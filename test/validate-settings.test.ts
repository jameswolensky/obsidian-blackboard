import { describe, it, expect } from 'vitest';
import { validateSettings, DEFAULT_PLUGIN_SETTINGS, PluginSettings } from '../src/domain/entities';

function makeSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return { ...DEFAULT_PLUGIN_SETTINGS, ...overrides };
}

describe('validateSettings', () => {
  it('preserves valid settings unchanged', () => {
    const input = makeSettings();
    const result = validateSettings(input);
    expect(result).toEqual(input);
  });

  it('defaults invalid drawingFolder to Blackboard', () => {
    const result = validateSettings(makeSettings({ drawingFolder: 123 as any }));
    expect(result.drawingFolder).toBe('Blackboard');
  });

  it('defaults invalid newFileLocation to fixed', () => {
    const result = validateSettings(makeSettings({ newFileLocation: 'somewhere' as any }));
    expect(result.newFileLocation).toBe('fixed');
  });

  it('defaults invalid autoExportSvg to false', () => {
    const result = validateSettings(makeSettings({ autoExportSvg: 'yes' as any }));
    expect(result.autoExportSvg).toBe(false);
  });

  it('defaults invalid svgExportPath to empty string', () => {
    const result = validateSettings(makeSettings({ svgExportPath: 42 as any }));
    expect(result.svgExportPath).toBe('');
  });

  it('coerces a non-boolean showToolbarPill back to true', () => {
    for (const bad of [undefined, 0, 'yes', null] as any[]) {
      const result = validateSettings(makeSettings({ showToolbarPill: bad }));
      expect(result.showToolbarPill).toBe(true);
    }
  });

  it('preserves showToolbarPill false', () => {
    const result = validateSettings(makeSettings({ showToolbarPill: false }));
    expect(result.showToolbarPill).toBe(false);
  });

  it('preserves showToolbarPill true', () => {
    const result = validateSettings(makeSettings({ showToolbarPill: true }));
    expect(result.showToolbarPill).toBe(true);
  });

  it('preserves valid drawingFolder', () => {
    const result = validateSettings(makeSettings({ drawingFolder: 'MyDrawings' }));
    expect(result.drawingFolder).toBe('MyDrawings');
  });

  it('preserves valid newFileLocation current', () => {
    const result = validateSettings(makeSettings({ newFileLocation: 'current' }));
    expect(result.newFileLocation).toBe('current');
  });

  const DEFAULT_PALETTE = ['#000000', '#ffffff', '#ff0000', '#0000ff', '#00ff00', '#ffff00', '#ffa500', '#800080'];

  it('preserves a valid eight-entry paletteColors in order', () => {
    const palette = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888'];
    const result = validateSettings(makeSettings({ paletteColors: palette }));
    expect(result.paletteColors).toEqual(palette);
  });

  it('resets a non-array paletteColors to the default', () => {
    const result = validateSettings(makeSettings({ paletteColors: 'nope' as any }));
    expect(result.paletteColors).toEqual(DEFAULT_PALETTE);
  });

  it('resets a wrong-length paletteColors to the default', () => {
    const result = validateSettings(makeSettings({ paletteColors: ['#000000', '#ffffff'] as any }));
    expect(result.paletteColors).toEqual(DEFAULT_PALETTE);
  });

  it('repairs an invalid hex entry in place, preserving the valid entries', () => {
    const palette = ['#111111', 'not-a-hex', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888'];
    const result = validateSettings(makeSettings({ paletteColors: palette as any }));
    expect(result.paletteColors).toEqual([
      '#111111', DEFAULT_PALETTE[1], '#333333', '#444444', '#555555', '#666666', '#777777', '#888888',
    ]);
  });

  it('repairs a 3-digit shorthand hex entry (not 6-digit) in place', () => {
    const palette = ['#fff', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888'];
    const result = validateSettings(makeSettings({ paletteColors: palette as any }));
    expect(result.paletteColors[0]).toBe(DEFAULT_PALETTE[0]);
    expect(result.paletteColors.slice(1)).toEqual(palette.slice(1));
  });

  it('does not reintroduce removed drawing-defaults/smoothing/streamline fields', () => {
    const result = validateSettings(makeSettings()) as any;
    expect(result.smoothing).toBeUndefined();
    expect(result.streamline).toBeUndefined();
    expect(result.defaultPenSize).toBeUndefined();
    expect(result.defaultHighlighterSize).toBeUndefined();
    expect(result.defaultEraserSize).toBeUndefined();
    expect(result.defaultTool).toBeUndefined();
  });
});
