/**
 * Cross-device-portable project bundle: project.json (references + metadata
 * only) plus models/*.glb and images/* (the actual binaries, named by
 * content hash).
 *
 * Once imported models and images live in IndexedDB, a plain .json export is
 * no longer self-contained — it references blobs that only exist on the
 * browser that created them. This is the format that travels.
 */
import type { Project } from '$lib/models/types';
import { getBlob, hasBlob, putBlob } from '$lib/services/blobStore';
import { sha256Hex } from './hash';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};
const EXT_TO_MIME: Record<string, string> = Object.fromEntries(Object.entries(IMAGE_EXT).map(([mime, ext]) => [ext, mime]));

/** Every image hash a project references: floor background images + custom entourage symbols. */
function imageHashesOf(project: Project): Set<string> {
  const hashes = new Set<string>();
  for (const floor of project.floors ?? []) {
    if (floor.backgroundImage?.hash) hashes.add(floor.backgroundImage.hash);
  }
  for (const def of project.customEntourage ?? []) {
    if (def.hash) hashes.add(def.hash);
  }
  return hashes;
}

/** Export a project as a .zip bundle (project.json + models/*.glb + images/*) so imported binaries travel with it. */
export async function exportProjectAsZip(project: Project): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(project, null, 2));

  const modelHashes = new Set((project.customFurniture ?? []).map((c) => c.hash));
  if (modelHashes.size > 0) {
    const modelsFolder = zip.folder('models')!;
    for (const hash of modelHashes) {
      const blob = await getBlob(hash);
      if (blob) modelsFolder.file(`${hash}.glb`, blob);
    }
  }

  const imageHashes = imageHashesOf(project);
  if (imageHashes.size > 0) {
    const imagesFolder = zip.folder('images')!;
    for (const hash of imageHashes) {
      const blob = await getBlob(hash);
      if (blob) imagesFolder.file(`${hash}.${IMAGE_EXT[blob.type] ?? 'bin'}`, blob);
    }
  }

  const content = await zip.generateAsync({ type: 'blob' });
  download(content, `${project.name || 'project'}.zip`);
}

export interface ZipBundleResult {
  project: unknown;
  restoredModels: number;
  restoredImages: number;
}

/**
 * Extract project.json + models/*.glb + images/* from a project .zip bundle,
 * storing any new blobs in IndexedDB (re-hashed from content, not trusted
 * from the filename). Throws if the zip doesn't contain a project.json —
 * callers can fall back to trying it as some other zip format (e.g. Apple
 * RoomPlan).
 */
export async function importProjectZip(file: File): Promise<ZipBundleResult> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);
  const projectEntry = zip.file('project.json');
  if (!projectEntry) throw new Error('NOT_A_PROJECT_BUNDLE');
  const projectText = await projectEntry.async('string');
  const project = JSON.parse(projectText);

  async function restoreFolder(pattern: RegExp, mimeFor: (name: string) => string): Promise<number> {
    let restored = 0;
    for (const entry of zip.file(pattern)) {
      const buffer = await entry.async('arraybuffer');
      const hash = await sha256Hex(buffer);
      if (!(await hasBlob(hash))) {
        await putBlob(hash, new Blob([buffer], { type: mimeFor(entry.name) }));
        restored++;
      }
    }
    return restored;
  }

  const restoredModels = await restoreFolder(/^models\/.+\.glb$/i, () => 'model/gltf-binary');
  const restoredImages = await restoreFolder(/^images\/.+$/i, (name) => {
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    return EXT_TO_MIME[ext] ?? 'image/png';
  });
  return { project, restoredModels, restoredImages };
}
