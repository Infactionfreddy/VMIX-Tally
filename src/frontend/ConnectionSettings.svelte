<script lang="ts">
  interface ConnectionInfo {
    host: string;
    port: number;
  }

  interface InitialSettings {
    vmix?: ConnectionInfo | null;
    atem?: ConnectionInfo | null;
  }

  let { initialSettings }: { initialSettings?: InitialSettings } = $props();

  let vmixHost = $state(initialSettings?.vmix?.host ?? '');
  let vmixPort = $state(initialSettings?.vmix?.port ?? 8099);
  let atemHost = $state(initialSettings?.atem?.host ?? '');
  let errorMsg = $state('');

  async function save(): Promise<void> {
    try {
      const res = await fetch('/config/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vmix: { host: vmixHost, port: Number(vmixPort) },
          atem: { host: atemHost, port: 9910 },
        }),
      });
      if (res.ok) {
        errorMsg = '';
        // Close the <details> panel on success
        const panel = document.querySelector('#settings-panel') as HTMLDetailsElement | null;
        if (panel) {
          panel.open = false;
        }
      } else {
        errorMsg = 'Einstellungen konnten nicht gespeichert werden. Bitte Eingaben prüfen.';
      }
    } catch {
      errorMsg = 'Einstellungen konnten nicht gespeichert werden. Bitte Eingaben prüfen.';
    }
  }
</script>

<details id="settings-panel" class="panel">
  <summary class="summary">
    Verbindung · vMix {vmixHost || '—'}:{vmixPort} · ATEM {atemHost || '—'}
  </summary>

  <div class="content">
    <div class="form">
      <div class="field">
        <label class="label" for="vmix-host">vMix Host</label>
        <input
          id="vmix-host"
          type="text"
          class="input"
          bind:value={vmixHost}
          placeholder="192.168.1.10"
        />
      </div>
      <div class="field">
        <label class="label" for="vmix-port">vMix Port (TCP)</label>
        <input
          id="vmix-port"
          type="number"
          class="input input-port"
          bind:value={vmixPort}
          min="1"
          max="65535"
        />
      </div>
      <div class="field">
        <label class="label" for="atem-host">ATEM Host</label>
        <input
          id="atem-host"
          type="text"
          class="input"
          bind:value={atemHost}
          placeholder="192.168.1.20"
        />
      </div>
    </div>

    <button
      class="btn btn-save"
      onclick={() => { void save(); }}
    >Einstellungen speichern</button>

    {#if errorMsg}
      <p class="error">{errorMsg}</p>
    {/if}
  </div>
</details>

<style>
  .panel {
    background: var(--color-surface-raised);
    border-radius: 8px;
    margin: var(--sp-md) var(--sp-lg) var(--sp-lg);
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
  }
  details[open] .summary::before {
    content: '▼ ';
  }
  .content {
    padding: 0 var(--sp-md) var(--sp-md);
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    margin-bottom: var(--sp-md);
    max-width: 400px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }
  .label {
    font-size: var(--text-label);
    color: #9ca3af;
    font-weight: 700;
  }
  .input {
    background: var(--color-surface);
    border: 1px solid #374151;
    border-radius: 4px;
    color: #f9fafb;
    font-size: var(--text-body);
    padding: var(--sp-xs) var(--sp-sm);
    min-height: 36px;
  }
  .input:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .input-port {
    width: 120px;
  }
  .btn-save {
    min-height: 36px;
    padding: 0 var(--sp-lg);
    border-radius: 4px;
    font-size: var(--text-label);
    font-weight: 700;
    cursor: pointer;
    border: none;
    background: var(--color-accent);
    color: #ffffff;
  }
  .btn-save:hover {
    opacity: 0.9;
  }
  .error {
    font-size: var(--text-label);
    color: #ef4444;
    margin-top: var(--sp-sm);
  }
</style>
