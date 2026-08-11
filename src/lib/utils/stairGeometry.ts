/**
 * Shared stair layout geometry.
 *
 * Both the 2D floor-plan renderer and the 3D viewer derive their stair meshes
 * from the layout returned here, so plan view and 3D always agree.
 *
 * Local coordinate system (before the stair's rotation/position are applied):
 *   - origin is the centre of the stair footprint
 *   - +x points right (the `width` axis)
 *   - +y points "down" the plan (the `depth` axis) and maps to +z in 3D
 *
 * Every stair type fits exactly inside the `width` x `depth` footprint centred
 * on `stair.position` — that is the box used for hit-testing, selection and
 * bounds, so flights and landings must never spill outside it.
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

export interface StairLayout {
  type: 'straight' | 'l-shaped' | 'u-shaped';
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

/** Width of each leg (and of the square corner landing) of an L-shaped stair. */
export function lShapedLegWidth(width: number, depth: number): number {
  return Math.min(width, depth) * 0.5;
}

/** Width of a single flight of a U-shaped stair, and the well-hole between them. */
export function uShapedRunWidth(width: number): { runWidth: number; wellGap: number } {
  const wellGap = width * 0.08;
  return { runWidth: (width - wellGap) / 2, wellGap };
}

/** Depth of the half-turn landing of a U-shaped stair. */
export function uShapedLandingDepth(width: number, depth: number): number {
  const { runWidth } = uShapedRunWidth(width);
  return Math.min(runWidth, depth * 0.35);
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

  if (type === 'spiral') {
    const radius = Math.min(w, d) / 2;
    return {
      type: 'spiral',
      radius,
      postRadius: radius * 0.12,
      totalAngle: SPIRAL_TOTAL_ANGLE,
      startAngle: SPIRAL_START_ANGLE,
      riserCount: n,
      riserHeight,
      totalRise,
      slabThickness: STAIR_SLAB_THICKNESS
    };
  }

  const common = {
    riserCount: n,
    riserHeight,
    totalRise,
    slabThickness: STAIR_SLAB_THICKNESS
  };

  if (type === 'l-shaped') {
    // Square landing in the -x/-y corner; first flight runs up along -y beside
    // it, the second turns and continues along +x.
    const leg = lShapedLegWidth(w, d);
    const run1Len = d - leg;
    const run2Len = w - leg;
    const [n1, n2] = splitRisers(n, run1Len, run2Len);
    return {
      type: 'l-shaped',
      flights: [
        {
          x: -w / 2, y: -d / 2 + leg, w: leg, h: run1Len,
          axis: 'y', dir: -1, riserCount: n1, startRiser: 0
        },
        {
          x: -w / 2 + leg, y: -d / 2, w: run2Len, h: leg,
          axis: 'x', dir: 1, riserCount: n2, startRiser: n1
        }
      ],
      landings: [{ x: -w / 2, y: -d / 2, w: leg, h: leg, atRiser: n1 }],
      ...common
    };
  }

  if (type === 'u-shaped') {
    // Two parallel flights with a full-width half-turn landing at the -y end.
    const { runWidth } = uShapedRunWidth(w);
    const landingDepth = uShapedLandingDepth(w, d);
    const runLen = d - landingDepth;
    const [n1, n2] = splitRisers(n, runLen, runLen);
    return {
      type: 'u-shaped',
      flights: [
        {
          x: -w / 2, y: -d / 2 + landingDepth, w: runWidth, h: runLen,
          axis: 'y', dir: -1, riserCount: n1, startRiser: 0
        },
        {
          x: w / 2 - runWidth, y: -d / 2 + landingDepth, w: runWidth, h: runLen,
          axis: 'y', dir: 1, riserCount: n2, startRiser: n1
        }
      ],
      landings: [{ x: -w / 2, y: -d / 2, w, h: landingDepth, atRiser: n1 }],
      ...common
    };
  }

  return {
    type: 'straight',
    flights: [
      {
        x: -w / 2, y: -d / 2, w, h: d,
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
