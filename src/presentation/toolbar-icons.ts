/**
 * Inline SVG icons for the global toolbar.
 *
 * We deliberately do NOT use Obsidian's `setIcon`/lucide here: lucide icon names
 * vary between Obsidian desktop and mobile (iPad) builds, and a missing name
 * renders nothing — which showed up on iPad as "no icons at all". Bundling our
 * own high-contrast SVGs guarantees identical rendering on every platform.
 *
 * Each icon is a 24x24, stroke-based glyph using `currentColor`, so button color
 * (and the .active accent) controls appearance.
 */
export type IconName =
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'size'
  | 'undo'
  | 'redo'
  | 'collapse'
  | 'plus'
  | 'insert-existing';

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS: Record<IconName, string> = {
  pen: svg('<path d="M4 20l4-1L19 8l-3-3L6 16l-2 4z"/><path d="M14 7l3 3"/>'),
  highlighter: svg(
    '<path d="M9 11l6-6a2 2 0 0 1 3 3l-6 6z"/><path d="M9 11l-4 4v4h4l4-4"/><path d="M4 21h16"/>',
  ),
  eraser: svg(
    '<g transform="rotate(-45 12 12)"><rect x="4" y="9" width="16" height="7" rx="2"/>' +
      '<line x1="12" y1="9" x2="12" y2="16"/></g><path d="M5 21h14"/>',
  ),
  size: svg(
    '<circle cx="7" cy="12" r="2" fill="currentColor" stroke="none"/>' +
      '<circle cx="16" cy="12" r="4" fill="currentColor" stroke="none"/>',
  ),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-6"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h6"/>'),
  collapse: svg('<path d="M7 4l5 5 5-5"/><path d="M7 20l5-5 5 5"/>'),
  plus: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  // Framed drawing with a "+" — insert an existing drawing into the page.
  'insert-existing': svg(
    '<rect x="3" y="4" width="12" height="12" rx="2"/>' +
      '<circle cx="7" cy="8" r="1.2" fill="currentColor" stroke="none"/>' +
      '<path d="M3 13l3-3 2 2 3-3 4 4"/>' +
      '<line x1="18" y1="14" x2="18" y2="20"/><line x1="15" y1="17" x2="21" y2="17"/>',
  ),
};

/**
 * Turn a trusted, static SVG string into a real DOM node (no `innerHTML` — Obsidian's
 * review guidelines forbid it). Parsing the exact same markup keeps rendering identical
 * across platforms, which is the whole reason we ship our own SVGs (see the file header).
 */
function svgToNode(markup: string): Node {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  return document.importNode(doc.documentElement, true);
}

export function setToolbarIcon(el: HTMLElement, name: IconName): void {
  el.empty();
  el.appendChild(svgToNode(ICONS[name]));
}

/**
 * Map a brush size to the diameter (px) of its indicator dot. Strictly increasing so
 * every preset size renders a visibly distinct dot — the two smallest sizes (2 and 4)
 * previously collapsed to the same dot because the old clamp floored the diameter at 4.
 * Capped at 22 to stay within the 24x24 viewBox / button bounds.
 */
export function sizeToDotDiameter(size: number): number {
  return Math.min(22, size + 2);
}

/**
 * Render the brush-size button glyph: a single white-filled circle whose diameter
 * scales with the brush size (see `sizeToDotDiameter`), mirroring the increasingly-
 * larger white dots in the size popover. Kept within the 24x24 viewBox.
 */
export function setSizeDotIcon(el: HTMLElement, size: number): void {
  const d = sizeToDotDiameter(size);
  el.empty();
  el.appendChild(svgToNode(
    `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">` +
    `<circle cx="12" cy="12" r="${d / 2}" fill="#ffffff" stroke="none"/></svg>`,
  ));
}
