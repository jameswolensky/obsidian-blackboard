import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Stroke } from '../src/domain/entities';
import { findStrokesAtPoint, eraseAtPoint } from '../src/application/eraser-service';
import { StrokeManager } from '../src/domain/stroke-manager';

function makeStroke(id: string, points: [number, number, number][]): Stroke {
  return {
    id,
    tool: 'pen',
    color: '#ffffff',
    size: 2,
    opacity: 1,
    points,
    hasPressure: false,
    timestamp: Date.now(),
  };
}

describe('findStrokesAtPoint', () => {
  it('returns empty array for no strokes', () => {
    const result = findStrokesAtPoint([], 0, 0, 10);
    expect(result).toEqual([]);
  });

  it('detects hit on a vertex', () => {
    const strokes = [makeStroke('s1', [[100, 100, 0.5]])];
    const result = findStrokesAtPoint(strokes, 105, 100, 10);
    expect(result).toEqual(['s1']);
  });

  it('misses when point is far from stroke', () => {
    const strokes = [makeStroke('s1', [[100, 100, 0.5]])];
    const result = findStrokesAtPoint(strokes, 200, 200, 10);
    expect(result).toEqual([]);
  });

  it('detects hit on a segment between vertices', () => {
    const strokes = [makeStroke('s1', [[0, 0, 0.5], [100, 0, 0.5]])];
    // Point at (50, 3) is 3 units from the segment, within eraserSize 10
    const result = findStrokesAtPoint(strokes, 50, 3, 10);
    expect(result).toEqual(['s1']);
  });

  it('returns multiple hit stroke ids', () => {
    const strokes = [
      makeStroke('s1', [[10, 10, 0.5]]),
      makeStroke('s2', [[12, 10, 0.5]]),
      makeStroke('s3', [[500, 500, 0.5]]),
    ];
    const result = findStrokesAtPoint(strokes, 11, 10, 5);
    expect(result).toContain('s1');
    expect(result).toContain('s2');
    expect(result).not.toContain('s3');
  });

  it('handles single-point strokes', () => {
    const strokes = [makeStroke('s1', [[50, 50, 0.5]])];
    const result = findStrokesAtPoint(strokes, 50, 50, 5);
    expect(result).toEqual(['s1']);
  });

  it('misses single-point stroke when outside radius', () => {
    const strokes = [makeStroke('s1', [[50, 50, 0.5]])];
    const result = findStrokesAtPoint(strokes, 70, 70, 5);
    expect(result).toEqual([]);
  });
});

describe('eraseAtPoint', () => {
  let strokeManager: StrokeManager;

  beforeEach(() => {
    strokeManager = new StrokeManager();
  });

  it('deletes strokes at the point and returns true', () => {
    strokeManager.addStroke(makeStroke('s1', [[10, 10, 0.5]]));

    const result = eraseAtPoint(strokeManager, 10, 10, 20);

    expect(result).toBe(true);
    expect(strokeManager.strokes.length).toBe(0);
  });

  it('returns false when no strokes are hit', () => {
    strokeManager.addStroke(makeStroke('s1', [[10, 10, 0.5]]));

    const result = eraseAtPoint(strokeManager, 500, 500, 20);

    expect(result).toBe(false);
    expect(strokeManager.strokes.length).toBe(1);
  });

  it('enforces minimum eraser size of 15', () => {
    // Place a stroke at (10, 10). With eraserSize=1, it would be clamped to 15.
    // A point at (24, 10) is 14 units away - within 15 but outside 1.
    strokeManager.addStroke(makeStroke('s1', [[10, 10, 0.5]]));

    const result = eraseAtPoint(strokeManager, 24, 10, 1);

    expect(result).toBe(true);
    expect(strokeManager.strokes.length).toBe(0);
  });

  it('uses provided size when larger than 15', () => {
    strokeManager.addStroke(makeStroke('s1', [[10, 10, 0.5]]));

    // Point at (40, 10) is 30 units away - within 50 but outside 15
    const result = eraseAtPoint(strokeManager, 40, 10, 50);

    expect(result).toBe(true);
  });

  it('deletes multiple strokes in one erase', () => {
    strokeManager.addStroke(makeStroke('s1', [[10, 10, 0.5]]));
    strokeManager.addStroke(makeStroke('s2', [[12, 10, 0.5]]));

    const result = eraseAtPoint(strokeManager, 11, 10, 20);

    expect(result).toBe(true);
    expect(strokeManager.strokes.length).toBe(0);
  });
});

describe('findStrokesAtPoint — additional', () => {
  it('direct vertex hit returns stroke id', () => {
    const strokes = [makeStroke('s1', [[50, 50, 0.5], [60, 60, 0.5]])];
    const result = findStrokesAtPoint(strokes, 50, 50, 10);

    expect(result).toEqual(['s1']);
  });

  it('miss far away returns empty', () => {
    const strokes = [makeStroke('s1', [[10, 10, 0.5], [20, 20, 0.5]])];
    const result = findStrokesAtPoint(strokes, 510, 510, 10);

    expect(result).toEqual([]);
  });

  it('multiple overlapping strokes all returned', () => {
    const strokes = [
      makeStroke('s1', [[50, 50, 0.5], [55, 55, 0.5]]),
      makeStroke('s2', [[50, 50, 0.5], [55, 55, 0.5]]),
      makeStroke('s3', [[50, 50, 0.5], [55, 55, 0.5]]),
    ];
    const result = findStrokesAtPoint(strokes, 50, 50, 10);

    expect(result).toHaveLength(3);
  });

  it('segment detection works for midpoint between vertices', () => {
    const strokes = [makeStroke('s1', [[0, 0, 0.5], [200, 0, 0.5]])];
    const result = findStrokesAtPoint(strokes, 100, 2, 10);

    expect(result).toEqual(['s1']);
  });
});

describe('eraseAtPoint — minimum size', () => {
  it('minimum eraser size 15px enforced', () => {
    const strokeManager = new StrokeManager();
    strokeManager.addStroke(makeStroke('s1', [[10, 10, 0.5], [20, 10, 0.5]]));

    const result = eraseAtPoint(strokeManager, 24, 10, 1);

    expect(strokeManager.strokes.length).toBe(0);
  });
});
