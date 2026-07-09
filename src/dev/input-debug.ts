// On-screen input event logger for diagnosing stylus behavior on devices where a
// remote console isn't available (e.g. Apple Pencil in Obsidian's iPad WKWebView).
// The diagnostics overlay ships dormant: `inputDebugEnabled` stays false in release
// builds (no user-facing command toggles it). `toggleInputDebug` is retained for
// local development — flip it from a temporary command or the console when debugging.

const EVENTS = [
  'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
  'gotpointercapture', 'lostpointercapture',
  'touchstart', 'touchmove', 'touchend', 'touchcancel',
  'mousedown', 'mouseup', 'click',
];

const MAX_LINES = 30;

interface Entry { text: string; count: number; }

let enabled = false;
let overlay: HTMLElement | null = null;
let entries: Entry[] = [];
let listener: ((e: Event) => void) | null = null;

function targetDesc(t: EventTarget | null): string {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return '?';
  const cls = typeof el.className === 'string' && el.className.trim()
    ? '.' + el.className.trim().split(/\s+/)[0]
    : '';
  return el.tagName.toLowerCase() + cls;
}

function flush(): void {
  if (overlay) {
    overlay.textContent = entries
      .map((e) => (e.count > 1 ? `${e.text} ×${e.count}` : e.text))
      .join('\n');
  }
}

function add(text: string, collapsible: boolean): void {
  const last = entries[entries.length - 1];
  if (collapsible && last && last.text === text) {
    last.count++;
  } else {
    entries.push({ text, count: 1 });
    if (entries.length > MAX_LINES) entries.shift();
  }
  flush();
}

function onEvent(e: Event): void {
  const pe = e as PointerEvent;
  const isPointer = typeof (pe as { pointerId?: number }).pointerId === 'number';
  const moveLike = e.type === 'pointermove' || e.type === 'touchmove' || e.type === 'mousemove';
  let text = e.type;
  if (isPointer) {
    const pressure = typeof pe.pressure === 'number' ? pe.pressure.toFixed(2) : '?';
    text += ` #${pe.pointerId} ${pe.pointerType} b${pe.buttons} p${pressure}`;
  }
  if (!moveLike) text += ` -> ${targetDesc(e.target)}`;
  add(text, moveLike);
}

export function inputDebugEnabled(): boolean {
  return enabled;
}

/**
 * Log a message from inside the real input handlers (e.g. why a pointerdown was
 * accepted or rejected). Prefixed with ">>" and never collapsed, so the accept/reject
 * decisions for each stroke stand out against the raw event stream.
 */
export function inputDebugLog(text: string): void {
  if (enabled) add('>> ' + text, false);
}

/** Toggle the overlay + listeners. Returns the new enabled state. */
export function toggleInputDebug(): boolean {
  if (enabled) {
    if (listener) {
      for (const type of EVENTS) activeDocument.removeEventListener(type, listener, true);
    }
    listener = null;
    overlay?.remove();
    overlay = null;
    entries = [];
    enabled = false;
    return false;
  }

  entries = [];
  overlay = createDiv();
  overlay.className = 'blackboard-input-debug';
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', zIndex: '99999',
    maxWidth: '60vw', maxHeight: '80vh', overflow: 'hidden',
    padding: '6px 8px', margin: '0',
    background: 'rgba(0,0,0,0.78)', color: '#0f0',
    font: '10px/1.35 ui-monospace, Menlo, monospace',
    whiteSpace: 'pre', pointerEvents: 'none',
    borderBottomRightRadius: '6px',
  } as Partial<CSSStyleDeclaration>);
  overlay.textContent = 'Blackboard input debug: waiting for events…';
  activeDocument.body.appendChild(overlay);

  listener = onEvent;
  for (const type of EVENTS) activeDocument.addEventListener(type, listener, true);
  enabled = true;
  return true;
}
