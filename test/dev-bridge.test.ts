import { describe, it, expect } from 'vitest';
import { collectAudit } from '../src/dev/dev-bridge';

describe('collectAudit', () => {
  it('captures per-control computed styles, rects, and icon presence', () => {
    document.body.className = 'is-tablet is-ios';
    const bar = document.body.createDiv({ cls: 'blackboard-global-toolbar' });
    const btn = bar.createEl('button', { cls: 'blackboard-gt-btn' });
    btn.classList.add('active');
    btn.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));

    const audit = collectAudit(document, { pluginVersion: 'test', buildHash: 'x' });

    expect(audit.bodyClasses).toContain('is-tablet');
    expect(audit.toolbarPresent).toBe(true);
    expect(audit.controls).toHaveLength(1);
    const c = audit.controls[0];
    expect(c.classes).toContain('blackboard-gt-btn');
    expect(c.active).toBe(true);
    expect(c.hasSvgIcon).toBe(true);
    expect(c.style).toHaveProperty('borderRadius');
    expect(c.style).toHaveProperty('backgroundColor');
    expect(c.rect).toHaveProperty('width');
    document.body.empty();
    document.body.className = '';
  });

  it('reports pill-only state when no toolbar is mounted', () => {
    document.body.createDiv({ cls: 'blackboard-global-toolbar-pill' });
    const audit = collectAudit(document, { pluginVersion: 'test', buildHash: 'x' });
    expect(audit.toolbarPresent).toBe(false);
    expect(audit.pillPresent).toBe(true);
    expect(audit.controls).toHaveLength(0);
    document.body.empty();
  });
});
