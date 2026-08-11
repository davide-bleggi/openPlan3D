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
 * Every flight and landing fits exactly inside the footprint, so nothing ever
 * spills outside the box the user can click and select.
 *
 * Flights always ascend towards -y (the direction the "UP" arrow points), and
 * turns then continue towards +x. `direction` does not change the geometry —
 * it only flips which way the plan arrow points, since a "down" stair is the
 * same physical object seen from the storey above. The 3D geometry always
 * rises from the floor the stair belongs to, so it is never buried under the
 * ground plane.
 */
import type { Stair } from '$lib/models/types';

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
