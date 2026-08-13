/**
 * Test script: the placing system never leaves the canvas stuck mid-drag, and a
 * drag costs exactly one undo entry however it ends (issue #19).
 *
 * The reported failure was a repositioning gesture that could not be released:
 * the drag flags stayed set, the draw loop re-rendered every frame forever, and
 * per-move mutators kept stringifying the whole project onto the undo stack
 * until the app had to be force-quit.
 *
 * Part 1 drives the controller (src/lib/utils/placement.ts) through every exit
 * path with a fake undo backend, checking the state-machine invariants.
 * Part 2 wires it to the real project store and checks the document-level
 * consequences: one undo entry per drag, none for a click, and an exact
 * rollback when a drag is cancelled.
 *
 * Run with: npx tsx test-placing-system.ts
 */
import {
  createPlacementController,
  placementHint,
  DRAG_THRESHOLD_PX,
  type PlacementKind,
  type PlacementEndReason,
  type PlacementSession,
} from './src/lib/utils/placement.js';
import {
  currentProject,
  createDefaultProject,
  activeFloor,
  beginUndoGroup,
  endUndoGroup,
  cancelUndoGroup,
  isUndoGroupOpen,
  moveFurniture,
  setFurnitureRotation,
  undo,
  undoHistoryStore,
} from './src/lib/stores/project.js';
import type { FurnitureItem } from './src/lib/models/types.js';
import { get } from 'svelte/store';

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
}
function section(title: string) {
  console.log(`\n${title}`);
}

// ── Part 1: the controller ────────────────────────────────────────────

/** Fake undo backend that mirrors the store's group semantics, plus a drag-flag
 *  stand-in so we can assert nothing is left set after a gesture ends. */
function harness() {
  const log: string[] = [];
  const state = {
    depth: 0,
    entries: [] as string[],
    rollbacks: 0,
    flagsSet: false,
    teardowns: [] as { kind: PlacementKind; reason: PlacementEndReason }[],
  };
  const controller = createPlacementController({
    beginUndo: () => {
      state.depth++;
      log.push('begin');
    },
    commitUndo: (label) => {
      state.depth--;
      state.entries.push(label);
      log.push(`commit:${label}`);
    },
    rollbackUndo: () => {
      state.depth--;
      state.rollbacks++;
      log.push('rollback');
    },
    teardown: (session, reason) => {
      state.teardowns.push({ kind: session.kind, reason });
      state.flagsSet = false;
      log.push(`teardown:${session.kind}:${reason}`);
    },
  });
  /** Stand-in for "onPointerDown set draggingFurnitureId". */
  function press(kind: PlacementKind, x = 0, y = 0) {
    state.flagsSet = true;
    return controller.begin(kind, { pointerId: 1, x, y });
  }
  return { controller, state, log, press };
}

section('1. One gesture at a time');
{
  const h = harness();
  h.press('furniture', 0, 0);
  check('a press starts a session', h.controller.isActive('furniture'));
  h.press('wall-endpoint', 0, 0);
  check('a second press supersedes the first', h.controller.isActive('wall-endpoint'));
  check(
    'the superseded gesture was torn down',
    h.state.teardowns.length === 1 && h.state.teardowns[0].reason === 'superseded',
    JSON.stringify(h.state.teardowns)
  );
  h.controller.end('commit');
  check('no session survives', !h.controller.isActive());
  check('no drag flags survive', !h.state.flagsSet);
}

section('2. Every exit path ends the gesture and balances the undo group');
{
  const reasons: PlacementEndReason[] = ['commit', 'cancel', 'lost', 'superseded'];
  for (const reason of reasons) {
    const h = harness();
    h.press('furniture', 100, 100);
    h.controller.moveTo(140, 140); // engage: opens the undo group
    check(`${reason}: group open while dragging`, h.state.depth === 1);
    h.controller.end(reason);
    check(`${reason}: session cleared`, !h.controller.isActive());
    check(`${reason}: drag flags cleared`, !h.state.flagsSet);
    check(`${reason}: undo group closed`, h.state.depth === 0, `depth=${h.state.depth}`);
    check(
      `${reason}: ${reason === 'cancel' ? 'rolled back' : 'one undo entry'}`,
      reason === 'cancel'
        ? h.state.rollbacks === 1 && h.state.entries.length === 0
        : h.state.rollbacks === 0 && h.state.entries.length === 1,
      JSON.stringify(h.state)
    );
  }
}

section('3. Ending is idempotent and re-entrancy safe');
{
  const h = harness();
  h.press('stair', 0, 0);
  h.controller.moveTo(50, 50);
  h.controller.end('commit');
  h.controller.end('commit');
  h.controller.end('lost');
  check('teardown ran exactly once', h.state.teardowns.length === 1, `${h.state.teardowns.length}`);
  check('exactly one undo entry', h.state.entries.length === 1, JSON.stringify(h.state.entries));
  check('end() on an idle controller is a no-op', h.controller.end('commit') === null);
}
{
  // A store write inside teardown can land in a handler that ends the gesture
  // again. That must not close the undo group twice.
  let reentered = 0;
  const state = { depth: 0, entries: 0 };
  const controller = createPlacementController({
    beginUndo: () => { state.depth++; },
    commitUndo: () => { state.depth--; state.entries++; },
    rollbackUndo: () => { state.depth--; },
    teardown: () => {
      reentered++;
      controller.end('lost'); // re-entrant call
    },
  });
  controller.begin('room', { pointerId: 1, x: 0, y: 0 });
  controller.moveTo(80, 0);
  controller.end('commit');
  check('re-entrant end() from teardown does not recurse', reentered === 1, `${reentered}`);
  check('undo group closed exactly once', state.depth === 0 && state.entries === 1, JSON.stringify(state));
}

section('4. A click is not a drag');
{
  const h = harness();
  h.press('furniture', 200, 200);
  const engagedInside = h.controller.moveTo(200 + DRAG_THRESHOLD_PX / 2, 200);
  check('sub-threshold movement does not engage', !engagedInside);
  check('…and opens no undo group', h.state.depth === 0);
  h.controller.end('commit');
  check('a click leaves no undo entry', h.state.entries.length === 0, JSON.stringify(h.state.entries));
  check('a click still tears down cleanly', !h.state.flagsSet && !h.controller.isActive());

  const h2 = harness();
  h2.press('furniture', 200, 200);
  check('past-threshold movement engages', h2.controller.moveTo(200 + DRAG_THRESHOLD_PX + 1, 200));
  check('…exactly once, no matter how many moves', (() => {
    for (let i = 0; i < 50; i++) h2.controller.moveTo(300 + i, 200);
    return h2.state.depth === 1;
  })(), `depth=${h2.state.depth}`);
  h2.controller.end('commit');
  check('a real drag leaves exactly one undo entry', h2.state.entries.length === 1);
}

section('5. Non-mutating gestures never touch the undo stack');
{
  for (const kind of ['pan', 'marquee'] as PlacementKind[]) {
    const h = harness();
    h.press(kind, 0, 0);
    h.controller.moveTo(400, 400);
    h.controller.end('commit');
    check(`${kind}: no undo group opened`, h.state.depth === 0 && h.state.entries.length === 0);
    check(`${kind}: still torn down`, h.state.teardowns.length === 1 && !h.state.flagsSet);
  }
}

section('6. Torture: random gestures always settle');
{
  const kinds: PlacementKind[] = [
    'furniture', 'door', 'window', 'stair', 'column', 'text', 'room', 'room-label',
    'wall-endpoint', 'wall-parallel', 'wall-curve', 'multi', 'guide', 'entourage',
    'entourage-resize', 'handle', 'pan', 'marquee',
  ];
  const reasons: PlacementEndReason[] = ['commit', 'cancel', 'lost', 'superseded'];
  const h = harness();
  // Deterministic pseudo-random walk over press / move / end, including the
  // orderings a real user hits by accident: press-press, end-end, move-after-end.
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let maxDepth = 0;
  for (let i = 0; i < 20000; i++) {
    const roll = rand();
    if (roll < 0.35) h.press(kinds[Math.floor(rand() * kinds.length)], rand() * 500, rand() * 500);
    else if (roll < 0.75) h.controller.moveTo(rand() * 500, rand() * 500);
    else h.controller.end(reasons[Math.floor(rand() * reasons.length)]);
    maxDepth = Math.max(maxDepth, h.state.depth);
    if (h.state.depth < 0 || h.state.depth > 1) break;
  }
  check('undo depth never left the 0..1 range', maxDepth <= 1 && h.state.depth >= 0, `max=${maxDepth}`);
  h.controller.end('commit');
  check('everything settles: no session', !h.controller.isActive());
  check('everything settles: no drag flags', !h.state.flagsSet);
  check('everything settles: no open undo group', h.state.depth === 0, `depth=${h.state.depth}`);
  check('every kind has a hint string', kinds.every(k => placementHint(k).length > 0));
}

// ── Part 2: against the real project store ───────────────────────────

/** A project with one piece of furniture to drag around. */
function seedProject(): FurnitureItem {
  const project = createDefaultProject('drag test');
  const item: FurnitureItem = {
    id: 'fi-1',
    catalogId: 'sofa',
    position: { x: 100, y: 100 },
    rotation: 0,
    scale: { x: 1, y: 1, z: 1 },
  };
  project.floors[0].furniture.push(item);
  currentProject.set(project);
  return item;
}

function undoEntryCount(): number {
  return get(undoHistoryStore).entries.length;
}

function furniturePos() {
  const f = get(activeFloor);
  const item = f?.furniture.find(i => i.id === 'fi-1');
  return item ? { ...item.position } : null;
}

/** Replays what FloorPlanCanvas does for a furniture drag, through the same
 *  controller wiring, so the store-level accounting is exercised end to end. */
function canvasController() {
  let dragging: string | null = null;
  const controller = createPlacementController({
    beginUndo: () => beginUndoGroup(),
    commitUndo: (label) => endUndoGroup(label),
    rollbackUndo: () => cancelUndoGroup(),
    teardown: () => { dragging = null; },
  });
  return {
    controller,
    isDragging: () => dragging !== null,
    press(id: string, x: number, y: number) {
      dragging = id;
      controller.begin('furniture', { pointerId: 1, x, y });
    },
    move(x: number, y: number) {
      if (!controller.moveTo(x, y)) return;
      if (dragging) {
        moveFurniture(dragging, { x, y });
        // The wall-snap path also rewrites rotation on every move — the call
        // that used to snapshot the whole project per pointer move.
        setFurnitureRotation(dragging, (x % 360 + 360) % 360);
      }
    },
  };
}

section('7. A drag costs one undo entry, and undo puts it back');
{
  seedProject();
  const before = undoEntryCount();
  const c = canvasController();
  c.press('fi-1', 100, 100);
  for (let x = 110; x <= 400; x += 5) c.move(x, 100);
  c.controller.end('commit');
  check('item moved', JSON.stringify(furniturePos()) === JSON.stringify({ x: 400, y: 100 }), JSON.stringify(furniturePos()));
  check('exactly one undo entry for ~60 moves', undoEntryCount() === before + 1, `${undoEntryCount() - before}`);
  check('no undo group left open', !isUndoGroupOpen());
  undo();
  check('one undo restores the pre-drag position', JSON.stringify(furniturePos()) === JSON.stringify({ x: 100, y: 100 }), JSON.stringify(furniturePos()));
}

section('8. A click on an item records nothing');
{
  seedProject();
  const before = undoEntryCount();
  const c = canvasController();
  c.press('fi-1', 100, 100);
  c.move(100, 100);          // no movement at all
  c.move(101, 100);          // sub-threshold jitter
  c.controller.end('commit');
  check('no undo entry', undoEntryCount() === before, `${undoEntryCount() - before}`);
  check('item did not move', JSON.stringify(furniturePos()) === JSON.stringify({ x: 100, y: 100 }));
  check('drag released', !c.isDragging() && !c.controller.isActive());
}

section('9. Escape rolls the document back to the pre-drag state');
{
  seedProject();
  const before = undoEntryCount();
  const c = canvasController();
  c.press('fi-1', 100, 100);
  for (let x = 110; x <= 300; x += 10) c.move(x, 250);
  check('mid-drag the item has moved', JSON.stringify(furniturePos()) !== JSON.stringify({ x: 100, y: 100 }));
  c.controller.end('cancel');
  check('position restored exactly', JSON.stringify(furniturePos()) === JSON.stringify({ x: 100, y: 100 }), JSON.stringify(furniturePos()));
  check('rotation restored too', get(activeFloor)?.furniture[0].rotation === 0);
  check('no undo entry added', undoEntryCount() === before, `${undoEntryCount() - before}`);
  check('no undo group left open', !isUndoGroupOpen());
  check('drag released', !c.isDragging());
}

section('10. A release that never arrives (issue #19) still ends the drag');
{
  seedProject();
  const before = undoEntryCount();
  const c = canvasController();
  c.press('fi-1', 100, 100);
  for (let x = 110; x <= 200; x += 10) c.move(x, 100);
  // The pointer went up over the sidebar / outside the window: no pointerup on
  // the canvas. The window failsafe (or the next no-buttons move) ends it.
  c.controller.end('lost');
  check('drag flags cleared', !c.isDragging(), 'the canvas would still be dragging');
  check('no session left', !c.controller.isActive());
  check('no undo group left open', !isUndoGroupOpen(), 'every later edit would be swallowed by the open group');
  check('the work done so far is kept, as one entry', undoEntryCount() === before + 1, `${undoEntryCount() - before}`);
  // And the editor is usable again: a further move must not drag anything.
  const posAfter = furniturePos();
  c.move(999, 999);
  check('a later move no longer drags the item', JSON.stringify(furniturePos()) === JSON.stringify(posAfter), JSON.stringify(furniturePos()));
  undo();
  check('undo still restores the pre-drag position', JSON.stringify(furniturePos()) === JSON.stringify({ x: 100, y: 100 }), JSON.stringify(furniturePos()));
}

section('11. Per-move mutators do not grow the undo stack');
{
  // Even with no group open (a mutator called from outside a gesture), the
  // coalescing keys keep a stream of identical edits to one entry instead of
  // one full project snapshot per pointer move.
  seedProject();
  const before = undoEntryCount();
  for (let i = 0; i < 500; i++) setFurnitureRotation('fi-1', i % 360);
  const added = undoEntryCount() - before;
  check('500 rotation writes → 1 undo entry', added === 1, `${added}`);
}

console.log(
  failures === 0
    ? '\n✅ PASS — gestures always settle, and a drag costs exactly one undo entry'
    : `\n❌ FAIL — ${failures} check(s) failed`
);
process.exit(failures === 0 ? 0 : 1);
