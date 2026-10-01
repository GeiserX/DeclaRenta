import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { csvDownload } from "../../src/web/csv-download.js";
import { formatCsv } from "../../src/generators/csv.js";
import type { TaxSummary } from "../../src/types/tax.js";

function report(): TaxSummary {
  return {
    year: 2025,
    warnings: [],
    messages: [],
    capitalGains: {
      transmissionValue: new Decimal(0),
      acquisitionValue: new Decimal(0),
      netGainLoss: new Decimal(0),
      blockedLosses: new Decimal(0),
      reintegratedLosses: new Decimal(0),
      disposals: [],
    },
    dividends: {
      grossIncome: new Decimal("12.5"),
      deductibleExpenses: new Decimal(0),
      spanishWithholding: new Decimal(0),
      entries: [
        {
          isin: "FR0000120271",
          symbol: "TTE",
          description: "Société Générale",
          payDate: "20250601",
          grossAmountEur: new Decimal("12.5"),
          withholdingTaxEur: new Decimal("3.13"),
          withholdingCountry: "FR",
          currency: "EUR",
          ecbRate: new Decimal(1),
        },
      ],
    },
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

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("csvDownload", () => {
  for (const dialect of ["standard", "excel-es"] as const) {
    it(`${dialect}: starts with the UTF-8 BOM, then the CSV encoded as UTF-8`, async () => {
      const r = report();
      const { blob } = csvDownload(r, dialect);
      const b = await bytes(blob);
      expect(Array.from(b.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
      expect(new TextDecoder("utf-8", { ignoreBOM: false }).decode(b)).toBe(formatCsv(r, dialect));
      expect(blob.type).toBe("text/csv;charset=utf-8");
    });
  }

  it("encodes accents as UTF-8, not Latin-1", async () => {
    const b = await bytes(csvDownload(report(), "excel-es").blob);
    const text = new TextDecoder("utf-8").decode(b);
    expect(text).toContain("Société Générale");
    // "é" is C3 A9 in UTF-8.
    const i = b.findIndex((x, k) => x === 0xc3 && b[k + 1] === 0xa9);
    expect(i).toBeGreaterThan(0);
  });

  it("standard download keeps ',' and '.'; excel-es uses ';' and ','", async () => {
    const std = new TextDecoder().decode(await bytes(csvDownload(report(), "standard").blob));
    const xl = new TextDecoder().decode(await bytes(csvDownload(report(), "excel-es").blob));
    expect(std).toContain("FR0000120271,TTE,Société Générale,20250601,12.50,3.13,FR,EUR");
    expect(xl).toContain("FR0000120271;TTE;Société Générale;20250601;12,50;3,13;FR;EUR");
  });

  it("names the files apart", () => {
    expect(csvDownload(report(), "standard").filename).toBe("declarenta_2025.csv");
    expect(csvDownload(report(), "excel-es").filename).toBe("declarenta_2025_excel.csv");
  });
});
