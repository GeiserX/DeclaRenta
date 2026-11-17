/**
 * Scenario harness for «Tradicional con divisa» (issue #434). A tiny DSL builds
 * an IBKR-shaped FlexStatement plus its ECB rate map, so every scenario runs
 * through the REAL generateTaxReport (parser-free). Rates are EUR per USD.
 *
 * The economic target of a closed cycle (every share sold, every dollar
 * converted) is EUR out − EUR in − income (dividends) + fees: stock + FX of all
 * years must equal it. That is the invariant every closed scenario asserts.
 */
import Decimal from "decimal.js";
import { generateTaxReport, type ReportOptions } from "../../src/generators/report.js";
import type { FlexStatement, Trade, CashTransaction } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { TaxSummary } from "../../src/types/tax.js";

export type Ev =
  | { k: "fund"; d: string; usd: string; r: string } // EUR → USD conversion
  | { k: "dep"; d: string; usd: string; r: string } // USD arrives with no EUR origin (r: assumed value, economic only)
  | { k: "buy"; d: string; sym: string; qty: string; px: string; r: string; time?: string }
  | { k: "sell"; d: string; sym: string; qty: string; px: string; r: string; time?: string }
  | { k: "conv"; d: string; usd: string; r: string } // USD → EUR conversion
  | { k: "div"; d: string; usd: string; r: string } // USD dividend kept in USD
  | { k: "fee"; d: string; usd: string; r: string }; // USD fee ("0" only adds a rate for that date)

export interface Scenario {
  id: string;
  years: number[];
  /** Every share sold and every dollar converted by the end. */
  closed: boolean;
  ev: Ev[];
  /** Settlement date per trade date ("SPLIT": CASH T+2, stock T+1). Default: settles on the trade date. */
  settle?: Record<string, string>;
  /** US withholding on a dividend date (USD). */
  wht?: { d: string; usd: string }[];
}

const ISIN: Record<string, string> = { AAA: "US0000000AA1", BBB: "US0000000BB2", CCC: "US0000000CC3" };

function trade(o: Partial<Trade>): Trade {
  const d = o.tradeDate ?? "2024-03-15";
  return {
    tradeID: "1",
    accountId: "U1",
    symbol: "AAA",
    description: "AAA INC",
    isin: ISIN.AAA!,
    assetCategory: "STK",
    currency: "USD",
    tradeDate: d,
    settlementDate: o.settlementDate ?? d,
    quantity: "1",
    tradePrice: "1",
    tradeMoney: "1",
    proceeds: "1",
    cost: "1",
    fifoPnlRealized: "0",
    fxRateToBase: "1",
    buySell: "BUY",
    openCloseIndicator: o.buySell === "SELL" ? "C" : "O",
    exchange: "NASDAQ",
    commissionCurrency: "USD",
    commission: "0",
    taxes: "0",
    multiplier: "1",
    ...o,
  };
}

function plusDays(d: string, n: number): string {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Build the FlexStatement and rate map of a scenario. */
export function toStatement(sc: Scenario): { st: FlexStatement; rates: EcbRateMap } {
  const trades: Trade[] = [];
  const cash: CashTransaction[] = [];
  const rates: EcbRateMap = new Map();
  let n = 0;
  for (const e of sc.ev) {
    if (!rates.has(e.d)) rates.set(e.d, new Map());
    rates.get(e.d)!.set("USD", e.r);
    const id = String(++n);
    const ymd = e.d.replace(/-/g, "");
    if (e.k === "fund" || e.k === "conv") {
      const side = e.k === "fund" ? "SELL" : "BUY"; // SELL EUR.USD = acquire USD
      trades.push(
        trade({
          tradeID: id,
          symbol: "EUR.USD",
          description: "EUR.USD",
          isin: "",
          assetCategory: "CASH",
          tradeDate: e.d,
          quantity: e.usd,
          tradePrice: "1",
          tradeMoney: e.usd,
          proceeds: side === "SELL" ? e.usd : `-${e.usd}`,
          cost: e.usd,
          buySell: side,
          openCloseIndicator: "",
          exchange: "IDEALFX",
        } as Partial<Trade>),
      );
    } else if (e.k === "buy" || e.k === "sell") {
      const money = new Decimal(e.qty).mul(e.px).toString();
      trades.push(
        trade({
          tradeID: id,
          symbol: e.sym,
          description: `${e.sym} INC`,
          isin: ISIN[e.sym]!,
          tradeDate: e.d,
          ...(e.time ? { tradeTime: e.time } : {}),
          buySell: e.k === "buy" ? "BUY" : "SELL",
          quantity: e.k === "buy" ? e.qty : `-${e.qty}`,
          tradePrice: e.px,
          tradeMoney: money,
          proceeds: e.k === "sell" ? money : `-${money}`,
          cost: money,
        }),
      );
    } else if (e.k === "div") {
      cash.push({
        transactionID: id,
        accountId: "U1",
        symbol: "AAA",
        description: "AAA CASH DIVIDEND",
        isin: ISIN.AAA!,
        currency: "USD",
        dateTime: ymd,
        settleDate: ymd,
        amount: e.usd,
        fxRateToBase: "1",
        type: "Dividends",
      });
    } else if (e.k === "fee" && new Decimal(e.usd).greaterThan(0)) {
      cash.push({
        transactionID: id,
        accountId: "U1",
        symbol: "",
        description: "MONTHLY FEE",
        isin: "",
        currency: "USD",
        dateTime: ymd,
        settleDate: ymd,
        amount: `-${e.usd}`,
        fxRateToBase: "1",
        type: "Other Fees",
      });
    }
  }
  for (const w of sc.wht ?? []) {
    const ymd = w.d.replace(/-/g, "");
    cash.push({
      transactionID: "w" + ymd,
      accountId: "U1",
      symbol: "AAA",
      description: "AAA US TAX",
      isin: ISIN.AAA!,
      currency: "USD",
      dateTime: ymd,
      settleDate: ymd,
      amount: `-${w.usd}`,
      fxRateToBase: "1",
      type: "Withholding Tax",
    });
  }
  if (sc.settle) {
    for (const t of trades) {
      const v = sc.settle[t.tradeDate];
      if (!v) continue;
      t.settlementDate = v === "SPLIT" ? plusDays(t.tradeDate, t.assetCategory === "CASH" ? 2 : 1) : v;
    }
  }
  const ys = sc.years;
  const st = {
    accountId: "U1",
    fromDate: `${ys[0]}0101`,
    toDate: `${ys[ys.length - 1]}1231`,
    period: "Annual",
    trades,
    cashTransactions: cash,
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
  } as unknown as FlexStatement;
  return { st, rates };
}

/** EUR out − EUR in − dividend income (gross) + fees, over the whole scenario. */
export function economic(sc: Scenario): Decimal {
  let v = new Decimal(0);
  for (const e of sc.ev) {
    if (!("usd" in e)) continue;
    const x = new Decimal(e.usd).mul(e.r);
    if (e.k === "conv" || e.k === "fee") v = v.plus(x);
    if (e.k === "fund" || e.k === "dep" || e.k === "div") v = v.minus(x);
  }
  for (const w of sc.wht ?? []) {
    const div = sc.ev.find((x) => x.k === "div" && x.d === w.d)!;
    v = v.plus(new Decimal(w.usd).mul(div.r));
  }
  return v;
}

export interface YearFigures {
  stock: Decimal;
  fx: Decimal;
  t1633: Decimal;
  a1637: Decimal;
  s0328: Decimal;
  s0331: Decimal;
  report: TaxSummary;
}

/** Run every year of a scenario through generateTaxReport with the given options. */
export function run(sc: Scenario, options: ReportOptions): Map<number, YearFigures> {
  const { st, rates } = toStatement(sc);
  const out = new Map<number, YearFigures>();
  for (const y of sc.years) {
    const r = generateTaxReport(st, rates, y, options);
    out.set(y, {
      stock: r.capitalGains.netGainLoss,
      fx: r.fxGains.netGainLoss,
      t1633: r.fxGains.transmissionValue,
      a1637: r.fxGains.acquisitionValue,
      s0328: r.capitalGains.transmissionValue,
      s0331: r.capitalGains.acquisitionValue,
      report: r,
    });
  }
  return out;
}

/** Stock + FX over every year of a run. */
export function lifetime(per: Map<number, YearFigures>): Decimal {
  let t = new Decimal(0);
  for (const v of per.values()) t = t.plus(v.stock).plus(v.fx);
  return t;
}

export const TRAD: ReportOptions = { traditionalFx: true };
export const MONO: ReportOptions = { skipFx: true };
