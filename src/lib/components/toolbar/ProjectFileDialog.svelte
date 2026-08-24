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
            This browser can't keep hold of a file — Safari on iPhone and iPad in
            particular. The project stays saved here.
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            To move it, use <strong>Export → Download JSON</strong>, then
            <strong>Import JSON</strong> on the other device.
          </p>

        {:else if sync.pendingLink}
          <div class="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
            <p class="text-sm font-semibold text-amber-800 dark:text-amber-200">That file already holds a project</p>
            <p class="text-xs text-amber-700 dark:text-amber-300">
              It holds “{sync.pendingLink.project.name}”, saved {when(sync.pendingLink.meta?.savedAt ?? sync.pendingLink.project.updatedAt)}.
            </p>
            <div class="flex flex-wrap gap-2 pt-1">
              <button
                class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                disabled={working}
                onclick={() => run(() => resolvePendingLink('adopt'))}
              >Open the file's version</button>
              <button
                class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 disabled:opacity-50"
                disabled={working}
                onclick={() => run(() => resolvePendingLink('overwrite'))}
              >Overwrite with this project</button>
              <button
                class="px-3 py-1.5 text-xs rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400"
                disabled={working}
                onclick={cancelPendingLink}
              >Cancel</button>
            </div>
          </div>

        {:else if sync.status === 'unlinked'}
          <p class="text-sm text-gray-600 dark:text-gray-300">
            The project autosaves into a file you choose. Put it in a synced
            folder and it follows you between devices.
          </p>
          <!-- One button makes the file, the other joins one that is already
               there. The labels have to carry that difference on their own. -->
          <div class="flex flex-wrap gap-2">
            <button
              class="px-3 py-2 text-sm font-semibold rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
              disabled={working}
              title="Create the file that will back this project"
              onclick={() => run(linkNewFile)}
            >Create a file…</button>
            <button
              class="px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 disabled:opacity-50"
              disabled={working}
              title="Open a project file that is already in the synced folder"
              onclick={() => run(linkExistingFile)}
            >Use an existing file…</button>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Create one on the first device; on the others, use the file that has
            arrived there.
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
                The browser asks for file permission once per session.
              </p>
              <button
                class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                disabled={working}
                onclick={() => run(requestFilePermission)}
              >Reconnect</button>
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
                  ? 'Another device saved while you had unsaved changes here.'
                  : 'The file is older than the version already synced here — usually a stale copy restored by the sync service.'}
                Nothing has been overwritten. It holds “{sync.conflict.project.name}”, saved
                {when(sync.conflict.meta?.savedAt ?? sync.conflict.project.updatedAt)}.
              </p>
              <div class="flex flex-wrap gap-2 pt-1">
                <button
                  class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                  disabled={working}
                  onclick={() => run(resolveWithLocal)}
                >Keep mine</button>
                <button
                  class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 disabled:opacity-50"
                  disabled={working}
                  onclick={() => run(resolveWithRemote)}
                >Use the file's</button>
              </div>
              <p class="text-[11px] text-red-600/80 dark:text-red-300/80">
                <strong>Export → Download JSON</strong> saves a copy of what is
                open before you choose.
              </p>
            </div>
          {/if}

          {#if sync.status === 'error' && sync.error}
            <p class="text-xs text-red-600 dark:text-red-400">{sync.error}</p>
          {/if}

          <!-- The two everyday actions on the left; leaving the file is
               destructive-ish and lives apart from them, on the right. -->
          <div class="flex items-center gap-2 pt-4 border-t border-gray-100 dark:border-gray-700">
            <button
              class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
              disabled={working || sync.status === 'permission-required'}
              onclick={() => run(syncNow)}
            >Save now</button>
            <button
              class="px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 disabled:opacity-50"
              disabled={working}
              onclick={() => run(linkNewFile)}
            >Change file…</button>
            <div class="flex-1"></div>
            <button
              class="px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-50"
              disabled={working}
              onclick={() => run(unlinkFile)}
            >Stop syncing</button>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Autosaves every few seconds, and picks up other devices' changes on
            its own.
          </p>
        {/if}
      </div>
    </div>
  </div>
{/if}
