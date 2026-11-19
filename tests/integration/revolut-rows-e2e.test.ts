/**
 * Revolut rows the parser could not read (#466, #467, #468). Every case runs a
 * real XLSX through the real parser and generateTaxReport, in the three FX
 * methods, next to a readable control.
 *
 * - A lone thousands comma ("USD 1,500", "1,000") was read as a decimal
 *   point: a sale of 1500 USD became 1.50 USD.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { parseRevolutXlsx } from "../../src/parsers/revolut.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { FxMethod, TaxSummary as TaxReport } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Statement } from "../../src/types/broker.js";

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];
const H = ["Date", "Ticker", "Type", "Quantity", "Price per share", "Total Amount", "Currency", "FX Rate"];
const HC = ["Date acquired", "Date sold", "Symbol", "Quantity", "Cost basis", "Gross proceeds", "Gross PnL", "Fees", "Net PnL", "Currency"];

function rates(): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86_400_000) {
    map.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "1.10"], ["GBP", "0.85"]]));
  }
  return map;
}

function workbook(rows: string[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

const parse = (rows: string[][], header = H): Promise<Statement> => parseRevolutXlsx(workbook([header, ...rows]));

async function report(rows: string[][], method: FxMethod, header = H): Promise<TaxReport> {
  const merged = mergeStatement(createEmptyStatement(), await parse(rows, header), "Revolut");
  return generateTaxReport(finalizeMergedStatement(merged), rates(), 2025, reportOptionsForMethod(method));
}

// Buy 10 AAPL at 100 USD, sell them at 150 USD. At 1.10 the report shows a
// transmission of 1650, an acquisition of 1100 and a gain of 550.
const BUY = ["2025-02-03T10:00:00Z", "AAPL", "BUY - MARKET", "10", "USD 100", "USD 1000", "USD", "1.1"];
const sell = (price = "USD 150", total = "USD 1500", qty = "10") =>
  ["2025-06-03T10:00:00Z", "AAPL", "SELL - MARKET", qty, price, total, "USD", "1.1"];
// The same round trip in the closed-positions format, with a fee of 2.
const closed = (o: Partial<Record<string, string>> = {}): string[] => {
  const d: Record<string, string> = {
    "Date acquired": "2025-02-03", "Date sold": "2025-06-03", Symbol: "AAPL", Quantity: "10", "Cost basis": "1000",
    "Gross proceeds": "1500", "Gross PnL": "500", Fees: "2", "Net PnL": "498", Currency: "USD", ...o,
  };
  return HC.map((h) => d[h]!);
};

describe("Revolut numbers: a comma is a thousands separator, never a decimal point", () => {
  it.each(METHODS)("[%s] a price and amount of \"USD 1,500\" is 1500, as \"USD 1500\" and \"USD 1,500.00\"", async (method) => {
    for (const price of ["USD 1500", "USD 1,500", "USD 1,500.00"]) {
      const r = await report([BUY, sell(price, price, "1")], method);
      expect(r.capitalGains.transmissionValue.toFixed(2), price).toBe("1650.00");
      expect(r.capitalGains.netGainLoss.toFixed(2), price).toBe("1540.00");
    }
  });

  it.each(METHODS)("[%s] a quantity of \"1,000\" is 1000 shares", async (method) => {
    for (const qty of ["1000", "1,000", "1,000.00"]) {
      const rows = [
        ["2025-02-03T10:00:00Z", "PENY", "BUY - MARKET", qty, "USD 1", "USD 1,000", "USD", "1.1"],
        ["2025-06-03T10:00:00Z", "PENY", "SELL - MARKET", "1000", "USD 2", "USD 2,000", "USD", "1.1"],
      ];
      const r = await report(rows, method);
      expect(r.capitalGains.acquisitionValue.toFixed(2), qty).toBe("1100.00");
      expect(r.capitalGains.netGainLoss.toFixed(2), qty).toBe("1100.00");
    }
  });

  it.each(METHODS)("[%s] closed positions: proceeds of \"1,500\" are 1500", async (method) => {
    for (const proceeds of ["1500", "1,500", "1,500.00"]) {
      const r = await report([closed({ "Gross proceeds": proceeds, "Cost basis": "1,000" })], method, HC);
      expect(r.capitalGains.transmissionValue.toFixed(2), proceeds).toBe("1647.80");
      expect(r.capitalGains.netGainLoss.toFixed(2), proceeds).toBe("547.80");
    }
  });

  it("a decimal comma that is no thousands group still reads as a decimal (\"EUR 15,61\")", async () => {
    const s = await parse([["2025-02-03T10:00:00Z", "SAP", "BUY - MARKET", "3", "EUR 15,61", "EUR 46,83", "EUR", "1"]]);
    expect(s.trades[0]!.tradePrice).toBe("15.61");
    expect(s.trades[0]!.cost).toBe("-46.83");
  });
});
