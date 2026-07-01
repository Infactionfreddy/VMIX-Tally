---
phase: 05
slug: reliability-reconnect-resync
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-01
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run src/vmix/ src/atem/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/vmix/ src/atem/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | VMIX-04 | — | N/A | unit | `npx vitest run src/vmix/VmixConnector.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | ATEM-04 | — | N/A | unit | `npx vitest run src/atem/AtemConnector.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/vmix/VmixConnector.test.ts` — test stubs for raw socket reconnect with backoff (VMIX-04)
- [ ] `src/atem/AtemConnector.test.ts` — test stubs for ATEM reconnect + resync (ATEM-04)

*Tests for backoff sequence use injected random function (not Math.random) per CONTEXT.md specifics.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| vMix cable pull → reconnect → correct tally | VMIX-04 | Requires live vMix + real LAN | Pull vMix LAN cable, observe pino logs for backoff + reconnect, verify tally correct after recovery |
| ATEM cable pull → reconnect → state resync | ATEM-04 | Requires real ATEM | Pull ATEM LAN cable, observe pino reconnect log, verify cameras show correct tally after recovery |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
