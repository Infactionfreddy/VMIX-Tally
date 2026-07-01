// Wave 0 stubs for PUT /overrides/:cameraId REST endpoint (Phase 6 D-07, UI-04).
// Filled in by Plan 02 once the route handler exists.
// Run: npx vitest run src/routes/overrides.test.ts

import { describe, it } from 'vitest';

describe('PUT /overrides/:cameraId (UI-04, D-07)', () => {
  it.todo('sets override to program and returns 200 with overrides map');
  it.todo('sets override to preview and returns 200 with overrides map');
  it.todo('clears override when state is null and returns 200');
  it.todo('returns 400 for invalid state value');
  it.todo('triggers WS broadcast immediately after override write');
});
