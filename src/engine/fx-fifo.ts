/**
 * FX FIFO engine — tracks currency lots per Art. 37.1.l LIRPF.
 *
 * Each EUR→FCY conversion creates a lot; each FCY disposal (conversion
 * back to EUR, or spending FCY on stock purchases) consumes lots via FIFO.
 * DGT V2324-10 confirms FIFO applies to foreign currency holdings.
 */

import Decimal from "decimal.js";
import type { FxLot, FxDisposal, FxTrigger, TaxMessage } from "../types/tax.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import type { EcbRateMap } from "../types/ecb.js";
import { getEcbRate } from "./ecb.js";
import { daysBetween, normalizeDate } from "./dates.js";

export interface FxEvent {
  date: string;
  currency: string;
  /** Positive = acquiring FCY (EUR→FCY), Negative = disposing FCY (FCY→EUR or FCY spent) */
  quantity: Decimal;
  /** EUR rate at event time (EUR per 1 FCY) */
  ecbRate: Decimal;
  trigger: FxTrigger;
}

export class FxFifoEngine {
  private lots: Map<string, FxLot[]> = new Map();
  private disposals: FxDisposal[] = [];
  private nextLotId = 1;
  warnings: string[] = [];
  /** Structured messages with severity, hint, and context */
  messages: TaxMessage[] = [];

  private emit(msg: TaxMessage): void {
    this.messages.push(msg);
    this.warnings.push(msg.message);
  }

  private fxMissing: Map<string, { count: number; totalQty: Decimal }> = new Map();

  /**
   * Process FX events extracted from trades.
   * CASH trades with assetCategory="CASH" that represent actual forex conversions
   * (not automatic FXCONV) generate FX lots and disposals.
   */
  processEvents(events: FxEvent[]): FxDisposal[] {
    this.fxMissing.clear();
    const sorted = [...events].sort((a, b) => {
      const cmp = a.date.localeCompare(b.date);
      if (cmp !== 0) return cmp;
      // Same date: acquisitions (positive qty) before disposals (negative qty)
      const aPhase = a.quantity.greaterThan(0) ? 0 : 1;
      const bPhase = b.quantity.greaterThan(0) ? 0 : 1;
      return aPhase - bPhase;
    });

    for (const event of sorted) {
      if (event.currency === "EUR") continue;

      if (event.quantity.greaterThan(0)) {
        this.addLot(event);
      } else if (event.quantity.lessThan(0)) {
        this.consumeLots(event);
      }
    }

    for (const [currency, { count, totalQty }] of this.fxMissing) {
      this.emit({ id: "fx.missing_prior_lots", severity: "info", message: `⚠ ${count} disposiciones de ${currency} sin lotes previos suficientes (total: ${totalQty.toFixed(2)} ${currency}). Posible adquisición anterior al período declarado — ganancia FX asumida = 0.`, hint: "La adquisición de esta divisa fue anterior al periodo del Flex Query. Se asume ganancia FX = 0 (tratamiento conservador).", context: { currency, count: count.toString(), totalQuantity: totalQty.toFixed(2) } });
    }

    return this.disposals;
  }

  /**
   * Extract FX events from trades.
   *
   * Only explicit CASH trades generate FX events:
   *   - BUY CASH in USD = acquiring USD (add lot)
   *   - SELL CASH in USD = disposing USD (consume lots)
   *
   * FXCONV/AFx-marked trades (automatic broker conversions for settlement)
   * are skipped per-trade via isFxconv(). No global auto-convert detection —
   * accounts can mix manual and automatic conversions freely.
   *
   * Securities trades do NOT generate implicit FX events. This avoids
   * double-counting (the broker's AFx conversion already covers settlement)
   * and eliminates phantom gains from missing prior-year lots.
   */
  static extractFxEvents(trades: Trade[], rateMap: EcbRateMap): FxEvent[] {
    const events: FxEvent[] = [];

    for (const trade of trades) {
      if (trade.currency === "EUR") continue;
      if (trade.assetCategory !== "CASH") continue;
      if (FxFifoEngine.isFxconv(trade)) continue;

      const date = normalizeDate(trade.settlementDate || trade.tradeDate);
      const ecbRate = getEcbRate(rateMap, date, trade.currency);
      const quantity = new Decimal(trade.quantity).abs();

      if (trade.buySell === "BUY") {
        events.push({ date, currency: trade.currency, quantity, ecbRate, trigger: "conversion" });
      } else {
        events.push({ date, currency: trade.currency, quantity: quantity.negated(), ecbRate, trigger: "conversion" });
      }
    }

    return events;
  }

  /**
   * Extract FX events from cash transactions (dividends, interest).
   *
   * Dividends/interest received in FCY create acquisition lots;
   * withholding tax and fees paid in FCY consume lots.
   */
  static extractCashFxEvents(cashTransactions: CashTransaction[], rateMap: EcbRateMap): FxEvent[] {

    const events: FxEvent[] = [];

    for (const tx of cashTransactions) {
      if (tx.currency === "EUR") continue;

      const amount = new Decimal(tx.amount);
      if (amount.isZero()) continue;

      const date = normalizeDate(tx.settleDate || tx.dateTime);
      const ecbRate = getEcbRate(rateMap, date, tx.currency);

      if (tx.type === "Dividends" || tx.type === "Payment In Lieu Of Dividends") {
        events.push({ date, currency: tx.currency, quantity: amount.abs(), ecbRate, trigger: "dividend" });
      } else if (tx.type === "Withholding Tax") {
        events.push({ date, currency: tx.currency, quantity: amount.abs().negated(), ecbRate, trigger: "dividend" });
      } else if (tx.type === "Broker Interest Received" || tx.type === "Bond Interest Received") {
        events.push({ date, currency: tx.currency, quantity: amount.abs(), ecbRate, trigger: "interest" });
      } else if (tx.type === "Broker Interest Paid" || tx.type === "Bond Interest Paid") {
        events.push({ date, currency: tx.currency, quantity: amount.abs().negated(), ecbRate, trigger: "interest" });
      } else if (tx.type === "Other Fees" || tx.type === "Commission Adjustments") {
        if (amount.lessThan(0)) {
          events.push({ date, currency: tx.currency, quantity: amount.abs().negated(), ecbRate, trigger: "commission" });
        } else {
          events.push({ date, currency: tx.currency, quantity: amount.abs(), ecbRate, trigger: "commission" });
        }
      }
    }

    return events;
  }

  /** Detect FXCONV (automatic broker conversions for settlement) */
  private static isFxconv(trade: Trade): boolean {
    const desc = (trade.description || "").toUpperCase();
    const exch = (trade.exchange || "").toUpperCase();
    const notes = (trade.notes || "").toUpperCase().split(";");
    return desc.includes("FXCONV") || desc.includes("CASH RECEIPTS") || desc.includes("CASH DISBURSEMENTS")
      || exch === "FXCONV" || notes.includes("AFX");
  }

  private addLot(event: FxEvent): void {
    const lot: FxLot = {
      id: `FX-${this.nextLotId++}`,
      currency: event.currency,
      acquireDate: event.date,
      quantity: event.quantity,
      costPerUnit: event.ecbRate,
      costInEur: event.quantity.mul(event.ecbRate),
    };

    if (!this.lots.has(event.currency)) {
      this.lots.set(event.currency, []);
    }
    this.lots.get(event.currency)!.push(lot);
  }

  private consumeLots(event: FxEvent): void {
    let remaining = event.quantity.abs();
    const lots = this.lots.get(event.currency);

    if (!lots || lots.length === 0) {
      const entry = this.fxMissing.get(event.currency) ?? { count: 0, totalQty: new Decimal(0) };
      entry.count++;
      entry.totalQty = entry.totalQty.plus(remaining);
      this.fxMissing.set(event.currency, entry);
      // No lots = prior-year acquisition. Record with zero gain (cost = proceeds)
      // to avoid fabricating phantom profits from missing historical data.
      const proceedsEur = remaining.mul(event.ecbRate);
      this.disposals.push({
        currency: event.currency,
        disposeDate: event.date,
        acquireDate: event.date,
        quantity: remaining,
        proceedsEur,
        costBasisEur: proceedsEur,
        gainLossEur: new Decimal(0),
        trigger: event.trigger,
        holdingPeriodDays: 0,
        lotId: "UNKNOWN",
      });
      return;
    }

    while (remaining.greaterThan(0) && lots.length > 0) {
      const lot = lots[0]!;
      const consumed = Decimal.min(remaining, lot.quantity);

      const proceedsEur = consumed.mul(event.ecbRate);
      const costBasisEur = consumed.mul(lot.costPerUnit);
      const holdingDays = daysBetween(lot.acquireDate, event.date);

      this.disposals.push({
        currency: event.currency,
        disposeDate: event.date,
        acquireDate: lot.acquireDate,
        quantity: consumed,
        proceedsEur,
        costBasisEur,
        gainLossEur: proceedsEur.minus(costBasisEur),
        trigger: event.trigger,
        holdingPeriodDays: holdingDays,
        lotId: lot.id,
      });

      lot.quantity = lot.quantity.minus(consumed);
      lot.costInEur = lot.costInEur.minus(costBasisEur);

      if (lot.quantity.isZero()) {
        lots.shift();
      }

      remaining = remaining.minus(consumed);
    }

    if (remaining.greaterThan(0)) {
      const entry = this.fxMissing.get(event.currency) ?? { count: 0, totalQty: new Decimal(0) };
      entry.count++;
      entry.totalQty = entry.totalQty.plus(remaining);
      this.fxMissing.set(event.currency, entry);
      // Without prior-year lots we cannot determine cost basis.
      // Use current rate as cost (zero gain) to avoid fabricating phantom profits.
      const proceedsEur = remaining.mul(event.ecbRate);
      this.disposals.push({
        currency: event.currency,
        disposeDate: event.date,
        acquireDate: event.date,
        quantity: remaining,
        proceedsEur,
        costBasisEur: proceedsEur,
        gainLossEur: new Decimal(0),
        trigger: event.trigger,
        holdingPeriodDays: 0,
        lotId: "UNKNOWN",
      });
    }
  }

  getDisposals(): FxDisposal[] {
    return this.disposals;
  }

  getRemainingLots(): Map<string, FxLot[]> {
    return this.lots;
  }
}
