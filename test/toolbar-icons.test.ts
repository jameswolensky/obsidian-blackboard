import { describe, it, expect } from 'vitest';
import { setToolbarIcon, setSizeDotIcon, ICONS } from '../src/presentation/toolbar-icons';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('setToolbarIcon', () => {
  it('renders the icon as a real SVG-namespace element (blank on iPad otherwise)', () => {
    const el = document.createElement('button');
    setToolbarIcon(el, 'pen');

    const svg = el.querySelector('svg');
    expect(svg).not.toBeNull();
    // The 1.0.5 regression: nodes outside the SVG namespace render BLANK in WebKit.
    expect(svg!.namespaceURI).toBe(SVG_NS);
    expect(svg!.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg!.getAttribute('stroke')).toBe('currentColor');
    const path = svg!.querySelector('path');
    expect(path).not.toBeNull();
    expect(path!.namespaceURI).toBe(SVG_NS);
  });

  it('replaces the previous icon instead of appending', () => {
    const el = document.createElement('button');
    setToolbarIcon(el, 'pen');
    setToolbarIcon(el, 'eraser');

    expect(el.querySelectorAll('svg')).toHaveLength(1);
  });

  it('renders every icon in the set', () => {
    for (const name of Object.keys(ICONS) as Array<keyof typeof ICONS>) {
      const el = document.createElement('button');
      setToolbarIcon(el, name);
      expect(el.querySelector('svg'), `icon ${name}`).not.toBeNull();
    }
  });
});

describe('setSizeDotIcon', () => {
  it('renders a white dot whose radius follows sizeToDotDiameter', () => {
    const el = document.createElement('button');
    setSizeDotIcon(el, 8);

    const circle = el.querySelector('circle');
    expect(circle).not.toBeNull();
    expect(circle!.namespaceURI).toBe(SVG_NS);
    expect(circle!.getAttribute('r')).toBe('5'); // (8 + 2) / 2
    expect(circle!.getAttribute('fill')).toBe('#ffffff');
  });

  it('replaces the previous dot instead of appending', () => {
    const el = document.createElement('button');
    setSizeDotIcon(el, 8);
    setSizeDotIcon(el, 30);

    expect(el.querySelectorAll('svg')).toHaveLength(1);
    expect(el.querySelector('circle')!.getAttribute('r')).toBe('11'); // min(22, 32)/2
  });
});
