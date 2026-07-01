<script lang="ts">
  import { bridgeState } from './state.svelte.js';
  import ConnectionBadge from './ConnectionBadge.svelte';
  import LatencyReadout from './LatencyReadout.svelte';
</script>

<header class="header">
  <h1 class="title">vMix-Tally Bridge</h1>
  <div class="badges" aria-live="polite" aria-label="Verbindungsstatus">
    <ConnectionBadge label="vMix" status={bridgeState.connections.vmix} />
    <ConnectionBadge label="ATEM" status={bridgeState.connections.atem} />
    <LatencyReadout />
  </div>
</header>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--color-surface-raised);
    padding: var(--sp-md) var(--sp-lg);
    min-height: var(--sp-xl);
    gap: var(--sp-md);
  }
  .title {
    font-size: var(--text-heading);
    font-weight: 700;
    color: #f9fafb;
    white-space: nowrap;
  }
  .badges {
    display: flex;
    align-items: center;
    gap: var(--sp-lg);
  }
</style>
