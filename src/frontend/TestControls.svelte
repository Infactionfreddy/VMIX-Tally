<script lang="ts">
  import { bridgeState, testState } from './state.svelte.js';

  let { cameraId }: { cameraId: string } = $props();

  let testActive = $derived(testState.activeCameraInTest === cameraId);

  async function postTest(id: string, action: 'program' | 'preview' | 'clear'): Promise<void> {
    await fetch(`/test/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  }

  async function startTest(action: 'program' | 'preview'): Promise<void> {
    const prev = testState.activeCameraInTest;
    // If another camera is in test, clear it first
    if (prev !== null && prev !== cameraId) {
      await postTest(prev, 'clear');
    }
    await postTest(cameraId, action);
    testState.activeCameraInTest = cameraId;
  }

  async function finishTest(): Promise<void> {
    await postTest(cameraId, 'clear');
    testState.activeCameraInTest = null;
  }
</script>

<div class="controls" class:test-active={testActive}>
  <button
    class="btn"
    disabled={!bridgeState.wsConnected}
    onclick={() => { void startTest('program'); }}
  >Test: PROG</button>
  <button
    class="btn"
    disabled={!bridgeState.wsConnected}
    onclick={() => { void startTest('preview'); }}
  >Test: PREV</button>
  {#if testActive}
    <button
      class="btn btn-fertig"
      disabled={!bridgeState.wsConnected}
      onclick={() => { void finishTest(); }}
    >Fertig</button>
  {/if}
</div>

<style>
  .controls {
    display: flex;
    gap: var(--sp-xs);
    flex-wrap: wrap;
  }
  .controls.test-active {
    outline: 2px dashed var(--tally-override);
    outline-offset: 4px;
    border-radius: 4px;
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
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn:not(:disabled):hover {
    opacity: 0.85;
  }
  .btn-fertig {
    background: #374151;
    color: #f9fafb;
    border-color: #6b7280;
  }
</style>
