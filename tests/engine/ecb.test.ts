import { describe, it, expect } from "vitest";
import { getEcbRate, getQ4AverageRate, lookupRateInMap } from "../../src/engine/ecb.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

describe("lookupRateInMap", () => {
  it("returns 1 for EUR without consulting the map", () => {
    const empty: EcbRateMap = new Map();
    expect(lookupRateInMap(empty, "2025-03-15", "EUR")!.toNumber()).toBe(1);
  });

  it("normalizes a stablecoin (USDT) to the underlying USD rate", () => {
    const rates = makeRateMap({ "2025-03-15": { USD: "0.92" } });
    // USDT is not present in the map, but normalizes to USD.
    expect(lookupRateInMap(rates, "2025-03-15", "USDT")!.toFixed(2)).toBe("0.92");
  });

  it("walks backward over a weekend gap to the prior business day", () => {
    // Friday 2025-03-14 has a rate; Sunday 2025-03-16 must fall back to it.
    const rates = makeRateMap({ "2025-03-14": { USD: "0.92" } });
    expect(lookupRateInMap(rates, "2025-03-16", "USD")!.toFixed(2)).toBe("0.92");
  });

  it("returns null for a currency not in the map (no throw)", () => {
    const rates = makeRateMap({ "2025-03-15": { USD: "0.92" } });
    expect(lookupRateInMap(rates, "2025-03-15", "SOL")).toBeNull();
  });

  it("does NOT gate on ECB membership — returns a synthetic in-map crypto rate", () => {
    // A synthetic rate injected by the valuation pre-pass for a non-fiat coin.
    const rates = makeRateMap({ "2025-03-15": { SOL: "0.0123456789" } });
    const rate = lookupRateInMap(rates, "2025-03-15", "SOL");
    expect(rate).not.toBeNull();
    expect(rate!.toFixed(10)).toBe("0.0123456789");
  });
});

describe("getEcbRate non-fiat error", () => {
  it("throws the non-fiat message for an unknown crypto miss", () => {
    const rates = makeRateMap({ "2025-03-15": { USD: "0.92" } });
    expect(() => getEcbRate(rates, "2025-03-15", "SOL")).toThrow(
      "No ECB rate available for non-fiat currency SOL",
    );
  });
});

describe("getEcbRate", () => {
  it("should return 1 for EUR currency", () => {
    const rates: EcbRateMap = new Map();
    expect(getEcbRate(rates, "2025-03-15", "EUR").toNumber()).toBe(1);
  });

  it("should return exact rate for matching date", () => {
    const rates = makeRateMap({ "2025-03-15": { USD: "0.92" } });
    expect(getEcbRate(rates, "2025-03-15", "USD").toFixed(2)).toBe("0.92");
  });

  it("should normalize YYYYMMDD date format", () => {
    const rates = makeRateMap({ "2025-03-15": { USD: "0.92" } });
    expect(getEcbRate(rates, "20250315", "USD").toFixed(2)).toBe("0.92");
  });

  it("should walk backward for weekends/holidays", () => {
    const rates = makeRateMap({ "2025-03-14": { USD: "0.92" } });
    // Saturday — should fall back to Friday
    expect(getEcbRate(rates, "2025-03-15", "USD").toFixed(2)).toBe("0.92");
  });

  it("should walk backward up to 10 days", () => {
    const rates = makeRateMap({ "2025-03-05": { USD: "0.92" } });
    // 9 days later — should still find it (walks back within 10)
    expect(getEcbRate(rates, "2025-03-14", "USD").toFixed(2)).toBe("0.92");
  });

  it("should throw if no rate found within 10 days", () => {
    const rates = makeRateMap({ "2025-03-01": { USD: "0.92" } });
    // 15 days later — exceeds 10-day lookback
    expect(() => getEcbRate(rates, "2025-03-16", "USD")).toThrow("No ECB rate found");
  });

  it("should handle multiple currencies independently", () => {
    const rates: EcbRateMap = new Map();
    rates.set("2025-03-15", new Map([["USD", "0.92"], ["GBP", "1.15"]]));

    expect(getEcbRate(rates, "2025-03-15", "USD").toFixed(2)).toBe("0.92");
    expect(getEcbRate(rates, "2025-03-15", "GBP").toFixed(2)).toBe("1.15");
  });
});

describe("getQ4AverageRate", () => {
  it("should return 1 for EUR currency", () => {
    const rates: EcbRateMap = new Map();
    expect(getQ4AverageRate(rates, 2025, "EUR").toNumber()).toBe(1);
  });

  it("should average all Q4 daily rates (Oct 1 - Dec 31)", () => {
    const rates = makeRateMap({
      "2025-10-01": { USD: "0.90" },
      "2025-10-15": { USD: "0.91" },
      "2025-11-01": { USD: "0.92" },
      "2025-11-15": { USD: "0.93" },
      "2025-12-01": { USD: "0.94" },
      "2025-12-31": { USD: "0.95" },
    });

    const avg = getQ4AverageRate(rates, 2025, "USD");
    // (0.90 + 0.91 + 0.92 + 0.93 + 0.94 + 0.95) / 6 = 5.55 / 6 = 0.925
    expect(avg.toFixed(3)).toBe("0.925");
  });

  it("should exclude dates outside Q4 (before Oct 1 or after Dec 31)", () => {
    const rates = makeRateMap({
      "2025-09-30": { USD: "0.80" },  // before Q4 — excluded
      "2025-10-01": { USD: "0.90" },  // Q4 start
      "2025-12-31": { USD: "0.92" },  // Q4 end
      "2026-01-02": { USD: "0.99" },  // after Q4 — excluded
    });

    const avg = getQ4AverageRate(rates, 2025, "USD");
    // Only 0.90 and 0.92 → average = 0.91
    expect(avg.toFixed(2)).toBe("0.91");
  });

  it("should throw if no Q4 rates found for the currency", () => {
    const rates = makeRateMap({
      "2025-03-15": { USD: "0.92" },  // not in Q4
    });

    expect(() => getQ4AverageRate(rates, 2025, "USD")).toThrow("No ECB Q4 rates found");
  });

  it("should handle single Q4 rate", () => {
    const rates = makeRateMap({
      "2025-11-15": { USD: "0.93" },
    });

    const avg = getQ4AverageRate(rates, 2025, "USD");
    expect(avg.toFixed(2)).toBe("0.93");
  });

  it("should handle multiple currencies in Q4 independently", () => {
    const rates: EcbRateMap = new Map();
    rates.set("2025-10-01", new Map([["USD", "0.90"], ["GBP", "1.10"]]));
    rates.set("2025-12-31", new Map([["USD", "0.92"], ["GBP", "1.14"]]));

    expect(getQ4AverageRate(rates, 2025, "USD").toFixed(2)).toBe("0.91");
    expect(getQ4AverageRate(rates, 2025, "GBP").toFixed(2)).toBe("1.12");
  });
});
