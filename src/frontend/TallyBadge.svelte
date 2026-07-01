<script lang="ts">
  import type { TallyValue } from './state.svelte.js';

  let { tally }: { tally: TallyValue } = $props();

  const labels: Record<TallyValue, string> = {
    program: 'LIVE',
    preview: 'PREV',
    off: '—',
  };
</script>

<div
  class="badge"
  class:program={tally === 'program'}
  class:preview={tally === 'preview'}
  class:off={tally === 'off'}
>
  {labels[tally]}
</div>

<style>
  .badge {
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-display);
    font-weight: 700;
    text-transform: uppercase;
    border-radius: 4px;
    padding: var(--sp-xs) var(--sp-sm);
  }
  .program { background: var(--tally-program); color: #fff; }
  .preview { background: var(--tally-preview); color: #fff; }
  .off     { background: var(--tally-off); color: #9ca3af; }
</style>
