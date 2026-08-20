/**
 * Test script: copy/paste of plan elements, including across floors (issue #22).
 * Run with: npx tsx test-clipboard.ts
 */
import {
  PASTE_OFFSET,
  copySelection, pasteOffset, planPaste, applyPaste,
  type Clipboard,
} from './src/lib/utils/clipboard.js';
import type { Floor } from './src/lib/models/types.js';

let passed = 0, failed = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  check(name, g === w, `got ${g}, want ${w}`);
}

// Deterministic ids, so a plan can be asserted against.
function ids(prefix: string) {
  let n = 0;
  return () => `${prefix}${++n}`;
}

// ── Fixtures ────────────────────────────────────────────────────────

/** Ground floor: a corner of two walls, a door and a window on them, plus a
 *  sofa, a table, stairs, a column, a label and a tree. */
function ground(): Floor {
  return {
    id: 'ground', name: 'Ground Floor', level: 0,
    walls: [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, thickness: 15, height: 280, color: '#444' },
      { id: 'w2', start: { x: 400, y: 0 }, end: { x: 400, y: 300 }, thickness: 15, height: 280, color: '#444' },
    ],
    rooms: [],
    doors: [{ id: 'd1', wallId: 'w1', position: 0.5, width: 90, height: 210, type: 'single', swingDirection: 'left', flipSide: false }],
    windows: [{ id: 'win1', wallId: 'w2', position: 0.5, width: 120, height: 140, sillHeight: 90, type: 'standard' }],
    furniture: [
      { id: 'fu1', catalogId: 'sofa', position: { x: 100, y: 100 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } },
      { id: 'fu2', catalogId: 'table', position: { x: 220, y: 160 }, rotation: 90, scale: { x: 1, y: 1, z: 1 }, locked: true },
    ],
    stairs: [{ id: 's1', position: { x: 50, y: 200 }, rotation: 0, width: 100, depth: 300, riserCount: 14, direction: 'up', stairType: 'straight' }],
    columns: [{ id: 'c1', position: { x: 300, y: 250 }, rotation: 0, shape: 'round', diameter: 30, height: 280, color: '#888' }],
    guides: [],
    measurements: [],
    annotations: [],
    textAnnotations: [{ id: 't1', x: 40, y: 60, text: 'Living', fontSize: 16, color: '#1e293b', rotation: 0 }],
    groups: [{ id: 'g1', elementIds: ['fu1', 'fu2'] }],
    entourage: [{ id: 'e1', defId: 'tree', position: { x: 500, y: 500 }, width: 120, rotation: 0 }],
  };
}

/** An empty upper floor. */
function upper(): Floor {
  return {
    id: 'first', name: 'Floor 1', level: 1,
    walls: [], rooms: [], doors: [], windows: [], furniture: [], stairs: [], columns: [],
    guides: [], measurements: [], annotations: [], textAnnotations: [], groups: [],
  };
}

/** An upper floor stacked from a copy of the ground floor: the same walls in
 *  the same places, but with ids of their own. */
function stackedUpper(): Floor {
  const f = upper();
  f.walls = [
    { id: 'uw1', start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, thickness: 15, height: 280, color: '#444' },
    { id: 'uw2', start: { x: 400, y: 0 }, end: { x: 400, y: 300 }, thickness: 15, height: 280, color: '#444' },
  ];
  return f;
}

function copyOf(floor: Floor, selection: string[]): Clipboard {
  const clip = copySelection(floor, selection);
  if (!clip) throw new Error(`nothing copied from ${selection.join(',')}`);
  return clip;
}

/** Paste onto `floor` the way the store does, and hand back the new ids. */
function paste(floor: Floor, clip: Clipboard, repeat = 0, newId = ids('n')) {
  const plan = planPaste(floor, clip, { offset: pasteOffset(clip, floor.id, repeat), newId });
  applyPaste(floor, plan);
  return plan;
}

// ── Copying ─────────────────────────────────────────────────────────

console.log('=== copying ===');
eq('an empty selection copies nothing', copySelection(ground(), []), null);
eq('a selection of things that cannot be copied yields nothing',
  copySelection(ground(), ['nope', 'also-nope']), null);
{
  const clip = copyOf(ground(), ['fu1', 'w1', 'd1', 's1', 'c1', 't1', 'e1', 'win1']);
  eq('every kind of element is copied', clip.entries.length, 8);
  eq('walls come first, so openings find their host', clip.entries[0].kind, 'wall');
  eq('the source floor is remembered', clip.sourceFloorId, 'ground');
  const door = clip.entries.find((e) => e.kind === 'door')!;
  eq('an opening carries a snapshot of its wall',
    (door as any).host, { id: 'w1', start: { x: 0, y: 0 }, end: { x: 400, y: 0 } });
}
{
  const f = ground();
  const clip = copyOf(f, ['fu1']);
  (clip.entries[0].data as any).position.x = -999;
  eq('the clipboard holds a copy, not a reference into the floor', f.furniture[0].position.x, 100);
}
{
  const clip = copyOf(ground(), ['fu2']);
  eq('a locked item copies, lock and all', (clip.entries[0].data as any).locked, true);
}
{
  const clip = copyOf(ground(), ['d1']);
  eq('an orphaned selection id is ignored', clip.entries.length, 1);
  const stray = copySelection({ ...ground(), doors: [{ id: 'dx', wallId: 'gone', position: 0.5, width: 90, height: 210, type: 'single', swingDirection: 'left', flipSide: false }] }, ['dx']);
  eq('a door whose wall is missing is not copied', stray, null);
}

console.log('\n=== groups ===');
{
  const clip = copyOf(ground(), ['fu1', 'fu2']);
  eq('a group copied whole is remembered', clip.groups, [['fu1', 'fu2']]);
}
{
  const clip = copyOf(ground(), ['fu1']);
  eq('half a group is not a group', clip.groups, []);
}
{
  const f = upper();
  const plan = paste(f, copyOf(ground(), ['fu1', 'fu2']));
  eq('the group re-forms around the copies', f.groups.map((g) => g.elementIds), [[plan.ids[0], plan.ids[1]]]);
  check('the re-formed group has an id of its own', f.groups[0].id !== 'g1', f.groups[0].id);
}

// ── Paste offsets ───────────────────────────────────────────────────

console.log('\n=== where a paste lands ===');
{
  const clip = copyOf(ground(), ['fu1']);
  eq('the first paste onto the source floor steps aside',
    pasteOffset(clip, 'ground', 0), { x: PASTE_OFFSET, y: PASTE_OFFSET });
  eq('the next one steps further', pasteOffset(clip, 'ground', 1), { x: 60, y: 60 });
  eq('the first paste onto another floor lands in place',
    pasteOffset(clip, 'first', 0), { x: 0, y: 0 });
  eq('a second paste there still cascades', pasteOffset(clip, 'first', 1), { x: PASTE_OFFSET, y: PASTE_OFFSET });
}
{
  const f = ground();
  paste(f, copyOf(f, ['fu1']));
  eq('same-floor paste is offset from the original',
    f.furniture[2].position, { x: 100 + PASTE_OFFSET, y: 100 + PASTE_OFFSET });
}
{
  const f = ground();
  const clip = copyOf(f, ['fu1']);
  paste(f, clip, 0);
  paste(f, clip, 1);
  eq('successive pastes cascade instead of piling up',
    [f.furniture[2].position.x, f.furniture[3].position.x], [130, 160]);
}
{
  const src = ground();
  const dst = upper();
  paste(dst, copyOf(src, ['fu1']));
  eq('a paste onto another floor keeps the original position', dst.furniture[0].position, { x: 100, y: 100 });
}
{
  const src = ground();
  const dst = upper();
  const plan = paste(dst, copyOf(src, ['fu1', 's1', 'c1', 't1', 'e1']), 1);
  const off = PASTE_OFFSET;
  eq('every kind of element moves by the same offset, so the shape survives',
    [dst.furniture[0].position, dst.stairs![0].position, dst.columns![0].position,
     { x: dst.textAnnotations[0].x, y: dst.textAnnotations[0].y }, dst.entourage![0].position],
    [{ x: 100 + off, y: 100 + off }, { x: 50 + off, y: 200 + off }, { x: 300 + off, y: 250 + off },
     { x: 40 + off, y: 60 + off }, { x: 500 + off, y: 500 + off }]);
  eq('the plan reports what it created', plan.ids.length, 5);
}

// ── Independence ────────────────────────────────────────────────────

console.log('\n=== the copy is independent ===');
{
  const src = ground();
  const dst = upper();
  paste(dst, copyOf(src, ['fu1']));
  const pasted = dst.furniture[0];
  check('the paste has an id of its own', pasted.id !== 'fu1', pasted.id);
  pasted.position.x = 1;
  pasted.scale.x = 3;
  pasted.color = '#ff0000';
  eq('editing the paste leaves the original alone',
    [src.furniture[0].position.x, src.furniture[0].scale.x, src.furniture[0].color], [100, 1, undefined]);
}
{
  // The clipboard survives its source being deleted — it is a copy by value.
  const src = ground();
  const clip = copyOf(src, ['fu1']);
  src.furniture = [];
  const dst = upper();
  paste(dst, clip);
  eq('a copy can still be pasted after the original is gone', dst.furniture[0].catalogId, 'sofa');
}
{
  const src = ground();
  const clip = copyOf(src, ['fu1']);
  const a = upper();
  const b = { ...upper(), id: 'second' };
  const gen = ids('n'); // one id source, as the store has
  paste(a, clip, 0, gen);
  paste(b, clip, 0, gen);
  a.furniture[0].position.x = -1;
  eq('two pastes of one clipboard share nothing', b.furniture[0].position.x, 100);
  check('two pastes get different ids', a.furniture[0].id !== b.furniture[0].id);
}

// ── Walls and openings ──────────────────────────────────────────────

console.log('\n=== walls ===');
{
  const src = ground();
  const dst = upper();
  paste(dst, copyOf(src, ['w1']));
  eq('a pasted wall keeps its geometry', [dst.walls[0].start, dst.walls[0].end],
    [{ x: 0, y: 0 }, { x: 400, y: 0 }]);
}
{
  const src = ground();
  src.walls[0].curvePoint = { x: 200, y: 60 };
  const f = ground();
  paste(f, copyOf(src, ['w1']));
  eq('the curve handle travels with the wall', f.walls[2].curvePoint, { x: 230, y: 90 });
}

console.log('\n=== openings ===');
{
  const src = ground();
  const dst = upper();
  const plan = paste(dst, copyOf(src, ['w1', 'd1']));
  eq('a door pasted with its wall hangs on the copy', dst.doors[0].wallId, dst.walls[0].id);
  eq('and keeps its place along it', dst.doors[0].position, 0.5);
  eq('nothing was skipped', plan.skipped, 0);
}
{
  const f = ground();
  paste(f, copyOf(f, ['d1']));
  // w1 runs east, so a (30, 30) offset slides the door 30cm along it.
  check('a door pasted alone onto its own floor slides along its wall',
    f.doors[1].wallId === 'w1' && Math.abs(f.doors[1].position - (0.5 + 30 / 400)) < 1e-6,
    `wall=${f.doors[1].wallId} pos=${f.doors[1].position}`);
}
{
  const dst = stackedUpper();
  const plan = paste(dst, copyOf(ground(), ['d1']));
  eq('a door pasted onto a floor stacked above rebinds to the wall standing there',
    [dst.doors[0].wallId, dst.doors[0].position], ['uw1', 0.5]);
  eq('and nothing is skipped', plan.skipped, 0);
}
{
  const dst = stackedUpper();
  // Drawn the other way round: the same wall, described from the far end.
  dst.walls[0] = { ...dst.walls[0], start: { x: 400, y: 0 }, end: { x: 0, y: 0 } };
  const src = ground();
  src.doors[0].position = 0.25;
  paste(dst, copyOf(src, ['d1']));
  check('a wall drawn the other way round still hosts it, measured from its own end',
    dst.doors[0].wallId === 'uw1' && Math.abs(dst.doors[0].position - 0.75) < 1e-6,
    `wall=${dst.doors[0].wallId} pos=${dst.doors[0].position}`);
}
{
  const dst = upper();
  const plan = paste(dst, copyOf(ground(), ['d1']));
  eq('a door with no wall to land on is skipped, not dropped into nowhere', plan.skipped, 1);
  eq('and nothing is created', [plan.ids.length, dst.doors.length], [0, 0]);
}
{
  const dst = upper();
  const plan = paste(dst, copyOf(ground(), ['fu1', 'd1']));
  eq('a skipped opening does not stop the rest of the paste', [plan.ids.length, plan.skipped], [1, 1]);
  eq('the furniture still landed', dst.furniture.length, 1);
}
{
  const src = ground();
  const dst = stackedUpper();
  paste(dst, copyOf(src, ['win1']));
  eq('a window rebinds the same way', dst.windows[0].wallId, 'uw2');
}
{
  // A door pushed off the end of its wall is clamped back onto it.
  const src = ground();
  src.doors[0].position = 0.88;
  const f = ground();
  f.doors[0].position = 0.88;
  paste(f, copyOf(src, ['d1']));
  const limit = 1 - 90 / 2 / 400;
  check('a paste cannot push an opening off the end of its wall',
    f.doors[1].position <= limit + 1e-6, `pos=${f.doors[1].position}`);
}

// ── Multi-select ────────────────────────────────────────────────────

console.log('\n=== multi-select ===');
{
  const src = ground();
  const dst = upper();
  paste(dst, copyOf(src, ['fu1', 'fu2']), 0);
  const [a, b] = dst.furniture;
  eq('relative positions between copied elements are preserved',
    { dx: b.position.x - a.position.x, dy: b.position.y - a.position.y },
    { dx: 220 - 100, dy: 160 - 100 });
}
{
  const f = ground();
  paste(f, copyOf(f, ['fu1', 'fu2']));
  const [a, b] = f.furniture.slice(2);
  eq('and on the same floor too, offset and all',
    [a.position, b.position], [{ x: 130, y: 130 }, { x: 250, y: 190 }]);
}
{
  const src = ground();
  const dst = stackedUpper();
  const plan = paste(dst, copyOf(src, ['w1', 'w2', 'd1', 'win1', 'fu1', 's1', 'c1', 't1', 'e1']));
  eq('a whole floor-worth of selection pastes in one go', plan.ids.length, 9);
  eq('the openings went onto the pasted walls, not the ones already there',
    [dst.doors[0].wallId, dst.windows[0].wallId], [dst.walls[2].id, dst.walls[3].id]);
}

// ── Applying ────────────────────────────────────────────────────────

console.log('\n=== applying a plan ===');
{
  const dst = upper();
  const plan = planPaste(dst, copyOf(ground(), ['fu1']), { newId: ids('x') });
  eq('planning does not touch the floor', dst.furniture.length, 0);
  applyPaste(dst, plan);
  eq('applying does', dst.furniture.length, 1);
}
{
  // Optional collections start out undefined on a floor loaded from an older
  // save — the paste has to create them rather than throw.
  const bare = { ...upper() } as any;
  delete bare.stairs; delete bare.columns; delete bare.entourage; delete bare.textAnnotations; delete bare.groups;
  const plan = paste(bare as Floor, copyOf(ground(), ['s1', 'c1', 't1', 'e1', 'fu1', 'fu2']));
  eq('a floor missing its optional collections still takes a paste',
    [bare.stairs.length, bare.columns.length, bare.entourage.length, bare.textAnnotations.length, bare.groups.length],
    [1, 1, 1, 1, 1]);
  eq('and reports everything it created', plan.ids.length, 6);
}

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : '❌ FAILURES'} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
