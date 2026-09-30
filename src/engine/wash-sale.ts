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
 * valores que permanezcan en el patrimonio del contribuyente") when the surviving
 * repurchased shares are themselves later sold — tracked here as
 * `reintegratedLossEur` on the disposal that sells them. See
 * docs/design/antichurning-proportional.md for the full contract and citations.
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
  /** Normalized YYYY-MM-DD of the buy — the key a future disposal matches to release the deferred loss. */
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

/** A deferred loss attached to a repurchased lot, released as that lot is later sold. */
interface DeferredLot {
  /** Repurchased shares still carrying deferred loss. */
  qty: Decimal;
  /** Deferred loss (EUR, positive) still attached to those shares. */
  deferredEur: Decimal;
  /** The deferred loss can release only on transmissions after the sale that created it. */
  availableAfterTime: number;
}

/**
 * Detect wash sales: compute PROPORTIONAL blocked losses and reintegrate
 * previously-deferred losses, in ONE chronological pass (Art. 33.5.f/g LIRPF).
 *
 * Per homogeneous key the pass maintains (a) a FIFO budget of in-window
 * repurchase quantities and (b) a ledger of deferred losses keyed by the
 * repurchase date. For each disposal in sell-date order:
 *  1. RELEASE — if it sells shares acquired on a date carrying a deferred loss,
 *     reintegrate that loss proportionally (`reintegratedLossEur`).
 *  2. BLOCK (losses only) — defer `|loss| × absorbed/qty` where `absorbed` is the
 *     in-window homogeneous repurchase quantity (a buy ON the sell date is the
 *     lot being sold, excluded), consuming that quantity from the budget and
 *     attaching the deferred loss to the consumed buys' dates.
 *
 * Passing the FULL (all-year) disposal+trade set makes reintegration work across
 * years in a merged multi-file run (the cross-year case). Single-year runs see
 * only blocking, exactly as before — but now proportional.
 *
 * @param disposals - FIFO disposals to check (pass all years for cross-year reintegration)
 * @param allTrades - All trades for the period (homogeneous repurchases)
 * @param corporateActions - Corporate actions for split-adjusted remaining-position caps
 * @returns Disposals with `blockedLossEur`, `reintegratedLossEur`, and `washSaleBlocked` set
 */
export function detectWashSales(
  disposals: FifoDisposal[],
  allTrades: Trade[],
  corporateActions: CorporateAction[] = [],
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
  const splitsByAsset = buildSplitEvents(corporateActions);

  // Deferred-loss ledger: key → (buy date → deferred lots). A loss blocked by a
  // repurchase on date D is recoverable when shares acquired on D are later sold.
  const deferredByAsset = new Map<string, Map<string, DeferredLot[]>>();

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

  for (const idx of order) {
    const disposal = result[idx]!;
    if (WASH_SALE_EXEMPT.has(disposal.assetCategory)) continue;
    const key = homogeneousKey(disposal.isin, disposal.symbol, disposal.assetCategory);
    if (!key) continue;

    const qty = disposal.quantity.abs();
    const disposalSellDate = parseDate(disposal.sellDate);
    const disposalSellTime = disposalSellDate.getTime();

    // 1. RELEASE: this disposal sells shares acquired on a date that carries a
    //    deferred loss → reintegrate proportionally to the quantity now sold.
    const deferredLots = deferredByAsset.get(key);
    if (deferredLots) {
      const acquireDate = normalizeDay(disposal.acquireDate);
      const lots = deferredLots.get(acquireDate);
      if (lots) {
        let remainingReleaseQty = qty;
        for (const lot of lots) {
          if (remainingReleaseQty.lessThanOrEqualTo(0)) break;
          if (disposalSellTime <= lot.availableAfterTime) continue;
          if (lot.qty.lessThanOrEqualTo(0)) continue;
          const releaseConversion = splitFactorBetween(splitsByAsset, key, lot.availableAfterTime, disposalSellTime);
          const lotQtyAtRelease = lot.qty.mul(releaseConversion.num).div(releaseConversion.den);
          if (lotQtyAtRelease.lessThanOrEqualTo(0)) continue;
          const releasedQty = Decimal.min(remainingReleaseQty, lotQtyAtRelease);
          const releasedOriginalQty = releasedQty.mul(releaseConversion.den).div(releaseConversion.num);
          const releasedEur = lot.qty.isZero()
            ? new Decimal(0)
            : lot.deferredEur.mul(releasedOriginalQty).div(lot.qty);
          disposal.reintegratedLossEur = disposal.reintegratedLossEur.plus(releasedEur);
          lot.qty = lot.qty.minus(releasedOriginalQty);
          lot.deferredEur = lot.deferredEur.minus(releasedEur);
          remainingReleaseQty = remainingReleaseQty.minus(releasedQty);
        }
        const remainingLots = lots.filter((lot) => lot.qty.greaterThan(0));
        if (remainingLots.length > 0) {
          deferredLots.set(acquireDate, remainingLots);
        } else {
          deferredLots.delete(acquireDate);
        }
      }
    }

    // 2. BLOCK: only loss disposals, proportional to the in-window repurchase qty.
    if (disposal.gainLossEur.greaterThanOrEqualTo(0)) continue;

    const sellDate = disposalSellDate;
    const months = windowMonths(disposal.assetCategory, disposal.isin);
    const windowStart = addMonths(sellDate, -months).getTime();
    const windowEnd = addMonths(sellDate, months).getTime();
    const sellTime = sellDate.getTime();

    const buyEvents = buysByAsset.get(key);
    if (!buyEvents) continue;

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
    const consumed: { date: string; qty: Decimal }[] = [];
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
    // FIFO leaves the newest pre-sale lots behind after a partial sale, so attach
    // capped pre-sale deferrals newest-first to the lots that actually survive.
    const preSaleConsumed = consume(
      firstIndexAtOrAfter(buyEvents, sellTime) - 1,
      firstIndexAtOrAfter(buyEvents, windowStart) - 1,
      -1,
      remainingHoldingBudget(key, sellTime),
    );
    consumeHoldingBudget(key, sellTime, preSaleConsumed);

    const absorbed = qty.minus(remainingToAbsorb);
    if (absorbed.lessThanOrEqualTo(0)) continue;

    // Proportional blocked loss: |loss| × absorbed / soldQty.
    const lossAbs = disposal.gainLossEur.abs();
    const blocked = absorbed.greaterThanOrEqualTo(qty) ? lossAbs : lossAbs.mul(absorbed).div(qty);
    disposal.blockedLossEur = blocked;
    disposal.washSaleBlocked = blocked.greaterThan(0);

    // Attach the deferred loss to each consumed repurchase date, pro-rata to the
    // quantity consumed there, so a later sale of those shares releases it.
    let lots = deferredByAsset.get(key);
    if (!lots) {
      lots = new Map<string, DeferredLot[]>();
      deferredByAsset.set(key, lots);
    }
    for (const c of consumed) {
      const share = absorbed.isZero() ? new Decimal(0) : blocked.mul(c.qty).div(absorbed);
      const existing = lots.get(c.date);
      const deferredLot = { qty: c.qty, deferredEur: share, availableAfterTime: sellTime };
      if (existing) {
        existing.push(deferredLot);
      } else {
        lots.set(c.date, [deferredLot]);
      }
    }
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

function buildSplitEvents(corporateActions: CorporateAction[]): Map<string, SplitEvent[]> {
  const splitsByAsset = new Map<string, SplitEvent[]>();
  const seen = new Set<string>();

  for (const action of corporateActions) {
    if (action.type !== "FS" && action.type !== "RS") continue;
    const ratioMatch = action.description.match(/SPLIT\s+(\d+)\s+FOR\s+(\d+)/i);
    if (!ratioMatch) continue;
    const numerator = new Decimal(ratioMatch[1]!);
    const denominator = new Decimal(ratioMatch[2]!);
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
