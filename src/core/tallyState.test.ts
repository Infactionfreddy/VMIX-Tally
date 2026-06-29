// Test suite for TallyStateReconciler (src/core/tallyState.ts).
// Proves: emit-on-diff, no-op-on-unchanged (SC4/CORE-03), per-field change
// reporting, first-class null transitions, single-writer state ownership
// (copies in/out), and the reset re-assert path.

import { describe, it, expect, vi } from "vitest";
import { TallyStateReconciler } from "./tallyState.js";

describe("TallyStateReconciler", () => {
  // ── Initial state ──────────────────────────────────────────────────────────

  it("starts with last-sent = { program: null, preview: null } (D-11 safe default)", () => {
    const reconciler = new TallyStateReconciler();
    expect(reconciler.current()).toEqual({ program: null, preview: null });
  });

  // ── First submit from null/null ────────────────────────────────────────────

  it("first submit from null/null reports changed:true for both fields and emits one change event", () => {
    const reconciler = new TallyStateReconciler();
    const listener = vi.fn();
    reconciler.on("change", listener);

    const report = reconciler.submit({ program: 1, preview: 2 });

    expect(report).toEqual({ changed: true, program: true, preview: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      state: { program: 1, preview: 2 },
      report: { changed: true, program: true, preview: true },
    });
  });

  // ── No-op on unchanged (SC4 / CORE-03) ────────────────────────────────────

  it("emits nothing and reports no change when desired equals last-sent (SC4/CORE-03)", () => {
    const reconciler = new TallyStateReconciler();
    reconciler.submit({ program: 1, preview: 2 }); // establish state

    const listener = vi.fn();
    reconciler.on("change", listener);

    const report = reconciler.submit({ program: 1, preview: 2 }); // identical submit

    expect(report).toEqual({ changed: false, program: false, preview: false });
    expect(listener).not.toHaveBeenCalled();
  });

  // ── Per-field change reporting ─────────────────────────────────────────────

  it("reports only preview:true when only preview changes (per-field report)", () => {
    const reconciler = new TallyStateReconciler();
    reconciler.submit({ program: 1, preview: 2 });

    const listener = vi.fn();
    reconciler.on("change", listener);

    const report = reconciler.submit({ program: 1, preview: 3 });

    expect(report).toEqual({ changed: true, program: false, preview: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reports only program:true when only program changes (per-field report)", () => {
    const reconciler = new TallyStateReconciler();
    reconciler.submit({ program: 1, preview: 2 });

    const listener = vi.fn();
    reconciler.on("change", listener);

    const report = reconciler.submit({ program: 5, preview: 2 });

    expect(report).toEqual({ changed: true, program: true, preview: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // ── Null transitions (first-class, not a bug) ─────────────────────────────

  it("transition to null program reports program:true (null is a real change, not no-op)", () => {
    const reconciler = new TallyStateReconciler();
    reconciler.submit({ program: 1, preview: 2 });

    const listener = vi.fn();
    reconciler.on("change", listener);

    const report = reconciler.submit({ program: null, preview: 2 });

    expect(report).toEqual({ changed: true, program: true, preview: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("transition from null to non-null program reports program:true", () => {
    const reconciler = new TallyStateReconciler();
    // Start with null/null, then set just preview so program stays null
    reconciler.submit({ program: null, preview: 2 });

    const listener = vi.fn();
    reconciler.on("change", listener);

    const report = reconciler.submit({ program: 5, preview: 2 });

    expect(report).toEqual({ changed: true, program: true, preview: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("null→null is a no-op (SC4: null treated as a first-class equal value)", () => {
    const reconciler = new TallyStateReconciler();
    // Starts at null/null by default
    const listener = vi.fn();
    reconciler.on("change", listener);

    const report = reconciler.submit({ program: null, preview: null });

    expect(report).toEqual({ changed: false, program: false, preview: false });
    expect(listener).not.toHaveBeenCalled();
  });

  // ── Ownership: current() returns a copy ───────────────────────────────────

  it("mutating the object returned by current() does not affect subsequent current() calls (copy, not reference)", () => {
    const reconciler = new TallyStateReconciler();
    reconciler.submit({ program: 1, preview: 2 });

    const snapshot = reconciler.current();
    // Mutate the returned snapshot — TypeScript allows it at runtime even though
    // the type itself is immutable in intent; we test the copy guarantee.
    (snapshot as { program: number | null }).program = 99;

    expect(reconciler.current()).toEqual({ program: 1, preview: 2 });
  });

  // ── Ownership: submit() does not capture caller's reference ──────────────

  it("mutating the desired object AFTER submit does not change current() (no reference capture)", () => {
    const reconciler = new TallyStateReconciler();
    const mutableDesired = { program: 3 as number | null, preview: 4 as number | null };
    reconciler.submit(mutableDesired);

    // Mutate after the call
    mutableDesired.program = 99;
    mutableDesired.preview = 99;

    // current() should reflect what was passed at submit time, not the later mutation
    expect(reconciler.current()).toEqual({ program: 3, preview: 4 });
  });

  // ── Emitted event payload carries state + report ─────────────────────────

  it("the emitted 'change' event payload carries new state and per-field report", () => {
    const reconciler = new TallyStateReconciler();
    reconciler.submit({ program: 1, preview: 1 }); // set initial

    const payloads: unknown[] = [];
    reconciler.on("change", (payload) => payloads.push(payload));

    reconciler.submit({ program: 2, preview: 1 }); // only program changes

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({
      state: { program: 2, preview: 1 },
      report: { changed: true, program: true, preview: false },
    });
  });

  // ── reset() re-assert path ────────────────────────────────────────────────

  it("reset() restores held state to null/null without emitting any event", () => {
    const reconciler = new TallyStateReconciler();
    reconciler.submit({ program: 3, preview: 4 }); // set a non-null state

    const listener = vi.fn();
    reconciler.on("change", listener);

    reconciler.reset();

    expect(reconciler.current()).toEqual({ program: null, preview: null });
    expect(listener).not.toHaveBeenCalled();
  });

  it("after reset(), the next submit of a non-null state reports changed:true (re-assert path, CORE-03)", () => {
    const reconciler = new TallyStateReconciler();
    reconciler.submit({ program: 3, preview: 4 });
    reconciler.reset();

    const listener = vi.fn();
    reconciler.on("change", listener);

    const report = reconciler.submit({ program: 3, preview: 4 });

    expect(report).toEqual({ changed: true, program: true, preview: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
