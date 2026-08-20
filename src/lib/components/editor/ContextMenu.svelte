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
    onclose: () => void;
    onaction: (action: string, data?: any) => void;
  }

  let { x, y, visible, targetType, targetId, targetWall, targetFurniture, targetRoom, selectedWalls = [], clipboard, onclose, onaction }: Props = $props();

  let menuEl: HTMLDivElement;

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
    if (visible && menuEl) {
      const rect = menuEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      adjustedX = x + rect.width > vw ? vw - rect.width - 8 : x;
      adjustedY = y + rect.height > vh ? vh - rect.height - 8 : y;
    } else {
      adjustedX = x;
      adjustedY = y;
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }

  function handleClickOutside(e: MouseEvent) {
    if (menuEl && !menuEl.contains(e.target as Node)) {
      onclose();
    }
  }

  function clickItem(action: string, data?: any) {
    onaction(action, data);
    onclose();
  }

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
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
    class="fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-xl py-1 min-w-[180px] text-sm select-none"
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
        <span class="ctx-icon">📦</span> Group Selected (Ctrl+G)
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('ungroup')}>
        <span class="ctx-icon">📤</span> Ungroup (Ctrl+Shift+G)
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
  }
  .ctx-item:hover {
    background: #f3f4f6;
  }
  .ctx-danger {
    color: #dc2626;
  }
  .ctx-danger:hover {
    background: #fef2f2;
  }
  /* Dark mode: the panel is repainted dark by the global .bg-white override,
     so the item colors have to follow or the labels become unreadable. */
  :global(html.dark) .ctx-item {
    color: #e5e7eb;
  }
  :global(html.dark) .ctx-item:hover {
    background: #374151;
  }
  :global(html.dark) .ctx-danger {
    color: #f87171;
  }
  :global(html.dark) .ctx-danger:hover {
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
</style>
