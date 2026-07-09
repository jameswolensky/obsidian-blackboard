import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Setting } from 'obsidian';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/domain/entities';
import type { PluginSettings } from '../src/domain/entities';
import { BlackboardSettingTab } from '../src/presentation/settings';

function createTab(settingsOverrides: Partial<typeof DEFAULT_PLUGIN_SETTINGS> = {}): BlackboardSettingTab {
  const plugin = {
    settings: { ...DEFAULT_PLUGIN_SETTINGS, ...settingsOverrides },
    saveSettings: vi.fn().mockResolvedValue(undefined),
  };
  const app = {};
  return new BlackboardSettingTab(app as any, plugin as any);
}

describe('BlackboardSettingTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('display does not throw', () => {
    const tab = createTab();

    expect(() => tab.display()).not.toThrow();
  });

  it('creates the section headings via setHeading (no manual h2 elements)', () => {
    const tab = createTab();

    tab.display();

    // Review guideline: headings come from new Setting(...).setHeading(), sentence case.
    expect(tab.containerEl.querySelectorAll('h2')).toHaveLength(0);
    const headings = tab.containerEl.querySelectorAll('.setting-item-heading .setting-item-name');
    const texts = Array.from(headings).map((h) => h.textContent);
    expect(texts).toEqual(['File storage', 'Toolbar palette', 'Toolbar']);
  });

  it('renders eight palette color controls in its own section, not under Drawing Defaults', () => {
    const tab = createTab();
    const settingSpy = vi.spyOn(Setting.prototype, 'addColorPicker');

    tab.display();

    // Eight color pickers, one per palette entry.
    expect(settingSpy).toHaveBeenCalledTimes(8);
    // No Drawing Defaults section exists at all.
    const texts = Array.from(tab.containerEl.querySelectorAll('h2')).map((h) => h.textContent);
    expect(texts).not.toContain('Drawing Defaults');
  });

  it('editing a palette color updates settings.paletteColors[i] and persists', async () => {
    const plugin = {
      settings: { ...DEFAULT_PLUGIN_SETTINGS, paletteColors: [...DEFAULT_PLUGIN_SETTINGS.paletteColors] } as PluginSettings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const tab = new BlackboardSettingTab({} as any, plugin as any);
    (Setting as any)._lastOnChangeCallbacks = [];

    tab.display();

    const callbacks = (Setting as any)._lastOnChangeCallbacks;
    // File Storage callbacks first: drawingFolder(0), newFileLocation(1), autoExportSvg(2);
    // autoExportSvg is false by default so svgExportPath is absent. Palette pickers follow.
    const paletteStart = 3;
    await callbacks[paletteStart + 2]('#abcdef');

    expect(plugin.settings.paletteColors[2]).toBe('#abcdef');
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('does not create a Drawing Defaults heading', () => {
    const tab = createTab();

    tab.display();

    const texts = Array.from(tab.containerEl.querySelectorAll('h2')).map((h) => h.textContent);
    expect(texts).not.toContain('Drawing Defaults');
  });

  it('does not create an Input heading', () => {
    const tab = createTab();

    tab.display();

    const texts = Array.from(tab.containerEl.querySelectorAll('h2')).map((h) => h.textContent);
    expect(texts).not.toContain('Input');
  });

  it('does not create any removed Drawing Defaults / Input controls', () => {
    const tab = createTab();
    const settingSpy = vi.spyOn(Setting.prototype, 'setName');

    tab.display();

    const names = settingSpy.mock.calls.map((c) => c[0]);
    for (const removed of [
      'Default tool',
      'Default pen color',
      'Default pen size',
      'Default highlighter color',
      'Default highlighter size',
      'Default eraser size',
      'Palm rejection',
      'Smoothing',
      'Streamline',
    ]) {
      expect(names).not.toContain(removed);
    }
  });

  it('renders a toggle in the Toolbar section for the collapsed toolbar pill', () => {
    const tab = createTab();
    const nameSpy = vi.spyOn(Setting.prototype, 'setName');
    const toggleSpy = vi.spyOn(Setting.prototype, 'addToggle');

    tab.display();

    const names = nameSpy.mock.calls.map((c) => c[0]);
    expect(names).toContain('Show toolbar pill');
    // autoExportSvg toggle (1) + the new pill toggle (1) = 2 toggles when autoExportSvg is false.
    expect(toggleSpy).toHaveBeenCalledTimes(2);
  });

  it('toggling Show toolbar pill updates settings.showToolbarPill and persists', async () => {
    const plugin = {
      settings: { ...DEFAULT_PLUGIN_SETTINGS, showToolbarPill: true } as PluginSettings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const tab = new BlackboardSettingTab({} as any, plugin as any);
    (Setting as any)._lastOnChangeCallbacks = [];

    tab.display();

    // The pill toggle is the LAST registered onChange (after File Storage + 8 palette pickers).
    const callbacks = (Setting as any)._lastOnChangeCallbacks;
    const last = callbacks[callbacks.length - 1];
    await last(false);

    expect(plugin.settings.showToolbarPill).toBe(false);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('renders the File Storage controls', () => {
    const tab = createTab();
    const settingSpy = vi.spyOn(Setting.prototype, 'setName');

    tab.display();

    const names = settingSpy.mock.calls.map((c) => c[0]);
    expect(names).toContain('Drawing folder');
    expect(names).toContain('New file location');
    expect(names).toContain('Auto-export SVG');
  });

  it('shows SVG export path setting when autoExportSvg is true', () => {
    const tab = createTab({ autoExportSvg: true });
    const settingSpy = vi.spyOn(Setting.prototype, 'setName');

    tab.display();

    const names = settingSpy.mock.calls.map((c) => c[0]);
    expect(names).toContain('SVG export path');
  });

  it('hides SVG export path setting when autoExportSvg is false', () => {
    const tab = createTab({ autoExportSvg: false });
    const settingSpy = vi.spyOn(Setting.prototype, 'setName');

    tab.display();

    const names = settingSpy.mock.calls.map((c) => c[0]);
    expect(names).not.toContain('SVG export path');
  });

  it('re-calling display reconstructs settings cleanly', () => {
    const tab = createTab();
    tab.display();
    const firstChildCount = tab.containerEl.children.length;

    tab.display();

    expect(tab.containerEl.children.length).toBe(firstChildCount);
  });

  it('onChange callbacks call saveSettings', async () => {
    const plugin = {
      settings: { ...DEFAULT_PLUGIN_SETTINGS } as PluginSettings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const tab = new BlackboardSettingTab({} as any, plugin as any);
    (Setting as any)._lastOnChangeCallbacks = [];

    tab.display();

    const callbacks = (Setting as any)._lastOnChangeCallbacks;
    expect(callbacks.length).toBeGreaterThan(0);

    // Call first callback (drawingFolder) to verify saveSettings is called
    await callbacks[0]('NewFolder');

    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('drawingFolder onChange updates settings', async () => {
    const plugin = {
      settings: { ...DEFAULT_PLUGIN_SETTINGS } as PluginSettings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const tab = new BlackboardSettingTab({} as any, plugin as any);
    (Setting as any)._lastOnChangeCallbacks = [];

    tab.display();

    // First callback is drawingFolder text input
    const callbacks = (Setting as any)._lastOnChangeCallbacks;
    await callbacks[0]('NewFolder');

    expect(plugin.settings.drawingFolder).toBe('NewFolder');
  });

  it('newFileLocation onChange updates settings', async () => {
    const plugin = {
      settings: { ...DEFAULT_PLUGIN_SETTINGS } as PluginSettings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const tab = new BlackboardSettingTab({} as any, plugin as any);
    (Setting as any)._lastOnChangeCallbacks = [];

    tab.display();

    const callbacks = (Setting as any)._lastOnChangeCallbacks;
    // 2nd callback is newFileLocation dropdown
    await callbacks[1]('current');

    expect(plugin.settings.newFileLocation).toBe('current');
  });

  it('autoExportSvg onChange triggers re-display', async () => {
    const plugin = {
      settings: { ...DEFAULT_PLUGIN_SETTINGS, autoExportSvg: false } as PluginSettings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const tab = new BlackboardSettingTab({} as any, plugin as any);
    (Setting as any)._lastOnChangeCallbacks = [];

    tab.display();

    // Stub display to prevent infinite loop (autoExportSvg onChange calls this.display())
    const displaySpy = vi.spyOn(tab, 'display').mockImplementation(() => {});

    // The toggle for autoExportSvg - 3rd callback: drawingFolder, newFileLocation, autoExportSvg
    const callbacks = (Setting as any)._lastOnChangeCallbacks;
    await callbacks[2](true);

    expect(plugin.settings.autoExportSvg).toBe(true);
    expect(displaySpy).toHaveBeenCalled();
  });

  it('svgExportPath onChange updates settings when autoExportSvg is true', async () => {
    const plugin = {
      settings: { ...DEFAULT_PLUGIN_SETTINGS, autoExportSvg: true } as PluginSettings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const tab = new BlackboardSettingTab({} as any, plugin as any);
    (Setting as any)._lastOnChangeCallbacks = [];

    tab.display();

    const callbacks = (Setting as any)._lastOnChangeCallbacks;
    // When autoExportSvg is true, svgExportPath is added after autoExportSvg toggle
    // drawingFolder(0), newFileLocation(1), autoExportSvg(2), svgExportPath(3)
    await callbacks[3]('exports/svg');

    expect(plugin.settings.svgExportPath).toBe('exports/svg');
  });
});
