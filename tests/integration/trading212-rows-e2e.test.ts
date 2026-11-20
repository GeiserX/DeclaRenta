/**
 * Trading 212 rows the parser read wrong (#466, #467, #468). Every case runs a
 * real CSV through the real parser and generateTaxReport, in the three FX
 * methods, next to a readable control.
 *
 * - A buy or sale with no readable price was valued from its Total, but the
 *   Total never reached the engine: FIFO reads only tradePrice, which stayed
 *   "0", so a sale became a full loss with no word.
 * - A sale whose price and Total both cannot be read was booked at 0.
 * - "Dividend (Tax exempted)" was read as a withholding.
 * - "Lending interest" was dropped with no word.
 * - A withholding refund (a positive withholding row) was one more withholding.
 * - The withholding of a dividend whose Total cannot be read was still booked.
 * - An empty currency cell was read as EUR.
 */
import { describe, it, expect } from "vitest";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { trading212Parser } from "../../src/parsers/trading212.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { FxMethod, TaxSummary as TaxReport } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Statement } from "../../src/types/broker.js";

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];
const H = "Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Notes,ID";
const AAPL = "US0378331005";
const BATS = "GB0002875804";

function rates(): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86_400_000) {
    map.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "1.10"], ["GBP", "1.18"]]));
  }
  return map;
}

const parse = (rows: string[]): Statement => trading212Parser.parse([H, ...rows].join("\n"));

function report(rows: string[], method: FxMethod): TaxReport {
  const merged = mergeStatement(createEmptyStatement(), parse(rows), "Trading 212");
  return generateTaxReport(finalizeMergedStatement(merged), rates(), 2025, reportOptionsForMethod(method));
}

const msg = (s: Statement, id: string): string | undefined =>
  s.parserMessages?.find((m) => m.id === id)?.context?.rows;

// Buy 10 AAPL at 100 USD, sell them at 150 USD. At 1.10 the report shows a
// transmission of 1650, an acquisition of 1100 and a gain of 550.
const buy = (price = "100", total = "1000", ccy = "USD", totalCcy = ccy) =>
  `Market buy,2025-01-10 10:00:00,${AAPL},AAPL,Apple,10,${price},${ccy},1,,,${total},${totalCcy},,b1`;
const sell = (price = "150", total = "1500", ccy = "USD", totalCcy = ccy) =>
  `Market sell,2025-06-10 10:00:00,${AAPL},AAPL,Apple,10,${price},${ccy},1,,,${total},${totalCcy},,s1`;

describe("Trading 212 price: a trade valued from its Total reaches the engine at that Total", () => {
  it.each(METHODS)("[%s] control: a readable price of 150 gives a 550 € gain", (method) => {
    const r = report([buy(), sell()], method);
    expect(r.capitalGains.transmissionValue.toFixed(2)).toBe("1650.00");
    expect(r.capitalGains.acquisitionValue.toFixed(2)).toBe("1100.00");
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("550.00");
    expect(parse([buy(), sell()]).trades[1]!.tradePrice).toBe("150");
  });

  it.each(METHODS)("[%s] a sale or buy whose price cannot be read or is zero is priced Total ÷ shares", (method) => {
    for (const price of ["abc", "", "Infinity", "0"]) {
      const s = parse([buy(), sell(price)]);
      expect(s.trades[1]!.tradePrice, price).toBe("150");
      expect(s.parserMessages, price).toBeUndefined();
      const r = report([buy(), sell(price)], method);
      expect(r.capitalGains.transmissionValue.toFixed(2), price).toBe("1650.00");
      expect(r.capitalGains.netGainLoss.toFixed(2), price).toBe("550.00");
      const b = report([buy(price), sell()], method);
      expect(b.capitalGains.acquisitionValue.toFixed(2), `buy ${price}`).toBe("1100.00");
      expect(b.capitalGains.netGainLoss.toFixed(2), `buy ${price}`).toBe("550.00");
    }
  });

  it("a GBX trade valued from a GBX Total is priced in GBP", () => {
    const row = `Market buy,2025-01-10 10:00:00,${BATS},BATS,BAT,10,,GBX,1,,,30000,GBX,,b1`;
    const t = parse([row]).trades[0]!;
    expect([t.currency, t.tradePrice, t.cost]).toEqual(["GBP", "30", "-300"]);
  });
});

describe("Trading 212 price and Total: a sale with neither is never a disposal at 0", () => {
  it.each(METHODS)("[%s] a sale whose price and Total cannot be read is named by both cells and books nothing", (method) => {
    for (const [price, total, cells] of [
      ["abc", "", 'Price / share: "abc", Total: ""'],
      ["", "abc", 'Price / share: "", Total: "abc"'],
      ["0", "", 'Price / share: "0", Total: ""'],
      ["", "", 'Price / share: "", Total: ""'],
    ] as const) {
      const s = parse([buy(), sell(price, total)]);
      expect(msg(s, "parser.trade_row_unreadable"), `${price}|${total}`).toBe(`AAPL (${AAPL}) 20250610 [${cells}]`);
      expect(s.trades[1]!.quantityUnknown, `${price}|${total}`).toBe(true);
      const r = report([buy(), sell(price, total)], method);
      expect(r.capitalGains.transmissionValue.toFixed(2), `${price}|${total}`).toBe("0.00");
      expect(r.capitalGains.netGainLoss.toFixed(2), `${price}|${total}`).toBe("0.00");
      expect(r.messages.map((m) => m.id), `${price}|${total}`).toContain("parser.trade_row_unreadable");
    }
  });

  it.each(METHODS)("[%s] a sale with a written zero price and Total is a corporate action not applied", (method) => {
    const s = parse([buy(), sell("0", "0")]);
    expect(msg(s, "parser.corporate_action_not_applied")).toBe(`AAPL (${AAPL}) 20250610 [Price / share 0, Total 0: 10]`);
    const r = report([buy(), sell("0", "0")], method);
    expect(r.capitalGains.transmissionValue.toFixed(2)).toBe("0.00");
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("0.00");
    expect(r.messages.map((m) => m.id)).toContain("parser.corporate_action_not_applied");
  });

  it("the same with the Total in another currency: an empty Total is named too, never booked at 0", () => {
    const s = parse([buy(), sell("", "", "USD", "EUR")]);
    expect(msg(s, "parser.trade_row_unreadable")).toBe(`AAPL (${AAPL}) 20250610 [Price / share: "", Total: ""]`);
    expect(s.trades[1]!.tradeMoney).toBe("0");
  });
});

describe("Trading 212 currency: an empty currency is never read as EUR", () => {
  const gbpBuy = `Market buy,2025-01-10 10:00:00,${BATS},BATS,BAT,10,30,GBP,1,,,300,GBP,,b1`;
  const gbpSell = (ccy: string) => `Market sell,2025-06-10 10:00:00,${BATS},BATS,BAT,10,40,${ccy},1,,,400,${ccy},,s1`;
  const gbpDiv = (ccy: string) => `Dividend (Ordinary),2025-05-15 09:00:00,${BATS},BATS,BAT,10,10,${ccy},1,,,100,${ccy},,d1`;

  it.each(METHODS)("[%s] control: a GBP sale gives 472 € and a GBP dividend 118 €", (method) => {
    const r = report([gbpBuy, gbpSell("GBP"), gbpDiv("GBP")], method);
    expect(r.capitalGains.transmissionValue.toFixed(2)).toBe("472.00");
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("118.00");
    expect(r.dividends.grossIncome.toFixed(2)).toBe("118.00");
  });

  it.each(METHODS)("[%s] a sale with empty currency cells is named by its currency cell and books nothing", (method) => {
    const s = parse([gbpBuy, gbpSell("")]);
    expect(msg(s, "parser.trade_row_unreadable")).toBe(`BATS (${BATS}) 20250610 [Currency (Price / share): ""]`);
    const r = report([gbpBuy, gbpSell("")], method);
    expect(r.capitalGains.transmissionValue.toFixed(2)).toBe("0.00");
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("0.00");
  });

  it.each(METHODS)("[%s] a sale row cut off after its share count or its price is named, never sold at 0 or in EUR", (method) => {
    for (const cut of [`Market sell,2025-06-10 10:00:00,${AAPL},AAPL,Apple,10`, `Market sell,2025-06-10 10:00:00,${AAPL},AAPL,Apple,10,150`]) {
      const s = parse([buy(), cut]);
      expect(msg(s, "parser.trade_row_unreadable"), cut).toBe(`AAPL (${AAPL}) 20250610 [Currency (Price / share): —]`);
      const r = report([buy(), cut], method);
      expect(r.capitalGains.transmissionValue.toFixed(2), cut).toBe("0.00");
      expect(r.capitalGains.netGainLoss.toFixed(2), cut).toBe("0.00");
    }
  });

  it.each(METHODS)("[%s] a dividend or interest with empty currency cells is named and not booked", (method) => {
    const interest = "Interest on cash,2025-03-01 00:00:00,,,,,,,,,,10,,,i1";
    const s = parse([gbpDiv(""), interest]);
    expect(s.cashTransactions).toEqual([]);
    expect(msg(s, "parser.cash_income_amount_unreadable")).toBe(
      'Dividend (Ordinary) BATS 20250515 [Currency (Price / share): "", Currency (Total): ""]; ' +
      'Interest on cash 20250301 [Currency (Price / share): "", Currency (Total): ""]');
    const r = report([gbpDiv(""), interest], method);
    expect(r.dividends.grossIncome.toFixed(2)).toBe("0.00");
    expect(r.interest.earned.toFixed(2)).toBe("0.00");
    expect(r.messages.map((m) => m.id)).toContain("parser.cash_income_amount_unreadable");
  });

  it("control: interest with only Currency (Total), and a dividend with only Currency (Price / share), are booked", () => {
    const s = parse(["Interest on cash,2025-03-01 00:00:00,,,,,,,,,,10,EUR,,i1", gbpDiv("GBP").replace(",100,GBP,", ",100,,")]);
    expect(s.cashTransactions.map((c) => `${c.type} ${c.amount} ${c.currency}`)).toEqual(["Broker Interest Received 10 EUR", "Dividends 100 GBP"]);
    expect(s.parserMessages).toBeUndefined();
  });

  it("a withholding with empty currency cells is named, not booked as EUR", () => {
    const s = parse([
      `Dividend (Ordinary),2025-05-15 09:00:00,${AAPL},AAPL,Apple,10,1,USD,0.92,,,110,USD,,d1`,
      `Dividend (Dividend tax),2025-05-15 09:00:00,${AAPL},AAPL,Apple,,,,0.92,,,-16.5,,,w1`,
    ]);
    expect(s.cashTransactions.map((c) => c.type)).toEqual(["Dividends"]);
    expect(msg(s, "parser.cash_income_amount_unreadable")).toBe(
      'Dividend (Dividend tax) AAPL 20250515 [Currency (Price / share): "", Currency (Total): ""]');
  });
});

describe("Trading 212 dividends: tax-exempt dividends, refunds and unreadable dividends", () => {
  const div = (action: string, day: string, total: string, id: string) =>
    `${action},2025-05-${day} 09:00:00,${AAPL},AAPL,Apple,10,1,USD,0.92,,,${total},USD,,${id}`;
  const wht = (day: string, total: string, id: string) =>
    `Dividend (Dividend tax),2025-05-${day} 09:00:00,${AAPL},AAPL,Apple,,,USD,0.92,,,${total},USD,,${id}`;

  it.each(METHODS)("[%s] \"Dividend (Tax exempted)\" is a dividend: 0029 = 242.00, 0588 = 0.00", (method) => {
    const rows = [div("Dividend (Ordinary)", "15", "110", "d1"), div("Dividend (Tax exempted)", "16", "110", "d2")];
    expect(parse(rows).cashTransactions.map((c) => `${c.type} ${c.amount}`)).toEqual(["Dividends 110", "Dividends 110"]);
    const r = report(rows, method);
    expect(r.dividends.grossIncome.toFixed(2)).toBe("242.00");
    expect(r.doubleTaxation.deduction.toFixed(2)).toBe("0.00");
  });

  it.each(METHODS)("[%s] control: a dividend of 110 USD with 16.5 withheld gives 0588 = 18.15", (method) => {
    const r = report([div("Dividend (Ordinary)", "15", "110", "d1"), wht("15", "-16.5", "w1")], method);
    expect(r.dividends.grossIncome.toFixed(2)).toBe("121.00");
    expect(r.doubleTaxation.deduction.toFixed(2)).toBe("18.15");
  });

  it.each(METHODS)("[%s] a positive withholding row next to a negative one is a refund: 0588 = 0.00", (method) => {
    const rows = [div("Dividend (Ordinary)", "15", "110", "d1"), wht("15", "-16.5", "w1"), wht("18", "16.5", "w2")];
    expect(parse(rows).cashTransactions.map((c) => c.amount)).toEqual(["110", "-16.5", "16.5"]);
    const r = report(rows, method);
    expect(r.dividends.grossIncome.toFixed(2)).toBe("121.00");
    expect(r.doubleTaxation.deduction.toFixed(2)).toBe("0.00");
  });

  it("control: a file that writes every withholding as positive still books them as withholdings", () => {
    const s = parse([div("Dividend (Ordinary)", "15", "110", "d1"), wht("15", "16.5", "w1")]);
    expect(s.cashTransactions.map((c) => c.amount)).toEqual(["110", "-16.5"]);
  });

  it.each(METHODS)("[%s] the withholding of a dividend whose Total cannot be read is named with it, never paired with another dividend", (method) => {
    const rows = [div("Dividend (Ordinary)", "15", "abc", "d1"), wht("15", "-16.5", "w1"), div("Dividend (Ordinary)", "18", "11", "d2")];
    const s = parse(rows);
    expect(s.cashTransactions.map((c) => `${c.type} ${c.amount}`)).toEqual(["Dividends 11"]);
    expect(msg(s, "parser.cash_income_amount_unreadable")).toBe(
      'Dividend (Ordinary) AAPL USD 20250515 (Withholding tax - AAPL -16.5 USD) [Total: "abc"]');
    const r = report(rows, method);
    expect(r.dividends.grossIncome.toFixed(2)).toBe("12.10");
    expect(r.doubleTaxation.deduction.toFixed(2)).toBe("0.00");
  });

  it("control: the withholding of a readable dividend on another day stays booked", () => {
    const s = parse([div("Dividend (Ordinary)", "15", "abc", "d1"), wht("18", "-1.65", "w1"), div("Dividend (Ordinary)", "18", "11", "d2")]);
    expect(s.cashTransactions.map((c) => `${c.type} ${c.amount}`)).toEqual(["Withholding Tax -1.65", "Dividends 11"]);
  });
});

describe("Trading 212 lending interest is interest income", () => {
  it.each(METHODS)("[%s] control: Interest on cash of 10 EUR gives 0027 = 10.00", (method) => {
    expect(report(["Interest on cash,2025-03-01 00:00:00,,,,,,,,,,10,EUR,,i1"], method).interest.earned.toFixed(2)).toBe("10.00");
  });

  it.each(METHODS)("[%s] Lending interest of 10 EUR, with or without a security, gives 0027 = 10.00", (method) => {
    for (const row of ["Lending interest,2025-03-01 00:00:00,,,,,,,,,,10,EUR,,l1", `Lending interest,2025-03-01 00:00:00,${AAPL},AAPL,Apple,,,,,,,10,EUR,,l1`]) {
      const s = parse([row]);
      expect(s.cashTransactions.map((c) => `${c.type} ${c.description} ${c.amount} ${c.currency}`), row).toEqual(["Broker Interest Received Lending interest 10 EUR"]);
      expect(s.trades, row).toEqual([]);
      expect(report([row], method).interest.earned.toFixed(2), row).toBe("10.00");
    }
  });

  it("Lending interest whose Total cannot be read is named", () => {
    expect(msg(parse(["Lending interest,2025-03-01 00:00:00,,,,,,,,,,abc,EUR,,l1"]), "parser.cash_income_amount_unreadable"))
      .toBe('Lending interest EUR 20250301 [Total: "abc"]');
  });
});
