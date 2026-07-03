<script lang="ts">
  import type { ConnectionStatus } from './state.svelte.js';

  let { label, status }: { label: string; status: ConnectionStatus } = $props();

  const statusText: Record<ConnectionStatus, string> = {
    connected: 'Verbunden',
    connecting: 'Verbinde …',
    disconnected: 'Getrennt',
  };

  const dotColor: Record<ConnectionStatus, string> = {
    connected: '#16a34a',
    connecting: '#ca8a04',
    disconnected: '#dc2626',
  };
</script>

<div class="badge" aria-live="polite">
  <span class="dot" style="background: {dotColor[status]}"></span>
  <span class="label">{label}</span>
  <span class="status">{statusText[status]}</span>
</div>

<style>
  .badge {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    font-size: var(--text-label);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: background 0.3s ease;
  }
  .label {
    font-weight: 700;
    color: #f9fafb;
  }
  .status {
    color: #9ca3af;
  }
</style>
