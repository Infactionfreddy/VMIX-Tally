// Tests for the vMix HTTP XML roster parser and fetchRoster function.
// Covers: VMIX-01 (roster fetch), VMIX-03 (key→number mapping)
// Includes: A2 attribute order safety check, empty roster, malformed XML.
// Run: npx vitest run src/vmix/parseRosterXml.test.ts

import { describe, it, expect, vi } from "vitest";
import { parseRosterXml, fetchRoster } from "./parseRosterXml.js";

// ---------------------------------------------------------------------------
// Fixtures: XML strings for various roster scenarios
// Top-level const — not inside beforeEach.
// ---------------------------------------------------------------------------

/** Single input with key before number (standard attribute order). */
const singleInputXml = `<vmix><inputs><input key="guid-1" number="1" title="Camera 1"/></inputs></vmix>`;

/** Three inputs with varying numbers. */
const multiInputXml = `<vmix><inputs>
  <input key="guid-1" number="1" title="Camera 1"/>
  <input key="guid-2" number="3" title="Camera 3"/>
  <input key="guid-3" number="5" title="Camera 5"/>
</inputs></vmix>`;

/**
 * Reversed attribute order: number comes before key (Assumption A2 safety check).
 * Some vMix versions may emit attributes in different order.
 */
const numberBeforeKeyXml = `<vmix><inputs><input number="2" key="guid-2" title="Cam2"/></inputs></vmix>`;

/** Empty inputs element — valid XML, zero roster entries. */
const emptyRosterXml = `<vmix><inputs></inputs></vmix>`;

/** Not XML at all — completely malformed. */
const malformedXml = "not xml at all";

/** Empty string (Pitfall 4: vMix emits empty string when roster is empty). */
const emptyString = "";

// ---------------------------------------------------------------------------
// Normal roster
// ---------------------------------------------------------------------------

describe("normal roster — standard XML with key=... number=...", () => {
  it("VMIX-03: singleInputXml returns Map with size 1", () => {
    const result = parseRosterXml(singleInputXml);
    expect(result.size).toBe(1);
  });

  it("VMIX-03: singleInputXml returns Map where get('guid-1') === 1", () => {
    const result = parseRosterXml(singleInputXml);
    expect(result.get("guid-1")).toBe(1);
  });

  it("VMIX-03: multiInputXml returns Map with size 3", () => {
    const result = parseRosterXml(multiInputXml);
    expect(result.size).toBe(3);
  });

  it("VMIX-03: multiInputXml maps all three keys to correct numbers", () => {
    const result = parseRosterXml(multiInputXml);
    expect(result.get("guid-1")).toBe(1);
    expect(result.get("guid-2")).toBe(3);
    expect(result.get("guid-3")).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Attribute order variants (Assumption A2 safety)
// ---------------------------------------------------------------------------

describe("attribute order variants — A2 risk mitigation", () => {
  it("A2: numberBeforeKeyXml (number= before key=) produces correct Map", () => {
    const result = parseRosterXml(numberBeforeKeyXml);
    expect(result.size).toBe(1);
    expect(result.get("guid-2")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Empty roster
// ---------------------------------------------------------------------------

describe("empty roster — no inputs in XML", () => {
  it("VMIX-03: emptyRosterXml returns empty Map (not throw)", () => {
    const result = parseRosterXml(emptyRosterXml);
    expect(result.size).toBe(0);
  });

  it("VMIX-03: empty string returns empty Map (Pitfall 4 — vMix emits '' for empty roster)", () => {
    const result = parseRosterXml(emptyString);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Malformed / empty XML
// ---------------------------------------------------------------------------

describe("malformed/empty XML — defensive degradation", () => {
  it("VMIX-03: malformedXml returns empty Map (not throw)", () => {
    const result = parseRosterXml(malformedXml);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fetchRoster: tests using vi.stubGlobal to mock fetch
// ---------------------------------------------------------------------------

describe("fetchRoster — HTTP fetch + safe degradation", () => {
  it("VMIX-01: fetchRoster returns Map on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => singleInputXml,
    }));

    const result = await fetchRoster("192.168.1.1", 8088);
    expect(result.size).toBe(1);
    expect(result.get("guid-1")).toBe(1);

    vi.unstubAllGlobals();
  });

  it("VMIX-01: fetchRoster returns empty Map on non-ok response (e.g. 404)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    }));

    const result = await fetchRoster("192.168.1.1", 8088);
    expect(result.size).toBe(0);

    vi.unstubAllGlobals();
  });

  it("VMIX-01: fetchRoster returns empty Map when fetch throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await fetchRoster("192.168.1.1", 8088);
    expect(result.size).toBe(0);

    vi.unstubAllGlobals();
  });

  it("VMIX-01: fetchRoster URL uses httpPort (not TCP port 8099) — Pitfall 5", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => emptyRosterXml,
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchRoster("192.168.1.1", 8088);

    // Verify the URL uses port 8088 (the HTTP port), not 8099 (the TCP port)
    expect(mockFetch).toHaveBeenCalledWith(
      "http://192.168.1.1:8088/api",
      expect.objectContaining({ signal: expect.anything() }),
    );

    vi.unstubAllGlobals();
  });
});
