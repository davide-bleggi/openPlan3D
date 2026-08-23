/**
 * Test script: file-backed project sync (issue #29).
 * Run with: npx tsx test-project-file-sync.ts
 *
 * Covers the decision logic that keeps two devices writing the same file from
 * losing each other's work, plus the file format itself.
 */
import {
  MTIME_TOLERANCE_MS,
  SYNC_META_KEY,
  compareRemote,
  decideSync,
  isEmptyFile,
  isLocalDirty,
  nextRevision,
  parseProjectFile,
  projectSignature,
  readSyncMeta,
  reviveProject,
  serializeProjectFile,
  suggestedFileName,
  type SyncMeta,
  type SyncStamp,
} from './src/lib/utils/projectFileSync.js';
import type { Project } from './src/lib/models/types.js';

let passed = 0, failed = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  check(name, g === w, `got ${g}, want ${w}`);
}
function throws(name: string, fn: () => unknown, match?: RegExp) {
  try {
    fn();
    check(name, false, 'did not throw');
  } catch (e: any) {
    check(name, !match || match.test(e.message), `message was "${e.message}"`);
  }
}

// ── Fixtures ────────────────────────────────────────────────────────

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Casa',
    floors: [
      {
        id: 'f1', name: 'Ground', level: 0,
        walls: [{ id: 'w1', start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, thickness: 15, height: 280, color: '#444' }],
        rooms: [], doors: [], windows: [], furniture: [], stairs: [], columns: [],
        guides: [], measurements: [], annotations: [], textAnnotations: [], groups: [],
      },
    ],
    activeFloorId: 'f1',
    createdAt: new Date('2026-08-01T10:00:00Z'),
    updatedAt: new Date('2026-08-15T10:00:00Z'),
    ...overrides,
  };
}

const meta = (revision: number, deviceId = 'devA'): SyncMeta =>
  ({ revision, deviceId, savedAt: new Date('2026-08-15T10:00:00Z').toISOString() });

const stamp = (revision: number | null, mtime: number): SyncStamp => ({ revision, mtime });

// ── Local dirtiness ─────────────────────────────────────────────────

console.log('=== is the open project ahead of the file? ===');
{
  const synced = project();
  const signature = projectSignature(synced);
  check('never synced counts as dirty', isLocalDirty(synced, null));
  check('untouched since the last sync', !isLocalDirty(project(), signature));
  check('renamed since the last sync', isLocalDirty(project({ name: 'Casa 2' }), signature));
  check('a wall moved since the last sync', isLocalDirty(
    project({ floors: [{ ...synced.floors[0], walls: [{ ...synced.floors[0].walls[0], end: { x: 500, y: 0 } }] }] }),
    signature,
  ));
  // Timestamps are deliberately not the signal: a device whose clock runs fast
  // must not make later edits elsewhere look like they predate the sync.
  check('a clock a minute ahead does not mask an edit', isLocalDirty(
    project({ name: 'Casa 2', updatedAt: new Date('2026-08-15T09:00:00Z') }),
    signature,
  ));
  check('the same content with a bumped clock is still an edit', isLocalDirty(
    project({ updatedAt: new Date('2026-08-15T11:00:00Z') }),
    signature,
  ));
  eq('the same project always fingerprints the same', projectSignature(project()), signature);
}

// ── Where the file sits ─────────────────────────────────────────────

console.log('\n=== where the file sits relative to us ===');
eq('same revision', compareRemote(stamp(3, 100), stamp(3, 100)), 'same');
eq('same revision, mtime rewritten by the sync service', compareRemote(stamp(3, 100), stamp(3, 999_999)), 'same');
eq('someone wrote a newer revision', compareRemote(stamp(3, 100), stamp(4, 200)), 'ahead');
eq('a stale copy came back', compareRemote(stamp(4, 200), stamp(3, 100)), 'behind');
eq('no metadata: untouched mtime', compareRemote(stamp(null, 1000), stamp(null, 1000)), 'same');
eq('no metadata: mtime within the filesystem\'s slop', compareRemote(stamp(null, 1000), stamp(null, 1000 + MTIME_TOLERANCE_MS)), 'same');
eq('no metadata: clearly later mtime', compareRemote(stamp(null, 1000), stamp(null, 1000 + MTIME_TOLERANCE_MS + 1)), 'ahead');
eq('no metadata: earlier mtime is not treated as a rollback', compareRemote(stamp(null, 5000), stamp(null, 1000)), 'same');

// ── The policy ──────────────────────────────────────────────────────

console.log('\n=== who may overwrite whom ===');
eq('nothing to do', decideSync(stamp(3, 100), stamp(3, 100), false), 'up-to-date');
eq('our edits over an untouched file', decideSync(stamp(3, 100), stamp(3, 100), true), 'write');
eq('their version, we have no edits', decideSync(stamp(3, 100), stamp(4, 200), false), 'pull');
eq('their version, we have edits', decideSync(stamp(3, 100), stamp(4, 200), true), 'conflict');
eq('a rollback is never silent, clean', decideSync(stamp(4, 200), stamp(3, 100), false), 'conflict');
eq('a rollback is never silent, dirty', decideSync(stamp(4, 200), stamp(3, 100), true), 'conflict');
eq('a plain exported file we are ahead of', decideSync(stamp(null, 1000), stamp(null, 1000), true), 'write');
eq('a plain exported file someone else touched', decideSync(stamp(null, 1000), stamp(null, 9000), true), 'conflict');

console.log('\n=== the revision a write should carry ===');
eq('first write into an empty file', nextRevision(null), 1);
eq('one past what the file holds', nextRevision(meta(7)), 8);
eq('never below what we already synced', nextRevision(meta(2), 5), 6);
eq('the file wins when it is ahead', nextRevision(meta(9), 5), 10);

// ── The file format ─────────────────────────────────────────────────

console.log('\n=== the file format ===');
const text = serializeProjectFile(project(), meta(4, 'devA'));
const raw = JSON.parse(text);
eq('metadata rides along under one key', raw[SYNC_META_KEY].revision, 4);
eq('which device wrote it', raw[SYNC_META_KEY].deviceId, 'devA');
check('the project stays plain JSON an import can read', !!raw.id && Array.isArray(raw.floors) && !!raw.activeFloorId);

const parsed = parseProjectFile(text);
eq('the revision reads back', parsed.meta?.revision, 4);
eq('the project reads back', parsed.project.name, 'Casa');
eq('walls survive the round trip', parsed.project.floors[0].walls[0].id, 'w1');
check('dates come back as Dates', parsed.project.updatedAt instanceof Date);
check('the metadata is kept out of the project', !(SYNC_META_KEY in (parsed.project as any)));

const plainExport = JSON.stringify(project());
eq('a hand-exported project has no metadata', parseProjectFile(plainExport).meta, null);
eq('and still opens', parseProjectFile(plainExport).project.id, 'p1');
eq('junk metadata is ignored', readSyncMeta({ [SYNC_META_KEY]: { revision: 'four' } }), null);

console.log('\n=== files that are not ours ===');
throws('not JSON at all', () => parseProjectFile('<html>nope</html>'), /valid JSON/);
throws('JSON, but not a project', () => parseProjectFile('{"hello":"world"}'), /project id/);
throws('a project with no floors', () => parseProjectFile('{"id":"x","floors":[]}'), /no floors/);
throws('a floor with no walls', () => parseProjectFile('{"id":"x","floors":[{"id":"f"}]}'), /without an id or walls/);
check('an empty file is recognised, not rejected', isEmptyFile('   \n '));
check('a written file is not empty', !isEmptyFile(text));

console.log('\n=== older files are brought up to date ===');
const old = reviveProject({ id: 'p2', floors: [{ id: 'f9', walls: [] }] });
eq('missing per-floor arrays are filled in', [old.floors[0].doors, old.floors[0].stairs, old.floors[0].groups], [[], [], []]);
eq('a missing active floor falls back to the first', old.activeFloorId, 'f9');
check('missing dates are invented rather than left undefined', old.updatedAt instanceof Date);

console.log('\n=== suggested file name ===');
eq('takes the project name', suggestedFileName('Casa al mare'), 'Casa al mare.openplan.json');
eq('path characters are stripped', suggestedFileName('a/b:c*d'), 'a-b-c-d.openplan.json');
eq('an unnamed project still gets a name', suggestedFileName('   '), 'floorplan.openplan.json');

// ── Two devices, one file ───────────────────────────────────────────
//
// A fake file plus the two devices' bookkeeping, driven through the same
// functions the app uses. This is the scenario the issue is about: no server,
// just a file that appears on the other machine some time later.

interface FakeFile { text: string; mtime: number; }
interface Device {
  name: string;
  project: Project;
  /** What this device knew about the file at its last read or write. */
  base: SyncStamp;
  syncedSignature: string | null;
}

let clock = 1_000_000;
const tick = () => (clock += 60_000);

function edit(device: Device, name: string) {
  device.project = { ...device.project, name, updatedAt: new Date(tick()) };
}

function push(device: Device, file: FakeFile): string {
  const remoteMeta = isEmptyFile(file.text) ? null : parseProjectFile(file.text).meta;
  const remote = stamp(remoteMeta?.revision ?? null, file.mtime);
  const verdict = decideSync(device.base, remote, isLocalDirty(device.project, device.syncedSignature));
  if (verdict !== 'write') return verdict;
  const revision = nextRevision(remoteMeta, device.base.revision);
  file.text = serializeProjectFile(device.project, { revision, deviceId: device.name, savedAt: new Date(tick()).toISOString() });
  file.mtime = tick();
  device.base = stamp(revision, file.mtime);
  device.syncedSignature = projectSignature(device.project);
  return verdict;
}

/** Joining a project already in the file — what "open from file" does. */
function adopt(device: Device, file: FakeFile) {
  const { project: remote, meta: remoteMeta } = parseProjectFile(file.text);
  device.project = remote;
  device.base = stamp(remoteMeta?.revision ?? null, file.mtime);
  device.syncedSignature = projectSignature(remote);
}

function poll(device: Device, file: FakeFile): string {
  const { project: remote, meta: remoteMeta } = parseProjectFile(file.text);
  const verdict = decideSync(
    device.base,
    stamp(remoteMeta?.revision ?? null, file.mtime),
    isLocalDirty(device.project, device.syncedSignature),
  );
  if (verdict === 'pull') {
    device.project = remote;
    device.base = stamp(remoteMeta?.revision ?? null, file.mtime);
    device.syncedSignature = projectSignature(remote);
  }
  return verdict;
}

const newDevice = (name: string, p: Project): Device =>
  ({ name, project: p, base: stamp(null, 0), syncedSignature: null });

console.log('\n=== two devices, one synced file ===');
{
  const file: FakeFile = { text: '', mtime: 0 };
  const laptop = newDevice('laptop', project());
  edit(laptop, 'Casa — laptop');
  eq('the laptop writes into the empty file', push(laptop, file), 'write');
  eq('it is revision 1', parseProjectFile(file.text).meta?.revision, 1);

  // The sync service drops the file on the desktop, where the user opens it.
  const desktop = newDevice('desktop', project());
  adopt(desktop, file);
  eq('the desktop sees the laptop\'s work', desktop.project.name, 'Casa — laptop');
  eq('and has nothing of its own to push', push(desktop, file), 'up-to-date');

  edit(desktop, 'Casa — desktop');
  eq('the desktop writes back', push(desktop, file), 'write');
  eq('it is revision 2', parseProjectFile(file.text).meta?.revision, 2);

  eq('the laptop, idle, picks that up', poll(laptop, file), 'pull');
  eq('and now shows the desktop\'s work', laptop.project.name, 'Casa — desktop');
  eq('with nothing left to push', push(laptop, file), 'up-to-date');
}

console.log('\n=== both edited: nothing is overwritten ===');
{
  const file: FakeFile = { text: '', mtime: 0 };
  const laptop = newDevice('laptop', project());
  const desktop = newDevice('desktop', project());
  edit(laptop, 'Casa v1');
  push(laptop, file);
  adopt(desktop, file);

  // Both go on editing; the desktop saves first.
  edit(laptop, 'Casa — laptop branch');
  edit(desktop, 'Casa — desktop branch');
  eq('the desktop gets its write in', push(desktop, file), 'write');

  eq('the laptop is stopped rather than clobbering it', push(laptop, file), 'conflict');
  eq('and polling reports the same clash', poll(laptop, file), 'conflict');
  eq('the file still holds the desktop version', parseProjectFile(file.text).project.name, 'Casa — desktop branch');
  eq('the laptop still holds its own', laptop.project.name, 'Casa — laptop branch');

  // Resolved by keeping the laptop's copy: a forced write, one revision on.
  const remoteMeta = parseProjectFile(file.text).meta;
  const revision = nextRevision(remoteMeta, laptop.base.revision);
  eq('keeping ours moves the file forward, not back', revision, (remoteMeta?.revision ?? 0) + 1);
}

console.log('\n=== a stale copy comes back ===');
{
  const file: FakeFile = { text: '', mtime: 0 };
  const laptop = newDevice('laptop', project());
  edit(laptop, 'Casa v1');
  push(laptop, file);
  edit(laptop, 'Casa v2');
  push(laptop, file);

  // The sync service restores an older copy over the top.
  file.text = serializeProjectFile(project({ name: 'Casa v1' }), meta(1, 'laptop'));
  file.mtime = tick();
  eq('an idle device does not step backwards on its own', poll(laptop, file), 'conflict');
  eq('nor does a write go out blind', push(laptop, file), 'conflict');
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
