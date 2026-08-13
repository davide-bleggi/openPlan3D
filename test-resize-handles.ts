/**
 * Test script: resizing an object pivots on the opposite corner/edge, follows
 * the grabbed handle exactly, and snaps dimensions only when snapping is on.
 *
 * The resize used to derive the new size from the distance between the item's
 * centre and the pointer. Two things fell out of that:
 *   - the item resized about its own centre, so the corner you were not
 *     dragging ran away from you — there was no fixed anchor to work against;
 *   - the size came straight from the pointer position, so grabbing a handle a
 *     few pixels off its centre snapped the item to a new size instantly.
 * It also quantised the *scale* to 1/20ths and never consulted the Snap switch,
 * so snapping could be neither relied on nor turned off.
 *
 * Run with: npx tsx test-resize-handles.ts
 */
import {
  startResize,
  resizeFrom,
  resizeAnchor,
  HANDLE_DIR,
  MIN_FURNITURE_CM,
  type ResizeHandle,
} from './src/lib/utils/canvasInteraction.js';
import { furnitureSize, furnitureBaseSize } from './src/lib/utils/furnitureCatalog.js';
import type { Point } from './src/lib/models/types.js';

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
}
function section(t: string) { console.log(`\n${t}`); }
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;
const nearPt = (a: Point, b: Point, tol = 1e-6) => near(a.x, b.x, tol) && near(a.y, b.y, tol);
const fmt = (p: Point) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;

const ALL_HANDLES = Object.keys(HANDLE_DIR) as ResizeHandle[];

/** World position of a handle for an item of the given size/rotation. */
function handlePoint(
  item: { position: Point; rotation: number },
  size: { width: number; depth: number },
  handle: ResizeHandle
): Point {
  const d = HANDLE_DIR[handle];
  const lx = (d.x * size.width) / 2;
  const ly = (d.y * size.depth) / 2;
  const rad = (item.rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return {
    x: item.position.x + lx * cos - ly * sin,
    y: item.position.y + lx * sin + ly * cos,
  };
}

section('1. The anchor — the opposite corner/edge — never moves');
{
  for (const rotation of [0, 30, 90, 217]) {
    let worst = 0;
    for (const handle of ALL_HANDLES) {
      const item = { position: { x: 120, y: -40 }, rotation };
      const size = { width: 200, depth: 90 };
      const grab = handlePoint(item, size, handle);
      const start = startResize(item, size, handle, grab);
      const anchor0 = resizeAnchor(start);
      // Drag the handle all over the place; the anchor must stay put.
      for (const [mx, my] of [[40, 25], [-260, 90], [15, -300], [500, 500], [-5, -5]]) {
        const next = resizeFrom(start, { x: grab.x + mx, y: grab.y + my });
        const d = HANDLE_DIR[handle];
        const ax = (-d.x * next.width) / 2;
        const ay = (-d.y * next.depth) / 2;
        const rad = (rotation * Math.PI) / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const anchorNow = {
          x: next.position.x + ax * cos - ay * sin,
          y: next.position.y + ax * sin + ay * cos,
        };
        worst = Math.max(worst, Math.hypot(anchorNow.x - anchor0.x, anchorNow.y - anchor0.y));
      }
    }
    check(`rotation ${rotation}°: anchor fixed for all 8 handles`, worst < 1e-6, `drifted ${worst.toFixed(4)} cm`);
  }
}

section('2. The grabbed handle follows the pointer exactly');
{
  // Grab the handle off-centre — the item must not jump, and from then on the
  // handle must track the pointer one-to-one.
  const item = { position: { x: 0, y: 0 }, rotation: 0 };
  const size = { width: 200, depth: 90 };
  const trueHandle = handlePoint(item, size, 'resize-br'); // (100, 45)
  const grab = { x: trueHandle.x + 4, y: trueHandle.y - 3 }; // sloppy grab

  const start = startResize(item, size, 'resize-br', grab);
  const noMove = resizeFrom(start, grab);
  check('grabbing off-centre does not change the size',
    near(noMove.width, 200) && near(noMove.depth, 90), `${noMove.width} × ${noMove.depth}`);
  check('…and does not move the item', nearPt(noMove.position, item.position), fmt(noMove.position));

  const moved = resizeFrom(start, { x: grab.x + 50, y: grab.y + 10 });
  check('moving the pointer 50cm widens the item by exactly 50cm',
    near(moved.width, 250), `${moved.width}`);
  check('…and 10cm deeper by exactly 10cm', near(moved.depth, 100), `${moved.depth}`);
  const newHandle = handlePoint({ position: moved.position, rotation: 0 }, moved, 'resize-br');
  check('the handle sits under the pointer (minus the grab offset)',
    nearPt(newHandle, { x: grab.x + 50 - 4, y: grab.y + 10 + 3 }), fmt(newHandle));
}

section('3. Edge handles change one dimension only');
{
  const item = { position: { x: 10, y: 20 }, rotation: 0 };
  const size = { width: 120, depth: 60 };
  for (const [handle, changes] of [
    ['resize-l', 'w'], ['resize-r', 'w'], ['resize-t', 'd'], ['resize-b', 'd'],
  ] as [ResizeHandle, 'w' | 'd'][]) {
    const grab = handlePoint(item, size, handle);
    const start = startResize(item, size, handle, grab);
    const next = resizeFrom(start, { x: grab.x + 33, y: grab.y + 27 });
    const wChanged = !near(next.width, size.width);
    const dChanged = !near(next.depth, size.depth);
    check(`${handle} changes only ${changes === 'w' ? 'width' : 'depth'}`,
      changes === 'w' ? wChanged && !dChanged : dChanged && !wChanged,
      `${next.width} × ${next.depth}`);
  }
}

section('4. Dragging past the anchor clamps instead of inverting');
{
  const item = { position: { x: 0, y: 0 }, rotation: 0 };
  const size = { width: 200, depth: 90 };
  const grab = handlePoint(item, size, 'resize-r'); // right edge at x = 100
  const start = startResize(item, size, 'resize-r', grab);
  // Drag the right edge far past the left edge.
  const next = resizeFrom(start, { x: -600, y: 0 });
  check('width clamps at the minimum', near(next.width, MIN_FURNITURE_CM), `${next.width}`);
  check('width never goes negative', next.width > 0, `${next.width}`);
  const anchor = resizeAnchor(start);
  check('the left edge is still the anchor', near(anchor.x, -100), `${anchor.x}`);
}

section('5. Snapping is applied to the dimension, and only when asked for');
{
  const item = { position: { x: 0, y: 0 }, rotation: 0 };
  const size = { width: 200, depth: 90 };
  const grab = handlePoint(item, size, 'resize-br');
  const start = startResize(item, size, 'resize-br', grab);
  const pointer = { x: grab.x + 37, y: grab.y + 12 };

  const free = resizeFrom(start, pointer);
  check('snap off: the exact dragged size is kept',
    near(free.width, 237) && near(free.depth, 102), `${free.width} × ${free.depth}`);

  const grid = (v: number) => Math.max(25, Math.round(v / 25) * 25);
  const snapped = resizeFrom(start, pointer, { snapLength: grid });
  check('snap on: both dimensions land on the 25cm grid',
    snapped.width % 25 === 0 && snapped.depth % 25 === 0, `${snapped.width} × ${snapped.depth}`);
  check('snap on: it rounds to the nearest step',
    near(snapped.width, 225) && near(snapped.depth, 100), `${snapped.width} × ${snapped.depth}`);
  // The anchor still holds with snapping on — this is what keeps a snapped
  // resize from nudging the whole item sideways.
  const a0 = resizeAnchor(start);
  check('snap on: the anchor still does not move',
    near(snapped.position.x - snapped.width / 2, a0.x) && near(snapped.position.y - snapped.depth / 2, a0.y),
    fmt(snapped.position));
}

section('6. Shift keeps the proportions on a corner handle');
{
  const item = { position: { x: 0, y: 0 }, rotation: 0 };
  const size = { width: 200, depth: 100 }; // 2:1
  const grab = handlePoint(item, size, 'resize-tl');
  const start = startResize(item, size, 'resize-tl', grab);
  const next = resizeFrom(start, { x: grab.x - 100, y: grab.y - 5 }, { keepAspect: true });
  check('the 2:1 ratio survives', near(next.width / next.depth, 2, 1e-9), `${next.width} × ${next.depth}`);
  check('the item still grew', next.width > size.width, `${next.width}`);
  const a0 = resizeAnchor(start);
  check('the anchor still does not move',
    near(next.position.x + next.width / 2, a0.x) && near(next.position.y + next.depth / 2, a0.y), fmt(next.position));
}

section('7. Rotated items resize along their own axes');
{
  const item = { position: { x: 0, y: 0 }, rotation: 90 };
  const size = { width: 200, depth: 90 };
  const grab = handlePoint(item, size, 'resize-r');
  const start = startResize(item, size, 'resize-r', grab);
  // At 90° the item's local +X points along world +Y, so pushing the handle
  // along world +Y is what widens it; pushing along world +X must not.
  const alongLocalX = resizeFrom(start, { x: grab.x, y: grab.y + 40 });
  check('a push along the local width axis widens it', near(alongLocalX.width, 240), `${alongLocalX.width}`);
  check('…and leaves the depth alone', near(alongLocalX.depth, 90), `${alongLocalX.depth}`);
  const acrossIt = resizeFrom(start, { x: grab.x + 40, y: grab.y });
  check('a push across it changes nothing', near(acrossIt.width, 200) && near(acrossIt.depth, 90),
    `${acrossIt.width} × ${acrossIt.depth}`);
}

section('8. Footprint: one formula for drawing, hit testing and handles');
{
  const sofa = { catalogId: 'sofa', position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } };
  check('a plain item uses its catalog size',
    furnitureSize(sofa).width === 200 && furnitureSize(sofa).depth === 90, JSON.stringify(furnitureSize(sofa)));

  const resized = { ...sofa, width: 150, depth: 70 };
  check('a per-item override wins over the catalog',
    furnitureSize(resized).width === 150 && furnitureSize(resized).depth === 70, JSON.stringify(furnitureSize(resized)));

  const scaled = { ...resized, scale: { x: 2, y: 0.5, z: 1 } };
  check('scale multiplies the override, not the catalog default',
    furnitureSize(scaled).width === 300 && furnitureSize(scaled).depth === 35, JSON.stringify(furnitureSize(scaled)));

  const mirrored = { ...sofa, scale: { x: -1, y: 1, z: 1 } };
  check('a mirrored item keeps a positive footprint',
    furnitureSize(mirrored).width === 200, JSON.stringify(furnitureSize(mirrored)));

  check('the base size is what scale applies to',
    furnitureBaseSize(scaled).width === 150 && furnitureBaseSize(scaled).depth === 70,
    JSON.stringify(furnitureBaseSize(scaled)));

  const unknown = { catalogId: 'nope', position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } };
  check('an unknown catalog id still yields a usable size', furnitureSize(unknown).width > 0);

  // A resize folds the scale into the dimensions, so the number the properties
  // panel shows (width ?? catalog) is the number the handles produced.
  const grab = handlePoint(scaled, furnitureSize(scaled), 'resize-br');
  const start = startResize(scaled, furnitureSize(scaled), 'resize-br', grab);
  const next = resizeFrom(start, { x: grab.x + 20, y: grab.y });
  const folded = { ...scaled, width: next.width, depth: next.depth, scale: { x: 1, y: 1, z: 1 } };
  check('after a resize the stored width is the on-plan width',
    furnitureSize(folded).width === next.width, `${furnitureSize(folded).width} vs ${next.width}`);
}

console.log(
  failures === 0
    ? '\n✅ PASS — resize pivots on a fixed anchor, tracks the handle, and snaps on request'
    : `\n❌ FAIL — ${failures} check(s) failed`
);
process.exit(failures === 0 ? 0 : 1);
