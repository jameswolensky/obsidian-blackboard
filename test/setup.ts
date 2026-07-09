import { vi } from 'vitest';

// Polyfill ResizeObserver for jsdom
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

if (!HTMLElement.prototype.empty) {
  HTMLElement.prototype.empty = function () {
    this.innerHTML = '';
  };
}

if (!HTMLElement.prototype.addClass) {
  (HTMLElement.prototype as any).addClass = function (cls: string) {
    this.classList.add(cls);
  };
}

if (!HTMLElement.prototype.createDiv) {
  (HTMLElement.prototype as any).createDiv = function (opts?: { cls?: string; text?: string }) {
    const div = document.createElement('div');
    if (opts?.cls) div.className = opts.cls;
    if (opts?.text) div.textContent = opts.text;
    this.appendChild(div);
    return div;
  };
}

if (!HTMLElement.prototype.createEl) {
  (HTMLElement.prototype as any).createEl = function (tag: string, opts?: { cls?: string; text?: string }) {
    const el = document.createElement(tag);
    if (opts?.cls) el.className = opts.cls;
    if (opts?.text) el.textContent = opts.text;
    this.appendChild(el);
    return el;
  };
}

if (typeof globalThis.URL.createObjectURL !== 'function') {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
}

if (typeof globalThis.URL.revokeObjectURL !== 'function') {
  globalThis.URL.revokeObjectURL = vi.fn();
}

// Obsidian runtime globals (obsidian.d.ts declares them; the app provides them).
// activeDocument/activeWindow alias the focused window — in jsdom that's the one window.
(globalThis as any).activeDocument = document;
(globalThis as any).activeWindow = window;
if (typeof (globalThis as any).createEl !== 'function') {
  (globalThis as any).createEl = (tag: string, o?: { cls?: string; text?: string }) => {
    const el = document.createElement(tag);
    if (o?.cls) el.className = o.cls;
    if (o?.text) el.textContent = o.text;
    return el;
  };
}
if (typeof (globalThis as any).createDiv !== 'function') {
  (globalThis as any).createDiv = (o?: { cls?: string; text?: string }) =>
    (globalThis as any).createEl('div', o);
}
