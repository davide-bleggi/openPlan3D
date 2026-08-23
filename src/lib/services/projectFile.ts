/**
 * Browser plumbing for file-backed projects (issue #29).
 *
 * Two things live here, both of them thin: the File System Access API calls
 * used to pick, read and write a project's base file, and the IndexedDB table
 * that remembers which file belongs to which project. A file handle survives a
 * reload but cannot be JSON-stringified, so localStorage is no use for it —
 * IndexedDB stores it structurally, which is the only reason this table exists.
 */
import type { SyncStamp } from '$lib/utils/projectFileSync';

/** A project's base file, as remembered between sessions. */
export interface ProjectFileLink {
  projectId: string;
  handle: FileSystemFileHandle;
  fileName: string;
  /** The revision and mtime we last read from, or wrote to, this file. */
  revision: number | null;
  mtime: number;
  /** Fingerprint of the project as it stood then — our local dirty marker. */
  syncedSignature: string | null;
  /** When that sync happened, for display. */
  syncedAt: string;
  linkedAt: string;
}

export function linkStamp(link: ProjectFileLink): SyncStamp {
  return { revision: link.revision, mtime: link.mtime };
}

// ── File System Access API ──────────────────────────────────────────

/**
 * Is this browser able to hold on to a file the user picked? Safari on iOS is
 * the one that matters here: it has no picker of this kind, so those users get
 * the manual export/import path instead.
 */
export function isFileSystemAccessSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.showSaveFilePicker === 'function' &&
    typeof window.showOpenFilePicker === 'function'
  );
}

const FILE_TYPES = [
  {
    description: 'openPlan3D project',
    accept: { 'application/json': ['.json'] },
  },
];

/** Ask the user where the project's file should live. Requires a user gesture. */
export async function pickFileToCreate(suggestedName: string): Promise<FileSystemFileHandle | null> {
  if (!isFileSystemAccessSupported()) return null;
  try {
    return await window.showSaveFilePicker!({
      suggestedName,
      types: FILE_TYPES,
      id: 'openplan-project-file',
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') return null;
    throw e;
  }
}

/** Ask the user to point at an existing project file. Requires a user gesture. */
export async function pickExistingFile(): Promise<FileSystemFileHandle | null> {
  if (!isFileSystemAccessSupported()) return null;
  try {
    const [handle] = await window.showOpenFilePicker!({
      types: FILE_TYPES,
      multiple: false,
      id: 'openplan-project-file',
    });
    return handle ?? null;
  } catch (e: any) {
    if (e?.name === 'AbortError') return null;
    throw e;
  }
}

export type FilePermission = 'granted' | 'prompt' | 'denied';

/**
 * Read-write permission on a handle lapses when the tab is closed, so after a
 * reload we have to ask again — and asking needs a user gesture, which is why
 * `request` is a choice the caller makes rather than something done here.
 */
export async function checkPermission(
  handle: FileSystemFileHandle,
  request = false,
): Promise<FilePermission> {
  const descriptor = { mode: 'readwrite' as const };
  try {
    const current = (await handle.queryPermission?.(descriptor)) ?? 'granted';
    if (current === 'granted' || !request) return current as FilePermission;
    const asked = (await handle.requestPermission?.(descriptor)) ?? 'granted';
    return asked as FilePermission;
  } catch {
    return 'denied';
  }
}

export interface FileRead {
  text: string;
  mtime: number;
}

/** The file's timestamp, without paying to read its contents. */
export async function statFile(handle: FileSystemFileHandle): Promise<number> {
  const file = await handle.getFile();
  return file.lastModified;
}

export async function readFile(handle: FileSystemFileHandle): Promise<FileRead> {
  const file = await handle.getFile();
  return { text: await file.text(), mtime: file.lastModified };
}

/** Write the file and report the mtime it ended up with, so we can stamp it. */
export async function writeFile(handle: FileSystemFileHandle, text: string): Promise<number> {
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
  return statFile(handle);
}

// ── Handle storage (IndexedDB) ──────────────────────────────────────

const DB_NAME = 'openplan-project-files';
const DB_VERSION = 1;
const STORE = 'links';

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'projectId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn('[ProjectFile] IndexedDB unavailable:', request.error);
      resolve(null);
    };
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction(STORE, mode);
          const request = fn(tx.objectStore(STORE));
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => {
            console.warn('[ProjectFile] Storage error:', request.error);
            resolve(null);
          };
          tx.oncomplete = () => db.close();
        } catch (e) {
          console.warn('[ProjectFile] Storage error:', e);
          resolve(null);
        }
      }),
  );
}

export function getLink(projectId: string): Promise<ProjectFileLink | null> {
  return run<ProjectFileLink>('readonly', (store) => store.get(projectId));
}

export async function putLink(link: ProjectFileLink): Promise<void> {
  await run('readwrite', (store) => store.put(link) as IDBRequest<any>);
}

export async function deleteLink(projectId: string): Promise<void> {
  await run('readwrite', (store) => store.delete(projectId) as IDBRequest<any>);
}

export async function listLinks(): Promise<ProjectFileLink[]> {
  const all = await run<ProjectFileLink[]>('readonly', (store) => store.getAll() as IDBRequest<ProjectFileLink[]>);
  return all ?? [];
}
