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
import {
  extractChartData,
  renderDonutChart,
  renderHorizontalBarChart,
  renderMonthlyGainLossChart,
  renderTaxBracketCard,
} from "../../src/web/charts.js";
import { ASSET_LABELS, assetLabel } from "../../src/web/asset-labels.js";

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
    expect(labels).toContain(ASSET_LABELS.STK);
    expect(labels).toContain(ASSET_LABELS.CRYPTO);
    expect(labels).toContain(ASSET_LABELS.FUND);
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

/** The opening <svg ...> tag of a rendered chart. */
function svgTag(html: string): string {
  const m = /<svg\b[^>]*>/.exec(html);
  expect(m, "chart renders an <svg>").not.toBeNull();
  return m![0];
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1]! : null;
}

describe("charts are readable by a screen reader", () => {
  const months = ["Ene", "Feb", "Mar"].map((month) => ({ month, gain: 0, loss: 0 }));
  months[0]!.gain = 1234.5;
  months[2]!.gain = 300;
  months[2]!.loss = -200;

  it("the monthly chart is an image named after its title and amounts", () => {
    const tag = svgTag(renderMonthlyGainLossChart("Ganancia/Pérdida por mes", months));
    expect(attr(tag, "role")).toBe("img");
    const label = attr(tag, "aria-label")!;
    expect(label).toContain("Ganancia/Pérdida por mes");
    expect(label).toContain("Ene: +1.234,50 €");
    expect(label).toContain("Mar: +300,00 € / -200,00 €");
    // A month with no disposals adds nothing to the spoken summary.
    expect(label).not.toContain("Feb");
  });

  it("each monthly bar carries a <title> with its euro amount", () => {
    const html = renderMonthlyGainLossChart("Ganancia/Pérdida por mes", months);
    const titles = [...html.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);
    expect(titles).toEqual(["Ene: +1.234,50 €", "Mar: +300,00 € / -200,00 €"]);
  });

  it("the donut is an image named after its title and shares", () => {
    const tag = svgTag(renderDonutChart("Composición por divisa", [
      { label: "USD", value: new Decimal(750) },
      { label: "EUR", value: new Decimal(250) },
    ]));
    expect(attr(tag, "role")).toBe("img");
    const label = attr(tag, "aria-label")!;
    expect(label).toContain("Composición por divisa");
    expect(label).toContain("USD 75.0%");
    expect(label).toContain("EUR 25.0%");
  });

  it("the horizontal bar chart is an image named after its title and amounts", () => {
    const tag = svgTag(renderHorizontalBarChart("Retenciones por país", [
      { label: "US", value: new Decimal(1500) },
    ]));
    expect(attr(tag, "role")).toBe("img");
    const label = attr(tag, "aria-label")!;
    expect(label).toContain("Retenciones por país");
    expect(label).toContain("US 1.500,00 EUR");
  });

  it("a label with markup characters is escaped inside the aria-label", () => {
    const tag = svgTag(renderDonutChart("A \"quoted\" <title>", [{ label: "X&Y", value: new Decimal(1) }]));
    expect(attr(tag, "aria-label")).toContain("A &quot;quoted&quot; &lt;title&gt;");
    expect(attr(tag, "aria-label")).toContain("X&amp;Y");
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
