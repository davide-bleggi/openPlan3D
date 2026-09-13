/**
 * Single entry point for "open a file" imports that need to accept both
 * plain .json and .zip on the same file input, discriminating on content
 * rather than trusting the extension.
 */
import { importProjectZip } from './projectZip';
import { extractRoomJsonFromZip } from './roomplanImport';

export type ImportedFileResult =
  | { kind: 'project'; data: unknown; restoredModels: number }
  | { kind: 'roomplan'; data: unknown }
  | { kind: 'json'; data: unknown };

export async function loadImportedFile(file: File): Promise<ImportedFileResult> {
  if (file.name.toLowerCase().endsWith('.zip')) {
    try {
      const { project, restoredModels } = await importProjectZip(file);
      return { kind: 'project', data: project, restoredModels };
    } catch {
      // Not a project bundle — see if it's an Apple RoomPlan export instead.
      const roomJson = await extractRoomJsonFromZip(file);
      return { kind: 'roomplan', data: roomJson };
    }
  }
  const text = await file.text();
  return { kind: 'json', data: JSON.parse(text) };
}
