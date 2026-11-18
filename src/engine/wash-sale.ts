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
 * «transmisión definitiva» of homogeneous shares, one with no unused repurchase
 * in its own window, gain or loss (DGT V3282-18, V1760-23). Pending losses form
 * a per-security queue counted in shares; each definitive share releases the
 * oldest pending share's loss, tracked as `reintegratedLossEur` on that
 * disposal. See docs/design/antichurning-proportional.md for the full contract
 * and citations.
 */

import type { FifoDisposal } from "../types/tax.js";
import type { Trade, CorporateAction } from "../types/ibkr.js";
import Decimal from "decimal.js";
import { parseDate } from "./dates.js";

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
 * For each disposal in sell-date order:
 *  1. ABSORB — take the in-window repurchases not yet used (a buy ON the sell
 *     date is the lot being sold, excluded): for a loss sale always, for a gain
 *     sale only while losses are pending (it needs them for the definitive test).
 *  2. RELEASE — the shares no rebuy absorbed are a «transmisión definitiva»;
 *     each releases one pending share's loss, oldest first (`reintegratedLossEur`).
 *  3. TOTAL EXIT — a definitive sale day that leaves no shares releases every
 *     loss still pending.
 *  4. BLOCK (losses only) — defer `|loss| × absorbed/qty` and append it to the
 *     queue. The same absorbed shares keep the old losses pending.
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
 * @returns Disposals with `blockedLossEur`, `reintegratedLossEur`, `washSaleBlocked`
 *   and the display trails `washSaleRepurchaseDates` / `washSaleReleasedFromDates` set
 */
export function detectWashSales(
  disposals: FifoDisposal[],
  allTrades: Trade[],
  corporateActions: CorporateAction[] = [],
  splitRatios: ReadonlyMap<string, { num: Decimal; den: Decimal }> = new Map(),
): FifoDisposal[] {
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
      let events = buysByAsset.get(key);
      if (!events) {
        events = [];
        buysByAsset.set(key, events);
      }
      events.push({ time, date: normalizeDay(trade.tradeDate), remainingQty: qty });
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
  const holdingAfterBudgetByAssetTime = new Map<string, Map<number, Decimal>>();

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

  const remainingHoldingBudget = (key: string, sellTime: number): Decimal => {
    let perTime = holdingAfterBudgetByAssetTime.get(key);
    if (!perTime) {
      perTime = new Map();
      holdingAfterBudgetByAssetTime.set(key, perTime);
    }
    let budget = perTime.get(sellTime);
    if (!budget) {
      budget = holdingAfter(key, sellTime);
      perTime.set(sellTime, budget);
    }
    return budget;
  };

  const consumeHoldingBudget = (key: string, sellTime: number, consumedQty: Decimal): void => {
    if (consumedQty.lessThanOrEqualTo(0)) return;
    const perTime = holdingAfterBudgetByAssetTime.get(key);
    if (!perTime) return;
    const current = perTime.get(sellTime) ?? new Decimal(0);
    perTime.set(sellTime, Decimal.max(current.minus(consumedQty), 0));
  };

  // Same-day disposals of one key run back to back (sell-date order), and the
  // total-exit release waits for the last of them: index of each key's last
  // disposal per sell day.
  const lastOfDay = new Map<string, number>();
  for (const idx of order) {
    const d = result[idx]!;
    if (WASH_SALE_EXEMPT.has(d.assetCategory)) continue;
    const key = homogeneousKey(d.isin, d.symbol, d.assetCategory);
    if (!key) continue;
    lastOfDay.set(`${key}|${parseDate(d.sellDate).getTime()}`, idx);
  }
  // Whether any disposal of a (key, sell day) had shares absorbed by a rebuy:
  // such a sale is not wholly definitive, so it never releases the whole queue.
  const absorbedOnDay = new Set<string>();

  for (const idx of order) {
    const disposal = result[idx]!;
    if (WASH_SALE_EXEMPT.has(disposal.assetCategory)) continue;
    const key = homogeneousKey(disposal.isin, disposal.symbol, disposal.assetCategory);
    if (!key) continue;

    const qty = disposal.quantity.abs();
    const sellDate = parseDate(disposal.sellDate);
    const sellTime = sellDate.getTime();
    const dayKey = `${key}|${sellTime}`;
    const isLoss = disposal.gainLossEur.lessThan(0);

    // Losses pending before this sale. A loss blocked by an earlier disposal of
    // the same sale day is not yet pending for this one.
    const queue = pendingByAsset.get(key);
    const hasPending = queue !== undefined && queue.head < queue.entries.length && queue.entries[queue.head]!.time < sellTime;

    // 1. ABSORB: the in-window homogeneous repurchases not yet used by an earlier
    //    transmission. A loss sale needs them to block its own loss; any sale,
    //    gain or loss, needs them for the definitive test of the pending losses
    //    («con independencia de que determinen ganancias o pérdidas», V3282-18),
    //    and a rebuy counted there is used up (V0248-18). A gain sale with no
    //    pending loss has nothing to test and uses no rebuy.
    let absorbed = new Decimal(0);
    const consumed: { date: string; qty: Decimal }[] = [];
    const buyEvents = buysByAsset.get(key);
    if (buyEvents && (isLoss || hasPending)) {
      const months = windowMonths(disposal.assetCategory, disposal.isin);
      const windowStart = addMonths(sellDate, -months).getTime();
      const windowEnd = addMonths(sellDate, months).getTime();

      // Consume repurchase quantity from in-window buys, excluding any buy on the
      // sell day (the lot being sold, not a repurchase). `absorbed` ≤ sold qty.
      //
      // Order matters. A POST-sale buy is a genuine surviving replacement, so it
      // remains uncapped and is consumed first. A PRE-sale buy can only block the
      // portion that still remains after this sale; if the sale fully exits the
      // position, DGT V3282-18(1) allows the loss in full because no homogeneous
      // shares remain in the patrimony. Same-day FIFO disposal splits share one
      // holdingAfter budget so they cannot collectively block more pre-sale shares
      // than remain after the full sale date.
      let remainingToAbsorb = qty;
      // buyEvents is sorted by time, so each pass walks only its slice of the
      // window, found by binary search: (sellTime, windowEnd] forward for post-sale
      // buys, [windowStart, sellTime) backward for pre-sale ones. Same-day buys are
      // outside both slices.
      const consume = (from: number, to: number, step: 1 | -1, maxQty?: Decimal): Decimal => {
        let remainingBudget = maxQty ?? qty;
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
        return (maxQty ?? qty).minus(remainingBudget);
      };
      // post-sale repurchases first (surviving replacements)
      consume(firstIndexAfter(buyEvents, sellTime), firstIndexAfter(buyEvents, windowEnd), 1);
      // FIFO leaves the newest pre-sale lots behind after a partial sale, so take
      // capped pre-sale repurchases newest-first, from the lots that survive.
      const preSaleConsumed = consume(
        firstIndexAtOrAfter(buyEvents, sellTime) - 1,
        firstIndexAtOrAfter(buyEvents, windowStart) - 1,
        -1,
        remainingHoldingBudget(key, sellTime),
      );
      consumeHoldingBudget(key, sellTime, preSaleConsumed);
      absorbed = qty.minus(remainingToAbsorb);
    }
    if (absorbed.greaterThan(0)) absorbedOnDay.add(dayKey);

    // 2. RELEASE: the shares no rebuy absorbed are a «transmisión definitiva».
    //    Each one releases one pending share, oldest pending loss first (V0571-21,
    //    V0754-26), whichever lot FIFO sells (V0046-20). The absorbed shares keep
    //    the pending losses deferred (V3282-18, V2481-20).
    const releasedFrom = new Set<string>();
    if (queue && hasPending) {
      let toRelease = qty.minus(absorbed);
      for (let i = queue.head; i < queue.entries.length; i++) {
        const entry = queue.entries[i]!;
        if (toRelease.lessThanOrEqualTo(0) || entry.time >= sellTime) break;
        const conversion = splitFactorBetween(splitsByAsset, key, entry.time, sellTime);
        const entryQtyAtSell = entry.qty.mul(conversion.num).div(conversion.den);
        if (entryQtyAtSell.lessThanOrEqualTo(0)) continue;
        const take = Decimal.min(toRelease, entryQtyAtSell);
        const releasedEur = take.equals(entryQtyAtSell) ? entry.eur : entry.eur.mul(take).div(entryQtyAtSell);
        disposal.reintegratedLossEur = disposal.reintegratedLossEur.plus(releasedEur);
        entry.eur = entry.eur.minus(releasedEur);
        entry.qty = take.equals(entryQtyAtSell) ? new Decimal(0) : entry.qty.minus(take.mul(conversion.den).div(conversion.num));
        releasedFrom.add(entry.sellDate);
        toRelease = toRelease.minus(take);
      }
    }

    // 3. TOTAL EXIT: a sale day that leaves no shares and whose sales no rebuy
    //    absorbed is a definitive exit; it releases every loss still pending
    //    («las pérdidas … que le resten por imputar», V1760-23). The queue can
    //    hold more shares than the position, because a rebought sale both keeps
    //    the old losses pending and adds its own.
    if (
      queue &&
      hasPending &&
      lastOfDay.get(dayKey) === idx &&
      !absorbedOnDay.has(dayKey) &&
      holdingAfter(key, sellTime).isZero()
    ) {
      for (let i = queue.head; i < queue.entries.length; i++) {
        const entry = queue.entries[i]!;
        if (entry.time >= sellTime) break;
        disposal.reintegratedLossEur = disposal.reintegratedLossEur.plus(entry.eur);
        entry.eur = new Decimal(0);
        entry.qty = new Decimal(0);
        releasedFrom.add(entry.sellDate);
      }
    }
    if (queue) {
      while (queue.head < queue.entries.length && queue.entries[queue.head]!.qty.lessThanOrEqualTo(0)) queue.head++;
    }
    if (releasedFrom.size > 0) disposal.washSaleReleasedFromDates = [...releasedFrom].sort();

    // 4. BLOCK (losses only): the absorbed shares defer their part of this loss,
    //    `|loss| × absorbed / qty`, which joins the end of the pending queue. The
    //    shares that keep the old losses pending are the same that block this one;
    //    they are not counted twice (V0913-08).
    if (!isLoss || absorbed.lessThanOrEqualTo(0)) continue;
    const lossAbs = disposal.gainLossEur.abs();
    const blocked = absorbed.greaterThanOrEqualTo(qty) ? lossAbs : lossAbs.mul(absorbed).div(qty);
    disposal.blockedLossEur = blocked;
    disposal.washSaleBlocked = blocked.greaterThan(0);
    if (!disposal.washSaleBlocked) continue;
    // Display-only trail so the UI can say WHICH purchases blocked this loss.
    disposal.washSaleRepurchaseDates = [...new Set(consumed.map((c) => c.date))].sort();
    let pending = pendingByAsset.get(key);
    if (!pending) {
      pending = { entries: [], head: 0 };
      pendingByAsset.set(key, pending);
    }
    pending.entries.push({ qty: absorbed, eur: blocked, time: sellTime, sellDate: normalizeDay(disposal.sellDate) });
  }

  return result;
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
