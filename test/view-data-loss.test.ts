// Regression: a Canvas .blackboard node is rendered by Obsidian's embedded BlackboardView
// (a TextFileView). When Obsidian tears down / reuses / suspends the view it can call
// clear() — which empties the engine — and then getViewData() to persist. If getViewData()
// rebuilds from the now-empty engine it returns an EMPTY serialization, and Obsidian writes
// that over a drawing that still has strokes. On iPad this is the "lock the screen, come
// back, some canvas drawings are completely blank" data-loss bug.
//
// Uses the REAL serialize/deserialize and a faithful engine whose reset() actually clears
// strokes (unlike the shared harness, whose reset is a no-op).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceLeaf } from 'obsidian';
import { DEFAULT_PLUGIN_SETTINGS, type Stroke } from '../src/domain/entities';

vi.mock('../src/infrastructure/canvas-renderer', () => {
  class FaithfulEngine {
    strokeManager = {
      strokes: [] as Stroke[],
      reset: vi.fn(function (this: any) { this.strokes.length = 0; }),
      undo: vi.fn(), redo: vi.fn(), deleteStroke: vi.fn(),
    };
    toolManager: any = { setTool: vi.fn(), setColor: vi.fn(), setSize: vi.fn(), setDefaults: vi.fn(), activeTool: 'pen', activeSize: 2, activeColor: '#fff', activeOpacity: 1 };
    drawingWidth = 800; drawingHeight = 600; staticDirty = false;
    render = vi.fn(); requestRender = vi.fn(); destroy = vi.fn();
    getContentBounds = vi.fn(() => {
      const s = this.strokeManager.strokes;
      return s.length ? { x: 0, y: 0, width: 100, height: 80 } : { x: 0, y: 0, width: 0, height: 0 };
    });
    setCanvasSize = vi.fn(); centerInBox = vi.fn(); resizeBox = vi.fn(); setDisplaySize = vi.fn();
    refitToContent = vi.fn(); fitReferenceSize = vi.fn(); panBy = vi.fn(); zoomAt = vi.fn(); setView = vi.fn();
    getViewTransform = vi.fn(() => ({ scale: 1, offsetX: 0, offsetY: 0 }));
    screenToDrawing = vi.fn((x: number, y: number) => [x, y] as [number, number]);
    beginStroke = vi.fn(); addPoint = vi.fn(); endStroke = vi.fn();
    loadStrokes = vi.fn(function (this: any, strokes: Stroke[]) {
      this.strokeManager.reset();
      for (const s of strokes) this.strokeManager.strokes.push(JSON.parse(JSON.stringify(s)));
    });
    constructor(_c?: HTMLElement, w?: number, h?: number, tm?: any) { if (w) this.drawingWidth = w; if (h) this.drawingHeight = h; if (tm) this.toolManager = tm; }
  }
  return { DrawingEngine: FaithfulEngine };
});

import { BlackboardView } from '../src/presentation/blackboard-view';
import { serialize, deserialize } from '../src/application/file-format';

function stroke(id: string): Stroke {
  return { id, tool: 'pen', color: '#fff', size: 2, opacity: 1, points: [[1, 1, 0.5], [2, 2, 0.5]], hasPressure: false, timestamp: 0 } as Stroke;
}

function fileWith(strokes: Stroke[]): string {
  return serialize({ version: 3, width: 100, height: 80, strokes, background: { color: 'transparent' } });
}

describe('BlackboardView — data loss on clear()+getViewData()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getViewData() after clear() must not overwrite a drawing with an empty file', async () => {
    const view = new BlackboardView(new WorkspaceLeaf(), DEFAULT_PLUGIN_SETTINGS);
    await view.onOpen();

    // Obsidian loads the file's real strokes into the view.
    view.setViewData(fileWith([stroke('a'), stroke('b')]), true);
    expect(deserialize(view.getViewData()).file.strokes).toHaveLength(2);

    // Obsidian empties the view during teardown/reuse/suspend...
    view.clear();

    // ...then asks for the data to persist. This MUST NOT be an empty drawing, or Obsidian
    // writes a blank file over the two-stroke drawing (the iPad lock-screen data loss).
    const persisted = deserialize(view.getViewData());
    expect(persisted.file.strokes).toHaveLength(2);
  });
});
