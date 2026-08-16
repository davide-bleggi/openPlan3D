<script lang="ts">
  /**
   * Floor manager (issue #15): reorder the stack, rename/duplicate/remove
   * floors, and add a new floor either empty or as a copy of the one below.
   *
   * Rows are listed top-of-building first, which is how the stack reads in the
   * 3D view; the store works bottom-to-top, so indices are mirrored on the way in.
   */
  import { currentProject, setActiveFloor, addFloor, removeFloor, moveFloor, reorderFloors, renameFloor, duplicateFloor } from '$lib/stores/project';
  import { orderFloorsBottomUp } from '$lib/utils/floorOrder';
  import { floorNameForLevel } from '$lib/utils/floorStacking';
  import type { Floor } from '$lib/models/types';

  let { open = $bindable(false), autoAdd = $bindable(false) }: { open: boolean; autoAdd?: boolean } = $props();

  /** Bottom-to-top, matching the store's ordering. */
  let stack: Floor[] = $derived($currentProject ? orderFloorsBottomUp($currentProject.floors) : []);
  /** Top-of-building first, matching how the list is drawn. */
  let rows: Floor[] = $derived([...stack].reverse());

  const toStackIndex = (rowIndex: number) => stack.length - 1 - rowIndex;

  // --- adding -------------------------------------------------------------
  let addOpen = $state(false);
  let addMode = $state<'empty' | 'copy'>('copy');
  let addFurniture = $state(false);

  let topFloor: Floor | undefined = $derived(stack[stack.length - 1]);

  // Opened straight from the "+" button: jump to the new-floor options.
  $effect(() => {
    if (open && autoAdd) { addOpen = true; autoAdd = false; }
  });

  function confirmAdd() {
    addFloor(
      addMode === 'copy'
        ? { copyFrom: 'previous', includeFurniture: addFurniture }
        : {},
    );
    addOpen = false;
  }

  // --- renaming -----------------------------------------------------------
  let editingId: string | null = $state(null);
  let editingName = $state('');

  function startRename(floor: Floor) {
    editingId = floor.id;
    editingName = floor.name || floorNameForLevel(floor.level ?? 0);
  }

  function commitRename() {
    if (editingId) renameFloor(editingId, editingName);
    editingId = null;
  }

  function onRenameKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    else if (e.key === 'Escape') { editingId = null; }
  }

  // --- drag and drop ------------------------------------------------------
  let dragRow: number | null = $state(null);
  let dropRow: number | null = $state(null);

  function onDragStart(e: DragEvent, rowIndex: number) {
    dragRow = rowIndex;
    e.dataTransfer?.setData('text/plain', String(rowIndex));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e: DragEvent, rowIndex: number) {
    if (dragRow === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dropRow = rowIndex;
  }

  function onDrop(e: DragEvent, rowIndex: number) {
    e.preventDefault();
    if (dragRow !== null && dragRow !== rowIndex) {
      reorderFloors(toStackIndex(dragRow), toStackIndex(rowIndex));
    }
    dragRow = null;
    dropRow = null;
  }

  function onDragEnd() {
    dragRow = null;
    dropRow = null;
  }

  function close() {
    open = false;
    addOpen = false;
    editingId = null;
  }

  function onRemove(floor: Floor) {
    if (stack.length <= 1) return;
    const label = floor.name || floorNameForLevel(floor.level ?? 0);
    if (confirm(`Remove "${label}" and everything on it?`)) removeFloor(floor.id);
  }
</script>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
    onclick={close}
    onkeydown={(e) => { if (e.key === 'Escape') close(); }}
    role="dialog"
    tabindex="-1"
    aria-label="Floors"
  >
    <div
      class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[420px] max-w-full max-h-[80vh] flex flex-col"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="document"
    >
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 class="font-semibold text-gray-800 dark:text-gray-100">Floors</h2>
        <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none" onclick={close} aria-label="Close">×</button>
      </div>

      <p class="px-4 pt-3 text-xs text-gray-500 dark:text-gray-400">
        Highest floor first — drag a row or use the arrows to change the stacking order.
      </p>

      <ul class="flex-1 overflow-y-auto px-2 py-2">
        {#each rows as fl, i (fl.id)}
          {@const stackIndex = toStackIndex(i)}
          <li
            class="flex items-center gap-1 px-2 py-1.5 rounded-lg border transition-colors
              {fl.id === $currentProject?.activeFloorId
                ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30'
                : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50'}
              {dropRow === i && dragRow !== null && dragRow !== i ? 'ring-2 ring-blue-400' : ''}
              {dragRow === i ? 'opacity-40' : ''}"
            draggable="true"
            ondragstart={(e) => onDragStart(e, i)}
            ondragover={(e) => onDragOver(e, i)}
            ondrop={(e) => onDrop(e, i)}
            ondragend={onDragEnd}
          >
            <span class="cursor-grab text-gray-400 px-1 select-none" title="Drag to reorder" aria-hidden="true">⋮⋮</span>

            {#if editingId === fl.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="flex-1 min-w-0 px-2 py-1 text-sm rounded border border-blue-400 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 outline-none"
                bind:value={editingName}
                autofocus
                onblur={commitRename}
                onkeydown={onRenameKeydown}
              />
            {:else}
              <button
                class="flex-1 min-w-0 text-left px-1 py-1 text-sm truncate {fl.id === $currentProject?.activeFloorId ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200'}"
                onclick={() => setActiveFloor(fl.id)}
                ondblclick={() => startRename(fl)}
                title="Click to open, double-click to rename"
              >
                {fl.name || floorNameForLevel(fl.level ?? 0)}
                <span class="text-[10px] text-gray-400 ml-1">L{fl.level ?? 0}</span>
              </button>
            {/if}

            <button
              class="p-1 text-gray-400 hover:text-blue-600 disabled:opacity-25 disabled:hover:text-gray-400"
              disabled={stackIndex >= stack.length - 1}
              onclick={() => moveFloor(fl.id, 1)}
              title="Move up"
              aria-label="Move {fl.name} up"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <button
              class="p-1 text-gray-400 hover:text-blue-600 disabled:opacity-25 disabled:hover:text-gray-400"
              disabled={stackIndex <= 0}
              onclick={() => moveFloor(fl.id, -1)}
              title="Move down"
              aria-label="Move {fl.name} down"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <button
              class="p-1 text-gray-400 hover:text-blue-600"
              onclick={() => duplicateFloor(fl.id)}
              title="Duplicate floor"
              aria-label="Duplicate {fl.name}"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button
              class="p-1 text-gray-400 hover:text-red-600 disabled:opacity-25 disabled:hover:text-gray-400"
              disabled={stack.length <= 1}
              onclick={() => onRemove(fl)}
              title="Remove floor"
              aria-label="Remove {fl.name}"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
          </li>
        {/each}
      </ul>

      <div class="border-t border-gray-200 dark:border-gray-700 p-3">
        {#if addOpen}
          <div class="space-y-2">
            <div class="text-xs font-bold uppercase tracking-wider text-gray-400">New floor</div>
            <label class="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
              <input type="radio" class="mt-1" bind:group={addMode} value="empty" />
              <span>
                Start empty
                <span class="block text-xs text-gray-400">A blank plan.</span>
              </span>
            </label>
            <label class="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
              <input type="radio" class="mt-1" bind:group={addMode} value="copy" />
              <span>
                Copy of {topFloor?.name || floorNameForLevel(topFloor?.level ?? 0)}
                <span class="block text-xs text-gray-400">Walls, rooms, doors, windows, columns and stairs — fully independent afterwards.</span>
              </span>
            </label>
            {#if addMode === 'copy'}
              <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 pl-6 cursor-pointer">
                <input type="checkbox" bind:checked={addFurniture} />
                Also copy furniture
              </label>
            {/if}
            <div class="flex justify-end gap-2 pt-1">
              <button class="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" onclick={() => addOpen = false}>Cancel</button>
              <button class="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded font-medium" onclick={confirmAdd}>Add floor</button>
            </div>
          </div>
        {:else}
          <button
            class="w-full px-3 py-2 text-sm rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-400 hover:text-blue-600 transition-colors"
            onclick={() => { addOpen = true; }}
          >+ Add floor</button>
        {/if}
      </div>
    </div>
  </div>
{/if}
