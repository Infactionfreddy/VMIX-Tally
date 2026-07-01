---
phase: 03
slug: vmix-live-ingest
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-01
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (or package.json scripts) |
| **Quick run command** | `npx vitest run src/vmix/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/vmix/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | VMIX-03 | — | parseTallyString returns [] for empty string | unit | `npx vitest run src/vmix/parseTallyString.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | VMIX-03 | — | parseTallyString maps position i → input i+1 | unit | `npx vitest run src/vmix/parseTallyString.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | VMIX-03 | — | parseRosterXml extracts key+number from XML | unit | `npx vitest run src/vmix/parseRosterXml.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 1 | VMIX-03 | — | buildRuntimeMapping: Key-reorder does not shift tally | unit | `npx vitest run src/vmix/buildRuntimeMapping.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | VMIX-01 | — | VmixConnector connects and emits tally event | unit | `npx vitest run src/vmix/VmixConnector.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | VMIX-02 | — | SUBSCRIBE TALLY re-sent after reconnect | unit | `npx vitest run src/vmix/VmixConnector.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/vmix/parseTallyString.test.ts` — RED stubs for VMIX-03 (parseTallyString)
- [ ] `src/vmix/parseRosterXml.test.ts` — RED stubs for VMIX-03 (parseRosterXml)
- [ ] `src/vmix/buildRuntimeMapping.test.ts` — RED stubs for VMIX-03 (Key-reorder regression)
- [ ] `src/vmix/VmixConnector.test.ts` — RED stubs for VMIX-01, VMIX-02 (connect + subscribe + reconnect)

*Vitest is already installed (see package.json).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real vMix tally push triggers Core update | VMIX-02 | Requires a running vMix instance on TCP 8099 | Start vMix, configure host/port, switch an input live, observe console log showing tally digit change |
| Input delete does not shift camera tally | VMIX-04 | Requires real vMix roster manipulation | Add inputs 1-4, bind them, delete input 2, switch input 3 live — verify camera 3 (not 2) lights up |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
