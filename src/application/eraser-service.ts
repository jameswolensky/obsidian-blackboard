import type { Stroke } from '../domain/entities';
import { distToSegment } from '../domain/geometry';
import { StrokeManager } from '../domain/stroke-manager';

export function findStrokesAtPoint(
  strokes: Stroke[],
  worldX: number,
  worldY: number,
  eraserSize: number,
): string[] {
  const toDelete: string[] = [];
  for (const stroke of strokes) {
    let hit = false;
    for (let pi = 0; pi < stroke.points.length; pi++) {
      const sp = stroke.points[pi];
      const dx = sp[0] - worldX;
      const dy = sp[1] - worldY;
      if (dx * dx + dy * dy < eraserSize * eraserSize) { hit = true; break; }
      if (pi > 0) {
        const prev = stroke.points[pi - 1];
        if (distToSegment(worldX, worldY, prev[0], prev[1], sp[0], sp[1]) < eraserSize) { hit = true; break; }
      }
    }
    if (hit) toDelete.push(stroke.id);
  }
  return toDelete;
}

export function eraseAtPoint(
  strokeManager: StrokeManager,
  worldX: number,
  worldY: number,
  eraserSize: number,
): boolean {
  const effectiveSize = Math.max(eraserSize, 15);
  const toDelete = findStrokesAtPoint(strokeManager.strokes, worldX, worldY, effectiveSize);
  for (const id of toDelete) strokeManager.deleteStroke(id);
  return toDelete.length > 0;
}
