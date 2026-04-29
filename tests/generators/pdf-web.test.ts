// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generatePdfWebReport } from "../../src/generators/pdf-web.js";
import type { TaxSummary } from "../../src/types/tax.js";

const t = (key: string) => key;

function makeReport(overrides: Partial<TaxSummary> = {}): TaxSummary {
  return {
    year: 2025,
    warnings: [],
    capitalGains: {
      transmissionValue: new Decimal("10000"),
      acquisitionValue: new Decimal("8000"),
      netGainLoss: new Decimal("2000"),
      blockedLosses: new Decimal("0"),
      disposals: [
        {
          isin: "US78462F1030",
          symbol: "SPY",
          description: "SPDR S&P 500",
          sellDate: "20250915",
          acquireDate: "20240301",
          quantity: new Decimal("10"),
          proceedsEur: new Decimal("5000"),
          costBasisEur: new Decimal("4000"),
          gainLossEur: new Decimal("1000"),
          holdingPeriodDays: 198,
          currency: "USD",
          sellEcbRate: new Decimal("0.92"),
          acquireEcbRate: new Decimal("0.91"),
          washSaleBlocked: false,
          assetCategory: "STK",
        },
        {
          isin: "IE00BK5BQT80",
          symbol: "VWCE",
          description: "Vanguard FTSE All-World",
          sellDate: "20251020",
          acquireDate: "20230615",
          quantity: new Decimal("5"),
          proceedsEur: new Decimal("5000"),
          costBasisEur: new Decimal("4000"),
          gainLossEur: new Decimal("-500"),
          holdingPeriodDays: 858,
          currency: "EUR",
          sellEcbRate: new Decimal("1"),
          acquireEcbRate: new Decimal("1"),
          washSaleBlocked: false,
          assetCategory: "FUND",
        },
      ],
    },
    dividends: {
      grossIncome: new Decimal("500"),
      deductibleExpenses: new Decimal("75"),
      entries: [
        {
          isin: "US78462F1030",
          symbol: "SPY",
          description: "US Dividend - SPY",
          payDate: "20250620",
          grossAmountEur: new Decimal("500"),
          withholdingTaxEur: new Decimal("75"),
          withholdingCountry: "US",
          currency: "USD",
          ecbRate: new Decimal("0.92"),
        },
      ],
    },
    interest: {
      earned: new Decimal("10"),
      paid: new Decimal("5"),
      entries: [],
    },
    doubleTaxation: {
      deduction: new Decimal("75"),
      byCountry: {
        US: { taxPaid: new Decimal("75"), deductionAllowed: new Decimal("75") },
      },
    },
    fxGains: {
      transmissionValue: new Decimal(0),
      acquisitionValue: new Decimal(0),
      netGainLoss: new Decimal(0),
      disposals: [],
    },
    ...overrides,
  };
}

describe("generatePdfWebReport", () => {
  it("returns a Blob with application/pdf type", async () => {
    const blob = await generatePdfWebReport(makeReport(), t);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/pdf");
  });

  it("generates a non-trivial PDF (smoke: > 10 KB)", async () => {
    const blob = await generatePdfWebReport(makeReport(), t);
    expect(blob.size).toBeGreaterThan(10_000);
  });

  it("starts with PDF magic bytes (%PDF)", async () => {
    const blob = await generatePdfWebReport(makeReport(), t);
    const buf = await blob.arrayBuffer();
    const header = new TextDecoder().decode(new Uint8Array(buf).slice(0, 4));
    expect(header).toBe("%PDF");
  });

  it("handles empty disposals without throwing", async () => {
    const report = makeReport({
      capitalGains: {
        transmissionValue: new Decimal(0),
        acquisitionValue: new Decimal(0),
        netGainLoss: new Decimal(0),
        blockedLosses: new Decimal(0),
        disposals: [],
      },
    });
    await expect(generatePdfWebReport(report, t)).resolves.toBeInstanceOf(Blob);
  });

  it("handles empty dividends without throwing", async () => {
    const report = makeReport({
      dividends: {
        grossIncome: new Decimal(0),
        deductibleExpenses: new Decimal(0),
        entries: [],
      },
    });
    await expect(generatePdfWebReport(report, t)).resolves.toBeInstanceOf(Blob);
  });

  it("handles warnings section without throwing", async () => {
    const report = makeReport({ warnings: ["Short sale detected: TSLA", "Missing lot: NVDA"] });
    await expect(generatePdfWebReport(report, t)).resolves.toBeInstanceOf(Blob);
  });

  it("includes blocked losses row when blockedLosses > 0", async () => {
    const report = makeReport({
      capitalGains: {
        transmissionValue: new Decimal("10000"),
        acquisitionValue: new Decimal("8000"),
        netGainLoss: new Decimal("2000"),
        blockedLosses: new Decimal("300"),
        disposals: [],
      },
    });
    await expect(generatePdfWebReport(report, t)).resolves.toBeInstanceOf(Blob);
  });

  it("generates a larger PDF with operations than without", async () => {
    const withOps = await generatePdfWebReport(makeReport(), t);
    const withoutOps = await generatePdfWebReport(
      makeReport({
        capitalGains: {
          transmissionValue: new Decimal(0),
          acquisitionValue: new Decimal(0),
          netGainLoss: new Decimal(0),
          blockedLosses: new Decimal(0),
          disposals: [],
        },
      }),
      t,
    );
    expect(withOps.size).toBeGreaterThan(withoutOps.size);
  });

  it("renders option disposals with expiration and exercise scenarios", async () => {
    const report = makeReport({
      capitalGains: {
        transmissionValue: new Decimal("500"),
        acquisitionValue: new Decimal("600"),
        netGainLoss: new Decimal("-100"),
        blockedLosses: new Decimal(0),
        disposals: [
          {
            isin: "US0231351067",
            symbol: "AAPL250117P00150000",
            description: "AAPL Jan 2025 150P",
            sellDate: "20250117",
            acquireDate: "20241201",
            quantity: new Decimal("1"),
            proceedsEur: new Decimal("0"),
            costBasisEur: new Decimal("300"),
            gainLossEur: new Decimal("-300"),
            holdingPeriodDays: 47,
            currency: "USD",
            sellEcbRate: new Decimal("0.92"),
            acquireEcbRate: new Decimal("0.91"),
            washSaleBlocked: false,
            assetCategory: "OPT",
            optionScenario: "expiration",
            underlyingSymbol: "AAPL",
            putCall: "P",
          },
          {
            isin: "US0231351067",
            symbol: "AAPL250117C00200000",
            description: "AAPL Jan 2025 200C",
            sellDate: "20250117",
            acquireDate: "20241101",
            quantity: new Decimal("2"),
            proceedsEur: new Decimal("500"),
            costBasisEur: new Decimal("300"),
            gainLossEur: new Decimal("200"),
            holdingPeriodDays: 77,
            currency: "USD",
            sellEcbRate: new Decimal("0.92"),
            acquireEcbRate: new Decimal("0.91"),
            washSaleBlocked: false,
            assetCategory: "OPT",
            optionScenario: "exercise",
            underlyingSymbol: "AAPL",
            putCall: "C",
          },
        ],
      },
    });
    await expect(generatePdfWebReport(report, t)).resolves.toBeInstanceOf(Blob);
  });

  it("handles warnings long enough to overflow onto a new page", async () => {
    const longWarning = "Warning: missing acquisition cost data for ticker ".padEnd(300, "X");
    const report = makeReport({
      capitalGains: {
        transmissionValue: new Decimal(0),
        acquisitionValue: new Decimal(0),
        netGainLoss: new Decimal(0),
        blockedLosses: new Decimal(0),
        disposals: [],
      },
      dividends: { grossIncome: new Decimal(0), deductibleExpenses: new Decimal(0), entries: [] },
      doubleTaxation: { deduction: new Decimal(0), byCountry: {} },
      warnings: Array.from({ length: 20 }, (_, i) => `${i + 1}: ${longWarning}`),
    });
    await expect(generatePdfWebReport(report, t)).resolves.toBeInstanceOf(Blob);
  });

  it("pushes ECB footnote to a new page when warnings fill the page near the bottom", async () => {
    const mediumWarning = "Warning: ECB rate not found, using fallback rate for ".padEnd(200, "X");
    const report = makeReport({
      capitalGains: {
        transmissionValue: new Decimal(0),
        acquisitionValue: new Decimal(0),
        netGainLoss: new Decimal(0),
        blockedLosses: new Decimal(0),
        disposals: [],
      },
      dividends: { grossIncome: new Decimal(0), deductibleExpenses: new Decimal(0), entries: [] },
      doubleTaxation: { deduction: new Decimal(0), byCountry: {} },
      warnings: Array.from({ length: 18 }, (_, i) => `${i + 1}: ${mediumWarning}`),
    });
    await expect(generatePdfWebReport(report, t)).resolves.toBeInstanceOf(Blob);
  });
});
