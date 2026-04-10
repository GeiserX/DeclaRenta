/**
 * FIFO (First In, First Out) cost basis engine.
 *
 * Spanish tax law (Art. 37.2 LIRPF) mandates FIFO for calculating
 * capital gains on securities. This engine tracks lots and computes
 * gains/losses using ECB official exchange rates.
 */

import Decimal from "decimal.js";
import type { Lot, FifoDisposal } from "../types/tax.js";
import type { Trade } from "../types/ibkr.js";
import type { EcbRateMap } from "../types/ecb.js";
import { getEcbRate } from "./ecb.js";

export class FifoEngine {
  /** FIFO queue per ISIN */
  private lots: Map<string, Lot[]> = new Map();
  private disposals: FifoDisposal[] = [];
  private nextLotId = 1;

  /**
   * Process a list of trades (must be sorted by date ascending).
   * Buys add lots to the queue; sells consume lots via FIFO.
   */
  processTrades(trades: Trade[], rateMap: EcbRateMap): FifoDisposal[] {
    // Sort by date ascending
    const sorted = [...trades]
      .filter((t) => t.assetCategory === "STK" || t.assetCategory === "FUND")
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

    for (const trade of sorted) {
      if (trade.buySell === "BUY") {
        this.addLot(trade, rateMap);
      } else {
        this.consumeLots(trade, rateMap);
      }
    }

    return this.disposals;
  }

  private addLot(trade: Trade, rateMap: EcbRateMap): void {
    const ecbRate = getEcbRate(rateMap, trade.tradeDate, trade.currency);
    const quantity = new Decimal(trade.quantity).abs();
    const pricePerShare = new Decimal(trade.tradePrice);
    const commission = new Decimal(trade.commission).abs();
    const costInOrigCurrency = quantity.mul(pricePerShare).plus(commission);
    const costInEur = costInOrigCurrency.mul(ecbRate);

    const lot: Lot = {
      id: `LOT-${this.nextLotId++}`,
      isin: trade.isin,
      symbol: trade.symbol,
      description: trade.description,
      acquireDate: trade.tradeDate,
      quantity,
      pricePerShare,
      costInEur,
      currency: trade.currency,
      ecbRate,
    };

    if (!this.lots.has(trade.isin)) {
      this.lots.set(trade.isin, []);
    }
    this.lots.get(trade.isin)!.push(lot);
  }

  private consumeLots(trade: Trade, rateMap: EcbRateMap): void {
    const ecbRate = getEcbRate(rateMap, trade.tradeDate, trade.currency);
    let remaining = new Decimal(trade.quantity).abs();
    const commission = new Decimal(trade.commission).abs();
    const pricePerShare = new Decimal(trade.tradePrice);

    const lots = this.lots.get(trade.isin);
    if (!lots || lots.length === 0) {
      throw new Error(`FIFO error: selling ${trade.symbol} (${trade.isin}) but no lots available`);
    }

    // Distribute commission proportionally across consumed lots
    const totalSellQuantity = remaining;

    while (remaining.greaterThan(0) && lots.length > 0) {
      const lot = lots[0]!;

      const consumed = Decimal.min(remaining, lot.quantity);
      const fractionOfSale = consumed.dividedBy(totalSellQuantity);
      const commissionShare = commission.mul(fractionOfSale);

      // Proceeds in EUR for this partial disposal
      const proceedsOrigCurrency = consumed.mul(pricePerShare).minus(commissionShare);
      const proceedsEur = proceedsOrigCurrency.mul(ecbRate);

      // Cost basis in EUR: proportional from lot (cost per unit * consumed quantity)
      const lotTotalCostPerUnit = lot.costInEur.dividedBy(lot.quantity);
      const disposalCostEur = lotTotalCostPerUnit.mul(consumed);

      const sellDate = trade.tradeDate;
      const acquireDate = lot.acquireDate;
      const holdingDays = Math.floor(
        (new Date(sellDate).getTime() - new Date(acquireDate).getTime()) / (1000 * 60 * 60 * 24),
      );

      this.disposals.push({
        isin: trade.isin,
        symbol: trade.symbol,
        description: trade.description,
        sellDate,
        acquireDate,
        quantity: consumed,
        proceedsEur,
        costBasisEur: disposalCostEur,
        gainLossEur: proceedsEur.minus(disposalCostEur),
        holdingPeriodDays: holdingDays,
        washSaleBlocked: false, // Set later by wash sale detection
      });

      // Reduce lot
      lot.quantity = lot.quantity.minus(consumed);
      lot.costInEur = lot.costInEur.minus(disposalCostEur);

      if (lot.quantity.isZero()) {
        lots.shift();
      }

      remaining = remaining.minus(consumed);
    }

    if (remaining.greaterThan(0)) {
      throw new Error(
        `FIFO error: insufficient lots for ${trade.symbol} (${trade.isin}). ` +
        `Remaining: ${remaining.toString()} shares`,
      );
    }
  }

  getDisposals(): FifoDisposal[] {
    return this.disposals;
  }

  getRemainingLots(): Map<string, Lot[]> {
    return this.lots;
  }
}
