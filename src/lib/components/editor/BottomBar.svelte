<script lang="ts">
  /**
   * Status / display bar shared by the 2D and 3D views.
   *
   * Everything here is view state, never document state — the top bar owns the
   * project (floors, undo, export, save), this bar owns how the model is shown.
   * Controls that make sense in both views (Fit, Furniture) are always present;
   * the ones that only mean something on the plan (grid, snap, rulers, mini-map,
   * layers, zoom readout) are hidden in 3D and while the elevation view is open.
   */
  import {
    activeFloor,
    detectedRoomsStore,
    selectedElementIds,
    snapEnabled,
    layerVisibility,
    canvasZoom,
    showGrid,
    showRulers,
    showMinimap,
    layerPanelOpen,
    elevationWallId,
    requestFitView,
  } from '$lib/stores/project';
  import { projectSettings, formatArea } from '$lib/stores/settings';

  let { mode }: { mode: '2d' | '3d' } = $props();

  /** The elevation view replaces the plan canvas, so none of these controls
   *  reach anything while it is open — the bar drops to stats only. */
  let elevationOpen = $derived(mode === '2d' && !!$elevationWallId);
  /** Controls that act on whichever view is showing */
  let viewControls = $derived(!elevationOpen);
  /** Plan-only controls: meaningless in 3D */
  let planControls = $derived(mode === '2d' && !elevationOpen);

  let floor = $derived($activeFloor);
  let rooms = $derived($detectedRoomsStore);
  let totalArea = $derived(rooms.reduce((s, r) => s + r.area, 0));
  let showFurniture = $derived($layerVisibility.furniture);

  const btn = 'px-1.5 py-0.5 rounded hover:bg-gray-100 hover:text-gray-700 transition-colors whitespace-nowrap';
</script>

<div
  class="h-9 shrink-0 flex items-center gap-x-3 gap-y-0.5 px-3 border-t border-gray-200 bg-white text-xs text-gray-500 overflow-x-auto"
>
  <!-- Model stats — same numbers whichever view is open. Phones need the width
       for the controls, so the read-only half steps aside there. -->
  <div class="flex items-center gap-x-3 max-md:hidden">
    {#if rooms.length > 0}
      <span class="whitespace-nowrap">{rooms.length} room{rooms.length !== 1 ? 's' : ''}</span>
      <span class="whitespace-nowrap">{formatArea(totalArea, $projectSettings.units)}</span>
      <span class="text-gray-300">|</span>
    {/if}
    {#if floor}
      <span class="whitespace-nowrap">{floor.walls.length} wall{floor.walls.length !== 1 ? 's' : ''}</span>
      {#if floor.doors.length > 0}
        <span class="whitespace-nowrap">{floor.doors.length} door{floor.doors.length !== 1 ? 's' : ''}</span>
      {/if}
      {#if floor.windows.length > 0}
        <span class="whitespace-nowrap">{floor.windows.length} window{floor.windows.length !== 1 ? 's' : ''}</span>
      {/if}
      {#if floor.furniture.length > 0}
        <span class="whitespace-nowrap">{floor.furniture.length} object{floor.furniture.length !== 1 ? 's' : ''}</span>
      {/if}
    {/if}
    {#if $selectedElementIds.size > 1}
      <span class="text-gray-300">|</span>
      <span class="text-blue-600 font-medium whitespace-nowrap">{$selectedElementIds.size} selected</span>
    {/if}
  </div>

  <div class="flex-1"></div>

  <!-- Display controls -->
  {#if planControls}
    <span class="whitespace-nowrap tabular-nums max-md:hidden">Zoom: {Math.round($canvasZoom * 100)}%</span>
  {/if}
  {#if viewControls}
    <button class={btn} onclick={requestFitView} title={mode === '3d' ? 'Fit model in view' : 'Zoom to Fit (F)'}>
      ⊞ Fit
    </button>
  {/if}
  {#if planControls}
    <button class={btn} onclick={() => showGrid.update(v => !v)} title="Toggle Grid (G)">
      {$showGrid ? '▦' : '▢'} Grid
    </button>
    <button class={btn} onclick={() => snapEnabled.update(v => !v)} title="Toggle snapping — grid, walls and dimensions (S)">
      {$snapEnabled ? '🧲' : '↔'} Snap
    </button>
  {/if}
  {#if viewControls}
    <button
      class={btn}
      onclick={() => layerVisibility.update(v => ({ ...v, furniture: !v.furniture }))}
      title="Toggle Furniture ({showFurniture ? 'Visible' : 'Hidden'})"
    >
      {showFurniture ? '🪑' : '👻'} Furniture
    </button>
  {/if}
  {#if planControls}
    <button class={btn} onclick={() => layerPanelOpen.update(v => !v)} title="Layer Visibility">
      🗂 Layers
    </button>
    <button class={btn} onclick={() => showRulers.update(v => !v)} title="Toggle Rulers">
      {$showRulers ? '📏' : '📐'} Rulers
    </button>
    <button class={btn} onclick={() => showMinimap.update(v => !v)} title="Toggle Mini-map">
      🗺 Map
    </button>
  {/if}
</div>
