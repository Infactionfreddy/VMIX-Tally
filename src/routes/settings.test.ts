// Wave 0 stubs for settings + mapping REST endpoints (Phase 6 UI-01).
// Filled in by Plan 02 once the route handlers exist.
// Run: npx vitest run src/routes/settings.test.ts

import { describe, it } from 'vitest';

describe('GET /config/settings (UI-01)', () => {
  it.todo('returns current settings from ConfigStore');
});

describe('PUT /config/settings (UI-01)', () => {
  it.todo('updates settings and returns 200 with new settings');
  it.todo('rejects invalid host/port with 400 and ConfigValidationError shape');
});

describe('GET /config/mapping (UI-01)', () => {
  it.todo('returns current mapping array from ConfigStore');
});

describe('PUT /config/mapping (UI-01)', () => {
  it.todo('replaces mapping and returns 200 with new mapping');
  it.todo('rejects mapping with 9 entries with 400 (max 8)');
});
