/**
 * Test script: arrow-key nudging (issue #21).
 * Run with: npx tsx test-nudge.ts
 */
import {
  NUDGE_STEP, NUDGE_STEP_COARSE, NUDGE_STEP_FINE,
  nudgeDirection, nudgeStep, nudgeDelta,
  computeNudge, applyNudge,
} from './src/lib/utils/nudge.js';
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

const key = (k: string, mods: Partial<Record<'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey', boolean>> = {}) =>
  ({ key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods }) as KeyboardEvent;

console.log('=== key mapping ===');
eq('ArrowUp is a nudge', nudgeDirection(key('ArrowUp')), 'up');
eq('ArrowDown is a nudge', nudgeDirection(key('ArrowDown')), 'down');
eq('ArrowLeft is a nudge', nudgeDirection(key('ArrowLeft')), 'left');
eq('ArrowRight is a nudge', nudgeDirection(key('ArrowRight')), 'right');
eq('a letter is not', nudgeDirection(key('r')), null);
eq('Ctrl+arrow is left to the browser', nudgeDirection(key('ArrowUp', { ctrlKey: true })), null);
eq('Cmd+arrow is left to the OS', nudgeDirection(key('ArrowUp', { metaKey: true })), null);
eq('plain step', nudgeStep(key('ArrowUp')), NUDGE_STEP);
eq('Shift strides', nudgeStep(key('ArrowUp', { shiftKey: true })), NUDGE_STEP_COARSE);
eq('Alt trims', nudgeStep(key('ArrowUp', { altKey: true })), NUDGE_STEP_FINE);

console.log('\n=== plan axes (2D) ===');
eq('up is -y (plan y grows downwards)', nudgeDelta('up', 1), { x: 0, y: -1 });
eq('down is +y', nudgeDelta('down', 1), { x: 0, y: 1 });
eq('left is -x', nudgeDelta('left', 10), { x: -10, y: 0 });
eq('right is +x', nudgeDelta('right', 10), { x: 10, y: 0 });

// ── Floor fixture ───────────────────────────────────────────────────
function fixture(): Floor {
  return {
    id: 'f1', name: 'Ground', level: 0,
    walls: [
      // A square room: w1 runs east along the top, w2 south down the right.
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, thickness: 15, height: 280, color: '#444' },
      { id: 'w2', start: { x: 400, y: 0 }, end: { x: 400, y: 300 }, thickness: 15, height: 280, color: '#444' },
    ],
    rooms: [],
    doors: [{ id: 'd1', wallId: 'w1', position: 0.5, width: 90, height: 210, type: 'single', swingDirection: 'left', flipSide: false }],
    windows: [{ id: 'win1', wallId: 'w2', position: 0.5, width: 120, height: 140, sillHeight: 90, type: 'standard' }],
    furniture: [
      { id: 'fu1', catalogId: 'sofa', position: { x: 100, y: 100 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } },
      { id: 'fu2', catalogId: 'table', position: { x: 200, y: 100 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, locked: true },
    ],
    stairs: [{ id: 's1', position: { x: 50, y: 200 }, rotation: 0, width: 100, depth: 300, riserCount: 14, direction: 'up', stairType: 'straight' }],
    columns: [{ id: 'c1', position: { x: 300, y: 200 }, rotation: 0, shape: 'round', diameter: 30, height: 280, color: '#ccc' }],
    guides: [], measurements: [], annotations: [],
    textAnnotations: [{ id: 't1', x: 10, y: 20, text: 'hi', fontSize: 14, color: '#000', rotation: 0 }],
    groups: [],
    entourage: [{ id: 'e1', defId: 'tree', position: { x: 500, y: 500 }, width: 200, rotation: 0 }],
  };
}

function nudged(floor: Floor, ids: string[], dx: number, dy: number): number {
  const moves = computeNudge(floor, ids, dx, dy);
  applyNudge(floor, moves);
  return moves.count;
}

console.log('\n=== moving elements ===');
{
  const f = fixture();
  const n = nudged(f, ['fu1'], 0, -1);
  check('furniture moves by exactly one step', n === 1 && f.furniture[0].position.y === 99,
    `count=${n} y=${f.furniture[0].position.y}`);
}
{
  const f = fixture();
  const n = nudged(f, ['fu2'], 1, 0);
  check('a locked item ignores the nudge', n === 0 && f.furniture[1].position.x === 200,
    `count=${n} x=${f.furniture[1].position.x}`);
}
{
  const f = fixture();
  const n = nudged(f, ['fu1', 's1', 'c1', 't1', 'e1'], 10, 0);
  check('stairs, columns, text and entourage all move', n === 5
    && f.stairs![0].position.x === 60 && f.columns![0].position.x === 310
    && f.textAnnotations![0].x === 20 && f.entourage![0].position.x === 510, `count=${n}`);
}
{
  const f = fixture();
  const n = nudged(f, ['nope'], 1, 0);
  check('an unknown id moves nothing', n === 0);
}
{
  const f = fixture();
  const n = nudged(f, ['fu1'], 0, 0);
  check('a zero delta moves nothing', n === 0);
}
{
  // 0.1cm steps must not drift: ten of them make exactly one centimetre.
  const f = fixture();
  for (let i = 0; i < 10; i++) nudged(f, ['fu1'], NUDGE_STEP_FINE, 0);
  eq('ten fine steps land exactly one centimetre on', f.furniture[0].position.x, 101);
}

console.log('\n=== walls ===');
{
  const f = fixture();
  const n = nudged(f, ['w1'], 0, -1);
  const w1 = f.walls[0], w2 = f.walls[1];
  check('the selected wall moves whole', n === 1 && w1.start.y === -1 && w1.end.y === -1,
    `${JSON.stringify(w1.start)} ${JSON.stringify(w1.end)}`);
  check('the neighbour it shares a corner with stretches to follow',
    w2.start.y === -1 && w2.end.y === 300, `${JSON.stringify(w2.start)} ${JSON.stringify(w2.end)}`);
}
{
  const f = fixture();
  nudged(f, ['w1', 'w2'], 5, 0);
  check('two selected walls move together, without double-shifting the shared corner',
    f.walls[0].end.x === 405 && f.walls[1].start.x === 405 && f.walls[1].end.x === 405,
    `${JSON.stringify(f.walls[1])}`);
}
{
  const f = fixture();
  f.walls[0].curvePoint = { x: 200, y: 60 };
  nudged(f, ['w1'], 0, -10);
  eq('a curved wall carries its control point along', f.walls[0].curvePoint, { x: 200, y: 50 });
}

console.log('\n=== openings stay on their wall ===');
{
  const f = fixture();
  // w1 runs along +x for 400cm, so 10cm along it is 0.025 of its length.
  const n = nudged(f, ['d1'], 10, 0);
  check('a door slides along its wall', n === 1 && Math.abs(f.doors[0].position - 0.525) < 1e-6,
    `count=${n} pos=${f.doors[0].position}`);
}
{
  const f = fixture();
  const n = nudged(f, ['d1'], 0, -10);
  check('a nudge across the wall does nothing (and no undo entry)', n === 0 && f.doors[0].position === 0.5,
    `count=${n} pos=${f.doors[0].position}`);
}
{
  const f = fixture();
  // A 90cm door on a 400cm wall can reach 0.7875 before it hangs over the end.
  for (let i = 0; i < 100; i++) nudged(f, ['d1'], 10, 0);
  const limit = 1 - 90 / 2 / 400;
  check('a door cannot be pushed off the end of its wall', f.doors[0].position <= limit + 1e-6,
    `pos=${f.doors[0].position} limit=${limit}`);
}
{
  const f = fixture();
  const n = nudged(f, ['win1'], 0, 10); // w2 runs along +y
  check('a window slides along a vertical wall', n === 1 && Math.abs(f.windows[0].position - (0.5 + 10 / 300)) < 1e-6,
    `count=${n} pos=${f.windows[0].position}`);
}
{
  const f = fixture();
  const n = nudged(f, ['w1', 'd1'], 0, -1);
  check('a door on a wall that is itself moving is not slid as well',
    n === 1 && f.doors[0].position === 0.5, `count=${n} pos=${f.doors[0].position}`);
}

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : '❌ FAILURES'} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
