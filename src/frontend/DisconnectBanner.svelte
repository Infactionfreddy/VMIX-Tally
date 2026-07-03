<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { bridgeState } from './state.svelte.js';

  let hasDisconnect = $derived(
    bridgeState.connections.vmix === 'disconnected' ||
    bridgeState.connections.atem === 'disconnected'
  );
</script>

{#if hasDisconnect}
  <div
    class="banner"
    aria-live="assertive"
    in:fly={{ y: -12, duration: 250 }}
    out:fade={{ duration: 200 }}
  >
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
