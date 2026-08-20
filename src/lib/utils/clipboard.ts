/**
 * Copy and paste of plan elements, across floors as well as within one
 * (issue #22).
 *
 * Duplicating something was already possible one element at a time, but only
 * ever next to itself: there was nowhere to *hold* a copy, so the balcony you
 * furnished on the ground floor had to be rebuilt by hand on the first. A
 * clipboard fixes that — the copy is taken by value and stays on the clipboard
 * until it is replaced, so you can switch floor, or keep pasting, in between.
 *
 * Two rules shape the result:
 *
 *   - **The copy is independent.** Everything is deep-cloned and every pasted
 *     element gets a fresh id, so editing a paste never reaches back into the
 *     original — including the nested `position` and `scale` objects a shallow
 *     spread would have left shared.
 *   - **The paste keeps its shape.** One offset moves the whole set, so the
 *     spacing between the pieces of a copied kitchen survives the trip.
 *
 * Openings are the awkward case: a door has no position of its own, only a
 * fraction along the wall it is cut into. So each copied opening also carries
 * a snapshot of that wall, and paste rebinds it, in order of preference, to
 * the wall pasted alongside it, to the same wall if it is still there, or to a
 * wall standing in the same place on the target floor — which is the common
 * case when floors were stacked from a copy. An opening with nowhere to land
 * is reported as skipped rather than dropped silently.
 *
 * Rooms are deliberately absent: they are detected from the walls that bound
 * them, so pasting the walls brings the room back on its own.
 *
 * Like the nudge planner, this module is pure — no store access, no DOM — and
 * splits planning from applying so the caller can tell a paste that does
 * nothing from one that does, and skip the undo entry for the former.
 */
import type {
  Column,
  Door,
  ElementGroup,
  EntourageItem,
  Floor,
  FurnitureItem,
  Point,
  Stair,
  TextAnnotation,
  Wall,
  Window as Win,
} from '$lib/models/types';

/** How far a paste onto the floor it was copied from steps aside, in cm, so
 *  the copy doesn't hide under the original. Matches the duplicate actions. */
export const PASTE_OFFSET = 30;

/** Endpoints this close count as the same corner — the tolerance the rest of
 *  the editor uses when deciding whether two walls meet. */
const WALL_MATCH_TOLERANCE = 2;

/** The wall an opening was cut into, remembered so the opening can be rebound
 *  to the equivalent wall on another floor. */
export interface HostWall {
  id: string;
  start: Point;
  end: Point;
}

export type ClipboardEntry =
  | { kind: 'wall'; data: Wall }
  | { kind: 'door'; data: Door; host: HostWall }
  | { kind: 'window'; data: Win; host: HostWall }
  | { kind: 'furniture'; data: FurnitureItem }
  | { kind: 'stair'; data: Stair }
  | { kind: 'column'; data: Column }
  | { kind: 'text'; data: TextAnnotation }
  | { kind: 'entourage'; data: EntourageItem };

export type ClipboardKind = ClipboardEntry['kind'];

export interface Clipboard {
  /** Copied elements, walls first so a paste builds the hosts before the
   *  openings that hang off them. */
  entries: ClipboardEntry[];
  /** Groups that were copied whole, as source ids; partial groups are dropped. */
  groups: string[][];
  /** Floor the copy was taken from — paste offsets differ on and off it. */
  sourceFloorId: string;
  copiedAt: number;
}

/** Everything a paste will add to a floor, worked out before touching it. */
export interface PastePlan {
  walls: Wall[];
  doors: Door[];
  windows: Win[];
  furniture: FurnitureItem[];
  stairs: Stair[];
  columns: Column[];
  textAnnotations: TextAnnotation[];
  entourage: EntourageItem[];
  groups: ElementGroup[];
  /** Ids of every element created, in clipboard order — the selection to make. */
  ids: string[];
  /** Copied openings that found no wall to attach to on this floor. */
  skipped: number;
}

export interface PasteOptions {
  /** World offset applied to everything pasted. Defaults to no offset. */
  offset?: Point;
  /** Id generator; defaults to the same short random id the store uses. */
  newId?: () => string;
}

function defaultId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Keep coordinates readable — an offset shouldn't add float noise. */
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function shifted(p: Point, offset: Point): Point {
  return { x: round(p.x + offset.x), y: round(p.y + offset.y) };
}

function wallLength(w: { start: Point; end: Point }): number {
  return Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
}

function nearPoint(a: Point, b: Point): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= WALL_MATCH_TOLERANCE;
}

/**
 * Clamp an opening's centre so it stays on its wall — the same clamp a drag
 * and a nudge apply: never past 10%/90% of the wall, and never hanging over an
 * end by half its own width.
 */
function clampOpening(t: number, width: number, wallLen: number): number {
  const half = width / 2 / Math.max(1, wallLen);
  let lo = Math.max(0.1, half);
  let hi = Math.min(0.9, 1 - half);
  if (lo > hi) { lo = 0.5; hi = 0.5; }
  return Math.max(lo, Math.min(hi, t));
}

// ── Copying ─────────────────────────────────────────────────────────

/**
 * Take a copy of `ids` from `floor`, or null when the selection holds nothing
 * copyable (a guide or a measurement, say, or an id that no longer exists).
 *
 * Locked elements copy: locking guards the original against being moved, and
 * a copy moves nothing. The lock travels with the copy, as every other
 * property does.
 */
export function copySelection(floor: Floor, ids: Iterable<string>): Clipboard | null {
  const idSet = ids instanceof Set ? (ids as Set<string>) : new Set(ids);
  if (idSet.size === 0) return null;

  const entries: ClipboardEntry[] = [];
  const copied = new Set<string>();
  const take = (entry: ClipboardEntry) => {
    entries.push(entry);
    copied.add(entry.data.id);
  };

  // Walls first: a door pasted alongside its wall has to find the wall
  // already built.
  for (const w of floor.walls) {
    if (idSet.has(w.id)) take({ kind: 'wall', data: structuredClone(w) });
  }
  for (const d of floor.doors) {
    if (!idSet.has(d.id)) continue;
    const host = floor.walls.find((w) => w.id === d.wallId);
    if (!host) continue; // an orphaned door has no meaning to paste
    take({ kind: 'door', data: structuredClone(d), host: hostSnapshot(host) });
  }
  for (const win of floor.windows) {
    if (!idSet.has(win.id)) continue;
    const host = floor.walls.find((w) => w.id === win.wallId);
    if (!host) continue;
    take({ kind: 'window', data: structuredClone(win), host: hostSnapshot(host) });
  }
  for (const fi of floor.furniture) {
    if (idSet.has(fi.id)) take({ kind: 'furniture', data: structuredClone(fi) });
  }
  for (const s of floor.stairs ?? []) {
    if (idSet.has(s.id)) take({ kind: 'stair', data: structuredClone(s) });
  }
  for (const c of floor.columns ?? []) {
    if (idSet.has(c.id)) take({ kind: 'column', data: structuredClone(c) });
  }
  for (const t of floor.textAnnotations ?? []) {
    if (idSet.has(t.id)) take({ kind: 'text', data: structuredClone(t) });
  }
  for (const en of floor.entourage ?? []) {
    if (idSet.has(en.id)) take({ kind: 'entourage', data: structuredClone(en) });
  }

  if (entries.length === 0) return null;

  // A group survives only when all of it was copied — half a group is not a
  // group, and re-forming one from the remnant would silently regroup things
  // the user only meant to copy.
  const groups: string[][] = [];
  for (const g of floor.groups ?? []) {
    const members = g.elementIds ?? [];
    if (members.length > 1 && members.every((id) => copied.has(id))) groups.push([...members]);
  }

  return { entries, groups, sourceFloorId: floor.id, copiedAt: Date.now() };
}

function hostSnapshot(w: Wall): HostWall {
  return { id: w.id, start: { ...w.start }, end: { ...w.end } };
}

/**
 * Where a paste should land: stepped aside on the floor it was copied from, so
 * the copy doesn't sit invisibly on top of the original, and in place on any
 * other floor, where landing directly above what it was copied from is exactly
 * what stacking a building wants. Repeated pastes cascade either way, so a run
 * of Ctrl+V leaves a diagonal trail rather than one pile.
 *
 * `repeat` is how many times this clipboard has already been pasted onto this
 * floor.
 */
export function pasteOffset(clip: Clipboard, targetFloorId: string, repeat = 0): Point {
  const steps = targetFloorId === clip.sourceFloorId ? repeat + 1 : repeat;
  return { x: PASTE_OFFSET * steps, y: PASTE_OFFSET * steps };
}

// ── Pasting ─────────────────────────────────────────────────────────

/**
 * Work out what pasting `clip` onto `floor` creates, without touching it.
 *
 * The plan is a set of ready-made elements: `applyPaste` only has to append
 * them. Planning separately is what lets the caller skip the undo entry for a
 * paste that turns out to add nothing — a lone door copied onto a floor with
 * no wall to hang it on.
 */
export function planPaste(floor: Floor, clip: Clipboard, options: PasteOptions = {}): PastePlan {
  const uid = options.newId ?? defaultId;
  const offset = options.offset ?? { x: 0, y: 0 };
  const plan: PastePlan = {
    walls: [], doors: [], windows: [], furniture: [], stairs: [], columns: [],
    textAnnotations: [], entourage: [], groups: [], ids: [], skipped: 0,
  };

  /** source element id → id of the copy this paste creates */
  const idMap = new Map<string, string>();
  const fresh = (sourceId: string): string => {
    const id = uid();
    idMap.set(sourceId, id);
    plan.ids.push(id);
    return id;
  };

  for (const entry of clip.entries) {
    switch (entry.kind) {
      case 'wall': {
        const w = structuredClone(entry.data);
        w.id = fresh(entry.data.id);
        w.start = shifted(w.start, offset);
        w.end = shifted(w.end, offset);
        // The curve handle is an absolute point, so it travels with the wall.
        if (w.curvePoint) w.curvePoint = shifted(w.curvePoint, offset);
        plan.walls.push(w);
        break;
      }
      case 'door':
      case 'window': {
        const bound = bindOpening(floor, plan, idMap, entry, offset);
        if (!bound) { plan.skipped++; break; }
        const item = structuredClone(entry.data) as Door & Win;
        item.id = fresh(entry.data.id);
        item.wallId = bound.wallId;
        item.position = bound.position;
        if (entry.kind === 'door') plan.doors.push(item as Door);
        else plan.windows.push(item as Win);
        break;
      }
      case 'furniture': {
        const fi = structuredClone(entry.data);
        fi.id = fresh(entry.data.id);
        fi.position = shifted(fi.position, offset);
        plan.furniture.push(fi);
        break;
      }
      case 'stair': {
        const s = structuredClone(entry.data);
        s.id = fresh(entry.data.id);
        s.position = shifted(s.position, offset);
        plan.stairs.push(s);
        break;
      }
      case 'column': {
        const c = structuredClone(entry.data);
        c.id = fresh(entry.data.id);
        c.position = shifted(c.position, offset);
        plan.columns.push(c);
        break;
      }
      case 'text': {
        const t = structuredClone(entry.data);
        t.id = fresh(entry.data.id);
        const p = shifted({ x: t.x, y: t.y }, offset);
        t.x = p.x;
        t.y = p.y;
        plan.textAnnotations.push(t);
        break;
      }
      case 'entourage': {
        const en = structuredClone(entry.data);
        en.id = fresh(entry.data.id);
        en.position = shifted(en.position, offset);
        plan.entourage.push(en);
        break;
      }
    }
  }

  // Groups re-form around the copies, but only where every member made it —
  // an opening that was skipped takes its group with it.
  for (const members of clip.groups) {
    const mapped = members.map((id) => idMap.get(id)).filter((id): id is string => !!id);
    if (mapped.length === members.length && mapped.length > 1) {
      plan.groups.push({ id: uid(), elementIds: mapped });
    }
  }

  return plan;
}

/**
 * Find the wall a pasted opening belongs on, and where along it to sit.
 *
 * Preference order:
 *   1. the wall pasted with it — the opening keeps its exact place on the copy;
 *   2. the wall it came from, still on this floor — the opening slides along it
 *      by however much of the paste offset runs along the wall, so a paste onto
 *      the same floor doesn't land exactly on top of the original;
 *   3. a wall standing where its host stood — the case that makes pasting onto
 *      another floor of a stacked building work.
 */
function bindOpening(
  floor: Floor,
  plan: PastePlan,
  idMap: Map<string, string>,
  entry: Extract<ClipboardEntry, { kind: 'door' | 'window' }>,
  offset: Point,
): { wallId: string; position: number } | null {
  const width = entry.data.width;

  // 1. Pasted alongside its own wall: the wall moved rigidly, so the fraction
  // along it is unchanged.
  const pastedWallId = idMap.get(entry.host.id);
  if (pastedWallId) return { wallId: pastedWallId, position: entry.data.position };

  // 2. Its own wall, still standing on this floor.
  const original = floor.walls.find((w) => w.id === entry.host.id);
  if (original) return { wallId: original.id, position: slideAlong(original, entry.data.position, width, offset) };

  // 3. A wall in the same place on this floor. Walls drawn the other way round
  // still match — the opening's fraction is measured from the other end.
  for (const w of floor.walls) {
    if (nearPoint(w.start, entry.host.start) && nearPoint(w.end, entry.host.end)) {
      return { wallId: w.id, position: slideAlong(w, entry.data.position, width, offset) };
    }
    if (nearPoint(w.start, entry.host.end) && nearPoint(w.end, entry.host.start)) {
      return { wallId: w.id, position: slideAlong(w, 1 - entry.data.position, width, offset) };
    }
  }

  // A wall pasted in this same paste can also host it, even though the opening
  // came from elsewhere — it stands where the host stood.
  for (const w of plan.walls) {
    if (nearPoint(w.start, entry.host.start) && nearPoint(w.end, entry.host.end)) {
      return { wallId: w.id, position: entry.data.position };
    }
  }

  return null;
}

/** Slide an opening along `wall` by the component of `offset` that runs along
 *  it, clamped so it stays on the wall. */
function slideAlong(wall: Wall, position: number, width: number, offset: Point): number {
  const len = wallLength(wall);
  if (len < 1) return position;
  const along = (offset.x * (wall.end.x - wall.start.x) + offset.y * (wall.end.y - wall.start.y)) / len;
  const next = clampOpening(position + along / len, width, len);
  return Math.round(next * 1e7) / 1e7;
}

/** Write a planned paste into a floor. */
export function applyPaste(floor: Floor, plan: PastePlan): void {
  if (plan.walls.length) floor.walls = [...floor.walls, ...plan.walls];
  if (plan.doors.length) floor.doors = [...floor.doors, ...plan.doors];
  if (plan.windows.length) floor.windows = [...floor.windows, ...plan.windows];
  if (plan.furniture.length) floor.furniture = [...floor.furniture, ...plan.furniture];
  if (plan.stairs.length) floor.stairs = [...(floor.stairs ?? []), ...plan.stairs];
  if (plan.columns.length) floor.columns = [...(floor.columns ?? []), ...plan.columns];
  if (plan.textAnnotations.length) floor.textAnnotations = [...(floor.textAnnotations ?? []), ...plan.textAnnotations];
  if (plan.entourage.length) floor.entourage = [...(floor.entourage ?? []), ...plan.entourage];
  if (plan.groups.length) floor.groups = [...(floor.groups ?? []), ...plan.groups];
}
