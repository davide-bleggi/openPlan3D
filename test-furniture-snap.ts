/**
 * Test script: verify the furniture snapping shared by the 2D plan and the 3D
 * view (issue #41). The 3D view now drags placed items, and it has to land
 * them exactly where the plan would: flush against a wall when one is close
 * enough, on the grid otherwise, with the item's own heading given back when
 * it leaves the wall.
 * Run with: npx tsx test-furniture-snap.ts
 */
import {
  snapFurnitureToWall,
  resolveFurnitureDrag,
  resolveFurnitureLift,
  ELEVATION_SNAP_CM,
  MAX_FURNITURE_ELEVATION,
  WALL_SNAP_DIST
} from './src/lib/utils/furnitureSnap.js';
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

/** A horizontal wall along y = 0, faces at y = ±10. */
const northWall = makeWall({ id: 'w1' });
const SIZE = { width: 100, depth: 60 };   // a sofa
const identity = (v: number) => v;
const grid25 = (v: number) => Math.round(v / 25) * 25;

console.log('\n1. Flush against a wall');
{
  // Centre 45cm below the wall centre-line: 35cm from the face, 5cm short of
  // the 30cm half-depth + face — inside the snap band.
  const snap = snapFurnitureToWall([northWall], { x: 200, y: 45 }, SIZE, identity);
  check('snaps when the back edge is near the face', snap !== null);
  if (snap) {
    check('centre sits half a depth off the wall face',
      Math.abs(snap.position.y - (10 + 30)) < EPS, `y=${snap.position.y}`);
    check('keeps its position along the wall',
      Math.abs(snap.position.x - 200) < EPS, `x=${snap.position.x}`);
    check('reports the wall it snapped to', snap.wallId === 'w1');
    check('faces away from the wall on the positive side',
      snap.rotation === 0, `rotation=${snap.rotation}`);
  }
}

console.log('\n2. The other side of the same wall');
{
  const snap = snapFurnitureToWall([northWall], { x: 200, y: -45 }, SIZE, identity);
  check('snaps on the negative side', snap !== null);
  if (snap) {
    check('centre is mirrored', Math.abs(snap.position.y + 40) < EPS, `y=${snap.position.y}`);
    check('rotation is flipped', snap.rotation === 180, `rotation=${snap.rotation}`);
    check('side is reported as anti', snap.side === 'anti');
  }
}

console.log('\n3. Out of range');
{
  // 40 + WALL_SNAP_DIST is exactly the edge of the band; go well past it.
  const far = snapFurnitureToWall([northWall], { x: 200, y: 40 + WALL_SNAP_DIST + 5 }, SIZE, identity);
  check('no snap when the item is too far out', far === null);
  const beyondEnd = snapFurnitureToWall([northWall], { x: 600, y: 40 }, SIZE, identity);
  check('no snap past the end of the wall segment', beyondEnd === null);
}

console.log('\n4. Rotation follows the wall');
{
  const diagonal = makeWall({ id: 'w2', start: { x: 0, y: 0 }, end: { x: 300, y: 300 } });
  const snap = snapFurnitureToWall([diagonal], { x: 120, y: 160 }, SIZE, identity);
  check('snaps to a diagonal wall', snap !== null);
  if (snap) {
    check('takes the wall\'s heading', Math.abs(snap.rotation - 45) < 1e-9, `rotation=${snap.rotation}`);
  }
}

console.log('\n5. The grid is applied to the snapped centre');
{
  const wall = makeWall({ id: 'w3', start: { x: 0, y: 0 }, end: { x: 400, y: 0 } });
  const snap = snapFurnitureToWall([wall], { x: 137, y: 45 }, SIZE, grid25);
  check('snapped position is quantised', snap !== null && snap.position.x % 25 === 0,
    snap ? `x=${snap.position.x}` : 'no snap');
}

console.log('\n6. resolveFurnitureDrag — one frame of a drag');
{
  const onWall = resolveFurnitureDrag({ x: 200, y: 45 }, {
    walls: [northWall], size: SIZE, baseRotation: 33, snapCoord: grid25
  });
  check('against a wall it takes the wall\'s rotation',
    onWall.wallSnap !== null && onWall.rotation === 0, `rotation=${onWall.rotation}`);

  const freeStanding = resolveFurnitureDrag({ x: 213, y: 400 }, {
    walls: [northWall], size: SIZE, baseRotation: 33, snapCoord: grid25
  });
  check('away from every wall it keeps its own rotation',
    freeStanding.wallSnap === null && freeStanding.rotation === 33,
    `rotation=${freeStanding.rotation}`);
  check('and lands on the grid',
    freeStanding.position.x === 225 && freeStanding.position.y === 400,
    `${freeStanding.position.x},${freeStanding.position.y}`);

  const snapOff = resolveFurnitureDrag({ x: 200, y: 45 }, {
    walls: [northWall], size: SIZE, baseRotation: 33, wallSnapEnabled: false
  });
  check('wall snapping obeys the Snap switch',
    snapOff.wallSnap === null && snapOff.position.y === 45, `y=${snapOff.position.y}`);

  const negative = resolveFurnitureDrag({ x: 0, y: 0 }, {
    walls: [], size: SIZE, baseRotation: -90
  });
  check('a negative base rotation comes back normalised',
    negative.rotation === 270, `rotation=${negative.rotation}`);
}

console.log('\n7. The nearest wall wins');
{
  const south = makeWall({ id: 'south', start: { x: 0, y: 300 }, end: { x: 400, y: 300 } });
  const snap = snapFurnitureToWall([northWall, south], { x: 200, y: 255 }, SIZE, identity);
  check('picks the wall whose flush position is closest',
    snap !== null && snap.wallId === 'south', snap ? snap.wallId : 'no snap');
}

console.log('\n8. resolveFurnitureLift — raising an item off the floor');
{
  check('snaps to the elevation step',
    resolveFurnitureLift(121) === 120, `${resolveFurnitureLift(121)}`);
  check('the step is finer than the plan grid', ELEVATION_SNAP_CM < 25);
  check('Alt (snapping off) keeps the exact height',
    resolveFurnitureLift(121.5, false) === 121.5, `${resolveFurnitureLift(121.5, false)}`);
  check('never sinks below the floor',
    resolveFurnitureLift(-40) === 0, `${resolveFurnitureLift(-40)}`);
  check('a floor-level drag stays at zero, not at a negative step',
    resolveFurnitureLift(-0.4) === 0, `${resolveFurnitureLift(-0.4)}`);
  check('is capped at the top of the range',
    resolveFurnitureLift(MAX_FURNITURE_ELEVATION + 500) === MAX_FURNITURE_ELEVATION,
    `${resolveFurnitureLift(MAX_FURNITURE_ELEVATION + 500)}`);
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
