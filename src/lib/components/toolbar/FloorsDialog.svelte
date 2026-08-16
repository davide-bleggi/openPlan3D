<script lang="ts">
  /**
   * Floor manager (issue #15): reorder the stack by dragging, and rename,
   * duplicate or remove floors that already exist. Creating a floor lives in
   * AddFloorDialog, not here.
   *
   * Rows are listed top-of-building first, which is how the stack reads in the
   * 3D view; the store works bottom-to-top, so indices are mirrored on the way in.
   */
  import { currentProject, setActiveFloor, removeFloor, moveFloor, reorderFloors, renameFloor, duplicateFloor } from '$lib/stores/project';
  import { orderFloorsBottomUp } from '$lib/utils/floorOrder';
  import { floorNameForLevel } from '$lib/utils/floorStacking';
  import type { Floor } from '$lib/models/types';

  let { open = $bindable(false) }: { open: boolean } = $props();

  /** Bottom-to-top, matching the store's ordering. */
  let stack: Floor[] = $derived($currentProject ? orderFloorsBottomUp($currentProject.floors) : []);
  /** Top-of-building first, matching how the list is drawn. */
  let rows: Floor[] = $derived([...stack].reverse());

  const toStackIndex = (rowIndex: number) => stack.length - 1 - rowIndex;
  const labelOf = (floor: Floor) => floor.name || floorNameForLevel(floor.level ?? 0);

  // --- renaming -----------------------------------------------------------
  let editingId: string | null = $state(null);
  let editingName = $state('');

  function startRename(floor: Floor) {
    editingId = floor.id;
    editingName = labelOf(floor);
  }

  function commitRename() {
    if (editingId) renameFloor(editingId, editingName);
    editingId = null;
  }

  function onRenameKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    else if (e.key === 'Escape') editingId = null;
  }

  // --- drag to reorder ----------------------------------------------------
  // Pointer events rather than HTML5 drag-and-drop, so dragging works with a
  // finger on a tablet as well as a mouse.
  let listEl: HTMLUListElement | undefined = $state();
  let dragRow: number | null = $state(null);
  /** Where the dragged row would land, as a gap index in 0..rows.length. */
  let dropGap: number | null = $state(null);
  /** Pixels the dragged row has been pulled from its resting place. */
  let dragOffset = $state(0);

  let startY = 0;
  let rowRects: DOMRect[] = [];

  function onPointerDown(e: PointerEvent, rowIndex: number) {
    if (e.button !== 0 || rows.length < 2 || editingId) return;
    e.preventDefault();
    const items = Array.from(listEl?.querySelectorAll('li') ?? []);
    rowRects = items.map((el) => el.getBoundingClientRect());
    startY = e.clientY;
    dragRow = rowIndex;
    dropGap = rowIndex;
    dragOffset = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (dragRow === null) return;
    dragOffset = e.clientY - startY;
    // The gap the pointer currently sits in: one past every row whose middle
    // it has passed.
    let gap = 0;
    for (const r of rowRects) {
      if (e.clientY > r.top + r.height / 2) gap++;
    }
    dropGap = gap;
  }

  function onPointerUp(e: PointerEvent) {
    if (dragRow === null) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    const gap = dropGap ?? dragRow;
    // A gap below the dragged row means it lands one index lower once removed.
    const target = Math.min(rows.length - 1, Math.max(0, gap > dragRow ? gap - 1 : gap));
    if (target !== dragRow) reorderFloors(toStackIndex(dragRow), toStackIndex(target));
    dragRow = null;
    dropGap = null;
    dragOffset = 0;
  }

  /** Keyboard equivalent of dragging, for the focused row handle. */
  function onHandleKeydown(e: KeyboardEvent, floor: Floor) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    moveFloor(floor.id, e.key === 'ArrowUp' ? 1 : -1);
  }

  function close() {
    open = false;
    editingId = null;
    dragRow = null;
    dropGap = null;
  }

  function onRemove(floor: Floor) {
    if (stack.length <= 1) return;
    if (confirm(`Remove "${labelOf(floor)}" and everything on it?`)) removeFloor(floor.id);
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
        Highest floor first — drag a row by its handle to change the stacking order.
      </p>

      <ul class="flex-1 overflow-y-auto px-2 py-2 select-none" bind:this={listEl}>
        {#each rows as fl, i (fl.id)}
          <li
            class="relative flex items-center gap-1 px-2 py-1.5 rounded-lg border transition-colors
              {fl.id === $currentProject?.activeFloorId
                ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30'
                : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50'}
              {dragRow === i ? 'z-10 shadow-lg bg-white dark:bg-gray-700 opacity-90' : ''}"
            style={dragRow === i ? `transform: translateY(${dragOffset}px)` : ''}
          >
            {#if dragRow !== null && dragRow !== i && dropGap === i}
              <span class="absolute -top-px left-2 right-2 h-0.5 bg-blue-500 rounded" aria-hidden="true"></span>
            {/if}
            {#if dragRow !== null && dropGap === rows.length && i === rows.length - 1}
              <span class="absolute -bottom-px left-2 right-2 h-0.5 bg-blue-500 rounded" aria-hidden="true"></span>
            {/if}

            <button
              class="px-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 touch-none {rows.length > 1 ? 'cursor-grab' : 'cursor-default opacity-40'}"
              onpointerdown={(e) => onPointerDown(e, i)}
              onpointermove={onPointerMove}
              onpointerup={onPointerUp}
              onpointercancel={onPointerUp}
              onkeydown={(e) => onHandleKeydown(e, fl)}
              title="Drag to reorder (or use ↑ / ↓ when focused)"
              aria-label="Reorder {labelOf(fl)}"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
            </button>

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
                {labelOf(fl)}
                <span class="text-[10px] text-gray-400 ml-1">L{fl.level ?? 0}</span>
              </button>
            {/if}

            <button
              class="p-1 text-gray-400 hover:text-blue-600"
              onclick={() => duplicateFloor(fl.id)}
              title="Duplicate floor"
              aria-label="Duplicate {labelOf(fl)}"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button
              class="p-1 text-gray-400 hover:text-red-600 disabled:opacity-25 disabled:hover:text-gray-400"
              disabled={stack.length <= 1}
              onclick={() => onRemove(fl)}
              title="Remove floor"
              aria-label="Remove {labelOf(fl)}"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/if}
