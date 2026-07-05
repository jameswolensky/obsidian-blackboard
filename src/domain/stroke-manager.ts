import type { Stroke } from './entities';

export interface Command {
  execute(): void;
  undo(): void;
}

export class StrokeManager {
  strokes: Stroke[] = [];
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  addStroke(stroke: Stroke): void {
    this.strokes.push(stroke);
    this.undoStack.push({
      execute: () => { this.strokes.push(stroke); },
      undo: () => { const i = this.strokes.findIndex(s => s.id === stroke.id); if (i !== -1) this.strokes.splice(i, 1); },
    });
    this.redoStack.length = 0;
  }

  deleteStroke(id: string): void {
    const index = this.strokes.findIndex(s => s.id === id);
    if (index === -1) return;
    const deleted = this.strokes.splice(index, 1)[0];
    this.undoStack.push({
      execute: () => { const i = this.strokes.findIndex(s => s.id === deleted.id); if (i !== -1) this.strokes.splice(i, 1); },
      undo: () => { this.strokes.splice(index, 0, deleted); },
    });
    this.redoStack.length = 0;
  }

  moveStroke(id: string, dx: number, dy: number): void {
    const stroke = this.strokes.find(s => s.id === id);
    if (!stroke) return;
    for (const point of stroke.points) {
      point[0] += dx;
      point[1] += dy;
    }
    this.undoStack.push({
      execute: () => {
        const s = this.strokes.find(x => x.id === id);
        if (s) for (const p of s.points) { p[0] += dx; p[1] += dy; }
      },
      undo: () => {
        const s = this.strokes.find(x => x.id === id);
        if (s) for (const p of s.points) { p[0] -= dx; p[1] -= dy; }
      },
    });
    this.redoStack.length = 0;
  }

  clearAll(): void {
    const saved = [...this.strokes];
    this.strokes.length = 0;
    this.undoStack.push({
      execute: () => { this.strokes.length = 0; },
      undo: () => { this.strokes.push(...saved); },
    });
    this.redoStack.length = 0;
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.execute();
    this.undoStack.push(cmd);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  reset(): void {
    this.strokes.length = 0;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
