import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generatePdfReport } from "../../src/generators/pdf.js";
import type { TaxSummary } from "../../src/types/tax.js";

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
          gainLossEur: new Decimal("1000"),
          holdingPeriodDays: 858,
          currency: "EUR",
          sellEcbRate: new Decimal("1"),
          acquireEcbRate: new Decimal("1"),
          washSaleBlocked: false,
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
    ...overrides,
  };
}

describe("PDF Report Generator", () => {
  it("should generate a valid PDF buffer", async () => {
    const report = makeReport();
    const buffer = await generatePdfReport(report);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(500);
    // PDF files start with %PDF
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("should produce a larger PDF with disposals than without", async () => {
    const withDisposals = await generatePdfReport(makeReport());
    const withoutDisposals = await generatePdfReport(makeReport({
      capitalGains: {
        transmissionValue: new Decimal(0),
        acquisitionValue: new Decimal(0),
        netGainLoss: new Decimal(0),
        blockedLosses: new Decimal(0),
        disposals: [],
      },
    }));
    expect(withDisposals.length).toBeGreaterThan(withoutDisposals.length);
  });

  it("should produce a larger PDF with dividends than without", async () => {
    const withDividends = await generatePdfReport(makeReport());
    const withoutDividends = await generatePdfReport(makeReport({
      dividends: {
        grossIncome: new Decimal(0),
        deductibleExpenses: new Decimal(0),
        entries: [],
      },
      doubleTaxation: {
        deduction: new Decimal(0),
        byCountry: {},
      },
    }));
    expect(withDividends.length).toBeGreaterThan(withoutDividends.length);
  });

  it("should handle report with no disposals", async () => {
    const report = makeReport({
      capitalGains: {
        transmissionValue: new Decimal(0),
        acquisitionValue: new Decimal(0),
        netGainLoss: new Decimal(0),
        blockedLosses: new Decimal(0),
        disposals: [],
      },
    });
    const buffer = await generatePdfReport(report);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);
  });

  it("should handle report with no dividends", async () => {
    const report = makeReport({
      dividends: {
        grossIncome: new Decimal(0),
        deductibleExpenses: new Decimal(0),
        entries: [],
      },
      doubleTaxation: {
        deduction: new Decimal(0),
        byCountry: {},
      },
    });
    const buffer = await generatePdfReport(report);
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it("should produce a larger PDF with warnings than without", async () => {
    const withWarnings = await generatePdfReport(
      makeReport({ warnings: ["Short sale detected for XYZ", "Missing ISIN for ABC"] }),
    );
    const withoutWarnings = await generatePdfReport(makeReport());
    expect(withWarnings.length).toBeGreaterThan(withoutWarnings.length);
  });

  it("should handle report with many disposals (pagination)", async () => {
    const manyDisposals = Array.from({ length: 60 }, (_, i) => ({
      isin: `US${String(i).padStart(10, "0")}`,
      symbol: `SYM${i}`,
      description: `Stock ${i}`,
      sellDate: "20250915",
      acquireDate: "20240301",
      quantity: new Decimal("10"),
      proceedsEur: new Decimal("5000"),
      costBasisEur: new Decimal("4000"),
      gainLossEur: new Decimal(i % 2 === 0 ? "1000" : "-500"),
      holdingPeriodDays: 198,
      currency: "USD",
      sellEcbRate: new Decimal("0.92"),
      acquireEcbRate: new Decimal("0.91"),
      washSaleBlocked: false,
    }));

    const report = makeReport({
      capitalGains: {
        transmissionValue: new Decimal("300000"),
        acquisitionValue: new Decimal("240000"),
        netGainLoss: new Decimal("60000"),
        blockedLosses: new Decimal("0"),
        disposals: manyDisposals,
      },
    });

    const buffer = await generatePdfReport(report);
    expect(buffer).toBeInstanceOf(Buffer);
    // Should be multi-page — significantly larger
    expect(buffer.length).toBeGreaterThan(2000);
  });

  it("should handle double taxation with multiple countries", async () => {
    const report = makeReport({
      doubleTaxation: {
        deduction: new Decimal("150"),
        byCountry: {
          US: { taxPaid: new Decimal("75"), deductionAllowed: new Decimal("75") },
          DE: { taxPaid: new Decimal("100"), deductionAllowed: new Decimal("75") },
        },
      },
    });
    const buffer = await generatePdfReport(report);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("should handle losses (negative gain/loss)", async () => {
    const report = makeReport();
    report.capitalGains.disposals[0]!.gainLossEur = new Decimal("-1000");
    report.capitalGains.netGainLoss = new Decimal("0");
    const buffer = await generatePdfReport(report);
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it("should handle blocked losses", async () => {
    const report = makeReport({
      capitalGains: {
        ...makeReport().capitalGains,
        blockedLosses: new Decimal("500"),
      },
    });
    const buffer = await generatePdfReport(report);
    expect(buffer).toBeInstanceOf(Buffer);
  });
});
