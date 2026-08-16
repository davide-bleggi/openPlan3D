/**
 * Test script: floor reordering and duplicate-from-previous-floor (issue #15).
 * Run with: npx tsx test-floor-reorder.ts
 */
import {
  orderFloorsBottomUp,
  normalizeFloorOrder,
  reorderFloorStack,
  moveFloorInStack,
  groundSlotIndex,
} from './src/lib/utils/floorOrder.js';
import { cloneFloorContents } from './src/lib/utils/floorClone.js';
import { computeFloorElevations, isAutoFloorName } from './src/lib/utils/floorStacking.js';
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

function makeFloor(id: string, level: number, name: string, wallHeight = 260): Floor {
  return {
    id,
    name,
    level,
    walls: [{ id: `${id}-w1`, start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, thickness: 10, height: wallHeight, color: '#fff' }],
    rooms: [],
    doors: [],
    windows: [],
    furniture: [],
    stairs: [],
    columns: [],
    guides: [],
    measurements: [],
    annotations: [],
    textAnnotations: [],
    groups: [],
  } as unknown as Floor;
}

const names = (floors: Floor[]) => floors.map((f) => f.name).join(' | ');
const levels = (floors: Floor[]) => floors.map((f) => f.level).join(', ');

console.log('=== moving a floor up the stack ===');
{
  const floors = [makeFloor('a', 0, 'Ground Floor'), makeFloor('b', 1, 'Floor 1'), makeFloor('c', 2, 'Floor 2')];
  const moved = moveFloorInStack(floors, 'a', 1);

  check('array is bottom-to-top after the move', moved.map((f) => f.id).join('') === 'bac', moved.map((f) => f.id).join(''));
  check('levels stay contiguous from 0', levels(moved) === '0, 1, 2', levels(moved));
  check('the moved floor carries its own walls', moved[1].walls[0].id === 'a-w1');
  check('auto names renumber to match the new order', names(moved) === 'Ground Floor | Floor 1 | Floor 2', names(moved));

  const stack = computeFloorElevations(moved);
  check('3D elevations follow the new order', stack.map((e) => e.floor.id).join('') === 'bac', stack.map((e) => e.floor.id).join(''));
  check('the bottom floor still sits at Y=0', stack[0].elevation === 0, String(stack[0].elevation));
  check('elevations are strictly increasing', stack.every((e, i) => i === 0 || e.elevation > stack[i - 1].elevation));
}

console.log('\n=== moving a floor down the stack ===');
{
  const floors = [makeFloor('a', 0, 'Ground Floor'), makeFloor('b', 1, 'Floor 1'), makeFloor('c', 2, 'Floor 2')];
  const moved = moveFloorInStack(floors, 'c', -1);
  check('top floor swaps with the one below', moved.map((f) => f.id).join('') === 'acb', moved.map((f) => f.id).join(''));
  check('levels stay contiguous', levels(moved) === '0, 1, 2', levels(moved));
}

console.log('\n=== moves that cannot happen ===');
{
  const floors = [makeFloor('a', 0, 'Ground Floor'), makeFloor('b', 1, 'Floor 1')];
  check('moving the top floor up is a no-op', moveFloorInStack(floors, 'b', 1).map((f) => f.id).join('') === 'ab');
  check('moving the bottom floor down is a no-op', moveFloorInStack(floors, 'a', -1).map((f) => f.id).join('') === 'ab');
  check('an unknown floor id is a no-op', moveFloorInStack(floors, 'zz', 1).map((f) => f.id).join('') === 'ab');
}

console.log('\n=== drag-and-drop reorder ===');
{
  const floors = [makeFloor('a', 0, 'Ground Floor'), makeFloor('b', 1, 'Floor 1'), makeFloor('c', 2, 'Floor 2'), makeFloor('d', 3, 'Floor 3')];
  const moved = reorderFloorStack(floors, 3, 0);
  check('dragging the top floor to the bottom reorders the whole stack', moved.map((f) => f.id).join('') === 'dabc', moved.map((f) => f.id).join(''));
  check('levels are renumbered from the bottom', levels(moved) === '0, 1, 2, 3', levels(moved));
  check('out-of-range indices leave the order alone', reorderFloorStack(floors, 0, 9).map((f) => f.id).join('') === 'abcd');
}

console.log('\n=== custom names survive reordering ===');
{
  const floors = [makeFloor('a', 0, 'Ground Floor'), makeFloor('b', 1, 'Attic Studio'), makeFloor('c', 2, 'Floor 2')];
  const moved = moveFloorInStack(floors, 'b', 1);
  check('a user-typed name is never rewritten', moved.find((f) => f.id === 'b')!.name === 'Attic Studio');
  check('auto names around it still renumber', moved.find((f) => f.id === 'c')!.name === 'Floor 1', names(moved));
  check('auto-name detection ignores custom names', !isAutoFloorName('Attic Studio') && isAutoFloorName('Floor 3') && isAutoFloorName('Basement 2'));
}

console.log('\n=== basements keep the ground floor anchored ===');
{
  const floors = [makeFloor('z', -1, 'Basement'), makeFloor('a', 0, 'Ground Floor'), makeFloor('b', 1, 'Floor 1')];
  const ordered = orderFloorsBottomUp(floors);
  check('the ground floor owns the level-0 slot', groundSlotIndex(ordered) === 1);

  const moved = moveFloorInStack(floors, 'b', -1); // Floor 1 swaps below the ground floor
  check('the level-0 slot stays put in the stack', moved[1].level === 0, levels(moved));
  check('the basement slot stays below it', moved[0].level === -1, levels(moved));
  check('renamed to match their new slots', names(moved) === 'Basement | Ground Floor | Floor 1', names(moved));

  const stack = computeFloorElevations(moved);
  check('the level-0 floor still sits at Y=0', stack.find((e) => e.floor.level === 0)!.elevation === 0);
  check('the basement sits below Y=0', stack[0].elevation < 0, String(stack[0].elevation));
}

console.log('\n=== legacy projects with broken levels are healed ===');
{
  const floors = [makeFloor('a', 0, 'Ground Floor'), makeFloor('b', 0, 'Floor 1'), makeFloor('c', 5, 'Floor 5')];
  const fixed = normalizeFloorOrder(floors);
  check('duplicate/gappy levels become contiguous', levels(fixed) === '0, 1, 2', levels(fixed));
  check('every floor gets a distinct elevation', new Set(computeFloorElevations(fixed).map((e) => e.elevation)).size === 3);
}

console.log('\n=== copying a floor ===');
{
  const source = makeFloor('a', 0, 'Ground Floor');
  source.walls.push({ id: 'a-w2', start: { x: 400, y: 0 }, end: { x: 400, y: 300 }, thickness: 10, height: 260, color: '#fff' });
  source.doors.push({ id: 'a-d1', wallId: 'a-w1', position: 0.5, width: 90, height: 210, type: 'single', swingDirection: 'left', flipSide: false });
  source.windows.push({ id: 'a-win1', wallId: 'a-w2', position: 0.4, width: 120, height: 140, sillHeight: 90, type: 'standard' });
  source.rooms.push({ id: 'a-r1', name: 'Living', walls: ['a-w1', 'a-w2'], floorTexture: 'wood', area: 12 });
  source.furniture.push({ id: 'a-f1', catalogId: 'sofa', position: { x: 100, y: 100 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } });
  source.groups.push({ id: 'a-g1', elementIds: ['a-w1', 'a-w2'] });

  const copy = cloneFloorContents(source);
  const copyIds = [...copy.walls, ...copy.doors, ...copy.windows, ...copy.rooms].map((e) => e.id);

  check('structure is copied', copy.walls.length === 2 && copy.doors.length === 1 && copy.windows.length === 1 && copy.rooms.length === 1);
  check('furniture is left out by default', copy.furniture.length === 0);
  check('every element gets a fresh id', copyIds.every((id) => !id.startsWith('a-')), copyIds.join(','));
  check('doors point at the copied wall', copy.doors[0].wallId === copy.walls[0].id);
  check('windows point at the copied wall', copy.windows[0].wallId === copy.walls[1].id);
  check('rooms reference the copied walls', copy.rooms[0].walls.join(',') === `${copy.walls[0].id},${copy.walls[1].id}`);
  check('groups are remapped to the copied elements', copy.groups[0].elementIds.join(',') === `${copy.walls[0].id},${copy.walls[1].id}`);

  // Independence: editing the copy must not touch the source.
  copy.walls[0].height = 999;
  copy.walls[0].start.x = 42;
  check('the copy is a deep clone (nested points too)', source.walls[0].height === 260 && source.walls[0].start.x === 0);

  const withFurniture = cloneFloorContents(source, { includeFurniture: true });
  check('furniture is copied on request, with new ids', withFurniture.furniture.length === 1 && withFurniture.furniture[0].id !== 'a-f1');
}

console.log(allPassed ? '\nAll floor reorder tests passed' : '\nFAILED');
process.exit(allPassed ? 0 : 1);
