/**
 * Coinbase rows the parser read wrong (#467). Every case runs a real CSV
 * through the real parser and generateTaxReport, in the three FX methods,
 * next to a readable control.
 *
 * - A negative income row (a reward taken back) was booked as negative
 *   income and cut casilla 0027 with no word.
 */
import Decimal from "decimal.js";
import { describe, it, expect } from "vitest";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { coinbaseParser } from "../../src/parsers/coinbase.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
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
