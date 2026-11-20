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
 * - A header the detection accepts ("Price per share (USD)") was not found
 *   by the column lookup: every trade was priced 0, or the file gave an
 *   empty statement with no word.
 * - The currency in front of an amount was ignored: "EUR 1500" with a
 *   Currency of USD was booked as 1500 USD, in both formats.
 * - A split, merger or spin-off with no ticker was dropped with no word: a
 *   split's later sale kept its pre-split cost, a cash merger's money was lost.
 * - A split that paid cash was applied with the cash dropped.
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

describe("Revolut headers: the lookup finds every column the detection accepts", () => {
  const swap = (header: string[], from: string, to: string) => header.map((h) => (h === from ? to : h));

  it.each(METHODS)("[%s] \"Price per share (USD)\" and \"Total Amount (USD)\" are read like the exact headers", async (method) => {
    for (const header of [swap(H, "Price per share", "Price per share (USD)"), swap(H, "Total Amount", "Total Amount (USD)")]) {
      const r = await report([BUY, sell()], method, header);
      expect(r.capitalGains.transmissionValue.toFixed(2), header.join()).toBe("1650.00");
      expect(r.capitalGains.netGainLoss.toFixed(2), header.join()).toBe("550.00");
    }
  });

  it.each(METHODS)("[%s] closed positions: \"Gross proceeds (USD)\" and \"Cost basis (USD)\" are read", async (method) => {
    const header = swap(swap(HC, "Gross proceeds", "Gross proceeds (USD)"), "Cost basis", "Cost basis (USD)");
    const r = await report([closed()], method, header);
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("547.80");
  });

  it("a file the detection accepts with a required column missing is refused, naming the column", async () => {
    const noCurrency = [H.filter((h) => h !== "Currency"), BUY.filter((_, i) => i !== 6)];
    await expect(parseRevolutXlsx(workbook(noCurrency))).rejects.toThrow("Revolut XLSX: faltan columnas obligatorias (Currency)");
    const noSymbol = [HC.filter((h) => h !== "Symbol"), closed().filter((_, i) => i !== 2)];
    await expect(parseRevolutXlsx(workbook(noSymbol))).rejects.toThrow("Revolut XLSX: faltan columnas obligatorias (Symbol)");
  });
});

describe("Revolut amounts whose currency disagrees with the Currency column are never booked in the wrong currency", () => {
  const withCurrency = (row: string[], currency: string) => row.map((c, i) => (i === 6 ? currency : c));
  const dividend = (total: string, currency = "USD") => ["2025-05-15T10:00:00Z", "AAPL", "DIVIDEND", "", "", total, currency, "1.1"];

  it.each(METHODS)("[%s] a sale written in EUR with a Currency of USD is named and books nothing", async (method) => {
    for (const [price, total, cells] of [
      ["EUR 150", "EUR 1500", 'Currency: "USD", Price per share: "EUR 150", Total Amount: "EUR 1500"'],
      ["USD 150", "EUR 1500", 'Currency: "USD", Total Amount: "EUR 1500"'],
    ] as const) {
      const s = await parse([BUY, sell(price, total)]);
      expect(msg(s, "parser.trade_row_unreadable"), total).toBe(`AAPL 20250603 [${cells}]`);
      expect(s.openPositions.map((p) => [p.symbol, p.quantityUnknown]), total).toEqual([["AAPL", true]]);
      const r = await report([BUY, sell(price, total)], method);
      expect(r.capitalGains.transmissionValue.toFixed(2), total).toBe("0.00");
    }
  });

  it.each(METHODS)("[%s] a dividend of \"GBP 100\" with a Currency of USD is named and not booked", async (method) => {
    const s = await parse([dividend("GBP 100")]);
    expect(s.cashTransactions).toEqual([]);
    expect(msg(s, "parser.cash_income_amount_unreadable")).toBe('DIVIDEND AAPL USD 20250515 [Currency: "USD", Total Amount: "GBP 100"]');
    const r = await report([dividend("GBP 100")], method);
    expect(r.dividends.grossIncome.toFixed(2)).toBe("0.00");
  });

  it.each(METHODS)("[%s] an empty Currency cell takes the currency written in front of the amounts", async (method) => {
    const r = await report([withCurrency(BUY, ""), withCurrency(sell(), "")], method);
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("550.00");
    const d = await report([dividend("USD 110", "")], method);
    expect(d.dividends.grossIncome.toFixed(2)).toBe("121.00");
    expect((await parse([dividend("USD 110", "")])).cashTransactions[0]!.currency).toBe("USD");
  });
});

describe("Revolut splits and other corporate actions with no ticker are kept and named, never dropped with no word", () => {
  // Buy 10 AAPL at 100 USD, a split that adds 10 shares, sell 10 at 75 USD.
  // Applied, the sale has a cost of 500 USD: a gain of 275 €.
  const SPLIT = (ticker: string, date = "2025-03-01T10:00:00Z") => [date, ticker, "STOCK SPLIT", "10", "", "USD 0", "USD", "1.1"];
  const SELL10 = ["2025-06-03T10:00:00Z", "AAPL", "SELL - MARKET", "10", "USD 75", "USD 750", "USD", "1.1"];

  it.each(METHODS)("[%s] control: a split with its ticker is applied, a gain of 275 €", async (method) => {
    const r = await report([BUY, SPLIT("AAPL"), SELL10], method);
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("275.00");
  });

  it.each(METHODS)("[%s] a split with no ticker is named as not applied: the user is told the 275 € loss may be wrong", async (method) => {
    const s = await parse([BUY, SPLIT(""), SELL10]);
    expect(msg(s, "parser.corporate_action_not_applied")).toBe("— 20250301 [STOCK SPLIT: 10]");
    expect(s.trades.filter((t) => t.corporateActionRow !== undefined).map((t) => [t.symbol, t.quantity, t.quantityUnknown]))
      .toEqual([["", "0", true]]);
    const r = await report([BUY, SPLIT(""), SELL10], method);
    expect(r.messages.some((m) => m.id === "parser.corporate_action_not_applied")).toBe(true);
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("-275.00");
  });

  it.each(METHODS)("[%s] a cash merger, a stock merger and a spin-off with no ticker are named; the merger's money is said to be missing", async (method) => {
    for (const [type, qty, total] of [["MERGER - CASH", "10", "USD 1500"], ["MERGER - STOCK", "10", "USD 0"], ["SPINOFF", "5", "USD 0"]] as const) {
      const row = ["2025-06-03T10:00:00Z", "", type, qty, "", total, "USD", "1.1"];
      const s = await parse([BUY, row]);
      expect(msg(s, "parser.corporate_action_not_applied"), type).toBe(`— 20250603 [${type}: ${qty}]`);
      const r = await report([BUY, row], method);
      expect(r.messages.find((m) => m.id === "parser.corporate_action_not_applied")?.hint, type).toContain("Añádela a mano");
      expect(r.capitalGains.transmissionValue.toFixed(2), type).toBe("0.00");
    }
  });

  it("a split with no ticker and no readable date is named with its date cell", async () => {
    const s = await parse([BUY, SPLIT("", "abc")]);
    expect(msg(s, "parser.corporate_action_not_applied")).toBe("— abc [STOCK SPLIT: 10]");
  });

  it("a merger with no ticker that moves no shares and no money, a reward and a custody fee with no ticker stay skipped", async () => {
    for (const row of [
      ["2025-06-03T10:00:00Z", "", "MERGER - CASH", "0", "", "USD 0", "USD", "1.1"],
      ["2025-06-03T10:00:00Z", "", "REWARD", "1", "", "USD 10", "USD", "1.1"],
      ["2025-06-03T10:00:00Z", "", "CUSTODY FEE", "", "", "USD -1", "USD", "1.1"],
    ]) {
      const s = await parse([BUY, row]);
      expect(s.trades.map((t) => t.tradeID), row.join()).toEqual(["revolut-buy-20250203-AAPL-1"]);
      expect(s.parserMessages, row.join()).toBeUndefined();
    }
  });
});

describe("Revolut closed positions: an amount whose currency disagrees with the Currency column is never booked in the wrong currency", () => {
  it.each(METHODS)("[%s] control: amounts written \"USD 1000\" and \"USD 1500\" with a Currency of USD give a 547.80 € gain", async (method) => {
    const r = await report([closed({ "Cost basis": "USD 1000", "Gross proceeds": "USD 1500" })], method, HC);
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("547.80");
  });

  it.each(METHODS)("[%s] proceeds of \"EUR 900\" with a Currency of USD keeps both legs as unreadable rows that book nothing", async (method) => {
    for (const [o, cells] of [
      [{ "Cost basis": "USD 1000", "Gross proceeds": "EUR 900" }, 'Currency: "USD", Gross proceeds: "EUR 900"'],
      [{ "Cost basis": "EUR 1000", "Gross proceeds": "EUR 1500" }, 'Currency: "USD", Cost basis: "EUR 1000", Gross proceeds: "EUR 1500"'],
      [{ Fees: "EUR 2" }, 'Currency: "USD", Fees: "EUR 2"'],
    ] as const) {
      const s = await parse([closed(o)], HC);
      expect(msg(s, "parser.trade_row_unreadable"), cells).toBe(`AAPL 20250203 [${cells}]; AAPL 20250603 [${cells}]`);
      const r = await report([closed(o)], method, HC);
      expect(r.capitalGains.transmissionValue.toFixed(2), cells).toBe("0.00");
      expect(r.capitalGains.netGainLoss.toFixed(2), cells).toBe("0.00");
    }
  });

  it.each(METHODS)("[%s] an empty Currency cell takes the currency written in front of the amounts", async (method) => {
    const o = { Currency: "", "Cost basis": "USD 1000", "Gross proceeds": "USD 1500" };
    expect((await parse([closed(o)], HC)).trades.map((t) => t.currency)).toEqual(["USD", "USD"]);
    const r = await report([closed(o)], method, HC);
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("547.80");
  });
});

describe("Revolut splits that pay cash are never applied with the cash dropped", () => {
  // Buy 10 AAPL at 100 USD; a reverse split leaves 1 share (-9) or half a
  // share and pays 750 USD for the other half (-9.5); sell what is left at
  // 1500 USD a share.
  const SPLIT = (qty: string, total: string) => ["2025-04-01T10:00:00Z", "AAPL", "STOCK SPLIT", qty, "", total, "USD", "1.1"];
  const SELL = (qty: string, total: string) => ["2025-06-03T10:00:00Z", "AAPL", "SELL - MARKET", qty, "USD 1500", total, "USD", "1.1"];

  it.each(METHODS)("[%s] control: a split with a Total of \"USD 0\" or blank is applied, a gain of 550 €", async (method) => {
    for (const total of ["USD 0", ""]) {
      const s = await parse([BUY, SPLIT("-9", total), SELL("1", "USD 1500")]);
      expect(s.corporateActions.map((c) => [c.type, c.quantity]), total).toEqual([["RS", "-9"]]);
      const r = await report([BUY, SPLIT("-9", total), SELL("1", "USD 1500")], method);
      expect(r.capitalGains.netGainLoss.toFixed(2), total).toBe("550.00");
    }
  });

  it.each(METHODS)("[%s] a split with a Total of \"USD 750\" or one with no number is named as not applied", async (method) => {
    for (const total of ["USD 750", "USD abc", "USD"]) {
      const rows = [BUY, SPLIT("-9.5", total), SELL("0.5", "USD 750")];
      const s = await parse(rows);
      expect(s.corporateActions, total).toEqual([]);
      expect(msg(s, "parser.corporate_action_not_applied"), total).toBe("AAPL 20250401 [STOCK SPLIT: -9.5]");
      expect(s.openPositions.map((p) => [p.symbol, p.quantityUnknown]), total).toEqual([["AAPL", true]]);
      const r = await report(rows, method);
      expect(r.messages.some((m) => m.id === "parser.corporate_action_not_applied"), total).toBe(true);
      // Not applied, the half share sold keeps its own cost (50 USD): a gain
      // of 770 € the user is told to check, never the 275 € loss of the split
      // applied with its 750 USD dropped.
      expect(r.capitalGains.netGainLoss.toFixed(2), total).toBe("770.00");
    }
  });
});
