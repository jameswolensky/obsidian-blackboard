import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IDrawingRepository } from '../src/domain/ports';
import type { BlackboardFile, PluginSettings } from '../src/domain/entities';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/domain/entities';
import { CreateDrawingUseCase } from '../src/application/use-cases/create-drawing';

class MockDrawingRepository implements IDrawingRepository {
  files = new Map<string, BlackboardFile>();
  folders = new Set<string>();
  rawFiles = new Map<string, string>();

  async load(path: string) {
    const file = this.files.get(path);
    if (!file) throw new Error(`Not found: ${path}`);
    return { file, warnings: [], readonly: false };
  }
  async save(path: string, file: BlackboardFile) { this.files.set(path, file); }
  async writeRaw(path: string, content: string) { this.rawFiles.set(path, content); }
  async create(folder: string, name: string, file: BlackboardFile) {
    const path = folder ? `${folder}/${name}` : name;
    this.files.set(path, file);
    return path;
  }
  exists(path: string) { return this.files.has(path) || this.folders.has(path); }
  async ensureFolder(path: string) { if (path) this.folders.add(path); }
  async delete(path: string) { this.files.delete(path); this.rawFiles.delete(path); }
  async rename(oldPath: string, newPath: string) {
    const f = this.files.get(oldPath);
    if (f) { this.files.delete(oldPath); this.files.set(newPath, f); }
    const r = this.rawFiles.get(oldPath);
    if (r) { this.rawFiles.delete(oldPath); this.rawFiles.set(newPath, r); }
  }
}

describe('CreateDrawingUseCase', () => {
  let repo: MockDrawingRepository;
  let useCase: CreateDrawingUseCase;
  let settings: PluginSettings;

  beforeEach(() => {
    repo = new MockDrawingRepository();
    useCase = new CreateDrawingUseCase(repo);
    settings = { ...DEFAULT_PLUGIN_SETTINGS, drawingFolder: 'Drawings' };
  });

  it('creates file in fixed folder', async () => {
    const path = await useCase.execute(settings, 'fixed');

    expect(path).toMatch(/^Drawings\/Drawing \d+\.blackboard$/);
    expect(repo.files.has(path)).toBe(true);
  });

  it('creates file in current folder when location is current', async () => {
    const path = await useCase.execute(settings, 'current', 'Notes/subfolder');

    expect(path).toMatch(/^Notes\/subfolder\/Drawing \d+\.blackboard$/);
  });

  it('falls back to drawingFolder when location is current but no currentFolderPath', async () => {
    const path = await useCase.execute(settings, 'current');

    expect(path).toMatch(/^Drawings\/Drawing \d+\.blackboard$/);
  });

  it('creates at the vault root when location is current and currentFolderPath is empty', async () => {
    // An empty path means the active note lives at the vault root, which is a valid
    // "current" location (distinct from undefined, which has no current folder).
    const path = await useCase.execute(settings, 'current', '');

    expect(path).toMatch(/^Drawing \d+\.blackboard$/);
  });

  it('ensures folder exists before creating', async () => {
    await useCase.execute(settings, 'fixed');

    expect(repo.folders.has('Drawings')).toBe(true);
  });

  it('returns the file path', async () => {
    const path = await useCase.execute(settings, 'fixed');

    expect(typeof path).toBe('string');
    expect(path.length).toBeGreaterThan(0);
  });

  it('creates a valid BlackboardFile with default properties', async () => {
    const path = await useCase.execute(settings, 'fixed');
    const file = repo.files.get(path)!;

    expect(file.version).toBe(3);
    expect(file.strokes).toEqual([]);
    expect(file.background.color).toBe('transparent');
  });
});
