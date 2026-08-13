/**
 * Canvas interaction utilities: coordinate conversion, snap logic, and shared types.
 * Extracted from FloorPlanCanvas.svelte.
 */
import type { Point, Wall } from '$lib/models/types';

/** Shared canvas state passed to rendering / hit-test functions */
export interface CanvasState {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  zoom: number;
  camX: number;
  camY: number;
}

export const GRID = 20;
export const SNAP = 10;
export const MAGNETIC_SNAP = 15;
export const WALL_SNAP_DIST = 30;

export function screenToWorld(cs: CanvasState, sx: number, sy: number): Point {
  return { x: (sx - cs.width / 2) / cs.zoom + cs.camX, y: (sy - cs.height / 2) / cs.zoom + cs.camY };
}

export function worldToScreen(cs: CanvasState, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - cs.camX) * cs.zoom + cs.width / 2, y: (wy - cs.camY) * cs.zoom + cs.height / 2 };
}

export function snap(v: number, enabled: boolean, snapToGrid: boolean, gridSize: number): number {
  if (!enabled) return v;
  const step = snapToGrid ? gridSize : SNAP;
  return Math.round(v / step) * step;
}

export function magneticSnap(
  p: Point,
  walls: Wall[],
  snapFn: (v: number) => number,
  zoom: number,
  excludeWallIds?: Set<string>
): Point & { snappedToEndpoint?: boolean } {
  let best: Point & { snappedToEndpoint?: boolean } = { x: snapFn(p.x), y: snapFn(p.y) };
  let bestDist = MAGNETIC_SNAP / zoom;
  for (const w of walls) {
    if (excludeWallIds && excludeWallIds.has(w.id)) continue;
    for (const ep of [w.start, w.end]) {
      const d = Math.hypot(p.x - ep.x, p.y - ep.y);
      if (d < bestDist) {
        bestDist = d;
        best = { x: ep.x, y: ep.y, snappedToEndpoint: true };
      }
    }
  }
  return best;
}

export function angleSnap(start: Point, end: Point, enabled: boolean): Point {
  if (!enabled) return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 5) return end;
  const angle = Math.atan2(dy, dx);
  const snapAngles = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, -Math.PI, -3 * Math.PI / 4, -Math.PI / 2, -Math.PI / 4];
  const ANGLE_THRESHOLD = Math.PI / 18;
  for (const sa of snapAngles) {
    if (Math.abs(angle - sa) < ANGLE_THRESHOLD) {
      return { x: start.x + len * Math.cos(sa), y: start.y + len * Math.sin(sa) };
    }
  }
  return end;
}

export function findConnectedEndpoints(pt: Point, excludeWallId: string, walls: Wall[]): { wallId: string; endpoint: 'start' | 'end' }[] {
  const tolerance = 2;
  const results: { wallId: string; endpoint: 'start' | 'end' }[] = [];
  for (const w of walls) {
    if (w.id === excludeWallId) continue;
    if (Math.hypot(w.start.x - pt.x, w.start.y - pt.y) < tolerance) {
      results.push({ wallId: w.id, endpoint: 'start' });
    }
    if (Math.hypot(w.end.x - pt.x, w.end.y - pt.y) < tolerance) {
      results.push({ wallId: w.id, endpoint: 'end' });
    }
  }
  return results;
}

/** Resize handle types for furniture */
export type HandleType = 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-t' | 'resize-b' | 'resize-l' | 'resize-r' | 'rotate';

export type ResizeHandle = Exclude<HandleType, 'rotate'>;

/** Which side of the item each resize handle sits on, in the item's own frame. */
export const HANDLE_DIR: Record<ResizeHandle, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
  'resize-tl': { x: -1, y: -1 }, 'resize-tr': { x: 1, y: -1 },
  'resize-bl': { x: -1, y: 1 },  'resize-br': { x: 1, y: 1 },
  'resize-l':  { x: -1, y: 0 },  'resize-r':  { x: 1, y: 0 },
  'resize-t':  { x: 0, y: -1 },  'resize-b':  { x: 0, y: 1 },
};

/** Smallest footprint a resize may produce, in cm. */
export const MIN_FURNITURE_CM = 10;

/**
 * Everything a resize needs, frozen at the moment the handle was grabbed.
 *
 * A resize pivots on the corner (or edge) opposite the handle, and that anchor
 * must stay nailed to the spot it started on. Deriving the size from the live
 * item instead resizes it about its own centre, which makes it creep away from
 * the cursor. `grabX/grabY` hold the offset between the pointer and the handle
 * at grab time so the item does not jump on the first pixel of movement.
 */
export interface ResizeStart {
  center: Point;   // item position, world, at grab time
  cos: number;     // the item's local frame
  sin: number;
  width: number;   // effective footprint at grab time, cm
  depth: number;
  dirX: -1 | 0 | 1;
  dirY: -1 | 0 | 1;
  grabX: number;
  grabY: number;
}

/** Freeze the state a resize drag works from. `pointer` is in world coords. */
export function startResize(
  item: { position: Point; rotation: number },
  size: { width: number; depth: number },
  handle: ResizeHandle,
  pointer: Point
): ResizeStart {
  const rad = (item.rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dir = HANDLE_DIR[handle];
  const dx = pointer.x - item.position.x;
  const dy = pointer.y - item.position.y;
  // World delta → the item's local frame (inverse rotation).
  const px = dx * cos + dy * sin;
  const py = -dx * sin + dy * cos;
  return {
    center: { ...item.position },
    cos, sin,
    width: size.width,
    depth: size.depth,
    dirX: dir.x, dirY: dir.y,
    grabX: px - (dir.x * size.width) / 2,
    grabY: py - (dir.y * size.depth) / 2,
  };
}

/**
 * Resize from the frozen start state, keeping the opposite corner/edge fixed.
 *
 * `snapLength` quantises each dimension (identity when snapping is off), and
 * `keepAspect` holds the original proportions on a corner handle.
 */
export function resizeFrom(
  r: ResizeStart,
  pointer: Point,
  opts: { snapLength?: (v: number) => number; keepAspect?: boolean } = {}
): { width: number; depth: number; position: Point } {
  const snapLen = opts.snapLength ?? ((v: number) => v);
  const dx = pointer.x - r.center.x;
  const dy = pointer.y - r.center.y;
  // Where the pointer puts the grabbed handle, in the item's local frame.
  const handleX = dx * r.cos + dy * r.sin - r.grabX;
  const handleY = -dx * r.sin + dy * r.cos - r.grabY;
  // The anchor is the opposite side; it must not move.
  const anchorX = (-r.dirX * r.width) / 2;
  const anchorY = (-r.dirY * r.depth) / 2;

  let width = r.width;
  let depth = r.depth;
  if (r.dirX !== 0) width = Math.max(MIN_FURNITURE_CM, snapLen(r.dirX * (handleX - anchorX)));
  if (r.dirY !== 0) depth = Math.max(MIN_FURNITURE_CM, snapLen(r.dirY * (handleY - anchorY)));

  if (opts.keepAspect && r.dirX !== 0 && r.dirY !== 0 && r.depth > 0) {
    const ratio = r.width / r.depth;
    if (width / depth > ratio) depth = Math.max(MIN_FURNITURE_CM, width / ratio);
    else width = Math.max(MIN_FURNITURE_CM, depth * ratio);
  }

  // Put the centre where it has to be for the anchor to stay put.
  const cx = r.dirX === 0 ? 0 : anchorX + (r.dirX * width) / 2;
  const cy = r.dirY === 0 ? 0 : anchorY + (r.dirY * depth) / 2;
  return {
    width,
    depth,
    position: {
      x: r.center.x + cx * r.cos - cy * r.sin,
      y: r.center.y + cx * r.sin + cy * r.cos,
    },
  };
}

/** World position of the anchor a resize pivots on — the side opposite the handle. */
export function resizeAnchor(r: ResizeStart): Point {
  const ax = (-r.dirX * r.width) / 2;
  const ay = (-r.dirY * r.depth) / 2;
  return {
    x: r.center.x + ax * r.cos - ay * r.sin,
    y: r.center.y + ax * r.sin + ay * r.cos,
  };
}
