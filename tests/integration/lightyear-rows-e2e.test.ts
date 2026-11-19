/**
 * Lightyear rows that the parser could not read, or paired by a guess (#466,
 * #467, #468). Every case runs the real CSV through the real parser and
 * generateTaxReport, in the three FX methods, next to a readable control.
 *
 * - A Price/share cell that cannot be read crashed the report; an empty,
 *   missing or written-zero one sold the shares at 0 €, so a gain became a
 *   loss. The price is now |Gross Amount| ÷ Quantity, else the row is named.
 * - A conversion's EUR principal and fee were paired by timestamp only, so two
 *   conversions in one second took each other's EUR amount or fee.
 * - A conversion leg with no readable amount or currency was dropped with no
 *   word, or crashed the report.
 * - A negative Tax Amt. (a withholding refund) was booked as more withholding.
 * - A row with an empty Type was dropped with no word.
 */
import { describe, it, expect } from "vitest";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { lightyearParser } from "../../src/parsers/lightyear.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { FxMethod, TaxSummary as TaxReport } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Statement } from "../../src/types/broker.js";

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];
const H = "Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.";

function rates(): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86_400_000) {
    map.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "0.9"], ["GBP", "1.2"]]));
  }
  return map;
}

const parse = (rows: string[]): Statement => lightyearParser.parse([H, ...rows].join("\n"));

function report(rows: string[], method: FxMethod, year = 2025): TaxReport {
  const merged = mergeStatement(createEmptyStatement(), parse(rows), "Lightyear");
  return generateTaxReport(finalizeMergedStatement(merged), rates(), year, reportOptionsForMethod(method));
}

const unreadableRows = (s: Statement): string | undefined =>
  s.parserMessages?.find((m) => m.id === "parser.trade_row_unreadable")?.context?.rows;

// Buy 10 AAPL at 100 USD in 2024 (fee 1), sell them at 150 USD in 2025 (fee 1).
// At 0.9 €/USD: acquisition 900.9 €, transmission 1349.1 €, gain 448.2 €.
const BUY = "15/03/2024 10:30:00,OR-1,AAPL,US0378331005,Buy,10.000000000,USD,100.00,1000.00,,1.00,1001.00,";
const sell = (price: string, gross = "1500.00") =>
  `20/06/2025 14:22:11,OR-2,AAPL,US0378331005,Sell,10.000000000,USD,${price},${gross},,1.00,1499.00,`;

describe("Lightyear Price/share: a sale is never booked at 0 or from a raw string", () => {
  it.each(METHODS)("[%s] control: a readable price 150.00 gives a 448.2 € gain", (method) => {
    const r = report([BUY, sell("150.00")], method);
    expect(r.capitalGains.netGainLoss.toString()).toBe("448.2");
  });

  it.each(METHODS)("[%s] an unreadable, empty, currency-only or written-zero price is |Gross| ÷ Quantity", (method) => {
    for (const price of ["n/a", "-", "", "$", "0.00"]) {
      const r = report([BUY, sell(price)], method);
      expect(r.capitalGains.transmissionValue.toString(), price).toBe("1349.1");
      expect(r.capitalGains.netGainLoss.toString(), price).toBe("448.2");
    }
    const buyNa = report([BUY.replace(",100.00,", ",n/a,"), sell("150.00")], method);
    expect(buyNa.capitalGains.acquisitionValue.toString()).toBe("900.9");
    expect(buyNa.capitalGains.netGainLoss.toString()).toBe("448.2");
  });

  it("a readable price keeps the file's text", () => {
    expect(parse([sell("150.00")]).trades[0]!.tradePrice).toBe("150.00");
  });

  it.each(METHODS)("[%s] a written zero price with a zero Gross moves shares for no money: a corporate action not applied, never a sale at 0", (method) => {
    const s = parse([BUY, sell("0.00", "0.00")]);
    expect(s.parserMessages?.find((m) => m.id === "parser.corporate_action_not_applied")?.context?.rows)
      .toBe("AAPL (US0378331005) 20250620 [Price/share 0.00: 10.000000000]");
    const r = report([BUY, sell("0.00", "0.00")], method);
    expect(r.capitalGains.transmissionValue.toString()).toBe("0");
    expect(r.capitalGains.netGainLoss.toString()).toBe("0");
  });

  it.each(METHODS)("[%s] with neither Price/share nor Gross readable the sale is kept, books nothing and is named", (method) => {
    for (const [price, gross, cell] of [["n/a", "n/a", 'Price/share: "n/a"'], ["", "", 'Price/share: ""'], ["-", "0.00", 'Price/share: "-"'], ["-150.00", "", 'Price/share: "-150.00"']] as const) {
      const s = parse([BUY, sell(price, gross)]);
      expect(unreadableRows(s), price).toBe(`AAPL (US0378331005) 20250620 [${cell}]`);
      const r = report([BUY, sell(price, gross)], method);
      expect(r.capitalGains.transmissionValue.toString()).toBe("0");
    }
  });

  it.each(METHODS)("[%s] a sale row cut after Quantity, or with an empty CCY, is named by its CCY cell, never sold in EUR at 0", (method) => {
    const cut = "20/06/2025 14:22:11,OR-2,AAPL,US0378331005,Sell,10.000000000";
    expect(unreadableRows(parse([BUY, cut]))).toBe("AAPL (US0378331005) 20250620 [CCY: —]");
    expect(unreadableRows(parse([BUY, sell("150.00").replace(",USD,", ",,")]))).toBe('AAPL (US0378331005) 20250620 [CCY: ""]');
    for (const row of [cut, sell("150.00").replace(",USD,", ",,")]) {
      const r = report([BUY, row], method);
      expect(r.capitalGains.transmissionValue.toString()).toBe("0");
      expect(r.capitalGains.netGainLoss.toString()).toBe("0");
    }
  });
});
