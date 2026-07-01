// Pure vMix HTTP XML roster parser + fetchRoster wrapper.
// parseRosterXml: no imports — uses built-in RegExp/String only.
// fetchRoster: uses Node 22 built-in fetch (no import needed).
// Total function (D-13): never throws on malformed input; returns empty Map on any error.
// Covers: VMIX-01 (roster fetch), VMIX-03 (key→number mapping)

/**
 * Parse a vMix HTTP API XML roster response into a Map of vmixKey → vmixNumber.
 *
 * Uses regex extraction rather than a full XML parser — extracts only the
 * `key` and `number` attributes from `<input>` elements. This is safe against
 * XML injection since no code is evaluated (T-03-03).
 *
 * Assumption A2 (RESEARCH.md): attribute order may not be guaranteed by vMix.
 * To handle any attribute order, this implementation uses two independent regex
 * patterns to extract `key` and `number` from each matched `<input>` element.
 *
 * @param xml The raw XML string from `http://<host>:<httpPort>/api`.
 * @returns A Map<string, number> where key = vMix input Key (GUID) and
 *   value = vMix input Number (positional 1-based). Returns an empty Map on
 *   empty/missing input or any parse failure — never throws.
 */
export function parseRosterXml(xml: string): Map<string, number> {
  const result = new Map<string, number>();
  if (!xml) return result;

  // Match entire <input ... /> or <input ...> elements to process each one independently.
  // This two-pass approach handles any attribute order (Assumption A2).
  const elementPattern = /<input\b([^>]*?)(?:\/>|>)/g;
  let elementMatch: RegExpExecArray | null;

  while ((elementMatch = elementPattern.exec(xml)) !== null) {
    const attrs = elementMatch[1] ?? "";

    // Extract key attribute from this element's attribute string
    const keyMatch = /\bkey="([^"]+)"/.exec(attrs);
    // Extract number attribute from this element's attribute string
    const numMatch = /\bnumber="(\d+)"/.exec(attrs);

    if (keyMatch === null || numMatch === null) continue;

    const key = keyMatch[1];
    const numStr = numMatch[1];

    if (!key) continue;
    const num = parseInt(numStr ?? "", 10);
    if (isNaN(num) || num <= 0) continue;

    result.set(key, num);
  }

  return result;
}

/**
 * Fetch the vMix input roster from the vMix HTTP API and parse it into a Map.
 *
 * The vMix HTTP API is at `http://<host>:<httpPort>/api` — NOT port 8099 (Pitfall 5).
 * The TCP port (8099) is for the push subscription; the HTTP port (8088 by default)
 * serves the XML roster.
 *
 * Applies a 5-second AbortSignal timeout to guard against hung HTTP requests (T-03-05).
 *
 * @param host The vMix host IP/hostname.
 * @param httpPort The vMix HTTP API port (typically 8088; consumer applies ?? 8088, D-08).
 * @returns A Map<string, number> on success, or an empty Map on any error
 *   (network failure, timeout, non-OK response, or parse failure) — never throws.
 */
export async function fetchRoster(
  host: string,
  httpPort: number,
): Promise<Map<string, number>> {
  try {
    const url = `http://${host}:${httpPort}/api`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return new Map();
    const text = await res.text();
    return parseRosterXml(text);
  } catch {
    // Network error, timeout, or parse failure → degrade to empty Map (T-03-05, D-13).
    return new Map();
  }
}
