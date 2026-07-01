<script lang="ts">
  import { bridgeState } from './state.svelte.js';

  let { cameraId, currentOverride }: {
    cameraId: string;
    currentOverride: 'program' | 'preview' | null;
  } = $props();

  let errorMsg = $state('');

  async function setOverride(id: string, state: 'program' | 'preview' | null): Promise<void> {
    try {
      const res = await fetch(`/overrides/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) {
        errorMsg = 'Override konnte nicht gesetzt werden.';
      } else {
        errorMsg = '';
      }
      // No local state update — WS broadcast from server drives the change
    } catch {
      errorMsg = 'Override konnte nicht gesetzt werden.';
    }
  }

  function handleToggle(target: 'program' | 'preview' | null): void {
    // Clicking the active button sends null (clear); clicking inactive sends the value
    const next = currentOverride === target ? null : target;
    void setOverride(cameraId, next);
  }
</script>

<div class="controls">
  <button
    class="btn"
    class:active-off={currentOverride === null}
    disabled={!bridgeState.wsConnected}
    onclick={() => handleToggle(null)}
  >Aus</button>
  <button
    class="btn"
    class:active-override={currentOverride === 'program'}
    disabled={!bridgeState.wsConnected}
    onclick={() => handleToggle('program')}
  >PROG</button>
  <button
    class="btn"
    class:active-override={currentOverride === 'preview'}
    disabled={!bridgeState.wsConnected}
    onclick={() => handleToggle('preview')}
  >PREV</button>
</div>

{#if errorMsg}
  <p class="error">{errorMsg}</p>
{/if}

<style>
  .controls {
    display: flex;
    gap: var(--sp-xs);
  }
  .btn {
    min-height: 36px;
    padding: 0 var(--sp-sm);
    border: 1px solid #374151;
    border-radius: 4px;
    background: var(--color-surface);
    color: #9ca3af;
    font-size: var(--text-label);
    font-weight: 700;
    cursor: pointer;
    flex: 1;
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn:not(:disabled):hover {
    opacity: 0.85;
  }
  .btn.active-off {
    background: var(--tally-off);
    color: #d1d5db;
    border-color: var(--tally-off);
  }
  .btn.active-override {
    background: var(--tally-override);
    color: #ffffff;
    border-color: var(--tally-override);
  }
  .error {
    font-size: var(--text-label);
    color: #ef4444;
    margin-top: var(--sp-xs);
  }
</style>
