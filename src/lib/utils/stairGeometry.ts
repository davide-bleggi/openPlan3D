/**
 * Shared stair layout geometry.
 *
 * Both the 2D floor-plan renderer and the 3D viewer derive their stair meshes
 * from the layout returned here, so plan view and 3D always agree.
 *
 * `stair.width` is the width of a **single flight**, not of the whole stair:
 * a U-shaped stair puts two flights of that width side by side, so its
 * footprint is a little over twice as wide. On a spiral stair it is the
 * walkable depth of one tread — from the centre post out to the edge — so the
 * radius, and therefore the diameter, follow from it. `stair.depth` is how far
 * the stair runs front-to-back, and is unused for spirals, whose footprint is
 * round. `stairFootprint()` gives the resulting bounding box — hit-testing,
 * selection and bounds must use it rather than width x depth.
 *
 * Local coordinate system (before the stair's rotation/position are applied):
 *   - origin is the centre of the stair footprint
 *   - +x points right
 *   - +y points "down" the plan and maps to +z in 3D
 *
 * Every flight, landing and railing fits exactly inside the footprint, so
 * nothing ever spills outside the box the user can click and select.
 *
 * Flights always ascend towards -y (the direction the "UP" arrow points), and
 * turns then continue towards +x. `direction` does not change the geometry —
 * it only flips which way the plan arrow points, since a "down" stair is the
 * same physical object seen from the storey above. The 3D geometry always
 * rises from the floor the stair belongs to, so it is never buried under the
 * ground plane.
 */
import type { Stair, StairRailingSides } from '$lib/models/types';

/** Height climbed by one flight of stairs (cm) — one storey. */
export const STAIR_TOTAL_RISE = 260;

/** Travel axis of a flight in local coordinates. */
export type StairAxis = 'x' | 'y';

/** Axis-aligned rectangle in local stair coordinates. */
export interface StairRect {
  /** Minimum x (left edge). */
  x: number;
  /** Minimum y (top edge in plan view). */
  y: number;
  /** Size along x. */
  w: number;
  /** Size along y. */
  h: number;
}

export interface StairFlight extends StairRect {
  /** Axis the flight travels along. */
  axis: StairAxis;
  /** Direction of ascent along `axis`: +1 towards larger coords, -1 towards smaller. */
  dir: 1 | -1;
  /** Number of risers (and treads) in this flight. */
  riserCount: number;
  /** Risers already climbed at the foot of this flight. */
  startRiser: number;
}

export interface StairLanding extends StairRect {
  /** Risers climbed when standing on this landing. */
  atRiser: number;
}

/** Overall bounding box of a stair, centred on `stair.position`. */
export interface StairFootprint {
  width: number;
  depth: number;
}

export interface StairLayout {
  type: 'straight' | 'l-shaped' | 'u-shaped';
  footprint: StairFootprint;
  flights: StairFlight[];
  /** Landings at the turns between flights (empty for straight stairs). */
  landings: StairLanding[];
  /** Total number of risers across all flights. */
  riserCount: number;
  /** Height of a single riser (cm). */
  riserHeight: number;
  /** Total height climbed (cm). */
  totalRise: number;
  /** Thickness of a tread / landing slab (cm). */
  slabThickness: number;
}

export interface SpiralStairLayout {
  type: 'spiral';
  footprint: StairFootprint;
  radius: number;
  postRadius: number;
  /** Total swept angle (radians). */
  totalAngle: number;
  /** Angle the first tread starts at (radians). */
  startAngle: number;
  riserCount: number;
  riserHeight: number;
  totalRise: number;
  slabThickness: number;
}

export const STAIR_SLAB_THICKNESS = 3;
/** Total swept angle of a spiral stair (radians). */
export const SPIRAL_TOTAL_ANGLE = Math.PI * 1.75;
/** Angle of the first spiral tread — starts at the "top" of the plan (-y). */
export const SPIRAL_START_ANGLE = -Math.PI / 2;

/**
 * Split `total` risers between two flights so the tread depth is (close to)
 * uniform across both, instead of splitting 50/50 regardless of run length.
 */
function splitRisers(total: number, len1: number, len2: number): [number, number] {
  const a = Math.max(len1, 1);
  const b = Math.max(len2, 1);
  const usable = Math.max(2, Math.round(total));
  let n1 = Math.round((usable * a) / (a + b));
  n1 = Math.max(1, Math.min(usable - 1, n1));
  return [n1, usable - n1];
}

/**
 * Length of each arm of an L-shaped stair, measured from the corner landing.
 * Both arms are the same length, so the first one plus the landing spans the
 * requested `depth`. Very wide/shallow stairs keep a usable minimum arm.
 */
export function lShapedArmLength(width: number, depth: number): number {
  return Math.max(depth - width, width * 0.5);
}

/** Width of the well-hole between the two flights of a U-shaped stair. */
export function uShapedWellGap(width: number): number {
  return width * 0.1;
}

/** Depth of the half-turn landing of a U-shaped stair. */
export function uShapedLandingDepth(width: number, depth: number): number {
  return Math.min(width, depth * 0.35);
}

/** Radius of a spiral stair's centre post, as a fraction of the tread width. */
export const SPIRAL_POST_RATIO = 0.15;

/**
 * Outer radius of a spiral stair. `width` is the walkable depth of one tread,
 * so the radius is that plus the centre post it wraps around.
 */
export function spiralRadius(width: number): number {
  return width * (1 + SPIRAL_POST_RATIO);
}

/**
 * Overall bounding box of a stair, centred on `stair.position`. This is the box
 * used for hit-testing, marquee bounds and the selection outline — it is only
 * `width` x `depth` for straight stairs, since `width` is the width of a single
 * flight and the other types lay several flights out side by side.
 */
export function stairFootprint(stair: Stair): StairFootprint {
  const w = Math.max(1, stair.width);
  const d = Math.max(1, stair.depth);
  switch (stair.stairType || 'straight') {
    case 'l-shaped': {
      const side = w + lShapedArmLength(w, d);
      return { width: side, depth: side };
    }
    case 'u-shaped':
      return { width: 2 * w + uShapedWellGap(w), depth: d };
    case 'spiral': {
      // Round footprint: `depth` plays no part, the treads set the radius
      const side = 2 * spiralRadius(w);
      return { width: side, depth: side };
    }
    default:
      return { width: w, depth: d };
  }
}

/**
 * Compute the layout of a stair. Spiral stairs use a different description, so
 * callers should branch on the returned `type`.
 */
export function buildStairLayout(
  stair: Stair,
  totalRise: number = STAIR_TOTAL_RISE
): StairLayout | SpiralStairLayout {
  const w = Math.max(1, stair.width);
  const d = Math.max(1, stair.depth);
  const n = Math.max(2, Math.round(stair.riserCount) || 2);
  const riserHeight = totalRise / n;
  const type = stair.stairType || 'straight';
  const footprint = stairFootprint(stair);
  // Half-extents of the footprint: every rectangle below is placed relative to
  // its centre, which is where the stair sits on the plan.
  const hx = footprint.width / 2;
  const hy = footprint.depth / 2;

  if (type === 'spiral') {
    return {
      type: 'spiral',
      footprint,
      radius: spiralRadius(w),
      postRadius: w * SPIRAL_POST_RATIO,
      totalAngle: SPIRAL_TOTAL_ANGLE,
      startAngle: SPIRAL_START_ANGLE,
      riserCount: n,
      riserHeight,
      totalRise,
      slabThickness: STAIR_SLAB_THICKNESS
    };
  }

  const common = {
    footprint,
    riserCount: n,
    riserHeight,
    totalRise,
    slabThickness: STAIR_SLAB_THICKNESS
  };

  if (type === 'l-shaped') {
    // Landing is a square of one flight width in the -x/-y corner; the first
    // flight runs up along -y beside it, the second turns and heads along +x.
    const arm = lShapedArmLength(w, d);
    const [n1, n2] = splitRisers(n, arm, arm);
    return {
      type: 'l-shaped',
      flights: [
        {
          x: -hx, y: -hy + w, w, h: arm,
          axis: 'y', dir: -1, riserCount: n1, startRiser: 0
        },
        {
          x: -hx + w, y: -hy, w: arm, h: w,
          axis: 'x', dir: 1, riserCount: n2, startRiser: n1
        }
      ],
      landings: [{ x: -hx, y: -hy, w, h: w, atRiser: n1 }],
      ...common
    };
  }

  if (type === 'u-shaped') {
    // Two parallel flights with a full-width half-turn landing at the -y end.
    const landingDepth = uShapedLandingDepth(w, d);
    const runLen = footprint.depth - landingDepth;
    const [n1, n2] = splitRisers(n, runLen, runLen);
    return {
      type: 'u-shaped',
      flights: [
        {
          x: -hx, y: -hy + landingDepth, w, h: runLen,
          axis: 'y', dir: -1, riserCount: n1, startRiser: 0
        },
        {
          x: hx - w, y: -hy + landingDepth, w, h: runLen,
          axis: 'y', dir: 1, riserCount: n2, startRiser: n1
        }
      ],
      landings: [{ x: -hx, y: -hy, w: footprint.width, h: landingDepth, atRiser: n1 }],
      ...common
    };
  }

  return {
    type: 'straight',
    flights: [
      {
        x: -hx, y: -hy, w: footprint.width, h: footprint.depth,
        axis: 'y', dir: -1, riserCount: n, startRiser: 0
      }
    ],
    landings: [],
    ...common
  };
}

/** Length of a flight along its travel axis. */
export function flightRunLength(flight: StairFlight): number {
  return flight.axis === 'x' ? flight.w : flight.h;
}

/** Depth of a single tread of a flight. */
export function flightTreadDepth(flight: StairFlight): number {
  return flightRunLength(flight) / Math.max(1, flight.riserCount);
}

/** Coordinate, along the travel axis, of the foot (lowest step) of a flight. */
export function flightStartCoord(flight: StairFlight): number {
  if (flight.axis === 'x') return flight.dir === 1 ? flight.x : flight.x + flight.w;
  return flight.dir === 1 ? flight.y : flight.y + flight.h;
}

/** Centre of a flight on the axis perpendicular to travel. */
export function flightCrossCenter(flight: StairFlight): number {
  return flight.axis === 'x' ? flight.y + flight.h / 2 : flight.x + flight.w / 2;
}

/** Width of a flight on the axis perpendicular to travel. */
export function flightCrossWidth(flight: StairFlight): number {
  return flight.axis === 'x' ? flight.h : flight.w;
}

// ── Railings ─────────────────────────────────────────────────────────
//
// A railing follows the *open* edges of the walking surface, so it is derived
// from the layout above rather than described separately: each run is a
// polyline of plan points, every point carrying the height of the surface
// underneath it. Renderers put the handrail `railingHeight` above that line
// and drop posts down to it, which keeps 2D and 3D on the same railings.

/** Default handrail height above the walking surface (cm). */
export const STAIR_RAILING_HEIGHT = 90;
/** Shortest handrail worth drawing — guards against silly input (cm). */
export const STAIR_RAILING_MIN_HEIGHT = 30;
/** Target gap between railing posts (cm); each segment rounds to fit. */
export const STAIR_RAILING_POST_SPACING = 25;
/** Side of the square handrail (cm). */
export const STAIR_RAILING_RAIL_THICKNESS = 4;
/** Side of a square post (cm). */
export const STAIR_RAILING_POST_THICKNESS = 3;

/** One hand of a stair, as you walk up it. */
export type StairRailingSide = 'left' | 'right';

/** A point on a railing: where it sits in plan, and the surface height there. */
export interface StairRailingPoint {
  x: number;
  y: number;
  /** Height of the walking surface under this point (cm above the floor). */
  base: number;
}

export interface StairRailingRun {
  side: StairRailingSide;
  /**
   * Path of the handrail from the foot of the stair to the top, running
   * continuously through the landings.
   */
  points: StairRailingPoint[];
}

/** Which sides of a stair are railed — unset means both. */
export function stairRailingSides(stair: Stair): StairRailingSides {
  return stair.railings ?? 'both';
}

/** Handrail height above the walking surface for a stair (cm). */
export function stairRailingHeight(stair: Stair): number {
  const h = stair.railingHeight;
  return h && h > 0 ? Math.max(STAIR_RAILING_MIN_HEIGHT, h) : STAIR_RAILING_HEIGHT;
}

/** Height of the walking surface a fraction `t` (0 = foot, 1 = head) up a flight. */
function flightBaseAt(flight: StairFlight, riserHeight: number, t: number): number {
  return (flight.startRiser + flight.riserCount * t) * riserHeight;
}

/**
 * Cross-axis coordinate of one hand of a flight. Facing the way the flight
 * ascends, the left hand is towards -x when climbing towards -y and towards
 * +x when climbing towards +y (and correspondingly for flights running along
 * x), which is what keeps a railing on the same hand across a turn.
 */
function flightSideCoord(flight: StairFlight, side: StairRailingSide): number {
  const leftIsMax = flight.axis === 'y' ? flight.dir === 1 : flight.dir === -1;
  const lo = flight.axis === 'y' ? flight.x : flight.y;
  const hi = lo + (flight.axis === 'y' ? flight.w : flight.h);
  return (side === 'left') === leftIsMax ? hi : lo;
}

/** Point on one hand of a flight, a fraction `t` of the way up it. */
function flightSidePoint(
  flight: StairFlight,
  side: StairRailingSide,
  t: number,
  riserHeight: number
): StairRailingPoint {
  const cross = flightSideCoord(flight, side);
  const along = flightStartCoord(flight) + flight.dir * t * flightRunLength(flight);
  const base = flightBaseAt(flight, riserHeight, t);
  return flight.axis === 'x' ? { x: along, y: cross, base } : { x: cross, y: along, base };
}

/**
 * Points a railing needs to cross a landing between two flights, on one hand.
 *
 * At a quarter-turn the two hands meet where their edges cross — the corner of
 * the landing on the outside, the inside corner on the other hand. At a
 * half-turn the flights are parallel: the outer railing has to travel around
 * the far edge of the landing, while the inner one cuts straight across the
 * open edge and needs nothing added.
 */
function landingRailingPoints(
  landing: StairLanding,
  below: StairFlight,
  above: StairFlight,
  side: StairRailingSide,
  riserHeight: number
): StairRailingPoint[] {
  const base = landing.atRiser * riserHeight;
  const crossBelow = flightSideCoord(below, side);
  const crossAbove = flightSideCoord(above, side);

  if (below.axis !== above.axis) {
    // Quarter-turn: the two edge lines meet at a corner of the landing.
    return below.axis === 'y'
      ? [{ x: crossBelow, y: crossAbove, base }]
      : [{ x: crossAbove, y: crossBelow, base }];
  }

  // Half-turn. The railing only wraps around the landing when it runs along
  // the landing's own outer edge; otherwise it is the well side, and a
  // straight segment across the open edge already joins the two flights.
  const alongAxis = below.axis;
  const lo = alongAxis === 'y' ? landing.y : landing.x;
  const hi = lo + (alongAxis === 'y' ? landing.h : landing.w);
  const crossLo = alongAxis === 'y' ? landing.x : landing.y;
  const crossHi = crossLo + (alongAxis === 'y' ? landing.w : landing.h);
  const onOuterEdge =
    Math.abs(crossBelow - crossLo) < 1e-6 || Math.abs(crossBelow - crossHi) < 1e-6;
  if (!onOuterEdge) return [];

  // Far edge of the landing: the one the flight below points at.
  const far = below.dir === 1 ? hi : lo;
  return alongAxis === 'y'
    ? [{ x: crossBelow, y: far, base }, { x: crossAbove, y: far, base }]
    : [{ x: far, y: crossBelow, base }, { x: far, y: crossAbove, base }];
}

/** Drop points that repeat the previous one, which turns at a shared corner produce. */
function dedupeRailingPoints(points: StairRailingPoint[]): StairRailingPoint[] {
  const out: StairRailingPoint[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < 1e-6 && Math.abs(prev.y - p.y) < 1e-6) continue;
    out.push(p);
  }
  return out;
}

/**
 * Compute the railings of a stair, in the same local coordinates as the
 * layout. Only the sides the stair asks for are returned, so a stair with
 * `railings: 'none'` yields nothing at all and renderers need no extra checks.
 */
export function buildStairRailings(
  stair: Stair,
  layout: StairLayout | SpiralStairLayout = buildStairLayout(stair)
): StairRailingRun[] {
  const sides = stairRailingSides(stair);
  if (sides === 'none') return [];
  // Keep posts inside the footprint, so the railing never spills outside the
  // box the user can click and select.
  const inset = STAIR_RAILING_POST_THICKNESS / 2;

  if (layout.type === 'spiral') {
    // Only the outer edge of a spiral is open — the inner one is the centre
    // post it winds around — so it has a single railing, on the walker's left.
    const r = Math.max(layout.postRadius, layout.radius - inset);
    const points: StairRailingPoint[] = [];
    for (let i = 0; i <= layout.riserCount; i++) {
      const a = layout.startAngle + (i / layout.riserCount) * layout.totalAngle;
      points.push({ x: r * Math.cos(a), y: r * Math.sin(a), base: i * layout.riserHeight });
    }
    return [{ side: 'left', points }];
  }

  const hx = layout.footprint.width / 2 - inset;
  const hy = layout.footprint.depth / 2 - inset;
  const clamp = (p: StairRailingPoint): StairRailingPoint => ({
    x: Math.max(-hx, Math.min(hx, p.x)),
    y: Math.max(-hy, Math.min(hy, p.y)),
    base: p.base
  });

  const runs: StairRailingRun[] = [];
  for (const side of ['left', 'right'] as const) {
    if (sides !== 'both' && sides !== side) continue;
    const points: StairRailingPoint[] = [];
    layout.flights.forEach((flight, i) => {
      const landing = layout.landings[i - 1];
      const previous = layout.flights[i - 1];
      if (landing && previous) {
        points.push(...landingRailingPoints(landing, previous, flight, side, layout.riserHeight));
      }
      points.push(
        flightSidePoint(flight, side, 0, layout.riserHeight),
        flightSidePoint(flight, side, 1, layout.riserHeight)
      );
    });
    const path = dedupeRailingPoints(points.map(clamp));
    if (path.length >= 2) runs.push({ side, points: path });
  }
  return runs;
}

/**
 * Positions of the posts along a railing run — one at every end and corner,
 * with the rest spread evenly so no gap exceeds `spacing`.
 */
export function railingPostPositions(
  run: StairRailingRun,
  spacing: number = STAIR_RAILING_POST_SPACING
): StairRailingPoint[] {
  const step = Math.max(5, spacing);
  const posts: StairRailingPoint[] = [];
  for (let i = 0; i < run.points.length - 1; i++) {
    const a = run.points[i];
    const b = run.points[i + 1];
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
  posts.push(run.points[run.points.length - 1]);
  return posts;
}
