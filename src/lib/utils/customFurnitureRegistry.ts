/**
 * Live lookup of the current project's imported (custom) furniture defs.
 *
 * Kept as a tiny module-level index (rather than threading `project` through
 * every 2D/3D renderer, panel, and exporter) so `getCatalogItem()` in
 * `furnitureCatalog.ts` can transparently resolve a `custom_*` id the same
 * way it resolves a built-in one — every existing call site keeps working.
 */
import { currentProject } from '$lib/stores/project';
import type { CustomFurnitureDef } from '$lib/models/types';
import type { FurnitureDef } from './furnitureCatalog';

let registry = new Map<string, CustomFurnitureDef>();

currentProject.subscribe((p) => {
  const next = new Map<string, CustomFurnitureDef>();
  for (const c of p?.customFurniture ?? []) next.set(c.id, c);
  registry = next;
});

export function getCustomFurnitureDef(id: string): CustomFurnitureDef | undefined {
  return registry.get(id);
}

export function isCustomFurnitureId(id: string): boolean {
  return registry.has(id);
}

export function listCustomFurniture(): CustomFurnitureDef[] {
  return Array.from(registry.values());
}

/** Adapt a CustomFurnitureDef to the shape the rest of the app already knows how to render. */
export function customDefToFurnitureDef(c: CustomFurnitureDef): FurnitureDef {
  return {
    id: c.id,
    name: c.name,
    category: 'Imported',
    icon: '📦',
    color: '#94a3b8',
    width: c.width,
    depth: c.depth,
    height: c.height,
  };
}
