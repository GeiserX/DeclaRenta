/**
 * Tests for extractChartData() asset-distribution labelling.
 *
 * extractChartData() is a pure function (no DOM), so we call it directly with
 * the minimal structural shape it reads. The focus is that the asset-category
 * labels now come from the canonical shared map (src/web/asset-labels.ts), so
 * the chart legend and the operations annex render the SAME Spanish label for a
 * given category — the consistency fix that replaced two diverging local maps.
 */

import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { extractChartData, renderTaxBracketCard } from "../../src/web/charts.js";
import { assetLabel } from "../../src/web/asset-labels.js";

/** Minimal disposal shape consumed by extractChartData. */
function disposal(assetCategory: string, proceeds: number, currency = "USD") {
  return {
    assetCategory,
    currency,
    sellDate: "2025-06-15",
    gainLossEur: new Decimal(proceeds).times(0.1),
    proceedsEur: new Decimal(proceeds),
  };
}

function makeReport(disposals: ReturnType<typeof disposal>[]) {
  return {
    capitalGains: { disposals },
    dividends: { entries: [] as { withholdingCountry: string; withholdingTaxEur: Decimal }[] },
  };
}

describe("extractChartData — asset distribution labels", () => {
  it("maps each category through the canonical shared map", () => {
    const { assetDistribution } = extractChartData(makeReport([
      disposal("STK", 1000),
      disposal("CRYPTO", 500),
      disposal("FUND", 250),
    ]));

    const labels = assetDistribution.map((d) => d.label);
    expect(labels).toContain(assetLabel("STK"));
    expect(labels).toContain(assetLabel("CRYPTO"));
    expect(labels).toContain(assetLabel("FUND"));
  });

  it("uses the canonical 'Criptomonedas' (not the old chart-local 'Crypto')", () => {
    const { assetDistribution } = extractChartData(makeReport([disposal("CRYPTO", 500)]));
    expect(assetDistribution[0]!.label).toBe("Criptomonedas");
    expect(assetDistribution.map((d) => d.label)).not.toContain("Crypto");
  });

  it("falls back to the raw category code for an unknown category", () => {
    const { assetDistribution } = extractChartData(makeReport([disposal("WIDGET", 100)]));
    expect(assetDistribution[0]!.label).toBe("WIDGET");
  });

  it("produces the same label the operations annex uses (single source of truth)", () => {
    // The chart and the annex both resolve via assetLabel(); a category therefore
    // renders identically in both places. This is the cross-view consistency the
    // shared map guarantees.
    const { assetDistribution } = extractChartData(makeReport([disposal("CRYPTO", 500)]));
    expect(assetDistribution[0]!.label).toBe(assetLabel("CRYPTO"));
  });
});

describe("renderTaxBracketCard — Spanish number format", () => {
  // 60.000 € of savings base in 2025: 6.000 × 19 % + 44.000 × 21 % + 10.000 × 23 % = 12.680 €.
  const html = renderTaxBracketCard("IRPF", 2025, 60000, 0);

  it("groups every band threshold, four-digit ones included", () => {
    expect(html).toContain("0 – 6.000");
    expect(html).toContain("6.000 – 50.000");
    expect(html).not.toContain("6000");
  });

  it("writes the effective rate with a decimal comma", () => {
    expect(html).toContain("21,13%");
  });
});
