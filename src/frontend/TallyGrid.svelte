<script lang="ts">
  import { bridgeState } from './state.svelte.js';
  import CameraCard from './CameraCard.svelte';
</script>

<section class="grid-section">
  {#if bridgeState.cameras.length === 0}
    <div class="empty">
      <h2 class="empty-heading">Keine Kameras konfiguriert</h2>
      <p class="empty-body">Öffne den Mapping-Editor und weise jedem vMix-Eingang eine ATEM-Kamera zu.</p>
    </div>
  {:else}
    <div class="grid">
      {#each bridgeState.cameras as cam (cam.cameraId)}
        <CameraCard {cam} />
      {/each}
    </div>
  {/if}
</section>

<style>
  .grid-section {
    padding: var(--sp-lg);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: var(--sp-lg);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-md);
    padding: var(--sp-3xl) var(--sp-lg);
    text-align: center;
  }
  .empty-heading {
    font-size: var(--text-heading);
    font-weight: 700;
    color: #f9fafb;
  }
  .empty-body {
    font-size: var(--text-body);
    color: #9ca3af;
    max-width: 400px;
  }
</style>
