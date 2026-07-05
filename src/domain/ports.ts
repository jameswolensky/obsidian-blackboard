import type { BlackboardFile } from './entities';

/** Repository port for drawing file persistence.
 *  Serialization is the repository's responsibility. */
export interface IDrawingRepository {
  load(path: string): Promise<{ file: BlackboardFile; warnings: string[]; readonly: boolean }>;
  save(path: string, file: BlackboardFile): Promise<void>;
  writeRaw(path: string, content: string): Promise<void>;
  create(folder: string, name: string, file: BlackboardFile): Promise<string>;
  exists(path: string): boolean;
  ensureFolder(path: string): Promise<void>;
  delete(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}
