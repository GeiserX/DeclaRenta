/**
 * Anti-churning rule detector (Art. 33.5.f LIRPF).
 *
 * Spanish tax law blocks capital losses if the same security
 * (or "homogeneous" security) is repurchased within:
 * - **2 calendar months** before or after the sale — for securities
 *   admitted to trading on regulated markets (STK, FUND, BOND on MiFID venues).
 * - **1 year** before or after the sale — for securities NOT admitted
 *   to trading on regulated markets (most crypto, unlisted shares, etc.).
 *
 * Crypto and other non-listed assets use the 1-year window. Listed securities
 * use the 2-month window.
 */

import type { FifoDisposal } from "../types/tax.js";
import type { Trade } from "../types/ibkr.js";
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

/**
 * Detect wash sales and mark blocked losses.
 *
 * A loss is blocked if:
 * 1. The disposal resulted in a loss (gainLossEur < 0)
 * 2. The same ISIN was purchased within 2 months before or after the sale
 *
 * @param disposals - FIFO disposals to check
 * @param allTrades - All trades for the period (needed to check repurchases)
 * @returns Disposals with washSaleBlocked flag set
 */
export function detectWashSales(disposals: FifoDisposal[], allTrades: Trade[]): FifoDisposal[] {
  const buysByAsset = new Map<string, Date[]>();

  // Index all buy dates by homogeneous-asset key.
  for (const trade of allTrades) {
    if (trade.buySell === "BUY" && !WASH_SALE_EXEMPT.has(trade.assetCategory)) {
      const key = homogeneousKey(trade.isin, trade.symbol, trade.assetCategory);
      if (!key) continue;
      if (!buysByAsset.has(key)) {
        buysByAsset.set(key, []);
      }
      buysByAsset.get(key)!.push(parseDate(trade.tradeDate));
    }
  }

  return disposals.map((disposal) => {
    // Only check disposals with losses
    if (disposal.gainLossEur.greaterThanOrEqualTo(0)) {
      return disposal;
    }

    // Anti-churning does NOT apply to derivatives, forex, or CFDs.
    if (WASH_SALE_EXEMPT.has(disposal.assetCategory)) {
      return disposal;
    }

    const key = homogeneousKey(disposal.isin, disposal.symbol, disposal.assetCategory);
    if (!key) {
      return disposal;
    }

    const sellDate = parseDate(disposal.sellDate);
    const months = windowMonths(disposal.assetCategory, disposal.isin);
    const windowStart = addMonths(sellDate, -months);
    const windowEnd = addMonths(sellDate, months);

    const buys = buysByAsset.get(key) ?? [];
    const hasRepurchase = buys.some((buyDate) => {
      // Exclude buys that are BEFORE the sell (those are the lots being sold)
      // We only care about repurchases: buys that happen in the 2-month window
      // AFTER the sale, or buys in the 2 months before that still have open lots
      return buyDate >= windowStart && buyDate <= windowEnd && buyDate.getTime() !== sellDate.getTime();
    });

    // DEFERRAL NOTE (Art. 33.5.f LIRPF): a blocked loss is NOT forfeited — it is
    // deferred and integrates into the taxable base when the replacement (repurchased)
    // lots are themselves later sold, by adding the blocked loss to those lots' basis.
    // We only set `washSaleBlocked` here; downstream the blocked loss is excluded from
    // the current-year deductible base (i.e. deferred = not deducted now), which is the
    // correct CURRENT-YEAR treatment.
    //
    // FULL deferral-to-future-basis is intentionally OUT OF SCOPE: it requires a
    // persistent multi-year lot store to attach the blocked amount to the specific
    // replacement lots and carry it across declarations. The current Lot/FifoDisposal
    // model is single-year and has no such cross-year carry mechanism, so attempting
    // to mutate replacement-lot basis here would be speculative and could corrupt
    // results. We therefore keep the conservative, correct current-year behavior.
    return {
      ...disposal,
      washSaleBlocked: hasRepurchase,
    };
  });
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
