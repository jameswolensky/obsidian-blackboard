export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - ax) * (px - ax) + (py - ay) * (py - ay));
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
}

export interface Box { width: number; height: number; }
export interface Bounds { x: number; y: number; width: number; height: number; }
export interface ViewTransform { scale: number; offsetX: number; offsetY: number; }

/**
 * Letterbox transform mapping a content bounding box (drawing-space) into a display
 * box (CSS px): aspect-preserved, centred. `null`/zero-area content -> identity so a
 * fresh drawing maps 1 display px to 1 drawing unit. A content point (cx, cy) maps to
 * screen as (cx * scale + offsetX, cy * scale + offsetY).
 *
 * An optional `maxScale` cap (default unbounded) clamps the fitted scale to at most
 * `maxScale`; when the cap binds the content is centred/letterboxed in the box at the capped
 * scale (via the existing offset math) rather than enlarged to fill it. A Markdown embed
 * passes `maxScale = 1` so a small drawing is shown crisp at natural size, never upscaled.
 */
export function fitContentToBox(box: Box, content: Bounds | null, padding = 0, maxScale = Infinity): ViewTransform {
  if (box.width <= 0 || box.height <= 0 || !content || content.width <= 0 || content.height <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  const cw = content.width + padding * 2;
  const ch = content.height + padding * 2;
  const scale = Math.min(box.width / cw, box.height / ch, maxScale);
  const originX = content.x - padding;
  const originY = content.y - padding;
  const offsetX = (box.width - cw * scale) / 2 - originX * scale;
  const offsetY = (box.height - ch * scale) / 2 - originY * scale;
  return { scale, offsetX, offsetY };
}

/** Inverse of fitContentToBox: screen (box-local px) -> drawing-space. */
export function screenToContent(px: number, py: number, t: ViewTransform): { x: number; y: number } {
  return { x: (px - t.offsetX) / t.scale, y: (py - t.offsetY) / t.scale };
}

/**
 * Centre a content bounding box inside a display box at scale 1 (no zoom). Used by the
 * standalone view so a small drawing opens with a comfortable, centred working area.
 * Null/zero-area content places the drawing-space origin at the box centre. A content
 * point (cx, cy) maps to screen as (cx + offsetX, cy + offsetY).
 */
export function centerContentInBox(box: Box, content: Bounds | null): ViewTransform {
  if (box.width <= 0 || box.height <= 0) return { scale: 1, offsetX: 0, offsetY: 0 };
  if (!content || content.width <= 0 || content.height <= 0) {
    return { scale: 1, offsetX: box.width / 2, offsetY: box.height / 2 };
  }
  const cx = content.x + content.width / 2;
  const cy = content.y + content.height / 2;
  return { scale: 1, offsetX: box.width / 2 - cx, offsetY: box.height / 2 - cy };
}

/** Display size an embed should auto-fit to, clamped to a sensible minimum. */
export function naturalContentSize(content: Bounds): { width: number; height: number } {
  const MIN_W = 400, MIN_H = 300;
  if (content.width <= 0 || content.height <= 0) return { width: MIN_W, height: MIN_H };
  return { width: Math.max(1, content.width), height: Math.max(1, content.height) };
}
