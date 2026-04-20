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

/** Known asset categories — warn on unknown values to catch future IBKR additions */
const KNOWN_CATEGORIES: ReadonlySet<string> = new Set(["STK", "OPT", "FUT", "CASH", "BOND", "FUND", "WAR", "CRYPTO", "CFD"]);

/** Lot grouping key: ISIN when available; conid for IBKR instruments without ISIN (survives ticker renames); otherwise asset category + symbol */
function lotKey(trade: { isin: string; symbol: string; assetCategory: string; conid?: string }): string {
  if (trade.isin) return trade.isin;
  if (trade.conid) return `${trade.assetCategory}:conid:${trade.conid}`;
  return `${trade.assetCategory}:${trade.symbol}`;
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
    // Process securities: STK, FUND, OPT, FUT, BOND, CFD, CRYPTO
    // Excluded: WAR (warrants — insufficient data), CASH (FX conversions —
    // gain/loss already embedded in securities trades via ECB rate conversion)
    const sorted = [...trades]
      .filter((t) => {
        if (!KNOWN_CATEGORIES.has(t.assetCategory)) {
          this.warnings.push(`⚠ Categoría de activo desconocida: "${t.assetCategory}" para ${t.symbol}. Se procesará con FIFO genérico.`);
        }
        return t.assetCategory !== "WAR" && t.assetCategory !== "CASH";
      })
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

    // Parse mergers (TC = Tender/Change / Acquisition) from corporate actions
    const mergers: { date: string; oldIsin: string; newIsin: string; newSymbol: string; newDescription: string; ratio: number }[] = [];
    for (const ca of (corporateActions ?? []).filter((ca) => ca.type === "TC")) {
      // IBKR description: "TENDER OFFER OLD_SYM(OLD_ISIN) MERGED(Acquisition) FOR RATIO NEW_SYM(NEW_ISIN)"
      // Also handle: "OLD_SYM(OLD_ISIN) MERGED(Acquisition) WITH NEW_SYM(NEW_ISIN) RATIO FOR 1"
      const mergeMatch = ca.description.match(/(\w+)\(([A-Z0-9]+)\)\s+MERGED.*?(\d+(?:\.\d+)?)\s+(?:FOR\s+)?(\d+(?:\.\d+)?)?\s*(\w+)\(([A-Z0-9]+)\)/i);
      if (mergeMatch) {
        const oldIsin = mergeMatch[2]!;
        const newIsin = mergeMatch[6]!;
        const newSymbol = mergeMatch[5]!;
        const ratioNew = parseFloat(mergeMatch[3]!);
        const ratioOld = parseFloat(mergeMatch[4] ?? "1");
        const date = normalizeDate(ca.dateTime.slice(0, 8));
        mergers.push({ date, oldIsin, newIsin, newSymbol, newDescription: ca.description, ratio: ratioNew / ratioOld });
        continue;
      }
      // Simpler format: just transfer all lots from old ISIN to new ISIN
      if (ca.isin && ca.quantity) {
        const qty = new Decimal(ca.quantity);
        if (!qty.isZero()) {
          const date = normalizeDate(ca.dateTime.slice(0, 8));
          mergers.push({
            date,
            oldIsin: ca.isin,
            newIsin: ca.isin, // Same ISIN if no new one detected
            newSymbol: ca.symbol,
            newDescription: ca.description,
            ratio: 1,
          });
        }
      }
    }
    const sortedMergers = mergers.sort((a, b) => a.date.localeCompare(b.date));

    // Parse spin-offs (SO) from corporate actions
    const spinOffs: { date: string; parentIsin: string; newIsin: string; newSymbol: string; newDescription: string; ratio: number; costFraction: number }[] = [];
    for (const ca of (corporateActions ?? []).filter((ca) => ca.type === "SO")) {
      // IBKR: "PARENT_SYM(PARENT_ISIN) SPINOFF RATIO FOR 1 NEW_SYM(NEW_ISIN)"
      const soMatch = ca.description.match(/(\w+)\(([A-Z0-9]+)\)\s+SPINOFF\s+(\d+(?:\.\d+)?)\s+FOR\s+(\d+(?:\.\d+)?)\s+(\w+)\(([A-Z0-9]+)\)/i);
      if (soMatch) {
        const parentIsin = soMatch[2]!;
        const newIsin = soMatch[6]!;
        const newSymbol = soMatch[5]!;
        const ratioNew = parseFloat(soMatch[3]!);
        const ratioOld = parseFloat(soMatch[4]!);
        const date = normalizeDate(ca.dateTime.slice(0, 8));
        // Default cost fraction: estimate from the ratio (will be approximate)
        // In practice, the cost basis split should use market values on the distribution date
        const costFraction = ratioNew / (ratioNew + ratioOld);
        spinOffs.push({ date, parentIsin, newIsin, newSymbol, newDescription: ca.description, ratio: ratioNew / ratioOld, costFraction });
      }
    }
    const sortedSpinOffs = spinOffs.sort((a, b) => a.date.localeCompare(b.date));

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

    // Merge trades, splits, scrip dividends, mergers, and spin-offs into a single chronological timeline
    let splitIdx = 0;
    let sdIdx = 0;
    let mergerIdx = 0;
    let spinOffIdx = 0;

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
      // Apply any mergers that occur before this trade
      while (mergerIdx < sortedMergers.length && sortedMergers[mergerIdx]!.date <= tradeDate) {
        this.applyMerger(sortedMergers[mergerIdx]!);
        mergerIdx++;
      }
      // Apply any spin-offs that occur before this trade
      while (spinOffIdx < sortedSpinOffs.length && sortedSpinOffs[spinOffIdx]!.date <= tradeDate) {
        this.applySpinOff(sortedSpinOffs[spinOffIdx]!);
        spinOffIdx++;
      }

      if (trade.buySell === "BUY") {
        this.addLot(trade, rateMap);
      } else {
        this.consumeLots(trade, rateMap);
      }
    }

    // Apply remaining events after all trades
    while (splitIdx < splits.length) {
      this.applySplit(splits[splitIdx]!);
      splitIdx++;
    }
    while (sdIdx < sortedScripDivs.length) {
      this.addScripDividendLot(sortedScripDivs[sdIdx]!);
      sdIdx++;
    }
    while (mergerIdx < sortedMergers.length) {
      this.applyMerger(sortedMergers[mergerIdx]!);
      mergerIdx++;
    }
    while (spinOffIdx < sortedSpinOffs.length) {
      this.applySpinOff(sortedSpinOffs[spinOffIdx]!);
      spinOffIdx++;
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
    this.warnings.push(`⚡ Split ${split.isin} ${split.ratio}:1 (${direction}) aplicado (${split.date})`);
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

  private applyMerger(merger: { date: string; oldIsin: string; newIsin: string; newSymbol: string; newDescription: string; ratio: number }): void {
    const oldLots = this.lots.get(merger.oldIsin);
    if (!oldLots || oldLots.length === 0) return;

    const ratio = new Decimal(merger.ratio);

    // Transfer all lots from old ISIN to new ISIN, adjusting quantity by ratio
    // Total cost basis is preserved (tax-neutral exchange)
    const newLots: Lot[] = [];
    for (const lot of oldLots) {
      const newQuantity = lot.quantity.mul(ratio);
      newLots.push({
        ...lot,
        id: `LOT-${this.nextLotId++}`,
        isin: merger.newIsin,
        symbol: merger.newSymbol,
        description: merger.newDescription,
        quantity: newQuantity,
        pricePerShare: lot.costInEur.dividedBy(newQuantity), // Recalculate per-share cost
        // costInEur preserved — total cost basis unchanged
      });
    }

    // Remove old lots, add new ones
    this.lots.delete(merger.oldIsin);
    if (!this.lots.has(merger.newIsin)) {
      this.lots.set(merger.newIsin, []);
    }
    this.lots.get(merger.newIsin)!.push(...newLots);

    this.warnings.push(`🔄 Fusión: ${merger.oldIsin} → ${merger.newIsin} (ratio ${merger.ratio}:1, ${oldLots.length} lotes transferidos, ${merger.date})`);
  }

  private applySpinOff(spinOff: { date: string; parentIsin: string; newIsin: string; newSymbol: string; newDescription: string; ratio: number; costFraction: number }): void {
    const parentLots = this.lots.get(spinOff.parentIsin);
    if (!parentLots || parentLots.length === 0) return;

    const ratio = new Decimal(spinOff.ratio);
    const costFraction = new Decimal(spinOff.costFraction);
    const parentFraction = new Decimal(1).minus(costFraction);

    // For each parent lot: split cost basis proportionally and create new lot for spin-off
    const newLots: Lot[] = [];
    for (const lot of parentLots) {
      const spinOffCost = lot.costInEur.mul(costFraction);
      const spinOffQuantity = lot.quantity.mul(ratio);

      // Reduce parent lot cost basis
      lot.costInEur = lot.costInEur.mul(parentFraction);
      lot.pricePerShare = lot.costInEur.dividedBy(lot.quantity);

      // Create new lot for spin-off entity
      newLots.push({
        id: `LOT-${this.nextLotId++}`,
        isin: spinOff.newIsin,
        symbol: spinOff.newSymbol,
        description: spinOff.newDescription,
        acquireDate: lot.acquireDate, // Inherit original acquisition date
        quantity: spinOffQuantity,
        pricePerShare: spinOffCost.dividedBy(spinOffQuantity),
        costInEur: spinOffCost,
        currency: lot.currency,
        ecbRate: lot.ecbRate,
      });
    }

    if (!this.lots.has(spinOff.newIsin)) {
      this.lots.set(spinOff.newIsin, []);
    }
    this.lots.get(spinOff.newIsin)!.push(...newLots);

    this.warnings.push(`🔀 Spin-off: ${spinOff.parentIsin} → ${spinOff.newIsin} (ratio ${spinOff.ratio}:1, coste ${(spinOff.costFraction * 100).toFixed(0)}% al spin-off, ${spinOff.date})`);
  }

  private addLot(trade: Trade, rateMap: EcbRateMap): void {
    const ecbRate = getEcbRate(rateMap, trade.tradeDate, trade.currency);
    const quantity = new Decimal(trade.quantity).abs();
    const pricePerShare = new Decimal(trade.tradePrice);
    const multiplier = new Decimal(trade.multiplier || "1");
    const commission = new Decimal(trade.commission).abs();
    const taxes = new Decimal(trade.taxes || "0").abs();
    const baseAmount = quantity.mul(pricePerShare).mul(multiplier).plus(taxes);
    // Convert commission separately if its currency differs from the trade currency
    const commissionEcbRate = !commission.isZero() && trade.commissionCurrency && trade.commissionCurrency !== trade.currency
      ? getEcbRate(rateMap, trade.tradeDate, trade.commissionCurrency)
      : ecbRate;
    const costInEur = baseAmount.mul(ecbRate).plus(commission.mul(commissionEcbRate));

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
    // Convert commission separately if its currency differs from the trade currency
    const commissionEcbRate = !commission.isZero() && trade.commissionCurrency && trade.commissionCurrency !== trade.currency
      ? getEcbRate(rateMap, trade.tradeDate, trade.commissionCurrency)
      : ecbRate;

    const key = lotKey(trade);
    const lots = this.lots.get(key);
    if (!lots || lots.length === 0) {
      // Short sale or missing prior data — warn and record with zero cost basis
      this.warnings.push(`⚠ Venta sin lotes: ${trade.symbol} (${trade.isin}) × ${remaining} el ${normalizeDate(trade.tradeDate)}. Coste base = 0 (posible posición corta o datos previos incompletos).`);
      const proceedsBaseEur = remaining.mul(pricePerShare).mul(multiplier).minus(taxes).mul(ecbRate);
      const proceedsEur = proceedsBaseEur.minus(commission.mul(commissionEcbRate));
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
        assetCategory: trade.assetCategory,
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
      const proceedsBaseEur = consumed.mul(pricePerShare).mul(multiplier).minus(taxesShare).mul(ecbRate);
      const proceedsEur = proceedsBaseEur.minus(commissionShare.mul(commissionEcbRate));

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
        assetCategory: trade.assetCategory,
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
      this.warnings.push(`⚠ Lotes insuficientes: ${trade.symbol} (${trade.isin}) × ${remaining} el ${normalizeDate(trade.tradeDate)}. Coste base = 0.`);
      const fractionOfSale = remaining.dividedBy(totalSellQuantity);
      const commissionShare = commission.mul(fractionOfSale);
      const taxesShare = taxes.mul(fractionOfSale);
      const proceedsBaseEur = remaining.mul(pricePerShare).mul(multiplier).minus(taxesShare).mul(ecbRate);
      const proceedsEur = proceedsBaseEur.minus(commissionShare.mul(commissionEcbRate));
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
        assetCategory: trade.assetCategory,
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
