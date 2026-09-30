import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { csvDownloadBlob, formatCsv, toExcelCsv } from "../../src/generators/csv.js";
import type { TaxSummary } from "../../src/types/tax.js";

function makeReport(): TaxSummary {
  return {
    year: 2025,
    warnings: [],
    messages: [],
    capitalGains: {
      transmissionValue: new Decimal("1000"),
      acquisitionValue: new Decimal("800"),
      netGainLoss: new Decimal("200"),
      blockedLosses: new Decimal("0"),
      disposals: [
        {
          isin: "FR0000130809",
          symbol: "GLE",
          description: "Société Générale",
          assetCategory: "STK",
          sellDate: "20250920",
          acquireDate: "20250315",
          quantity: new Decimal("10"),
          proceedsEur: new Decimal("1000.5"),
          costBasisEur: new Decimal("800.25"),
          gainLossEur: new Decimal("200.25"),
          holdingPeriodDays: 189,
          currency: "EUR",
          sellEcbRate: new Decimal("1"),
          acquireEcbRate: new Decimal("1"),
          washSaleBlocked: false,
        },
      ],
    },
    dividends: {
      grossIncome: new Decimal("0"),
      deductibleExpenses: new Decimal("0"),
      spanishWithholding: new Decimal("0"),
      entries: [],
    },
    interest: { earned: new Decimal("0"), paid: new Decimal("0"), entries: [] },
    generalGains: { total: new Decimal("0"), entries: [] },
    doubleTaxation: { deduction: new Decimal("0"), byCountry: {} },
    fxGains: {
      transmissionValue: new Decimal("0"),
      acquisitionValue: new Decimal("0"),
      netGainLoss: new Decimal("0"),
      disposals: [],
    },
  };
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("toExcelCsv", () => {
  it("prepends the UTF-8 BOM and a sep=, line, then the unchanged CSV", () => {
    expect(toExcelCsv("a,b\n1,2\n")).toBe("\uFEFFsep=,\na,b\n1,2\n");
  });
});

describe("csvDownloadBlob (web CSV download)", () => {
  it("starts with the bytes EF BB BF", async () => {
    const bytes = await blobBytes(csvDownloadBlob(makeReport()));
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("puts 'sep=,' on the first line, right after the BOM", async () => {
    const text = new TextDecoder("utf-8", { ignoreBOM: false }).decode(
      await blobBytes(csvDownloadBlob(makeReport())),
    );
    expect(text.split("\n")[0]).toBe("sep=,");
    expect(text.split("\n")[1]).toBe("# GANANCIAS PATRIMONIALES");
  });

  it("keeps comma separators and point decimals, and encodes accents and the dash as UTF-8", async () => {
    const report = makeReport();
    const text = new TextDecoder("utf-8", { ignoreBOM: false }).decode(
      await blobBytes(csvDownloadBlob(report)),
    );
    expect(text).toBe("sep=,\n" + formatCsv(report));
    expect(text).toContain("FR0000130809,GLE,Société Générale,STK,");
    expect(text).toContain(",800.25,1000.50,200.25,");
    expect(text).toContain("—,Intereses pagados al broker");
  });

  it("declares UTF-8 in the MIME type", () => {
    expect(csvDownloadBlob(makeReport()).type).toBe("text/csv;charset=utf-8");
  });
});

describe("formatCsv (CLI output) stays plain", () => {
  it("has no BOM and no sep= line", () => {
    const csv = formatCsv(makeReport());
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv.startsWith("sep=")).toBe(false);
  });
});
