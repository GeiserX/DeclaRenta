import { describe, it, expect } from "vitest";
import { getEcbRate, getQ4AverageRate, isEcbResolvable, normalizeCurrency } from "../../src/engine/ecb.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

describe("isEcbResolvable", () => {
  it("should return true for EUR", () => {
    expect(isEcbResolvable("EUR")).toBe(true);
  });

  it("should return true for standard fiat currencies", () => {
    expect(isEcbResolvable("USD")).toBe(true);
    expect(isEcbResolvable("GBP")).toBe(true);
    expect(isEcbResolvable("CHF")).toBe(true);
  });

  it("should return true for stablecoins mapped to USD (ECB currency)", () => {
    expect(isEcbResolvable("USDT")).toBe(true);
    expect(isEcbResolvable("USDC")).toBe(true);
    expect(isEcbResolvable("BUSD")).toBe(true);
    expect(isEcbResolvable("DAI")).toBe(true);
    expect(isEcbResolvable("FDUSD")).toBe(true);
    expect(isEcbResolvable("PYUSD")).toBe(true);
    expect(isEcbResolvable("GUSD")).toBe(true);
    expect(isEcbResolvable("USDP")).toBe(true);
    expect(isEcbResolvable("TUSD")).toBe(true);
  });

  it("should return false for EUR-mapped stablecoins (EUR not in ECB_CURRENCIES set)", () => {
    // EURT/EUROC normalize to EUR, but EUR isn't in ECB_CURRENCIES (it's the base)
    // isEcbResolvable only returns true for EUR if currency === "EUR" exactly
    expect(isEcbResolvable("EURT")).toBe(false);
    expect(isEcbResolvable("EUROC")).toBe(false);
  });

  it("should return false for crypto currencies not in ECB set", () => {
    expect(isEcbResolvable("BTC")).toBe(false);
    expect(isEcbResolvable("ETH")).toBe(false);
    expect(isEcbResolvable("SOL")).toBe(false);
  });
});

describe("normalizeCurrency", () => {
  it("should map stablecoins to fiat", () => {
    expect(normalizeCurrency("USDT")).toBe("USD");
    expect(normalizeCurrency("USDC")).toBe("USD");
    expect(normalizeCurrency("DAI")).toBe("USD");
    expect(normalizeCurrency("EURT")).toBe("EUR");
    expect(normalizeCurrency("EUROC")).toBe("EUR");
    expect(normalizeCurrency("PYUSD")).toBe("USD");
    expect(normalizeCurrency("GUSD")).toBe("USD");
    expect(normalizeCurrency("FDUSD")).toBe("USD");
    expect(normalizeCurrency("USDP")).toBe("USD");
    expect(normalizeCurrency("TUSD")).toBe("USD");
  });

  it("should return the same currency if not a stablecoin", () => {
    expect(normalizeCurrency("USD")).toBe("USD");
    expect(normalizeCurrency("BTC")).toBe("BTC");
    expect(normalizeCurrency("EUR")).toBe("EUR");
  });
});

describe("getEcbRate - crypto fallback", () => {
  it("should return Decimal(0) for non-ECB crypto currency with no rates", () => {
    const rates = makeRateMap({ "2025-03-15": { USD: "0.92" } });
    const result = getEcbRate(rates, "2025-03-15", "BTC");
    expect(result.toNumber()).toBe(0);
  });

  it("should return Decimal(1) for EURT stablecoin (maps to EUR)", () => {
    const rates: EcbRateMap = new Map();
    expect(getEcbRate(rates, "2025-03-15", "EURT").toNumber()).toBe(1);
  });

  it("should return Decimal(1) for EUROC stablecoin (maps to EUR)", () => {
    const rates: EcbRateMap = new Map();
    expect(getEcbRate(rates, "2025-03-15", "EUROC").toNumber()).toBe(1);
  });

  it("should resolve stablecoin USDT to USD rate", () => {
    const rates = makeRateMap({ "2025-03-15": { USD: "0.92" } });
    expect(getEcbRate(rates, "2025-03-15", "USDT").toFixed(2)).toBe("0.92");
  });
});

describe("getQ4AverageRate - crypto fallback", () => {
  it("should return Decimal(0) for non-ECB crypto with no Q4 rates", () => {
    const rates = makeRateMap({ "2025-10-01": { USD: "0.92" } });
    const result = getQ4AverageRate(rates, 2025, "BTC");
    expect(result.toNumber()).toBe(0);
  });

  it("should return Decimal(1) for EUR-mapped stablecoins", () => {
    const rates: EcbRateMap = new Map();
    expect(getQ4AverageRate(rates, 2025, "EURT").toNumber()).toBe(1);
    expect(getQ4AverageRate(rates, 2025, "EUROC").toNumber()).toBe(1);
  });

  it("should resolve stablecoin USDC to USD Q4 average", () => {
    const rates = makeRateMap({
      "2025-10-01": { USD: "0.90" },
      "2025-12-31": { USD: "0.92" },
    });
    const avg = getQ4AverageRate(rates, 2025, "USDC");
    expect(avg.toFixed(2)).toBe("0.91");
  });
});
