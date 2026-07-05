import { describe, it, expect } from 'vitest';
import { distToSegment, fitContentToBox, screenToContent, naturalContentSize, centerContentInBox } from '../src/domain/geometry';

describe('distToSegment', () => {
  it('returns zero when point is on segment start', () => {
    const result = distToSegment(0, 0, 0, 0, 10, 0);

    expect(result).toBeCloseTo(0, 5);
  });

  it('returns zero when point is on segment end', () => {
    const result = distToSegment(10, 0, 0, 0, 10, 0);

    expect(result).toBeCloseTo(0, 5);
  });

  it('returns zero when point is on segment midpoint', () => {
    const result = distToSegment(5, 0, 0, 0, 10, 0);

    expect(result).toBeCloseTo(0, 5);
  });

  it('returns perpendicular distance to horizontal segment', () => {
    const result = distToSegment(5, 3, 0, 0, 10, 0);

    expect(result).toBeCloseTo(3, 5);
  });

  it('returns perpendicular distance to vertical segment', () => {
    const result = distToSegment(4, 5, 0, 0, 0, 10);

    expect(result).toBeCloseTo(4, 5);
  });

  it('returns perpendicular distance to diagonal segment', () => {
    const result = distToSegment(1, -1, 0, 0, 2, 2);

    expect(result).toBeCloseTo(Math.sqrt(2), 4);
  });

  it('clamps to start endpoint when point is before segment', () => {
    const result = distToSegment(-5, 0, 0, 0, 10, 0);

    expect(result).toBeCloseTo(5, 5);
  });

  it('clamps to end endpoint when point is past segment', () => {
    const result = distToSegment(15, 0, 0, 0, 10, 0);

    expect(result).toBeCloseTo(5, 5);
  });

  it('returns point distance for zero-length segment', () => {
    const result = distToSegment(3, 4, 0, 0, 0, 0);

    expect(result).toBeCloseTo(5, 5);
  });

  it('handles negative coordinates', () => {
    const result = distToSegment(-5, -3, -10, 0, 0, 0);

    expect(result).toBeCloseTo(3, 5);
  });
});

describe('fitContentToBox', () => {
  it('returns identity for null content', () => {
    expect(fitContentToBox({ width: 200, height: 100 }, null)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });

  it('returns identity for zero-area content', () => {
    expect(fitContentToBox({ width: 200, height: 100 }, { x: 0, y: 0, width: 0, height: 0 }))
      .toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });

  it('scales content to fit and centres letterbox on the wide axis', () => {
    const t = fitContentToBox({ width: 300, height: 100 }, { x: 0, y: 0, width: 100, height: 100 });
    expect(t.scale).toBe(1);
    expect(t.offsetX).toBe(100);
    expect(t.offsetY).toBe(0);
  });

  it('scales down when content is larger than the box', () => {
    const t = fitContentToBox({ width: 100, height: 100 }, { x: 0, y: 0, width: 200, height: 200 });
    expect(t.scale).toBe(0.5);
    expect(t.offsetX).toBe(0);
    expect(t.offsetY).toBe(0);
  });

  it('accounts for the content origin (x/y) in the offset', () => {
    const t = fitContentToBox({ width: 100, height: 100 }, { x: 50, y: 50, width: 100, height: 100 });
    expect(t.scale).toBe(1);
    expect(t.offsetX).toBe(-50);
    expect(t.offsetY).toBe(-50);
  });

  it('applies padding around the content when fitting', () => {
    // 100x100 content + padding 10 => padded 120x120 into a 120x120 box => scale 1, no offset.
    const t = fitContentToBox({ width: 120, height: 120 }, { x: 0, y: 0, width: 100, height: 100 }, 10);
    expect(t.scale).toBe(1);
    expect(t.offsetX).toBe(10);
    expect(t.offsetY).toBe(10);
  });

  it('returns identity for a degenerate (zero-size) box', () => {
    expect(fitContentToBox({ width: 0, height: 0 }, { x: 0, y: 0, width: 100, height: 100 }))
      .toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });

  // markdown-embed-frame: an optional maxScale cap prevents upscaling past natural size and
  // letterboxes/centers the content when the cap binds (a Markdown embed never zooms ink up).
  it('caps the scale at maxScale and letterbox-centers instead of enlarging', () => {
    // 100x100 content into a 300x300 box would normally scale 3x to fill; maxScale 1 caps it.
    const t = fitContentToBox({ width: 300, height: 300 }, { x: 0, y: 0, width: 100, height: 100 }, 0, 1);
    expect(t.scale).toBe(1);
    // Centered: (300 - 100*1)/2 = 100 on each axis.
    expect(t.offsetX).toBe(100);
    expect(t.offsetY).toBe(100);
  });

  it('maxScale does not affect shrinking (cap does not bind when content is larger)', () => {
    const t = fitContentToBox({ width: 100, height: 100 }, { x: 0, y: 0, width: 200, height: 200 }, 0, 1);
    expect(t.scale).toBe(0.5);
    expect(t.offsetX).toBe(0);
    expect(t.offsetY).toBe(0);
  });

  it('omitting maxScale preserves the existing unbounded (upscaling) behavior', () => {
    const t = fitContentToBox({ width: 300, height: 300 }, { x: 0, y: 0, width: 100, height: 100 });
    expect(t.scale).toBe(3);
  });
});

describe('screenToContent', () => {
  it('inverts the transform (round-trip)', () => {
    const t = { scale: 0.5, offsetX: 100, offsetY: 20 };
    expect(screenToContent(120, 50, t)).toEqual({ x: 40, y: 60 });
  });
});

describe('centerContentInBox', () => {
  it('centers content bounds in the box at scale 1', () => {
    // 100x100 content at origin, in a 400x300 box -> centered, no zoom
    const t = centerContentInBox({ width: 400, height: 300 }, { x: 0, y: 0, width: 100, height: 100 });
    expect(t.scale).toBe(1);
    // content center (50,50) maps to box center (200,150): 50 + offset = 200 -> offset 150 / 100
    expect(t.offsetX).toBe(150);
    expect(t.offsetY).toBe(100);
  });

  it('places the drawing-space origin at the box center for empty content', () => {
    expect(centerContentInBox({ width: 800, height: 600 }, null)).toEqual({ scale: 1, offsetX: 400, offsetY: 300 });
    expect(centerContentInBox({ width: 800, height: 600 }, { x: 0, y: 0, width: 0, height: 0 }))
      .toEqual({ scale: 1, offsetX: 400, offsetY: 300 });
  });

  it('round-trips through screenToContent (a pointer at box center maps to content center)', () => {
    const content = { x: 20, y: 40, width: 200, height: 100 };
    const t = centerContentInBox({ width: 600, height: 400 }, content);
    const world = screenToContent(300, 200, t); // box center
    expect(world.x).toBeCloseTo(120); // content center x = 20 + 100
    expect(world.y).toBeCloseTo(90);  // content center y = 40 + 50
  });

  it('returns identity for a degenerate box', () => {
    expect(centerContentInBox({ width: 0, height: 0 }, null)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });
});

describe('naturalContentSize', () => {
  it('returns content size for non-empty bounds', () => {
    expect(naturalContentSize({ x: 5, y: 5, width: 120, height: 80 })).toEqual({ width: 120, height: 80 });
  });
  it('clamps to a minimum for tiny/empty content', () => {
    expect(naturalContentSize({ x: 0, y: 0, width: 0, height: 0 })).toEqual({ width: 400, height: 300 });
  });
});
