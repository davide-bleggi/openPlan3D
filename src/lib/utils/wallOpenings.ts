/**
 * Carving door and window openings out of a wall for the 3D view.
 *
 * A wall is drawn as a set of solid boxes, and an opening is the space those
 * boxes leave: a pier either side, a lintel above and (for a window) an apron
 * below. Two rules keep the result free of the flickering that coplanar
 * surfaces produce:
 *
 *   1. The boxes tile the wall — they touch, they never overlap. Two boxes
 *      covering the same span would put two faces on the same plane, and the
 *      depth buffer has no way to choose between them.
 *   2. Trim (jambs, header, window frame, sill) overlaps the cut faces by
 *      `OPENING_TRIM_EPS` rather than stopping flush with them, so the wall's
 *      face is hidden behind the trim instead of competing with it.
 *
 * The trim itself lives in the 3D viewer; this module owns rule 1 and the
 * shared dimensions both sides have to agree on.
 */
import type { Door, Window as Win } from '$lib/models/types';

/** How far trim reaches past the wall's cut face, in cm. */
export const OPENING_TRIM_EPS = 0.5;
/** Head height of a door opening, in cm. */
export const DOOR_HEIGHT = 210;
/** Jamb/header thickness around a door opening, in cm. */
export const DOOR_JAMB = 5;

/** One solid box of wall. `offsetX` is its centre along the wall, `offsetY` its base. */
export interface WallSegment {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

interface Opening {
  left: number;
  right: number;
  bottomY: number;
  topY: number;
}

/**
 * Split a wall of `wallLen` x `wallH` into the boxes left over once every door
 * and window on it has been carved out. Openings are given in the wall's own
 * coordinates: `position` is 0-1 along the wall, heights are from the floor.
 */
export function buildWallSegments(
  wallLen: number,
  wallH: number,
  doors: Door[],
  windows: Win[]
): WallSegment[] {
  const openings: Opening[] = [];
  // Clamped to the wall, so an opening hanging off the end can't push a lintel
  // out past the wall's own volume.
  const addOpening = (center: number, width: number, bottomY: number, topY: number) => {
    const left = Math.max(0, center - width / 2);
    const right = Math.min(wallLen, center + width / 2);
    const bottom = Math.min(Math.max(bottomY, 0), wallH);
    const top = Math.min(Math.max(topY, 0), wallH);
    if (right - left <= 0 || top - bottom <= 0) return;
    openings.push({ left, right, bottomY: bottom, topY: top });
  };
  for (const d of doors) addOpening(d.position * wallLen, d.width, 0, DOOR_HEIGHT);
  for (const w of windows) {
    addOpening(w.position * wallLen, w.width, w.sillHeight, w.sillHeight + w.height);
  }

  if (openings.length === 0) {
    return [{ width: wallLen, height: wallH, offsetX: wallLen / 2, offsetY: 0 }];
  }

  // Openings that overlap — or leave only a sliver of a pier between them — are
  // merged into one hole spanning both. Carving them separately would stack a
  // lintel and an apron over the shared span, which is rule 1 broken.
  openings.sort((a, b) => a.left - b.left);
  const merged: Opening[] = [];
  for (const op of openings) {
    const prev = merged[merged.length - 1];
    if (prev && op.left < prev.right + OPENING_TRIM_EPS) {
      prev.right = Math.max(prev.right, op.right);
      prev.bottomY = Math.min(prev.bottomY, op.bottomY);
      prev.topY = Math.max(prev.topY, op.topY);
    } else {
      merged.push({ ...op });
    }
  }

  const segs: WallSegment[] = [];
  let cursor = 0;

  for (const op of merged) {
    if (op.left > cursor) {
      segs.push({
        width: op.left - cursor,
        height: wallH,
        offsetX: cursor + (op.left - cursor) / 2,
        offsetY: 0,
      });
    }
    const opWidth = op.right - op.left;
    const opCenter = (op.left + op.right) / 2;
    if (op.topY < wallH) {
      segs.push({ width: opWidth, height: wallH - op.topY, offsetX: opCenter, offsetY: op.topY });
    }
    if (op.bottomY > 0) {
      segs.push({ width: opWidth, height: op.bottomY, offsetX: opCenter, offsetY: 0 });
    }
    cursor = op.right;
  }

  if (cursor < wallLen) {
    segs.push({
      width: wallLen - cursor,
      height: wallH,
      offsetX: cursor + (wallLen - cursor) / 2,
      offsetY: 0,
    });
  }

  return segs;
}
