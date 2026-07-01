<script lang="ts">
  import { bridgeState } from './state.svelte.js';

  let activeCount = $derived(
    Object.values(bridgeState.overrides).filter(v => v !== null).length
  );

  let dismissed = $state(false);
</script>

{#if activeCount > 0 && !dismissed}
  <div class="banner">
    <span class="message">{activeCount} Kamera(s) mit aktivem manuellen Override</span>
    <button
      class="dismiss"
      onclick={() => { dismissed = true; }}
      aria-label="Override-Warnung ausblenden"
    >×</button>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #ea580c;
    color: #ffffff;
    padding: var(--sp-sm) var(--sp-md);
    width: 100%;
  }
  .message {
    font-size: var(--text-body);
    font-weight: 700;
  }
  .dismiss {
    background: transparent;
    border: none;
    color: #ffffff;
    font-size: 18px;
    font-weight: 700;
    cursor: pointer;
    padding: 0 var(--sp-xs);
    line-height: 1;
    min-height: 36px;
    min-width: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dismiss:hover {
    opacity: 0.8;
  }
</style>
