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

  it('every icon renders exactly one 24x24 <svg> child', () => {
    for (const name of names) {
      const el = document.createElement('div');
      setToolbarIcon(el, name);
      expect(el.querySelectorAll('svg').length, name).toBe(1);
      expect(el.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 24 24');
    }
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
