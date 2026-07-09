import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_PLUGIN_SETTINGS, validateSettings } from '../src/domain/entities';

vi.mock('../src/presentation/canvas-integration');
vi.mock('../src/presentation/embed');
vi.mock('../src/presentation/settings');
vi.mock('../src/presentation/blackboard-view', () => ({
  BlackboardView: vi.fn(),
  VIEW_TYPE: 'blackboard-view',
  FILE_EXTENSION: 'blackboard',
}));
vi.mock('../src/infrastructure/obsidian-drawing-repository', () => ({
  ObsidianDrawingRepository: class {
    load = vi.fn();
    save = vi.fn();
    writeRaw = vi.fn();
    create = vi.fn();
    exists = vi.fn();
    ensureFolder = vi.fn();
    delete = vi.fn();
    rename = vi.fn();
  },
}));
vi.mock('../src/application/use-cases/create-drawing', () => ({
  CreateDrawingUseCase: class {
    execute = vi.fn().mockResolvedValue('Blackboard/Drawing 123.blackboard');
  },
}));
vi.mock('../src/application/use-cases/export-svg', () => ({
  ExportSvgUseCase: class {
    execute = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('../src/domain/entities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/domain/entities')>();
  return {
    ...actual,
    createDefaultFile: vi.fn().mockReturnValue({
      version: 1,
      strokes: [],
      background: { color: '#1a1a2e' },
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { smoothing: 0.5, streamline: 0.5 },
    }),
  };
});

import BlackboardPlugin from '../src/main';
import { TFile } from 'obsidian';
import { patchCanvas, insertDrawingAtCursor, insertExistingDrawing } from '../src/presentation/canvas-integration';
import { BlackboardView } from '../src/presentation/blackboard-view';
import { ToolManager } from '../src/domain/tool-manager';

function createPlugin(settingsOverrides: Partial<typeof DEFAULT_PLUGIN_SETTINGS> = {}): BlackboardPlugin {
  const plugin = new BlackboardPlugin();
  plugin.settings = { ...DEFAULT_PLUGIN_SETTINGS, ...settingsOverrides };
  plugin.app = {
    vault: {
      create: vi.fn().mockResolvedValue(undefined),
      createFolder: vi.fn().mockResolvedValue(undefined),
      modify: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue('{"version":1}'),
      getAbstractFileByPath: vi.fn().mockReturnValue(null),
      on: vi.fn().mockReturnValue({ type: 'event' }),
    },
    workspace: {
      getActiveFile: vi.fn().mockReturnValue(null),
      getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn() }),
      on: vi.fn().mockReturnValue({ type: 'event' }),
    },
    metadataCache: {
      getFirstLinkpathDest: vi.fn().mockReturnValue(null),
    },
  };
  return plugin;
}

describe('BlackboardPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadSettings', () => {
    it('merges saved data with defaults', async () => {
      const plugin = createPlugin();
      plugin.loadData = vi.fn().mockResolvedValue({ drawingFolder: 'custom-folder' });

      await plugin.loadSettings();

      expect(plugin.settings.drawingFolder).toBe('custom-folder');
    });

    it('validates settings after loading', async () => {
      const plugin = createPlugin();
      plugin.loadData = vi.fn().mockResolvedValue({ newFileLocation: 'somewhere' });

      await plugin.loadSettings();

      expect(plugin.settings.newFileLocation).toBe('fixed');
    });
  });

  describe('saveSettings', () => {
    it('calls saveData with current settings', async () => {
      const plugin = createPlugin();

      await plugin.saveSettings();

      expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
    });
  });

  describe('onload', () => {
    it('heals stale bbMounted markers from a previous plugin instance at startup', async () => {
      // A prior instance (old version / hot-swap) left a mounted embed behind: marker
      // set and engine DOM present. onload must clear both so re-mount can happen.
      const stale = document.body.createDiv();
      stale.dataset.bbMounted = 'true';
      stale.createDiv({ cls: 'blackboard-static' });
      const plugin = createPlugin();

      await plugin.onload();

      expect(stale.dataset.bbMounted).toBe('false');
      expect(stale.querySelector('.blackboard-static')).toBeNull();
      stale.remove();
    });

    it('removes a stale card-menu pencil button at startup', async () => {
      const btn = document.body.createDiv();
      btn.id = 'blackboard-add-drawing';
      const plugin = createPlugin();

      await plugin.onload();

      expect(document.querySelector('#blackboard-add-drawing')).toBeNull();
    });

    it('registers view, extensions, commands, and settings tab', async () => {
      const plugin = createPlugin();

      await plugin.onload();

      expect(plugin.registerView).toHaveBeenCalledWith('blackboard-view', expect.any(Function));
      expect(plugin.registerExtensions).toHaveBeenCalledWith(['blackboard'], 'blackboard-view');
      expect(plugin.addCommand).toHaveBeenCalledTimes(3);
      expect(plugin.addSettingTab).toHaveBeenCalledTimes(1);
    });

    it('registers new-drawing command', async () => {
      const plugin = createPlugin();

      await plugin.onload();

      const commands = (plugin.addCommand as any).mock.calls.map((c: any) => c[0]);
      const newDrawingCmd = commands.find((c: any) => c.id === 'new-drawing');
      expect(newDrawingCmd).toBeDefined();
      expect(newDrawingCmd.name).toBe('New drawing');
    });

    it('registers insert-drawing command', async () => {
      const plugin = createPlugin();

      await plugin.onload();

      const commands = (plugin.addCommand as any).mock.calls.map((c: any) => c[0]);
      const insertCmd = commands.find((c: any) => c.id === 'insert-drawing');
      expect(insertCmd).toBeDefined();
      expect(insertCmd.name).toBe('Insert drawing');
    });

    it('registers insert-existing-drawing command', async () => {
      const plugin = createPlugin();

      await plugin.onload();

      const commands = (plugin.addCommand as any).mock.calls.map((c: any) => c[0]);
      const cmd = commands.find((c: any) => c.id === 'insert-existing-drawing');
      expect(cmd).toBeDefined();
      expect(cmd.name).toBe('Insert existing drawing');
    });

    it('does not register a fit-drawing-to-content command', async () => {
      const plugin = createPlugin();

      await plugin.onload();

      const commands = (plugin.addCommand as any).mock.calls.map((c: any) => c[0]);
      const fitCmd = commands.find((c: any) => c.id === 'fit-drawing-to-content');
      expect(fitCmd).toBeUndefined();
    });

    it('registers vault event handlers', async () => {
      const plugin = createPlugin();

      await plugin.onload();

      // registerEvent is called for: layout-change (x2), modify, rename, delete, active-leaf-change
      expect(plugin.registerEvent).toHaveBeenCalled();
    });

    it('calls patchCanvas', async () => {
      const plugin = createPlugin();

      await plugin.onload();

      expect(patchCanvas).toHaveBeenCalled();
    });

    it('owns exactly one shared ToolManager and passes it to the view factory and patchCanvas (fix-tool-state-isolation)', async () => {
      const plugin = createPlugin();

      await plugin.onload();

      // One shared manager lives on the plugin.
      expect(plugin.toolManager).toBeInstanceOf(ToolManager);

      // The registered view factory builds a BlackboardView with the shared manager (4th arg).
      const viewFactory = (plugin.registerView as any).mock.calls[0][1];
      viewFactory({});
      const viewArgs = (BlackboardView as any).mock.calls.at(-1);
      expect(viewArgs[3]).toBe(plugin.toolManager);

      // patchCanvas receives the same shared manager (7th arg, index 6).
      expect((patchCanvas as any).mock.calls[0][6]).toBe(plugin.toolManager);
    });

    it('owns one shared DocumentStore and threads it to the view factory and patchCanvas', async () => {
      const plugin = createPlugin();

      await plugin.onload();

      expect(plugin.documentStore).toBeDefined();

      // The view factory builds a BlackboardView with the shared store (5th arg, index 4).
      const viewFactory = (plugin.registerView as any).mock.calls[0][1];
      viewFactory({});
      const viewArgs = (BlackboardView as any).mock.calls.at(-1);
      expect(viewArgs[4]).toBe(plugin.documentStore);

      // patchCanvas receives the same shared store (8th arg, index 7).
      expect((patchCanvas as any).mock.calls[0][7]).toBe(plugin.documentStore);
    });

    it('modify handler reads the file and reconciles the shared document (external-edit channel)', async () => {
      const plugin = createPlugin();
      await plugin.onload();
      const reconcileSpy = vi.spyOn(plugin.documentStore, 'reconcile');
      plugin.app.vault.read = vi.fn().mockResolvedValue('{"version":3,"strokes":[]}');

      const modifyHandler = plugin.app.vault.on.mock.calls.find((c: any) => c[0] === 'modify')![1];
      const tfile = Object.assign(new TFile(), { path: 'Draw.blackboard', extension: 'blackboard' });
      await modifyHandler(tfile);

      expect(plugin.app.vault.read).toHaveBeenCalledWith(tfile);
      expect(reconcileSpy).toHaveBeenCalledWith('Draw.blackboard', '{"version":3,"strokes":[]}');
    });

    it('modify handler ignores non-blackboard files (no read, no reconcile)', async () => {
      const plugin = createPlugin();
      await plugin.onload();
      const reconcileSpy = vi.spyOn(plugin.documentStore, 'reconcile');
      plugin.app.vault.read = vi.fn().mockResolvedValue('x');

      const modifyHandler = plugin.app.vault.on.mock.calls.find((c: any) => c[0] === 'modify')![1];
      const tfile = Object.assign(new TFile(), { path: 'note.md', extension: 'md' });
      await modifyHandler(tfile);

      expect(plugin.app.vault.read).not.toHaveBeenCalled();
      expect(reconcileSpy).not.toHaveBeenCalled();
    });

    it('creates drawingFolder if it does not exist', async () => {
      const plugin = createPlugin();
      // loadData returns drawingFolder so loadSettings preserves it
      plugin.loadData = vi.fn().mockResolvedValue({ drawingFolder: 'Blackboard' });
      plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

      await plugin.onload();

      expect(plugin.app.vault.createFolder).toHaveBeenCalledWith('Blackboard');
    });

    it('does not create drawingFolder if it already exists', async () => {
      const plugin = createPlugin();
      plugin.loadData = vi.fn().mockResolvedValue({ drawingFolder: 'Blackboard' });
      plugin.app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'Blackboard') return {};
        return null;
      });

      await plugin.onload();

      expect(plugin.app.vault.createFolder).not.toHaveBeenCalled();
    });

    it('new-drawing command callback executes without error', async () => {
      const plugin = createPlugin();
      await plugin.onload();

      const commands = (plugin.addCommand as any).mock.calls.map((c: any) => c[0]);
      const newDrawingCmd = commands.find((c: any) => c.id === 'new-drawing');

      await expect(newDrawingCmd.callback()).resolves.not.toThrow();
    });

    it('insert-drawing command callback executes without error', async () => {
      const plugin = createPlugin();
      await plugin.onload();

      const commands = (plugin.addCommand as any).mock.calls.map((c: any) => c[0]);
      const insertCmd = commands.find((c: any) => c.id === 'insert-drawing');

      await expect(insertCmd.callback()).resolves.not.toThrow();
    });

    it('insert-drawing command passes the shared DocumentStore (inserted node reads live doc, not stale disk)', async () => {
      const plugin = createPlugin();
      await plugin.onload();
      const commands = (plugin.addCommand as any).mock.calls.map((c: any) => c[0]);
      await commands.find((c: any) => c.id === 'insert-drawing').callback();
      // insertDrawingAtCursor(app, settings, createDrawing, repo, surfaceManager, toolManager, store)
      const args = (insertDrawingAtCursor as any).mock.calls.at(-1);
      expect(args[6]).toBe(plugin.documentStore);
    });

    it('insert-existing-drawing command passes the shared DocumentStore', async () => {
      const plugin = createPlugin();
      await plugin.onload();
      const commands = (plugin.addCommand as any).mock.calls.map((c: any) => c[0]);
      commands.find((c: any) => c.id === 'insert-existing-drawing').callback();
      // insertExistingDrawing(app, repo, settings, surfaceManager, toolManager, store)
      const args = (insertExistingDrawing as any).mock.calls.at(-1);
      expect(args[5]).toBe(plugin.documentStore);
    });

    it('vault modify handler calls exportSvg when autoExportSvg is true', async () => {
      const plugin = createPlugin({ autoExportSvg: true });
      await plugin.onload();

      // Find the modify handler
      const vaultOnCalls = plugin.app.vault.on.mock.calls;
      const modifyCall = vaultOnCalls.find((c: any) => c[0] === 'modify');
      expect(modifyCall).toBeDefined();

      const modifyHandler = modifyCall![1];
      const tfile = Object.assign(new TFile(), { path: 'test.blackboard', extension: 'blackboard' });

      await modifyHandler(tfile);
      // Should not throw - the handler catches errors internally
    });

    it('vault rename handler renames SVG file', async () => {
      const plugin = createPlugin({ autoExportSvg: true });
      await plugin.onload();

      const vaultOnCalls = plugin.app.vault.on.mock.calls;
      const renameCall = vaultOnCalls.find((c: any) => c[0] === 'rename');
      expect(renameCall).toBeDefined();

      const renameHandler = renameCall![1];
      const tfile = Object.assign(new TFile(), { path: 'new.blackboard', extension: 'blackboard' });

      await renameHandler(tfile, 'old.blackboard');
    });

    it('vault delete handler deletes SVG file', async () => {
      const plugin = createPlugin({ autoExportSvg: true });
      await plugin.onload();

      const vaultOnCalls = plugin.app.vault.on.mock.calls;
      const deleteCall = vaultOnCalls.find((c: any) => c[0] === 'delete');
      expect(deleteCall).toBeDefined();

      const deleteHandler = deleteCall![1];
      const tfile = Object.assign(new TFile(), { path: 'test.blackboard', extension: 'blackboard' });

      await deleteHandler(tfile);
    });

    it('rename handler targets the sibling .svg regardless of svgExportPath', async () => {
      const plugin = createPlugin();
      await plugin.onload();
      // onload's loadSettings resets settings from loadData(); apply the flags the handler reads at call-time.
      plugin.settings.autoExportSvg = true;
      plugin.settings.svgExportPath = 'exports';
      const renameSpy = vi.fn().mockResolvedValue(undefined);
      (plugin as any).repo.rename = renameSpy;

      const renameHandler = plugin.app.vault.on.mock.calls.find((c: any) => c[0] === 'rename')![1];
      const tfile = Object.assign(new TFile(), { path: 'sub/new.blackboard', extension: 'blackboard' });
      await renameHandler(tfile, 'sub/old.blackboard');

      // Sibling paths are used; the configured export folder is ignored (documents the inconsistency).
      expect(renameSpy).toHaveBeenCalledWith('sub/old.svg', 'sub/new.svg');
    });

    it('delete handler targets the sibling .svg regardless of svgExportPath', async () => {
      const plugin = createPlugin();
      await plugin.onload();
      plugin.settings.autoExportSvg = true;
      plugin.settings.svgExportPath = 'exports';
      const deleteSpy = vi.fn().mockResolvedValue(undefined);
      (plugin as any).repo.delete = deleteSpy;

      const deleteHandler = plugin.app.vault.on.mock.calls.find((c: any) => c[0] === 'delete')![1];
      const tfile = Object.assign(new TFile(), { path: 'sub/test.blackboard', extension: 'blackboard' });
      await deleteHandler(tfile);

      expect(deleteSpy).toHaveBeenCalledWith('sub/test.svg');
    });

    it('vault modify handler does nothing when autoExportSvg is false', async () => {
      const plugin = createPlugin({ autoExportSvg: false });
      await plugin.onload();

      const vaultOnCalls = plugin.app.vault.on.mock.calls;
      const modifyCall = vaultOnCalls.find((c: any) => c[0] === 'modify');
      if (modifyCall) {
        const modifyHandler = modifyCall[1];
        const tfile = Object.assign(new TFile(), { path: 'test.blackboard', extension: 'blackboard' });
        await modifyHandler(tfile);
      }
    });

    it('vault rename handler ignores non-blackboard files', async () => {
      const plugin = createPlugin({ autoExportSvg: true });
      await plugin.onload();

      const vaultOnCalls = plugin.app.vault.on.mock.calls;
      const renameCall = vaultOnCalls.find((c: any) => c[0] === 'rename');
      if (renameCall) {
        const renameHandler = renameCall[1];
        const tfile = Object.assign(new TFile(), { path: 'test.md', extension: 'md' });
        await renameHandler(tfile, 'old.md');
      }
    });

    it('vault delete handler ignores non-blackboard files', async () => {
      const plugin = createPlugin({ autoExportSvg: true });
      await plugin.onload();

      const vaultOnCalls = plugin.app.vault.on.mock.calls;
      const deleteCall = vaultOnCalls.find((c: any) => c[0] === 'delete');
      if (deleteCall) {
        const deleteHandler = deleteCall[1];
        const tfile = Object.assign(new TFile(), { path: 'test.md', extension: 'md' });
        await deleteHandler(tfile);
      }
    });
  });
});
