<script lang="ts">
  import { bridgeState } from './state.svelte.js';
  import type { CameraSnapshot } from './state.svelte.js';
  import TallyBadge from './TallyBadge.svelte';
  import OverrideControls from './OverrideControls.svelte';
  import TestControls from './TestControls.svelte';

  let { cam }: { cam: CameraSnapshot } = $props();

  let currentOverride = $derived(bridgeState.overrides[cam.cameraId] ?? null);
</script>

<div class="card" class:has-override={currentOverride !== null}>
  <p class="name">{cam.name}</p>
  <TallyBadge tally={cam.tally} />
  <OverrideControls cameraId={cam.cameraId} currentOverride={currentOverride} />
  <TestControls cameraId={cam.cameraId} />
</div>

<style>
  .card {
    background: var(--color-surface-raised);
    padding: var(--sp-md);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    border-left: 4px solid transparent;
  }
  .card.has-override {
    border-left-color: var(--tally-override);
  }
  .name {
    font-size: var(--text-heading);
    font-weight: 700;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: #f9fafb;
  }
</style>
