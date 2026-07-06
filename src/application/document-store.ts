import type { BlackboardFile, Stroke } from '../domain/entities';
import type { IDrawingRepository } from '../domain/ports';
import { serialize, deserialize } from './file-format';

/**
 * A handle to the shared document for one file path, held by a single mounted surface.
 * Each acquire() returns a distinct handle (a distinct subscriber identity), so a commit
 * from one surface notifies its siblings but never itself.
 */
export interface SharedDocumentHandle {
  /** Canonical strokes for the path (authoritative across all surfaces). */
  getStrokes(): Stroke[];
  /** Canonical file (for the saved width/height used as a stable fit reference). */
  getFile(): BlackboardFile;
  /** Register this surface's refresh callback (fired when a sibling or external edit lands). */
  subscribe(onChange: () => void): void;
  /** Replace the canonical document, persist (debounced), and refresh sibling surfaces. */
  commit(file: BlackboardFile): void;
  /** Release this surface's reference; the entry is dropped when the last surface unmounts. */
  release(): void;
}

interface Entry {
  file: BlackboardFile;
  subscribers: Map<symbol, () => void>;
  refCount: number;
  /** Serialized form of our most recent write — the origin guard for reconcile(). */
  lastWrittenContent: string;
  saveTimer: ReturnType<typeof setTimeout> | null;
  repo: IDrawingRepository;
}

/**
 * Single source of truth for `.blackboard` stroke data, keyed by file path. Every mounted
 * surface (standalone view, Markdown embed, Canvas node) of the same file shares one canonical
 * document: a commit from any surface updates the canonical strokes, persists once (debounced),
 * and synchronously refreshes the other surfaces — so drawing on one is immediately visible on
 * all (B2). External edits arrive via reconcile() and are suppressed when they echo our own write.
 */
export class DocumentStore {
  private entries = new Map<string, Entry>();
  private readonly saveDelayMs: number;

  constructor(opts?: { saveDelayMs?: number }) {
    this.saveDelayMs = opts?.saveDelayMs ?? 250;
  }

  async acquire(path: string, repo: IDrawingRepository): Promise<SharedDocumentHandle> {
    let entry = this.entries.get(path);
    if (!entry) {
      const { file } = await repo.load(path);
      entry = {
        file,
        subscribers: new Map(),
        refCount: 0,
        lastWrittenContent: serialize(file),
        saveTimer: null,
        repo,
      };
      this.entries.set(path, entry);
    }
    entry.refCount++;
    const id = Symbol('surface');
    const e = entry;
    return {
      getStrokes: () => e.file.strokes,
      getFile: () => e.file,
      subscribe: (onChange) => { e.subscribers.set(id, onChange); },
      commit: (file) => this.commit(path, id, file),
      release: () => this.release(path, id),
    };
  }

  /** External-edit channel (vault `modify`): refresh from disk unless the content is our own write. */
  reconcile(path: string, diskContent: string): void {
    const entry = this.entries.get(path);
    if (!entry) return;
    if (diskContent === entry.lastWrittenContent) return; // our own save echoing back — ignore
    const { file } = deserialize(diskContent);
    entry.file = file;
    entry.lastWrittenContent = diskContent;
    for (const cb of entry.subscribers.values()) cb(); // genuine external edit: refresh everyone
  }

  private commit(path: string, originId: symbol, file: BlackboardFile): void {
    const entry = this.entries.get(path);
    if (!entry) return;
    entry.file = file;
    entry.lastWrittenContent = serialize(file);
    for (const [id, cb] of entry.subscribers) {
      if (id !== originId) cb(); // refresh siblings, never the committer
    }
    this.scheduleSave(path);
  }

  private scheduleSave(path: string): void {
    const entry = this.entries.get(path);
    if (!entry) return;
    if (entry.saveTimer !== null) window.clearTimeout(entry.saveTimer);
    entry.saveTimer = window.setTimeout(() => {
      entry.saveTimer = null;
      void entry.repo.save(path, entry.file);
    }, this.saveDelayMs);
  }

  private release(path: string, id: symbol): void {
    const entry = this.entries.get(path);
    if (!entry) return;
    entry.subscribers.delete(id);
    entry.refCount--;
    if (entry.refCount <= 0) {
      // Flush any pending debounced write so the last edit is never lost on unmount.
      if (entry.saveTimer !== null) {
        window.clearTimeout(entry.saveTimer);
        entry.saveTimer = null;
        void entry.repo.save(path, entry.file);
      }
      this.entries.delete(path);
    }
  }
}
