import { describe, it, expect, vi } from 'vitest';
import { SurfaceManager } from '../src/presentation/surface-manager';
import type { DrawingSurface } from '../src/presentation/drawing-surface';

/**
 * The manager only stores and compares surface identities; it never invokes any
 * DrawingSurface method during routing/notification. So a plain object cast to
 * the interface is a sufficient fake for these unit tests.
 */
function fakeSurface(label: string): DrawingSurface {
  return { __label: label } as unknown as DrawingSurface;
}

describe('SurfaceManager', () => {
  it('register + activateForView routes to that surface', () => {
    const mgr = new SurfaceManager();
    const surface = fakeSurface('a');
    const view = document.createElement('div');
    const el = document.createElement('div');
    view.appendChild(el);

    mgr.register(surface, el);
    mgr.activateForView(view);

    expect(mgr.getActive()).toBe(surface);
  });

  it('setActive(b) while a is active switches active and notifies with (b, elB)', () => {
    const mgr = new SurfaceManager();
    const a = fakeSurface('a');
    const b = fakeSurface('b');
    const elA = document.createElement('div');
    const elB = document.createElement('div');
    mgr.register(a, elA);
    mgr.register(b, elB);

    mgr.setActive(a);

    const listener = vi.fn();
    mgr.onChange(listener);

    mgr.setActive(b);

    expect(mgr.getActive()).toBe(b);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(b, elB);
  });

  it('setActive(s) when s is already active does not notify again', () => {
    const mgr = new SurfaceManager();
    const s = fakeSurface('s');
    const el = document.createElement('div');
    mgr.register(s, el);

    mgr.setActive(s);

    const listener = vi.fn();
    mgr.onChange(listener);

    mgr.setActive(s);

    expect(mgr.getActive()).toBe(s);
    expect(listener).not.toHaveBeenCalled();
  });

  it('setActive(null) clears active and notifies with (null, null)', () => {
    const mgr = new SurfaceManager();
    const s = fakeSurface('s');
    const el = document.createElement('div');
    mgr.register(s, el);
    mgr.setActive(s);

    const listener = vi.fn();
    mgr.onChange(listener);

    mgr.setActive(null);

    expect(mgr.getActive()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(null, null);
  });

  it('unregister(activeSurface) clears active and notifies', () => {
    const mgr = new SurfaceManager();
    const s = fakeSurface('s');
    const el = document.createElement('div');
    mgr.register(s, el);
    mgr.setActive(s);

    const listener = vi.fn();
    mgr.onChange(listener);

    mgr.unregister(s);

    expect(mgr.getActive()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    // After unregister the element is no longer known, so it notifies with null.
    expect(listener).toHaveBeenCalledWith(null, null);
  });

  it('onChange returns an unsubscribe fn that stops future notifications', () => {
    const mgr = new SurfaceManager();
    const a = fakeSurface('a');
    const b = fakeSurface('b');
    mgr.register(a, document.createElement('div'));
    mgr.register(b, document.createElement('div'));

    const listener = vi.fn();
    const unsubscribe = mgr.onChange(listener);

    mgr.setActive(a);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();

    mgr.setActive(b);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('refresh() re-notifies listeners with the unchanged active surface/element', () => {
    const mgr = new SurfaceManager();
    const s = fakeSurface('s');
    const el = document.createElement('div');
    mgr.register(s, el);
    mgr.setActive(s);

    const listener = vi.fn();
    mgr.onChange(listener);

    mgr.refresh();

    expect(mgr.getActive()).toBe(s);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(s, el);
  });

  it('activateForView(null) clears active to null', () => {
    const mgr = new SurfaceManager();
    const s = fakeSurface('s');
    const el = document.createElement('div');
    mgr.register(s, el);
    mgr.setActive(s);

    mgr.activateForView(null);

    expect(mgr.getActive()).toBeNull();
  });

  describe('activateForView routing with real DOM containment', () => {
    it('keeps the current active surface if its element is contained in the view', () => {
      const mgr = new SurfaceManager();
      const a = fakeSurface('a');
      const b = fakeSurface('b');
      const view = document.createElement('div');
      const elA = document.createElement('div');
      const elB = document.createElement('div');
      view.appendChild(elA);
      view.appendChild(elB);
      mgr.register(a, elA);
      mgr.register(b, elB);

      mgr.setActive(a);

      const listener = vi.fn();
      mgr.onChange(listener);

      mgr.activateForView(view);

      // a stays active (its element is inside view); no switch, no notify.
      expect(mgr.getActive()).toBe(a);
      expect(listener).not.toHaveBeenCalled();
    });

    it('falls back to a registered surface inside the view when the active one is not', () => {
      const mgr = new SurfaceManager();
      const a = fakeSurface('a');
      const b = fakeSurface('b');
      const elsewhere = document.createElement('div');
      const elA = document.createElement('div');
      elsewhere.appendChild(elA); // a's element lives outside the target view
      const view = document.createElement('div');
      const elB = document.createElement('div');
      view.appendChild(elB);
      mgr.register(a, elA);
      mgr.register(b, elB);

      mgr.setActive(a);
      mgr.activateForView(view);

      expect(mgr.getActive()).toBe(b);
    });

    it('clears to null when no registered surface element is inside the view', () => {
      const mgr = new SurfaceManager();
      const a = fakeSurface('a');
      const elsewhere = document.createElement('div');
      const elA = document.createElement('div');
      elsewhere.appendChild(elA);
      mgr.register(a, elA);

      mgr.setActive(a);

      const emptyView = document.createElement('div');
      mgr.activateForView(emptyView);

      expect(mgr.getActive()).toBeNull();
    });
  });

  describe('stroke-end notification (QA3: undo arrow must light up after the first stroke)', () => {
    it('notifyStrokeEnd calls every onStrokeEnd listener', () => {
      const mgr = new SurfaceManager();
      const cb = vi.fn();
      mgr.onStrokeEnd(cb);

      mgr.notifyStrokeEnd();

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('onStrokeEnd returns an unsubscribe that stops further notifications', () => {
      const mgr = new SurfaceManager();
      const cb = vi.fn();
      const unsub = mgr.onStrokeEnd(cb);

      unsub();
      mgr.notifyStrokeEnd();

      expect(cb).not.toHaveBeenCalled();
    });
  });
});
