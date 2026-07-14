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
  /**
   * Serialized forms we've written to disk (or accepted as an external edit) that are still
   * echoing back through the vault `modify` event. The `modify` handler is async, so an echo
   * of an EARLIER save can arrive AFTER a newer commit has advanced the document — a single
   * "last written" slot mis-reads that stale echo as a foreign edit and reverts, silently
   * deleting the strokes drawn in between. Remembering every recent self-write closes that race.
   */
  seen: Set<string>;
  saveTimer: ReturnType<typeof setTimeout> | null;
  repo: IDrawingRepository;
}

/** How many recent self-writes to remember. Far above any realistic number of in-flight
 * disk writes, so a delayed echo is always still recognized, while the set stays bounded. */
const SEEN_LIMIT = 32;

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
        seen: new Set(),
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
    if (diskContent === serialize(entry.file)) return; // already our canonical state — nothing to do
    if (entry.seen.has(diskContent)) return; // a (possibly delayed) echo of one of our own writes
    const { file } = deserialize(diskContent);
    entry.file = file;
    this.remember(entry, diskContent); // remember accepted bytes so duplicate echoes are ignored too
    for (const cb of entry.subscribers.values()) cb(); // genuine external edit: refresh everyone
  }

  private commit(path: string, originId: symbol, file: BlackboardFile): void {
    const entry = this.entries.get(path);
    if (!entry) return;
    entry.file = file;
    for (const [id, cb] of entry.subscribers) {
      if (id !== originId) cb(); // refresh siblings, never the committer
    }
    this.scheduleSave(path);
  }

  /** Record a serialized content as one of ours, evicting the oldest to stay bounded. */
  private remember(entry: Entry, content: string): void {
    entry.seen.add(content);
    while (entry.seen.size > SEEN_LIMIT) {
      const oldest = entry.seen.values().next().value;
      if (oldest === undefined) break;
      entry.seen.delete(oldest);
    }
  }

  /**
   * Immediately write every path with a pending debounced save. Called when the app is about
   * to be backgrounded/suspended (iPad lock screen, tab hidden) — otherwise a stroke drawn
   * within the debounce window before suspension is lost, because the timer never fires while
   * the WebView is frozen. Writes the canonical document, so it can never blank a drawing.
   */
  flushAll(): void {
    for (const [path, entry] of this.entries) {
      if (entry.saveTimer !== null) {
        window.clearTimeout(entry.saveTimer);
        entry.saveTimer = null;
        this.remember(entry, serialize(entry.file));
        void entry.repo.save(path, entry.file);
      }
    }
  }

  private scheduleSave(path: string): void {
    const entry = this.entries.get(path);
    if (!entry) return;
    if (entry.saveTimer !== null) window.clearTimeout(entry.saveTimer);
    entry.saveTimer = window.setTimeout(() => {
      entry.saveTimer = null;
      // Remember exactly what we're about to write BEFORE its `modify` echo can arrive, so a
      // later reconcile recognizes it as our own even after newer commits move the document on.
      this.remember(entry, serialize(entry.file));
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
        this.remember(entry, serialize(entry.file));
        void entry.repo.save(path, entry.file);
      }
      this.entries.delete(path);
    }
  }
}
