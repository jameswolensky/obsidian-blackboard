import type { IDrawingRepository } from '../../domain/ports';
import type { PluginSettings } from '../../domain/entities';
import { createDefaultFile, FILE_EXTENSION } from '../../domain/entities';

export class CreateDrawingUseCase {
  constructor(private repo: IDrawingRepository) {}

  async execute(
    settings: PluginSettings,
    location: 'fixed' | 'current',
    currentFolderPath?: string,
  ): Promise<string> {
    // currentFolderPath is '' for a note at the vault root, which is still a valid
    // "current" location, so distinguish it from undefined rather than treating it as falsy.
    const folder = location === 'current' && currentFolderPath !== undefined
      ? currentFolderPath
      : settings.drawingFolder;

    await this.repo.ensureFolder(folder);

    const defaultFile = createDefaultFile(settings);
    const name = `Drawing ${Date.now()}.${FILE_EXTENSION}`;
    return this.repo.create(folder, name, defaultFile);
  }
}
