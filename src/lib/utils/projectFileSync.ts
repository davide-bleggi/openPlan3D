/**
 * File-backed project sync — the pure part (issue #29).
 *
 * A project can be given a single JSON file as its "base". The app writes the
 * project to that file; keeping the file in a folder that some third-party
 * service already syncs (iCloud Drive, Dropbox, Syncthing, a network share…)
 * is what carries it between devices. No server of ours is involved, and there
 * is no account system — the sync service moves the bytes, the app just owns
 * the file.
 *
 * The tricky part is that two devices can write the same file, and the sync
 * service can hand us a copy that arrived late. This module holds the decision
 * logic for that, free of any browser API so it can be tested on its own:
 * given what we knew about the file at our last read or write, what is in it
 * now, and whether we have local edits, it says whether to write, to adopt the
 * file, or to stop and ask.
 */
import type { Project } from '$lib/models/types';

/** Key the sync metadata is stored under inside the project file. */
export const SYNC_META_KEY = 'openplanSync';

/**
 * File mtimes are coarse on some filesystems and sync services rewrite
 * timestamps, so a file is only "touched by someone else" once its mtime moves
 * by more than this. Only used for files that carry no revision of ours.
 */
export const MTIME_TOLERANCE_MS = 1000;

/** Bookkeeping we add to the file so two devices can order their writes. */
export interface SyncMeta {
  /** Bumped on every write. The authority for "who is ahead". */
  revision: number;
  /** Which browser wrote this revision — so a device can spot its own writes. */
  deviceId: string;
  /** When it was written, for display only; device clocks disagree. */
  savedAt: string;
}

/** What we knew about the file at our last successful read or write. */
export interface SyncStamp {
  /** Revision read from the file, or null for a file that carries none. */
  revision: number | null;
  /** The file's lastModified at that moment. */
  mtime: number;
}

/**
 * - `up-to-date` — the file holds what we last synced and we have nothing new.
 * - `write` — we are ahead of an untouched file: safe to overwrite.
 * - `pull` — the file moved on and we have no local edits: adopt it.
 * - `conflict` — both sides moved, or the file went backwards. Ask the user.
 */
export type SyncVerdict = 'up-to-date' | 'write' | 'pull' | 'conflict';

/** How the file compares to the revision we last synced with. */
export type RemotePosition = 'same' | 'ahead' | 'behind';

/**
 * A content fingerprint of the project — what "unchanged since the last sync"
 * means here. Timestamps look like the obvious answer and are the wrong one:
 * two devices' clocks disagree, so a project pulled from a device running a
 * minute fast would make every later local edit look older than the sync and
 * therefore clean. A digest of the content has no such opinion.
 *
 * FNV-1a in two lanes, which is plenty for spotting "this changed" and costs a
 * fraction of the stringify the undo stack already does on every edit.
 */
export function projectSignature(project: Project): string {
  const text = JSON.stringify(project);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** Does the project carry edits made since we last synced it to the file? */
export function isLocalDirty(project: Project, syncedSignature: string | null): boolean {
  if (!syncedSignature) return true;
  return projectSignature(project) !== syncedSignature;
}

/** Where the file sits relative to the revision we last synced with. */
export function compareRemote(base: SyncStamp, remote: SyncStamp): RemotePosition {
  if (base.revision !== null && remote.revision !== null) {
    if (remote.revision === base.revision) return 'same';
    return remote.revision > base.revision ? 'ahead' : 'behind';
  }
  // A file without our metadata (a hand-exported JSON, say) — all we have is
  // its timestamp. Treat only a clearly later mtime as someone else's write.
  if (remote.mtime > base.mtime + MTIME_TOLERANCE_MS) return 'ahead';
  return 'same';
}

/**
 * The whole conflict policy, in one place. A write only ever goes out over a
 * file that is where we left it: anything else stops and asks rather than
 * dropping one side's work.
 */
export function decideSync(base: SyncStamp, remote: SyncStamp, localDirty: boolean): SyncVerdict {
  switch (compareRemote(base, remote)) {
    case 'same':
      return localDirty ? 'write' : 'up-to-date';
    case 'ahead':
      // Someone else wrote. Adopting is only lossless while we hold no edits.
      return localDirty ? 'conflict' : 'pull';
    case 'behind':
      // The file is older than the revision we already have — a sync service
      // restoring a stale copy, or a device that never saw our writes. Never
      // silently step backwards.
      return 'conflict';
  }
}

/** The revision number a write should carry, given what is in the file now. */
export function nextRevision(remoteMeta: SyncMeta | null, baseRevision: number | null = null): number {
  return Math.max(remoteMeta?.revision ?? 0, baseRevision ?? 0) + 1;
}

/**
 * Project files are plain project JSON — the same shape "Download JSON"
 * produces, so they stay importable by hand — with our bookkeeping added under
 * a single extra key.
 */
export function serializeProjectFile(project: Project, meta: SyncMeta): string {
  return JSON.stringify({ ...project, [SYNC_META_KEY]: meta }, null, 2);
}

/** Read the sync metadata out of parsed file contents, if it has any. */
export function readSyncMeta(data: unknown): SyncMeta | null {
  const meta = (data as Record<string, unknown> | null)?.[SYNC_META_KEY] as Partial<SyncMeta> | undefined;
  if (!meta || typeof meta.revision !== 'number' || !Number.isFinite(meta.revision)) return null;
  return {
    revision: meta.revision,
    deviceId: typeof meta.deviceId === 'string' ? meta.deviceId : 'unknown',
    savedAt: typeof meta.savedAt === 'string' ? meta.savedAt : new Date(0).toISOString(),
  };
}

/**
 * Validate and normalise a project read from disk: the file may have been
 * written by an older version, hand-edited, or be something else entirely.
 * Throws with a message meant for the user.
 */
export function reviveProject(data: any): Project {
  if (!data || typeof data !== 'object') throw new Error('The file does not contain a project.');
  if (!data.id || typeof data.id !== 'string') throw new Error('The file is missing a project id.');
  if (!Array.isArray(data.floors) || data.floors.length === 0) {
    throw new Error('The file has no floors — it is not an openPlan3D project.');
  }
  for (const floor of data.floors) {
    if (!floor?.id || !Array.isArray(floor.walls)) {
      throw new Error('The file has a floor without an id or walls.');
    }
    // Older files predate some of the per-floor arrays.
    floor.rooms ??= [];
    floor.doors ??= [];
    floor.windows ??= [];
    floor.furniture ??= [];
    floor.stairs ??= [];
    floor.columns ??= [];
    floor.guides ??= [];
    floor.measurements ??= [];
    floor.annotations ??= [];
    floor.textAnnotations ??= [];
    floor.groups ??= [];
  }
  if (!data.activeFloorId || !data.floors.some((f: any) => f.id === data.activeFloorId)) {
    data.activeFloorId = data.floors[0].id;
  }
  data.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
  data.updatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date();
  delete data[SYNC_META_KEY];
  return data as Project;
}

export interface ParsedProjectFile {
  project: Project;
  meta: SyncMeta | null;
}

/** Parse a project file's text. Throws with a user-facing message. */
export function parseProjectFile(text: string): ParsedProjectFile {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  const meta = readSyncMeta(data);
  return { project: reviveProject(data), meta };
}

/** Is this text an empty file (a freshly created one, before our first write)? */
export function isEmptyFile(text: string): boolean {
  return text.trim().length === 0;
}

/**
 * Nothing has ever been drawn in this project — it is indistinguishable from
 * the blank one the editor makes for itself when it opens without a project.
 * Used to decide whether such a throwaway can be cleared out once the file it
 * was pointed at turns out to hold a different project.
 */
export function isEmptyProject(project: Project): boolean {
  if (project.floors.length !== 1) return false;
  return project.floors.every(
    (f) =>
      !f.walls?.length &&
      !f.rooms?.length &&
      !f.doors?.length &&
      !f.windows?.length &&
      !f.furniture?.length &&
      !f.stairs?.length &&
      !f.columns?.length &&
      !f.entourage?.length &&
      !f.guides?.length &&
      !f.measurements?.length &&
      !f.annotations?.length &&
      !f.textAnnotations?.length &&
      !f.backgroundImage,
  );
}

/** Default filename offered when a project is first given a file. */
export function suggestedFileName(projectName: string): string {
  const safe = (projectName || 'floorplan')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 60) || 'floorplan';
  return `${safe}.openplan.json`;
}
