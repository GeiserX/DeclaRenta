import { describe, it, expect, vi, afterEach, type MockInstance } from "vitest";
import Decimal from "decimal.js";
import PDFDocument from "pdfkit";
import { generatePdfReport } from "../../src/generators/pdf.js";
import type { TaxSummary } from "../../src/types/tax.js";

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

  it("should produce a larger PDF with messages than without", async () => {
    const withMessages = await generatePdfReport(
      makeReport({ messages: [
        { id: "fifo.sell_without_lots", severity: "error", message: "Short sale detected for XYZ" },
        { id: "parser.unparsed_section", severity: "info", message: "Missing ISIN for ABC" },
      ] }),
    );
    const withoutMessages = await generatePdfReport(makeReport());
    expect(withMessages.length).toBeGreaterThan(withoutMessages.length);
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

  // ---------------------------------------------------------------------------
  // Casilla routing tests — block guard coverage (PR #184)
  //
  // pdfkit compresses content streams with FlateDecode by default, making the
  // raw buffer unsearchable for text strings. Instead we spy on the PDFDocument
  // prototype's `text` method to capture every string passed to the renderer
  // before compression. This is the minimal observable proxy that doesn't
  // require touching src/.
  // ---------------------------------------------------------------------------

  afterEach(() => { vi.restoreAllMocks(); });

  function captureRenderedText(
    spy: MockInstance<typeof PDFDocument.prototype.text>,
  ): string[] {
    return spy.mock.calls
      .map((args) => String(args[0]))
      .filter(Boolean);
  }

  it("renders casillas 0328 and 0331 (listed shares) but NOT 1633/1637 when disposals are STK only", async () => {
    const spy = vi.spyOn(PDFDocument.prototype, "text");
    const report = makeReport({
      capitalGains: {
        transmissionValue: new Decimal("5000"),
        acquisitionValue: new Decimal("4000"),
        netGainLoss: new Decimal("1000"),
        blockedLosses: new Decimal("0"),
        disposals: [
          {
            isin: "US0378331005",
            symbol: "AAPL",
            description: "APPLE INC",
            sellDate: "20250920",
            acquireDate: "20250315",
            quantity: new Decimal("10"),
            proceedsEur: new Decimal("5000"),
            costBasisEur: new Decimal("4000"),
            gainLossEur: new Decimal("1000"),
            holdingPeriodDays: 189,
            currency: "USD",
            sellEcbRate: new Decimal("0.91"),
            acquireEcbRate: new Decimal("0.92"),
            washSaleBlocked: false,
            assetCategory: "STK",
          },
        ],
      },
      fxGains: { transmissionValue: new Decimal(0), acquisitionValue: new Decimal(0), netGainLoss: new Decimal(0), disposals: [] },
    });
    await generatePdfReport(report);
    const rendered = captureRenderedText(spy);
    expect(rendered).toContain("Casilla 0328");
    expect(rendered).toContain("Casilla 0331");
    expect(rendered.some((s) => s.includes("1633"))).toBe(false);
    expect(rendered.some((s) => s.includes("1637"))).toBe(false);
  });

  it("renders casillas 1633 and 1637 (otros elementos) but NOT 0328/0331 when disposals are FUND/OPT only", async () => {
    const spy = vi.spyOn(PDFDocument.prototype, "text");
    const report = makeReport({
      capitalGains: {
        transmissionValue: new Decimal("800"),
        acquisitionValue: new Decimal("600"),
        netGainLoss: new Decimal("200"),
        blockedLosses: new Decimal("0"),
        disposals: [
          {
            isin: "IE00BK5BQT80",
            symbol: "VWCE",
            description: "Vanguard FTSE All-World",
            sellDate: "20251020",
            acquireDate: "20230615",
            quantity: new Decimal("5"),
            proceedsEur: new Decimal("500"),
            costBasisEur: new Decimal("400"),
            gainLossEur: new Decimal("100"),
            holdingPeriodDays: 858,
            currency: "EUR",
            sellEcbRate: new Decimal("1"),
            acquireEcbRate: new Decimal("1"),
            washSaleBlocked: false,
            assetCategory: "FUND",
          },
          {
            isin: "US0231351067",
            symbol: "AAPL250117P00150000",
            description: "AAPL Jan 2025 150P",
            sellDate: "20250117",
            acquireDate: "20241201",
            quantity: new Decimal("1"),
            proceedsEur: new Decimal("300"),
            costBasisEur: new Decimal("200"),
            gainLossEur: new Decimal("100"),
            holdingPeriodDays: 47,
            currency: "USD",
            sellEcbRate: new Decimal("0.92"),
            acquireEcbRate: new Decimal("0.91"),
            washSaleBlocked: false,
            assetCategory: "OPT",
            optionScenario: "close" as const,
            underlyingSymbol: "AAPL",
            putCall: "P" as const,
          },
        ],
      },
      fxGains: { transmissionValue: new Decimal(0), acquisitionValue: new Decimal(0), netGainLoss: new Decimal(0), disposals: [] },
    });
    await generatePdfReport(report);
    const rendered = captureRenderedText(spy);
    expect(rendered).toContain("Casilla 1633");
    expect(rendered).toContain("Casilla 1637");
    expect(rendered.some((s) => s.includes("0328"))).toBe(false);
    expect(rendered.some((s) => s.includes("0331"))).toBe(false);
  });

  it("renders both blocks (0328/0331 and 1633/1637) and never 0327 for a mixed STK+FUND+OPT+FX report", async () => {
    const spy = vi.spyOn(PDFDocument.prototype, "text");
    const report = makeReport({
      capitalGains: {
        transmissionValue: new Decimal("6300"),
        acquisitionValue: new Decimal("4700"),
        netGainLoss: new Decimal("1600"),
        blockedLosses: new Decimal("0"),
        disposals: [
          // Listed share — routes to 0328/0331
          {
            isin: "US0378331005",
            symbol: "AAPL",
            description: "APPLE INC",
            sellDate: "20250920",
            acquireDate: "20250315",
            quantity: new Decimal("10"),
            proceedsEur: new Decimal("5000"),
            costBasisEur: new Decimal("4000"),
            gainLossEur: new Decimal("1000"),
            holdingPeriodDays: 189,
            currency: "USD",
            sellEcbRate: new Decimal("0.91"),
            acquireEcbRate: new Decimal("0.92"),
            washSaleBlocked: false,
            assetCategory: "STK",
          },
          // Fund — routes to 1633/1637
          {
            isin: "IE00BK5BQT80",
            symbol: "VWCE",
            description: "Vanguard FTSE All-World",
            sellDate: "20251020",
            acquireDate: "20230615",
            quantity: new Decimal("5"),
            proceedsEur: new Decimal("800"),
            costBasisEur: new Decimal("600"),
            gainLossEur: new Decimal("200"),
            holdingPeriodDays: 858,
            currency: "EUR",
            sellEcbRate: new Decimal("1"),
            acquireEcbRate: new Decimal("1"),
            washSaleBlocked: false,
            assetCategory: "FUND",
          },
          // Option — routes to 1633/1637
          {
            isin: "US0231351067",
            symbol: "AAPL250117C00200000",
            description: "AAPL Jan 2025 200C",
            sellDate: "20250117",
            acquireDate: "20241201",
            quantity: new Decimal("2"),
            proceedsEur: new Decimal("500"),
            costBasisEur: new Decimal("100"),
            gainLossEur: new Decimal("400"),
            holdingPeriodDays: 47,
            currency: "USD",
            sellEcbRate: new Decimal("0.92"),
            acquireEcbRate: new Decimal("0.91"),
            washSaleBlocked: false,
            assetCategory: "OPT",
            optionScenario: "close" as const,
            underlyingSymbol: "AAPL",
            putCall: "C" as const,
          },
        ],
      },
      // FX disposal — folds into 1633/1637 via computeCasillaBlocksWithFx
      fxGains: {
        transmissionValue: new Decimal("5000"),
        acquisitionValue: new Decimal("4800"),
        netGainLoss: new Decimal("200"),
        disposals: [
          {
            currency: "USD",
            disposeDate: "20250615",
            acquireDate: "20250110",
            quantity: new Decimal("5000"),
            proceedsEur: new Decimal("5000"),
            costBasisEur: new Decimal("4800"),
            gainLossEur: new Decimal("200"),
            trigger: "conversion" as const,
            holdingPeriodDays: 156,
            lotId: "fx-1",
          },
        ],
      },
    });
    await generatePdfReport(report);
    const rendered = captureRenderedText(spy);
    // Both blocks must be present
    expect(rendered).toContain("Casilla 0328");
    expect(rendered).toContain("Casilla 0331");
    expect(rendered).toContain("Casilla 1633");
    expect(rendered).toContain("Casilla 1637");
    // The legacy casilla 0327 must never appear as a labelled row
    expect(rendered.some((s) => s.includes("0327"))).toBe(false);
  });

  it("renders neither block's casilla codes when there are no disposals (count > 0 guards)", async () => {
    const spy = vi.spyOn(PDFDocument.prototype, "text");
    const report = makeReport({
      capitalGains: { transmissionValue: new Decimal(0), acquisitionValue: new Decimal(0), netGainLoss: new Decimal(0), blockedLosses: new Decimal(0), disposals: [] },
      fxGains: { transmissionValue: new Decimal(0), acquisitionValue: new Decimal(0), netGainLoss: new Decimal(0), disposals: [] },
    });
    await generatePdfReport(report);
    const rendered = captureRenderedText(spy);
    expect(rendered.some((s) => s.includes("0328"))).toBe(false);
    expect(rendered.some((s) => s.includes("0331"))).toBe(false);
    expect(rendered.some((s) => s.includes("1633"))).toBe(false);
    expect(rendered.some((s) => s.includes("1637"))).toBe(false);
    expect(rendered.some((s) => s.includes("0327"))).toBe(false);
  });
});
