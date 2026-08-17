import { writable, derived, get } from 'svelte/store';
import type { Project, Floor, Wall, Door, Window as Win, FurnitureItem, Point, Stair, Column, BackgroundImage, GuideLine, ElementGroup, EntourageItem } from '$lib/models/types';
import { floorNameForLevel } from '$lib/utils/floorStacking';
import { assignFloorLevels, groundSlotIndex, moveFloorInStack, normalizeFloorOrder, orderFloorsBottomUp, reorderFloorStack } from '$lib/utils/floorOrder';
import { cloneFloorContents } from '$lib/utils/floorClone';


function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createDefaultFloor(level = 0): Floor {
  const id = uid();
  return { id, name: level === 0 ? 'Ground Floor' : `Floor ${level}`, level, walls: [], rooms: [], doors: [], windows: [], furniture: [], stairs: [], columns: [], guides: [], measurements: [], annotations: [], textAnnotations: [], groups: [] };
}

export function createDefaultProject(name = 'Untitled Project'): Project {
  const floor = createDefaultFloor();
  return {
    id: uid(),
    name,
    floors: [floor],
    activeFloorId: floor.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export const currentProject = writable<Project | null>(null);

export const activeFloor = derived(currentProject, ($p) => {
  if (!$p) return null;
  return $p.floors.find((f) => f.id === $p.activeFloorId) ?? $p.floors[0] ?? null;
});

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'furniture' | 'text';
export const selectedTool = writable<Tool>('select');
export const snapEnabled = writable<boolean>(true);
/** When true, left-click drag pans the canvas instead of selecting */
export const panMode = writable<boolean>(false);
export const selectedElementId = writable<string | null>(null);
/** Multi-select: set of element IDs currently selected (used alongside selectedElementId for marquee/shift-click) */
export const selectedElementIds = writable<Set<string>>(new Set());
export const viewMode = writable<'2d' | '3d'>('2d');

// Undo / Redo
interface UndoEntry {
  state: string;
  description: string;
  timestamp: number;
}
const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];

/** Reactive store exposing undo history for the UndoHistoryPanel */
export const undoHistoryStore = writable<{ entries: { description: string; timestamp: number }[]; currentIndex: number }>({ entries: [], currentIndex: -1 });

function syncHistoryStore() {
  const entries = undoStack.map(e => ({ description: e.description, timestamp: e.timestamp }));
  // currentIndex: undoStack.length means "current state" (top), entries are past states
  undoHistoryStore.set({ entries, currentIndex: undoStack.length });
}

/** Current undo action description — set before calling mutate/snapshot */
let _nextDescription = '';

// Undo coalescing: rapid consecutive edits to the same field (e.g. typing digits
// into a dimension input, which fires `oninput` per keystroke) should collapse into
// a single undo entry instead of one per keystroke. The first edit pushes the
// pre-edit baseline; subsequent edits sharing the same key within the time window
// reuse it rather than pushing a fresh snapshot.
let _lastCoalesceKey: string | null = null;
let _lastSnapshotTime = 0;
const COALESCE_WINDOW_MS = 800;

/** Break any active coalescing chain so the next edit starts a fresh undo entry. */
function resetCoalescing() {
  _lastCoalesceKey = null;
}

/** Build a coalesce key for an element edit from its type, id, and the fields changed.
 *  Rapid edits to the same element+fields collapse into one undo entry; changing which
 *  fields are edited (or which element) starts a new entry. */
function coalesceKeyFor(type: string, id: string, updates: Record<string, unknown>): string {
  return `${type}:${id}:${Object.keys(updates).sort().join(',')}`;
}

// Undo grouping: batch multiple mutations into a single undo entry
let undoGroupSnapshot: string | null = null;
let undoGroupDepth = 0;

/** Begin an undo group. Nested calls are supported; only the outermost pair takes effect. */
export function beginUndoGroup() {
  if (undoGroupDepth === 0) {
    const p = get(currentProject);
    if (p) undoGroupSnapshot = JSON.stringify(p);
  }
  undoGroupDepth++;
}

/** End an undo group. Commits a single undo entry from the state captured at beginUndoGroup(). */
export function endUndoGroup(description?: string) {
  if (undoGroupDepth <= 0) return;
  undoGroupDepth--;
  if (undoGroupDepth === 0 && undoGroupSnapshot !== null) {
    undoStack.push({ state: undoGroupSnapshot, description: description || _nextDescription || 'Group action', timestamp: Date.now() });
    if (undoStack.length > 50) undoStack.shift();
    redoStack.length = 0;
    undoGroupSnapshot = null;
    _nextDescription = '';
    resetCoalescing();
    syncHistoryStore();
  }
}

/** Abandon the open undo group and restore the state captured at beginUndoGroup().
 *  Used to back out of an in-progress gesture (Escape while dragging) — the
 *  document returns to how it looked before the drag and no undo entry is added.
 *  Unwinds nested groups too: a cancelled gesture cancels the whole thing. */
export function cancelUndoGroup() {
  if (undoGroupDepth <= 0) return;
  undoGroupDepth = 0;
  const snap = undoGroupSnapshot;
  undoGroupSnapshot = null;
  _nextDescription = '';
  resetCoalescing();
  if (snap !== null) currentProject.set(reviveDates(JSON.parse(snap)));
}

/** True while an undo group is open — i.e. individual mutations are being batched. */
export function isUndoGroupOpen(): boolean {
  return undoGroupDepth > 0;
}

function snapshot(description?: string, coalesceKey?: string) {
  // If inside an undo group, skip — the group handles the snapshot
  if (undoGroupDepth > 0) return;
  const p = get(currentProject);
  if (!p) return;
  const now = Date.now();
  // Coalesce rapid consecutive edits to the same field: the top-of-stack entry
  // already holds the correct pre-edit baseline, so don't push another snapshot.
  if (
    coalesceKey &&
    coalesceKey === _lastCoalesceKey &&
    now - _lastSnapshotTime < COALESCE_WINDOW_MS &&
    undoStack.length > 0
  ) {
    _lastSnapshotTime = now;
    redoStack.length = 0;
    return;
  }
  undoStack.push({ state: JSON.stringify(p), description: description || _nextDescription || 'Edit', timestamp: now });
  if (undoStack.length > 50) undoStack.shift();
  redoStack.length = 0;
  _nextDescription = '';
  _lastCoalesceKey = coalesceKey ?? null;
  _lastSnapshotTime = now;
  syncHistoryStore();
}

function reviveDates(p: Project): Project {
  if (p.createdAt && !(p.createdAt instanceof Date)) p.createdAt = new Date(p.createdAt as any);
  if (p.updatedAt && !(p.updatedAt instanceof Date)) p.updatedAt = new Date(p.updatedAt as any);
  return p;
}

export function undo() {
  resetCoalescing();
  const prev = undoStack.pop();
  if (!prev) return;
  const cur = get(currentProject);
  if (cur) redoStack.push({ state: JSON.stringify(cur), description: prev.description, timestamp: prev.timestamp });
  currentProject.set(reviveDates(JSON.parse(prev.state)));
  syncHistoryStore();
}

export function redo() {
  resetCoalescing();
  const next = redoStack.pop();
  if (!next) return;
  const cur = get(currentProject);
  if (cur) undoStack.push({ state: JSON.stringify(cur), description: next.description, timestamp: next.timestamp });
  currentProject.set(reviveDates(JSON.parse(next.state)));
  syncHistoryStore();
}

/** Jump to a specific undo history step by index (0 = oldest) */
export function jumpToUndoStep(targetIndex: number) {
  resetCoalescing();
  const total = undoStack.length; // total past states; current state is at index `total`
  if (targetIndex < 0 || targetIndex > total) return;
  if (targetIndex === total) return; // already at current state

  // We need to go back (total - targetIndex) steps
  // First, save current state to redo
  const cur = get(currentProject);
  if (!cur) return;

  // Push current + all states between current and target onto redo
  const stepsBack = total - targetIndex;
  // Move states from undoStack to redoStack
  redoStack.push({ state: JSON.stringify(cur), description: 'Current state', timestamp: Date.now() });
  for (let i = 0; i < stepsBack - 1; i++) {
    const entry = undoStack.pop()!;
    redoStack.push(entry);
  }
  const target = undoStack.pop()!;
  currentProject.set(reviveDates(JSON.parse(target.state)));
  syncHistoryStore();
}

function mutate(fn: (floor: Floor) => void, description?: string, coalesceKey?: string) {
  const p = get(currentProject);
  if (!p) return;
  snapshot(description, coalesceKey);
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  if (!floor) return;
  fn(floor);
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

export function addWall(start: Point, end: Point): string {
  const id = uid();
  mutate((f) => {
    f.walls.push({ id, start, end, thickness: 15, height: 280, color: '#444444' });
  }, 'Added wall');
  // Onboarding tip
  import('$lib/stores/onboarding.svelte').then(m => m.triggerTip('first-wall', end.x > 400 ? 300 : end.x + 20, 120));
  return id;
}

export function removeWall(id: string) {
  mutate((f) => {
    f.walls = f.walls.filter((w) => w.id !== id);
    f.doors = f.doors.filter((d) => d.wallId !== id);
    f.windows = f.windows.filter((w) => w.wallId !== id);
  }, 'Deleted wall');
}

export function addDoor(wallId: string, position: number, doorType: Door['type'] = 'single'): string {
  const id = uid();
  const defaults: Record<Door['type'], { width: number; height: number }> = {
    single: { width: 90, height: 210 },
    double: { width: 150, height: 210 },
    sliding: { width: 180, height: 210 },
    french: { width: 150, height: 210 },
    pocket: { width: 90, height: 210 },
    bifold: { width: 180, height: 210 },
    opening: { width: 100, height: 210 },
    garage: { width: 240, height: 210 },
  };
  const { width, height } = defaults[doorType];
  mutate((f) => {
    f.doors.push({ id, wallId, position, width, height, type: doorType, swingDirection: 'left', flipSide: false });
  }, `Added ${doorType} door`);
  // Onboarding tip
  import('$lib/stores/onboarding.svelte').then(m => m.triggerTip('first-door', 300, 120));
  return id;
}

export function addWindow(wallId: string, position: number, windowType: import('$lib/models/types').Window['type'] = 'standard'): string {
  const id = uid();
  const defaults: Record<import('$lib/models/types').Window['type'], { width: number; height: number }> = {
    standard: { width: 120, height: 120 },
    fixed: { width: 100, height: 100 },
    casement: { width: 80, height: 130 },
    sliding: { width: 180, height: 120 },
    bay: { width: 200, height: 150 },
  };
  const { width, height } = defaults[windowType];
  mutate((f) => {
    f.windows.push({ id, wallId, position, width, height, sillHeight: 90, type: windowType });
  }, `Added ${windowType} window`);
  return id;
}

export function addFurniture(catalogId: string, position: Point): string {
  const id = uid();
  mutate((f) => {
    f.furniture.push({ id, catalogId, position, rotation: 0, scale: { x: 1, y: 1, z: 1 } });
  }, `Added ${catalogId}`);
  // Onboarding tip
  import('$lib/stores/onboarding.svelte').then(m => m.triggerTip('first-furniture', position.x + 20, position.y + 20));
  return id;
}

/** Snapshot the current state before a drag begins (call once at drag start) */
export function beginDrag(description = 'Moved element') {
  snapshot(description);
}

/** Move furniture without creating an undo snapshot on every call (used during drag).
 *  Call `beginDrag()` when the drag starts to snapshot the pre-drag state. */
export function moveFurniture(id: string, position: Point) {
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  if (!floor) return;
  const item = floor.furniture.find((fi) => fi.id === id);
  if (item) {
    item.position = position;
    p.updatedAt = new Date();
    currentProject.set({ ...p });
  }
}

export function rotateFurniture(id: string, angle: number) {
  mutate((f) => {
    const item = f.furniture.find((fi) => fi.id === id);
    if (item) item.rotation = (item.rotation + angle) % 360;
  }, 'Rotated furniture');
}

/** Set an absolute rotation. Called once per pointer move while a wall-snapped
 *  item is dragged, so it coalesces: without a key every move would stringify
 *  the whole project onto the undo stack. */
export function setFurnitureRotation(id: string, angle: number) {
  mutate((f) => {
    const item = f.furniture.find((fi) => fi.id === id);
    if (item) item.rotation = ((angle % 360) + 360) % 360;
  }, undefined, coalesceKeyFor('furniture', id, { rotation: angle }));
}

/**
 * Resize a placed item during a handle drag.
 *
 * Writes real centimetre dimensions into `width`/`depth` and normalises `scale`
 * to ±1 (the sign is kept, it mirrors the icon). Effective size is
 * `(width ?? catalog.width) * |scale.x|` everywhere, so folding the scale into
 * the dimensions leaves the item exactly where it was drawn while making the
 * number in the properties panel the same number the handles produce.
 *
 * `position` moves with it: a resize pivots on the opposite corner/edge, so the
 * centre shifts by half the size change. No undo snapshot — the gesture's undo
 * group covers the whole drag.
 */
export function resizeFurniture(id: string, size: { width: number; depth: number }, position: Point) {
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  const item = floor?.furniture.find((fi) => fi.id === id);
  if (!item) return;
  item.width = size.width;
  item.depth = size.depth;
  item.scale = {
    x: Math.sign(item.scale?.x ?? 1) || 1,
    y: Math.sign(item.scale?.y ?? 1) || 1,
    z: item.scale?.z ?? 1,
  };
  item.position = position;
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

/** Set an absolute scale. Called once per pointer move while a resize handle is
 *  dragged — coalesced for the same reason as setFurnitureRotation. */
export function scaleFurniture(id: string, scale: { x: number; y: number }) {
  mutate((f) => {
    const fi = f.furniture.find((item) => item.id === id);
    if (fi) {
      fi.scale = { x: Math.max(0.2, scale.x), y: Math.max(0.2, scale.y), z: fi.scale.z };
    }
  }, undefined, coalesceKeyFor('furniture', id, { scale }));
}

export function removeFurniture(id: string) {
  mutate((f) => {
    f.furniture = f.furniture.filter((fi) => fi.id !== id);
  }, 'Deleted furniture');
}

// Stairs
export function addStair(position: Point): string {
  const id = uid();
  mutate((f) => {
    if (!f.stairs) f.stairs = [];
    f.stairs.push({ id, position, rotation: 0, width: 100, depth: 300, riserCount: 14, direction: 'up', stairType: 'straight' });
  }, 'Added stair');
  return id;
}

export function updateStair(id: string, updates: Partial<Stair>) {
  mutate((f) => {
    if (!f.stairs) return;
    const s = f.stairs.find((s) => s.id === id);
    if (s) Object.assign(s, updates);
  }, undefined, coalesceKeyFor('stair', id, updates));
}

export function removeStair(id: string) {
  mutate((f) => {
    if (!f.stairs) return;
    f.stairs = f.stairs.filter((s) => s.id !== id);
  });
}

export function moveStair(id: string, position: Point) {
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  if (!floor || !floor.stairs) return;
  const s = floor.stairs.find((s) => s.id === id);
  if (s) {
    s.position = position;
    p.updatedAt = new Date();
    currentProject.set({ ...p });
  }
}

// Background Image
export function setBackgroundImage(bg: BackgroundImage | undefined) {
  mutate((f) => {
    f.backgroundImage = bg;
  });
}

export function updateBackgroundImage(updates: Partial<BackgroundImage>) {
  mutate((f) => {
    if (f.backgroundImage) Object.assign(f.backgroundImage, updates);
  });
}

// Column functions
export function addColumn(position: Point, shape: 'round' | 'square' = 'round'): string {
  const id = uid();
  mutate((f) => {
    if (!f.columns) f.columns = [];
    f.columns.push({ id, position, rotation: 0, shape, diameter: 30, height: 280, color: '#cccccc' });
  }, `Added ${shape} column`);
  return id;
}

export function updateColumn(id: string, updates: Partial<Column>) {
  mutate((f) => {
    if (!f.columns) return;
    const c = f.columns.find((c) => c.id === id);
    if (c) Object.assign(c, updates);
  }, undefined, coalesceKeyFor('column', id, updates));
}

export function removeColumn(id: string) {
  mutate((f) => {
    if (!f.columns) return;
    f.columns = f.columns.filter((c) => c.id !== id);
  });
}

export function moveColumn(id: string, position: Point) {
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  if (!floor || !floor.columns) return;
  const c = floor.columns.find((c) => c.id === id);
  if (c) {
    c.position = position;
    p.updatedAt = new Date();
    currentProject.set({ ...p });
  }
}

/** Tool for placing columns */
export const placingColumn = writable<boolean>(false);
export const placingColumnShape = writable<'round' | 'square'>('round');

/** Tool for placing stairs */
export const placingStair = writable<boolean>(false);

// --- Entourage (2D presentation symbols) ---
export const placingEntourageId = writable<string | null>(null);

export function addEntourageItem(defId: string, position: Point, width: number): string {
  const id = uid();
  mutate((f) => {
    if (!f.entourage) f.entourage = [];
    f.entourage.push({ id, defId, position, width, rotation: 0 });
  }, 'Added entourage');
  return id;
}

/** Move an entourage item without snapshotting (used during drag). */
export function moveEntourage(id: string, position: Point) {
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  const item = floor?.entourage?.find((e) => e.id === id);
  if (item) {
    item.position = position;
    p.updatedAt = new Date();
    currentProject.set({ ...p });
  }
}

/** Resize an entourage item without snapshotting (used during handle drag). */
export function resizeEntourage(id: string, width: number) {
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  const item = floor?.entourage?.find((e) => e.id === id);
  if (item) {
    item.width = width;
    p.updatedAt = new Date();
    currentProject.set({ ...p });
  }
}

export function updateEntourageItem(id: string, updates: Partial<EntourageItem>) {
  mutate((f) => {
    const e = f.entourage?.find((e) => e.id === id);
    if (e) Object.assign(e, updates);
  }, undefined, coalesceKeyFor('entourage', id, updates));
}

/** Register an uploaded PNG as a reusable project-level entourage symbol. */
export function addCustomEntourage(name: string, dataUrl: string, aspect: number): string {
  const p = get(currentProject);
  if (!p) return '';
  snapshot('Added custom entourage');
  if (!p.customEntourage) p.customEntourage = [];
  const id = uid();
  p.customEntourage.push({ id, name, dataUrl, aspect });
  p.updatedAt = new Date();
  currentProject.set({ ...p });
  return id;
}

/** Scale calibration mode */
export const calibrationMode = writable<boolean>(false);
export const calibrationPoints = writable<Point[]>([]);

export function removeElement(id: string) {
  mutate((f) => {
    // Check if the element being removed is a wall — if so, also remove associated doors/windows
    const isWall = f.walls.some((w) => w.id === id);
    f.walls = f.walls.filter((w) => w.id !== id);
    if (isWall) {
      // Cascade delete: remove doors and windows attached to this wall
      f.doors = f.doors.filter((d) => d.wallId !== id);
      f.windows = f.windows.filter((w) => w.wallId !== id);
    }
    f.doors = f.doors.filter((d) => d.id !== id);
    f.windows = f.windows.filter((w) => w.id !== id);
    f.furniture = f.furniture.filter((fi) => fi.id !== id);
    if (f.stairs) f.stairs = f.stairs.filter((s) => s.id !== id);
    if (f.columns) f.columns = f.columns.filter((c) => c.id !== id);
    if (f.textAnnotations) f.textAnnotations = f.textAnnotations.filter((t) => t.id !== id);
    if (f.entourage) f.entourage = f.entourage.filter((e) => e.id !== id);
  }, 'Deleted element');
}

/** Move a wall endpoint without creating an undo snapshot (for dragging) */
export function moveWallEndpoint(id: string, endpoint: 'start' | 'end', position: Point) {
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  if (!floor) return;
  const w = floor.walls.find((w) => w.id === id);
  if (w) {
    w[endpoint] = position;
    p.updatedAt = new Date();
    currentProject.set({ ...p });
  }
}

export function updateWall(id: string, updates: Partial<Wall>) {
  mutate((f) => {
    const w = f.walls.find((w) => w.id === id);
    if (w) Object.assign(w, updates);
  }, undefined, coalesceKeyFor('wall', id, updates));
}

/** Show/hide a single wall (rendering only — the wall stays structural). */
export function setWallHidden(id: string, hidden: boolean) {
  mutate((f) => {
    const w = f.walls.find((w) => w.id === id);
    if (w) w.hidden = hidden || undefined;
  }, hidden ? 'Hid wall' : 'Showed wall');
}

/**
 * Turn the railing on a hidden wall on or off. A wall that is actually built
 * needs none, so this only makes sense on a hidden (terrace/balcony) wall.
 */
export function setWallRailing(id: string, railing: boolean) {
  mutate((f) => {
    const w = f.walls.find((w) => w.id === id);
    if (w) w.railing = railing || undefined;
  }, railing ? 'Added wall railing' : 'Removed wall railing');
}

export function toggleWallHidden(id: string) {
  const f = get(activeFloor);
  const w = f?.walls.find((w) => w.id === id);
  if (!w) return;
  setWallHidden(id, !w.hidden);
}

/**
 * Show/hide several walls in one undoable step. Ids that are not walls on the
 * active floor are ignored, so a mixed multi-selection can be passed straight in.
 * Returns the number of walls actually changed.
 */
export function setWallsHidden(ids: Iterable<string>, hidden: boolean): number {
  const idSet = new Set(ids);
  const f = get(activeFloor);
  if (!f) return 0;
  const targets = f.walls.filter((w) => idSet.has(w.id) && !!w.hidden !== hidden);
  if (targets.length === 0) return 0;
  const targetIds = new Set(targets.map((w) => w.id));
  mutate((floor) => {
    for (const w of floor.walls) {
      if (targetIds.has(w.id)) w.hidden = hidden || undefined;
    }
  }, `${hidden ? 'Hid' : 'Showed'} ${targets.length} wall${targets.length === 1 ? '' : 's'}`);
  return targets.length;
}

export function updateDoor(id: string, updates: Partial<Door>) {
  mutate((f) => {
    const d = f.doors.find((d) => d.id === id);
    if (d) Object.assign(d, updates);
  }, undefined, coalesceKeyFor('door', id, updates));
}

export function updateWindow(id: string, updates: Partial<Win>) {
  mutate((f) => {
    const w = f.windows.find((w) => w.id === id);
    if (w) Object.assign(w, updates);
  }, undefined, coalesceKeyFor('window', id, updates));
}

export function updateFurniture(id: string, updates: Partial<FurnitureItem>) {
  mutate((f) => {
    const fi = f.furniture.find((fi) => fi.id === id);
    if (fi) Object.assign(fi, updates);
  }, undefined, coalesceKeyFor('furniture', id, updates));
}

export function updateRoom(id: string, updates: Partial<{ name: string; floorTexture: string; color: string; roomType: import('$lib/models/types').RoomCategory; labelOffset: import('$lib/models/types').Point | undefined }>) {
  mutate((f) => {
    let r = f.rooms.find((r) => r.id === id);
    if (r) {
      Object.assign(r, updates);
    } else {
      // Room not in floor.rooms yet (dynamically detected) — add it so changes persist on save
      const detected = get(detectedRoomsStore).find((r) => r.id === id);
      if (detected) {
        const newRoom = { ...detected, ...updates };
        f.rooms.push(newRoom);
      }
    }
  }, undefined, coalesceKeyFor('room', id, updates));
}

export interface AddFloorOptions {
  /** Name for the new floor. Defaults to the conventional name for its level. */
  name?: string;
  /**
   * Id of the floor to copy structure from, or `'previous'` for the floor the
   * new one lands on top of. Omit to start empty.
   */
  copyFrom?: string | 'previous' | null;
  /** Copy furniture and entourage too (structure only by default). */
  includeFurniture?: boolean;
}

/**
 * Add a floor on top of the stack, optionally as an independent copy of the
 * floor below it (issue #15). The new floor becomes the active one.
 */
export function addFloor(options: AddFloorOptions = {}) {
  const p = get(currentProject);
  if (!p) return;
  snapshot('Added floor');
  const ordered = normalizeFloorOrder(p.floors);
  // One above the highest existing level — floors.length would reuse a level
  // after a middle floor was removed, stacking two floors at the same height.
  const level = ordered.reduce((max, f) => Math.max(max, f.level ?? 0), -1) + 1;
  const floor: Floor = { id: uid(), name: options.name?.trim() || floorNameForLevel(level), level, walls: [], rooms: [], doors: [], windows: [], furniture: [], stairs: [], columns: [], guides: [], measurements: [], annotations: [], textAnnotations: [], groups: [] };

  const sourceId = options.copyFrom === 'previous' ? ordered[ordered.length - 1]?.id : options.copyFrom;
  const source = sourceId ? ordered.find((f) => f.id === sourceId) : undefined;
  if (source) {
    Object.assign(floor, cloneFloorContents(source, { includeFurniture: options.includeFurniture, newId: uid }));
  }

  p.floors = [...ordered, floor];
  p.activeFloorId = floor.id;
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

export function removeFloor(id: string) {
  const p = get(currentProject);
  if (!p || p.floors.length <= 1) return;
  snapshot('Removed floor');
  // Re-level the survivors so the stack stays contiguous and auto-named floors
  // renumber instead of leaving a gap behind (e.g. "Floor 1, Floor 3").
  p.floors = normalizeFloorOrder(p.floors.filter(f => f.id !== id));
  if (p.activeFloorId === id) {
    p.activeFloorId = p.floors[0].id;
  }
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

/** Move a floor one step down (`-1`) or up (`+1`) the stack. */
export function moveFloor(id: string, delta: -1 | 1) {
  const p = get(currentProject);
  if (!p) return;
  const before = orderFloorsBottomUp(p.floors);
  const from = before.findIndex((f) => f.id === id);
  if (from === -1 || from + delta < 0 || from + delta >= before.length) return;
  snapshot(delta > 0 ? 'Moved floor up' : 'Moved floor down');
  p.floors = moveFloorInStack(p.floors, id, delta);
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

/** Drag-and-drop reorder: move the floor at index `from` to index `to`,
 *  both counted bottom-to-top in the stack. */
export function reorderFloors(from: number, to: number) {
  const p = get(currentProject);
  if (!p || from === to) return;
  const ordered = orderFloorsBottomUp(p.floors);
  if (from < 0 || from >= ordered.length || to < 0 || to >= ordered.length) return;
  snapshot('Reordered floors');
  p.floors = reorderFloorStack(p.floors, from, to);
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

/** Rename a floor. An empty name falls back to the level's conventional name. */
export function renameFloor(id: string, name: string) {
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find((f) => f.id === id);
  if (!floor) return;
  const next = name.trim() || floorNameForLevel(floor.level ?? 0);
  if (next === floor.name) return;
  snapshot('Renamed floor');
  floor.name = next;
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

/** Duplicate an existing floor, inserting the copy directly above it. */
export function duplicateFloor(id: string, includeFurniture = true) {
  const p = get(currentProject);
  if (!p) return;
  const ordered = orderFloorsBottomUp(p.floors);
  const index = ordered.findIndex((f) => f.id === id);
  if (index === -1) return;
  snapshot('Duplicated floor');
  const source = ordered[index];
  const copy: Floor = {
    ...cloneFloorContents(source, { includeFurniture, newId: uid }),
    id: uid(),
    name: `${source.name || floorNameForLevel(source.level ?? 0)} copy`,
    level: source.level ?? 0,
  };
  ordered.splice(index + 1, 0, copy);
  p.floors = assignFloorLevels(ordered, groundSlotIndex(ordered));
  p.activeFloorId = copy.id;
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

export function setActiveFloor(floorId: string) {
  const p = get(currentProject);
  if (!p) return;
  if (p.floors.some((f) => f.id === floorId)) {
    p.activeFloorId = floorId;
    currentProject.set({ ...p });
  }
}

export function updateProjectName(name: string) {
  const p = get(currentProject);
  if (!p) return;
  p.name = name;
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

export function loadProject(project: Project) {
  undoStack.length = 0;
  redoStack.length = 0;
  resetCoalescing();
  currentProject.set(project);
  syncHistoryStore();
}

/** Import a floor's data into the current project's active floor (replaces walls/doors/windows/furniture) */
export function importFloorIntoCurrentProject(floor: import('$lib/models/types').Floor) {
  const p = get(currentProject);
  if (!p) return;
  snapshot('Imported floor');
  const activeFloorIdx = p.floors.findIndex((f) => f.id === p.activeFloorId);
  if (activeFloorIdx === -1) return;
  // snapshot was already called above via snapshot('Imported floor')
  const existing = p.floors[activeFloorIdx];
  // Merge imported data into the active floor
  existing.walls = [...existing.walls, ...floor.walls];
  existing.doors = [...existing.doors, ...floor.doors];
  existing.windows = [...existing.windows, ...floor.windows];
  existing.furniture = [...existing.furniture, ...floor.furniture];
  if (floor.stairs) existing.stairs = [...(existing.stairs || []), ...floor.stairs];
  if (floor.columns) existing.columns = [...(existing.columns || []), ...floor.columns];
  currentProject.set({ ...p });
}

export const selectedRoomId = writable<string | null>(null);
/** Detected rooms (synced from canvas room detection) */
export const detectedRoomsStore = writable<import('$lib/models/types').Room[]>([]);
/** catalogId currently being placed (null = not placing) */
export const placingFurnitureId = writable<string | null>(null);
/** Rotation angle for furniture being placed */
export const placingRotation = writable<number>(0);

/**
 * Every "now click the plan to place X" mode, cleared together.
 * Arming one of them parks the tool on 'select', so leaving another armed
 * makes the canvas swallow the next click for the wrong thing.
 */
export function clearPlacementModes() {
  placingStair.set(false);
  placingColumn.set(false);
  placingFurnitureId.set(null);
  placingEntourageId.set(null);
}

/** Pick a tool. Always use this rather than setting `selectedTool` directly,
 *  so a pending placement never survives the change. */
export function setActiveTool(tool: Tool) {
  clearPlacementModes();
  selectedTool.set(tool);
}
/** Door subtype currently selected for placement */
export const placingDoorType = writable<Door['type']>('single');
/** Window subtype currently selected for placement */
export const placingWindowType = writable<import('$lib/models/types').Window['type']>('standard');

/** Duplicate a door onto the same wall */
export function duplicateDoor(id: string): string | null {
  const p = get(currentProject);
  if (!p) return null;
  const floor = p.floors.find(f => f.id === p.activeFloorId);
  if (!floor) return null;
  const d = floor.doors.find(d => d.id === id);
  if (!d) return null;
  const newPos = Math.min(1, d.position + 0.1);
  const newId = uid();
  mutate(f => {
    f.doors.push({ ...d, id: newId, position: newPos });
  });
  return newId;
}

/** Duplicate a window onto the same wall */
export function duplicateWindow(id: string): string | null {
  const p = get(currentProject);
  if (!p) return null;
  const floor = p.floors.find(f => f.id === p.activeFloorId);
  if (!floor) return null;
  const w = floor.windows.find(w => w.id === id);
  if (!w) return null;
  const newPos = Math.min(1, w.position + 0.1);
  const newId = uid();
  mutate(f => {
    f.windows.push({ ...w, id: newId, position: newPos });
  });
  return newId;
}

/** Duplicate furniture */
export function duplicateFurniture(id: string): string | null {
  const p = get(currentProject);
  if (!p) return null;
  const floor = p.floors.find(f => f.id === p.activeFloorId);
  if (!floor) return null;
  const fi = floor.furniture.find(fi => fi.id === id);
  if (!fi) return null;
  const newId = uid();
  mutate(f => {
    f.furniture.push({ ...fi, id: newId, position: { x: fi.position.x + 30, y: fi.position.y + 30 } });
  });
  return newId;
}

/** Move a wall parallel to itself (both endpoints shift by the same perpendicular offset) without undo snapshot (for dragging) */
export function moveWallParallel(id: string, dx: number, dy: number) {
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  if (!floor) return;
  const w = floor.walls.find((w) => w.id === id);
  if (w) {
    w.start = { x: w.start.x + dx, y: w.start.y + dy };
    w.end = { x: w.end.x + dx, y: w.end.y + dy };
    if (w.curvePoint) {
      w.curvePoint = { x: w.curvePoint.x + dx, y: w.curvePoint.y + dy };
    }
    p.updatedAt = new Date();
    currentProject.set({ ...p });
  }
}

/** Split a wall into two segments at a given parameter t (0-1) */
export function splitWall(id: string, t: number): string | null {
  const p = get(currentProject);
  if (!p) return null;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  if (!floor) return null;
  const w = floor.walls.find((w) => w.id === id);
  if (!w || w.curvePoint) return null; // don't split curved walls
  if (t <= 0.001 || t >= 0.999) return null; // prevent division by zero at extremes
  snapshot('Split wall');
  const midPt: Point = {
    x: w.start.x + (w.end.x - w.start.x) * t,
    y: w.start.y + (w.end.y - w.start.y) * t,
  };
  const newId = uid();
  // New wall from midpoint to original end
  floor.walls.push({ id: newId, start: { ...midPt }, end: { ...w.end }, thickness: w.thickness, height: w.height, color: w.color });
  // Shorten original wall to midpoint
  w.end = { ...midPt };
  // Move doors/windows on the original wall: adjust positions
  for (const d of floor.doors) {
    if (d.wallId === id) {
      if (d.position > t) {
        d.wallId = newId;
        d.position = (d.position - t) / (1 - t);
      } else {
        d.position = d.position / t;
      }
    }
  }
  for (const win of floor.windows) {
    if (win.wallId === id) {
      if (win.position > t) {
        win.wallId = newId;
        win.position = (win.position - t) / (1 - t);
      } else {
        win.position = win.position / t;
      }
    }
  }
  p.updatedAt = new Date();
  currentProject.set({ ...p });
  return newId;
}

/** Duplicate a wall */
export function duplicateWall(id: string): string | null {
  const p = get(currentProject);
  if (!p) return null;
  const floor = p.floors.find(f => f.id === p.activeFloorId);
  if (!floor) return null;
  const w = floor.walls.find(w => w.id === id);
  if (!w) return null;
  const newId = uid();
  mutate(f => {
    f.walls.push({ ...w, id: newId, start: { x: w.start.x + 30, y: w.start.y + 30 }, end: { x: w.end.x + 30, y: w.end.y + 30 } });
  });
  return newId;
}

// --- Guide Lines ---
export function addGuide(orientation: 'horizontal' | 'vertical', position: number): string {
  const id = uid();
  mutate(f => {
    if (!f.guides) f.guides = [];
    f.guides.push({ id, orientation, position });
  });
  return id;
}

export function moveGuide(id: string, position: number) {
  mutate(f => {
    if (!f.guides) return;
    const g = f.guides.find(g => g.id === id);
    if (g) g.position = position;
  });
}

export function removeGuide(id: string) {
  mutate(f => {
    if (!f.guides) return;
    f.guides = f.guides.filter(g => g.id !== id);
  });
}

// --- Measurements ---
export function addMeasurement(x1: number, y1: number, x2: number, y2: number): string {
  const id = uid();
  mutate(f => {
    if (!f.measurements) f.measurements = [];
    f.measurements.push({ id, x1, y1, x2, y2 });
  });
  return id;
}

export function removeMeasurement(id: string) {
  mutate(f => {
    if (!f.measurements) return;
    f.measurements = f.measurements.filter(m => m.id !== id);
  });
}

// --- Annotations ---
export function addAnnotation(x1: number, y1: number, x2: number, y2: number, offset = 40, label?: string): string {
  const id = uid();
  mutate(f => {
    if (!f.annotations) f.annotations = [];
    f.annotations.push({ id, x1, y1, x2, y2, offset, label });
  });
  return id;
}

export function removeAnnotation(id: string) {
  mutate(f => {
    if (!f.annotations) return;
    f.annotations = f.annotations.filter(a => a.id !== id);
  });
}

export function updateAnnotation(id: string, updates: Partial<{ x1: number; y1: number; x2: number; y2: number; offset: number; label: string }>) {
  mutate(f => {
    if (!f.annotations) return;
    const a = f.annotations.find(a => a.id === id);
    if (!a) return;
    Object.assign(a, updates);
  }, undefined, coalesceKeyFor('annotation', id, updates));
}

// --- Text Annotations ---
export function addTextAnnotation(x: number, y: number, text: string, fontSize = 16, color = '#1e293b', rotation = 0): string {
  const id = uid();
  mutate(f => {
    if (!f.textAnnotations) f.textAnnotations = [];
    f.textAnnotations.push({ id, x, y, text, fontSize, color, rotation });
  });
  return id;
}

export function removeTextAnnotation(id: string) {
  mutate(f => {
    if (!f.textAnnotations) return;
    f.textAnnotations = f.textAnnotations.filter(t => t.id !== id);
  });
}

export function updateTextAnnotation(id: string, updates: Partial<{ x: number; y: number; text: string; fontSize: number; color: string; rotation: number }>) {
  mutate(f => {
    if (!f.textAnnotations) return;
    const t = f.textAnnotations.find(t => t.id === id);
    if (!t) return;
    Object.assign(t, updates);
  }, undefined, coalesceKeyFor('textAnnotation', id, updates));
}

export function moveTextAnnotation(id: string, position: { x: number; y: number }) {
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find(f => f.id === p.activeFloorId);
  if (!floor?.textAnnotations) return;
  const t = floor.textAnnotations.find(t => t.id === id);
  if (!t) return;
  t.x = position.x;
  t.y = position.y;
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

// Layer visibility store (used by LayersPanel and FloorPlanCanvas)
export const layerVisibility = writable<{ walls: boolean; doors: boolean; windows: boolean; furniture: boolean; stairs: boolean; columns: boolean; guides: boolean; measurements: boolean; annotations: boolean; entourage: boolean }>({
  walls: true, doors: true, windows: true, furniture: true, stairs: true, columns: true, guides: true, measurements: true, annotations: true, entourage: true,
});

// --- Lock ---
export function toggleFurnitureLock(id: string) {
  mutate((f) => {
    const fi = f.furniture.find((fi) => fi.id === id);
    if (fi) fi.locked = !fi.locked;
  });
}

export function setFurnitureLocked(id: string, locked: boolean) {
  mutate((f) => {
    const fi = f.furniture.find((fi) => fi.id === id);
    if (fi) fi.locked = locked;
  });
}

// --- Element Groups ---
export function createGroup(elementIds: string[]): string | null {
  if (elementIds.length < 2) return null;
  const id = uid();
  mutate((f) => {
    if (!f.groups) f.groups = [];
    // Remove any existing group membership for these elements
    f.groups = f.groups.map(g => ({
      ...g,
      elementIds: g.elementIds.filter(eid => !elementIds.includes(eid))
    })).filter(g => g.elementIds.length >= 2);
    f.groups.push({ id, elementIds: [...elementIds] });
  });
  return id;
}

export function ungroup(groupId: string) {
  mutate((f) => {
    if (!f.groups) return;
    f.groups = f.groups.filter(g => g.id !== groupId);
  });
}

export function ungroupElements(elementIds: string[]) {
  mutate((f) => {
    if (!f.groups) return;
    f.groups = f.groups.filter(g => !g.elementIds.some(eid => elementIds.includes(eid)));
  });
}

export function findGroupForElement(floor: Floor, elementId: string): ElementGroup | undefined {
  if (!floor.groups) return undefined;
  return floor.groups.find(g => g.elementIds.includes(elementId));
}

/** Wall id whose face-on elevation editor is open (null = closed) */
export const elevationWallId = writable<string | null>(null);
/** Armed when Elevation is requested with no wall selected: the next wall
 *  clicked in the plan canvas opens its elevation; empty click / Esc cancels */
export const elevationPickMode = writable<boolean>(false);

// Zoom store for 2D canvas — shared between FloorPlanCanvas and the bottom bar
export const canvasZoom = writable<number>(1);
// Camera position stores for 2D canvas — used to compute viewport center
export const canvasCamX = writable<number>(0);
export const canvasCamY = writable<number>(0);

// --- Bottom bar display toggles ---------------------------------------------
// The bottom bar is shared by the 2D and 3D views, so the display state it
// drives lives here rather than inside FloorPlanCanvas. These four are
// plan-specific (the bar only shows them in 2D) but still need to be reachable
// from a component that sits outside the canvas.
export const showGrid = writable<boolean>(true);
export const showRulers = writable<boolean>(true);
export const showMinimap = writable<boolean>(true);
export const layerPanelOpen = writable<boolean>(false);

/** Incremented by the bottom bar's "Fit" button. Whichever view is mounted
 *  listens and fits its own camera: the 2D canvas zooms to the floor extents,
 *  the 3D viewer re-frames the model. */
export const fitViewRequest = writable<number>(0);

/** Ask the active view (2D canvas or 3D scene) to fit its content on screen. */
export function requestFitView() {
  fitViewRequest.update((n) => n + 1);
}

