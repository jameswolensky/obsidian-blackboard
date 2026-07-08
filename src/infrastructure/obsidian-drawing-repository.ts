import { App, TFile, normalizePath } from 'obsidian';
import type { IDrawingRepository } from '../domain/ports';
import type { BlackboardFile } from '../domain/entities';
import { serialize, deserialize } from '../application/file-format';

export class ObsidianDrawingRepository implements IDrawingRepository {
  constructor(private app: App) {}

  async load(path: string): Promise<{ file: BlackboardFile; warnings: string[]; readonly: boolean }> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`);
    const content = await this.app.vault.read(file);
    return deserialize(content);
  }

  async save(path: string, drawingFile: BlackboardFile): Promise<void> {
    const content = serialize(drawingFile);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }

  async writeRaw(path: string, content: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }

  async create(folder: string, name: string, drawingFile: BlackboardFile): Promise<string> {
    const content = serialize(drawingFile);
    const path = normalizePath(folder ? `${folder}/${name}` : name);
    const file = await this.app.vault.create(path, content);
    return file.path;
  }

  exists(path: string): boolean {
    return !!this.app.vault.getAbstractFileByPath(path);
  }

  async ensureFolder(path: string): Promise<void> {
    if (path && !this.exists(path)) {
      await this.app.vault.createFolder(path);
    }
  }

  async delete(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.delete(file);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(oldPath);
    if (file instanceof TFile) {
      await this.app.vault.rename(file, newPath);
    }
  }
}
