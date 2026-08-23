<script lang="ts">
  /**
   * Project file sync (issue #29) — the panel where a project is given the file
   * that backs it, and where anything the file does behind our back gets
   * settled.
   *
   * The model to convey: one file per project, kept in a folder the user
   * already syncs with something else. The app writes into it; the sync
   * service carries it. Nothing here talks to a server.
   */
  import {
    fileSync,
    linkExistingFile,
    linkNewFile,
    requestFilePermission,
    resolvePendingLink,
    cancelPendingLink,
    resolveWithLocal,
    resolveWithRemote,
    syncNow,
    unlinkFile,
  } from '$lib/stores/projectFileSync';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let sync = $derived($fileSync);
  let working = $state(false);

  function close() {
    open = false;
  }

  /** Every action here hits the disk; keep the buttons from being double-fired. */
  async function run(fn: () => Promise<unknown>) {
    if (working) return;
    working = true;
    try {
      await fn();
    } finally {
      working = false;
    }
  }

  function when(value: Date | string | null | undefined): string {
    if (!value) return 'never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'unknown';
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 5) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleString();
  }
</script>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
    onclick={close}
    onkeydown={(e) => { if (e.key === 'Escape') close(); }}
    role="dialog"
    tabindex="-1"
    aria-label="Project file"
  >
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[480px] max-w-full max-h-[85vh] overflow-y-auto flex flex-col"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="document"
    >
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 class="font-semibold text-gray-800 dark:text-gray-100">Project file</h2>
        <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none" onclick={close} aria-label="Close">×</button>
      </div>

      <div class="p-4 space-y-4">
        {#if sync.status === 'unsupported'}
          <p class="text-sm text-gray-600 dark:text-gray-300">
            This browser cannot hand a file to a web app and keep it — Safari on
            iPhone and iPad, in particular. The project stays saved in this
            browser.
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            To move it between devices, use <strong>Export → Download JSON</strong>
            and <strong>Export → Import JSON</strong> on the other one. On a
            desktop browser (Chrome, Edge, or Safari on macOS) the same project
            can be given a file and kept in sync automatically.
          </p>

        {:else if sync.pendingLink}
          <div class="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
            <p class="text-sm font-semibold text-amber-800 dark:text-amber-200">That file already holds a project</p>
            <p class="text-xs text-amber-700 dark:text-amber-300">
              <strong>{sync.pendingLink.fileName}</strong> contains
              “{sync.pendingLink.project.name}”, saved {when(sync.pendingLink.meta?.savedAt ?? sync.pendingLink.project.updatedAt)}.
            </p>
            <div class="flex flex-wrap gap-2 pt-1">
              <button
                class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                disabled={working}
                onclick={() => run(() => resolvePendingLink('adopt'))}
              >Open what is in the file</button>
              <button
                class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 disabled:opacity-50"
                disabled={working}
                onclick={() => run(() => resolvePendingLink('overwrite'))}
              >Overwrite it with this project</button>
              <button
                class="px-3 py-1.5 text-xs rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400"
                disabled={working}
                onclick={cancelPendingLink}
              >Cancel</button>
            </div>
          </div>

        {:else if sync.status === 'unlinked'}
          <p class="text-sm text-gray-600 dark:text-gray-300">
            Give this project a file and it autosaves into it. Put that file in a
            folder something else already syncs — iCloud Drive, Dropbox, OneDrive,
            Syncthing, a network share — and the project follows you to your other
            devices. Nothing is uploaded to us; the sync service moves the file.
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              class="px-3 py-2 text-sm font-semibold rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
              disabled={working}
              onclick={() => run(linkNewFile)}
            >Choose a file…</button>
            <button
              class="px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 disabled:opacity-50"
              disabled={working}
              onclick={() => run(linkExistingFile)}
            >Use an existing project file…</button>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            On another device, pick the file that arrived there with
            <strong>Use an existing project file…</strong> — same project, carried
            over by the sync service.
          </p>

        {:else}
          <div class="flex items-start gap-2">
            <svg class="w-4 h-4 mt-0.5 text-gray-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
            <div class="min-w-0">
              <p class="text-sm font-medium text-gray-800 dark:text-gray-100 break-all">{sync.fileName}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {#if sync.revision !== null}Revision {sync.revision} ·{/if} last synced {when(sync.lastSyncedAt)}
              </p>
            </div>
          </div>

          {#if sync.status === 'permission-required'}
            <div class="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
              <p class="text-sm text-amber-800 dark:text-amber-200">
                The browser needs your permission again before it can read and write
                this file — it asks once per session.
              </p>
              <button
                class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                disabled={working}
                onclick={() => run(requestFilePermission)}
              >Reconnect the file</button>
            </div>
          {/if}

          {#if sync.status === 'conflict' && sync.conflict}
            <div class="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 p-3 space-y-2">
              <p class="text-sm font-semibold text-red-800 dark:text-red-200">
                {sync.conflict.reason === 'remote-newer'
                  ? 'The file changed while you were editing'
                  : 'The file went back to an older version'}
              </p>
              <p class="text-xs text-red-700 dark:text-red-300">
                {sync.conflict.reason === 'remote-newer'
                  ? 'Another device saved this project, and you have unsaved changes here. Nothing has been overwritten — pick which version wins.'
                  : 'The file holds an older version than the one already synced here, which usually means the sync service restored a stale copy. Nothing has been overwritten.'}
                The file holds “{sync.conflict.project.name}”, saved
                {when(sync.conflict.meta?.savedAt ?? sync.conflict.project.updatedAt)}.
              </p>
              <div class="flex flex-wrap gap-2 pt-1">
                <button
                  class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                  disabled={working}
                  onclick={() => run(resolveWithLocal)}
                >Keep mine, overwrite the file</button>
                <button
                  class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 disabled:opacity-50"
                  disabled={working}
                  onclick={() => run(resolveWithRemote)}
                >Use the file, discard my changes</button>
              </div>
              <p class="text-[11px] text-red-600/80 dark:text-red-300/80">
                Losing either side would be a shame: <strong>Export → Download JSON</strong>
                saves a copy of what is open before you choose.
              </p>
            </div>
          {/if}

          {#if sync.status === 'error' && sync.error}
            <p class="text-xs text-red-600 dark:text-red-400">{sync.error}</p>
          {/if}

          <div class="flex flex-wrap gap-2 pt-1 border-t border-gray-100 dark:border-gray-700">
            <button
              class="mt-3 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
              disabled={working || sync.status === 'permission-required'}
              onclick={() => run(syncNow)}
            >Save to file now</button>
            <button
              class="mt-3 px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 disabled:opacity-50"
              disabled={working}
              onclick={() => run(linkNewFile)}
            >Change file…</button>
            <button
              class="mt-3 px-3 py-1.5 text-xs rounded-lg text-gray-500 hover:text-red-600 dark:text-gray-400 disabled:opacity-50"
              disabled={working}
              onclick={() => run(unlinkFile)}
            >Stop syncing</button>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            The project autosaves into this file every few seconds and is
            re-checked while the editor is open, so a version arriving from
            another device is picked up on its own.
          </p>
        {/if}
      </div>
    </div>
  </div>
{/if}
