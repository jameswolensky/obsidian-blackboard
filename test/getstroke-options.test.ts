import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('obsidian', () => ({
  setIcon: vi.fn(),
  Plugin: class {},
  TextFileView: class { contentEl = document.createElement('div'); },
  WorkspaceLeaf: class {},
}));

vi.mock('perfect-freehand', () => ({
  getStroke: vi.fn(() => [[0, 0], [1, 1], [2, 2], [3, 3]]),
}));

function makeMockContext(): any {
  return {
    save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), clearRect: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(),
    closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(), scale: vi.fn(), translate: vi.fn(),
    globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '', globalAlpha: 1,
  };
}

beforeAll(() => {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type === '2d') return makeMockContext();
    return origGetContext.call(this, type as any);
  } as any;
});

import { getStroke } from 'perfect-freehand';
import { DrawingEngine } from '../src/infrastructure/canvas-renderer';
import { exportSvg } from '../src/application/export-service';
import type { Stroke, Background } from '../src/domain/entities';

const mockGetStroke = getStroke as unknown as ReturnType<typeof vi.fn>;

function makeStroke(): Stroke {
  return {
    id: 's1', tool: 'pen', color: '#fff', size: 4, opacity: 1,
    points: [[0, 0, 0.5], [10, 10, 0.5], [20, 5, 0.5]], hasPressure: true, timestamp: 1,
  };
}

function makeBackground(): Background {
  return { type: 'blank', color: 'transparent', grid: false, gridSize: 20 };
}

describe('getStroke options no longer carry smoothing/streamline', () => {
  beforeEach(() => {
    mockGetStroke.mockClear();
  });

  it('committed stroke render passes thinning but neither smoothing nor streamline', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const engine = new DrawingEngine(container);
    engine.loadStrokes([makeStroke()]);
    engine.staticDirty = true;
    engine.render();

    expect(mockGetStroke).toHaveBeenCalled();
    const opts = mockGetStroke.mock.calls[mockGetStroke.mock.calls.length - 1][1];
    expect(opts.thinning).toBe(0.5);
    expect('smoothing' in opts).toBe(false);
    expect('streamline' in opts).toBe(false);

    engine.destroy();
    document.body.removeChild(container);
  });

  it('SVG export passes thinning but neither smoothing nor streamline', () => {
    exportSvg([makeStroke()], makeBackground());

    expect(mockGetStroke).toHaveBeenCalled();
    const opts = mockGetStroke.mock.calls[0][1];
    expect(opts.thinning).toBe(0.5);
    expect('smoothing' in opts).toBe(false);
    expect('streamline' in opts).toBe(false);
  });
});
