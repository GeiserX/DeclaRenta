/**
 * Binance rows the parser read wrong (#467). Every case runs a real CSV
 * through the real parser and generateTaxReport, in the three FX methods,
 * next to a readable control.
 *
 * - A Trade History cell of a coin whose ticker starts with a digit (1INCH,
 *   1000SATS) glued the coin's digits onto the number: "1001INCH" (100 units)
 *   was read as 1001, so FIFO took the wrong share of each lot.
 */
import Decimal from "decimal.js";
import { describe, it, expect } from "vitest";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { binanceParser } from "../../src/parsers/binance.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { FxMethod, TaxMessage, TaxSummary as TaxReport } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Statement } from "../../src/types/broker.js";

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];
const TH = "Date(UTC),Pair,Side,Price,Executed,Amount,Fee";
const TH_ES = "Tiempo,Par,Lado,Precio,Ejecutado,Cantidad,Tarifa";

function rates(): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86_400_000) {
    map.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "1.10"], ["USDT", "1.10"], ["TRY", "35"]]));
  }
  return map;
}

const parse = (header: string, rows: string[]): Statement => binanceParser.parse([header, ...rows].join("\n"));

function report(s: Statement, method: FxMethod): TaxReport {
  const merged = mergeStatement(createEmptyStatement(), s, "Binance");
  return generateTaxReport(finalizeMergedStatement(merged), rates(), 2025, reportOptionsForMethod(method));
}

const message = (messages: readonly TaxMessage[] | undefined, id: string): TaxMessage | undefined => messages?.find((m) => m.id === id);
const quantities = (s: Statement, coin: string): string[] => s.trades.filter((t) => t.symbol === coin).map((t) => t.quantity);
const disposals = (r: TaxReport, coin: string): string[] => r.capitalGains.disposals
  .filter((d) => d.symbol === coin)
  .map((d) => `${new Decimal(d.quantity).toString()} p${new Decimal(d.proceedsEur).toFixed(2)} c${new Decimal(d.costBasisEur).toFixed(2)} g${new Decimal(d.gainLossEur).toFixed(2)}`);
const net = (r: TaxReport): string => r.capitalGains.netGainLoss.toFixed(2);

describe("#467 Binance Trade History: a coin whose ticker starts with a digit is read after its number", () => {
  // 1INCH bought 100.5 for 50.25 USDT and 100 for 50 USDT, then 100 sold for
  // 100 USDT: the sale costs 50.25 × 100 / 100.5 = 50 USDT (55 €) and brings
  // 110 €, a 55 € gain.
  const inch = (buy1: string, buy2: string, sell: string): Statement => parse(TH_ES, [
    `25-01-10 10:00:00,1INCHUSDT,BUY,0.5,${buy1},50.25USDT,0USDT`,
    `25-02-10 10:00:00,1INCHUSDT,BUY,0.5,${buy2},50USDT,0USDT`,
    `25-06-10 10:00:00,1INCHUSDT,SELL,1,${sell},100USDT,0USDT`,
  ]);
  const control = inch("100.5", "100", "100");
  const suffixed = inch("100.51INCH", "1001INCH", "1001INCH");

  it.each(METHODS)("[%s] control: plain numbers give a 55 € gain on 1INCH", (method) => {
    const r = report(control, method);
    expect(quantities(control, "1INCH")).toEqual(["100.5", "100", "-100"]);
    expect(disposals(r, "1INCH")).toEqual(["100 p110.00 c55.00 g55.00"]);
    expect(net(r)).toBe("165.28");
  });

  it.each(METHODS)("[%s] \"1001INCH\" is 100 units of 1INCH, booked as the control", (method) => {
    expect(quantities(suffixed, "1INCH")).toEqual(["100.5", "100", "-100"]);
    expect(suffixed.parserMessages ?? []).toEqual([]);
    const r = report(suffixed, method);
    expect(disposals(r, "1INCH")).toEqual(disposals(report(control, method), "1INCH"));
    expect(net(r)).toBe(net(report(control, method)));
  });

  it.each(METHODS)("[%s] a 1INCH sale for BTC reads 100 units, not 1001", (method) => {
    const s = parse(TH_ES, [
      "25-01-10 10:00:00,1INCHUSDT,BUY,0.5,100.51INCH,50.25USDT,0USDT",
      "25-06-10 10:00:00,1INCHBTC,SELL,0.00001,1001INCH,0.001BTC,0.0011INCH",
    ]);
    expect(quantities(s, "1INCH")).toEqual(["100.5", "-100"]);
    const sale = s.trades.find((t) => t.symbol === "1INCH" && t.buySell === "SELL")!;
    expect([sale.commission, sale.commissionCurrency]).toEqual(["-0.001", "1INCH"]);
    const r = report(s, method);
    expect(r.messages.filter((m) => m.id === "fifo.sell_without_lots").map((m) => m.context?.symbol)).toEqual(["USDT"]);
  });

  // 1000SATS bought 5000 for 50 TRY and 2500.5 sold for 30.006 TRY. The
  // gain is right either way (FIFO uses Price × Executed), but the holding
  // left at the year end (720, 721, D-6) was 10 000 times too high.
  const sats = (buy: string, sell: string): Statement => parse(TH, [
    `2025-01-10 10:00:00,1000SATSTRY,BUY,0.01,${buy},50TRY,0TRY`,
    `2025-06-10 10:00:00,1000SATSTRY,SELL,0.012,${sell},30.006TRY,0TRY`,
  ]);
  it.each(METHODS)("[%s] \"50001000SATS\" is 5000 units of 1000SATS, booked as the control", (method) => {
    const s = sats("50001000SATS", "2500.51000SATS");
    const c = sats("5000", "2500.5");
    expect(quantities(s, "1000SATS")).toEqual(["5000", "-2500.5"]);
    expect(quantities(c, "1000SATS")).toEqual(["5000", "-2500.5"]);
    expect(disposals(report(s, method), "1000SATS")).toEqual(disposals(report(c, method), "1000SATS"));
    expect(disposals(report(c, method), "1000SATS")).toEqual(["2500.5 p1050.21 c875.18 g175.04"]);
  });

  // A cell whose coin is not the one the pair names for it cannot be read:
  // "0.1ETH" in the Executed of BTCEUR may be any amount of BTC.
  const btc = (executed: string, amount = "9000EUR"): Statement => parse(TH, [
    "2024-01-15 10:30:00,BTCEUR,BUY,30000,0.1BTC,3000EUR,0EUR",
    `2025-03-01 10:00:00,BTCEUR,SELL,90000,${executed},${amount},0EUR`,
  ]);
  it.each(METHODS)("[%s] control: \"0.1BTC\" in a BTCEUR sale gives a 6000 € gain", (method) => {
    const s = btc("0.1BTC");
    expect(s.parserMessages ?? []).toEqual([]);
    expect(net(report(s, method))).toBe("6000.00");
  });
  it.each(METHODS)("[%s] \"0.1ETH\" in a BTCEUR sale is an unreadable row, named, never read as 0.1 BTC", (method) => {
    const s = btc("0.1ETH");
    expect(message(s.parserMessages, "parser.trade_row_unreadable")?.context?.rows).toBe('BTC 20250301 [Executed: "0.1ETH"]');
    const r = report(s, method);
    expect(r.capitalGains.disposals).toEqual([]);
    expect(message(r.messages, "parser.trade_row_unreadable")?.context?.rows).toBe('BTC 20250301 [Executed: "0.1ETH"]');
  });
  it("an Amount in another coin than the quote of a crypto pair is an unreadable row", () => {
    const s = parse(TH, ["2025-03-01 10:00:00,ETHBTC,SELL,0.05,1ETH,0.05ETH,0BTC"]);
    expect(message(s.parserMessages, "parser.trade_row_unreadable")?.context?.rows).toBe('ETH 20250301 [Amount: "0.05ETH"]; BTC 20250301 [Amount: "0.05ETH"]');
  });
  it("a coin that ends in a digit is read: \"100USD1\" is 100 USD1", () => {
    const s = parse(TH, ["2025-03-01 10:00:00,BTCUSD1,BUY,100000,0.001BTC,100USD1,0USD1"]);
    expect(s.parserMessages ?? []).toEqual([]);
    expect(s.trades.map((t) => `${t.buySell} ${t.symbol} ${t.quantity}`)).toEqual(["SELL USD1 -100", "BUY BTC 0.001"]);
  });
});
