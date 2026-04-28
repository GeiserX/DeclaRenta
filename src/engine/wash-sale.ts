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

/** Add/subtract calendar months (Art. 33.5.f says "dos meses", not 60 days). */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
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
    const months = disposal.assetCategory === "CRYPTO" ? 12 : 2;
    const windowStart = addMonths(sellDate, -months);
    const windowEnd = addMonths(sellDate, months);

    const buys = buysByAsset.get(key) ?? [];
    const hasRepurchase = buys.some((buyDate) => {
      // Exclude buys that are BEFORE the sell (those are the lots being sold)
      // We only care about repurchases: buys that happen in the 2-month window
      // AFTER the sale, or buys in the 2 months before that still have open lots
      return buyDate >= windowStart && buyDate <= windowEnd && buyDate.getTime() !== sellDate.getTime();
    });

    return {
      ...disposal,
      washSaleBlocked: hasRepurchase,
    };
  });
}

function homogeneousKey(isin: string, symbol: string, assetCategory: string): string {
  if (assetCategory === "CRYPTO") return `CRYPTO:${symbol.toUpperCase()}`;
  if (isin) return isin;
  return "";
}
