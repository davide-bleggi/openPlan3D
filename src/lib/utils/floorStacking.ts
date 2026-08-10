/**
 * Vertical stacking maths for the multi-floor 3D view.
 *
 * Floors are stacked in `level` order and each one occupies its own structural
 * height (its tallest wall plus the slab it sits on), so a floor with 300 cm
 * walls does not overlap the one above it. Elevations are anchored so the
 * ground floor (level 0) sits at Y=0 and basements go negative.
 */

import type { Floor } from '$lib/models/types';

/** Wall height assumed for a floor that has no walls yet. */
export const DEFAULT_WALL_HEIGHT = 260;
/** Structural depth between a floor's wall tops and the slab above it. */
export const FLOOR_SLAB_THICKNESS = 0;

export interface FloorElevation {
  floor: Floor;
  /** Position in the stack, lowest floor first. */
  index: number;
  /** Structural height this floor consumes (tallest wall + slab). */
  height: number;
  /** Y offset of this floor's slab. */
  elevation: number;
}

/** Height a floor consumes in the stack: its tallest wall plus the slab above. */
export function floorStructuralHeight(floor: Pick<Floor, 'walls'>): number {
  let tallest = 0;
  for (const wall of floor.walls ?? []) {
    if (Number.isFinite(wall.height) && wall.height > tallest) tallest = wall.height;
  }
  return (tallest > 0 ? tallest : DEFAULT_WALL_HEIGHT) + FLOOR_SLAB_THICKNESS;
}

/**
 * Order the floors bottom-to-top and give each one a distinct Y offset.
 *
 * Offsets are cumulative rather than `index * constant`: floors keep their own
 * heights, and floors that share a `level` (possible in older projects) still
 * get separate elevations because the sort is stable.
 */
export function computeFloorElevations(floors: Floor[]): FloorElevation[] {
  const ordered = [...floors].sort((a, b) => levelOf(a) - levelOf(b));

  let cursor = 0;
  const stack: FloorElevation[] = ordered.map((floor, index) => {
    const height = floorStructuralHeight(floor);
    cursor += height;
    const entry: FloorElevation = { floor, index, height, elevation: cursor };
    return entry;
  });

  // Anchor the ground floor at Y=0 so basements sit below the base plane.
  const ground = stack.find((e) => levelOf(e.floor) === 0) ?? stack[0];
  if (ground && ground.elevation !== 0) {
    const shift = ground.elevation;
    for (const entry of stack) entry.elevation -= shift;
  }

  return stack;
}

/** Display name for a floor that was never explicitly named. */
export function defaultFloorName(floor: Floor, index: number): string {
  const level = typeof floor.level === 'number' ? floor.level : index;
  if (level === 0) return 'Ground Floor';
  if (level < 0) return level === -1 ? 'Basement' : `Basement ${-level}`;
  return `Floor ${level}`;
}

function levelOf(floor: Floor): number {
  return typeof floor.level === 'number' && Number.isFinite(floor.level) ? floor.level : 0;
}
