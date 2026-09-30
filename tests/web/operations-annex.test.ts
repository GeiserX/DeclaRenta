/**
 * Tests for the operations annex (Anexo C1) renderer.
 *
 * renderOperationsAnnex() returns an HTML string (no DOM needed), so we render
 * it directly and assert on the markup. The focus is the shared asset-category
 * labels: the annex now consumes the canonical ASSET_LABELS map (src/web/
 * asset-labels.ts) instead of its old local copy, so the labels must match the
 * canonical Spanish values and never the pre-consolidation chart variants.
 */

import { describe, it, expect, afterEach } from "vitest";
import Decimal from "decimal.js";
import { renderOperationsAnnex, blockedLossBadge } from "../../src/web/operations-annex.js";
import { setLocale } from "../../src/i18n/index.js";
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
    reintegratedLossEur: new Decimal(0),
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

describe("blocked (anti-churning) loss marker", () => {
  afterEach(() => { setLocale("es"); });

  const blockedSale = (overrides: Partial<FifoDisposal> = {}) => makeDisposal({
    proceedsEur: new Decimal(600),
    costBasisEur: new Decimal(1000),
    gainLossEur: new Decimal(-400),
    washSaleBlocked: true,
    blockedLossEur: new Decimal(400),
    ...overrides,
  });

  it("names the blocked amount and art. 33.5.f for a listed security", () => {
    expect(blockedLossBadge(blockedSale())).toContain("Pérdida bloqueada 400,00 € (art. 33.5.f)");
  });

  it("cites art. 33.5.g for an unlisted asset (crypto, 1-year window)", () => {
    const html = blockedLossBadge(blockedSale({ assetCategory: "CRYPTO", isin: "", symbol: "BTC" }));
    expect(html).toContain("(art. 33.5.g)");
  });

  it("shows only the blocked part of a partially blocked loss", () => {
    expect(blockedLossBadge(blockedSale({ blockedLossEur: new Decimal("123.456") }))).toContain("123,46 €");
  });

  it("renders nothing for a sale without a blocked loss", () => {
    expect(blockedLossBadge(makeDisposal())).toBe("");
    expect(blockedLossBadge(makeDisposal({ gainLossEur: new Decimal(-50) }))).toBe("");
  });

  it("follows the active locale", () => {
    setLocale("en");
    expect(blockedLossBadge(blockedSale())).toContain("Blocked loss 400,00 € (art. 33.5.f)");
  });

  it("marks exactly the blocked row in the annex, with text and amount", () => {
    const html = renderOperationsAnnex(makeSummary([
      makeDisposal({ symbol: "MSFT" }),
      blockedSale({ symbol: "AAPL" }),
    ]));
    expect(html.match(/class="wash-sale-badge"/g)).toHaveLength(1);
    const blockedRow = html.split("<tr").find((r) => r.includes("wash-sale-blocked"))!;
    expect(blockedRow).toContain("AAPL");
    expect(blockedRow).toContain("Pérdida bloqueada 400,00 €");
  });
});
