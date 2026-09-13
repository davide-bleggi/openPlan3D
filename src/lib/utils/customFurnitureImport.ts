/**
 * Import pipeline for user-supplied GLB/glTF furniture models: validate,
 * derive dimensions from the bounding box, generate a palette thumbnail, and
 * store the binary in IndexedDB keyed by content hash.
 *
 * Re-importing a file whose hash already exists in the current project is
 * idempotent — the caller (see `importCustomFurniture`) reuses the existing
 * def instead of creating a duplicate, and also serves the "re-attach a
 * missing model" flow: the same upload just needs its blob restored.
 */
import * as THREE from 'three';
import { get } from 'svelte/store';
import { parseGLTF } from './customGLTFLoader';
import { sha256Hex } from './hash';
import { stripNonMeshNodes, countTriangles } from './glbSanitize';
import { renderThumbnailForObject } from './furnitureThumbnails';
import { putModelBlob, hasModelBlob } from '$lib/services/modelStore';
import { currentProject, addCustomFurnitureDef } from '$lib/stores/project';
import type { CustomFurnitureDef } from '$lib/models/types';

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
export const TRIANGLE_WARN_THRESHOLD = 100_000;
export const TRIANGLE_HARD_LIMIT = 500_000;

export interface ProcessedModel {
  hash: string;
  width: number;
  depth: number;
  height: number;
  triangleCount: number;
  fileSize: number;
  thumbnail: string;
  warnings: string[];
}

/** Validate, hash, and thumbnail a GLB/glTF file. Stores the binary in IndexedDB if not already present. */
export async function processModelFile(file: File): Promise<ProcessedModel> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB) — max ${MAX_FILE_SIZE / 1024 / 1024} MB.`);
  }

  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);

  let scene: THREE.Group;
  try {
    scene = await parseGLTF(buffer.slice(0));
  } catch {
    throw new Error('Could not parse this file as a GLB/glTF model. Multi-file .gltf bundles (with separate .bin/textures) are not supported — export as a single .glb instead.');
  }

  // Animations/cameras/lights are never wired up for placed furniture; strip
  // camera/light nodes from the render graph so they can't leak in unexpectedly.
  stripNonMeshNodes(scene);
  scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if ((mesh as unknown as { isMesh?: boolean }).isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  const triangleCount = countTriangles(scene);
  if (triangleCount > TRIANGLE_HARD_LIMIT) {
    throw new Error(`Model has too many triangles (${triangleCount.toLocaleString()}) — max ${TRIANGLE_HARD_LIMIT.toLocaleString()}.`);
  }
  const warnings: string[] = [];
  if (triangleCount > TRIANGLE_WARN_THRESHOLD) {
    warnings.push(`High triangle count (${triangleCount.toLocaleString()}) — may impact performance.`);
  }

  // Detect a Z-up export (degenerate/flat on Y) the same way the catalog GLB loader does,
  // so dimensions are derived from the model's "standing" orientation.
  let box = new THREE.Box3().setFromObject(scene);
  let size = new THREE.Vector3();
  box.getSize(size);
  if (size.y < 0.01 && size.z > size.y * 10) {
    scene.rotation.x = -Math.PI / 2;
    scene.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(scene);
    box.getSize(size);
  }
  if (size.x < 1e-4 || size.y < 1e-4 || size.z < 1e-4) {
    throw new Error('Model has no visible geometry.');
  }

  // glTF convention is meters — convert to the app's cm units.
  const width = Math.round(size.x * 100);
  const depth = Math.round(size.z * 100);
  const height = Math.round(size.y * 100);

  const thumbnail = renderThumbnailForObject(scene) ?? '';

  const alreadyStored = await hasModelBlob(hash);
  if (!alreadyStored) {
    await putModelBlob(hash, new Blob([buffer], { type: file.type || 'model/gltf-binary' }));
  }

  return { hash, width, depth, height, triangleCount, fileSize: file.size, thumbnail, warnings };
}

export interface ImportOutcome {
  id: string;
  created: boolean; // false when this hash matched an existing def (idempotent re-import / missing-model re-attach)
  def: CustomFurnitureDef;
  warnings: string[];
}

/**
 * Import a GLB/glTF file into the current project's furniture library.
 * If a def with the same content hash already exists, reuses it (this also
 * covers re-attaching a model whose IndexedDB blob had gone missing).
 */
export async function importCustomFurniture(file: File): Promise<ImportOutcome> {
  const processed = await processModelFile(file);
  const project = get(currentProject);
  const existing = project?.customFurniture?.find((c) => c.hash === processed.hash);
  if (existing) {
    return { id: existing.id, created: false, def: existing, warnings: processed.warnings };
  }
  const name = file.name.replace(/\.[^./]+$/, '');
  const { hash, width, depth, height, thumbnail, triangleCount, fileSize } = processed;
  const { id, def } = addCustomFurnitureDef(name, file.name, { hash, width, depth, height, thumbnail, triangleCount, fileSize });
  return { id, created: true, def, warnings: processed.warnings };
}
