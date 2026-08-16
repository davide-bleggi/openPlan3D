/**
 * Deep-copy the contents of one floor onto another (issue #15).
 *
 * A new floor can be started as a copy of the one below it, since upper floors
 * usually repeat the structure of the floor underneath. Everything is cloned by
 * value and every element gets a fresh id — the copy shares no object with the
 * source, so editing one floor never touches the other. Cross-references
 * (doors/windows → wall, rooms → walls, groups → elements) are remapped to the
 * new ids.
 */

import type { Floor } from '$lib/models/types';

export interface CloneFloorOptions {
  /** Also copy furniture and 2D entourage symbols. Off by default. */
  includeFurniture?: boolean;
  /** Also copy guides, measurements, annotations and the background image. */
  includeAnnotations?: boolean;
  /** Id generator; defaults to the same short random id the store uses. */
  newId?: () => string;
}

function defaultId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Structural + optional contents of `source`, ready to spread onto a floor. */
export function cloneFloorContents(
  source: Floor,
  options: CloneFloorOptions = {},
): Omit<Floor, 'id' | 'name' | 'level'> {
  const { includeFurniture = false, includeAnnotations = true } = options;
  const uid = options.newId ?? defaultId;

  /** old element id → new element id, for remapping references */
  const idMap = new Map<string, string>();
  const remap = (id: string): string => idMap.get(id) ?? id;

  const clone = <T extends { id: string }>(items: T[] | undefined): T[] =>
    (items ?? []).map((item) => {
      const copy = structuredClone(item);
      copy.id = uid();
      idMap.set(item.id, copy.id);
      return copy;
    });

  // Walls first: doors, windows and rooms all point at wall ids.
  const walls = clone(source.walls);
  const doors = clone(source.doors).map((d) => ({ ...d, wallId: remap(d.wallId) }));
  const windows = clone(source.windows).map((w) => ({ ...w, wallId: remap(w.wallId) }));
  const rooms = clone(source.rooms).map((r) => ({ ...r, walls: (r.walls ?? []).map(remap) }));
  const columns = clone(source.columns);
  const stairs = clone(source.stairs);

  const furniture = includeFurniture ? clone(source.furniture) : [];
  const entourage = includeFurniture ? clone(source.entourage) : [];

  const guides = includeAnnotations ? clone(source.guides) : [];
  const measurements = includeAnnotations ? clone(source.measurements) : [];
  const annotations = includeAnnotations ? clone(source.annotations) : [];
  const textAnnotations = includeAnnotations ? clone(source.textAnnotations) : [];
  const backgroundImage =
    includeAnnotations && source.backgroundImage ? structuredClone(source.backgroundImage) : undefined;

  // Groups survive only where every member was copied.
  const groups = (source.groups ?? [])
    .map((g) => ({
      id: uid(),
      elementIds: (g.elementIds ?? []).filter((id) => idMap.has(id)).map(remap),
    }))
    .filter((g) => g.elementIds.length > 1);

  return {
    walls,
    rooms,
    doors,
    windows,
    furniture,
    stairs,
    columns,
    guides,
    measurements,
    annotations,
    textAnnotations,
    groups,
    entourage,
    backgroundImage,
  };
}
