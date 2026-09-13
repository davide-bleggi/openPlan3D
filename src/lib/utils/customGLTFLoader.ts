/**
 * Shared GLTFLoader configured with the DRACO and Meshopt decoders, used for
 * parsing user-imported furniture models. Most GLBs found in the wild ship
 * compressed with one of these, so without them a large share of imports
 * would silently fail to load.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { base } from '$app/paths';

let loader: GLTFLoader | null = null;

function getLoader(): GLTFLoader {
  if (loader) return loader;
  loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${base}/draco/`);
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

/** Parse a GLB/glTF ArrayBuffer into a THREE scene graph. */
export function parseGLTF(buffer: ArrayBuffer): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    getLoader().parse(
      buffer,
      '',
      (gltf) => resolve(gltf.scene as unknown as THREE.Group),
      (err) => reject(err instanceof Error ? err : new Error('Failed to parse model'))
    );
  });
}
