import { getStroke } from 'perfect-freehand';
import type { Point, Stroke } from '../domain/entities';
import { StrokeManager } from '../domain/stroke-manager';
import { ToolManager } from '../domain/tool-manager';
import { fitContentToBox, screenToContent, centerContentInBox, type ViewTransform } from '../domain/geometry';

/** View-scale clamp shared by the presentation-facing transform mutators. */
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

export class DrawingEngine {
  readonly: boolean = false;
  warnings: string[] = [];
  strokeManager: StrokeManager;
  toolManager: ToolManager;

  private container: HTMLElement;
  private staticCanvas: HTMLCanvasElement;
  private activeCanvas: HTMLCanvasElement;
  private staticCtx: CanvasRenderingContext2D;
  private activeCtx: CanvasRenderingContext2D;
  private activePoints: Point[] = [];
  private activePointerType: string = '';
  private isDrawing: boolean = false;
  staticDirty: boolean = true;
  private activeDirty: boolean = false;
  private rafId: number = 0;
  drawingWidth: number;
  drawingHeight: number;
  private displayWidth = 0;
  private displayHeight = 0;
  private contentBounds: { x: number; y: number; width: number; height: number } | null = null;
  private view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };

  constructor(container: HTMLElement, width?: number, height?: number, toolManager?: ToolManager) {
    this.container = container;
    this.strokeManager = new StrokeManager();
    // Tool state is global: when the plugin injects a shared ToolManager, every surface
    // reads and drives the same selection (fix-tool-state-isolation). Falls back to a
    // private manager for back-compat (standalone construction / tests).
    this.toolManager = toolManager ?? new ToolManager();

    this.drawingWidth = width ?? (container.clientWidth || 800);
    this.drawingHeight = height ?? (container.clientHeight || 600);

    // Layout (absolute, full-bleed) lives in styles.css under .blackboard-static/.blackboard-active.
    this.staticCanvas = createEl('canvas');
    this.staticCanvas.className = 'blackboard-static';

    this.activeCanvas = createEl('canvas');
    this.activeCanvas.className = 'blackboard-active';

    container.appendChild(this.staticCanvas);
    container.appendChild(this.activeCanvas);

    // desynchronized lowers input-to-paint latency for stylus drawing in WebKit.
    this.staticCtx = this.staticCanvas.getContext('2d', { desynchronized: true })!;
    this.activeCtx = this.activeCanvas.getContext('2d', { desynchronized: true })!;

    this.setCanvasSize(this.drawingWidth, this.drawingHeight);
  }

  loadStrokes(strokes: Stroke[]): void {
    this.strokeManager.reset();
    for (const stroke of strokes) {
      this.strokeManager.strokes.push(JSON.parse(JSON.stringify(stroke)) as Stroke);
    }
    this.staticDirty = true;
  }

  beginStroke(pointerType: string): void {
    this.isDrawing = true;
    this.activePointerType = pointerType;
    this.activePoints = [];
  }

  addPoint(point: Point): void {
    if (!this.isDrawing) return;
    // Skip zero-length segments (e.g. the pointerup point landing on the last move
    // position) so capturing the release point doesn't add a duplicate.
    const last = this.activePoints[this.activePoints.length - 1];
    if (last && last[0] === point[0] && last[1] === point[1]) return;
    this.activePoints.push(point);
    this.activeDirty = true;
    this.requestRender();
  }

  endStroke(): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.activePoints.length >= 1) {
      const tool = this.toolManager.activeTool === 'highlighter' ? 'highlighter' : 'pen';
      const stroke: Stroke = {
        id: crypto.randomUUID(),
        tool,
        color: this.toolManager.activeColor,
        size: this.toolManager.activeSize,
        opacity: this.toolManager.activeOpacity,
        points: [...this.activePoints],
        hasPressure: this.activePoints.some(p => p[2] !== 0.5),
        timestamp: Date.now(),
      };
      this.strokeManager.addStroke(stroke);
      this.staticDirty = true;
    }

    this.activePoints = [];
    this.activeDirty = true;
    this.requestRender();
  }

  render(): void {
    if (this.staticDirty) {
      this.renderStatic();
      this.staticDirty = false;
    }
    if (this.activeDirty) {
      this.renderActive();
      this.activeDirty = false;
    }
    this.rafId = 0;
  }

  requestRender(): void {
    if (this.rafId !== 0) return;
    this.rafId = window.requestAnimationFrame(() => this.render());
  }

  exportThumbnail(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const bounds = this.getContentBounds();
      if (bounds.width === 0 || bounds.height === 0) {
        resolve(null);
        return;
      }

      const thumbCanvas = createEl('canvas');
      const maxSize = 256;
      const scale = Math.min(maxSize / bounds.width, maxSize / bounds.height);
      thumbCanvas.width = Math.ceil(bounds.width * scale);
      thumbCanvas.height = Math.ceil(bounds.height * scale);

      const ctx = thumbCanvas.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.translate(-bounds.x, -bounds.y);
      this.renderStrokes(ctx, this.strokeManager.strokes);

      thumbCanvas.toBlob((blob) => resolve(blob));
    });
  }

  getContentBounds(): { x: number; y: number; width: number; height: number } {
    const strokes = this.strokeManager.strokes;
    if (strokes.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxSize = 0;

    for (const stroke of strokes) {
      if (stroke.size > maxSize) maxSize = stroke.size;
      for (const point of stroke.points) {
        if (point[0] < minX) minX = point[0];
        if (point[1] < minY) minY = point[1];
        if (point[0] > maxX) maxX = point[0];
        if (point[1] > maxY) maxY = point[1];
      }
    }

    const pad = maxSize / 2;
    return {
      x: minX - pad,
      y: minY - pad,
      width: (maxX - minX) + maxSize,
      height: (maxY - minY) + maxSize,
    };
  }


  setCanvasSize(width: number, height: number): void {
    if (width === 0 || height === 0) return;
    this.drawingWidth = width;
    this.drawingHeight = height;
    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    this.staticCanvas.width = width * dpr;
    this.staticCanvas.height = height * dpr;
    this.activeCanvas.width = width * dpr;
    this.activeCanvas.height = height * dpr;
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  /** Size the backing store to the display box (CSS px) and recompute the view. */
  setDisplaySize(width: number, height: number): void {
    if (width === 0 || height === 0) return;
    this.displayWidth = width;
    this.displayHeight = height;
    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    this.staticCanvas.width = width * dpr;
    this.staticCanvas.height = height * dpr;
    this.activeCanvas.width = width * dpr;
    this.activeCanvas.height = height * dpr;
    this.recomputeView();
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  /**
   * Standalone view: size the backing store to a CSS box and centre the content at
   * scale 1 (no zoom). Empty content centres the drawing-space origin in the box.
   */
  centerInBox(boxW: number, boxH: number): void {
    if (boxW <= 0 || boxH <= 0) return;
    this.resizeBackingStore(boxW, boxH);
    const b = this.getContentBounds();
    this.contentBounds = (b.width > 0 && b.height > 0) ? b : null;
    this.view = centerContentInBox({ width: boxW, height: boxH }, this.contentBounds);
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  /**
   * Replace the view transform wholesale (presentation-facing pan/zoom). `scale` is clamped
   * to [MIN_SCALE, MAX_SCALE]; the render pipeline is untouched (it still composes
   * `view.scale`/`view.offset` with DPR). Marks both layers dirty and requests a render.
   */
  setView(view: ViewTransform): void {
    this.view = {
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale)),
      offsetX: view.offsetX,
      offsetY: view.offsetY,
    };
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  /** Translate the view offset by (dx, dy) display px without changing the scale. */
  panBy(dx: number, dy: number): void {
    this.view = { scale: this.view.scale, offsetX: this.view.offsetX + dx, offsetY: this.view.offsetY + dy };
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  /**
   * Focal-point zoom: scale by `factor` about the box-local point (cx, cy), clamped to
   * [MIN_SCALE, MAX_SCALE], keeping the content under (cx, cy) fixed on screen.
   */
  zoomAt(factor: number, cx: number, cy: number): void {
    const scale = this.view.scale;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    this.view = {
      scale: newScale,
      offsetX: cx - (cx - this.view.offsetX) / scale * newScale,
      offsetY: cy - (cy - this.view.offsetY) / scale * newScale,
    };
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  /** Resize the backing store to a CSS box without changing the view transform. */
  resizeBox(boxW: number, boxH: number): void {
    if (boxW <= 0 || boxH <= 0) return;
    this.resizeBackingStore(boxW, boxH);
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  private resizeBackingStore(boxW: number, boxH: number): void {
    this.displayWidth = boxW;
    this.displayHeight = boxH;
    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    this.staticCanvas.width = boxW * dpr;
    this.staticCanvas.height = boxH * dpr;
    this.activeCanvas.width = boxW * dpr;
    this.activeCanvas.height = boxH * dpr;
  }

  /** Recompute the content bbox from current strokes and re-fit. Call on idle, NOT mid-stroke. */
  refitToContent(padding = 0): void {
    const b = this.getContentBounds();
    this.contentBounds = (b.width > 0 && b.height > 0) ? b : null;
    this.recomputeView(padding);
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  /**
   * Fit content to the display box using an explicit caller-supplied reference size
   * (the file's saved `width`/`height`) instead of the live recomputed content bounds.
   *
   * The reference rectangle is anchored at the live content origin but takes its
   * DIMENSIONS from the caller, so the resulting scale is `min(boxW/refW, boxH/refH)`
   * regardless of how the content has since grown. Because the saved dimensions are the
   * stable description of the drawing at save time, fitting against them reproduces the
   * same scale across a save→reload round trip — existing strokes keep their on-screen
   * size when an embedded surface is unmounted and remounted after an edit (B3). Anchoring
   * at the live origin makes the content's top-left land at the same screen position too,
   * since the origin cancels in the letterbox offset. Like refitToContent/resizeBox, apply
   * this on layout/resize only, never per stroke.
   */
  fitReferenceSize(refWidth: number, refHeight: number, padding = 0, maxScale = Infinity): void {
    const b = this.getContentBounds();
    const hasContent = b.width > 0 && b.height > 0;
    const reference = (refWidth > 0 && refHeight > 0)
      ? { x: hasContent ? b.x : 0, y: hasContent ? b.y : 0, width: refWidth, height: refHeight }
      : null;
    this.contentBounds = reference;
    this.view = fitContentToBox(
      { width: this.displayWidth || this.drawingWidth, height: this.displayHeight || this.drawingHeight },
      reference,
      padding,
      maxScale,
    );
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  private recomputeView(padding = 0): void {
    this.view = fitContentToBox(
      { width: this.displayWidth || this.drawingWidth, height: this.displayHeight || this.drawingHeight },
      this.contentBounds,
      padding,
    );
  }

  getViewTransform(): ViewTransform {
    return { ...this.view };
  }

  /**
   * Map a pointer event to drawing-space coordinates. `el` must be the same element
   * whose layout size drives `setDisplaySize`. Divides by rect.width/height before
   * inverting the view transform to compensate for any CSS zoom applied by
   * Obsidian Canvas (pointer offsets are in rendered px, not layout px).
   */
  screenToDrawing(clientX: number, clientY: number, el: HTMLElement): [number, number] {
    const rect = el.getBoundingClientRect();
    const sx = rect.width ? el.clientWidth / rect.width : 1;
    const sy = rect.height ? el.clientHeight / rect.height : 1;
    const p = screenToContent((clientX - rect.left) * sx, (clientY - rect.top) * sy, this.view);
    return [p.x, p.y];
  }

  destroy(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.staticCanvas.remove();
    this.activeCanvas.remove();
  }

  private renderStatic(): void {
    const ctx = this.staticCtx;
    const w = this.staticCanvas.width;
    const h = this.staticCanvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.restore();

    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    ctx.save();
    ctx.setTransform(dpr * this.view.scale, 0, 0, dpr * this.view.scale, dpr * this.view.offsetX, dpr * this.view.offsetY);

    const penStrokes = this.strokeManager.strokes.filter(s => s.tool === 'pen');
    const highlighterStrokes = this.strokeManager.strokes.filter(s => s.tool === 'highlighter');

    for (const stroke of penStrokes) {
      this.renderSingleStroke(ctx, stroke);
    }

    ctx.globalCompositeOperation = 'destination-over';
    for (const stroke of highlighterStrokes) {
      this.renderSingleStroke(ctx, stroke);
    }

    ctx.restore();
  }

  private renderActive(): void {
    const ctx = this.activeCtx;
    const w = this.activeCanvas.width;
    const h = this.activeCanvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.restore();

    if (this.activePoints.length < 1) return;

    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    ctx.save();
    ctx.setTransform(dpr * this.view.scale, 0, 0, dpr * this.view.scale, dpr * this.view.offsetX, dpr * this.view.offsetY);

    const outlinePoints = getStroke(this.activePoints, {
      size: this.toolManager.activeSize,
      thinning: 0.5,
      simulatePressure: !this.activePoints.some(p => p[2] !== 0.5),
    });

    ctx.globalAlpha = this.toolManager.activeOpacity;
    ctx.fillStyle = this.toolManager.activeColor;
    this.fillOutline(ctx, outlinePoints);

    ctx.restore();
  }

  private renderStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]): void {
    const penStrokes = strokes.filter(s => s.tool === 'pen');
    const highlighterStrokes = strokes.filter(s => s.tool === 'highlighter');

    for (const stroke of penStrokes) {
      this.renderSingleStroke(ctx, stroke);
    }

    for (const stroke of highlighterStrokes) {
      this.renderSingleStroke(ctx, stroke);
    }
  }

  private renderSingleStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    if (stroke.points.length < 1) return;

    const outlinePoints = getStroke(stroke.points, {
      size: stroke.size,
      thinning: 0.5,
      simulatePressure: !stroke.hasPressure,
    });

    ctx.globalAlpha = stroke.opacity;
    ctx.fillStyle = stroke.color;
    this.fillOutline(ctx, outlinePoints);
  }

  private fillOutline(ctx: CanvasRenderingContext2D, points: number[][]): void {
    if (points.length === 0) return;

    ctx.beginPath();

    if (points.length < 3) {
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
    } else {
      ctx.moveTo(points[0][0], points[0][1]);

      let midX = (points[0][0] + points[1][0]) / 2;
      let midY = (points[0][1] + points[1][1]) / 2;
      ctx.lineTo(midX, midY);

      for (let i = 1; i < points.length - 1; i++) {
        const nextMidX = (points[i][0] + points[i + 1][0]) / 2;
        const nextMidY = (points[i][1] + points[i + 1][1]) / 2;
        ctx.quadraticCurveTo(points[i][0], points[i][1], nextMidX, nextMidY);
      }

      const last = points[points.length - 1];
      ctx.lineTo(last[0], last[1]);
    }

    ctx.closePath();
    ctx.fill();
  }
}
