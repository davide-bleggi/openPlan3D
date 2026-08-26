/**
 * Where a dragged piece of furniture lands.
 *
 * The 2D plan has always snapped furniture flush against a nearby wall while
 * it is dragged; the 3D view had no dragging at all (issue #41). Rather than
 * write the same geometry twice, the rule lives here and both views call it,
 * so an armchair pushed against the north wall ends up in exactly the same
 * place whichever view the user pushed it in.
 */
import type { Point, Wall } from '$lib/models/types';

/** cm — how close the item's back edge has to come to a wall before it snaps. */
export const WALL_SNAP_DIST = 30;

export interface WallSnap {
  /** Centre position that puts the item's back edge flush with the wall face. */
  position: Point;
  /** Degrees, with the item's front facing away from the wall. */
  rotation: number;
  wallId: string;
  /** Which side of the wall's direction vector the item sits on. */
  side: 'normal' | 'anti';
  /** Degrees — the wall's own direction, for the on-screen snap indicator. */
  wallAngle: number;
}

/**
 * Snap a position so the item's back edge is flush against the nearest wall.
 * Returns null when no wall is within `maxDist` of that flush position.
 *
 * `snapCoord` quantises the resulting centre (the caller's grid-snap function);
 * pass the identity to leave it alone.
 */
export function snapFurnitureToWall(
  walls: readonly Wall[],
  pos: Point,
  size: { width: number; depth: number },
  snapCoord: (v: number) => number = (v) => v,
  maxDist = WALL_SNAP_DIST
): WallSnap | null {
  // Furniture half-depth (the "back" dimension that goes against the wall)
  const halfDepth = size.depth / 2;

  let bestDist = maxDist;
  let bestResult: WallSnap | null = null;

  for (const wall of walls) {
    const wx = wall.end.x - wall.start.x;
    const wy = wall.end.y - wall.start.y;
    const wLen = Math.hypot(wx, wy);
    if (wLen < 1) continue;

    // Unit vectors along wall and perpendicular (normal)
    const ux = wx / wLen, uy = wy / wLen;
    const nx = -uy, ny = ux; // normal pointing "left" of wall direction

    // Project furniture center onto wall line
    const dx = pos.x - wall.start.x;
    const dy = pos.y - wall.start.y;
    const along = dx * ux + dy * uy; // projection along wall
    const perp = dx * nx + dy * ny;  // signed distance from wall center-line

    // Check if projection falls within wall segment (with some margin)
    if (along < -size.width / 2 || along > wLen + size.width / 2) continue;

    const wallHalfThickness = wall.thickness / 2;
    // Distance from furniture center to wall surface on the side the furniture is on
    const absDist = Math.abs(perp) - wallHalfThickness;

    // We want the furniture edge to touch the wall, so target distance = halfDepth
    const snapDist = Math.abs(absDist - halfDepth);

    if (snapDist < bestDist) {
      bestDist = snapDist;
      const side: 'normal' | 'anti' = perp >= 0 ? 'normal' : 'anti';
      const sign = perp >= 0 ? 1 : -1;
      // Position: push center so edge is flush with wall surface
      const targetPerp = sign * (wallHalfThickness + halfDepth);
      const clampedAlong = Math.max(size.width / 2, Math.min(wLen - size.width / 2, along));
      const newX = wall.start.x + ux * clampedAlong + nx * targetPerp;
      const newY = wall.start.y + uy * clampedAlong + ny * targetPerp;
      // Align rotation: furniture "front" faces away from wall
      const wallAngle = Math.atan2(wy, wx) * 180 / Math.PI;
      // Furniture at 0° has depth along Y axis, so align perpendicular
      const targetRotation = perp >= 0 ? wallAngle : wallAngle + 180;

      bestResult = {
        position: { x: snapCoord(newX), y: snapCoord(newY) },
        rotation: ((targetRotation % 360) + 360) % 360,
        wallId: wall.id,
        side,
        wallAngle
      };
    }
  }
  return bestResult;
}

export interface DragResolution {
  position: Point;
  rotation: number;
  /** The wall the item snapped to, or null when it landed free-standing. */
  wallSnap: WallSnap | null;
}

/**
 * Resolve one frame of a furniture drag: wall snap if a wall is close enough,
 * otherwise the quantised free position with the rotation the item started the
 * drag with — so leaving a wall gives the item its own heading back instead of
 * keeping whatever the wall imposed.
 */
export function resolveFurnitureDrag(
  target: Point,
  opts: {
    walls: readonly Wall[];
    size: { width: number; depth: number };
    /** Rotation to fall back to when the item is not against a wall. */
    baseRotation: number;
    snapCoord?: (v: number) => number;
    /** Wall snapping is snapping: the Snap switch turns it off like everything else. */
    wallSnapEnabled?: boolean;
    maxDist?: number;
  }
): DragResolution {
  const snapCoord = opts.snapCoord ?? ((v: number) => v);
  const wallSnap = opts.wallSnapEnabled === false
    ? null
    : snapFurnitureToWall(opts.walls, target, opts.size, snapCoord, opts.maxDist ?? WALL_SNAP_DIST);
  if (wallSnap) {
    return { position: wallSnap.position, rotation: wallSnap.rotation, wallSnap };
  }
  return {
    position: { x: snapCoord(target.x), y: snapCoord(target.y) },
    rotation: ((opts.baseRotation % 360) + 360) % 360,
    wallSnap: null
  };
}
