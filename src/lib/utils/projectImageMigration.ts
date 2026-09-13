/**
 * One-time migration for projects saved before background images and custom
 * entourage symbols moved off inline base64 `dataUrl` and onto the shared
 * IndexedDB blob store (see `imageStore.ts`). Called wherever a project is
 * loaded from persistence or from an imported file, so an old, possibly
 * quota-bloated project self-heals the moment it's opened.
 *
 * Safe to call on an already-migrated (or brand new) project — it only acts
 * on fields that still carry the legacy `dataUrl` shape.
 */
import type { Project } from '$lib/models/types';
import { importImageDataUrl } from './imageStore';

/** True if anything in the project was migrated (caller may want to persist the result). */
export async function migrateProjectImages(project: Project): Promise<boolean> {
  let migrated = false;

  for (const floor of project.floors ?? []) {
    const bg = floor.backgroundImage as (typeof floor.backgroundImage & { dataUrl?: string }) | undefined;
    if (bg && typeof bg.dataUrl === 'string') {
      const { hash } = await importImageDataUrl(bg.dataUrl);
      bg.hash = hash;
      delete bg.dataUrl;
      migrated = true;
    }
  }

  for (const def of project.customEntourage ?? []) {
    const legacy = def as typeof def & { dataUrl?: string };
    if (typeof legacy.dataUrl === 'string') {
      const { hash } = await importImageDataUrl(legacy.dataUrl);
      legacy.hash = hash;
      delete legacy.dataUrl;
      migrated = true;
    }
  }

  return migrated;
}
