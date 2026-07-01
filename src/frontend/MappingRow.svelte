<script lang="ts">
  import type { PersistedMappingEntry } from '../config/schema.js';

  interface RosterInput {
    key: string;
    number: number;
  }

  let { row, roster, onchange, ondelete }: {
    row: PersistedMappingEntry;
    roster: RosterInput[];
    onchange: (row: PersistedMappingEntry) => void;
    ondelete: () => void;
  } = $props();

  // Two-step delete confirmation state
  let deleteArmed = $state(false);

  function handleVmixKeyChange(key: string): void {
    onchange({ ...row, vmixKey: key });
  }

  function handleAtemSourceChange(val: string): void {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) {
      onchange({ ...row, atemSource: num });
    }
  }

  function handleCameraIdChange(val: string): void {
    onchange({ ...row, cameraId: val });
  }

  function handleDeleteClick(): void {
    if (deleteArmed) {
      ondelete();
    } else {
      deleteArmed = true;
    }
  }
</script>

<tr class="row">
  <td class="cell">
    {#if roster.length > 0}
      <select
        class="input"
        value={row.vmixKey}
        onchange={(e) => handleVmixKeyChange((e.target as HTMLSelectElement).value)}
      >
        <option value="">-- wählen --</option>
        {#each roster as i}
          <option value={i.key}>Input {i.number}</option>
        {/each}
      </select>
    {:else}
      <input
        type="text"
        class="input"
        placeholder="vMix GUID eingeben"
        value={row.vmixKey}
        oninput={(e) => handleVmixKeyChange((e.target as HTMLInputElement).value)}
      />
    {/if}
  </td>
  <td class="cell">
    <input
      type="number"
      class="input input-num"
      min="1"
      value={row.atemSource}
      oninput={(e) => handleAtemSourceChange((e.target as HTMLInputElement).value)}
    />
  </td>
  <td class="cell">
    <input
      type="text"
      class="input"
      value={row.cameraId}
      oninput={(e) => handleCameraIdChange((e.target as HTMLInputElement).value)}
    />
  </td>
  <td class="cell cell-delete">
    {#if deleteArmed}
      <button
        class="btn btn-confirm"
        onclick={handleDeleteClick}
      >Löschen bestätigen?</button>
      <button
        class="btn btn-cancel"
        onclick={() => { deleteArmed = false; }}
      >Abbrechen</button>
    {:else}
      <button
        class="btn btn-delete"
        aria-label="Zeile löschen"
        onclick={handleDeleteClick}
      >×</button>
    {/if}
  </td>
</tr>

<style>
  .row {
    border-bottom: 1px solid #374151;
  }
  .cell {
    padding: var(--sp-xs) var(--sp-sm);
    vertical-align: middle;
  }
  .cell-delete {
    white-space: nowrap;
    text-align: right;
  }
  .input {
    background: var(--color-surface-raised);
    border: 1px solid #374151;
    border-radius: 4px;
    color: #f9fafb;
    font-size: var(--text-body);
    padding: var(--sp-xs) var(--sp-sm);
    width: 100%;
    min-height: 32px;
  }
  .input:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .input-num {
    width: 60px;
  }
  .btn {
    min-height: 32px;
    padding: 0 var(--sp-sm);
    border-radius: 4px;
    font-size: var(--text-label);
    font-weight: 700;
    cursor: pointer;
    border: 1px solid #374151;
    background: var(--color-surface);
    color: #9ca3af;
  }
  .btn:hover {
    opacity: 0.85;
  }
  .btn-delete {
    color: #9ca3af;
    font-size: 16px;
  }
  .btn-confirm {
    background: #ef4444;
    color: #ffffff;
    border-color: #ef4444;
    margin-right: var(--sp-xs);
  }
  .btn-cancel {
    color: #9ca3af;
  }
</style>
