/**
 * Anti-churning rule detector (Art. 33.5.e/f/g LIRPF) — PROPORTIONAL blocking.
 *
 * Spanish tax law blocks capital losses if homogeneous securities are
 * repurchased within:
 * - **2 calendar months** before or after the sale — for securities admitted
 *   to trading on a regulated market of the European Economic Area (33.5.f) or
 *   on a third-country market the European Commission declared equivalent
 *   (DGT V0778-25): the US (NYSE, Nasdaq: Implementing Decision (EU)
 *   2017/2320), Australia (2017/2318), Hong Kong (2017/2319), and the markets
 *   of the EMIR decisions (Toronto, Tokyo, Singapore: open for shares).
 * - **1 year** before or after the sale — for securities admitted to neither
 *   (33.5.g): unlisted shares, OTC-only securities, shares listed only on a
 *   third-country market with no equivalence decision (London from 2021, SIX
 *   from July 2019). Which window an ISIN gets comes from the user's per-ISIN
 *   value or IBKR's listing codes (`antichurning-window.ts`, #452).
 * Crypto is no «valor o participación» (DGT V0525-25, V0648-24), so letters f
 * and g do not reach it; the engine applies 33.5.e to it (#457): only a
 * repurchase of the same coin, on any exchange, in the year after the sale
 * counts (de fecha a fecha, end day included), never a buy before the sale.
 * No consulta names crypto and art. 33.5 together: this is a deduction from
 * that doctrine and from V1613-25 (letter e, «y no las letras f) y g)», for
 * dollars), not a holding.
 *
 * The block is **proportional to the repurchased quantity** ("por paquetes",
 * DGT V0913-08): sell 100 at a loss, rebuy 30 → only the loss on 30 is deferred,
 * the loss on 70 is deductible now. One repurchased share absorbs one sold
 * share's loss, once (no double-counting — DGT V2481-20). The deferred loss is
 * NOT forfeited: it is released ("se integrarán a medida que se transmitan los
 * valores que permanezcan en el patrimonio del contribuyente") on a later
 * «transmisión definitiva» of homogeneous shares: the shares of a later sale,
 * gain or loss, that no unused repurchase in its own window absorbs (DGT
 * V3282-18, V1760-23). Pending losses form
 * a per-security queue counted in shares; each definitive share releases the
 * oldest pending share's loss, tracked as `reintegratedLossEur` on that
 * disposal. See docs/design/antichurning-proportional.md for the full contract
 * and citations.
 */

import type { FifoDisposal, Lot } from "../types/tax.js";
import type { Trade, CorporateAction } from "../types/ibkr.js";
import Decimal from "decimal.js";
import { normalizeDate, parseDate } from "./dates.js";
import { compareFifoTradeOrder } from "./fifo.js";
import { resolveIsinWindow, type IsinWindow } from "./antichurning-window.js";

/** Asset categories exempt from anti-churning (not "valores homogéneos" per Art. 33.5.f/g) */
const WASH_SALE_EXEMPT: ReadonlySet<string> = new Set(["OPT", "FUT", "FOP", "FSFOP", "CFD", "CASH"]);

/** Asset categories that, when backed by a real ISIN, are treated as listed (2-month window). */
const LISTED_CATEGORIES: ReadonlySet<string> = new Set(["STK", "FUND", "BOND"]);

/**
 * Add/subtract calendar months (Art. 33.5.f/g says "dos meses"/"un año", not 60/365 days).
 *
 * Plain `Date.setMonth(getMonth()+n)` overflows when the source day-of-month does
 * not exist in the target month (e.g. Jan 31 + 1mo → Mar 2/3, because February has
 * no 31st). For a tax window that silently shifts the boundary by a couple of days.
 * We clamp the day to the last valid day of the target month instead
 * (Jan 31 + 1mo → Feb 28/29; Mar 31 − 1mo → Feb 28/29; Dec 31 + 2mo → Feb 28/29).
 *
 * All arithmetic is in UTC because `parseDate` returns UTC midnight. Local-time
 * setters keep the local hour across a daylight-saving change, which moves the
 * window edge an hour off midnight in Spain and drops a repurchase made exactly
 * on the boundary day.
 */
export function addMonths(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  // Date.UTC normalises month overflow in both directions (e.g. month 13 → next January).
  const month = date.getUTCMonth() + months;
  // Last day of the target month.
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDayOfMonth)));
}

/** A homogeneous repurchase available to absorb a loss, with a consumable quantity. */
interface BuyEvent {
  time: number;
  /** Normalized YYYY-MM-DD of the buy (display trail of the block). */
  date: string;
  /** Shares this buy added to the long position (what a cover buy does not cover). */
  qty: Decimal;
  /** Remaining repurchased quantity not yet used to block a loss (the consumable budget). */
  remainingQty: Decimal;
}

/** Signed position movement used to compute shares remaining after a disposal. */
interface PositionEvent {
  time: number;
  qty: Decimal;
}

/** Corporate split ratio that changes share quantities without changing cost basis. */
interface SplitEvent {
  time: number;
  /** `num` new shares for every `den` old ones */
  num: Decimal;
  den: Decimal;
}

/** Exact quantity conversion between two dates: multiply by `num`, then divide by `den`. */
interface SplitConversion {
  num: Decimal;
  den: Decimal;
}

/** One BUY trade row, for the one-purchase exception's count of buy operations. */
interface BuyOperation {
  time: number;
  /** Same value for the rows of one buy operation (fills of one order on one day). */
  op: string;
}

/**
 * A long-position movement for the one-purchase exception: what a trade does
 * to the shares held (a short open moves nothing, a cover only what it does not
 * cover), and the account it comes from.
 */
interface LongEvent extends PositionEvent {
  /** {@link accountKey} of the trade's broker and account, or {@link MANUAL_GROUP}. */
  group: string;
}

/** Group of the manual opening lots: they belong to no uploaded file. */
const MANUAL_GROUP = "\u0000manual";

/** The split-adjusted position after each day with trades (one entry per day). */
interface PositionStep {
  time: number;
  /** Position after the day's trades, in the share units of that day. */
  position: Decimal;
}

/**
 * What the uploaded files show, for the one-purchase exception: it needs the
 * holding at the start of the 2-month window, and only a holdings list that
 * the trades explain proves it (see {@link buildEvidenceCheck}).
 */
export interface WashSaleCoverage {
  /**
   * One entry per uploaded file and account (an IBKR multi-account Flex gives
   * one per account). Absent or empty → the exception is never applied.
   */
  statements?: readonly AccountStatement[];
}

/** What one uploaded file shows for one account. */
export interface AccountStatement {
  /** The file's broker (`brokerSource` of its trades), when merged with one. */
  source?: string;
  /** The account, as the trades' `accountId` names it. */
  accountId: string;
  /** First and last day the file covers for the account (YYYY-MM-DD or YYYYMMDD). */
  fromDate?: string;
  toDate?: string;
  /**
   * Whether the file has a trades section for the account. Without one (an
   * IBKR Flex with only Open Positions) its period shows no trades and covers
   * nothing; it can still give the holdings list.
   */
  hasTrades: boolean;
  /**
   * Whether the file has a holdings section for the account (IBKR's
   * `<OpenPositions>`). With it, no rows is a list of nothing held at
   * `toDate`; without it (or unknown), no rows is no list.
   */
  hasPositions?: boolean;
  /** The account's holdings at `toDate` (IBKR's OpenPositions). */
  positions: readonly {
    isin: string;
    symbol: string;
    assetCategory: string;
    quantity: string;
    fromTrades?: boolean;
    quantityUnknown?: boolean;
  }[];
}

/** A blocked loss waiting for a definitive transmission, counted in shares. */
interface PendingLoss {
  /** Shares of the loss sale still pending, in the share units of `time`. */
  qty: Decimal;
  /** Pending loss (EUR, positive) on those shares. */
  eur: Decimal;
  /** Sell time of the loss sale; only later transmissions can release it. */
  time: number;
  /** Normalized YYYY-MM-DD of the loss sale (display trail of the release). */
  sellDate: string;
}

/**
 * Crypto (art. 33.5.e): units of one buy day that carry pending losses. A
 * crypto loss waits on the coins its repurchase brought in, not on any later
 * sale. Each group is the units one loss sale absorbed on that day.
 */
interface TieGroup {
  /** Units of the buy day that carry the loss. */
  qty: Decimal;
  /** The pending loss these units carry. */
  entry: PendingLoss;
  /** The EUR of that loss still on these units. */
  eur: Decimal;
}

/**
 * Detect wash sales: compute PROPORTIONAL blocked losses and release pending
 * losses on definitive transmissions, in ONE chronological pass (Art. 33.5.f/g
 * LIRPF; 33.5.e for crypto, whose window holds only the year after the sale).
 *
 * Per homogeneous key the pass keeps (a) a FIFO budget of in-window repurchase
 * quantities and (b) a queue of pending losses, oldest first, counted in shares.
 * For each (key, sell day) in date order, over all of that day's disposals:
 *  1. ABSORB — take the in-window repurchases not yet used: for loss lots
 *     always, for gain lots only while losses are pending (they need them for
 *     the definitive test). The DGT's order (#454): oldest first, so the
 *     purchases before the sale and on the sale day (each only for its shares
 *     still held after it; the sale day's buys are the newest of them) come
 *     before those after it, and the rest of the lot the sale transmits comes
 *     last.
 *     The purchases of the 2 months BEFORE the sale do not count when they are
 *     one buy operation and no shares were held at the window's start (the
 *     one-purchase exception, DGT V3282-18); the purchases after it always do.
 *     The absorbed shares go to the loss lots first, then the gain lots, newest
 *     acquisition first: the deductible part is the first-acquired shares.
 *  2. RELEASE — the shares no rebuy absorbed are a «transmisión definitiva»;
 *     each releases one pending share's loss, oldest first (`reintegratedLossEur`).
 *  3. TOTAL EXIT — a definitive sale day that leaves no shares (in the trades
 *     and in FIFO) releases every loss still pending.
 *  4. BLOCK (loss lots only) — defer `|loss| × absorbed/qty` and append it to
 *     the queue. The same absorbed shares keep the old losses pending.
 * Crypto (art. 33.5.e) runs neither 2 nor 3, and only its loss lots absorb:
 * each blocked loss is tied to the coins of the rebuys that absorbed it, and
 * the sale of those coins releases it («se integrará cuando se produzca la
 * posterior transmisión del elemento patrimonial»), whatever is bought after.
 * Only held shares are transmitted: a short cover (`isShort`) runs no definitive
 * test, releases nothing and is no exit, the shares its buy covers are no
 * repurchase, and a zero-share disposal is skipped.
 *
 * Passing the FULL (all-year) disposal+trade set makes the release work across
 * years in a merged multi-file run (the cross-year case). A single-year run sees
 * only the losses pending inside that year.
 *
 * @param disposals - FIFO disposals to check (pass all years for cross-year reintegration)
 * @param allTrades - All trades for the period (homogeneous repurchases)
 * @param corporateActions - Corporate actions for split-adjusted remaining-position caps
 * @param splitRatios - Ratio the FIFO engine applied per FS/RS transactionID
 *   (`FifoEngine.getSplitRatios()`); required for splits given only as shares
 *   added (Revolut), whose ratio depends on the holding at the split date
 * @param remainingLots - Lots FIFO still holds after the last input
 *   (`FifoEngine.getRemainingLots()`). With them the total exit also sees shares
 *   that came in without a BUY (scrip dividend, merger, spin-off, reward lots)
 * @param coverage - The period and the holdings of each uploaded file and
 *   account. The one-purchase exception applies only when they prove that no
 *   share was held at the window start (see `buildEvidenceCheck`); absent →
 *   never applied.
 * @param windows - Per-ISIN window data (`collectIsinWindows`): the user's value
 *   and IBKR's listing codes. Pass the SAME map to `salesWithWindowPastData`, so
 *   the block, the definitive test and the past-data warning use one window.
 *   Absent → 2 months for every security with an ISIN (#452).
 * @returns Disposals with `blockedLossEur`, `reintegratedLossEur`, `washSaleBlocked`
 *   and the display trails `washSaleRepurchaseDates` / `washSaleReleasedFromDates` set
 */
export function detectWashSales(
  disposals: FifoDisposal[],
  allTrades: Trade[],
  corporateActions: CorporateAction[] = [],
  splitRatios: ReadonlyMap<string, { num: Decimal; den: Decimal }> = new Map(),
  remainingLots?: ReadonlyMap<string, readonly Lot[]>,
  coverage: WashSaleCoverage = {},
  windows: ReadonlyMap<string, IsinWindow> = new Map(),
): FifoDisposal[] {
  // Shares bought back on each (key, day) to close a short, from FIFO's short
  // disposals. They go straight back to the lender and never stay in the
  // patrimony, so they are no repurchase (fx-fifo.ts does not count a cover as a
  // purchase either). Without this, a cover buy could block a loss that nothing
  // ever releases, because a cover is no «transmisión definitiva».
  // The covered shares are split by the day the short opened (the disposal's
  // acquireDate): a short opened on an earlier day, or one opened on the cover
  // day itself by a SELL "O". FIFO runs a day's "C;O" buys before its SELL "O"
  // rows and its "C" buys after them (compareFifoTradeOrder), so a "C;O" buy can
  // only cover an earlier short, and a "C" buy covers what is left of the
  // earlier short and then the same-day one.
  const coveredEarlier = new Map<string, Decimal>();
  const coveredSameDay = new Map<string, Decimal>();
  for (const d of disposals) {
    if (d.isShort !== true || WASH_SALE_EXEMPT.has(d.assetCategory)) continue;
    const key = homogeneousKey(d.isin, d.symbol, d.assetCategory);
    if (!key) continue;
    const time = parseDate(d.sellDate).getTime();
    const dayKey = `${key}|${time}`;
    const bucket = parseDate(d.acquireDate).getTime() < time ? coveredEarlier : coveredSameDay;
    bucket.set(dayKey, (bucket.get(dayKey) ?? new Decimal(0)).plus(d.quantity.abs()));
  }
  const takeCovered = (bucket: Map<string, Decimal>, dayKey: string, wanted: Decimal): Decimal => {
    const left = bucket.get(dayKey) ?? new Decimal(0);
    const taken = Decimal.min(wanted, left);
    bucket.set(dayKey, left.minus(taken));
    return taken;
  };

  // Index in-window-eligible BUY events and signed position movements by key.
  // Walk the trades in FIFO's processing order, so same-day covers take the
  // short in the order FIFO gave it to them: a "C;O" buy before a "C" buy,
  // whatever the file order.
  const buysByAsset = new Map<string, BuyEvent[]>();
  const buyOpsByAsset = new Map<string, BuyOperation[]>();
  const positionEventsByAsset = new Map<string, PositionEvent[]>();
  const longEventsByAsset = new Map<string, LongEvent[]>();
  // Crypto repurchase units bought per `key|day` (`manual`: the part from
  // manual opening lots, which FIFO books after the day's reward lots), for
  // the rebought coins still held of a buy day.
  const cryptoBoughtByDay = new Map<string, { all: Decimal; manual: Decimal }>();
  // Days of the share trades with no ISIN (a Flex without the Trades ISIN
  // column, a broker that gives none): any of them may be any ISIN's security,
  // so the one-purchase exception's evidence cannot count them (#453).
  const unidentifiedTradeTimes: number[] = [];
  // Their symbol-only keys, and the days of those with neither ISIN nor symbol:
  // a holding of one open at the window start may be any ISIN's shares (#453).
  const unidentifiedKeys = new Set<string>();
  const keylessTradeTimes: number[] = [];
  // ISINs with a share trade whose quantity the file does not give: it may be
  // a purchase or a sale of any size, so the upload cannot prove the
  // exception for that security (#453).
  const unknownQuantityIsins = new Set<string>();
  for (const trade of [...allTrades].sort(compareFifoTradeOrder)) {
    if (WASH_SALE_EXEMPT.has(trade.assetCategory)) continue;
    const key = homogeneousKey(trade.isin, trade.symbol, trade.assetCategory);
    // A missing or unreadable quantity reads "0" but is no explicit zero: a row
    // with no ISIN may then be any security's trade, with no holding to walk.
    if (trade.quantityUnknown === true && trade.assetCategory !== "CRYPTO") {
      if (trade.isin) unknownQuantityIsins.add(trade.isin);
      else {
        const time = parseDate(trade.tradeDate).getTime();
        unidentifiedTradeTimes.push(time);
        keylessTradeTimes.push(time);
      }
      continue;
    }
    const qty = parseQty(trade.quantity);
    if (qty.lessThanOrEqualTo(0)) continue;
    const d = parseDate(trade.tradeDate);
    const time = d.getTime();
    if (!trade.isin && trade.assetCategory !== "CRYPTO") {
      unidentifiedTradeTimes.push(time);
      if (key) unidentifiedKeys.add(key);
      else keylessTradeTimes.push(time);
    }
    if (!key) continue;

    let positionEvents = positionEventsByAsset.get(key);
    if (!positionEvents) {
      positionEvents = [];
      positionEventsByAsset.set(key, positionEvents);
    }
    let longEvents = longEventsByAsset.get(key);
    if (!longEvents) {
      longEvents = [];
      longEventsByAsset.set(key, longEvents);
    }
    const group = trade.notes === "manual-opening-lot" ? MANUAL_GROUP : accountKey(trade.brokerSource, trade.accountId);

    if (trade.buySell === "BUY") {
      positionEvents.push({ time, qty });
      // Every BUY row is a purchase for the one-purchase exception's count,
      // cover buys included (counting more can only withhold the exception).
      let ops = buyOpsByAsset.get(key);
      if (!ops) {
        ops = [];
        buyOpsByAsset.set(key, ops);
      }
      ops.push({ time, op: buyOperationId(trade, time, ops.length) });
      // FIFO sends a BUY flagged "C" or "C;O" to the open short lots first
      // (fifo.ts consumeShortLots). Only what is left after the cover becomes a
      // held lot. A "C" buy with no open short books nothing at all. The day's
      // covered shares go to the cover buys in FIFO's order (the sort above):
      // a "C;O" buy takes only shorts opened on an earlier day, a "C" buy takes
      // those first and then the shorts the same day's SELL "O" opened.
      let repurchased = qty;
      const oci = trade.openCloseIndicator;
      if (oci === "C" || oci === "C;O") {
        const dayKey = `${key}|${time}`;
        let covered = takeCovered(coveredEarlier, dayKey, qty);
        if (oci === "C") covered = covered.plus(takeCovered(coveredSameDay, dayKey, qty.minus(covered)));
        repurchased = oci === "C" && covered.isZero() ? new Decimal(0) : qty.minus(covered);
      }
      longEvents.push({ time, qty: repurchased, group });
      if (repurchased.greaterThan(0)) {
        let events = buysByAsset.get(key);
        if (!events) {
          events = [];
          buysByAsset.set(key, events);
        }
        events.push({ time, date: normalizeDay(trade.tradeDate), qty: repurchased, remainingQty: repurchased });
        if (trade.assetCategory === "CRYPTO") {
          const dayKey = `${key}|${normalizeDay(trade.tradeDate)}`;
          const bought = cryptoBoughtByDay.get(dayKey) ?? { all: new Decimal(0), manual: new Decimal(0) };
          bought.all = bought.all.plus(repurchased);
          if (group === MANUAL_GROUP) bought.manual = bought.manual.plus(repurchased);
          cryptoBoughtByDay.set(dayKey, bought);
        }
      }
    } else {
      positionEvents.push({ time, qty: qty.neg() });
      // A SELL "O" opens a short (FIFO addShortLot): it takes no held shares.
      longEvents.push({ time, qty: trade.openCloseIndicator === "O" ? new Decimal(0) : qty.neg(), group });
    }
  }
  for (const events of buysByAsset.values()) {
    events.sort((a, b) => a.time - b.time);
  }
  for (const ops of buyOpsByAsset.values()) {
    ops.sort((a, b) => a.time - b.time);
  }
  for (const events of positionEventsByAsset.values()) {
    events.sort((a, b) => a.time - b.time);
  }
  for (const events of longEventsByAsset.values()) {
    events.sort((a, b) => a.time - b.time);
  }
  const splitsByAsset = buildSplitEvents(corporateActions, splitRatios);
  const positionSteps = buildPositionSteps(longEventsByAsset, splitsByAsset);
  const filesProveNoShares = buildEvidenceCheck(longEventsByAsset, splitsByAsset, coverage.statements ?? [], unidentifiedTradeTimes);

  // Pending-loss queue per key, oldest first. A blocked loss does not belong to
  // one lot: any later definitive transmission of homogeneous shares releases it.
  // Entries are appended in sell-time order and released from the front, so the
  // spent ones are a prefix that `head` skips.
  const pendingByAsset = new Map<string, { entries: PendingLoss[]; head: number }>();
  // Crypto (art. 33.5.e): per key, the tie groups on each buy day (YYYY-MM-DD),
  // oldest first. Only crypto losses are tied to their repurchase's coins.
  const tiesByAsset = new Map<string, Map<string, TieGroup[]>>();
  const cryptoHeldAfter = buildCryptoDayHoldings(disposals, remainingLots, cryptoBoughtByDay);

  // Process disposals oldest-first so a block is recorded before the later
  // disposal that releases it (stable sort by sell date; preserve input order
  // for same-day disposals via the index tiebreak).
  const order = disposals.map((_, i) => i);
  order.sort((a, b) => {
    const ta = parseDate(disposals[a]!.sellDate).getTime();
    const tb = parseDate(disposals[b]!.sellDate).getTime();
    return ta !== tb ? ta - tb : a - b;
  });

  const result: FifoDisposal[] = disposals.map((d) => ({
    ...d,
    blockedLossEur: new Decimal(0),
    reintegratedLossEur: new Decimal(0),
    washSaleBlocked: false,
    washSaleRepurchaseDates: undefined,
    washSaleReleasedFromDates: undefined,
    washSaleSinglePurchase: undefined,
  }));

  const holdingAfterByAssetTime = new Map<string, Map<number, Decimal>>();

  // Running split-adjusted position per key, advanced forward as sell dates grow
  // (disposals are visited in sell-date order). `splitsApplied` is how many of the
  // key's splits fall on or before the sell date the sum is expressed in; crossing
  // a new split changes every earlier event's conversion, so the sum is rebuilt
  // once per split. Each event adds the same term in the same order as a full
  // re-walk from the start would, so the result is identical, in O(events + splits
  // × events) per key instead of O(sell dates × events).
  const positionSweepByAsset = new Map<
    string,
    { nextEvent: number; position: Decimal; splitsApplied: number; lastSellTime: number }
  >();

  const holdingAfter = (key: string, sellTime: number): Decimal => {
    let perTime = holdingAfterByAssetTime.get(key);
    if (!perTime) {
      perTime = new Map();
      holdingAfterByAssetTime.set(key, perTime);
    }
    const cached = perTime.get(sellTime);
    if (cached) return cached;

    const events = positionEventsByAsset.get(key) ?? [];
    const splits = splitsByAsset.get(key) ?? [];
    let splitsApplied = 0;
    while (splitsApplied < splits.length && splits[splitsApplied]!.time <= sellTime) splitsApplied++;
    let sweep = positionSweepByAsset.get(key);
    if (!sweep || sellTime < sweep.lastSellTime || splitsApplied !== sweep.splitsApplied) {
      sweep = { nextEvent: 0, position: new Decimal(0), splitsApplied, lastSellTime: sellTime };
      positionSweepByAsset.set(key, sweep);
    }
    sweep.lastSellTime = sellTime;
    while (sweep.nextEvent < events.length && events[sweep.nextEvent]!.time <= sellTime) {
      const ev = events[sweep.nextEvent]!;
      const conversion = splitFactorBetween(splitsByAsset, key, ev.time, sellTime);
      sweep.position = sweep.position.plus(ev.qty.mul(conversion.num).div(conversion.den));
      sweep.nextEvent++;
    }
    const remaining = Decimal.max(sweep.position, 0);
    perTime.set(sellTime, remaining);
    return remaining;
  };

  // The trades alone miss shares FIFO holds without a BUY (scrip dividends, a
  // merger into a new ISIN, spin-off and reward lots), so the total exit also
  // asks FIFO whether any lot of the key is still held after the sale day.
  const fifoHoldsAfter = buildFifoHoldings(disposals, remainingLots);

  // Whether a share holding with no ISIN may be open at the window start: FIFO
  // holds a lot of it the day before (any lot, also one no BUY row opened), or
  // a sale of one took shares the upload never shows bought (so they were held
  // before the files, maybe still at the window start). Such a holding may be
  // any ISIN's shares bought before the window, so the files cannot prove "no
  // shares at the window start" for any ISIN (#453). A holding closed before
  // the window does not stop the exception.
  // The "sold unbought" test runs per account: FIFO matches across accounts
  // (the taxpayer's FIFO), so another account's sale of shares held before its
  // files can take this account's lot and net the merged balance to zero,
  // hiding a lot that is still held. With no account ever below zero, FIFO
  // holds a lot exactly when some account does.
  const unidentifiedFifoHoldsAfter = buildUnidentifiedFifoHoldings(disposals, remainingLots);
  const unidentifiedSoldUnbought = [...unidentifiedKeys].some((key) =>
    someAccountSoldUnbought(longEventsByAsset.get(key) ?? [], splitsByAsset.get(key) ?? []),
  );
  const unidentifiedHeldAt = (windowStart: number): boolean =>
    unidentifiedSoldUnbought ||
    unidentifiedFifoHoldsAfter(windowStart - 1) ||
    // A trade with neither ISIN nor symbol has no holding to walk.
    keylessTradeTimes.some((time) => !(time >= windowStart));

  // The one-purchase exception (DGT V3282-18, AEAT Manual Renta 2025): the rule
  // on the purchases of the 2 months BEFORE a sale «no resulta de aplicación
  // cuando dentro del plazo de los dos meses anteriores a la transmisión sólo se
  // hubiera efectuado una operación de compra y, además, al inicio de ese
  // período no se tuvieran acciones o participaciones homogéneas». It answers
  // null when the upload shows the exception does not apply (two purchases, or
  // shares held at the window start), "applied" when the upload proves both
  // conditions, and "unverified" when it shows them but cannot prove the second
  // one (fail safe: not applied). The count runs from the window start to the
  // sale day included: a same-day buy has no intraday order, so it counts as a
  // second purchase. The positions are long holdings: a short is no share held.
  // The upload proves "no shares at the window start" only when both hold:
  //  - no sale ever takes more shares than the upload shows (else it holds
  //    shares from before the files);
  //  - for every account that trades or lists the key, a holdings list dated
  //    on or after the sale, reached without a gap in its files from the window
  //    start, is exactly what its trades since the window start leave, and
  //    those trades never sell more than they bought before; and no share
  //    trade without an ISIN falls in that span (`buildEvidenceCheck`);
  //  - no share holding without an ISIN may be open at the window start
  //    (`unidentifiedHeldAt`).
  // A start date alone proves nothing.
  const singlePurchase = (key: string, windowStart: number, sellTime: number): "applied" | "unverified" | null => {
    const ops = buyOpsByAsset.get(key) ?? [];
    const from = firstIndexAtOrAfter(ops, windowStart);
    const to = firstIndexAfter(ops, sellTime);
    const distinct = new Set<string>();
    for (let i = from; i < to; i++) distinct.add(ops[i]!.op);
    if (distinct.size !== 1) return null;
    const steps = positionSteps.get(key);
    const before = steps ? firstIndexAtOrAfter(steps.steps, windowStart) - 1 : -1;
    if (steps && before >= 0 && steps.steps[before]!.position.greaterThan(0)) return null;
    if (fifoHoldsAfter(key, windowStart - 1)) return null;
    if (!steps || steps.everNegative || unknownQuantityIsins.has(key)) return "unverified";
    return filesProveNoShares(key, windowStart, sellTime) && !unidentifiedHeldAt(windowStart) ? "applied" : "unverified";
  };

  // One unit per (key, sell day): FIFO splits a sale into one disposal per lot,
  // and same-day sales have no intraday order, so the absorption, the definitive
  // test and the total exit run once over the day's whole quantity. A disposal
  // of zero shares (FIFO books a 0-quantity SELL row with no lots) transmits
  // nothing: it can neither block, release nor empty the position.
  const groups: { key: string; sellDate: Date; sellTime: number; idxs: number[] }[] = [];
  const groupByDay = new Map<string, (typeof groups)[number]>();
  for (const idx of order) {
    const d = result[idx]!;
    if (WASH_SALE_EXEMPT.has(d.assetCategory)) continue;
    if (d.quantity.isZero()) continue;
    const key = homogeneousKey(d.isin, d.symbol, d.assetCategory);
    if (!key) continue;
    const sellDate = parseDate(d.sellDate);
    const sellTime = sellDate.getTime();
    const dayKey = `${key}|${sellTime}`;
    let group = groupByDay.get(dayKey);
    if (!group) {
      group = { key, sellDate, sellTime, idxs: [] };
      groupByDay.set(dayKey, group);
      groups.push(group);
    }
    group.idxs.push(idx);
  }

  const isLossAt = (idx: number): boolean => result[idx]!.gainLossEur.lessThan(0);
  // A short cover buys back shares sold short; it transmits no held shares, so
  // it is never a «transmisión definitiva»: it runs no definitive test, releases
  // no pending loss and cannot empty the position. Its own loss still blocks.
  const isShortAt = (idx: number): boolean => result[idx]!.isShort === true;
  const acquireTimeAt = (idx: number): number => {
    const t = parseDate(result[idx]!.acquireDate).getTime();
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  };
  // Newest acquisition first; a later FIFO index is a newer lot on a tie.
  const newestFirst = (a: number, b: number): number => {
    const ta = acquireTimeAt(a);
    const tb = acquireTimeAt(b);
    if (ta === tb) return b - a;
    return ta < tb ? 1 : -1;
  };

  for (const { key, sellDate, sellTime, idxs } of groups) {
    // Losses pending before this sale day. A loss blocked on this same day is
    // not yet pending for it.
    const queue = pendingByAsset.get(key);
    const hasPending = queue !== undefined && queue.head < queue.entries.length && queue.entries[queue.head]!.time < sellTime;

    // Crypto (art. 33.5.e): «se integrará cuando se produzca la posterior
    // transmisión del elemento patrimonial», the coins the repurchase brought
    // in. Of each buy day's coins sold today, the tied ones are the units that
    // leave the tie pool: the rebought coins of that day still held after
    // today keep the ties first (the tied coins of a day go last, so a release
    // never comes early).
    const ties = tiesByAsset.get(key);
    const tiedOf = new Map<number, Decimal>();
    if (ties) {
      const lotsByDay = new Map<string, number[]>();
      for (const idx of idxs) {
        if (isShortAt(idx)) continue;
        const day = normalizeDay(result[idx]!.acquireDate);
        if (!ties.has(day)) continue;
        const dayIdxs = lotsByDay.get(day);
        if (dayIdxs) dayIdxs.push(idx);
        else lotsByDay.set(day, [idx]);
      }
      for (const [day, dayIdxs] of lotsByDay) {
        const tied = ties.get(day)!.reduce((sum, g) => sum.plus(g.qty), new Decimal(0));
        let leaving = Decimal.max(0, tied.minus(cryptoHeldAfter(key, day, sellTime)));
        for (const idx of dayIdxs) {
          if (leaving.lessThanOrEqualTo(0)) break;
          const take = Decimal.min(result[idx]!.quantity.abs(), leaving);
          tiedOf.set(idx, take);
          leaving = leaving.minus(take);
        }
      }
    }

    // 1. ABSORB: the in-window homogeneous repurchases not yet used by an earlier
    //    transmission. A loss lot needs them to block its own loss; while losses
    //    are pending every sold share, gain or loss, needs them for the definitive
    //    test («con independencia de que determinen ganancias o pérdidas»,
    //    V3282-18), and a rebuy counted there is used up (V0248-18). With nothing
    //    pending a gain lot has nothing to test and uses no rebuy, and a short
    //    cover never has one. Crypto runs no definitive test (its tied coins
    //    release when sold, whatever is bought after), so only its loss lots
    //    take a rebuy: a gain sale uses up none that a later loss needs.
    const isCrypto = key.startsWith("CRYPTO:");
    const seekers = idxs.filter((idx) => isLossAt(idx) || (hasPending && !isShortAt(idx) && !isCrypto));
    const need = seekers.reduce((sum, idx) => sum.plus(result[idx]!.quantity.abs()), new Decimal(0));
    let dayAbsorbed = new Decimal(0);
    const consumed: { date: string; qty: Decimal }[] = [];
    const buyEvents = buysByAsset.get(key);
    if (buyEvents && need.greaterThan(0)) {
      const first = result[idxs[0]!]!;
      const months = windowMonths(first.assetCategory, first.isin, windows, sellDate.toISOString().slice(0, 10));
      // Art. 33.5.e (#457): for crypto only a buy in the year after the sale
      // counts, so its window starts at the sale and the pre-sale pass is empty.
      const windowStart = looksBack(first.assetCategory) ? addMonths(sellDate, -months).getTime() : sellTime;
      const windowEnd = addMonths(sellDate, months).getTime();

      // Consume repurchase quantity from in-window buys. Absorbed ≤ `need`. The
      // DGT's order (#454) is the oldest purchase no earlier sale has used: the
      // purchases of the 2 months before the sale and of the sale day first,
      // oldest first, then those of the 2 months after it, oldest first. V3282-18 gives the
      // 26/03 sale the 20/03 purchase, not 24/03 or the later 28/03; V0248-18
      // gives the 25/04 sale 3,000 of the 5,000 of 18/03, not the 3,000 of 31/03.
      //
      // A PRE-sale buy counts only for its shares still held after the sale day
      // (V3282-18 A: «únicamente, las compras que supongan una recompra»), so a
      // day that fully exits the position deducts the loss in full (situation 1).
      // FIFO keeps the newest shares: the `holdingAfter` shares left are the
      // newest bought, so walking the pre-sale buy days newest first, each day holds
      // what is left of that count. The sale day's own buys are part of the
      // count and of the walk, as its newest day: FIFO sells the oldest shares
      // first, so the shares bought on the sale day are the newest ones held
      // after it, whatever the time of day. The DGT counts such a buy as a
      // rebuy (V0571-21, 11/08/2020: the 7,000 bought on the sale day make it
      // not definitive), for its own held shares, and it is used up like any
      // other purchase. A buy only partly held is the lot the sale
      // itself transmits. It still counts (situation 3, and the one-purchase
      // exception exists because it would), but last, after the post-sale buys:
      // V3282-18 gives the 20/02 sale the 15/03 purchase, not the rest of the
      // 15/02 lot it sells from, and V1760-23 gives the 05/05 and 09/05 sales the
      // 06/05 purchase, not the rest of the 04/05 lot.
      let remainingToAbsorb = need;
      // buyEvents is sorted by time, so each pass walks only its slice of the
      // window, found by binary search: [windowStart, sellTime] for the buys up
      // to the sale day included, (sellTime, windowEnd] for post-sale ones. The
      // held buys are the newest ones, so the walk stops where the count runs
      // out and the pre-sale passes start there (`preFrom`).
      //
      // Crypto (#457) looks forward only: its window starts at the sale, and a
      // buy on the sale day is no reacquisition «dentro del año siguiente a la
      // fecha de dicha transmisión», so its walk stays empty.
      //
      // Before #454's follow-up the walk stopped before the sale day and the
      // day's held shares were credited to an older lot. That missed the rebuy
      // when no older lot was in the window or an earlier sale had used it,
      // left the sale-day shares for a later sale to use again, and put the
      // stood-in lot after the post-sale buys (step 4), so the sale took a later
      // purchase the DGT leaves for the next sale.
      const windowFrom = firstIndexAtOrAfter(buyEvents, windowStart);
      const preTo = windowStart < sellTime ? firstIndexAfter(buyEvents, sellTime) : windowFrom;
      // The buys of one day are one purchase here: brokers give no time of day,
      // and some list one order as several fills (DEGIRO, one row per fill with
      // one «ID Orden»). So the held count, and whether a buy is the lot the
      // sale transmits, is decided per day, never per row: otherwise the rows
      // FIFO left untouched would count as fully held and come before the
      // post-sale buys, and the year would depend on the fill layout.
      // `heldOfDay` maps a day's first row to the shares that day still holds.
      const dayOf = new Map<number, number>();
      const heldOfDay = new Map<number, Decimal>();
      let partlyFrom = -1;
      let partlyTo = -1;
      let preFrom = preTo;
      let stillHeld = holdingAfter(key, sellTime);
      for (let i = preTo - 1; i >= windowFrom && stillHeld.greaterThan(0); ) {
        const time = buyEvents[i]!.time;
        let first = i;
        while (first - 1 >= windowFrom && buyEvents[first - 1]!.time === time) first--;
        const conversion = buyQtyConversionToSellUnits(splitsByAsset, key, time, sellTime);
        let bought = new Decimal(0);
        for (let k = first; k <= i; k++) {
          bought = bought.plus(buyEvents[k]!.qty.mul(conversion.num).div(conversion.den));
          dayOf.set(k, first);
        }
        const held = Decimal.min(bought, stillHeld);
        stillHeld = stillHeld.minus(held);
        heldOfDay.set(first, held);
        preFrom = first;
        if (held.greaterThan(0) && held.lessThan(bought)) {
          partlyFrom = first;
          partlyTo = i + 1;
        }
        i = first - 1;
      }
      // Walks [from, to) oldest first, skipping [skipFrom, skipTo); a pre-sale
      // day gives at most its shares held after the sale. With `commit` false it
      // only measures what it would take.
      const consume = (from: number, to: number, commit = true, skipFrom = -1, skipTo = -1): Decimal => {
        let left = remainingToAbsorb;
        const takenOfDay = new Map<number, Decimal>();
        for (let i = from; i < to && left.greaterThan(0); i++) {
          const ev = buyEvents[i]!;
          if ((i >= skipFrom && i < skipTo) || ev.remainingQty.lessThanOrEqualTo(0)) continue;
          const conversion = buyQtyConversionToSellUnits(splitsByAsset, key, ev.time, sellTime);
          let availableAtSell = ev.remainingQty.mul(conversion.num).div(conversion.den);
          const day = dayOf.get(i);
          if (i < preTo) {
            if (day === undefined) continue;
            const capLeft = heldOfDay.get(day)!.minus(takenOfDay.get(day) ?? 0);
            availableAtSell = Decimal.min(availableAtSell, capLeft);
          }
          if (availableAtSell.lessThanOrEqualTo(0)) continue;
          const take = Decimal.min(availableAtSell, left);
          left = left.minus(take);
          if (day !== undefined) takenOfDay.set(day, (takenOfDay.get(day) ?? new Decimal(0)).plus(take));
          if (!commit) continue;
          ev.remainingQty = ev.remainingQty.minus(take.mul(conversion.den).div(conversion.num));
          consumed.push({ date: ev.date, qty: take });
        }
        const taken = remainingToAbsorb.minus(left);
        if (commit) remainingToAbsorb = left;
        return taken;
      };
      // The one-purchase exception lifts the pre-sale rule (both pre-sale
      // passes), and the doctrine states it for the 2-month window of letter f
      // only: the 1-year window (letter g, crypto) keeps the rule. Checked only
      // where a pre-sale pass would take something, so a sale it cannot change
      // carries no mark. The same test decides whether a sale is definitive
      // («los mismos criterios», V3282-18), because loss and gain lots share
      // this absorption.
      let preStatus: "applied" | "unverified" | null | undefined;
      const preSaleRuleApplies = (): boolean => {
        if (months !== 2) return true;
        if (preStatus === undefined) {
          preStatus = singlePurchase(key, windowStart, sellTime);
          if (preStatus) {
            for (const idx of idxs) if (!isShortAt(idx)) result[idx]!.washSaleSinglePurchase = preStatus;
          }
        }
        return preStatus !== "applied";
      };
      if (consume(preFrom, preTo, false, partlyFrom, partlyTo).greaterThan(0) && preSaleRuleApplies()) {
        consume(preFrom, preTo, true, partlyFrom, partlyTo);
      }
      // The post-sale repurchases. The one-purchase exception never reaches
      // them: «sin perjuicio de que las recompras efectuadas en el plazo de los
      // dos meses posteriores a la transmisión impidan también la imputación»
      // (V3282-18, B).
      consume(firstIndexAfter(buyEvents, sellTime), firstIndexAfter(buyEvents, windowEnd));
      // Last, the rest of the lot the sale transmits: every row of that day.
      if (partlyFrom >= 0 && consume(partlyFrom, partlyTo, false).greaterThan(0) && preSaleRuleApplies()) {
        consume(partlyFrom, partlyTo);
      }
      dayAbsorbed = need.minus(remainingToAbsorb);
    }

    // Hand the absorbed shares to the day's lots. Of the shares sold, the ones a
    // rebuy replaces are the last acquired: the deductible part is the shares
    // acquired first (V0913-08, V1294-22, Art. 37.2). Loss lots take them before
    // gain lots, so a loss lot of the sale stays blocked (V0279-25) and a pending
    // loss elsewhere cannot hand its rebuy to a gain lot. Each lot keeps the
    // dates of the repurchases it took, for the display trail.
    // A crypto lot also keeps the quantity per buy day (`chunksOf`): its
    // block is tied to those coins.
    const absorbedOf = new Map<number, Decimal>();
    const datesOf = new Map<number, Set<string>>();
    const chunksOf = new Map<number, { date: string; qty: Decimal }[]>();
    const allocation = [
      ...seekers.filter((idx) => isLossAt(idx)).sort(newestFirst),
      ...seekers.filter((idx) => !isLossAt(idx)).sort(newestFirst),
    ];
    let toAllocate = dayAbsorbed;
    let chunk = 0;
    for (const idx of allocation) {
      if (toAllocate.lessThanOrEqualTo(0)) break;
      const take = Decimal.min(result[idx]!.quantity.abs(), toAllocate);
      absorbedOf.set(idx, take);
      toAllocate = toAllocate.minus(take);
      const dates = new Set<string>();
      const chunks: { date: string; qty: Decimal }[] = [];
      let toCover = take;
      while (toCover.greaterThan(0) && chunk < consumed.length) {
        const c = consumed[chunk]!;
        const part = Decimal.min(c.qty, toCover);
        dates.add(c.date);
        chunks.push({ date: c.date, qty: part });
        c.qty = c.qty.minus(part);
        toCover = toCover.minus(part);
        if (c.qty.lessThanOrEqualTo(0)) chunk++;
      }
      datesOf.set(idx, dates);
      chunksOf.set(idx, chunks);
    }

    // 2. RELEASE: the shares no rebuy absorbed are a «transmisión definitiva».
    //    Each one releases one pending share, oldest pending loss first (V0571-21,
    //    V0754-26), whichever lot FIFO sells (V0046-20). The absorbed shares keep
    //    the pending losses deferred (V3282-18, V2481-20). A short cover
    //    transmits no held shares and releases nothing.
    const releasedFromOf = new Map<number, Set<string>>();
    const releaseInto = (idx: number, entry: PendingLoss, eur: Decimal): void => {
      const disposal = result[idx]!;
      disposal.reintegratedLossEur = disposal.reintegratedLossEur.plus(eur);
      let from = releasedFromOf.get(idx);
      if (!from) {
        from = new Set();
        releasedFromOf.set(idx, from);
      }
      from.add(entry.sellDate);
    };
    // Crypto: the tied coins sold release their losses, in proportion to the
    // units, oldest group first. A rebuy after this sale does not hold them
    // back: the law names the transmission of the reacquired coins as the
    // moment, and that rebuy can block this sale's own loss instead. A sale of
    // other coins releases nothing.
    for (const [idx, tied] of tiedOf) {
      const day = normalizeDay(result[idx]!.acquireDate);
      const dayGroups = ties!.get(day)!;
      takeTiedUnits(dayGroups, tied, (entry, eur, units) => {
        releaseInto(idx, entry, eur);
        entry.eur = entry.eur.minus(eur);
        entry.qty = entry.qty.minus(units);
      });
      if (dayGroups.length === 0) ties!.delete(day);
    }
    if (queue && hasPending && !isCrypto) {
      // The cursor moves past each entry as it is spent, so a sale of many lots
      // walks the queue once instead of rescanning the spent prefix per lot.
      let cursor = queue.head;
      for (const idx of idxs) {
        if (isShortAt(idx)) continue;
        let toRelease = result[idx]!.quantity.abs().minus(absorbedOf.get(idx) ?? 0);
        while (toRelease.greaterThan(0) && cursor < queue.entries.length) {
          const entry = queue.entries[cursor]!;
          if (entry.time >= sellTime) break;
          const conversion = splitFactorBetween(splitsByAsset, key, entry.time, sellTime);
          const entryQtyAtSell = entry.qty.mul(conversion.num).div(conversion.den);
          if (entryQtyAtSell.lessThanOrEqualTo(0)) {
            cursor++;
            continue;
          }
          const take = Decimal.min(toRelease, entryQtyAtSell);
          const spent = take.equals(entryQtyAtSell);
          const releasedEur = spent ? entry.eur : entry.eur.mul(take).div(entryQtyAtSell);
          releaseInto(idx, entry, releasedEur);
          entry.eur = entry.eur.minus(releasedEur);
          entry.qty = spent ? new Decimal(0) : entry.qty.minus(take.mul(conversion.den).div(conversion.num));
          toRelease = toRelease.minus(take);
          if (spent) cursor++;
        }
      }
    }

    // 3. TOTAL EXIT: a sale day that leaves no shares and whose sales no rebuy
    //    absorbed is a definitive exit; it releases every loss still pending
    //    («las pérdidas … que le resten por imputar», V1760-23). The queue can
    //    hold more shares than the position, because a rebought sale both keeps
    //    the old losses pending and adds its own. Both the trades and FIFO must
    //    show the position at zero, and the day must transmit held shares: a
    //    day of short covers only is no exit. Crypto has no total exit: every
    //    pending crypto loss is tied to its rebuy's coins, and selling out
    //    before a rebuy that comes later transmits none of them.
    if (
      !isCrypto &&
      queue &&
      hasPending &&
      idxs.some((idx) => !isShortAt(idx)) &&
      dayAbsorbed.isZero() &&
      holdingAfter(key, sellTime).isZero() &&
      !fifoHoldsAfter(key, sellTime)
    ) {
      // The last long sale of the day takes the rest: a short cover releases nothing.
      const longIdxs = idxs.filter((idx) => !isShortAt(idx));
      const lastIdx = longIdxs[longIdxs.length - 1]!;
      for (let i = queue.head; i < queue.entries.length; i++) {
        const entry = queue.entries[i]!;
        if (entry.time >= sellTime) break;
        if (entry.qty.lessThanOrEqualTo(0) && entry.eur.isZero()) continue;
        releaseInto(lastIdx, entry, entry.eur);
        entry.eur = new Decimal(0);
        entry.qty = new Decimal(0);
      }
    }
    if (queue) {
      while (queue.head < queue.entries.length && queue.entries[queue.head]!.qty.lessThanOrEqualTo(0)) queue.head++;
    }
    for (const [idx, from] of releasedFromOf) result[idx]!.washSaleReleasedFromDates = [...from].sort();

    // 4. BLOCK (loss lots only): the absorbed shares defer their part of each
    //    loss, `|loss| × absorbed / qty`, which joins the end of the pending
    //    queue. The shares that keep the old losses pending are the same that
    //    block this one; they are not counted twice (V0913-08).
    const blockOf = new Map<number, PendingLoss>();
    for (const idx of idxs) {
      const disposal = result[idx]!;
      const absorbed = absorbedOf.get(idx);
      if (!isLossAt(idx) || !absorbed || absorbed.lessThanOrEqualTo(0)) continue;
      const qty = disposal.quantity.abs();
      const lossAbs = disposal.gainLossEur.abs();
      const blocked = absorbed.greaterThanOrEqualTo(qty) ? lossAbs : lossAbs.mul(absorbed).div(qty);
      disposal.blockedLossEur = blocked;
      disposal.washSaleBlocked = blocked.greaterThan(0);
      if (!disposal.washSaleBlocked) continue;
      // Display-only trail so the UI can say WHICH purchases blocked this loss.
      disposal.washSaleRepurchaseDates = [...(datesOf.get(idx) ?? [])].sort();
      let pending = pendingByAsset.get(key);
      if (!pending) {
        pending = { entries: [], head: 0 };
        pendingByAsset.set(key, pending);
      }
      const entry: PendingLoss = { qty: absorbed, eur: blocked, time: sellTime, sellDate: normalizeDay(disposal.sellDate) };
      pending.entries.push(entry);
      blockOf.set(idx, entry);
    }

    // Crypto: tie each lot's new block to the coins of the rebuys that
    // absorbed it, per buy day, in proportion to the units.
    if (isCrypto) {
      for (const [idx, chunks] of chunksOf) {
        const block = blockOf.get(idx);
        if (!block) continue;
        const blockShare = shareOut(block.eur, absorbedOf.get(idx)!);
        let keyTies = tiesByAsset.get(key);
        if (!keyTies) {
          keyTies = new Map();
          tiesByAsset.set(key, keyTies);
        }
        for (const c of chunks) {
          const part: TieGroup = { qty: c.qty, entry: block, eur: blockShare(c.qty) };
          const dayGroups = keyTies.get(c.date);
          if (dayGroups) dayGroups.push(part);
          else keyTies.set(c.date, [part]);
        }
      }
    }
  }

  return result;
}

/**
 * Hand out `eur` over `units` in parts: each call takes `eur × part / units`,
 * and the call that takes the last units takes what is left, so the parts sum
 * to `eur` exactly.
 */
function shareOut(eur: Decimal, units: Decimal): (part: Decimal) => Decimal {
  let eurLeft = eur;
  let unitsLeft = units;
  return (part: Decimal): Decimal => {
    const take = part.greaterThanOrEqualTo(unitsLeft) ? eurLeft : eurLeft.mul(part).div(unitsLeft);
    eurLeft = eurLeft.minus(take);
    unitsLeft = unitsLeft.minus(part);
    return take;
  };
}

/**
 * Take `units` tied coins off a buy day's groups, oldest group first. Each
 * group gives up its loss's share of EUR on the units taken (all of it when the
 * whole group goes) through `onRelease`, with the units taken from that group.
 */
function takeTiedUnits(
  groups: TieGroup[],
  units: Decimal,
  onRelease: (entry: PendingLoss, eur: Decimal, units: Decimal) => void,
): void {
  let left = units;
  while (left.greaterThan(0) && groups.length > 0) {
    const group = groups[0]!;
    const take = Decimal.min(group.qty, left);
    const eur = take.equals(group.qty) ? group.eur : group.eur.mul(take).div(group.qty);
    group.eur = group.eur.minus(eur);
    onRelease(group.entry, eur, take);
    group.qty = group.qty.minus(take);
    left = left.minus(take);
    if (group.qty.lessThanOrEqualTo(0)) groups.shift();
  }
}

/**
 * Rebought crypto coins of each buy day still held after a given day, per key.
 * The day's coins held are the disposals of that buy day sold later, plus the
 * lots of that day FIFO still holds at the end (without FIFO's lots, the coins
 * bought that day that no disposal sold). Of those, the coins no repurchase
 * brought in (reward lots: the day's coins beyond `boughtByDay`) carry no tie.
 * FIFO books one day's lots in input order (`generateTaxReport`: the trades,
 * then the reward lots, then the manual opening lots; the sort compares days
 * only), so it sells them in that order and the held ones are its tail: the
 * manual coins, then the reward coins, then the trade coins. Keyed
 * `key|YYYY-MM-DD` on the lot's acquisition day, which is the trade day of the
 * buy that opened it.
 */
function buildCryptoDayHoldings(
  disposals: readonly FifoDisposal[],
  remainingLots: ReadonlyMap<string, readonly Lot[]> | undefined,
  boughtByDay: ReadonlyMap<string, { all: Decimal; manual: Decimal }>,
): (key: string, day: string, time: number) => Decimal {
  const sales = new Map<string, { time: number; qty: Decimal }[]>();
  const soldByDay = new Map<string, Decimal>();
  for (const d of disposals) {
    if (d.assetCategory !== "CRYPTO" || d.isShort === true || d.quantity.isZero()) continue;
    const dayKey = `${homogeneousKey(d.isin, d.symbol, d.assetCategory)}|${normalizeDay(d.acquireDate)}`;
    const qty = d.quantity.abs();
    const sale = { time: parseDate(d.sellDate).getTime(), qty };
    const daySales = sales.get(dayKey);
    if (daySales) daySales.push(sale);
    else sales.set(dayKey, [sale]);
    soldByDay.set(dayKey, (soldByDay.get(dayKey) ?? new Decimal(0)).plus(qty));
  }
  const heldAtEnd = new Map<string, Decimal>();
  if (remainingLots) {
    for (const [mapKey, lots] of remainingLots) {
      if (!mapKey.startsWith("CRYPTO:")) continue;
      for (const lot of lots) {
        if (lot.isShort || lot.quantity.lessThanOrEqualTo(0)) continue;
        const dayKey = `${mapKey}|${normalizeDay(lot.acquireDate)}`;
        heldAtEnd.set(dayKey, (heldAtEnd.get(dayKey) ?? new Decimal(0)).plus(lot.quantity));
      }
    }
  } else {
    for (const [dayKey, bought] of boughtByDay) {
      heldAtEnd.set(dayKey, Decimal.max(0, bought.all.minus(soldByDay.get(dayKey) ?? 0)));
    }
  }
  return (key: string, day: string, time: number): Decimal => {
    const dayKey = `${key}|${day}`;
    const end = heldAtEnd.get(dayKey) ?? new Decimal(0);
    let held = end;
    for (const sale of sales.get(dayKey) ?? []) if (sale.time > time) held = held.plus(sale.qty);
    const bought = boughtByDay.get(dayKey);
    const manual = bought?.manual ?? new Decimal(0);
    const reward = Decimal.max(0, end.plus(soldByDay.get(dayKey) ?? 0).minus(bought?.all ?? 0));
    return held.minus(Decimal.min(reward, Decimal.max(0, held.minus(manual))));
  };
}

/**
 * The sales (one per security and sale day, as the detector groups them) whose
 * anti-churning result a buy after the loaded data could still change, with
 * the last day of each one's window and the last date the data covers for it.
 * The detector sees only the uploaded trades, so a repurchase after that date
 * is invisible. It matters for a loss not fully blocked (the buy would block
 * more of it, the BLOCK step) and for a sale that released pending losses (the
 * buy would make its shares non-definitive, the RELEASE and TOTAL EXIT steps).
 * A crypto release is final: the sale of the rebought coins integrates the loss
 * whatever is bought after (art. 33.5.e), so it alone raises no warning.
 * Nothing is withheld: the caller only warns.
 *
 * With one broker the data covers every security up to `lastLoadedDate` (its
 * statement end or its last trade of any security: a final exit never has a
 * later trade of its own). With several merged brokers each one's files end on
 * their own date, and a rebuy of a security can sit at any broker that trades
 * it. A security is then covered up to the earliest end among the brokers that
 * trade it: a broker's end is its last trade of any security, or its statement
 * end from `endBySource` when later. A broker with a statement end and no
 * trades is one of the merged brokers too.
 *
 * @param lastLoadedDate - Last date the whole upload covers (YYYY-MM-DD or YYYYMMDD)
 * @param trades - The uploaded trades, with `brokerSource` set by the merge
 * @param endBySource - Statement end per broker, when its files give one
 * @param windows - The per-ISIN window data passed to `detectWashSales` (#452)
 */
export function salesWithWindowPastData(
  disposals: readonly FifoDisposal[],
  lastLoadedDate: string,
  trades: readonly Trade[] = [],
  endBySource: ReadonlyMap<string, string> = new Map(),
  windows: ReadonlyMap<string, IsinWindow> = new Map(),
): { key: string; sellDate: string; windowEnd: string; lastDate: string }[] {
  // Day only: a trade date may carry a time ("20250602;101500").
  const dayTime = (date: string): number => parseDate(normalizeDate(date.trim()).slice(0, 10)).getTime();
  const uploadEnd = dayTime(lastLoadedDate);
  if (!Number.isFinite(uploadEnd)) return [];

  // Per broker: the last date its files cover, and the keys it trades.
  const endOfSource = new Map<string, number>();
  const sourcesOfKey = new Map<string, Set<string>>();
  for (const trade of trades) {
    const source = trade.brokerSource;
    const time = dayTime(trade.tradeDate);
    if (!source || !Number.isFinite(time)) continue;
    endOfSource.set(source, Math.max(endOfSource.get(source) ?? Number.NEGATIVE_INFINITY, time));
    const key = homogeneousKey(trade.isin, trade.symbol, trade.assetCategory);
    if (!key) continue;
    let sources = sourcesOfKey.get(key);
    if (!sources) {
      sources = new Set();
      sourcesOfKey.set(key, sources);
    }
    sources.add(source);
  }
  // A broker with a statement end but no trades still counts as one of the
  // merged brokers, or its later statement end would stand in for the others.
  for (const [source, date] of endBySource) {
    const time = dayTime(date);
    if (Number.isFinite(time)) endOfSource.set(source, Math.max(endOfSource.get(source) ?? Number.NEGATIVE_INFINITY, time));
  }
  const coveredUntil = (key: string): number => {
    const sources = sourcesOfKey.get(key);
    if (endOfSource.size < 2 || !sources) return uploadEnd;
    return Math.min(...[...sources].map((source) => endOfSource.get(source)!));
  };

  const out = new Map<string, { key: string; sellDate: string; windowEnd: string; lastDate: string }>();
  for (const d of disposals) {
    if (WASH_SALE_EXEMPT.has(d.assetCategory) || d.quantity.isZero()) continue;
    const key = homogeneousKey(d.isin, d.symbol, d.assetCategory);
    if (!key) continue;
    const openLoss = d.gainLossEur.lessThan(0) && d.blockedLossEur.lessThan(d.gainLossEur.abs());
    const undoableRelease = d.reintegratedLossEur.greaterThan(0) && d.assetCategory !== "CRYPTO";
    if (!openLoss && !undoableRelease) continue;
    const sellDate = parseDate(d.sellDate);
    if (!Number.isFinite(sellDate.getTime())) continue;
    const windowEnd = addMonths(sellDate, windowMonths(d.assetCategory, d.isin, windows, normalizeDay(d.sellDate)));
    const lastTime = coveredUntil(key);
    if (windowEnd.getTime() <= lastTime) continue;
    const day = normalizeDay(d.sellDate);
    out.set(`${key}|${day}`, {
      key,
      sellDate: day,
      windowEnd: windowEnd.toISOString().slice(0, 10),
      lastDate: new Date(lastTime).toISOString().slice(0, 10),
    });
  }
  return [...out.values()];
}

/**
 * Whether FIFO still holds shares of a homogeneous key after a sale day, built
 * from the lots FIFO holds at the end and the disposals it booked. A lot is held
 * after day `t` if it entered the security on or before `t` and is either still
 * open or sold after `t`. The entry date is `entryDate` when FIFO set one (a
 * spin-off or merger lot keeps the parent's tax `acquireDate` but entered this
 * security on the corporate action's date), else `acquireDate`. Splits change the share count, never zero against non-zero, so
 * the test needs no split conversion. Without `remainingLots` it answers false
 * and the caller relies on the trades alone.
 */
function buildFifoHoldings(
  disposals: readonly FifoDisposal[],
  remainingLots: ReadonlyMap<string, readonly Lot[]> | undefined,
): (key: string, time: number) => boolean {
  if (!remainingLots) return () => false;
  const timeOf = (date: string): number => {
    const t = parseDate(date).getTime();
    // An unreadable acquisition date counts as held since forever: the total
    // exit then waits rather than releasing early.
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  };

  const firstOpenByKey = new Map<string, number>();
  for (const [mapKey, lots] of remainingLots) {
    for (const lot of lots) {
      if (lot.isShort || lot.quantity.lessThanOrEqualTo(0)) continue;
      // FIFO keys a lot like homogeneousKey, except a symbol-only lot keeps the
      // broker's case or a conid: rebuild it from the category prefix.
      const key = mapKey.startsWith("CRYPTO:")
        ? mapKey
        : lot.isin || `${mapKey.split(":")[0]}:${lot.symbol.toUpperCase()}`;
      const t = timeOf(lot.entryDate ?? lot.acquireDate);
      const prev = firstOpenByKey.get(key);
      if (prev === undefined || t < prev) firstOpenByKey.set(key, t);
    }
  }

  // Per key: [acquire, sell) spans sorted by acquire time, with the running
  // maximum sell time, so "any span with acquire ≤ t < sell" is one search.
  const spansByKey = new Map<string, { acquire: number; sell: number }[]>();
  for (const d of disposals) {
    if (d.isShort || WASH_SALE_EXEMPT.has(d.assetCategory)) continue;
    const key = homogeneousKey(d.isin, d.symbol, d.assetCategory);
    if (!key) continue;
    let spans = spansByKey.get(key);
    if (!spans) {
      spans = [];
      spansByKey.set(key, spans);
    }
    spans.push({ acquire: timeOf(d.entryDate ?? d.acquireDate), sell: parseDate(d.sellDate).getTime() });
  }
  const maxSellByKey = new Map<string, { acquire: number[]; maxSell: number[] }>();
  for (const [key, spans] of spansByKey) {
    spans.sort((a, b) => (a.acquire === b.acquire ? 0 : a.acquire < b.acquire ? -1 : 1));
    const acquire: number[] = [];
    const maxSell: number[] = [];
    let running = Number.NEGATIVE_INFINITY;
    for (const span of spans) {
      running = Math.max(running, span.sell);
      acquire.push(span.acquire);
      maxSell.push(running);
    }
    maxSellByKey.set(key, { acquire, maxSell });
  }

  return (key: string, time: number): boolean => {
    const firstOpen = firstOpenByKey.get(key);
    if (firstOpen !== undefined && firstOpen <= time) return true;
    const spans = maxSellByKey.get(key);
    if (!spans) return false;
    // Last span acquired on or before `time`.
    let lo = 0;
    let hi = spans.acquire.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (spans.acquire[mid]! <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 && spans.maxSell[lo - 1]! > time;
  };
}

/**
 * The id of the buy operation a BUY row belongs to. Brokers that list the
 * fills of one order as separate rows give them one order id: IBKR's
 * `ibOrderID` (its parser already collapses those fills into one trade), and
 * the order id DEGIRO and Flatex use as `tradeID`. Rows of one broker, account
 * and day with the same id are one operation; a GTC order filled on two days is
 * two purchases. A row with no id is an operation on its own.
 */
function buyOperationId(trade: Trade, time: number, index: number): string {
  const id = trade.ibOrderID || trade.tradeID;
  if (!id) return `row:${index}`;
  return `${trade.brokerSource ?? ""}|${trade.accountId}|${time}|${id}`;
}

/**
 * Per key, the split-adjusted long position after each day with trades, and
 * whether it ever goes below zero (a sale of shares the upload does not show).
 * A split multiplies the running position before the trades of its own day, as
 * `holdingAfter` converts them.
 */
function buildPositionSteps(
  positionEventsByAsset: ReadonlyMap<string, readonly PositionEvent[]>,
  splitsByAsset: ReadonlyMap<string, readonly SplitEvent[]>,
): Map<string, { steps: PositionStep[]; everNegative: boolean }> {
  const out = new Map<string, { steps: PositionStep[]; everNegative: boolean }>();
  for (const [key, events] of positionEventsByAsset) {
    const splits = splitsByAsset.get(key) ?? [];
    const steps: PositionStep[] = [];
    let position = new Decimal(0);
    let nextSplit = 0;
    let everNegative = false;
    for (let i = 0; i < events.length; ) {
      const time = events[i]!.time;
      while (nextSplit < splits.length && splits[nextSplit]!.time <= time) {
        position = position.mul(splits[nextSplit]!.num).div(splits[nextSplit]!.den);
        nextSplit++;
      }
      // At least one event per step: an unreadable date (NaN) equals no time.
      do {
        position = position.plus(events[i]!.qty);
        i++;
      } while (i < events.length && events[i]!.time === time);
      if (position.isNegative()) everNegative = true;
      steps.push({ time, position });
    }
    out.set(key, { steps, everNegative });
  }
  return out;
}

/**
 * Whether FIFO holds a share lot with no ISIN after day `t` (crypto and the
 * exempt categories aside): a lot still open that entered on or before `t`, or
 * one sold after `t` that entered on or before it. This also sees lots no BUY
 * row opened (a scrip dividend keyed on its bare symbol), whatever FIFO's key.
 * A lot's category is the prefix of FIFO's key; a key with none (a scrip or
 * merger lot) counts as shares.
 */
function buildUnidentifiedFifoHoldings(
  disposals: readonly FifoDisposal[],
  remainingLots: ReadonlyMap<string, readonly Lot[]> | undefined,
): (time: number) => boolean {
  const timeOf = (date: string): number => {
    const t = parseDate(date).getTime();
    // An unreadable entry date counts as held since forever (fail safe).
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  };
  let firstOpen = Number.POSITIVE_INFINITY;
  for (const [mapKey, lots] of remainingLots ?? []) {
    const category = mapKey.includes(":") ? mapKey.split(":")[0]! : "STK";
    if (category === "CRYPTO" || WASH_SALE_EXEMPT.has(category)) continue;
    for (const lot of lots) {
      if (lot.isin || lot.isShort || lot.quantity.lessThanOrEqualTo(0)) continue;
      firstOpen = Math.min(firstOpen, timeOf(lot.entryDate ?? lot.acquireDate));
    }
  }
  const spans = disposals
    .filter((d) => !d.isin && !d.isShort && d.assetCategory !== "CRYPTO" && !WASH_SALE_EXEMPT.has(d.assetCategory))
    .map((d) => ({ acquire: timeOf(d.entryDate ?? d.acquireDate), sell: parseDate(d.sellDate).getTime() }));
  return (time) => firstOpen <= time || spans.some((span) => span.acquire <= time && time < span.sell);
}

/**
 * Whether some account's long events ever end a day below zero: it sold shares
 * the upload never shows it bought. Manual opening lots belong to no uploaded
 * account, so any account may sell them: a day's shortfall is taken from them
 * first. Splits scale every balance before the trades of their day.
 */
function someAccountSoldUnbought(events: readonly LongEvent[], splits: readonly SplitEvent[]): boolean {
  const balances = new Map<string, Decimal>();
  let manual = new Decimal(0);
  let nextSplit = 0;
  for (let i = 0; i < events.length; ) {
    const time = events[i]!.time;
    while (nextSplit < splits.length && splits[nextSplit]!.time <= time) {
      const { num, den } = splits[nextSplit]!;
      manual = manual.mul(num).div(den);
      for (const [group, balance] of balances) balances.set(group, balance.mul(num).div(den));
      nextSplit++;
    }
    // At least one event per day: an unreadable date (NaN) equals no time.
    do {
      const ev = events[i]!;
      if (ev.group === MANUAL_GROUP) manual = manual.plus(ev.qty);
      else balances.set(ev.group, (balances.get(ev.group) ?? new Decimal(0)).plus(ev.qty));
      i++;
    } while (i < events.length && events[i]!.time === time);
    for (const [group, balance] of balances) {
      if (!balance.isNegative()) continue;
      if (manual.lessThan(balance.neg())) return true;
      manual = manual.plus(balance);
      balances.set(group, new Decimal(0));
    }
  }
  return false;
}

/** The account a trade or a holdings row belongs to: its broker and account id. */
function accountKey(source: string | undefined, accountId: string | undefined): string {
  return `${source ?? ""}\u0000${accountId ?? ""}`;
}

const DAY_MS = 86_400_000;

/**
 * Whether the uploaded files prove that no share of a key was held at the
 * window start (the second condition of the one-purchase exception). The
 * rule, for EVERY account (broker and account id) that trades the key or lists
 * it in any holdings list of the upload:
 *  1. it has a holdings list dated on or after the sale day (the earliest such
 *     date counts);
 *  2. its files with a trades section cover every day from the window start
 *     to that date exactly once: no gap (a hidden trade), no day in two files
 *     (the same trades counted twice). Back-to-back files qualify; a file with
 *     no trades section (a holdings-only Flex) covers nothing, though it can
 *     give the list;
 *  3. every row of the key in that list has a readable quantity (a missing one
 *     is no zero); a list with no row of the key says zero, but only when every
 *     row of shares in every list of the upload has an ISIN, so no row can be
 *     the key under another name (options, the other exempt categories and
 *     crypto aside; only an ISIN key has the 2-month window);
 *  4. the long holding listed equals what the account's own trades from the
 *     window start to that date leave, split-adjusted to that date's units,
 *     and no day of those trades ends with more sold than bought since the
 *     window start (a sale of shares held at the window start, hidden in the
 *     end total by a later buy);
 *  5. no share trade without an ISIN, of any account, falls between the
 *     window start and the latest of those list dates (or has no readable
 *     date): it may be this security, a purchase or a sale the ISIN's trades
 *     miss. No identifier ties such a trade to an ISIN in every file, so
 *     none is resolved.
 * Then the account held nothing at the window start: its list is that holding
 * plus its trades since. Each account is checked on its own, in its own list's
 * share units, and nothing is offset between accounts: a difference at one
 * account is unexplained (shares held before, or moved in or out) even if
 * another account shows the opposite one. So a transfer between two uploaded
 * accounts is unverified too (no parser documents transfers), and so is a
 * manual opening lot of the key dated on or after the window start (it belongs
 * to no uploaded account). A list holding nothing at all is a list only when
 * the file says it has the section (`hasPositions`, an empty IBKR
 * `<OpenPositions />`); rows a parser built from the file's own trades
 * (Revolut) always match them and are no list. Not visible to any check:
 * shares held at the window start that a transfer moves out of the upload
 * before the list date, or between uploaded accounts and out again (the
 * "applied" message says so).
 */
function buildEvidenceCheck(
  longEventsByAsset: ReadonlyMap<string, readonly LongEvent[]>,
  splitsByAsset: ReadonlyMap<string, readonly SplitEvent[]>,
  statements: readonly AccountStatement[],
  unidentifiedTradeTimes: readonly number[],
): (key: string, windowStart: number, sellTime: number) => boolean {
  const unidentified = unidentifiedTradeTimes
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b)
    .map((time) => ({ time }));
  const unidentifiedUndated = unidentified.length < unidentifiedTradeTimes.length;
  const dayTime = (date: string | undefined): number =>
    date ? parseDate(normalizeDate(date.trim()).slice(0, 10)).getTime() : Number.NaN;
  /** Per account: the periods its files cover, and its lists by date (null quantity = unreadable). */
  const accounts = new Map<string, { periods: [number, number][]; lists: Map<number, Map<string, Decimal | null>[]> }>();
  /** Per key: the accounts whose lists have a row of it. */
  const listedBy = new Map<string, Set<string>>();
  /** Whether some list row of shares has no ISIN (exempt categories and crypto aside). */
  let rowWithoutIsin = false;
  for (const st of statements) {
    const id = accountKey(st.source, st.accountId);
    let account = accounts.get(id);
    if (!account) {
      account = { periods: [], lists: new Map() };
      accounts.set(id, account);
    }
    const from = dayTime(st.fromDate);
    const to = dayTime(st.toDate);
    if (st.hasTrades && Number.isFinite(from) && Number.isFinite(to) && from <= to) account.periods.push([from, to]);
    const rows = st.positions.filter((pos) => !pos.fromTrades);
    // No rows is a list of nothing only when the file has the section.
    if (rows.length === 0 && (st.positions.length > 0 || !st.hasPositions)) continue;
    const list = new Map<string, Decimal | null>();
    for (const pos of rows) {
      const key = homogeneousKey(pos.isin, pos.symbol, pos.assetCategory);
      if (!pos.isin && !WASH_SALE_EXEMPT.has(pos.assetCategory) && pos.assetCategory !== "CRYPTO") rowWithoutIsin = true;
      if (!key) continue;
      let ids = listedBy.get(key);
      if (!ids) {
        ids = new Set();
        listedBy.set(key, ids);
      }
      ids.add(id);
      const qty = pos.quantityUnknown ? null : readQuantity(pos.quantity);
      const prev = list.get(key);
      list.set(key, prev === null || qty === null ? null : (prev ?? new Decimal(0)).plus(qty));
    }
    if (!Number.isFinite(to)) continue;
    const lists = account.lists.get(to);
    if (lists) lists.push(list);
    else account.lists.set(to, [list]);
  }
  for (const account of accounts.values()) account.periods.sort((a, b) => a[0] - b[0]);

  return (key: string, windowStart: number, sellTime: number): boolean => {
    // Only an ISIN key reaches here (the 2-month window needs one). A list row
    // of shares with no ISIN may be the key under another name, so then "no
    // row of the key" proves nothing.
    if (key.includes(":") || rowWithoutIsin) return false;
    const events = longEventsByAsset.get(key) ?? [];
    const splits = splitsByAsset.get(key) ?? [];
    const relevant = new Set(listedBy.get(key));
    for (const ev of events) {
      if (ev.group !== MANUAL_GROUP) relevant.add(ev.group);
      else if (ev.time >= windowStart) return false;
    }
    if (relevant.size === 0) return false;
    let lastListTime = windowStart;
    for (const id of relevant) {
      const account = accounts.get(id);
      if (!account) return false;
      let listTime = Number.POSITIVE_INFINITY;
      for (const time of account.lists.keys()) if (time >= sellTime && time < listTime) listTime = time;
      if (!Number.isFinite(listTime) || !coversDaysOnce(account.periods, windowStart, listTime)) return false;
      let listed: Decimal | undefined;
      for (const list of account.lists.get(listTime)!) {
        const value = list.get(key);
        const qty = value === undefined ? new Decimal(0) : value;
        // Unreadable, or two files of the account on that date that disagree.
        if (qty === null || (listed !== undefined && !listed.eq(qty))) return false;
        listed = qty;
      }
      // A short position is no share held.
      const held = Decimal.max(listed!, 0);
      const explained = longPositionAt(events, splits, id, windowStart, listTime);
      if (explained === null || !held.minus(explained).abs().lessThan("1e-9")) return false;
      lastListTime = Math.max(lastListTime, listTime);
    }
    // A share trade with no ISIN in that span may be this security.
    return !unidentifiedUndated && firstIndexAtOrAfter(unidentified, windowStart) === firstIndexAfter(unidentified, lastListTime);
  };
}

/**
 * Whether the periods (sorted by start) cover every day from `start` to `end`
 * exactly once: no gap, and no day of that span in two periods.
 */
function coversDaysOnce(periods: readonly [number, number][], start: number, end: number): boolean {
  /** Last day of the span covered so far. */
  let reach = start - DAY_MS;
  for (const [from, to] of periods) {
    if (to < start) continue;
    if (from > end) break;
    if (from <= reach && reach >= start) return false;
    if (from > reach + DAY_MS) return false;
    reach = Math.max(reach, to);
  }
  return reach >= end;
}

/** A holdings quantity, or null when it is missing or unreadable. */
function readQuantity(quantity: string): Decimal | null {
  try {
    const qty = new Decimal(quantity.trim());
    return qty.isFinite() ? qty : null;
  } catch {
    return null;
  }
}

/**
 * The split-adjusted long position one account's events from `from` leave at
 * the end of `until`, in that day's units, or null when it ends a day below
 * zero (a sale of shares held before `from`). Same-day trades have no order.
 */
function longPositionAt(
  events: readonly LongEvent[],
  splits: readonly SplitEvent[],
  group: string,
  from: number,
  until: number,
): Decimal | null {
  let position = new Decimal(0);
  let nextSplit = 0;
  const applySplitsUpTo = (time: number): void => {
    while (nextSplit < splits.length && splits[nextSplit]!.time <= time) {
      position = position.mul(splits[nextSplit]!.num).div(splits[nextSplit]!.den);
      nextSplit++;
    }
  };
  const own = events.filter((ev) => ev.time >= from && ev.time <= until && ev.group === group);
  for (let i = 0; i < own.length; i++) {
    applySplitsUpTo(own[i]!.time);
    position = position.plus(own[i]!.qty);
    if (own[i + 1]?.time !== own[i]!.time && position.isNegative()) return null;
  }
  applySplitsUpTo(until);
  return position;
}

/** Parse a trade quantity string to an absolute Decimal (never NaN/negative). */
function parseQty(q: string): Decimal {
  try {
    const d = new Decimal(q);
    return d.isFinite() ? d.abs() : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

/** First index of the time-sorted `events` whose time is strictly after `time` (length if none). */
function firstIndexAfter(events: readonly { time: number }[], time: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid]!.time > time) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** First index of the time-sorted `events` whose time is at or after `time` (length if none). */
function firstIndexAtOrAfter(events: readonly { time: number }[], time: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid]!.time >= time) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Normalize a date string (YYYY-MM-DD or YYYYMMDD) to YYYY-MM-DD for ledger keys. */
function normalizeDay(date: string): string {
  const t = date.trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return t.slice(0, 10);
}

function buildSplitEvents(
  corporateActions: CorporateAction[],
  splitRatios: ReadonlyMap<string, { num: Decimal; den: Decimal }>,
): Map<string, SplitEvent[]> {
  const splitsByAsset = new Map<string, SplitEvent[]>();
  const seen = new Set<string>();

  for (const action of corporateActions) {
    if (action.type !== "FS" && action.type !== "RS") continue;
    // Same ratio as FIFO: from the description, or the one FIFO sized from the
    // holding when the broker gives only the shares added. A split FIFO did not
    // apply has no ratio and is skipped here too.
    const ratioMatch = action.description.match(/SPLIT\s+(\d+)\s+FOR\s+(\d+)/i);
    const applied = ratioMatch ? undefined : splitRatios.get(action.transactionID);
    if (!ratioMatch && !applied) continue;
    const numerator = ratioMatch ? new Decimal(ratioMatch[1]!) : applied!.num;
    const denominator = ratioMatch ? new Decimal(ratioMatch[2]!) : applied!.den;
    if (numerator.lessThanOrEqualTo(0) || denominator.lessThanOrEqualTo(0)) continue;

    const key = corporateActionKey(action);
    if (!key) continue;
    const date = normalizeDay(action.dateTime);
    const dedupeKey = `${key}:${date}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    let splits = splitsByAsset.get(key);
    if (!splits) {
      splits = [];
      splitsByAsset.set(key, splits);
    }
    splits.push({ time: parseDate(date).getTime(), num: numerator, den: denominator });
  }

  for (const splits of splitsByAsset.values()) {
    splits.sort((a, b) => a.time - b.time);
  }
  return splitsByAsset;
}

function corporateActionKey(action: CorporateAction): string {
  if (action.isin) return action.isin;
  if (action.symbol) return `STK:${action.symbol.toUpperCase()}`;
  return "";
}

function splitFactorBetween(
  splitsByAsset: Map<string, SplitEvent[]>,
  key: string,
  fromTime: number,
  toTime: number,
): SplitConversion {
  let num = new Decimal(1);
  let den = new Decimal(1);
  if (fromTime >= toTime) return { num, den };

  for (const split of splitsByAsset.get(key) ?? []) {
    if (split.time <= fromTime) continue;
    if (split.time > toTime) break;
    num = num.mul(split.num);
    den = den.mul(split.den);
  }
  return { num, den };
}

function buyQtyConversionToSellUnits(
  splitsByAsset: Map<string, SplitEvent[]>,
  key: string,
  buyTime: number,
  sellTime: number,
): SplitConversion {
  if (buyTime < sellTime) {
    return splitFactorBetween(splitsByAsset, key, buyTime, sellTime);
  }
  if (buyTime > sellTime) {
    const inverse = splitFactorBetween(splitsByAsset, key, sellTime, buyTime);
    return { num: inverse.den, den: inverse.num };
  }
  return { num: new Decimal(1), den: new Decimal(1) };
}

/**
 * Choose the anti-churning window length in calendar months.
 *
 * Art. 33.5.f/g LIRPF distinguishes by whether the security is admitted to
 * trading on a regulated market:
 *  - **2 months** on a regulated market of the European Economic Area, or on a
 *    third-country market the European Commission declared equivalent (the US,
 *    e.g. NYSE and Nasdaq: DGT V0778-25; Australia; Hong Kong; the EMIR
 *    decisions name Toronto, Tokyo and Singapore, open for shares).
 *  - **1 year (12 months)** on neither (unlisted shares, OTC-only securities
 *    such as OTC Markets / pink sheets, shares listed only on the London Stock
 *    Exchange from 2021 or on SIX from July 2019).
 * Crypto gets 12 months too, but under 33.5.e: the window runs from the sale to
 * 12 months after it and never looks back (`looksBack`, #457).
 *
 * Order (#452):
 *  - CRYPTO → 12 months, after the sale only (33.5.e). Nothing overrides it.
 *  - The ISIN's resolved window on the sale day (`resolveIsinWindow`): the
 *    user's value, else 12 when every IBKR listing code of the ISIN is a
 *    letter-g market that day.
 *  - Otherwise a heuristic: WITH a real ISIN → treated as listed (2 months);
 *    with NO ISIN → treated as unlisted (12 months).
 *
 * LIMITATION: with no IBKR code and no user value, a security with an ISIN
 * gets 2 months even if it trades only OTC or only in London (the report and
 * the guide point to the per-ISIN setting), and a listed security that arrives
 * without an ISIN gets 12.
 */
function windowMonths(assetCategory: string, isin: string, windows: ReadonlyMap<string, IsinWindow>, sellDay: string): number {
  if (assetCategory === "CRYPTO") return 12;
  const resolved = isin ? resolveIsinWindow(windows.get(isin), sellDay) : undefined;
  if (resolved) return resolved.months;
  if (isin && LISTED_CATEGORIES.has(assetCategory)) return 2;
  // No ISIN (and not a recognized listed category) → assume unlisted.
  return isin ? 2 : 12;
}

/**
 * Whether the window also reaches back before the sale. Letters f and g count
 * «valores homogéneos» bought in the months «anteriores o posteriores»; letter e,
 * which applies to crypto, counts only a reacquisition «dentro del año siguiente
 * a la fecha de dicha transmisión» (#457).
 */
function looksBack(assetCategory: string): boolean {
  return assetCategory !== "CRYPTO";
}

function homogeneousKey(isin: string, symbol: string, assetCategory: string): string {
  if (assetCategory === "CRYPTO") return `CRYPTO:${symbol.toUpperCase()}`;
  if (isin) return isin;
  if (symbol) return `${assetCategory}:${symbol.toUpperCase()}`;
  return "";
}
