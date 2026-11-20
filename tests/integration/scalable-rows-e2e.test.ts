/**
 * Scalable Capital rows the parser could not read (#466, #467, #468). Every
 * case runs a real CSV through the real parser and generateTaxReport, in the
 * three FX methods, next to a readable control.
 *
 * - A buy or sale whose price cannot be read ("abc", "-") stopped the whole
 *   report with a DecimalError.
 * - A sale whose price is empty, only "€", a written zero or in no column was
 *   booked at price 0: a gain became a full loss with no word.
 * - A "Corporate action" row with a written 0 share count and a cash amount
 *   (a cash merger, a redemption) was dropped with no word.
 * - The tax of a reversed (negative) Distribution was booked as a new
 *   withholding, so a reversed Spanish dividend gave its 0597 credit again.
 */
import { describe, it, expect } from "vitest";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { scalableParser } from "../../src/parsers/scalable.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { FxMethod, TaxSummary as TaxReport } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Statement } from "../../src/types/broker.js";

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];
const H = "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency";
const H_NO_PRICE = "date;time;status;reference;description;assetType;type;isin;shares;amount;fee;tax;currency";

function rates(): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86_400_000) {
    map.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "1.10"]]));
  }
  return map;
}

const parse = (rows: string[], header = H): Statement => scalableParser.parse([header, ...rows].join("\n"));

function report(rows: string[], method: FxMethod, header = H): TaxReport {
  const merged = mergeStatement(createEmptyStatement(), parse(rows, header), "Scalable Capital");
  return generateTaxReport(finalizeMergedStatement(merged), rates(), 2025, reportOptionsForMethod(method));
}

const msg = (s: Statement, id: string): string | undefined =>
  s.parserMessages?.find((m) => m.id === id)?.context?.rows;

// Buy 10 AAPL at 100 USD, sell them at 150 USD. At 1.10 the report shows a
// transmission of 1650, an acquisition of 1100 and a gain of 550.
const buy = (price = "100,00", amount = "-1000,00") =>
  `2025-02-03;09:15;Executed;U1;Apple;Security;Buy;US0378331005;10;${price};${amount};0;0;USD`;
const sell = (price = "150,00", amount = "1500,00") =>
  `2025-09-03;09:15;Executed;U2;Apple;Security;Sell;US0378331005;-10;${price};${amount};0;0;USD`;

describe("Scalable price: a buy or sale is never booked at price 0 and never stops the report", () => {
  it.each(METHODS)("[%s] control: a readable price of 150,00 gives a 550 € gain", (method) => {
    const r = report([buy(), sell()], method);
    expect(r.capitalGains.transmissionValue.toFixed(2)).toBe("1650.00");
    expect(r.capitalGains.acquisitionValue.toFixed(2)).toBe("1100.00");
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("550.00");
    expect(parse([buy(), sell()]).trades[1]!.tradePrice).toBe("150.00");
  });

  it.each(METHODS)("[%s] a price that cannot be read, is empty, zero or negative is |amount| ÷ shares", (method) => {
    for (const price of ["abc", "-", "", "€", "0,00", "0", "-150,00"]) {
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

  it.each(METHODS)("[%s] a file with no price column prices every trade from its amount", (method) => {
    const rows = [
      "2025-02-03;09:15;Executed;U1;Apple;Security;Buy;US0378331005;10;-1000,00;0;0;USD",
      "2025-09-03;09:15;Executed;U2;Apple;Security;Sell;US0378331005;-10;1500,00;0;0;USD",
    ];
    expect(parse(rows, H_NO_PRICE).trades.map((t) => t.tradePrice)).toEqual(["100", "150"]);
    const r = report(rows, method, H_NO_PRICE);
    expect(r.capitalGains.transmissionValue.toFixed(2)).toBe("1650.00");
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("550.00");
  });

  it.each(METHODS)("[%s] with no readable amount either, the sale is named by its price and books nothing", (method) => {
    for (const [price, amount] of [["abc", ""], ["", ""], ["€", "abc"], ["-150,00", "0,00"]] as const) {
      const s = parse([buy(), sell(price, amount)]);
      expect(msg(s, "parser.trade_row_unreadable"), price).toBe(`Apple (US0378331005) 20250903 [price: ${JSON.stringify(price)}]`);
      const r = report([buy(), sell(price, amount)], method);
      expect(r.capitalGains.transmissionValue.toFixed(2), price).toBe("0.00");
      expect(r.capitalGains.netGainLoss.toFixed(2), price).toBe("0.00");
      expect(r.messages.map((m) => m.id), price).toContain("parser.trade_row_unreadable");
    }
  });

  it.each(METHODS)("[%s] a written zero price with no money is a corporate action not applied, never a sale at 0", (method) => {
    for (const amount of ["0,00", ""]) {
      const s = parse([buy(), sell("0,00", amount)]);
      expect(msg(s, "parser.corporate_action_not_applied"), amount).toBe("Apple (US0378331005) 20250903 [price 0,00: -10]");
      const r = report([buy(), sell("0,00", amount)], method);
      expect(r.capitalGains.transmissionValue.toFixed(2), amount).toBe("0.00");
      expect(r.capitalGains.netGainLoss.toFixed(2), amount).toBe("0.00");
    }
  });
});

describe("Scalable corporate action with a written 0 share count and money: kept and named", () => {
  const action = (amount: string) =>
    `2025-05-01;10:00;Executed;X1;Apple;Security;Corporate action;US0378331005;0;;${amount};0;0;USD`;

  it.each(METHODS)("[%s] a cash merger of 1000,00 is named as not applied, so the payout is not lost with no word", (method) => {
    for (const amount of ["1000,00", "abc", "€"]) {
      const s = parse([buy(), action(amount)]);
      expect(msg(s, "parser.corporate_action_not_applied"), amount).toBe("Apple (US0378331005) 20250501 [Corporate action: 0]");
      const r = report([buy(), action(amount)], method);
      expect(r.messages.map((m) => m.id), amount).toContain("parser.corporate_action_not_applied");
      expect(r.capitalGains.netGainLoss.toFixed(2), amount).toBe("0.00");
    }
  });

  it("control: a written zero or an empty amount stays skipped", () => {
    for (const amount of ["0,00", "0", ""]) {
      const s = parse([buy(), action(amount)]);
      expect(s.trades.length, amount).toBe(1);
      expect(s.parserMessages, amount).toBeUndefined();
    }
  });
});

describe("Scalable reversed Distribution: its tax is a refund, never a second withholding", () => {
  const ES = "ES0113900J37";
  const US = "US0378331005";
  const div = (amount: string, tax: string, date: string, isin = ES) =>
    `${date};10:00;Executed;D${date};Banco;Security;Distribution;${isin};0;0;${amount};0;${tax};EUR`;
  const sums = (r: TaxReport): string =>
    `div=${r.dividends.grossIncome.toFixed(2)} sw=${r.dividends.spanishWithholding.toFixed(2)} dtd=${r.doubleTaxation.deduction.toFixed(2)}`;

  it.each(METHODS)("[%s] control: one Spanish dividend of 100 with 19 withheld", (method) => {
    expect(sums(report([div("100,00", "-19,00", "2025-06-01")], method))).toBe("div=100.00 sw=19.00 dtd=0.00");
  });

  it.each(METHODS)("[%s] a Spanish dividend reversed and paid again keeps one withholding of 19 in 0597", (method) => {
    const rows = [div("100,00", "-19,00", "2025-06-01"), div("-100,00", "19,00", "2025-06-10"), div("100,00", "-19,00", "2025-06-11")];
    expect(parse(rows).cashTransactions.map((c) => `${c.type} ${c.amount}`)).toEqual([
      "Dividends 100", "Withholding Tax -19", "Dividends -100", "Withholding Tax 19", "Dividends 100", "Withholding Tax -19",
    ]);
    expect(sums(report(rows, method))).toBe("div=100.00 sw=19.00 dtd=0.00");
  });

  it.each(METHODS)("[%s] a full reversal refunds its tax, written positive or negative: 0597 is 0", (method) => {
    for (const tax of ["19,00", "-19,00"]) {
      const rows = [div("100,00", "-19,00", "2025-06-01"), div("-100,00", tax, "2025-06-05")];
      expect(parse(rows).cashTransactions.map((c) => `${c.type} ${c.amount}`), tax).toEqual([
        "Dividends 100", "Withholding Tax -19", "Dividends -100", "Withholding Tax 19",
      ]);
      expect(sums(report(rows, method)), tax).toBe("div=0.00 sw=0.00 dtd=0.00");
    }
  });

  it.each(METHODS)("[%s] a reversal whose tax cannot be read is not booked and is named, so the dividend keeps its income", (method) => {
    for (const tax of ["abc", "€", "19,00 EUR"]) {
      const rows = [div("100,00", "-19,00", "2025-06-01"), div("-100,00", tax, "2025-06-10")];
      const s = parse(rows);
      expect(s.cashTransactions.map((c) => `${c.type} ${c.amount}`), tax).toEqual(["Dividends 100", "Withholding Tax -19"]);
      expect(msg(s, "scalable.income_row_not_read"), tax).toBe(`Distribution Banco (${ES}) -100 EUR 20250610 [tax: ${JSON.stringify(tax)}]`);
      const r = report(rows, method);
      expect(sums(r), tax).toBe("div=100.00 sw=19.00 dtd=0.00");
      expect(r.messages.map((m) => m.id), tax).toContain("scalable.income_row_not_read");
    }
  });

  it.each(METHODS)("[%s] a dividend whose tax cannot be read is booked in full with no withholding", (method) => {
    const rows = [div("100,00", "abc", "2025-06-01")];
    expect(parse(rows).parserMessages).toBeUndefined();
    expect(sums(report(rows, method))).toBe("div=100.00 sw=0.00 dtd=0.00");
  });

  it.each(METHODS)("[%s] a foreign dividend reversed and paid again keeps one withholding of 15 in 0588", (method) => {
    const rows = [div("100,00", "-15,00", "2025-06-01", US), div("-100,00", "15,00", "2025-06-10", US), div("100,00", "-15,00", "2025-06-11", US)];
    expect(parse(rows).cashTransactions.filter((c) => c.type === "Withholding Tax").map((c) => c.amount)).toEqual(["-15", "15", "-15"]);
    expect(sums(report(rows, method))).toBe("div=100.00 sw=0.00 dtd=15.00");
  });
});
