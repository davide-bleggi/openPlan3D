<script lang="ts">
  /**
   * The floor dropdown's contents (issue #15): switch floor, reorder the stack
   * by dragging, rename, duplicate and remove — all in the menu itself, so
   * managing floors never needs a separate dialog. Creating a floor is the one
   * thing that opens one, via `onAdd`.
   *
   * Rows are listed top-of-building first, which is how the stack reads in the
   * 3D view; the store works bottom-to-top, so indices are mirrored on the way in.
   */
  import { currentProject, setActiveFloor, removeFloor, moveFloor, reorderFloors, renameFloor, duplicateFloor } from '$lib/stores/project';
  import { orderFloorsBottomUp } from '$lib/utils/floorOrder';
  import { floorNameForLevel } from '$lib/utils/floorStacking';
  import type { Floor } from '$lib/models/types';

  let { onAdd, onSelect }: { onAdd: () => void; onSelect?: () => void } = $props();

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
  // finger on a tablet as well as a mouse. The whole row is a drag target (the
  // handle is only the affordance); the drag starts once the pointer has moved
  // past a small threshold, so a plain click still selects the floor and a
  // double-click still renames it.
  const DRAG_THRESHOLD = 4;

  let listEl: HTMLUListElement | undefined = $state();
  let dragRow: number | null = $state(null);
  /** Where the dragged row would land, as a gap index in 0..rows.length. */
  let dropGap: number | null = $state(null);
  /** Pixels the dragged row has been pulled from its resting place. */
  let dragOffset = $state(0);
  /** Distance between two rows, used to part them around the landing spot. */
  let rowPitch = $state(0);

  let pendingRow: number | null = null;
  let startY = 0;
  let rowRects: DOMRect[] = [];
  /** Set on a drop so the click it may synthesize does not also select the row.
   *  Cleared by the next pointerdown, so ordinary clicks are never swallowed. */
  let justDropped = false;

  function onPointerDown(e: PointerEvent, rowIndex: number) {
    if (e.button !== 0 || rows.length < 2 || editingId) return;
    // Row actions (duplicate, remove) and the rename field are not drag handles.
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    justDropped = false;
    pendingRow = rowIndex;
    startY = e.clientY;
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowUp);
  }

  function onWindowMove(e: PointerEvent) {
    if (pendingRow === null) return;
    const dy = e.clientY - startY;
    if (dragRow === null) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return;
      rowRects = Array.from(listEl?.querySelectorAll('li') ?? []).map((el) => el.getBoundingClientRect());
      rowPitch = rowRects.length > 1 ? rowRects[1].top - rowRects[0].top : rowRects[0].height;
      dragRow = pendingRow;
    }
    e.preventDefault();
    dragOffset = dy;
    // The gap the pointer currently sits in: one past every row whose middle
    // it has passed.
    let gap = 0;
    for (const r of rowRects) {
      if (e.clientY > r.top + r.height / 2) gap++;
    }
    dropGap = gap;
  }

  function onWindowUp() {
    const from = dragRow;
    const gap = dropGap ?? from ?? 0;
    cancelDrag();
    if (from === null) return; // never passed the threshold — leave the click alone

    const target = landingIndex(from, gap);
    justDropped = true;
    if (target !== from) reorderFloors(toStackIndex(from), toStackIndex(target));
  }

  /** Drop the drag state and its listeners, without reordering anything. */
  function cancelDrag() {
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', onWindowUp);
    window.removeEventListener('pointercancel', onWindowUp);
    pendingRow = null;
    dragRow = null;
    dropGap = null;
    dragOffset = 0;
  }

  /** Index the dragged row would land on, from the gap the pointer sits in. */
  function landingIndex(from: number, gap: number): number {
    return Math.min(rows.length - 1, Math.max(0, gap > from ? gap - 1 : gap));
  }

  /** How far a row that is not being dragged slides to open the landing gap. */
  function shiftFor(i: number): number {
    if (dragRow === null || dropGap === null || i === dragRow) return 0;
    const target = landingIndex(dragRow, dropGap);
    if (target > dragRow && i > dragRow && i <= target) return -rowPitch;
    if (target < dragRow && i >= target && i < dragRow) return rowPitch;
    return 0;
  }

  /** Keyboard equivalent of dragging, for the focused row handle. */
  function onHandleKeydown(e: KeyboardEvent, floor: Floor) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    moveFloor(floor.id, e.key === 'ArrowUp' ? 1 : -1);
  }

  /** Row click: open the floor, unless the click is the tail of a drop. */
  function selectFloor(id: string) {
    if (justDropped) { justDropped = false; return; }
    setActiveFloor(id);
    onSelect?.();
  }

  function onRemove(floor: Floor) {
    if (stack.length <= 1) return;
    if (confirm(`Remove "${labelOf(floor)}" and everything on it?`)) removeFloor(floor.id);
  }
</script>

<ul class="py-1 max-h-[50vh] overflow-y-auto select-none" bind:this={listEl}>
  {#each rows as fl, i (fl.id)}
    <li
      class="relative flex items-center gap-1 px-2 py-1.5 rounded-lg touch-none
        {rows.length > 1 ? 'cursor-grab' : ''}
        {fl.id === $currentProject?.activeFloorId ? 'bg-blue-50' : 'hover:bg-gray-100'}
        {dragRow === i ? 'z-10 shadow-lg bg-white cursor-grabbing' : ''}
        {dragRow !== null && dragRow !== i ? 'transition-transform duration-100' : ''}"
      style={dragRow === i
        ? `transform: translateY(${dragOffset}px)`
        : shiftFor(i) !== 0 ? `transform: translateY(${shiftFor(i)}px)` : ''}
      onpointerdown={(e) => onPointerDown(e, i)}
    >
      <button
        class="px-0.5 text-gray-400 hover:text-gray-600 {rows.length > 1 ? '' : 'opacity-40'}"
        onkeydown={(e) => onHandleKeydown(e, fl)}
        title="Drag the row to reorder (or use ↑ / ↓ from here)"
        aria-label="Reorder {labelOf(fl)}"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg>
      </button>

      {#if editingId === fl.id}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          data-no-drag
          class="flex-1 min-w-0 px-2 py-0.5 text-sm rounded border border-blue-400 bg-white text-gray-800 outline-none"
          bind:value={editingName}
          autofocus
          onblur={commitRename}
          onkeydown={onRenameKeydown}
        />
      {:else}
        <button
          class="flex-1 min-w-0 text-left px-1 py-0.5 text-sm truncate {fl.id === $currentProject?.activeFloorId ? 'text-blue-600 font-semibold' : 'text-gray-700'}"
          onclick={() => selectFloor(fl.id)}
          title="Open this floor"
        >{labelOf(fl)}</button>
        <span class="text-[10px] text-gray-400 shrink-0">{fl.level ?? 0}F</span>
        <!-- Renaming needs its own button here: a click on the row opens the
             floor and closes the menu, so double-click could never land. -->
        <button
          data-no-drag
          class="p-1 text-gray-400 hover:text-blue-600 shrink-0"
          onclick={() => startRename(fl)}
          title="Rename floor"
          aria-label="Rename {labelOf(fl)}"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
      {/if}

      <button
        data-no-drag
        class="p-1 text-gray-400 hover:text-blue-600 shrink-0"
        onclick={() => duplicateFloor(fl.id)}
        title="Duplicate floor"
        aria-label="Duplicate {labelOf(fl)}"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button
        data-no-drag
        class="p-1 text-gray-400 hover:text-red-600 disabled:opacity-25 disabled:hover:text-gray-400 shrink-0"
        disabled={stack.length <= 1}
        onclick={() => onRemove(fl)}
        title="Remove floor"
        aria-label="Remove {labelOf(fl)}"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
      </button>
    </li>
  {/each}
</ul>

<div class="border-t border-gray-100 pt-1">
  <button class="w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 text-left rounded-lg" onclick={onAdd}>+ Add floor…</button>
  <p class="px-3 pb-1.5 pt-0.5 text-[10px] text-gray-400 leading-snug">
    {stack.length} floor{stack.length === 1 ? '' : 's'}, highest first. Drag a row to change the stacking order.
  </p>
</div>
