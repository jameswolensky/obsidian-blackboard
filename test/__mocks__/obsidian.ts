import { vi } from 'vitest';

export class App {}
export class TFile {
  path = '';
  basename = '';
  extension = '';
  parent: { path: string } | null = null;
}
export class Plugin {
  app: any = {};
  loadData = vi.fn().mockResolvedValue({});
  saveData = vi.fn().mockResolvedValue(undefined);
  registerView = vi.fn();
  registerExtensions = vi.fn();
  addCommand = vi.fn();
  addSettingTab = vi.fn();
  registerEvent = vi.fn();
  register = vi.fn();
}
export class Notice {}
export class MarkdownView {
  editor = {
    getCursor: vi.fn().mockReturnValue({ line: 0, ch: 0 }),
    replaceRange: vi.fn(),
  };
}
export class View {
  containerEl: HTMLElement = document.createElement('div');
  contentEl: HTMLElement = document.createElement('div');
  getViewType(): string { return ''; }
}
export class TextFileView {
  file: TFile | null = null;
  contentEl: HTMLElement = document.createElement('div');
  data: string = '';
  requestSave(): void {}
  constructor(_leaf: any) {}
}
export class WorkspaceLeaf {}
export class PluginSettingTab {
  containerEl: HTMLElement = document.createElement('div');
  constructor(_app: any, _plugin: any) {}
}
export class Setting {
  static _lastOnChangeCallbacks: Array<(value: any) => void> = [];
  settingEl: HTMLElement;
  nameEl: HTMLElement;
  // Mirror real Obsidian: each Setting appends a .setting-item div to the container;
  // setHeading() marks it as a section heading (what the review guideline requires
  // instead of manual <h2> elements).
  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement('div');
    this.settingEl.className = 'setting-item';
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'setting-item-name';
    this.settingEl.appendChild(this.nameEl);
    containerEl.appendChild(this.settingEl);
  }
  setName(name: string) { this.nameEl.textContent = name; return this; }
  setDesc(_desc: string) { return this; }
  setHeading() { this.settingEl.classList.add('setting-item-heading'); return this; }
  addText(cb: any) {
    let onChangeCb: any;
    cb({ setValue: () => ({ onChange: (fn: any) => { onChangeCb = fn; Setting._lastOnChangeCallbacks.push(fn); } }) });
    return this;
  }
  addDropdown(cb: any) {
    const dropdown: any = {};
    dropdown.addOption = () => dropdown;
    dropdown.setValue = () => dropdown;
    dropdown.onChange = (fn: any) => { Setting._lastOnChangeCallbacks.push(fn); return dropdown; };
    cb(dropdown);
    return this;
  }
  addToggle(cb: any) {
    cb({ setValue: () => ({ onChange: (fn: any) => { Setting._lastOnChangeCallbacks.push(fn); } }) });
    return this;
  }
  addColorPicker(cb: any) {
    cb({ setValue: () => ({ onChange: (fn: any) => { Setting._lastOnChangeCallbacks.push(fn); } }) });
    return this;
  }
  addSlider(cb: any) {
    const slider: any = {};
    slider.setLimits = () => slider;
    slider.setValue = () => slider;
    slider.setDynamicTooltip = () => slider;
    slider.onChange = (fn: any) => { Setting._lastOnChangeCallbacks.push(fn); return slider; };
    cb(slider);
    return this;
  }
}
export const setIcon = vi.fn();
export function setTooltip() {}

// Mirror Obsidian's normalizePath: backslashes -> forward, collapse repeats, trim
// surrounding slashes/whitespace.
export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

export class FuzzySuggestModal<T> {
  app: any;
  constructor(app: any) { this.app = app; }
  getItems(): T[] { return []; }
  getItemText(_item: T): string { return ''; }
  onChooseItem(_item: T, _evt: any): void {}
  setPlaceholder(_text: string): void {}
  open(): void {}
  close(): void {}
}
