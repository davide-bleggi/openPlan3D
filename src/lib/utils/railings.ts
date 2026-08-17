/**
 * Shared railing geometry.
 *
 * A railing is described as a polyline — a path in plan, where every point
 * also carries the height of the surface it stands on. That is all a renderer
 * needs: the handrail rides `height` above the path and the posts drop from it
 * to the surface. Stairs derive their paths from the stair layout (see
 * `stairGeometry.ts`), while a terrace or balcony derives one from the wall
 * standing in for its perimeter, and both then look identical in 3D and read
 * the same way in the plan.
 *
 * Heights are relative to the floor the railing belongs to, so a caller that
 * lifts a whole storey does not have to adjust anything here.
 */
import type { Point, Wall } from '$lib/models/types';

/** Default handrail height above the surface it stands on (cm). */
export const RAILING_HEIGHT = 90;
/** Shortest handrail worth drawing — guards against silly input (cm). */
export const RAILING_MIN_HEIGHT = 30;
/** Target gap between railing posts (cm); each segment rounds to fit. */
export const RAILING_POST_SPACING = 25;
/** Side of the square handrail (cm). */
export const RAILING_RAIL_THICKNESS = 4;
/** Side of a square post (cm). */
export const RAILING_POST_THICKNESS = 3;

/** A point on a railing: where it sits in plan, and the height it stands at. */
export interface RailingPoint {
  x: number;
  y: number;
  /** Height of the surface under this point (cm above the floor). */
  base: number;
}

/** Handrail height for an element, falling back to the default when unset. */
export function railingHeight(height: number | undefined): number {
  return height && height > 0 ? Math.max(RAILING_MIN_HEIGHT, height) : RAILING_HEIGHT;
}

/**
 * Positions of the posts along a railing path — one at every end and corner,
 * with the rest spread evenly so no gap exceeds `spacing`.
 */
export function railingPostPositions(
  points: RailingPoint[],
  spacing: number = RAILING_POST_SPACING
): RailingPoint[] {
  if (points.length === 0) return [];
  const step = Math.max(5, spacing);
  const posts: RailingPoint[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let j = 0; j < count; j++) {
      const t = j / count;
      posts.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        base: a.base + (b.base - a.base) * t
      });
    }
  }
  posts.push(points[points.length - 1]);
  return posts;
}

// ── Walls standing in for a terrace or balcony perimeter ─────────────
//
// A hidden wall is not built in 3D — it only bounds the room — which is how
// terraces and balconies are drawn. Such a perimeter still needs something to
// stop you walking off it, so a hidden wall can carry a railing along its
// line: the wall stays unbuilt, and the balustrade takes its place.

/**
 * Does this wall carry a railing? Only hidden walls can: a wall that is
 * actually built already stops you, and a railing buried inside it would
 * never be seen.
 */
export function wallHasRailing(wall: Wall): boolean {
  return !!wall.hidden && !!wall.railing;
}

/** Handrail height above the floor for a wall's railing (cm). */
export function wallRailingHeight(wall: Wall): number {
  return railingHeight(wall.railingHeight);
}

/** Point a fraction `t` along a wall, following its curve when it has one. */
export function wallPointAt(wall: Wall, t: number): Point {
  if (!wall.curvePoint) {
    return {
      x: wall.start.x + (wall.end.x - wall.start.x) * t,
      y: wall.start.y + (wall.end.y - wall.start.y) * t
    };
  }
  // Same quadratic bezier the wall itself is drawn from, so the railing sits
  // on the wall's line rather than cutting the corner off it.
  const mt = 1 - t;
  return {
    x: mt * mt * wall.start.x + 2 * mt * t * wall.curvePoint.x + t * t * wall.end.x,
    y: mt * mt * wall.start.y + 2 * mt * t * wall.curvePoint.y + t * t * wall.end.y
  };
}

/** Fewest / most points used to trace a curved wall's railing. */
const WALL_RAILING_MIN_SAMPLES = 8;
const WALL_RAILING_MAX_SAMPLES = 64;

/**
 * Path a wall's railing follows: the wall's own centreline, standing on the
 * floor. A curved wall is traced closely enough that the handrail reads as a
 * curve rather than a chord.
 */
export function wallRailingPath(wall: Wall): RailingPoint[] {
  const span = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  if (span < 1) return [];
  if (!wall.curvePoint) {
    return [
      { x: wall.start.x, y: wall.start.y, base: 0 },
      { x: wall.end.x, y: wall.end.y, base: 0 }
    ];
  }
  const steps = Math.min(
    WALL_RAILING_MAX_SAMPLES,
    Math.max(WALL_RAILING_MIN_SAMPLES, Math.ceil(span / RAILING_POST_SPACING))
  );
  const points: RailingPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = wallPointAt(wall, i / steps);
    points.push({ x: p.x, y: p.y, base: 0 });
  }
  return points;
}
