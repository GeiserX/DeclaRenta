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
    messages: [],
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
    generalGains: { total: new Decimal(0), entries: [] },
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

  it("handles messages section without throwing", async () => {
    const report = makeReport({ messages: [
      { id: "fifo.sell_without_lots", severity: "error", message: "Short sale detected: TSLA" },
      { id: "fifo.insufficient_lots", severity: "error", message: "Missing lot: NVDA" },
    ] });
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

  it("renders option disposals with expiration, exercise, and close scenarios", async () => {
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
          {
            isin: "US0231351067",
            symbol: "AAPL250320C00180000",
            description: "AAPL Mar 2025 180C",
            sellDate: "20250320",
            acquireDate: "20250101",
            quantity: new Decimal("3"),
            proceedsEur: new Decimal("600"),
            costBasisEur: new Decimal("400"),
            gainLossEur: new Decimal("200"),
            holdingPeriodDays: 78,
            currency: "USD",
            sellEcbRate: new Decimal("0.91"),
            acquireEcbRate: new Decimal("0.90"),
            washSaleBlocked: false,
            assetCategory: "OPT",
            optionScenario: "close",
            underlyingSymbol: "AAPL",
            putCall: "C",
          },
        ],
      },
    });
    await expect(generatePdfWebReport(report, t)).resolves.toBeInstanceOf(Blob);
  });

  it("includes key casilla numbers in PDF content", async () => {
    const blob = await generatePdfWebReport(makeReport(), t);
    const buf = await blob.arrayBuffer();
    const text = new TextDecoder("latin1").decode(new Uint8Array(buf));
    expect(text).toContain("0328");
    expect(text).toContain("0331");
    expect(text).toContain("0029");
    expect(text).toContain("0027");
    expect(text).toContain("0588");
  });

  it("handles 50+ disposals without throwing (pagination stress)", async () => {
    const disposals = Array.from({ length: 55 }, (_, i) => ({
      isin: `US${String(i).padStart(10, "0")}`,
      symbol: `SYM${i}`,
      description: `Security ${i}`,
      sellDate: "20251201",
      acquireDate: "20240101",
      quantity: new Decimal("10"),
      proceedsEur: new Decimal("1000"),
      costBasisEur: new Decimal("800"),
      gainLossEur: new Decimal("200"),
      holdingPeriodDays: 334,
      currency: "USD",
      sellEcbRate: new Decimal("0.92"),
      acquireEcbRate: new Decimal("0.91"),
      washSaleBlocked: false,
      assetCategory: "STK",
    }));
    const report = makeReport({
      capitalGains: {
        transmissionValue: new Decimal("55000"),
        acquisitionValue: new Decimal("44000"),
        netGainLoss: new Decimal("11000"),
        blockedLosses: new Decimal(0),
        disposals,
      },
    });
    const blob = await generatePdfWebReport(report, t);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(20_000);
  });

  it("handles messages long enough to overflow onto a new page", async () => {
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
      messages: Array.from({ length: 20 }, (_, i) => ({ id: "test.overflow", severity: "warning" as const, message: `${i + 1}: ${longWarning}` })),
    });
    await expect(generatePdfWebReport(report, t)).resolves.toBeInstanceOf(Blob);
  });

  it("pushes ECB footnote to a new page when messages fill the page near the bottom", async () => {
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
      messages: Array.from({ length: 18 }, (_, i) => ({ id: "test.overflow", severity: "info" as const, message: `${i + 1}: ${mediumWarning}` })),
    });
    await expect(generatePdfWebReport(report, t)).resolves.toBeInstanceOf(Blob);
  });
});
