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
    manualRateHints: [],
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
  target.manualRateHints = [...(target.manualRateHints ?? []), ...(source.manualRateHints ?? [])];

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
 *
 * One order filled in parts has several trades (and usually several legs) with
 * the same order number. Equal counts → pair them 1:1 by date, then by amount
 * within a day. Different counts → recover the order's total fee and split it
 * pro rata by trade value.
 * The fee is only derived when leg and trade share a currency: a USD-priced
 * trade settled in EUR would otherwise book the whole FX difference as a fee.
 */
const FLATEX_ORDER_PREFIX = "flatex-order:";

type Trade = Statement["trades"][number];
type OrderLeg = NonNullable<Statement["pendingOrderLegs"]>[number];

// Pair fills with cash legs by date, and same-day fills by size: sorting both
// sides by amount minimises the total |net − gross| and the largest single
// gap, so no same-day fill is booked more than the order's largest real fee.
// File order is not used: the Depot and Konto exports need not list same-day
// fills in the same order.
function tradeOrder(a: Trade, b: Trade): number {
  const dateCmp = normalizeDate(a.tradeDate).localeCompare(normalizeDate(b.tradeDate));
  if (dateCmp !== 0) return dateCmp;
  return new Decimal(a.tradeMoney).abs().cmp(new Decimal(b.tradeMoney).abs());
}

function legOrder(a: OrderLeg, b: OrderLeg): number {
  const dateCmp = normalizeDate(a.tradeDate).localeCompare(normalizeDate(b.tradeDate));
  if (dateCmp !== 0) return dateCmp;
  return new Decimal(a.netAmount).abs().cmp(new Decimal(b.netAmount).abs());
}

function reconcileOrderLegs(statement: Statement): void {
  // Note: we can't early-exit when pendingOrderLegs is empty — a Depot-only
  // upload has no legs but still carries trades with the "flatex-order:" scratch
  // note that must be cleared (and warned about). The per-trade startsWith guard
  // below is a no-op for IBKR/other brokers whose notes never use that prefix.
  const legsByKey = new Map<string, OrderLeg[]>();
  // The same cash leg can arrive twice (one Konto export uploaded twice, or two
  // exports with overlapping dates). Keep one leg per booking number, or the
  // order would look like it has more legs than fills.
  const seenBookings = new Set<string>();
  for (const leg of statement.pendingOrderLegs ?? []) {
    if (!leg.orderKey) continue;
    if (leg.bookingId) {
      const booking = `${leg.orderKey}:${leg.bookingId}`;
      if (seenBookings.has(booking)) continue;
      seenBookings.add(booking);
    }
    const legs = legsByKey.get(leg.orderKey);
    if (legs) legs.push(leg);
    else legsByKey.set(leg.orderKey, [leg]);
  }

  const tradesByKey = new Map<string, Trade[]>();
  // A Depot export uploaded twice (or two exports with overlapping dates)
  // repeats each fill with the same booking number (TA-Nr.). Keep one fill per
  // booking number, or FIFO would count every buy and sell twice.
  const seenFills = new Set<string>();
  const repeatedFills = new Set<Trade>();
  for (const trade of statement.trades) {
    const key = trade.notes ?? "";
    if (!key.startsWith(FLATEX_ORDER_PREFIX)) continue;
    // notes was only a reconciliation scratch key — always clear it so it isn't
    // mistaken for an IBKR notes flag (AFx, P) downstream.
    delete trade.notes;
    const orderKey = key.slice(FLATEX_ORDER_PREFIX.length);
    if (trade.tradeID) {
      const fill = `${orderKey}:${trade.tradeID}`;
      if (seenFills.has(fill)) {
        repeatedFills.add(trade);
        continue;
      }
      seenFills.add(fill);
    }
    const trades = tradesByKey.get(orderKey);
    if (trades) trades.push(trade);
    else tradesByKey.set(orderKey, [trade]);
  }

  let unmatchedTrades = 0;
  let crossCurrencyTrades = 0;
  let proratedOrders = 0;

  // Commission = | net cash settled − gross trade value |. The FIFO engine
  // (fifo.ts) reads Trade.commission directly and folds it into cost basis
  // (buys) / out of proceeds (sells) per Art. 35 LIRPF. We follow the IBKR
  // convention where `cost`/`proceeds` stay GROSS and `commission` is the
  // separate fee — so we set commission only and never touch cost/proceeds
  // (mutating them too would double-count the fee for any consumer that adds
  // commission to them).
  for (const [orderKey, trades] of tradesByKey) {
    const legs = legsByKey.get(orderKey);
    if (!legs) {
      unmatchedTrades += trades.length;
      continue;
    }

    if (legs.length === trades.length) {
      // One cash leg per fill: pair by date, then by amount within a day.
      const sortedTrades = [...trades].sort(tradeOrder);
      const sortedLegs = [...legs].sort(legOrder);
      sortedTrades.forEach((trade, i) => {
        const leg = sortedLegs[i]!;
        if (leg.currency !== trade.currency) {
          crossCurrencyTrades++;
          return;
        }
        const gross = new Decimal(trade.tradeMoney);
        const net = new Decimal(leg.netAmount).abs();
        trade.commission = net.minus(gross).abs().toFixed();
        trade.commissionCurrency = leg.currency || trade.commissionCurrency || trade.currency;
      });
      continue;
    }

    // Counts differ (e.g. one combined cash leg for several fills): we can't
    // tell which leg belongs to which fill, so split the order's total fee
    // across its fills in proportion to their gross value.
    if (legs.some((leg) => trades.some((trade) => leg.currency !== trade.currency))) {
      crossCurrencyTrades += trades.length;
      continue;
    }
    const net = legs.reduce((sum, leg) => sum.plus(new Decimal(leg.netAmount).abs()), new Decimal(0));
    const gross = trades.reduce((sum, trade) => sum.plus(trade.tradeMoney), new Decimal(0));
    const totalFee = net.minus(gross).abs();
    for (const trade of trades) {
      trade.commission = totalFee.mul(trade.tradeMoney).div(gross).toFixed();
      trade.commissionCurrency = legs[0]!.currency || trade.commissionCurrency || trade.currency;
    }
    proratedOrders++;
  }

  if (repeatedFills.size > 0) {
    statement.trades = statement.trades.filter((trade) => !repeatedFills.has(trade));
    addInfoMessage(statement, {
      id: "flatex.depot.repeated_fills",
      severity: "info",
      message: `Operaciones de Flatex repetidas y contadas una sola vez: ${repeatedFills.size}. Tenían el mismo número de orden y de apunte (TA-Nr.) que otra ya cargada.`,
      hint: "Suele pasar al subir el mismo CSV de Depotumsätze dos veces, o dos exportaciones con fechas que se solapan. Si de verdad son operaciones distintas, revisa el archivo: Flatex da a cada ejecución su propio TA-Nr.",
      context: { fills: String(repeatedFills.size) },
    });
  }

  // Trades present but their settlement legs are not (user uploaded only the
  // Depotumsätze file) → commission can't be recovered. Tell the user.
  if (unmatchedTrades > 0) {
    addInfoMessage(statement, {
      id: "flatex.commission.unmatched_trades",
      severity: "info",
      message:
        "No se pudieron emparejar todas las comisiones de Flatex: faltan los apuntes de caja correspondientes.",
      hint: "Sube también el CSV de Kontoumsätze (movimientos de cuenta) junto con el de Depotumsätze para que la comisión de cada operación se tenga en cuenta (sumándose al coste de adquisición en las compras y restándose del valor de transmisión en las ventas).",
      context: { unmatchedTrades: String(unmatchedTrades) },
    });
  }

  if (crossCurrencyTrades > 0) {
    addInfoMessage(statement, {
      id: "flatex.commission.cross_currency",
      severity: "info",
      message: `Operaciones de Flatex sin comisión calculada: ${crossCurrencyTrades}. El apunte de caja está en una moneda distinta a la de la operación.`,
      hint: "La comisión de esas operaciones se ha dejado en 0. Consulta su importe en la liquidación de la orden en Flatex y tenlo en cuenta al revisar la declaración: se suma al valor de adquisición en las compras y se resta del valor de transmisión en las ventas.",
      context: { trades: String(crossCurrencyTrades) },
    });
  }

  if (proratedOrders > 0) {
    addInfoMessage(statement, {
      id: "flatex.commission.multi_fill_prorated",
      severity: "info",
      message: `Órdenes de Flatex ejecutadas en varias partes: ${proratedOrders}. Su comisión se ha repartido entre las ejecuciones en proporción a su importe.`,
      hint: "Flatex liquidó esas órdenes con un número de apuntes de caja distinto al de ejecuciones, así que no se puede saber qué comisión corresponde a cada una. El total de comisiones de cada orden es exacto; solo el reparto entre ejecuciones es aproximado.",
      context: { orders: String(proratedOrders) },
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
