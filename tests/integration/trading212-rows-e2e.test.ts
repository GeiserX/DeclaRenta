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
 * - A "Result adjustment" was dropped with its money and with no word.
 */
import { describe, it, expect } from "vitest";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { trading212Parser } from "../../src/parsers/trading212.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { FxMethod, TaxSummary as TaxReport } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Statement } from "../../src/types/broker.js";
import es from "../../src/i18n/locales/es.js";

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];
const H = "Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Notes,ID";
const AAPL = "US0378331005";
const BATS = "GB0002875804";

function rates(usd = "1.10"): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86_400_000) {
    map.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", usd], ["GBP", "1.18"]]));
  }
  return map;
}

const parse = (rows: string[], header = H): Statement => trading212Parser.parse([header, ...rows].join("\n"));

function report(rows: string[], method: FxMethod, usd = "1.10", header = H): TaxReport {
  const merged = mergeStatement(createEmptyStatement(), parse(rows, header), "Trading 212");
  return generateTaxReport(finalizeMergedStatement(merged), rates(usd), 2025, reportOptionsForMethod(method));
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

  it("control: interest with only Currency (Total) is booked", () => {
    const s = parse(["Interest on cash,2025-03-01 00:00:00,,,,,,,,,,10,EUR,,i1"]);
    expect(s.cashTransactions.map((c) => `${c.type} ${c.amount} ${c.currency}`)).toEqual(["Broker Interest Received 10 EUR"]);
    expect(s.parserMessages).toBeUndefined();
  });

  // In an EUR account the Total is in EUR while Currency (Price / share) is
  // the instrument's. An empty Currency (Total) was read as the price
  // currency: at a USD rate of 0.91 a 100 € dividend became 91 €.
  describe("an empty Currency (Total) is never read as the price currency", () => {
    const usdDiv = (totalCcy: string) => `Dividend (Ordinary),2025-05-15 09:00:00,${AAPL},AAPL,Apple,10,11,USD,0.92,,,100,${totalCcy},,d1`;
    const batsDiv = `Dividend (Ordinary),2025-05-15 09:00:00,${BATS},BATS,BAT,10,10,GBP,1,,,100,EUR,,d1`;
    const batsWht = (totalCcy: string) => `Dividend (Dividend tax),2025-05-15 09:00:00,${BATS},BATS,BAT,,,GBP,1,,,-15,${totalCcy},,w1`;
    const eurSell = (price: string, totalCcy: string) => `Market sell,2025-06-10 10:00:00,${AAPL},AAPL,Apple,10,${price},USD,0.9,,,1363.64,${totalCcy},,s1`;

    it.each(METHODS)("[%s] control: a USD dividend whose Total is 100 EUR gives 0029 = 100.00", (method) => {
      expect(report([usdDiv("EUR")], method, "0.91").dividends.grossIncome.toFixed(2)).toBe("100.00");
    });

    it.each(METHODS)("[%s] a dividend with only Currency (Price / share) is named and not booked", (method) => {
      for (const [row, named] of [
        [usdDiv(""), 'Dividend (Ordinary) AAPL 20250515 [Currency (Price / share): "USD", Currency (Total): ""]'],
        [gbpDiv("GBP").replace(",100,GBP,", ",100,,"), 'Dividend (Ordinary) BATS 20250515 [Currency (Price / share): "GBP", Currency (Total): ""]'],
      ] as const) {
        const s = parse([row]);
        expect(s.cashTransactions, named).toEqual([]);
        expect(msg(s, "parser.cash_income_amount_unreadable"), named).toBe(named);
        const r = report([row], method, "0.91");
        expect(r.dividends.grossIncome.toFixed(2), named).toBe("0.00");
        expect(r.messages.map((m) => m.id), named).toContain("parser.cash_income_amount_unreadable");
      }
    });

    it.each(METHODS)("[%s] a withholding with only Currency (Price / share) is named and not booked", (method) => {
      const s = parse([batsDiv, batsWht("")]);
      expect(s.cashTransactions.map((c) => `${c.type} ${c.amount} ${c.currency}`)).toEqual(["Dividends 100 EUR"]);
      expect(msg(s, "parser.cash_income_amount_unreadable")).toBe(
        'Dividend (Dividend tax) BATS 20250515 [Currency (Price / share): "GBP", Currency (Total): ""]');
      expect(report([batsDiv, batsWht("")], method, "0.91").dividends.entries.map((e) => e.withholdingTaxEur.toFixed(2))).toEqual(["0.00"]);
      expect(report([batsDiv, batsWht("EUR")], method, "0.91").dividends.entries.map((e) => e.withholdingTaxEur.toFixed(2))).toEqual(["15.00"]);
      expect(msg(parse([batsWht("").replace(`,${BATS},BATS,BAT,`, ",,,,")]), "parser.cash_income_amount_unreadable")).toBe(
        'Dividend (Dividend tax) — 20250515 [Currency (Price / share): "GBP", Currency (Total): ""]');
    });

    it.each(METHODS)("[%s] a sale with no price is never valued from a Total with no currency", (method) => {
      for (const price of ["", "0", "abc"]) {
        const s = parse([buy(), eurSell(price, "")]);
        expect(msg(s, "parser.trade_row_unreadable"), price).toBe(`AAPL (${AAPL}) 20250610 [Price / share: ${JSON.stringify(price)}, Currency (Total): ""]`);
        expect(s.trades[1]!.quantityUnknown, price).toBe(true);
        const r = report([buy(), eurSell(price, "")], method, "0.91");
        expect(r.capitalGains.transmissionValue.toFixed(2), price).toBe("0.00");
        expect(r.capitalGains.netGainLoss.toFixed(2), price).toBe("0.00");
      }
    });

    it.each(METHODS)("[%s] control: a readable price needs no Currency (Total)", (method) => {
      expect(report([buy(), eurSell("149.85", "")], method, "0.91").capitalGains.netGainLoss.toFixed(2)).toBe("453.64");
      expect(report([buy(), eurSell("149.85", "EUR")], method, "0.91").capitalGains.netGainLoss.toFixed(2)).toBe("453.64");
      expect(report([buy("100", "1000", "USD", ""), sell("150", "1500", "USD", "")], method).capitalGains.netGainLoss.toFixed(2)).toBe("550.00");
    });

    it("a fee with no currency of its own takes only Currency (Total), never the price currency", () => {
      const HF = H.replace("Currency (Total),", "Currency (Total),Currency conversion fee,Currency (Currency conversion fee),");
      const row = (totalCcy: string) => `Market sell,2025-06-10 10:00:00,${AAPL},AAPL,Apple,10,150,USD,1,,,1363.64,${totalCcy},1.5,,,s1`;
      const fee = (totalCcy: string) => { const t = parse([row(totalCcy)], HF).trades[0]!; return `${t.commission} ${t.commissionCurrency} ${t.taxes}`; };
      expect(fee("EUR")).toBe("-1.5 EUR 0");
      expect(fee("")).toBe("0 USD 0");
    });
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

  // The engine pairs a withholding with a dividend by ISIN alone, so a
  // withholding that writes no Ticker is still the unreadable dividend's.
  it.each(METHODS)("[%s] the same when only one of the two rows writes the Ticker: the withholding goes with the dividend by ISIN", (method) => {
    const noTicker = (row: string) => row.replace(",AAPL,Apple,", ",,Apple,");
    for (const [rows, tax] of [
      [[div("Dividend (Ordinary)", "15", "abc", "d1"), noTicker(wht("15", "-16.5", "w1")), div("Dividend (Ordinary)", "18", "11", "d2")], `Withholding tax - ${AAPL} -16.5 USD`],
      [[noTicker(div("Dividend (Ordinary)", "15", "abc", "d1")), wht("15", "-16.5", "w1"), div("Dividend (Ordinary)", "18", "11", "d2")], "Withholding tax - AAPL -16.5 USD"],
    ] as const) {
      const s = parse([...rows]);
      expect(s.cashTransactions.map((c) => `${c.type} ${c.amount}`), tax).toEqual(["Dividends 11"]);
      expect(msg(s, "parser.cash_income_amount_unreadable"), tax).toContain(`(${tax}) [Total: "abc"]`);
      const r = report([...rows], method);
      expect(r.dividends.grossIncome.toFixed(2), tax).toBe("12.10");
      expect(r.doubleTaxation.deduction.toFixed(2), tax).toBe("0.00");
    }
  });

  // In a file that writes withholdings negative a third withholding row can
  // be a refund: read as 0 and dropped, the report kept a deduction paid back.
  it.each(METHODS)("[%s] a withholding whose Total cannot be read is named, never read as 0 and dropped with no word", (method) => {
    const noSecurity = (row: string) => row.replace(`,${AAPL},AAPL,Apple,`, ",,,,");
    for (const [third, named] of [
      [wht("18", "abc", "w2"), 'Dividend (Dividend tax) AAPL USD 20250518 [Total: "abc"]'],
      [wht("18", "", "w2"), 'Dividend (Dividend tax) AAPL USD 20250518 [Total: ""]'],
      [noSecurity(wht("18", "abc", "w2")), 'Dividend (Dividend tax) — USD 20250518 [Total: "abc"]'],
    ] as const) {
      const rows = [div("Dividend (Ordinary)", "15", "110", "d1"), wht("15", "-16.5", "w1"), third];
      const s = parse(rows);
      expect(s.cashTransactions.map((c) => `${c.type} ${c.amount}`), named).toEqual(["Dividends 110", "Withholding Tax -16.5"]);
      expect(msg(s, "parser.cash_income_amount_unreadable"), named).toBe(named);
      expect(report(rows, method).messages.map((m) => m.id), named).toContain("parser.cash_income_amount_unreadable");
    }
  });

  it("control: a withholding that writes 0 stays skipped with no word", () => {
    const s = parse([div("Dividend (Ordinary)", "15", "110", "d1"), wht("15", "-16.5", "w1"), wht("18", "0", "w2")]);
    expect(s.cashTransactions.map((c) => `${c.type} ${c.amount}`)).toEqual(["Dividends 110", "Withholding Tax -16.5"]);
    expect(s.parserMessages).toBeUndefined();
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

// A "Result adjustment" is a credit or a debit Trading 212 makes to correct a
// trade's result. It moves no shares, so it is no trade, but it was dropped
// with its money and with no word: a credit is gain the report never saw.
describe("Trading 212 money rows of an unknown action are named, never dropped with no word", () => {
  const adjustment = (total: string) => `Result adjustment,2025-06-11 09:30:00,${AAPL},AAPL,Apple,,,,,,,${total},EUR,,r1`;

  it.each(METHODS)("[%s] a Result adjustment of +50 or -50 EUR is named; the sale's numbers do not move", (method) => {
    const control = report([buy(), sell()], method);
    expect(control.capitalGains.netGainLoss.toFixed(2)).toBe("550.00");
    for (const total of ["50", "-50"]) {
      const s = parse([buy(), sell(), adjustment(total)]);
      expect(s.trades.map((t) => t.tradeID), total).toEqual(["trading212-buy-b1", "trading212-sell-s1"]);
      expect(s.cashTransactions, total).toEqual([]);
      expect(msg(s, "parser.cash_row_not_booked"), total).toBe(`Result adjustment AAPL EUR 20250611 [Total: "${total}"]`);
      const r = report([buy(), sell(), adjustment(total)], method);
      expect(r.capitalGains.transmissionValue.toFixed(2), total).toBe("1650.00");
      expect(r.capitalGains.netGainLoss.toFixed(2), total).toBe("550.00");
      expect(r.messages.map((m) => m.id), total).toContain("parser.cash_row_not_booked");
    }
  });

  it("an unknown money row with no security, or a written share count of 0, is named the same way", () => {
    const s = parse([
      "Custody fee,2025-06-11 09:30:00,,,,,,,,,,-2,EUR,,c1",
      `Result adjustment,2025-06-12 09:30:00,${AAPL},AAPL,Apple,0,,,,,,abc,EUR,,r2`,
    ]);
    expect(msg(s, "parser.cash_row_not_booked")).toBe(
      'Custody fee EUR 20250611 [Total: "-2"]; Result adjustment AAPL EUR 20250612 [Total: "abc"]');
    const emitted = s.parserMessages!.find((m) => m.id === "parser.cash_row_not_booked")!;
    const esText = es as Record<string, string>;
    expect(emitted.message).toBe(esText["parser.cash_row_not_booked"]!.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => emitted.context?.[k] ?? ""));
    expect(emitted.hint).toBe(esText["parser.cash_row_not_booked.hint"]);
  });

  it("control: a written zero or an empty Total, deposits, withdrawals, conversions, card rows and cashback stay skipped with no word", () => {
    const s = parse([
      adjustment("0"), adjustment(""),
      "Deposit,2025-01-02 10:00:00,,,,,,,,,,1000,EUR,,x1",
      "Withdrawal,2025-01-03 10:00:00,,,,,,,,,,-100,EUR,,x2",
      "Currency conversion,2025-01-04 10:00:00,,,,,,,,,,-100,EUR,,x3",
      "Card debit,2025-01-05 10:00:00,,,,,,,,,,-20,EUR,,x4",
      "Card credit,2025-01-06 10:00:00,,,,,,,,,,20,EUR,,x5",
      "New card cost,2025-01-07 10:00:00,,,,,,,,,,-5,EUR,,x6",
      "Spending cashback,2025-01-08 10:00:00,,,,,,,,,,0.5,EUR,,x7",
    ]);
    expect([s.trades, s.cashTransactions, s.parserMessages]).toEqual([[], [], undefined]);
  });
});

describe("Trading 212 price: a negative price is never booked", () => {
  it.each(METHODS)("[%s] control: a readable sale at 50 gives a 550 € loss", (method) => {
    expect(report([buy(), sell("50", "500")], method).capitalGains.netGainLoss.toFixed(2)).toBe("-550.00");
  });

  // Booked, a sale at -150 had proceeds of -1500: a 550 € gain became a
  // 2,750 € loss. A parenthesized "(150)" reads as negative too.
  it.each(METHODS)("[%s] a sale or buy at a negative price is named by its price cell and books nothing", (method) => {
    for (const [rows, named] of [
      [[buy(), sell("-150")], `AAPL (${AAPL}) 20250610 [Price / share: "-150"]`],
      [[buy(), sell("\"(150)\"")], `AAPL (${AAPL}) 20250610 [Price / share: "(150)"]`],
      [[buy(), sell("-150", "1363.64", "USD", "EUR")], `AAPL (${AAPL}) 20250610 [Price / share: "-150"]`],
      [[buy(), sell("-50", "500")], `AAPL (${AAPL}) 20250610 [Price / share: "-50"]`],
      [[buy("-100"), sell()], `AAPL (${AAPL}) 20250110 [Price / share: "-100"]`],
    ] as const) {
      const s = parse([...rows]);
      expect(msg(s, "parser.trade_row_unreadable"), named).toBe(named);
      expect(s.trades.filter((t) => t.unreadableRow).map((t) => [t.quantityUnknown, t.tradeMoney]), named).toEqual([[true, "0"]]);
      // With the sale named, nothing is sold. With the buy named, the sale
      // has no lot: cost 0 and fifo.sell_without_lots, never a cost of -1000.
      const r = report([...rows], method);
      const buyNamed = named.includes("20250110");
      expect(r.capitalGains.transmissionValue.toFixed(2), named).toBe(buyNamed ? "1650.00" : "0.00");
      expect(r.capitalGains.acquisitionValue.toFixed(2), named).toBe("0.00");
      expect(r.capitalGains.netGainLoss.toFixed(2), named).toBe(buyNamed ? "1650.00" : "0.00");
      expect(r.messages.some((m) => m.id === "fifo.sell_without_lots"), named).toBe(buyNamed);
    }
  });
});

describe("Trading 212 fees: two fees in two other currencies are never added as one", () => {
  const HF2 = H.replace("Currency (Total),", "Currency (Total),Currency conversion fee,Currency (Currency conversion fee),Stamp duty reserve tax,Currency (Stamp duty reserve tax),");
  const feeBuy = `Market buy,2025-01-10 10:00:00,${AAPL},AAPL,Apple,10,100,USD,1,,,1000,USD,,,,,,b1`;
  const feeSell = (conv: string, convCcy: string, stamp: string, stampCcy: string) =>
    `Market sell,2025-06-10 10:00:00,${AAPL},AAPL,Apple,10,150,USD,1,,,1500,USD,${conv},${convCcy},${stamp},${stampCcy},,s1`;
  const fee = (sale: string) => { const t = parse([feeBuy, sale], HF2).trades[1]!; return `${t.commission} ${t.commissionCurrency} ${t.taxes}`; };
  const gain = (sale: string, method: FxMethod) => report([feeBuy, sale], method, "1.10", HF2).capitalGains.netGainLoss.toFixed(2);

  it.each(METHODS)("[%s] control: a 100 EUR fee alone gives 450 €, a 1 GBP or 100 GBP stamp duty alone 548.82 € or 432 €", (method) => {
    expect(fee(feeSell("100", "EUR", "", ""))).toBe("-100 EUR 0");
    expect(gain(feeSell("100", "EUR", "", ""), method)).toBe("450.00");
    expect(gain(feeSell("", "", "1", "GBP"), method)).toBe("548.82");
    expect(gain(feeSell("", "", "100", "GBP"), method)).toBe("432.00");
  });

  // Added as one, 100 EUR and 1 GBP were 101 GBP, and the gain fell 18 € with
  // no word. The fee in a second other currency is not added, which can only
  // raise the tax.
  it.each(METHODS)("[%s] a second fee in a third currency is not added to the first", (method) => {
    expect(fee(feeSell("100", "EUR", "1", "GBP"))).toBe("-100 EUR 0");
    expect(gain(feeSell("100", "EUR", "1", "GBP"), method)).toBe("450.00");
    expect(fee(feeSell("1", "EUR", "100", "GBP"))).toBe("-1 EUR 0");
    expect(gain(feeSell("1", "EUR", "100", "GBP"), method)).toBe("549.00");
  });

  it("control: two fees in one other currency add up, and a fee in the instrument's currency stays in taxes", () => {
    expect(fee(feeSell("1.5", "EUR", "1", "EUR"))).toBe("-2.5 EUR 0");
    expect(fee(feeSell("1.5", "EUR", "1", "USD"))).toBe("-1.5 EUR -1");
  });
});

// A dividend that is not booked takes its withholdings with it: booked, the
// engine pairs them by ISIN within 7 days with another dividend of the
// security. Next to a dividend of 1000 USD with 50 withheld (0029 = 1100.00,
// 0588 = 55.00), a dividend of 1000 USD with 150 withheld that is not booked
// must leave 0588 at 55.00, not 220 × the cap (165.00).
describe("Trading 212 dividends: the withholdings of a dividend not booked are never another dividend's", () => {
  const row = (action: string, day: string, isin: string, ticker: string, total: string, id: string) =>
    `${action},2025-05-${day} 09:00:00,${isin},${ticker},Apple,${action.includes("tax") ? "," : "10,1"},USD,0.92,,,${total},USD,,${id}`;
  const div = (day: string, isin: string, ticker: string, total: string, id: string) => row("Dividend (Ordinary)", day, isin, ticker, total, id);
  const wht = (day: string, isin: string, ticker: string, total: string, id: string) => row("Dividend (Dividend tax)", day, isin, ticker, total, id);
  const other = (isin = AAPL) => [div("18", isin, "AAPL", "1000", "d2"), wht("18", isin, "AAPL", "-50", "w2")];
  const numbers = (rows: string[], method: FxMethod): string[] => {
    const r = report(rows, method);
    return [r.dividends.grossIncome.toFixed(2), r.doubleTaxation.deduction.toFixed(2)];
  };

  it.each(METHODS)("[%s] control: the other dividend alone gives 0029 = 1100.00 and 0588 = 55.00", (method) => {
    expect(numbers(other(), method)).toEqual(["1100.00", "55.00"]);
    expect(numbers(other(""), method)).toEqual(["1100.00", "55.00"]);
  });

  it.each(METHODS)("[%s] a dividend whose Total cannot be read takes its withholding when only one of the two rows writes the ISIN", (method) => {
    for (const [rows, tax] of [
      [[div("15", "", "AAPL", "abc", "d1"), wht("15", AAPL, "AAPL", "-150", "w1"), ...other()], "Withholding tax - AAPL -150 USD"],
      [[div("15", AAPL, "AAPL", "abc", "d1"), wht("15", "", "AAPL", "-150", "w1"), ...other("")], "Withholding tax - AAPL -150 USD"],
    ] as const) {
      const s = parse([...rows]);
      expect(s.cashTransactions.map((c) => `${c.type} ${c.amount}`), tax).toEqual(["Dividends 1000", "Withholding Tax -50"]);
      expect(msg(s, "parser.cash_income_amount_unreadable"), tax).toContain(`(${tax}) [Total: "abc"]`);
      expect(numbers([...rows], method), tax).toEqual(["1100.00", "55.00"]);
    }
  });
  // A dividend with no ticker and no ISIN names no security, so its
  // withholdings are those of its day that no booked dividend of their own
  // security and day claims.
  it.each(METHODS)("[%s] a dividend that names no security takes the withholding of its day that no other dividend claims", (method) => {
    for (const [first, named, id] of [
      [div("15", "", "", "1000", "d1"), "Dividend (Ordinary) 1000 USD 20250515 (Withholding tax - AAPL -150 USD)", "parser.cash_row_unidentified"],
      [div("15", "", "", "abc", "d1"), 'Dividend (Ordinary) — USD 20250515 (Withholding tax - AAPL -150 USD) [Total: "abc"]', "parser.cash_income_amount_unreadable"],
    ] as const) {
      const rows = [first, wht("15", AAPL, "AAPL", "-150", "w1"), ...other()];
      const s = parse(rows);
      expect(s.cashTransactions.map((c) => `${c.type} ${c.amount}`), named).toEqual(["Dividends 1000", "Withholding Tax -50"]);
      expect(msg(s, id), named).toBe(named);
      expect(numbers(rows, method), named).toEqual(["1100.00", "55.00"]);
    }
    // A refund on that day stays booked: taken out, the deduction would rise.
    const refund = [div("15", "", "", "1000", "d1"), wht("15", AAPL, "AAPL", "20", "w3"), wht("15", AAPL, "AAPL", "-150", "w1"), ...other()];
    expect(parse(refund).cashTransactions.map((c) => `${c.type} ${c.amount}`)).toEqual(["Withholding Tax 20", "Dividends 1000", "Withholding Tax -50"]);
  });

  it.each(METHODS)("[%s] control: a withholding its own dividend claims on that day stays booked, and so does a refund of that day", (method) => {
    const rows = [div("18", "", "", "1000", "d1"), ...other(), wht("18", AAPL, "AAPL", "20", "w3")];
    const s = parse(rows);
    expect(s.cashTransactions.map((c) => `${c.type} ${c.amount}`)).toEqual(["Dividends 1000", "Withholding Tax -50", "Withholding Tax 20"]);
    expect(msg(s, "parser.cash_row_unidentified")).toBe("Dividend (Ordinary) 1000 USD 20250518");
    expect(numbers(rows, method)).toEqual(["1100.00", "33.00"]);
  });
});
