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

/** Screen-px margin kept around the drawing when the standalone view fits it to the pane. */
const STANDALONE_FIT_MARGIN = 16;
export { FILE_EXTENSION };

// Tracked document/observer teardown callbacks. Handlers are registered with concrete event
// types (PointerEvent, KeyboardEvent) and observer entries are called with null. Method syntax
// keeps the parameter bivariant so both stay assignable.
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
  // True once the engine has been populated with this file's strokes and represents the live
  // user state. Obsidian's TextFileView lifecycle can call clear() (which empties the engine)
  // during teardown/reuse/mobile-suspend and then getViewData() to persist; rebuilding from
  // the emptied engine would serialize a BLANK file and overwrite a real drawing (the iPad
  // lock-screen data loss). While this is false, getViewData() returns the last loaded bytes
  // instead of the empty engine, so a transient clear() can never blank the file on disk.
  private contentLoaded: boolean = false;
  private surface: DrawingSurface | null = null;
  private isEmbedded: boolean = false;
  private docListeners: Array<{ type: string; fn: DocListenerFn; capture: boolean }> = [];
  private strokeActive: boolean = false;
  // Standalone view only: the surface fills the pane and is an infinite pan + zoom canvas
  // over the engine's view transform. On open and on resize the drawing is fitted into the
  // pane. Once the user has drawn, panned or zoomed (`userInteracted`), the view stays where
  // they put it and a resize only resizes the backing store.
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

    // The embedded (Canvas node) view fills its host with an absolute, overflow-hidden
    // surface. The standalone view sizes its surface to the pane itself and pans and zooms
    // instead, so it must NOT use the embedded (absolute, clipped) class.
    const containerCls = this.isEmbedded
      ? 'blackboard-drawing-container blackboard-embedded-drawing'
      : 'blackboard-drawing-container blackboard-standalone-drawing';
    this.drawingContainer = container.createDiv({ cls: containerCls });
    this.drawingContainer.style.touchAction = this.isEmbedded ? 'pan-x pan-y' : 'none';
    // Board background (issue #13): paint the surface in the chosen board colour.
    this.drawingContainer.style.backgroundColor = this.settings.boardBackground;

    this.drawingContainer.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        e.preventDefault();
      }
    });

    // iPadOS Scribble swallows Apple Pencil pointer events that look like handwriting and
    // drops whole strokes. A non-passive touchstart/touchmove preventDefault on the drawing
    // surface stops it (the Pencil draws through pointer events, which still fire).
    const blockScribble = (e: TouchEvent) => { e.preventDefault(); };
    this.drawingContainer.addEventListener('touchstart', blockScribble, { passive: false });
    this.drawingContainer.addEventListener('touchmove', blockScribble, { passive: false });

    // Standalone full-page view: extend the same guard to contentEl, so a Pencil anywhere in
    // the pane is covered and not only over the drawing container. The listeners are removed
    // on close because Obsidian reuses the view's contentEl. (The embedded view skips this so
    // its host stays scrollable.) This can only be checked on a real iPad.
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

    // Read the saved size and strokes before building the engine.
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

    // Share the plugin's single ToolManager so the tool, colour and size are the same on every
    // surface. The manager is seeded once at startup and NOT on mount, so opening a file never
    // resets the tool the user picked.
    this.engine = new DrawingEngine(this.drawingContainer, fileWidth, fileHeight, this.toolManager);

    if (fileStrokes.length > 0) {
      this.engine.loadStrokes(fileStrokes);
    }
    // The engine now mirrors this.fileData (empty or not), so getViewData() may rebuild from it.
    this.contentLoaded = true;

    if (this.isEmbedded) {
      this.drawingContainer.style.width = fileWidth + 'px';
      this.drawingContainer.style.height = fileHeight + 'px';
    } else {
      // Standalone: an infinite pan + zoom canvas. The surface fills the pane and navigation
      // is the view transform, NOT document scroll, so the pane itself never scrolls (a
      // scrolled pane shifts the surface under the pointer).
      container.setCssStyles({ position: 'relative' });
      container.addClass('blackboard-standalone-host');
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

    // Join the shared document so edits in embeds and Canvas nodes reach this view and this
    // view's edits reach them. Not awaited: the engine already renders from the file data and
    // reloads the canonical strokes once the handle arrives.
    void this.attachToStore();
  }

  /**
   * Attach this view to the path's shared document. After that the store is the only writer
   * (`persist()` commits, never `requestSave`), and a commit from another view reloads the
   * canonical strokes here WITHOUT re-fitting (the user's pan and zoom stay put). Safe to call
   * more than once and safe if the view closes while it waits.
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
        // Reload the canonical strokes and repaint. Never re-fit and never save from here.
        this.engine.loadStrokes(this.handle.getStrokes());
        this.engine.staticDirty = true;
        this.engine.requestRender();
      });
    } finally {
      this.attaching = false;
    }
  }

  /** Build the canonical file from the live engine. getViewData and commit both use it, so the
   * store's serialized content matches what Obsidian would write (the loop guard stays valid). */
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

  /** Save a change. With the store attached it is the only writer (commit, then a debounced
   * save and a refresh of the other views); otherwise use Obsidian's debounced requestSave. */
  private persist(): void {
    // Never write from an engine that does not hold this file's strokes. Obsidian can call
    // clear() during teardown, view reuse or a mobile suspend, which empties the engine and
    // sets contentLoaded=false while the store handle stays attached. A persist() after that
    // (a stray pointerup/pointercancel after an iPad suspend, or an erase) would commit an
    // EMPTY buildFile() over a real drawing, and the store would save it to disk and push the
    // blank to every other view. getViewData() has this guard; the store path skips
    // getViewData entirely, so it needs its own. (This wiped a drawing on iPad on 2026-08-21.)
    if (!this.contentLoaded) return;
    if (this.handle) this.handle.commit(this.buildFile());
    else this.requestSave();
  }

  /**
   * Standalone view layout: the drawing surface FILLS the pane (no grow-to-content, no
   * document scroll). Navigation is over the engine's view transform (infinite pan + zoom).
   * Until the user interacts, each open or resize fits the content into the pane (aspect
   * kept, centred, shrunk if needed but never zoomed in). Once `userInteracted` is set, a
   * resize only resizes the backing store and the current pan and zoom stay put (no jump).
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
      // Size the backing store to the pane, then fit the content into it. The fit only shrinks a
      // big drawing, never zooms a small one in (maxScale 1); empty content opens at scale 1.
      this.engine.setDisplaySize(paneW, paneH);
      this.engine.refitToContent(0, STANDALONE_FIT_MARGIN, 1);
    }
  }

  getViewData(): string {
    // width/height store the content-bounds size (recomputable from strokes); embeds and
    // Canvas nodes fit against them. Built via buildFile() so the bytes match what the store
    // commits, which keeps the own-write guard valid when the store is attached.
    //
    // Only rebuild from the engine when it actually holds the loaded drawing. After a
    // teardown or suspend clear() the engine is empty but the file still has strokes, and
    // rebuilding would return a blank drawing that Obsidian then writes over the file (data
    // loss). In that state the last loaded bytes are returned unchanged.
    if (this.engine && this.contentLoaded) this.fileData = serialize(this.buildFile());
    return this.fileData;
  }

  setViewData(data: string, clear: boolean): void {
    this.fileData = data;
    // Once the store owns this drawing, Obsidian's reload after a save is the store's own write
    // coming back (outside edits arrive through the store's reconcile instead). Reloading the
    // engine here would wipe the undo history after every stroke, and when the write is slow
    // (iPad) it would load an older file and erase the stroke drawn in the meantime.
    if (this.handle && !clear) return;
    if (this.engine) {
      if (clear) this.engine.strokeManager.reset();
      try {
        const result = deserialize(data);
        this.engine.loadStrokes(result.file.strokes);
        // The engine now mirrors the file: getViewData() may rebuild from it again.
        this.contentLoaded = true;
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
        // Unparseable data, or a layout racing a detached container during teardown. The
        // engine is left as it is, and the next resize lays it out again.
      }
      this.engine.staticDirty = true;
      this.engine.render();
    }
    // The path becomes known once Obsidian loads the file; attach now if not attached yet.
    void this.attachToStore();
  }

  clear(): void {
    if (this.engine) this.engine.strokeManager.reset();
    // The engine no longer holds the file's strokes; getViewData() must fall back to the last
    // loaded bytes rather than serialize this empty engine over a real drawing (data loss).
    this.contentLoaded = false;
  }

  async onClose(): Promise<void> {
    this.contentEl.classList.remove('blackboard-standalone-host');
    // Flush any unsaved strokes before tearing down. With the store attached it is the only
    // writer and flushes its own pending save on release(), so only the no-store path writes
    // through Obsidian here (this avoids a double write).
    if (this.engine && this.file && !this.handle) {
      try {
        await this.app.vault.modify(this.file, this.getViewData());
      } catch {
        // Best effort: a failed write must not stop the view from closing.
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

    // A finger (touch) never draws: in the standalone view it pans and zooms, in the embed it
    // is ignored. Pen and mouse draw (in the standalone view, a mouse with space held pans).
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

      // Standalone finger navigation: a touch pans or pinch-zooms the view and never draws.
      // While a pen stroke is active, fingers are ignored so a resting palm cannot pan.
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
      // A finger gesture is in progress. The Pencil wins over it: on iPad the palm usually rests
      // on the screen before the Pencil touches down, and that touch must not swallow the stroke.
      // Drop the navigation pointers (the resting palm's later moves and lift are then ignored as
      // non-drawing input) and draw. Any other input still yields to finger navigation.
      if (!this.isEmbedded && this.navPointers.size > 0) {
        if (e.pointerType !== 'pen') return;
        this.navPointers.clear();
        this.pinchPrev = null;
      }
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
      // Standalone finger navigation (pan, pinch-zoom). It only moves the view and never
      // touches the DocumentStore.
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
      // Update the toolbar's undo/redo as soon as a stroke or erase commits, so the undo
      // arrow lights up right away rather than on the next tap.
      this.surfaceManager?.notifyStrokeEnd();
      if (__DEV_BUILD__ && inputDebugEnabled()) inputDebugLog(`UP committed total=${engine.strokeManager.strokes.length}`);
    };

    activeDocument.addEventListener('pointerdown', onDocPointerDown, true);
    activeDocument.addEventListener('pointermove', onDocPointerMove, true);
    activeDocument.addEventListener('pointerup', onDocPointerUp, true);
    // iPadOS ends palm and finger touches with pointercancel (not pointerup), typically when the
    // Pencil comes down. Treat it as the pointer ending: otherwise the touch stays in navPointers
    // and every later pen stroke is rejected as "finger navigation in progress".
    activeDocument.addEventListener('pointercancel', onDocPointerUp, true);

    this.docListeners.push({ type: 'pointerdown', fn: onDocPointerDown, capture: true });
    this.docListeners.push({ type: 'pointermove', fn: onDocPointerMove, capture: true });
    this.docListeners.push({ type: 'pointerup', fn: onDocPointerUp, capture: true });
    this.docListeners.push({ type: 'pointercancel', fn: onDocPointerUp, capture: true });

    // Standalone desktop navigation: a plain wheel or trackpad scroll pans, Ctrl/Cmd+wheel
    // zooms about the cursor, and space+drag pans (handled in the pointer handlers above).
    // All of these change only the view transform.
    if (!this.isEmbedded) {
      const onWheel = (e: WheelEvent) => {
        if (!dc.contains(e.target as Node)) return;
        e.preventDefault();
        e.stopPropagation();
        this.userInteracted = true;
        // Plain wheel / two-finger trackpad scroll pans the infinite canvas; Ctrl/Cmd zooms.
        if (!(e.ctrlKey || e.metaKey)) {
          engine.panBy(-e.deltaX, -e.deltaY);
          return;
        }
        const rect = dc.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        // deltaY < 0 (scroll up / pinch-out) zooms in; > 0 zooms out.
        const factor = Math.exp(-e.deltaY * 0.01);
        engine.zoomAt(factor, cx, cy);
      };
      dc.addEventListener('wheel', onWheel, { passive: false });
      this.docListeners.push({ type: '__observer__', fn: () => dc.removeEventListener('wheel', onWheel), capture: false });

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code !== 'Space') return;
        this.spaceDown = true;
        // Space is the pan modifier here, so it must not also do the browser's page-scroll: that
        // smooth-scrolls the pane and slides the surface under the pointer mid-stroke. Only when
        // this view is the active one and focus is not in a text field (typing a space elsewhere
        // keeps working).
        // instanceOf, not instanceof: in a popout window the target belongs to that window's
        // HTMLElement class, which a plain instanceof against this window's class rejects.
        const t = e.target as Node | null;
        if (t?.instanceOf?.(HTMLElement) && (t.isContentEditable || t.closest('input, textarea, select'))) return;
        if (this.app?.workspace?.getActiveViewOfType?.(BlackboardView) !== this) return;
        e.preventDefault();
      };
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
