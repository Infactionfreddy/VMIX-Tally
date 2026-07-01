<script lang="ts">
  import { onMount } from 'svelte';
  import { bridgeState } from './state.svelte.js';
  import Header from './Header.svelte';
  import DisconnectBanner from './DisconnectBanner.svelte';
  import OverrideBanner from './OverrideBanner.svelte';
  import TallyGrid from './TallyGrid.svelte';
  import MappingEditor from './MappingEditor.svelte';
  import ConnectionSettings from './ConnectionSettings.svelte';

  // Track whether a connection has ever been attempted so the overlay
  // does not flash on initial page load before the first WS open event.
  let wsAttempted = $state(false);

  // Pre-populated settings for ConnectionSettings component
  interface ConnectionInfo { host: string; port: number; }
  interface InitialSettings {
    vmix?: ConnectionInfo | null;
    atem?: ConnectionInfo | null;
  }
  let initialSettings = $state<InitialSettings | undefined>(undefined);

  onMount(() => {
    function connect(): WebSocket {
      const ws = new WebSocket(`ws://${location.host}/ws`);

      ws.onopen = () => {
        wsAttempted = true;
        bridgeState.wsConnected = true;
      };

      ws.onmessage = (event: MessageEvent) => {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        if (msg.type === 'state') {
          bridgeState.cameras = msg.cameras as typeof bridgeState.cameras;
          bridgeState.connections = msg.connections as typeof bridgeState.connections;
          bridgeState.latencyMs = msg.latencyMs as number | null;
          bridgeState.overrides = msg.overrides as typeof bridgeState.overrides;
        }
      };

      ws.onclose = () => {
        bridgeState.wsConnected = false;
        setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };

      return ws;
    }

    const ws = connect();

    // Pre-populate connection settings for ConnectionSettings component
    fetch('/config/settings')
      .then(res => (res.ok ? res.json() : null))
      .then((data: { settings: InitialSettings } | null) => {
        if (data?.settings) {
          initialSettings = data.settings;
        }
      })
      .catch(() => null);

    return () => {
      ws.close();
    };
  });
</script>

<div class="app">
  <Header />
  <DisconnectBanner />
  <OverrideBanner />
  <TallyGrid />
  <MappingEditor />
  <ConnectionSettings initialSettings={initialSettings} />

  {#if !bridgeState.wsConnected && wsAttempted}
    <div class="ws-overlay" aria-live="assertive">
      <p>Verbindung zur Bridge unterbrochen — Seite neu laden</p>
      <button onclick={() => location.reload()}>Neu laden</button>
    </div>
  {/if}
</div>

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .ws-overlay {
    position: fixed;
    inset: 0;
    background: rgba(17, 24, 39, 0.95);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-lg);
    z-index: 9999;
    color: #f9fafb;
    text-align: center;
    padding: var(--sp-lg);
  }
  .ws-overlay p {
    font-size: var(--text-heading);
    font-weight: 700;
  }
  .ws-overlay button {
    background: var(--color-accent);
    color: #ffffff;
    border: none;
    padding: var(--sp-sm) var(--sp-lg);
    border-radius: 6px;
    font-size: var(--text-body);
    font-weight: 700;
    cursor: pointer;
    min-height: 36px;
  }
  .ws-overlay button:hover {
    opacity: 0.9;
  }
</style>
