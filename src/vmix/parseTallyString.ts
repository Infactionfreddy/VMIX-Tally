// Pure tally string parser: vMix TCP TALLY digit string → number[].
// Zero I/O, zero imports. Total function (D-13): never throws on malformed input.
// Covers: VMIX-03 (positional tally indexing contract)

/**
 * Parse a vMix TCP TALLY string into a positional state array.
 *
 * The vMix TCP API returns tally as a sequence of digits, one per input:
 *   '0' = off, '1' = program, '2' = preview.
 * Any other character is coerced to 0 (off) per the defensive total-function
 * stance (D-13).
 *
 * @param tallyString The raw digit string from vMix (e.g. "1020").
 *   An empty string means the roster is empty and returns [] immediately
 *   (Pitfall 4: empty roster emits an empty string, not an error).
 * @returns A number[] where array[i] = state of vMix input (i+1).
 *   That is: array[0] = input 1, array[1] = input 2, etc.
 *   This is the invariant resolver.ts relies on via safeTally[entry.vmixInput - 1].
 *   Returns [] for an empty string — never throws.
 */
export function parseTallyString(tallyString: string): number[] {
  // Guard: empty roster emits "" from vMix TCP (Pitfall 4) — return [] immediately.
  if (tallyString.length === 0) return [];
  return [...tallyString].map((ch) => {
    const n = Number(ch);
    // Coerce any non-0/1/2 character to 0 (off) — defensive total-function (D-13).
    return n === 0 || n === 1 || n === 2 ? n : 0;
  });
}
