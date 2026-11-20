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
 * - A row whose status was not executed, cancelled or the like ("Settled")
 *   was dropped with no word, even a sale or a dividend.
 * - A Distribution with a written 0 amount and a tax booked a 0 dividend that
 *   took its own tax, so the tax raised the 0588 of the country's other dividends.
 * - A reversed Distribution whose tax cell was empty or missing was booked
 *   with no refund, so the reversed dividend kept its whole withholding.
 * - A status that named an execution and a cancelled rest dropped the row
 *   with no word.
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

describe("Scalable status: a row of a status that is not known is never dropped with no word", () => {
  const withStatus = (row: string, status: string) => row.replace(";Executed;", `;${status};`);
  const dividend = "2025-06-01;10:00;Executed;D1;Apple;Security;Distribution;US0378331005;0;0;100,00;0;-15,00;USD";
  const interest = "2025-06-30;10:00;Executed;I1;Zinsen;Cash;Interest;;0;0;12,34;0;0;EUR";

  it.each(METHODS)("[%s] control: an executed sale, in any spelling, gives a 550 € gain", (method) => {
    for (const status of ["Executed", "EXECUTED", "ausgeführt", "Ausgeführt", "Ejecutada", "Ejecutado", ""]) {
      const r = report([buy(), withStatus(sell(), status)], method);
      expect(r.capitalGains.transmissionValue.toFixed(2), status).toBe("1650.00");
      expect(r.capitalGains.netGainLoss.toFixed(2), status).toBe("550.00");
      expect(parse([buy(), withStatus(sell(), status)]).parserMessages, status).toBeUndefined();
    }
  });

  it.each(METHODS)("[%s] a cancelled, rejected, pending or expired row stays skipped with no word", (method) => {
    for (const status of ["Cancelled", "Rejected", "Pending", "Expired", "Failed", "Storniert", "Abgelehnt", "Ausstehend", "Cancelada", "Rechazada", "Pendiente", "Anulada"]) {
      const rows = [buy(), withStatus(sell(), status), withStatus(dividend, status), withStatus(interest, status)];
      expect(parse(rows).parserMessages, status).toBeUndefined();
      const r = report(rows, method);
      expect(r.capitalGains.transmissionValue.toFixed(2), status).toBe("0.00");
      expect(r.dividends.grossIncome.toFixed(2), status).toBe("0.00");
      expect(r.interest.earned.toFixed(2), status).toBe("0.00");
    }
  });

  it.each(METHODS)("[%s] a sale of another status is an unreadable row named by its status", (method) => {
    for (const status of ["Settled", "Completed", "Done", "Booked"]) {
      const s = parse([buy(), withStatus(sell(), status)]);
      expect(msg(s, "parser.trade_row_unreadable"), status).toBe(`Apple (US0378331005) 20250903 [status: ${JSON.stringify(status)}]`);
      const r = report([buy(), withStatus(sell(), status)], method);
      expect(r.capitalGains.transmissionValue.toFixed(2), status).toBe("0.00");
      expect(r.messages.map((m) => m.id), status).toContain("parser.trade_row_unreadable");
    }
    const b = parse([withStatus(buy(), "Settled"), sell()]);
    expect(msg(b, "parser.trade_row_unreadable")).toBe('Apple (US0378331005) 20250203 [status: "Settled"]');
  });

  it.each(METHODS)("[%s] a dividend or interest of another status is not booked and is named", (method) => {
    const rows = [withStatus(dividend, "Settled"), withStatus(interest, "Gutgeschrieben")];
    const s = parse(rows);
    expect(s.cashTransactions).toEqual([]);
    expect(msg(s, "scalable.income_row_not_read")).toBe(
      'Distribution Apple (US0378331005) USD 20250601 (tax -15) [status: "Settled"]; Interest Zinsen EUR 20250630 [status: "Gutgeschrieben"]');
    const r = report(rows, method);
    expect(r.dividends.grossIncome.toFixed(2)).toBe("0.00");
    expect(r.interest.earned.toFixed(2)).toBe("0.00");
    expect(r.messages.map((m) => m.id)).toContain("scalable.income_row_not_read");
  });

  it("a cash row of another status that moves no shares and names no income stays skipped", () => {
    const deposit = "2025-01-10;10:00;Settled;T1;Deposit;Cash;Deposit;;;;1000,00;0;0;EUR";
    expect(parse([buy(), deposit]).parserMessages).toBeUndefined();
  });
});

describe("Scalable round 3: rows booked against what the file says", () => {
  const MSFT = "US5949181045";
  const GOOG = "US02079K3059";
  const ES = "ES0113900J37";
  const dist = (isin: string, amount: string, tax: string, date: string, name = "Div") =>
    `${date};10:00;Executed;D${date}${isin};${name};Security;Distribution;${isin};0;0;${amount};0;${tax};EUR`;
  const sums = (r: TaxReport): string =>
    `div=${r.dividends.grossIncome.toFixed(2)} sw=${r.dividends.spanishWithholding.toFixed(2)} dtd=${r.doubleTaxation.deduction.toFixed(2)}`;
  const cash = (s: Statement): string[] => s.cashTransactions.map((c) => `${c.type} ${c.isin} ${c.amount}`);

  it.each(METHODS)("[%s] control: one US dividend of 100 with 10 withheld gives a 0588 of 10", (method) => {
    expect(sums(report([dist(MSFT, "100,00", "-10,00", "2025-06-01")], method))).toBe("div=100.00 sw=0.00 dtd=10.00");
  });

  it.each(METHODS)("[%s] a Distribution of 0 with a tax books only the tax, which never pairs with itself", (method) => {
    for (const date of ["2025-06-01", "2025-08-01"]) {
      const rows = [dist(MSFT, "100,00", "-10,00", "2025-06-01"), dist(GOOG, "0", "-3,00", date)];
      expect(cash(parse(rows)), date).toEqual([`Dividends ${MSFT} 100`, `Withholding Tax ${MSFT} -10`, `Withholding Tax ${GOOG} -3`]);
      expect(sums(report(rows, method)), date).toBe("div=100.00 sw=0.00 dtd=10.00");
    }
    // A Spanish tax with no dividend of its ISIN in reach is left out too.
    expect(sums(report([dist(ES, "0,00", "-19,00", "2025-06-01")], method))).toBe("div=0.00 sw=0.00 dtd=0.00");
  });

  it("a written zero Distribution with no tax still books its zero, as the file says", () => {
    expect(cash(parse([dist(GOOG, "0", "0", "2025-06-01")]))).toEqual([`Dividends ${GOOG} 0`]);
  });

  it.each(METHODS)("[%s] a reversal whose tax cell is empty, blank or missing is not booked and is named", (method) => {
    const reversals: [string, string][] = [
      [dist(ES, "-100,00", "", "2025-06-05"), '""'],
      [dist(ES, "-100,00", "   ", "2025-06-05"), '""'],
      ["2025-06-05;10:00;Executed;R1;Div;Security;Distribution;ES0113900J37;0;0;-100,00;0", "—"],
    ];
    for (const [row, shown] of reversals) {
      const rows = [dist(ES, "100,00", "-19,00", "2025-06-01"), row];
      const s = parse(rows);
      expect(cash(s), row).toEqual([`Dividends ${ES} 100`, `Withholding Tax ${ES} -19`]);
      expect(msg(s, "scalable.income_row_not_read"), row).toBe(`Distribution Div (${ES}) -100 EUR 20250605 [tax: ${shown}]`);
      const r = report(rows, method);
      expect(sums(r), row).toBe("div=100.00 sw=19.00 dtd=0.00");
      expect(r.messages.map((m) => m.id), row).toContain("scalable.income_row_not_read");
    }
    // Control: a written 0 is the file's word, and the reversal is booked.
    const zero = [dist(ES, "100,00", "-19,00", "2025-06-01"), dist(ES, "-100,00", "0", "2025-06-05")];
    expect(cash(parse(zero))).toEqual([`Dividends ${ES} 100`, `Withholding Tax ${ES} -19`, `Dividends ${ES} -100`]);
    expect(parse(zero).parserMessages).toBeUndefined();
  });

  it.each(METHODS)("[%s] a file with no tax column still books a reversal", (method) => {
    const header = "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;currency";
    const rows = [
      "2025-06-01;10:00;Executed;D1;Div;Security;Distribution;ES0113900J37;0;0;100,00;0;EUR",
      "2025-06-05;10:00;Executed;D2;Div;Security;Distribution;ES0113900J37;0;0;-100,00;0;EUR",
    ];
    expect(parse(rows, header).parserMessages).toBeUndefined();
    expect(sums(report(rows, method, header))).toBe("div=0.00 sw=0.00 dtd=0.00");
  });

  it.each(METHODS)("[%s] a status that names an execution and a cancelled rest is named, never dropped", (method) => {
    const withStatus = (row: string, status: string) => row.replace(";Executed;", `;${status};`);
    const dividend = dist(MSFT, "100,00", "-15,00", "2025-06-01", "Microsoft");
    for (const status of ["Partially cancelled", "Teilweise ausgeführt, Rest storniert", "Executed, remainder cancelled", "Parcialmente cancelada"]) {
      const s = parse([buy(), withStatus(sell(), status), withStatus(dividend, status)]);
      expect(msg(s, "parser.trade_row_unreadable"), status).toBe(`Apple (US0378331005) 20250903 [status: ${JSON.stringify(status)}]`);
      expect(msg(s, "scalable.income_row_not_read"), status).toBe(
        `Distribution Microsoft (${MSFT}) EUR 20250601 (tax -15) [status: ${JSON.stringify(status)}]`);
      const r = report([buy(), withStatus(sell(), status), withStatus(dividend, status)], method);
      expect(r.capitalGains.transmissionValue.toFixed(2), status).toBe("0.00");
      expect(r.dividends.grossIncome.toFixed(2), status).toBe("0.00");
      expect(r.messages.map((m) => m.id), status).toContain("parser.trade_row_unreadable");
      expect(r.messages.map((m) => m.id), status).toContain("scalable.income_row_not_read");
    }
    // Control: a status that names no execution stays skipped with no word.
    for (const status of ["Cancelled", "Storniert", "Suspended"]) {
      expect(parse([buy(), withStatus(sell(), status), withStatus(dividend, status)]).parserMessages, status).toBeUndefined();
    }
  });
});
