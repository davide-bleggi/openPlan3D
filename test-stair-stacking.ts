/**
 * Test script: stairs in the stacked 3D view.
 * Verifies every floor's stairs get a placement, that a "down" stair lands on
 * the storey it descends to, and that a stairwell drawn twice (up below, down
 * above) is not rendered twice.
 * Run with: npx tsx test-stair-stacking.ts
 */
import { computeFloorElevations } from './src/lib/utils/floorStacking.js';
import { stackedStairPlacements } from './src/lib/utils/stairStacking.js';
import type { Floor, Stair } from './src/lib/models/types.js';

let allPassed = true;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) allPassed = false;
  console.log(`  ${ok ? '✅' : '❌'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

function stair(id: string, direction: 'up' | 'down', x = 100, y = 200, rotation = 0): Stair {
  return { id, position: { x, y }, rotation, width: 100, depth: 300, riserCount: 14, direction, stairType: 'straight' };
}

function floor(id: string, level: number, wallHeight: number, stairs: Stair[]): Floor {
  return {
    id, name: '', level,
    walls: [{ id: `${id}-w`, start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, thickness: 10, height: wallHeight }],
    rooms: [], doors: [], windows: [], furniture: [], stairs, columns: [],
  } as unknown as Floor;
}

console.log('=== stairs on every floor are placed ===');
{
  const stack = computeFloorElevations([
    floor('g', 0, 300, [stair('g1', 'up')]),
    floor('f1', 1, 280, [stair('f1a', 'up', 500, 200)]),
    floor('f2', 2, 280, [stair('f2a', 'up', 900, 200)]),
  ]);
  const placements = stackedStairPlacements(stack);
  check('one placement per stair', placements.length, 3);
  check('elevations follow the floors', placements.map((p) => p.baseElevation), [0, 300, 580]);
}

console.log('=== a "down" stair descends to the floor below ===');
{
  const stack = computeFloorElevations([
    floor('g', 0, 300, []),
    floor('f1', 1, 280, [stair('d', 'down')]),
  ]);
  const placements = stackedStairPlacements(stack);
  check('placed one storey down', placements.map((p) => p.baseElevation), [0]);
  check('still owned by its own floor', placements.map((p) => p.floors.map((f) => f.id)), [['f1']]);
}

console.log('=== one stairwell drawn as up + down renders once ===');
{
  const stack = computeFloorElevations([
    floor('g', 0, 300, [stair('up', 'up')]),
    floor('f1', 1, 280, [stair('down', 'down'), stair('up2', 'up', 500, 200)]),
  ]);
  const placements = stackedStairPlacements(stack);
  check('duplicate dropped', placements.map((p) => p.stair.id), ['up', 'up2']);
  check('remaining elevations', placements.map((p) => p.baseElevation), [0, 300]);
  check('both floors still draw it', placements.map((p) => p.floors.map((f) => f.id)), [['g', 'f1'], ['f1']]);
}

console.log('=== a stairwell offset in plan is kept ===');
{
  const stack = computeFloorElevations([
    floor('g', 0, 300, [stair('up', 'up', 100, 200)]),
    floor('f1', 1, 280, [stair('down', 'down', 400, 200)]),
  ]);
  check('both kept', stackedStairPlacements(stack).map((p) => p.stair.id), ['up', 'down']);
}

console.log('=== a "down" stair on the lowest floor keeps its own level ===');
{
  const stack = computeFloorElevations([floor('g', 0, 300, [stair('d', 'down')])]);
  check('not pushed underground', stackedStairPlacements(stack).map((p) => p.baseElevation), [0]);
}

console.log();
process.exit(allPassed ? 0 : 1);
