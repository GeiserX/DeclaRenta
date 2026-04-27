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

  it("should prevent spreadsheet formula injection", () => {
    expect(escapeCsv("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsv("+cmd")).toBe("'+cmd");
    expect(escapeCsv("-1+1")).toBe("'-1+1");
    expect(escapeCsv("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsv(" =indirect")).toBe("' =indirect");
  });

  it("should not inject-protect safe strings", () => {
    expect(escapeCsv("APPLE INC")).toBe("APPLE INC");
    expect(escapeCsv("US0378331005")).toBe("US0378331005");
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
          currency: "USD",
          sellEcbRate: new Decimal("0.91"),
          acquireEcbRate: new Decimal("0.92"),
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
    fxGains: {
      transmissionValue: new Decimal(0),
      acquisitionValue: new Decimal(0),
      netGainLoss: new Decimal(0),
      disposals: [],
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

  it("should include disposal rows with correct fields and column order", () => {
    const csv = formatCsv(makeReport());

    const lines = csv.split("\n");
    const header = lines.find((l) => l.startsWith("ISIN,Simbolo"))!;
    const headerCols = header.split(",");
    expect(headerCols[0]).toBe("ISIN");
    expect(headerCols[1]).toBe("Simbolo");
    expect(headerCols[10]).toBe("Divisa");
    expect(headerCols[11]).toBe("Tipo_ECB_Compra");
    expect(headerCols[12]).toBe("Tipo_ECB_Venta");
    expect(headerCols[13]).toBe("Bloqueada_Antichurning");

    const dataLine = lines.find((l) => l.startsWith("US0378331005,AAPL"))!;
    const dataCols = dataLine.split(",");
    expect(dataCols[0]).toBe("US0378331005"); // ISIN
    expect(dataCols[1]).toBe("AAPL"); // symbol
    expect(dataCols[6]).toBe("800.00"); // cost
    expect(dataCols[7]).toBe("1000.00"); // proceeds
    expect(dataCols[8]).toBe("200.00"); // gain
    expect(dataCols[9]).toBe("189"); // holding days
    expect(dataCols[10]).toBe("USD"); // currency
    expect(dataCols[11]).toBe("0.920000"); // acquire ECB rate
    expect(dataCols[12]).toBe("0.910000"); // sell ECB rate
    expect(dataCols[13]).toBe("NO"); // not blocked
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
