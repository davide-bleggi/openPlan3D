/**
 * Cross-device-portable project bundle: project.json (references + metadata
 * only) plus models/*.glb (the actual binaries, named by content hash).
 *
 * Once imported models live in IndexedDB, a plain .json export is no longer
 * self-contained — it references blobs that only exist on the browser that
 * created them. This is the format that travels.
 */
import type { Project } from '$lib/models/types';
import { getModelBlob, hasModelBlob, putModelBlob } from '$lib/services/modelStore';
import { sha256Hex } from './hash';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Export a project as a .zip bundle (project.json + models/*.glb) so imported furniture travels with it. */
export async function exportProjectAsZip(project: Project): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(project, null, 2));

  const hashes = new Set((project.customFurniture ?? []).map((c) => c.hash));
  if (hashes.size > 0) {
    const modelsFolder = zip.folder('models')!;
    for (const hash of hashes) {
      const blob = await getModelBlob(hash);
      if (blob) modelsFolder.file(`${hash}.glb`, blob);
    }
  }

  const content = await zip.generateAsync({ type: 'blob' });
  download(content, `${project.name || 'project'}.zip`);
}

export interface ZipBundleResult {
  project: unknown;
  restoredModels: number;
}

/**
 * Extract project.json + models/*.glb from a project .zip bundle, storing
 * any new blobs in IndexedDB (re-hashed from content, not trusted from the
 * filename). Throws if the zip doesn't contain a project.json — callers can
 * fall back to trying it as some other zip format (e.g. Apple RoomPlan).
 */
export async function importProjectZip(file: File): Promise<ZipBundleResult> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);
  const projectEntry = zip.file('project.json');
  if (!projectEntry) throw new Error('NOT_A_PROJECT_BUNDLE');
  const projectText = await projectEntry.async('string');
  const project = JSON.parse(projectText);

  let restoredModels = 0;
  const modelFiles = zip.file(/^models\/.+\.glb$/i);
  for (const entry of modelFiles) {
    const buffer = await entry.async('arraybuffer');
    const hash = await sha256Hex(buffer);
    if (!(await hasModelBlob(hash))) {
      await putModelBlob(hash, new Blob([buffer], { type: 'model/gltf-binary' }));
      restoredModels++;
    }
  }
  return { project, restoredModels };
}
