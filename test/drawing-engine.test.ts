import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrawingEngine } from '../src/infrastructure/canvas-renderer';
import { ToolManager } from '../src/domain/tool-manager';
import { DEFAULT_TOOL_STATE } from '../src/domain/entities';

let mockCtx: Record<string, any>;

function createMockContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    fillRect: vi.fn(),
    quadraticCurveTo: vi.fn(),
    canvas: { width: 800, height: 600 },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
  };
}

beforeEach(() => {
  mockCtx = createMockContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any);
});

function createMockContainer(): HTMLElement {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 800 });
  Object.defineProperty(container, 'clientHeight', { value: 600 });
  return container;
}

describe('DrawingEngine — shared tool state (B4: tool leak across surfaces)', () => {
  it('uses an injected shared ToolManager instead of constructing its own', () => {
    const shared = new ToolManager({ ...DEFAULT_TOOL_STATE });
    const engine = new DrawingEngine(createMockContainer(), 800, 600, shared);

    expect(engine.toolManager).toBe(shared);
  });

  it('every surface reflects a tool switch — no per-surface divergence', () => {
    // Repro of the reported bug: two drawings (top + bottom) backed by independent
    // tool state. Switching to highlighter while drawing on one left the other stuck
    // on pen, so the next stroke on the other surface committed as the wrong tool.
    const shared = new ToolManager({ ...DEFAULT_TOOL_STATE });
    const top = new DrawingEngine(createMockContainer(), 800, 600, shared);
    const bottom = new DrawingEngine(createMockContainer(), 800, 600, shared);

    // User switches to highlighter while working on the bottom drawing...
    bottom.toolManager.setTool('highlighter');

    // ...the top drawing must already be on highlighter too (one shared state).
    expect(top.toolManager.activeTool).toBe('highlighter');
  });

  it('per-tool colour and size are global across surfaces (S7)', () => {
    const shared = new ToolManager({ ...DEFAULT_TOOL_STATE });
    const a = new DrawingEngine(createMockContainer(), 800, 600, shared);
    const b = new DrawingEngine(createMockContainer(), 800, 600, shared);

    // Set the pen colour/size while "drawing" on surface A.
    a.toolManager.setColor('#ff0000');
    a.toolManager.setSize(8);

    // Surface B selects the pen and must see the same colour and size.
    b.toolManager.setTool('pen');
    expect(b.toolManager.activeColor).toBe('#ff0000');
    expect(b.toolManager.activeSize).toBe(8);
  });

  it('a surface mounted after a mutation inherits the live state, not the defaults (S7)', () => {
    const shared = new ToolManager({ ...DEFAULT_TOOL_STATE });
    const a = new DrawingEngine(createMockContainer(), 800, 600, shared);

    a.toolManager.setTool('highlighter');
    a.toolManager.setSize(30);

    // A new surface mounting later is wired to the same shared manager.
    const late = new DrawingEngine(createMockContainer(), 800, 600, shared);
    expect(late.toolManager.activeTool).toBe('highlighter');
    expect(late.toolManager.activeSize).toBe(30);
  });

  it('B4: a stroke on surface A commits as the current tool after switching on surface B', () => {
    const shared = new ToolManager({ ...DEFAULT_TOOL_STATE });
    const a = new DrawingEngine(createMockContainer(), 800, 600, shared);
    const b = new DrawingEngine(createMockContainer(), 800, 600, shared);

    // Pen strokes on both surfaces.
    a.beginStroke('pen'); a.addPoint([10, 10, 0.5]); a.endStroke();
    b.beginStroke('pen'); b.addPoint([20, 20, 0.5]); b.endStroke();

    // Switch to the highlighter while working on B, draw on B...
    b.toolManager.setTool('highlighter');
    b.beginStroke('pen'); b.addPoint([30, 30, 0.5]); b.endStroke();

    // ...then draw on A: the stroke must commit as a highlighter stroke, not pen.
    a.beginStroke('pen'); a.addPoint([40, 40, 0.5]); a.endStroke();

    expect(a.strokeManager.strokes.at(-1)!.tool).toBe('highlighter');
  });
});

describe('DrawingEngine', () => {
  it('constructor creates static canvas element', () => {
    const container = createMockContainer();

    new DrawingEngine(container);

    expect(container.querySelectorAll('canvas').length).toBeGreaterThanOrEqual(1);
  });

  it('constructor creates active canvas element', () => {
    const container = createMockContainer();

    new DrawingEngine(container);

    expect(container.querySelectorAll('canvas').length).toBe(2);
  });

  it('beginStroke initializes active stroke state', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);

    engine.beginStroke('pen');

    expect((engine as any).activePoints).toBeDefined();
  });

  it('endStroke adds stroke to manager', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.beginStroke('pen');
    engine.addPoint([10, 20, 0.5]);
    engine.addPoint([30, 40, 0.7]);

    engine.endStroke();

    expect(engine.strokeManager.strokes.length).toBe(1);
  });

  it('endStroke clears active stroke', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.beginStroke('pen');
    engine.addPoint([10, 20, 0.5]);
    engine.addPoint([30, 40, 0.7]);
    engine.endStroke();

    expect((engine as any).activePoints.length).toBe(0);
  });

  it('getContentBounds returns zero bounds for empty drawing', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);

    const bounds = engine.getContentBounds();

    expect(bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('getContentBounds calculates bounds from stroke points', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.beginStroke('pen');
    engine.addPoint([10, 20, 0.5]);
    engine.addPoint([50, 80, 0.7]);
    engine.endStroke();

    const bounds = engine.getContentBounds();

    expect(bounds.width).toBeGreaterThan(0);
  });

  it('destroy removes canvases from container', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);

    engine.destroy();

    expect(container.querySelectorAll('canvas').length).toBe(0);
  });

  it('endStroke with a single point adds a dot stroke', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.beginStroke('pen');
    engine.addPoint([10, 20, 0.5]);

    engine.endStroke();

    expect(engine.strokeManager.strokes.length).toBe(1);
    expect(engine.strokeManager.strokes[0].points.length).toBe(1);
  });

  it('addPoint called before beginStroke does not throw', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);

    const act = () => engine.addPoint([10, 20, 0.5]);

    expect(act).not.toThrow();
  });

  it('destroy nulls out internal canvases', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);

    engine.destroy();

    expect(container.querySelector('canvas')).toBeNull();
  });

  it('requestRender schedules a render via requestAnimationFrame', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.render();
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(99);

    engine.requestRender();

    expect(rafSpy).toHaveBeenCalledOnce();
    rafSpy.mockRestore();
  });

  it('requestRender does not double-schedule when already pending', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.render();
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(99);

    engine.requestRender();
    engine.requestRender();

    expect(rafSpy).toHaveBeenCalledOnce();
    rafSpy.mockRestore();
  });

  it('render clears staticDirty flag after repaint', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.staticDirty = true;

    engine.render();

    expect(engine.staticDirty).toBe(false);
  });

  it('setCanvasSize with zero width does not update canvas', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    const prevWidth = (engine as any).staticCanvas.width;

    engine.setCanvasSize(0, 600);

    expect((engine as any).staticCanvas.width).toBe(prevWidth);
  });

  it('setCanvasSize sets canvas buffer dimensions with DPR scaling', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);

    engine.setCanvasSize(400, 300);

    expect((engine as any).staticCanvas.width).toBe(400 * (globalThis.devicePixelRatio || 1));
  });

  it('single point creates a dot stroke', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.beginStroke('pen');
    engine.addPoint([10, 20, 0.5]);
    engine.endStroke();

    expect(engine.strokeManager.strokes.length).toBe(1);
  });

  it('two points creates stroke', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.beginStroke('pen');
    engine.addPoint([10, 20, 0.5]);
    engine.addPoint([30, 40, 0.5]);
    engine.endStroke();

    expect(engine.strokeManager.strokes.length).toBe(1);
  });

  it('pressure preserved when not 0.5', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.beginStroke('pen');
    engine.addPoint([10, 20, 0.8]);
    engine.addPoint([30, 40, 0.9]);
    engine.endStroke();

    expect(engine.strokeManager.strokes[0].hasPressure).toBe(true);
  });

  it('all points at 0.5 pressure sets hasPressure false', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.beginStroke('pen');
    engine.addPoint([10, 20, 0.5]);
    engine.addPoint([30, 40, 0.5]);
    engine.endStroke();

    expect(engine.strokeManager.strokes[0].hasPressure).toBe(false);
  });

  it('highlighter stroke has opacity 0.3', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.toolManager.setTool('highlighter');
    engine.beginStroke('pen');
    engine.addPoint([10, 20, 0.5]);
    engine.addPoint([30, 40, 0.5]);
    engine.endStroke();

    expect(engine.strokeManager.strokes[0].opacity).toBe(0.3);
  });

  it('highlighter opacity getter returns 0.3', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.toolManager.setTool('highlighter');

    expect(engine.toolManager.activeOpacity).toBe(0.3);
  });

  it('pen opacity getter returns 1.0', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.toolManager.setTool('pen');

    expect(engine.toolManager.activeOpacity).toBe(1.0);
  });
});

describe('Smooth curve rendering', () => {
  it('fillOutline uses quadraticCurveTo for smooth curves', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
    const engine = new DrawingEngine(container);

    // Spy on canvas context methods
    const ctx = (engine as any).staticCtx as CanvasRenderingContext2D;
    const curveSpy = vi.spyOn(ctx, 'quadraticCurveTo');

    // Create a stroke with circle points (enough for curves)
    const circlePoints: [number, number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const angle = (i / 12) * 2 * Math.PI;
      circlePoints.push([
        200 + Math.cos(angle) * 100,
        200 + Math.sin(angle) * 100,
        0.5,
      ]);
    }

    engine.loadStrokes([{
      id: 'circle-1',
      tool: 'pen' as const,
      color: '#000',
      size: 4,
      opacity: 1,
      points: circlePoints,
      hasPressure: false,
      timestamp: Date.now(),
    }]);

    engine.staticDirty = true;
    engine.render();

    expect(curveSpy).toHaveBeenCalled();

    engine.destroy();
  });

  it('fillOutline uses lineTo for fewer than 3 outline points', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
    const engine = new DrawingEngine(container);

    const ctx = (engine as any).staticCtx as CanvasRenderingContext2D;
    const curveSpy = vi.spyOn(ctx, 'quadraticCurveTo');
    const lineToSpy = vi.spyOn(ctx, 'lineTo');

    const fillOutline = (engine as any).fillOutline.bind(engine);
    fillOutline(ctx, [[10, 10], [20, 20]]);

    expect(lineToSpy).toHaveBeenCalled();
    expect(curveSpy).not.toHaveBeenCalled();

    engine.destroy();
  });
});

describe('DrawingEngine view transform', () => {
  function engineWith(boxW: number, boxH: number) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const e = new DrawingEngine(container, boxW, boxH);
    e.setDisplaySize(boxW, boxH);
    return e;
  }

  // Stand-in for the surface element screenToDrawing reads: a bounding rect (rendered px)
  // plus clientWidth/Height (layout px). Equal sizes = no zoom; rect larger = zoomed in.
  function fakeEl(rect: { left: number; top: number; width: number; height: number }, clientW: number, clientH: number) {
    return { getBoundingClientRect: () => rect, clientWidth: clientW, clientHeight: clientH } as unknown as HTMLElement;
  }

  it('identity transform when there are no strokes', () => {
    const e = engineWith(300, 200);
    e.refitToContent();
    expect(e.getViewTransform()).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });

  it('screenToDrawing is identity when transform is identity', () => {
    const e = engineWith(300, 200);
    e.refitToContent();
    const el = fakeEl({ left: 0, top: 0, width: 300, height: 200 }, 300, 200);
    expect(e.screenToDrawing(50, 60, el)).toEqual([50, 60]);
  });

  it('screenToDrawing accounts for CSS zoom (Canvas pan/zoom): rendered px -> layout px', () => {
    const e = engineWith(100, 100);
    e.refitToContent(); // no strokes -> identity view
    // Element is rendered at 2x (bounding rect 200) but its layout size is 100.
    const zoomed = fakeEl({ left: 0, top: 0, width: 200, height: 200 }, 100, 100);
    // A pointer at rendered (100,100) is layout (50,50) -> drawing (50,50) under identity.
    const d = e.screenToDrawing(100, 100, zoomed);
    expect(d[0]).toBeCloseTo(50, 5);
    expect(d[1]).toBeCloseTo(50, 5);
  });

  it('centerInBox centers content at scale 1 (no zoom) and screenToDrawing inverts it', () => {
    const e = engineWith(600, 400);
    // One stroke whose bounding box is roughly (100..200, 100..150).
    e.loadStrokes([{ id: 's', tool: 'pen', color: '#fff', size: 0, opacity: 1,
      points: [[100, 100, 0.5], [200, 150, 0.5]], hasPressure: false, timestamp: 1 }]);
    e.centerInBox(600, 400);
    const t = e.getViewTransform();
    expect(t.scale).toBe(1); // never zooms
    // A pointer at the box center maps back to the content center.
    const el = fakeEl({ left: 0, top: 0, width: 600, height: 400 }, 600, 400);
    const center = e.screenToDrawing(300, 200, el);
    expect(center[0]).toBeCloseTo(150, 0); // content center x ~ (100+200)/2
    expect(center[1]).toBeCloseTo(125, 0); // content center y ~ (100+150)/2
  });

  it('centerInBox on an empty drawing puts the origin at the box center', () => {
    const e = engineWith(800, 600);
    e.centerInBox(800, 600);
    expect(e.getViewTransform()).toEqual({ scale: 1, offsetX: 400, offsetY: 300 });
  });

  it('sets backing store to display box times devicePixelRatio', () => {
    const e = engineWith(200, 100);
    const dpr = (globalThis as any).devicePixelRatio || 1;
    const canvases = (e as any).container.querySelectorAll('canvas');
    expect(canvases[0].width).toBe(200 * dpr);
    expect(canvases[0].height).toBe(100 * dpr);
  });

  it('refit scales existing content to fill the box and screenToDrawing inverts the transform', () => {
    const e = engineWith(100, 100);
    e.loadStrokes([{ id: 's', tool: 'pen', color: '#fff', size: 2, opacity: 1,
      points: [[0, 0, 0.5], [200, 200, 0.5]], hasPressure: false, timestamp: 0 }]);
    e.refitToContent(0);
    const b = e.getContentBounds();
    const expectedScale = Math.min(100 / b.width, 100 / b.height);
    const t = e.getViewTransform();
    expect(t.scale).toBeCloseTo(expectedScale, 5);
    expect(t.scale).toBeLessThan(1);
    const el = fakeEl({ left: 0, top: 0, width: 100, height: 100 }, 100, 100);
    const d = e.screenToDrawing(50, 50, el);
    expect(d[0] * t.scale + t.offsetX).toBeCloseTo(50, 5);
    expect(d[1] * t.scale + t.offsetY).toBeCloseTo(50, 5);
  });

  it('renderStatic applies the view-scaled transform when content is non-identity', () => {
    const e = engineWith(100, 100);
    e.loadStrokes([{ id: 's', tool: 'pen', color: '#fff', size: 2, opacity: 1,
      points: [[0, 0, 0.5], [200, 200, 0.5]], hasPressure: false, timestamp: 0 }]);
    e.refitToContent(0);
    const t = e.getViewTransform();
    const dpr = (globalThis as any).devicePixelRatio || 1;
    // force a synchronous static render and inspect the setTransform call
    e.staticDirty = true;
    e.render();
    const setTransformCalls = mockCtx.setTransform.mock.calls;
    // Find a call matching (dpr*scale, 0, 0, dpr*scale, dpr*offsetX, dpr*offsetY)
    const scaledCall = setTransformCalls.find(
      (args: number[]) =>
        Math.abs(args[0] - dpr * t.scale) < 1e-5 &&
        args[1] === 0 &&
        args[2] === 0 &&
        Math.abs(args[3] - dpr * t.scale) < 1e-5 &&
        Math.abs(args[4] - dpr * t.offsetX) < 1e-5 &&
        Math.abs(args[5] - dpr * t.offsetY) < 1e-5
    );
    expect(scaledCall).toBeDefined();
    expect(scaledCall[0]).toBeCloseTo(dpr * t.scale, 5);
    expect(scaledCall[3]).toBeCloseTo(dpr * t.scale, 5);
    expect(scaledCall[4]).toBeCloseTo(dpr * t.offsetX, 5);
    expect(scaledCall[5]).toBeCloseTo(dpr * t.offsetY, 5);
    // The view must be non-identity for this test to be meaningful
    expect(t.scale).toBeLessThan(1);

    e.destroy();
  });
});

describe('DrawingEngine sizing', () => {
  it('constructor accepts explicit width and height', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
    const engine = new DrawingEngine(container, 1024, 768);

    const dpr = globalThis.devicePixelRatio || 1;
    expect((engine as any).staticCanvas.width).toBe(1024 * dpr);
    expect((engine as any).staticCanvas.height).toBe(768 * dpr);
    expect((engine as any).activeCanvas.width).toBe(1024 * dpr);
    expect((engine as any).activeCanvas.height).toBe(768 * dpr);

    engine.destroy();
  });

  it('constructor defaults to container dimensions when width/height omitted', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
    const engine = new DrawingEngine(container);

    const dpr = globalThis.devicePixelRatio || 1;
    expect((engine as any).staticCanvas.width).toBe(800 * dpr);
    expect((engine as any).staticCanvas.height).toBe(600 * dpr);

    engine.destroy();
  });

  it('setCanvasSize updates canvas pixel buffer', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);

    engine.setCanvasSize(500, 400);

    const dpr = globalThis.devicePixelRatio || 1;
    expect((engine as any).staticCanvas.width).toBe(500 * dpr);
    expect((engine as any).staticCanvas.height).toBe(400 * dpr);

    engine.destroy();
  });

  it('renders strokes with DPR-only transform when the view is identity', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);

    engine.loadStrokes([{
      id: 'dpr-1',
      tool: 'pen' as const,
      color: '#000',
      size: 4,
      opacity: 1,
      points: [[100, 100, 0.5], [200, 200, 0.5]] as [number, number, number][],
      hasPressure: false,
      timestamp: Date.now(),
    }]);

    engine.staticDirty = true;
    engine.render();

    const dpr = globalThis.devicePixelRatio || 1;
    // The setTransform call for the identity-view case (scale=1, offsets=0) scales only by DPR
    const setTransformCalls = mockCtx.setTransform.mock.calls;
    // Find a call that sets DPR scaling (dpr, 0, 0, dpr, 0, 0)
    const dprCall = setTransformCalls.find(
      (args: number[]) => args[0] === dpr && args[1] === 0 && args[2] === 0 && args[3] === dpr && args[4] === 0 && args[5] === 0
    );
    expect(dprCall).toBeDefined();

    engine.destroy();
  });
});

describe('DrawingEngine exportThumbnail', () => {
  it('resolves null when content bounds are empty (no strokes)', async () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);

    const result = await engine.exportThumbnail();

    expect(result).toBeNull();

    engine.destroy();
  });

  it('resolves a value for non-empty content', async () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.loadStrokes([{
      id: 'thumb-1',
      tool: 'pen' as const,
      color: '#000',
      size: 4,
      opacity: 1,
      points: [[10, 10, 0.5], [50, 80, 0.5]] as [number, number, number][],
      hasPressure: false,
      timestamp: Date.now(),
    }]);

    // jsdom does not implement HTMLCanvasElement.toBlob; mock it so the resolve
    // path is observable (the engine forwards whatever the browser hands back).
    const fakeBlob = {} as Blob;
    const toBlobSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
        cb(fakeBlob);
      });

    const result = await engine.exportThumbnail();

    expect(result).toBe(fakeBlob);

    toBlobSpy.mockRestore();
    engine.destroy();
  });
});

describe('DrawingEngine destination-over layering', () => {
  it('paints highlighter strokes under destination-over when a highlighter exists', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);

    // Record the composite mode active at each fill() so we can prove the
    // highlighter outline is painted while globalCompositeOperation is set.
    const fillComposites: string[] = [];
    mockCtx.fill = vi.fn(() => {
      fillComposites.push(mockCtx.globalCompositeOperation);
    });

    engine.loadStrokes([
      {
        id: 'pen-1',
        tool: 'pen' as const,
        color: '#000',
        size: 4,
        opacity: 1,
        points: [[10, 10, 0.5], [20, 20, 0.5], [30, 30, 0.5]] as [number, number, number][],
        hasPressure: false,
        timestamp: 1,
      },
      {
        id: 'hl-1',
        tool: 'highlighter' as const,
        color: '#ff0',
        size: 8,
        opacity: 0.3,
        points: [[40, 40, 0.5], [50, 50, 0.5], [60, 60, 0.5]] as [number, number, number][],
        hasPressure: false,
        timestamp: 2,
      },
    ]);
    engine.staticDirty = true;
    engine.render();

    expect(fillComposites).toContain('destination-over');

    engine.destroy();
  });

  it('does not paint under destination-over when only pen strokes exist', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);

    const fillComposites: string[] = [];
    mockCtx.fill = vi.fn(() => {
      fillComposites.push(mockCtx.globalCompositeOperation);
    });

    engine.loadStrokes([{
      id: 'pen-only-1',
      tool: 'pen' as const,
      color: '#000',
      size: 4,
      opacity: 1,
      points: [[10, 10, 0.5], [20, 20, 0.5], [30, 30, 0.5]] as [number, number, number][],
      hasPressure: false,
      timestamp: 1,
    }]);
    engine.staticDirty = true;
    engine.render();

    // The pen outline was painted (at least one fill) and none of those fills
    // ran under destination-over (the highlighter loop is empty).
    expect(fillComposites.length).toBeGreaterThan(0);
    expect(fillComposites).not.toContain('destination-over');

    engine.destroy();
  });
});

describe('DrawingEngine active-stroke bookkeeping', () => {
  it('addPoint skips a duplicate point matching the previous x/y', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.beginStroke('pen');
    engine.addPoint([10, 20, 0.5]);
    engine.addPoint([10, 20, 0.9]); // same x/y as previous -> skipped (pressure ignored)
    engine.addPoint([30, 40, 0.5]);

    engine.endStroke();

    expect(engine.strokeManager.strokes[0].points.length).toBe(2);
  });

  it('committed stroke carries a non-empty string id and numeric timestamp', () => {
    const container = createMockContainer();
    const engine = new DrawingEngine(container);
    engine.beginStroke('pen');
    engine.addPoint([10, 20, 0.5]);
    engine.addPoint([30, 40, 0.5]);

    engine.endStroke();

    const strokes = engine.strokeManager.strokes;
    const committed = strokes[strokes.length - 1];
    expect(typeof committed.id).toBe('string');
    expect(committed.id.length).toBeGreaterThan(0);
    expect(typeof committed.timestamp).toBe('number');
  });
});

describe('DrawingEngine — stable reference-size fit (B3 idempotent embed fit)', () => {
  function strokeAt(x: number, y: number, len: number): any {
    const points: any[] = [];
    for (let i = 0; i <= len; i++) points.push([x + i, y + i, 0.5]);
    return { id: `s${x}`, tool: 'pen', color: '#fff', size: 2, opacity: 1, points, hasPressure: false, timestamp: 0 };
  }

  it('fits a reference rectangle into the box with scale min(boxW/refW, boxH/refH)', () => {
    const engine = new DrawingEngine(createMockContainer(), 800, 600);
    engine.loadStrokes([strokeAt(0, 0, 100)]);
    engine.setDisplaySize(400, 300);
    engine.fitReferenceSize(200, 100, 0);

    // Letterbox fit of a 200x100 reference into a 400x300 box -> scale = min(2, 3) = 2.
    expect(engine.getViewTransform().scale).toBeCloseTo(2, 5);
  });

  it('produces a STABLE scale across content growth at the same box + reference (idempotent)', () => {
    const box = { w: 400, h: 300 };
    const ref = { w: 200, h: 100 };

    const before = new DrawingEngine(createMockContainer(), 800, 600);
    before.loadStrokes([strokeAt(0, 0, 100)]);
    before.setDisplaySize(box.w, box.h);
    before.fitReferenceSize(ref.w, ref.h, 8);
    const scaleBefore = before.getViewTransform().scale;

    // The user drew more (live content bounds grow well past the reference), then the
    // surface is remounted at the SAME box and SAME saved reference dimensions.
    const after = new DrawingEngine(createMockContainer(), 800, 600);
    after.loadStrokes([strokeAt(0, 0, 100), strokeAt(500, 500, 400)]);
    after.setDisplaySize(box.w, box.h);
    after.fitReferenceSize(ref.w, ref.h, 8);
    const scaleAfter = after.getViewTransform().scale;

    // Same reference + same box => same scale, regardless of how content grew.
    expect(scaleAfter).toBeCloseTo(scaleBefore, 10);
  });

  it('degenerate reference (zero area) yields the identity transform', () => {
    const engine = new DrawingEngine(createMockContainer(), 800, 600);
    engine.loadStrokes([strokeAt(0, 0, 100)]);
    engine.setDisplaySize(400, 300);
    engine.fitReferenceSize(0, 0, 8);

    expect(engine.getViewTransform()).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });

  // markdown-embed-frame: the reference-size fit threads a maxScale cap so a Markdown embed
  // never upscales a small drawing past natural size.
  it('caps the view scale at maxScale when the reference is smaller than the box', () => {
    const engine = new DrawingEngine(createMockContainer(), 800, 600);
    engine.loadStrokes([strokeAt(0, 0, 100)]);
    engine.setDisplaySize(400, 300);
    engine.fitReferenceSize(200, 100, 0, 1);

    // Uncapped this fits at scale min(400/200, 300/100) = 2; the maxScale=1 cap binds.
    expect(engine.getViewTransform().scale).toBeCloseTo(1, 5);
  });

  it('an uncapped fit at the same box/reference still scales up past 1', () => {
    const engine = new DrawingEngine(createMockContainer(), 800, 600);
    engine.loadStrokes([strokeAt(0, 0, 100)]);
    engine.setDisplaySize(400, 300);
    engine.fitReferenceSize(200, 100, 0);

    expect(engine.getViewTransform().scale).toBeCloseTo(2, 5);
  });
});

// canvas-rendering: presentation-facing transform mutators (setView/panBy/zoomAt). These
// drive pan/zoom on a surface WITHOUT touching the render pipeline; they clamp scale to
// [0.1, 8], mark the static layer dirty, and request a render.
describe('DrawingEngine transform mutators (setView / panBy / zoomAt)', () => {
  function engineAt(boxW: number, boxH: number) {
    const e = new DrawingEngine(createMockContainer(), boxW, boxH);
    e.setDisplaySize(boxW, boxH);
    return e;
  }

  it('setView replaces the transform and clamps scale to [0.1, 8]', () => {
    const e = engineAt(400, 300);
    e.setView({ scale: 100, offsetX: 12, offsetY: 34 });
    expect(e.getViewTransform()).toEqual({ scale: 8, offsetX: 12, offsetY: 34 });

    e.setView({ scale: 0.001, offsetX: 5, offsetY: 6 });
    expect(e.getViewTransform()).toEqual({ scale: 0.1, offsetX: 5, offsetY: 6 });
  });

  it('setView marks the static layer dirty and requests a render', () => {
    const e = engineAt(400, 300);
    e.render(); // clear dirty + rafId
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(7);
    e.setView({ scale: 1, offsetX: 0, offsetY: 0 });
    expect(e.staticDirty).toBe(true);
    expect(rafSpy).toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it('panBy translates the offset and leaves the scale unchanged', () => {
    const e = engineAt(400, 300);
    e.setView({ scale: 2, offsetX: 10, offsetY: 20 });
    e.panBy(5, -7);
    expect(e.getViewTransform()).toEqual({ scale: 2, offsetX: 15, offsetY: 13 });
  });

  it('panBy marks dirty and requests a render', () => {
    const e = engineAt(400, 300);
    e.render();
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(7);
    e.panBy(1, 1);
    expect(e.staticDirty).toBe(true);
    expect(rafSpy).toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it('zoomAt keeps the focal point fixed under the cursor (zoom-to-point identity)', () => {
    const e = engineAt(400, 300);
    e.setView({ scale: 2, offsetX: 30, offsetY: 10 });
    const cx = 100, cy = 90;
    // Content point currently under the cursor.
    const before = e.getViewTransform();
    const contentX = (cx - before.offsetX) / before.scale;
    const contentY = (cy - before.offsetY) / before.scale;

    e.zoomAt(0.5, cx, cy);

    const after = e.getViewTransform();
    // The same content point must still map to the same screen pixel.
    expect(contentX * after.scale + after.offsetX).toBeCloseTo(cx, 6);
    expect(contentY * after.scale + after.offsetY).toBeCloseTo(cy, 6);
    expect(after.scale).toBeCloseTo(1, 6);
  });

  it('zoomAt clamps the resulting scale at 8 (max) and 0.1 (min)', () => {
    const e = engineAt(400, 300);
    e.setView({ scale: 5, offsetX: 0, offsetY: 0 });
    e.zoomAt(4, 50, 50); // 5 * 4 = 20 -> clamp 8
    expect(e.getViewTransform().scale).toBeCloseTo(8, 6);

    e.setView({ scale: 0.2, offsetX: 0, offsetY: 0 });
    e.zoomAt(0.1, 50, 50); // 0.2 * 0.1 = 0.02 -> clamp 0.1
    expect(e.getViewTransform().scale).toBeCloseTo(0.1, 6);
  });

  it('resizeBox resizes the backing store but leaves the view transform unchanged', () => {
    const e = engineAt(400, 300);
    e.setView({ scale: 1.5, offsetX: 22, offsetY: 33 });
    const before = e.getViewTransform();
    const dpr = (globalThis as any).devicePixelRatio || 1;

    e.resizeBox(640, 480);

    expect(e.getViewTransform()).toEqual(before);
    expect((e as any).staticCanvas.width).toBe(640 * dpr);
    expect((e as any).staticCanvas.height).toBe(480 * dpr);
  });
});
