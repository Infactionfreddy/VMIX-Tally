import type { CameraTallyState } from '../core/events.js';

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';
export type TallyValue = CameraTallyState;

export interface CameraSnapshot {
  cameraId: string;
  name: string;
  tally: TallyValue;
}

export interface BridgeState {
  cameras: CameraSnapshot[];
  connections: { vmix: ConnectionStatus; atem: ConnectionStatus };
  latencyMs: number | null;
  overrides: Record<string, 'program' | 'preview' | null>;
  wsConnected: boolean;
}

// CRITICAL: export an object (proxy), never a bare `let`
export const bridgeState = $state<BridgeState>({
  cameras: [],
  connections: { vmix: 'connecting', atem: 'connecting' },
  latencyMs: null,
  overrides: {},
  wsConnected: false,
});
