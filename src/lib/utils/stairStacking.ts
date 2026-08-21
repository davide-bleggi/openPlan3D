/**
 * Where each stair sits in the multi-floor ("stacked") 3D view.
 *
 * Stairs are the one element that spans two storeys, so they cannot simply be
 * drawn at the elevation of the floor that owns them: an "up" stair climbs out
 * of its own floor, but a "down" stair is the *same physical flight* as the
 * "up" stair on the storey below and therefore has to start one floor lower.
 * Placing them by direction also means the two annotations a user typically
 * draws for one stairwell — "up" on the lower floor, "down" on the upper —
 * resolve to the same geometry, so the duplicate is dropped instead of
 * z-fighting with itself.
 */

import type { Floor, Stair } from '$lib/models/types';
import type { FloorElevation } from './floorStacking';

/** Plan distance (cm) under which two stairs count as the same stairwell. */
export const STAIR_COINCIDENCE_TOLERANCE = 1;

export interface StackedStairPlacement {
  stair: Stair;
  /** The floor the stair is stored on. */
  floor: Floor;
  /** Y of the stair's bottom tread — the floor it climbs *from*. */
  baseElevation: number;
}

/**
 * Resolve every floor's stairs to a base elevation in the stacked view.
 *
 * `stack` is expected bottom-to-top, as `computeFloorElevations` returns it.
 * A "down" stair on the lowest floor has nothing below it to descend to, so it
 * keeps its own elevation rather than disappearing under the building.
 */
export function stackedStairPlacements(stack: FloorElevation[]): StackedStairPlacement[] {
  const placements: StackedStairPlacement[] = [];

  for (let i = 0; i < stack.length; i++) {
    const entry = stack[i];
    for (const stair of entry.floor.stairs ?? []) {
      const below = stair.direction === 'down' ? stack[i - 1] : undefined;
      const baseElevation = (below ?? entry).elevation;
      // The lower floor is visited first, so the surviving placement of a
      // duplicated stairwell is the "up" one — the direction that matches the
      // geometry actually being drawn.
      if (placements.some((p) => isSameFlight(p, stair, baseElevation))) continue;
      placements.push({ stair, floor: entry.floor, baseElevation });
    }
  }

  return placements;
}

function isSameFlight(placed: StackedStairPlacement, stair: Stair, baseElevation: number): boolean {
  return (
    placed.baseElevation === baseElevation &&
    Math.abs(placed.stair.position.x - stair.position.x) <= STAIR_COINCIDENCE_TOLERANCE &&
    Math.abs(placed.stair.position.y - stair.position.y) <= STAIR_COINCIDENCE_TOLERANCE &&
    normalizeAngle(placed.stair.rotation) === normalizeAngle(stair.rotation)
  );
}

function normalizeAngle(deg: number): number {
  const a = ((deg ?? 0) % 360 + 360) % 360;
  // Round so floating-point drift from repeated rotations still matches.
  return Math.round(a * 100) / 100;
}
