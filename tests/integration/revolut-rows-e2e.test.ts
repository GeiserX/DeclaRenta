/**
 * Revolut rows the parser could not read (#466, #467, #468). Every case runs a
 * real XLSX through the real parser and generateTaxReport, in the three FX
 * methods, next to a readable control.
 *
 * - A lone thousands comma ("USD 1,500", "1,000") was read as a decimal
 *   point: a sale of 1500 USD became 1.50 USD.
 * - A dividend whose Total Amount cannot be read was dropped with no word,
 *   with or without a ticker.
 * - A row of unknown type (a cash merger) with a zero quantity and a Total
 *   Amount that cannot be read was dropped with no word.
 * - A buy or sale whose Price per share cannot be read, or is zero, was
 *   booked at price 0: a sale became a full loss with no word.
 * - A closed position whose Gross proceeds cannot be read was booked as a
 *   sale at 0, and one with no symbol and no readable date was dropped.
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

const msg = (s: Statement, id: string): string | undefined =>
  s.parserMessages?.find((m) => m.id === id)?.context?.rows;

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

describe("Revolut dividends whose Total Amount cannot be read are named, never dropped with no word", () => {
  const dividend = (total: string, ticker = "AAPL") =>
    ["2025-05-15T10:00:00Z", ticker, "DIVIDEND", "", "", total, "USD", "1.1"];

  it.each(METHODS)("[%s] control: a readable dividend of USD 110 is 121 €", async (method) => {
    const r = await report([dividend("USD 110")], method);
    expect(r.dividends.grossIncome.toFixed(2)).toBe("121.00");
  });

  it.each(METHODS)("[%s] an unreadable, empty or currency-only Total Amount is named and not booked", async (method) => {
    for (const total of ["USD abc", "", "USD"]) {
      const s = await parse([dividend(total)]);
      expect(s.cashTransactions, total).toEqual([]);
      expect(msg(s, "parser.cash_income_amount_unreadable"), total)
        .toBe(`DIVIDEND AAPL USD 20250515 [Total Amount: ${JSON.stringify(total)}]`);
      expect(s.parserMessages?.some((m) => m.id === "revolut.dividends_net"), total).toBe(false);
      const r = await report([dividend(total)], method);
      expect(r.dividends.grossIncome.toFixed(2), total).toBe("0.00");
    }
  });

  it.each(METHODS)("[%s] with no ticker, an unreadable Total Amount is named too; a readable one stays unidentified", async (method) => {
    for (const total of ["USD abc", "", "USD"]) {
      const s = await parse([dividend(total, "")]);
      expect(msg(s, "parser.cash_income_amount_unreadable"), total)
        .toBe(`DIVIDEND USD 20250515 [Ticker: "", Total Amount: ${JSON.stringify(total)}]`);
      expect(msg(s, "parser.cash_row_unidentified"), total).toBeUndefined();
      const r = await report([dividend(total, "")], method);
      expect(r.dividends.grossIncome.toFixed(2), total).toBe("0.00");
    }
    expect(msg(await parse([dividend("USD 110", "")]), "parser.cash_row_unidentified")).toBe("DIVIDEND USD 110 20250515");
  });

  it("a written zero stays the file's word: skipped with no message, with or without a ticker", async () => {
    for (const ticker of ["AAPL", ""]) {
      const s = await parse([dividend("USD 0", ticker)]);
      expect(s.cashTransactions).toEqual([]);
      expect(s.parserMessages).toBeUndefined();
    }
  });
});

describe("Revolut rows of unknown type with a zero quantity: an amount that cannot be read is no zero", () => {
  const merger = (total: string, type = "MERGER - CASH") => ["2025-06-03T10:00:00Z", "AAPL", type, "0", "", total, "USD", "1.1"];

  it.each(METHODS)("[%s] control: a readable amount keeps the row, named, and the holding is of unknown size", async (method) => {
    const s = await parse([BUY, merger("USD 1500")]);
    expect(msg(s, "parser.trade_row_unreadable")).toBe('AAPL 20250603 [Type: "MERGER - CASH"]');
    expect(s.openPositions.map((p) => [p.symbol, p.quantityUnknown])).toEqual([["AAPL", true]]);
    const r = await report([BUY, merger("USD 1500")], method);
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("0.00");
  });

  it.each(METHODS)("[%s] an unreadable or currency-only amount keeps the row the same way", async (method) => {
    for (const total of ["USD abc", "USD"]) {
      const s = await parse([BUY, merger(total)]);
      expect(msg(s, "parser.trade_row_unreadable"), total).toBe('AAPL 20250603 [Type: "MERGER - CASH"]');
      expect(s.openPositions.map((p) => [p.symbol, p.quantityUnknown]), total).toEqual([["AAPL", true]]);
      const r = await report([BUY, merger(total)], method);
      expect(r.capitalGains.netGainLoss.toFixed(2), total).toBe("0.00");
    }
  });

  it("a blank or written-zero amount moves no money and stays skipped, and so does a fee", async () => {
    for (const row of [merger(""), merger("USD 0"), merger("USD abc", "CUSTODY FEE")]) {
      const s = await parse([BUY, row]);
      expect(s.trades.map((t) => t.tradeID), row.join()).toEqual(["revolut-buy-20250203-AAPL-1"]);
      expect(s.parserMessages, row.join()).toBeUndefined();
      expect(s.openPositions.map((p) => [p.symbol, p.quantity, p.costBasisMoney]), row.join()).toEqual([["AAPL", "10", "1000.00"]]);
    }
  });
});

describe("Revolut Price per share: a sale is never booked at price 0", () => {
  it.each(METHODS)("[%s] control: a readable price of USD 150 gives a 550 € gain", async (method) => {
    const r = await report([BUY, sell()], method);
    expect(r.capitalGains.transmissionValue.toFixed(2)).toBe("1650.00");
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("550.00");
    expect((await parse([BUY, sell()])).trades[1]!.tradePrice).toBe("150");
  });

  it.each(METHODS)("[%s] a price that cannot be read, is zero or negative is |Total Amount| ÷ Quantity", async (method) => {
    for (const price of ["USD abc", "", "USD", "USD 0", "-USD 150", "USD -150"]) {
      const s = await parse([BUY, sell(price)]);
      expect(s.trades[1]!.tradePrice, price).toBe("150");
      expect(s.parserMessages, price).toBeUndefined();
      const r = await report([BUY, sell(price)], method);
      expect(r.capitalGains.transmissionValue.toFixed(2), price).toBe("1650.00");
      expect(r.capitalGains.netGainLoss.toFixed(2), price).toBe("550.00");
    }
    const one = await report([BUY, sell("USD 1 500.00", "USD 1500", "1")], method);
    expect(one.capitalGains.netGainLoss.toFixed(2)).toBe("1540.00");
    const buyAbc = await report([BUY.map((c) => (c === "USD 100" ? "USD abc" : c)), sell()], method);
    expect(buyAbc.capitalGains.acquisitionValue.toFixed(2)).toBe("1100.00");
    expect(buyAbc.capitalGains.netGainLoss.toFixed(2)).toBe("550.00");
  });

  it.each(METHODS)("[%s] with no readable Total either, the sale is named by its price and books nothing", async (method) => {
    for (const [price, total] of [["USD abc", "USD abc"], ["", ""], ["USD", "USD 0"]]) {
      const s = await parse([BUY, sell(price, total)]);
      expect(msg(s, "parser.trade_row_unreadable"), price).toBe(`AAPL 20250603 [Price per share: ${JSON.stringify(price)}]`);
      expect(s.openPositions.map((p) => [p.symbol, p.quantityUnknown]), price).toEqual([["AAPL", true]]);
      const r = await report([BUY, sell(price, total)], method);
      expect(r.capitalGains.transmissionValue.toFixed(2), price).toBe("0.00");
      expect(r.capitalGains.netGainLoss.toFixed(2), price).toBe("0.00");
    }
  });

  it.each(METHODS)("[%s] a written zero price with no money is a corporate action not applied, never a sale at 0", async (method) => {
    const s = await parse([BUY, sell("USD 0", "USD 0")]);
    expect(msg(s, "parser.corporate_action_not_applied")).toBe("AAPL 20250603 [Price per share USD 0: 10]");
    expect(s.openPositions.map((p) => [p.symbol, p.quantityUnknown])).toEqual([["AAPL", true]]);
    const r = await report([BUY, sell("USD 0", "USD 0")], method);
    expect(r.capitalGains.transmissionValue.toFixed(2)).toBe("0.00");
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("0.00");
  });
});

describe("Revolut closed positions: proceeds that cannot be read are no sale at 0", () => {
  it.each(METHODS)("[%s] control: proceeds of 1500 give a 547.80 € gain", async (method) => {
    const r = await report([closed()], method, HC);
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("547.80");
  });

  it.each(METHODS)("[%s] unreadable, empty or currency-only proceeds keep both legs as unreadable rows that book nothing", async (method) => {
    for (const proceeds of ["abc", "", "$"]) {
      const s = await parse([closed({ "Gross proceeds": proceeds })], HC);
      const cell = `Gross proceeds: ${JSON.stringify(proceeds)}`;
      expect(msg(s, "parser.trade_row_unreadable"), proceeds).toBe(`AAPL 20250203 [${cell}]; AAPL 20250603 [${cell}]`);
      const r = await report([closed({ "Gross proceeds": proceeds })], method, HC);
      expect(r.capitalGains.transmissionValue.toFixed(2), proceeds).toBe("0.00");
      expect(r.capitalGains.netGainLoss.toFixed(2), proceeds).toBe("0.00");
    }
  });

  it.each(METHODS)("[%s] written zero proceeds stay the file's word", async (method) => {
    const r = await report([closed({ "Gross proceeds": "0" })], method, HC);
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("-1102.20");
  });

  it.each(METHODS)("[%s] a row with no symbol and no readable date that has a quantity is kept as two unreadable rows", async (method) => {
    const row = closed({ Symbol: "", "Date acquired": "abc", "Date sold": "abc" });
    const s = await parse([row], HC);
    expect(msg(s, "parser.trade_row_unreadable"))
      .toBe('— [Symbol: "", Date acquired: "abc"]; — [Symbol: "", Date sold: "abc"]');
    const r = await report([closed(), row], method, HC);
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("547.80");
  });

  it("a totals line (a Total label, or no quantity) with no symbol and no date stays skipped", async () => {
    for (const row of [
      ["Total", "", "", "10", "1000", "1500", "500", "2", "498", ""],
      ["", "", "", "", "1000", "1500", "500", "2", "498", ""],
    ]) {
      const s = await parse([closed(), row], HC);
      expect(s.trades.map((t) => t.symbol), row.join()).toEqual(["AAPL", "AAPL"]);
      expect(s.parserMessages, row.join()).toBeUndefined();
    }
  });
});
