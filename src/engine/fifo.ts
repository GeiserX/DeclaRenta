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
import { daysBetween, normalizeDate } from "./dates.js";

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
      .sort((a, b) => normalizeDate(a.tradeDate).localeCompare(normalizeDate(b.tradeDate)));

    // Parse splits from corporate actions (deduplicate by ISIN+date)
    const splitMap = new Map<string, { isin: string; date: string; ratio: number }>();
    for (const ca of (corporateActions ?? []).filter((ca) => ca.type === "FS")) {
      const ratioMatch = ca.description.match(/SPLIT\s+(\d+)\s+FOR\s+(\d+)/i);
      const ratio = ratioMatch ? parseInt(ratioMatch[1]!) / parseInt(ratioMatch[2]!) : 0;
      if (ratio <= 0) continue;
      const date = normalizeDate(ca.dateTime.slice(0, 8));
      const key = `${ca.isin}:${date}`;
      if (!splitMap.has(key)) {
        splitMap.set(key, { isin: ca.isin, date, ratio });
      }
    }
    const splits = [...splitMap.values()].sort((a, b) => a.date.localeCompare(b.date));

    // Parse scrip dividends into timeline events (applied chronologically, not upfront)
    const scripDivs: { key: string; isin: string; symbol: string; description: string; date: string; quantity: Decimal; pricePerShare: Decimal; costInEur: Decimal; currency: string; ecbRate: Decimal }[] = [];
    for (const ca of (corporateActions ?? []).filter((ca) => ca.type === "SD")) {
      const qty = new Decimal(ca.quantity);
      if (qty.isZero()) continue;
      const amount = new Decimal(ca.amount).abs();
      const date = normalizeDate(ca.dateTime.slice(0, 8));
      const ecbRate = getEcbRate(rateMap, date, ca.currency);
      const costInEur = amount.mul(ecbRate);
      scripDivs.push({
        key: ca.isin || ca.symbol,
        isin: ca.isin,
        symbol: ca.symbol,
        description: ca.description,
        date,
        quantity: qty.abs(),
        pricePerShare: amount.dividedBy(qty.abs()),
        costInEur,
        currency: ca.currency,
        ecbRate,
      });
      this.warnings.push(`📈 Scrip dividend: ${ca.symbol} +${qty.abs()} acciones el ${date}`);
    }
    const sortedScripDivs = scripDivs.sort((a, b) => a.date.localeCompare(b.date));

    // Merge trades, splits, and scrip dividends into a single chronological timeline
    let splitIdx = 0;
    let sdIdx = 0;

    for (const trade of sorted) {
      const tradeDate = normalizeDate(trade.tradeDate);
      // Apply any splits that occur before this trade
      while (splitIdx < splits.length && splits[splitIdx]!.date <= tradeDate) {
        this.applySplit(splits[splitIdx]!);
        splitIdx++;
      }
      // Apply any scrip dividends that occur before this trade
      while (sdIdx < sortedScripDivs.length && sortedScripDivs[sdIdx]!.date <= tradeDate) {
        this.addScripDividendLot(sortedScripDivs[sdIdx]!);
        sdIdx++;
      }

      if (trade.buySell === "BUY") {
        this.addLot(trade, rateMap);
      } else {
        this.consumeLots(trade, rateMap);
      }
    }

    // Apply remaining splits and scrip dividends after all trades
    while (splitIdx < splits.length) {
      this.applySplit(splits[splitIdx]!);
      splitIdx++;
    }
    while (sdIdx < sortedScripDivs.length) {
      this.addScripDividendLot(sortedScripDivs[sdIdx]!);
      sdIdx++;
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

    // Remove sub-share lots after split (fractional remainders become cash-in-lieu)
    const remaining = lots.filter((l) => l.quantity.greaterThanOrEqualTo(1));
    if (remaining.length < lots.length) {
      this.lots.set(split.isin, remaining);
    }

    const direction = split.ratio >= 1 ? "forward" : "reverse";
    console.error(`  ⚡ Split ${split.isin} ${split.ratio}:1 (${direction}) aplicado (${split.date})`);
  }

  private addScripDividendLot(sd: { key: string; isin: string; symbol: string; description: string; date: string; quantity: Decimal; pricePerShare: Decimal; costInEur: Decimal; currency: string; ecbRate: Decimal }): void {
    const lot: Lot = {
      id: `LOT-${this.nextLotId++}`,
      isin: sd.isin,
      symbol: sd.symbol,
      description: sd.description,
      acquireDate: sd.date,
      quantity: sd.quantity,
      pricePerShare: sd.pricePerShare,
      costInEur: sd.costInEur,
      currency: sd.currency,
      ecbRate: sd.ecbRate,
    };
    if (!this.lots.has(sd.key)) {
      this.lots.set(sd.key, []);
    }
    this.lots.get(sd.key)!.push(lot);
  }

  private addLot(trade: Trade, rateMap: EcbRateMap): void {
    const ecbRate = getEcbRate(rateMap, trade.tradeDate, trade.currency);
    const quantity = new Decimal(trade.quantity).abs();
    const pricePerShare = new Decimal(trade.tradePrice);
    const multiplier = new Decimal(trade.multiplier || "1");
    const commission = new Decimal(trade.commission).abs();
    const taxes = new Decimal(trade.taxes || "0").abs();
    const costInOrigCurrency = quantity.mul(pricePerShare).mul(multiplier).plus(commission).plus(taxes);
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
    const taxes = new Decimal(trade.taxes || "0").abs();
    const pricePerShare = new Decimal(trade.tradePrice);
    const multiplier = new Decimal(trade.multiplier || "1");

    const key = lotKey(trade);
    const lots = this.lots.get(key);
    if (!lots || lots.length === 0) {
      // Short sale or missing prior data — warn and record with zero cost basis
      this.warnings.push(`⚠ Venta sin lotes: ${trade.symbol} (${trade.isin}) × ${remaining} el ${trade.tradeDate}. Coste base = 0 (posible posición corta o datos previos incompletos).`);
      const proceedsOrigCurrency = remaining.mul(pricePerShare).mul(multiplier).minus(commission).minus(taxes);
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
        currency: trade.currency,
        sellEcbRate: ecbRate,
        acquireEcbRate: ecbRate,
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
      const taxesShare = taxes.mul(fractionOfSale);

      // Proceeds in EUR for this partial disposal
      const proceedsOrigCurrency = consumed.mul(pricePerShare).mul(multiplier).minus(commissionShare).minus(taxesShare);
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
        currency: trade.currency,
        sellEcbRate: ecbRate,
        acquireEcbRate: lot.ecbRate,
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
      const taxesShare = taxes.mul(fractionOfSale);
      const proceedsOrigCurrency = remaining.mul(pricePerShare).mul(multiplier).minus(commissionShare).minus(taxesShare);
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
        currency: trade.currency,
        sellEcbRate: ecbRate,
        acquireEcbRate: ecbRate,
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
