import { describe, it, expect } from 'vitest';
import { DEFAULT_PLUGIN_SETTINGS, DEFAULT_TOOL_STATE, createDefaultFile } from '../src/domain/entities';

describe('DEFAULT_PLUGIN_SETTINGS', () => {
  it('equals the file-storage/export fields plus the default palette', () => {
    expect(DEFAULT_PLUGIN_SETTINGS).toEqual({
      drawingFolder: 'Blackboard',
      newFileLocation: 'fixed',
      autoExportSvg: false,
      svgExportPath: '',
      paletteColors: ['#000000', '#ffffff', '#ff0000', '#0000ff', '#00ff00', '#ffff00', '#ffa500', '#800080'],
      showToolbarPill: true,
      boardBackground: '#000000',
    });
  });

  it('seeds paletteColors with the eight presets in order', () => {
    expect(DEFAULT_PLUGIN_SETTINGS.paletteColors).toEqual([
      '#000000', '#ffffff', '#ff0000', '#0000ff', '#00ff00', '#ffff00', '#ffa500', '#800080',
    ]);
  });

  it('has no per-tool drawing-defaults fields', () => {
    expect((DEFAULT_PLUGIN_SETTINGS as any).defaultTool).toBeUndefined();
    expect((DEFAULT_PLUGIN_SETTINGS as any).defaultPenColor).toBeUndefined();
    expect((DEFAULT_PLUGIN_SETTINGS as any).defaultPenSize).toBeUndefined();
    expect((DEFAULT_PLUGIN_SETTINGS as any).defaultHighlighterColor).toBeUndefined();
    expect((DEFAULT_PLUGIN_SETTINGS as any).defaultHighlighterSize).toBeUndefined();
    expect((DEFAULT_PLUGIN_SETTINGS as any).defaultEraserSize).toBeUndefined();
  });

  it('has no smoothing, streamline, or palmRejection fields', () => {
    expect((DEFAULT_PLUGIN_SETTINGS as any).smoothing).toBeUndefined();
    expect((DEFAULT_PLUGIN_SETTINGS as any).streamline).toBeUndefined();
    expect((DEFAULT_PLUGIN_SETTINGS as any).palmRejection).toBeUndefined();
  });

  it('drawingFolder is Blackboard', () => {
    expect(DEFAULT_PLUGIN_SETTINGS.drawingFolder).toBe('Blackboard');
  });

  it('newFileLocation is fixed', () => {
    expect(DEFAULT_PLUGIN_SETTINGS.newFileLocation).toBe('fixed');
  });

  it('autoExportSvg is false', () => {
    expect(DEFAULT_PLUGIN_SETTINGS.autoExportSvg).toBe(false);
  });

  it('svgExportPath is empty string', () => {
    expect(DEFAULT_PLUGIN_SETTINGS.svgExportPath).toBe('');
  });

  it('showToolbarPill is true (persistent pill shown by default)', () => {
    expect(DEFAULT_PLUGIN_SETTINGS.showToolbarPill).toBe(true);
  });
});

describe('DEFAULT_TOOL_STATE', () => {
  it('seeds per-tool defaults: pen white/2, highlighter yellow/22, eraser 8 (each on a real preset)', () => {
    // The highlighter default lands on a mid HIGHLIGHTER_SIZES preset (a real marker is
    // chunky, not 2px), and the eraser default lands on a PEN_SIZES preset — so the size
    // popover can highlight the selected dot for every tool on first open (QA3).
    expect(DEFAULT_TOOL_STATE).toEqual({
      activeTool: 'pen',
      penColor: '#ffffff',
      penSize: 2,
      highlighterColor: '#ffff00',
      highlighterSize: 22,
      eraserSize: 8,
    });
  });
});

describe('createDefaultFile', () => {
  it('returns version 3', () => {
    const data = createDefaultFile(DEFAULT_PLUGIN_SETTINGS);
    expect(data.version).toBe(3);
  });

  it('returns empty strokes array', () => {
    const data = createDefaultFile(DEFAULT_PLUGIN_SETTINGS);
    expect(data.strokes).toEqual([]);
  });

  it('uses transparent background', () => {
    const data = createDefaultFile(DEFAULT_PLUGIN_SETTINGS);
    expect(data.background.color).toBe('transparent');
  });

  it('has no viewport field', () => {
    const data = createDefaultFile(DEFAULT_PLUGIN_SETTINGS);
    expect((data as any).viewport).toBeUndefined();
  });

  it('carries no settings block', () => {
    const data = createDefaultFile(DEFAULT_PLUGIN_SETTINGS);
    expect((data as any).settings).toBeUndefined();
  });

  it('always uses transparent background regardless of settings', () => {
    const custom = { ...DEFAULT_PLUGIN_SETTINGS };
    const data = createDefaultFile(custom);
    expect(data.background.color).toBe('transparent');
  });
});
