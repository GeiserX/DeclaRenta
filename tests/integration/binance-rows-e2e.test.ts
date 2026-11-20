/**
 * Binance rows the parser read wrong (#467). Every case runs a real CSV
 * through the real parser and generateTaxReport, in the three FX methods,
 * next to a readable control.
 *
 * - A Trade History cell of a coin whose ticker starts with a digit (1INCH,
 *   1000SATS) glued the coin's digits onto the number: "1001INCH" (100 units)
 *   was read as 1001, so FIFO took the wrong share of each lot.
 * - Two orders in one ±1 s window that give up the same coin for two
 *   different coins netted the given coin into one leg, booked against the
 *   first counter-leg only: 0.2 BTC sold for 3000 € in place of 0.1 BTC for
 *   3000 € and 0.1 BTC for 3300 USDT.
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
const TX = "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark";

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

describe("#467 Binance: two orders in one window that give up the same coin never book it against one counterpart", () => {
  // 0.2 BTC bought for 4000 € in January. On 01/06/2025, 0.1 BTC sold for
  // 3000 € and 0.1 BTC for 3300 USDT (3630 €): gains of 1000 and 1630 €.
  const buy = ["2025-01-10 09:00:00|Buy,BTC,0.2", "2025-01-10 09:00:00|Sell,EUR,-4000"];
  const tx = (rows: string[], eur = false): Statement => parse(eur ? `${TX},EUR_Value` : TX, rows.map((r) => {
    const [time, rest] = r.split("|");
    const [op, coin, change, value] = rest!.split(",");
    return `1,${time},Spot,${op},${coin},${change},${eur ? `,${value}` : ""}`;
  }));
  const at = (sec: number, legs: string[]): string[] => legs.map((l) => `2025-06-01 10:00:0${sec}|${l}`);
  const cases: [string, (sec: number) => string[], boolean][] = [
    ["spot: BTC to EUR, then BTC to USDT", (sec) => [...at(0, ["Sell,BTC,-0.1", "Buy,EUR,3000"]), ...at(sec, ["Sell,BTC,-0.1", "Buy,USDT,3300"])], false],
    ["spot with an EUR value on every row", (sec) => [...at(0, ["Sell,BTC,-0.1,-3000", "Buy,EUR,3000,3000"]), ...at(sec, ["Sell,BTC,-0.1,-3000", "Buy,USDT,3300,3000"])], true],
    ["spot: BTC to EUR and ETH bought with BTC", (sec) => [...at(0, ["Sell,BTC,-0.1", "Buy,EUR,3000"]), ...at(sec, ["Buy,ETH,1", "Sell,BTC,-0.1"])], false],
    ["Convert: BTC to EUR, then BTC to USDT", (sec) => [...at(0, ["Binance Convert,BTC,-0.1", "Binance Convert,EUR,3000"]), ...at(sec, ["Binance Convert,BTC,-0.1", "Binance Convert,USDT,3300"])], false],
  ];
  const buyRows = (eur: boolean): string[] => eur ? buy.map((r, k) => `${r},${k === 0 ? "4000" : "-4000"}`) : buy;

  describe.each(cases)("%s", (_label, legs, eur) => {
    const control = tx([...buyRows(eur), ...legs(5)], eur);
    const sameWindow = tx([...buyRows(eur), ...legs(0)], eur);
    const oneSecond = tx([...buyRows(eur), ...legs(1)], eur);

    it.each(METHODS)("[%s] control: 5 s apart, each order is booked on its own", (method) => {
      const r = report(control, method);
      expect(disposals(r, "BTC")[0]).toBe("0.1 p3000.00 c2000.00 g1000.00");
      expect(control.parserMessages ?? []).toEqual([]);
    });

    it.each(METHODS)("[%s] in one window, each BTC row is booked against its own counterpart, as the control", (method) => {
      for (const s of [sameWindow, oneSecond]) {
        expect(quantities(s, "BTC").filter((q) => q.startsWith("-"))).toEqual(["-0.1", "-0.1"]);
        expect(s.parserMessages ?? []).toEqual([]);
        const r = report(s, method);
        expect(disposals(r, "BTC")).toEqual(disposals(report(control, method), "BTC"));
        expect(net(r)).toBe(net(report(control, method)));
      }
    });
  });

  it.each(METHODS)("[%s] the BTC rows written apart from their counterparts are paired by order and named", (method) => {
    const legs = ["Sell,BTC,-0.1", "Sell,BTC,-0.1", "Buy,EUR,3000", "Buy,USDT,3300"];
    const s = tx([...buy, ...at(0, legs)]);
    const r = report(s, method);
    expect(disposals(r, "BTC")).toEqual(["0.1 p3000.00 c2000.00 g1000.00", "0.1 p3630.00 c2000.00 g1630.00"]);
    expect(net(r)).toBe("2630.00");
    expect(message(r.messages, "binance.spot_cost_split")?.context?.rows)
      .toBe("BTC Sell -0.1 2025-06-01 10:00:00; BTC Sell -0.1 2025-06-01 10:00:00; EUR Buy 3000 2025-06-01 10:00:00; USDT Buy 3300 2025-06-01 10:00:00");
    expect(message(r.messages, "binance.unpaired_leg")).toBeUndefined();
  });

  it.each(METHODS)("[%s] control: one sale in two fills next to a straddling buy is still booked in full", (method) => {
    // 0.1 BTC sold for 3000 € in two fills, and ETH bought at :01 with BTC
    // paid at :02: the window cannot pair the ETH, which is named as before.
    const s = tx([...buy, ...at(0, ["Sell,BTC,-0.05", "Buy,EUR,1500", "Sell,BTC,-0.05", "Buy,EUR,1500"]), ...at(1, ["Buy,ETH,1"]), ...at(2, ["Sell,BTC,-0.1"])]);
    const r = report(s, method);
    expect(disposals(r, "BTC")).toEqual(["0.05 p1500.00 c1000.00 g500.00", "0.05 p1500.00 c1000.00 g500.00"]);
    expect(message(r.messages, "binance.unpaired_leg")?.context?.rows).toBe("ETH Buy 1 2025-06-01 10:00:01; BTC Sell -0.1 2025-06-01 10:00:02");
  });
});
