// @vitest-environment jsdom
/**
 * Month names, asset types, option scenarios and the FX detail columns follow
 * the active language instead of staying in Spanish.
 */
import { describe, it, expect, afterEach } from "vitest";
import Decimal from "decimal.js";
import { setLocale } from "../../src/i18n/index.js";
import { extractChartData } from "../../src/web/charts.js";
import { renderOperationsAnnex } from "../../src/web/operations-annex.js";
import { renderCasillaCards } from "../../src/web/casilla-detail.js";
import type { TaxSummary, FifoDisposal } from "../../src/types/tax.js";

function disposal(overrides: Partial<FifoDisposal> = {}): FifoDisposal {
  return {
    isin: "US0378331005",
    symbol: "AAPL",
    description: "APPLE INC",
    sellDate: "2025-01-20",
    acquireDate: "2024-03-15",
    quantity: new Decimal(10),
    gainLossFcy: new Decimal(172),
    proceedsFcy: new Decimal(1092),
    costBasisFcy: new Decimal(920),
    proceedsEur: new Decimal(1092),
    costBasisEur: new Decimal(920),
    gainLossEur: new Decimal(172),
    holdingPeriodDays: 311,
    currency: "USD",
    sellEcbRate: new Decimal(0.91),
    acquireEcbRate: new Decimal(0.92),
    assetCategory: "STK",
    washSaleBlocked: false,
    ...overrides,
  };
}

function summary(disposals: FifoDisposal[], fxDisposals: TaxSummary["fxGains"]["disposals"] = []): TaxSummary {
  return {
    year: 2025,
    warnings: [],
    messages: [],
    capitalGains: {
      transmissionValue: new Decimal(1092),
      acquisitionValue: new Decimal(920),
      netGainLoss: new Decimal(172),
      blockedLosses: new Decimal(0),
      reintegratedLosses: new Decimal(0),
      disposals,
    },
    dividends: { grossIncome: new Decimal(0), deductibleExpenses: new Decimal(0), spanishWithholding: new Decimal(0), entries: [] },
    interest: { earned: new Decimal(0), paid: new Decimal(0), entries: [] },
    generalGains: { total: new Decimal(0), entries: [] },
    doubleTaxation: { deduction: new Decimal(0), byCountry: {} },
    fxGains: {
      transmissionValue: new Decimal(800),
      acquisitionValue: new Decimal(750),
      netGainLoss: new Decimal(50),
      disposals: fxDisposals,
    },
  };
}

afterEach(() => {
  setLocale("es");
});

describe("labels follow the active language", () => {
  it("chart months and asset types are English under the English locale", () => {
    setLocale("en");
    const { monthlyGainLoss, assetDistribution } = extractChartData(summary([disposal()]));
    expect(monthlyGainLoss.map((m) => m.month)).toEqual(
      ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    );
    // The January sale lands in the first month, not in a "?" bucket.
    expect(monthlyGainLoss[0]!.gain).toBeCloseTo(172);
    expect(assetDistribution[0]!.label).toBe("Stocks");
  });

  it("control: Spanish keeps the Spanish month and asset labels", () => {
    const { monthlyGainLoss, assetDistribution } = extractChartData(summary([disposal()]));
    expect(monthlyGainLoss[0]!.month).toBe("Ene");
    expect(monthlyGainLoss[11]!.month).toBe("Dic");
    expect(assetDistribution[0]!.label).toBe("Acciones");
  });

  it("the operations annex prints asset group and option scenario in English", () => {
    setLocale("en");
    const html = renderOperationsAnnex(summary([
      disposal({ assetCategory: "OPT", optionScenario: "expiration", putCall: "C", strike: "20" }),
    ]));
    expect(html).toContain("Options");
    expect(html).toContain("Expiration");
    expect(html).not.toContain("Expiración");
    expect(html).not.toContain("Opciones");
  });

  it("the FX detail has translated headers and a readable trigger instead of the raw code", () => {
    setLocale("en");
    const container = document.createElement("div");
    renderCasillaCards(container, summary([], [{
      currency: "USD",
      disposeDate: "2025-06-15",
      acquireDate: "2025-01-10",
      quantity: new Decimal(5000),
      proceedsEur: new Decimal(800),
      costBasisEur: new Decimal(750),
      gainLossEur: new Decimal(50),
      trigger: "conversion",
      holdingPeriodDays: 156,
      lotId: "lot-001",
    }]));
    const html = container.innerHTML;
    expect(html).toContain("lot-001");
    expect(html).not.toContain("Origen");
    expect(html).not.toContain("Lote FIFO");
    expect(html).not.toContain(">conversion<");
    expect(html).toContain(">Currency conversion<");
  });
});
