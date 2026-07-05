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
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
  };
}

beforeAll(() => {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type === '2d') return makeMockContext();
    return origGetContext.call(this, type as any);
  } as any;
});

import { DrawingEngine } from '../src/infrastructure/canvas-renderer';
import type { Stroke } from '../src/domain/entities';

function generateStrokes(count: number): Stroke[] {
  const strokes: Stroke[] = [];
  for (let i = 0; i < count; i++) {
    const points: [number, number, number][] = [];
    for (let j = 0; j < 20; j++) {
      points.push([Math.random() * 500, Math.random() * 500, 0.5]);
    }
    strokes.push({
      id: `stroke-${i}`,
      tool: i % 3 === 0 ? 'highlighter' : 'pen',
      color: '#ffffff',
      size: 4,
      opacity: 1,
      points,
      hasPressure: true,
      timestamp: Date.now(),
    });
  }
  return strokes;
}

describe('performance: multiple DrawingEngine instances', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mounts 100 engines with 10 strokes each under 500ms', () => {
    const engines: DrawingEngine[] = [];
    const strokes = generateStrokes(10);

    const start = performance.now();

    for (let i = 0; i < 100; i++) {
      const container = document.createElement('div');
      container.style.width = '400px';
      container.style.height = '300px';
      document.body.appendChild(container);
      const engine = new DrawingEngine(container);
      engine.loadStrokes(strokes);
      engine.staticDirty = true;
      engine.render();
      engines.push(engine);
    }

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);

    for (const engine of engines) engine.destroy();
    document.body.innerHTML = '';
  });

  it('mounts 100 engines with 50 strokes each under 2000ms', () => {
    const engines: DrawingEngine[] = [];
    const strokes = generateStrokes(50);

    const start = performance.now();

    for (let i = 0; i < 100; i++) {
      const container = document.createElement('div');
      container.style.width = '400px';
      container.style.height = '300px';
      document.body.appendChild(container);
      const engine = new DrawingEngine(container);
      engine.loadStrokes(strokes);
      engine.staticDirty = true;
      engine.render();
      engines.push(engine);
    }

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(2000);

    for (const engine of engines) engine.destroy();
    document.body.innerHTML = '';
  });

  it('single stroke input latency under 5ms per point', () => {
    const container = document.createElement('div');
    container.style.width = '400px';
    container.style.height = '300px';
    document.body.appendChild(container);
    const engine = new DrawingEngine(container);
    engine.loadStrokes(generateStrokes(50));
    engine.staticDirty = true;
    engine.render();

    engine.beginStroke('pen');

    const iterations = 100;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      engine.addPoint([i * 2, i * 2, 0.5]);
    }
    const elapsed = performance.now() - start;
    const perPoint = elapsed / iterations;

    expect(perPoint).toBeLessThan(5);

    engine.endStroke();
    engine.destroy();
    document.body.removeChild(container);
  });

  it('concurrent render of 50 engines completes under 1000ms', () => {
    const engines: DrawingEngine[] = [];
    const strokes = generateStrokes(20);

    for (let i = 0; i < 50; i++) {
      const container = document.createElement('div');
      container.style.width = '400px';
      container.style.height = '300px';
      document.body.appendChild(container);
      const engine = new DrawingEngine(container);
      engine.loadStrokes(strokes);
      engines.push(engine);
    }

    const start = performance.now();
    for (const engine of engines) {
      engine.staticDirty = true;
      engine.render();
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);

    for (const engine of engines) engine.destroy();
    document.body.innerHTML = '';
  });

  it('1000-word handwriting equivalent: 5000 strokes, 150k points — load + render', () => {
    const strokes = generateStrokes(5000);
    for (const s of strokes) {
      const pts: [number, number, number][] = [];
      const baseX = Math.random() * 2000;
      const baseY = Math.random() * 5000;
      for (let j = 0; j < 30; j++) {
        pts.push([baseX + j * 3 + Math.random() * 2, baseY + Math.random() * 10, 0.3 + Math.random() * 0.4]);
      }
      s.points = pts;
    }

    const container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
    const engine = new DrawingEngine(container);

    const loadStart = performance.now();
    engine.loadStrokes(strokes);
    const loadTime = performance.now() - loadStart;

    const renderStart = performance.now();
    engine.staticDirty = true;
    engine.render();
    const renderTime = performance.now() - renderStart;

    const totalTime = loadTime + renderTime;

    console.log(`[1000-word handwriting] Strokes: ${strokes.length}, Points: ${strokes.reduce((a, s) => a + s.points.length, 0)}`);
    console.log(`[1000-word handwriting] Load: ${loadTime.toFixed(1)}ms, Render: ${renderTime.toFixed(1)}ms, Total: ${totalTime.toFixed(1)}ms`);

    expect(totalTime).toBeLessThan(3000);

    engine.destroy();
    document.body.removeChild(container);
  });

  it('1000-word handwriting: input latency while drawing on busy canvas', () => {
    const strokes = generateStrokes(5000);
    for (const s of strokes) {
      const pts: [number, number, number][] = [];
      const baseX = Math.random() * 2000;
      const baseY = Math.random() * 5000;
      for (let j = 0; j < 30; j++) {
        pts.push([baseX + j * 3, baseY + Math.random() * 10, 0.5]);
      }
      s.points = pts;
    }

    const container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
    const engine = new DrawingEngine(container);
    engine.loadStrokes(strokes);
    engine.staticDirty = true;
    engine.render();

    engine.beginStroke('pen');
    const iterations = 200;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      engine.addPoint([100 + i * 2, 100 + Math.sin(i * 0.1) * 20, 0.5]);
    }
    engine.endStroke();
    const elapsed = performance.now() - start;
    const perPoint = elapsed / iterations;

    console.log(`[1000-word input latency] ${iterations} points on 5000-stroke canvas: ${elapsed.toFixed(1)}ms total, ${perPoint.toFixed(3)}ms/point`);

    expect(perPoint).toBeLessThan(5);

    engine.destroy();
    document.body.removeChild(container);
  });

  it('1000-word handwriting: re-render after adding one stroke to busy canvas', () => {
    const strokes = generateStrokes(5000);
    for (const s of strokes) {
      const pts: [number, number, number][] = [];
      for (let j = 0; j < 30; j++) {
        pts.push([Math.random() * 2000, Math.random() * 5000, 0.5]);
      }
      s.points = pts;
    }

    const container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
    const engine = new DrawingEngine(container);
    engine.loadStrokes(strokes);
    engine.staticDirty = true;
    engine.render();

    engine.beginStroke('pen');
    for (let i = 0; i < 30; i++) {
      engine.addPoint([i * 3, i * 3, 0.5]);
    }
    engine.endStroke();

    const rerenderStart = performance.now();
    engine.staticDirty = true;
    engine.render();
    const rerenderTime = performance.now() - rerenderStart;

    console.log(`[1000-word re-render] Full re-render of 5001 strokes: ${rerenderTime.toFixed(1)}ms`);

    expect(rerenderTime).toBeLessThan(2000);

    engine.destroy();
    document.body.removeChild(container);
  });
});
