import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import type { BlackboardFile, PluginSettings } from '../src/domain/entities';
import type { IDrawingRepository } from '../src/domain/ports';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/domain/entities';

vi.mock('../src/application/file-format', () => ({
  serialize: vi.fn((file: BlackboardFile) => JSON.stringify(file)),
  deserialize: vi.fn(),
}));

vi.mock('../src/application/export-service', () => ({
  exportSvg: vi.fn(() => '<svg></svg>'),
}));

vi.mock('../src/application/eraser-service', () => ({
  eraseAtPoint: vi.fn(() => false),
}));

const engineInstances: any[] = [];

vi.mock('../src/infrastructure/canvas-renderer', () => {
  return {
    DrawingEngine: class {
      strokeManager = { strokes: [] as any[], reset: vi.fn(), undo: vi.fn(), redo: vi.fn(), deleteStroke: vi.fn() };
      viewport = { fitToContent: vi.fn(), screenToWorld: vi.fn(() => ({ x: 0, y: 0 })) };
      toolManager = (() => { const tm: any = { setColor: vi.fn(), setSize: vi.fn(), activeTool: 'pen', activeSize: 10 }; tm.setTool = vi.fn((tool: string) => { tm.activeTool = tool; }); tm.setDefaults = vi.fn((d: any) => { if (d?.activeTool) tm.activeTool = d.activeTool; }); return tm; })();
      staticDirty = false;
      drawingWidth = 800;
      drawingHeight = 600;
      render = vi.fn();
      requestRender = vi.fn();
      getContentBounds = vi.fn(() => ({ x: 0, y: 0, width: 0, height: 0 }));
      destroy = vi.fn();
      beginStroke = vi.fn();
      endStroke = vi.fn();
      cancelStroke = vi.fn();
      addPoint = vi.fn();
      setCanvasSize = vi.fn(function(this: any, w: number, h: number) { this.drawingWidth = w; this.drawingHeight = h; });
      setDisplaySize = vi.fn();
      refitToContent = vi.fn();
      fitReferenceSize = vi.fn();
      resizeBox = vi.fn();
      panBy = vi.fn();
      setView = vi.fn();
      zoomAt = vi.fn();
      screenToDrawing = vi.fn((_clientX: number, _clientY: number, _rect: any) => [0, 0] as [number, number]);
      loadStrokes = vi.fn((strokes: any[]) => {
        this.strokeManager.reset();
        for (const s of strokes) {
          this.strokeManager.strokes.push(JSON.parse(JSON.stringify(s)));
        }
        this.staticDirty = true;
      });
      constructor(_container?: HTMLElement, width?: number, height?: number, toolManager?: any) {
        if (width !== undefined) this.drawingWidth = width;
        if (height !== undefined) this.drawingHeight = height;
        // Honor an injected shared ToolManager (fix-tool-state-isolation).
        if (toolManager) this.toolManager = toolManager;
        engineInstances.push(this);
      }
    },
  };
});

vi.mock('../src/presentation/toolbar', () => {
  return {
    Toolbar: class {
      setActiveTool = vi.fn();
      destroy = vi.fn();
      constructor(container: HTMLElement) {
        const el = document.createElement('div');
        el.className = 'blackboard-toolbar';
        container.appendChild(el);
      }
    },
  };
});

vi.mock('../src/domain/geometry', () => ({
  distToSegment: vi.fn(() => 999),
}));

import { mountBlackboardEmbed } from '../src/presentation/embed';
import { DocumentStore } from '../src/application/document-store';
import { deserialize, serialize } from '../src/application/file-format';
import { exportSvg } from '../src/application/export-service';

const mockDeserialize = deserialize as Mock;
const mockSerialize = serialize as Mock;
const mockExportSvg = exportSvg as Mock;

function makeFile(overrides: Partial<BlackboardFile> = {}): BlackboardFile {
  return {
    version: 2,
    width: 800,
    height: 600,
    strokes: [],
    background: { color: '#1a1a2e' },
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: { smoothing: 0.5, streamline: 0.5 },
    ...overrides,
  };
}

function makeRepo(fileData?: BlackboardFile): IDrawingRepository {
  const file = fileData || makeFile();
  return {
    load: vi.fn().mockResolvedValue({ file, warnings: [], readonly: false }),
    save: vi.fn().mockResolvedValue(undefined),
    writeRaw: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue('test.bb'),
    exists: vi.fn().mockReturnValue(true),
    ensureFolder: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSettings(): PluginSettings {
  return { ...DEFAULT_PLUGIN_SETTINGS };
}

function makeEmbed(): HTMLElement {
  return document.createElement('div');
}

function flushPromises(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10));
}

describe('mountBlackboardEmbed – auto-show toolbar & Scribble guard', () => {
  let repo: IDrawingRepository;
  let filePath: string;
  let settings: PluginSettings;
  let embedEl: HTMLElement;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    filePath = 'test.bb';
    settings = makeSettings();
    embedEl = makeEmbed();
  });

  afterEach(() => {
    if (cleanup) cleanup();
    cleanup = undefined;
  });

  it('activates its surface on mount so the toolbar appears without interaction', async () => {
    const surfaceManager = { register: vi.fn(), unregister: vi.fn(), setActive: vi.fn(), notifyStrokeStart: vi.fn() } as any;
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings, surfaceManager);

    expect(surfaceManager.register).toHaveBeenCalledTimes(1);
    expect(surfaceManager.setActive).toHaveBeenCalledTimes(1);
  });

  it('attaches non-passive touch guards to the embed element and the drawing container', async () => {
    const addSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener');
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    const touchNonPassive = addSpy.mock.calls.filter(
      ([type, , opts]) => (type === 'touchstart' || type === 'touchmove')
        && !!opts && typeof opts === 'object' && (opts as AddEventListenerOptions).passive === false,
    );
    // Two event types x two surfaces (embed element + drawing container) = 4.
    expect(touchNonPassive.length).toBeGreaterThanOrEqual(4);
    addSpy.mockRestore();
  });
});

// The document-level geometric guard is the core of harden-scribble-suppression: it must
// suppress Scribble even when the touch's DOM target is NOT the embed (the failure mode the
// element-level guards cannot cover). NOTE: jsdom cannot reproduce iPadOS Scribble itself —
// these tests verify the preventDefault hit-testing logic only; near-edge behaviour with a
// real Apple Pencil is verified on-device (tasks.md §4, intentionally unchecked).
describe('mountBlackboardEmbed – document-level geometric Scribble guard', () => {
  let repo: IDrawingRepository;
  let filePath: string;
  let settings: PluginSettings;
  let embedEl: HTMLElement;
  let cleanup: (() => void) | undefined;

  // jsdom has no real Touch; a stylus is simulated by a plain object exposing the
  // touchType + client coordinates the guard reads off touches[0].
  function dispatchStylusTouch(
    target: EventTarget,
    coords: { x: number; y: number },
    touchType: 'stylus' | 'direct' = 'stylus',
    type: 'touchstart' | 'touchmove' = 'touchstart',
  ): TouchEvent {
    const fakeTouch = { touchType, clientX: coords.x, clientY: coords.y } as unknown as Touch;
    const e = new TouchEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'touches', { value: [fakeTouch], writable: false });
    Object.defineProperty(e, 'changedTouches', { value: [fakeTouch], writable: false });
    target.dispatchEvent(e);
    return e;
  }

  // Embed rendered at (100,100)-(400,300); the inner drawing container sits inside it.
  function stubEmbedRect(): void {
    embedEl.getBoundingClientRect = () => ({
      left: 100, top: 100, right: 400, bottom: 300, width: 300, height: 200, x: 100, y: 100, toJSON() {},
    }) as DOMRect;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    engineInstances.length = 0;
    repo = makeRepo();
    filePath = 'test.bb';
    settings = makeSettings();
    embedEl = makeEmbed();
    document.body.appendChild(embedEl);
  });

  afterEach(() => {
    if (cleanup) cleanup();
    cleanup = undefined;
    if (embedEl.parentElement) embedEl.parentElement.removeChild(embedEl);
  });

  it('registers a capture-phase non-passive touchstart/touchmove guard on document', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    const docTouchGuards = addSpy.mock.calls.filter(
      ([type, , opts]) => (type === 'touchstart' || type === 'touchmove')
        && !!opts && typeof opts === 'object'
        && (opts as AddEventListenerOptions).passive === false
        && (opts as AddEventListenerOptions).capture === true,
    );
    expect(docTouchGuards.length).toBe(2);
    addSpy.mockRestore();
  });

  it('prevents a stylus touch in the embed edge gap even when the target is NOT the drawing container', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    stubEmbedRect();

    // A sibling element (not the drawing container) is the DOM target — the element-level
    // guards never fire, so only the document-level geometric guard can prevent default.
    const sibling = document.createElement('div');
    document.body.appendChild(sibling);

    // Coordinates inside the embed bounds (the gap near the top edge, above the container).
    const e = dispatchStylusTouch(sibling, { x: 250, y: 105 }, 'stylus');

    expect(e.defaultPrevented).toBe(true);
    document.body.removeChild(sibling);
  });

  it('QA2: suppresses a touch over the embed even when NOT reported as a stylus', async () => {
    // On-device failure: in a Markdown embed the Apple Pencil is not reliably reported as
    // touchType 'stylus', so the stylus-gated guard did nothing and Scribble ate the stroke.
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    stubEmbedRect();
    const sibling = document.createElement('div');
    document.body.appendChild(sibling);

    const e = dispatchStylusTouch(sibling, { x: 250, y: 150 }, 'direct'); // inside embed, non-stylus

    expect(e.defaultPrevented).toBe(true);
    document.body.removeChild(sibling);
  });

  it('prevents a stylus touch on the host contenteditable within 12px of the embed edge', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    stubEmbedRect();

    // Stand-in for the surrounding note's contenteditable; the pencil lands just outside the
    // embed's top border but within the 12px Scribble activation slop.
    const contentEditable = document.createElement('div');
    document.body.appendChild(contentEditable);

    const e = dispatchStylusTouch(contentEditable, { x: 250, y: 92 }, 'stylus');

    expect(e.defaultPrevented).toBe(true);
    document.body.removeChild(contentEditable);
  });

  it('does NOT prevent a finger touch well outside the expanded embed rect', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    stubEmbedRect();

    const elsewhere = document.createElement('div');
    document.body.appendChild(elsewhere);

    const e = dispatchStylusTouch(elsewhere, { x: 900, y: 900 }, 'direct');

    expect(e.defaultPrevented).toBe(false);
    document.body.removeChild(elsewhere);
  });

  it('does NOT prevent a stylus touch far outside the embed (geometric miss)', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    stubEmbedRect();

    const elsewhere = document.createElement('div');
    document.body.appendChild(elsewhere);

    const e = dispatchStylusTouch(elsewhere, { x: 900, y: 900 }, 'stylus');

    expect(e.defaultPrevented).toBe(false);
    document.body.removeChild(elsewhere);
  });

  it('removes the document-level guard on cleanup (no leak)', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    stubEmbedRect();
    cleanup();
    cleanup = undefined;

    const elsewhere = document.createElement('div');
    document.body.appendChild(elsewhere);

    // After unmount the geometric guard must no longer prevent default for an in-rect stylus.
    const e = dispatchStylusTouch(elsewhere, { x: 250, y: 105 }, 'stylus');

    expect(e.defaultPrevented).toBe(false);
    document.body.removeChild(elsewhere);
  });
});

describe('mountBlackboardEmbed – editor-focus suppression (QA: Scribble via Obsidian bottom toolbar)', () => {
  let repo: IDrawingRepository;
  let filePath: string;
  let settings: PluginSettings;
  let embedEl: HTMLElement;
  let cleanup: (() => void) | undefined;
  let cmEditor: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    filePath = 'test.bb';
    settings = makeSettings();
    embedEl = makeEmbed();
    // Live Preview renders the embed INSIDE the CodeMirror editor.
    cmEditor = document.createElement('div');
    cmEditor.className = 'cm-editor';
    cmEditor.appendChild(embedEl);
    document.body.appendChild(cmEditor);
  });

  afterEach(() => {
    if (cleanup) cleanup();
    cleanup = undefined;
    cmEditor.remove();
  });

  function focusedCmContent(): HTMLElement {
    const cmContent = document.createElement('div');
    cmContent.className = 'cm-content';
    cmContent.setAttribute('contenteditable', 'true');
    cmContent.tabIndex = 0;
    cmEditor.insertBefore(cmContent, embedEl);
    cmContent.focus();
    return cmContent;
  }

  function penDownOnDrawing(): void {
    const drawingContainer = embedEl.querySelector('.blackboard-drawing-container') as HTMLElement;
    const down = new PointerEvent('pointerdown', { clientX: 50, clientY: 50, bubbles: true, cancelable: true, pointerType: 'pen' });
    Object.defineProperty(down, 'target', { value: drawingContainer, writable: false });
    document.dispatchEvent(down);
  }

  it('blurs the focused CodeMirror editor when a pen stroke starts (so the bottom toolbar never raises Scribble)', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const cmContent = focusedCmContent();
    expect(document.activeElement).toBe(cmContent);

    penDownOnDrawing();

    expect(document.activeElement).not.toBe(cmContent);
  });

  it('leaves a focused field alone for a finger touch (only pen/mouse draw, so no spurious blur)', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const cmContent = focusedCmContent();

    const drawingContainer = embedEl.querySelector('.blackboard-drawing-container') as HTMLElement;
    const down = new PointerEvent('pointerdown', { clientX: 50, clientY: 50, bubbles: true, cancelable: true, pointerType: 'touch' });
    Object.defineProperty(down, 'target', { value: drawingContainer, writable: false });
    document.dispatchEvent(down);

    expect(document.activeElement).toBe(cmContent);
  });
});

describe('mountBlackboardEmbed – always-live canvas', () => {
  let repo: IDrawingRepository;
  let filePath: string;
  let settings: PluginSettings;
  let embedEl: HTMLElement;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    filePath = 'test.bb';
    settings = makeSettings();
    embedEl = makeEmbed();
  });

  afterEach(() => {
    if (cleanup) cleanup();
    cleanup = undefined;
  });

  it('mounts a drawing container immediately (no preview)', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    expect(embedEl.querySelector('.blackboard-drawing-container')).not.toBeNull();
  });

  it('loads strokes from file into the engine', async () => {
    const stroke = { id: '1', tool: 'pen', color: '#fff', size: 2, opacity: 1, points: [[0, 0, 0.5]], hasPressure: false, timestamp: 0 };
    const fileData = makeFile({ width: 400, height: 300, strokes: [stroke] });
    repo = makeRepo(fileData);

    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    // loadStrokes is called on the engine with the file's strokes
    const engineInstance = engineInstances.at(-1)!;
    expect(engineInstance.loadStrokes).toHaveBeenCalled();
  });

  it('does not set width/height on the host element (size comes from host, not file)', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    // Display size is the host's responsibility — embed must not override it
    expect(embedEl.style.width).toBe('');
    expect(embedEl.style.height).toBe('');
  });
});

describe('host-driven sizing (no file-mutating resize handle)', () => {
  let repo: IDrawingRepository;
  let filePath: string;
  let settings: PluginSettings;
  let embedEl: HTMLElement;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    engineInstances.length = 0;
    repo = makeRepo();
    filePath = 'test.bb';
    settings = makeSettings();
    embedEl = makeEmbed();
  });

  afterEach(() => {
    if (cleanup) cleanup();
    cleanup = undefined;
  });

  it('calls setDisplaySize on mount from the drawing surface dimensions', async () => {
    // The embed now measures the inner drawing container (the same element the pointer
    // mapping reads), not the outer embed element. jsdom does no layout, so the measured
    // size is the fallback — assert the call happens with positive dimensions. Exact-
    // dimension + zoom correctness is covered by drawing-engine.test.ts (screenToDrawing)
    // and on-device verification.
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const engineInstance = engineInstances.at(-1)!;

    expect(engineInstance.setDisplaySize).toHaveBeenCalled();
    const [w, h] = engineInstance.setDisplaySize.mock.calls[0];
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });

  it('fits to the saved reference dimensions on mount (B3 idempotent fit)', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const engineInstance = engineInstances.at(-1)!;

    expect(engineInstance.fitReferenceSize).toHaveBeenCalled();
  });

  it('does NOT refit the view after a stroke ends (drawing must not resize the surface)', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const engineInstance = engineInstances.at(-1)!;
    engineInstance.fitReferenceSize.mockClear();

    const drawingContainer = embedEl.querySelector('.blackboard-drawing-container') as HTMLElement;

    const downEvent = new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true, cancelable: true, pointerType: 'pen',
    });
    Object.defineProperty(downEvent, 'target', { value: drawingContainer, writable: false });
    document.dispatchEvent(downEvent);

    const upEvent = new PointerEvent('pointerup', {
      clientX: 60, clientY: 60, bubbles: true, pointerType: 'pen',
    });
    document.dispatchEvent(upEvent);
    await flushPromises();

    // Strokes never trigger a re-fit — the view changes only on mount and node resize.
    expect(engineInstance.fitReferenceSize).not.toHaveBeenCalled();
  });

  it('notifies the surface manager that a stroke ended on pointer-up (QA3: undo arrow lights up)', async () => {
    const surfaceManager = { register: vi.fn(), unregister: vi.fn(), setActive: vi.fn(), notifyStrokeStart: vi.fn(), notifyStrokeEnd: vi.fn() } as any;
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings, surfaceManager);

    const drawingContainer = embedEl.querySelector('.blackboard-drawing-container') as HTMLElement;
    const downEvent = new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true, cancelable: true, pointerType: 'pen',
    });
    Object.defineProperty(downEvent, 'target', { value: drawingContainer, writable: false });
    document.dispatchEvent(downEvent);
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 60, clientY: 60, bubbles: true, pointerType: 'pen' }));
    await flushPromises();

    expect(surfaceManager.notifyStrokeEnd).toHaveBeenCalledTimes(1);
  });

  it('does not save display size (width/height) to the file', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const engineInstance = engineInstances.at(-1)!;

    const drawingContainer = embedEl.querySelector('.blackboard-drawing-container') as HTMLElement;
    const downEvent = new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true, cancelable: true, pointerType: 'pen',
    });
    Object.defineProperty(downEvent, 'target', { value: drawingContainer, writable: false });
    document.dispatchEvent(downEvent);

    const upEvent = new PointerEvent('pointerup', {
      clientX: 60, clientY: 60, bubbles: true, pointerType: 'pen',
    });
    document.dispatchEvent(upEvent);
    await flushPromises();

    // Saved file must be v3 with no viewport property
    expect(repo.save).toHaveBeenCalled();
    const savedFile = (repo.save as Mock).mock.calls[0][1];
    expect(savedFile.version).toBe(3);
    expect(savedFile.viewport).toBeUndefined();
    expect(engineInstance.getContentBounds).toHaveBeenCalled();
  });
});

describe('mountBlackboardEmbed', () => {
  let repo: IDrawingRepository;
  let filePath: string;
  let settings: PluginSettings;
  let embedEl: HTMLElement;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    filePath = 'test.bb';
    settings = makeSettings();
    embedEl = makeEmbed();
  });

  afterEach(() => {
    if (cleanup) cleanup();
    cleanup = undefined;
  });

  it('sets bbMounted data attribute', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    expect(embedEl.dataset.bbMounted).toBe('true');
  });

  it('adds blackboard-embed class', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    expect(embedEl.classList.contains('blackboard-embed')).toBe(true);
  });

  it('skips mounting when already mounted', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    (repo.load as Mock).mockClear();

    await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    expect(repo.load).not.toHaveBeenCalled();
  });

  it('does not apply file width/height to host style (display size is host-driven)', async () => {
    embedEl.setAttribute('alt', '1024x768');
    const fileData = makeFile({ width: 800, height: 600 });
    repo = makeRepo(fileData);

    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    // The embed must not override the host element's dimensions
    expect(embedEl.style.width).toBe('');
    expect(embedEl.style.height).toBe('');
  });

  it('mounts the drawing container regardless of file dimensions', async () => {
    const fileData = makeFile({ width: 600, height: 450 });
    repo = makeRepo(fileData);

    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    expect(embedEl.querySelector('.blackboard-drawing-container')).not.toBeNull();
  });

  it('sets flexDirection column by default', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    expect(embedEl.style.flexDirection).toBe('column');
  });

  it('is idempotent on double call (bbMounted check)', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    (repo.load as Mock).mockClear();

    await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    expect(repo.load).not.toHaveBeenCalled();
  });
});

describe('embed pointer handling', () => {
  let repo: IDrawingRepository;
  let filePath: string;
  let settings: PluginSettings;
  let embedEl: HTMLElement;
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    engineInstances.length = 0;
    repo = makeRepo();
    filePath = 'test.bb';
    settings = makeSettings();
    embedEl = makeEmbed();
  });

  afterEach(() => {
    if (cleanup) cleanup();
  });

  it('handles pointer events during drawing on live canvas', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    const drawingContainer = embedEl.querySelector('.blackboard-drawing-container') as HTMLElement;
    const engineInstance = engineInstances.at(-1)!;

    const downEvent = new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true, cancelable: true, pointerType: 'pen',
    });
    Object.defineProperty(downEvent, 'target', { value: drawingContainer, writable: false });
    document.dispatchEvent(downEvent);

    const moveEvent = new PointerEvent('pointermove', {
      clientX: 60, clientY: 60, bubbles: true, cancelable: true, pointerType: 'pen',
    });
    document.dispatchEvent(moveEvent);

    const upEvent = new PointerEvent('pointerup', {
      clientX: 60, clientY: 60, bubbles: true, pointerType: 'pen',
    });
    document.dispatchEvent(upEvent);
    await flushPromises();

    expect(engineInstance.beginStroke).toHaveBeenCalled();
    expect(engineInstance.addPoint).toHaveBeenCalled();
    expect(engineInstance.endStroke).toHaveBeenCalled();
  });

  it('does not record points dragged outside the node boundary', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const engineInstance = engineInstances.at(-1)!;
    const dc = embedEl.querySelector('.blackboard-drawing-container') as HTMLElement;
    // Give the surface a real measured rect so the bounds check is active.
    dc.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200, x: 0, y: 0, toJSON() {},
    }) as DOMRect;

    const down = new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true, cancelable: true, pointerType: 'pen',
    });
    Object.defineProperty(down, 'target', { value: dc });
    document.dispatchEvent(down);
    const afterDown = engineInstance.addPoint.mock.calls.length;

    // Drag OUTSIDE the surface -> must not record.
    document.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 999, clientY: 999, bubbles: true, cancelable: true, pointerType: 'pen',
    }));
    expect(engineInstance.addPoint.mock.calls.length).toBe(afterDown);

    // Back INSIDE -> records again.
    document.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 120, clientY: 120, bubbles: true, cancelable: true, pointerType: 'pen',
    }));
    expect(engineInstance.addPoint.mock.calls.length).toBe(afterDown + 1);

    document.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 120, clientY: 120, bubbles: true, pointerType: 'pen',
    }));
  });

  it('ignores pointermove when stroke is not active', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const engineInstance = engineInstances.at(-1)!;

    const moveEvent = new PointerEvent('pointermove', {
      clientX: 60, clientY: 60, bubbles: true, cancelable: true, pointerType: 'pen',
    });
    document.dispatchEvent(moveEvent);

    expect(engineInstance.addPoint).not.toHaveBeenCalled();
  });

  it('ignores pointerup when stroke is not active', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const engineInstance = engineInstances.at(-1)!;

    const upEvent = new PointerEvent('pointerup', {
      clientX: 60, clientY: 60, bubbles: true, pointerType: 'pen',
    });
    document.dispatchEvent(upEvent);

    expect(engineInstance.endStroke).not.toHaveBeenCalled();
  });

  it('ignores pointerdown outside drawing container', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const engineInstance = engineInstances.at(-1)!;

    const outsideEl = document.createElement('div');
    document.body.appendChild(outsideEl);

    const downEvent = new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true, cancelable: true, pointerType: 'pen',
    });
    Object.defineProperty(downEvent, 'target', { value: outsideEl, writable: false });
    document.dispatchEvent(downEvent);

    document.body.removeChild(outsideEl);

    expect(engineInstance.beginStroke).not.toHaveBeenCalled();
  });

  it('ignores touch input (only pen/mouse draw)', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const engineInstance = engineInstances.at(-1)!;

    const drawingContainer = embedEl.querySelector('.blackboard-drawing-container') as HTMLElement;

    const downEvent = new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true, cancelable: true, pointerType: 'touch',
    });
    Object.defineProperty(downEvent, 'target', { value: drawingContainer, writable: false });
    document.dispatchEvent(downEvent);

    expect(engineInstance.beginStroke).not.toHaveBeenCalled();
  });

  it('eraser tool calls eraseAt instead of beginStroke', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const engineInstance = engineInstances.at(-1)!;
    // The tool is seeded to pen from DEFAULT_TOOL_STATE; simulate the user selecting eraser.
    engineInstance.toolManager.activeTool = 'eraser';

    const drawingContainer = embedEl.querySelector('.blackboard-drawing-container') as HTMLElement;

    const downEvent = new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true, cancelable: true, pointerType: 'pen',
    });
    Object.defineProperty(downEvent, 'target', { value: drawingContainer, writable: false });
    document.dispatchEvent(downEvent);

    expect(engineInstance.beginStroke).not.toHaveBeenCalled();
  });
});

describe('embed sizing', () => {
  function fakeRepo() {
    return {
      load: async () => ({
        file: { version: 3, width: 800, height: 600, strokes: [],
          background: { color: 'transparent' }, settings: { smoothing: 0.5, streamline: 0.5 } },
        warnings: [], readonly: false,
      }),
      save: async () => {},
    } as any;
  }

  it('does not create the old file-mutating resize handle', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const cleanup = await mountBlackboardEmbed(fakeRepo(), host, 'd.blackboard', DEFAULT_PLUGIN_SETTINGS);
    expect(host.querySelector('.blackboard-resize-handle')).toBeNull();
    cleanup();
  });

  it('mounts a drawing surface into the host', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const cleanup = await mountBlackboardEmbed(fakeRepo(), host, 'd.blackboard', DEFAULT_PLUGIN_SETTINGS);
    expect(host.querySelector('.blackboard-drawing-container')).not.toBeNull();
    cleanup();
  });
});

describe('toolbar auto-show/hide', () => {
  let repo: IDrawingRepository;
  let filePath: string;
  let settings: PluginSettings;
  let embedEl: HTMLElement;
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    engineInstances.length = 0;
    repo = makeRepo();
    filePath = 'test.bb';
    settings = makeSettings();
    embedEl = makeEmbed();
  });

  afterEach(() => {
    if (cleanup) cleanup();
    vi.useRealTimers();
  });

  it('toolbar is not visible before first interaction', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    expect(embedEl.querySelector('.blackboard-toolbar')).toBeNull();
  });

  it('registers a drawing surface and activates it on pointerdown (global toolbar)', async () => {
    const register = vi.fn();
    const setActive = vi.fn();
    const sm = { register, setActive, unregister: vi.fn(), notifyStrokeStart: vi.fn() } as any;
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings, sm);
    expect(register).toHaveBeenCalled();

    const drawingContainer = embedEl.querySelector('.blackboard-drawing-container') as HTMLElement;
    const downEvent = new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true, cancelable: true, pointerType: 'pen',
    });
    Object.defineProperty(downEvent, 'target', { value: drawingContainer, writable: false });
    document.dispatchEvent(downEvent);

    expect(setActive).toHaveBeenCalled();
  });

  // iPad bugs (issue #17-22 part 2): regressions where Pencil strokes drop mid-word
  // and the toolbar wraps to 3 rows on narrow embeds.

  it('ignores a spurious pointercancel so the stroke still commits on pointerup', async () => {
    // WKWebView can fire a stray pointercancel mid-stroke. The working model has no
    // cancel handler, so the stroke survives and commits normally on pointerup.
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const drawingContainer = embedEl.querySelector('.blackboard-drawing-container') as HTMLElement;
    const engineInstance = engineInstances.at(-1)!;

    const downEvent = new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 1,
    });
    Object.defineProperty(downEvent, 'target', { value: drawingContainer, writable: false });
    document.dispatchEvent(downEvent);

    const moveEvent = new PointerEvent('pointermove', {
      clientX: 60, clientY: 60, bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 1,
    });
    document.dispatchEvent(moveEvent);

    const cancelEvent = new PointerEvent('pointercancel', {
      clientX: 60, clientY: 60, bubbles: true, pointerType: 'pen', pointerId: 1,
    });
    document.dispatchEvent(cancelEvent);

    const upEvent = new PointerEvent('pointerup', {
      clientX: 60, clientY: 60, bubbles: true, pointerType: 'pen', pointerId: 1,
    });
    document.dispatchEvent(upEvent);
    await flushPromises();

    expect(engineInstance.beginStroke).toHaveBeenCalled();
    expect(engineInstance.endStroke).toHaveBeenCalled();
  });

  it('pen pointerdown does NOT call setPointerCapture (broken in WebKit/WKWebView)', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const drawingContainer = embedEl.querySelector('.blackboard-drawing-container') as HTMLElement;
    const stubCanvas = document.createElement('canvas');
    stubCanvas.className = 'blackboard-active';
    drawingContainer.appendChild(stubCanvas);
    const setCaptureSpy = vi.fn();
    (stubCanvas as any).setPointerCapture = setCaptureSpy;

    const downEvent = new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 42,
    });
    Object.defineProperty(downEvent, 'target', { value: drawingContainer, writable: false });
    document.dispatchEvent(downEvent);

    expect(setCaptureSpy).not.toHaveBeenCalled();
  });

  it('pen pointerdown sets touchAction to none on drawingContainer to block browser pan-cancel', async () => {
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const drawingContainer = embedEl.querySelector('.blackboard-drawing-container') as HTMLElement;
    drawingContainer.style.touchAction = 'pan-x pan-y';

    const downEvent = new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 1,
    });
    Object.defineProperty(downEvent, 'target', { value: drawingContainer, writable: false });
    document.dispatchEvent(downEvent);

    expect(drawingContainer.style.touchAction).toBe('none');
  });

});

describe('embed link-navigation suppression', () => {
  let repo: IDrawingRepository;
  let filePath: string;
  let settings: PluginSettings;
  let embedEl: HTMLElement;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    engineInstances.length = 0;
    repo = makeRepo();
    filePath = 'test.bb';
    settings = makeSettings();
    embedEl = makeEmbed();
  });

  afterEach(() => {
    if (cleanup) cleanup();
    cleanup = undefined;
  });

  it('stops a click on the embed in the capture phase so a later document listener never fires', async () => {
    document.body.appendChild(embedEl);
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    // A bubble-phase listener Obsidian (or anything) adds AFTER mount must not see the
    // event — the embed's capture-phase handler runs stopImmediatePropagation first.
    const docClick = vi.fn();
    document.addEventListener('click', docClick);

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    embedEl.dispatchEvent(clickEvent);

    expect(docClick).not.toHaveBeenCalled();

    document.removeEventListener('click', docClick);
    document.body.removeChild(embedEl);
  });

  it('stops a dblclick on the embed in the capture phase so a later document listener never fires', async () => {
    document.body.appendChild(embedEl);
    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    const docDblClick = vi.fn();
    document.addEventListener('dblclick', docDblClick);

    const dblClickEvent = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
    embedEl.dispatchEvent(dblClickEvent);

    expect(docDblClick).not.toHaveBeenCalled();

    document.removeEventListener('dblclick', docDblClick);
    document.body.removeChild(embedEl);
  });
});

describe('embed canvas-node content blocker', () => {
  let repo: IDrawingRepository;
  let filePath: string;
  let settings: PluginSettings;
  let embedEl: HTMLElement;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    engineInstances.length = 0;
    repo = makeRepo();
    filePath = 'test.bb';
    settings = makeSettings();
    embedEl = makeEmbed();
  });

  afterEach(() => {
    if (cleanup) cleanup();
    cleanup = undefined;
  });

  it('hides the .canvas-node-content-blocker of an ancestor .canvas-node so the surface is drawable', async () => {
    // Build the Obsidian Canvas DOM shape: .canvas-node wraps a content blocker and the
    // embed host (via an intermediate content element, so parentElement walking is exercised).
    const canvasNode = document.createElement('div');
    canvasNode.className = 'canvas-node';
    const blocker = document.createElement('div');
    blocker.className = 'canvas-node-content-blocker';
    canvasNode.appendChild(blocker);
    const content = document.createElement('div');
    content.className = 'canvas-node-content';
    canvasNode.appendChild(content);
    content.appendChild(embedEl);
    document.body.appendChild(canvasNode);

    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);

    expect(blocker.style.display).toBe('none');

    document.body.removeChild(canvasNode);
  });
});

describe('embed shared tool state (fix-tool-state-isolation)', () => {
  let repo: IDrawingRepository;
  let filePath: string;
  let settings: PluginSettings;
  let embedEl: HTMLElement;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    engineInstances.length = 0;
    repo = makeRepo();
    filePath = 'test.bb';
    settings = makeSettings();
    embedEl = makeEmbed();
  });

  afterEach(() => {
    if (cleanup) cleanup();
    cleanup = undefined;
  });

  it('wires the engine to the injected shared ToolManager and does NOT re-seed it on mount', async () => {
    const shared: any = { setDefaults: vi.fn(), activeTool: 'highlighter', activeSize: 30, activeColor: '#ff0000', activeOpacity: 0.3, setTool: vi.fn(), setColor: vi.fn(), setSize: vi.fn() };

    cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings, undefined, shared);

    const engineInstance = engineInstances.at(-1)!;
    expect(engineInstance.toolManager).toBe(shared);
    // Mounting must not reset the live selection back to the settings defaults.
    expect(shared.setDefaults).not.toHaveBeenCalled();
    expect(engineInstance.toolManager.activeTool).toBe('highlighter');
  });
});

describe('embed shared-document sync (B2: multi-surface single source of truth)', () => {
  let repo: IDrawingRepository;
  let filePath: string;
  let settings: PluginSettings;
  let store: DocumentStore;

  beforeEach(() => {
    vi.clearAllMocks();
    engineInstances.length = 0;
    repo = makeRepo();
    filePath = 'test.bb';
    settings = makeSettings();
    store = new DocumentStore({ saveDelayMs: 0 });
  });

  it('two embeds of the same path share ONE canonical document (single disk load)', async () => {
    const embedA = makeEmbed();
    const embedB = makeEmbed();

    const cleanupA = await mountBlackboardEmbed(repo, embedA, filePath, settings, undefined, undefined, store);
    const cleanupB = await mountBlackboardEmbed(repo, embedB, filePath, settings, undefined, undefined, store);

    // Two distinct engines (per-surface rendering) but exactly one disk load (shared doc).
    expect(engineInstances.at(-1)).not.toBe(engineInstances.at(-2));
    expect((repo.load as Mock).mock.calls.length).toBe(1);

    cleanupA();
    cleanupB();
  });

  it('a stroke committed on one embed refreshes the sibling embed (cross-surface sync)', async () => {
    const embedA = makeEmbed();
    const embedB = makeEmbed();

    const cleanupA = await mountBlackboardEmbed(repo, embedA, filePath, settings, undefined, undefined, store);
    const cleanupB = await mountBlackboardEmbed(repo, embedB, filePath, settings, undefined, undefined, store);
    const engineB = engineInstances.at(-1)!;
    const reloadsBefore = engineB.loadStrokes.mock.calls.length;

    // Draw a stroke on embed A -> saveDrawing -> store.commit -> notifies sibling B.
    const dcA = embedA.querySelector('.blackboard-drawing-container') as HTMLElement;
    const down = new PointerEvent('pointerdown', { clientX: 5, clientY: 5, bubbles: true, cancelable: true, pointerType: 'pen' });
    Object.defineProperty(down, 'target', { value: dcA, writable: false });
    document.dispatchEvent(down);
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 6, clientY: 6, bubbles: true, pointerType: 'pen' }));

    // The sibling reloaded the canonical strokes (one extra loadStrokes beyond mount).
    expect(engineB.loadStrokes.mock.calls.length).toBe(reloadsBefore + 1);

    cleanupA();
    cleanupB();
  });

  it('releasing the last embed drops the entry so a later mount reloads from disk', async () => {
    const embedA = makeEmbed();
    const cleanupA = await mountBlackboardEmbed(repo, embedA, filePath, settings, undefined, undefined, store);
    expect((repo.load as Mock).mock.calls.length).toBe(1);
    cleanupA();

    const embedB = makeEmbed();
    const cleanupB = await mountBlackboardEmbed(repo, embedB, filePath, settings, undefined, undefined, store);
    expect((repo.load as Mock).mock.calls.length).toBe(2);
    cleanupB();
  });
});

// markdown-embed-frame: a Markdown embed (no .canvas-node ancestor) is a fixed-scale
// fit-to-content FRAME that never upscales past natural size (maxScale = 1); a canvas-node
// embed keeps the uncapped fill behavior.
describe('embed fit cap (markdown-embed-frame: no-upscale on Markdown embeds)', () => {
  let repo: IDrawingRepository;
  let filePath: string;
  let settings: PluginSettings;

  beforeEach(() => {
    vi.clearAllMocks();
    engineInstances.length = 0;
    repo = makeRepo(makeFile({ width: 200, height: 150 }));
    filePath = 'test.bb';
    settings = makeSettings();
  });

  it('a Markdown embed fits with a maxScale cap of 1 (no upscale past natural size)', async () => {
    const embedEl = makeEmbed();
    const cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const engine = engineInstances.at(-1)!;

    expect(engine.fitReferenceSize).toHaveBeenCalled();
    const args = engine.fitReferenceSize.mock.calls[0];
    // fitReferenceSize(refWidth, refHeight, padding=8, maxScale=1)
    expect(args[3]).toBe(1);
    cleanup();
  });

  it('a canvas-node embed fits UNCAPPED (maxScale is not 1, so it still fills the node)', async () => {
    const canvasNode = document.createElement('div');
    canvasNode.className = 'canvas-node';
    const embedEl = makeEmbed();
    canvasNode.appendChild(embedEl);
    document.body.appendChild(canvasNode);

    const cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const engine = engineInstances.at(-1)!;

    expect(engine.fitReferenceSize).toHaveBeenCalled();
    const args = engine.fitReferenceSize.mock.calls[0];
    expect(args[3]).not.toBe(1);
    expect(args[3]).toBe(Infinity);

    cleanup();
    document.body.removeChild(canvasNode);
  });
});

// canvas-node-extend-on-resize: a canvas-node embed is a fixed-scale frame. A node resize is
// keyed off the .canvas-node element's LOGICAL size (offsetWidth/offsetHeight) and position;
// it calls resizeBox (right/bottom anchor) and panBy (left/top anchor), never a re-fit. Pure
// canvas zoom (logical size unchanged) is a no-op.
describe('canvas-node frame on resize (canvas-node-extend-on-resize)', () => {
  let repo: IDrawingRepository;
  let filePath: string;
  let settings: PluginSettings;
  let OriginalRO: typeof ResizeObserver;
  let roCallbacks: ResizeObserverCallback[];

  function makeCanvasNode(w: number, h: number, x = 0, y = 0): HTMLElement & { setLogical: (nw: number, nh: number, nx?: number, ny?: number) => void } {
    const node = document.createElement('div') as any;
    node.className = 'canvas-node';
    let _w = w, _h = h, _x = x, _y = y;
    Object.defineProperty(node, 'offsetWidth', { get: () => _w, configurable: true });
    Object.defineProperty(node, 'offsetHeight', { get: () => _h, configurable: true });
    node.style.transform = `translate(${_x}px, ${_y}px)`;
    node.setLogical = (nw: number, nh: number, nx?: number, ny?: number) => {
      _w = nw; _h = nh;
      if (nx !== undefined) _x = nx;
      if (ny !== undefined) _y = ny;
      node.style.transform = `translate(${_x}px, ${_y}px)`;
    };
    return node;
  }

  function fireResize(): void {
    for (const cb of roCallbacks) cb([], {} as ResizeObserver);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    engineInstances.length = 0;
    repo = makeRepo(makeFile({ width: 400, height: 300 }));
    filePath = 'test.bb';
    settings = makeSettings();
    OriginalRO = globalThis.ResizeObserver;
    roCallbacks = [];
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) { roCallbacks.push(cb); }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;
  });

  afterEach(() => {
    globalThis.ResizeObserver = OriginalRO;
  });

  async function mountInNode(node: HTMLElement) {
    const embedEl = makeEmbed();
    node.appendChild(embedEl);
    document.body.appendChild(node);
    const cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const engine = engineInstances.at(-1)!;
    // Clear the mount-time fit so we only observe resize-driven calls.
    engine.fitReferenceSize.mockClear();
    engine.setDisplaySize.mockClear();
    engine.resizeBox.mockClear();
    engine.panBy.mockClear();
    return { embedEl, engine, cleanup };
  }

  it('enlarge from the right keeps the transform: resizeBox grows the box, no panBy, no re-fit', async () => {
    const node = makeCanvasNode(400, 300, 0, 0);
    const { engine, cleanup } = await mountInNode(node);

    node.setLogical(500, 300); // right edge dragged out, x/y unchanged
    fireResize();

    expect(engine.resizeBox).toHaveBeenCalledWith(500, 300);
    expect(engine.panBy).not.toHaveBeenCalled();
    expect(engine.fitReferenceSize).not.toHaveBeenCalled();
    expect(engine.setDisplaySize).not.toHaveBeenCalled();
    cleanup();
    document.body.removeChild(node);
  });

  it('enlarge from the left anchors the right edge via panBy(Δw, 0)', async () => {
    const node = makeCanvasNode(400, 300, 0, 0);
    const { engine, cleanup } = await mountInNode(node);

    // Left edge dragged out by 100: width 400->500, logical x 0->-100.
    node.setLogical(500, 300, -100, 0);
    fireResize();

    expect(engine.resizeBox).toHaveBeenCalledWith(500, 300);
    expect(engine.panBy).toHaveBeenCalledWith(100, 0);
    cleanup();
    document.body.removeChild(node);
  });

  it('enlarge from the top anchors the bottom edge via panBy(0, Δh)', async () => {
    const node = makeCanvasNode(400, 300, 0, 0);
    const { engine, cleanup } = await mountInNode(node);

    // Top edge dragged out by 80: height 300->380, logical y 0->-80.
    node.setLogical(400, 380, 0, -80);
    fireResize();

    expect(engine.resizeBox).toHaveBeenCalledWith(400, 380);
    expect(engine.panBy).toHaveBeenCalledWith(0, 80);
    cleanup();
    document.body.removeChild(node);
  });

  it('shrink clips without deleting strokes, and a later enlarge restores the box', async () => {
    const node = makeCanvasNode(400, 300, 0, 0);
    const { engine, cleanup } = await mountInNode(node);
    engine.strokeManager.strokes.push({ id: 's1' }, { id: 's2' });
    const before = engine.strokeManager.strokes.length;

    node.setLogical(300, 300); // right edge dragged inward (shrink)
    fireResize();

    expect(engine.resizeBox).toHaveBeenCalledWith(300, 300);
    expect(engine.strokeManager.strokes.length).toBe(before); // strokes preserved (clipped, not deleted)

    // Enlarge back -> box restored, clipped content reappears.
    node.setLogical(400, 300);
    fireResize();
    expect(engine.resizeBox).toHaveBeenCalledWith(400, 300);
    expect(engine.strokeManager.strokes.length).toBe(before);
    cleanup();
    document.body.removeChild(node);
  });

  it('pure canvas zoom (logical size unchanged) is a no-op: no resizeBox, no re-fit', async () => {
    const node = makeCanvasNode(400, 300, 0, 0);
    const { engine, cleanup } = await mountInNode(node);

    // Simulate a canvas zoom: the on-screen pixel rect changes but the LOGICAL
    // offsetWidth/offsetHeight are unchanged. Firing the observer must do nothing.
    node.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;
    fireResize();

    expect(engine.resizeBox).not.toHaveBeenCalled();
    expect(engine.panBy).not.toHaveBeenCalled();
    expect(engine.fitReferenceSize).not.toHaveBeenCalled();
    expect(engine.setDisplaySize).not.toHaveBeenCalled();
    cleanup();
    document.body.removeChild(node);
  });

  it('corner drag (top-left) applies both panBy nudges', async () => {
    const node = makeCanvasNode(400, 300, 0, 0);
    const { engine, cleanup } = await mountInNode(node);

    node.setLogical(500, 380, -100, -80); // both left and top edges dragged out
    fireResize();

    expect(engine.resizeBox).toHaveBeenCalledWith(500, 380);
    expect(engine.panBy).toHaveBeenCalledWith(100, 0);
    expect(engine.panBy).toHaveBeenCalledWith(0, 80);
    cleanup();
    document.body.removeChild(node);
  });
});

// markdown-embed-frame: a Markdown embed (no canvas-node) still RE-FITS on host resize,
// with the maxScale = 1 cap carried through.
describe('markdown embed re-fits on host resize with the maxScale cap', () => {
  let repo: IDrawingRepository;
  let filePath: string;
  let settings: PluginSettings;
  let OriginalRO: typeof ResizeObserver;
  let roCallbacks: ResizeObserverCallback[];

  beforeEach(() => {
    vi.clearAllMocks();
    engineInstances.length = 0;
    repo = makeRepo(makeFile({ width: 200, height: 150 }));
    filePath = 'test.bb';
    settings = makeSettings();
    OriginalRO = globalThis.ResizeObserver;
    roCallbacks = [];
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) { roCallbacks.push(cb); }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;
  });

  afterEach(() => {
    globalThis.ResizeObserver = OriginalRO;
  });

  it('re-fits with setDisplaySize + fitReferenceSize(..., 1) on resize (no frame logic)', async () => {
    const embedEl = makeEmbed();
    document.body.appendChild(embedEl);
    const cleanup = await mountBlackboardEmbed(repo, embedEl, filePath, settings);
    const engine = engineInstances.at(-1)!;
    engine.fitReferenceSize.mockClear();
    engine.setDisplaySize.mockClear();

    for (const cb of roCallbacks) cb([], {} as ResizeObserver);

    expect(engine.setDisplaySize).toHaveBeenCalled();
    expect(engine.fitReferenceSize).toHaveBeenCalled();
    expect(engine.fitReferenceSize.mock.calls.at(-1)![3]).toBe(1);
    expect(engine.resizeBox).not.toHaveBeenCalled();
    cleanup();
    document.body.removeChild(embedEl);
  });
});

describe('unmountAllEmbeds — plugin reload lifecycle', () => {
  it('unmounts every live embed so a new plugin instance can re-mount them', async () => {
    const { mountBlackboardEmbed, unmountAllEmbeds } = await import('../src/presentation/embed');
    const repo = makeRepo();
    const el = document.createElement('div');
    document.body.appendChild(el);

    await mountBlackboardEmbed(repo, el, 'A.blackboard', makeSettings());
    expect(el.dataset.bbMounted).toBe('true');

    // Simulates plugin onunload: without this, dataset.bbMounted stays 'true' on the
    // surviving DOM and the NEXT plugin instance refuses to re-mount (dead toolbar bug).
    unmountAllEmbeds();
    expect(el.dataset.bbMounted).toBe('false');

    // A fresh instance can now mount the same element again.
    await mountBlackboardEmbed(repo, el, 'A.blackboard', makeSettings());
    expect(el.dataset.bbMounted).toBe('true');
    unmountAllEmbeds();
    expect(el.dataset.bbMounted).toBe('false');
    el.remove();
  });

  it('an individually cleaned-up embed is not cleaned twice by unmountAllEmbeds', async () => {
    const { mountBlackboardEmbed, unmountAllEmbeds } = await import('../src/presentation/embed');
    const repo = makeRepo();
    const el = document.createElement('div');
    document.body.appendChild(el);

    const cleanup = await mountBlackboardEmbed(repo, el, 'B.blackboard', makeSettings());
    cleanup();
    expect(el.dataset.bbMounted).toBe('false');
    el.dataset.bbMounted = 'true'; // simulate a NEW mount owned by someone else
    unmountAllEmbeds(); // must not touch it (the earlier cleanup already deregistered)
    expect(el.dataset.bbMounted).toBe('true');
    el.remove();
  });
});
