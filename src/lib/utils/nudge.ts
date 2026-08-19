/**
 * Keyboard nudging — precise movement of the selection with the arrow keys
 * (issue #21).
 *
 * Dragging with the mouse is the fast way to place something, never the exact
 * one: the pointer quantises to whatever a screen pixel is worth at the current
 * zoom, and the snap system can pull an item somewhere you didn't ask for. An
 * arrow press moves by a number instead — 1cm by default, 10cm with Shift for
 * coarse positioning, 1mm with Alt to trim.
 *
 * The module is split in two halves so the plan and the elevation view can
 * share it:
 *   - the *key* helpers turn a press into a direction and a step size;
 *   - `computeNudge` turns a world-space (dx, dy) into the concrete moves for
 *     one floor, which `nudgeElements` in the project store applies inside a
 *     single undo entry.
 *
 * The 3D view deliberately takes no part in this: it has no drag-to-move of
 * its own, and an orbited camera gives the arrows no stable meaning.
 *
 * Everything here is pure: no store access, no DOM.
 */
import type { Floor, Point, Wall } from '$lib/models/types';

/** Plain arrow: one centimetre. */
export const NUDGE_STEP = 1;
/** Shift+arrow: coarse positioning. */
export const NUDGE_STEP_COARSE = 10;
/** Alt+arrow: sub-centimetre trim. */
export const NUDGE_STEP_FINE = 0.1;

export type NudgeDirection = 'up' | 'down' | 'left' | 'right';

const ARROW_KEYS: Record<string, NudgeDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/**
 * The direction an arrow key asks for, or null when the event isn't a nudge.
 *
 * Ctrl/Cmd+arrow is left alone: the browser and the OS both bind it (word-wise
 * caret movement, desktop switching), and nothing here is worth stealing it for.
 */
export function nudgeDirection(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>): NudgeDirection | null {
  if (e.ctrlKey || e.metaKey) return null;
  return ARROW_KEYS[e.key] ?? null;
}

/** Step size in cm for a key press: Alt trims, Shift strides, otherwise 1cm. */
export function nudgeStep(e: Pick<KeyboardEvent, 'shiftKey' | 'altKey'>): number {
  if (e.altKey) return NUDGE_STEP_FINE;
  if (e.shiftKey) return NUDGE_STEP_COARSE;
  return NUDGE_STEP;
}

/**
 * Plan-axis delta, for the 2D canvas: the plan is drawn with y growing
 * downwards, so Up is -y.
 */
export function nudgeDelta(dir: NudgeDirection, step: number): Point {
  switch (dir) {
    case 'up': return { x: 0, y: -step };
    case 'down': return { x: 0, y: step };
    case 'left': return { x: -step, y: 0 };
    case 'right': return { x: step, y: 0 };
  }
}

// ── Planning a nudge ────────────────────────────────────────────────

export type NudgePointKind = 'furniture' | 'stair' | 'column' | 'entourage' | 'text';

export interface NudgeMoves {
  /** Selected walls, moved whole (both endpoints). */
  walls: { id: string; start: Point; end: Point }[];
  /** Endpoints of *unselected* walls dragged along so corners stay joined. */
  joints: { id: string; endpoint: 'start' | 'end'; to: Point }[];
  /** Elements that carry a free position. */
  points: { kind: NudgePointKind; id: string; to: Point }[];
  /** Doors and windows, slid along their host wall. */
  openings: { kind: 'door' | 'window'; id: string; position: number }[];
  /** How many selected elements the nudge actually moves. */
  count: number;
}

/** Endpoints within this distance are treated as the same corner — the same
 *  tolerance the canvas uses when dragging a wall body. */
const JOINT_TOLERANCE = 2;

/** Keep coordinates readable: 0.1cm steps otherwise accumulate float noise. */
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function shifted(p: Point, dx: number, dy: number): Point {
  return { x: round(p.x + dx), y: round(p.y + dy) };
}

function samePoint(a: Point, b: Point): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < JOINT_TOLERANCE;
}

/**
 * Clamp an opening's centre so it stays on its wall, matching the clamp
 * `positionOnWall()` applies to a drag: never past 10%/90% of the wall, and
 * never hanging over an end by half its own width.
 */
function clampOpening(t: number, width: number, wallLen: number): number {
  const half = width / 2 / Math.max(1, wallLen);
  let lo = Math.max(0.1, half);
  let hi = Math.min(0.9, 1 - half);
  if (lo > hi) { lo = 0.5; hi = 0.5; }
  return Math.max(lo, Math.min(hi, t));
}

function wallLength(w: Wall): number {
  return Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
}

/**
 * Work out what moving `ids` by (dx, dy) does to `floor`, without touching it.
 *
 * Planning before mutating is what lets the caller tell a nudge that does
 * nothing — everything selected is locked, or a door was pushed square across
 * its own wall — from one that does, and skip the undo entry for the former.
 */
export function computeNudge(floor: Floor, ids: Iterable<string>, dx: number, dy: number): NudgeMoves {
  const moves: NudgeMoves = { walls: [], joints: [], points: [], openings: [], count: 0 };
  if (!dx && !dy) return moves;
  const idSet = ids instanceof Set ? (ids as Set<string>) : new Set(ids);
  if (idSet.size === 0) return moves;

  // Walls move whole, and pull the corners they share with unselected walls
  // along with them — the same stretching a wall-body drag does, so a nudged
  // wall doesn't tear itself off the room it belongs to.
  const corners: { from: Point; to: Point }[] = [];
  for (const w of floor.walls) {
    if (!idSet.has(w.id)) continue;
    const start = shifted(w.start, dx, dy);
    const end = shifted(w.end, dx, dy);
    moves.walls.push({ id: w.id, start, end });
    corners.push({ from: w.start, to: start }, { from: w.end, to: end });
  }
  if (corners.length > 0) {
    for (const w of floor.walls) {
      if (idSet.has(w.id)) continue;
      for (const c of corners) {
        if (samePoint(w.start, c.from)) moves.joints.push({ id: w.id, endpoint: 'start', to: c.to });
        if (samePoint(w.end, c.from)) moves.joints.push({ id: w.id, endpoint: 'end', to: c.to });
      }
    }
  }

  const addPoint = (kind: NudgePointKind, id: string, p: Point) => {
    moves.points.push({ kind, id, to: shifted(p, dx, dy) });
  };
  // Locked items ignore a nudge exactly as they ignore a drag.
  for (const fi of floor.furniture) {
    if (idSet.has(fi.id) && !fi.locked) addPoint('furniture', fi.id, fi.position);
  }
  for (const s of floor.stairs ?? []) {
    if (idSet.has(s.id)) addPoint('stair', s.id, s.position);
  }
  for (const c of floor.columns ?? []) {
    if (idSet.has(c.id)) addPoint('column', c.id, c.position);
  }
  for (const en of floor.entourage ?? []) {
    if (idSet.has(en.id) && !en.locked) addPoint('entourage', en.id, en.position);
  }
  for (const t of floor.textAnnotations ?? []) {
    if (idSet.has(t.id)) addPoint('text', t.id, { x: t.x, y: t.y });
  }

  // A door or window has one degree of freedom: it slides along its wall. Only
  // the component of the nudge that runs along the wall counts, so pressing
  // "up" against a horizontal wall correctly does nothing. An opening whose
  // wall is itself selected has already moved with it.
  const slide = (wallId: string, width: number, position: number): number | null => {
    if (idSet.has(wallId)) return null;
    const wall = floor.walls.find((w) => w.id === wallId);
    if (!wall) return null;
    const len = wallLength(wall);
    if (len < 1) return null;
    const along = ((dx * (wall.end.x - wall.start.x)) + (dy * (wall.end.y - wall.start.y))) / len;
    if (along === 0) return null;
    const next = clampOpening(position + along / len, width, len);
    // 1e-7 of a wall is a fraction of a micron: rounds off float noise
    // without quantising a 1mm nudge on a long wall into nothing.
    return Math.abs(next - position) < 1e-9 ? null : Math.round(next * 1e7) / 1e7;
  };
  for (const d of floor.doors) {
    if (!idSet.has(d.id)) continue;
    const next = slide(d.wallId, d.width, d.position);
    if (next !== null) moves.openings.push({ kind: 'door', id: d.id, position: next });
  }
  for (const w of floor.windows) {
    if (!idSet.has(w.id)) continue;
    const next = slide(w.wallId, w.width, w.position);
    if (next !== null) moves.openings.push({ kind: 'window', id: w.id, position: next });
  }

  moves.count = moves.walls.length + moves.points.length + moves.openings.length;
  return moves;
}

/** Write a planned nudge into a floor. */
export function applyNudge(floor: Floor, moves: NudgeMoves): void {
  for (const m of moves.walls) {
    const w = floor.walls.find((w) => w.id === m.id);
    if (!w) continue;
    // A curve handle is an absolute point, so it has to travel with the wall.
    if (w.curvePoint) {
      w.curvePoint = {
        x: round(w.curvePoint.x + (m.start.x - w.start.x)),
        y: round(w.curvePoint.y + (m.start.y - w.start.y)),
      };
    }
    w.start = m.start;
    w.end = m.end;
  }
  for (const j of moves.joints) {
    const w = floor.walls.find((w) => w.id === j.id);
    if (!w) continue;
    if (j.endpoint === 'start') w.start = { ...j.to };
    else w.end = { ...j.to };
  }
  for (const m of moves.points) {
    switch (m.kind) {
      case 'furniture': {
        const it = floor.furniture.find((f) => f.id === m.id);
        if (it) it.position = m.to;
        break;
      }
      case 'stair': {
        const it = floor.stairs?.find((s) => s.id === m.id);
        if (it) it.position = m.to;
        break;
      }
      case 'column': {
        const it = floor.columns?.find((c) => c.id === m.id);
        if (it) it.position = m.to;
        break;
      }
      case 'entourage': {
        const it = floor.entourage?.find((e) => e.id === m.id);
        if (it) it.position = m.to;
        break;
      }
      case 'text': {
        const it = floor.textAnnotations?.find((t) => t.id === m.id);
        if (it) { it.x = m.to.x; it.y = m.to.y; }
        break;
      }
    }
  }
  for (const m of moves.openings) {
    if (m.kind === 'door') {
      const d = floor.doors.find((d) => d.id === m.id);
      if (d) d.position = m.position;
    } else {
      const w = floor.windows.find((w) => w.id === m.id);
      if (w) w.position = m.position;
    }
  }
}
