/**
 * DEV BUILDS ONLY (gated by __DEV_BUILD__ in main.ts; tree-shaken from releases —
 * `npm run build` is grep-guarded against any of this shipping).
 *
 * Deploy: polls the Mac dev server for new builds, hot-swaps this plugin's files
 * in the vault, and reloads the plugin — a ~5s build-to-device loop with no releases.
 *
 * Verify: collects device truth about the toolbar (computed styles, geometry, icon
 * presence) and POSTs it back to the dev server, where scripts/assert-audit.mjs
 * checks the openspec toolbar invariants. This is the machine-checkable answer to
 * "how does it ACTUALLY render on the iPad" — the gap behind releases 1.0.4–1.0.15.
 *
 * Uses Obsidian's requestUrl (not fetch) so WKWebView CORS never applies.
 */
import { requestUrl, type Plugin } from 'obsidian';

// Replaced by esbuild `define`; see esbuild.config.mjs.
declare const __DEV_SERVER__: string;

const AUDIT_STYLE_PROPS = [
  'width',
  'height',
  'padding',
  'borderRadius',
  'backgroundColor',
  'color',
  'opacity',
  'display',
  'webkitAppearance',
  'border',
  'boxSizing',
] as const;

export interface ControlAudit {
  classes: string[];
  active: boolean;
  disabled: boolean;
  hasSvgIcon: boolean;
  svgOpacity: string | null;
  rect: { x: number; y: number; width: number; height: number };
  style: Record<string, string>;
}

export interface DevAudit {
  at: string;
  pluginVersion: string;
  buildHash: string;
  bodyClasses: string[];
  viewport: { w: number; h: number };
  toolbarPresent: boolean;
  toolbarRect: { x: number; y: number; width: number; height: number } | null;
  pillPresent: boolean;
  controls: ControlAudit[];
}

const rectOf = (el: Element) => {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
};

export function collectAudit(
  doc: Document,
  meta: { pluginVersion: string; buildHash: string },
): DevAudit {
  const win = doc.defaultView ?? window;
  const toolbar = doc.querySelector('.blackboard-global-toolbar');
  const pill = doc.querySelector('.blackboard-global-toolbar-pill');
  const controls: ControlAudit[] = [];
  const sel =
    '.blackboard-gt-btn, .blackboard-gt-swatch, .blackboard-gt-colorwell, .blackboard-gt-size-dot';
  for (const el of Array.from(toolbar?.querySelectorAll(sel) ?? [])) {
    const cs = win.getComputedStyle(el);
    const svg = el.querySelector('svg');
    const style: Record<string, string> = {};
    for (const p of AUDIT_STYLE_PROPS) style[p] = String(cs[p] ?? '');
    controls.push({
      classes: Array.from(el.classList),
      active: el.classList.contains('active'),
      disabled: el.hasAttribute('disabled'),
      hasSvgIcon: svg !== null,
      svgOpacity: svg ? win.getComputedStyle(svg).opacity : null,
      rect: rectOf(el),
      style,
    });
  }
  return {
    at: new Date().toISOString(),
    pluginVersion: meta.pluginVersion,
    buildHash: meta.buildHash,
    bodyClasses: Array.from(doc.body.classList),
    viewport: { w: win.innerWidth, h: win.innerHeight },
    toolbarPresent: toolbar !== null,
    toolbarRect: toolbar ? rectOf(toolbar) : null,
    pillPresent: pill !== null,
    controls,
  };
}

async function fetchText(path: string): Promise<string> {
  const res = await requestUrl({ url: `${__DEV_SERVER__}${path}`, throw: true });
  return res.text;
}

export function startDevBridge(plugin: Plugin): void {
  const manifestVersion = plugin.manifest.version;
  let knownVersion = '';
  let swapping = false;

  const audit = async (): Promise<void> => {
    const payload = collectAudit(activeDocument, {
      pluginVersion: manifestVersion,
      buildHash: knownVersion,
    });
    await requestUrl({
      url: `${__DEV_SERVER__}/audit`,
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify(payload),
      throw: false,
    });
  };

  const tick = async (): Promise<void> => {
    if (swapping) return;
    let version: string;
    try {
      version = (JSON.parse(await fetchText('/build/version')) as { version: string }).version;
    } catch {
      return; // dev server not up / device off-LAN — stay quiet
    }
    if (knownVersion === '') {
      knownVersion = version; // baseline at load; swap only on CHANGE after load
      return;
    }
    if (version === knownVersion) return;
    swapping = true;
    try {
      const [main, css] = await Promise.all([
        fetchText('/build/main.js'),
        fetchText('/build/styles.css'),
      ]);
      const dir = `.obsidian/plugins/${plugin.manifest.id}`;
      await plugin.app.vault.adapter.write(`${dir}/main.js`, main);
      await plugin.app.vault.adapter.write(`${dir}/styles.css`, css);
      knownVersion = version;
      interface PluginManager {
        disablePlugin(id: string): Promise<void>;
        enablePlugin(id: string): Promise<void>;
      }
      const plugins = (plugin.app as unknown as { plugins: PluginManager }).plugins;
      const id = plugin.manifest.id;
      // Detach before disabling ourselves; the re-enabled instance re-baselines.
      window.setTimeout(() => {
        void plugins.disablePlugin(id).then(() => plugins.enablePlugin(id));
      }, 50);
    } finally {
      swapping = false;
    }
  };

  const interval = window.setInterval(() => void tick(), 3000);
  plugin.register(() => window.clearInterval(interval));

  plugin.addCommand({
    id: 'dev-audit',
    name: 'Dev: send device audit',
    callback: () => void audit(),
  });
  // Auto-audit shortly after load so every hot-swap produces fresh device truth.
  plugin.app.workspace.onLayoutReady(() => window.setTimeout(() => void audit(), 2500));
}
