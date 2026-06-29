---
phase: 02
slug: config-persistence-mapping-model
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-29
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (scoped to `src/**/*.test.ts`) |
| **Quick run command** | `npx vitest run src/config` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/config`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green (Phase 1's 62 tests stay green — this phase must NOT touch `src/core/`)
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

> Filled by the planner against the actual task IDs. Anchor tests to the
> validation architecture from RESEARCH.md (round-trip persistence,
> Number-reorder-survives-by-Key, atomicity/crash-mid-save, corrupt-file
> quarantine, invariant rejection).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | CFG-01 / CFG-02 / MAP-01 | — | Bad/missing config never crashes; degrades to safe defaults | unit | `npx vitest run src/config` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/config/*.test.ts` — test stubs for CFG-01, CFG-02, MAP-01
- [ ] vitest already installed and configured (Phase 1) — no framework install needed

*Existing vitest infrastructure covers all phase requirements; only new test files for `src/config/` are required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| True crash-durability (power-cut after rename, pre-fsync) | CFG-* (SC4 boundary) | steno does not `fsync`; atomicity (no torn file) is testable but durability is not deterministically reproducible in CI | Documented as an accepted threat-model boundary in RESEARCH.md; atomicity itself IS automated below |

*Atomicity (no torn/half-written file on interrupted save) has an automated test; only fsync-level durability is manual/accepted-boundary.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (use `vitest run`, never bare `vitest`)
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
