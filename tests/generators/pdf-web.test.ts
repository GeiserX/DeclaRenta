// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { jsPDF } from "jspdf";
import Decimal from "decimal.js";
import { generatePdfWebReport } from "../../src/generators/pdf-web.js";
import type { TaxSummary } from "../../src/types/tax.js";
import { t as realT, setLocale } from "../../src/i18n/index.js";

const t = (key: string) => key;

function makeReport(overrides: Partial<TaxSummary> = {}): TaxSummary {
  return {
    year: 2025,
    messages: [],
    capitalGains: {
      transmissionValue: new Decimal("10000"),
      acquisitionValue: new Decimal("8000"),
      netGainLoss: new Decimal("2000"),
      blockedLosses: new Decimal("0"),
      reintegratedLosses: new Decimal("0"),
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
      spanishWithholding: new Decimal(0),      entries: [
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
        US: { grossIncome: new Decimal("500"), taxPaid: new Decimal("75"), deductionAllowed: new Decimal("75") },
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

async function pdfText(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  return new TextDecoder("latin1").decode(new Uint8Array(buf));
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
        reintegratedLosses: new Decimal(0),
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
        spanishWithholding: new Decimal(0),        entries: [],
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

  function lossesReport(blocked: string, reintegrated: string): TaxSummary {
    return makeReport({
      capitalGains: {
        transmissionValue: new Decimal("10000"),
        acquisitionValue: new Decimal("8000"),
        netGainLoss: new Decimal("2000"),
        blockedLosses: new Decimal(blocked),
        reintegratedLosses: new Decimal(reintegrated),
        disposals: [],
      },
    });
  }

  it("includes blocked losses row when blockedLosses > 0", async () => {
    const text = await pdfText(await generatePdfWebReport(lossesReport("300", "0"), t));
    expect(text).toContain("pdf.blocked_losses");
    expect(text).toContain("300.00 EUR");
    expect(text).not.toContain("pdf.reintegrated_losses");
  });

  it("omits the blocked losses row when blockedLosses is 0", async () => {
    const text = await pdfText(await generatePdfWebReport(lossesReport("0", "0"), t));
    expect(text).not.toContain("pdf.blocked_losses");
    expect(text).not.toContain("pdf.reintegrated_losses");
  });

  it("includes reintegrated losses row when reintegratedLosses > 0", async () => {
    const text = await pdfText(await generatePdfWebReport(lossesReport("0", "240"), t));
    expect(text).toContain("pdf.reintegrated_losses");
    expect(text).toContain("240.00 EUR");
    expect(text).not.toContain("pdf.blocked_losses");
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
          reintegratedLosses: new Decimal(0),
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
        reintegratedLosses: new Decimal(0),
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
        reintegratedLosses: new Decimal(0),
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
        reintegratedLosses: new Decimal(0),
        disposals: [],
      },
      dividends: { grossIncome: new Decimal(0), deductibleExpenses: new Decimal(0), spanishWithholding: new Decimal(0), entries: [] },
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
        reintegratedLosses: new Decimal(0),
        disposals: [],
      },
      dividends: { grossIncome: new Decimal(0), deductibleExpenses: new Decimal(0), spanishWithholding: new Decimal(0), entries: [] },
      doubleTaxation: { deduction: new Decimal(0), byCountry: {} },
      messages: Array.from({ length: 18 }, (_, i) => ({ id: "test.overflow", severity: "info" as const, message: `${i + 1}: ${mediumWarning}` })),
    });
    await expect(generatePdfWebReport(report, t)).resolves.toBeInstanceOf(Blob);
  });

  it("prints messages with symbols the built-in font can encode (no 2-byte strings)", async () => {
    // Helvetica here is WinAnsi only. A string holding ⛔ ⚠ ℹ → or an emoji makes
    // jsPDF write that whole string as 2-byte text, which shows as garbage.
    for (const locale of ["es", "en"] as const) {
      await setLocale(locale);
      const report = makeReport({
        messages: [
          {
            id: "fifo.sell_without_lots",
            severity: "error",
            message: "⚠ Venta sin lotes: XYZ (XX0000000001) × 5 el 2025-03-14.",
            hint: "pista",
            context: { symbol: "XYZ", isin: "XX0000000001", quantity: "5", date: "2025-03-14" },
          },
          { id: "test.unkeyed_warning", severity: "warning", message: "⚠️ Aviso de prueba 💶" },
          { id: "test.unkeyed_info", severity: "info", message: "ℹ Nota de prueba" },
        ],
      });
      const blob = await generatePdfWebReport(report, realT, locale);
      const text = new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer()));
      expect(text, locale).toContain("XYZ");
      expect(text, locale).toContain("Aviso de prueba");
      expect(text, locale).toContain("Nota de prueba");
      expect(text, locale).not.toContain("\u0000");
      expect(text, locale).not.toContain("&\u00d4");
    }
    await setLocale("es");
  });
});

describe("generatePdfWebReport settings line", () => {
  // jsPDF writes uncompressed content streams, so the header text is readable.
  const tp = (key: string, params?: Record<string, string>) =>
    params ? `${key}[${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(";")}]` : key;

  it("prints the settings the figures were computed with", async () => {
    const blob = await generatePdfWebReport(
      makeReport({ settings: { monodivisa: true, trackAutoConvert: false, titulares: 3 } }),
      tp,
    );
    const text = new TextDecoder().decode(await blob.arrayBuffer());
    expect(text).toContain(
      "results.settings_used[monodivisa=results.setting_yes;titulares=3;autoconvert=results.setting_no]",
    );
  });

  it("prints no settings line for a report without settings", async () => {
    const blob = await generatePdfWebReport(makeReport(), tp);
    const text = new TextDecoder().decode(await blob.arrayBuffer());
    expect(text).not.toContain("results.settings_used");
  });
});


describe("generatePdfWebReport broker columns", () => {
  // Short labels: a long key would wrap inside the narrow header cell.
  const tb = (key: string) => (key === "table.buy_broker" ? "BUYB" : key === "table.sell_broker" ? "SELLB" : key);
  const withBrokers = (sale: [string, string | undefined], other: [string, string | undefined]) => {
    const base = makeReport();
    const [a, b] = base.capitalGains.disposals;
    return makeReport({
      capitalGains: {
        ...base.capitalGains,
        disposals: [
          { ...a!, brokerSource: sale[0], acquireBrokerSource: sale[1] },
          { ...b!, brokerSource: other[0], acquireBrokerSource: other[1] },
        ],
      },
    });
  };

  it("prints the purchase and sale broker when the sales cross brokers", async () => {
    const text = await pdfText(await generatePdfWebReport(
      withBrokers(["Degiro", "Interactive Brokers"], ["Degiro", undefined]),
      tb,
    ));
    expect(text).toContain("(BUYB)");
    expect(text).toContain("(SELLB)");
    expect(text).toContain("Degiro");
    expect(text).toContain("Interactive");
    // The dash of the sale without lots stays 1-byte WinAnsi text.
    expect(text).not.toContain("\u0000");
  });

  it("prints no broker columns for a single-broker report", async () => {
    const text = await pdfText(await generatePdfWebReport(withBrokers(["Degiro", "Degiro"], ["Degiro", undefined]), tb));
    expect(text).not.toContain("BUYB");
    expect(text).not.toContain("Degiro");
  });
});

describe("generatePdfWebReport broker columns fit their cells", () => {
  it("keeps a 12-character ISIN and a 12-character symbol on one line in the two-broker layout", async () => {
    const base = makeReport();
    const [a, b] = base.capitalGains.disposals;
    const report = makeReport({
      capitalGains: {
        ...base.capitalGains,
        disposals: [
          { ...a!, isin: "DE000A0WMPJ6", symbol: "Acme World E", brokerSource: "Degiro", acquireBrokerSource: "Interactive Brokers" },
          { ...b!, isin: "GB00BH4HKS39", brokerSource: "Degiro" },
        ],
      },
    });
    // A cell too narrow for its text is split by autotable into two text runs.
    const text = await pdfText(await generatePdfWebReport(report, t));
    expect(text).toContain("(Degiro)"); // the two-broker layout was drawn
    expect(text).toContain("(DE000A0WMPJ6)");
    expect(text).toContain("(GB00BH4HKS39)");
    expect(text).toContain("(Acme World E)");
  });
});

describe("generatePdfWebReport broker columns keep a wide symbol on one line", () => {
  it("cuts a wide upper-case symbol instead of wrapping its last letter to a second line", async () => {
    const base = makeReport();
    const [a, b] = base.capitalGains.disposals;
    const report = makeReport({
      capitalGains: {
        ...base.capitalGains,
        disposals: [
          { ...a!, symbol: "ACME WORLD ETF", brokerSource: "Degiro", acquireBrokerSource: "Interactive Brokers" },
          { ...b!, brokerSource: "Degiro" },
        ],
      },
    });
    const text = await pdfText(await generatePdfWebReport(report, t));
    expect(text).toContain("(Degiro)"); // the two-broker layout was drawn
    // Every text run of the symbol: one run, starting "ACME", never a lone "E".
    const runs = [...text.matchAll(/\((ACME[^)]*|E)\) Tj/g)].map((m) => m[1]);
    expect(runs).toHaveLength(1);
    // Cut to the cell with an ellipsis; the CSV and the screen keep the full name.
    expect(runs[0]).toMatch(/^ACME WO.*\.\.\.$/);
  });
});

describe("generatePdfWebReport broker columns keep the G/P colours", () => {
  it("colours the G/P cell, not another column, in the two-broker layout", async () => {
    const base = makeReport();
    const [a, b] = base.capitalGains.disposals;
    const report = makeReport({
      capitalGains: {
        ...base.capitalGains,
        disposals: [
          { ...a!, brokerSource: "Degiro", acquireBrokerSource: "Interactive Brokers" },
          { ...b!, brokerSource: "Degiro" },
        ],
      },
    });
    const text = await pdfText(await generatePdfWebReport(report, t));
    expect(text).toContain("(Degiro)"); // the two-broker layout was drawn
    // jsPDF sets the fill colour (successRgb 56,161,105 / dangerRgb 229,62,62) right before the cell text.
    const coloured = (rg: string) =>
      [...text.matchAll(new RegExp(`${rg} rg\\n[^\\n]*\\n\\(([^)]*)\\) Tj`, "g"))].map((m) => m[1]);
    expect(coloured("0\\.22 0\\.631 0\\.412")).toContain("+1000.00");
    expect(coloured("0\\.898 0\\.243 0\\.243")).toContain("-500.00");
  });
});

describe("generatePdfWebReport footer", () => {
  it("keeps the disclaimer inside the page margins", async () => {
    await setLocale("es");
    const text = await pdfText(await generatePdfWebReport(makeReport(), realT, "es"));
    // jsPDF writes each line as "<x> <y> Td (<text>) Tj", x in points from the left edge.
    const lines = [...text.matchAll(/(-?[\d.]+) [\d.]+ Td\n\(([^)]*)\) Tj/g)]
      .filter((m) => m[2]!.includes("orientativo"));
    expect(lines.length).toBeGreaterThan(0);
    const marginPt = (14 * 72) / 25.4;
    const pageW = 595.28;
    const measure = new jsPDF({ unit: "pt", format: "a4" });
    measure.setFont("helvetica", "normal");
    measure.setFontSize(6.5);
    for (const m of lines) {
      const x = Number(m[1]);
      const right = x + measure.getTextWidth(m[2]!);
      expect(x).toBeGreaterThanOrEqual(marginPt);
      expect(right).toBeLessThanOrEqual(pageW - marginPt);
      // Centred: as much room on the left as on the right.
      expect(Math.abs(x - (pageW - right))).toBeLessThan(1);
    }
  });
});
