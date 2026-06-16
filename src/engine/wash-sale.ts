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
 * docs/antichurning-proportional-design.md for the full contract and citations.
 */

import type { FifoDisposal } from "../types/tax.js";
import type { Trade } from "../types/ibkr.js";
import Decimal from "decimal.js";
import { parseDate } from "./dates.js";

/** Asset categories exempt from anti-churning (not "valores homogéneos" per Art. 33.5.f) */
const WASH_SALE_EXEMPT: ReadonlySet<string> = new Set(["OPT", "FUT", "FOP", "FSFOP", "CFD", "CASH"]);

/** Asset categories that, when backed by a real ISIN, are treated as listed (2-month window). */
const LISTED_CATEGORIES: ReadonlySet<string> = new Set(["STK", "FUND", "BOND"]);

/**
 * Add/subtract calendar months (Art. 33.5.f says "dos meses"/"un año", not 60/365 days).
 *
 * Plain `Date.setMonth(getMonth()+n)` overflows when the source day-of-month does
 * not exist in the target month (e.g. Jan 31 + 1mo → Mar 2/3, because February has
 * no 31st). For a tax window that silently shifts the boundary by a couple of days.
 * We clamp the day to the last valid day of the target month instead
 * (Jan 31 + 1mo → Feb 28/29; Mar 31 − 1mo → Feb 28/29; Dec 31 + 2mo → Feb 28/29).
 */
export function addMonths(date: Date, months: number): Date {
  const day = date.getDate();
  // Move to the 1st to avoid overflow while shifting the month, then clamp the day.
  const result = new Date(date);
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  // Last day of the (now correct) target month.
  const lastDayOfMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDayOfMonth));
  return result;
}

/** A homogeneous repurchase available to absorb a loss, with a consumable quantity. */
interface BuyEvent {
  time: number;
  /** Normalized YYYY-MM-DD of the buy — the key a future disposal matches to release the deferred loss. */
  date: string;
  /** Remaining repurchased quantity not yet used to block a loss (the consumable budget). */
  remainingQty: Decimal;
}

/** A deferred loss attached to a repurchased lot, released as that lot is later sold. */
interface DeferredLot {
  /** Repurchased shares still carrying deferred loss. */
  qty: Decimal;
  /** Deferred loss (EUR, positive) still attached to those shares. */
  deferredEur: Decimal;
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
 * @returns Disposals with `blockedLossEur`, `reintegratedLossEur`, and `washSaleBlocked` set
 */
export function detectWashSales(disposals: FifoDisposal[], allTrades: Trade[]): FifoDisposal[] {
  // Index in-window-eligible BUY events (time, date, consumable qty) by key.
  const buysByAsset = new Map<string, BuyEvent[]>();
  for (const trade of allTrades) {
    if (trade.buySell !== "BUY" || WASH_SALE_EXEMPT.has(trade.assetCategory)) continue;
    const key = homogeneousKey(trade.isin, trade.symbol, trade.assetCategory);
    if (!key) continue;
    const qty = parseQty(trade.quantity);
    if (qty.lessThanOrEqualTo(0)) continue;
    const d = parseDate(trade.tradeDate);
    let events = buysByAsset.get(key);
    if (!events) {
      events = [];
      buysByAsset.set(key, events);
    }
    events.push({ time: d.getTime(), date: normalizeDay(trade.tradeDate), remainingQty: qty });
  }
  for (const events of buysByAsset.values()) {
    events.sort((a, b) => a.time - b.time);
  }

  // Deferred-loss ledger: key → (buy date → deferred lot). A loss blocked by a
  // repurchase on date D is recoverable when shares acquired on D are later sold.
  const deferredByAsset = new Map<string, Map<string, DeferredLot>>();

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

  for (const idx of order) {
    const disposal = result[idx]!;
    if (WASH_SALE_EXEMPT.has(disposal.assetCategory)) continue;
    const key = homogeneousKey(disposal.isin, disposal.symbol, disposal.assetCategory);
    if (!key) continue;

    const qty = disposal.quantity.abs();

    // 1. RELEASE: this disposal sells shares acquired on a date that carries a
    //    deferred loss → reintegrate proportionally to the quantity now sold.
    const deferredLots = deferredByAsset.get(key);
    if (deferredLots) {
      const lot = deferredLots.get(normalizeDay(disposal.acquireDate));
      if (lot && lot.qty.greaterThan(0)) {
        const releasedQty = Decimal.min(qty, lot.qty);
        const releasedEur = lot.qty.isZero()
          ? new Decimal(0)
          : lot.deferredEur.mul(releasedQty).div(lot.qty);
        disposal.reintegratedLossEur = releasedEur;
        lot.qty = lot.qty.minus(releasedQty);
        lot.deferredEur = lot.deferredEur.minus(releasedEur);
        if (lot.qty.lessThanOrEqualTo(0)) deferredLots.delete(normalizeDay(disposal.acquireDate));
      }
    }

    // 2. BLOCK: only loss disposals, proportional to the in-window repurchase qty.
    if (disposal.gainLossEur.greaterThanOrEqualTo(0)) continue;

    const sellDate = parseDate(disposal.sellDate);
    const months = windowMonths(disposal.assetCategory, disposal.isin);
    const windowStart = addMonths(sellDate, -months).getTime();
    const windowEnd = addMonths(sellDate, months).getTime();
    const sellTime = sellDate.getTime();

    const buyEvents = buysByAsset.get(key);
    if (!buyEvents) continue;

    // Consume repurchase quantity from in-window buys, excluding any buy on the
    // sell day (the lot being sold, not a repurchase). `absorbed` ≤ sold qty.
    //
    // Order matters for REINTEGRATION keying (not for the blocked amount): the
    // deferred loss must attach to shares that REMAIN in the patrimony so a later
    // sale can release it ("se integrarán a medida que se transmitan los valores
    // que permanezcan"). A genuine replacement is a POST-sale repurchase, whereas
    // an in-window PRE-sale buy is often the very lot FIFO just sold (which will
    // never be sold again → the deferred loss would be stranded). So we consume
    // post-sale buys (ascending) FIRST, then pre-sale buys — the total absorbed
    // (and thus the proportional block) is identical either way, but the deferred
    // loss lands on the surviving lot. (Residual, conservative: if the ONLY
    // in-window homogeneous acquisition is the partially-sold lot itself, the
    // block keys there and may not reintegrate — over-deferral, never under-pay.)
    let remainingToAbsorb = qty;
    const consumed: { date: string; qty: Decimal }[] = [];
    const consume = (predicate: (evTime: number) => boolean): void => {
      for (const ev of buyEvents) {
        if (remainingToAbsorb.lessThanOrEqualTo(0)) break;
        if (ev.time < windowStart || ev.time > windowEnd) continue;
        if (ev.time === sellTime) continue;
        if (!predicate(ev.time)) continue;
        if (ev.remainingQty.lessThanOrEqualTo(0)) continue;
        const take = Decimal.min(ev.remainingQty, remainingToAbsorb);
        ev.remainingQty = ev.remainingQty.minus(take);
        remainingToAbsorb = remainingToAbsorb.minus(take);
        consumed.push({ date: ev.date, qty: take });
      }
    };
    consume((evTime) => evTime > sellTime); // post-sale repurchases first (surviving replacements)
    consume((evTime) => evTime < sellTime); // then pre-sale in-window buys

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
      lots = new Map<string, DeferredLot>();
      deferredByAsset.set(key, lots);
    }
    for (const c of consumed) {
      const share = absorbed.isZero() ? new Decimal(0) : blocked.mul(c.qty).div(absorbed);
      const existing = lots.get(c.date);
      if (existing) {
        existing.qty = existing.qty.plus(c.qty);
        existing.deferredEur = existing.deferredEur.plus(share);
      } else {
        lots.set(c.date, { qty: c.qty, deferredEur: share });
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

/** Normalize a date string (YYYY-MM-DD or YYYYMMDD) to YYYY-MM-DD for ledger keys. */
function normalizeDay(date: string): string {
  const t = date.trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return t.slice(0, 10);
}

/**
 * Choose the anti-churning window length in calendar months.
 *
 * Art. 33.5.f LIRPF distinguishes by whether the security is admitted to
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
