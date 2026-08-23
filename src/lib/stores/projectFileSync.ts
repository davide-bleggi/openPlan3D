/**
 * File-backed project sync — the moving parts (issue #29).
 *
 * Gives a project a single file as its base: the app autosaves into it, reads
 * it back when the project is reopened, and watches it while the editor is
 * open so a copy that arrives from another device is noticed. Whatever puts
 * the file on the other device — iCloud Drive, Dropbox, Syncthing, a shared
 * folder — is none of the app's business, which is the whole point: no server,
 * no account, no cloud of ours.
 *
 * The rules for who may overwrite whom live in `$lib/utils/projectFileSync`;
 * this module is what talks to the browser and the rest of the app.
 */
import { get, writable } from 'svelte/store';
import type { Project } from '$lib/models/types';
import { currentProject, loadProject } from './project';
import { markClean } from './saveStatus';
import { localStore } from '$lib/services/datastore';
import { saveSnapshot } from './versionHistory';
import {
  checkPermission,
  deleteLink,
  getLink,
  isFileSystemAccessSupported,
  linkStamp,
  pickExistingFile,
  pickFileToCreate,
  putLink,
  readFile,
  statFile,
  writeFile,
  type ProjectFileLink,
} from '$lib/services/projectFile';
import {
  decideSync,
  isEmptyFile,
  isLocalDirty,
  nextRevision,
  parseProjectFile,
  projectSignature,
  serializeProjectFile,
  suggestedFileName,
  type SyncMeta,
} from '$lib/utils/projectFileSync';

export type FileSyncStatus =
  /** No file picker in this browser — manual export/import is the fallback. */
  | 'unsupported'
  /** Supported, but this project has no file yet. */
  | 'unlinked'
  /** Linked, but the browser dropped write permission (typically a reload). */
  | 'permission-required'
  /** Linked and settled. */
  | 'idle'
  | 'syncing'
  /** The file moved under us while we had edits — waiting on the user. */
  | 'conflict'
  | 'error';

/** The other side of a conflict, kept parsed so resolving it is instant. */
export interface FileConflict {
  /** `remote-newer`: someone else wrote while we had edits.
   *  `remote-older`: the file went backwards — a stale copy came back. */
  reason: 'remote-newer' | 'remote-older';
  project: Project;
  meta: SyncMeta | null;
  mtime: number;
}

/** A file the user picked that already holds a project — which way do we go? */
export interface PendingLink {
  handle: FileSystemFileHandle;
  fileName: string;
  project: Project;
  meta: SyncMeta | null;
  mtime: number;
}

export interface FileSyncState {
  status: FileSyncStatus;
  fileName: string | null;
  lastSyncedAt: Date | null;
  revision: number | null;
  error: string | null;
  conflict: FileConflict | null;
  pendingLink: PendingLink | null;
}

const initialState: FileSyncState = {
  status: 'unlinked',
  fileName: null,
  lastSyncedAt: null,
  revision: null,
  error: null,
  conflict: null,
  pendingLink: null,
};

export const fileSync = writable<FileSyncState>({ ...initialState });

function patch(changes: Partial<FileSyncState>) {
  fileSync.update((s) => ({ ...s, ...changes }));
}

/** How often the linked file is re-checked while the editor is open. */
const WATCH_INTERVAL_MS = 15_000;

const DEVICE_ID_KEY = 'o3d_device_id';

/** A stable id for this browser, so a device can recognise its own writes. */
function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

let link: ProjectFileLink | null = null;
let activeProjectId: string | null = null;
let watchTimer: ReturnType<typeof setInterval> | null = null;
let busy = false;

async function rememberLink(next: ProjectFileLink) {
  link = next;
  await putLink(next);
}

/** Stamp the link with what we just read from, or wrote to, the file. */
async function stampSynced(project: Project, revision: number | null, mtime: number) {
  if (!link) return;
  const syncedAt = new Date();
  await rememberLink({
    ...link,
    revision,
    mtime,
    syncedSignature: projectSignature(project),
    syncedAt: syncedAt.toISOString(),
  });
  patch({ revision, lastSyncedAt: syncedAt, status: 'idle', error: null, conflict: null });
}

function dirty(project: Project): boolean {
  return !link || isLocalDirty(project, link.syncedSignature);
}

function fail(message: string, e?: unknown) {
  if (e) console.error('[FileSync]', message, e);
  patch({ status: 'error', error: message });
}

// ── Lifecycle ───────────────────────────────────────────────────────

/**
 * Attach the sync machinery to a project. Called once the editor has the
 * project in hand: if it has a file and we still hold permission, the file is
 * read straight away, so reopening a project — here or on another device the
 * sync service has since reached — starts from what the file says.
 */
export async function initProjectFileSync(project: Project): Promise<void> {
  stopProjectFileSync();
  activeProjectId = project.id;

  if (!isFileSystemAccessSupported()) {
    fileSync.set({ ...initialState, status: 'unsupported' });
    return;
  }

  fileSync.set({ ...initialState });
  link = await getLink(project.id);
  if (!link) return;

  patch({
    status: 'idle',
    fileName: link.fileName,
    revision: link.revision,
    lastSyncedAt: link.syncedAt ? new Date(link.syncedAt) : null,
  });

  if ((await checkPermission(link.handle)) !== 'granted') {
    patch({ status: 'permission-required' });
    return;
  }

  await checkRemote();
  startWatching();
}

export function stopProjectFileSync() {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('focus', onWake);
    document.removeEventListener('visibilitychange', onWake);
  }
  link = null;
  activeProjectId = null;
}

function onWake() {
  if (document.visibilityState === 'visible') void checkRemote();
}

function startWatching() {
  if (watchTimer || typeof window === 'undefined') return;
  watchTimer = setInterval(() => void checkRemote(), WATCH_INTERVAL_MS);
  window.addEventListener('focus', onWake);
  document.addEventListener('visibilitychange', onWake);
}

/** Re-request write permission. Must be called from a user gesture. */
export async function requestFilePermission(): Promise<boolean> {
  if (!link) return false;
  const granted = (await checkPermission(link.handle, true)) === 'granted';
  if (!granted) {
    patch({ status: 'permission-required' });
    return false;
  }
  patch({ status: 'idle', error: null });
  await checkRemote();
  startWatching();
  return true;
}

// ── Reading the file ────────────────────────────────────────────────

/**
 * Look at the linked file and act on what has happened to it: nothing, someone
 * else's newer version (adopted when we hold no edits), or a clash to hand to
 * the user.
 */
export async function checkRemote(): Promise<void> {
  const project = get(currentProject);
  if (!link || !project || busy) return;
  if (get(fileSync).status === 'conflict' || get(fileSync).status === 'permission-required') return;

  busy = true;
  try {
    const mtime = await statFile(link.handle);
    const localDirty = dirty(project);
    // Nothing has touched the file since our last sync — the autosave path
    // will carry any local edits, so there is nothing to do here.
    if (mtime === link.mtime) return;

    const { text, mtime: readMtime } = await readFile(link.handle);
    if (isEmptyFile(text)) return; // freshly created, not written yet
    const { project: remote, meta } = parseProjectFile(text);
    const verdict = decideSync(linkStamp(link), { revision: meta?.revision ?? null, mtime: readMtime }, localDirty);

    if (verdict === 'pull') {
      await applyRemote(remote, meta, readMtime);
    } else if (verdict === 'conflict') {
      const reason = (meta?.revision ?? 0) < (link.revision ?? 0) ? 'remote-older' : 'remote-newer';
      patch({ status: 'conflict', conflict: { reason, project: remote, meta, mtime: readMtime } });
    } else if (verdict === 'up-to-date') {
      // Same revision, different mtime — the sync service rewrote the file.
      await stampSynced(project, link.revision, readMtime);
    }
  } catch (e: any) {
    fail(e?.message ?? 'Could not read the project file.', e);
  } finally {
    busy = false;
  }
}

/** Replace what is open with the file's version, and note that we are level. */
async function applyRemote(remote: Project, meta: SyncMeta | null, mtime: number) {
  markClean();
  loadProject(remote);
  await localStore.save(remote);
  await stampSynced(remote, meta?.revision ?? null, mtime);
}

// ── Writing the file ────────────────────────────────────────────────

/**
 * Push the project into its file, unless the file has moved on — in which case
 * we stop and raise a conflict rather than overwrite someone's work. Called by
 * the autosave loop, so it stays quiet when there is nothing to do.
 */
export async function syncProjectFile(project: Project): Promise<void> {
  const state = get(fileSync);
  if (!link || project.id !== activeProjectId || busy) return;
  if (state.status === 'conflict' || state.status === 'permission-required' || state.status === 'unsupported') return;
  if (!dirty(project)) return;
  await writeNow(project);
}

/** Write on the user's say-so, whether or not the project looks dirty. */
export async function syncNow(): Promise<void> {
  const project = get(currentProject);
  if (!project || !link) return;
  await writeNow(project, true);
}

async function writeNow(project: Project, force = false): Promise<void> {
  if (!link || busy) return;
  busy = true;
  patch({ status: 'syncing', error: null });
  try {
    const { text, mtime } = await readFile(link.handle);
    const remoteMeta = isEmptyFile(text) ? null : parseProjectFile(text).meta;
    const verdict = decideSync(linkStamp(link), { revision: remoteMeta?.revision ?? null, mtime }, true);

    if (verdict === 'conflict' && !force) {
      const remote = parseProjectFile(text).project;
      const reason = (remoteMeta?.revision ?? 0) < (link.revision ?? 0) ? 'remote-older' : 'remote-newer';
      patch({ status: 'conflict', conflict: { reason, project: remote, meta: remoteMeta, mtime } });
      return;
    }

    const meta: SyncMeta = {
      revision: nextRevision(remoteMeta, link.revision),
      deviceId: deviceId(),
      savedAt: new Date().toISOString(),
    };
    const written = await writeFile(link.handle, serializeProjectFile(project, meta));
    await stampSynced(project, meta.revision, written);
  } catch (e: any) {
    if (e?.name === 'NotAllowedError') {
      patch({ status: 'permission-required' });
    } else {
      fail(e?.message ?? 'Could not write the project file.', e);
    }
  } finally {
    busy = false;
  }
}

// ── Linking a file ──────────────────────────────────────────────────

async function inspectPickedFile(handle: FileSystemFileHandle): Promise<void> {
  const project = get(currentProject);
  if (!project) return;
  const { text, mtime } = await readFile(handle);

  if (isEmptyFile(text)) {
    await adoptHandle(handle, project, null, mtime, { write: true });
    return;
  }

  // The file already holds a project — which way it should go is the user's
  // call, so hand both sides to the dialog rather than guessing.
  const { project: existing, meta } = parseProjectFile(text);
  patch({ pendingLink: { handle, fileName: handle.name, project: existing, meta, mtime } });
}

/** Start syncing `project` into `handle`, optionally writing it out at once. */
async function adoptHandle(
  handle: FileSystemFileHandle,
  project: Project,
  revision: number | null,
  mtime: number,
  opts: { write: boolean },
) {
  await rememberLink({
    projectId: project.id,
    handle,
    fileName: handle.name,
    revision,
    mtime,
    syncedSignature: null,
    syncedAt: new Date().toISOString(),
    linkedAt: new Date().toISOString(),
  });
  activeProjectId = project.id;
  patch({ status: 'idle', fileName: handle.name, revision, error: null, conflict: null, pendingLink: null });
  if (opts.write) await writeNow(project, true);
  else await stampSynced(project, revision, mtime);
  startWatching();
}

/** "Set a file for this project" — pick where it should live. User gesture. */
export async function linkNewFile(): Promise<void> {
  const project = get(currentProject);
  if (!project) return;
  try {
    const handle = await pickFileToCreate(suggestedFileName(project.name));
    if (!handle) return;
    await inspectPickedFile(handle);
  } catch (e: any) {
    fail(e?.message ?? 'Could not open that file.', e);
  }
}

/** "Use a file that is already synced here" — pick an existing one. */
export async function linkExistingFile(): Promise<void> {
  const project = get(currentProject);
  if (!project) return;
  try {
    const handle = await pickExistingFile();
    if (!handle) return;
    await inspectPickedFile(handle);
  } catch (e: any) {
    fail(e?.message ?? 'Could not open that file.', e);
  }
}

/**
 * Settle a file that already had a project in it: take what the file holds, or
 * keep what is open and overwrite the file with it.
 */
export async function resolvePendingLink(choice: 'adopt' | 'overwrite'): Promise<void> {
  const pending = get(fileSync).pendingLink;
  if (!pending) return;
  patch({ pendingLink: null });
  try {
    if (choice === 'adopt') {
      await adoptHandle(pending.handle, pending.project, pending.meta?.revision ?? null, pending.mtime, {
        write: false,
      });
      await applyRemote(pending.project, pending.meta, pending.mtime);
    } else {
      const project = get(currentProject);
      if (!project) return;
      await adoptHandle(pending.handle, project, pending.meta?.revision ?? null, pending.mtime, { write: true });
    }
  } catch (e: any) {
    fail(e?.message ?? 'Could not link that file.', e);
  }
}

export function cancelPendingLink() {
  patch({ pendingLink: null });
}

/** Stop syncing this project to its file. The file itself is left alone. */
export async function unlinkFile(): Promise<void> {
  const projectId = activeProjectId ?? get(currentProject)?.id;
  if (projectId) await deleteLink(projectId);
  link = null;
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  fileSync.set({ ...initialState, status: isFileSystemAccessSupported() ? 'unlinked' : 'unsupported' });
}

// ── Resolving a conflict ────────────────────────────────────────────

/** Take the file's version, dropping the local edits. */
export async function resolveWithRemote(): Promise<void> {
  const conflict = get(fileSync).conflict;
  if (!conflict) return;
  // The edits being dropped were real work — park them in version history so
  // "discard mine" stays recoverable.
  const local = get(currentProject);
  if (local) saveSnapshot(local, 'Before loading the file version');
  patch({ status: 'syncing', conflict: null });
  await applyRemote(conflict.project, conflict.meta, conflict.mtime);
}

/** Keep what is open and overwrite the file with it. */
export async function resolveWithLocal(): Promise<void> {
  const project = get(currentProject);
  if (!project) return;
  patch({ status: 'syncing', conflict: null });
  await writeNow(project, true);
}

// ── Opening a project from a file (home screen) ─────────────────────

export interface OpenedFromFile {
  project: Project;
  fileName: string;
}

/**
 * Pick a project file and open what is in it — the way a second device joins a
 * project once the sync service has dropped the file there. The project is
 * stored locally and linked to the file, so editing carries straight on.
 */
export async function openProjectFromFile(): Promise<OpenedFromFile | null> {
  const handle = await pickExistingFile();
  if (!handle) return null;
  const { text, mtime } = await readFile(handle);
  if (isEmptyFile(text)) throw new Error('That file is empty.');
  const { project, meta } = parseProjectFile(text);
  await localStore.save(project);
  await putLink({
    projectId: project.id,
    handle,
    fileName: handle.name,
    revision: meta?.revision ?? null,
    mtime,
    syncedSignature: projectSignature(project),
    syncedAt: new Date().toISOString(),
    linkedAt: new Date().toISOString(),
  });
  return { project, fileName: handle.name };
}
