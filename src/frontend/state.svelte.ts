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

/**
 * Tracks which cameraId is currently in test mode (D-12).
 * Only one camera can be in test mode at a time.
 * Exported as a mutable $state object so TestControls instances can coordinate.
 */
export const testState = $state<{ activeCameraInTest: string | null }>({
  activeCameraInTest: null,
});
