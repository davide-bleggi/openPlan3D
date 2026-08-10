/**
 * Test script: verify multi-floor 3D stacking gives every floor a distinct,
 * correctly ordered vertical offset (issue #6).
 * Run with: npx tsx test-floor-stacking.ts
 */
import {
  computeFloorElevations,
  floorStructuralHeight,
  defaultFloorName,
  DEFAULT_WALL_HEIGHT,
  FLOOR_SLAB_THICKNESS,
} from './src/lib/utils/floorStacking.js';
import type { Floor } from './src/lib/models/types.js';

let allPassed = true;

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    allPassed = false;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function makeFloor(id: string, level: number, wallHeight?: number, name?: string): Floor {
  const walls = wallHeight
    ? [{
        id: `${id}-w`,
        start: { x: 0, y: 0 },
        end: { x: 400, y: 0 },
        thickness: 10,
        height: wallHeight,
      }]
    : [];
  return {
    id, name: name ?? '', level,
    walls, rooms: [], doors: [], windows: [], furniture: [], stairs: [], columns: [],
    guides: [], measurements: [], annotations: [], textAnnotations: [], groups: [],
  } as unknown as Floor;
}

console.log('=== 3 floors with distinct heights ===');
{
  const floors = [
    makeFloor('a', 0, 300),
    makeFloor('b', 1, 260),
    makeFloor('c', 2, 240),
  ];
  const stack = computeFloorElevations(floors);
  const elevations = stack.map(e => e.elevation);
  console.log(`  elevations: ${elevations.join(', ')}`);

  check('ground floor sits at Y=0', elevations[0] === 0, `got ${elevations[0]}`);
  check('every floor has a distinct elevation', new Set(elevations).size === floors.length,
    `got ${elevations.join(', ')}`);
  check('elevations increase with level', elevations.every((y, i) => i === 0 || y > elevations[i - 1]));
  check('second floor clears the first floor walls', elevations[1] === 300 + FLOOR_SLAB_THICKNESS,
    `got ${elevations[1]}`);
  check('third floor clears the second floor walls',
    elevations[2] === 300 + 260 + 2 * FLOOR_SLAB_THICKNESS, `got ${elevations[2]}`);
  check('no floor overlaps the one above it',
    stack.every((e, i) => i === 0 || e.elevation >= stack[i - 1].elevation + stack[i - 1].height));
}

console.log('\n=== floors stored out of level order ===');
{
  const floors = [makeFloor('top', 2), makeFloor('ground', 0), makeFloor('mid', 1)];
  const stack = computeFloorElevations(floors);
  check('stack is ordered bottom-to-top',
    stack.map(e => e.floor.id).join(',') === 'ground,mid,top',
    stack.map(e => e.floor.id).join(','));
  check('ground floor still anchored at Y=0', stack[0].elevation === 0);
}

console.log('\n=== basement below the ground floor ===');
{
  const floors = [makeFloor('basement', -1, 240), makeFloor('ground', 0, 300)];
  const stack = computeFloorElevations(floors);
  check('basement is below Y=0', stack[0].elevation < 0, `got ${stack[0].elevation}`);
  check('ground floor is at Y=0', stack[1].elevation === 0, `got ${stack[1].elevation}`);
  check('basement is one storey down', stack[0].elevation === -(240 + FLOOR_SLAB_THICKNESS),
    `got ${stack[0].elevation}`);
}

console.log('\n=== duplicate levels (legacy projects) ===');
{
  const floors = [makeFloor('a', 0), makeFloor('b', 1), makeFloor('c', 1)];
  const elevations = computeFloorElevations(floors).map(e => e.elevation);
  check('duplicate levels still get distinct elevations',
    new Set(elevations).size === floors.length, `got ${elevations.join(', ')}`);
}

console.log('\n=== floor heights ===');
{
  check('empty floor falls back to the default wall height',
    floorStructuralHeight(makeFloor('e', 0)) === DEFAULT_WALL_HEIGHT + FLOOR_SLAB_THICKNESS);
  check('floor height follows its tallest wall',
    floorStructuralHeight(makeFloor('t', 0, 320)) === 320 + FLOOR_SLAB_THICKNESS);
}

console.log('\n=== default names ===');
{
  check('level 0 is the ground floor', defaultFloorName(makeFloor('a', 0), 0) === 'Ground Floor');
  check('level 2 is Floor 2', defaultFloorName(makeFloor('b', 2), 1) === 'Floor 2');
  check('level -1 is the basement', defaultFloorName(makeFloor('c', -1), 0) === 'Basement');
}

console.log(allPassed ? '\nAll floor stacking tests passed' : '\nFAILED');
process.exit(allPassed ? 0 : 1);
