/**
 * Anti-churning rule detector (Art. 33.5.f/g LIRPF) — PROPORTIONAL blocking.
 *
 * Spanish tax law blocks capital losses if homogeneous securities are
 * repurchased within:
 * - **2 calendar months** before or after the sale — for securities admitted
 *   to trading on a regulated market of the European Economic Area (33.5.f) or
 *   on a third-country market the European Commission declared equivalent:
 *   only the US (NYSE, Nasdaq: DGT V0778-25, Implementing Decision (EU)
 *   2017/2320), Australia (2017/2318) and Hong Kong (2017/2319).
 * - **1 year** before or after the sale — for securities admitted to neither
 *   (33.5.g): unlisted shares, OTC-only securities, shares listed only on a
 *   third-country market with no equivalence decision (London, SIX, Toronto).
 * Crypto is no «valor o participación»: the law applies 33.5.e to it (only a
 * repurchase in the year after the sale counts); the engine gives it ±1 year
 * (#457).
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
 * Detect wash sales: compute PROPORTIONAL blocked losses and release pending
 * losses on definitive transmissions, in ONE chronological pass (Art. 33.5.f/g
 * LIRPF).
 *
 * Per homogeneous key the pass keeps (a) a FIFO budget of in-window repurchase
 * quantities and (b) a queue of pending losses, oldest first, counted in shares.
 * For each (key, sell day) in date order, over all of that day's disposals:
 *  1. ABSORB — take the in-window repurchases not yet used (a buy ON the sell
 *     date is the lot being sold, excluded): for loss lots always, for gain lots
 *     only while losses are pending (they need them for the definitive test).
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
  for (const trade of [...allTrades].sort(compareFifoTradeOrder)) {
    if (WASH_SALE_EXEMPT.has(trade.assetCategory)) continue;
    const key = homogeneousKey(trade.isin, trade.symbol, trade.assetCategory);
    if (!key) continue;
    const qty = parseQty(trade.quantity);
    if (qty.lessThanOrEqualTo(0)) continue;
    const d = parseDate(trade.tradeDate);
    const time = d.getTime();

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
        events.push({ time, date: normalizeDay(trade.tradeDate), remainingQty: repurchased });
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
  const filesProveNoShares = buildEvidenceCheck(longEventsByAsset, splitsByAsset, coverage.statements ?? []);

  // Pending-loss queue per key, oldest first. A blocked loss does not belong to
  // one lot: any later definitive transmission of homogeneous shares releases it.
  // Entries are appended in sell-time order and released from the front, so the
  // spent ones are a prefix that `head` skips.
  const pendingByAsset = new Map<string, { entries: PendingLoss[]; head: number }>();

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
  //    start, is exactly what its trades since the window start leave
  //    (`buildEvidenceCheck`). A start date alone proves nothing.
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
    if (!steps || steps.everNegative) return "unverified";
    return filesProveNoShares(key, windowStart, sellTime) ? "applied" : "unverified";
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

    // 1. ABSORB: the in-window homogeneous repurchases not yet used by an earlier
    //    transmission. A loss lot needs them to block its own loss; while losses
    //    are pending every sold share, gain or loss, needs them for the definitive
    //    test («con independencia de que determinen ganancias o pérdidas»,
    //    V3282-18), and a rebuy counted there is used up (V0248-18). With nothing
    //    pending a gain lot has nothing to test and uses no rebuy, and a short
    //    cover never has one.
    const seekers = idxs.filter((idx) => isLossAt(idx) || (hasPending && !isShortAt(idx)));
    const need = seekers.reduce((sum, idx) => sum.plus(result[idx]!.quantity.abs()), new Decimal(0));
    let dayAbsorbed = new Decimal(0);
    const consumed: { date: string; qty: Decimal }[] = [];
    const buyEvents = buysByAsset.get(key);
    if (buyEvents && need.greaterThan(0)) {
      const first = result[idxs[0]!]!;
      const months = windowMonths(first.assetCategory, first.isin);
      const windowStart = addMonths(sellDate, -months).getTime();
      const windowEnd = addMonths(sellDate, months).getTime();

      // Consume repurchase quantity from in-window buys, excluding any buy on the
      // sell day (the lot being sold, not a repurchase). Absorbed ≤ `need`.
      //
      // Order matters. A POST-sale buy is a genuine surviving replacement, so it
      // remains uncapped and is consumed first. A PRE-sale buy can only block the
      // portion that still remains after this sale day; if the day fully exits the
      // position, DGT V3282-18(1) allows the loss in full because no homogeneous
      // shares remain in the patrimony.
      let remainingToAbsorb = need;
      // buyEvents is sorted by time, so each pass walks only its slice of the
      // window, found by binary search: (sellTime, windowEnd] forward for post-sale
      // buys, [windowStart, sellTime) backward for pre-sale ones. Same-day buys are
      // outside both slices.
      // With `commit` false it only measures what it would take.
      const consume = (from: number, to: number, step: 1 | -1, maxQty: Decimal, commit = true): Decimal => {
        let remainingBudget = maxQty;
        let left = remainingToAbsorb;
        for (let i = from; i !== to; i += step) {
          const ev = buyEvents[i]!;
          if (left.lessThanOrEqualTo(0)) break;
          if (remainingBudget.lessThanOrEqualTo(0)) break;
          if (ev.remainingQty.lessThanOrEqualTo(0)) continue;
          const conversion = buyQtyConversionToSellUnits(splitsByAsset, key, ev.time, sellTime);
          const availableAtSell = ev.remainingQty.mul(conversion.num).div(conversion.den);
          if (availableAtSell.lessThanOrEqualTo(0)) continue;
          const take = Decimal.min(availableAtSell, left, remainingBudget);
          left = left.minus(take);
          remainingBudget = remainingBudget.minus(take);
          if (!commit) continue;
          ev.remainingQty = ev.remainingQty.minus(take.mul(conversion.den).div(conversion.num));
          consumed.push({ date: ev.date, qty: take });
        }
        const taken = remainingToAbsorb.minus(left);
        if (commit) remainingToAbsorb = left;
        return taken;
      };
      // post-sale repurchases first (surviving replacements). The one-purchase
      // exception never reaches them: «sin perjuicio de que las recompras
      // efectuadas en el plazo de los dos meses posteriores a la transmisión
      // impidan también la imputación» (V3282-18, B).
      consume(firstIndexAfter(buyEvents, sellTime), firstIndexAfter(buyEvents, windowEnd), 1, need);
      // FIFO leaves the newest pre-sale lots behind after a partial sale, so take
      // capped pre-sale repurchases newest-first, from the lots that survive.
      const preFrom = firstIndexAtOrAfter(buyEvents, sellTime) - 1;
      const preTo = firstIndexAtOrAfter(buyEvents, windowStart) - 1;
      const preCap = holdingAfter(key, sellTime);
      // The one-purchase exception lifts only this pre-sale rule, and the
      // doctrine states it for the 2-month window of letter f only: the 1-year
      // window (letter g, crypto) keeps the rule. Checked only where the
      // pre-sale purchases would take something, so a sale it cannot change
      // carries no mark. The same test decides whether a sale is definitive
      // («los mismos criterios», V3282-18), because loss and gain lots share
      // this absorption.
      let skipPreSale = false;
      if (months === 2 && consume(preFrom, preTo, -1, preCap, false).greaterThan(0)) {
        const status = singlePurchase(key, windowStart, sellTime);
        if (status) {
          for (const idx of idxs) if (!isShortAt(idx)) result[idx]!.washSaleSinglePurchase = status;
        }
        skipPreSale = status === "applied";
      }
      if (!skipPreSale) consume(preFrom, preTo, -1, preCap);
      dayAbsorbed = need.minus(remainingToAbsorb);
    }

    // Hand the absorbed shares to the day's lots. Of the shares sold, the ones a
    // rebuy replaces are the last acquired: the deductible part is the shares
    // acquired first (V0913-08, V1294-22, Art. 37.2). Loss lots take them before
    // gain lots, so a loss lot of the sale stays blocked (V0279-25) and a pending
    // loss elsewhere cannot hand its rebuy to a gain lot. Each lot keeps the
    // dates of the repurchases it took, for the display trail.
    const absorbedOf = new Map<number, Decimal>();
    const datesOf = new Map<number, Set<string>>();
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
      let toCover = take;
      while (toCover.greaterThan(0) && chunk < consumed.length) {
        const c = consumed[chunk]!;
        const part = Decimal.min(c.qty, toCover);
        dates.add(c.date);
        c.qty = c.qty.minus(part);
        toCover = toCover.minus(part);
        if (c.qty.lessThanOrEqualTo(0)) chunk++;
      }
      datesOf.set(idx, dates);
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
    if (queue && hasPending) {
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
    //    day of short covers only is no exit.
    if (
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
      pending.entries.push({ qty: absorbed, eur: blocked, time: sellTime, sellDate: normalizeDay(disposal.sellDate) });
    }
  }

  return result;
}

/**
 * The sales (one per security and sale day, as the detector groups them) whose
 * anti-churning result a buy after the loaded data could still change, with
 * the last day of each one's window and the last date the data covers for it.
 * The detector sees only the uploaded trades, so a repurchase after that date
 * is invisible. It matters for a loss not fully blocked (the buy would block
 * more of it, the BLOCK step) and for a sale that released pending losses (the
 * buy would make its shares non-definitive, the RELEASE and TOTAL EXIT steps).
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
 */
export function salesWithWindowPastData(
  disposals: readonly FifoDisposal[],
  lastLoadedDate: string,
  trades: readonly Trade[] = [],
  endBySource: ReadonlyMap<string, string> = new Map(),
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
    if (!openLoss && !d.reintegratedLossEur.greaterThan(0)) continue;
    const sellDate = parseDate(d.sellDate);
    if (!Number.isFinite(sellDate.getTime())) continue;
    const windowEnd = addMonths(sellDate, windowMonths(d.assetCategory, d.isin));
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
 *  2. its files cover it without a gap from the window start to that date
 *     (adjacent or overlapping periods qualify);
 *  3. every row of the key in that list has a readable quantity (a missing one
 *     is no zero); a list with no row of the key says zero;
 *  4. the long holding listed equals what the account's own trades from the
 *     window start to that date leave, split-adjusted to that date's units.
 * Then the account held nothing at the window start: its list is that holding
 * plus its trades since. Each account is checked on its own, in its own list's
 * share units, and nothing is offset between accounts: a difference at one
 * account is unexplained (shares held before, or moved in or out) even if
 * another account shows the opposite one. So a transfer between two uploaded
 * accounts is unverified too (no parser documents transfers), and so is a
 * manual opening lot of the key dated on or after the window start (it belongs
 * to no uploaded account). A list holding nothing at all cannot be told apart
 * from a file without the section, and rows a parser built from the file's own
 * trades (Revolut) always match them: neither is a list. Not visible to any
 * check: shares held at the window start that leave the upload by a transfer
 * before the list date (the "applied" message says so).
 */
function buildEvidenceCheck(
  longEventsByAsset: ReadonlyMap<string, readonly LongEvent[]>,
  splitsByAsset: ReadonlyMap<string, readonly SplitEvent[]>,
  statements: readonly AccountStatement[],
): (key: string, windowStart: number, sellTime: number) => boolean {
  const dayTime = (date: string | undefined): number =>
    date ? parseDate(normalizeDate(date.trim()).slice(0, 10)).getTime() : Number.NaN;
  /** Per account: the periods its files cover, and its lists by date (null quantity = unreadable). */
  const accounts = new Map<string, { periods: [number, number][]; lists: Map<number, Map<string, Decimal | null>[]> }>();
  /** Per key: the accounts whose lists have a row of it. */
  const listedBy = new Map<string, Set<string>>();
  for (const st of statements) {
    const id = accountKey(st.source, st.accountId);
    let account = accounts.get(id);
    if (!account) {
      account = { periods: [], lists: new Map() };
      accounts.set(id, account);
    }
    const from = dayTime(st.fromDate);
    const to = dayTime(st.toDate);
    if (Number.isFinite(from) && Number.isFinite(to) && from <= to) account.periods.push([from, to]);
    const rows = st.positions.filter((pos) => !pos.fromTrades);
    if (rows.length === 0) continue;
    const list = new Map<string, Decimal | null>();
    for (const pos of rows) {
      const key = homogeneousKey(pos.isin, pos.symbol, pos.assetCategory);
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
    const events = longEventsByAsset.get(key) ?? [];
    const splits = splitsByAsset.get(key) ?? [];
    const relevant = new Set(listedBy.get(key));
    for (const ev of events) {
      if (ev.group !== MANUAL_GROUP) relevant.add(ev.group);
      else if (ev.time >= windowStart) return false;
    }
    if (relevant.size === 0) return false;
    for (const id of relevant) {
      const account = accounts.get(id);
      if (!account) return false;
      let listTime = Number.POSITIVE_INFINITY;
      for (const time of account.lists.keys()) if (time >= sellTime && time < listTime) listTime = time;
      if (!Number.isFinite(listTime) || !coversDays(account.periods, windowStart, listTime)) return false;
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
      if (!held.minus(longPositionAt(events, splits, id, windowStart, listTime)).abs().lessThan("1e-9")) return false;
    }
    return true;
  };
}

/** Whether the periods (sorted by start) cover every day from `start` to `end` without a gap. */
function coversDays(periods: readonly [number, number][], start: number, end: number): boolean {
  let reach = start - DAY_MS;
  for (const [from, to] of periods) {
    if (to <= reach) continue;
    if (from > reach + DAY_MS) return false;
    reach = to;
    if (reach >= end) return true;
  }
  return false;
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

/** The split-adjusted long position one account's events from `from` leave at the end of `until`, in that day's units. */
function longPositionAt(
  events: readonly LongEvent[],
  splits: readonly SplitEvent[],
  group: string,
  from: number,
  until: number,
): Decimal {
  let position = new Decimal(0);
  let nextSplit = 0;
  const applySplitsUpTo = (time: number): void => {
    while (nextSplit < splits.length && splits[nextSplit]!.time <= time) {
      position = position.mul(splits[nextSplit]!.num).div(splits[nextSplit]!.den);
      nextSplit++;
    }
  };
  for (const ev of events) {
    if (!(ev.time >= from && ev.time <= until) || ev.group !== group) continue;
    applySplitsUpTo(ev.time);
    position = position.plus(ev.qty);
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
 *    e.g. NYSE and Nasdaq: DGT V0778-25; Australia; Hong Kong).
 *  - **1 year (12 months)** on neither (unlisted shares, OTC-only securities
 *    such as OTC Markets / pink sheets, shares listed only on the London Stock
 *    Exchange, SIX or Toronto).
 * Crypto gets 12 months here; the law applies 33.5.e to it, which counts only
 * a repurchase in the year after the sale (#457, not handled).
 *
 * We have no reliable "is listed" flag from the brokers, so we use a heuristic:
 *  - CRYPTO → always unlisted (12 months).
 *  - STK/FUND/BOND WITH a real ISIN → treated as listed (2 months).
 *  - Anything else with NO ISIN → treated as unlisted (12 months).
 *
 * LIMITATION (#452): a real ISIN does not guarantee admission to a regulated or
 * equivalent market (some ISIN-bearing instruments trade only OTC, or only on a
 * third-country market with no equivalence decision such as the London Stock
 * Exchange, where the statute gives 1 year and we apply 2 months), and conversely a few
 * listed instruments may arrive without an ISIN. This is a conservative
 * approximation; precise classification would require per-instrument market
 * admission data we do not collect.
 */
function windowMonths(assetCategory: string, isin: string): number {
  if (assetCategory === "CRYPTO") return 12;
  if (isin && LISTED_CATEGORIES.has(assetCategory)) return 2;
  // No ISIN (and not a recognized listed category) → assume unlisted.
  return isin ? 2 : 12;
}

function homogeneousKey(isin: string, symbol: string, assetCategory: string): string {
  if (assetCategory === "CRYPTO") return `CRYPTO:${symbol.toUpperCase()}`;
  if (isin) return isin;
  if (symbol) return `${assetCategory}:${symbol.toUpperCase()}`;
  return "";
}
