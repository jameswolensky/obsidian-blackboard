import { describe, it, expect } from 'vitest';
import { getSvgPathFromStroke, getStrokeBounds, exportSvg } from '../src/application/export-service';
import type { Stroke, Point, Background } from '../src/domain/entities';

function makeStroke(points: Point[], color = '#ffffff', tool: 'pen' | 'highlighter' = 'pen'): Stroke {
  return {
    id: `stroke-${Date.now()}`,
    tool,
    color,
    size: 2,
    opacity: 1,
    points,
    hasPressure: true,
    timestamp: Date.now(),
  };
}

function makeBackground(overrides: Partial<Background> = {}): Background {
  return {
    type: 'blank',
    color: '#1a1a2e',
    grid: false,
    gridSize: 20,
    ...overrides,
  };
}

describe('getSvgPathFromStroke', () => {
  it('returns empty string for less than 2 points', () => {
    const result = getSvgPathFromStroke([[0, 0]]);

    expect(result).toBe('');
  });

  it('returns string starting with M', () => {
    const points = [[0, 0], [10, 10], [20, 20], [30, 30]];
    const result = getSvgPathFromStroke(points);

    expect(result.startsWith('M')).toBe(true);
  });

  it('returns string ending with Z', () => {
    const points = [[0, 0], [10, 10], [20, 20], [30, 30]];
    const result = getSvgPathFromStroke(points);

    expect(result.endsWith('Z')).toBe(true);
  });
});

describe('getStrokeBounds', () => {
  it('returns zero dimensions for empty array', () => {
    const result = getStrokeBounds([]);

    expect(result).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('calculates min x from stroke points', () => {
    const stroke = makeStroke([[5, 10, 0.5], [15, 20, 0.5], [25, 30, 0.5]]);
    const result = getStrokeBounds([stroke]);

    expect(result.x).toBe(5);
  });

  it('calculates max x from stroke points', () => {
    const stroke = makeStroke([[5, 10, 0.5], [15, 20, 0.5], [25, 30, 0.5]]);
    const result = getStrokeBounds([stroke]);

    expect(result.x + result.width).toBe(25);
  });

  it('calculates width from point spread', () => {
    const stroke = makeStroke([[10, 0, 0.5], [30, 0, 0.5]]);
    const result = getStrokeBounds([stroke]);

    expect(result.width).toBe(20);
  });

  it('calculates height from point spread', () => {
    const stroke = makeStroke([[0, 10, 0.5], [0, 50, 0.5]]);
    const result = getStrokeBounds([stroke]);

    expect(result.height).toBe(40);
  });
});

describe('exportSvg', () => {
  const samplePoints: Point[] = [[10, 10, 0.5], [20, 20, 0.5], [30, 30, 0.5]];

  it('returns string containing svg tag', () => {
    const result = exportSvg([makeStroke(samplePoints)], makeBackground());

    expect(result).toContain('<svg');
  });

  it('returns string containing xmlns attribute', () => {
    const result = exportSvg([makeStroke(samplePoints)], makeBackground());

    expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('contains viewBox attribute', () => {
    const result = exportSvg([makeStroke(samplePoints)], makeBackground());

    expect(result).toContain('viewBox=');
  });

  it('contains path element for each stroke', () => {
    const strokes = [
      makeStroke(samplePoints, '#ff0000'),
      makeStroke(samplePoints, '#00ff00'),
    ];
    const result = exportSvg(strokes, makeBackground());

    expect((result.match(/<path /g) || []).length).toBe(2);
  });

  it('contains fill attribute matching stroke color', () => {
    const result = exportSvg([makeStroke(samplePoints, '#ff0000')], makeBackground());

    expect(result).toContain('fill="#ff0000"');
  });

  it('has transparent background (no background rect)', () => {
    const result = exportSvg([makeStroke(samplePoints)], makeBackground());

    expect(result).not.toMatch(/<rect[^>]*fill="[^"]*"[^>]*>/);
  });

  it('contains grid pattern when grid enabled', () => {
    const bg = makeBackground({ grid: true });
    const result = exportSvg([makeStroke(samplePoints)], bg);

    expect(result).toContain('<pattern');
  });

  it('does not contain grid when grid disabled', () => {
    const bg = makeBackground({ grid: false });
    const result = exportSvg([makeStroke(samplePoints)], bg);

    expect(result).not.toContain('<pattern');
  });

  it('exportSvg with empty strokes array produces string containing svg tag', () => {
    const result = exportSvg([], makeBackground());

    expect(result).toContain('<svg');
  });

  it('exportSvg highlighter stroke has opacity attribute matching 0.3', () => {
    const stroke = makeStroke(samplePoints, '#ffff00', 'highlighter');
    stroke.opacity = 0.3;

    const result = exportSvg([stroke], makeBackground());

    expect(result).toContain('opacity="0.3"');
  });
});
