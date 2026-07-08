import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentStore } from '../src/application/document-store';
import { serialize } from '../src/application/file-format';
import type { BlackboardFile, Stroke } from '../src/domain/entities';
import type { IDrawingRepository } from '../src/domain/ports';

function stroke(id: string): Stroke {
  return { id, tool: 'pen', color: '#fff', size: 2, opacity: 1, points: [[0, 0, 0.5]], hasPressure: false, timestamp: 0 };
}

function file(strokes: Stroke[]): BlackboardFile {
  return { version: 3, width: 800, height: 600, strokes, background: { color: 'transparent' } };
}

function mockRepo(initial: BlackboardFile): IDrawingRepository & { save: ReturnType<typeof vi.fn> } {
  return {
    load: vi.fn().mockResolvedValue({ file: initial, warnings: [], readonly: false }),
    save: vi.fn().mockResolvedValue(undefined),
    writeRaw: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(''),
    exists: vi.fn().mockReturnValue(true),
    ensureFolder: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe('DocumentStore', () => {
  let store: DocumentStore;
  beforeEach(() => { store = new DocumentStore({ saveDelayMs: 0 }); });

  it('loads strokes from the repo on first acquire', async () => {
    const repo = mockRepo(file([stroke('a')]));
    const h = await store.acquire('Draw.blackboard', repo);

    expect(repo.load).toHaveBeenCalledTimes(1);
    expect(h.getStrokes().map((s) => s.id)).toEqual(['a']);
  });

  it('a second acquire of the same path shares the canonical document without reloading', async () => {
    const repo = mockRepo(file([stroke('a')]));
    const h1 = await store.acquire('Draw.blackboard', repo);
    const h2 = await store.acquire('Draw.blackboard', repo);

    expect(repo.load).toHaveBeenCalledTimes(1);
    expect(h2.getStrokes().map((s) => s.id)).toEqual(['a']);
    expect(h1).not.toBe(h2); // distinct handles (distinct subscriber identities)
  });

  it('commit notifies sibling subscribers but NOT the committing handle (B2)', async () => {
    const repo = mockRepo(file([stroke('a')]));
    const h1 = await store.acquire('Draw.blackboard', repo);
    const h2 = await store.acquire('Draw.blackboard', repo);
    const onH1 = vi.fn();
    const onH2 = vi.fn();
    h1.subscribe(onH1);
    h2.subscribe(onH2);

    h1.commit(file([stroke('a'), stroke('b')]));

    expect(onH1).not.toHaveBeenCalled();           // committer is not re-notified
    expect(onH2).toHaveBeenCalledTimes(1);          // sibling refreshes
    expect(h2.getStrokes().map((s) => s.id)).toEqual(['a', 'b']); // canonical updated
  });

  it('commit persists the file through the repo', async () => {
    const repo = mockRepo(file([stroke('a')]));
    const h = await store.acquire('Draw.blackboard', repo);

    h.commit(file([stroke('a'), stroke('b')]));
    await new Promise((r) => setTimeout(r, 1)); // let the (0ms) debounce flush

    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.save.mock.calls[0][0]).toBe('Draw.blackboard');
    expect((repo.save.mock.calls[0][1] as BlackboardFile).strokes.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('reconcile with foreign disk content replaces strokes and notifies ALL subscribers', async () => {
    const repo = mockRepo(file([stroke('a')]));
    const h1 = await store.acquire('Draw.blackboard', repo);
    const h2 = await store.acquire('Draw.blackboard', repo);
    const onH1 = vi.fn();
    const onH2 = vi.fn();
    h1.subscribe(onH1);
    h2.subscribe(onH2);

    store.reconcile('Draw.blackboard', serialize(file([stroke('x'), stroke('y')])));

    expect(onH1).toHaveBeenCalledTimes(1);
    expect(onH2).toHaveBeenCalledTimes(1);
    expect(h1.getStrokes().map((s) => s.id)).toEqual(['x', 'y']);
  });

  it('reconcile ignores our own last-written content (no save->modify->reload loop)', async () => {
    const repo = mockRepo(file([stroke('a')]));
    const h = await store.acquire('Draw.blackboard', repo);
    const onChange = vi.fn();
    h.subscribe(onChange);

    const committed = file([stroke('a'), stroke('b')]);
    h.commit(committed);
    onChange.mockClear(); // committer wasn't notified anyway

    store.reconcile('Draw.blackboard', serialize(committed)); // our own write echoing back

    expect(onChange).not.toHaveBeenCalled();
  });

  it('releasing the last handle drops the entry so the next acquire reloads from disk', async () => {
    const repo = mockRepo(file([stroke('a')]));
    const h1 = await store.acquire('Draw.blackboard', repo);
    const h2 = await store.acquire('Draw.blackboard', repo);

    h1.release();
    h2.release();
    await store.acquire('Draw.blackboard', repo);

    expect(repo.load).toHaveBeenCalledTimes(2); // reloaded after the entry was dropped
  });
});
