import type { IDrawingRepository } from '../domain/ports';
import type { BlackboardFile, PluginSettings } from '../domain/entities';
import { DrawingEngine } from '../infrastructure/canvas-renderer';
import type { ToolManager } from '../domain/tool-manager';
import { eraseAtPoint } from '../application/eraser-service';
import { inputDebugEnabled, inputDebugLog } from './input-debug';
import type { SurfaceManager } from './surface-manager';
import type { DocumentStore, SharedDocumentHandle } from '../application/document-store';
import { engineSurface } from './drawing-surface';

function dbgTarget(t: EventTarget | null): string {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return '?';
  const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
  return el.tagName.toLowerCase() + cls;
}

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
  const active = document.activeElement as HTMLElement | null;
  if (!active || typeof active.blur !== 'function') return;
  const isEditor = active.isContentEditable || active.closest('.cm-editor') !== null;
  if (isEditor) active.blur();
}

export async function mountBlackboardEmbed(repo: IDrawingRepository, embedEl: HTMLElement, filePath: string, settings: PluginSettings, surfaceManager?: SurfaceManager, toolManager?: ToolManager, store?: DocumentStore): Promise<() => void> {
  if (embedEl.dataset.bbMounted === 'true') return () => {};
  embedEl.dataset.bbMounted = 'true';
  embedEl.empty();
  embedEl.addClass('blackboard-embed');
  embedEl.style.position = 'relative';
  embedEl.style.display = 'flex';
  embedEl.style.flexDirection = 'column';

  // The shared document is the single source of truth for this path: the engine renders
  // from its canonical strokes and writes through it, so sibling surfaces stay in sync
  // (B2). Without a store (back-compat / isolated tests) we fall back to the repo directly.
  const handle: SharedDocumentHandle | null = store ? await store.acquire(filePath, repo) : null;
  const file = handle ? handle.getFile() : (await repo.load(filePath)).file;
  // Saved width/height describe the drawing at save time; using them as the fit reference
  // (rather than the live, growing content bounds) keeps an edit-and-remount round trip
  // scale-stable (B3).
  const refFile = () => (handle ? handle.getFile() : file);

  const drawingContainer = document.createElement('div');
  drawingContainer.className = 'blackboard-drawing-container blackboard-embedded-drawing';
  drawingContainer.style.position = 'relative';
  drawingContainer.style.width = '100%';
  drawingContainer.style.flex = '1';
  drawingContainer.style.minHeight = '150px';
  embedEl.appendChild(drawingContainer);

  // Display size is measured from the drawing surface element (the same one the pointer
  // mapping uses), in layout px. Measuring the outer embed element or the zoom-scaled
  // rect causes pen-tip/stroke drift when Obsidian Canvas is zoomed.
  function hostBox(): { w: number; h: number } {
    const w = drawingContainer.clientWidth || drawingContainer.offsetWidth || 400;
    const h = drawingContainer.clientHeight || drawingContainer.offsetHeight || 300;
    return { w, h };
  }

  embedEl.addEventListener('click', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); }, true);
  embedEl.addEventListener('dblclick', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); }, true);

  const docListeners: Array<{ type: string; fn: (e: any) => void; capture: boolean }> = [];

  let canvasNode: HTMLElement | null = null;
  let el: HTMLElement | null = embedEl;
  while (el) {
    if (el.classList.contains('canvas-node')) { canvasNode = el; break; }
    el = el.parentElement;
  }
  if (canvasNode) {
    const hideBlocker = () => {
      const blocker = canvasNode!.querySelector('.canvas-node-content-blocker') as HTMLElement | null;
      if (blocker) blocker.style.display = 'none';
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
  engine.fitReferenceSize(refFile().width, refFile().height, 8, maxFitScale);
  engine.render();

  // A sibling surface committing notifies us: reload the canonical strokes and repaint the
  // static layer, KEEPING our own view transform (no re-fit/re-centre on refresh). We never
  // persist in response to a notification — only commit writes (no save feedback loop).
  if (handle) {
    handle.subscribe(() => {
      engine.loadStrokes(handle.getStrokes());
      engine.staticDirty = true;
      engine.requestRender();
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

  // Host resize handling. A Markdown embed re-fits (host-driven sizing, capped at 1× so it
  // never upscales). A canvas-node embed is a FIXED-SCALE FRAME: it keeps the established
  // scale and resizes the backing store (resizeBox, transform-preserving) so the drag side
  // reveals/clips drawable area while the opposite edge stays anchored — never re-fitting.
  const ro = new ResizeObserver(() => {
    if (canvasNode && prevLogical) {
      const cur = nodeLogicalRect();
      const dw = cur.w - prevLogical.w;
      const dh = cur.h - prevLogical.h;
      // Pure canvas zoom (or any change with no logical-size delta): do nothing.
      if (dw === 0 && dh === 0) return;
      // resizeBox preserves the view transform -> right/bottom drag anchors content top-left.
      engine.resizeBox(cur.w, cur.h);
      // Left edge moved (logical x changed): nudge content right/left by Δw so the right edge
      // stays anchored. Top edge moved (logical y changed): nudge by Δh to anchor the bottom.
      if (cur.x !== prevLogical.x) engine.panBy(dw, 0);
      if (cur.y !== prevLogical.y) engine.panBy(0, dh);
      prevLogical = cur;
    } else {
      const b = hostBox();
      engine.setDisplaySize(b.w, b.h);
      engine.fitReferenceSize(refFile().width, refFile().height, 8, maxFitScale);
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
        strokes: JSON.parse(JSON.stringify(engine.strokeManager.strokes)),
        background: { color: 'transparent' },
        contentBounds: (b.width > 0 && b.height > 0) ? b : undefined,
      };
      // The store is the single writer: commit persists (debounced) and refreshes siblings.
      if (handle) handle.commit(fileToSave);
      else await repo.save(filePath, fileToSave);
    } catch {}
  }

  const surface = engineSurface(engine, () => { saveDrawing(); });
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
    if (inputDebugEnabled()) {
      inputDebugLog(`DOWN ${e.pointerType} in=${inside ? 'Y' : 'N'} draw=${drawInput ? 'Y' : 'N'} tgt=${dbgTarget(e.target)}${inside && drawInput ? ' OK' : ' REJECT'}`);
    }
    if (!inside) return;
    if (!drawInput) return;

    e.stopPropagation();
    e.preventDefault();
    // Drop editor focus before anything else so Obsidian's mobile bottom toolbar (the
    // Scribble trigger) never raises for a drawing stroke.
    suppressEditorFocus();
    drawingContainer.style.touchAction = 'none';
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
    if (inputDebugEnabled()) inputDebugLog(`UP committed total=${engine.strokeManager.strokes.length}`);
    // Tell the toolbar a stroke just committed so it re-syncs undo/redo enablement now,
    // instead of leaving the undo arrow greyed out until the next tap (QA3).
    surfaceManager?.notifyStrokeEnd();
    // Do not re-fit the view on stroke end: the view is fitted once on mount and only
    // re-fitted by the ResizeObserver above. Strokes beyond the node edge are clipped.
    saveDrawing();
  };

  document.addEventListener('pointerdown', onDocPointerDown, true);
  document.addEventListener('pointermove', onDocPointerMove, true);
  document.addEventListener('pointerup', onDocPointerUp, true);
  docListeners.push({ type: 'pointerdown', fn: onDocPointerDown, capture: true });
  docListeners.push({ type: 'pointermove', fn: onDocPointerMove, capture: true });
  docListeners.push({ type: 'pointerup', fn: onDocPointerUp, capture: true });

  // iPadOS Scribble intercepts Apple Pencil pointer events that look like handwriting,
  // dropping whole strokes before they reach the page. The proven fix (the one Excalidraw
  // shipped in #4705) is an UNCONDITIONAL non-passive touchstart/touchmove preventDefault on
  // the drawing surface. We previously gated this on `touchType === 'stylus'`, but inside a
  // Markdown embed the iPad WKWebView does NOT reliably report the Pencil as a stylus, so the
  // guard no-opped and Scribble won. Suppress every touch over the embed/drawing surface;
  // the note still scrolls from outside the embed (accepted tradeoff). Pen draws via pointer
  // events, which still fire.
  embedEl.style.padding = '0';
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
  const SCRIBBLE_EDGE_MARGIN = 12;
  const blockScribbleDoc = (e: TouchEvent) => {
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
  document.addEventListener('touchstart', blockScribbleDoc, { passive: false, capture: true });
  document.addEventListener('touchmove', blockScribbleDoc, { passive: false, capture: true });
  docListeners.push({ type: 'touchstart', fn: blockScribbleDoc, capture: true });
  docListeners.push({ type: 'touchmove', fn: blockScribbleDoc, capture: true });

  return () => {
    for (const l of docListeners) {
      if (l.type === '__observer__') { l.fn(null); } else { document.removeEventListener(l.type, l.fn, l.capture); }
    }
    embedEl.removeEventListener('touchstart', blockScribble);
    embedEl.removeEventListener('touchmove', blockScribble);
    surfaceManager?.unregister(surface);
    engine.destroy();
    handle?.release();
    embedEl.dataset.bbMounted = 'false';
  };
}
