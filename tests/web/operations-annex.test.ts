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
import { ASSET_LABELS } from "../../src/web/asset-labels.js";
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
    blockedLossEur: new Decimal(0),
    ...overrides,
  };
}

function makeSummary(disposals: FifoDisposal[]): TaxSummary {
  const transmissionValue = disposals.reduce((s, d) => s.plus(d.proceedsEur), new Decimal(0));
  const acquisitionValue = disposals.reduce((s, d) => s.plus(d.costBasisEur), new Decimal(0));
  return {
    year: 2025,
    warnings: [],
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
    expect(html).toContain(ASSET_LABELS.CRYPTO);
    expect(html).toContain("Criptomonedas");
    // The pre-consolidation chart label must no longer appear as a group name.
    expect(html).not.toContain(">Crypto<");
  });

  it("labels an STK group with the canonical 'Acciones'", () => {
    const html = renderOperationsAnnex(makeSummary([makeDisposal({ assetCategory: "STK" })]));
    expect(html).toContain(ASSET_LABELS.STK);
    // The old annex-only label is gone.
    expect(html).not.toContain("Acciones cotizadas");
  });

  it("labels FUND with the canonical 'Fondos / ETFs'", () => {
    const html = renderOperationsAnnex(makeSummary([
      makeDisposal({ assetCategory: "FUND", symbol: "VWCE", description: "Vanguard FTSE All-World" }),
    ]));
    expect(html).toContain(ASSET_LABELS.FUND);
    expect(html).toContain("Fondos / ETFs");
  });

  it("falls back to the raw category code for an unknown category", () => {
    const html = renderOperationsAnnex(makeSummary([
      makeDisposal({ assetCategory: "WIDGET", isin: "", symbol: "X", description: "X" }),
    ]));
    expect(html).toContain("WIDGET");
  });
});

describe("renderOperationsAnnex — blocked-loss column (art. 33.5.f)", () => {
  const blockedSale = () =>
    makeDisposal({
      symbol: "TSLA",
      isin: "US88160R1014",
      proceedsEur: new Decimal(600),
      costBasisEur: new Decimal(1000),
      gainLossEur: new Decimal(-400),
      washSaleBlocked: true,
      blockedLossEur: new Decimal(400),
    });

  it("adds no column when no sale has a blocked loss", () => {
    const html = renderOperationsAnnex(makeSummary([makeDisposal()]));
    expect(html).not.toContain("Pérdida bloqueada");
    expect(html).not.toContain("blocked-loss");
  });

  it("shows the column, the amount and the legal hint when a sale is blocked", () => {
    const html = renderOperationsAnnex(makeSummary([makeDisposal(), blockedSale()]));
    expect(html).toContain("Pérdida bloqueada EUR");
    expect(html).toContain("33.5.f");
    expect(html).toContain('<td class="num blocked-loss">400,00</td>');
    // The blocked row is marked, the other one is not.
    expect(html.match(/class="wash-sale-blocked"/g)).toHaveLength(1);
  });

  it("leaves the cell blank for sales without a blocked loss", () => {
    const html = renderOperationsAnnex(makeSummary([makeDisposal(), blockedSale()]));
    // One blank row cell (AAPL); the TSLA row and the subtotal carry 400,00.
    expect(html.match(/<td class="num blocked-loss"><\/td>/g)).toHaveLength(1);
    expect(html.match(/<td class="num blocked-loss">400,00<\/td>/g)).toHaveLength(2);
  });

  it("keeps the column in every group so the tables line up", () => {
    const html = renderOperationsAnnex(makeSummary([
      blockedSale(),
      makeDisposal({ assetCategory: "FUND", symbol: "VWCE" }),
    ]));
    expect(html.match(/Pérdida bloqueada EUR/g)).toHaveLength(2);
  });
});
