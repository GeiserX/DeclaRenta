import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { calculateDoubleTaxation } from "../../src/engine/double-taxation.js";
import type { DividendEntry } from "../../src/types/tax.js";

function makeEntry(overrides: Partial<DividendEntry>): DividendEntry {
  return {
    isin: "US0378331005",
    symbol: "AAPL",
    description: "APPLE INC",
    payDate: "2025-06-01",
    grossAmountEur: new Decimal(100),
    withholdingTaxEur: new Decimal(15),
    withholdingCountry: "US",
    currency: "USD",
    ecbRate: new Decimal(0.92),
    ...overrides,
  };
}

describe("calculateDoubleTaxation", () => {
  it("should calculate deduction capped by Spanish tax", () => {
    const entries = [
      makeEntry({ grossAmountEur: new Decimal(1000), withholdingTaxEur: new Decimal(300) }),
    ];

    const result = calculateDoubleTaxation(entries);

    // Spanish tax on 1000 EUR: 19% of 1000 = 190
    // Foreign tax: 300, Spanish tax: 190 → deduction = min(300, 190) = 190
    expect(result.total.toFixed(2)).toBe("190.00");
    expect(result.byCountry["US"]!.taxPaid.toFixed(2)).toBe("300.00");
    expect(result.byCountry["US"]!.deductionAllowed.toFixed(2)).toBe("190.00");
  });

  it("should allow full deduction when foreign tax is lower", () => {
    const entries = [
      makeEntry({ grossAmountEur: new Decimal(1000), withholdingTaxEur: new Decimal(100) }),
    ];

    const result = calculateDoubleTaxation(entries);

    // Spanish tax on 1000: 190. Foreign: 100. Deduction = min(100, 190) = 100
    expect(result.total.toFixed(2)).toBe("100.00");
  });

  it("should aggregate by country", () => {
    const entries = [
      makeEntry({ withholdingCountry: "US", grossAmountEur: new Decimal(500), withholdingTaxEur: new Decimal(75) }),
      makeEntry({ withholdingCountry: "US", grossAmountEur: new Decimal(500), withholdingTaxEur: new Decimal(75) }),
      makeEntry({ withholdingCountry: "DE", grossAmountEur: new Decimal(200), withholdingTaxEur: new Decimal(52) }),
    ];

    const result = calculateDoubleTaxation(entries);

    expect(Object.keys(result.byCountry)).toHaveLength(2);
    // US: gross 1000, tax 150, Spanish tax 190 → deduction 150
    expect(result.byCountry["US"]!.deductionAllowed.toFixed(2)).toBe("150.00");
    // DE: gross 200, tax 52, Spanish tax 38 → deduction 38
    expect(result.byCountry["DE"]!.deductionAllowed.toFixed(2)).toBe("38.00");
    expect(result.total.toFixed(2)).toBe("188.00");
  });

  it("should return empty when no withholdings", () => {
    const entries = [
      makeEntry({ withholdingTaxEur: new Decimal(0) }),
    ];

    const result = calculateDoubleTaxation(entries);
    expect(result.total.toFixed(2)).toBe("0.00");
    expect(Object.keys(result.byCountry)).toHaveLength(0);
  });

  it("should handle empty input", () => {
    const result = calculateDoubleTaxation([]);
    expect(result.total.toFixed(2)).toBe("0.00");
    expect(Object.keys(result.byCountry)).toHaveLength(0);
  });

  it("should use progressive savings brackets for large amounts", () => {
    const entries = [
      makeEntry({
        grossAmountEur: new Decimal(10000),
        withholdingTaxEur: new Decimal(5000),
      }),
    ];

    const result = calculateDoubleTaxation(entries);

    // Spanish tax on 10000:
    // 6000 × 19% = 1140
    // 4000 × 21% = 840
    // Total = 1980
    // Foreign: 5000, deduction = min(5000, 1980) = 1980
    expect(result.total.toFixed(2)).toBe("1980.00");
  });

  it("should apply 30% top bracket for amounts over 300K (Ley 7/2024)", () => {
    const entries = [
      makeEntry({
        grossAmountEur: new Decimal(400000),
        withholdingTaxEur: new Decimal(200000),
      }),
    ];

    const result = calculateDoubleTaxation(entries);

    // Spanish tax on 400000:
    // 6000 × 19% = 1140
    // 44000 × 21% = 9240
    // 150000 × 23% = 34500
    // 100000 × 27% = 27000
    // 100000 × 30% = 30000
    // Total = 101880
    // Foreign: 200000, deduction = min(200000, 101880) = 101880
    expect(result.total.toFixed(2)).toBe("101880.00");
  });
});
