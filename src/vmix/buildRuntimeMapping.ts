// Pure Key→positional bridge: PersistedMappingEntry[] + roster Map → MappingEntry[].
// Zero I/O — stateless, dependency-free except for type imports.
// Total function (D-13): never throws; returns empty array when roster has no matches.
// Covers: VMIX-03 (D-03 Key-anchor seam, SC4 Key reorder, D-04 silent drop)

import type { MappingEntry } from "../core/resolver.js";
import type { PersistedMappingEntry } from "../config/schema.js";

/**
 * Build the runtime MappingEntry array by resolving persisted Key-anchored entries
 * against the current live vMix input roster.
 *
 * This is the D-03 seam: the persisted config anchors on `vmixKey` (GUID — stable
 * across vMix reorders), while the resolver's MappingEntry uses positional `vmixInput`
 * (1-based, derived from the live roster). This function bridges them.
 *
 * Key properties:
 * - SC4 Key-reorder: if a vMix operator reorders inputs, the same GUID now maps to a
 *   different Number in the roster. buildRuntimeMapping produces the correct positional
 *   vmixInput from the current roster — the persisted config needs no update.
 * - D-04 silent drop: if a persisted vmixKey is absent from the current roster (input
 *   was deleted in vMix), the entry is silently dropped. No error, no log. The persisted
 *   config is unchanged; the camera simply has no runtime tally until re-added.
 *
 * @param persisted PersistedMappingEntry[] from the lowdb config (already zod-validated).
 *   Each entry has a stable vmixKey (GUID) as the match anchor.
 * @param roster The current live vMix input roster: Map<vmixKey, vmixNumber>.
 *   Produced by parseRosterXml / fetchRoster on connect or roster re-sync.
 * @returns MappingEntry[] for the resolver. May be empty if no persisted keys match
 *   the current roster — never throws (D-13).
 */
export function buildRuntimeMapping(
  persisted: PersistedMappingEntry[],
  roster: Map<string, number>,
): MappingEntry[] {
  const result: MappingEntry[] = [];
  for (const entry of persisted) {
    // D-03: look up current positional number by stable GUID key
    const vmixNumber = roster.get(entry.vmixKey);
    // D-04: key absent from roster → silently drop this entry (no error, no log)
    if (vmixNumber === undefined) continue;
    result.push({
      vmixInput: vmixNumber,      // positional 1-based; matches parseTallyString array[vmixInput-1]
      atemSource: entry.atemSource,
      cameraId: entry.cameraId,
    });
  }
  return result;
}
