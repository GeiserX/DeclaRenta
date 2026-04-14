import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { escapeCsv, formatCsv } from "../../src/generators/csv.js";
import type { TaxSummary } from "../../src/types/tax.js";

describe("escapeCsv", () => {
  it("should return plain strings unchanged", () => {
    expect(escapeCsv("AAPL")).toBe("AAPL");
  });

  it("should wrap strings with commas in quotes", () => {
    expect(escapeCsv("APPLE INC, Class A")).toBe('"APPLE INC, Class A"');
  });

  it("should escape double quotes by doubling them", () => {
    expect(escapeCsv('She said "hello"')).toBe('"She said ""hello"""');
  });

  it("should wrap strings with newlines in quotes", () => {
    expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
  });
});

function makeReport(overrides?: Partial<TaxSummary>): TaxSummary {
  return {
    year: 2025,
    warnings: [],
    capitalGains: {
      transmissionValue: new Decimal(1000),
      acquisitionValue: new Decimal(800),
      netGainLoss: new Decimal(200),
      blockedLosses: new Decimal(0),
      disposals: [
        {
          isin: "US0378331005",
          symbol: "AAPL",
          description: "APPLE INC",
          sellDate: "20250920",
          acquireDate: "20250315",
          quantity: new Decimal(10),
          proceedsEur: new Decimal(1000),
          costBasisEur: new Decimal(800),
          gainLossEur: new Decimal(200),
          holdingPeriodDays: 189,
          washSaleBlocked: false,
        },
      ],
    },
    dividends: {
      grossIncome: new Decimal(50),
      deductibleExpenses: new Decimal(0),
      entries: [
        {
          isin: "US0378331005",
          symbol: "AAPL",
          description: "APPLE INC",
          payDate: "20250601",
          grossAmountEur: new Decimal(50),
          withholdingTaxEur: new Decimal(7.5),
          withholdingCountry: "US",
          currency: "USD",
          ecbRate: new Decimal("0.92"),
        },
      ],
    },
    interest: {
      earned: new Decimal(10),
      paid: new Decimal(2),
      entries: [],
    },
    doubleTaxation: {
      deduction: new Decimal(7.5),
      byCountry: {},
    },
    ...overrides,
  };
}

describe("formatCsv", () => {
  it("should produce capital gains, dividends, and summary sections", () => {
    const csv = formatCsv(makeReport());

    expect(csv).toContain("# GANANCIAS PATRIMONIALES");
    expect(csv).toContain("# DIVIDENDOS");
    expect(csv).toContain("# RESUMEN CASILLAS");
  });

  it("should include disposal rows with correct fields", () => {
    const csv = formatCsv(makeReport());

    // Header + 1 data row in capital gains
    const lines = csv.split("\n");
    const header = lines.find((l) => l.startsWith("ISIN,Simbolo"))!;
    expect(header).toContain("Bloqueada_Antichurning");

    const dataLine = lines.find((l) => l.startsWith("US0378331005,AAPL"))!;
    expect(dataLine).toContain("1000.00"); // proceeds
    expect(dataLine).toContain("800.00"); // cost
    expect(dataLine).toContain("200.00"); // gain
    expect(dataLine).toContain("189"); // holding days
    expect(dataLine).toContain("NO"); // not blocked
  });

  it("should include dividend rows", () => {
    const csv = formatCsv(makeReport());

    const lines = csv.split("\n");
    const divLine = lines.find((l) => l.includes("50.00") && l.includes("US"))!;
    expect(divLine).toContain("7.50"); // withholding
    expect(divLine).toContain("USD");
  });

  it("should include casilla summary values", () => {
    const csv = formatCsv(makeReport());

    expect(csv).toContain("0327,Valor de transmision,1000.00");
    expect(csv).toContain("0328,Valor de adquisicion,800.00");
    expect(csv).toContain("0029,Dividendos brutos,50.00");
    expect(csv).toContain("0588,Deduccion doble imposicion,7.50");
  });

  it("should escape descriptions with commas", () => {
    const report = makeReport();
    report.capitalGains.disposals[0]!.description = "BERKSHIRE HATHAWAY, CL B";
    const csv = formatCsv(report);

    expect(csv).toContain('"BERKSHIRE HATHAWAY, CL B"');
  });

  it("should show SI for wash-sale blocked disposals", () => {
    const report = makeReport();
    report.capitalGains.disposals[0]!.washSaleBlocked = true;
    const csv = formatCsv(report);

    const lines = csv.split("\n");
    const dataLine = lines.find((l) => l.startsWith("US0378331005"))!;
    expect(dataLine.endsWith("SI")).toBe(true);
  });

  it("should handle empty disposals and dividends", () => {
    const report = makeReport();
    report.capitalGains.disposals = [];
    report.dividends.entries = [];
    const csv = formatCsv(report);

    expect(csv).toContain("# GANANCIAS PATRIMONIALES");
    expect(csv).toContain("# RESUMEN CASILLAS");
    // Should still have headers but no data rows
    const lines = csv.split("\n").filter((l) => l.startsWith("US"));
    expect(lines).toHaveLength(0);
  });
});
