import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile, FuzzySuggestModal } from 'obsidian';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/domain/entities';
import type { PluginSettings } from '../src/domain/entities';
import type { IDrawingRepository } from '../src/domain/ports';

vi.mock('../src/presentation/embed', () => ({
  mountBlackboardEmbed: vi.fn(),
}));

vi.mock('../src/application/file-format', () => ({
  serialize: vi.fn(() => 'mock-serialized-content'),
}));

vi.mock('../src/presentation/blackboard-view', () => ({
  VIEW_TYPE: 'blackboard-view',
  FILE_EXTENSION: 'blackboard',
}));

import {
  insertDrawingAtCursor,
  embedDrawingIntoHost,
  insertExistingDrawing,
  BlackboardFileSuggestModal,
  patchCanvas,
} from '../src/presentation/canvas-integration';
import * as canvasIntegration from '../src/presentation/canvas-integration';
import { mountBlackboardEmbed } from '../src/presentation/embed';

function createMockApp() {
  return {
    vault: {
      create: vi.fn().mockResolvedValue(undefined),
      createFolder: vi.fn().mockResolvedValue(undefined),
      getAbstractFileByPath: vi.fn().mockReturnValue(null),
    },
    workspace: {
      getActiveViewOfType: vi.fn().mockReturnValue(null),
      getMostRecentLeaf: vi.fn().mockReturnValue(null),
      getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn().mockResolvedValue(undefined) }),
    },
  };
}

function createMockCreateDrawing(folder: string) {
  return {
    execute: vi.fn().mockImplementation(async (settings: PluginSettings, location: string) => {
      const name = `Drawing ${Date.now()}.blackboard`;
      return folder ? `${folder}/${name}` : name;
    }),
  };
}

function createMockRepo(): IDrawingRepository {
  return {
    load: vi.fn().mockResolvedValue({ file: { version: 1, strokes: [] }, warnings: [], readonly: false }),
    save: vi.fn().mockResolvedValue(undefined),
    writeRaw: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue('test.blackboard'),
    exists: vi.fn().mockReturnValue(true),
    ensureFolder: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
  };
}

describe('insertDrawingAtCursor', () => {
  let app: ReturnType<typeof createMockApp>;
  let settings: PluginSettings;
  let createDrawing: ReturnType<typeof createMockCreateDrawing>;
  let repo: IDrawingRepository;

  beforeEach(() => {
    vi.restoreAllMocks();
    app = createMockApp();
    settings = { ...DEFAULT_PLUGIN_SETTINGS, drawingFolder: 'Blackboard' };
    createDrawing = createMockCreateDrawing('Blackboard');
    repo = createMockRepo();
  });

  it('calls createDrawing.execute with fixed location', async () => {
    await insertDrawingAtCursor(app as any, settings, createDrawing as any, repo);

    expect(createDrawing.execute).toHaveBeenCalledWith(settings, 'fixed');
  });

  it('does not directly create folder or file via vault', async () => {
    await insertDrawingAtCursor(app as any, settings, createDrawing as any, repo);

    expect(app.vault.createFolder).not.toHaveBeenCalled();
    expect(app.vault.create).not.toHaveBeenCalled();
  });

  it('does nothing when a Blackboard view is active (no create, no leaf, no throw)', async () => {
    // Repro of the reported bug: invoking "insert new drawing" while a .blackboard
    // editor is the active view created a stray file and navigated away. The command
    // must fail gracefully (no-op) in that context.
    app.workspace.getActiveViewOfType.mockReturnValue({ getViewType: () => 'blackboard-view' } as any);

    await expect(
      insertDrawingAtCursor(app as any, settings, createDrawing as any, repo),
    ).resolves.toBeUndefined();

    expect(createDrawing.execute).not.toHaveBeenCalled();
    expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    expect(app.vault.create).not.toHaveBeenCalled();
  });

  it('inserts wikilink at cursor when markdown view is active', async () => {
    const mockEditor = {
      getCursor: vi.fn().mockReturnValue({ line: 5, ch: 10 }),
      replaceRange: vi.fn(),
    };
    app.workspace.getActiveViewOfType.mockReturnValue({ editor: mockEditor });

    await insertDrawingAtCursor(app as any, settings, createDrawing as any, repo);

    expect(mockEditor.replaceRange).toHaveBeenCalledWith(
      expect.stringMatching(/^!\[\[Drawing \d+\.blackboard\]\]\n$/),
      { line: 5, ch: 10 },
    );
  });

  it('wikilink format includes ![[...]] with .blackboard extension', async () => {
    const mockEditor = {
      getCursor: vi.fn().mockReturnValue({ line: 0, ch: 0 }),
      replaceRange: vi.fn(),
    };
    app.workspace.getActiveViewOfType.mockReturnValue({ editor: mockEditor });

    await insertDrawingAtCursor(app as any, settings, createDrawing as any, repo);

    const insertedText = mockEditor.replaceRange.mock.calls[0][0] as string;
    expect(insertedText).toMatch(/^!\[\[.+\.blackboard\]\]\n$/);
  });

  it('appends wikilink with newline to existing canvas text node text', async () => {
    const textNode = {
      text: 'existing content',
      setText: vi.fn(),
    };
    const mockCanvas = {
      selection: new Set([textNode]),
      requestSave: vi.fn(),
    };
    app.workspace.getMostRecentLeaf.mockReturnValue({
      view: { canvas: mockCanvas },
    });

    await insertDrawingAtCursor(app as any, settings, createDrawing as any, repo);

    expect(textNode.setText).toHaveBeenCalledWith(
      expect.stringMatching(/^existing content\n!\[\[Drawing \d+\.blackboard\]\]$/),
    );
  });

  it('no newline prefix when canvas text node text is empty', async () => {
    const textNode = {
      text: '',
      setText: vi.fn(),
    };
    const mockCanvas = {
      selection: new Set([textNode]),
      requestSave: vi.fn(),
    };
    app.workspace.getMostRecentLeaf.mockReturnValue({
      view: { canvas: mockCanvas },
    });

    await insertDrawingAtCursor(app as any, settings, createDrawing as any, repo);

    expect(textNode.setText).toHaveBeenCalledWith(
      expect.stringMatching(/^!\[\[Drawing \d+\.blackboard\]\]$/),
    );
  });

  it('creates file node at viewport center when no text node selected', async () => {
    const createdFile = Object.assign(new TFile(), {
      path: 'Blackboard/Drawing 123.blackboard',
    });
    const createFileNode = vi.fn();
    const mockCanvas = {
      selection: new Set(),
      requestSave: vi.fn(),
      getViewportBBox: vi.fn().mockReturnValue({
        minX: 0,
        maxX: 400,
        minY: 0,
        maxY: 300,
      }),
      createFileNode,
    };
    app.workspace.getMostRecentLeaf.mockReturnValue({
      view: { canvas: mockCanvas },
    });
    app.vault.getAbstractFileByPath.mockImplementation((p: string) => {
      if (p.endsWith('.blackboard')) return createdFile;
      return null;
    });

    await insertDrawingAtCursor(app as any, settings, createDrawing as any, repo);

    expect(createFileNode).toHaveBeenCalledWith({
      pos: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      file: createdFile,
    });
  });

  it('opens the created drawing in a leaf when no markdown view and no canvas host', async () => {
    const createdFile = Object.assign(new TFile(), { path: 'Blackboard/Drawing 123.blackboard' });
    const openFile = vi.fn().mockResolvedValue(undefined);
    app.workspace.getActiveViewOfType.mockReturnValue(null);
    app.workspace.getMostRecentLeaf.mockReturnValue(null);
    app.workspace.getLeaf.mockReturnValue({ openFile });
    app.vault.getAbstractFileByPath.mockImplementation((p: string) =>
      p.endsWith('.blackboard') ? createdFile : null,
    );

    await insertDrawingAtCursor(app as any, settings, createDrawing as any, repo);

    expect(createDrawing.execute).toHaveBeenCalled();
    expect(app.workspace.getLeaf).toHaveBeenCalledWith(false);
    expect(openFile).toHaveBeenCalledWith(createdFile);
  });

  it('does not open a leaf on the fallback path when the created file is missing', async () => {
    const openFile = vi.fn();
    app.workspace.getActiveViewOfType.mockReturnValue(null);
    app.workspace.getMostRecentLeaf.mockReturnValue(null);
    app.workspace.getLeaf.mockReturnValue({ openFile });
    app.vault.getAbstractFileByPath.mockReturnValue(null);

    await insertDrawingAtCursor(app as any, settings, createDrawing as any, repo);

    expect(openFile).not.toHaveBeenCalled();
  });

  it('file node position is (0,0) when getViewportBBox returns undefined', async () => {
    const createdFile = Object.assign(new TFile(), {
      path: 'Blackboard/Drawing 123.blackboard',
    });
    const createFileNode = vi.fn();
    const mockCanvas = {
      selection: new Set(),
      requestSave: vi.fn(),
      getViewportBBox: vi.fn().mockReturnValue(undefined),
      createFileNode,
    };
    app.workspace.getMostRecentLeaf.mockReturnValue({
      view: { canvas: mockCanvas },
    });
    app.vault.getAbstractFileByPath.mockImplementation((p: string) => {
      if (p.endsWith('.blackboard')) return createdFile;
      return null;
    });

    await insertDrawingAtCursor(app as any, settings, createDrawing as any, repo);

    expect(createFileNode).toHaveBeenCalledWith(
      expect.objectContaining({ pos: { x: 0, y: 0 } }),
    );
  });

  it('file path has no folder prefix when drawingFolder is empty', async () => {
    settings.drawingFolder = '';
    createDrawing = createMockCreateDrawing('');

    const mockEditor = {
      getCursor: vi.fn().mockReturnValue({ line: 0, ch: 0 }),
      replaceRange: vi.fn(),
    };
    app.workspace.getActiveViewOfType.mockReturnValue({ editor: mockEditor });

    await insertDrawingAtCursor(app as any, settings, createDrawing as any, repo);

    const insertedText = mockEditor.replaceRange.mock.calls[0][0] as string;
    expect(insertedText).toMatch(/^!\[\[Drawing \d+\.blackboard\]\]\n$/);
  });
});

describe('embedDrawingIntoHost (existing file)', () => {
  let app: ReturnType<typeof createMockApp>;
  let settings: PluginSettings;
  let repo: IDrawingRepository;

  function blackboardFile(path: string): TFile {
    return Object.assign(new TFile(), {
      path,
      name: path.split('/').pop(),
      extension: 'blackboard',
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    app = createMockApp();
    settings = { ...DEFAULT_PLUGIN_SETTINGS, drawingFolder: 'Blackboard' };
    repo = createMockRepo();
  });

  it('inserts a wikilink for the existing file at the markdown cursor', async () => {
    const file = blackboardFile('Blackboard/Existing.blackboard');
    const replaceRange = vi.fn();
    app.workspace.getActiveViewOfType.mockReturnValue({
      editor: { getCursor: vi.fn().mockReturnValue({ line: 2, ch: 3 }), replaceRange },
    });

    await embedDrawingIntoHost(app as any, file.name, file, repo, settings);

    expect(replaceRange).toHaveBeenCalledWith('![[Existing.blackboard]]\n', { line: 2, ch: 3 });
  });

  it('creates a canvas file node for the existing file when no text node selected', async () => {
    const file = blackboardFile('Blackboard/Existing.blackboard');
    const createFileNode = vi.fn();
    app.workspace.getMostRecentLeaf.mockReturnValue({
      view: { canvas: { selection: new Set(), requestSave: vi.fn(), getViewportBBox: () => undefined, createFileNode } },
    });

    await embedDrawingIntoHost(app as any, file.name, file, repo, settings);

    expect(createFileNode).toHaveBeenCalledWith(expect.objectContaining({ file }));
  });

  it('opens the existing file in a leaf when there is no markdown or canvas host', async () => {
    const file = blackboardFile('Blackboard/Existing.blackboard');
    const openFile = vi.fn().mockResolvedValue(undefined);
    app.workspace.getActiveViewOfType.mockReturnValue(null);
    app.workspace.getMostRecentLeaf.mockReturnValue(null);
    app.workspace.getLeaf.mockReturnValue({ openFile });

    await embedDrawingIntoHost(app as any, file.name, file, repo, settings);

    expect(openFile).toHaveBeenCalledWith(file);
  });
});

describe('BlackboardFileSuggestModal', () => {
  function makeFile(path: string, extension: string): TFile {
    return Object.assign(new TFile(), { path, name: path.split('/').pop(), extension });
  }

  it('offers only .blackboard files', () => {
    const files = [
      makeFile('a.blackboard', 'blackboard'),
      makeFile('note.md', 'md'),
      makeFile('Drawings/b.blackboard', 'blackboard'),
      makeFile('canvas.canvas', 'canvas'),
    ];
    const app = { vault: { getFiles: () => files } };

    const modal = new BlackboardFileSuggestModal(app as any, () => {});
    const items = modal.getItems();

    expect(items.map((f) => f.path)).toEqual(['a.blackboard', 'Drawings/b.blackboard']);
    expect(modal.getItemText(items[0])).toBe('a.blackboard');
  });

  it('invokes the onChoose callback with the chosen file', () => {
    const file = makeFile('a.blackboard', 'blackboard');
    const onChoose = vi.fn();
    const modal = new BlackboardFileSuggestModal({ vault: { getFiles: () => [file] } } as any, onChoose);

    modal.onChooseItem(file, {} as any);

    expect(onChoose).toHaveBeenCalledWith(file);
  });

  it('insertExistingDrawing does not throw when opening the picker', () => {
    const app = { vault: { getFiles: () => [] } };
    expect(() => insertExistingDrawing(app as any, createMockRepo(), { ...DEFAULT_PLUGIN_SETTINGS })).not.toThrow();
  });

  it('does not open the picker when a Blackboard view is active', () => {
    // Repro: the picker should not open while a .blackboard editor is active.
    const openSpy = vi.spyOn(FuzzySuggestModal.prototype, 'open');
    const app = {
      vault: { getFiles: () => [] },
      workspace: { getActiveViewOfType: () => ({ getViewType: () => 'blackboard-view' }) },
    };

    expect(() =>
      insertExistingDrawing(app as any, createMockRepo(), { ...DEFAULT_PLUGIN_SETTINGS }),
    ).not.toThrow();
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe('patchCanvas', () => {
  it('registers event listeners for layout-change and active-leaf-change', () => {
    // patchCanvas imported at top

    const mockPlugin = {
      registerEvent: vi.fn(),
      register: vi.fn(),
    };
    const mockApp = {
      workspace: {
        on: vi.fn().mockReturnValue({ type: 'event' }),
        getMostRecentLeaf: vi.fn().mockReturnValue(null),
      },
    };
    const mockSettings = { ...DEFAULT_PLUGIN_SETTINGS };
    const mockRepo = createMockRepo();
    const mockCreateDrawing = createMockCreateDrawing('Blackboard');

    patchCanvas(mockApp, mockPlugin, mockSettings, mockRepo, mockCreateDrawing);

    // 3 workspace.on calls: 2 layout-change + 1 active-leaf-change
    expect(mockApp.workspace.on).toHaveBeenCalledWith('layout-change', expect.any(Function));
    expect(mockApp.workspace.on).toHaveBeenCalledWith('active-leaf-change', expect.any(Function));
    expect(mockPlugin.registerEvent).toHaveBeenCalled();
    expect(mockPlugin.register).toHaveBeenCalled();
  });

  it('layout-change handler adds button when canvas has cardMenuEl', () => {
    // patchCanvas imported at top

    const menuEl = document.createElement('div');
    const mockPlugin = {
      registerEvent: vi.fn(),
      register: vi.fn(),
    };
    const mockApp = {
      workspace: {
        on: vi.fn().mockReturnValue({ type: 'event' }),
        getMostRecentLeaf: vi.fn().mockReturnValue({
          view: {
            canvas: {
              cardMenuEl: menuEl,
              nodes: new Map(),
            },
          },
        }),
      },
    };
    const mockSettings = { ...DEFAULT_PLUGIN_SETTINGS };
    const mockRepo = createMockRepo();
    const mockCreateDrawing = createMockCreateDrawing('Blackboard');

    patchCanvas(mockApp, mockPlugin, mockSettings, mockRepo, mockCreateDrawing);

    // Invoke the first layout-change callback
    const layoutChangeCalls = mockApp.workspace.on.mock.calls.filter((c: any) => c[0] === 'layout-change');
    layoutChangeCalls[0][1]();

    expect(menuEl.querySelector('#blackboard-add-drawing')).not.toBeNull();
  });

  it('layout-change handler does nothing when leaf is null', () => {
    // patchCanvas imported at top

    const mockPlugin = {
      registerEvent: vi.fn(),
      register: vi.fn(),
    };
    const mockApp = {
      workspace: {
        on: vi.fn().mockReturnValue({ type: 'event' }),
        getMostRecentLeaf: vi.fn().mockReturnValue(null),
      },
    };

    patchCanvas(mockApp, mockPlugin, {}, createMockRepo(), createMockCreateDrawing(''));

    const layoutChangeCalls = mockApp.workspace.on.mock.calls.filter((c: any) => c[0] === 'layout-change');
    // Should not throw
    layoutChangeCalls[0][1]();
  });

  it('layout-change handler does not add duplicate button', () => {
    // patchCanvas imported at top

    const menuEl = document.createElement('div');
    const existingBtn = document.createElement('div');
    existingBtn.id = 'blackboard-add-drawing';
    menuEl.appendChild(existingBtn);

    const mockPlugin = {
      registerEvent: vi.fn(),
      register: vi.fn(),
    };
    const mockApp = {
      workspace: {
        on: vi.fn().mockReturnValue({ type: 'event' }),
        getMostRecentLeaf: vi.fn().mockReturnValue({
          view: {
            canvas: {
              cardMenuEl: menuEl,
              nodes: new Map(),
            },
          },
        }),
      },
    };

    patchCanvas(mockApp, mockPlugin, {}, createMockRepo(), createMockCreateDrawing(''));

    const layoutChangeCalls = mockApp.workspace.on.mock.calls.filter((c: any) => c[0] === 'layout-change');
    layoutChangeCalls[0][1]();

    expect(menuEl.querySelectorAll('#blackboard-add-drawing').length).toBe(1);
  });
});

describe('patchCanvasFileNodes (via patchCanvas layout-change handler)', () => {
  beforeEach(() => {
    // Fake timers so patchCanvas's trailing setTimeout (line ~183) doesn't leak a
    // real dangling timer into later tests. The layout-change handler we invoke runs
    // patchCanvasFileNodes synchronously, so no timer advance is needed for assertions.
    vi.useFakeTimers();
    vi.mocked(mountBlackboardEmbed).mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function fileNode(path: string) {
    const contentEl = document.createElement('div');
    return {
      file: { extension: 'blackboard', path },
      contentEl,
    };
  }

  function runLayoutHandler(canvas: any, repo: IDrawingRepository) {
    const mockPlugin = { registerEvent: vi.fn(), register: vi.fn() };
    const mockApp = {
      workspace: {
        on: vi.fn().mockReturnValue({ type: 'event' }),
        getMostRecentLeaf: vi.fn().mockReturnValue({ view: { canvas } }),
      },
    };
    patchCanvas(mockApp, mockPlugin, { ...DEFAULT_PLUGIN_SETTINGS }, repo, createMockCreateDrawing(''));
    const layoutChangeCalls = mockApp.workspace.on.mock.calls.filter((c: any) => c[0] === 'layout-change');
    layoutChangeCalls[0][1]();
  }

  it('mounts an unmounted .blackboard file node via mountBlackboardEmbed', () => {
    const repo = createMockRepo();
    const node = fileNode('A.blackboard');
    const canvas = {
      cardMenuEl: document.createElement('div'),
      nodes: new Map([['a', node]]),
    };

    runLayoutHandler(canvas, repo);

    expect(mountBlackboardEmbed).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mountBlackboardEmbed).mock.calls[0];
    expect(call[1]).toBe(node.contentEl);
    expect(call[2]).toBe('A.blackboard');
  });

  it('threads the shared ToolManager through to mountBlackboardEmbed (fix-tool-state-isolation)', () => {
    const repo = createMockRepo();
    const node = fileNode('A.blackboard');
    const canvas = {
      cardMenuEl: document.createElement('div'),
      nodes: new Map([['a', node]]),
    };
    const sharedToolManager = { setTool: vi.fn(), setColor: vi.fn(), setSize: vi.fn() } as any;

    const mockPlugin = { registerEvent: vi.fn(), register: vi.fn() };
    const mockApp = {
      workspace: {
        on: vi.fn().mockReturnValue({ type: 'event' }),
        getMostRecentLeaf: vi.fn().mockReturnValue({ view: { canvas } }),
      },
    };
    patchCanvas(mockApp, mockPlugin, { ...DEFAULT_PLUGIN_SETTINGS }, repo, createMockCreateDrawing(''), undefined, sharedToolManager);
    const layoutChangeCalls = mockApp.workspace.on.mock.calls.filter((c: any) => c[0] === 'layout-change');
    layoutChangeCalls[0][1]();

    expect(mountBlackboardEmbed).toHaveBeenCalledTimes(1);
    // 6th arg (index 5) is the shared ToolManager.
    expect(vi.mocked(mountBlackboardEmbed).mock.calls[0][5]).toBe(sharedToolManager);
  });

  it('does not mount a node already marked bbMounted=true', () => {
    const repo = createMockRepo();
    const node = fileNode('B.blackboard');
    node.contentEl.dataset.bbMounted = 'true';
    const canvas = {
      cardMenuEl: document.createElement('div'),
      nodes: new Map([['b', node]]),
    };

    runLayoutHandler(canvas, repo);

    expect(mountBlackboardEmbed).not.toHaveBeenCalled();
  });

  it('does not mount a node that already has a .blackboard-preview-img child', () => {
    const repo = createMockRepo();
    const node = fileNode('C.blackboard');
    const preview = document.createElement('img');
    preview.classList.add('blackboard-preview-img');
    node.contentEl.appendChild(preview);
    const canvas = {
      cardMenuEl: document.createElement('div'),
      nodes: new Map([['c', node]]),
    };

    runLayoutHandler(canvas, repo);

    expect(mountBlackboardEmbed).not.toHaveBeenCalled();
  });

  it('does not mount a node that already hosts a live surface (.blackboard-static) — B5 single engine', () => {
    // A Canvas file node can also be rendered by Obsidian's registered embedded
    // BlackboardView, which paints a `.blackboard-static` canvas into the same content
    // host. Mounting a second embed engine would duplicate the in-progress stroke.
    const repo = createMockRepo();
    const node = fileNode('F.blackboard');
    const liveCanvas = document.createElement('canvas');
    liveCanvas.classList.add('blackboard-static');
    node.contentEl.appendChild(liveCanvas);
    const canvas = {
      cardMenuEl: document.createElement('div'),
      nodes: new Map([['f', node]]),
    };

    runLayoutHandler(canvas, repo);

    expect(mountBlackboardEmbed).not.toHaveBeenCalled();
  });

  it('threads the shared DocumentStore through to mountBlackboardEmbed (7th arg)', () => {
    const repo = createMockRepo();
    const node = fileNode('G.blackboard');
    const canvas = {
      cardMenuEl: document.createElement('div'),
      nodes: new Map([['g', node]]),
    };
    const sharedStore = { acquire: vi.fn(), reconcile: vi.fn() } as any;

    const mockPlugin = { registerEvent: vi.fn(), register: vi.fn() };
    const mockApp = {
      workspace: {
        on: vi.fn().mockReturnValue({ type: 'event' }),
        getMostRecentLeaf: vi.fn().mockReturnValue({ view: { canvas } }),
      },
    };
    patchCanvas(mockApp, mockPlugin, { ...DEFAULT_PLUGIN_SETTINGS }, repo, createMockCreateDrawing(''), undefined, undefined, sharedStore);
    const layoutChangeCalls = mockApp.workspace.on.mock.calls.filter((c: any) => c[0] === 'layout-change');
    layoutChangeCalls[0][1]();

    expect(mountBlackboardEmbed).toHaveBeenCalledTimes(1);
    // 7th arg (index 6) is the shared DocumentStore.
    expect(vi.mocked(mountBlackboardEmbed).mock.calls[0][6]).toBe(sharedStore);
  });

  it('does not mount a node that already has a .blackboard-placeholder child', () => {
    const repo = createMockRepo();
    const node = fileNode('D.blackboard');
    const placeholder = document.createElement('div');
    placeholder.classList.add('blackboard-placeholder');
    node.contentEl.appendChild(placeholder);
    const canvas = {
      cardMenuEl: document.createElement('div'),
      nodes: new Map([['d', node]]),
    };

    runLayoutHandler(canvas, repo);

    expect(mountBlackboardEmbed).not.toHaveBeenCalled();
  });

  it('skips non-blackboard file nodes and mounts only the blackboard one', () => {
    const repo = createMockRepo();
    const bbNode = fileNode('E.blackboard');
    const mdNode = {
      file: { extension: 'md', path: 'note.md' },
      contentEl: document.createElement('div'),
    };
    const canvas = {
      cardMenuEl: document.createElement('div'),
      nodes: new Map<string, any>([['md', mdNode], ['e', bbNode]]),
    };

    runLayoutHandler(canvas, repo);

    expect(mountBlackboardEmbed).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mountBlackboardEmbed).mock.calls[0][1]).toBe(bbNode.contentEl);
  });
});

describe('fit-to-content removal', () => {
  it('no longer exports fitActiveCanvasNodeToContent', () => {
    expect((canvasIntegration as any).fitActiveCanvasNodeToContent).toBeUndefined();
  });
});
