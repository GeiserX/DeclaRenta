/**
 * FIFO (First In, First Out) cost basis engine.
 *
 * Spanish tax law (Art. 37.2 LIRPF) mandates FIFO for calculating
 * capital gains on securities. This engine tracks lots and computes
 * gains/losses using ECB official exchange rates.
 */

import Decimal from "decimal.js";
import type { Lot, FifoDisposal } from "../types/tax.js";
import type { Trade, CorporateAction } from "../types/ibkr.js";
import type { EcbRateMap } from "../types/ecb.js";
import { getEcbRate } from "./ecb.js";
import { daysBetween } from "./dates.js";

/** Lot grouping key: ISIN for stocks/funds, symbol for options (which lack ISINs) */
function lotKey(trade: { isin: string; symbol: string }): string {
  return trade.isin || trade.symbol;
}

export class FifoEngine {
  /** FIFO queue per security (ISIN or symbol) */
  private lots: Map<string, Lot[]> = new Map();
  private disposals: FifoDisposal[] = [];
  private nextLotId = 1;
  /** Warnings for issues that don't block execution */
  warnings: string[] = [];

  /**
   * Process trades and corporate actions together, sorted chronologically.
   * Buys add lots; sells consume lots via FIFO; splits adjust lots.
   */
  processTrades(trades: Trade[], rateMap: EcbRateMap, corporateActions?: CorporateAction[]): FifoDisposal[] {
    const sorted = [...trades]
      .filter((t) => t.assetCategory === "STK" || t.assetCategory === "FUND" || t.assetCategory === "OPT")
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

    // Parse splits from corporate actions (deduplicate by ISIN+date)
    const splitMap = new Map<string, { isin: string; date: string; ratio: number }>();
    for (const ca of (corporateActions ?? []).filter((ca) => ca.type === "FS")) {
      const ratioMatch = ca.description.match(/SPLIT\s+(\d+)\s+FOR\s+(\d+)/i);
      const ratio = ratioMatch ? parseInt(ratioMatch[1]!) / parseInt(ratioMatch[2]!) : 0;
      if (ratio <= 0) continue;
      const date = ca.dateTime.slice(0, 8); // "20240807" — same format as trade.tradeDate
      const key = `${ca.isin}:${date}`;
      if (!splitMap.has(key)) {
        splitMap.set(key, { isin: ca.isin, date, ratio });
      }
    }
    const splits = [...splitMap.values()].sort((a, b) => a.date.localeCompare(b.date));

    // Merge trades and splits into a single timeline
    let splitIdx = 0;

    for (const trade of sorted) {
      // Apply any splits that occur before this trade
      while (splitIdx < splits.length && splits[splitIdx]!.date <= trade.tradeDate) {
        this.applySplit(splits[splitIdx]!);
        splitIdx++;
      }

      if (trade.buySell === "BUY") {
        this.addLot(trade, rateMap);
      } else {
        this.consumeLots(trade, rateMap);
      }
    }

    // Apply remaining splits after all trades
    while (splitIdx < splits.length) {
      this.applySplit(splits[splitIdx]!);
      splitIdx++;
    }

    return this.disposals;
  }

  private applySplit(split: { isin: string; date: string; ratio: number }): void {
    const lots = this.lots.get(split.isin);
    if (!lots || lots.length === 0) return;

    const ratio = new Decimal(split.ratio);
    for (const lot of lots) {
      // Multiply quantity by ratio, keep total cost the same
      lot.quantity = lot.quantity.mul(ratio);
      lot.pricePerShare = lot.pricePerShare.dividedBy(ratio);
      // costInEur stays the same — total cost doesn't change on a split
    }
    console.error(`  ⚡ Split ${split.isin} ${split.ratio}:1 aplicado (${split.date})`);
  }

  private addLot(trade: Trade, rateMap: EcbRateMap): void {
    const ecbRate = getEcbRate(rateMap, trade.tradeDate, trade.currency);
    const quantity = new Decimal(trade.quantity).abs();
    const pricePerShare = new Decimal(trade.tradePrice);
    const multiplier = new Decimal(trade.multiplier || "1");
    const commission = new Decimal(trade.commission).abs();
    const costInOrigCurrency = quantity.mul(pricePerShare).mul(multiplier).plus(commission);
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

    const key = lotKey(trade);
    if (!this.lots.has(key)) {
      this.lots.set(key, []);
    }
    this.lots.get(key)!.push(lot);
  }

  private consumeLots(trade: Trade, rateMap: EcbRateMap): void {
    const ecbRate = getEcbRate(rateMap, trade.tradeDate, trade.currency);
    let remaining = new Decimal(trade.quantity).abs();
    const commission = new Decimal(trade.commission).abs();
    const pricePerShare = new Decimal(trade.tradePrice);
    const multiplier = new Decimal(trade.multiplier || "1");

    const key = lotKey(trade);
    const lots = this.lots.get(key);
    if (!lots || lots.length === 0) {
      // Short sale or missing prior data — warn and record with zero cost basis
      this.warnings.push(`⚠ Venta sin lotes: ${trade.symbol} (${trade.isin}) × ${remaining} el ${trade.tradeDate}. Coste base = 0 (posible posición corta o datos previos incompletos).`);
      const proceedsOrigCurrency = remaining.mul(pricePerShare).mul(multiplier).minus(commission);
      const proceedsEur = proceedsOrigCurrency.mul(ecbRate);
      this.disposals.push({
        isin: trade.isin,
        symbol: trade.symbol,
        description: trade.description,
        sellDate: trade.tradeDate,
        acquireDate: trade.tradeDate,
        quantity: remaining,
        proceedsEur,
        costBasisEur: new Decimal(0),
        gainLossEur: proceedsEur,
        holdingPeriodDays: 0,
        washSaleBlocked: false,
      });
      return;
    }

    // Distribute commission proportionally across consumed lots
    const totalSellQuantity = remaining;

    while (remaining.greaterThan(0) && lots.length > 0) {
      const lot = lots[0]!;

      const consumed = Decimal.min(remaining, lot.quantity);
      const fractionOfSale = consumed.dividedBy(totalSellQuantity);
      const commissionShare = commission.mul(fractionOfSale);

      // Proceeds in EUR for this partial disposal
      const proceedsOrigCurrency = consumed.mul(pricePerShare).mul(multiplier).minus(commissionShare);
      const proceedsEur = proceedsOrigCurrency.mul(ecbRate);

      // Cost basis in EUR: proportional from lot (cost per unit * consumed quantity)
      const lotTotalCostPerUnit = lot.costInEur.dividedBy(lot.quantity);
      const disposalCostEur = lotTotalCostPerUnit.mul(consumed);

      const sellDate = trade.tradeDate;
      const acquireDate = lot.acquireDate;
      const holdingDays = daysBetween(acquireDate, sellDate);

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
      // Remaining shares with no lots — short sale or data gap
      this.warnings.push(`⚠ Lotes insuficientes: ${trade.symbol} (${trade.isin}) × ${remaining} el ${trade.tradeDate}. Coste base = 0.`);
      const fractionOfSale = remaining.dividedBy(totalSellQuantity);
      const commissionShare = commission.mul(fractionOfSale);
      const proceedsOrigCurrency = remaining.mul(pricePerShare).mul(multiplier).minus(commissionShare);
      const proceedsEur = proceedsOrigCurrency.mul(ecbRate);
      this.disposals.push({
        isin: trade.isin,
        symbol: trade.symbol,
        description: trade.description,
        sellDate: trade.tradeDate,
        acquireDate: trade.tradeDate,
        quantity: remaining,
        proceedsEur,
        costBasisEur: new Decimal(0),
        gainLossEur: proceedsEur,
        holdingPeriodDays: 0,
        washSaleBlocked: false,
      });
    }
  }

  getDisposals(): FifoDisposal[] {
    return this.disposals;
  }

  getRemainingLots(): Map<string, Lot[]> {
    return this.lots;
  }
}
