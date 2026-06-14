/**
 * FX FIFO engine — tracks foreign-currency holdings as patrimonial elements
 * (Art. 33.1 LIRPF: gain/loss = valor de transmisión − valor de adquisición of
 * the divisa; NOT Art. 37.1.l, which governs "incorporaciones que no derivan de
 * una transmisión" — an unrelated rule). DGT V2422-20 / V1613-25 / V0463-21:
 * the FX gain crystallizes only on the effective conversion to euros (cobro/pago,
 * Art. 14.2.e).
 *
 * Each EUR→FCY conversion creates a lot; each FCY disposal (conversion
 * back to EUR, or spending FCY on stock purchases) consumes lots via FIFO.
 * Dividend/interest withholding is a pago a cuenta, NOT a disposal — see
 * extractCashFxEvents (issue #225).
 */

import Decimal from "decimal.js";
import type { FxLot, FxDisposal, FxTrigger, FifoDisposal, TaxMessage } from "../types/tax.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import type { EcbRateMap } from "../types/ecb.js";
import { getEcbRate, isEcbResolvable, lookupRateInMap } from "./ecb.js";
import { daysBetween, normalizeDate } from "./dates.js";

export interface FxEvent {
  date: string;
  currency: string;
  /** Positive = acquiring FCY (EUR→FCY), Negative = disposing FCY (FCY→EUR or FCY spent) */
  quantity: Decimal;
  /** EUR rate at event time (EUR per 1 FCY) */
  ecbRate: Decimal;
  trigger: FxTrigger;
  /** Commission in EUR (positive = cost paid). Increases cost basis on BUY, reduces proceeds on SELL. */
  commissionEur?: Decimal;
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
   * Only explicit CASH trades generate FX events. For BASE.QUOTE pairs:
   *   - If trade.currency matches the quote: quantity is in the base (wrong
   *     currency), so we use tradeMoney (in quote = trade.currency) and invert
   *     polarity (SELL base = acquiring quote, BUY base = disposing quote).
   *   - If trade.currency matches the base: quantity is already in
   *     trade.currency, BUY = acquiring, SELL = disposing.
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

      const quoteIsTarget = FxFifoEngine.isCurrencyQuote(trade);
      let amount: Decimal;
      let acquiring: boolean;

      if (quoteIsTarget) {
        amount = new Decimal(trade.tradeMoney).abs();
        acquiring = trade.buySell === "SELL";
      } else {
        amount = new Decimal(trade.quantity).abs();
        acquiring = trade.buySell === "BUY";
      }

      // Commission increases cost basis (BUY) or reduces proceeds (SELL)
      let commissionEur: Decimal | undefined;
      const commAbs = new Decimal(trade.commission).abs();
      if (commAbs.greaterThan(0)) {
        const commCcy = trade.commissionCurrency || trade.currency;
        if (commCcy === "EUR") {
          commissionEur = commAbs;
        } else {
          const commRate = getEcbRate(rateMap, date, commCcy);
          commissionEur = commAbs.mul(commRate);
        }
      }

      if (acquiring) {
        events.push({ date, currency: trade.currency, quantity: amount, ecbRate, trigger: "conversion", commissionEur });
      } else {
        events.push({ date, currency: trade.currency, quantity: amount.negated(), ecbRate, trigger: "conversion", commissionEur });
      }
    }

    return events;
  }

  /**
   * Detect if trade.currency is the QUOTE side of a BASE.QUOTE pair.
   * When true, quantity is in the base (wrong currency for lot tracking)
   * and tradeMoney is in the quote (= trade.currency).
   */
  private static isCurrencyQuote(trade: Trade): boolean {
    const sym = (trade.symbol || trade.description || "").toUpperCase();
    const dot = sym.indexOf(".");
    if (dot === -1) return false;
    const quote = sym.slice(dot + 1);
    return quote === trade.currency.toUpperCase();
  }

  /**
   * Extract FX events from cash transactions (dividends, interest).
   *
   * Dividends/interest received in FCY create acquisition lots;
   * withholding tax and fees paid in FCY consume lots.
   */
  static extractCashFxEvents(cashTransactions: CashTransaction[], rateMap: EcbRateMap): FxEvent[] {

    const events: FxEvent[] = [];

    // Withholding tax (retención en origen) on a foreign-currency dividend/interest
    // is a PAGO A CUENTA: it is deducted at source, the withheld FCY never enters
    // the taxpayer's spendable balance, and it is not a "conversión de divisas a
    // euros" — so it must NOT create an FX disposal (issue #225). The DGT timing
    // doctrine (V2422-20, V1613-25, V0463-21) crystallizes an FX gain only on the
    // effective conversion to EUR (cobro/pago); a withholding is neither. The
    // GROSS income is still declared independently on the income path (casilla
    // 0029) and the withholding still credits double-taxation (0588) — those read
    // the raw cashTransactions, never these FX events, so they are untouched.
    //
    // Instead of emitting a phantom disposal that FIFO-consumes an OLDER lot at a
    // different rate (the bug), we net each withholding into its income lot: the
    // acquisition lot reflects the NET FCY actually received. FX lots are fungible
    // per currency, so netting by (currency, date) is equivalent to exact issuer
    // pairing and far simpler. A withholding with no same-(currency,date) income
    // (orphan / cross-date reclaim) is dropped — still never a disposal.
    //
    // The orphan drop is intentionally SILENT (no warning): extractCashFxEvents is
    // static with no `emit`/messages channel, and the condition is non-actionable —
    // the gross income (0029) and the 0588 credit are declared by the income path
    // regardless; the only effect is a marginally-gross FX lot. Surfacing it would
    // add anxiety for nothing. If a diagnostic is ever wanted, aggregate it in
    // report.ts after processEvents, not here.
    const whtByKey = new Map<string, Decimal>();
    for (const tx of cashTransactions) {
      if (tx.type !== "Withholding Tax" || tx.currency === "EUR") continue;
      const amt = new Decimal(tx.amount);
      if (!amt.isNegative()) continue; // a positive WHT (refund) is FCY received, not a deduction
      const key = `${tx.currency}|${normalizeDate(tx.settleDate || tx.dateTime)}`;
      whtByKey.set(key, (whtByKey.get(key) ?? new Decimal(0)).plus(amt.abs()));
    }
    /**
     * Reduce an income inflow by any withholding pending for its (currency,date),
     * returning the NET FCY received. STATEFUL: it draws down the shared `whtByKey`
     * bucket, so two same-(currency,date) incomes split one withholding total rather
     * than each netting it in full; order within a key doesn't change the total netted.
     * NOTE: this keys on the EXACT same-date (currency,date), deliberately coarser
     * AND stricter than the income path's matcher in dividends.ts (ISIN + currency +
     * ≤7-day window). Coarser is safe for FX because lots are fungible per currency
     * (the net-per-currency total is what matters, not which issuer). Stricter on the
     * date means a withholding booked on a DIFFERENT settle-date than its dividend
     * isn't matched here → it's an orphan, dropped, and the lot stays gross. That is
     * conservative (no phantom disposal; the extra FCY only ever yields real drift on
     * currency actually received) and immaterial — accepted deliberately.
     */
    const consumeWithholding = (currency: string, date: string, gross: Decimal): Decimal => {
      const key = `${currency}|${date}`;
      const pending = whtByKey.get(key);
      if (!pending || pending.isZero()) return gross;
      const applied = Decimal.min(pending, gross);
      whtByKey.set(key, pending.minus(applied));
      return gross.minus(applied);
    };

    for (const tx of cashTransactions) {
      if (tx.currency === "EUR") continue;

      const amount = new Decimal(tx.amount);
      if (amount.isZero()) continue;

      // Crypto reward income (staking, Simple Earn interest, airdrops, referral)
      // is valued and taxed entirely on the income path in report.ts; it must
      // never generate an FX event here. Skip it BEFORE any rate lookup — its
      // currency may be a coin (e.g. USDT) whose ECB/USD rate was not fetched,
      // and getEcbRate would otherwise throw and crash the whole report.
      if (tx.type === "Crypto Reward Income") continue;

      // Crypto-denominated income (e.g. Kraken staking, reported in the staked
      // coin) has no ECB rate. It can't generate an FX event — skip it here.
      // report.ts surfaces a warning so the user values it manually.
      if (!isEcbResolvable(tx.currency)) continue;

      const date = normalizeDate(tx.settleDate || tx.dateTime);
      // A resolvable currency whose rate was not fetched (e.g. an FCY income in
      // a year with no trades) must not throw — skip the event and let report.ts
      // surface it. lookupRateInMap returns null instead of throwing.
      const ecbRate = lookupRateInMap(rateMap, date, tx.currency);
      if (ecbRate === null) continue;

      if (tx.type === "Dividends" || tx.type === "Payment In Lieu Of Dividends") {
        // Net the same-(currency,date) withholding into the dividend lot.
        const net = consumeWithholding(tx.currency, date, amount.abs());
        // `greaterThan(0)`, not `isPositive()` — decimal.js treats +0 as positive,
        // and a zero-quantity event would make addLot compute 0/0 = NaN.
        if (net.greaterThan(0)) {
          events.push({ date, currency: tx.currency, quantity: net, ecbRate, trigger: "dividend" });
        }
      } else if (tx.type === "Withholding Tax") {
        // Netted into its income inflow above (or dropped if orphan). Never a
        // disposal. A positive-amount WHT (a refund) IS currency received → acquire.
        // Defensive: not observed in current broker exports, but symmetric and cheap.
        if (amount.greaterThan(0)) {
          events.push({ date, currency: tx.currency, quantity: amount, ecbRate, trigger: "dividend" });
        }
      } else if (tx.type === "Broker Interest Received" || tx.type === "Bond Interest Received") {
        // Interest can also carry withholding (e.g. "WITHHOLDING ON CREDIT INT");
        // net it the same way — a withholding is a pago a cuenta whatever the income.
        const net = consumeWithholding(tx.currency, date, amount.abs());
        if (net.greaterThan(0)) {
          events.push({ date, currency: tx.currency, quantity: net, ecbRate, trigger: "interest" });
        }
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

  /**
   * Extract FX ACQUISITION events from the foreign-currency PROCEEDS of stock
   * (security) sales — the divisa-side effect of selling a foreign-currency
   * security, deferred to its eventual conversion to euros (issue #230, "Model D").
   *
   * WHY THIS EXISTS — the two FIFO engines are decoupled. The stock FIFO
   * (fifo.ts) converts a security's gain at the disposal-date rate (V2422-20),
   * which deliberately STRIPS the buy↔sale FX drift out of the stock gain so the
   * currency can be taxed separately as its own patrimonial element (Art. 33.1
   * LIRPF). But selling a foreign-currency stock is exactly how the taxpayer
   * ACQUIRES that foreign currency: sell a $1200 USD stock and you now hold $1200
   * of real dollars. Until this producer existed, that inflow created no FX lot,
   * so a later USD→EUR conversion had nothing to consume and the currency drift
   * went untaxed. This method feeds those proceeds into the FX FIFO as an
   * acquisition lot so the eventual conversion correctly taxes the EUR/FX gain.
   *
   * FULL NET PROCEEDS, NOT THE GAIN (load-bearing fiscal decision). The lot
   * quantity is `proceedsFcy` — the WHOLE amount of foreign currency received
   * (already net of commission and taxes per fifo.ts), NOT `gainLossFcy`. The
   * dollars you receive selling a $1200 stock are $1200 of real currency, not the
   * $200 profit; sizing the lot to the gain would track only a fraction of the
   * currency actually held and systematically UNDER-declare the later FX gain.
   *
   * GAINS AND LOSSES ALIKE — no forced disposal, no "destruction". The stock's
   * P&L sign is irrelevant to the currency received: a loss-making sale still
   * hands you dollars. So a sale produces an acquisition lot whether the stock
   * made a profit or a loss. There is NO disposal emitted here and nothing is
   * destroyed on a loss — this is purely an ACQUISITION producer.
   *
   * NO BUY-SIDE HANDLING — buys neither create nor consume FX lots here. A stock
   * PURCHASE spends foreign currency, but per the FX-engine simplification
   * (v0.39.2) securities trades do not emit implicit FX disposals (that produced
   * phantom gains from missing prior-year lots and double-counted the broker's
   * AFx settlement). Symmetrically, only the SALE side is modelled — as a pure
   * positive (acquisition) event. The existing `processEvents` routes positive
   * quantities to `addLot`; this producer emits nothing negative.
   *
   * DEFERRED TO CONVERSION (Art. 14.2.e LIRPF; DGT V2422-20 / V1613-25 /
   * V0463-21). Receiving the foreign currency is NOT itself a taxable event for
   * the divisa — the FX gain crystallizes only on the effective conversion to
   * euros (cobro/pago). So this method only ADDS a lot; the gain is realized
   * later when a conversion disposal consumes it. With no subsequent conversion,
   * the lot simply sits in the queue and is never taxed — exactly the deferral
   * the law requires.
   *
   * V2324-10 SYMMETRIC CRITERION. DGT V2324-10 confirms FIFO for foreign currency
   * as a homogeneous patrimonial element. We apply the SAME resolvability and
   * category filter on the producer side as the consumer side uses, so a currency
   * we would track on conversion is the same set we create lots for on a sale —
   * no asymmetry that could orphan a conversion against a missing acquisition.
   *
   * WHY PHANTOM/ORPHAN LOTS ARE BENIGN. Because `processEvents` consumes
   * FIFO-oldest-first and a missing-lot disposal is floored to a zero FX gain
   * (the "sin lotes previos" path, never a fabricated profit), an extra
   * acquisition lot from a sale can only ever (a) be matched by a real later
   * conversion — the intended behavior — or (b) sit unconsumed and untaxed
   * (correct deferral). It can never manufacture a phantom gain.
   *
   * Events returned here are designed to be concatenated into the SAME
   * `processEvents` call as the conversion/dividend/interest events, so the
   * stock-sale acquisition lots are present in the FIFO queue by the time a later
   * USD→EUR conversion disposal consumes them.
   */
  static extractStockProceedsFxEvents(disposals: FifoDisposal[]): FxEvent[] {
    const events: FxEvent[] = [];
    // Only genuine securities produce a foreign-currency cash inflow we track as
    // divisa. CRYPTO is excluded (a crypto↔crypto permuta's proceedsFcy is in a
    // coin, not fiat — handled by the crypto valuation path); OPT/FOP/FSFOP and
    // CASH conversions are excluded too (the latter are already the FX engine's
    // own conversion events — including them here would double-count).
    const SECURITY_CATEGORIES = new Set(["STK", "FUND", "BOND"]);
    for (const d of disposals) {
      if (d.currency === "EUR") continue;
      if (!SECURITY_CATEGORIES.has(d.assetCategory)) continue; // exclude crypto permutas, options/FOP, CASH conversions
      if (!isEcbResolvable(d.currency)) continue;               // genuine fiat FCY only
      if (!d.proceedsFcy.greaterThan(0)) continue;              // skip non-positive (defensive)
      events.push({
        date: normalizeDate(d.sellDate),
        currency: d.currency,
        quantity: d.proceedsFcy,        // FULL net proceeds in FCY (already net of commission/taxes)
        ecbRate: d.sellEcbRate,         // sale-date ECB rate
        trigger: "stock_sale",
      });
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
    // Defense-in-depth: never create a lot for a non-positive quantity — costPerUnit
    // would be 0/0 = NaN and silently poison all later FIFO math for this currency.
    if (!event.quantity.greaterThan(0)) return;
    // Commission increases the EUR cost of acquiring the lot
    const baseCost = event.quantity.mul(event.ecbRate);
    const totalCost = event.commissionEur ? baseCost.plus(event.commissionEur) : baseCost;
    const costPerUnit = totalCost.div(event.quantity);

    const lot: FxLot = {
      id: `FX-${this.nextLotId++}`,
      currency: event.currency,
      acquireDate: event.date,
      quantity: event.quantity,
      costPerUnit,
      costInEur: totalCost,
    };

    if (!this.lots.has(event.currency)) {
      this.lots.set(event.currency, []);
    }
    this.lots.get(event.currency)!.push(lot);
  }

  private consumeLots(event: FxEvent): void {
    let remaining = event.quantity.abs();
    const totalQty = remaining;
    const lots = this.lots.get(event.currency);

    if (!lots || lots.length === 0) {
      const entry = this.fxMissing.get(event.currency) ?? { count: 0, totalQty: new Decimal(0) };
      entry.count++;
      entry.totalQty = entry.totalQty.plus(remaining);
      this.fxMissing.set(event.currency, entry);
      const proceedsEur = remaining.mul(event.ecbRate);
      const netProceeds = event.commissionEur ? proceedsEur.minus(event.commissionEur) : proceedsEur;
      this.disposals.push({
        currency: event.currency,
        disposeDate: event.date,
        acquireDate: event.date,
        quantity: remaining,
        proceedsEur: netProceeds,
        costBasisEur: netProceeds,
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

      // Commission reduces proceeds, distributed proportionally across consumed lots
      let proceedsEur = consumed.mul(event.ecbRate);
      if (event.commissionEur) {
        const proportion = consumed.div(totalQty);
        proceedsEur = proceedsEur.minus(event.commissionEur.mul(proportion));
      }
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
      let proceedsEur = remaining.mul(event.ecbRate);
      if (event.commissionEur) {
        const proportion = remaining.div(totalQty);
        proceedsEur = proceedsEur.minus(event.commissionEur.mul(proportion));
      }
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
