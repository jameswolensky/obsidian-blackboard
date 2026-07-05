import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IDrawingRepository } from '../src/domain/ports';
import type { BlackboardFile } from '../src/domain/entities';
import { ExportSvgUseCase } from '../src/application/use-cases/export-svg';

vi.mock('../src/application/export-service', () => ({
  exportSvg: vi.fn(() => '<svg>mock</svg>'),
}));

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

function makeFile(overrides: Partial<BlackboardFile> = {}): BlackboardFile {
  return {
    version: 1,
    strokes: [],
    background: { color: '#1a1a2e' },
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: { smoothing: 0.5, streamline: 0.5 },
    ...overrides,
  };
}

describe('ExportSvgUseCase', () => {
  let repo: MockDrawingRepository;
  let useCase: ExportSvgUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new MockDrawingRepository();
    useCase = new ExportSvgUseCase(repo);
  });

  it('skips export when strokes are empty', async () => {
    repo.files.set('drawing.blackboard', makeFile());

    await useCase.execute('drawing.blackboard', '');

    expect(repo.rawFiles.size).toBe(0);
  });

  it('exports SVG to same folder when no svgExportFolder', async () => {
    repo.files.set('folder/drawing.blackboard', makeFile({
      strokes: [{ id: 's1', tool: 'pen', color: '#fff', size: 2, opacity: 1, points: [[0, 0, 0.5]], hasPressure: false, timestamp: 0 }],
    }));

    await useCase.execute('folder/drawing.blackboard', '');

    expect(repo.rawFiles.has('folder/drawing.svg')).toBe(true);
    expect(repo.rawFiles.get('folder/drawing.svg')).toContain('<svg');
  });

  it('exports SVG to configured export folder', async () => {
    repo.files.set('folder/drawing.blackboard', makeFile({
      strokes: [{ id: 's1', tool: 'pen', color: '#fff', size: 2, opacity: 1, points: [[0, 0, 0.5]], hasPressure: false, timestamp: 0 }],
    }));

    await useCase.execute('folder/drawing.blackboard', 'exports/svg');

    expect(repo.rawFiles.has('exports/svg/drawing.svg')).toBe(true);
  });

  it('ensures export folder exists when svgExportFolder is set', async () => {
    repo.files.set('drawing.blackboard', makeFile({
      strokes: [{ id: 's1', tool: 'pen', color: '#fff', size: 2, opacity: 1, points: [[0, 0, 0.5]], hasPressure: false, timestamp: 0 }],
    }));

    await useCase.execute('drawing.blackboard', 'exports');

    expect(repo.folders.has('exports')).toBe(true);
  });

  it('uses writeRaw to save SVG content', async () => {
    repo.files.set('test.blackboard', makeFile({
      strokes: [{ id: 's1', tool: 'pen', color: '#fff', size: 2, opacity: 1, points: [[0, 0, 0.5]], hasPressure: false, timestamp: 0 }],
    }));

    await useCase.execute('test.blackboard', '');

    const svg = repo.rawFiles.get('test.svg');
    expect(svg).toBeDefined();
    expect(svg).toContain('<svg');
  });

  it('exports file without folder prefix in basename', async () => {
    repo.files.set('drawing.blackboard', makeFile({
      strokes: [{ id: 's1', tool: 'pen', color: '#fff', size: 2, opacity: 1, points: [[0, 0, 0.5]], hasPressure: false, timestamp: 0 }],
    }));

    await useCase.execute('drawing.blackboard', '');

    expect(repo.rawFiles.has('drawing.svg')).toBe(true);
  });
});
