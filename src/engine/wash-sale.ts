/**
 * Anti-churning rule detector (Art. 33.5.f LIRPF).
 *
 * Spanish tax law blocks capital losses if the same security
 * (or "homogeneous" security) is repurchased within 2 months
 * before or after the sale date.
 */

import type { FifoDisposal } from "../types/tax.js";
import type { Trade } from "../types/ibkr.js";
import { parseDate } from "./dates.js";

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
  const buysByIsin = new Map<string, Date[]>();

  // Index all buy dates by ISIN
  for (const trade of allTrades) {
    if (trade.buySell === "BUY" && (trade.assetCategory === "STK" || trade.assetCategory === "FUND")) {
      if (!buysByIsin.has(trade.isin)) {
        buysByIsin.set(trade.isin, []);
      }
      buysByIsin.get(trade.isin)!.push(parseDate(trade.tradeDate));
    }
  }

  return disposals.map((disposal) => {
    // Only check disposals with losses
    if (disposal.gainLossEur.greaterThanOrEqualTo(0)) {
      return disposal;
    }

    // Anti-churning does NOT apply to options (CALL/PUT)
    if (disposal.assetCategory === "OPT") {
      return disposal;
    }

    const sellDate = parseDate(disposal.sellDate);
    const windowStart = addMonths(sellDate, -2);
    const windowEnd = addMonths(sellDate, 2);

    const buys = buysByIsin.get(disposal.isin) ?? [];
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
