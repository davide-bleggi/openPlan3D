/**
 * Ordering maths for the floor stack (issue #15).
 *
 * The project's `floors` array is kept bottom-to-top and each floor carries a
 * `level` (0 = ground, negatives = basements). `level` is what the 3D stacking
 * and the plan labels read, so reordering has to rewrite levels — not just the
 * array — and it does so by keeping the *slots* fixed and moving floors between
 * them: the level-0 slot always stays at the same position in the stack, so the
 * building never jumps vertically when two floors swap.
 */

import type { Floor } from '$lib/models/types';
import { floorNameForLevel, isAutoFloorName } from './floorStacking';

function levelOf(floor: Floor): number {
  return typeof floor.level === 'number' && Number.isFinite(floor.level) ? floor.level : 0;
}

/** The floors sorted bottom-to-top. Stable, so equal levels keep their order. */
export function orderFloorsBottomUp(floors: Floor[]): Floor[] {
  return [...floors].sort((a, b) => levelOf(a) - levelOf(b));
}

/**
 * Index of the level-0 slot in a bottom-to-top ordering.
 *
 * When no floor sits at level 0 (all basements, or a legacy project with odd
 * levels) the lowest non-negative floor is used, falling back to the top floor.
 */
export function groundSlotIndex(ordered: Floor[]): number {
  const exact = ordered.findIndex((f) => levelOf(f) === 0);
  if (exact !== -1) return exact;
  const firstAbove = ordered.findIndex((f) => levelOf(f) > 0);
  if (firstAbove !== -1) return firstAbove;
  return Math.max(0, ordered.length - 1);
}

/**
 * Give every floor in a bottom-to-top array a contiguous level, with the floor
 * at `groundIndex` on level 0. Auto-generated names are re-derived from the new
 * level; names the user typed are kept.
 *
 * Pure: floors whose level or name change are returned as new objects (their
 * contents are shared, so element references stay valid), and the input array
 * is left untouched.
 */
export function assignFloorLevels(ordered: Floor[], groundIndex: number): Floor[] {
  return ordered.map((floor, i) => {
    const level = i - groundIndex;
    if (levelOf(floor) === level && floor.name) return floor;
    const name = isAutoFloorName(floor.name) ? floorNameForLevel(level) : floor.name;
    return { ...floor, level, name };
  });
}

/**
 * Sort the floors bottom-to-top and repair their levels so they are unique and
 * contiguous. Used to heal projects saved before reordering existed (duplicate
 * or gappy levels) and after a floor is removed.
 */
export function normalizeFloorOrder(floors: Floor[]): Floor[] {
  const ordered = orderFloorsBottomUp(floors);
  return assignFloorLevels(ordered, groundSlotIndex(ordered));
}

/**
 * Move the floor at `from` to index `to` in the bottom-to-top stack.
 *
 * Returns a new array with levels and auto-names updated. Out-of-range or
 * no-op moves return a copy of the input unchanged.
 */
export function reorderFloorStack(floors: Floor[], from: number, to: number): Floor[] {
  const ordered = orderFloorsBottomUp(floors);
  if (from < 0 || from >= ordered.length || to < 0 || to >= ordered.length || from === to) {
    return ordered;
  }
  const ground = groundSlotIndex(ordered);
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);
  return assignFloorLevels(ordered, ground);
}

/** Move one floor a step down (`-1`) or up (`+1`) the stack. */
export function moveFloorInStack(floors: Floor[], floorId: string, delta: -1 | 1): Floor[] {
  const ordered = orderFloorsBottomUp(floors);
  const from = ordered.findIndex((f) => f.id === floorId);
  if (from === -1) return ordered;
  return reorderFloorStack(ordered, from, from + delta);
}
