// Single-writer diff reconciler for the desired ATEM bus state.
// Owns the last-sent { program, preview } desired state (D-03, CORE-03);
// emits a "change" event ONLY when the freshly submitted desired state
// differs from what was last sent. No-op-on-unchanged is a first-class
// testable behavior (SC4), not an optimization.
//
// This module performs ZERO network/disk/log I/O — it holds in-process state
// and emits in-process events only.

import { EventEmitter } from "node:events";
import type { DesiredAtemBusState } from "./events.js";

/**
 * Per-field change report returned by submit().
 * `changed` is true if either program OR preview changed.
 * `program`/`preview` identify which field(s) changed so Phase 4
 * can issue only the needed changeProgramInput/changePreviewInput call.
 */
export interface ChangeReport {
  changed: boolean;
  program: boolean;
  preview: boolean;
}

/**
 * Payload emitted on the "change" event when a real diff is detected.
 */
export interface ChangeEventPayload {
  state: DesiredAtemBusState;
  report: ChangeReport;
}

/**
 * Single-writer diff reconciler.
 *
 * Holds the last-sent desired ATEM bus state and, on submit(desired):
 * - Returns a ChangeReport with per-field diff information.
 * - Emits a "change" event (with ChangeEventPayload) ONLY when at least
 *   one field changed (SC4 no-op-on-unchanged is a hard, tested guarantee).
 *
 * Ownership invariants (T-03-01, D-03):
 * - current() returns a COPY — callers cannot mutate internal state.
 * - submit() stores a COPY — callers can mutate the submitted object afterwards
 *   without affecting the held last-sent state.
 *
 * Usage pattern for Phase 5 resync:
 *   reconciler.reset()               // clears held state; emits nothing
 *   reconciler.submit(desiredState)  // next submit always reports changed
 */
export class TallyStateReconciler extends EventEmitter {
  private lastSent: DesiredAtemBusState;

  constructor() {
    super();
    // D-11 safe default: nothing is live yet → both buses off.
    this.lastSent = { program: null, preview: null };
  }

  /**
   * Submit a new desired bus state.
   *
   * Compares desired against the held last-sent state field by field.
   * If neither field changed, returns { changed:false, program:false, preview:false }
   * and emits nothing (SC4 no-op-on-unchanged).
   * If at least one field changed, updates the held state (storing a copy),
   * emits "change" with { state, report }, and returns the per-field report.
   *
   * The `desired` argument is never stored by reference — submit a mutable
   * object and mutate it afterwards without corrupting the held state.
   */
  submit(desired: DesiredAtemBusState): ChangeReport {
    const programChanged = this.lastSent.program !== desired.program;
    const previewChanged = this.lastSent.preview !== desired.preview;

    if (!programChanged && !previewChanged) {
      // No-op: identical state — emit nothing (SC4 / T-03-02 command-thrash prevention).
      return { changed: false, program: false, preview: false };
    }

    // Store a fresh copy — never hold the caller's reference (T-03-01 single-writer ownership).
    this.lastSent = { program: desired.program, preview: desired.preview };

    const report: ChangeReport = {
      changed: true,
      program: programChanged,
      preview: previewChanged,
    };

    // Emit the copy already stored in lastSent so the payload is also a safe copy.
    const payload: ChangeEventPayload = {
      state: { ...this.lastSent },
      report,
    };
    this.emit("change", payload);

    return report;
  }

  /**
   * Returns a copy of the currently held last-sent desired bus state.
   * Callers may mutate the returned object without affecting internal state.
   */
  current(): DesiredAtemBusState {
    return { ...this.lastSent };
  }

  /**
   * Reset the held state back to { program:null, preview:null } WITHOUT emitting.
   *
   * Intended for Phase 5 resync: after an ATEM reconnection the connector calls
   * reset() so that the very next submit() will always report `changed:true`,
   * forcing the ATEM to re-receive the current desired state regardless of what
   * was "last sent" before the disconnect.
   */
  reset(): void {
    // Deliberate no-emit — reset is a setup step, not a state transition.
    this.lastSent = { program: null, preview: null };
  }
}
