/**
 * Anti-churning rule detector (Art. 33.5.f/g LIRPF) — PROPORTIONAL blocking.
 *
 * Spanish tax law blocks capital losses if homogeneous securities are
 * repurchased within:
 * - **2 calendar months** before or after the sale — for securities
 *   admitted to trading on regulated markets (STK, FUND, BOND on MiFID venues).
 * - **1 year** before or after the sale — for securities NOT admitted
 *   to trading on regulated markets (most crypto, unlisted shares, etc.).
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
 * @returns Disposals with `blockedLossEur`, `reintegratedLossEur`, `washSaleBlocked`
 *   and the display trails `washSaleRepurchaseDates` / `washSaleReleasedFromDates` set
 */
export function detectWashSales(
  disposals: FifoDisposal[],
  allTrades: Trade[],
  corporateActions: CorporateAction[] = [],
  splitRatios: ReadonlyMap<string, { num: Decimal; den: Decimal }> = new Map(),
  remainingLots?: ReadonlyMap<string, readonly Lot[]>,
): FifoDisposal[] {
  // Shares bought back on each (key, day) to close a short, from FIFO's short
  // disposals. They go straight back to the lender and never stay in the
  // patrimony, so they are no repurchase (fx-fifo.ts does not count a cover as a
  // purchase either). Without this, a cover buy could block a loss that nothing
  // ever releases, because a cover is no «transmisión definitiva».
  const coveredLeft = new Map<string, Decimal>();
  for (const d of disposals) {
    if (d.isShort !== true || WASH_SALE_EXEMPT.has(d.assetCategory)) continue;
    const key = homogeneousKey(d.isin, d.symbol, d.assetCategory);
    if (!key) continue;
    const dayKey = `${key}|${parseDate(d.sellDate).getTime()}`;
    coveredLeft.set(dayKey, (coveredLeft.get(dayKey) ?? new Decimal(0)).plus(d.quantity.abs()));
  }

  // Index in-window-eligible BUY events and signed position movements by key.
  const buysByAsset = new Map<string, BuyEvent[]>();
  const positionEventsByAsset = new Map<string, PositionEvent[]>();
  for (const trade of allTrades) {
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

    if (trade.buySell === "BUY") {
      positionEvents.push({ time, qty });
      // FIFO sends a BUY flagged "C" or "C;O" to the open short lots first
      // (fifo.ts consumeShortLots). Only what is left after the cover becomes a
      // held lot. A "C" buy with no open short books nothing at all.
      let repurchased = qty;
      const oci = trade.openCloseIndicator;
      if (oci === "C" || oci === "C;O") {
        const dayKey = `${key}|${time}`;
        const left = coveredLeft.get(dayKey) ?? new Decimal(0);
        const covered = Decimal.min(qty, left);
        coveredLeft.set(dayKey, left.minus(covered));
        repurchased = oci === "C" && covered.isZero() ? new Decimal(0) : qty.minus(covered);
      }
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
    }
  }
  for (const events of buysByAsset.values()) {
    events.sort((a, b) => a.time - b.time);
  }
  for (const events of positionEventsByAsset.values()) {
    events.sort((a, b) => a.time - b.time);
  }
  const splitsByAsset = buildSplitEvents(corporateActions, splitRatios);

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
      const consume = (from: number, to: number, step: 1 | -1, maxQty: Decimal): void => {
        let remainingBudget = maxQty;
        for (let i = from; i !== to; i += step) {
          const ev = buyEvents[i]!;
          if (remainingToAbsorb.lessThanOrEqualTo(0)) break;
          if (remainingBudget.lessThanOrEqualTo(0)) break;
          if (ev.remainingQty.lessThanOrEqualTo(0)) continue;
          const conversion = buyQtyConversionToSellUnits(splitsByAsset, key, ev.time, sellTime);
          const availableAtSell = ev.remainingQty.mul(conversion.num).div(conversion.den);
          if (availableAtSell.lessThanOrEqualTo(0)) continue;
          const take = Decimal.min(availableAtSell, remainingToAbsorb, remainingBudget);
          ev.remainingQty = ev.remainingQty.minus(take.mul(conversion.den).div(conversion.num));
          remainingToAbsorb = remainingToAbsorb.minus(take);
          remainingBudget = remainingBudget.minus(take);
          consumed.push({ date: ev.date, qty: take });
        }
      };
      // post-sale repurchases first (surviving replacements)
      consume(firstIndexAfter(buyEvents, sellTime), firstIndexAfter(buyEvents, windowEnd), 1, need);
      // FIFO leaves the newest pre-sale lots behind after a partial sale, so take
      // capped pre-sale repurchases newest-first, from the lots that survive.
      consume(
        firstIndexAtOrAfter(buyEvents, sellTime) - 1,
        firstIndexAtOrAfter(buyEvents, windowStart) - 1,
        -1,
        holdingAfter(key, sellTime),
      );
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
      const lastIdx = idxs[idxs.length - 1]!;
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
 * end from `endBySource` when later.
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
  for (const [source, date] of endBySource) {
    const time = dayTime(date);
    if (endOfSource.has(source) && Number.isFinite(time)) endOfSource.set(source, Math.max(endOfSource.get(source)!, time));
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
 *  - **2 months** for listed securities (regulated markets).
 *  - **1 year (12 months)** for securities NOT admitted to trading
 *    (crypto, unlisted shares, etc.).
 *
 * We have no reliable "is listed" flag from the brokers, so we use a heuristic:
 *  - CRYPTO → always unlisted (12 months).
 *  - STK/FUND/BOND WITH a real ISIN → treated as listed (2 months).
 *  - Anything else with NO ISIN → treated as unlisted (12 months).
 *
 * LIMITATION: a real ISIN does not strictly guarantee admission to a regulated
 * market (some ISIN-bearing instruments are unlisted/OTC), and conversely a few
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
