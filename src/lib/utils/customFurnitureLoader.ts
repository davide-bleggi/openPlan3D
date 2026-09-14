/**
 * 3D placement rendering for user-imported furniture (mirrors
 * `furnitureModelLoader.ts`'s role for the built-in catalog).
 *
 * Renders a lightweight placeholder immediately, then swaps in the real GLB
 * once its blob is read from IndexedDB. If the blob is missing — sync not
 * caught up yet, or the file was never re-attached on this device — the
 * placeholder stays up with a visible "missing model" marker instead of a
 * hard error, per the graceful-degradation requirement.
 */
import * as THREE from 'three';
import { parseGLTF } from './customGLTFLoader';
import { stripNonMeshNodes } from './glbSanitize';
import { getBlob, hasBlob } from '$lib/services/blobStore';
import type { CustomFurnitureDef } from '$lib/models/types';

const parsedCache = new Map<string, THREE.Group>();
const loadingPromises = new Map<string, Promise<THREE.Group | null>>();

async function loadCustomModel(hash: string): Promise<THREE.Group | null> {
  if (parsedCache.has(hash)) return parsedCache.get(hash)!.clone();
  if (loadingPromises.has(hash)) {
    return loadingPromises.get(hash)!.then(() => (parsedCache.has(hash) ? parsedCache.get(hash)!.clone() : null));
  }

  const promise = (async () => {
    const blob = await getBlob(hash);
    if (!blob) return null;
    try {
      const buffer = await blob.arrayBuffer();
      const scene = await parseGLTF(buffer);
      stripNonMeshNodes(scene);
      scene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if ((mesh as unknown as { isMesh?: boolean }).isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      parsedCache.set(hash, scene);
      return scene;
    } catch (err) {
      console.warn('[CustomFurniture] failed to parse stored model:', err);
      return null;
    }
  })();

  loadingPromises.set(hash, promise);
  return promise.then((scene) => {
    loadingPromises.delete(hash);
    return scene ? scene.clone() : null;
  });
}

/** Scale/center a freshly-loaded model to sit on the ground at its derived (cm) dimensions. */
function placeOnGround(model: THREE.Group): void {
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.x < 1e-4 || size.y < 1e-4 || size.z < 1e-4) return;

  // Dimensions were derived at import time from this same bounding box in
  // meters, converted ×100 to cm — apply the same conversion here.
  model.scale.setScalar(100);

  const scaledBox = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3();
  scaledBox.getCenter(center);
  model.position.sub(center);
  model.position.y -= scaledBox.min.y;
}

function createPlaceholder(def: CustomFurnitureDef, missing: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = missing ? 'missing_model_placeholder' : 'custom_model_placeholder';

  const geo = new THREE.BoxGeometry(Math.max(def.width, 1), Math.max(def.height, 1), Math.max(def.depth, 1));
  const mat = new THREE.MeshStandardMaterial({
    color: missing ? 0xef4444 : 0x94a3b8,
    transparent: true,
    opacity: missing ? 0.35 : 0.55,
    wireframe: missing,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = def.height / 2;
  mesh.castShadow = true;
  group.add(mesh);

  if (missing) {
    // Small floating warning marker so a missing model is visibly distinct from a normal placeholder.
    const markerSize = Math.max(8, Math.min(def.width, def.depth) * 0.15);
    const markerGeo = new THREE.OctahedronGeometry(markerSize * 0.5);
    const markerMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.5 });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.y = def.height + markerSize;
    group.add(marker);
  }

  return group;
}

function disposeGroup(group: THREE.Object3D): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}

/**
 * Create a placed instance of a custom furniture def. Starts as a neutral
 * placeholder, then swaps to either the real model or a "missing" marker
 * once the IndexedDB lookup resolves.
 */
export function createCustomFurnitureModel(def: CustomFurnitureDef, onLoaded?: (model: THREE.Group) => void): THREE.Group {
  const container = new THREE.Group();
  container.name = `custom_furniture_${def.id}`;
  const placeholder = createPlaceholder(def, false);
  container.add(placeholder);

  loadCustomModel(def.hash).then((model) => {
    container.remove(placeholder);
    disposeGroup(placeholder);
    if (model) {
      placeOnGround(model);
      container.add(model);
    } else {
      container.add(createPlaceholder(def, true));
    }
    onLoaded?.(container);
  });

  return container;
}

/** Whether a def's binary is missing from this device's IndexedDB (used to badge the palette/library UI). */
export async function isModelMissing(def: CustomFurnitureDef): Promise<boolean> {
  return !(await hasBlob(def.hash));
}
