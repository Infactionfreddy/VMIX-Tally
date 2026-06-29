// Typed output contract for the vMix→ATEM tally resolver.
// This file is types ONLY — no runtime logic, no functions, no class instances.
// Every downstream phase (2/3/4/6) imports from here; changing these shapes
// is a breaking change across the whole codebase.

/**
 * The per-camera canonical tally state: exactly one of three string literals.
 * "program" = red (on-air), "preview" = green (on-deck), "off" = no tally.
 * When the same camera would be both program and preview simultaneously (D-12),
 * the resolver collapses to "program" — red is the safety-critical on-air signal.
 */
export type CameraTallyState = "off" | "program" | "preview";

/**
 * Camera identity — a string label decoupled from both vMix input numbers
 * and ATEM input numbers (D-02). The mapping carries the three-way chain
 * (vMix input → ATEM input → camera id); the resolver speaks camera ids
 * for the canonical UI state and ATEM source ids for the bus output.
 */
export type CameraId = string;

/**
 * A single ATEM source id for mixEffect 0.
 * Wire format: u16 (0–65535). Domain cap is 8 cameras but the type is unbounded.
 * null = no source (the "nothing live" case, D-11).
 *
 * Design note: ARCHITECTURE.md uses undefined for absent program/preview, but
 * null is used here because null serializes cleanly to JSON ("null") over the
 * eventual WebSocket (Phase 6), whereas undefined is dropped by JSON.stringify.
 * This is an intentional deviation from the ARCHITECTURE sketch.
 */
export type AtemSource = number | null;

/**
 * The desired ATEM bus state for mixEffect 0 (the single ME this bridge controls).
 * Both fields are a single ATEM source id or null (D-01, D-11).
 * Maps directly to atem-connection's ProgramInputUpdateCommand / PreviewInputUpdateCommand
 * where cmd.mixEffect === 0 and cmd.properties.source is the source id.
 */
export interface DesiredAtemBusState {
  program: AtemSource;
  preview: AtemSource;
}

/**
 * The canonical per-camera tally map (D-01, D-02).
 * Keyed by CameraId (string label); value is exactly one of off|program|preview.
 * This is intentionally NARROWER than ATEM's two-boolean bitfield — program wins
 * on collision (D-12), and the contended sidecar carries what that collapse discards.
 */
export type CameraTallyMap = Record<CameraId, CameraTallyState>;

/**
 * Why a live input is absent from the clean tally map (D-06, D-10).
 * "lost-bus": a program-flagged input that lost lowest-ATEM-# arbitration (D-04).
 * "unmapped": a live vMix input with no camera mapping (D-10).
 */
export type ContendedReason = "lost-bus" | "unmapped";

/**
 * A single entry in the contended/dropped sidecar (D-06, D-10).
 * Carries enough context for Phase 6 to produce meaningful UI warnings:
 * "overlaid source X gets no tally" or "input Y has no camera mapping".
 */
export interface ContendedInput {
  /** The vMix input number that went live but did not win the tally bus. */
  vmixInputNumber: number;
  /** Why this input is absent from the clean per-camera tally map. */
  reason: ContendedReason;
  /**
   * The ATEM source this vMix input mapped to, if a mapping existed.
   * null when reason is "unmapped" (no mapping → no ATEM source known).
   */
  atemSource: AtemSource;
}

/**
 * The single object the resolver returns (D-01).
 * Three distinct, separately-typed fields:
 * - cameras: the per-camera off|program|preview map for the UI dashboard.
 * - bus: the desired ATEM program/preview bus state for the ATEM connector.
 * - contended: the dropped/contended-inputs sidecar for UI warnings (D-06).
 */
export interface ResolverOutput {
  cameras: CameraTallyMap;
  bus: DesiredAtemBusState;
  contended: ContendedInput[];
}
