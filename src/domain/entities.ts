export const FILE_EXTENSION = 'blackboard';

export type Point = [number, number, number];

export interface Background {
  type: 'blank' | 'dot-grid' | 'line-grid' | 'square-grid';
  color: string;
  grid: boolean;
  gridSize: number;
}

export interface Stroke {
  id: string;
  tool: 'pen' | 'highlighter';
  color: string;
  size: number;
  opacity: number;
  points: Point[];
  hasPressure: boolean;
  timestamp: number;
}

export interface ToolState {
  activeTool: 'pen' | 'highlighter' | 'eraser';
  penColor: string;
  penSize: number;
  highlighterColor: string;
  highlighterSize: number;
  eraserSize: number;
}

/**
 * The per-tool default values seeded once into the shared `ToolManager`. Mirrors the
 * prior `default*` settings so first-run tool behavior is unchanged now that those
 * settings fields are gone.
 */
export const DEFAULT_TOOL_STATE: ToolState = {
  activeTool: 'pen',
  penColor: '#ffffff',
  penSize: 2,
  highlighterColor: '#ffff00',
  // The highlighter has its own wider size scale (HIGHLIGHTER_SIZES); its default lands on
  // a mid preset (22) so a marker looks like a marker. The eraser default lands on a real
  // PEN_SIZES preset (8) so the size popover can highlight its selected dot.
  highlighterSize: 22,
  eraserSize: 8,
};

export type StrokeAction =
  | { type: 'add'; stroke: Stroke }
  | { type: 'delete'; strokeId: string; stroke: Stroke }
  | { type: 'move'; strokeIds: string[]; dx: number; dy: number }
  | { type: 'clear'; strokes: Stroke[] };

export interface PluginSettings {
  drawingFolder: string;
  newFileLocation: 'fixed' | 'current';
  autoExportSvg: boolean;
  svgExportPath: string;
  /** Exactly eight color shortcuts (6-digit hex) in toolbar display order. */
  paletteColors: string[];
  /**
   * Whether the collapsed toolbar pill (the circular pen-icon affordance) is shown on
   * Markdown/Canvas host views with no active drawing surface. True preserves the
   * always-present pill; false suppresses only that persistent no-surface pill.
   */
  showToolbarPill: boolean;
}

/** The eight color-popover shortcuts seeded by default, in display order. */
export const DEFAULT_PALETTE_COLORS = [
  '#000000', '#ffffff', '#ff0000', '#0000ff', '#00ff00', '#ffff00', '#ffa500', '#800080',
];

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  drawingFolder: 'Blackboard',
  newFileLocation: 'fixed',
  autoExportSvg: false,
  svgExportPath: '',
  paletteColors: [...DEFAULT_PALETTE_COLORS],
  showToolbarPill: true,
};

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export interface BlackboardFile {
  version: number;
  /** Content bounding-box dimensions, cached on save (recomputable from strokes). */
  width: number;
  /** Content bounding-box dimensions, cached on save (recomputable from strokes). */
  height: number;
  strokes: Stroke[];
  background: { color: string };
  /** Cached drawing-space content bounding box (recomputable from strokes). */
  contentBounds?: { x: number; y: number; width: number; height: number };
}

export function createDefaultFile(_settings: PluginSettings): BlackboardFile {
  return {
    version: 3,
    width: 800,
    height: 600,
    strokes: [],
    background: { color: 'transparent' },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

export function validateFileData(raw: unknown): BlackboardFile | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.version !== 'number') return null;
  if (!Array.isArray(raw.strokes)) return null;

  const strokes = raw.strokes.filter((s: unknown): s is Stroke =>
    isRecord(s) && typeof s.id === 'string' &&
    Array.isArray(s.points) &&
    typeof s.color === 'string' &&
    typeof s.tool === 'string'
  );

  const result: BlackboardFile = {
    version: raw.version,
    width: (typeof raw.width === 'number' && raw.width > 0) ? raw.width : 800,
    height: (typeof raw.height === 'number' && raw.height > 0) ? raw.height : 600,
    strokes,
    background: isRecord(raw.background) && typeof raw.background.color === 'string'
      ? { color: raw.background.color }
      : { color: 'transparent' },
  };
  if (isRecord(raw.contentBounds)) {
    const cb = raw.contentBounds;
    if (typeof cb.x === 'number' && typeof cb.y === 'number' &&
        typeof cb.width === 'number' && cb.width >= 0 &&
        typeof cb.height === 'number' && cb.height >= 0) {
      result.contentBounds = { x: cb.x, y: cb.y, width: cb.width, height: cb.height };
    }
  }
  return result;
}

export function validateSettings(settings: PluginSettings): PluginSettings {
  const result = { ...settings };
  if (typeof result.drawingFolder !== 'string') {
    result.drawingFolder = 'Blackboard';
  }
  if (result.newFileLocation !== 'fixed' && result.newFileLocation !== 'current') {
    result.newFileLocation = 'fixed';
  }
  if (typeof result.autoExportSvg !== 'boolean') {
    result.autoExportSvg = false;
  }
  if (typeof result.svgExportPath !== 'string') {
    result.svgExportPath = '';
  }
  if (typeof result.showToolbarPill !== 'boolean') {
    result.showToolbarPill = true;
  }
  // Palette: a non-array or wrong-length value is reset wholesale; an eight-entry array
  // has only its invalid hex entries repaired in place to the default at that index.
  if (!Array.isArray(result.paletteColors) || result.paletteColors.length !== 8) {
    result.paletteColors = [...DEFAULT_PALETTE_COLORS];
  } else {
    result.paletteColors = result.paletteColors.map((c, i) =>
      typeof c === 'string' && HEX6.test(c) ? c : DEFAULT_PALETTE_COLORS[i],
    );
  }
  return result;
}
