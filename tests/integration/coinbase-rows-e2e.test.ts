/**
 * Coinbase rows the parser read wrong (#467). Every case runs a real CSV
 * through the real parser and generateTaxReport, in the three FX methods,
 * next to a readable control.
 *
 * - A negative income row (a reward taken back) was booked as negative
 *   income and cut casilla 0027 with no word.
 * - A V1 export (no ID column) gave each trade its line number as ID, so the
 *   same row in two overlapping exports got two IDs and the duplicate check
 *   never saw it: the loss was counted twice with no word.
 * - An income row with no Asset and a blank Total was named with an amount
 *   of 0, although its Subtotal was readable.
 */
import Decimal from "decimal.js";
import { describe, it, expect } from "vitest";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { coinbaseParser } from "../../src/parsers/coinbase.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import { validateStatement } from "../../src/web/validation.js";
import type { FxMethod, TaxMessage, TaxSummary as TaxReport } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Statement } from "../../src/types/broker.js";
import es from "../../src/i18n/locales/es.js";
import en from "../../src/i18n/locales/en.js";
import ca from "../../src/i18n/locales/ca.js";
import eu from "../../src/i18n/locales/eu.js";
import gl from "../../src/i18n/locales/gl.js";

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];
const H1 = "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";
const H3 = "ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";

function rates(): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86_400_000) {
    map.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "1.10"]]));
  }
  return map;
}

const parse = (header: string, ...rows: string[]): Statement => coinbaseParser.parse([header, ...rows].join("\n"));

function merged(...files: Statement[]): Statement {
  const statement = createEmptyStatement();
  for (const f of files) mergeStatement(statement, f, "Coinbase");
  return finalizeMergedStatement(statement);
}

const report = (s: Statement, method: FxMethod): TaxReport => generateTaxReport(s, rates(), 2024, reportOptionsForMethod(method));
const message = (messages: readonly TaxMessage[] | undefined, id: string): TaxMessage | undefined => messages?.find((m) => m.id === id);
const duplicates = (s: Statement): string | undefined => validateStatement(s, 2024, ["Coinbase"]).find((i) => /duplicad/.test(i.message))?.message;

describe("#467 Coinbase: a negative income row is named and books nothing, never cuts the year's income", () => {
  // 0.01 ETH of staking, 32 € (casilla 0027).
  const stake = "2024-03-15T10:00:00Z,Staking Income,ETH,0.01,EUR,3200.00,32.00,32.00,0.00,Staking";
  const named = (m: readonly TaxMessage[] | undefined): TaxMessage | undefined => message(m, "coinbase.income_negative");
  const interest = (r: TaxReport): string => new Decimal(r.interest.earned).toFixed(2);
  const general = (r: TaxReport): string => new Decimal(r.generalGains.total).toFixed(2);

  it.each(METHODS)("[%s] control: one staking row of 32 € is 32 € of income and nothing is named", (method) => {
    const parsed = parse(H1, stake);
    expect(named(parsed.parserMessages)).toBeUndefined();
    expect(interest(report(merged(parsed), method))).toBe("32.00");
  });

  const cases: [string, string, string][] = [
    ["a negative quantity and Total", "2024-04-15T10:00:00Z,Staking Income,ETH,-0.005,EUR,3200.00,-16.00,-16.00,0.00,Reversal", "Staking Income ETH -0.005 (-16.00 EUR) 20240415"],
    ["a Total in parentheses", "2024-04-15T10:00:00Z,Staking Income,ETH,0.005,EUR,3200.00,(16.00),(16.00),0.00,Reversal", "Staking Income ETH 0.005 (-16.00 EUR) 20240415"],
    ["a Rewards Income with a positive quantity and a negative Total", "2024-04-15T10:00:00Z,Rewards Income,ETH,0.005,EUR,3200.00,-16.00,-16.00,0.00,Reversal", "Rewards Income ETH 0.005 (-16.00 EUR) 20240415"],
    ["a blank Total and a negative Subtotal in dollars", "2024-04-15T10:00:00Z,Inflation Reward,ETH,-0.005,USD,3500.00,-17.60,,0.00,Reversal", "Inflation Reward ETH -0.005 (-17.60 USD) 20240415"],
  ];
  it.each(METHODS.flatMap((m) => cases.map((c) => [m, ...c] as const)))("[%s] a row with %s books nothing and is named", (method, _label, row, rows) => {
    const parsed = parse(H1, stake, row);
    expect(parsed.cashTransactions.map((c) => c.amount)).toEqual(["32.00"]);
    expect(named(parsed.parserMessages)?.context).toEqual({ count: "1", rows });
    const r = report(merged(parsed), method);
    expect(interest(r)).toBe("32.00");
    expect(named(r.messages)?.severity).toBe("warning");
  });

  it.each(METHODS)("[%s] a negative Learning Reward books nothing: the 10 € reward stays 10 €, not 10 + 5", (method) => {
    const learn = "2024-03-15T10:00:00Z,Learning Reward,XLM,100,EUR,0.1,10.00,10.00,0.00,Earn";
    expect(general(report(merged(parse(H1, learn)), method))).toBe("10.00");
    const parsed = parse(H1, learn, "2024-04-15T10:00:00Z,Learning Reward,XLM,-50,EUR,0.1,-5.00,-5.00,0.00,Reversal");
    expect(named(parsed.parserMessages)?.context).toEqual({ count: "1", rows: "Learning Reward XLM -50 (-5.00 EUR) 20240415" });
    expect(general(report(merged(parsed), method))).toBe("10.00");
  });

  it("a negative Rewards Income alone is no income to classify", () => {
    const parsed = parse(H1, "2024-04-15T10:00:00Z,Rewards Income,ETH,0.005,EUR,3200.00,-16.00,-16.00,0.00,Reversal");
    expect(message(parsed.parserMessages, "coinbase.rewards_income_classification")).toBeUndefined();
    expect(named(parsed.parserMessages)?.context?.count).toBe("1");
  });

  it("a written zero Total stays the file's word: booked as 0, nothing named", () => {
    for (const total of ["0.00", "-0.00"]) {
      const parsed = parse(H1, `2024-04-15T10:00:00Z,Staking Income,ETH,0.005,EUR,3200.00,0.00,${total},0.00,`);
      expect([parsed.cashTransactions.map((c) => c.amount), named(parsed.parserMessages)]).toEqual([[total], undefined]);
    }
  });

  it("the warning is the es locale and exists in the five locales", () => {
    const m = named(parse(H1, "2024-04-15T10:00:00Z,Staking Income,ETH,-0.005,EUR,3200.00,-16.00,-16.00,0.00,").parserMessages)!;
    const fill = (text: string): string => text.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => m.context?.[k] ?? "");
    expect(m.message).toBe(fill((es as Record<string, string>)["coinbase.income_negative"]!));
    expect(m.hint).toBe((es as Record<string, string>)["coinbase.income_negative.hint"]);
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
      expect(locale["coinbase.income_negative"]).toContain("{{rows}}");
      expect(locale["coinbase.income_negative.hint"]).toContain("Renta Web");
    }
  });
});

describe("#467 Coinbase V1 (no ID column): the same row in two overlapping exports gets the same ID", () => {
  // Buy 1 BTC at 40000 € and sell it at 30000 € in 2024: a 10200 € loss.
  const buy = "2024-01-10T10:00:00Z,Buy,BTC,1,EUR,40000.00,40000.00,40100.00,100.00,Bought";
  const sell = "2024-03-15T10:00:00Z,Sell,BTC,1,EUR,30000.00,30000.00,29900.00,100.00,Sold";
  const send = "2024-02-01T10:00:00Z,Send,ETH,1,EUR,2000,2000,2000,0,Sent";
  const net = (r: TaxReport): string => r.capitalGains.netGainLoss.toFixed(2);

  it.each(METHODS)("[%s] control: one export is a 10200 € loss and nothing is repeated", (method) => {
    const s = merged(parse(H1, buy, sell));
    expect(duplicates(s)).toBeUndefined();
    expect(net(report(s, method))).toBe("-10200.00");
  });

  it.each(METHODS)("[%s] a Q1 export and a full-year export with one more row first: both rows are flagged as repeated", (method) => {
    const q1 = parse(H1, buy, sell);
    const year = parse(H1, send, buy, sell);
    expect(year.trades.map((t) => t.tradeID)).toEqual(q1.trades.map((t) => t.tradeID));
    const s = merged(q1, year);
    expect(duplicates(s)).toContain("2 operación(es) duplicada(s)");
    // The duplicate check warns and drops nothing, as for V2/V3 exports.
    expect(net(report(s, method))).toBe("-20400.00");
  });

  it("mirror: the same overlap in a V3 export is flagged too", () => {
    const s = merged(parse(H3, `a1,${buy}`, `a2,${sell}`), parse(H3, `a0,${send}`, `a1,${buy}`, `a2,${sell}`));
    expect(duplicates(s)).toContain("2 operación(es) duplicada(s)");
  });

  it("the same V1 file twice is still flagged", () => {
    expect(duplicates(merged(parse(H1, buy, sell), parse(H1, buy, sell)))).toContain("2 operación(es) duplicada(s)");
  });

  it("two identical fills in one V1 file are two trades with two IDs, and nothing is flagged", () => {
    const s = merged(parse(H1, buy, buy, sell));
    expect(new Set(s.trades.map((t) => t.tradeID)).size).toBe(3);
    expect(duplicates(s)).toBeUndefined();
  });

  it("two different same-day buys at the same line of two V1 files are not flagged", () => {
    const other = "2024-01-10T15:00:00Z,Buy,BTC,0.5,EUR,41000.00,20500.00,20550.00,50.00,Bought";
    expect(duplicates(merged(parse(H1, buy), parse(H1, other)))).toBeUndefined();
  });

  it("a reward in two overlapping V1 files gets the same ID, and a Convert's two legs keep two IDs", () => {
    const stake = "2024-03-15T10:00:00Z,Staking Income,ETH,0.01,EUR,3200.00,32.00,32.00,0.00,Staking";
    const ids = [parse(H1, stake), parse(H1, send, stake)].map((s) => s.cashTransactions[0]!.transactionID);
    expect(ids[0]).toBe(ids[1]);
    const convert = parse(H1, "2024-03-15T10:00:00Z,Convert,BTC,0.1,EUR,30000,3000,3000,0,Converted 0.1 BTC to 1 ETH");
    expect(new Set(convert.trades.map((t) => t.tradeID)).size).toBe(2);
  });
});

describe("#467 Coinbase: income with no Asset is named with its readable amount, never 0", () => {
  const unidentified = (r: TaxReport): string | undefined => message(r.messages, "parser.crypto_income_unidentified")?.context?.rows;
  const cases: [string, string, string, string][] = [
    ["control: a readable Total", "32.00", "32.00", 'Staking Income 0.01 (32.00 EUR) 20240315 [Asset: ""]'],
    ["a blank Total and a readable Subtotal", "32.00", "", 'Staking Income 0.01 (32.00 EUR) 20240315 [Asset: ""]'],
    ["a Total of 'abc' and a readable Subtotal", "32.00", "abc", 'Staking Income 0.01 (32.00 EUR) 20240315 [Asset: ""]'],
    ["neither cell readable", "", "", 'Staking Income 0.01 (— EUR) 20240315 [Asset: ""]'],
    ["a written zero Total", "32.00", "0.00", 'Staking Income 0.01 (0.00 EUR) 20240315 [Asset: ""]'],
  ];
  it.each(METHODS.flatMap((m) => cases.map((c) => [m, ...c] as const)))("[%s] %s", (method, _label, subtotal, total, rows) => {
    const parsed = parse(H1, `2024-03-15T10:00:00Z,Staking Income,,0.01,EUR,3200.00,${subtotal},${total},0.00,`);
    expect(parsed.cashTransactions).toEqual([]);
    const r = report(merged(parsed), method);
    expect(r.interest.entries).toEqual([]);
    expect(unidentified(r)).toBe(rows);
  });
});

describe("#467 Coinbase round 4: a V1 and a V3 export of the same trades are flagged as repeated", () => {
  // Buy 1 BTC at 40000 € and sell it at 30000 € in 2024: a 10200 € loss.
  const V1 = [
    "2024-01-10T10:00:00Z,Buy,BTC,1,EUR,40000.00,40000.00,40100.00,100.00,Bought",
    "2024-03-15T10:00:00Z,Sell,BTC,1,EUR,30000.00,30000.00,29900.00,100.00,Sold",
  ];
  const V3 = [
    "aaa111,2024-01-10 10:00:00 UTC,Buy,BTC,1,EUR,€40000.00,€40000.00,€40100.00,€100.00,Bought 1 BTC for €40100.00",
    "bbb222,2024-03-15 10:00:00 UTC,Sell,BTC,1,EUR,€30000.00,€30000.00,€29900.00,€100.00,Sold 1 BTC for €29900.00",
  ];
  const net = (r: TaxReport): string => r.capitalGains.netGainLoss.toFixed(2);

  it.each(METHODS)("[%s] control: either export alone is a 10200 € loss and nothing is repeated", (method) => {
    for (const s of [merged(parse(H1, ...V1)), merged(parse(H3, ...V3))]) {
      expect(duplicates(s)).toBeUndefined();
      expect(net(report(s, method))).toBe("-10200.00");
    }
  });

  it.each(METHODS)("[%s] both exports give each trade the same ID, so both trades are flagged as repeated", (method) => {
    const v1 = parse(H1, ...V1);
    const v3 = parse(H3, ...V3);
    expect(v3.trades.map((t) => t.tradeID)).toEqual(v1.trades.map((t) => t.tradeID));
    const s = merged(v1, v3);
    expect(duplicates(s)).toContain("2 operación(es) duplicada(s)");
    // The duplicate check warns and drops nothing, as for two V1 exports.
    expect(net(report(s, method))).toBe("-20400.00");
  });

  it("a V1 and a V3 export of different trades are not flagged", () => {
    const other = "ccc333,2024-01-10 10:00:00 UTC,Buy,BTC,1,EUR,€41000.00,€41000.00,€41100.00,€100.00,Bought";
    expect(duplicates(merged(parse(H1, V1[0]!), parse(H3, other)))).toBeUndefined();
  });

  it("two V3 fills with their own IDs and the same cells are two trades with two IDs, and nothing is flagged", () => {
    const s = merged(parse(H3, V3[0]!, V3[0]!.replace("aaa111", "aaa112"), V3[1]!));
    expect(new Set(s.trades.map((t) => t.tradeID)).size).toBe(3);
    expect(duplicates(s)).toBeUndefined();
  });
});
