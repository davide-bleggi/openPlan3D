/**
 * Placing system — the single owner of "an interaction is in progress" on the
 * 2D floor plan canvas (issue #19).
 *
 * Before this module existed, every kind of drag (furniture, wall endpoints,
 * doors, rooms, resize handles, …) was tracked by its own `dragging*` variable
 * in FloorPlanCanvas, and the only thing that ever reset them was a `mouseup`
 * listener bound to the canvas element. Release the button anywhere else — over
 * the sidebar, outside the window, after an alt-tab, on a pointer cancel — and
 * every one of those flags stayed set. The consequences compounded:
 *
 *   - the next pointer move kept dragging the element with no button held, and
 *     there was no gesture that could clear the state (Escape didn't either);
 *   - the draw loop marks itself dirty for as long as any drag flag is set, so
 *     it re-rendered the whole plan (plus room detection) every frame forever;
 *   - some per-move mutators snapshot the entire project for undo, so each
 *     frame also stringified the document and pushed it onto the undo stack.
 *
 * That is the runaway resource usage in the report, and force-quitting was the
 * only way out. This controller makes it structurally impossible:
 *
 *   - exactly one session can be active, and starting a new one always ends the
 *     previous one first;
 *   - ending is idempotent and always runs the same teardown, whichever of the
 *     many exits triggered it (pointerup, pointercancel, lost capture, Escape,
 *     window blur, tab hidden, or a move that arrives with no buttons held);
 *   - a mutating session opens at most one undo group, and that group is always
 *     closed by the same teardown — committed on success, rolled back on cancel.
 *
 * The controller is deliberately DOM-free so the invariants above can be tested
 * directly (see test-placing-system.ts).
 */

/** Every interaction the canvas can be in the middle of. */
export type PlacementKind =
  | 'pan'
  | 'marquee'
  | 'guide'
  | 'furniture'
  | 'entourage'
  | 'entourage-resize'
  | 'handle'
  | 'door'
  | 'window'
  | 'stair'
  | 'column'
  | 'text'
  | 'room'
  | 'room-label'
  | 'wall-endpoint'
  | 'wall-parallel'
  | 'wall-curve'
  | 'multi';

/**
 * Why a session ended.
 *  - `commit`     — the pointer was released normally.
 *  - `cancel`     — the user backed out (Escape); mutations are rolled back.
 *  - `lost`       — the release was never delivered (capture lost, window blur,
 *                   tab hidden, a move with no buttons held). The edits the user
 *                   already made are kept, and stay undoable.
 *  - `superseded` — a new session started while this one was still open.
 */
export type PlacementEndReason = 'commit' | 'cancel' | 'lost' | 'superseded';

export interface PlacementSession {
  readonly kind: PlacementKind;
  /** Pointer that owns the gesture, or null for synthetic (touch shim) input. */
  readonly pointerId: number | null;
  /** Screen-space origin of the gesture, used for the movement threshold. */
  readonly originX: number;
  readonly originY: number;
  readonly startedAt: number;
  /** True once the pointer travelled far enough to count as a drag. */
  engaged: boolean;
  /** True once an undo group was opened for this session. */
  grouped: boolean;
}

interface KindMeta {
  /** Undo entry label. */
  label: string;
  /** Whether the session edits the document (and therefore needs an undo group). */
  mutates: boolean;
  /** Human-readable name for the on-canvas hint. */
  hint: string;
}

const KIND_META: Record<PlacementKind, KindMeta> = {
  pan:                { label: '',                      mutates: false, hint: 'Panning' },
  marquee:            { label: '',                      mutates: false, hint: 'Selecting' },
  guide:              { label: 'Moved guide',           mutates: true,  hint: 'Moving guide' },
  furniture:          { label: 'Moved furniture',       mutates: true,  hint: 'Moving furniture' },
  entourage:          { label: 'Moved entourage',       mutates: true,  hint: 'Moving symbol' },
  'entourage-resize': { label: 'Resized entourage',     mutates: true,  hint: 'Resizing symbol' },
  handle:             { label: 'Resized furniture',     mutates: true,  hint: 'Resizing' },
  door:               { label: 'Moved door',            mutates: true,  hint: 'Moving door' },
  window:             { label: 'Moved window',          mutates: true,  hint: 'Moving window' },
  stair:              { label: 'Moved stair',           mutates: true,  hint: 'Moving stair' },
  column:             { label: 'Moved column',          mutates: true,  hint: 'Moving column' },
  text:               { label: 'Moved text',            mutates: true,  hint: 'Moving text' },
  room:               { label: 'Moved room',            mutates: true,  hint: 'Moving room' },
  'room-label':       { label: 'Moved room label',      mutates: true,  hint: 'Moving label' },
  'wall-endpoint':    { label: 'Moved wall endpoint',   mutates: true,  hint: 'Moving corner' },
  'wall-parallel':    { label: 'Moved wall',            mutates: true,  hint: 'Moving wall' },
  'wall-curve':       { label: 'Curved wall',           mutates: true,  hint: 'Curving wall' },
  multi:              { label: 'Moved selection',       mutates: true,  hint: 'Moving selection' },
};

export function placementHint(kind: PlacementKind): string {
  return KIND_META[kind].hint;
}

/** Screen-space travel (px) before a press counts as a drag rather than a click. */
export const DRAG_THRESHOLD_PX = 2;

export interface PlacementHooks {
  /** Open an undo group covering the whole gesture. */
  beginUndo(): void;
  /** Close the undo group, recording one entry with `label`. */
  commitUndo(label: string): void;
  /** Close the undo group and restore the state captured when it opened. */
  rollbackUndo(): void;
  /**
   * Release pointer capture, clear the per-kind drag variables, and run any
   * end-of-gesture bookkeeping. Called exactly once per session, after the undo
   * group has been resolved. Must not throw and must not start a new session.
   */
  teardown(session: PlacementSession, reason: PlacementEndReason): void;
  /** Injectable clock, for tests. */
  now?(): number;
}

export interface PlacementController {
  /** The session in progress, or null. */
  readonly session: PlacementSession | null;
  readonly kind: PlacementKind | null;
  /** True when a gesture is in progress (whether or not it passed the threshold). */
  isActive(kind?: PlacementKind): boolean;
  /** True when a gesture is in progress *and* has moved past the drag threshold. */
  isEngaged(): boolean;
  /** Start a gesture. Any session already open is ended as `superseded` first. */
  begin(kind: PlacementKind, opts?: { pointerId?: number | null; x?: number; y?: number }): PlacementSession;
  /**
   * Report pointer movement in screen coordinates. Returns true once the
   * gesture has passed the drag threshold — the caller should only apply
   * document edits from that point on, so a plain click never records one.
   */
  moveTo(x: number, y: number): boolean;
  /** End the gesture. No-op when nothing is in progress. Returns the session that ended. */
  end(reason: PlacementEndReason): PlacementSession | null;
}

export function createPlacementController(hooks: PlacementHooks): PlacementController {
  const now = hooks.now ?? (() => Date.now());
  let session: PlacementSession | null = null;
  // Guards against re-entrancy: teardown (or an undo hook) may synchronously
  // trigger another end() — for example a store write that lands in a handler
  // which also tries to end the gesture. Without this, teardown could run twice
  // or an undo group could be closed twice.
  let ending = false;

  function end(reason: PlacementEndReason): PlacementSession | null {
    if (!session || ending) return null;
    ending = true;
    const ended = session;
    session = null;
    try {
      if (ended.grouped) {
        if (reason === 'cancel') hooks.rollbackUndo();
        else hooks.commitUndo(KIND_META[ended.kind].label);
        ended.grouped = false;
      }
      hooks.teardown(ended, reason);
    } finally {
      ending = false;
    }
    return ended;
  }

  return {
    get session() {
      return session;
    },
    get kind() {
      return session?.kind ?? null;
    },
    isActive(kind?: PlacementKind) {
      return session !== null && (kind === undefined || session.kind === kind);
    },
    isEngaged() {
      return session !== null && session.engaged;
    },
    begin(kind, opts) {
      // Starting a gesture while one is open means we missed a release. Close
      // the old one properly rather than leaking its flags and undo group.
      if (session) end('superseded');
      session = {
        kind,
        pointerId: opts?.pointerId ?? null,
        originX: opts?.x ?? 0,
        originY: opts?.y ?? 0,
        startedAt: now(),
        engaged: false,
        grouped: false,
      };
      return session;
    },
    moveTo(x, y) {
      if (!session) return false;
      if (!session.engaged) {
        if (Math.hypot(x - session.originX, y - session.originY) < DRAG_THRESHOLD_PX) return false;
        session.engaged = true;
        if (KIND_META[session.kind].mutates) {
          hooks.beginUndo();
          session.grouped = true;
        }
      }
      return true;
    },
    end,
  };
}
