import type { ToolState } from './entities';

export class ToolManager {
  activeTool: ToolState['activeTool'];
  private penColor_: string;
  private penSize: number;
  private highlighterColor_: string;
  private highlighterSize: number;
  private eraserSize: number;

  constructor(defaults?: Partial<ToolState>) {
    this.activeTool = defaults?.activeTool ?? 'pen';
    this.penColor_ = defaults?.penColor ?? '#ffffff';
    this.penSize = defaults?.penSize ?? 4;
    this.highlighterColor_ = defaults?.highlighterColor ?? '#FFFF00';
    this.highlighterSize = defaults?.highlighterSize ?? 20;
    this.eraserSize = defaults?.eraserSize ?? 10;
  }

  setTool(tool: ToolState['activeTool']): void {
    this.activeTool = tool;
  }

  /**
   * Apply the given colors and sizes to every tool at once, then select `activeTool` if given.
   * Sets each tool's color and size directly (`setColor`/`setSize` only change the active
   * tool), so the highlighter and eraser values apply whichever tool is active.
   */
  setDefaults(defaults: Partial<ToolState>): void {
    if (defaults.penColor !== undefined) this.penColor_ = defaults.penColor;
    if (defaults.penSize !== undefined) this.penSize = defaults.penSize;
    if (defaults.highlighterColor !== undefined) this.highlighterColor_ = defaults.highlighterColor;
    if (defaults.highlighterSize !== undefined) this.highlighterSize = defaults.highlighterSize;
    if (defaults.eraserSize !== undefined) this.eraserSize = defaults.eraserSize;
    if (defaults.activeTool !== undefined) this.activeTool = defaults.activeTool;
  }

  setColor(color: string): void {
    if (this.activeTool === 'pen') {
      this.penColor_ = color;
    } else if (this.activeTool === 'highlighter') {
      this.highlighterColor_ = color;
    }
  }

  setSize(size: number): void {
    if (this.activeTool === 'pen') {
      this.penSize = size;
    } else if (this.activeTool === 'highlighter') {
      this.highlighterSize = size;
    } else if (this.activeTool === 'eraser') {
      this.eraserSize = size;
    }
  }

  get activeColor(): string {
    if (this.activeTool === 'highlighter') {
      return this.highlighterColor_;
    }
    return this.penColor_;
  }

  /** Pen color whatever the active tool is, so the toolbar can tint the pen icon. */
  get penColor(): string {
    return this.penColor_;
  }

  /** Highlighter color whatever the active tool is, so the toolbar can tint the highlighter icon. */
  get highlighterColor(): string {
    return this.highlighterColor_;
  }

  get activeSize(): number {
    if (this.activeTool === 'highlighter') {
      return this.highlighterSize;
    }
    if (this.activeTool === 'eraser') {
      return this.eraserSize;
    }
    return this.penSize;
  }

  get activeOpacity(): number {
    if (this.activeTool === 'highlighter') {
      return 0.3;
    }
    return 1.0;
  }

  getState(): ToolState {
    return {
      activeTool: this.activeTool,
      penColor: this.penColor_,
      penSize: this.penSize,
      highlighterColor: this.highlighterColor_,
      highlighterSize: this.highlighterSize,
      eraserSize: this.eraserSize,
    };
  }
}
