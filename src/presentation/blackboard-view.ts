import { TextFileView, WorkspaceLeaf } from 'obsidian';
import type { BlackboardFile, PluginSettings, Stroke } from '../domain/entities';
import { FILE_EXTENSION } from '../domain/entities';
import { serialize, deserialize } from '../application/file-format';
import { DrawingEngine } from '../infrastructure/canvas-renderer';
import type { ToolManager } from '../domain/tool-manager';
import type { IDrawingRepository } from '../domain/ports';
import type { DocumentStore, SharedDocumentHandle } from '../application/document-store';
import { eraseAtPoint } from '../application/eraser-service';
import { inputDebugEnabled, inputDebugLog } from '../dev/input-debug';

// Replaced by esbuild `define` (true in dev builds, false in production, where the
// branch and the src/dev module behind it are eliminated from the bundle).
declare const __DEV_BUILD__: boolean;
import type { SurfaceManager } from './surface-manager';
import { engineSurface, type DrawingSurface } from './drawing-surface';

function dbgTarget(t: EventTarget | null): string {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return '?';
  const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
  return el.tagName.toLowerCase() + cls;
}


export const VIEW_TYPE = 'blackboard-view';
export { FILE_EXTENSION };

// Tracked document/observer teardown callbacks. Handlers are registered with concrete event
// types (PointerEvent, KeyboardEvent, …) and observer entries are invoked with null; method
// syntax keeps the parameter bivariant so both stay assignable.
type DocListenerFn = { fn(e: Event | null): void }['fn'];

export class BlackboardView extends TextFileView {
  private engine: DrawingEngine | null = null;
  private drawingContainer: HTMLElement | null = null;
  private settings: PluginSettings;
  private surfaceManager: SurfaceManager | null;
  private toolManager: ToolManager | undefined;
  private store: DocumentStore | null;
  private repo: IDrawingRepository | null;
  // The view's shared-document handle when the store is active. When set, the STORE is the
  // single writer for this path: mutations commit through it (never Obsidian requestSave),
  // and getViewData mirrors the same serialized content so any incidental Obsidian write is
  // byte-identical and suppressed by the store's own-write guard (no save->modify->reload loop).
  private handle: SharedDocumentHandle | null = null;
  private attaching: boolean = false;
  private surface: DrawingSurface | null = null;
  private isEmbedded: boolean = false;
  private docListeners: Array<{ type: string; fn: DocListenerFn; capture: boolean }> = [];
  private strokeActive: boolean = false;
  // Standalone view only: the surface fills the pane and is an infinite pan + zoom canvas
  // over the engine's view transform. On open (and on resize) the drawing is fitted into
  // the pane; once the user has drawn/panned/zoomed (`userInteracted`) the view is left
  // where they put it and a resize only resizes the backing store.
  private userInteracted: boolean = false;
  private resizeObserver: ResizeObserver | null = null;
  // Active finger (touch) pointers for standalone pan/pinch navigation, keyed by pointerId.
  // A single finger pans; two fingers pinch-zoom about the midpoint. Pen/mouse never enter
  // this map (they draw). Fingers are also kept out while a pen stroke is active (palm
  // rejection), and a stroke is not begun while this map is non-empty (finger gesture wins).
  private navPointers: Map<number, { x: number; y: number }> = new Map();
  private pinchPrev: { dist: number; x: number; y: number } | null = null;
  // Desktop space+drag pan state.
  private spaceDown: boolean = false;
  private spacePanActive: boolean = false;
  private spacePanPrev: { x: number; y: number } | null = null;

  constructor(leaf: WorkspaceLeaf, settings: PluginSettings, surfaceManager?: SurfaceManager, toolManager?: ToolManager, store?: DocumentStore, repo?: IDrawingRepository) {
    super(leaf);
    this.settings = settings;
    this.surfaceManager = surfaceManager ?? null;
    this.toolManager = toolManager;
    this.store = store ?? null;
    this.repo = repo ?? null;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? 'Drawing';
  }

  getIcon(): string {
    return 'pencil';
  }

  private editing: boolean = false;
  private fileData: string = '';

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass('blackboard-view-container');

    this.isEmbedded = this.detectEmbedded();
    this.enterEditMode();
  }

  private enterEditMode(): void {
    if (this.editing) return;
    this.editing = true;

    const container = this.contentEl;

    if (this.isEmbedded) {
      this.hideCanvasBlocker();
    }

    // The embedded (canvas-node) view fills its host with an absolute, overflow-hidden
    // surface. The standalone view instead fills the pane and scrolls when the drawing
    // is larger than the pane, so it must NOT use the embedded (absolute/clip) class.
    const containerCls = this.isEmbedded
      ? 'blackboard-drawing-container blackboard-embedded-drawing'
      : 'blackboard-drawing-container blackboard-standalone-drawing';
    this.drawingContainer = container.createDiv({ cls: containerCls });
    this.drawingContainer.style.touchAction = this.isEmbedded ? 'pan-x pan-y' : 'none';
    // Board background (issue #13): paint the surface (whiteboard/blackboard/etc.).
    this.drawingContainer.style.backgroundColor = this.settings.boardBackground;

    this.drawingContainer.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        e.preventDefault();
      }
    });

    // iPadOS Scribble swallows Apple Pencil pointer events that "look like" handwriting,
    // dropping whole strokes. A non-passive touchstart/touchmove preventDefault on the
    // drawing surface is the known fix (Pencil draws via pointer events, which still fire).
    const blockScribble = (e: TouchEvent) => { e.preventDefault(); };
    this.drawingContainer.addEventListener('touchstart', blockScribble, { passive: false });
    this.drawingContainer.addEventListener('touchmove', blockScribble, { passive: false });

    // Standalone full-page view: the drawing container is centred, leaving margins of bare
    // contentEl around it. A stylus over those margins still lands on an editable region,
    // so Scribble can fire there. Extend the same non-passive guard to contentEl so a
    // Pencil anywhere over the pane is suppressed; a standalone Blackboard must never
    // trigger Scribble. Tracked for removal on close so the listener never leaks across the
    // view's reusable contentEl. (Embedded mode keeps the note scrollable, so it is not
    // extended here.) Real-device confirmation only; see tasks.md §4.
    if (!this.isEmbedded) {
      const contentEl = container;
      contentEl.addEventListener('touchstart', blockScribble, { passive: false });
      contentEl.addEventListener('touchmove', blockScribble, { passive: false });
      this.docListeners.push({
        type: '__observer__',
        fn: () => {
          contentEl.removeEventListener('touchstart', blockScribble);
          contentEl.removeEventListener('touchmove', blockScribble);
        },
        capture: false,
      });
    }

    // Parse file dimensions first
    let fileWidth = 800;
    let fileHeight = 600;
    let fileStrokes: Stroke[] = [];
    if (this.fileData) {
      try {
        const result = deserialize(this.fileData);
        fileWidth = result.file.width;
        fileHeight = result.file.height;
        fileStrokes = result.file.strokes;
      } catch {
        // Unparseable data falls back to the 800x600 empty-drawing defaults above.
      }
    }

    // Share the plugin's single ToolManager so tool/colour/size are global across every
    // surface; the manager is seeded once at startup and is NOT re-seeded on mount, so
    // opening a file never clobbers the user's live selection (fix-tool-state-isolation).
    this.engine = new DrawingEngine(this.drawingContainer, fileWidth, fileHeight, this.toolManager);

    if (fileStrokes.length > 0) {
      this.engine.loadStrokes(fileStrokes);
    }

    if (this.isEmbedded) {
      this.drawingContainer.style.width = fileWidth + 'px';
      this.drawingContainer.style.height = fileHeight + 'px';
    } else {
      // Standalone: an infinite pan + zoom canvas. The surface fills the pane and
      // navigation is via the view transform (pan/zoom), NOT document scroll.
      container.setCssStyles({ position: 'relative' });
      this.layoutStandalone();
      this.resizeObserver = new ResizeObserver(() => this.layoutStandalone());
      this.resizeObserver.observe(container);
    }

    this.engine.staticDirty = true;
    this.engine.render();

    this.surface = engineSurface(this.engine, () => this.persist());
    this.surfaceManager?.register(this.surface, this.drawingContainer);
    this.surfaceManager?.setActive(this.surface);

    this.setupDocumentListeners();

    // Join the shared document so sibling edits (embeds, Canvas nodes) reach this view and
    // this view's edits reach them. Fire-and-forget: the engine already renders from the
    // file data; once acquired we reseed from the canonical strokes.
    void this.attachToStore();
  }

  /**
   * Register this view's surface with the path's shared document. Single-writer design:
   * after acquiring, the store owns persistence (`persist()` commits, never `requestSave`),
   * and a sibling commit reloads canonical strokes here WITHOUT re-centring (the user's
   * scroll position / `userInteracted` state is preserved). Idempotent and torn-down safe.
   */
  private async attachToStore(): Promise<void> {
    if (!this.store || !this.repo || !this.file || this.handle || this.attaching || !this.engine) return;
    this.attaching = true;
    try {
      const handle = await this.store.acquire(this.file.path, this.repo);
      if (!this.engine) { handle.release(); return; } // torn down while awaiting
      this.handle = handle;
      this.engine.loadStrokes(handle.getStrokes());
      this.engine.staticDirty = true;
      this.engine.render();
      handle.subscribe(() => {
        if (!this.engine || !this.handle) return;
        // Reload canonical strokes and repaint only — never re-centre, never re-persist.
        this.engine.loadStrokes(this.handle.getStrokes());
        this.engine.staticDirty = true;
        this.engine.requestRender();
      });
    } finally {
      this.attaching = false;
    }
  }

  /** Build the canonical file from the live engine; shared by getViewData and commit so the
   * store's serialized content matches what Obsidian would write (loop guard stays valid). */
  private buildFile(): BlackboardFile {
    const cb = this.engine!.getContentBounds();
    const hasContent = cb.width > 0 && cb.height > 0;
    return {
      version: 3,
      width: hasContent ? Math.round(cb.width) : 800,
      height: hasContent ? Math.round(cb.height) : 600,
      strokes: JSON.parse(JSON.stringify(this.engine!.strokeManager.strokes)) as Stroke[],
      background: { color: 'transparent' },
      contentBounds: hasContent ? cb : undefined,
    };
  }

  /** Persist a mutation. With the store active it is the single writer (commit -> debounced
   * save + sibling refresh); otherwise fall back to Obsidian's debounced requestSave. */
  private persist(): void {
    if (this.handle) this.handle.commit(this.buildFile());
    else this.requestSave();
  }

  /**
   * Standalone view layout: the drawing surface FILLS the pane (no grow-to-content, no
   * document scroll). Navigation is over the engine's view transform (infinite pan + zoom).
   * While the user has not yet interacted, the loaded content is fitted into the pane
   * (aspect-preserved, centred) on open/resize. Once `userInteracted` is set, a resize only
   * resizes the backing store and the current pan/zoom is preserved (no re-fit jump).
   */
  private layoutStandalone(): void {
    if (!this.engine || !this.drawingContainer || this.isEmbedded) return;
    const pane = this.contentEl;
    const paneW = pane.clientWidth || 800;
    const paneH = pane.clientHeight || 600;
    this.drawingContainer.style.width = paneW + 'px';
    this.drawingContainer.style.height = paneH + 'px';
    if (this.userInteracted) {
      // Preserve the user's pan/zoom; only resize the backing store to the new pane size.
      this.engine.resizeBox(paneW, paneH);
    } else {
      // Size the backing store to the pane, then fit the content into it (empty content
      // yields the identity transform — a blank pane-filling canvas at scale 1).
      this.engine.setDisplaySize(paneW, paneH);
      this.engine.refitToContent();
    }
  }

  getViewData(): string {
    // width/height cache the content-bounds size (recomputable from strokes); embeds use
    // them to render a drawing at its natural size. Built via buildFile() so the bytes match
    // what the store commits, keeping the own-write guard valid when the store is active.
    if (this.engine) this.fileData = serialize(this.buildFile());
    return this.fileData;
  }

  setViewData(data: string, clear: boolean): void {
    this.fileData = data;
    if (this.engine) {
      if (clear) this.engine.strokeManager.reset();
      try {
        const result = deserialize(data);
        this.engine.loadStrokes(result.file.strokes);
        if (this.isEmbedded) {
          this.engine.setCanvasSize(result.file.width, result.file.height);
          if (this.drawingContainer) {
            this.drawingContainer.style.width = result.file.width + 'px';
            this.drawingContainer.style.height = result.file.height + 'px';
          }
        } else {
          this.layoutStandalone();
        }
      } catch {
        // Layout during teardown can race a detached container; the next resize re-lays out.
      }
      this.engine.staticDirty = true;
      this.engine.render();
    }
    // The path becomes known once Obsidian loads the file; attach now if we haven't yet.
    void this.attachToStore();
  }

  clear(): void {
    if (this.engine) this.engine.strokeManager.reset();
  }

  async onClose(): Promise<void> {
    // Flush any unsaved strokes before tearing down. When the store is active it is the
    // single writer and flushes its own pending debounced save on release(), so only the
    // legacy (no-store) path writes through Obsidian here (avoids a double-write).
    if (this.engine && this.file && !this.handle) {
      try {
        await this.app.vault.modify(this.file, this.getViewData());
      } catch {
        // Save is retried on the next stroke end; failing here must not break the view.
      }
    }
    if (this.handle) {
      this.handle.release();
      this.handle = null;
    }
    for (const listener of this.docListeners) {
      if (listener.type === '__observer__') {
        listener.fn(null);
      } else {
        activeDocument.removeEventListener(listener.type, listener.fn, listener.capture);
      }
    }
    this.docListeners = [];
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.surface) {
      this.surfaceManager?.unregister(this.surface);
      this.surface = null;
    }
    if (this.engine) {
      this.engine.destroy();
      this.engine = null;
    }
    this.drawingContainer = null;
    this.navPointers.clear();
    this.pinchPrev = null;
    this.spaceDown = false;
    this.spacePanActive = false;
    this.spacePanPrev = null;
    this.editing = false;
  }

  private detectEmbedded(): boolean {
    let el: HTMLElement | null = this.contentEl;
    while (el) {
      if (el.classList.contains('canvas-node-content')) return true;
      el = el.parentElement;
    }
    return false;
  }

  private hideCanvasBlocker(): void {
    let canvasNode: HTMLElement | null = null;
    let el: HTMLElement | null = this.contentEl;
    while (el) {
      if (el.classList.contains('canvas-node')) {
        canvasNode = el;
        break;
      }
      el = el.parentElement;
    }
    if (!canvasNode) return;

    const hideBlocker = () => {
      const blocker = canvasNode.querySelector<HTMLElement>('.canvas-node-content-blocker');
      if (blocker) blocker.setCssStyles({ display: 'none' });
    };
    hideBlocker();

    const observer = new MutationObserver(hideBlocker);
    observer.observe(canvasNode, { childList: true, subtree: true });
    this.docListeners.push({ type: '__observer__', fn: () => observer.disconnect(), capture: false });

    canvasNode.addEventListener('click', (e) => {
      if (this.contentEl.contains(e.target as Node)) {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    }, true);

    canvasNode.addEventListener('dblclick', (e) => {
      if (this.contentEl.contains(e.target as Node)) {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    }, true);
  }

  private setupDocumentListeners(): void {
    if (!this.drawingContainer || !this.engine) return;
    const dc = this.drawingContainer;
    const engine = this.engine;

    const isInsideDrawing = (e: PointerEvent): boolean => {
      const target = e.target as HTMLElement;
      if (target.closest('.canvas-node-resize-handle')) return false;
      return dc.contains(target) && !target.closest('.blackboard-toolbar');
    };

    const handlePoint = (e: PointerEvent): void => {
      let localX: number;
      let localY: number;
      if (this.isEmbedded) {
        const rect = dc.getBoundingClientRect();
        const scaleX = engine.drawingWidth / rect.width;
        const scaleY = engine.drawingHeight / rect.height;
        localX = (e.clientX - rect.left) * scaleX;
        localY = (e.clientY - rect.top) * scaleY;
      } else {
        // Standalone: invert the full pan + zoom view transform (scale and offset).
        [localX, localY] = engine.screenToDrawing(e.clientX, e.clientY, dc);
      }
      const tool = engine.toolManager.activeTool;

      if (tool === 'eraser') {
        this.eraseAt(localX, localY);
        return;
      }
      engine.addPoint([localX, localY, e.pressure || 0.5]);
    };

    // A finger (touch) never draws: in the standalone view it navigates (pan/zoom), in the
    // embed it is ignored. Pen always draws; mouse draws (and pans with space held).
    const isDrawingInput = (e: PointerEvent): boolean => {
      if (e.pointerType === 'touch') return false;
      if (!this.isEmbedded) return true;
      return e.pointerType === 'pen' || e.pointerType === 'mouse';
    };

    const onDocPointerDown = (e: PointerEvent) => {
      const inside = isInsideDrawing(e);
      const drawInput = isDrawingInput(e);
      if (__DEV_BUILD__ && inputDebugEnabled()) {
        inputDebugLog(`DOWN ${e.pointerType} in=${inside ? 'Y' : 'N'} draw=${drawInput ? 'Y' : 'N'} tgt=${dbgTarget(e.target)}${inside && drawInput ? ' OK' : ' REJECT'}`);
      }
      if (!inside) return;

      // Standalone finger navigation: a touch pans/pinch-zooms the view, it never draws.
      // While a pen stroke is active, ignore fingers so a resting palm cannot pan.
      if (!this.isEmbedded && e.pointerType === 'touch') {
        if (this.strokeActive) return; // palm rejection
        e.stopPropagation();
        e.preventDefault();
        this.userInteracted = true;
        this.navPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.pinchPrev = null; // re-baseline the pinch on the next move
        return;
      }

      // Standalone desktop space+drag pan (mouse held with the space bar down).
      if (!this.isEmbedded && this.spaceDown && e.pointerType !== 'touch') {
        e.stopPropagation();
        e.preventDefault();
        this.userInteracted = true;
        this.spacePanActive = true;
        this.spacePanPrev = { x: e.clientX, y: e.clientY };
        return;
      }

      if (!drawInput) return;
      // A finger gesture is in progress: do not begin a stroke (finger navigation wins).
      if (!this.isEmbedded && this.navPointers.size > 0) return;
      e.stopPropagation();
      e.preventDefault();
      // Stop re-fitting the standalone view on resize once the user has drawn.
      this.userInteracted = true;
      this.strokeActive = true;
      if (this.surface) this.surfaceManager?.setActive(this.surface);
      this.surfaceManager?.notifyStrokeStart();
      const tool = engine.toolManager.activeTool;
      if (tool !== 'eraser') {
        engine.beginStroke(e.pointerType);
      }
      handlePoint(e);
    };

    const onDocPointerMove = (e: PointerEvent) => {
      // Standalone finger navigation (pan / pinch-zoom) — decoupled from the DocumentStore.
      if (!this.isEmbedded && this.navPointers.has(e.pointerId)) {
        e.stopPropagation();
        e.preventDefault();
        const prev = this.navPointers.get(e.pointerId)!;
        this.navPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.navPointers.size >= 2) {
          const pts = [...this.navPointers.values()];
          const a = pts[0];
          const b = pts[1];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          const rect = dc.getBoundingClientRect();
          const mx = (a.x + b.x) / 2 - rect.left;
          const my = (a.y + b.y) / 2 - rect.top;
          if (this.pinchPrev) {
            if (this.pinchPrev.dist > 0 && dist > 0) {
              engine.zoomAt(dist / this.pinchPrev.dist, mx, my);
            }
            const mdx = mx - this.pinchPrev.x;
            const mdy = my - this.pinchPrev.y;
            if (mdx || mdy) engine.panBy(mdx, mdy);
          }
          this.pinchPrev = { dist, x: mx, y: my };
        } else {
          const dx = e.clientX - prev.x;
          const dy = e.clientY - prev.y;
          if (dx || dy) engine.panBy(dx, dy);
        }
        return;
      }

      // Standalone desktop space+drag pan.
      if (!this.isEmbedded && this.spacePanActive && this.spacePanPrev) {
        e.stopPropagation();
        e.preventDefault();
        const dx = e.clientX - this.spacePanPrev.x;
        const dy = e.clientY - this.spacePanPrev.y;
        this.spacePanPrev = { x: e.clientX, y: e.clientY };
        if (dx || dy) engine.panBy(dx, dy);
        return;
      }

      if (!this.strokeActive) return;
      if (!isDrawingInput(e)) return;
      e.stopPropagation();
      e.preventDefault();
      handlePoint(e);
    };

    const onDocPointerUp = (e: PointerEvent) => {
      if (!this.isEmbedded && this.navPointers.has(e.pointerId)) {
        this.navPointers.delete(e.pointerId);
        this.pinchPrev = null;
        e.stopPropagation();
        return;
      }
      if (!this.isEmbedded && this.spacePanActive) {
        this.spacePanActive = false;
        this.spacePanPrev = null;
        e.stopPropagation();
        return;
      }
      if (!this.strokeActive) return;
      if (!isDrawingInput(e)) return;
      this.strokeActive = false;
      e.stopPropagation();
      const tool = engine.toolManager.activeTool;
      if (tool !== 'eraser') {
        engine.endStroke();
        this.persist();
      }
      // Re-sync the toolbar (undo/redo enablement) the instant a stroke or erase commits,
      // so the undo arrow lights up immediately rather than on the next tap (QA3).
      this.surfaceManager?.notifyStrokeEnd();
      if (__DEV_BUILD__ && inputDebugEnabled()) inputDebugLog(`UP committed total=${engine.strokeManager.strokes.length}`);
    };

    activeDocument.addEventListener('pointerdown', onDocPointerDown, true);
    activeDocument.addEventListener('pointermove', onDocPointerMove, true);
    activeDocument.addEventListener('pointerup', onDocPointerUp, true);

    this.docListeners.push({ type: 'pointerdown', fn: onDocPointerDown, capture: true });
    this.docListeners.push({ type: 'pointermove', fn: onDocPointerMove, capture: true });
    this.docListeners.push({ type: 'pointerup', fn: onDocPointerUp, capture: true });

    // Standalone desktop navigation: Ctrl/Cmd+wheel zooms about the cursor; space+drag
    // pans (handled in the pointer handlers above). These mutate only the view transform.
    if (!this.isEmbedded) {
      const onWheel = (e: WheelEvent) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        if (!dc.contains(e.target as Node)) return;
        e.preventDefault();
        e.stopPropagation();
        this.userInteracted = true;
        const rect = dc.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        // deltaY < 0 (scroll up / pinch-out) zooms in; > 0 zooms out.
        const factor = Math.exp(-e.deltaY * 0.01);
        engine.zoomAt(factor, cx, cy);
      };
      dc.addEventListener('wheel', onWheel, { passive: false });
      this.docListeners.push({ type: '__observer__', fn: () => dc.removeEventListener('wheel', onWheel), capture: false });

      const onKeyDown = (e: KeyboardEvent) => { if (e.code === 'Space') this.spaceDown = true; };
      const onKeyUp = (e: KeyboardEvent) => {
        if (e.code === 'Space') { this.spaceDown = false; this.spacePanActive = false; this.spacePanPrev = null; }
      };
      activeDocument.addEventListener('keydown', onKeyDown, true);
      activeDocument.addEventListener('keyup', onKeyUp, true);
      this.docListeners.push({ type: 'keydown', fn: onKeyDown, capture: true });
      this.docListeners.push({ type: 'keyup', fn: onKeyUp, capture: true });
    }
  }

  private eraseAt(localX: number, localY: number): void {
    if (!this.engine) return;
    const erased = eraseAtPoint(
      this.engine.strokeManager,
      localX, localY,
      this.engine.toolManager.activeSize,
    );
    if (erased) {
      this.engine.staticDirty = true;
      this.engine.requestRender();
      this.persist();
    }
  }
}
