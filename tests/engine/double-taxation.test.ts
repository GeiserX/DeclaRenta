import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { calculateDoubleTaxation } from "../../src/engine/double-taxation.js";
import type { DividendEntry } from "../../src/types/tax.js";

const YEAR = 2025;

function makeEntry(overrides: Partial<DividendEntry>): DividendEntry {
  return {
    isin: "US0000000000",
    symbol: "FOO",
    description: "FOO INC",
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
  it("should cap the credit at the treaty rate, then by Spanish tax", () => {
    const entries = [
      makeEntry({ grossAmountEur: new Decimal(1000), withholdingTaxEur: new Decimal(300) }),
    ];

    const result = calculateDoubleTaxation(entries, YEAR);

    // Treaty cap (15% of 1000) = 150; Spanish tax on 1000 = 190.
    // deduction = min(min(300, 150), 190) = 150
    expect(result.total.toFixed(2)).toBe("150.00");
    // taxPaid still shows the ACTUAL withheld amount for display.
    expect(result.byCountry["US"]!.taxPaid.toFixed(2)).toBe("300.00");
    expect(result.byCountry["US"]!.deductionAllowed.toFixed(2)).toBe("150.00");
  });

  it("should allow full deduction when foreign tax is below treaty cap and Spanish tax", () => {
    const entries = [
      makeEntry({ grossAmountEur: new Decimal(1000), withholdingTaxEur: new Decimal(100) }),
    ];

    const result = calculateDoubleTaxation(entries, YEAR);

    // Treaty cap 150, Spanish tax 190, foreign 100 → min = 100
    expect(result.total.toFixed(2)).toBe("100.00");
  });

  it("should aggregate by country with per-country treaty caps", () => {
    const entries = [
      makeEntry({ withholdingCountry: "US", grossAmountEur: new Decimal(500), withholdingTaxEur: new Decimal(75) }),
      makeEntry({ withholdingCountry: "US", grossAmountEur: new Decimal(500), withholdingTaxEur: new Decimal(75) }),
      makeEntry({ withholdingCountry: "DE", grossAmountEur: new Decimal(200), withholdingTaxEur: new Decimal(52) }),
    ];

    const result = calculateDoubleTaxation(entries, YEAR);

    expect(Object.keys(result.byCountry)).toHaveLength(2);
    // US: gross 1000, tax 150, treaty cap 150, Spanish tax 190 → deduction 150
    expect(result.byCountry["US"]!.deductionAllowed.toFixed(2)).toBe("150.00");
    // DE: gross 200, tax 52, treaty cap 15% × 200 = 30 → deduction 30 (excess reclaimable at source)
    expect(result.byCountry["DE"]!.deductionAllowed.toFixed(2)).toBe("30.00");
    expect(result.total.toFixed(2)).toBe("180.00");
  });

  it("should return empty when no withholdings", () => {
    const entries = [
      makeEntry({ withholdingTaxEur: new Decimal(0) }),
    ];

    const result = calculateDoubleTaxation(entries, YEAR);
    expect(result.total.toFixed(2)).toBe("0.00");
    expect(Object.keys(result.byCountry)).toHaveLength(0);
  });

  it("should handle empty input", () => {
    const result = calculateDoubleTaxation([], YEAR);
    expect(result.total.toFixed(2)).toBe("0.00");
    expect(Object.keys(result.byCountry)).toHaveLength(0);
  });

  it("should exclude domestic ES withholding from the foreign deduction", () => {
    // A Spanish dividend's retención a cuenta is NOT a foreign tax credit
    // (Art. 80 LIRPF). Even with tax withheld, ES must never appear.
    const entries = [
      makeEntry({
        isin: "ES0000000000",
        withholdingCountry: "ES",
        grossAmountEur: new Decimal(1000),
        withholdingTaxEur: new Decimal(190),
      }),
      makeEntry({ withholdingCountry: "US", grossAmountEur: new Decimal(1000), withholdingTaxEur: new Decimal(150) }),
    ];

    const result = calculateDoubleTaxation(entries, YEAR);

    expect(result.byCountry["ES"]).toBeUndefined();
    // US: gross 1000, tax 150 = treaty cap, Spanish 190 → 150
    expect(result.byCountry["US"]!.deductionAllowed.toFixed(2)).toBe("150.00");
    expect(result.total.toFixed(2)).toBe("150.00");
    // The ES retención a cuenta is surfaced as casilla 0597 (spanishWithholding)
    // — the SAME 190 it excludes from the foreign 0588 total above. A domestic
    // pago a cuenta must be reported, just not as a foreign tax credit.
    expect(result.spanishWithholding.toFixed(2)).toBe("190.00");
  });

  it("should report zero Spanish withholding when no ES dividend is present", () => {
    // Purely-foreign holdings have no retención a cuenta española → casilla 0597
    // is 0 (the byCountry["ES"]?.taxPaid ?? 0 fallback). Guards the split so a
    // US-only file never mislabels foreign withholding as a domestic 0597.
    const entries = [
      makeEntry({ withholdingCountry: "US", grossAmountEur: new Decimal(1000), withholdingTaxEur: new Decimal(150) }),
      makeEntry({ withholdingCountry: "DE", grossAmountEur: new Decimal(200), withholdingTaxEur: new Decimal(30) }),
    ];

    const result = calculateDoubleTaxation(entries, YEAR);

    expect(result.spanishWithholding.toFixed(2)).toBe("0.00");
    // The foreign credit is unaffected — it still aggregates US + DE.
    expect(result.byCountry["ES"]).toBeUndefined();
    expect(result.total.toFixed(2)).toBe("180.00");
  });

  it("should use progressive savings brackets but still cap at the treaty rate", () => {
    const entries = [
      makeEntry({
        grossAmountEur: new Decimal(10000),
        withholdingTaxEur: new Decimal(5000),
      }),
    ];

    const result = calculateDoubleTaxation(entries, YEAR);

    // Spanish tax on 10000: 6000×19% + 4000×21% = 1140 + 840 = 1980.
    // Treaty cap: 15% × 10000 = 1500.
    // deduction = min(min(5000, 1500), 1980) = 1500
    expect(result.total.toFixed(2)).toBe("1500.00");
  });

  it("should cap a 30%-withholding US dividend at the 15% treaty rate", () => {
    // Anonymized: a broker withholds 30% on a US dividend (e.g. missing W-8BEN).
    // Spain only credits up to the treaty 15%; the rest is reclaimable in the US.
    const entries = [
      makeEntry({
        withholdingCountry: "US",
        grossAmountEur: new Decimal(1000),
        withholdingTaxEur: new Decimal(300),
      }),
    ];

    const result = calculateDoubleTaxation(entries, YEAR);

    // Treaty cap 15% × 1000 = 150; Spanish tax 190 → deduction 150.
    expect(result.byCountry["US"]!.taxPaid.toFixed(2)).toBe("300.00");
    expect(result.byCountry["US"]!.deductionAllowed.toFixed(2)).toBe("150.00");
    expect(result.total.toFixed(2)).toBe("150.00");
  });

  it("should respect the treaty cap on the top savings bracket too", () => {
    const entries = [
      makeEntry({
        grossAmountEur: new Decimal(400000),
        withholdingTaxEur: new Decimal(200000),
      }),
    ];

    const result = calculateDoubleTaxation(entries, YEAR);

    // Spanish tax on 400000 (Ley 7/2024) = 101880.
    // Treaty cap: 15% × 400000 = 60000.
    // deduction = min(min(200000, 60000), 101880) = 60000
    expect(result.total.toFixed(2)).toBe("60000.00");
  });
});
