import type { Statement } from "../types/broker.js";
import Decimal from "decimal.js";
import { formatDateDmy, isYearEndDate, normalizeDate } from "../engine/dates.js";
import { readableDay } from "./csv-utils.js";

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

/**
 * Append `source` to `target`. With `brokerName` (the parser's `name`, e.g.
 * "Interactive Brokers"), every row of `source` that does not already name its
 * broker gets `brokerSource = brokerName`, so trades, cash, positions and the
 * FIFO lots and disposals built from them can be traced back to their broker.
 * Stamping here, where both the web and the CLI merge each parsed file, covers
 * every parser, including future ones, with the same name the user sees.
 */
export function mergeStatement(target: Statement, source: Statement, brokerName?: string): Statement {
  if (brokerName) stampBroker(source, brokerName);
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
  if (source.krakenLedgerTrades) target.krakenLedgerTrades = [...(target.krakenLedgerTrades ?? []), ...source.krakenLedgerTrades];
  target.manualRateHints = [...(target.manualRateHints ?? []), ...(source.manualRateHints ?? [])];
  target.holdingsBySource = [
    ...(target.holdingsBySource ?? []),
    ...(source.holdingsBySource ?? [{
      accountId: source.accountId,
      ...(source.fromDate ? { fromDate: source.fromDate } : {}),
      toDate: source.toDate,
      ...(brokerName ? { brokerSource: brokerName } : {}),
      openPositions: source.openPositions,
      cashBalances: source.cashBalances ?? [],
      ...(source.accountPeriods ? { accountPeriods: source.accountPeriods } : {}),
    }]),
  ];

  return target;
}

function stampBroker(statement: Statement, brokerName: string): void {
  const rows: { brokerSource?: string }[][] = [
    statement.trades,
    statement.cashTransactions,
    statement.corporateActions,
    statement.openPositions,
    statement.securitiesInfo,
    statement.cashBalances ?? [],
    statement.optionExercises ?? [],
  ];
  for (const list of rows) {
    for (const row of list) row.brokerSource ??= brokerName;
  }
}

/**
 * The statement to use for Modelo 720, 721 and D-6 of `year`.
 *
 * Each file's open positions and cash balances are the holdings on that file's
 * own period end, and the merged `toDate` is the latest one. So with last
 * year's statement uploaded next to this year's (for its trades), last year's
 * holdings would be added to this year's and still pass the positions-date
 * check. Keep only the holdings of the files that end at the year end, plus
 * those of files with no period end (their date is unknown, only IBKR gives
 * one), and warn once per file whose holdings are left out. Trades and cash
 * transactions of every file are kept.
 *
 * When no file ends at the year end, the statement is returned as is, so the
 * positions-date check still refuses it. The merged statement is not changed:
 * the web applies this again when the user picks another year.
 */
export function yearEndHoldings(statement: Statement, year: number): Statement {
  const sources = statement.holdingsBySource ?? [];
  const other = sources.filter((s) => s.toDate && !isYearEndDate(s.toDate, year));
  const atYearEnd = sources.filter((s) => s.toDate && isYearEndDate(s.toDate, year));
  if (other.length === 0 || atYearEnd.length === 0) return statement;

  const kept = sources.filter((s) => !other.includes(s));
  const messages = other
    .filter((s) => s.openPositions.length > 0 || s.cashBalances.length > 0)
    .map((s): NonNullable<Statement["parserMessages"]>[number] => {
      const account = s.accountId || "(sin número)";
      const date = formatDateDmy(s.toDate);
      return {
        id: "merge.holdings_other_date",
        severity: "warning",
        message: `Posiciones y saldos de la cuenta ${account} a fecha ${date} fuera de los modelos 720, 721 y D-6: no son los de 31/12/${year}.`,
        hint: `Ese fichero termina en otra fecha. Sus operaciones y movimientos sí se tienen en cuenta, pero estos modelos declaran lo que tenías a 31 de diciembre, así que sus posiciones y saldos no se suman. Si te falta el informe de esa cuenta a 31/12/${year}, súbelo también.`,
        context: { account, date, year: String(year) },
      };
    });

  return {
    ...statement,
    toDate: atYearEnd.map((s) => s.toDate).reduce(maxDate),
    openPositions: kept.flatMap((s) => s.openPositions),
    cashBalances: kept.flatMap((s) => s.cashBalances),
    parserMessages: [...(statement.parserMessages ?? []), ...messages],
    parserWarnings: [...(statement.parserWarnings ?? []), ...messages.map((m) => m.message)],
  };
}

export function finalizeMergedStatement(statement: Statement): Statement {
  reconcileOrderLegs(statement);
  nameUnbookedKrakenLedgerTrades(statement);
  dateUndatedRowsAtUploadStart(statement);

  // Same-day trades go by time of day, then keep the parser's row order (the
  // sort is stable). Never by tradeID: Kraken txids are random and row-index
  // IDs compare as text ("-10" before "-9"), so FIFO would consume a later
  // purchase first (Art. 37.2 LIRPF).
  statement.trades.sort((a, b) => {
    const dateCmp = normalizeDate(a.tradeDate).localeCompare(normalizeDate(b.tradeDate));
    if (dateCmp !== 0) return dateCmp;
    return (a.tradeTime ?? "").localeCompare(b.tradeTime ?? "");
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
 * A Kraken ledger names each trade by refid, the txid of its row in the
 * Trades CSV, and the ledger parser books none of them. A ledger uploaded
 * with no Trades CSV that has the trade lost a sale or a purchase with no
 * word (#467): each trade no Kraken trade of the upload books is named.
 */
function nameUnbookedKrakenLedgerTrades(statement: Statement): void {
  const pending = statement.krakenLedgerTrades;
  delete statement.krakenLedgerTrades;
  if (!pending?.length) return;
  const booked = new Set(statement.trades.filter((t) => t.exchange === "KRAKEN").map((t) => t.tradeID));
  const rows = new Map(pending.filter((p) => !booked.has(p.refid)).map((p) => [p.refid, p.row]));
  if (rows.size === 0) return;
  const count = String(rows.size);
  const text = [...rows.values()].join("; ");
  addInfoMessage(statement, {
    id: "kraken.ledger_trade_not_booked",
    severity: "warning",
    message: `Kraken: ${count} compraventa(s) del libro mayor (Ledgers) no están en ningún archivo de operaciones (Trades) subido y no se calculan: ${text}.`,
    hint: "DeclaRenta lee las compras y las ventas de Kraken solo del archivo de operaciones (Trades). Cada fila trae el refid de la operación y su fecha. Entre corchetes van las monedas y los importes que mueve en el libro mayor. Descarga de Kraken el archivo Trades de esas fechas (History → Export → Trades) y súbelo junto al libro mayor. Sin él, puede faltar una venta en tu declaración, o el coste de una compra.",
    context: { count, rows: text },
  });
}

/**
 * A kept trade row whose file gives no readable date (`undatedRow`, #467)
 * cannot be placed in time, so it must make the one-purchase evidence (#453)
 * "unverified" whatever the window. With an ISIN it does at any date. With no
 * ISIN the evidence reads it only before a sale's window start or between the
 * window start and the year-end list it checks, never after that list. The
 * earliest date of the whole upload (trades and cash rows) is on or before
 * every sale, so the row stands in one of those two places for every sale.
 * The engine needs a real date (crypto valuation throws on ""), and this one
 * adds no year to the upload. The row books nothing, so no number moves.
 * When the upload has no readable date at all it has no sale either: the row
 * is left out of the merged trades and stays named by its parser's warning.
 * A copy replaces each row: the parsed file's own statement keeps its trade.
 */
function dateUndatedRowsAtUploadStart(statement: Statement): void {
  if (!statement.trades.some((t) => t.undatedRow === true)) return;
  const days = [
    ...statement.trades.map((t) => t.tradeDate),
    ...statement.cashTransactions.map((c) => c.dateTime),
  ]
    .flatMap((d) => readableDay(d) ?? [])
    .sort();
  const earliest = days[0];
  statement.trades = earliest === undefined
    ? statement.trades.filter((t) => t.undatedRow !== true)
    : statement.trades.map((t) => (t.undatedRow === true ? { ...t, tradeDate: earliest, settlementDate: earliest } : t));
}

/**
 * Reconcile per-trade commission for brokers (Flatex) that ship trades and
 * their cash settlement in two separate files. The trade carries the broker
 * order number in `notes`; the cash leg carries the same key in `orderKey`.
 *
 * commission = −| |netAmount| − grossTradeMoney |  (negative = charged, like every parser)
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
 * the same order number. Flatex books a fill and its cash leg on the same
 * Buchtag, so legs and fills are matched day by day (#467): every day of the
 * order must have both, every leg a readable day, and no fill of the order may
 * be a row the parser kept unreadable (its leg would have no fill). A day with
 * as many legs as fills pairs them 1:1 by amount. A day with a different
 * count (one combined leg for several fills) recovers the day's total fee and
 * splits it pro rata by trade value. Legs paired with fills of another
 * execution booked a fill's whole value as a fee with no word.
 * The fee is only derived when leg and trade share a currency: a USD-priced
 * trade settled in EUR would otherwise book the whole FX difference as a fee.
 *
 * A fee is kept only when the legs can give one (#467): every leg's amount is
 * readable, and the fee is not below zero (a buy pays at least its gross, a
 * sale gets at most its gross; one cent of rounding is allowed) and is below
 * the gross. A split fee is also below the day's smallest fill: a missing or
 * extra leg of a fill of the day (a sale leg not exported, a leg uploaded
 * twice with no TA-Nr.) moves the fee by at least that fill's value. A day
 * with more legs than fills (net of Stornos) is never split: the extra leg
 * may be that of a fill the Depot export does not list or writes with a
 * Nominal of 0, and such a leg can be below the smallest fill. Otherwise
 * the fills keep a fee of 0 and `flatex.commission.not_recovered` names the
 * order: a leg with an empty amount made the whole trade a fee (a 1194 € gain
 * became a 1006 € loss), and a missing or extra leg a fee as large as a fill.
 * The legs are summed with their sign, so a Storno cancels the leg it reverses.
 */
const FLATEX_ORDER_PREFIX = "flatex-order:";

type Trade = Statement["trades"][number];
type OrderLeg = NonNullable<Statement["pendingOrderLegs"]>[number];

// Pair same-day fills with cash legs by size: sorting both sides by amount
// minimises the total |net − gross| and the largest single gap, so no fill
// is booked more than the day's largest real fee. File order is not used:
// the Depot and Konto exports need not list same-day fills in the same order.
function tradeOrder(a: Trade, b: Trade): number {
  return new Decimal(a.tradeMoney).abs().cmp(new Decimal(b.tradeMoney).abs());
}

function legOrder(a: OrderLeg, b: OrderLeg): number {
  return new Decimal(a.netAmount).abs().cmp(new Decimal(b.netAmount).abs());
}

/**
 * The fills and legs of one order, by day (oldest first), or undefined when
 * they cannot be the same executions: a leg or fill with no readable day, or
 * a day with fills and no leg or with legs and no fill (#467).
 */
function executionDays(trades: readonly Trade[], legs: readonly OrderLeg[]): { trades: Trade[]; legs: OrderLeg[] }[] | undefined {
  const days = new Map<string, { trades: Trade[]; legs: OrderLeg[] }>();
  const dayOf = (date: string): { trades: Trade[]; legs: OrderLeg[] } | undefined => {
    const day = readableDay(date);
    if (day === undefined) return undefined;
    const entry = days.get(day) ?? { trades: [], legs: [] };
    days.set(day, entry);
    return entry;
  };
  for (const trade of trades) {
    const day = dayOf(trade.tradeDate);
    if (!day) return undefined;
    day.trades.push(trade);
  }
  for (const leg of legs) {
    const day = dayOf(leg.tradeDate);
    if (!day) return undefined;
    day.legs.push(leg);
  }
  const sorted = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([, day]) => day);
  return sorted.every((day) => day.trades.length > 0 && day.legs.length > 0) ? sorted : undefined;
}

// One cent: Flatex rounds the cash leg to cents, but not the gross (qty × Kurs).
const FEE_ROUNDING = new Decimal("0.01");

/**
 * The fee readable legs give fills of one side and `gross` value, or
 * undefined when they give none: a buy pays gross + fee (its legs are
 * debits), a sale gets gross − fee (its legs are credits). The fee must be
 * below `limit` (the gross, or a split fee's smallest fill).
 */
function legFee(legs: readonly OrderLeg[], side: Trade["buySell"], gross: Decimal, limit: Decimal = gross): Decimal | undefined {
  const signed = legs.reduce((sum, leg) => sum.plus(leg.netAmount), new Decimal(0));
  const fee = side === "SELL" ? gross.minus(signed) : signed.negated().minus(gross);
  return fee.greaterThan(FEE_ROUNDING.negated()) && fee.lessThan(limit) ? fee : undefined;
}

/**
 * True when a day has more legs than fills once each Storno cancels the leg it
 * reverses: a buy's legs are debits, a sale's credits, and a leg of the other
 * sign is a Storno. One combined leg serves several fills, but no fill has two
 * legs, so a surplus leg is the leg of a fill that is not among them (missing
 * from the Depot export, or written with a Nominal of 0). Below the smallest
 * fill it passed the fee limit and became the other fills' fee (#467). Were
 * a fill ever to have two legs, the order would only lose its fee (named).
 */
function moreLegsThanFills(legs: readonly OrderLeg[], trades: readonly Trade[]): boolean {
  const sign = trades[0]!.buySell === "SELL" ? 1 : -1;
  const net = legs.reduce((count, leg) => count + new Decimal(leg.netAmount).cmp(0) * sign, 0);
  return net > trades.length;
}

/** How `flatex.commission.not_recovered` names an order's fills and legs. */
function orderRow(orderKey: string, legs: readonly OrderLeg[], trades: readonly Trade[]): string {
  const first = trades[0]!;
  const unreadable = legs.flatMap((leg) => leg.unreadableCell ?? []);
  const gross = trades.reduce((sum, trade) => sum.plus(trade.tradeMoney), new Decimal(0));
  const net = legs.reduce((sum, leg) => sum.plus(leg.netAmount), new Decimal(0));
  const cells = unreadable.length > 0
    ? unreadable.join(", ")
    : `${gross.toFixed()} ${first.currency} / ${net.toFixed()} ${legs[0]!.currency}`;
  return `${orderKey} ${first.isin || first.symbol} ${first.tradeDate} [${cells}]`;
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
  // Orders with a fill the parser kept as a row that books nothing (a Kurs or
  // Nominal it cannot read): that fill's leg is in the Konto export, so the
  // legs cannot give the readable fills a fee (#467).
  const keptFillOrders = new Set<string>();
  for (const trade of statement.trades) {
    const key = trade.notes ?? "";
    if (!key.startsWith(FLATEX_ORDER_PREFIX)) continue;
    // notes was only a reconciliation scratch key — always clear it so it isn't
    // mistaken for an IBKR notes flag (AFx, P) downstream.
    delete trade.notes;
    const orderKey = key.slice(FLATEX_ORDER_PREFIX.length);
    if (trade.quantityUnknown === true) {
      keptFillOrders.add(orderKey);
      continue;
    }
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
  const notRecovered: string[] = [];

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

    // A leg that cannot be read could be any fill's, and a fill that cannot
    // be read has its leg among them: no fill of the order gets a fee from
    // them, and the order is named. So is an order whose legs and fills do
    // not fall on the same days: they are not the same executions.
    const days = executionDays(trades, legs);
    if (legs.some((leg) => leg.unreadableCell !== undefined) || keptFillOrders.has(orderKey) || days === undefined) {
      notRecovered.push(orderRow(orderKey, legs, trades));
      continue;
    }

    let prorated = false;
    for (const day of days) {
      if (day.legs.length === day.trades.length) {
        // One cash leg per fill: pair them by amount.
        const sortedTrades = [...day.trades].sort(tradeOrder);
        const sortedLegs = [...day.legs].sort(legOrder);
        sortedTrades.forEach((trade, i) => {
          const leg = sortedLegs[i]!;
          if (leg.currency !== trade.currency) {
            crossCurrencyTrades++;
            return;
          }
          const fee = legFee([leg], trade.buySell, new Decimal(trade.tradeMoney));
          if (fee === undefined) {
            notRecovered.push(orderRow(orderKey, [leg], [trade]));
            return;
          }
          trade.commission = fee.abs().negated().toFixed();
          trade.commissionCurrency = leg.currency || trade.commissionCurrency || trade.currency;
        });
        continue;
      }

      // Counts differ (e.g. one combined cash leg for several fills): we can't
      // tell which leg belongs to which fill, so split the day's total fee
      // across its fills in proportion to their gross value.
      if (day.legs.some((leg) => day.trades.some((trade) => leg.currency !== trade.currency))) {
        crossCurrencyTrades += day.trades.length;
        continue;
      }
      const gross = day.trades.reduce((sum, trade) => sum.plus(trade.tradeMoney), new Decimal(0));
      const smallest = Decimal.min(...day.trades.map((trade) => trade.tradeMoney));
      const sides = new Set(day.trades.map((trade) => trade.buySell));
      const totalFee = sides.size === 1 && !moreLegsThanFills(day.legs, day.trades)
        ? legFee(day.legs, day.trades[0]!.buySell, gross, smallest)
        : undefined;
      if (totalFee === undefined) {
        notRecovered.push(orderRow(orderKey, day.legs, day.trades));
        continue;
      }
      for (const trade of day.trades) {
        trade.commission = totalFee.mul(trade.tradeMoney).div(gross).abs().negated().toFixed();
        trade.commissionCurrency = day.legs[0]!.currency || trade.commissionCurrency || trade.currency;
      }
      prorated = true;
    }
    if (prorated) proratedOrders++;
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

  if (notRecovered.length > 0) {
    const count = String(notRecovered.length);
    const rows = notRecovered.join("; ");
    addInfoMessage(statement, {
      id: "flatex.commission.not_recovered",
      severity: "warning",
      message: `Flatex: ${count} operación(es) no tienen la comisión calculada, porque sus apuntes de caja no cuadran con la operación: ${rows}.`,
      hint: "Cada fila trae el número de orden, el valor y la fecha. Entre corchetes va el importe de la operación y la suma de sus apuntes de caja. Si un importe no se puede leer, va su celda. Puede faltar un apunte o sobrar uno. Un apunte puede tener un importe o una fecha que no se puede leer, o una fecha que no es la de la operación. También puede haber una ejecución de la orden que no se puede leer. DeclaRenta deja esa comisión en 0. No la suma al coste de las compras ni la resta del valor de las ventas. Consulta la comisión en la liquidación de la orden en Flatex. Si quieres deducirla, añádela a mano en Renta Web.",
      context: { count, rows },
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
