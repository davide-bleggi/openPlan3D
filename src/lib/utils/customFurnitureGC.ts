/**
 * Blobs in IndexedDB are deduplicated by content hash across *all* projects,
 * so deleting a def from one project must not delete a blob another project
 * still references. This scans localStorage (there are only ever a handful
 * of projects) before actually freeing a blob.
 */
import { localStore } from '$lib/services/datastore';
import { deleteBlob } from '$lib/services/blobStore';

export async function gcModelBlobIfUnreferenced(hash: string, skipProjectId?: string): Promise<void> {
  try {
    const projects = await localStore.list();
    for (const meta of projects) {
      if (meta.id === skipProjectId) continue;
      const proj = await localStore.load(meta.id);
      if (proj?.customFurniture?.some((c) => c.hash === hash)) return; // still referenced elsewhere
    }
    await deleteBlob(hash);
  } catch {
    // Best-effort cleanup — leaving an orphaned blob is harmless (just wasted IndexedDB space).
  }
}
