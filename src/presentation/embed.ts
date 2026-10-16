import type { IDrawingRepository } from '../domain/ports';
import type { BlackboardFile, PluginSettings, Stroke } from '../domain/entities';
import { DrawingEngine } from '../infrastructure/canvas-renderer';
import type { ToolManager } from '../domain/tool-manager';
import { eraseAtPoint } from '../application/eraser-service';
import { inputDebugEnabled, inputDebugLog } from '../dev/input-debug';

// Replaced by esbuild `define` (true in dev builds, false in production, where the
// branch and the src/dev module behind it are eliminated from the bundle).
declare const __DEV_BUILD__: boolean;
import type { SurfaceManager } from './surface-manager';
import type { DocumentStore, SharedDocumentHandle } from '../application/document-store';
import { engineSurface } from './drawing-surface';

// Tracked document/observer teardown callbacks. Handlers are registered with concrete event
// types (PointerEvent, TouchEvent, …) and observer entries are invoked with null; method
// syntax keeps the parameter bivariant so both stay assignable.
type DocListenerFn = { fn(e: Event | null): void }['fn'];

function dbgTarget(t: EventTarget | null): string {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return '?';
  const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
  return el.tagName.toLowerCase() + cls;
}

/** Screen-px margin kept around the drawing when an embed fits it. */
const EMBED_FIT_MARGIN = 8;

function isDrawingInput(e: PointerEvent): boolean {
  return e.pointerType === 'pen' || e.pointerType === 'mouse';
}

/**
 * Obsidian's mobile bottom editing toolbar appears whenever the Markdown editor (CodeMirror)
 * holds focus. In Live Preview the embed is rendered INSIDE that editor, so a pen-down can
 * leave the editor focused — which raises the bottom toolbar and lets iPadOS Scribble take
 * over the Pencil (drawing then turns into handwriting-to-text). Blurring the focused editor
 * at stroke start keeps that toolbar down, so Scribble never engages. Only blur a genuinely
 * editable/CodeMirror element; never steal focus from anything else.
 */
function suppressEditorFocus(): void {
  const active = activeDocument.activeElement as HTMLElement | null;
  if (!active || typeof active.blur !== 'function') return;
  const isEditor = active.isContentEditable || active.closest('.cm-editor') !== null;
  if (isEditor) active.blur();
}

/**
 * Cleanups of every live embed mount. Plugin reloads (store update, sync restart,
 * dev hot-swap, manual toggle) MUST unmount all embeds via unmountAllEmbeds():
 * otherwise the surviving DOM keeps dataset.bbMounted='true', the next plugin
 * instance refuses to re-mount, and the user draws on an orphaned engine whose
 * surface the new toolbar has never heard of (dead/disabled toolbar until the
 * note is reopened) — plus the orphan's document-level listeners leak.
 */
const liveMounts = new Map<() => void, HTMLElement>();

/**
 * Release every live embed whose element is no longer in the document: Obsidian Canvas
 * unmounts the content of nodes that scroll out of view (or zoom out to placeholders), and
 * notes drop their embeds when closed or virtualised. Each mounted embed holds a drawing
 * engine with two full-size canvas bitmaps plus document listeners, so keeping them alive
 * makes memory and per-event cost grow with every drawing ever shown. Cleanup resets the
 * mount marker, so the embed mounts again if Obsidian re-attaches its element.
 */
export function releaseDetachedEmbeds(): void {
  for (const [cleanup, el] of Array.from(liveMounts)) {
    if (!el.isConnected) cleanup();
  }
}

export function unmountAllEmbeds(): void {
  for (const cleanup of Array.from(liveMounts.keys())) cleanup();
  liveMounts.clear();
}

export async function mountBlackboardEmbed(repo: IDrawingRepository, embedEl: HTMLElement, filePath: string, settings: PluginSettings, surfaceManager?: SurfaceManager, toolManager?: ToolManager, store?: DocumentStore): Promise<() => void> {
  if (embedEl.dataset.bbMounted === 'true') return () => {};
  embedEl.dataset.bbMounted = 'true';
  embedEl.empty();
  embedEl.addClass('blackboard-embed');
  // Inline (not a class): embedEl carries host classes (.internal-embed etc.) whose
  // app/theme rules these must always beat.
  embedEl.setCssStyles({ position: 'relative', display: 'flex', flexDirection: 'column' });

  // The shared document is the single source of truth for this path: the engine renders
  // from its canonical strokes and writes through it, so sibling surfaces stay in sync
  // (B2). Without a store (back-compat / isolated tests) we fall back to the repo directly.
  const handle: SharedDocumentHandle | null = store ? await store.acquire(filePath, repo) : null;
  const file = handle ? handle.getFile() : (await repo.load(filePath)).file;
  // Saved width/height describe the drawing at save time; using them as the fit reference
  // (rather than the live, growing content bounds) keeps an edit-and-remount round trip
  // scale-stable (B3).
  const refFile = () => (handle ? handle.getFile() : file);

  const drawingContainer = createDiv();
  drawingContainer.className = 'blackboard-drawing-container blackboard-embedded-drawing';
  // Inline (not a class): position:relative must override .blackboard-embedded-drawing's
  // position:absolute for the flex-child layout used here.
  drawingContainer.setCssStyles({ position: 'relative', width: '100%', flex: '1', minHeight: '150px' });
  // Board background (issue #13): paint the surface so a whiteboard/blackboard shows here too.
  drawingContainer.style.backgroundColor = settings.boardBackground;
  embedEl.appendChild(drawingContainer);

  // Display size is measured from the drawing surface element (the same one the pointer
  // mapping uses), in layout px. Measuring the outer embed element or the zoom-scaled
  // rect causes pen-tip/stroke drift when Obsidian Canvas is zoomed.
  function hostBox(): { w: number; h: number } {
    const w = drawingContainer.clientWidth || drawingContainer.offsetWidth || 400;
    const h = drawingContainer.clientHeight || drawingContainer.offsetHeight || 300;
    return { w, h };
  }

  // Removed in cleanup: a Canvas node's contentEl (embedEl) is reused across mount/unmount
  // cycles, so a listener left behind would keep this whole mount (engine, strokes, bitmaps)
  // alive and stack up with every remount.
  const swallowClick = (e: Event) => { e.stopPropagation(); e.stopImmediatePropagation(); };
  embedEl.addEventListener('click', swallowClick, true);
  embedEl.addEventListener('dblclick', swallowClick, true);

  const docListeners: Array<{ type: string; fn: DocListenerFn; capture: boolean }> = [];

  let canvasNode: HTMLElement | null = null;
  let el: HTMLElement | null = embedEl;
  while (el) {
    if (el.classList.contains('canvas-node')) { canvasNode = el; break; }
    el = el.parentElement;
  }
  if (canvasNode) {
    const hideBlocker = () => {
      const blocker = canvasNode.querySelector<HTMLElement>('.canvas-node-content-blocker');
      if (blocker) blocker.setCssStyles({ display: 'none' });
    };
    hideBlocker();
    const observer = new MutationObserver(hideBlocker);
    observer.observe(canvasNode, { childList: true, subtree: true });
    docListeners.push({ type: '__observer__', fn: () => observer.disconnect(), capture: false });
  }

  // Markdown embeds (no .canvas-node ancestor) are a fixed-scale fit-to-content FRAME that
  // never upscales past natural size (maxScale = 1 → letterbox/centre a small drawing crisp).
  // Canvas-node embeds keep the uncapped fill (maxScale = Infinity) and, after the one-time
  // mount fit, behave as a fixed-scale window that extends/clips on node resize.
  const maxFitScale = canvasNode ? Infinity : 1;

  const box0 = hostBox();
  // Share the plugin's single ToolManager so tool/colour/size are global across every
  // surface (fix-tool-state-isolation).
  const engine = new DrawingEngine(drawingContainer, box0.w, box0.h, toolManager);
  engine.loadStrokes(handle ? handle.getStrokes() : file.strokes);
  engine.setDisplaySize(box0.w, box0.h);
  const fitAll = () => engine.fitReferenceSize(refFile().width, refFile().height, 0, maxFitScale, EMBED_FIT_MARGIN);
  fitAll();
  engine.render();

  // A sibling surface committing notifies us (the drawing changed in another view): reload the
  // canonical strokes and repaint. Our view transform is KEPT while the drawing still fits in
  // this frame, so edits elsewhere never rescale it; once it no longer fits, re-fit (debounced)
  // so the whole drawing shows at its own proportions. The embed/node element is never resized.
  // Our own strokes never notify us (the store skips the committing surface), so nothing moves
  // while drawing here. We never persist in response to a notification (no save feedback loop).
  let refitTimer = 0;
  if (handle) {
    handle.subscribe(() => {
      engine.loadStrokes(handle.getStrokes());
      engine.staticDirty = true;
      engine.requestRender();
      if (engine.contentFitsView()) return;
      window.clearTimeout(refitTimer);
      refitTimer = window.setTimeout(() => {
        if (strokeActive || engine.contentFitsView()) return;
        fitAll();
      }, 250);
    });
  }

  // The node's LOGICAL rect (canvas units): offsetWidth/offsetHeight and the inline-transform
  // translate. NOT getBoundingClientRect, whose pixel size changes on canvas zoom — keying off
  // logical size makes a pure zoom a non-event for the frame logic.
  function nodeLogicalRect(): { x: number; y: number; w: number; h: number } {
    const node = canvasNode!;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const tr = node.style.transform || '';
    const m = tr.match(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/);
    const x = m ? parseFloat(m[1]) : node.offsetLeft;
    const y = m ? parseFloat(m[2]) : node.offsetTop;
    return { x, y, w, h };
  }

  // Canvas-node embeds: record the initial logical rect so resize deltas anchor the opposite
  // (non-dragged) edge. Markdown embeds don't use this.
  let prevLogical = canvasNode ? nodeLogicalRect() : null;

  // The canvases' backing store must always match the drawing surface's own layout size:
  // the pen is mapped through that size (screenToDrawing), so a bitmap of any other size is
  // stretched and strokes render offset from the stylus. Tracked separately from the node rect.
  let lastBox = hostBox();

  // Host resize handling. A Markdown embed re-fits (host-driven sizing, capped at 1× so it
  // never upscales). A canvas-node embed is a FIXED-SCALE FRAME: it keeps the established
  // scale and resizes the backing store (resizeBox, transform-preserving) so the drag side
  // reveals/clips drawable area while the opposite edge stays anchored — never re-fitting.
  const ro = new ResizeObserver(() => {
    if (canvasNode && prevLogical) {
      const cur = nodeLogicalRect();
      const box = hostBox();
      const dw = cur.w - prevLogical.w;
      const dh = cur.h - prevLogical.h;
      // Size the bitmap to the drawing container, not the node: the node also holds its border
      // and chrome, and the container can settle after mount without the node changing size.
      // A pure canvas zoom changes neither (layout px), so it stays a no-op.
      if (box.w !== lastBox.w || box.h !== lastBox.h) {
        engine.resizeBox(box.w, box.h);
        lastBox = box;
      }
      // Left edge moved (logical x changed): nudge content right/left by Δw so the right edge
      // stays anchored. Top edge moved (logical y changed): nudge by Δh to anchor the bottom.
      if (dw !== 0 && cur.x !== prevLogical.x) engine.panBy(dw, 0);
      if (dh !== 0 && cur.y !== prevLogical.y) engine.panBy(0, dh);
      prevLogical = cur;
    } else {
      const b = hostBox();
      engine.setDisplaySize(b.w, b.h);
      fitAll();
    }
  });
  ro.observe(drawingContainer);
  docListeners.push({ type: '__observer__', fn: () => ro.disconnect(), capture: false });

  async function saveDrawing(): Promise<void> {
    try {
      const b = engine.getContentBounds();
      const fileToSave: BlackboardFile = {
        version: 3,
        width: b.width || 800,
        height: b.height || 600,
        strokes: JSON.parse(JSON.stringify(engine.strokeManager.strokes)) as Stroke[],
        background: { color: 'transparent' },
        contentBounds: (b.width > 0 && b.height > 0) ? b : undefined,
      };
      // The store is the single writer: commit persists (debounced) and refreshes siblings.
      if (handle) handle.commit(fileToSave);
      else await repo.save(filePath, fileToSave);
    } catch {
      // Best-effort save; the next stroke end retries. Never break drawing over I/O.
    }
  }

  const surface = engineSurface(engine, () => { void saveDrawing(); });
  surfaceManager?.register(surface, drawingContainer);
  // Auto-show the shared toolbar when a page/node already contains a drawing, instead
  // of waiting for the first pointer interaction.
  surfaceManager?.setActive(surface);

  let strokeActive = false;

  function isInsideDrawing(e: PointerEvent): boolean {
    const target = e.target as HTMLElement;
    return drawingContainer.contains(target) && !target.closest('.blackboard-toolbar');
  }

  function eraseAt(localX: number, localY: number): void {
    const erased = eraseAtPoint(
      engine.strokeManager,
      localX, localY,
      engine.toolManager.activeSize,
    );
    if (erased) {
      engine.staticDirty = true;
      engine.requestRender();
    }
  }

  function handlePoint(e: PointerEvent): void {
    // Clamp to the surface boundary: document-level pointermove fires everywhere once a
    // stroke is active, so dragging past the node edge must not append out-of-bounds points.
    const rect = drawingContainer.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 &&
        (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) {
      return;
    }
    const [localX, localY] = engine.screenToDrawing(e.clientX, e.clientY, drawingContainer);
    const tool = engine.toolManager.activeTool;
    if (tool === 'eraser') { eraseAt(localX, localY); return; }
    engine.addPoint([localX, localY, e.pressure || 0.5]);
  }

  const onDocPointerDown = (e: PointerEvent) => {
    const inside = isInsideDrawing(e);
    const drawInput = isDrawingInput(e);
    if (__DEV_BUILD__ && inputDebugEnabled()) {
      inputDebugLog(`DOWN ${e.pointerType} in=${inside ? 'Y' : 'N'} draw=${drawInput ? 'Y' : 'N'} tgt=${dbgTarget(e.target)}${inside && drawInput ? ' OK' : ' REJECT'}`);
    }
    if (!inside) return;
    if (!drawInput) return;

    e.stopPropagation();
    e.preventDefault();
    // Drop editor focus before anything else so Obsidian's mobile bottom toolbar (the
    // Scribble trigger) never raises for a drawing stroke.
    suppressEditorFocus();
    drawingContainer.setCssStyles({ touchAction: 'none' });
    strokeActive = true;

    surfaceManager?.setActive(surface);
    surfaceManager?.notifyStrokeStart();

    const tool = engine.toolManager.activeTool;
    if (tool !== 'eraser') {
      engine.beginStroke(e.pointerType);
    }
    handlePoint(e);
  };

  const onDocPointerMove = (e: PointerEvent) => {
    if (!strokeActive) return;
    if (!isDrawingInput(e)) return;
    e.stopPropagation();
    e.preventDefault();
    handlePoint(e);
  };

  const onDocPointerUp = (e: PointerEvent) => {
    if (!strokeActive) return;
    if (!isDrawingInput(e)) return;
    strokeActive = false;
    e.stopPropagation();
    const tool = engine.toolManager.activeTool;
    if (tool !== 'eraser') {
      engine.endStroke();
    }
    if (__DEV_BUILD__ && inputDebugEnabled()) inputDebugLog(`UP committed total=${engine.strokeManager.strokes.length}`);
    // Tell the toolbar a stroke just committed so it re-syncs undo/redo enablement now,
    // instead of leaving the undo arrow greyed out until the next tap (QA3).
    surfaceManager?.notifyStrokeEnd();
    // Do not re-fit the view on stroke end: the view is fitted once on mount and only
    // re-fitted by the ResizeObserver above. Strokes beyond the node edge are clipped.
    void saveDrawing();
  };

  activeDocument.addEventListener('pointerdown', onDocPointerDown, true);
  activeDocument.addEventListener('pointermove', onDocPointerMove, true);
  activeDocument.addEventListener('pointerup', onDocPointerUp, true);
  // A stroke the system cancels (pointercancel instead of pointerup) ends like a lift, keeping
  // what was drawn, so the surface never stays stuck mid-stroke.
  activeDocument.addEventListener('pointercancel', onDocPointerUp, true);
  docListeners.push({ type: 'pointerdown', fn: onDocPointerDown, capture: true });
  docListeners.push({ type: 'pointermove', fn: onDocPointerMove, capture: true });
  docListeners.push({ type: 'pointerup', fn: onDocPointerUp, capture: true });
  docListeners.push({ type: 'pointercancel', fn: onDocPointerUp, capture: true });

  // iPadOS Scribble intercepts Apple Pencil pointer events that look like handwriting,
  // dropping whole strokes before they reach the page. The proven fix (the one Excalidraw
  // shipped in #4705) is an UNCONDITIONAL non-passive touchstart/touchmove preventDefault on
  // the drawing surface. We previously gated this on `touchType === 'stylus'`, but inside a
  // Markdown embed the iPad WKWebView does NOT reliably report the Pencil as a stylus, so the
  // guard no-opped and Scribble won. Suppress every touch over the embed/drawing surface;
  // the note still scrolls from outside the embed (accepted tradeoff). Pen draws via pointer
  // events, which still fire.
  embedEl.setCssStyles({ padding: '0' });
  const blockScribble = (e: TouchEvent) => { e.preventDefault(); };
  embedEl.addEventListener('touchstart', blockScribble, { passive: false });
  embedEl.addEventListener('touchmove', blockScribble, { passive: false });
  drawingContainer.addEventListener('touchstart', blockScribble, { passive: false });
  drawingContainer.addEventListener('touchmove', blockScribble, { passive: false });

  // The element-level guards above only fire when the touch's DOM target is the embed or
  // the drawing container. A Pencil that lands a few px outside the embed border — or on
  // the host note's contenteditable within Scribble's activation slop, or in any rendered
  // gap inside the embed not covered by the inner container — is dispatched to the note,
  // so those listeners never run and Scribble swallows the stroke as text. Back them with
  // a GEOMETRIC, document-level, capture-phase guard: for any touch whose client coordinates
  // fall within the embed's rendered rect expanded by an edge margin, call preventDefault
  // regardless of event.target. The stylus check is intentionally omitted — the Pencil is not
  // reliably reported as a stylus in the embed, so gating on it let Scribble through. Touches
  // outside the embed rect+margin are left alone so the note still scrolls. (Real-device
  // confirmation only; see tasks.md §4.)
  //
  // The guard only acts on touches whose target is inside the host content that holds this
  // embed (the note's editor or reading view, or the Canvas node). The embed's bounding box is
  // not clipped to what is visible: in a zoomed Canvas it can extend under Obsidian's own tab
  // bar, view header, sidebars and notices, and preventDefault on their touchstart cancels the
  // tap's click, so the whole app stops responding. Unknown hosts fall back to the view's
  // content area, which still excludes that chrome.
  const SCRIBBLE_EDGE_MARGIN = 12;
  const guardScope = (): HTMLElement =>
    embedEl.closest<HTMLElement>('.markdown-source-view, .markdown-preview-view, .canvas-node')
    ?? embedEl.closest<HTMLElement>('.view-content')
    ?? embedEl.parentElement
    ?? embedEl;
  const blockScribbleDoc = (e: TouchEvent) => {
    const target = e.target as Node | null;
    if (!target || !guardScope().contains(target)) return;
    const t = e.touches[0] || e.changedTouches[0];
    if (!t) return;
    const rect = embedEl.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return;
    const m = SCRIBBLE_EDGE_MARGIN;
    const within =
      t.clientX >= rect.left - m && t.clientX <= rect.right + m &&
      t.clientY >= rect.top - m && t.clientY <= rect.bottom + m;
    if (within) e.preventDefault();
  };
  activeDocument.addEventListener('touchstart', blockScribbleDoc, { passive: false, capture: true });
  activeDocument.addEventListener('touchmove', blockScribbleDoc, { passive: false, capture: true });
  docListeners.push({ type: 'touchstart', fn: blockScribbleDoc, capture: true });
  docListeners.push({ type: 'touchmove', fn: blockScribbleDoc, capture: true });

  const cleanup = () => {
    liveMounts.delete(cleanup);
    for (const l of docListeners) {
      if (l.type === '__observer__') { l.fn(null); } else { activeDocument.removeEventListener(l.type, l.fn, l.capture); }
    }
    window.clearTimeout(refitTimer);
    embedEl.removeEventListener('click', swallowClick, true);
    embedEl.removeEventListener('dblclick', swallowClick, true);
    embedEl.removeEventListener('touchstart', blockScribble);
    embedEl.removeEventListener('touchmove', blockScribble);
    surfaceManager?.unregister(surface);
    engine.destroy();
    handle?.release();
    embedEl.dataset.bbMounted = 'false';
  };
  liveMounts.set(cleanup, embedEl);
  return cleanup;
}
