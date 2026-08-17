/**
 * Test script: verify the shared railing geometry — post distribution along a
 * path, and the railing a hidden wall carries in place of a terrace or balcony
 * perimeter (it has to sit on the wall's own line, curve included).
 * Run with: npx tsx test-railings.ts
 */
import {
  railingHeight,
  railingPostPositions,
  wallHasRailing,
  wallPointAt,
  wallRailingHeight,
  wallRailingPath,
  RAILING_HEIGHT,
  RAILING_MIN_HEIGHT,
  RAILING_POST_SPACING,
  type RailingPoint
} from './src/lib/utils/railings.js';
import type { Point, Wall } from './src/lib/models/types.js';

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

function makeWall(overrides: Partial<Wall>): Wall {
  return {
    id: 'w1',
    start: { x: 0, y: 0 },
    end: { x: 400, y: 0 },
    thickness: 10,
    height: 260,
    color: '#cccccc',
    ...overrides
  };
}

function pathLength(points: { x: number; y: number }[]): number {
  return points.reduce(
    (a, p, i) => (i === 0 ? 0 : a + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y)),
    0
  );
}

/** Closest distance from a point to the wall's centreline, sampled finely. */
function distToWallLine(p: Point, wall: Wall): number {
  let best = Infinity;
  for (let i = 0; i <= 2000; i++) {
    const q = wallPointAt(wall, i / 2000);
    best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
  }
  return best;
}

// ── Which walls carry a railing ──────────────────────────────────────
//
// Only a hidden wall can: a wall that is actually built already stops you, and
// a railing inside it would never be seen.
console.log('=== railing ownership ===');
check('a plain wall carries no railing', !wallHasRailing(makeWall({})));
check('a hidden wall carries none by default', !wallHasRailing(makeWall({ hidden: true })));
check('a hidden wall asked for one carries it', wallHasRailing(makeWall({ hidden: true, railing: true })));
check(
  'a built wall never carries one, even if the flag is set',
  !wallHasRailing(makeWall({ railing: true })),
  'a solid wall already stops you'
);

// ── Heights ──────────────────────────────────────────────────────────
console.log('=== heights ===');
check('unset height falls back to the default', railingHeight(undefined) === RAILING_HEIGHT);
check('height is configurable', railingHeight(110) === 110);
check('zero falls back to the default', railingHeight(0) === RAILING_HEIGHT);
check('negative falls back to the default', railingHeight(-50) === RAILING_HEIGHT);
check('silly small heights are clamped to something usable', railingHeight(3) === RAILING_MIN_HEIGHT);
check('a wall reports its own height', wallRailingHeight(makeWall({ railingHeight: 100 })) === 100);
check('a wall without one reports the default', wallRailingHeight(makeWall({})) === RAILING_HEIGHT);

// ── Posts along a path ───────────────────────────────────────────────
//
// One at each end, one at every corner, and no gap wider than the target
// spacing — whatever shape the path is.
console.log('=== posts ===');
const paths: Array<[string, RailingPoint[]]> = [
  ['straight 400cm', [{ x: 0, y: 0, base: 0 }, { x: 400, y: 0, base: 0 }]],
  ['short 12cm', [{ x: 0, y: 0, base: 0 }, { x: 12, y: 0, base: 0 }]],
  ['climbing', [{ x: 0, y: 0, base: 0 }, { x: 300, y: 0, base: 260 }]],
  ['cornered', [
    { x: 0, y: 0, base: 0 },
    { x: 200, y: 0, base: 0 },
    { x: 200, y: 150, base: 0 },
    { x: 40, y: 150, base: 0 }
  ]],
  ['degenerate segment', [
    { x: 0, y: 0, base: 0 },
    { x: 0, y: 0, base: 0 },
    { x: 100, y: 0, base: 0 }
  ]]
];
for (const [label, path] of paths) {
  const posts = railingPostPositions(path);
  check(`${label}: a post at each end`,
    Math.hypot(posts[0].x - path[0].x, posts[0].y - path[0].y) < EPS &&
      Math.hypot(posts[posts.length - 1].x - path[path.length - 1].x,
        posts[posts.length - 1].y - path[path.length - 1].y) < EPS);
  check(`${label}: a post at every corner`,
    path.every((v) => posts.some((p) => Math.hypot(p.x - v.x, p.y - v.y) < EPS)));
  check(`${label}: no gap wider than the spacing`,
    posts.every((p, i) => i === 0 ||
      Math.hypot(p.x - posts[i - 1].x, p.y - posts[i - 1].y) <= RAILING_POST_SPACING + EPS),
    JSON.stringify(posts.map((p, i) => i === 0 ? 0 : Math.round(Math.hypot(p.x - posts[i - 1].x, p.y - posts[i - 1].y)))));
  check(`${label}: heights interpolate along the path`,
    posts.every((p) => p.base >= -EPS && p.base <= Math.max(...path.map((v) => v.base)) + EPS));
  check(`${label}: at least two posts`, posts.length >= 2, `${posts.length}`);
}
check('an empty path yields no posts', railingPostPositions([]).length === 0);
{
  // A wide spacing must still post the ends and corners, never fewer.
  const posts = railingPostPositions(paths[3][1], 10_000);
  check('a huge spacing still posts every corner', posts.length === paths[3][1].length,
    `${posts.length} posts for ${paths[3][1].length} points`);
}

// ── The path a wall's railing follows ────────────────────────────────
console.log('=== straight wall railing ===');
for (const [sx, sy, ex, ey] of [[0, 0, 400, 0], [-150, 80, 200, -300], [0, 0, 0, 250]]) {
  const wall = makeWall({ hidden: true, railing: true, start: { x: sx, y: sy }, end: { x: ex, y: ey } });
  const path = wallRailingPath(wall);
  const label = `(${sx},${sy})->(${ex},${ey})`;
  check(`${label}: runs end to end of the wall`,
    path.length === 2 &&
      Math.hypot(path[0].x - sx, path[0].y - sy) < EPS &&
      Math.hypot(path[1].x - ex, path[1].y - ey) < EPS,
    JSON.stringify(path));
  check(`${label}: stands on the floor`, path.every((p) => p.base === 0));
  check(`${label}: as long as the wall`,
    Math.abs(pathLength(path) - Math.hypot(ex - sx, ey - sy)) < EPS);
}
check('a wall too short to build gets no railing',
  wallRailingPath(makeWall({ hidden: true, railing: true, end: { x: 0.5, y: 0 } })).length === 0);

console.log('=== curved wall railing ===');
for (const bulge of [60, -200, 400]) {
  const wall = makeWall({
    hidden: true, railing: true,
    start: { x: 0, y: 0 }, end: { x: 400, y: 0 },
    curvePoint: { x: 200, y: bulge }
  });
  const path = wallRailingPath(wall);
  const label = `bulge ${bulge}`;
  check(`${label}: traced with several points`, path.length >= 9, `${path.length} points`);
  check(`${label}: starts and ends on the wall's ends`,
    Math.hypot(path[0].x - wall.start.x, path[0].y - wall.start.y) < EPS &&
      Math.hypot(path[path.length - 1].x - wall.end.x, path[path.length - 1].y - wall.end.y) < EPS);
  check(`${label}: every point sits on the wall's line`,
    path.every((p) => distToWallLine(p, wall) < 0.5),
    JSON.stringify(path.filter((p) => distToWallLine(p, wall) >= 0.5)));
  check(`${label}: follows the curve instead of cutting the chord`,
    pathLength(path) > Math.hypot(400, 0) + 1,
    `path ${pathLength(path).toFixed(1)} vs chord 400`);
  check(`${label}: stands on the floor`, path.every((p) => p.base === 0));
  // Posts must land on the curve too, not on the chords between samples.
  const posts = railingPostPositions(path);
  check(`${label}: posts stay on the wall's line`,
    posts.every((p) => distToWallLine(p, wall) < 2),
    JSON.stringify(posts.filter((p) => distToWallLine(p, wall) >= 2).slice(0, 3)));
  check(`${label}: posts respect the spacing`,
    posts.every((p, i) => i === 0 ||
      Math.hypot(p.x - posts[i - 1].x, p.y - posts[i - 1].y) <= RAILING_POST_SPACING + EPS));
}

// A curve is sampled by length, but never without bound.
{
  const long = makeWall({
    hidden: true, railing: true,
    start: { x: 0, y: 0 }, end: { x: 20_000, y: 0 },
    curvePoint: { x: 10_000, y: 4000 }
  });
  check('a very long curve stays within the sample budget',
    wallRailingPath(long).length <= 65, `${wallRailingPath(long).length} points`);
}

console.log(failures === 0 ? '\nAll railing checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
