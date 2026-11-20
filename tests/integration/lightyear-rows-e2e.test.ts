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
 * - A tax-only dividend row (zero Gross) became a 0 dividend that anchored its
 *   tax, so the tax counted against other dividends of the country.
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

// Acquire 100 USD on 10/02 and give them back for 80 € on 10/09.
const FX_DISPOSE = [
  "10/09/2025 09:00:00,CN-3,USD,,Conversion,,USD,,-100.00,,,-100.00,",
  "10/09/2025 09:00:00,CN-4,EUR,,Conversion,,EUR,,80.00,,0.00,80.00,",
];

describe("Lightyear conversions: the EUR principal and the fee pair only one EUR leg with one other leg", () => {
  const sameSecond = (firstEurNet: string) => [
    "10/02/2025 09:00:00,CN-1,USD,,Conversion,,USD,,100.00,,,100.00,",
    `10/02/2025 09:00:00,CN-2,EUR,,Conversion,,EUR,,-95.00,,,${firstEurNet},`,
    "10/02/2025 09:00:00,CN-5,GBP,,Conversion,,GBP,,50.00,,,50.00,",
    "10/02/2025 09:00:00,CN-6,EUR,,Conversion,,EUR,,-60.00,,,-60.00,",
    ...FX_DISPOSE,
  ];

  it.each(METHODS)("[%s] an unreadable EUR leg in a second with two conversions leaves both at the ECB rate", (method) => {
    const s = parse(sameSecond("n/a"));
    for (const id of ["lightyear-fx-CN-1", "lightyear-fx-CN-5"]) {
      expect(s.trades.find((t) => t.tradeID === id)!.realEurAmount).toBeUndefined();
    }
    const control = report(sameSecond("-95.00"), method).fxGains;
    const r = report(sameSecond("n/a"), method).fxGains;
    expect(r.netGainLoss.toString()).toBe(control.netGainLoss.toString());
    expect(r.netGainLoss.toString()).toBe(method === "monodivisa" ? "0" : "-10");
  });

  const fcyInEurSecond = (usdGbpTime: string) => [
    "01/02/2025 09:00:00,CN-9,USD,,Conversion,,USD,,500.00,,,500.00,",
    "01/02/2025 09:00:00,CN-10,EUR,,Conversion,,EUR,,-450.00,,,-450.00,",
    "10/02/2025 09:00:00,CN-1,GBP,,Conversion,,GBP,,10.00,,,10.00,",
    "10/02/2025 09:00:00,CN-2,EUR,,Conversion,,EUR,,-12.00,,,-12.00,",
    `${usdGbpTime},CN-7,USD,,Conversion,,USD,,-500.00,,,-500.00,`,
    `${usdGbpTime},CN-8,GBP,,Conversion,,GBP,,400.00,,,400.00,`,
  ];

  it.each(METHODS)("[%s] a USD→GBP conversion in the same second as an EUR→GBP one never takes its 12 € principal", (method) => {
    const s = parse(fcyInEurSecond("10/02/2025 09:00:00"));
    expect(s.trades.find((t) => t.tradeID === "lightyear-fx-CN-7")!.realEurAmount).toBeUndefined();
    const control = report(fcyInEurSecond("10/02/2025 09:00:01"), method).fxGains;
    const r = report(fcyInEurSecond("10/02/2025 09:00:00"), method).fxGains;
    expect(r.transmissionValue.toString()).toBe(control.transmissionValue.toString());
    expect(r.netGainLoss.toString()).toBe("0");
  });

  it("a single conversion keeps its EUR principal and its fee", () => {
    const s = parse([
      "10/02/2025 09:00:00,CN-1,USD,,Conversion,,USD,,100.00,,,100.00,",
      "10/02/2025 09:00:00,CN-2,EUR,,Conversion,,EUR,,-95.50,,0.50,-95.00,",
    ]);
    expect(s.trades[0]!.realEurAmount).toBe("95");
    expect(s.trades[0]!.commission).toBe("-0.5");
    expect(s.trades[0]!.commissionCurrency).toBe("EUR");
  });

  it.each(METHODS)("[%s] two conversions in one second never both take the larger fee", (method) => {
    const rows = (gbpTime: string) => [
      "10/02/2025 09:00:00,CN-1,USD,,Conversion,,USD,,100.00,,,100.00,",
      "10/02/2025 09:00:00,CN-2,EUR,,Conversion,,EUR,,-95.50,,0.50,-95.00,",
      `${gbpTime},CN-5,GBP,,Conversion,,GBP,,50.00,,,50.00,`,
      `${gbpTime},CN-6,EUR,,Conversion,,EUR,,-60.20,,0.20,-60.00,`,
    ];
    const fees = parse(rows("10/02/2025 09:00:00")).trades.map((t) => t.commission);
    expect(fees).toEqual(["-0", "-0"]);
    expect(parse(rows("10/02/2025 09:00:01")).trades.map((t) => t.commission)).toEqual(["-0.5", "-0.2"]);
    // Both currencies given back later: ECB values (90 € + 60 €) with no fee,
    // never the 151 € of the 0.50 fee counted twice.
    const sold = [...rows("10/02/2025 09:00:00"), ...FX_DISPOSE, "11/09/2025 09:00:00,CN-11,GBP,,Conversion,,GBP,,-50.00,,,-50.00,"];
    expect(report(sold, method).fxGains.acquisitionValue.toString()).toBe(method === "monodivisa" ? "0" : "150");
  });
});

describe("Lightyear conversions: a leg with no readable amount or currency is named, never dropped or a crash", () => {
  const FX_ACQUIRE = [
    "10/02/2025 09:00:00,CN-1,USD,,Conversion,,USD,,100.00,,,100.00,",
    "10/02/2025 09:00:00,CN-2,EUR,,Conversion,,EUR,,-95.00,,,-95.00,",
  ];
  const dispose = (usd: string) => [
    `10/09/2025 09:00:00,CN-3,USD,,Conversion,,USD,,${usd},,,${usd},`,
    "10/09/2025 09:00:00,CN-4,EUR,,Conversion,,EUR,,110.00,,0.00,110.00,",
  ];

  it.each(METHODS)("[%s] control: a readable dispose leg gives a 15 € FX gain", (method) => {
    expect(report([...FX_ACQUIRE, ...dispose("-100.00")], method).fxGains.netGainLoss.toString()).toBe(method === "monodivisa" ? "0" : "15");
  });

  it.each(METHODS)("[%s] a dispose leg whose Net and Gross cannot be read is named", (method) => {
    for (const usd of ["x", ""]) {
      const s = parse([...FX_ACQUIRE, ...dispose(usd)]);
      expect(unreadableRows(s), usd).toBe(`USD.EUR 20250910 [Net Amt.: ${JSON.stringify(usd)}, Gross Amount: ${JSON.stringify(usd)}]`);
      expect(s.trades.map((t) => t.tradeID)).toEqual(["lightyear-fx-CN-1"]);
      expect(() => report([...FX_ACQUIRE, ...dispose(usd)], method)).not.toThrow();
    }
  });

  it("a leg that writes a zero amount stays skipped with no word", () => {
    const s = parse([...FX_ACQUIRE, ...dispose("0.00")]);
    expect(s.trades.map((t) => t.tradeID)).toEqual(["lightyear-fx-CN-1"]);
    expect(s.parserMessages).toBeUndefined();
  });

  it.each(METHODS)("[%s] a leg with an empty CCY is named and never becomes a trade in currency \"\"", (method) => {
    for (const [leg, date] of [["CN-3", "20250910"], ["CN-1", "20250210"]] as const) {
      const rows = [...FX_ACQUIRE, ...dispose("-100.00")].map((r) => r.replace(`${leg},USD,,Conversion,,USD,`, `${leg},USD,,Conversion,,,`));
      const s = parse(rows);
      expect(s.trades.every((t) => t.currency !== "")).toBe(true);
      expect(unreadableRows(s)).toBe(`USD ${date} [CCY: ""]`);
      expect(() => report(rows, method)).not.toThrow();
    }
  });
});

describe("Lightyear Tax Amt.: a refund lowers the withholding, never raises it", () => {
  const DIV = "16/12/2025 06:02:35,DD-1,GOOG,US02079K1079,Dividend,,USD,,14.09,,,13.09,1.00";

  it.each(METHODS)("[%s] a 1.00 withholding and a 0.50 refund give the deduction of 0.50", (method) => {
    expect(report([DIV], method).doubleTaxation.deduction.toString()).toBe("0.9");
    const refund = "20/12/2025 06:02:35,DD-2,GOOG,US02079K1079,Dividend,,USD,,0.00,,,0.50,-0.50";
    expect(report([DIV, refund], method).doubleTaxation.deduction.toString()).toBe("0.45");
    expect(report([DIV.replace(",13.09,1.00", ",13.59,0.50")], method).doubleTaxation.deduction.toString()).toBe("0.45");
  });

  it("a withholding written negative with a Net that shows it was taken stays withholding", () => {
    const s = parse(["15/01/2025,REF001,VWRL,IE00B3RBWM25,Distribution,,USD,,10,1,0,8.50,-1.50"]);
    expect(s.cashTransactions.map((c) => `${c.type} ${c.amount}`)).toEqual(["Dividends 10", "Withholding Tax -1.5"]);
  });

  it.each(METHODS)("[%s] a negative Tax Amt. whose Fee cannot be read is a refund, as with the Fee written", (method) => {
    // MSFT 100 USD with 10 withheld, then a refund of 3 on a row with a fee of 5: 6.3 € of deduction.
    const DIV10 = "10/05/2025 06:00:00,DD-9,MSFT,US5949181045,Dividend,,USD,,100.00,,,90.00,10.00";
    const refund = (fee: string) => `12/05/2025 06:00:00,DD-11,MSFT,US5949181045,Dividend,,USD,,100.00,,${fee},98.00,-3.00`;
    expect(report([DIV10, refund("5.00")], method).doubleTaxation.deduction.toString()).toBe("6.3");
    for (const fee of ["n/a", "$", "-"]) {
      expect(report([DIV10, refund(fee)], method).doubleTaxation.deduction.toString(), fee).toBe("6.3");
    }
  });

  it("a negative Tax Amt. whose Net cannot be read lowers the withholding (the conservative reading)", () => {
    const s = parse(["15/01/2025,REF001,VWRL,IE00B3RBWM25,Distribution,,USD,,10,1,0,n/a,-1.50"]);
    expect(s.cashTransactions.map((c) => `${c.type} ${c.amount}`)).toEqual(["Dividends 10", "Withholding Tax 1.5"]);
  });
});

describe("Lightyear Tax Amt. on a dividend row with a zero Gross: a withholding with no dividend of its own", () => {
  // MSFT 100 USD with 10 withheld: at 0.9 €/USD the deduction is 9 €.
  const DIV10 = "10/05/2025 06:00:00,DD-9,MSFT,US5949181045,Dividend,,USD,,100.00,,,90.00,10.00";
  const taxOnly = (date: string, ticker = "MSFT,US5949181045") => `${date} 06:00:00,DD-10,${ticker},Dividend,,USD,,0.00,,,-3.00,3.00`;

  it.each(METHODS)("[%s] control: a tax-only row of the same security 2 days later joins that dividend", (method) => {
    expect(report([DIV10], method).doubleTaxation.deduction.toString()).toBe("9");
    expect(report([DIV10, taxOnly("12/05/2025")], method).doubleTaxation.deduction.toString()).toBe("11.7");
  });

  it.each(METHODS)("[%s] a tax-only row of another security, or out of the 7-day reach, never adds to another dividend's deduction", (method) => {
    for (const row of [taxOnly("12/05/2025", "GOOG,US02079K1079"), taxOnly("20/06/2025")]) {
      expect(report([DIV10, row], method).doubleTaxation.deduction.toString(), row).toBe("9");
    }
    const late = ["10/05/2024 06:00:00,DD-8,MSFT,US5949181045,Dividend,,USD,,100.00,,,90.00,10.00", DIV10, taxOnly("20/02/2025")];
    expect(report(late, method).doubleTaxation.deduction.toString()).toBe("9");
  });

  it("a zero Gross books no dividend: only the withholding, which the report matches like any other", () => {
    expect(parse([taxOnly("12/05/2025")]).cashTransactions.map((c) => `${c.type} ${c.amount}`)).toEqual(["Withholding Tax -3"]);
    expect(parse(["12/05/2025 06:00:00,DD-10,MSFT,US5949181045,Dividend,,USD,,0.00,,,0.00,0.00"]).cashTransactions).toEqual([]);
  });
});

describe("Lightyear: a row with an empty Type is named, never dropped with no word", () => {
  it("an empty Type with an amount, or with a security and no share count, is listed", () => {
    for (const row of [
      "01/05/2025 10:00:00,XX-9,,,,,EUR,,100.00,,,100.00,",
      "01/05/2025 10:00:00,XX-9,AAPL,US0378331005,,,USD,,100.00,,,100.00,",
    ]) {
      const s = parse([row]);
      expect(s.parserMessages?.find((m) => m.id === "lightyear.unknown_types")?.context?.types).toBe('Type: "" (1)');
    }
  });

  it.each(METHODS)("[%s] the listed row moves no number: the sale next to it keeps its 448.2 € gain", (method) => {
    const r = report([BUY, sell("150.00"), "01/05/2025 10:00:00,XX-9,,,,,EUR,,100.00,,,100.00,"], method);
    expect(r.capitalGains.netGainLoss.toString()).toBe("448.2");
    expect(r.messages.some((m) => m.id === "lightyear.unknown_types")).toBe(true);
  });

  it("an all-blank padding row stays skipped with no word", () => {
    expect(parse([BUY, ",,,,,,,,,,,,"]).parserMessages).toBeUndefined();
  });
});
