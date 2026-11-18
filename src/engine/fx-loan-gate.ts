/**
 * Which currencies the FX engine treats with the loan model (issue #449).
 *
 * A buy or a debit that spends more of a currency than the account holds
 * leaves the account below zero: the broker lends that currency until later
 * inflows repay it. From the trades alone, that loan looks the same as
 * currency that came from outside the upload (an opening balance, a deposit,
 * IBKR auto-conversions skipped under the opt-out, DEGIRO AutoFX), and a loan
 * model applied to those files books results that never happened (an AFx-skip
 * round trip went from the right 40 to 90 in «Tradicional con divisa»).
 *
 * So the loan model runs for a currency only when the upload proves its cash:
 *  - an IBKR CashReport row of that currency for every statement period, all
 *    of one account (no merged accounts) and one broker, whose first period
 *    starts at a known, non-negative `startingCash`. Each row needs a
 *    non-blank account id, real calendar dates with `fromDate` ≤ `toDate`,
 *    and an `endingCash` the broker wrote (the parser's "0" for a missing one
 *    proves nothing). A blank id matched every other blank id, and
 *    "2025-00-01" .. "2025-99-31" held every date of 2025;
 *  - every row of the upload that moves that currency is one the FX engine
 *    reads, of that account and broker: a trade of a currency pair or a
 *    stock, fund or bond trade (no option, future, short cover, or commission
 *    paid in the currency for a trade in another one, no opening short sale),
 *    a cash row of income, withholding, interest or fees (no deposit,
 *    withdrawal or transfer), and no corporate action with cash. And no cash
 *    row is one the engine drops (a withholding with no income on its day, an
 *    orphan, or a row with no ECB rate: its cash is not seen), and each day's
 *    cash rows add up to the cash events the engine made of them (a per-period
 *    sum let a dropped credit and a dropped debit on two days cancel). A
 *    per-period net cannot prove the balance
 *    along the way: a USD deposit and an equal withdrawal in one year net to
 *    zero, the balance never went below zero, and the loan model invented a
 *    loan (70 € in «Tradicional con divisa»). Likewise a second account with
 *    no CashReport, merged with one that has it, ran the model on dollars the
 *    upload cannot see, and an opening short sale's inflow cancelled an
 *    orphan withholding's debit;
 *  - each period's `startingCash` plus the movements the FX engine sees in
 *    that period (conversions, income, fees, interest, stock buys and sales)
 *    equals its `endingCash`, within {@link CASH_TOLERANCE}, and a period
 *    starts where the one before it ended;
 *  - every event of the currency falls inside a period and comes from the
 *    broker of those rows;
 *  - no auto-conversion of the currency is skipped (`trackAutoConvert`).
 * Every other currency, and every file without such a CashReport, keeps the
 * untracked path unchanged.
 *
 * The answer must not depend on the FX method: the caller passes the stock
 * sales as «Tradicional con divisa» reads them, every sale with its net
 * proceeds, also at 0 or below (a commission larger than a worthless sale),
 * which the default's own producer leaves out (a trap: the same upload ran
 * the loan in one method and the untracked path in the other).
 *
 * The result maps each currency to its opening balance (the first period's
 * `startingCash`): currency the account held whose EUR cost the upload does
 * not show, spent before any loan opens.
 */

import Decimal from "decimal.js";
import type { CashBalance, CashTransaction, CorporateAction, Trade } from "../types/ibkr.js";
import { FxFifoEngine, type FxEvent } from "./fx-fifo.js";
import { normalizeDate } from "./dates.js";

/**
 * How far the upload's movements may miss the CashReport's ending balance,
 * in units of the currency. A stock buy's cost is quantity × price, which can
 * differ from the broker's rounded cash by a fraction of a cent.
 */
export const CASH_TOLERANCE = new Decimal(1);

/** Cash effect of one FX event on its currency, in units of that currency. */
function cashFlow(e: FxEvent): Decimal {
  if (e.kind === "stock_buy") return e.coveredCostPerUnit ? new Decimal(0) : (e.costFcy ?? new Decimal(0)).negated();
  if (e.kind === "stock_sell") return e.proceedsFcy ?? new Decimal(0);
  return e.quantity;
}

interface Period {
  accountId: string;
  brokerSource: string | undefined;
  from: string;
  to: string;
  starting: Decimal;
  ending: Decimal;
}

/** Whether `d` (normalized) is a real calendar date, YYYY-MM-DD. */
function calendarDate(d: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return false;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return t.toISOString().slice(0, 10) === d;
}

function parsePeriod(row: CashBalance): Period | null {
  if (row.startingCash === undefined || row.endingCashMissing || !row.fromDate || !row.toDate) return null;
  if (!row.accountId || row.accountId.trim() === "") return null;
  const from = normalizeDate(row.fromDate);
  const to = normalizeDate(row.toDate);
  if (!calendarDate(from) || !calendarDate(to) || from > to) return null;
  let starting: Decimal;
  let ending: Decimal;
  try {
    starting = new Decimal(row.startingCash);
    ending = new Decimal(row.endingCash);
  } catch {
    return null;
  }
  if (!starting.isFinite() || !ending.isFinite()) return null;
  return {
    accountId: row.accountId,
    brokerSource: row.brokerSource,
    from,
    to,
    starting,
    ending,
  };
}

/** Currencies the auto-conversion opt-out skips at least once. */
function skippedAutoConvert(trades: Trade[]): Set<string> {
  const out = new Set<string>();
  for (const t of trades) {
    if (t.assetCategory !== "CASH" || !FxFifoEngine.isFxconv(t)) continue;
    out.add(t.currency);
    const pair = FxFifoEngine.pairCurrencies(t);
    if (pair) {
      out.add(pair.base);
      out.add(pair.quote);
    }
  }
  return out;
}

/** Cash rows the FX engine reads (`extractCashFxEvents`); any other type moves currency it does not see. */
const READ_CASH_TYPES: ReadonlySet<string> = new Set([
  "Dividends",
  "Payment In Lieu Of Dividends",
  "Withholding Tax",
  "Broker Interest Received",
  "Bond Interest Received",
  "Broker Interest Paid",
  "Bond Interest Paid",
  "Other Fees",
  "Commission Adjustments",
]);

/** Asset categories whose trades the FX engine reads: currency pairs and long securities. */
const SECURITY_CATEGORIES: ReadonlySet<string> = new Set(["STK", "FUND", "BOND"]);

/**
 * Whether every row of the upload that moves `ccy` is one the FX engine reads,
 * from `account` and `broker` (see the module comment).
 */
function rowsReadable(
  ccy: string,
  account: string,
  broker: string,
  rows: { trades: Trade[]; cashTransactions: CashTransaction[]; corporateActions: CorporateAction[] },
): boolean {
  const ours = (r: { accountId: string; brokerSource?: string }): boolean => r.accountId === account && (r.brokerSource ?? "") === broker;
  for (const t of rows.trades) {
    const pair = t.assetCategory === "CASH" ? FxFifoEngine.pairCurrencies(t) : null;
    const inPair = pair !== null && (pair.base === ccy || pair.quote === ccy);
    const commission = t.commissionCurrency === ccy && !new Decimal(t.commission || "0").isZero();
    if (t.currency !== ccy && !inPair && !commission) continue;
    if (!ours(t)) return false;
    if (t.assetCategory === "CASH") continue;
    if (!SECURITY_CATEGORIES.has(t.assetCategory) || t.currency !== ccy) return false;
    // A short cover: the buy producer skips it, so its cash is unseen. A
    // short sale's own inflow is unseen too, and nothing the engine reads
    // cancels it, so the reconciliation catches it (the parser writes "O"
    // on a sale with no indicator, so the indicator cannot tell a short sale).
    if (t.buySell === "BUY" && (t.openCloseIndicator === "C" || t.openCloseIndicator === "C;O")) return false;
    // An opening short sale: the stock FIFO opens a short lot and makes no
    // disposal, so its inflow is unseen too. Alone the reconciliation catches
    // it; with an unseen debit of the same size (an orphan withholding) the
    // period nets to its ending.
    if (t.buySell === "SELL" && t.openCloseIndicator === "O") return false;
  }
  for (const c of rows.cashTransactions) {
    if (c.currency !== ccy) continue;
    if (!ours(c) || c.brokerConvertedToBase || !READ_CASH_TYPES.has(c.type)) return false;
  }
  for (const a of rows.corporateActions) {
    if (a.currency !== ccy) continue;
    let amount: Decimal;
    try {
      amount = new Decimal(a.amount || "0");
    } catch {
      return false;
    }
    if (!amount.isZero()) return false;
  }
  return true;
}

/**
 * Whether every cash row of `ccy` reaches the cash events the FX engine made
 * of them (dividends, withholding netted in, interest, fees).
 * `extractCashFxEvents` drops a withholding with no income on its day (an
 * orphan) and a row with no ECB rate, so their cash is not seen, and it
 * reports each row it drops (`omitted`): one is enough to reject. On top,
 * the rows of each day (the date the extractor keys on) add up to the events
 * of that day, which a withholding netted into its income that day keeps. A
 * trap, PR #460 review: compared per period, a credit with no ECB rate and an
 * orphan withholding of the same size on another day both vanished and the
 * period still added up. A row outside every period proves nothing either.
 */
function cashRowsSeen(
  ccy: string,
  periods: Period[],
  cashTransactions: CashTransaction[],
  omitted: CashTransaction[],
  events: FxEvent[],
): boolean {
  if (omitted.some((c) => c.currency === ccy)) return false;
  const inside = (date: string): boolean => periods.some((p) => date >= p.from && date <= p.to);
  const raw = new Map<string, Decimal>();
  const seen = new Map<string, Decimal>();
  const add = (m: Map<string, Decimal>, date: string, q: Decimal): void => {
    m.set(date, (m.get(date) ?? new Decimal(0)).plus(q));
  };
  for (const c of cashTransactions) {
    if (c.currency !== ccy) continue;
    const date = normalizeDate(c.dateTime || c.settleDate);
    let amount: Decimal;
    try {
      amount = new Decimal(c.amount || "0");
    } catch {
      return false;
    }
    if (!inside(date) || !amount.isFinite()) return false;
    add(raw, date, amount);
  }
  for (const e of events) {
    // Conversions and stock trades are checked row by row in rowsReadable.
    if (e.currency !== ccy || e.kind !== undefined || e.trigger === "conversion") continue;
    if (!inside(e.date)) return false;
    add(seen, e.date, e.quantity);
  }
  const zero = new Decimal(0);
  for (const date of new Set([...raw.keys(), ...seen.keys()])) {
    if (!(raw.get(date) ?? zero).equals(seen.get(date) ?? zero)) return false;
  }
  return true;
}

/** See the module comment. */
export function loanCurrencies(input: {
  /** Every FX event, the stock sales as «Tradicional con divisa» reads them. */
  events: FxEvent[];
  cashBalances: CashBalance[];
  trades: Trade[];
  cashTransactions: CashTransaction[];
  /** The cash rows `extractCashFxEvents` left out of its events (its `omitted`). */
  omittedCash: CashTransaction[];
  corporateActions: CorporateAction[];
  trackAutoConvert: boolean;
}): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  const skipped = input.trackAutoConvert ? new Set<string>() : skippedAutoConvert(input.trades);
  const currencies = new Set(input.events.map((e) => e.currency).filter((c) => c !== "EUR"));
  for (const ccy of currencies) {
    if (skipped.has(ccy)) continue;
    const rows = input.cashBalances.filter((r) => r.currency === ccy);
    if (rows.length === 0) continue;
    const periods: Period[] = [];
    const seen = new Set<string>();
    let valid = true;
    for (const row of rows) {
      const p = parsePeriod(row);
      if (!p) {
        valid = false;
        break;
      }
      // The same statement uploaded twice gives the same row twice. The broker
      // is in the key: the same row from two brokers is two pieces of evidence.
      const key = `${p.brokerSource ?? ""}|${p.accountId}|${p.from}|${p.to}|${p.starting.toString()}|${p.ending.toString()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      periods.push(p);
    }
    if (!valid || periods.length === 0) continue;
    // One account, one broker.
    if (new Set(periods.map((p) => p.accountId)).size !== 1) continue;
    if (new Set(periods.map((p) => p.brokerSource ?? "")).size !== 1) continue;
    periods.sort((a, b) => a.from.localeCompare(b.from));
    if (periods[0]!.starting.isNegative()) continue;
    // Periods do not overlap, and each starts where the one before ended.
    let chained = true;
    for (let i = 1; i < periods.length; i++) {
      const prev = periods[i - 1]!;
      const cur = periods[i]!;
      if (cur.from <= prev.to || cur.starting.minus(prev.ending).abs().greaterThan(CASH_TOLERANCE)) {
        chained = false;
        break;
      }
    }
    if (!chained) continue;
    const broker = periods[0]!.brokerSource ?? "";
    if (!rowsReadable(ccy, periods[0]!.accountId, broker, input)) continue;
    const flow = periods.map(() => new Decimal(0));
    let inside = true;
    for (const e of input.events) {
      if (e.currency !== ccy) continue;
      const i = periods.findIndex((p) => e.date >= p.from && e.date <= p.to);
      if (i < 0 || (e.brokerSource ?? "") !== broker) {
        inside = false;
        break;
      }
      flow[i] = flow[i]!.plus(cashFlow(e));
    }
    if (!inside) continue;
    if (!cashRowsSeen(ccy, periods, input.cashTransactions, input.omittedCash, input.events)) continue;
    const explained = periods.every((p, i) => p.starting.plus(flow[i]!).minus(p.ending).abs().lessThanOrEqualTo(CASH_TOLERANCE));
    if (!explained) continue;
    out.set(ccy, periods[0]!.starting);
  }
  return out;
}
