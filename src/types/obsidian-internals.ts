import type { TFile } from 'obsidian';

/**
 * Obsidian Canvas internals — undocumented, modeled structurally from observed usage.
 * Only the members this plugin actually touches are declared; members are optional
 * wherever the calling code already guards for their absence.
 */

/** A Canvas node (text card or file card). */
export interface CanvasNodeLike {
  /** Present on text nodes; used to detect them among a selection. */
  text?: string;
  setText(text: string): void;
  /** Present on file nodes. */
  file?: TFile;
  contentEl?: HTMLElement;
}

export interface CanvasLike {
  selection?: Set<CanvasNodeLike>;
  nodes: Map<string, CanvasNodeLike>;
  requestSave(): void;
  getViewportBBox?(): { minX: number; minY: number; maxX: number; maxY: number };
  createFileNode(opts: {
    pos: { x: number; y: number };
    size: { width: number; height: number };
    file: TFile;
  }): void;
  cardMenuEl?: HTMLElement;
}

/** A workspace leaf's view when (and only when) it hosts an Obsidian Canvas. */
export interface CanvasViewLike {
  canvas?: CanvasLike;
  contentEl?: HTMLElement;
}

/**
 * @jaames/iro color picker — typed structurally from the members this plugin uses,
 * since iro's shipped types don't cover this call pattern.
 */
export interface IroColorLike {
  hexString: string;
}

export interface IroColorPickerLike {
  on(event: string, cb: (color: IroColorLike) => void): void;
  color: IroColorLike;
}

export interface IroModuleLike {
  ColorPicker(
    parent: HTMLElement,
    props: {
      width: number;
      color: string;
      layout: Array<{ component: unknown; options?: { sliderType: string } }>;
    },
  ): IroColorPickerLike;
  ui: { Wheel: unknown; Slider: unknown };
}
