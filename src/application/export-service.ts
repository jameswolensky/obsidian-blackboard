import { getStroke } from 'perfect-freehand';
import type { Stroke, Background } from '../domain/entities';

export function getSvgPathFromStroke(points: number[][]): string {
  if (points.length < 2) return '';

  const first = points[0];
  let d = `M${first[0].toFixed(2)},${first[1].toFixed(2)}`;

  for (let i = 1; i < points.length - 1; i++) {
    const cp = points[i];
    const next = points[i + 1];
    const midX = (cp[0] + next[0]) / 2;
    const midY = (cp[1] + next[1]) / 2;
    d += ` Q${cp[0].toFixed(2)},${cp[1].toFixed(2)} ${midX.toFixed(2)},${midY.toFixed(2)}`;
  }

  const last = points[points.length - 1];
  d += ` Q${last[0].toFixed(2)},${last[1].toFixed(2)} ${first[0].toFixed(2)},${first[1].toFixed(2)}Z`;

  return d;
}

export function getStrokeBounds(strokes: Stroke[]): { x: number; y: number; width: number; height: number } {
  if (strokes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    for (const point of stroke.points) {
      if (point[0] < minX) minX = point[0];
      if (point[1] < minY) minY = point[1];
      if (point[0] > maxX) maxX = point[0];
      if (point[1] > maxY) maxY = point[1];
    }
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function exportSvg(strokes: Stroke[], background: Background): string {
  const bounds = getStrokeBounds(strokes);
  const padding = 20;
  const vx = bounds.x - padding;
  const vy = bounds.y - padding;
  const vw = bounds.width + padding * 2;
  const vh = bounds.height + padding * 2;

  let defs = '';
  let gridRect = '';

  if (background.grid) {
    const gs = background.gridSize;
    defs = `<defs><pattern id="grid" width="${gs}" height="${gs}" patternUnits="userSpaceOnUse"><path d="M ${gs} 0 L 0 0 0 ${gs}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/></pattern></defs>`;
    gridRect = `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="url(#grid)"/>`;
  }

  const paths = strokes.map((stroke) => {
    const outlinePoints = getStroke(stroke.points, {
      size: stroke.size,
      thinning: 0.5,
      simulatePressure: !stroke.hasPressure,
    });
    const d = getSvgPathFromStroke(outlinePoints);
    return `<path d="${d}" fill="${stroke.color}" opacity="${stroke.opacity}"/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}">${defs}${gridRect}${paths.join('')}</svg>`;
}
