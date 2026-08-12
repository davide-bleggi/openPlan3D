/**
 * Test script: verify wall openings are carved as a clean tiling — no wall box
 * overlaps another, and none of them covers an opening (issue #14).
 *
 * Overlapping boxes are what produced the z-fighting at doors and windows: two
 * solids sharing a span put two faces on the same plane, and the depth buffer
 * flickers between them.
 *
 * Run with: npx tsx test-wall-openings.ts
 */
import {
  buildWallSegments,
  doorOpeningHeight,
  DEFAULT_DOOR_HEIGHT,
  type WallSegment,
} from './src/lib/utils/wallOpenings.js';
import type { Door, Window as Win } from './src/lib/models/types.js';

const DOOR_HEIGHT = DEFAULT_DOOR_HEIGHT;

let allPassed = true;

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    allPassed = false;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function door(position: number, width: number, height = DOOR_HEIGHT): Door {
  return {
    id: `d-${position}-${width}`, wallId: 'w1', position, width, height,
    type: 'single', swingDirection: 'left', flipSide: false,
  };
}

function window(position: number, width: number, sillHeight: number, height: number): Win {
  return {
    id: `w-${position}-${width}`, wallId: 'w1', position, width, height, sillHeight,
    type: 'standard',
  };
}

const EPS = 1e-9;

interface Rect { x0: number; x1: number; y0: number; y1: number }

const rectOf = (s: WallSegment): Rect => ({
  x0: s.offsetX - s.width / 2,
  x1: s.offsetX + s.width / 2,
  y0: s.offsetY,
  y1: s.offsetY + s.height,
});

/** Area shared by two rectangles — anything above zero is geometry drawn twice. */
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > EPS && h > EPS ? w * h : 0;
}

function findOverlap(segs: WallSegment[]): string | null {
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const area = overlapArea(rectOf(segs[i]), rectOf(segs[j]));
      if (area > EPS) {
        const a = rectOf(segs[i]), b = rectOf(segs[j]);
        return `segments overlap by ${area.toFixed(2)} cm²: ` +
          `[${a.x0}..${a.x1} x ${a.y0}..${a.y1}] and [${b.x0}..${b.x1} x ${b.y0}..${b.y1}]`;
      }
    }
  }
  return null;
}

/** Total wall area the segments cover, given they are known not to overlap. */
const coveredArea = (segs: WallSegment[]) =>
  segs.reduce((sum, s) => sum + s.width * s.height, 0);

const WALL_LEN = 500;
const WALL_H = 270;

console.log('\n1. Plain wall with no openings');
{
  const segs = buildWallSegments(WALL_LEN, WALL_H, [], []);
  check('one solid box', segs.length === 1, `got ${segs.length}`);
  check('covers the whole wall', Math.abs(coveredArea(segs) - WALL_LEN * WALL_H) < EPS);
}

console.log('\n2. One door and one window, well apart');
{
  const d = door(0.25, 90);
  const w = window(0.7, 120, 90, 120);
  const segs = buildWallSegments(WALL_LEN, WALL_H, [d], [w]);
  check('no two segments overlap', findOverlap(segs) === null, findOverlap(segs) ?? '');
  const expected = WALL_LEN * WALL_H - d.width * DOOR_HEIGHT - w.width * w.height;
  check('exactly the openings are missing',
    Math.abs(coveredArea(segs) - expected) < EPS,
    `covered ${coveredArea(segs)}, expected ${expected}`);
  check('a lintel sits above the door',
    segs.some((s) => Math.abs(s.offsetY - DOOR_HEIGHT) < EPS && Math.abs(s.width - d.width) < EPS));
  check('an apron sits below the window',
    segs.some((s) => s.offsetY === 0 && Math.abs(s.height - w.sillHeight) < EPS
      && Math.abs(s.width - w.width) < EPS));
}

console.log('\n3. Overlapping openings merge into a single hole');
{
  // Two doors 100 apart, 150 wide each: they share 50 cm of wall.
  const segs = buildWallSegments(WALL_LEN, WALL_H, [door(0.4, 150), door(0.6, 150)], []);
  const overlap = findOverlap(segs);
  check('no two segments overlap', overlap === null, overlap ?? '');
  check('no pier between them',
    !segs.some((s) => s.offsetX > 125 && s.offsetX < 375 && Math.abs(s.height - WALL_H) < EPS));
  const merged = { left: 0.4 * WALL_LEN - 75, right: 0.6 * WALL_LEN + 75 };
  const expected = WALL_LEN * WALL_H - (merged.right - merged.left) * DOOR_HEIGHT;
  check('the merged hole is carved once',
    Math.abs(coveredArea(segs) - expected) < EPS,
    `covered ${coveredArea(segs)}, expected ${expected}`);
}

console.log('\n4. A window fully inside a door opening');
{
  const segs = buildWallSegments(WALL_LEN, WALL_H, [door(0.5, 200)], [window(0.5, 60, 100, 60)]);
  const overlap = findOverlap(segs);
  check('no two segments overlap', overlap === null, overlap ?? '');
  const expected = WALL_LEN * WALL_H - 200 * DOOR_HEIGHT;
  check('the contained window carves nothing extra',
    Math.abs(coveredArea(segs) - expected) < EPS,
    `covered ${coveredArea(segs)}, expected ${expected}`);
}

console.log('\n5. Openings a hair apart merge instead of leaving a sliver pier');
{
  // 0.2 cm of wall between the two openings — too thin to draw as its own box.
  const segs = buildWallSegments(WALL_LEN, WALL_H, [door(0.2, 100), door(0.2 + 100.2 / WALL_LEN, 100)], []);
  const overlap = findOverlap(segs);
  check('no two segments overlap', overlap === null, overlap ?? '');
  check('no sliver segment survives',
    segs.every((s) => s.width > 1 && s.height > 1),
    segs.filter((s) => s.width <= 1 || s.height <= 1).map((s) => `${s.width}x${s.height}`).join(', '));
}

console.log('\n6. An opening hanging off the end of the wall');
{
  const segs = buildWallSegments(WALL_LEN, WALL_H, [door(0.98, 200)], []);
  const overlap = findOverlap(segs);
  check('no two segments overlap', overlap === null, overlap ?? '');
  check('nothing extends past the wall',
    segs.every((s) => s.offsetX - s.width / 2 >= -EPS && s.offsetX + s.width / 2 <= WALL_LEN + EPS),
    segs.map((s) => `${s.offsetX - s.width / 2}..${s.offsetX + s.width / 2}`).join(', '));
  const clearWidth = WALL_LEN - (0.98 * WALL_LEN - 100);
  const expected = WALL_LEN * WALL_H - clearWidth * DOOR_HEIGHT;
  check('only the part over the wall is carved',
    Math.abs(coveredArea(segs) - expected) < EPS,
    `covered ${coveredArea(segs)}, expected ${expected}`);
}

console.log('\n7. An opening taller than the wall');
{
  const segs = buildWallSegments(WALL_LEN, 180, [door(0.5, 90)], []);
  const overlap = findOverlap(segs);
  check('no two segments overlap', overlap === null, overlap ?? '');
  check('no lintel above the wall top',
    segs.every((s) => s.offsetY + s.height <= 180 + EPS));
  check('the opening runs full height',
    Math.abs(coveredArea(segs) - (WALL_LEN * 180 - 90 * 180)) < EPS);
}

console.log('\n8. A wall crowded with openings stays a clean tiling');
{
  const doors = [door(0.1, 80), door(0.35, 90), door(0.62, 200)];
  const windows = [
    window(0.2, 100, 90, 120),
    window(0.5, 140, 100, 110),
    window(0.9, 60, 40, 200),
  ];
  const segs = buildWallSegments(WALL_LEN, WALL_H, doors, windows);
  const overlap = findOverlap(segs);
  check('no two segments overlap', overlap === null, overlap ?? '');
  check('every segment has positive size', segs.every((s) => s.width > 0 && s.height > 0));
  check('nothing extends past the wall',
    segs.every((s) => s.offsetX - s.width / 2 >= -EPS && s.offsetX + s.width / 2 <= WALL_LEN + EPS
      && s.offsetY >= -EPS && s.offsetY + s.height <= WALL_H + EPS));
}

console.log('\n9. A door is carved to its own height, not a fixed one');
{
  const d = door(0.5, 90, 150);
  const segs = buildWallSegments(WALL_LEN, WALL_H, [d], []);
  const overlap = findOverlap(segs);
  check('no two segments overlap', overlap === null, overlap ?? '');
  check('the lintel starts at the door head',
    segs.some((s) => Math.abs(s.offsetY - 150) < EPS && Math.abs(s.width - d.width) < EPS),
    segs.map((s) => `y${s.offsetY} w${s.width}`).join(', '));
  check('the opening is the door\'s own height',
    Math.abs(coveredArea(segs) - (WALL_LEN * WALL_H - 90 * 150)) < EPS);

  const tall = buildWallSegments(WALL_LEN, WALL_H, [door(0.5, 90, 250)], []);
  check('a taller door carves more',
    Math.abs(coveredArea(tall) - (WALL_LEN * WALL_H - 90 * 250)) < EPS);
}

console.log('\n10. doorOpeningHeight');
{
  check('uses the door\'s height', doorOpeningHeight(door(0.5, 90, 195), 270) === 195);
  check('clamps to the wall', doorOpeningHeight(door(0.5, 90, 300), 270) === 270);
  check('falls back for a door with no height',
    doorOpeningHeight({ ...door(0.5, 90), height: undefined as unknown as number }, 270) === DOOR_HEIGHT);
}

console.log(allPassed ? '\nAll checks passed.\n' : '\nSome checks FAILED.\n');
process.exit(allPassed ? 0 : 1);
