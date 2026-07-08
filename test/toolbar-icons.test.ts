import { describe, it, expect } from 'vitest';
import {
  setToolbarIcon,
  setSizeDotIcon,
  sizeToDotDiameter,
  ICONS,
} from '../src/presentation/toolbar-icons';
import type { IconName } from '../src/presentation/toolbar-icons';

describe('toolbar icons (DOM-built, no innerHTML)', () => {
  const names = Object.keys(ICONS) as IconName[];

  const SVG_NS = 'http://www.w3.org/2000/svg';

  it('every icon renders exactly one 24x24 <svg> child', () => {
    for (const name of names) {
      const el = document.createElement('div');
      setToolbarIcon(el, name);
      expect(el.querySelectorAll('svg').length, name).toBe(1);
      expect(el.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 24 24');
    }
  });

  // Regression (iPad "0 icons"): icons MUST be in the SVG namespace or WebKit renders
  // nothing. Parsing the markup as `image/svg+xml` without an xmlns declaration produced
  // a null-namespace node that displayed on jsdom/Chromium but was blank on iPad.
  it('every icon and its shapes live in the SVG namespace (WebKit renders them)', () => {
    for (const name of names) {
      const el = document.createElement('div');
      setToolbarIcon(el, name);
      const svg = el.querySelector('svg')!;
      expect(svg.namespaceURI, `${name} <svg> namespace`).toBe(SVG_NS);
      const shape = svg.querySelector('path, circle, rect, line, g');
      expect(shape, `${name} has a shape`).not.toBeNull();
      expect(shape!.namespaceURI, `${name} shape namespace`).toBe(SVG_NS);
    }
  });

  it('the size-dot glyph is also in the SVG namespace', () => {
    const el = document.createElement('div');
    setSizeDotIcon(el, 10);
    const svg = el.querySelector('svg')!;
    expect(svg.namespaceURI).toBe(SVG_NS);
    expect(el.querySelector('circle')!.namespaceURI).toBe(SVG_NS);
  });

  it('re-setting an icon replaces rather than stacks', () => {
    const el = document.createElement('div');
    setToolbarIcon(el, 'pen');
    setToolbarIcon(el, 'eraser');
    expect(el.querySelectorAll('svg').length).toBe(1);
  });

  it('size dot renders a circle whose radius scales with the brush size', () => {
    const el = document.createElement('div');
    setSizeDotIcon(el, 10);
    const r = Number(el.querySelector('circle')!.getAttribute('r'));
    expect(r).toBe(sizeToDotDiameter(10) / 2);
  });
});
