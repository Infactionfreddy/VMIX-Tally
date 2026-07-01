---
phase: 06
slug: web-ui-status-then-control
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-01
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run src/server` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/server`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green + `npx vite build` exits 0
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | UI-02 | T-06-01 | Sec-Fetch-Site header check blocks cross-origin PUT requests | unit | `npx vitest run src/server/routes.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | UI-03 | — | N/A | unit | `npx vitest run src/server/broadcast.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/frontend/tsconfig.json` — separate TS config for Svelte/Vite (moduleResolution: bundler)
- [ ] `src/server/routes.test.ts` — stubs for UI-01, UI-02, UI-04, UI-05 REST endpoints
- [ ] `src/server/broadcast.test.ts` — stubs for WS snapshot push (UI-03)
- [ ] `vite.config.ts` — Vite build configuration for Svelte 5 frontend

*TypeScript config split (NodeNext for server, bundler for frontend) is the highest-risk setup step and must be Wave 0.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-time tally dashboard updates in browser | UI-03 | Requires live browser + running server | Open UI, trigger vMix tally change, verify camera card updates red/green |
| DISCONNECTED banner appears on link drop | UI-02 | Requires live hardware | Pull ATEM cable, verify prominent DISCONNECTED banner in browser |
| Override toggle persists across reload | UI-04 | E2E browser interaction | Set override, reload page, verify override still active and orange |
| Svelte 5 production build is valid | — | Vite build output verification | `npx vite build` exits 0; open dist/index.html in browser |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
