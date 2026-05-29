import type { Statement } from "../types/broker.js";
import Decimal from "decimal.js";
import { normalizeDate } from "../engine/dates.js";

export function createEmptyStatement(): Statement {
  return {
    accountId: "",
    fromDate: "",
    toDate: "",
    period: "",
    trades: [],
    cashTransactions: [],
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
    cashBalances: [],
    optionExercises: [],
    parserWarnings: [],
    parserMessages: [],
    pendingOrderLegs: [],
  };
}

export function mergeStatement(target: Statement, source: Statement): Statement {
  target.accountId = target.accountId || source.accountId;
  target.fromDate = minDate(target.fromDate, source.fromDate);
  target.toDate = maxDate(target.toDate, source.toDate);
  target.period = target.period || source.period;

  target.trades.push(...source.trades);
  target.cashTransactions.push(...source.cashTransactions);
  target.corporateActions.push(...source.corporateActions);
  target.openPositions.push(...source.openPositions);
  target.securitiesInfo.push(...source.securitiesInfo);
  target.cashBalances = [...(target.cashBalances ?? []), ...(source.cashBalances ?? [])];
  target.optionExercises = [...(target.optionExercises ?? []), ...(source.optionExercises ?? [])];
  target.parserWarnings = [...(target.parserWarnings ?? []), ...(source.parserWarnings ?? [])];
  target.parserMessages = [...(target.parserMessages ?? []), ...(source.parserMessages ?? [])];
  target.pendingOrderLegs = [...(target.pendingOrderLegs ?? []), ...(source.pendingOrderLegs ?? [])];

  return target;
}

export function finalizeMergedStatement(statement: Statement): Statement {
  reconcileOrderLegs(statement);

  statement.trades.sort((a, b) => {
    const dateCmp = normalizeDate(a.tradeDate).localeCompare(normalizeDate(b.tradeDate));
    if (dateCmp !== 0) return dateCmp;
    return a.tradeID.localeCompare(b.tradeID);
  });
  statement.cashTransactions.sort((a, b) =>
    normalizeDate(a.dateTime).localeCompare(normalizeDate(b.dateTime)),
  );
  statement.corporateActions.sort((a, b) =>
    normalizeDate(a.dateTime).localeCompare(normalizeDate(b.dateTime)),
  );
  statement.optionExercises?.sort((a, b) =>
    normalizeDate(a.date).localeCompare(normalizeDate(b.date)),
  );
  return statement;
}

/**
 * Reconcile per-trade commission for brokers (Flatex) that ship trades and
 * their cash settlement in two separate files. The trade carries the broker
 * order number in `notes`; the cash leg carries the same key in `orderKey`.
 *
 * commission = | |netAmount| − grossTradeMoney |
 *   - BUY:  gross is what the position costs; broker debits gross + fee  → |net| > gross
 *   - SELL: gross is the position value; broker credits gross − fee      → |net| < gross
 *
 * The FIFO engine (fifo.ts) already folds `Trade.commission` into cost basis
 * (buys) / out of proceeds (sells) per Art. 35 LIRPF, so we only populate it.
 *
 * If legs are present but a trade has no match (e.g. user uploaded only one of
 * the two files), emit an info message — commission can't be recovered then.
 */
const FLATEX_ORDER_PREFIX = "flatex-order:";

function reconcileOrderLegs(statement: Statement): void {
  // Note: we can't early-exit when pendingOrderLegs is empty — a Depot-only
  // upload has no legs but still carries trades with the "flatex-order:" scratch
  // note that must be cleared (and warned about). The per-trade startsWith guard
  // below is a no-op for IBKR/other brokers whose notes never use that prefix.
  const legByKey = new Map<string, NonNullable<Statement["pendingOrderLegs"]>[number]>();
  for (const leg of statement.pendingOrderLegs ?? []) {
    if (leg.orderKey) legByKey.set(leg.orderKey, leg);
  }

  let tradesNeedingLegs = 0;
  let unmatchedTrades = 0;

  for (const trade of statement.trades) {
    const key = trade.notes ?? "";
    if (!key.startsWith(FLATEX_ORDER_PREFIX)) continue;
    // notes was only a reconciliation scratch key — always clear it so it isn't
    // mistaken for an IBKR notes flag (AFx, P) downstream.
    delete trade.notes;
    tradesNeedingLegs++;

    const orderKey = key.slice(FLATEX_ORDER_PREFIX.length);
    const leg = legByKey.get(orderKey);
    if (!leg) {
      unmatchedTrades++;
      continue;
    }

    // Commission = | net cash settled − gross trade value |. The FIFO engine
    // (fifo.ts) reads Trade.commission directly and folds it into cost basis
    // (buys) / out of proceeds (sells) per Art. 35 LIRPF. We follow the IBKR
    // convention where `cost`/`proceeds` stay GROSS and `commission` is the
    // separate fee — so we set commission only and never touch cost/proceeds
    // (mutating them too would double-count the fee for any consumer that adds
    // commission to them).
    const gross = new Decimal(trade.tradeMoney);
    const net = new Decimal(leg.netAmount).abs();
    const fee = net.minus(gross).abs();

    trade.commission = fee.toFixed();
    trade.commissionCurrency = leg.currency || trade.commissionCurrency || trade.currency;
  }

  // Trades present but their settlement legs are not (user uploaded only the
  // Depotumsätze file) → commission can't be recovered. Tell the user.
  if (tradesNeedingLegs > 0 && unmatchedTrades > 0) {
    addInfoMessage(statement, {
      id: "flatex.commission.unmatched_trades",
      severity: "info",
      message:
        "No se pudieron emparejar todas las comisiones de Flatex: faltan los apuntes de caja correspondientes.",
      hint: "Sube también el CSV de Kontoumsätze (movimientos de cuenta) junto con el de Depotumsätze para que la comisión de cada operación se tenga en cuenta (sumándose al coste de adquisición en las compras y restándose del valor de transmisión en las ventas).",
      context: { unmatchedTrades: String(unmatchedTrades) },
    });
  }

  delete statement.pendingOrderLegs;
}

function addInfoMessage(
  statement: Statement,
  message: NonNullable<Statement["parserMessages"]>[number],
): void {
  statement.parserMessages = [...(statement.parserMessages ?? []), message];
  statement.parserWarnings = [...(statement.parserWarnings ?? []), message.message];
}

function minDate(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return normalizeDate(a) <= normalizeDate(b) ? a : b;
}

function maxDate(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return normalizeDate(a) >= normalizeDate(b) ? a : b;
}
