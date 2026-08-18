/**
 * Test script: a French door is carved like a door, not like a window
 * (issue #17).
 *
 * A French door is a full-height glazed door onto a balcony or terrace. It is
 * glazed like a window, but it stands on the floor: its opening must run from
 * the floor to its head, with no apron of wall left underneath.
 *
 * Run with: npx tsx test-french-door.ts
 */
import {
  buildWallSegments,
  doorOpeningHeight,
  type WallSegment,
} from './src/lib/utils/wallOpenings.js';
import type { Door, Window as Win } from './src/lib/models/types.js';

const WALL_LEN = 500;
const WALL_H = 280;
const EPS = 1e-6;

let allPassed = true;

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    allPassed = false;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function frenchDoor(position: number, width = 150, height = 230): Door {
  return {
    id: `pf-${position}`, wallId: 'w1', position, width, height,
    type: 'french', swingDirection: 'left', flipSide: false,
  };
}

function window(position: number, width: number, sillHeight: number, height: number): Win {
  return {
    id: `w-${position}`, wallId: 'w1', position, width, height, sillHeight,
    type: 'standard',
  };
}

/** Total wall area the segments cover. */
function coveredArea(segs: WallSegment[]): number {
  return segs.reduce((sum, s) => sum + s.width * s.height, 0);
}

/** True if any segment covers part of the given rectangle in wall coordinates. */
function anySegmentIn(segs: WallSegment[], x0: number, x1: number, y0: number, y1: number): boolean {
  return segs.some((s) => {
    const sx0 = s.offsetX - s.width / 2, sx1 = s.offsetX + s.width / 2;
    const sy0 = s.offsetY, sy1 = s.offsetY + s.height;
    return sx1 - x0 > EPS && x1 - sx0 > EPS && sy1 - y0 > EPS && y1 - sy0 > EPS;
  });
}

console.log('\n1. The opening reaches the floor');
{
  const d = frenchDoor(0.5);
  const segs = buildWallSegments(WALL_LEN, WALL_H, [d], []);
  const left = d.position * WALL_LEN - d.width / 2;
  const right = d.position * WALL_LEN + d.width / 2;
  check('no wall left under the opening', !anySegmentIn(segs, left, right, 0, d.height));
  check('the lintel sits on the head',
    segs.some((s) => Math.abs(s.offsetY - d.height) < EPS && Math.abs(s.width - d.width) < EPS),
    segs.map((s) => `y${s.offsetY} w${s.width}`).join(', '));
  check('the carved area is the full opening',
    Math.abs(coveredArea(segs) - (WALL_LEN * WALL_H - d.width * d.height)) < EPS);
}

console.log('\n2. Unlike a window of the same size, which keeps its apron');
{
  const d = frenchDoor(0.5);
  const win = window(0.5, d.width, 50, d.height - 50);
  const doorSegs = buildWallSegments(WALL_LEN, WALL_H, [d], []);
  const winSegs = buildWallSegments(WALL_LEN, WALL_H, [], [win]);
  const left = d.position * WALL_LEN - d.width / 2;
  const right = d.position * WALL_LEN + d.width / 2;
  check('the window leaves an apron below the sill', anySegmentIn(winSegs, left, right, 0, 50));
  check('the French door does not', !anySegmentIn(doorSegs, left, right, 0, 50));
  check('so the French door carves more wall away', coveredArea(doorSegs) < coveredArea(winSegs));
}

console.log('\n3. Head height');
{
  check('uses the door\'s own height', doorOpeningHeight(frenchDoor(0.5, 150, 230), WALL_H) === 230);
  check('clamps to a lower wall', doorOpeningHeight(frenchDoor(0.5, 150, 230), 220) === 220);
}

console.log(allPassed ? '\nAll checks passed.\n' : '\nSome checks FAILED.\n');
process.exit(allPassed ? 0 : 1);
