import iro from '@jaames/iro';
import type { SurfaceManager } from './surface-manager';
import type { DrawingSurface, ToolName } from './drawing-surface';
import { setToolbarIcon, setSizeDotIcon, type IconName } from './toolbar-icons';
import type { PluginSettings } from '../domain/entities';
import { DEFAULT_PLUGIN_SETTINGS } from '../domain/entities';

// Minimal typings for the parts of iro.js we use (the package ships loose types).
interface IroColorPickerInstance {
  on(event: string, cb: (color: { hexString: string }) => void): void;
  color: { hexString: string };
}
interface IroStatic {
  ColorPicker: (el: HTMLElement, opts: unknown) => IroColorPickerInstance;
  ui: { Wheel: unknown; Slider: unknown };
}

const TOOLS: Array<{ name: ToolName; icon: IconName; label: string }> = [
  { name: 'pen', icon: 'pen', label: 'Pen' },
  { name: 'highlighter', icon: 'highlighter', label: 'Highlighter' },
  { name: 'eraser', icon: 'eraser', label: 'Eraser' },
];
// Pen and eraser share the finer pen scale; the highlighter gets its own markedly wider
// scale so a marker reads like a marker rather than a fat pen (QA4). Each is five presets.
const PEN_SIZES = [2, 4, 8, 16, 30];
const HIGHLIGHTER_SIZES = [8, 14, 22, 32, 44];

/**
 * One floating toolbar shared by every drawing surface. Lives over the workspace,
 * follows the active surface (SurfaceManager), and collapses to a corner pill.
 * Hidden when no drawing is active.
 */
export class GlobalToolbar {
  private root: HTMLElement;
  private pill: HTMLElement;
  private toolButtons = new Map<ToolName, HTMLElement>();
  private colorWell!: HTMLElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private colorPopover!: HTMLElement;
  private sizePopover!: HTMLElement;
  private sizeRow!: HTMLElement;
  private sizeBtn!: HTMLElement;
  // iro.ColorPicker — typed loosely because iro ships no strict types we can import
  private picker: IroColorPickerInstance | null = null;
  private surface: DrawingSurface | null = null;
  private anchorEl: HTMLElement | null = null;
  // Anchor for the persistent pill on a Markdown/Canvas view that has no active surface yet.
  // null on views where drawing makes no sense (graph, settings, …) so the toolbar stays hidden.
  private hostEl: HTMLElement | null = null;
  // Controls that only act on an active surface; disabled in the no-surface (host-only) state.
  private surfaceControls: HTMLButtonElement[] = [];
  private collapsed = false;
  // Gates the persistent no-surface pill on Markdown/Canvas hosts (settings.showToolbarPill).
  // When false, a host with no active surface shows nothing; an active surface is unaffected.
  private pillEnabled = true;
  // True while the collapse is forced by the no-surface pill (not chosen by the user), so a
  // newly-activated drawing knows to expand rather than inherit the empty-page pill.
  private pillForcedByNoSurface = false;
  private unsub: () => void;
  private unsubStroke: () => void;
  private unsubStrokeEnd: () => void;
  private onResize: () => void;
  // iPad home-indicator inset; the toolbar is kept above this to avoid clipping.
  private safeBottom = 0;

  // The eight color-popover shortcuts in display order, sourced from plugin settings.
  private readonly paletteColors: string[];

  constructor(private host: HTMLElement, private manager: SurfaceManager, private onNewDrawing?: () => void, private onInsertExisting?: () => void, settings?: PluginSettings) {
    this.paletteColors = settings?.paletteColors ?? DEFAULT_PLUGIN_SETTINGS.paletteColors;
    this.pillEnabled = settings?.showToolbarPill ?? DEFAULT_PLUGIN_SETTINGS.showToolbarPill;
    this.root = host.createDiv({ cls: 'blackboard-global-toolbar' });
    this.pill = host.createDiv({ cls: 'blackboard-global-toolbar-pill' });
    this.build();
    // Toolbar and pill positions are fixed (no drag). Pointer-driven drag caused
    // Apple Pencil hover to visually jitter the toolbar during drawing.
    this.pill.addEventListener('pointerup', (e) => { e.stopPropagation(); this.setCollapsed(false); });
    this.hide();
    this.unsub = manager.onChange((s, el) => this.onSurfaceChange(s, el));
    // Starting to draw closes any open popover.
    this.unsubStroke = manager.onStrokeStart(() => this.closePopovers());
    // Finishing a stroke re-syncs derived controls (notably undo/redo enablement) so the
    // undo arrow lights up immediately after the first stroke, not on the next tap (QA3).
    this.unsubStrokeEnd = manager.onStrokeEnd(() => this.sync());
    this.measureSafeBottom();
    this.onResize = () => { this.measureSafeBottom(); this.reposition(); };
    window.addEventListener('resize', this.onResize);
    // The iPad floating mini-keyboard and orientation changes resize/scroll the VISUAL
    // viewport (not the layout viewport), so window 'resize' alone misses them and the
    // toolbar drifts off-centre. Re-centre on those too.
    window.addEventListener('orientationchange', this.onResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.onResize);
      window.visualViewport.addEventListener('scroll', this.onResize);
    }
  }

  /** Read env(safe-area-inset-bottom) via a probe so the palette clears the
   * iPad home indicator. Zero on desktop. */
  private measureSafeBottom(): void {
    const probe = createDiv();
    probe.className = 'blackboard-safe-area-probe';
    document.body.appendChild(probe);
    this.safeBottom = probe.getBoundingClientRect().height || 0;
    probe.remove();
  }

  private build(): void {
    for (const t of TOOLS) {
      const btn = this.iconButton(t.icon, t.label);
      btn.dataset.tool = t.name;
      btn.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        // Per-tool colour memory: each tool keeps its OWN stored colour, so switching
        // tools must NOT carry the active colour across (carrying it turned the
        // highlighter white when switching from a white pen). The shared ToolManager
        // already holds pen/highlighter colours independently; we just select the tool.
        const prevTool = this.surface?.activeTool;
        // Selecting the eraser while the colour popover is open would otherwise lose the
        // in-progress wheel selection (the eraser has no colour). Save it to the
        // previously-active tool FIRST, while pen/highlighter is still active, then switch.
        if (
          t.name === 'eraser' &&
          this.colorPopover.style.display !== 'none' &&
          (prevTool === 'pen' || prevTool === 'highlighter')
        ) {
          const color = this.surface?.activeColor;
          if (color !== undefined) this.surface?.setColor(color);
        }
        this.surface?.setTool(t.name);
        this.sync();
        this.closePopovers();
      });
      this.toolButtons.set(t.name, btn);
      this.surfaceControls.push(btn);
      this.root.appendChild(btn);
    }
    this.root.appendChild(this.separator());

    this.colorWell = createEl('button');
    // Spectrum-only: the conic rainbow fills the whole well, with no center-color dot.
    this.colorWell.className = 'blackboard-gt-swatch blackboard-gt-colorwell';
    this.colorWell.setAttribute('aria-label', 'Color');
    this.colorWell.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      // The eraser has no color, so the color picker is a no-op while it is active.
      if (this.surface?.activeTool === 'eraser') return;
      this.togglePopover('color');
    });
    this.surfaceControls.push(this.colorWell as HTMLButtonElement);
    this.root.appendChild(this.colorWell);

    const sizeBtn = this.iconButton('size', 'Brush size');
    sizeBtn.classList.add('blackboard-gt-size-btn');
    sizeBtn.addEventListener('pointerup', (e) => { e.stopPropagation(); this.togglePopover('size'); });
    this.surfaceControls.push(sizeBtn);
    this.sizeBtn = sizeBtn;
    this.root.appendChild(sizeBtn);
    this.root.appendChild(this.separator());

    this.undoBtn = this.iconButton('undo', 'Undo');
    this.undoBtn.dataset.action = 'undo';
    this.undoBtn.addEventListener('pointerup', (e) => { e.stopPropagation(); this.closePopovers(); this.surface?.undo(); this.sync(); });
    this.surfaceControls.push(this.undoBtn);
    this.root.appendChild(this.undoBtn);
    this.redoBtn = this.iconButton('redo', 'Redo');
    this.redoBtn.dataset.action = 'redo';
    this.redoBtn.addEventListener('pointerup', (e) => { e.stopPropagation(); this.closePopovers(); this.surface?.redo(); this.sync(); });
    this.surfaceControls.push(this.redoBtn);
    this.root.appendChild(this.redoBtn);
    this.root.appendChild(this.separator());

    const newBtn = this.iconButton('plus', 'New drawing');
    newBtn.dataset.action = 'new-drawing';
    newBtn.addEventListener('pointerup', (e) => { e.stopPropagation(); this.closePopovers(); this.onNewDrawing?.(); });
    this.root.appendChild(newBtn);

    const insertBtn = this.iconButton('insert-existing', 'Insert existing drawing');
    insertBtn.dataset.action = 'insert-existing';
    insertBtn.addEventListener('pointerup', (e) => { e.stopPropagation(); this.closePopovers(); this.onInsertExisting?.(); });
    this.root.appendChild(insertBtn);
    this.root.appendChild(this.separator());

    const collapseBtn = this.iconButton('collapse', 'Minimize toolbar');
    collapseBtn.addEventListener('pointerup', (e) => { e.stopPropagation(); this.setCollapsed(true); });
    this.root.appendChild(collapseBtn);

    this.buildColorPopover();
    this.buildSizePopover();
  }

  private buildColorPopover(): void {
    this.colorPopover = this.host.createDiv({ cls: 'blackboard-gt-popover blackboard-gt-color-popover' });
    this.colorPopover.setCssStyles({ display: 'none' });
    this.colorPopover.addEventListener('pointerdown', (e) => e.stopPropagation());

    const swatches = this.colorPopover.createDiv({ cls: 'blackboard-gt-swatches' });
    // The eight swatches are pure shortcuts sourced from settings.paletteColors, in order.
    for (const color of this.paletteColors) {
      const sw = createEl('button');
      sw.className = 'blackboard-gt-swatch';
      sw.style.backgroundColor = color;
      sw.addEventListener('pointerup', (e) => { e.stopPropagation(); this.pickColor(color); });
      swatches.appendChild(sw);
    }

    const wheel = this.colorPopover.createDiv({ cls: 'blackboard-gt-wheel' });
    try {
      const I = iro as unknown as IroStatic;
      this.picker = I.ColorPicker(wheel, {
        width: 150,
        color: '#ffffff',
        layout: [
          { component: I.ui.Wheel },
          { component: I.ui.Slider, options: { sliderType: 'value' } },
        ],
      });
      this.picker.on('color:change', (c: { hexString: string }) => {
        // Arbitrary wheel colors set the active tool color but never rewrite paletteColors.
        this.surface?.setColor(c.hexString);
      });
    } catch {
      this.picker = null;
    }
  }

  private buildSizePopover(): void {
    this.sizePopover = this.host.createDiv({ cls: 'blackboard-gt-popover blackboard-gt-size-popover' });
    this.sizePopover.setCssStyles({ display: 'none' });
    this.sizePopover.addEventListener('pointerdown', (e) => e.stopPropagation());
    const label = this.sizePopover.createDiv({ cls: 'blackboard-gt-popover-label' });
    label.textContent = 'Brush size';
    this.sizeRow = this.sizePopover.createDiv({ cls: 'blackboard-gt-size-row' });
    this.rebuildSizeDots();
  }

  /** The preset size scale for the active tool: the highlighter's own wider scale, else the
   * shared pen scale (also used by the eraser). */
  private presetsForActiveTool(): number[] {
    return this.surface?.activeTool === 'highlighter' ? HIGHLIGHTER_SIZES : PEN_SIZES;
  }

  /** (Re)build the popover dots for the active tool's preset scale, then highlight the dot
   * matching the active size. Called on build and each time the size popover opens, so
   * switching tools swaps the pen scale for the highlighter scale (QA4). */
  private rebuildSizeDots(): void {
    const sizes = this.presetsForActiveTool();
    this.sizeRow.empty();
    const min = sizes[0];
    const max = sizes[sizes.length - 1];
    for (const size of sizes) {
      const dot = createEl('button');
      dot.className = 'blackboard-gt-size-dot';
      dot.dataset.size = String(size);
      const inner = dot.createDiv({ cls: 'blackboard-gt-size-dot-inner' });
      // Grade the dot diameter WITHIN the active scale (6px smallest → 22px largest) so every
      // dot is visibly distinct — the highlighter's top sizes would otherwise clamp together
      // under the absolute size→diameter mapping.
      const t = max === min ? 0 : (size - min) / (max - min);
      const d = Math.round(6 + t * 16);
      inner.style.width = `${d}px`;
      inner.style.height = `${d}px`;
      dot.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.surface?.setSize(size);
        this.sync();
        // Selecting a size minimizes the popover (visual feedback: choice made).
        this.closePopovers();
      });
      this.sizeRow.appendChild(dot);
    }
    this.refreshSizeDots();
  }

  private onSurfaceChange(s: DrawingSurface | null, el: HTMLElement | null): void {
    this.surface = s;
    if (s) {
      // Anchor to the active view's content area so the toolbar never bleeds over sidebars.
      this.anchorEl = el ? ((el.closest('.view-content')) ?? el) : null;
      // A real drawing means the full toolbar, not the pill. If we were only showing the
      // no-surface pill (forced collapsed), expand now; but preserve a user's own collapse
      // choice when switching between two actual drawings.
      if (this.pillForcedByNoSurface) this.collapsed = false;
      this.pillForcedByNoSurface = false;
      this.setSurfaceControlsEnabled(true);
      // No state is pushed onto the surface: every surface already shares the one
      // ToolManager, so binding simply reflects the global selection (sync()).
      this.show();
      this.sync();
    } else {
      // No active surface: fall back to a persistent pill if the current view is a drawing host.
      this.refreshNoSurface();
    }
  }

  /** Tell the toolbar which Markdown/Canvas view content to anchor the persistent pill to when
   * no surface is active. Pass null on views where drawing makes no sense (hides the toolbar). */
  setHost(anchorEl: HTMLElement | null): void {
    this.hostEl = anchorEl ? ((anchorEl.closest('.view-content')) ?? anchorEl) : null;
    if (!this.surface) this.refreshNoSurface();
  }

  /** Enable/disable the persistent no-surface pill (settings.showToolbarPill). Disabling it
   * hides the pill on a host with no active surface; an active surface is unaffected. */
  setPillEnabled(enabled: boolean): void {
    this.pillEnabled = enabled;
    if (!this.surface) this.refreshNoSurface();
  }

  /** No active surface: show a collapsed pill anchored to the host (if any), else hide. The
   * no-surface toolbar exposes only New-drawing and Insert-existing; the rest is disabled.
   * When the persistent pill is disabled (settings.showToolbarPill === false), the host shows
   * nothing — no pill and no toolbar. */
  private refreshNoSurface(): void {
    if (this.hostEl && this.pillEnabled) {
      this.anchorEl = this.hostEl;
      this.collapsed = true;
      this.pillForcedByNoSurface = true;
      this.setSurfaceControlsEnabled(false);
      this.show();
    } else {
      this.hide();
    }
  }

  private setSurfaceControlsEnabled(enabled: boolean): void {
    for (const btn of this.surfaceControls) btn.disabled = !enabled;
  }

  private anchorRect(): DOMRect {
    return (this.anchorEl ?? this.host).getBoundingClientRect();
  }

  /** Usable region: the active view's rect, intersected with the visible viewport
   * (minus the bottom safe-area inset) and inset by a 12px margin. */
  private bounds(): { left: number; right: number; top: number; bottom: number } {
    const r = this.anchorRect();
    // Clamp to the VISIBLE viewport bottom (visualViewport excludes the floating
    // mini-keyboard) so the toolbar stays above the keyboard rather than behind it;
    // fall back to the layout viewport when visualViewport is unavailable.
    const vv = window.visualViewport;
    const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    let bottom = Math.min(r.bottom, visibleBottom - this.safeBottom) - 12;
    // Keep clear of Obsidian's native Canvas card menu (also bottom-centred), on any
    // device/size, by sitting above it whenever it is present and visible.
    const cardMenu = this.anchorEl?.querySelector('.canvas-card-menu') as HTMLElement | null;
    if (cardMenu) {
      const cm = cardMenu.getBoundingClientRect();
      if (cm.height > 0 && cm.top < bottom) bottom = cm.top - 8;
    }
    return {
      left: r.left + 12,
      right: r.right - 12,
      top: Math.max(r.top, 0) + 12,
      bottom,
    };
  }

  /** Re-pin the toolbar/pill to their fixed positions (call on resize or layout change).
   * Idempotent: repeated calls do not jiggle the toolbar. */
  reposition(): void {
    if (!this.surface && !this.hostEl) return;
    if (this.collapsed) this.placePill();
    else this.placeToolbar();
  }

  /** Toolbar: always bottom-centre of the active view. */
  private placeToolbar(): void {
    const b = this.bounds();
    this.root.style.maxWidth = `${Math.max(120, b.right - b.left)}px`;
    const w = this.root.offsetWidth || 220;
    const h = this.root.offsetHeight || 48;
    this.root.style.left = `${Math.max(b.left, Math.round((b.left + b.right) / 2 - w / 2))}px`;
    this.root.style.top = `${Math.max(b.top, b.bottom - h)}px`;
  }

  /** Pill: always pinned to the right edge, vertically centred. */
  private placePill(): void {
    const b = this.bounds();
    const s = this.pill.offsetWidth || 56;
    this.pill.style.left = `${Math.max(b.left, b.right - s)}px`;
    this.pill.style.top = `${Math.max(b.top, Math.round((b.top + b.bottom) / 2 - s / 2))}px`;
  }

  private sync(): void {
    if (!this.surface) return;
    for (const [name, btn] of this.toolButtons) {
      btn.classList.toggle('active', name === this.surface.activeTool);
    }
    this.updateToolTints();
    this.updateSizeIcon();
    this.undoBtn.disabled = !this.surface.canUndo();
    this.redoBtn.disabled = !this.surface.canRedo();
    this.refreshSizeDots();
    if (this.collapsed) this.updatePillIcon();
  }

  /** Highlight the size dot whose `data-size` equals the active tool's current size. */
  private refreshSizeDots(): void {
    if (!this.surface) return;
    const active = this.surface.activeSize;
    for (const dot of Array.from(this.sizePopover.querySelectorAll<HTMLElement>('.blackboard-gt-size-dot'))) {
      dot.classList.toggle('active', Number(dot.dataset.size) === active);
    }
  }

  /** White circle on the size button, scaled to the active tool's current brush size. */
  private updateSizeIcon(): void {
    if (!this.surface) return;
    setSizeDotIcon(this.sizeBtn, this.surface.activeSize);
  }

  /** Tint the pen/highlighter glyphs to their tool's colour. The eraser has no colour, so its
   * glyph is left untinted, and selecting the eraser never disturbs the pen/highlighter tints. */
  private updateToolTints(): void {
    if (!this.surface) return;
    const pen = this.toolButtons.get('pen');
    const highlighter = this.toolButtons.get('highlighter');
    if (pen) pen.style.color = this.surface.penColor;
    if (highlighter) highlighter.style.color = this.surface.highlighterColor;
  }

  private pickColor(color: string): void {
    this.surface?.setColor(color);
    if (this.picker) { try { this.picker.color.hexString = color; } catch { /* ignore */ } }
    // Selecting a preset swatch is a committed choice — close the popover.
    this.closePopovers();
  }

  private togglePopover(which: 'color' | 'size'): void {
    const target = which === 'color' ? this.colorPopover : this.sizePopover;
    const other = which === 'color' ? this.sizePopover : this.colorPopover;
    other.setCssStyles({ display: 'none' });
    const open = target.style.display === 'none';
    this.closePopovers();
    if (open) {
      target.setCssStyles({ display: '' });
      if (which === 'color' && this.picker && this.surface) {
        try { this.picker.color.hexString = this.surface.activeColor; } catch { /* ignore */ }
      }
      // When the size popover opens, (re)build its dots for the active tool's scale (pen vs
      // highlighter) and highlight the dot matching the active size — sync() only runs on
      // selection otherwise.
      if (which === 'size') this.rebuildSizeDots();
      this.positionPopover(target);
    }
  }

  private closePopovers(): void {
    this.colorPopover.setCssStyles({ display: 'none' });
    this.sizePopover.setCssStyles({ display: 'none' });
  }

  private positionPopover(p: HTMLElement): void {
    // position:fixed in viewport coords; anchored above the toolbar and clamped
    // horizontally within the active view so it doesn't overflow sidebars.
    const r = this.root.getBoundingClientRect();
    const a = this.anchorRect();
    const left = Math.min(Math.max(a.left + 8, r.left), a.right - p.offsetWidth - 8);
    p.style.left = `${Math.max(8, left)}px`;
    p.style.top = `${Math.max(8, r.top - p.offsetHeight - 8)}px`;
  }

  private setCollapsed(c: boolean): void {
    this.collapsed = c;
    // An explicit collapse/expand is the user taking control; stop treating it as the forced pill.
    this.pillForcedByNoSurface = false;
    this.closePopovers();
    // Allow expand/collapse in the host-only (no-surface) state too, not just when drawing.
    if (!this.surface && !this.hostEl) return;
    this.root.setCssStyles({ display: c ? 'none' : '' });
    this.pill.setCssStyles({ display: c ? '' : 'none' });
    if (c) { this.updatePillIcon(); this.placePill(); }
    else this.placeToolbar();
  }

  private updatePillIcon(): void {
    const tool = this.surface?.activeTool ?? 'pen';
    const icon = TOOLS.find((t) => t.name === tool)?.icon ?? 'pen';
    setToolbarIcon(this.pill, icon);
  }

  private show(): void {
    // Set display BEFORE measuring so offsetWidth/Height are non-zero.
    if (this.collapsed) { this.pill.setCssStyles({ display: '' }); this.root.setCssStyles({ display: 'none' }); this.updatePillIcon(); this.placePill(); }
    else { this.root.setCssStyles({ display: '' }); this.pill.setCssStyles({ display: 'none' }); this.placeToolbar(); }
  }

  private hide(): void {
    this.root.setCssStyles({ display: 'none' });
    this.pill.setCssStyles({ display: 'none' });
    this.closePopovers();
  }

  private iconButton(icon: IconName, label: string): HTMLButtonElement {
    const btn = createEl('button');
    btn.className = 'blackboard-gt-btn';
    btn.setAttribute('aria-label', label);
    setToolbarIcon(btn, icon);
    return btn;
  }

  private separator(): HTMLElement {
    const s = createDiv();
    s.className = 'blackboard-gt-sep';
    return s;
  }

  destroy(): void {
    this.unsub();
    this.unsubStroke();
    this.unsubStrokeEnd();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.onResize);
      window.visualViewport.removeEventListener('scroll', this.onResize);
    }
    this.root.remove();
    this.pill.remove();
    this.colorPopover.remove();
    this.sizePopover.remove();
  }
}
