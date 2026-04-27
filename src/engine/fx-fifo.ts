/**
 * FX FIFO engine — tracks currency lots per Art. 37.1.l LIRPF.
 *
 * Each EUR→FCY conversion creates a lot; each FCY disposal (conversion
 * back to EUR, or spending FCY on stock purchases) consumes lots via FIFO.
 * DGT V2324-10 confirms FIFO applies to foreign currency holdings.
 */

import Decimal from "decimal.js";
import type { FxLot, FxDisposal, FxTrigger } from "../types/tax.js";
import type { Trade, CashTransaction, CashBalance } from "../types/ibkr.js";
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

  /**
   * Process FX events extracted from trades.
   * CASH trades with assetCategory="CASH" that represent actual forex conversions
   * (not automatic FXCONV) generate FX lots and disposals.
   */
  processEvents(events: FxEvent[]): FxDisposal[] {
    const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));

    for (const event of sorted) {
      if (event.currency === "EUR") continue;

      if (event.quantity.greaterThan(0)) {
        this.addLot(event);
      } else if (event.quantity.lessThan(0)) {
        this.consumeLots(event);
      }
    }

    return this.disposals;
  }

  /**
   * Detect whether the account uses automatic currency conversion.
   * If FXCONV trades exist, the broker converts FCY instantly on each trade —
   * the user never holds FCY between operations, so securities trades
   * don't generate independent FX exposure.
   *
   * Detection uses multiple signals (any one triggers auto-convert):
   * 1. FXCONV/CASH RECEIPTS/DISBURSEMENTS in trade descriptions
   * 2. exchange="FXCONV" on CASH-category trades
   * 3. Heuristic: non-EUR securities trades exist but zero manual CASH trades
   *    (user never converted manually → broker does it automatically)
   */
  static detectAutoConvert(trades: Trade[], cashBalances?: CashBalance[]): boolean {
    // Signal 1+2: Explicit FXCONV markers in trade data
    if (trades.some((t) => t.assetCategory === "CASH" && FxFifoEngine.isFxconv(t))) {
      return true;
    }

    // Signal 3: Heuristic — non-EUR stock trades exist but no manual CASH trades at all
    const hasNonEurSecurities = trades.some(
      (t) => t.currency !== "EUR" && t.assetCategory !== "CASH" && t.assetCategory !== "WAR",
    );
    const hasManualCashTrades = trades.some(
      (t) => t.assetCategory === "CASH" && !FxFifoEngine.isFxconv(t),
    );

    if (hasNonEurSecurities && !hasManualCashTrades) {
      return true;
    }

    // Signal 4: CashBalance shows negligible non-EUR holdings at period end
    if (cashBalances && cashBalances.length > 0 && hasNonEurSecurities) {
      const nonEurBalance = cashBalances
        .filter((b) => b.currency !== "EUR" && b.currency !== "BASE_SUMMARY")
        .reduce((sum, b) => sum.plus(new Decimal(b.endingCash).abs()), new Decimal(0));
      if (nonEurBalance.lessThan(10)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract FX events from trades.
   *
   * Two sources of FX events:
   * 1. CASH trades (assetCategory=CASH): direct forex conversions
   *    - BUY CASH in USD = acquiring USD (add lot)
   *    - SELL CASH in USD = disposing USD (consume lots)
   * 2. Securities trades in non-EUR (ONLY in multi-currency accounts):
   *    - BUY stock in USD = spending USD (dispose FCY lots)
   *    - SELL stock in USD = receiving USD (add FCY lot)
   *
   * Auto-convert accounts: only manual CASH conversions generate FX events.
   * Stock trades are settled instantly via FXCONV — no FX exposure.
   */
  static extractFxEvents(trades: Trade[], rateMap: EcbRateMap, cashBalances?: CashBalance[]): FxEvent[] {
    const autoConvert = FxFifoEngine.detectAutoConvert(trades, cashBalances);
    const events: FxEvent[] = [];

    for (const trade of trades) {
      if (trade.currency === "EUR") continue;

      const date = normalizeDate(trade.tradeDate);
      const ecbRate = getEcbRate(rateMap, date, trade.currency);

      if (trade.assetCategory === "CASH") {
        // Direct forex trade — skip FXCONV (automatic conversions)
        if (FxFifoEngine.isFxconv(trade)) continue;

        const quantity = new Decimal(trade.quantity).abs();
        if (trade.buySell === "BUY") {
          events.push({ date, currency: trade.currency, quantity, ecbRate, trigger: "conversion" });
        } else {
          events.push({ date, currency: trade.currency, quantity: quantity.negated(), ecbRate, trigger: "conversion" });
        }
      } else if (!autoConvert && trade.assetCategory !== "WAR") {
        // Multi-currency account: securities trade = implicit FX event
        const tradeMoney = new Decimal(trade.tradeMoney).abs();
        if (tradeMoney.isZero()) continue;

        if (trade.buySell === "BUY") {
          events.push({ date, currency: trade.currency, quantity: tradeMoney.negated(), ecbRate, trigger: "stock_purchase" });
        } else {
          events.push({ date, currency: trade.currency, quantity: tradeMoney, ecbRate, trigger: "stock_sale" });
        }

        // Commission also consumes FCY (paid in commissionCurrency)
        const commission = new Decimal(trade.commission).abs();
        if (commission.greaterThan(0) && trade.commissionCurrency !== "EUR") {
          const commRate = getEcbRate(rateMap, date, trade.commissionCurrency);
          events.push({ date, currency: trade.commissionCurrency, quantity: commission.negated(), ecbRate: commRate, trigger: "commission" });
        }
      }
    }

    return events;
  }

  /**
   * Extract FX events from cash transactions (dividends, interest).
   *
   * Only relevant for multi-currency accounts where FCY is held.
   * Auto-convert accounts don't hold FCY — dividends/interest are
   * converted instantly, so no FX lots are created.
   */
  static extractCashFxEvents(cashTransactions: CashTransaction[], rateMap: EcbRateMap, autoConvert: boolean): FxEvent[] {
    if (autoConvert) return [];

    const events: FxEvent[] = [];

    for (const tx of cashTransactions) {
      if (tx.currency === "EUR") continue;

      const amount = new Decimal(tx.amount);
      if (amount.isZero()) continue;

      const date = normalizeDate(tx.dateTime);
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
    return desc.includes("FXCONV") || desc.includes("CASH RECEIPTS") || desc.includes("CASH DISBURSEMENTS") || exch === "FXCONV";
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
      this.warnings.push(`⚠ Venta de ${event.currency} sin lotes previos el ${event.date}. Posible adquisición anterior al período declarado.`);
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
      this.warnings.push(`⚠ Lotes FX insuficientes: ${event.currency} × ${remaining} el ${event.date}. Coste = 0.`);
      const proceedsEur = remaining.mul(event.ecbRate);
      this.disposals.push({
        currency: event.currency,
        disposeDate: event.date,
        acquireDate: event.date,
        quantity: remaining,
        proceedsEur,
        costBasisEur: new Decimal(0),
        gainLossEur: proceedsEur,
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
