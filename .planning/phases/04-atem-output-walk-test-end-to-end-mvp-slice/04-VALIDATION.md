---
phase: 04
slug: atem-output-walk-test-end-to-end-mvp-slice
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-01
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run src/atem/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/atem/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | ATEM-01 | — | N/A | unit | `npx vitest run src/atem/AtemConnector.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/atem/AtemConnector.test.ts` — stubs for ATEM-01, ATEM-02, ATEM-03
- [ ] Test infrastructure for hydration gate and pendingState flush

*Existing vitest infrastructure covers test execution. Wave 0 adds phase-specific test stubs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `changeProgramInput` produces red SDI tally on physical camera | ATEM-02 | Requires real hardware (ATEM + Blackmagic camera) | Connect ATEM, run walk-test, observe red tally on camera |
| `changePreviewInput` produces green SDI tally | ATEM-03 | Hardware verification required | Walk-test: verify green tally per camera |
| p95 latency < 100 ms | REL-01 | Requires real vMix + ATEM LAN | Run live switching, scan pino logs for latencyMs |
| Walk-test sequential illumination | VERIFY-01 | Live hardware needed | GET /walk-test, observe each camera lights red in sequence |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
