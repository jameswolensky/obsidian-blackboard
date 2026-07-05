import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/domain/entities';
import type { BlackboardFile } from '../src/domain/entities';

vi.mock('../src/infrastructure/canvas-renderer', () => {
  class MockDrawingEngine {
    strokeManager = {
      strokes: [] as any[],
      reset: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      deleteStroke: vi.fn(),
    };
    toolManager: any = {
      setTool: vi.fn(),
      setColor: vi.fn(),
      setSize: vi.fn(),
      setDefaults: vi.fn(),
      activeTool: 'pen',
      activeSize: 2,
      activeColor: '#ffffff',
      activeOpacity: 1,
    };
    drawingWidth: number;
    drawingHeight: number;
    staticDirty = false;
    render = vi.fn();
    requestRender = vi.fn();
    getContentBounds = vi.fn().mockReturnValue({ x: 0, y: 0, width: 0, height: 0 });
    destroy = vi.fn();
    setCanvasSize = vi.fn((w: number, h: number) => {
      this.drawingWidth = w;
      this.drawingHeight = h;
    });
    centerInBox = vi.fn();
    resizeBox = vi.fn();
    setDisplaySize = vi.fn();
    refitToContent = vi.fn();
    panBy = vi.fn();
    zoomAt = vi.fn();
    setView = vi.fn();
    getViewTransform = vi.fn().mockReturnValue({ scale: 1, offsetX: 0, offsetY: 0 });
    screenToDrawing = vi.fn((clientX: number, clientY: number) => [clientX, clientY] as [number, number]);
    beginStroke = vi.fn();
    addPoint = vi.fn();
    endStroke = vi.fn();
    loadStrokes = vi.fn((strokes: any[]) => {
      this.strokeManager.reset();
      for (const s of strokes) {
        this.strokeManager.strokes.push(JSON.parse(JSON.stringify(s)));
      }
      this.staticDirty = true;
    });
    constructor(container?: HTMLElement, width?: number, height?: number, toolManager?: any) {
      this.drawingWidth = width ?? 800;
      this.drawingHeight = height ?? 600;
      // Honor an injected shared ToolManager (fix-tool-state-isolation).
      if (toolManager) this.toolManager = toolManager;
    }
  }
  return { DrawingEngine: MockDrawingEngine };
});

vi.mock('../src/application/file-format', () => ({
  serialize: vi.fn().mockReturnValue('{"version":2}'),
  deserialize: vi.fn().mockReturnValue({
    file: { version: 2, width: 800, height: 600, strokes: [], background: { color: 'transparent' }, viewport: { x: 0, y: 0, zoom: 1 }, settings: { smoothing: 0.5, streamline: 0.5 } },
    warnings: [],
    readonly: false,
  }),
}));

vi.mock('../src/application/export-service', () => ({
  exportSvg: vi.fn().mockReturnValue('<svg></svg>'),
}));

vi.mock('../src/domain/geometry', () => ({
  distToSegment: vi.fn().mockReturnValue(100),
}));

import { BlackboardView, VIEW_TYPE } from '../src/presentation/blackboard-view';
import { DrawingEngine } from '../src/infrastructure/canvas-renderer';
import { DocumentStore } from '../src/application/document-store';
import { serialize, deserialize } from '../src/application/file-format';

function createView(settings = DEFAULT_PLUGIN_SETTINGS): BlackboardView {
  const leaf = new WorkspaceLeaf();
  return new BlackboardView(leaf, settings);
}

function createViewWith(surfaceManager: any, toolManager: any, settings = DEFAULT_PLUGIN_SETTINGS): BlackboardView {
  const leaf = new WorkspaceLeaf();
  return new BlackboardView(leaf, settings, surfaceManager, toolManager);
}

describe('BlackboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('view basics', () => {
    it('returns the correct view type', () => {
      const view = createView();

      const result = view.getViewType();

      expect(result).toBe(VIEW_TYPE);
    });

    it('returns basename when file is set', () => {
      const view = createView();
      const file = new TFile();
      file.basename = 'my-drawing';
      view.file = file;

      const result = view.getDisplayText();

      expect(result).toBe('my-drawing');
    });

    it('returns Drawing when file is null', () => {
      const view = createView();
      view.file = null;

      const result = view.getDisplayText();

      expect(result).toBe('Drawing');
    });

    it('returns pencil as the icon', () => {
      const view = createView();

      const result = view.getIcon();

      expect(result).toBe('pencil');
    });
  });

  describe('detectEmbedded', () => {
    it('returns true when ancestor has canvas-node-content class', async () => {
      const view = createView();
      const wrapper = document.createElement('div');
      wrapper.classList.add('canvas-node-content');
      wrapper.appendChild(view.contentEl);

      await view.onOpen();

      // Embedded views now go straight to edit mode with a drawing container
      expect(view.contentEl.querySelector('.blackboard-drawing-container')).not.toBeNull();
    });

    it('returns false when no ancestor has canvas-node-content class', async () => {
      const view = createView();

      await view.onOpen();

      expect((view as any).engine).not.toBeNull();
    });
  });

  describe('hideCanvasBlocker', () => {
    it('hides the blocker element when canvas-node ancestor exists', async () => {
      const view = createView();
      const canvasNode = document.createElement('div');
      canvasNode.classList.add('canvas-node');
      const canvasNodeContent = document.createElement('div');
      canvasNodeContent.classList.add('canvas-node-content');
      const blocker = document.createElement('div');
      blocker.classList.add('canvas-node-content-blocker');
      canvasNode.appendChild(blocker);
      canvasNode.appendChild(canvasNodeContent);
      canvasNodeContent.appendChild(view.contentEl);
      document.body.appendChild(canvasNode);

      await view.onOpen();

      expect(blocker.style.display).toBe('none');
      document.body.removeChild(canvasNode);
    });

    it('does nothing when no canvas-node ancestor exists', async () => {
      const view = createView();

      await view.onOpen();

      expect(view.contentEl.parentElement).toBeNull();
    });
  });

  describe('onOpen', () => {
    it('enters edit mode immediately (always-live canvas)', async () => {
      const view = createView();

      await view.onOpen();

      expect((view as any).editing).toBe(true);
    });

    it('enters edit mode when embedded too (no preview)', async () => {
      const view = createView();
      const wrapper = document.createElement('div');
      wrapper.classList.add('canvas-node-content');
      wrapper.appendChild(view.contentEl);

      await view.onOpen();

      expect((view as any).editing).toBe(true);
      expect(view.contentEl.querySelector('.blackboard-drawing-container')).not.toBeNull();
    });
  });

  describe('enterEditMode', () => {
    it('is idempotent when called twice', async () => {
      const view = createView();
      await view.onOpen();
      const engineBefore = (view as any).engine;

      (view as any).enterEditMode();

      expect((view as any).engine).toBe(engineBefore);
    });

    it('loads strokes from fileData during enter', async () => {
      const mockStrokes = [{ id: 's1', tool: 'pen', color: '#fff', size: 2, opacity: 1, points: [[0, 0, 0.5]], hasPressure: false, timestamp: 1 }];
      vi.mocked(deserialize).mockReturnValueOnce({
        file: { version: 2, width: 800, height: 600, strokes: mockStrokes, background: { color: 'transparent' }, viewport: { x: 0, y: 0, zoom: 1 }, settings: { smoothing: 0.5, streamline: 0.5 } },
        warnings: [],
        readonly: false,
      });
      const view = createView();
      (view as any).fileData = '{"version":2}';

      await view.onOpen();

      expect(deserialize).toHaveBeenCalledWith('{"version":2}');
    });

    it('fills the pane in the standalone view instead of sizing to the saved file', async () => {
      vi.mocked(deserialize).mockReturnValueOnce({
        file: { version: 3, width: 1024, height: 768, strokes: [], background: { color: 'transparent' }, settings: { smoothing: 0.5, streamline: 0.5 } },
        warnings: [],
        readonly: false,
      });
      const view = createView();
      (view as any).fileData = '{"version":3}';

      await view.onOpen();

      const dc = (view as any).drawingContainer as HTMLElement;
      // Standalone surface fills the pane (jsdom: 800x600 fallback), not the saved 1024x768.
      expect(dc.style.width).not.toBe('1024px');
      // Infinite-canvas model: fit content into the pane via the view transform (no centre-at-scale-1).
      expect((view as any).engine.setDisplaySize).toHaveBeenCalled();
      expect((view as any).engine.refitToContent).toHaveBeenCalled();
      expect((view as any).engine.centerInBox).not.toHaveBeenCalled();
    });

    it('uses default 800x600 when no fileData', async () => {
      const view = createView();

      await view.onOpen();

      const dc = (view as any).drawingContainer as HTMLElement;
      expect(dc.style.width).toBe('800px');
      expect(dc.style.height).toBe('600px');
    });
  });

  describe('shared tool state (fix-tool-state-isolation)', () => {
    it('wires the engine to the injected shared ToolManager', async () => {
      const shared = { setDefaults: vi.fn(), activeTool: 'highlighter', activeSize: 30, activeColor: '#ff0000', activeOpacity: 0.3, setTool: vi.fn(), setColor: vi.fn(), setSize: vi.fn() };
      const view = createViewWith(undefined, shared);

      await view.onOpen();

      expect((view as any).engine.toolManager).toBe(shared);
    });

    it('does NOT re-seed the shared manager on mount (no setDefaults, keeps the live selection)', async () => {
      const shared = { setDefaults: vi.fn(), activeTool: 'highlighter', activeSize: 30, activeColor: '#ff0000', activeOpacity: 0.3, setTool: vi.fn(), setColor: vi.fn(), setSize: vi.fn() };
      const view = createViewWith(undefined, shared);

      await view.onOpen();

      expect(shared.setDefaults).not.toHaveBeenCalled();
      // The live selection survives opening the file.
      expect((view as any).engine.toolManager.activeTool).toBe('highlighter');
    });
  });

  describe('getViewData', () => {
    it('serializes strokes with version 3 and dimensions', async () => {
      const view = createView();
      await view.onOpen();

      view.getViewData();

      expect(serialize).toHaveBeenCalledTimes(1);
      const callArg = vi.mocked(serialize).mock.calls[0][0];
      expect(callArg.version).toBe(3);
      expect(callArg.width).toBe(800);
      expect(callArg.height).toBe(600);
    });

    it('returns cached fileData when engine is null', () => {
      const view = createView();
      (view as any).fileData = 'cached-data';

      const result = view.getViewData();

      expect(result).toBe('cached-data');
    });
  });

  describe('setViewData', () => {
    it('pushes deserialized strokes into engine and centers the standalone surface', async () => {
      const mockStrokes = [{ id: 's1', tool: 'pen', color: '#fff', size: 2, opacity: 1, points: [[0, 0, 0.5]], hasPressure: false, timestamp: 1 }];
      vi.mocked(deserialize).mockReturnValue({
        file: { version: 3, width: 1024, height: 768, strokes: mockStrokes, background: { color: 'transparent' }, settings: { smoothing: 0.5, streamline: 0.5 } },
        warnings: [],
        readonly: false,
      });
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      engine.strokeManager.strokes = [];

      view.setViewData('{"version":3}', false);

      expect(engine.strokeManager.strokes.length).toBe(1);
      // Standalone view fits content into the pane instead of sizing to the saved dimensions.
      expect(engine.refitToContent).toHaveBeenCalled();
      expect(engine.setCanvasSize).not.toHaveBeenCalledWith(1024, 768);
    });

    it('sizes the standalone container to the pane, not the saved dimensions', async () => {
      vi.mocked(deserialize).mockReturnValue({
        file: { version: 3, width: 1920, height: 1080, strokes: [], background: { color: 'transparent' }, settings: { smoothing: 0.5, streamline: 0.5 } },
        warnings: [],
        readonly: false,
      });
      const view = createView();
      await view.onOpen();

      view.setViewData('{"version":3}', false);

      const dc = (view as any).drawingContainer as HTMLElement;
      // jsdom has no layout (pane client size 0) so the box falls back to 800x600 —
      // the point is it is NOT the saved 1920x1080.
      expect(dc.style.width).not.toBe('1920px');
      expect(dc.style.width).toBe('800px');
      expect(dc.style.height).toBe('600px');
    });

    it('resets stroke manager when clear flag is true', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;

      view.setViewData('{"version":2}', true);

      expect(engine.strokeManager.reset).toHaveBeenCalled();
    });

    it('handles corrupt JSON without throwing', async () => {
      vi.mocked(deserialize).mockImplementationOnce(() => { throw new Error('bad json'); });
      const view = createView();
      await view.onOpen();

      expect(() => view.setViewData('not-json', false)).not.toThrow();
    });
  });

  describe('clear', () => {
    it('resets the stroke manager', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;

      view.clear();

      expect(engine.strokeManager.reset).toHaveBeenCalledTimes(1);
    });
  });

  describe('onClose', () => {
    it('destroys engine and cleans up resources', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;

      await view.onClose();

      expect(engine.destroy).toHaveBeenCalledTimes(1);
    });

    it('handles close when no toolbar exists', async () => {
      const view = createView();

      await view.onClose();

      expect((view as any).engine).toBeNull();
    });
  });

  describe('eraseAt', () => {
    it('does nothing when engine is null', () => {
      const view = createView();
      // eraseAt with no engine should not throw
      expect(() => (view as any).eraseAt(10, 10)).not.toThrow();
    });
  });

  describe('document pointer listeners', () => {
    it('handles pointerdown inside drawing container', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      const dc = (view as any).drawingContainer as HTMLElement;

      const event = new PointerEvent('pointerdown', {
        clientX: 50,
        clientY: 50,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'target', { value: dc, writable: false });

      document.dispatchEvent(event);

      expect(engine.beginStroke).toHaveBeenCalled();
    });

    it('passes coordinates directly to addPoint without viewport transform', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      const dc = (view as any).drawingContainer as HTMLElement;

      const downEvent = new PointerEvent('pointerdown', {
        clientX: 50, clientY: 50, bubbles: true, cancelable: true,
      });
      Object.defineProperty(downEvent, 'target', { value: dc, writable: false });
      document.dispatchEvent(downEvent);

      // addPoint should receive CSS-compensated coordinates directly
      expect(engine.addPoint).toHaveBeenCalled();
      const point = engine.addPoint.mock.calls[0][0];
      expect(point).toHaveLength(3);
      expect(typeof point[0]).toBe('number');
      expect(typeof point[1]).toBe('number');
      expect(typeof point[2]).toBe('number');
    });

    it('ignores pointerdown outside drawing container', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;

      const outsideEl = document.createElement('div');
      document.body.appendChild(outsideEl);

      const event = new PointerEvent('pointerdown', {
        clientX: 50,
        clientY: 50,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'target', { value: outsideEl, writable: false });

      document.dispatchEvent(event);

      expect(engine.beginStroke).not.toHaveBeenCalled();
      document.body.removeChild(outsideEl);
    });

    it('handles pointermove during active stroke', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      const dc = (view as any).drawingContainer as HTMLElement;

      // Start stroke
      const downEvent = new PointerEvent('pointerdown', {
        clientX: 50, clientY: 50, bubbles: true, cancelable: true,
      });
      Object.defineProperty(downEvent, 'target', { value: dc, writable: false });
      document.dispatchEvent(downEvent);

      // Move
      const moveEvent = new PointerEvent('pointermove', {
        clientX: 60, clientY: 60, bubbles: true, cancelable: true,
      });
      document.dispatchEvent(moveEvent);

      expect(engine.addPoint).toHaveBeenCalled();
    });

    it('ignores pointermove when no stroke is active', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;

      const moveEvent = new PointerEvent('pointermove', {
        clientX: 60, clientY: 60, bubbles: true, cancelable: true,
      });
      document.dispatchEvent(moveEvent);

      expect(engine.addPoint).not.toHaveBeenCalled();
    });

    it('handles pointerup to end stroke', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      const dc = (view as any).drawingContainer as HTMLElement;
      const saveSpy = vi.spyOn(view, 'requestSave');

      // Start stroke
      const downEvent = new PointerEvent('pointerdown', {
        clientX: 50, clientY: 50, bubbles: true, cancelable: true,
      });
      Object.defineProperty(downEvent, 'target', { value: dc, writable: false });
      document.dispatchEvent(downEvent);

      // End stroke
      const upEvent = new PointerEvent('pointerup', {
        clientX: 50, clientY: 50, bubbles: true,
      });
      document.dispatchEvent(upEvent);

      expect(engine.endStroke).toHaveBeenCalled();
      expect(saveSpy).toHaveBeenCalled();
    });

    it('ignores pointerup when no stroke is active', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;

      const upEvent = new PointerEvent('pointerup', {
        clientX: 50, clientY: 50, bubbles: true,
      });
      document.dispatchEvent(upEvent);

      expect(engine.endStroke).not.toHaveBeenCalled();
    });

    it('eraser tool does not begin/end stroke', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      engine.toolManager.activeTool = 'eraser';
      const dc = (view as any).drawingContainer as HTMLElement;

      const downEvent = new PointerEvent('pointerdown', {
        clientX: 50, clientY: 50, bubbles: true, cancelable: true,
      });
      Object.defineProperty(downEvent, 'target', { value: dc, writable: false });
      document.dispatchEvent(downEvent);

      expect(engine.beginStroke).not.toHaveBeenCalled();
    });

  });

  describe('resize handle touch passthrough', () => {
    it('does not intercept touch events on canvas-node-resize-handle elements', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      const dc = (view as any).drawingContainer as HTMLElement;

      // Create a resize handle inside the drawing container (simulating Obsidian's canvas)
      const resizeHandle = document.createElement('div');
      resizeHandle.classList.add('canvas-node-resize-handle');
      dc.appendChild(resizeHandle);

      const downEvent = new PointerEvent('pointerdown', {
        clientX: 50, clientY: 50, bubbles: true, cancelable: true,
        pointerType: 'touch',
      });
      Object.defineProperty(downEvent, 'target', { value: resizeHandle, writable: false });
      document.dispatchEvent(downEvent);

      expect(engine.beginStroke).not.toHaveBeenCalled();
      expect((view as any).strokeActive).toBe(false);
    });

    it('does not intercept touch events on children of resize handles', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      const dc = (view as any).drawingContainer as HTMLElement;

      const resizeHandle = document.createElement('div');
      resizeHandle.classList.add('canvas-node-resize-handle');
      const child = document.createElement('span');
      resizeHandle.appendChild(child);
      dc.appendChild(resizeHandle);

      const downEvent = new PointerEvent('pointerdown', {
        clientX: 50, clientY: 50, bubbles: true, cancelable: true,
        pointerType: 'touch',
      });
      Object.defineProperty(downEvent, 'target', { value: child, writable: false });
      document.dispatchEvent(downEvent);

      expect(engine.beginStroke).not.toHaveBeenCalled();
    });

    it('sets touch-action to pan-x pan-y in embedded mode for resize gestures', async () => {
      const view = createView();
      const wrapper = document.createElement('div');
      wrapper.classList.add('canvas-node-content');
      wrapper.appendChild(view.contentEl);

      await view.onOpen();

      const dc = (view as any).drawingContainer as HTMLElement;
      expect(dc.style.touchAction).toBe('pan-x pan-y');
    });

    it('sets touch-action to none in standalone mode', async () => {
      const view = createView();

      await view.onOpen();

      const dc = (view as any).drawingContainer as HTMLElement;
      expect(dc.style.touchAction).toBe('none');
    });
  });

  describe('palm touch keyboard prevention', () => {
    it('prevents default on touch pointerdown events on the drawing container', async () => {
      const view = createView();
      await view.onOpen();

      const container = view.contentEl.querySelector('.blackboard-drawing-container') as HTMLElement;
      const event = new PointerEvent('pointerdown', {
        pointerType: 'touch',
        cancelable: true,
        bubbles: true,
      });
      container.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('does not prevent default on pen pointerdown events', async () => {
      const view = createView();
      await view.onOpen();

      const container = view.contentEl.querySelector('.blackboard-drawing-container') as HTMLElement;
      const event = new PointerEvent('pointerdown', {
        pointerType: 'pen',
        cancelable: true,
        bubbles: true,
      });
      container.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('prevents touchstart default in embedded mode', async () => {
      const view = createView();
      const wrapper = document.createElement('div');
      wrapper.classList.add('canvas-node-content');
      wrapper.appendChild(view.contentEl);

      await view.onOpen();

      const container = view.contentEl.querySelector('.blackboard-drawing-container') as HTMLElement;
      const event = new TouchEvent('touchstart', {
        cancelable: true,
        bubbles: true,
      });
      container.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('prevents touchstart default in standalone mode too (defuses iPadOS Scribble)', async () => {
      const view = createView();
      await view.onOpen();

      const container = view.contentEl.querySelector('.blackboard-drawing-container') as HTMLElement;
      const event = new TouchEvent('touchstart', {
        cancelable: true,
        bubbles: true,
      });
      container.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    // harden-scribble-suppression: a standalone Blackboard must never trigger Scribble, so
    // the guard extends from the drawing container to the surrounding contentEl margins.
    // NOTE: jsdom verifies the preventDefault wiring only; true Scribble behaviour near the
    // pane edges is device-only (tasks.md §4, intentionally unchecked).
    it('prevents touchstart on the standalone contentEl margin outside the drawing container', async () => {
      const view = createView();
      await view.onOpen();

      // Target is contentEl itself (the centred margin around the drawing), NOT the inner
      // drawing container, so only the new contentEl-level guard can prevent default.
      const event = new TouchEvent('touchstart', { cancelable: true, bubbles: true });
      Object.defineProperty(event, 'target', { value: view.contentEl, writable: false });
      view.contentEl.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('prevents touchmove on the standalone contentEl margin', async () => {
      const view = createView();
      await view.onOpen();

      const event = new TouchEvent('touchmove', { cancelable: true, bubbles: true });
      view.contentEl.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('removes the standalone contentEl guard on close (no leak)', async () => {
      const view = createView();
      await view.onOpen();
      await view.onClose();

      const event = new TouchEvent('touchstart', { cancelable: true, bubbles: true });
      view.contentEl.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });
  });

  // infinite-canvas-standalone: fit-to-content on open, gated by userInteracted.
  describe('fit-to-content on open (infinite canvas)', () => {
    it('fits the loaded content into the pane on open while userInteracted is false', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;

      expect((view as any).userInteracted).toBe(false);
      expect(engine.setDisplaySize).toHaveBeenCalled();
      expect(engine.refitToContent).toHaveBeenCalled();
      expect(engine.resizeBox).not.toHaveBeenCalled();
    });

    it('preserves the view (resizeBox, no re-fit) once userInteracted is true', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      engine.setDisplaySize.mockClear();
      engine.refitToContent.mockClear();
      engine.resizeBox.mockClear();

      // Simulate the user having panned/zoomed/drawn, then a pane resize.
      (view as any).userInteracted = true;
      (view as any).layoutStandalone();

      expect(engine.resizeBox).toHaveBeenCalled();
      expect(engine.refitToContent).not.toHaveBeenCalled();
      expect(engine.setDisplaySize).not.toHaveBeenCalled();
    });

    it('does not give contentEl an overflow:auto scroll model', async () => {
      const view = createView();
      await view.onOpen();

      expect(view.contentEl.style.overflow).not.toBe('auto');
    });
  });

  // infinite-canvas-standalone: gesture arbitration — pen draws, finger navigates.
  describe('pan/zoom navigation (infinite canvas)', () => {
    function downAt(target: HTMLElement, x: number, y: number, pointerType: string, pointerId = 1) {
      const e = new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerType, pointerId, bubbles: true, cancelable: true });
      Object.defineProperty(e, 'target', { value: target, writable: false });
      document.dispatchEvent(e);
      return e;
    }
    function moveAt(x: number, y: number, pointerType: string, pointerId = 1) {
      const e = new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType, pointerId, bubbles: true, cancelable: true });
      document.dispatchEvent(e);
      return e;
    }
    function upAt(x: number, y: number, pointerType: string, pointerId = 1) {
      const e = new PointerEvent('pointerup', { clientX: x, clientY: y, pointerType, pointerId, bubbles: true, cancelable: true });
      document.dispatchEvent(e);
      return e;
    }

    it('pen pointerdown begins a stroke (pen always draws, never navigates)', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      const dc = (view as any).drawingContainer as HTMLElement;

      downAt(dc, 50, 50, 'pen');

      expect(engine.beginStroke).toHaveBeenCalled();
      expect(engine.panBy).not.toHaveBeenCalled();
      expect(engine.zoomAt).not.toHaveBeenCalled();
    });

    it('touch pointerdown does NOT begin a stroke (routes to navigation)', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      const dc = (view as any).drawingContainer as HTMLElement;

      downAt(dc, 50, 50, 'touch');

      expect(engine.beginStroke).not.toHaveBeenCalled();
      expect((view as any).strokeActive).toBe(false);
      expect((view as any).userInteracted).toBe(true);
    });

    it('single-finger drag pans via engine.panBy with the screen-pixel delta', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      const dc = (view as any).drawingContainer as HTMLElement;

      downAt(dc, 100, 100, 'touch', 1);
      moveAt(140, 75, 'touch', 1);

      expect(engine.panBy).toHaveBeenCalledWith(40, -25);
      expect(engine.beginStroke).not.toHaveBeenCalled();
    });

    it('two-finger pinch zooms via engine.zoomAt with a factor reflecting the distance change, about the midpoint', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      const dc = (view as any).drawingContainer as HTMLElement;

      // Two fingers down 100px apart, centred on (100, 50).
      downAt(dc, 50, 50, 'touch', 1);
      downAt(dc, 150, 50, 'touch', 2);
      // Establish the pinch baseline distance (100) on the first move.
      moveAt(50, 50, 'touch', 1);
      engine.zoomAt.mockClear();
      // Spread finger 2 out to 200px separation -> factor 2, midpoint (100, 50).
      moveAt(250, 50, 'touch', 2);

      expect(engine.zoomAt).toHaveBeenCalled();
      const [factor, cx, cy] = engine.zoomAt.mock.calls[engine.zoomAt.mock.calls.length - 1];
      expect(factor).toBeCloseTo(2, 5);
      expect(cx).toBeCloseTo(150, 5); // midpoint of (50) and (250)
      expect(cy).toBeCloseTo(50, 5);
      expect(engine.beginStroke).not.toHaveBeenCalled();
    });

    it('ignores finger gestures while a pen stroke is active (palm rejection): finger-move does not pan', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      const dc = (view as any).drawingContainer as HTMLElement;

      // Pen stroke starts.
      downAt(dc, 10, 10, 'pen', 1);
      expect((view as any).strokeActive).toBe(true);
      // A resting palm (touch) lands and moves.
      downAt(dc, 200, 200, 'touch', 2);
      moveAt(260, 260, 'touch', 2);

      expect(engine.panBy).not.toHaveBeenCalled();
    });

    it('does not begin a stroke while a finger gesture is active: pen-down panics no stroke', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      const dc = (view as any).drawingContainer as HTMLElement;

      // A finger is already panning.
      downAt(dc, 100, 100, 'touch', 1);
      // Pen comes down mid-gesture.
      downAt(dc, 120, 120, 'pen', 2);

      expect(engine.beginStroke).not.toHaveBeenCalled();
      expect((view as any).strokeActive).toBe(false);
    });

    it('Ctrl/Cmd+wheel zooms about the cursor and prevents page scroll', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      const dc = (view as any).drawingContainer as HTMLElement;

      const wheel = new WheelEvent('wheel', { clientX: 120, clientY: 80, deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
      Object.defineProperty(wheel, 'target', { value: dc, writable: false });
      dc.dispatchEvent(wheel);

      expect(engine.zoomAt).toHaveBeenCalled();
      const [, cx, cy] = engine.zoomAt.mock.calls[0];
      expect(cx).toBeCloseTo(120, 5);
      expect(cy).toBeCloseTo(80, 5);
      expect(wheel.defaultPrevented).toBe(true);
    });

    it('plain wheel (no modifier) does not zoom', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      const dc = (view as any).drawingContainer as HTMLElement;

      const wheel = new WheelEvent('wheel', { clientX: 120, clientY: 80, deltaY: -100, bubbles: true, cancelable: true });
      Object.defineProperty(wheel, 'target', { value: dc, writable: false });
      dc.dispatchEvent(wheel);

      expect(engine.zoomAt).not.toHaveBeenCalled();
    });

    it('space+drag pans on desktop (mouse) via engine.panBy', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      const dc = (view as any).drawingContainer as HTMLElement;

      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
      downAt(dc, 100, 100, 'mouse', 1);
      moveAt(130, 90, 'mouse', 1);

      expect(engine.panBy).toHaveBeenCalledWith(30, -10);
      expect(engine.beginStroke).not.toHaveBeenCalled();
      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
    });

    it('navigation never writes through the DocumentStore (decoupled from embeds)', async () => {
      const view = createView();
      await view.onOpen();
      const engine = (view as any).engine;
      const dc = (view as any).drawingContainer as HTMLElement;
      const persistSpy = vi.spyOn(view as any, 'persist');

      downAt(dc, 100, 100, 'touch', 1);
      moveAt(140, 100, 'touch', 1);
      upAt(140, 100, 'touch', 1);

      expect(engine.panBy).toHaveBeenCalled();
      expect(persistSpy).not.toHaveBeenCalled();
    });
  });
});

describe('BlackboardView — shared-document sync (B2 single source of truth)', () => {
  function strokeOf(id: string): any {
    return { id, tool: 'pen', color: '#fff', size: 2, opacity: 1, points: [[0, 0, 0.5]], hasPressure: false, timestamp: 0 };
  }
  function fileWith(strokes: any[]): BlackboardFile {
    return { version: 3, width: 800, height: 600, strokes, background: { color: 'transparent' } };
  }
  function mkRepo(file: BlackboardFile) {
    return {
      load: vi.fn().mockResolvedValue({ file, warnings: [], readonly: false }),
      save: vi.fn().mockResolvedValue(undefined),
      writeRaw: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(''),
      exists: vi.fn().mockReturnValue(true),
      ensureFolder: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
    } as any;
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  function mountView(store: DocumentStore, repo: any, path: string): BlackboardView {
    const view = new BlackboardView(new WorkspaceLeaf(), DEFAULT_PLUGIN_SETTINGS, undefined, undefined, store, repo);
    view.file = Object.assign(new TFile(), { path });
    return view;
  }

  beforeEach(() => { vi.clearAllMocks(); });

  it('acquires the shared document and seeds the engine from canonical strokes', async () => {
    const store = new DocumentStore({ saveDelayMs: 0 });
    const repo = mkRepo(fileWith([strokeOf('a')]));
    const view = mountView(store, repo, 'D.blackboard');

    await view.onOpen();
    await tick();

    expect(repo.load).toHaveBeenCalledWith('D.blackboard');
    expect((view as any).handle).not.toBeNull();
  });

  it('reloads canonical strokes when a sibling commits, WITHOUT re-centring', async () => {
    const store = new DocumentStore({ saveDelayMs: 0 });
    const repo = mkRepo(fileWith([strokeOf('a')]));
    const view = mountView(store, repo, 'D.blackboard');
    await view.onOpen();
    await tick();
    const engine = (view as any).engine;
    engine.loadStrokes.mockClear();
    engine.centerInBox.mockClear();
    engine.refitToContent.mockClear();

    // A sibling surface (embed/canvas node) commits a new stroke.
    const sibling = await store.acquire('D.blackboard', repo);
    sibling.commit(fileWith([strokeOf('a'), strokeOf('b')]));

    expect(engine.loadStrokes).toHaveBeenCalled();        // reloaded the canonical strokes
    expect(engine.centerInBox).not.toHaveBeenCalled();    // view position preserved (no jump)
    expect(engine.refitToContent).not.toHaveBeenCalled(); // no re-fit on sibling reload
  });

  it('commits a finished stroke through the store so siblings refresh', async () => {
    const store = new DocumentStore({ saveDelayMs: 0 });
    const repo = mkRepo(fileWith([strokeOf('a')]));
    const view = mountView(store, repo, 'E.blackboard');
    await view.onOpen();
    await tick();
    const dc = (view as any).drawingContainer as HTMLElement;

    const sibling = await store.acquire('E.blackboard', repo);
    const onSibling = vi.fn();
    sibling.subscribe(onSibling);

    const down = new PointerEvent('pointerdown', { clientX: 5, clientY: 5, bubbles: true, cancelable: true });
    Object.defineProperty(down, 'target', { value: dc, writable: false });
    document.dispatchEvent(down);
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 5, clientY: 5, bubbles: true }));

    expect(onSibling).toHaveBeenCalled();
  });

  it('releases the shared document on close and nulls the handle', async () => {
    const store = new DocumentStore({ saveDelayMs: 0 });
    const repo = mkRepo(fileWith([strokeOf('a')]));
    const view = mountView(store, repo, 'F.blackboard');
    await view.onOpen();
    await tick();
    const handle = (view as any).handle;
    const releaseSpy = vi.spyOn(handle, 'release');

    await view.onClose();

    expect(releaseSpy).toHaveBeenCalled();
    expect((view as any).handle).toBeNull();
  });

  it('does NOT write through Obsidian on close when the store is active (single writer)', async () => {
    const store = new DocumentStore({ saveDelayMs: 0 });
    const repo = mkRepo(fileWith([strokeOf('a')]));
    const view = mountView(store, repo, 'G.blackboard');
    await view.onOpen();
    await tick();
    const modify = vi.fn().mockResolvedValue(undefined);
    (view as any).app = { vault: { modify } };

    await view.onClose();

    expect(modify).not.toHaveBeenCalled();
  });
});
