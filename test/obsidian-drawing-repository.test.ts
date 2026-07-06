import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import { ObsidianDrawingRepository } from '../src/infrastructure/obsidian-drawing-repository';
import type { BlackboardFile } from '../src/domain/entities';

function makeApp() {
  return {
    vault: {
      getAbstractFileByPath: vi.fn(),
      read: vi.fn(),
      modify: vi.fn(),
      create: vi.fn(),
      createFolder: vi.fn(),
      delete: vi.fn(),
      rename: vi.fn(),
    },
    fileManager: {
      trashFile: vi.fn(),
    },
  };
}

function makeFile(): BlackboardFile {
  return {
    version: 1,
    strokes: [],
    background: { color: '#1a1a2e' },
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: { smoothing: 0.5, streamline: 0.5 },
  };
}

describe('ObsidianDrawingRepository', () => {
  let app: ReturnType<typeof makeApp>;
  let repo: ObsidianDrawingRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
    repo = new ObsidianDrawingRepository(app as any);
  });

  describe('load', () => {
    it('reads and deserializes file content', async () => {
      const tfile = new TFile();
      app.vault.getAbstractFileByPath.mockReturnValue(tfile);
      app.vault.read.mockResolvedValue(JSON.stringify(makeFile()));

      const result = await repo.load('test.blackboard');

      expect(result.file.version).toBe(1);
      expect(result.warnings).toEqual([]);
    });

    it('throws when file not found', async () => {
      app.vault.getAbstractFileByPath.mockReturnValue(null);

      await expect(repo.load('missing.blackboard')).rejects.toThrow('File not found');
    });
  });

  describe('save', () => {
    it('modifies existing file', async () => {
      const tfile = new TFile();
      app.vault.getAbstractFileByPath.mockReturnValue(tfile);

      await repo.save('test.blackboard', makeFile());

      expect(app.vault.modify).toHaveBeenCalledWith(tfile, expect.any(String));
    });

    it('creates new file when it does not exist', async () => {
      app.vault.getAbstractFileByPath.mockReturnValue(null);

      await repo.save('test.blackboard', makeFile());

      expect(app.vault.create).toHaveBeenCalledWith('test.blackboard', expect.any(String));
    });
  });

  describe('writeRaw', () => {
    it('modifies existing file with raw content', async () => {
      const tfile = new TFile();
      app.vault.getAbstractFileByPath.mockReturnValue(tfile);

      await repo.writeRaw('test.svg', '<svg></svg>');

      expect(app.vault.modify).toHaveBeenCalledWith(tfile, '<svg></svg>');
    });

    it('creates new file with raw content when not found', async () => {
      app.vault.getAbstractFileByPath.mockReturnValue(null);

      await repo.writeRaw('test.svg', '<svg></svg>');

      expect(app.vault.create).toHaveBeenCalledWith('test.svg', '<svg></svg>');
    });
  });

  describe('create', () => {
    it('creates file in folder and returns path', async () => {
      const tfile = Object.assign(new TFile(), { path: 'Drawings/test.blackboard' });
      app.vault.create.mockResolvedValue(tfile);

      const path = await repo.create('Drawings', 'test.blackboard', makeFile());

      expect(path).toBe('Drawings/test.blackboard');
      expect(app.vault.create).toHaveBeenCalledWith('Drawings/test.blackboard', expect.any(String));
    });

    it('creates file without folder prefix when folder is empty', async () => {
      const tfile = Object.assign(new TFile(), { path: 'test.blackboard' });
      app.vault.create.mockResolvedValue(tfile);

      const path = await repo.create('', 'test.blackboard', makeFile());

      expect(path).toBe('test.blackboard');
    });

    it('normalizes the constructed path before calling vault.create', async () => {
      const tfile = Object.assign(new TFile(), { path: 'Drawings/test.blackboard' });
      app.vault.create.mockResolvedValue(tfile);

      // A folder with a trailing slash must not yield a doubled separator.
      await repo.create('Drawings/', 'test.blackboard', makeFile());

      expect(app.vault.create).toHaveBeenCalledWith('Drawings/test.blackboard', expect.any(String));
    });
  });

  describe('exists', () => {
    it('returns true when file exists', () => {
      app.vault.getAbstractFileByPath.mockReturnValue(new TFile());
      expect(repo.exists('test.blackboard')).toBe(true);
    });

    it('returns false when file does not exist', () => {
      app.vault.getAbstractFileByPath.mockReturnValue(null);
      expect(repo.exists('missing.blackboard')).toBe(false);
    });
  });

  describe('ensureFolder', () => {
    it('creates folder when it does not exist', async () => {
      app.vault.getAbstractFileByPath.mockReturnValue(null);

      await repo.ensureFolder('Drawings');

      expect(app.vault.createFolder).toHaveBeenCalledWith('Drawings');
    });

    it('skips when folder already exists', async () => {
      app.vault.getAbstractFileByPath.mockReturnValue({});

      await repo.ensureFolder('Drawings');

      expect(app.vault.createFolder).not.toHaveBeenCalled();
    });

    it('skips when path is empty', async () => {
      await repo.ensureFolder('');

      expect(app.vault.createFolder).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('trashes existing file', async () => {
      const tfile = new TFile();
      app.vault.getAbstractFileByPath.mockReturnValue(tfile);

      await repo.delete('test.blackboard');

      expect(app.fileManager.trashFile).toHaveBeenCalledWith(tfile);
    });

    it('does nothing when file not found', async () => {
      app.vault.getAbstractFileByPath.mockReturnValue(null);

      await repo.delete('missing.blackboard');

      expect(app.fileManager.trashFile).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('renames existing file', async () => {
      const tfile = new TFile();
      app.vault.getAbstractFileByPath.mockReturnValue(tfile);

      await repo.rename('old.blackboard', 'new.blackboard');

      expect(app.vault.rename).toHaveBeenCalledWith(tfile, 'new.blackboard');
    });

    it('does nothing when file not found', async () => {
      app.vault.getAbstractFileByPath.mockReturnValue(null);

      await repo.rename('missing.blackboard', 'new.blackboard');

      expect(app.vault.rename).not.toHaveBeenCalled();
    });
  });
});
