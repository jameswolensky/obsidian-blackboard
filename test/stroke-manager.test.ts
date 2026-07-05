import { describe, it, expect } from 'vitest';
import { StrokeManager } from '../src/domain/stroke-manager';
import type { Stroke, Point } from '../src/domain/entities';

function makeStroke(id: string): Stroke {
  return {
    id,
    tool: 'pen',
    color: '#000000',
    size: 2,
    opacity: 1,
    points: [[10, 20, 0.5], [30, 40, 0.7]] as Point[],
    hasPressure: true,
    timestamp: Date.now(),
  };
}

describe('StrokeManager', () => {
  it('addStroke increases stroke count by one', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));

    expect(mgr.strokes.length).toBe(1);
  });

  it('addStroke places stroke at end of array', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.addStroke(makeStroke('s2'));

    expect(mgr.strokes[1].id).toBe('s2');
  });

  it('deleteStroke removes stroke by id', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.addStroke(makeStroke('s2'));
    mgr.deleteStroke('s1');

    expect(mgr.strokes.length).toBe(1);
  });

  it('deleteStroke does nothing for unknown id', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.deleteStroke('unknown');

    expect(mgr.strokes.length).toBe(1);
  });

  it('undo after addStroke removes the stroke', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.undo();

    expect(mgr.strokes.length).toBe(0);
  });

  it('undo after deleteStroke restores the stroke', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.deleteStroke('s1');
    mgr.undo();

    expect(mgr.strokes.some(s => s.id === 's1')).toBe(true);
  });

  it('undo after deleteStroke restores at original index', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.addStroke(makeStroke('s2'));
    mgr.addStroke(makeStroke('s3'));
    mgr.deleteStroke('s2');
    mgr.undo();

    expect(mgr.strokes[1].id).toBe('s2');
  });

  it('redo after undo re-adds the stroke', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.undo();
    mgr.redo();

    expect(mgr.strokes.length).toBe(1);
  });

  it('canUndo returns false when empty', () => {
    const mgr = new StrokeManager();

    expect(mgr.canUndo()).toBe(false);
  });

  it('canUndo returns true after addStroke', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));

    expect(mgr.canUndo()).toBe(true);
  });

  it('canRedo returns false when no undo performed', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));

    expect(mgr.canRedo()).toBe(false);
  });

  it('canRedo returns true after undo', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.undo();

    expect(mgr.canRedo()).toBe(true);
  });

  it('addStroke clears redo stack', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.undo();
    mgr.addStroke(makeStroke('s2'));

    expect(mgr.canRedo()).toBe(false);
  });

  it('clearAll removes all strokes', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.addStroke(makeStroke('s2'));
    mgr.clearAll();

    expect(mgr.strokes.length).toBe(0);
  });

  it('undo after clearAll restores all strokes', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.addStroke(makeStroke('s2'));
    mgr.clearAll();
    mgr.undo();

    expect(mgr.strokes.length).toBe(2);
  });

  it('moveStroke updates point x coordinates', () => {
    const mgr = new StrokeManager();
    const stroke = makeStroke('s1');
    mgr.addStroke(stroke);
    mgr.moveStroke('s1', 5, 0);

    expect(mgr.strokes[0].points[0][0]).toBe(15);
  });

  it('moveStroke updates point y coordinates', () => {
    const mgr = new StrokeManager();
    const stroke = makeStroke('s1');
    mgr.addStroke(stroke);
    mgr.moveStroke('s1', 0, 10);

    expect(mgr.strokes[0].points[0][1]).toBe(30);
  });

  it('undo after moveStroke reverses x delta', () => {
    const mgr = new StrokeManager();
    const stroke = makeStroke('s1');
    mgr.addStroke(stroke);
    mgr.moveStroke('s1', 5, 0);
    mgr.undo();

    expect(mgr.strokes[0].points[0][0]).toBe(10);
  });

  it('undo after moveStroke reverses y delta', () => {
    const mgr = new StrokeManager();
    const stroke = makeStroke('s1');
    mgr.addStroke(stroke);
    mgr.moveStroke('s1', 0, 10);
    mgr.undo();

    expect(mgr.strokes[0].points[0][1]).toBe(20);
  });

  it('undo stack has no limit', () => {
    const mgr = new StrokeManager();
    for (let i = 0; i < 200; i++) mgr.addStroke(makeStroke('s' + i));
    for (let i = 0; i < 200; i++) mgr.undo();

    expect(mgr.strokes).toHaveLength(0);
  });

  it('reset clears strokes', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.reset();

    expect(mgr.strokes.length).toBe(0);
  });

  it('reset clears undo stack', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.reset();

    expect(mgr.canUndo()).toBe(false);
  });

  it('undo on empty stack does not throw', () => {
    const mgr = new StrokeManager();
    expect(() => mgr.undo()).not.toThrow();
  });

  it('redo on empty stack does not throw', () => {
    const mgr = new StrokeManager();
    expect(() => mgr.redo()).not.toThrow();
  });

  it('add 3 strokes then undo 3 then redo 3 restores all 3 strokes', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.addStroke(makeStroke('s2'));
    mgr.addStroke(makeStroke('s3'));
    mgr.undo();
    mgr.undo();
    mgr.undo();
    mgr.redo();
    mgr.redo();
    mgr.redo();

    expect(mgr.strokes.length).toBe(3);
  });

  it('moveStroke with unknown id does not throw', () => {
    const mgr = new StrokeManager();
    expect(() => mgr.moveStroke('nonexistent', 5, 10)).not.toThrow();
  });

  it('redo after moveStroke re-applies the move delta', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.moveStroke('s1', 5, 10);
    mgr.undo();

    mgr.redo();

    expect(mgr.strokes[0].points[0][0]).toBe(15);
  });

  it('redo after deleteStroke re-deletes the stroke', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.deleteStroke('s1');
    mgr.undo();

    mgr.redo();

    expect(mgr.strokes.length).toBe(0);
  });

  it('redo after clearAll re-clears all strokes', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.addStroke(makeStroke('s2'));
    mgr.clearAll();
    mgr.undo();

    mgr.redo();

    expect(mgr.strokes.length).toBe(0);
  });

  it('undo 10 strokes sequentially leaves 0 strokes', () => {
    const mgr = new StrokeManager();
    for (let i = 0; i < 10; i++) mgr.addStroke(makeStroke('s' + i));
    for (let i = 0; i < 10; i++) mgr.undo();

    expect(mgr.strokes.length).toBe(0);
  });

  it('undo past empty does not crash and leaves 0 strokes', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.undo();
    mgr.undo();

    expect(mgr.strokes.length).toBe(0);
  });

  it('redo with nothing undone does not crash and leaves strokes unchanged', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('s1'));
    mgr.redo();

    expect(mgr.strokes.length).toBe(1);
  });

  it('new stroke after undo clears redo stack', () => {
    const mgr = new StrokeManager();
    mgr.addStroke(makeStroke('a'));
    mgr.undo();
    mgr.addStroke(makeStroke('b'));

    expect(mgr.canRedo()).toBe(false);
  });
});
