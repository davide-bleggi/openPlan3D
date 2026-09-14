/**
 * Single entry point for "open a file" imports that need to accept both
 * plain .json and .zip on the same file input, discriminating on content
 * rather than trusting the extension.
 */
import type { Project } from '$lib/models/types';
import { importProjectZip } from './projectZip';
import { extractRoomJsonFromZip } from './roomplanImport';
import { migrateProjectImages } from './projectImageMigration';

export type ImportedFileResult =
  | { kind: 'project'; data: unknown; restoredModels: number; restoredImages: number }
  | { kind: 'roomplan'; data: unknown }
  | { kind: 'json'; data: unknown };

/** A pre-IndexedDB export still has inline dataUrl fields — bring it up to the current shape. */
async function migrateIfProjectShaped(data: unknown): Promise<void> {
  if (data && typeof data === 'object' && Array.isArray((data as Project).floors)) {
    await migrateProjectImages(data as Project);
  }
}

export async function loadImportedFile(file: File): Promise<ImportedFileResult> {
  if (file.name.toLowerCase().endsWith('.zip')) {
    try {
      const { project, restoredModels, restoredImages } = await importProjectZip(file);
      await migrateIfProjectShaped(project);
      return { kind: 'project', data: project, restoredModels, restoredImages };
    } catch {
      // Not a project bundle — see if it's an Apple RoomPlan export instead.
      const roomJson = await extractRoomJsonFromZip(file);
      return { kind: 'roomplan', data: roomJson };
    }
  }
  const text = await file.text();
  const data = JSON.parse(text);
  await migrateIfProjectShaped(data);
  return { kind: 'json', data };
}
