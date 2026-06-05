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
    messages: [],
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
          assetCategory: "STK",
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
    generalGains: { total: new Decimal(0), entries: [] },
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
    expect(headerCols[3]).toBe("Categoria");
    expect(headerCols[11]).toBe("Divisa");
    expect(headerCols[12]).toBe("Tipo_ECB_Compra");
    expect(headerCols[13]).toBe("Tipo_ECB_Venta");
    expect(headerCols[14]).toBe("Bloqueada_Antichurning");
    expect(headerCols[15]).toBe("Opcion_Escenario");

    const dataLine = lines.find((l) => l.startsWith("US0378331005,AAPL"))!;
    const dataCols = dataLine.split(",");
    expect(dataCols[0]).toBe("US0378331005"); // ISIN
    expect(dataCols[1]).toBe("AAPL"); // symbol
    expect(dataCols[7]).toBe("800.00"); // cost
    expect(dataCols[8]).toBe("1000.00"); // proceeds
    expect(dataCols[9]).toBe("200.00"); // gain
    expect(dataCols[10]).toBe("189"); // holding days
    expect(dataCols[11]).toBe("USD"); // currency
    expect(dataCols[12]).toBe("0.920000"); // acquire ECB rate
    expect(dataCols[13]).toBe("0.910000"); // sell ECB rate
    expect(dataCols[14]).toBe("NO"); // not blocked
  });

  it("should include dividend rows", () => {
    const csv = formatCsv(makeReport());

    const lines = csv.split("\n");
    const divLine = lines.find((l) => l.includes("50.00") && l.includes("US"))!;
    expect(divLine).toContain("7.50"); // withholding
    expect(divLine).toContain("USD");
  });

  it("should include a per-issuer dividend section alongside the per-payment one", () => {
    const csv = formatCsv(makeReport());
    expect(csv).toContain("# DIVIDENDOS");           // per-payment, unchanged
    expect(csv).toContain("# DIVIDENDOS POR EMISOR"); // new aggregated section
    expect(csv).toContain("ISIN,Simbolo,Pais,Pagos,Bruto_Anual_EUR,Retencion_Anual_EUR,Divisa");
    // The single AAPL payment aggregates to a 1-payment, 50.00 EUR issuer row.
    const issuerLine = csv.split("\n").find((l) => l.startsWith("US0378331005,AAPL,US,1,"))!;
    expect(issuerLine).toContain("50.00");
    expect(issuerLine).toContain("7.50");
  });

  it("should include casilla summary values", () => {
    const csv = formatCsv(makeReport());

    expect(csv).toContain("0328,Valor de transmision (acciones negociadas),1000.00");
    expect(csv).toContain("0331,Valor de adquisicion (acciones negociadas),800.00");
    expect(csv).toContain("0029,Dividendos brutos,50.00");
    expect(csv).toContain("0588,Deduccion doble imposicion,7.50");
  });

  it("should omit 1633/1637 rows when there are no other-element or FX disposals", () => {
    // STK-only fixture → otros elementos block is empty, so those rows must not appear.
    const csv = formatCsv(makeReport());
    const lines = csv.split("\n");
    expect(lines.some((l) => l.startsWith("1633,"))).toBe(false);
    expect(lines.some((l) => l.startsWith("1637,"))).toBe(false);
  });

  it("should omit 0328/0331 rows when there are no listed-share disposals", () => {
    const report = makeReport();
    report.capitalGains.disposals[0]!.assetCategory = "OPT";
    const csv = formatCsv(report);
    const lines = csv.split("\n");
    expect(lines.some((l) => l.startsWith("0328,"))).toBe(false);
    expect(lines.some((l) => l.startsWith("0331,"))).toBe(false);
    // OPT routes to otros elementos → 1633/1637 present instead.
    expect(lines.some((l) => l.startsWith("1633,"))).toBe(true);
    expect(lines.some((l) => l.startsWith("1637,"))).toBe(true);
  });

  it("should emit 1633/1637 rows when only FX disposals exist (no FIFO other-elements)", () => {
    const report = makeReport({
      capitalGains: {
        transmissionValue: new Decimal(0),
        acquisitionValue: new Decimal(0),
        netGainLoss: new Decimal(0),
        blockedLosses: new Decimal(0),
        disposals: [],
      },
      fxGains: {
        transmissionValue: new Decimal(800),
        acquisitionValue: new Decimal(750),
        netGainLoss: new Decimal(50),
        disposals: [
          {
            currency: "USD",
            disposeDate: "20250615",
            acquireDate: "20250110",
            quantity: new Decimal(5000),
            proceedsEur: new Decimal(800),
            costBasisEur: new Decimal(750),
            gainLossEur: new Decimal(50),
            trigger: "conversion",
            holdingPeriodDays: 156,
            lotId: "lot-001",
          },
        ],
      },
    });
    const csv = formatCsv(report);
    const lines = csv.split("\n");
    expect(lines.some((l) => l.startsWith("1633,Valor de transmision (otros elementos: opciones/cripto/fondos/divisa),800.00"))).toBe(true);
    expect(lines.some((l) => l.startsWith("1637,Valor de adquisicion (otros elementos: opciones/cripto/fondos/divisa),750.00"))).toBe(true);
    // No STK disposals → listed-shares rows absent.
    expect(lines.some((l) => l.startsWith("0328,"))).toBe(false);
  });

  it("should NOT emit the deprecated single-casilla 0327 summary line", () => {
    const csv = formatCsv(makeReport());
    // 0327 is a TEXT field (denominación), never a money box — regression guard
    // against reintroducing the old 0327/0328 transmisión/adquisición mapping.
    const lines = csv.split("\n");
    expect(lines.some((l) => l.startsWith("0327,"))).toBe(false);
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
    const cols = dataLine.split(",");
    expect(cols[14]).toBe("SI");
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
