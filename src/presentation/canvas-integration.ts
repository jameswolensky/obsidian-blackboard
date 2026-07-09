import { App, Plugin, TFile, FuzzySuggestModal, Notice, setIcon, setTooltip, MarkdownView, View } from 'obsidian';
import type { PluginSettings } from '../domain/entities';
import type { IDrawingRepository } from '../domain/ports';
import { CreateDrawingUseCase } from '../application/use-cases/create-drawing';
import { FILE_EXTENSION, VIEW_TYPE } from './blackboard-view';
import { mountBlackboardEmbed } from './embed';
import type { SurfaceManager } from './surface-manager';
import type { ToolManager } from '../domain/tool-manager';
import type { DocumentStore } from '../application/document-store';
// Aliased locally: esbuild's minified-identifier frequency analysis reads type-name
// characters, and the capital V in CanvasViewLike perturbs the release bundle's mangling.
import type { CanvasViewLike as CanvasHostLike } from '../types/obsidian-internals';

/**
 * The insert-drawing commands target a Markdown/Canvas host that can receive an embed. When the
 * standalone Blackboard view is active there is no such host, so the commands fail gracefully
 * (no-op) instead of creating a stray file and navigating away.
 */
function isBlackboardViewActive(app: App): boolean {
  return app.workspace?.getActiveViewOfType(View)?.getViewType?.() === VIEW_TYPE;
}

/**
 * Embed a `.blackboard` drawing into the active host, host-aware:
 * - Markdown view: insert a `![[name]]` embed at the cursor.
 * - Canvas: append to a selected text node, else create a file node at viewport center.
 * - Neither (e.g. a `.blackboard` file is the active view): open the drawing in a leaf so the
 *   user always sees a result.
 *
 * `name` is the wikilink target used by the Markdown/Canvas-text paths; `file` is the resolved
 * `TFile` needed by the Canvas-node and open-in-leaf paths (may be null when only a Markdown
 * insert is required, e.g. a freshly created drawing whose TFile is not yet resolved).
 */
export async function embedDrawingIntoHost(
  app: App,
  name: string,
  file: TFile | null,
  repo: IDrawingRepository,
  settings: PluginSettings,
  surfaceManager?: SurfaceManager,
  toolManager?: ToolManager,
  store?: DocumentStore,
): Promise<void> {
  const activeView = app.workspace.getActiveViewOfType(MarkdownView);
  if (activeView) {
    const editor = activeView.editor;
    const cursor = editor.getCursor();
    editor.replaceRange(`![[${name}]]\n`, cursor);
    return;
  }

  const leaf = app.workspace.getMostRecentLeaf();
  const view = leaf?.view as CanvasHostLike | undefined;
  if (view?.canvas) {
    const selectedNodes = Array.from(view.canvas.selection || []);
    const textNode = selectedNodes.find((n) => n.text !== undefined);
    if (textNode) {
      const currentText = textNode.text || '';
      textNode.setText(currentText + (currentText ? '\n' : '') + `![[${name}]]`);
      view.canvas.requestSave();
    } else if (file instanceof TFile) {
      const vp = view.canvas.getViewportBBox?.();
      view.canvas.createFileNode({
        pos: {
          x: vp ? (vp.minX + vp.maxX) / 2 - 200 : 0,
          y: vp ? (vp.minY + vp.maxY) / 2 - 150 : 0,
        },
        size: { width: 400, height: 300 },
        file,
      });
      window.setTimeout(() => patchCanvasFileNodes(repo, app, settings, surfaceManager, toolManager, store), 200);
      window.setTimeout(() => patchCanvasFileNodes(repo, app, settings, surfaceManager, toolManager, store), 500);
      window.setTimeout(() => patchCanvasFileNodes(repo, app, settings, surfaceManager, toolManager, store), 1000);
    }
    return;
  }

  // No Markdown or Canvas host (e.g. a .blackboard file is the active view): open the drawing
  // so the user always sees a result instead of a silent, invisible operation.
  if (file instanceof TFile) await app.workspace.getLeaf(false).openFile(file);
}

export async function insertDrawingAtCursor(app: App, settings: PluginSettings, createDrawing: CreateDrawingUseCase, repo: IDrawingRepository, surfaceManager?: SurfaceManager, toolManager?: ToolManager, store?: DocumentStore): Promise<void> {
  if (isBlackboardViewActive(app)) {
    new Notice('Open a Markdown or canvas note to insert a drawing.');
    return;
  }
  const path = await createDrawing.execute(settings, 'fixed');
  const name = path.split('/').pop() || path;
  const created = app.vault.getAbstractFileByPath(path);
  await embedDrawingIntoHost(app, name, created instanceof TFile ? created : null, repo, settings, surfaceManager, toolManager, store);
}

/** Suggester listing every `.blackboard` file in the vault; selecting one runs `onChoose`. */
export class BlackboardFileSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onChoose: (file: TFile) => void) {
    super(app);
    this.setPlaceholder('Select a drawing to insert');
  }
  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((f) => f.extension === FILE_EXTENSION);
  }
  getItemText(file: TFile): string {
    return file.path;
  }
  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

/** Open the file picker and embed the chosen existing drawing into the active host. */
export function insertExistingDrawing(app: App, repo: IDrawingRepository, settings: PluginSettings, surfaceManager?: SurfaceManager, toolManager?: ToolManager, store?: DocumentStore): void {
  if (isBlackboardViewActive(app)) {
    new Notice('Open a Markdown or canvas note to insert a drawing.');
    return;
  }
  new BlackboardFileSuggestModal(app, (file) => {
    void embedDrawingIntoHost(app, file.name, file, repo, settings, surfaceManager, toolManager, store);
  }).open();
}

function patchCanvasFileNodes(repo: IDrawingRepository, app: App, settings: PluginSettings, surfaceManager?: SurfaceManager, toolManager?: ToolManager, store?: DocumentStore): void {
  const leaf = app.workspace.getMostRecentLeaf();
  if (!leaf) return;
  const view = leaf?.view as CanvasHostLike | undefined;
  if (!view?.canvas) return;

  for (const node of view.canvas.nodes.values()) {
    if (!node.file || node.file.extension !== FILE_EXTENSION) continue;
    const contentEl = node.contentEl;
    if (!contentEl || contentEl.dataset.bbMounted === 'true') continue;

    const hasPreview = contentEl.querySelector('.blackboard-preview-img') || contentEl.querySelector('.blackboard-placeholder');
    if (hasPreview) continue;

    // B5: a Canvas file node can ALSO be rendered by Obsidian's registered embedded
    // BlackboardView in the same content host. A live drawing surface (either an embed
    // engine or the embedded view) shows a `.blackboard-static` canvas; if one is already
    // present, skip — mounting a second engine would paint the in-progress stroke twice.
    if (contentEl.querySelector('.blackboard-static')) continue;

    void mountBlackboardEmbed(repo, contentEl, node.file.path, settings, surfaceManager, toolManager, store);
    // No automatic content-driven node sizing: a drawing must only ever resize when
    // the user resizes the node. Growing the node to match strokes made the node creep
    // larger as you drew near an edge.
  }
}

export function patchCanvas(app: App, plugin: Plugin, settings: PluginSettings, repo: IDrawingRepository, createDrawing: CreateDrawingUseCase, surfaceManager?: SurfaceManager, toolManager?: ToolManager, store?: DocumentStore): void {
  plugin.registerEvent(app.workspace.on('layout-change', () => {
    const leaf = app.workspace.getMostRecentLeaf();
    if (!leaf) return;
    const view = leaf.view as CanvasHostLike;
    if (!view?.canvas?.cardMenuEl) return;
    const menuEl = view.canvas.cardMenuEl;
    if (menuEl.querySelector('#blackboard-add-drawing')) return;

    const btn = createDiv();
    btn.id = 'blackboard-add-drawing';
    btn.classList.add('canvas-card-menu-button');
    setIcon(btn, 'pencil');
    setTooltip(btn, 'New Drawing', { placement: 'top' });
    btn.addEventListener('click', () => { void insertDrawingAtCursor(app, settings, createDrawing, repo, surfaceManager, toolManager, store); });
    menuEl.appendChild(btn);

    patchCanvasFileNodes(repo, app, settings, surfaceManager, toolManager, store);
  }));

  plugin.registerEvent(app.workspace.on('active-leaf-change', () => {
    window.setTimeout(() => patchCanvasFileNodes(repo, app, settings, surfaceManager, toolManager, store), 200);
  }));

  const observer = new MutationObserver(() => patchCanvasFileNodes(repo, app, settings, surfaceManager, toolManager, store));
  plugin.registerEvent(app.workspace.on('layout-change', () => {
    const leaf = app.workspace.getMostRecentLeaf();
    if (!leaf) return;
    const view = leaf.view as CanvasHostLike;
    if (!view?.canvas) return;
    const el = view.contentEl;
    if (el && !el.dataset.bbCanvasObserved) {
      el.dataset.bbCanvasObserved = 'true';
      observer.observe(el, { childList: true, subtree: true });
    }
  }));
  plugin.register(() => observer.disconnect());

  window.setTimeout(() => patchCanvasFileNodes(repo, app, settings, surfaceManager, toolManager, store), 500);
}
