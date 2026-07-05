export interface EmbedSize { width: string | null; height: string | null; }

/**
 * Parse Obsidian's embed size alias (the text after `|` in `![[file|...]]`):
 *   "640x480" -> {width:"640px", height:"480px"}
 *   "300"     -> {width:"300px", height:null}
 *   "100%"    -> {width:"100%",  height:null}
 *   "100%x400"-> {width:"100%",  height:"400px"}
 * Returns null when there's no usable size.
 */
/**
 * Fit a drawing's saved size into the available note width, preserving aspect ratio.
 * Used for no-alias Markdown embeds so they render at the drawing's natural size,
 * scaled down (never up) to fit the note. Returns null for a degenerate saved size.
 */
export function fitSavedEmbedSize(
  savedW: number,
  savedH: number,
  availableWidth: number,
): { width: number; height: number } | null {
  if (savedW <= 0 || savedH <= 0) return null;
  if (availableWidth > 0 && savedW > availableWidth) {
    const scale = availableWidth / savedW;
    return { width: Math.floor(savedW * scale), height: Math.floor(savedH * scale) };
  }
  return { width: savedW, height: savedH };
}

export function parseEmbedSize(alias: string | null | undefined): EmbedSize | null {
  if (!alias) return null;
  const m = alias.trim().match(/^(\d+%?)(?:x(\d+))?$/);
  if (!m) return null;
  const wNum = parseInt(m[1], 10);
  if (wNum === 0) return null;                       // a zero width would collapse the embed
  const w = m[1].endsWith('%') ? m[1] : `${m[1]}px`;
  const h = m[2] && parseInt(m[2], 10) > 0 ? `${m[2]}px` : null;
  return { width: w, height: h };
}
