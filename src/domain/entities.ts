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
 * Starting color and size for each tool, given once to the plugin's single shared
 * `ToolManager` when the plugin loads.
 */
export const DEFAULT_TOOL_STATE: ToolState = {
  activeTool: 'pen',
  penColor: '#ffffff',
  penSize: 2,
  highlighterColor: '#ffff00',
  // The highlighter has its own wider size scale (HIGHLIGHTER_SIZES), and 22 is its middle
  // preset so it looks like a marker. The eraser default (8) is one of the PEN_SIZES presets
  // so the size popover can mark its dot as selected.
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
   * Shows the collapsed toolbar pill (the round button that opens the toolbar) on Markdown
   * and Canvas views with no active drawing. False hides only that pill; a pill the user
   * collapses on an active drawing still shows.
   */
  showToolbarPill: boolean;
  /**
   * CSS color painted behind every drawing surface (full-page view, Markdown embed and
   * Canvas node). The default '#000000' is a blackboard; '#ffffff' gives a whiteboard, and
   * any CSS color works. It only applies on screen (SVG export stays transparent).
   */
  boardBackground: string;
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
  boardBackground: '#000000',
};

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export interface BlackboardFile {
  version: number;
  /** Content bounding-box width, cached on save (recomputable from strokes). */
  width: number;
  /** Content bounding-box height, cached on save (recomputable from strokes). */
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
  if (typeof result.boardBackground !== 'string' || result.boardBackground === '') {
    result.boardBackground = '#000000';
  }
  // Palette: a non-array or wrong-length value is reset to the defaults. In an eight-entry
  // array, only the invalid hex entries are replaced, each with the default at its index.
  if (!Array.isArray(result.paletteColors) || result.paletteColors.length !== 8) {
    result.paletteColors = [...DEFAULT_PALETTE_COLORS];
  } else {
    result.paletteColors = result.paletteColors.map((c, i) =>
      typeof c === 'string' && HEX6.test(c) ? c : DEFAULT_PALETTE_COLORS[i],
    );
  }
  return result;
}
