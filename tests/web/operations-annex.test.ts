/**
 * Tests for the operations annex (Anexo C1) renderer.
 *
 * renderOperationsAnnex() returns an HTML string (no DOM needed), so we render
 * it directly and assert on the markup. The focus is the shared asset-category
 * labels: the annex now consumes the canonical ASSET_LABELS map (src/web/
 * asset-labels.ts) instead of its old local copy, so the labels must match the
 * canonical Spanish values and never the pre-consolidation chart variants.
 */

import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { renderOperationsAnnex } from "../../src/web/operations-annex.js";
import { assetLabel } from "../../src/web/asset-labels.js";
import type { TaxSummary, FifoDisposal } from "../../src/types/tax.js";

function makeDisposal(overrides: Partial<FifoDisposal> = {}): FifoDisposal {
  return {
    isin: "US0378331005",
    symbol: "AAPL",
    description: "APPLE INC",
    sellDate: "2025-09-20",
    acquireDate: "2025-03-15",
    quantity: new Decimal(10),
    gainLossFcy: new Decimal(172),
    proceedsFcy: new Decimal(1092),
    costBasisFcy: new Decimal(920),
    proceedsEur: new Decimal(1092),
    costBasisEur: new Decimal(920),
    gainLossEur: new Decimal(172),
    holdingPeriodDays: 189,
    currency: "USD",
    sellEcbRate: new Decimal(0.91),
    acquireEcbRate: new Decimal(0.92),
    assetCategory: "STK",
    washSaleBlocked: false,
    ...overrides,
  };
}

function makeSummary(disposals: FifoDisposal[]): TaxSummary {
  const transmissionValue = disposals.reduce((s, d) => s.plus(d.proceedsEur), new Decimal(0));
  const acquisitionValue = disposals.reduce((s, d) => s.plus(d.costBasisEur), new Decimal(0));
  return {
    year: 2025,
    messages: [],
    capitalGains: {
      transmissionValue,
      acquisitionValue,
      netGainLoss: transmissionValue.minus(acquisitionValue),
      blockedLosses: new Decimal(0),
      disposals,
    },
    dividends: { grossIncome: new Decimal(0), deductibleExpenses: new Decimal(0), spanishWithholding: new Decimal(0), entries: [] },
    interest: { earned: new Decimal(0), paid: new Decimal(0), entries: [] },
    generalGains: { total: new Decimal(0), entries: [] },
    doubleTaxation: { deduction: new Decimal(0), byCountry: {} },
    fxGains: {
      transmissionValue: new Decimal(0),
      acquisitionValue: new Decimal(0),
      netGainLoss: new Decimal(0),
      disposals: [],
    },
  };
}

describe("renderOperationsAnnex — shared asset labels", () => {
  it("returns empty string when there are no disposals", () => {
    expect(renderOperationsAnnex(makeSummary([]))).toBe("");
  });

  it("labels a crypto group with the canonical 'Criptomonedas' (not 'Crypto')", () => {
    const html = renderOperationsAnnex(makeSummary([
      makeDisposal({ assetCategory: "CRYPTO", isin: "", symbol: "BTC", description: "Bitcoin" }),
    ]));
    expect(html).toContain(assetLabel("CRYPTO"));
    expect(html).toContain("Criptomonedas");
    // The pre-consolidation chart label must no longer appear as a group name.
    expect(html).not.toContain(">Crypto<");
  });

  it("labels an STK group with the canonical 'Acciones'", () => {
    const html = renderOperationsAnnex(makeSummary([makeDisposal({ assetCategory: "STK" })]));
    expect(html).toContain(assetLabel("STK"));
    // The old annex-only label is gone.
    expect(html).not.toContain("Acciones cotizadas");
  });

  it("labels FUND with the canonical 'Fondos / ETFs'", () => {
    const html = renderOperationsAnnex(makeSummary([
      makeDisposal({ assetCategory: "FUND", symbol: "VWCE", description: "Vanguard FTSE All-World" }),
    ]));
    expect(html).toContain(assetLabel("FUND"));
    expect(html).toContain("Fondos / ETFs");
  });

  it("falls back to the raw category code for an unknown category", () => {
    const html = renderOperationsAnnex(makeSummary([
      makeDisposal({ assetCategory: "WIDGET", isin: "", symbol: "X", description: "X" }),
    ]));
    expect(html).toContain("WIDGET");
  });
});

describe("renderOperationsAnnex — anti-churning marker", () => {
  it("highlights a blocked sale and adds an expandable line with amount and repurchase dates", () => {
    const html = renderOperationsAnnex(makeSummary([
      makeDisposal({
        gainLossEur: new Decimal(-400),
        proceedsEur: new Decimal(520),
        costBasisEur: new Decimal(920),
        washSaleBlocked: true,
        blockedLossEur: new Decimal(400),
        washSaleRepurchaseDates: ["2025-10-01"],
      }),
    ]));
    expect(html).toContain('<tr class="wash-sale-blocked">');
    expect(html).toContain('<tr class="wash-sale-detail"><td colspan="9">');
    expect(html).toContain("Pérdida bloqueada por recompra: 400,00 EUR");
    expect(html).toContain("01/10/2025");
  });

  it("adds no marker to a sale without a blocked loss", () => {
    const html = renderOperationsAnnex(makeSummary([makeDisposal()]));
    expect(html).not.toContain("wash-sale-blocked");
    expect(html).not.toContain("wash-sale-detail");
  });
});

describe("renderOperationsAnnex — purchase and sale broker", () => {
  it("adds no broker columns when every sale and lot comes from one broker", () => {
    const html = renderOperationsAnnex(makeSummary([
      makeDisposal({ brokerSource: "Degiro", acquireBrokerSource: "Degiro" }),
      makeDisposal({ brokerSource: "Degiro" }),
    ]));
    expect(html).not.toContain("Broker compra");
    expect(html).not.toContain("Broker venta");
    expect(html).not.toContain(">Degiro<");
    expect(html).toContain('<td colspan="6">');
  });

  it("names the purchase and the sale broker of each row when the sales cross brokers", () => {
    const html = renderOperationsAnnex(makeSummary([
      makeDisposal({ brokerSource: "Degiro", acquireBrokerSource: "Interactive Brokers" }),
      // A sale without lots has no purchase broker.
      makeDisposal({ symbol: "MSFT", brokerSource: "Degiro" }),
    ]));
    expect(html).toContain("<th>Broker compra</th>");
    expect(html).toContain("<th>Broker venta</th>");
    const rows = html.split("<tr").filter((r) => r.includes("<td>1</td>") || r.includes("<td>2</td>"));
    expect(rows[0]).toMatch(/<td>Interactive Brokers<\/td>\s*<td>Degiro<\/td>/);
    expect(rows[1]).toMatch(/<td>—<\/td>\s*<td>Degiro<\/td>/);
    // The subtotal label and the anti-churning line span the two extra columns.
    expect(html).toContain('<td colspan="8">');
  });

  it("widens the anti-churning line to the broker columns", () => {
    const html = renderOperationsAnnex(makeSummary([
      makeDisposal({
        gainLossEur: new Decimal(-400),
        washSaleBlocked: true,
        blockedLossEur: new Decimal(400),
        brokerSource: "Degiro",
        acquireBrokerSource: "Interactive Brokers",
      }),
    ]));
    expect(html).toContain('<tr class="wash-sale-detail"><td colspan="11">');
  });

  it("escapes broker names", () => {
    const html = renderOperationsAnnex(makeSummary([
      makeDisposal({ brokerSource: "A<b>", acquireBrokerSource: "B&C" }),
    ]));
    expect(html).toContain("<td>B&amp;C</td>");
    expect(html).toContain("<td>A&lt;b&gt;</td>");
  });
});
