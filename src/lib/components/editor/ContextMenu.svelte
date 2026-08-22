<script lang="ts">
  import { onMount } from 'svelte';
  import {
    selectedElementId, selectedElementIds, selectedTool,
    removeElement, duplicateFurniture, duplicateWall,
    rotateFurniture, scaleFurniture, splitWall,
    updateWall, updateRoom, removeWall,
    beginUndoGroup, endUndoGroup, updateFurniture
  } from '$lib/stores/project';
  import type { Wall, Door, Window as Win, FurnitureItem, Room } from '$lib/models/types';
  import type { Clipboard } from '$lib/utils/clipboard';

  interface Props {
    x: number;
    y: number;
    visible: boolean;
    targetType: 'furniture' | 'wall' | 'door' | 'window' | 'room' | 'canvas' | null;
    targetId: string | null;
    targetWall?: Wall | null;
    targetFurniture?: FurnitureItem | null;
    targetRoom?: Room | null;
    selectedWalls?: Wall[];
    clipboard?: Clipboard | null;
    /** Opened by a long-press: use touch-sized rows and keep clear of the finger. */
    touch?: boolean;
    onclose: () => void;
    onaction: (action: string, data?: any) => void;
  }

  let { x, y, visible, targetType, targetId, targetWall, targetFurniture, targetRoom, selectedWalls = [], clipboard, touch = false, onclose, onaction }: Props = $props();

  let menuEl: HTMLDivElement;

  /** Gap kept between the menu and the viewport edges. */
  const MARGIN = 8;
  /** How far a touch-opened menu sits from the press point, so the finger doesn't cover it. */
  const TOUCH_OFFSET = 12;

  // Adjust position to keep menu within viewport
  let adjustedX = $state(0);
  let adjustedY = $state(0);

  let clipboardCount = $derived(clipboard?.entries.length ?? 0);
  /** A right-click on empty canvas still offers Copy while something is
   *  selected — the selection is what a copy acts on, not the click target. */
  let hasSelection = $derived($selectedElementIds.size > 0 || !!$selectedElementId);
  let pasteLabel = $derived(clipboardCount > 1 ? `Paste ${clipboardCount} Elements` : 'Paste');

  let selectedWallCount = $derived(selectedWalls?.length ?? 0);
  let hiddenWallCount = $derived(selectedWalls?.filter(w => w.hidden).length ?? 0);

  $effect(() => {
    if (!visible || !menuEl) {
      adjustedX = x;
      adjustedY = y;
      return;
    }
    // Width/height are independent of left/top, so measuring before the new
    // position is applied is safe. Height is already capped by max-height.
    const { width, height } = menuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let nx = touch ? x + TOUCH_OFFSET : x;
    if (nx + width > vw - MARGIN) nx = touch ? x - width - TOUCH_OFFSET : vw - width - MARGIN;
    adjustedX = Math.max(MARGIN, nx);

    let ny = y;
    // On touch, prefer flipping above the press point over sliding up underneath
    // the finger — sliding up would put the first item right where it is resting.
    if (touch && y + height > vh - MARGIN && y - height - MARGIN >= MARGIN) ny = y - height;
    if (ny + height > vh - MARGIN) ny = vh - height - MARGIN;
    adjustedY = Math.max(MARGIN, ny);
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }

  function handleOutsidePointer(e: Event) {
    if (menuEl && !menuEl.contains(e.target as Node)) {
      onclose();
    }
  }

  function clickItem(action: string, data?: any) {
    onaction(action, data);
    onclose();
  }

  onMount(() => {
    document.addEventListener('mousedown', handleOutsidePointer, true);
    document.addEventListener('touchstart', handleOutsidePointer, true);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('mousedown', handleOutsidePointer, true);
      document.removeEventListener('touchstart', handleOutsidePointer, true);
      document.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

{#snippet copyPaste()}
  <button class="ctx-item" role="menuitem" onclick={() => clickItem('copy')}>
    <span class="ctx-icon">📄</span> Copy <span class="ctx-hint">Ctrl+C</span>
  </button>
  {#if clipboardCount > 0}
    <button class="ctx-item" role="menuitem" onclick={() => clickItem('paste')}>
      <span class="ctx-icon">📋</span> {pasteLabel} <span class="ctx-hint">Ctrl+V</span>
    </button>
  {/if}
{/snippet}

{#if visible}
  <div
    bind:this={menuEl}
    class="ctx-menu fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-xl py-1 text-sm select-none {touch ? 'ctx-touch min-w-[220px]' : 'min-w-[180px]'}"
    style="left: {adjustedX}px; top: {adjustedY}px;"
    role="menu"
  >
    {#if targetType === 'furniture'}
      {@render copyPaste()}
      <div class="ctx-sep"></div>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('duplicate-furniture')}>
        <span class="ctx-icon">⧉</span> Duplicate
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('rotate-furniture-90')}>
        <span class="ctx-icon">🔄</span> Rotate 90°
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('flip-horizontal')}>
        <span class="ctx-icon">↔️</span> Flip Horizontal
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('bring-to-front')}>
        <span class="ctx-icon">⬆️</span> Bring to Front
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('send-to-back')}>
        <span class="ctx-icon">⬇️</span> Send to Back
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('toggle-lock')}>
        <span class="ctx-icon">{targetFurniture?.locked ? '🔓' : '🔒'}</span> {targetFurniture?.locked ? 'Unlock' : 'Lock'}
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('properties')}>
        <span class="ctx-icon">⚙️</span> Properties
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item ctx-danger" role="menuitem" onclick={() => clickItem('delete')}>
        <span class="ctx-icon">🗑️</span> Delete
      </button>

    {:else if targetType === 'wall'}
      {@render copyPaste()}
      <div class="ctx-sep"></div>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('split-wall')}>
        <span class="ctx-icon">✂️</span> Split Wall
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('toggle-curve')}>
        <span class="ctx-icon">〰️</span> Curve {targetWall?.curvePoint ? 'Off' : 'On'}
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('toggle-wall-hidden')}>
        <span class="ctx-icon">{targetWall?.hidden ? '👁' : '🚫'}</span> {targetWall?.hidden ? 'Show Selected Wall' : 'Hide Selected Wall'}
      </button>
      {#if selectedWallCount > 1}
        <button class="ctx-item" role="menuitem" onclick={() => clickItem('hide-selected-walls')}>
          <span class="ctx-icon">🚫</span> Hide {selectedWallCount} Selected Walls
        </button>
        <button class="ctx-item" role="menuitem" onclick={() => clickItem('show-selected-walls')}>
          <span class="ctx-icon">👁</span> Show {selectedWallCount} Selected Walls
        </button>
      {/if}
      <div class="ctx-sep"></div>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('properties')}>
        <span class="ctx-icon">⚙️</span> Properties
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item ctx-danger" role="menuitem" onclick={() => clickItem('delete')}>
        <span class="ctx-icon">🗑️</span> Delete Wall
      </button>

    {:else if targetType === 'door' || targetType === 'window'}
      {@render copyPaste()}
      <div class="ctx-sep"></div>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('properties')}>
        <span class="ctx-icon">⚙️</span> Properties
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item ctx-danger" role="menuitem" onclick={() => clickItem('delete')}>
        <span class="ctx-icon">🗑️</span> Delete
      </button>

    {:else if targetType === 'room'}
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('rename-room')}>
        <span class="ctx-icon">✏️</span> Rename Room
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('change-floor-texture')}>
        <span class="ctx-icon">🎨</span> Change Floor Texture
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item ctx-danger" role="menuitem" onclick={() => clickItem('delete-room')}>
        <span class="ctx-icon">🗑️</span> Delete Room
      </button>

    {:else if targetType === 'canvas'}
      {#if hasSelection}
        <button class="ctx-item" role="menuitem" onclick={() => clickItem('copy')}>
          <span class="ctx-icon">📄</span> Copy Selection <span class="ctx-hint">Ctrl+C</span>
        </button>
      {/if}
      {#if clipboardCount > 0}
        <button class="ctx-item" role="menuitem" onclick={() => clickItem('paste')}>
          <span class="ctx-icon">📋</span> {pasteLabel} <span class="ctx-hint">Ctrl+V</span>
        </button>
      {/if}
      {#if hasSelection || clipboardCount > 0}
        <div class="ctx-sep"></div>
      {/if}
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('select-all')}>
        <span class="ctx-icon">⬜</span> Select All
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('group')}>
        <span class="ctx-icon">📦</span> Group Selected{touch ? '' : ' (Ctrl+G)'}
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('ungroup')}>
        <span class="ctx-icon">📤</span> Ungroup{touch ? '' : ' (Ctrl+Shift+G)'}
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('add-wall')}>
        <span class="ctx-icon">🧱</span> Add Wall
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('zoom-to-fit')}>
        <span class="ctx-icon">🔍</span> Zoom to Fit
      </button>
    {/if}
  </div>
{/if}

<style>
  .ctx-menu {
    /* A tall menu near a short viewport scrolls instead of overflowing offscreen */
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .ctx-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 14px;
    text-align: left;
    cursor: pointer;
    border: none;
    background: none;
    color: #374151;
    font-size: 13px;
    white-space: nowrap;
    /* Suppress the tap-highlight / callout the OS would otherwise draw */
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }
  .ctx-danger {
    color: #dc2626;
  }
  /* Dark mode: the panel is repainted dark by the global .bg-white override,
     so the item colors have to follow or the labels become unreadable. */
  :global(html.dark) .ctx-item {
    color: #e5e7eb;
  }
  :global(html.dark) .ctx-danger {
    color: #f87171;
  }
  /* Hover is guarded so a tapped item on touch doesn't keep a stuck highlight;
     :active gives touch its own press feedback instead. */
  @media (hover: hover) {
    .ctx-item:hover {
      background: #f3f4f6;
    }
    .ctx-danger:hover {
      background: #fef2f2;
    }
    :global(html.dark) .ctx-item:hover {
      background: #374151;
    }
    :global(html.dark) .ctx-danger:hover {
      background: #451a1a;
    }
  }
  .ctx-item:active {
    background: #e5e7eb;
  }
  .ctx-danger:active {
    background: #fee2e2;
  }
  :global(html.dark) .ctx-item:active {
    background: #374151;
  }
  :global(html.dark) .ctx-danger:active {
    background: #451a1a;
  }
  .ctx-hint {
    margin-left: auto;
    padding-left: 16px;
    font-size: 11px;
    color: #9ca3af;
  }
  .ctx-icon {
    width: 18px;
    text-align: center;
    font-size: 14px;
  }
  .ctx-sep {
    height: 1px;
    background: #e5e7eb;
    margin: 4px 0;
  }
  :global(html.dark) .ctx-sep {
    background: #374151;
  }

  /* Touch-opened menu: rows meet the 44px minimum tap target, and the
     keyboard hints go — they mean nothing on a phone and drive the width. */
  .ctx-touch .ctx-item {
    min-height: 44px;
    padding: 10px 16px;
    font-size: 15px;
    gap: 12px;
  }
  .ctx-touch .ctx-icon {
    width: 22px;
    font-size: 17px;
  }
  .ctx-touch .ctx-sep {
    margin: 6px 0;
  }
  .ctx-touch .ctx-hint {
    display: none;
  }
</style>
