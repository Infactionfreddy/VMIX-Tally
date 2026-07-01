<script lang="ts">
  import { onMount } from 'svelte';
  import type { PersistedMappingEntry } from '../config/schema.js';
  import MappingRow from './MappingRow.svelte';

  interface RosterInput {
    key: string;
    number: number;
  }

  let mapping = $state<PersistedMappingEntry[]>([]);
  let roster = $state<RosterInput[]>([]);
  let dirty = $state(false);
  let errorMsg = $state('');

  onMount(async () => {
    try {
      const res = await fetch('/config/mapping');
      if (res.ok) {
        const data = await res.json() as { mapping: PersistedMappingEntry[] };
        mapping = data.mapping;
      }
    } catch {
      // silent — mapping stays empty
    }
  });

  async function fetchRoster(): Promise<void> {
    try {
      const res = await fetch('/vmix/roster');
      if (res.ok) {
        const data = await res.json() as { inputs: RosterInput[] };
        roster = data.inputs;
      }
    } catch {
      roster = [];
    }
  }

  function handleRowChange(index: number, updated: PersistedMappingEntry): void {
    mapping = mapping.map((row, i) => (i === index ? updated : row));
    dirty = true;
  }

  function handleRowDelete(index: number): void {
    mapping = mapping.filter((_, i) => i !== index);
    dirty = true;
  }

  function addRow(): void {
    const newEntry: PersistedMappingEntry = {
      vmixKey: '',
      atemSource: 1,
      cameraId: '',
    };
    mapping = [...mapping, newEntry];
    dirty = true;
  }

  async function save(): Promise<void> {
    try {
      const res = await fetch('/config/mapping', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mapping),
      });
      if (res.ok) {
        dirty = false;
        errorMsg = '';
      } else {
        errorMsg = 'Mapping konnte nicht gespeichert werden. Ungültige Eingaben.';
      }
    } catch {
      errorMsg = 'Mapping konnte nicht gespeichert werden. Ungültige Eingaben.';
    }
  }
</script>

<details
  id="mapping-panel"
  class="panel"
  ontoggle={(e) => {
    if ((e.target as HTMLDetailsElement).open) void fetchRoster();
  }}
>
  <summary class="summary">Mapping · {mapping.length} Eingänge konfiguriert</summary>

  <div class="content">
    {#if mapping.length > 0}
      <table class="table">
        <thead>
          <tr>
            <th class="th">vMix Eingang</th>
            <th class="th">ATEM Source</th>
            <th class="th">Kamera-ID</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          {#each mapping as row, i (i)}
            <MappingRow
              {row}
              {roster}
              onchange={(updated) => handleRowChange(i, updated)}
              ondelete={() => handleRowDelete(i)}
            />
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="empty">Keine Einträge vorhanden. Füge einen neuen Eintrag hinzu.</p>
    {/if}

    <div class="actions">
      <button class="btn btn-add" onclick={addRow}>+ Eintrag hinzufügen</button>
      <button
        class="btn btn-save"
        disabled={!dirty}
        onclick={() => { void save(); }}
      >Mapping speichern</button>
    </div>

    {#if errorMsg}
      <p class="error">{errorMsg}</p>
    {/if}
  </div>
</details>

<style>
  .panel {
    background: var(--color-surface-raised);
    border-radius: 8px;
    margin: var(--sp-lg) var(--sp-lg) 0;
  }
  .summary {
    font-size: var(--text-heading);
    font-weight: 700;
    color: #f9fafb;
    padding: var(--sp-md);
    cursor: pointer;
    list-style: none;
    user-select: none;
  }
  .summary::-webkit-details-marker {
    display: none;
  }
  .summary::before {
    content: '▶ ';
    font-size: 10px;
    margin-right: var(--sp-xs);
    transition: none;
  }
  details[open] .summary::before {
    content: '▼ ';
  }
  .content {
    padding: 0 var(--sp-md) var(--sp-md);
  }
  .table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: var(--sp-md);
  }
  .th {
    font-size: var(--text-label);
    color: #9ca3af;
    text-align: left;
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid #374151;
    font-weight: 700;
  }
  .empty {
    font-size: var(--text-body);
    color: #6b7280;
    margin-bottom: var(--sp-md);
  }
  .actions {
    display: flex;
    gap: var(--sp-sm);
    align-items: center;
  }
  .btn {
    min-height: 36px;
    padding: 0 var(--sp-md);
    border-radius: 4px;
    font-size: var(--text-label);
    font-weight: 700;
    cursor: pointer;
    border: 1px solid #374151;
    background: var(--color-surface);
    color: #9ca3af;
  }
  .btn:hover:not(:disabled) {
    opacity: 0.85;
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn-add {
    color: #f9fafb;
    border-color: #4b5563;
  }
  .btn-save {
    background: var(--color-accent);
    color: #ffffff;
    border-color: var(--color-accent);
  }
  .error {
    font-size: var(--text-label);
    color: #ef4444;
    margin-top: var(--sp-sm);
  }
</style>
