import { describe, it, expect } from "vitest";
import {
  buildManualRateMap,
  coerceManualQuotes,
  normalizeManualQuote,
} from "../../src/engine/manual-rates.js";
import { lookupRateInMap } from "../../src/engine/ecb.js";

// All fixtures ANONYMIZED: synthetic coins/dates, no NIF/name/amounts.

describe("normalizeManualQuote", () => {
  it("upper-cases the currency and normalizes YYYYMMDD dates", () => {
    const norm = normalizeManualQuote({ currency: "sol", date: "20250410", eurPerUnit: "40" });
    expect(norm).not.toBeNull();
    expect(norm!.currency).toBe("SOL");
    expect(norm!.date).toBe("2025-04-10");
    expect(norm!.eurPerUnit).toBe("40");
  });

  it("normalizes a stablecoin ticker to its fiat key (USDT → USD)", () => {
    // Lookups resolve USDT→USD, so a manual USDT key must also be stored as USD,
    // otherwise the lookup would never find it.
    const norm = normalizeManualQuote({ currency: "usdt", date: "2025-04-10", eurPerUnit: "0.92" });
    expect(norm!.currency).toBe("USD");
  });

  it("rejects non-positive, non-finite and non-numeric rates", () => {
    expect(normalizeManualQuote({ currency: "SOL", date: "2025-04-10", eurPerUnit: "0" })).toBeNull();
    expect(normalizeManualQuote({ currency: "SOL", date: "2025-04-10", eurPerUnit: "-5" })).toBeNull();
    expect(normalizeManualQuote({ currency: "SOL", date: "2025-04-10", eurPerUnit: "abc" })).toBeNull();
  });

  it("preserves a canonical dot-decimal string (no precision loss)", () => {
    const norm = normalizeManualQuote({ currency: "SOL", date: "2025-04-10", eurPerUnit: "40.1234567890123" });
    expect(norm!.eurPerUnit).toBe("40.1234567890123");
  });

  it("accepts a comma decimal mark (Spanish/EU input) and canonicalizes to a dot", () => {
    const norm = normalizeManualQuote({ currency: "SOL", date: "2025-04-10", eurPerUnit: "142,50" });
    expect(norm).not.toBeNull();
    expect(norm!.eurPerUnit).toBe("142.50");
  });

  it("strips thousands separators (dots + spaces) with a comma decimal mark", () => {
    const norm = normalizeManualQuote({ currency: "SOL", date: "2025-04-10", eurPerUnit: "1.234,56" });
    expect(norm!.eurPerUnit).toBe("1234.56");
    const spaced = normalizeManualQuote({ currency: "SOL", date: "2025-04-10", eurPerUnit: "1 234,56" });
    expect(spaced!.eurPerUnit).toBe("1234.56");
  });
});

describe("buildManualRateMap", () => {
  it("builds a date→currency→rate map and resolves via lookupRateInMap", () => {
    const map = buildManualRateMap([
      { currency: "SOL", date: "20250410", eurPerUnit: "40" },
      { currency: "DOGE", date: "2025-04-11", eurPerUnit: "0.15" },
    ]);
    expect(lookupRateInMap(map, "2025-04-10", "SOL")!.toFixed(0)).toBe("40");
    expect(lookupRateInMap(map, "2025-04-11", "DOGE")!.toFixed(2)).toBe("0.15");
  });

  it("skips invalid entries but keeps valid ones", () => {
    const map = buildManualRateMap([
      { currency: "SOL", date: "2025-04-10", eurPerUnit: "40" },
      { currency: "BAD", date: "2025-04-10", eurPerUnit: "-1" },
    ]);
    expect(lookupRateInMap(map, "2025-04-10", "SOL")).not.toBeNull();
    expect(lookupRateInMap(map, "2025-04-10", "BAD")).toBeNull();
  });

  it("is last-write-wins for the same currency+date", () => {
    const map = buildManualRateMap([
      { currency: "SOL", date: "2025-04-10", eurPerUnit: "40" },
      { currency: "SOL", date: "2025-04-10", eurPerUnit: "42" },
    ]);
    expect(lookupRateInMap(map, "2025-04-10", "SOL")!.toFixed(0)).toBe("42");
  });

  it("returns an empty map for no quotes", () => {
    expect(buildManualRateMap([]).size).toBe(0);
  });
});

describe("coerceManualQuotes", () => {
  it("returns [] for non-array input", () => {
    expect(coerceManualQuotes(null)).toEqual([]);
    expect(coerceManualQuotes({})).toEqual([]);
    expect(coerceManualQuotes("nope")).toEqual([]);
  });

  it("drops entries missing any of the three string fields", () => {
    const quotes = coerceManualQuotes([
      { currency: "SOL", date: "2025-04-10", eurPerUnit: "40" },
      { currency: "SOL", date: "2025-04-10" }, // missing eurPerUnit
      { currency: "SOL", date: 20250410, eurPerUnit: "40" }, // date not a string
      null,
      42,
    ]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toEqual({ currency: "SOL", date: "2025-04-10", eurPerUnit: "40" });
  });

  it("round-trips through buildManualRateMap from raw JSON", () => {
    const parsed: unknown = JSON.parse('[{"currency":"sol","date":"20250410","eurPerUnit":"40"}]');
    const map = buildManualRateMap(coerceManualQuotes(parsed));
    expect(lookupRateInMap(map, "2025-04-10", "SOL")!.toFixed(0)).toBe("40");
  });
});
