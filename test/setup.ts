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

// Obsidian DOM helper globals that jsdom lacks. Each returns a DETACHED element.
interface DomElInfo {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
}

function applyElInfo(el: HTMLElement, opts?: DomElInfo): void {
  if (!opts) return;
  if (opts.cls) el.className = Array.isArray(opts.cls) ? opts.cls.join(' ') : opts.cls;
  if (opts.text != null) el.textContent = opts.text;
  if (opts.attr) {
    for (const [k, v] of Object.entries(opts.attr)) {
      if (v != null) el.setAttribute(k, String(v));
    }
  }
}

const g = globalThis as unknown as {
  createEl?: (tag: string, opts?: DomElInfo) => HTMLElement;
  createDiv?: (opts?: DomElInfo) => HTMLElement;
  createSpan?: (opts?: DomElInfo) => HTMLElement;
  createFragment?: () => DocumentFragment;
  activeDocument?: Document;
  activeWindow?: Window;
};

g.createEl ??= (tag: string, opts?: DomElInfo): HTMLElement => {
  const el = document.createElement(tag);
  applyElInfo(el, opts);
  return el;
};

g.createDiv ??= (opts?: DomElInfo): HTMLElement => {
  const el = document.createElement('div');
  applyElInfo(el, opts);
  return el;
};

g.createSpan ??= (opts?: DomElInfo): HTMLElement => {
  const el = document.createElement('span');
  applyElInfo(el, opts);
  return el;
};

g.createFragment ??= (): DocumentFragment => document.createDocumentFragment();

g.activeDocument ??= document;
g.activeWindow ??= window;

if (!(HTMLElement.prototype as unknown as { setCssStyles?: unknown }).setCssStyles) {
  (HTMLElement.prototype as unknown as {
    setCssStyles: (styles: Partial<CSSStyleDeclaration>) => void;
  }).setCssStyles = function (styles: Partial<CSSStyleDeclaration>) {
    Object.assign(this.style, styles);
  };
}

if (!(HTMLElement.prototype as unknown as { setCssProps?: unknown }).setCssProps) {
  (HTMLElement.prototype as unknown as {
    setCssProps: (props: Record<string, string | number>) => void;
  }).setCssProps = function (props: Record<string, string | number>) {
    for (const [k, v] of Object.entries(props)) {
      this.style.setProperty(k, String(v));
    }
  };
}

if (typeof globalThis.URL.createObjectURL !== 'function') {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
}

if (typeof globalThis.URL.revokeObjectURL !== 'function') {
  globalThis.URL.revokeObjectURL = vi.fn();
}
