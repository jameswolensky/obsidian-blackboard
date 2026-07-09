import { Plugin, TFile, View } from 'obsidian';
import type { PluginSettings } from './domain/entities';
import { DEFAULT_PLUGIN_SETTINGS, DEFAULT_TOOL_STATE, validateSettings } from './domain/entities';
import type { IDrawingRepository } from './domain/ports';
import { ToolManager } from './domain/tool-manager';
import { ObsidianDrawingRepository } from './infrastructure/obsidian-drawing-repository';
import { CreateDrawingUseCase } from './application/use-cases/create-drawing';
import { ExportSvgUseCase } from './application/use-cases/export-svg';
import { BlackboardView, VIEW_TYPE, FILE_EXTENSION } from './presentation/blackboard-view';
import { insertDrawingAtCursor, insertExistingDrawing, patchCanvas } from './presentation/canvas-integration';
import { BlackboardSettingTab } from './presentation/settings';
import { mountBlackboardEmbed } from './presentation/embed';
import { SurfaceManager } from './presentation/surface-manager';
import { DocumentStore } from './application/document-store';
import { GlobalToolbar } from './presentation/global-toolbar';
import { parseEmbedSize, fitSavedEmbedSize } from './presentation/embed-size';

export default class BlackboardPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_PLUGIN_SETTINGS;
  private repo!: IDrawingRepository;
  private createDrawingUseCase!: CreateDrawingUseCase;
  private exportSvgUseCase!: ExportSvgUseCase;
  surfaceManager: SurfaceManager = new SurfaceManager();
  // Single source of truth for `.blackboard` stroke data, keyed by path. Every surface of a
  // file shares one canonical document so edits propagate across panes/embeds/canvas nodes
  // (B2), with a debounced single writer and an own-write/external-edit reconcile guard.
  documentStore: DocumentStore = new DocumentStore();
  // Exactly one ToolManager is the global source of truth for the active tool and every
  // tool's colour/size, shared across the standalone view and every embed/canvas node.
  // Seeded once from code defaults at startup; mounting a surface never re-seeds it
  // (fix-tool-state-isolation).
  toolManager: ToolManager = new ToolManager({ ...DEFAULT_TOOL_STATE });
  private globalToolbar: GlobalToolbar | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    if (__DEV_BUILD__) {
      const { startDevBridge } = await import('./dev/dev-bridge');
      startDevBridge(this);
    }

    this.repo = new ObsidianDrawingRepository(this.app);
    this.createDrawingUseCase = new CreateDrawingUseCase(this.repo);
    this.exportSvgUseCase = new ExportSvgUseCase(this.repo);

    this.registerView(VIEW_TYPE, (leaf) => new BlackboardView(leaf, this.settings, this.surfaceManager, this.toolManager, this.documentStore, this.repo));

    // One floating toolbar shared by every drawing surface; route it to whichever
    // drawing lives in the active view.
    this.app.workspace.onLayoutReady?.(() => {
      this.globalToolbar = new GlobalToolbar(this.app.workspace.containerEl, this.surfaceManager, () => {
        void insertDrawingAtCursor(this.app, this.settings, this.createDrawingUseCase, this.repo, this.surfaceManager, this.toolManager, this.documentStore);
      }, () => {
        insertExistingDrawing(this.app, this.repo, this.settings, this.surfaceManager, this.toolManager, this.documentStore);
      }, this.settings);
      this.register(() => this.globalToolbar?.destroy());
      this.routeToolbar();
    });
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.routeToolbar()));
    // Keep the toolbar clamped inside the active view when the layout changes
    // (sidebar toggled, pane resized, device rotated).
    this.registerEvent(this.app.workspace.on('resize', () => this.globalToolbar?.reposition()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.globalToolbar?.reposition()));
    try {
      this.registerExtensions([FILE_EXTENSION], VIEW_TYPE);
    } catch {
      // Extension may still be registered from a previous load (e.g. plugin re-enable);
      // ignore so onload doesn't abort and leave the plugin disabled.
    }

    this.addCommand({
      id: 'new-drawing',
      name: 'New drawing',
      callback: async () => {
        try {
          const path = await this.createDrawingUseCase.execute(
            this.settings,
            this.settings.newFileLocation,
            this.app.workspace.getActiveFile()?.parent?.path ?? undefined,
          );
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
        } catch {
          return;
        }
      },
    });

    this.addCommand({
      id: 'insert-drawing',
      name: 'Insert drawing',
      callback: async () => {
        try {
          await insertDrawingAtCursor(this.app, this.settings, this.createDrawingUseCase, this.repo, this.surfaceManager, this.toolManager, this.documentStore);
        } catch {
          // Insertion is best-effort: no Markdown/Canvas host is a normal no-op, not an error.
        }
      },
    });

    this.addCommand({
      id: 'insert-existing-drawing',
      name: 'Insert existing drawing',
      callback: () => {
        try {
          insertExistingDrawing(this.app, this.repo, this.settings, this.surfaceManager, this.toolManager, this.documentStore);
        } catch {
          // Best-effort like insert-drawing: absence of a host must not surface an error.
        }
      },
    });

    this.addSettingTab(new BlackboardSettingTab(this.app, this));

    patchCanvas(this.app, this, this.settings, this.repo, this.createDrawingUseCase, this.surfaceManager, this.toolManager, this.documentStore);

    const processEmbeds = () => {
      const embeds = activeDocument.querySelectorAll('.internal-embed.mod-generic.is-loaded');
      embeds.forEach((embedEl) => {
        const src = (embedEl as HTMLElement).getAttribute('src') || '';
        if (!src.endsWith('.' + FILE_EXTENSION)) return;
        if ((embedEl as HTMLElement).dataset.bbMounted === 'true') return;
        const file = this.app.metadataCache.getFirstLinkpathDest(src, '');
        if (!file) return;
        const sizeAlias = (embedEl as HTMLElement).getAttribute('width')
          || (embedEl as HTMLElement).getAttribute('alt')
          || '';
        const size = parseEmbedSize(sizeAlias);
        if (size) {
          // Explicit |WxH / |N% alias overrides the default.
          if (size.width !== null) (embedEl as HTMLElement).style.width = size.width;
          if (size.height !== null) (embedEl as HTMLElement).style.height = size.height;
          void mountBlackboardEmbed(this.repo, embedEl as HTMLElement, file.path, this.settings, this.surfaceManager, this.toolManager, this.documentStore);
        } else {
          // No alias: render at the drawing's saved size, centred, capped to the note
          // width. Reading the file first keeps the embed image-like rather than
          // stretching to full width.
          void this.applySavedEmbedSize(embedEl as HTMLElement, file.path).then(() => {
            void mountBlackboardEmbed(this.repo, embedEl as HTMLElement, file.path, this.settings, this.surfaceManager, this.toolManager, this.documentStore);
          });
        }
      });
    };

    this.registerEvent(this.app.workspace.on('layout-change', processEmbeds));

    const embedObserver = new MutationObserver(processEmbeds);
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      const activeEl = activeDocument.querySelector('.workspace-leaf.mod-active .view-content');
      if (activeEl && !(activeEl as HTMLElement).dataset.bbObserved) {
        (activeEl as HTMLElement).dataset.bbObserved = 'true';
        embedObserver.observe(activeEl, { childList: true, subtree: true });
      }
    }));
    this.register(() => embedObserver.disconnect());

    window.setTimeout(processEmbeds, 1000);

    const folder = this.settings.drawingFolder;
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      try {
        await this.app.vault.createFolder(folder);
      } catch {
        // Folder may already exist (vault cache lag / re-enable); ignore.
      }
    }

    this.registerEvent(this.app.vault.on('modify', async (file) => {
      if (!(file instanceof TFile) || file.extension !== FILE_EXTENSION) return;
      // External-edit channel: reconcile the on-disk content into the shared document so
      // open surfaces refresh (another device, Obsidian Sync, manual edit). The store
      // ignores content equal to its own last write, so our own saves don't loop.
      try {
        const content = await this.app.vault.read(file);
        this.documentStore.reconcile(file.path, content);
      } catch {
        // File may be mid-rename or unreadable this tick; the next modify event reconciles.
      }
      if (this.settings.autoExportSvg) {
        try { await this.exportSvgUseCase.execute(file.path, this.settings.svgExportPath); } catch {
          // Auto-export must never block or fail the save that triggered it.
        }
      }
    }));

    this.registerEvent(this.app.vault.on('rename', async (file, oldPath) => {
      if (file instanceof TFile && file.extension === FILE_EXTENSION && this.settings.autoExportSvg) {
        const oldSvgPath = oldPath.replace(/\.[^.]+$/, '.svg');
        const newSvgPath = file.path.replace(/\.[^.]+$/, '.svg');
        await this.repo.rename(oldSvgPath, newSvgPath);
      }
    }));

    this.registerEvent(this.app.vault.on('delete', async (file) => {
      if (file instanceof TFile && file.extension === FILE_EXTENSION && this.settings.autoExportSvg) {
        const svgPath = file.path.replace(/\.[^.]+$/, '.svg');
        await this.repo.delete(svgPath);
      }
    }));
  }

  private routeToolbar(): void {
    const view = this.app.workspace.getActiveViewOfType(View) as unknown as
      | { contentEl?: HTMLElement; getViewType?: () => string }
      | null
      | undefined;
    const contentEl = view?.contentEl ?? null;
    // Persistent pill: on Markdown/Canvas views the toolbar shows a collapsed pill even with no
    // drawing, so there is always an affordance to start. Set the host before activating so the
    // no-surface fallback anchors correctly; other view types pass null and stay hidden.
    const viewType = view?.getViewType?.();
    const isDrawingHost = viewType === 'markdown' || viewType === 'canvas';
    this.globalToolbar?.setHost(isDrawingHost ? contentEl : null);
    this.surfaceManager.activateForView(contentEl);
  }

  /**
   * Size a no-alias Markdown embed to the drawing's saved dimensions, centred, and
   * scaled down to fit the note's content width when wider. An explicit `|WxH` alias
   * skips this (handled by the caller).
   */
  private async applySavedEmbedSize(embedEl: HTMLElement, filePath: string): Promise<void> {
    try {
      const { file } = await this.repo.load(filePath);
      const avail = embedEl.parentElement?.clientWidth || embedEl.clientWidth || file.width || 0;
      const fit = fitSavedEmbedSize(file.width || 0, file.height || 0, avail);
      if (!fit) return;
      embedEl.style.width = fit.width + 'px';
      embedEl.style.height = fit.height + 'px';
      embedEl.style.marginLeft = 'auto';
      embedEl.style.marginRight = 'auto';
    } catch {
      // Couldn't read the file; leave the embed at its default size.
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_PLUGIN_SETTINGS, await this.loadData() as Partial<PluginSettings>);
    this.validateSettings();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // Reflect the persistent-pill toggle immediately so a Markdown/Canvas host with no
    // active surface hides (or restores) the pill without needing a view switch.
    this.globalToolbar?.setPillEnabled(this.settings.showToolbarPill);
  }

  private validateSettings(): void {
    this.settings = validateSettings(this.settings);
  }
}
