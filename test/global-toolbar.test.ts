import { describe, it, expect, vi, afterEach } from 'vitest';
import { GlobalToolbar } from '../src/presentation/global-toolbar';
import { setSizeDotIcon } from '../src/presentation/toolbar-icons';
import { SurfaceManager } from '../src/presentation/surface-manager';
import type { DrawingSurface, ToolName } from '../src/presentation/drawing-surface';
import { ToolManager } from '../src/domain/tool-manager';
import { DEFAULT_TOOL_STATE, DEFAULT_PLUGIN_SETTINGS } from '../src/domain/entities';
import type { PluginSettings } from '../src/domain/entities';

/** A surface backed by a shared ToolManager — mirrors `engineSurface` so the toolbar
 * drives the one global tool state (fix-tool-state-isolation). */
function sharedSurface(tm: ToolManager): DrawingSurface {
  return {
    setTool: (t) => tm.setTool(t),
    setColor: (c) => tm.setColor(c),
    setSize: (s) => tm.setSize(s),
    undo: () => {},
    redo: () => {},
    get activeTool() { return tm.activeTool as ToolName; },
    get activeColor() { return tm.activeColor; },
    get activeSize() { return tm.activeSize; },
    get penColor() { return tm.penColor; },
    get highlighterColor() { return tm.highlighterColor; },
    canUndo: () => false,
    canRedo: () => false,
  };
}

function mockSurface(): DrawingSurface & { setColor: ReturnType<typeof vi.fn>; setTool: ReturnType<typeof vi.fn> } {
  const state = { activeTool: 'pen' as const, activeColor: '#ffffff', activeSize: 4, penColor: '#ffffff', highlighterColor: '#ffff00' };
  return {
    setTool: vi.fn((t: any) => { state.activeTool = t; }),
    setColor: vi.fn((c: string) => { state.activeColor = c; }),
    setSize: vi.fn((s: number) => { state.activeSize = s; }),
    undo: vi.fn(),
    redo: vi.fn(),
    get activeTool() { return state.activeTool; },
    get activeColor() { return state.activeColor; },
    get activeSize() { return state.activeSize; },
    get penColor() { return state.penColor; },
    get highlighterColor() { return state.highlighterColor; },
    canUndo: () => false,
    canRedo: () => false,
  } as any;
}

function pointerup(el: Element | null) {
  el?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
}

describe('GlobalToolbar — per-tool colour memory (QA2: highlighter must stay yellow)', () => {
  let tb: GlobalToolbar | undefined;
  afterEach(() => { tb?.destroy(); tb = undefined; });

  it('selecting the highlighter keeps its own colour (yellow), not the pen colour', () => {
    // Repro: highlighter icon starts yellow but clicking it turned the stroke white,
    // because the toolbar carried the active (pen=white) colour across the switch.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mgr = new SurfaceManager();
    const tm = new ToolManager({ ...DEFAULT_TOOL_STATE }); // pen #ffffff, highlighter #ffff00
    const surface = sharedSurface(tm);
    tb = new GlobalToolbar(host, mgr);
    mgr.register(surface, document.createElement('div'));
    mgr.setActive(surface);

    pointerup(host.querySelector('[data-tool="highlighter"]'));

    expect(surface.activeTool).toBe('highlighter');
    expect(surface.activeColor).toBe('#ffff00'); // its own yellow, NOT the pen's white
  });

  it('each tool keeps its own colour across switches', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mgr = new SurfaceManager();
    const tm = new ToolManager({ ...DEFAULT_TOOL_STATE });
    const surface = sharedSurface(tm);
    tb = new GlobalToolbar(host, mgr);
    mgr.register(surface, document.createElement('div'));
    mgr.setActive(surface);

    pointerup(host.querySelector('[data-tool="highlighter"]'));
    expect(surface.activeColor).toBe('#ffff00');
    pointerup(host.querySelector('[data-tool="pen"]'));
    expect(surface.activeColor).toBe('#ffffff');
  });
});

describe('Brush size dots — QA2: five sizes must be visually distinct', () => {
  function radiusOf(size: number): number {
    const el = document.createElement('div');
    setSizeDotIcon(el, size);
    return Number(el.querySelector('circle')!.getAttribute('r'));
  }

  it('the two smallest sizes (2 and 4) render at different radii', () => {
    // Repro: the size-dot radius was clamped to a floor of 4, so sizes 2 and 4
    // collapsed to the same dot and were indistinguishable.
    expect(radiusOf(2)).not.toBe(radiusOf(4));
  });

  it('all five preset sizes render at strictly increasing radii', () => {
    const radii = [2, 4, 8, 16, 30].map(radiusOf);
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeGreaterThan(radii[i - 1]);
    }
  });
});

describe('GlobalToolbar — QA3: undo/redo light up when a stroke ends', () => {
  let tb: GlobalToolbar | undefined;
  afterEach(() => { tb?.destroy(); tb = undefined; });

  function undoRedoSurface(state: { undoable: boolean; redoable: boolean }): DrawingSurface {
    const tm = new ToolManager({ ...DEFAULT_TOOL_STATE });
    return {
      setTool: (t) => tm.setTool(t),
      setColor: (c) => tm.setColor(c),
      setSize: (s) => tm.setSize(s),
      undo: () => {},
      redo: () => {},
      get activeTool() { return tm.activeTool as ToolName; },
      get activeColor() { return tm.activeColor; },
      get activeSize() { return tm.activeSize; },
      get penColor() { return tm.penColor; },
      get highlighterColor() { return tm.highlighterColor; },
      canUndo: () => state.undoable,
      canRedo: () => state.redoable,
    };
  }

  it('re-enables the undo button when a stroke ends (was stuck disabled after the first stroke)', () => {
    // Repro: drawing the first stroke made the surface undoable, but the toolbar only
    // re-syncs undo/redo on tool/size/surface changes — never on stroke end — so the
    // undo arrow stayed greyed out until the user happened to tap it.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mgr = new SurfaceManager();
    const state = { undoable: false, redoable: false };
    const surface = undoRedoSurface(state);
    tb = new GlobalToolbar(host, mgr);
    mgr.register(surface, document.createElement('div'));
    mgr.setActive(surface);

    const undoBtn = host.querySelector('[data-action="undo"]') as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(true); // nothing drawn yet

    // User draws the first stroke: the surface is now undoable and the stroke ends.
    state.undoable = true;
    mgr.notifyStrokeEnd();

    expect(undoBtn.disabled).toBe(false);
  });
});

describe('GlobalToolbar — QA2: re-centers on viewport changes (mini-keyboard / orientation)', () => {
  let tb: GlobalToolbar | undefined;
  let origVV: unknown;
  beforeEach(() => { origVV = (window as any).visualViewport; });
  afterEach(() => { tb?.destroy(); tb = undefined; (window as any).visualViewport = origVV; });

  function mockVV() {
    const vv = { addEventListener: vi.fn(), removeEventListener: vi.fn(), width: 800, height: 600, offsetTop: 0, offsetLeft: 0 };
    (window as any).visualViewport = vv;
    return vv;
  }

  it('subscribes to visualViewport resize/scroll and window orientationchange', () => {
    const vv = mockVV();
    const winAdd = vi.spyOn(window, 'addEventListener');
    const host = document.createElement('div');
    document.body.appendChild(host);
    tb = new GlobalToolbar(host, new SurfaceManager());

    const vvTypes = vv.addEventListener.mock.calls.map((c) => c[0]);
    expect(vvTypes).toContain('resize');
    expect(vvTypes).toContain('scroll');
    expect(winAdd.mock.calls.map((c) => c[0])).toContain('orientationchange');
    winAdd.mockRestore();
  });

  it('removes the visualViewport + orientationchange listeners on destroy (no leak)', () => {
    const vv = mockVV();
    const winRemove = vi.spyOn(window, 'removeEventListener');
    const host = document.createElement('div');
    document.body.appendChild(host);
    tb = new GlobalToolbar(host, new SurfaceManager());
    tb.destroy();
    tb = undefined;

    const vvTypes = vv.removeEventListener.mock.calls.map((c) => c[0]);
    expect(vvTypes).toContain('resize');
    expect(vvTypes).toContain('scroll');
    expect(winRemove.mock.calls.map((c) => c[0])).toContain('orientationchange');
    winRemove.mockRestore();
  });
});

describe('GlobalToolbar — QA2: popovers auto-close', () => {
  let tb: GlobalToolbar | undefined;
  afterEach(() => { tb?.destroy(); tb = undefined; });

  function setup() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mgr = new SurfaceManager();
    const surface = sharedSurface(new ToolManager({ ...DEFAULT_TOOL_STATE }));
    tb = new GlobalToolbar(host, mgr);
    mgr.register(surface, document.createElement('div'));
    mgr.setActive(surface);
    return { host, mgr };
  }
  const isOpen = (host: HTMLElement, sel: string) =>
    (host.querySelector(sel) as HTMLElement).style.display !== 'none';

  it('selecting a colour swatch closes the colour popover', () => {
    const { host } = setup();
    pointerup(host.querySelector('.blackboard-gt-colorwell'));
    expect(isOpen(host, '.blackboard-gt-color-popover')).toBe(true);
    pointerup(host.querySelector('.blackboard-gt-color-popover .blackboard-gt-swatch'));
    expect(isOpen(host, '.blackboard-gt-color-popover')).toBe(false);
  });

  it('clicking undo closes an open popover', () => {
    const { host } = setup();
    pointerup(host.querySelector('.blackboard-gt-size-btn'));
    expect(isOpen(host, '.blackboard-gt-size-popover')).toBe(true);
    pointerup(host.querySelector('[data-action="undo"]'));
    expect(isOpen(host, '.blackboard-gt-size-popover')).toBe(false);
  });

  it('starting a stroke on the active surface closes an open popover', () => {
    const { host, mgr } = setup();
    pointerup(host.querySelector('.blackboard-gt-size-btn'));
    expect(isOpen(host, '.blackboard-gt-size-popover')).toBe(true);
    mgr.notifyStrokeStart();
    expect(isOpen(host, '.blackboard-gt-size-popover')).toBe(false);
  });
});

describe('GlobalToolbar — tool selection cannot enter a stuck state (shared tool state)', () => {
  let tb: GlobalToolbar | undefined;
  afterEach(() => { tb?.destroy(); tb = undefined; });

  it('re-selecting the pen takes effect after cross-surface switching, and stays consistent everywhere', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mgr = new SurfaceManager();
    tb = new GlobalToolbar(host, mgr);

    // Two surfaces sharing ONE ToolManager (the B4 setup).
    const shared = new ToolManager({ ...DEFAULT_TOOL_STATE });
    const surfaceA = sharedSurface(shared);
    const surfaceB = sharedSurface(shared);
    mgr.register(surfaceA, document.createElement('div'));
    mgr.register(surfaceB, document.createElement('div'));

    // The toolbar tracks surface A while the user actually drew last on B — the stale-
    // surface condition that caused the stuck toolbar.
    mgr.setActive(surfaceA);

    // Switch tools several times across surfaces, leaving the highlighter active.
    pointerup(host.querySelector('[data-tool="highlighter"]'));
    pointerup(host.querySelector('[data-tool="eraser"]'));
    pointerup(host.querySelector('[data-tool="highlighter"]'));
    expect(shared.activeTool).toBe('highlighter');

    // Re-select the pen — must take effect (no stuck state).
    pointerup(host.querySelector('[data-tool="pen"]'));

    expect(shared.activeTool).toBe('pen');
    // The active tool is identical across both surfaces and the toolbar's marked button.
    expect(surfaceA.activeTool).toBe('pen');
    expect(surfaceB.activeTool).toBe('pen');
    expect((host.querySelector('[data-tool="pen"]') as HTMLElement).classList.contains('active')).toBe(true);
    expect((host.querySelector('[data-tool="highlighter"]') as HTMLElement).classList.contains('active')).toBe(false);
  });

  it('binding to a newly-active surface does not push state onto it (reflects shared selection)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mgr = new SurfaceManager();
    tb = new GlobalToolbar(host, mgr);

    const shared = new ToolManager({ ...DEFAULT_TOOL_STATE });
    const surface = sharedSurface(shared);
    // Spy on the mutators: binding must not call them.
    const setTool = vi.spyOn(surface, 'setTool');
    const setColor = vi.spyOn(surface, 'setColor');
    const setSize = vi.spyOn(surface, 'setSize');
    mgr.register(surface, document.createElement('div'));

    mgr.setActive(surface);

    expect(setTool).not.toHaveBeenCalled();
    expect(setColor).not.toHaveBeenCalled();
    expect(setSize).not.toHaveBeenCalled();
  });
});

describe('GlobalToolbar — customizable palette and spectrum-only well', () => {
  let tb: GlobalToolbar | undefined;
  afterEach(() => { tb?.destroy(); tb = undefined; });

  function settingsWith(palette: string[]): PluginSettings {
    return { ...DEFAULT_PLUGIN_SETTINGS, paletteColors: palette };
  }

  function setup(settings?: PluginSettings) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mgr = new SurfaceManager();
    tb = new GlobalToolbar(host, mgr, undefined, undefined, settings);
    const surface = mockSurface();
    mgr.register(surface, document.createElement('div'));
    mgr.setActive(surface);
    return { host, surface };
  }

  it('renders the eight color-popover swatches from settings.paletteColors in order', () => {
    const palette = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888'];
    const { host } = setup(settingsWith(palette));

    const swatches = Array.from(
      host.querySelectorAll<HTMLElement>('.blackboard-gt-color-popover .blackboard-gt-swatch'),
    );
    expect(swatches).toHaveLength(8);
    const probe = document.createElement('div');
    swatches.forEach((sw, i) => {
      probe.style.backgroundColor = palette[i];
      expect(sw.style.backgroundColor).toBe(probe.style.backgroundColor);
    });
  });

  it('clicking the first swatch sets the active color to paletteColors[0]', () => {
    const palette = ['#123456', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888'];
    const { host, surface } = setup(settingsWith(palette));

    pointerup(host.querySelector('.blackboard-gt-colorwell'));
    pointerup(host.querySelector('.blackboard-gt-color-popover .blackboard-gt-swatch'));

    expect(surface.setColor).toHaveBeenCalledWith('#123456');
    expect(surface.activeColor).toBe('#123456');
  });

  it('color well has no center-swatch dot (spectrum-only)', () => {
    const { host } = setup();
    expect(host.querySelector('.blackboard-gt-colorwell-dot')).toBeNull();
  });

  it('picking an arbitrary wheel color does not mutate settings.paletteColors', () => {
    const palette = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888'];
    const settings = settingsWith(palette);
    const { host } = setup(settings);
    const before = [...settings.paletteColors];

    const picker = (tb as any).picker;
    if (picker) {
      // Drive the iro picker as the user dragging the wheel to an off-palette color.
      picker.color.hexString = '#abcdef';
    } else {
      // Fallback when iro can't initialize in jsdom: exercise the same code path directly.
      (tb as any).pickColor('#abcdef');
    }

    expect(settings.paletteColors).toEqual(before);
    // And the swatch DOM still reflects the configured palette unchanged.
    const swatches = Array.from(host.querySelectorAll<HTMLElement>('.blackboard-gt-color-popover .blackboard-gt-swatch'));
    const probe = document.createElement('div');
    swatches.forEach((sw, i) => {
      probe.style.backgroundColor = palette[i];
      expect(sw.style.backgroundColor).toBe(probe.style.backgroundColor);
    });
  });

  it('eraser active: activating the color well opens no popover', () => {
    const { host } = setup();
    const popover = host.querySelector('.blackboard-gt-color-popover') as HTMLElement;

    // Make the eraser the active tool.
    pointerup(host.querySelector('[data-tool="eraser"]'));

    pointerup(host.querySelector('.blackboard-gt-colorwell'));

    expect(popover.style.display).toBe('none');
  });

  it('pen active: activating the color well opens the popover', () => {
    const { host } = setup();
    const popover = host.querySelector('.blackboard-gt-color-popover') as HTMLElement;

    pointerup(host.querySelector('.blackboard-gt-colorwell'));

    expect(popover.style.display).not.toBe('none');
  });

  it('selecting the eraser with the color popover open closes it and saves the color to the previously-active tool', () => {
    const palette = ['#0a0a0a', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888'];
    const { host, surface } = setup(settingsWith(palette));
    const popover = host.querySelector('.blackboard-gt-color-popover') as HTMLElement;

    // Open the popover via the colour well (a swatch pick now closes it, so don't pick one).
    pointerup(host.querySelector('.blackboard-gt-colorwell'));
    expect(popover.style.display).not.toBe('none');
    const penColor = surface.activeColor;

    surface.setColor.mockClear();
    surface.setTool.mockClear();

    // Now select the eraser.
    pointerup(host.querySelector('[data-tool="eraser"]'));

    // Popover closed, eraser active, and the previous tool's color was saved
    // (setColor called BEFORE switching to the eraser).
    expect(popover.style.display).toBe('none');
    expect(surface.setTool).toHaveBeenCalledWith('eraser');
    expect(surface.setColor).toHaveBeenCalledWith(penColor);
    expect(surface.setColor.mock.invocationCallOrder[0])
      .toBeLessThan(surface.setTool.mock.invocationCallOrder[0]);
  });

  it('selecting the eraser with no popover open applies no extra color', () => {
    const { host, surface } = setup();
    // Popover is closed.
    surface.setColor.mockClear();

    pointerup(host.querySelector('[data-tool="eraser"]'));

    expect(surface.setTool).toHaveBeenCalledWith('eraser');
    // The colorless eraser stores nothing: setColor here is a harmless no-op re-apply
    // that never precedes the tool switch (no pre-switch save path runs).
    const setColorOrders = surface.setColor.mock.invocationCallOrder;
    const setToolOrder = surface.setTool.mock.invocationCallOrder.at(-1)!;
    for (const o of setColorOrders) expect(o).toBeGreaterThan(setToolOrder);
  });
});

function stubRect(el: HTMLElement, r: { top: number; bottom: number; left: number; right: number }) {
  el.getBoundingClientRect = () => ({
    top: r.top, bottom: r.bottom, left: r.left, right: r.right,
    width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top, toJSON() {},
  }) as DOMRect;
}

describe('GlobalToolbar — new-drawing (+) button', () => {
  let tb: GlobalToolbar | undefined;
  afterEach(() => { tb?.destroy(); tb = undefined; });

  it('invokes onNewDrawing when the + button is activated', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onNewDrawing = vi.fn();
    tb = new GlobalToolbar(host, new SurfaceManager(), onNewDrawing);

    pointerup(host.querySelector('[data-action="new-drawing"]'));

    expect(onNewDrawing).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the + button is activated with no callback', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    tb = new GlobalToolbar(host, new SurfaceManager());

    const btn = host.querySelector('[data-action="new-drawing"]');
    expect(btn).not.toBeNull();
    expect(() => pointerup(btn)).not.toThrow();
  });
});

describe('GlobalToolbar — insert-existing button', () => {
  let tb: GlobalToolbar | undefined;
  afterEach(() => { tb?.destroy(); tb = undefined; });

  it('invokes onInsertExisting when the insert-existing button is activated', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onInsertExisting = vi.fn();
    tb = new GlobalToolbar(host, new SurfaceManager(), undefined, onInsertExisting);

    pointerup(host.querySelector('[data-action="insert-existing"]'));

    expect(onInsertExisting).toHaveBeenCalledTimes(1);
  });

  it('does not throw when activated with no callback', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    tb = new GlobalToolbar(host, new SurfaceManager());

    const btn = host.querySelector('[data-action="insert-existing"]');
    expect(btn).not.toBeNull();
    expect(() => pointerup(btn)).not.toThrow();
  });
});

describe('GlobalToolbar — persistent pill on host with no surface', () => {
  let tb: GlobalToolbar | undefined;
  afterEach(() => { tb?.destroy(); tb = undefined; });

  function makeToolbar() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mgr = new SurfaceManager();
    tb = new GlobalToolbar(host, mgr, vi.fn(), vi.fn());
    return { host, mgr };
  }

  it('shows the collapsed pill when a drawing host is set with no active surface', () => {
    const { host } = makeToolbar();
    const view = document.createElement('div');
    view.className = 'view-content';

    tb!.setHost(view);

    const root = host.querySelector('.blackboard-global-toolbar') as HTMLElement;
    const pill = host.querySelector('.blackboard-global-toolbar-pill') as HTMLElement;
    expect(pill.style.display).toBe('');
    expect(root.style.display).toBe('none');
  });

  it('hides entirely when the host is null (non-drawing view)', () => {
    const { host } = makeToolbar();
    tb!.setHost(document.createElement('div'));
    tb!.setHost(null);

    const root = host.querySelector('.blackboard-global-toolbar') as HTMLElement;
    const pill = host.querySelector('.blackboard-global-toolbar-pill') as HTMLElement;
    expect(pill.style.display).toBe('none');
    expect(root.style.display).toBe('none');
  });

  it('expanding the no-surface pill disables surface controls but keeps new/insert enabled', () => {
    const { host } = makeToolbar();
    tb!.setHost(document.createElement('div'));

    // Tap the pill to expand.
    pointerup(host.querySelector('.blackboard-global-toolbar-pill'));

    const root = host.querySelector('.blackboard-global-toolbar') as HTMLElement;
    expect(root.style.display).toBe('');
    // Surface-bound controls disabled.
    expect((host.querySelector('[data-tool="pen"]') as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelector('.blackboard-gt-colorwell') as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelector('[data-action="undo"]') as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelector('[data-action="redo"]') as HTMLButtonElement).disabled).toBe(true);
    // New + insert stay enabled.
    expect((host.querySelector('[data-action="new-drawing"]') as HTMLButtonElement).disabled).toBe(false);
    expect((host.querySelector('[data-action="insert-existing"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('re-enables surface controls when a surface becomes active', () => {
    const { host, mgr } = makeToolbar();
    tb!.setHost(document.createElement('div'));
    expect((host.querySelector('[data-tool="pen"]') as HTMLButtonElement).disabled).toBe(true);

    const surface = mockSurface();
    mgr.register(surface, document.createElement('div'));
    mgr.setActive(surface);

    expect((host.querySelector('[data-tool="pen"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('expands to the full toolbar (not the pill) when a drawing activates after the empty-page pill', () => {
    const { host, mgr } = makeToolbar();
    const root = host.querySelector('.blackboard-global-toolbar') as HTMLElement;
    const pill = host.querySelector('.blackboard-global-toolbar-pill') as HTMLElement;

    // Empty page → forced collapsed pill.
    tb!.setHost(document.createElement('div'));
    expect(pill.style.display).toBe('');
    expect(root.style.display).toBe('none');

    // A real drawing activates → full toolbar, not the pill.
    const surface = mockSurface();
    mgr.register(surface, document.createElement('div'));
    mgr.setActive(surface);

    expect(root.style.display).toBe('');
    expect(pill.style.display).toBe('none');
  });

  it("preserves a user-chosen collapse across surface changes (does not force-expand)", () => {
    const { host, mgr } = makeToolbar();
    const root = host.querySelector('.blackboard-global-toolbar') as HTMLElement;
    const pill = host.querySelector('.blackboard-global-toolbar-pill') as HTMLElement;

    // A real drawing is active → full toolbar shown.
    const a = mockSurface();
    mgr.register(a, document.createElement('div'));
    mgr.setActive(a);
    expect(root.style.display).toBe('');

    // The user explicitly collapses (clears pillForcedByNoSurface).
    pointerup(host.querySelector('[aria-label="Minimize toolbar"]'));
    expect(root.style.display).toBe('none');
    expect(pill.style.display).toBe('');

    // Switching to a different drawing keeps the user's collapse — not auto-expanded.
    const b = mockSurface();
    mgr.register(b, document.createElement('div'));
    mgr.setActive(b);
    expect(root.style.display).toBe('none');
    expect(pill.style.display).toBe('');
  });
});

describe('GlobalToolbar — showToolbarPill setting gates the persistent no-surface pill', () => {
  let tb: GlobalToolbar | undefined;
  afterEach(() => { tb?.destroy(); tb = undefined; });

  function makeToolbar(showToolbarPill: boolean) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mgr = new SurfaceManager();
    const settings: PluginSettings = { ...DEFAULT_PLUGIN_SETTINGS, showToolbarPill };
    tb = new GlobalToolbar(host, mgr, vi.fn(), vi.fn(), settings);
    return { host, mgr };
  }

  it('shows the persistent pill on a host with no surface when showToolbarPill is true', () => {
    const { host } = makeToolbar(true);
    const view = document.createElement('div');
    view.className = 'view-content';

    tb!.setHost(view);

    const root = host.querySelector('.blackboard-global-toolbar') as HTMLElement;
    const pill = host.querySelector('.blackboard-global-toolbar-pill') as HTMLElement;
    expect(pill.style.display).toBe('');
    expect(root.style.display).toBe('none');
  });

  it('shows NO pill (and keeps the root hidden) on a host with no surface when showToolbarPill is false', () => {
    const { host } = makeToolbar(false);
    const view = document.createElement('div');
    view.className = 'view-content';

    tb!.setHost(view);

    const root = host.querySelector('.blackboard-global-toolbar') as HTMLElement;
    const pill = host.querySelector('.blackboard-global-toolbar-pill') as HTMLElement;
    expect(pill.style.display).toBe('none');
    expect(root.style.display).toBe('none');
  });

  it('still shows the full toolbar for an active surface even when showToolbarPill is false', () => {
    const { host, mgr } = makeToolbar(false);
    tb!.setHost(document.createElement('div'));

    const surface = mockSurface();
    mgr.register(surface, document.createElement('div'));
    mgr.setActive(surface);

    const root = host.querySelector('.blackboard-global-toolbar') as HTMLElement;
    const pill = host.querySelector('.blackboard-global-toolbar-pill') as HTMLElement;
    expect(root.style.display).toBe('');
    expect(pill.style.display).toBe('none');
  });

  it('lets the user manually collapse an active surface to a pill regardless of the setting', () => {
    const { host, mgr } = makeToolbar(false);
    const surface = mockSurface();
    mgr.register(surface, document.createElement('div'));
    mgr.setActive(surface);

    const root = host.querySelector('.blackboard-global-toolbar') as HTMLElement;
    const pill = host.querySelector('.blackboard-global-toolbar-pill') as HTMLElement;
    expect(root.style.display).toBe('');

    // Manual collapse-to-pill must still work while a surface is active.
    pointerup(host.querySelector('[aria-label="Minimize toolbar"]'));
    expect(root.style.display).toBe('none');
    expect(pill.style.display).toBe('');
  });

  it('setPillEnabled(false) hides a currently-shown no-surface pill', () => {
    const { host } = makeToolbar(true);
    tb!.setHost(document.createElement('div'));
    const pill = host.querySelector('.blackboard-global-toolbar-pill') as HTMLElement;
    expect(pill.style.display).toBe('');

    tb!.setPillEnabled(false);

    const root = host.querySelector('.blackboard-global-toolbar') as HTMLElement;
    expect(pill.style.display).toBe('none');
    expect(root.style.display).toBe('none');
  });

  it('setPillEnabled(true) restores the no-surface pill on a host', () => {
    const { host } = makeToolbar(false);
    tb!.setHost(document.createElement('div'));
    const pill = host.querySelector('.blackboard-global-toolbar-pill') as HTMLElement;
    expect(pill.style.display).toBe('none');

    tb!.setPillEnabled(true);

    expect(pill.style.display).toBe('');
  });
});

describe('GlobalToolbar — stays clear of the native Canvas card menu', () => {
  let tb: GlobalToolbar | undefined;
  afterEach(() => { tb?.destroy(); tb = undefined; });

  it('places the toolbar above a visible .canvas-card-menu', () => {
    const view = document.createElement('div');
    view.className = 'view-content';
    stubRect(view, { top: 0, bottom: 600, left: 0, right: 400 });
    const cardMenu = document.createElement('div');
    cardMenu.className = 'canvas-card-menu';
    stubRect(cardMenu, { top: 500, bottom: 544, left: 100, right: 300 });
    view.appendChild(cardMenu);
    const surfaceEl = document.createElement('div');
    view.appendChild(surfaceEl);
    document.body.appendChild(view);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const mgr = new SurfaceManager();
    tb = new GlobalToolbar(host, mgr);
    const surface = mockSurface();
    mgr.register(surface, surfaceEl);
    mgr.setActive(surface);

    const root = host.querySelector('.blackboard-global-toolbar') as HTMLElement;
    const top = parseFloat(root.style.top);
    const height = root.offsetHeight || 48;
    // The toolbar's bottom edge must sit at or above the card menu's top (500).
    expect(top + height).toBeLessThanOrEqual(500);
  });
});

describe('GlobalToolbar — visual feedback', () => {
  let tb: GlobalToolbar | undefined;
  afterEach(() => { tb?.destroy(); tb = undefined; });

  function setup(tm: ToolManager) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mgr = new SurfaceManager();
    tb = new GlobalToolbar(host, mgr);
    const surface = sharedSurface(tm);
    mgr.register(surface, document.createElement('div'));
    mgr.setActive(surface);
    return { host, surface };
  }

  it('highlights the active tool size dot when the size popover opens', () => {
    const tm = new ToolManager({ ...DEFAULT_TOOL_STATE, penSize: 4 });
    const { host } = setup(tm);

    // Change the active size WITHOUT going through the toolbar (no sync() runs),
    // so only the open-time refresh can update the dot highlight.
    tm.setSize(16);

    pointerup(host.querySelector('.blackboard-gt-size-btn'));

    const dots = Array.from(host.querySelectorAll<HTMLElement>('.blackboard-gt-size-dot'));
    const active = dots.filter((d) => d.classList.contains('active'));
    expect(active).toHaveLength(1);
    expect(active[0].dataset.size).toBe('16');
  });

  it('closes the size popover when a size dot is selected', () => {
    const tm = new ToolManager({ ...DEFAULT_TOOL_STATE });
    const { host } = setup(tm);
    const popover = host.querySelector('.blackboard-gt-size-popover') as HTMLElement;

    pointerup(host.querySelector('.blackboard-gt-size-btn'));
    expect(popover.style.display).not.toBe('none');

    pointerup(host.querySelector('.blackboard-gt-size-dot[data-size="8"]'));
    expect(popover.style.display).toBe('none');
  });

  it('scales the size-button circle glyph with the active size', () => {
    const tm = new ToolManager({ ...DEFAULT_TOOL_STATE, penSize: 2 });
    const { host } = setup(tm);
    const sizeBtn = host.querySelector('.blackboard-gt-size-btn') as HTMLElement;

    const small = parseFloat((sizeBtn.querySelector('circle') as Element).getAttribute('r')!);

    // Select the largest preset size.
    pointerup(sizeBtn);
    pointerup(host.querySelector('.blackboard-gt-size-dot[data-size="30"]'));

    const large = parseFloat((sizeBtn.querySelector('circle') as Element).getAttribute('r')!);
    expect(large).toBeGreaterThan(small);
  });

  it('resizes the size-button circle to the newly-active tool size when switching tools', () => {
    // pen size 2, eraser size 30 — switching pen -> eraser must grow the glyph.
    const tm = new ToolManager({ ...DEFAULT_TOOL_STATE, penSize: 2, eraserSize: 30 });
    const { host } = setup(tm);
    const sizeBtn = host.querySelector('.blackboard-gt-size-btn') as HTMLElement;
    const penR = parseFloat((sizeBtn.querySelector('circle') as Element).getAttribute('r')!);

    pointerup(host.querySelector('[data-tool="eraser"]'));
    const eraserR = parseFloat((sizeBtn.querySelector('circle') as Element).getAttribute('r')!);

    expect(eraserR).toBeGreaterThan(penR);
  });

  it('tints the pen and highlighter glyphs to their tool color, leaving the eraser uncolored', () => {
    const tm = new ToolManager({ ...DEFAULT_TOOL_STATE, penColor: '#ff0000', highlighterColor: '#ffff00' });
    const { host } = setup(tm);

    const probe = document.createElement('div');
    const pen = host.querySelector('[data-tool="pen"]') as HTMLElement;
    const hl = host.querySelector('[data-tool="highlighter"]') as HTMLElement;
    const eraser = host.querySelector('[data-tool="eraser"]') as HTMLElement;

    probe.style.color = '#ff0000';
    expect(pen.style.color).toBe(probe.style.color);
    probe.style.color = '#ffff00';
    expect(hl.style.color).toBe(probe.style.color);
    expect(eraser.style.color).toBe('');
  });

  it('does not change the pen/highlighter tints when the eraser is selected', () => {
    const tm = new ToolManager({ ...DEFAULT_TOOL_STATE, penColor: '#ff0000', highlighterColor: '#ffff00' });
    const { host } = setup(tm);
    const pen = host.querySelector('[data-tool="pen"]') as HTMLElement;
    const hl = host.querySelector('[data-tool="highlighter"]') as HTMLElement;
    const penBefore = pen.style.color;
    const hlBefore = hl.style.color;

    pointerup(host.querySelector('[data-tool="eraser"]'));

    expect(pen.style.color).toBe(penBefore);
    expect(hl.style.color).toBe(hlBefore);
    expect((host.querySelector('[data-tool="eraser"]') as HTMLElement).style.color).toBe('');
  });
});

describe('GlobalToolbar — pen glyph repaints immediately on colour change (icon stayed white until next event)', () => {
  let tb: GlobalToolbar | undefined;
  afterEach(() => { tb?.destroy(); tb = undefined; });

  function setup(palette: string[]) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mgr = new SurfaceManager();
    const settings: PluginSettings = { ...DEFAULT_PLUGIN_SETTINGS, paletteColors: palette };
    tb = new GlobalToolbar(host, mgr, undefined, undefined, settings);
    // sharedSurface so setColor actually mutates penColor (like the real engine surface).
    const surface = sharedSurface(new ToolManager({ ...DEFAULT_TOOL_STATE })); // pen #ffffff
    mgr.register(surface, document.createElement('div'));
    mgr.setActive(surface);
    return { host, surface };
  }

  const colorStr = (c: string) => { const p = document.createElement('div'); p.style.color = c; return p.style.color; };

  it('repaints the pen glyph the instant a palette swatch is picked — no other event needed', () => {
    // Repro: picking a colour set surface.penColor but never re-tinted the pen button, so
    // the glyph stayed white (its initial tint) until an unrelated sync() (draw/tool switch).
    const palette = ['#ff0000', '#00ff00', '#0000ff', '#111111', '#222222', '#333333', '#444444', '#555555'];
    const { host } = setup(palette);
    const pen = host.querySelector('[data-tool="pen"]') as HTMLElement;
    expect(pen.style.color).toBe(colorStr('#ffffff')); // starts white

    // Open the colour well and pick the first swatch (red). Do NOTHING else afterward.
    pointerup(host.querySelector('.blackboard-gt-colorwell'));
    pointerup(host.querySelector('.blackboard-gt-color-popover .blackboard-gt-swatch'));

    expect(pen.style.color).toBe(colorStr('#ff0000'));
  });

  it('repaints the pen glyph the instant an arbitrary wheel colour is chosen', () => {
    const palette = ['#ff0000', '#00ff00', '#0000ff', '#111111', '#222222', '#333333', '#444444', '#555555'];
    const { host } = setup(palette);
    const pen = host.querySelector('[data-tool="pen"]') as HTMLElement;

    const picker = (tb as any).picker;
    if (picker) {
      // Drive the iro picker as the user dragging the wheel.
      picker.color.hexString = '#abcdef';
    } else {
      // Fallback when iro can't init in jsdom: exercise the same code path directly.
      (tb as any).pickColor('#abcdef');
    }

    expect(pen.style.color).toBe(colorStr('#abcdef'));
  });

  it('repaints the highlighter glyph the instant its colour is changed (same bug, highlighter tool)', () => {
    // The user flagged the highlighter was never directly tested. Same missing-refresh path:
    // with the highlighter active, picking a colour must re-tint the highlighter glyph now.
    const palette = ['#00ffcc', '#00ff00', '#0000ff', '#111111', '#222222', '#333333', '#444444', '#555555'];
    const { host } = setup(palette);
    const hl = host.querySelector('[data-tool="highlighter"]') as HTMLElement;
    // Make the highlighter the active tool, then read its starting tint.
    pointerup(host.querySelector('[data-tool="highlighter"]'));
    const before = hl.style.color;

    // Pick the first swatch while the highlighter is active. Nothing else afterward.
    pointerup(host.querySelector('.blackboard-gt-colorwell'));
    pointerup(host.querySelector('.blackboard-gt-color-popover .blackboard-gt-swatch'));

    expect(hl.style.color).toBe(colorStr('#00ffcc'));
    expect(hl.style.color).not.toBe(before);
  });
});

describe('GlobalToolbar — QA4: highlighter has its own wider size scale', () => {
  let tb: GlobalToolbar | undefined;
  afterEach(() => { tb?.destroy(); tb = undefined; });

  function setup(tm: ToolManager) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mgr = new SurfaceManager();
    tb = new GlobalToolbar(host, mgr);
    const surface = sharedSurface(tm);
    mgr.register(surface, document.createElement('div'));
    mgr.setActive(surface);
    return { host, surface };
  }

  function openSizePopover(host: HTMLElement) {
    pointerup(host.querySelector('.blackboard-gt-size-btn'));
  }

  function dotSizes(host: HTMLElement): string[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.blackboard-gt-size-dot'))
      .map((d) => d.dataset.size!);
  }

  it('shows the pen scale [2,4,8,16,30] when the pen is active', () => {
    const tm = new ToolManager({ ...DEFAULT_TOOL_STATE }); // pen active
    const { host } = setup(tm);

    openSizePopover(host);

    expect(dotSizes(host)).toEqual(['2', '4', '8', '16', '30']);
  });

  it('shows the wider highlighter scale [8,14,22,32,44] when the highlighter is active', () => {
    const tm = new ToolManager({ ...DEFAULT_TOOL_STATE });
    const { host } = setup(tm);

    pointerup(host.querySelector('[data-tool="highlighter"]'));
    openSizePopover(host);

    expect(dotSizes(host)).toEqual(['8', '14', '22', '32', '44']);
  });

  it('switches the popover scale back to the pen scale when the pen is reselected', () => {
    const tm = new ToolManager({ ...DEFAULT_TOOL_STATE });
    const { host } = setup(tm);

    pointerup(host.querySelector('[data-tool="highlighter"]'));
    openSizePopover(host);
    expect(dotSizes(host)).toEqual(['8', '14', '22', '32', '44']);

    pointerup(host.querySelector('[data-tool="pen"]'));
    openSizePopover(host);
    expect(dotSizes(host)).toEqual(['2', '4', '8', '16', '30']);
  });

  it('highlights the highlighter default size (22) dot when its popover opens', () => {
    const tm = new ToolManager({ ...DEFAULT_TOOL_STATE }); // highlighterSize default 22
    const { host } = setup(tm);

    pointerup(host.querySelector('[data-tool="highlighter"]'));
    openSizePopover(host);

    const active = Array.from(host.querySelectorAll<HTMLElement>('.blackboard-gt-size-dot'))
      .filter((d) => d.classList.contains('active'));
    expect(active).toHaveLength(1);
    expect(active[0].dataset.size).toBe('22');
  });

  it('renders the five highlighter dots at strictly increasing, distinct diameters', () => {
    const tm = new ToolManager({ ...DEFAULT_TOOL_STATE });
    const { host } = setup(tm);

    pointerup(host.querySelector('[data-tool="highlighter"]'));
    openSizePopover(host);

    const diameters = Array.from(host.querySelectorAll<HTMLElement>('.blackboard-gt-size-dot-inner'))
      .map((inner) => parseFloat(inner.style.width));
    expect(diameters).toHaveLength(5);
    for (let i = 1; i < diameters.length; i++) {
      expect(diameters[i]).toBeGreaterThan(diameters[i - 1]);
    }
  });

  it('selecting a highlighter-scale size sets that size on the surface', () => {
    const tm = new ToolManager({ ...DEFAULT_TOOL_STATE });
    const { host, surface } = setup(tm);

    pointerup(host.querySelector('[data-tool="highlighter"]'));
    openSizePopover(host);
    pointerup(host.querySelector('.blackboard-gt-size-dot[data-size="44"]'));

    expect(surface.activeSize).toBe(44);
  });
});
