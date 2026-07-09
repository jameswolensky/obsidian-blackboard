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

  let parsed: unknown;
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

  const version =
    typeof parsed === 'object' && parsed !== null && 'version' in parsed
      ? parsed.version
      : undefined;
  if (typeof version === 'number' && version > 3) {
    warnings.push('File version ' + String(version) + ' is newer than supported version 3');
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
