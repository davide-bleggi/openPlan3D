<script lang="ts">
  /**
   * Creating a floor (issue #15) — kept separate from the floor manager, which
   * only edits floors that already exist.
   *
   * A new floor always lands on top of the stack. It can start blank or as an
   * independent copy of any existing floor — the one below it by default.
   */
  import { currentProject, addFloor } from '$lib/stores/project';
  import { orderFloorsBottomUp } from '$lib/utils/floorOrder';
  import { floorNameForLevel } from '$lib/utils/floorStacking';
  import type { Floor } from '$lib/models/types';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let mode = $state<'empty' | 'copy'>('copy');
  let includeFurniture = $state(false);
  /** Which existing floor to copy. Defaults to the one the new floor lands on. */
  let sourceId = $state('');

  let stack: Floor[] = $derived($currentProject ? orderFloorsBottomUp($currentProject.floors) : []);
  /** Highest floor first, so the list reads like the building. */
  let choices: Floor[] = $derived([...stack].reverse());
  let below: Floor | undefined = $derived(stack[stack.length - 1]);
  const labelOf = (floor: Floor) => floor.name || floorNameForLevel(floor.level ?? 0);
  let belowName = $derived(below ? labelOf(below) : 'the floor below');

  // Every time the dialog opens it starts from the same defaults: copy the
  // floor the new one will sit on, structure only.
  $effect(() => {
    if (!open) return;
    mode = 'copy';
    includeFurniture = false;
    sourceId = below?.id ?? '';
  });

  function close() {
    open = false;
  }

  function confirm() {
    addFloor(mode === 'copy' ? { copyFrom: sourceId || 'previous', includeFurniture } : {});
    close();
  }
</script>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
    onclick={close}
    onkeydown={(e) => { if (e.key === 'Escape') close(); }}
    role="dialog"
    tabindex="-1"
    aria-label="Add floor"
  >
    <div
      class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[420px] max-w-full flex flex-col"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="document"
    >
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 class="font-semibold text-gray-800 dark:text-gray-100">Add floor</h2>
        <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none" onclick={close} aria-label="Close">×</button>
      </div>

      <div class="p-4 space-y-3">
        <p class="text-xs text-gray-500 dark:text-gray-400">
          The new floor goes on top of the stack, above {belowName}.
        </p>

        <label class="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
          <input type="radio" class="mt-1" bind:group={mode} value="empty" />
          <span>
            Start empty
            <span class="block text-xs text-gray-400">A blank plan.</span>
          </span>
        </label>

        <label class="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
          <input type="radio" class="mt-1" bind:group={mode} value="copy" />
          <span>
            Copy an existing floor
            <span class="block text-xs text-gray-400">Walls, rooms, doors, windows, columns and stairs — fully independent afterwards.</span>
          </span>
        </label>

        {#if mode === 'copy'}
          <div class="pl-6 space-y-2">
            <label class="block text-xs font-medium text-gray-500 dark:text-gray-400" for="add-floor-source">Copy from</label>
            <select
              id="add-floor-source"
              bind:value={sourceId}
              class="w-full px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 outline-none focus:border-blue-400"
            >
              {#each choices as fl}
                <option value={fl.id}>{labelOf(fl)}{fl.id === below?.id ? ' (floor below)' : ''}</option>
              {/each}
            </select>
            <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
              <input type="checkbox" bind:checked={includeFurniture} />
              Also copy furniture
            </label>
          </div>
        {/if}
      </div>

      <div class="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
        <button class="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" onclick={close}>Cancel</button>
        <button class="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded font-medium" onclick={confirm}>Add floor</button>
      </div>
    </div>
  </div>
{/if}
