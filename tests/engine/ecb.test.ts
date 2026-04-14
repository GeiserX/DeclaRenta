import { describe, it, expect } from "vitest";
import { getEcbRate } from "../../src/engine/ecb.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

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
