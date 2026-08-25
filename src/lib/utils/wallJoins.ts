/**
 * Corner joins between straight walls, in plan coordinates.
 *
 * Each wall is drawn in 3D as a prism whose two ends are cut back to meet its
 * neighbours: the miter. This module works out where those cuts land and which
 * end caps survive; the caller turns that into geometry.
 */
import type { Point, Wall } from '$lib/models/types';

/** Thinnest a wall is ever drawn, whatever the plan says. */
export const WALL_THICKNESS = 15;

/** Snap distance for matching wall endpoints (mirrors roomDetection.ts). */
export const WALL_JOIN_EPS = 5;

// A true miter spikes to infinity as the angle closes; past this multiple of the
// half-thickness we clamp the tip and keep the cap, trading a small notch for a hole.
export const MITER_LIMIT = 4;

// uPos / uNeg are the cut positions along the wall axis on its +normal and -normal side.
// capped=false means the neighbour's volume closes this end exactly, so the cap face
// would be an internal boundary and is dropped.
export interface WallJoinEnd { uPos: number; uNeg: number; capped: boolean }
export interface WallJoin { start: WallJoinEnd; end: WallJoinEnd }

// Where three or more walls meet, the mitered ends leave a small polygon in the middle
// that no wall covers. The cap faces close it on the sides; it still needs a lid.
export interface JunctionVoid { center: Point; poly: Point[]; minHeight: number }

/** Default thickness a wall is mitered at: its own, floored at WALL_THICKNESS. */
export const wallJoinThickness = (w: Wall) => Math.max(w.thickness, WALL_THICKNESS);

/**
 * Corner join per wall end. Purely local: group wall ends by shared vertex, sort them
 * by outgoing angle, and miter each end against its immediate angular neighbour on each
 * side. Degree 2 reduces to the usual corner miter; degree 3+ (T- and X-junctions) falls
 * out of the same rule, and reports the central void the caller has to lid.
 *
 * Only walls that are actually built take part. A curved wall is drawn as its own chain
 * of segments and never miters; a hidden wall has no volume at all, so mitering into one
 * would cut a real wall back to meet nothing — the neighbour would lose its end cap and
 * show an open, slanted cross-section at the corner. Both are left out here, which leaves
 * their neighbours with the square, capped end a free end gets.
 */
export function computeWallJoins(
  walls: Wall[],
  thicknessOf: (w: Wall) => number = wallJoinThickness
): { joins: Map<string, WallJoin>; voids: JunctionVoid[] } {
  const samePoint = (a: Point, b: Point) =>
    Math.abs(a.x - b.x) < WALL_JOIN_EPS && Math.abs(a.y - b.y) < WALL_JOIN_EPS;

  // One record per wall endpoint. dOut points away from the shared vertex, along the
  // wall, so the angular order around the vertex is just atan2(dOut).
  interface End {
    wall: Wall;
    atStart: boolean;
    v: Point;
    d: Point;      // wall direction, start -> end
    dOut: Point;   // direction away from v
    r: number;
    len: number;
    angle: number;
  }

  const ends: End[] = [];
  for (const wall of walls) {
    if (wall.curvePoint || wall.hidden) continue;
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const d = { x: dx / len, y: dy / len };
    const r = thicknessOf(wall) / 2;
    for (const atStart of [true, false]) {
      const dOut = atStart ? d : { x: -d.x, y: -d.y };
      ends.push({
        wall, atStart, v: atStart ? wall.start : wall.end, d, dOut, r, len,
        angle: Math.atan2(dOut.y, dOut.x),
      });
    }
  }

  // Group endpoints that land on the same vertex (same tolerance as roomDetection).
  const vertices: End[][] = [];
  for (const e of ends) {
    const group = vertices.find((g) => samePoint(g[0].v, e.v));
    if (group) group.push(e); else vertices.push([e]);
  }

  // Where the two offset lines meet. `sideA`/`sideB` pick which side of each wall
  // (+1 = left of dOut) the offset line sits on.
  function cutPoint(a: End, sideA: number, b: End, sideB: number): { p: Point; exact: boolean } {
    const nA = { x: -a.dOut.y * sideA, y: a.dOut.x * sideA };
    const nB = { x: -b.dOut.y * sideB, y: b.dOut.x * sideB };
    const pA = { x: a.v.x + nA.x * a.r, y: a.v.y + nA.y * a.r };
    const pB = { x: b.v.x + nB.x * b.r, y: b.v.y + nB.y * b.r };
    const denom = a.dOut.x * b.dOut.y - a.dOut.y * b.dOut.x;

    if (Math.abs(denom) < 1e-6) {
      // Parallel offset lines. Anti-parallel means the two walls run straight through
      // each other, and equal radii make the faces continuous — a flat cut at the
      // vertex is then exact. Same-direction (overlapping walls) never is.
      const straightThrough = a.dOut.x * b.dOut.x + a.dOut.y * b.dOut.y < -0.999;
      return { p: pA, exact: straightThrough && Math.abs(a.r - b.r) < 1e-6 };
    }

    const t = ((pB.x - pA.x) * b.dOut.y - (pB.y - pA.y) * b.dOut.x) / denom;
    const p = { x: pA.x + t * a.dOut.x, y: pA.y + t * a.dOut.y };
    const reach = Math.hypot(p.x - a.v.x, p.y - a.v.y);
    const limit = Math.max(a.r, b.r) * MITER_LIMIT;
    if (reach > limit) {
      // Too acute for a spike: pull the tip back to the limit and keep the cap.
      const k = limit / reach;
      return { p: { x: a.v.x + (p.x - a.v.x) * k, y: a.v.y + (p.y - a.v.y) * k }, exact: false };
    }
    return { p, exact: true };
  }

  const result = new Map<string, WallJoin>();
  const voids: JunctionVoid[] = [];
  const setEnd = (e: End, entry: WallJoinEnd) => {
    const existing = result.get(e.wall.id) ?? {
      start: { uPos: 0, uNeg: 0, capped: true },
      end: { uPos: e.len, uNeg: e.len, capped: true },
    };
    if (e.atStart) existing.start = entry; else existing.end = entry;
    result.set(e.wall.id, existing);
  };

  for (const group of vertices) {
    const n = group.length;

    // A free end stays square.
    if (n < 2) {
      const e = group[0];
      const u = e.atStart ? 0 : e.len;
      setEnd(e, { uPos: u, uNeg: u, capped: true });
      continue;
    }

    group.sort((a, b) => a.angle - b.angle);

    // Going counter-clockwise, the wedge between an end and its next neighbour is
    // bounded by that end's left face and the neighbour's right face; mirrored on the
    // other side. The left cut points, in this same order, are the corners of the
    // polygon left uncovered in the middle of the junction.
    const cuts = group.map((e, i) => ({
      left: cutPoint(e, +1, group[(i + 1) % n], -1),
      right: cutPoint(e, -1, group[(i - 1 + n) % n], +1),
    }));

    // Two walls meet exactly, so there is nothing in the middle to close. Three or more
    // leave a real void: its sides are the cap faces, but the top is open to the sky.
    if (n >= 3) {
      const poly = cuts.map((c) => c.left.p);
      let area = 0;
      for (let i = 0; i < n; i++) {
        const p = poly[i], q = poly[(i + 1) % n];
        area += p.x * q.y - q.x * p.y;
      }
      if (Math.abs(area) / 2 > 0.5) {
        voids.push({
          center: group[0].v,
          poly,
          minHeight: Math.min(...group.map((e) => e.wall.height)),
        });
      }
    }

    for (let i = 0; i < n; i++) {
      const e = group[i];
      const { left: cutL, right: cutR } = cuts[i];

      const uOf = (p: Point) => (p.x - e.wall.start.x) * e.d.x + (p.y - e.wall.start.y) * e.d.y;
      // Local +z of the wall mesh is the left normal of start->end, so at the start end
      // "left of dOut" is the +normal side and at the far end it is the -normal side.
      let uPos = e.atStart ? uOf(cutL.p) : uOf(cutR.p);
      let uNeg = e.atStart ? uOf(cutR.p) : uOf(cutL.p);

      // Never let a cut cross the wall's midpoint — a short wall between two thick ones
      // would otherwise invert.
      const clampU = (u: number) => (e.atStart ? Math.min(u, e.len / 2) : Math.max(u, e.len / 2));
      const clamped = { uPos: clampU(uPos), uNeg: clampU(uNeg) };
      const wasClamped = clamped.uPos !== uPos || clamped.uNeg !== uNeg;
      uPos = clamped.uPos;
      uNeg = clamped.uNeg;

      // The cap can only go when the join is exact on both sides and the neighbour is
      // tall enough to close the whole opening. At degree 3+ the caps are the sides of
      // the central void, so they always stay.
      let capped = true;
      if (n === 2 && cutL.exact && cutR.exact && !wasClamped) {
        const other = group[(i + 1) % 2];
        capped = e.wall.height > other.wall.height;
      }

      setEnd(e, { uPos, uNeg, capped });
    }
  }

  return { joins: result, voids };
}
