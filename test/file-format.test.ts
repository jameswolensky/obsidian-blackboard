import { describe, it, expect } from 'vitest';
import { serialize, deserialize } from '../src/application/file-format';
import type { BlackboardFile } from '../src/domain/entities';
import { createDefaultFile, DEFAULT_PLUGIN_SETTINGS } from '../src/domain/entities';

function makeFile(overrides: Partial<BlackboardFile> = {}): BlackboardFile {
  return {
    version: 3,
    width: 800,
    height: 600,
    strokes: [],
    background: { color: 'transparent' },
    ...overrides,
  };
}

describe('serialize', () => {
  it('returns valid JSON', () => {
    const result = serialize(makeFile());
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('uses 2-space indentation', () => {
    const result = serialize(makeFile());
    expect(result).toContain('  "version"');
  });

  it('preserves version field', () => {
    const result = serialize(makeFile({ version: 2 }));
    const parsed = JSON.parse(result);
    expect(parsed.version).toBe(2);
  });

  it('includes width and height in output', () => {
    const result = serialize(makeFile({ width: 1024, height: 768 }));
    const parsed = JSON.parse(result);
    expect(parsed.width).toBe(1024);
    expect(parsed.height).toBe(768);
  });

  it('preserves strokes array', () => {
    const file = makeFile({
      strokes: [{
        id: 's1', tool: 'pen', color: '#fff', size: 2, opacity: 1,
        points: [[10, 20, 0.5]], hasPressure: false, timestamp: 123,
      }],
    });
    const result = serialize(file);
    const parsed = JSON.parse(result);
    expect(parsed.strokes).toHaveLength(1);
    expect(parsed.strokes[0].id).toBe('s1');
  });

  it('preserves background color', () => {
    const result = serialize(makeFile({ background: { color: '#ff0000' } }));
    const parsed = JSON.parse(result);
    expect(parsed.background.color).toBe('#ff0000');
  });
});

describe('deserialize', () => {
  it('parses valid file data', () => {
    const json = serialize(makeFile());
    const result = deserialize(json);
    expect(result.file.version).toBe(3);
  });

  it('returns empty file for empty string', () => {
    const result = deserialize('');
    expect(result.file.strokes).toEqual([]);
    expect(result.warnings).toHaveLength(0);
    expect((result.file as any).settings).toBeUndefined();
  });

  it('invalid-JSON fallback file carries no settings block', () => {
    const result = deserialize('{bad}');
    expect((result.file as any).settings).toBeUndefined();
  });

  it('returns readonly true for invalid JSON', () => {
    const result = deserialize('{invalid json}');
    expect(result.readonly).toBe(true);
    expect(result.warnings).toContain('Invalid JSON');
  });

  it('returns readonly true for future version', () => {
    const json = JSON.stringify({ version: 99, strokes: [], background: { color: '#000' }, viewport: { x: 0, y: 0, zoom: 1 }, settings: { smoothing: 0.5, streamline: 0.5 } });
    const result = deserialize(json);
    expect(result.readonly).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns readonly false for a current-version file', () => {
    const json = serialize(makeFile());
    const result = deserialize(json);
    expect(result.readonly).toBe(false);
  });

  it('filters invalid strokes', () => {
    const json = JSON.stringify({
      version: 1,
      strokes: [
        { id: 's1', tool: 'pen', color: '#fff', size: 2, opacity: 1, points: [[0, 0, 0.5]], hasPressure: false, timestamp: 1 },
        { bad: true },
        null,
      ],
      background: { color: '#000' },
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { smoothing: 0.5, streamline: 0.5 },
    });
    const result = deserialize(json);
    expect(result.file.strokes).toHaveLength(1);
  });

  it('returns default background when missing', () => {
    const json = JSON.stringify({ version: 1, strokes: [] });
    const result = deserialize(json);
    expect(result.file.background.color).toBe('transparent');
  });

  it('does not set viewport field when missing from input', () => {
    const json = JSON.stringify({ version: 1, strokes: [] });
    const result = deserialize(json);
    expect(result.file.viewport).toBeUndefined();
  });

  it('does not carry a settings block', () => {
    const json = JSON.stringify({ version: 1, strokes: [] });
    const result = deserialize(json);
    expect((result.file as any).settings).toBeUndefined();
  });

  it('loads a legacy file that still carries a settings block (field ignored, not a failure)', () => {
    const json = JSON.stringify({
      version: 3,
      strokes: [],
      background: { color: 'transparent' },
      settings: { smoothing: 0.7, streamline: 0.2 },
    });
    const result = deserialize(json);
    expect(result.readonly).toBe(false);
    expect(result.warnings).toEqual([]);
    expect((result.file as any).settings).toBeUndefined();
  });

  it('returns readonly true for missing version and strokes', () => {
    const json = JSON.stringify({ something: 'else' });
    const result = deserialize(json);
    expect(result.readonly).toBe(true);
  });

  it('round-trips correctly', () => {
    const original = makeFile({
      strokes: [{
        id: 'test', tool: 'highlighter', color: '#ffff00', size: 20, opacity: 0.3,
        points: [[1, 2, 0.5], [3, 4, 0.8]], hasPressure: true, timestamp: 999,
      }],
    });
    const json = serialize(original);
    const result = deserialize(json);
    expect(result.file).toEqual(original);
  });

  it('embedWidth is not preserved (removed in v3)', () => {
    const json = JSON.stringify({ version: 1, strokes: [], embedWidth: 500, embedHeight: 400 });

    const result = deserialize(json);

    expect((result.file as any).embedWidth).toBeUndefined();
    expect((result.file as any).embedHeight).toBeUndefined();
  });

  it('embedWidth absent when not set in source', () => {
    const original = makeFile();
    const json = serialize(original);

    const result = deserialize(json);

    expect((result.file as any).embedWidth).toBeUndefined();
  });

  it('corrupt JSON returns readonly with Invalid JSON warning', () => {
    const result = deserialize('not json');

    expect(result.readonly).toBe(true);
    expect(result.warnings).toContain('Invalid JSON');
  });

  it('version > 3 returns readonly with version warning', () => {
    const json = JSON.stringify({ version: 4, strokes: [], background: { color: '#000' }, settings: { smoothing: 0.5, streamline: 0.5 } });

    const result = deserialize(json);

    expect(result.readonly).toBe(true);
    expect(result.warnings.some(w => w.includes('version'))).toBe(true);
  });

  it('deserialize reads width and height from v2 file', () => {
    const json = JSON.stringify({ version: 2, width: 1024, height: 768, strokes: [], background: { color: '#000' }, viewport: { x: 0, y: 0, zoom: 1 }, settings: { smoothing: 0.5, streamline: 0.5 } });
    const result = deserialize(json);
    expect(result.file.width).toBe(1024);
    expect(result.file.height).toBe(768);
    expect(result.readonly).toBe(false);
  });

  it('v1 files without dimensions get default 800x600', () => {
    const json = JSON.stringify({ version: 1, strokes: [], background: { color: '#000' }, viewport: { x: 0, y: 0, zoom: 1 }, settings: { smoothing: 0.5, streamline: 0.5 } });
    const result = deserialize(json);
    expect(result.file.width).toBe(800);
    expect(result.file.height).toBe(600);
  });

  it('empty string fallback includes width and height', () => {
    const result = deserialize('');
    expect(result.file.width).toBe(800);
    expect(result.file.height).toBe(600);
  });

  it('invalid JSON fallback includes width and height', () => {
    const result = deserialize('{bad}');
    expect(result.file.width).toBe(800);
    expect(result.file.height).toBe(600);
  });
});

describe('createDefaultFile', () => {
  it('returns version 3 with default dimensions', () => {
    const file = createDefaultFile(DEFAULT_PLUGIN_SETTINGS);
    expect(file.version).toBe(3);
    expect(file.width).toBe(800);
    expect(file.height).toBe(600);
  });
});

describe('file format v3', () => {
  it('createDefaultFile produces version 3 with no viewport', () => {
    const f = createDefaultFile(DEFAULT_PLUGIN_SETTINGS);
    expect(f.version).toBe(3);
    expect((f as any).viewport).toBeUndefined();
  });

  it('deserialize reads a v2 file without marking it readonly', () => {
    const v2 = JSON.stringify({ version: 2, width: 800, height: 600, strokes: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const { file, readonly } = deserialize(v2);
    expect(readonly).toBe(false);
    expect(file.strokes).toEqual([]);
  });

  it('deserialize reads a v3 file without marking it readonly', () => {
    const v3 = JSON.stringify({ version: 3, strokes: [], background: { color: 'transparent' }, settings: { smoothing: 0.5, streamline: 0.5 } });
    const { file, readonly } = deserialize(v3);
    expect(readonly).toBe(false);
    expect(file.version).toBe(3);
  });

  it('deserialize marks version 4+ readonly', () => {
    const v4 = JSON.stringify({ version: 4, strokes: [] });
    expect(deserialize(v4).readonly).toBe(true);
  });

  it('drops contentBounds with non-numeric fields', () => {
    const bad = JSON.stringify({ version: 3, strokes: [], contentBounds: { x: 'evil', y: null, width: 10, height: 10 } });
    expect(deserialize(bad).file.contentBounds).toBeUndefined();
  });

  it('keeps valid numeric contentBounds', () => {
    const good = JSON.stringify({ version: 3, strokes: [], contentBounds: { x: 1, y: 2, width: 30, height: 40 } });
    expect(deserialize(good).file.contentBounds).toEqual({ x: 1, y: 2, width: 30, height: 40 });
  });
});
