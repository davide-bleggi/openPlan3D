/**
 * Test script: verify U/L-shaped stair layouts are connected and stay inside
 * the stair footprint (the box used for hit-testing and selection).
 * Run with: npx tsx test-stairs.ts
 */
import {
  buildStairLayout,
  flightCrossCenter,
  flightRunLength,
  flightStartCoord,
  flightTreadDepth,
  spiralRadius,
  stairFootprint,
  SPIRAL_POST_RATIO,
  STAIR_TOTAL_RISE,
  type StairFlight,
  type StairLayout,
  type StairRect
} from './src/lib/utils/stairGeometry.js';
import type { Stair, StairType } from './src/lib/models/types.js';

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

function rectInside(r: StairRect, w: number, d: number): boolean {
  return (
    r.x >= -w / 2 - EPS && r.x + r.w <= w / 2 + EPS &&
    r.y >= -d / 2 - EPS && r.y + r.h <= d / 2 + EPS &&
    r.w > 0 && r.h > 0
  );
}

/** Distance from a point to an axis-aligned rectangle (0 when inside/on edge). */
function distToRect(p: { x: number; y: number }, r: StairRect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

function flightFoot(f: StairFlight) {
  const cross = flightCrossCenter(f);
  const start = flightStartCoord(f);
  return f.axis === 'x' ? { x: start, y: cross } : { x: cross, y: start };
}

function flightHead(f: StairFlight) {
  const cross = flightCrossCenter(f);
  const end = flightStartCoord(f) + f.dir * flightRunLength(f);
  return f.axis === 'x' ? { x: end, y: cross } : { x: cross, y: end };
}

function makeStair(overrides: Partial<Stair>): Stair {
  return {
    id: 'test',
    position: { x: 0, y: 0 },
    rotation: 0,
    width: 100,
    depth: 300,
    riserCount: 14,
    direction: 'up',
    stairType: 'straight',
    ...overrides
  };
}

const sizes: Array<[number, number]> = [
  [100, 300],
  [240, 240],
  [300, 120],
  [90, 90],
  [140, 400]
];
const riserCounts = [3, 8, 14, 22];
const types: StairType[] = ['straight', 'l-shaped', 'u-shaped'];

for (const type of types) {
  for (const [width, depth] of sizes) {
    for (const riserCount of riserCounts) {
      const stair = makeStair({ stairType: type, width, depth, riserCount });
      const layout = buildStairLayout(stair) as StairLayout;
      const label = `${type} ${width}x${depth} / ${riserCount} risers`;
      console.log(`=== ${label} ===`);

      // 1. Everything stays inside the reported footprint, and the footprint
      //    is tight around it (no dead space the user could click but not see)
      const fp = stairFootprint(stair);
      const allRects: StairRect[] = [...layout.flights, ...layout.landings];
      const outside = allRects.filter((r) => !rectInside(r, fp.width, fp.depth));
      check('all flights + landings inside footprint', outside.length === 0, JSON.stringify(outside));
      check('layout reports the same footprint', layout.footprint.width === fp.width && layout.footprint.depth === fp.depth);
      const spanX = Math.max(...allRects.map((r) => r.x + r.w)) - Math.min(...allRects.map((r) => r.x));
      const spanY = Math.max(...allRects.map((r) => r.y + r.h)) - Math.min(...allRects.map((r) => r.y));
      check('footprint is tight', Math.abs(spanX - fp.width) < EPS && Math.abs(spanY - fp.depth) < EPS, `span ${spanX}x${spanY} vs footprint ${fp.width}x${fp.depth}`);

      // 2. `width` is the width of a single flight, whatever the type
      check(
        'every flight is `width` wide',
        layout.flights.every((f) => Math.abs((f.axis === 'x' ? f.h : f.w) - width) < EPS),
        JSON.stringify(layout.flights.map((f) => (f.axis === 'x' ? f.h : f.w)))
      );

      // 3. Risers add up and every flight has at least one
      const sum = layout.flights.reduce((a, f) => a + f.riserCount, 0);
      check('riser counts add up', sum === layout.riserCount, `${sum} != ${layout.riserCount}`);
      check('no empty flight', layout.flights.every((f) => f.riserCount >= 1));

      // 4. Flights are chained: startRiser of each flight = risers below it
      let expectedStart = 0;
      let chained = true;
      for (const f of layout.flights) {
        if (f.startRiser !== expectedStart) chained = false;
        expectedStart += f.riserCount;
      }
      check('flights chained by startRiser', chained);

      // 5. Top tread lands exactly on the next storey
      const topTread = layout.riserCount * layout.riserHeight;
      check('top tread at storey height', Math.abs(topTread - STAIR_TOTAL_RISE) < 1e-9);

      // 6. Landing count matches the number of turns
      check(
        'one landing per turn',
        layout.landings.length === layout.flights.length - 1,
        `${layout.landings.length} landings, ${layout.flights.length} flights`
      );

      // 7. Each landing touches the top of the flight below and the foot of
      //    the flight above, and sits at the matching height.
      layout.landings.forEach((landing, i) => {
        const below = layout.flights[i];
        const above = layout.flights[i + 1];
        check(
          `landing ${i} touches top of flight ${i}`,
          distToRect(flightHead(below), landing) < 1e-6,
          `head ${JSON.stringify(flightHead(below))} vs ${JSON.stringify(landing)}`
        );
        check(
          `landing ${i} touches foot of flight ${i + 1}`,
          distToRect(flightFoot(above), landing) < 1e-6,
          `foot ${JSON.stringify(flightFoot(above))} vs ${JSON.stringify(landing)}`
        );
        check(
          `landing ${i} height matches both flights`,
          landing.atRiser === below.startRiser + below.riserCount && landing.atRiser === above.startRiser
        );
      });

      // 8. Tread depths are positive, and the risers are split between the two
      //    flights as evenly as integer rounding allows.
      const treads = layout.flights.map(flightTreadDepth);
      check('tread depths positive', treads.every((t) => t > 0), JSON.stringify(treads));
      if (layout.flights.length === 2) {
        const [f1, f2] = layout.flights;
        const len1 = flightRunLength(f1);
        const len2 = flightRunLength(f2);
        const spreadFor = (n1: number) => {
          const t = [len1 / n1, len2 / (riserCount - n1)];
          return Math.max(...t) / Math.min(...t);
        };
        let best = Infinity;
        for (let n1 = 1; n1 < riserCount; n1++) best = Math.min(best, spreadFor(n1));
        const actual = spreadFor(f1.riserCount);
        check(
          'riser split gives the most uniform tread depth possible',
          actual <= best + 1e-9,
          `spread ${actual.toFixed(3)} vs best ${best.toFixed(3)}, treads ${JSON.stringify(treads)}`
        );
      }
    }
  }
}

// Direction only flips the plan arrow — the footprint must not change, or the
// 3D geometry would end up mirrored relative to the plan.
console.log('=== direction handling ===');
for (const type of types) {
  const up = buildStairLayout(makeStair({ stairType: type, direction: 'up' })) as StairLayout;
  const down = buildStairLayout(makeStair({ stairType: type, direction: 'down' })) as StairLayout;
  check(`${type}: footprint identical up/down`, JSON.stringify(up.flights) === JSON.stringify(down.flights));
  check(`${type}: landings identical up/down`, JSON.stringify(up.landings) === JSON.stringify(down.landings));
}

// The footprint follows from the flight width, not the other way round.
console.log('=== footprint from flight width ===');
{
  const straight = stairFootprint(makeStair({ stairType: 'straight', width: 100, depth: 300 }));
  check('straight: footprint is width x depth', straight.width === 100 && straight.depth === 300, JSON.stringify(straight));

  const u = stairFootprint(makeStair({ stairType: 'u-shaped', width: 100, depth: 300 }));
  check('u-shaped: two 100-wide flights plus a well', u.width === 210 && u.depth === 300, JSON.stringify(u));

  const uWide = stairFootprint(makeStair({ stairType: 'u-shaped', width: 120, depth: 300 }));
  check('u-shaped: footprint scales with flight width', uWide.width === 252, JSON.stringify(uWide));

  const l = stairFootprint(makeStair({ stairType: 'l-shaped', width: 100, depth: 300 }));
  check('l-shaped: square footprint of depth', l.width === 300 && l.depth === 300, JSON.stringify(l));

  // Degenerate case: a flight wider than the requested depth still gets arms
  const lSquat = buildStairLayout(makeStair({ stairType: 'l-shaped', width: 200, depth: 100 })) as StairLayout;
  check('l-shaped: wide/shallow stair keeps full flight width',
    lSquat.flights.every((f) => (f.axis === 'x' ? f.h : f.w) === 200));
  check('l-shaped: wide/shallow stair keeps positive arms',
    lSquat.flights.every((f) => flightRunLength(f) > 0));
}

// Spiral: `width` is the walkable depth of one tread, so the radius follows
// from it and `depth` plays no part.
console.log('=== spiral ===');
for (const width of [60, 100, 160]) {
  const layout = buildStairLayout(makeStair({ stairType: 'spiral', width, depth: 200 }));
  if (layout.type !== 'spiral') {
    check(`spiral ${width}: layout is spiral`, false);
    continue;
  }
  check(
    `spiral ${width}: tread run equals width`,
    Math.abs(layout.radius - layout.postRadius - width) < EPS,
    `radius ${layout.radius} - post ${layout.postRadius} = ${layout.radius - layout.postRadius}`
  );
  check(
    `spiral ${width}: footprint is the full diameter`,
    Math.abs(layout.footprint.width - 2 * layout.radius) < EPS &&
      Math.abs(layout.footprint.depth - 2 * layout.radius) < EPS,
    JSON.stringify(layout.footprint)
  );
  check(
    `spiral ${width}: radius = width + post`,
    Math.abs(layout.radius - spiralRadius(width)) < EPS &&
      Math.abs(layout.postRadius - width * SPIRAL_POST_RATIO) < EPS
  );
  const other = buildStairLayout(makeStair({ stairType: 'spiral', width, depth: 900 }));
  check(
    `spiral ${width}: depth does not affect the geometry`,
    JSON.stringify(other) === JSON.stringify(layout)
  );
  check(`spiral ${width}: top tread at storey height`,
    Math.abs(layout.riserCount * layout.riserHeight - STAIR_TOTAL_RISE) < 1e-9);
}

console.log(failures === 0 ? '\nAll stair layout checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
