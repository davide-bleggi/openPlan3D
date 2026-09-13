/**
 * Content-addressed storage for user-uploaded images — the background
 * tracing image and custom entourage symbols. Mirrors the furniture-model
 * import pipeline (`customFurnitureImport.ts`): the binary goes into the
 * shared IndexedDB blob store keyed by hash, and only that hash is kept on
 * the project, so a pasted photo or a PNG symbol can no longer blow the
 * ~5MB localStorage quota the way an inline base64 `dataUrl` did.
 */
import { sha256Hex } from './hash';
import { putBlob, getBlob, hasBlob } from '$lib/services/blobStore';

/** Generous safety cap — no longer a quota concern, just guards against pathological uploads. */
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

function assertSize(size: number) {
  if (size > MAX_IMAGE_SIZE) {
    throw new Error(`Image is too large (${(size / 1024 / 1024).toFixed(1)} MB) — max ${MAX_IMAGE_SIZE / 1024 / 1024} MB.`);
  }
}

/** Hash + store an uploaded image file. Idempotent — re-uploading the same bytes is a no-op store-wise. */
export async function importImageFile(file: File): Promise<{ hash: string }> {
  assertSize(file.size);
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  if (!(await hasBlob(hash))) {
    await putBlob(hash, new Blob([buffer], { type: file.type || 'image/png' }));
  }
  return { hash };
}

/** Hash + store an image already in memory as a data URL (clipboard paste, legacy-project migration). */
export async function importImageDataUrl(dataUrl: string): Promise<{ hash: string }> {
  const res = await fetch(dataUrl);
  const buffer = await res.arrayBuffer();
  assertSize(buffer.byteLength);
  const hash = await sha256Hex(buffer);
  if (!(await hasBlob(hash))) {
    const mime = dataUrl.slice(5, dataUrl.indexOf(';')) || 'image/png';
    await putBlob(hash, new Blob([buffer], { type: mime }));
  }
  return { hash };
}

// Resolved object URLs are kept for the page's lifetime — there are only ever
// a handful of these (one background image per floor, a few entourage defs),
// so there is no practical need to revoke them before the tab closes.
const urlCache = new Map<string, Promise<string | null>>();

/** Resolve a stored image's hash to a displayable object URL, or null if the blob is missing on this device. */
export function getImageObjectURL(hash: string): Promise<string | null> {
  if (urlCache.has(hash)) return urlCache.get(hash)!;
  const promise = (async () => {
    const blob = await getBlob(hash);
    return blob ? URL.createObjectURL(blob) : null;
  })();
  urlCache.set(hash, promise);
  return promise;
}

/** Whether an image's blob is missing from this device's IndexedDB (opened on a fresh device, sync not caught up, …). */
export async function isImageMissing(hash: string): Promise<boolean> {
  return !(await hasBlob(hash));
}
