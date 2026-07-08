import type { BlackboardFile } from '../domain/entities';
import { validateFileData } from '../domain/entities';

export function serialize(file: BlackboardFile): string {
  return JSON.stringify(file, null, 2);
}

export function deserialize(data: string): { file: BlackboardFile; warnings: string[]; readonly: boolean } {
  const warnings: string[] = [];
  let readonly = false;

  if (!data || data.trim() === '') {
    return {
      file: { version: 3, width: 800, height: 600, strokes: [], background: { color: 'transparent' } },
      warnings: [],
      readonly: false,
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(data);
  } catch {
    warnings.push('Invalid JSON');
    return {
      file: { version: 3, width: 800, height: 600, strokes: [], background: { color: 'transparent' } },
      warnings,
      readonly: true,
    };
  }

  if (typeof parsed.version === 'number' && parsed.version > 3) {
    warnings.push('File version ' + parsed.version + ' is newer than supported version 3');
    readonly = true;
  }

  const validated = validateFileData(parsed);
  if (!validated) {
    warnings.push('Invalid file structure');
    return {
      file: { version: 3, width: 800, height: 600, strokes: [], background: { color: 'transparent' } },
      warnings,
      readonly: true,
    };
  }

  return { file: validated, warnings, readonly };
}
