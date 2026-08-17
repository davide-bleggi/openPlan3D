/**
 * Test script: verify U/L-shaped stair layouts are connected and stay inside
 * the stair footprint (the box used for hit-testing and selection), and that
 * the railings follow the open edges of the surface you actually walk on.
 * Run with: npx tsx test-stairs.ts
 */
import {
  buildStairLayout,
  buildStairRailings,
  flightCrossCenter,
  flightRunLength,
  flightStartCoord,
  flightTreadDepth,
  railingPostPositions,
  spiralRadius,
  stairFootprint,
  stairRailingHeight,
  SPIRAL_POST_RATIO,
  STAIR_RAILING_HEIGHT,
  STAIR_RAILING_POST_SPACING,
  STAIR_RAILING_POST_THICKNESS,
  STAIR_TOTAL_RISE,
  type StairFlight,
  type StairLayout,
  type StairRailingRun,
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

// ── Railings ────────────────────────────────────────────────────────
//
// A railing has to sit on the walking surface at every point (no floating or
// buried handrails), stay inside the footprint, and stay on one hand of the
// stair all the way up — including across the landings of L/U-shaped stairs.

/** Every rectangle of the stair you can stand on, with its surface height. */
function surfaces(layout: StairLayout): Array<{ rect: StairRect; from: number; to: number }> {
  const out: Array<{ rect: StairRect; from: number; to: number }> = [];
  for (const f of layout.flights) {
    out.push({
      rect: f,
      from: f.startRiser * layout.riserHeight,
      to: (f.startRiser + f.riserCount) * layout.riserHeight
    });
  }
  for (const l of layout.landings) {
    const h = l.atRiser * layout.riserHeight;
    out.push({ rect: l, from: h, to: h });
  }
  return out;
}

/** Does a railing point rest on some walkable surface, at that surface's height? */
function onSurface(p: { x: number; y: number; base: number }, layout: StairLayout): boolean {
  const tol = STAIR_RAILING_POST_THICKNESS / 2 + 1e-6;
  return surfaces(layout).some(({ rect, from, to }) => {
    if (distToRect(p, rect) > tol) return false;
    const lo = Math.min(from, to) - 1e-6;
    const hi = Math.max(from, to) + 1e-6;
    return p.base >= lo && p.base <= hi;
  });
}

console.log('=== railings ===');
for (const type of types) {
  for (const [width, depth] of sizes) {
    for (const riserCount of [3, 14, 22]) {
      const stair = makeStair({ stairType: type, width, depth, riserCount });
      const layout = buildStairLayout(stair) as StairLayout;
      const fp = layout.footprint;
      const label = `${type} ${width}x${depth} / ${riserCount} risers`;
      const runs = buildStairRailings(stair, layout);

      check(`${label}: railed on both hands by default`,
        runs.length === 2 && runs.some((r) => r.side === 'left') && runs.some((r) => r.side === 'right'),
        JSON.stringify(runs.map((r) => r.side)));

      for (const run of runs) {
        const pts = run.points;
        check(`${label} ${run.side}: railing has a path`, pts.length >= 2, `${pts.length} points`);
        check(`${label} ${run.side}: inside the footprint`,
          pts.every((p) => Math.abs(p.x) <= fp.width / 2 + EPS && Math.abs(p.y) <= fp.depth / 2 + EPS),
          JSON.stringify(pts.filter((p) => Math.abs(p.x) > fp.width / 2 + EPS || Math.abs(p.y) > fp.depth / 2 + EPS)));
        check(`${label} ${run.side}: every point rests on the stair`,
          pts.every((p) => onSurface(p, layout)),
          JSON.stringify(pts.filter((p) => !onSurface(p, layout))));
        check(`${label} ${run.side}: climbs from the floor to the storey above`,
          Math.abs(pts[0].base) < 1e-6 && Math.abs(pts[pts.length - 1].base - STAIR_TOTAL_RISE) < 1e-6,
          `${pts[0].base} -> ${pts[pts.length - 1].base}`);
        check(`${label} ${run.side}: never descends along the run`,
          pts.every((p, i) => i === 0 || p.base >= pts[i - 1].base - 1e-6));
        check(`${label} ${run.side}: no zero-length segment`,
          pts.every((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 1e-6));

        // Posts: one at each end, one at every corner, and none further apart
        // than the target spacing.
        const posts = railingPostPositions(run);
        const first = posts[0];
        const last = posts[posts.length - 1];
        check(`${label} ${run.side}: posts start and end the railing`,
          Math.hypot(first.x - pts[0].x, first.y - pts[0].y) < 1e-6 &&
            Math.hypot(last.x - pts[pts.length - 1].x, last.y - pts[pts.length - 1].y) < 1e-6);
        check(`${label} ${run.side}: posts respect the spacing`,
          posts.every((p, i) => i === 0 ||
            Math.hypot(p.x - posts[i - 1].x, p.y - posts[i - 1].y) <= STAIR_RAILING_POST_SPACING + 1e-6));
        check(`${label} ${run.side}: a post at every corner`,
          pts.every((v) => posts.some((p) => Math.hypot(p.x - v.x, p.y - v.y) < 1e-6)));
        check(`${label} ${run.side}: posts rest on the stair`,
          posts.every((p) => onSurface(p, layout)),
          JSON.stringify(posts.filter((p) => !onSurface(p, layout)).slice(0, 3)));
      }

      // The two hands must not be the same line, or one side of the stair
      // would be left open with two railings stacked on the other.
      if (runs.length === 2) {
        const [a, b] = runs;
        check(`${label}: the two railings are on opposite hands`,
          JSON.stringify(a.points) !== JSON.stringify(b.points));
        // First flight: left hand towards -x, right hand towards +x, since
        // flights always start by climbing towards -y.
        const left = runs.find((r) => r.side === 'left')!;
        const right = runs.find((r) => r.side === 'right')!;
        check(`${label}: left hand is the -x side at the foot`,
          left.points[0].x < right.points[0].x,
          `left ${left.points[0].x} vs right ${right.points[0].x}`);
      }
    }
  }
}

// Turning stairs: the railing must actually go round the turn rather than stop
// at the landing, so it needs more than the two ends of a single flight.
console.log('=== railings across turns ===');
for (const type of ['l-shaped', 'u-shaped'] as StairType[]) {
  const stair = makeStair({ stairType: type });
  const layout = buildStairLayout(stair) as StairLayout;
  const runs = buildStairRailings(stair, layout);
  const landingHeight = layout.landings[0].atRiser * layout.riserHeight;
  for (const run of runs) {
    check(`${type} ${run.side}: railing turns with the stair`, run.points.length >= 3,
      JSON.stringify(run.points));
    check(`${type} ${run.side}: railing passes the landing at landing height`,
      run.points.some((p) => Math.abs(p.base - landingHeight) < 1e-6));
  }
  // The outer railing wraps around the landing, so it takes the longer path.
  const left = runs.find((r) => r.side === 'left')!;
  const right = runs.find((r) => r.side === 'right')!;
  const len = (r: StairRailingRun) =>
    r.points.reduce((a, p, i) => (i === 0 ? 0 : a + Math.hypot(p.x - r.points[i - 1].x, p.y - r.points[i - 1].y)), 0);
  check(`${type}: outer railing is the longer one`, len(left) > len(right),
    `left ${len(left).toFixed(1)} vs right ${len(right).toFixed(1)}`);
}

// Spiral: one railing, along the open outer edge, following the treads up.
console.log('=== spiral railing ===');
for (const width of [60, 100, 160]) {
  const stair = makeStair({ stairType: 'spiral', width });
  const layout = buildStairLayout(stair);
  if (layout.type !== 'spiral') continue;
  const runs = buildStairRailings(stair, layout);
  check(`spiral ${width}: a single railing on the open outer edge`, runs.length === 1,
    JSON.stringify(runs.map((r) => r.side)));
  const pts = runs[0]?.points ?? [];
  check(`spiral ${width}: one point per tread edge`, pts.length === layout.riserCount + 1,
    `${pts.length} points for ${layout.riserCount} treads`);
  check(`spiral ${width}: follows the outer edge, inside the footprint`,
    pts.every((p) => {
      const r = Math.hypot(p.x, p.y);
      return r <= layout.radius + EPS && r > layout.postRadius;
    }));
  check(`spiral ${width}: climbs from the floor to the storey above`,
    Math.abs(pts[0].base) < 1e-6 && Math.abs(pts[pts.length - 1].base - STAIR_TOTAL_RISE) < 1e-6);
  check(`spiral ${width}: rises one riser per tread`,
    pts.every((p, i) => i === 0 || Math.abs(p.base - pts[i - 1].base - layout.riserHeight) < 1e-9));
}

// Railings are removable, side by side, and their height is configurable.
console.log('=== railing options ===');
for (const type of [...types, 'spiral' as StairType]) {
  check(`${type}: 'none' removes every railing`,
    buildStairRailings(makeStair({ stairType: type, railings: 'none' })).length === 0);
  const dflt = buildStairRailings(makeStair({ stairType: type }));
  const explicitBoth = buildStairRailings(makeStair({ stairType: type, railings: 'both' }));
  check(`${type}: unset railings means both`, JSON.stringify(dflt) === JSON.stringify(explicitBoth));
  if (type === 'spiral') continue;
  for (const side of ['left', 'right'] as const) {
    const runs = buildStairRailings(makeStair({ stairType: type, railings: side }));
    check(`${type}: '${side}' keeps just that hand`,
      runs.length === 1 && runs[0].side === side, JSON.stringify(runs.map((r) => r.side)));
    const both = dflt.find((r) => r.side === side)!;
    check(`${type}: '${side}' is the same railing as with both`,
      JSON.stringify(runs[0].points) === JSON.stringify(both.points));
  }
}
{
  check('railing height defaults to the standard height',
    stairRailingHeight(makeStair({})) === STAIR_RAILING_HEIGHT);
  check('railing height is configurable', stairRailingHeight(makeStair({ railingHeight: 110 })) === 110);
  check('silly railing heights fall back to something usable',
    stairRailingHeight(makeStair({ railingHeight: 0 })) === STAIR_RAILING_HEIGHT &&
      stairRailingHeight(makeStair({ railingHeight: 2 })) >= 30);
}

console.log(failures === 0 ? '\nAll stair layout checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
