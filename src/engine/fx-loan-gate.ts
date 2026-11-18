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
 *    of one account (no merged accounts), whose first period starts at a
 *    known, non-negative `startingCash`;
 *  - each period's `startingCash` plus the movements the FX engine sees in
 *    that period (conversions, income, fees, interest, stock buys and sales)
 *    equals its `endingCash`, within {@link CASH_TOLERANCE}, and a period
 *    starts where the one before it ended. A deposit, a transfer, an option
 *    premium or any other movement the engine does not see breaks this;
 *  - every event of the currency falls inside a period and comes from the
 *    broker of those rows;
 *  - no auto-conversion of the currency is skipped (`trackAutoConvert`).
 * Every other currency, and every file without such a CashReport, keeps the
 * untracked path unchanged.
 *
 * The result maps each currency to its opening balance (the first period's
 * `startingCash`): currency the account held whose EUR cost the upload does
 * not show, spent before any loan opens.
 */

import Decimal from "decimal.js";
import type { CashBalance, Trade } from "../types/ibkr.js";
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

function parsePeriod(row: CashBalance): Period | null {
  if (row.startingCash === undefined || !row.fromDate || !row.toDate) return null;
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
    from: normalizeDate(row.fromDate),
    to: normalizeDate(row.toDate),
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

/** See the module comment. */
export function loanCurrencies(input: {
  events: FxEvent[];
  cashBalances: CashBalance[];
  trades: Trade[];
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
      // The same statement uploaded twice gives the same row twice.
      const key = `${p.accountId}|${p.from}|${p.to}|${p.starting.toString()}|${p.ending.toString()}`;
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
    const explained = periods.every((p, i) => p.starting.plus(flow[i]!).minus(p.ending).abs().lessThanOrEqualTo(CASH_TOLERANCE));
    if (!explained) continue;
    out.set(ccy, periods[0]!.starting);
  }
  return out;
}
