/**
 * Test script: verify wall corner joins — the mitered cuts and end caps that
 * make two walls meet cleanly, and what happens at a corner where one of the
 * two walls is hidden (invisible walls carry no volume, so there is nothing
 * there for the neighbour to miter into).
 * Run with: npx tsx test-wall-joins.ts
 */
import {
  computeWallJoins,
  WALL_THICKNESS,
  type WallJoin
} from './src/lib/utils/wallJoins.js';
import type { Wall } from './src/lib/models/types.js';

const EPS = 1e-6;
let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function makeWall(overrides: Partial<Wall> & { id: string }): Wall {
  return {
    start: { x: 0, y: 0 },
    end: { x: 400, y: 0 },
    thickness: 20,
    height: 260,
    color: '#cccccc',
    ...overrides
  } as Wall;
}

/** An end is "square" when both sides are cut at the same place along the wall. */
const isSquare = (join: WallJoin, which: 'start' | 'end') =>
  Math.abs(join[which].uPos - join[which].uNeg) < EPS;

const isMitered = (join: WallJoin, which: 'start' | 'end') => !isSquare(join, which);

// Two walls meeting at a right angle: A runs east, B runs north from A's end.
const cornerA = makeWall({ id: 'A', start: { x: 0, y: 0 }, end: { x: 400, y: 0 } });
const cornerB = makeWall({ id: 'B', start: { x: 400, y: 0 }, end: { x: 400, y: 300 } });

console.log('\nA plain corner between two visible walls');
{
  const { joins, voids } = computeWallJoins([cornerA, cornerB]);
  const a = joins.get('A')!;
  const b = joins.get('B')!;
  check('both walls get a join', !!a && !!b);
  check('A\'s free end stays square and capped', isSquare(a, 'start') && a.start.capped);
  check('A\'s corner end is mitered', isMitered(a, 'end'));
  check('B\'s corner end is mitered', isMitered(b, 'start'));
  // Equal heights: the two cut faces coincide, so neither cap is drawn.
  check('the mitered caps are dropped', !a.end.capped && !b.start.capped);
  // The corner turns north, so A's +normal side (+y) is the inside of the corner: it
  // stops half of B's thickness short of the vertex, and the outside runs that much past.
  check('the inner cut stops short of the vertex', Math.abs(a.end.uPos - 390) < EPS,
    `uPos=${a.end.uPos}`);
  check('the outer cut reaches past it', Math.abs(a.end.uNeg - 410) < EPS,
    `uNeg=${a.end.uNeg}`);
  check('no junction void at a plain corner', voids.length === 0);
}

console.log('\nA corner where the neighbour is hidden');
{
  const hiddenB = makeWall({ ...cornerB, hidden: true });
  const { joins, voids } = computeWallJoins([cornerA, hiddenB]);
  const a = joins.get('A')!;
  check('the hidden wall gets no join of its own', !joins.has('B'));
  check('the visible wall still gets one', !!a);
  // Mitering into a wall that is never built would cut A back to meet nothing and
  // drop the cap that closes it — the open, slanted cross-section of issue #39.
  check('the visible wall ends square', isSquare(a, 'end'), `uPos=${a.end.uPos} uNeg=${a.end.uNeg}`);
  check('it ends at the shared vertex', Math.abs(a.end.uPos - 400) < EPS, `uPos=${a.end.uPos}`);
  check('its end cap is kept, so the thickness is closed', a.end.capped);
  check('its far end is untouched', isSquare(a, 'start') && a.start.capped);
  check('no junction void', voids.length === 0);
}

console.log('\nA T-junction with one hidden branch');
{
  // A and B make the corner; C is a third wall into the same vertex, hidden.
  const hiddenC = makeWall({
    id: 'C', start: { x: 400, y: 0 }, end: { x: 700, y: 0 }, hidden: true
  });
  const { joins, voids } = computeWallJoins([cornerA, cornerB, hiddenC]);
  const a = joins.get('A')!;
  const b = joins.get('B')!;
  check('the hidden branch is left out', !joins.has('C'));
  check('the two visible walls miter as a plain corner',
    isMitered(a, 'end') && isMitered(b, 'start'));
  check('their caps are dropped', !a.end.capped && !b.start.capped);
  check('no lid over a junction that no longer exists', voids.length === 0);
}

console.log('\nA T-junction of three visible walls (unchanged)');
{
  const c = makeWall({ id: 'C', start: { x: 400, y: 0 }, end: { x: 700, y: 0 } });
  const { joins, voids } = computeWallJoins([cornerA, cornerB, c]);
  check('every wall gets a join', joins.has('A') && joins.has('B') && joins.has('C'));
  check('the central void is reported', voids.length === 1);
  check('the void is lidded at the lowest wall height',
    voids[0]?.minHeight === 260, `minHeight=${voids[0]?.minHeight}`);
  check('caps stay at degree 3 — they are the void\'s sides',
    joins.get('A')!.end.capped && joins.get('B')!.start.capped && joins.get('C')!.start.capped);
}

console.log('\nOther walls that carry no mitered volume');
{
  const curved = makeWall({
    id: 'B', start: { x: 400, y: 0 }, end: { x: 400, y: 300 }, curvePoint: { x: 460, y: 150 }
  });
  const { joins } = computeWallJoins([cornerA, curved]);
  check('a curved neighbour is left out', !joins.has('B'));
  check('the straight wall ends square and capped',
    isSquare(joins.get('A')!, 'end') && joins.get('A')!.end.capped);

  const stub = makeWall({ id: 'D', start: { x: 400, y: 0 }, end: { x: 400.2, y: 0 } });
  const { joins: stubJoins } = computeWallJoins([cornerA, stub]);
  check('a zero-length neighbour is left out', !stubJoins.has('D'));
  check('the straight wall still ends square', isSquare(stubJoins.get('A')!, 'end'));
}

console.log('\nWall heights and thickness overrides');
{
  const tall = makeWall({ ...cornerB, height: 300 });
  const { joins } = computeWallJoins([cornerA, tall]);
  check('the taller wall keeps its cap', joins.get('B')!.start.capped);
  check('the shorter one drops it — the taller closes the opening',
    !joins.get('A')!.end.capped);

  // The baseboard mitres at its own, larger radius (wall thickness + 2).
  const { joins: bb } = computeWallJoins([cornerA, cornerB], (w) =>
    Math.max(w.thickness, WALL_THICKNESS) + 2);
  check('a wider profile cuts back further, matching the wider neighbour',
    Math.abs(bb.get('A')!.end.uNeg - 411) < EPS && Math.abs(bb.get('A')!.end.uPos - 389) < EPS,
    `uPos=${bb.get('A')!.end.uPos} uNeg=${bb.get('A')!.end.uNeg}`);

  const thin = makeWall({ ...cornerB, thickness: 2 });
  const { joins: thinJoins } = computeWallJoins([cornerA, thin]);
  check('a wall thinner than the minimum is mitered at the minimum',
    Math.abs(thinJoins.get('A')!.end.uPos - (400 - WALL_THICKNESS / 2)) < EPS,
    `uPos=${thinJoins.get('A')!.end.uPos}`);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
