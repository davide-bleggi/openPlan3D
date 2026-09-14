import * as THREE from 'three';

/** Remove lights and cameras embedded in an imported model — furniture placement only wants meshes. */
export function stripNonMeshNodes(root: THREE.Object3D): void {
  const toRemove: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if ((obj as unknown as { isLight?: boolean }).isLight || (obj as unknown as { isCamera?: boolean }).isCamera) {
      toRemove.push(obj);
    }
  });
  for (const obj of toRemove) obj.parent?.remove(obj);
}

/** Count triangles across all meshes in a scene graph, for import size-budget validation. */
export function countTriangles(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh || !mesh.geometry) return;
    const geo = mesh.geometry;
    if (geo.index) count += geo.index.count / 3;
    else if (geo.attributes.position) count += geo.attributes.position.count / 3;
  });
  return Math.round(count);
}
