<script lang="ts">
  import { bridgeState } from './state.svelte.js';

  let color = $derived(
    bridgeState.latencyMs === null
      ? '#9ca3af'
      : bridgeState.latencyMs < 50
        ? '#ffffff'
        : bridgeState.latencyMs < 100
          ? '#ca8a04'
          : '#dc2626'
  );

  let label = $derived(
    bridgeState.latencyMs === null
      ? '— ms'
      : bridgeState.latencyMs > 100
        ? `${bridgeState.latencyMs} ms ⚠`
        : `${bridgeState.latencyMs} ms`
  );
</script>

<span class="readout" style="color: {color}">{label}</span>

<style>
  .readout {
    font-size: var(--text-label);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    min-width: 60px;
    text-align: right;
  }
</style>
