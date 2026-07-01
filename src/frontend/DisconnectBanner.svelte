<script lang="ts">
  import { bridgeState } from './state.svelte.js';

  let hasDisconnect = $derived(
    bridgeState.connections.vmix === 'disconnected' ||
    bridgeState.connections.atem === 'disconnected'
  );
</script>

{#if hasDisconnect}
  <div class="banner" aria-live="assertive">
    {#if bridgeState.connections.vmix === 'disconnected'}
      <p>vMix getrennt — Tally-Daten möglicherweise veraltet</p>
    {/if}
    {#if bridgeState.connections.atem === 'disconnected'}
      <p>ATEM getrennt — Kein Tally-Ausgang aktiv</p>
    {/if}
  </div>
{/if}

<style>
  .banner {
    background: #dc2626;
    color: #ffffff;
    padding: var(--sp-sm) var(--sp-md);
    width: 100%;
  }
  .banner p {
    font-size: var(--text-body);
    font-weight: 700;
    line-height: 1.5;
  }
</style>
