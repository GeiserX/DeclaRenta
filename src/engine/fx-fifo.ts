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
import type { FxLot, FxDisposal, FxTrigger, FifoDisposal, TaxMessage, FxTraceEvent, FxTraceKind } from "../types/tax.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import type { EcbRateMap } from "../types/ecb.js";
import { getEcbRate, isEcbResolvable, lookupRateInMap } from "./ecb.js";
import { daysBetween, normalizeDate } from "./dates.js";

/**
 * One foreign-currency event fed to {@link FxFifoEngine.processEvents}.
 *
 * ENCODING (three shapes share this one interface, discriminated by `kind`):
 *
 *  1. ACQUIRE/DISPOSE (the original shape; `kind` absent). Signed `quantity`
 *     drives it: positive = acquiring FCY (EUR→FCY conversion, dividend, interest
 *     received) → a pool lot; negative = disposing FCY (FCY→EUR conversion, fee,
 *     interest paid) → consume the pool FIFO and realize an FX gain (emits a
 *     FxDisposal). `commissionEur` adjusts the EUR cost/proceeds. UNCHANGED — all
 *     existing producers (extractFxEvents, extractCashFxEvents) still emit this.
 *
 *  2. STOCK_BUY (`kind: "stock_buy"`). The divisa-side of a foreign-currency
 *     stock PURCHASE: it spends `costFcy` of foreign currency. It silently
 *     CONSUMES that `costFcy` from the per-currency pool FIFO and PARKS the
 *     carried basis under its `positionKey` (any shortfall parks "uncovered").
 *     It realizes NO gain and emits NO disposal. `quantity` is unused (set to
 *     0) — the amount spent is `costFcy`.
 *
 *  3. STOCK_SELL (`kind: "stock_sell"`). The divisa-side of a foreign-currency
 *     stock SALE: it received `proceedsFcy`, of which `costFcy` is the principal
 *     that had been parked at the matching buy UNDER THE SAME `positionKey`. It
 *     re-adds that position's carried principal (up to the proceeds) plus the
 *     profit at the sale rate. It emits NO disposal — the FX gain defers to the
 *     eventual EUR conversion. `quantity` is unused.
 *
 * Buys/sells never appear as a signed `quantity`, so the existing positive/
 * negative routing in processEvents is untouched by them — they are dispatched
 * solely on `kind`. See the carry-basis-defer doc on processEvents.
 */
export interface FxEvent {
  date: string;
  currency: string;
  /**
   * For acquire/dispose events (kind absent): Positive = acquiring FCY (EUR→FCY),
   * Negative = disposing FCY (FCY→EUR or FCY spent). For stock_buy/stock_sell the
   * spent/received amounts live in costFcy/proceedsFcy and this is unused (0).
   */
  quantity: Decimal;
  /** EUR rate at event time (EUR per 1 FCY) */
  ecbRate: Decimal;
  trigger: FxTrigger;
  /** Commission in EUR (positive = cost paid). Increases cost basis on BUY, reduces proceeds on SELL. */
  commissionEur?: Decimal;
  /**
   * Discriminator for the carry-basis stock events. Absent → a plain
   * acquire/dispose driven by signed `quantity` (the original behavior).
   */
  kind?: "stock_buy" | "stock_sell";
  /**
   * Stock buy/sell: the foreign-currency PRINCIPAL of the position. On a buy it
   * is the FCY cash outflow consumed from the pool and parked; on a sell it is
   * the parked principal pulled back and re-added (the part of the proceeds that
   * is "the same dollars" returning, not new profit).
   */
  costFcy?: Decimal;
  /** Stock sell only: the total FCY received (principal + profit). */
  proceedsFcy?: Decimal;
  /**
   * Stock buy/sell ONLY: the stable identity of the position whose principal is
   * being parked (buy) or unparked (sell). Both producers derive it IDENTICALLY
   * — `isin || symbol`, mirroring fifo.ts `lotKey` for the STK/FUND/BOND case
   * these events cover — so a SELL only ever reclaims the principal ITS OWN
   * position parked. This makes the parked FIFO per-(currency, position), not
   * per-currency: an option-exercise/assignment STK disposal (fifo.ts emits these
   * with `assetCategory:"STK"` and the underlying's isin/symbol but NO backing BUY
   * trade) finds no parked principal under its key and cleanly degrades to the
   * "unmatched sell → re-add at sale rate" path, instead of wrongly draining a
   * DIFFERENT same-currency position's parked basis. Absent for acquire/dispose.
   */
  positionKey?: string;
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
   * Opt-in movement trace (audit/diagnostic only — issue #230 follow-up). OFF by
   * default and ZERO-COST when off: every `record()` call returns immediately
   * unless `traceEnabled` is set via {@link enableTrace}. When on, each pool/park
   * movement appends an {@link FxTraceEvent} so a developer/advisor can verify how
   * a 1633/1637 figure was built. Never surfaced in the standard UI.
   */
  private traceEnabled = false;
  private trace: FxTraceEvent[] = [];
  private traceSeq = 0;

  /** Enable the movement trace (see {@link getTrace}). Call before processEvents. */
  enableTrace(): void {
    this.traceEnabled = true;
  }

  /** The recorded FX-FIFO movement trace (empty unless {@link enableTrace} was called). */
  getTrace(): FxTraceEvent[] {
    return this.trace;
  }

  /** Sum the FCY quantity remaining in the spendable pool for a currency. */
  private poolBalance(currency: string): Decimal {
    const lots = this.lots.get(currency);
    if (!lots) return new Decimal(0);
    return lots.reduce((s, l) => s.plus(l.quantity), new Decimal(0));
  }

  /** Sum the FCY quantity remaining in a (currency, position) parked queue. */
  private parkedBalance(currency: string, positionKey: string | undefined): Decimal {
    const park = this.parked.get(FxFifoEngine.parkKey(currency, positionKey));
    if (!park) return new Decimal(0);
    return park.reduce((s, p) => s.plus(p.q), new Decimal(0));
  }

  /**
   * Append one movement to the trace (no-op unless tracing is enabled). Captures
   * the running pool/parked balances AFTER the caller has applied the movement,
   * so the trace reads as a chronological ledger. All monetary values are stored
   * as decimal strings (the {@link FxTraceEvent} contract).
   */
  private record(
    kind: FxTraceKind,
    event: FxEvent,
    fields: {
      quantityFcy: Decimal;
      rate: Decimal | null;
      costBasisEur?: Decimal;
      proceedsEur?: Decimal;
      gainLossEur?: Decimal;
      lotId?: string;
      note?: string;
    },
  ): void {
    if (!this.traceEnabled) return;
    this.trace.push({
      seq: ++this.traceSeq,
      date: event.date,
      kind,
      currency: event.currency,
      trigger: event.trigger,
      quantityFcy: fields.quantityFcy.toString(),
      rate: fields.rate === null ? null : fields.rate.toString(),
      ...(fields.costBasisEur !== undefined ? { costBasisEur: fields.costBasisEur.toString() } : {}),
      ...(fields.proceedsEur !== undefined ? { proceedsEur: fields.proceedsEur.toString() } : {}),
      ...(fields.gainLossEur !== undefined ? { gainLossEur: fields.gainLossEur.toString() } : {}),
      poolBalanceFcy: this.poolBalance(event.currency).toString(),
      parkedBalanceFcy: this.parkedBalance(event.currency, event.positionKey).toString(),
      ...(event.positionKey !== undefined ? { positionKey: event.positionKey } : {}),
      ...(fields.lotId !== undefined ? { lotId: fields.lotId } : {}),
      ...(fields.note !== undefined ? { note: fields.note } : {}),
    });
  }

  /**
   * PARKED FIFO per (currency, position) — the foreign-currency PRINCIPAL
   * currently locked inside OPEN foreign-stock positions, carrying its EUR
   * acquisition basis.
   *
   * KEYED PER POSITION, NOT PER CURRENCY (the carry-basis review fix). The map
   * key is the composite `${currency}|${positionKey}` ({@link parkKey}), where
   * `positionKey` is the stock's identity (`isin || symbol` — see
   * {@link positionKey}, mirroring fifo.ts `lotKey`). The BUY producer
   * ({@link FxFifoEngine.extractStockPurchaseFxEvents}) and the SELL producer
   * ({@link FxFifoEngine.extractStockProceedsFxEvents}) derive the SAME
   * `positionKey` for the same position, so a SELL only ever reclaims the
   * principal ITS OWN position parked. WHY this matters: option exercises and
   * assignments emit `assetCategory:"STK"` disposals (fifo.ts) with the
   * underlying's isin/symbol but NO backing BUY trade — with per-CURRENCY keying
   * such a sell could unpark, and mis-rate, a DIFFERENT same-currency position's
   * parked basis. Per-position keying confines each unpark to its own queue; an
   * option-delivered-share sale finds nothing parked under its key and cleanly
   * degrades to the "unmatched sell → re-add at sale rate" path (the
   * funding-absent no-op). For every SINGLE-position scenario per-position keying
   * is identical to per-currency, so the validated invariants (S1/S2/S6/S8 and
   * the A* no-ops) are unchanged — the fix only bites multi-position-same-currency
   * cases.
   *
   * NOTE the SPENDABLE pool (`this.lots`) stays PER CURRENCY — FCY is fungible
   * for SPENDING, so a buy still consumes the shared currency pool oldest-first;
   * it merely PARKS the carried basis under its position key so the matching
   * sell reclaims its own principal.
   *
   * A `rate` of `null` is an "uncovered" parking: the FCY the buy spent had no
   * tracked acquisition lot (funding outside the data window — AFx settlement, a
   * single-year export), so there is no basis to carry; a later sell re-adds that
   * portion at the SALE rate, which is exactly what reproduces the pre-#230
   * full-proceeds behavior (the funding-absent no-op safety property).
   *
   * Transient, like `fxMissing`: cleared at the start of every processEvents run.
   * Whatever stays parked at the end is principal in positions still open at the
   * period boundary — correctly never converted, never taxed.
   *
   * Each parked slice also carries `acquireDate` — the ORIGINAL acquisition date
   * of the pool lot the buy consumed (`null` for an uncovered slice, which has no
   * tracked origin). The matching SELL re-adds the principal to the pool stamped
   * with THIS date (not the sale date), so the spendable pool stays FIFO-ordered
   * by genuine acquisition date and a later conversion consumes the truly-oldest
   * dollars first (issue #230; DGT V0282-22: the returned principal keeps its
   * original acquisition date — only the trading PROFIT is newly-acquired at the
   * sale rate/date). The carried EUR basis is `rate`; the carried date is
   * `acquireDate` — both travel with the principal across the round-trip.
   */
  private parked: Map<string, { q: Decimal; rate: Decimal | null; acquireDate: string | null }[]> = new Map();

  /**
   * Stable identity of a foreign-stock POSITION for the parked FIFO. `isin ||
   * symbol`, mirroring fifo.ts `lotKey` for the STK/FUND/BOND case the carry-basis
   * stock events cover (those producers already exclude CRYPTO/OPT/FOP, so the
   * conid/CRYPTO branches of `lotKey` are out of scope here). Both the BUY and the
   * SELL producer call this so the same position yields the same key on both
   * sides — the load-bearing requirement for a sell to reclaim only its own
   * parked principal.
   */
  private static positionKey(ref: { isin: string; symbol: string }): string {
    return ref.isin || ref.symbol;
  }

  /**
   * Composite key for the parked FIFO. With a positionKey: `${currency}|${positionKey}`
   * — the per-position queue. WITHOUT one: the BARE currency (`${currency}`,
   * unchanged from the old per-currency keying). The bare-currency fallback is
   * deliberate and load-bearing in two ways:
   *   1. Every PRODUCTION stock_buy/stock_sell sets positionKey, so real data
   *      always partitions per position.
   *   2. A buy and a sell that BOTH omit positionKey collapse to the SAME bare
   *      `${currency}` queue, so they still park/unpark against each other — this
   *      is exactly the old per-currency behavior, which is what the
   *      reference/unit harnesses (no positionKey) exercise. Falling back to the
   *      bare currency (not `${currency}|`) also keeps `getParked().get(currency)`
   *      working for those harnesses.
   * For a given run the two forms never collide: a position's isin/symbol is
   * non-empty, so `${currency}|${positionKey}` is always distinct from `${currency}`.
   */
  private static parkKey(currency: string, positionKey: string | undefined): string {
    return positionKey ? `${currency}|${positionKey}` : currency;
  }

  /**
   * Same-day processing phase (CRITICAL ordering). Generalizes the original
   * 2-phase "acquisitions before disposals" sort to 4 phases so the carry-basis
   * stock events interleave correctly when they fall on the same date:
   *
   *   (0) pool ACQUISITIONS — positive non-stock (conversion-in / dividend /
   *       interest received). FCY must be in the pool before a buy can spend it.
   *   (1) STOCK_BUY — park/consume. Removes spent FCY from the pool and parks it.
   *   (2) STOCK_SELL — re-add. A same-day sell of a just-bought position needs the
   *       buy's parked principal already present (1 < 2).
   *   (3) DISPOSALS — negative non-stock (conversion-out / fee / interest paid). A
   *       same-day conversion must see the sell's re-added proceeds (2 < 3).
   *
   * EQUIVALENCE TO THE OLD SORT: with NO stock events, only phases 0 and 3 occur,
   * and 0 < 3 reproduces "positive (acquire) before negative (dispose)" exactly —
   * so CASH-only / dividend-only / interest-only flows are byte-identical. Verified
   * by the existing fx-fifo / cash / conversion suites staying green.
   */
  private static phaseOf(event: FxEvent): number {
    if (event.kind === "stock_buy") return 1;
    if (event.kind === "stock_sell") return 2;
    return event.quantity.greaterThan(0) ? 0 : 3;
  }

  /**
   * Process FX events extracted from trades.
   * CASH trades with assetCategory="CASH" that represent actual forex conversions
   * (not automatic FXCONV) generate FX lots and disposals.
   *
   * Carry-basis-defer model (issue #230 follow-up). The full event set is the
   * concatenation of conversion, dividend/interest, stock-buy and stock-sell
   * producers, processed in (date, phase) order — see {@link phaseOf}. Only the
   * acquire/dispose (signed-quantity) events emit FxDisposals; stock buys/sells
   * move principal between the spendable pool and the parked FIFO and realize
   * nothing (the divisa gain defers to the conversion that consumes the pool).
   */
  processEvents(events: FxEvent[]): FxDisposal[] {
    this.fxMissing.clear();
    this.parked.clear();
    this.trace = [];
    this.traceSeq = 0;
    const sorted = [...events].sort((a, b) => {
      const cmp = a.date.localeCompare(b.date);
      if (cmp !== 0) return cmp;
      // Same date: 4-phase rank (acquire < stock_buy < stock_sell < dispose).
      return FxFifoEngine.phaseOf(a) - FxFifoEngine.phaseOf(b);
    });

    for (const event of sorted) {
      if (event.currency === "EUR") continue;

      if (event.kind === "stock_buy") {
        this.parkPrincipal(event);
      } else if (event.kind === "stock_sell") {
        this.unparkAndReadd(event);
      } else if (event.quantity.greaterThan(0)) {
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
   * Extract the SELL-side carry-basis FX events from foreign-currency stock
   * (security) disposals — the divisa-side effect of SELLING a foreign-currency
   * security under the carry-basis-defer model (issue #230 follow-up, supersedes
   * the v0.49.0 full-proceeds model).
   *
   * WHY THIS EXISTS — the two FIFO engines are decoupled. The stock FIFO
   * (fifo.ts) converts a security's gain at the disposal-date rate (V2422-20),
   * deliberately STRIPPING the buy↔sale FX drift out of the stock gain so the
   * currency is taxed separately as its own patrimonial element (Art. 33.1
   * LIRPF). Selling a foreign-currency stock returns the dollars that were
   * spent buying it (the principal) plus a profit/loss; those dollars must
   * re-enter the divisa pool so a later USD→EUR conversion taxes the right FX
   * gain. The matching BUY removed (parked) that principal — see
   * {@link extractStockPurchaseFxEvents}; this method re-adds it.
   *
   * CARRY-BASIS, NOT FULL PROCEEDS (the v0.49.0 → follow-up correction). The old
   * model pushed the WHOLE `proceedsFcy` as a fresh acquisition lot at the sale
   * rate and did NO buy-side accounting. Across multiple same-currency
   * round-trips the FX FIFO balance DIVERGED from the real spendable balance and
   * a later conversion consumed the wrong "oldest" dollars (proven: €450 reported
   * vs €320 correct on a two-round-trip account, off by €130). The fix splits the
   * proceeds into PRINCIPAL (`costBasisFcy`) re-added at its CARRIED basis (set by
   * the buy that parked it) and PROFIT (`proceedsFcy − costBasisFcy`, when
   * positive) added at the sale rate. So this method emits a `stock_sell` event
   * carrying BOTH `costFcy` (= `costBasisFcy`) and `proceedsFcy`; the parked-FIFO
   * re-add logic lives in {@link unparkAndReadd}.
   *
   * GAINS AND LOSSES ALIKE, STILL NO DISPOSAL. The stock P&L sign does not make
   * this a disposal: a sale only MOVES principal back into the pool (at its carry)
   * and tops up profit. On a LOSS the principal beyond the proceeds is discarded
   * by `unparkAndReadd` (those dollars left the patrimony in the losing trade).
   * No FxDisposal is emitted — the divisa gain defers to the EUR conversion
   * (Art. 14.2.e LIRPF; DGT V2422-20 / V1613-25 / V0463-21).
   *
   * UNMATCHED SELL = FULL-PROCEEDS NO-OP. If the sold position was bought OUTSIDE
   * the data window (no parked principal), `unparkAndReadd` re-adds at the sale
   * rate — reproducing the pre-#230 full-proceeds behavior exactly. This is the
   * load-bearing safety property: nothing changes for single-year/AFx files.
   *
   * SAME FILTERS AS THE BUY/CONSUMER SIDE (V2324-10 symmetry). STK/FUND/BOND only
   * (CRYPTO permutas' proceedsFcy is a coin, not fiat → crypto path; OPT/FOP/CASH
   * excluded — CASH conversions are the FX engine's own events). `currency ≠ EUR`,
   * ECB-resolvable, `proceedsFcy > 0`, and NOT a short close (`isShort`): a cover
   * SPENDS FCY (its FifoDisposal carries the OPEN proceeds dated at the CLOSE), so
   * it is neither a buy nor a sell of held dollars here.
   *
   * Concatenated into the SAME `processEvents` call as the conversion, dividend/
   * interest, and stock-buy events; the 4-phase + date sort guarantees the buy
   * parks before this sell re-adds and before a conversion consumes the result.
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
      // A SHORT close (BUY+C covering a SELL+O) must NOT seed a sell here. Its
      // FifoDisposal carries the OPEN proceeds (the FCY received when the short
      // was opened, possibly a prior year) but is dated at the CLOSE — and a
      // cover SPENDS foreign currency to buy the shares back, it does not receive
      // it. Re-adding the gross open proceeds at the close date/rate would
      // mis-date, mis-rate, and over-state held FCY. A short's divisa leg is
      // genuinely different (inflow at open, outflow at close); the carry-basis
      // long-round-trip model can't represent it, so we skip it. A later
      // conversion of the real short profit then hits the conservative missing-lot
      // floor (gain = 0) rather than a fabricated gain.
      if (d.isShort) continue;
      if (!isEcbResolvable(d.currency)) continue;               // genuine fiat FCY only
      if (!d.proceedsFcy.greaterThan(0)) continue;              // skip non-positive (defensive)
      events.push({
        kind: "stock_sell",
        date: normalizeDate(d.sellDate),
        currency: d.currency,
        quantity: new Decimal(0),       // unused for stock_sell (amounts are in costFcy/proceedsFcy)
        costFcy: d.costBasisFcy,        // principal that was parked at the matching buy
        proceedsFcy: d.proceedsFcy,     // FULL net proceeds in FCY (already net of commission/taxes)
        ecbRate: d.sellEcbRate,         // sale-date ECB rate (for the profit and uncovered/unmatched re-add)
        trigger: "stock_sale",
        // Per-position key (isin || symbol) — IDENTICAL derivation to the buy
        // producer, so this sell unparks ONLY its own position's principal. An
        // option-exercise/assignment STK disposal carries the underlying's
        // isin/symbol but parked nothing (no backing BUY) → no match under this
        // key → it falls through to the safe sale-rate re-add (full-proceeds).
        positionKey: FxFifoEngine.positionKey(d),
      });
    }
    return events;
  }

  /**
   * Extract the BUY-side carry-basis FX events from foreign-currency stock
   * (security) PURCHASES — the divisa-side effect of BUYING a foreign-currency
   * security (issue #230 follow-up). The companion of
   * {@link extractStockProceedsFxEvents}.
   *
   * A foreign-currency stock BUY spends `costFcy` of foreign currency. The
   * resulting `stock_buy` event makes {@link parkPrincipal} silently CONSUME that
   * FCY from the spendable pool (FIFO oldest-first) and PARK the carried EUR basis
   * inside the open position — NO disposal, NO realized gain (the buy never
   * reaches the disposal path, so it cannot re-arm the missing-prior-year-lots
   * phantom gain that PR #143/#171 removed). The matching SELL later re-adds that
   * principal at its carry; an UNCOVERED buy (no tracked funding) is a safe no-op
   * against an empty pool and the sell re-adds at the sale rate (full-proceeds
   * equivalence).
   *
   * costFcy MIRRORS fifo.ts addLot EXACTLY — `quantity × tradePrice × multiplier
   * + taxes + commissionFcy`, where a commission in a different currency is
   * homogenized to the share currency via the trade-date cross-rate
   * (`commission × rate(commCcy) / rate(shareCcy)`). This is the SAME FCY cash
   * outflow that `fifo.ts` books as the lot's `costInFcy`, so the principal parked
   * here equals the principal the SELL re-adds via `costBasisFcy` — the two sides
   * reconcile.
   *
   * SAME FILTERS AS THE SELL SIDE (V2324-10 symmetry): `buySell === "BUY"`,
   * STK/FUND/BOND only, `currency ≠ EUR`, ECB-resolvable, NOT an FXCONV/AFx trade.
   * EXCLUDES short-cover buys (`openCloseIndicator === "C"`): a cover is the CLOSE
   * of a short, not a fresh FCY outflow to acquire a long position — mirroring the
   * `isShort` guard on the sell side (`extractStockProceedsFxEvents` skips short
   * closes). Uses `trade.tradeDate` for the rate, exactly like `addLot`.
   */
  static extractStockPurchaseFxEvents(trades: Trade[], rateMap: EcbRateMap): FxEvent[] {
    const events: FxEvent[] = [];
    const SECURITY_CATEGORIES = new Set(["STK", "FUND", "BOND"]);
    for (const trade of trades) {
      if (trade.buySell !== "BUY") continue;
      if (!SECURITY_CATEGORIES.has(trade.assetCategory)) continue;
      if (trade.currency === "EUR") continue;
      if (!isEcbResolvable(trade.currency)) continue;
      if (FxFifoEngine.isFxconv(trade)) continue;
      // A short COVER (BUY to close, openCloseIndicator "C" or "C;O") is not a
      // fresh FCY outflow acquiring a long — it closes a short opened by a prior
      // SELL. Mirrors the isShort skip on the sell side. A plain long buy has
      // openCloseIndicator "O" (or, for some exports, absent) → not skipped.
      if (trade.openCloseIndicator === "C" || trade.openCloseIndicator === "C;O") continue;

      // The FCY actually LEAVES the account on the cash settlement date, so the
      // park event must be DATED there (matching how CASH conversions date on
      // settlementDate||tradeDate, extractFxEvents above). Otherwise, with normal
      // T+2 stock settlement, a manual funding conversion that settles AFTER the
      // stock trade date would sort after the buy in processEvents → the buy parks
      // `rate: null` (uncovered) and silently degrades to full-proceeds even though
      // the account IS tracked. The RATE math, however, mirrors fifo.ts addLot's
      // costInFcy exactly — including the commission cross-rate — which keys on the
      // TRADE date, so costFcy stays byte-equal to the disposal's costBasisFcy the
      // matching sell unparks. So: rate lookups on tradeDate, event dated on settle.
      const cashDate = normalizeDate(trade.settlementDate || trade.tradeDate);
      const ecbRate = getEcbRate(rateMap, trade.tradeDate, trade.currency);
      // costFcy = the FCY cash outflow, MIRRORING fifo.ts addLot's costInFcy:
      // quantity × tradePrice × multiplier + taxes + commission (homogenized to
      // the share currency via the trade-date cross-rate when in another currency).
      const quantity = new Decimal(trade.quantity).abs();
      const pricePerShare = new Decimal(trade.tradePrice);
      const multiplier = new Decimal(trade.multiplier || "1");
      const taxes = new Decimal(trade.taxes || "0").abs();
      const commission = new Decimal(trade.commission).abs();
      let commissionFcy = commission;
      if (commission.greaterThan(0) && trade.commissionCurrency && trade.commissionCurrency !== trade.currency) {
        const commEcbRate = getEcbRate(rateMap, trade.tradeDate, trade.commissionCurrency);
        commissionFcy = commission.mul(commEcbRate).dividedBy(ecbRate);
      }
      const costFcy = quantity.mul(pricePerShare).mul(multiplier).plus(taxes).plus(commissionFcy);
      if (!costFcy.greaterThan(0)) continue; // defensive: nothing to park

      events.push({
        kind: "stock_buy",
        date: cashDate,
        currency: trade.currency,
        quantity: new Decimal(0),       // unused for stock_buy (the amount spent is costFcy)
        costFcy,
        ecbRate,
        trigger: "stock_purchase",
        // Per-position key (isin || symbol) — IDENTICAL derivation to the sell
        // producer (extractStockProceedsFxEvents), so the SELL of this exact
        // position reclaims the principal parked here and no other.
        positionKey: FxFifoEngine.positionKey(trade),
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
    this.record("acquire", event, { quantityFcy: event.quantity, rate: costPerUnit });
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
      this.record("dispose", event, { quantityFcy: remaining, rate: event.ecbRate, costBasisEur: netProceeds, proceedsEur: netProceeds, gainLossEur: new Decimal(0), lotId: "UNKNOWN", note: "sin lotes previos → ganancia FX = 0" });
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

      const lotIdConsumed = lot.id;
      lot.quantity = lot.quantity.minus(consumed);
      lot.costInEur = lot.costInEur.minus(costBasisEur);

      if (lot.quantity.isZero()) {
        lots.shift();
      }

      remaining = remaining.minus(consumed);
      this.record("dispose", event, { quantityFcy: consumed, rate: event.ecbRate, costBasisEur, proceedsEur, gainLossEur: proceedsEur.minus(costBasisEur), lotId: lotIdConsumed });
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
      this.record("dispose", event, { quantityFcy: remaining, rate: event.ecbRate, costBasisEur: proceedsEur, proceedsEur, gainLossEur: new Decimal(0), lotId: "UNKNOWN", note: "lotes insuficientes → ganancia FX = 0" });
    }
  }

  /**
   * Epsilon for the carry-basis FIFO loops. The reference algorithm advances/
   * shifts a queue entry while `remaining > 1e-9` (not `> 0`), so that
   * floating-point dust never leaves a phantom sub-nano sliver behind. Decimal is
   * exact, but we mirror the same threshold so the TS reproduces the reference
   * numbers byte-for-byte and never parks/re-adds a meaningless residue.
   */
  private static readonly EPS = new Decimal("1e-9");

  /**
   * Push a re-added principal/profit slice back onto the spendable pool as a new
   * FX lot at EUR rate `rate` (EUR per 1 FCY). Mirrors {@link addLot}'s lot shape
   * (costPerUnit = rate, costInEur = q × rate) so a later conversion consumes it
   * exactly like any acquisition lot. Skips non-positive `q` (defense-in-depth:
   * a zero-quantity lot would make a later costPerUnit 0/0 = NaN).
   *
   * FIFO-ORDERED INSERTION (issue #230 fix). The spendable pool is consumed
   * oldest-first by ARRAY POSITION ({@link consumeLots} takes `lots[0]`), so the
   * array must stay sorted ascending by `acquireDate`. Plain acquisitions
   * ({@link addLot}) always arrive in (date, phase) order, so they append and the
   * array stays sorted. A SELL re-adds principal stamped with its ORIGINAL
   * acquisition date (carried through the park) — which can be EARLIER than lots
   * funded between the buy and the sale — so a tail append would mis-order the
   * pool and make a later conversion consume the wrong (newer) dollars first,
   * shifting an FX gain into the wrong tax year. We therefore SPLICE the new lot
   * into the first position whose `acquireDate` is strictly greater, keeping the
   * pool FIFO-correct. Stable for equal dates (inserts AFTER same-date lots), so
   * same-date ordering is unchanged from the old append.
   */
  private pushPoolLot(currency: string, date: string, q: Decimal, rate: Decimal): void {
    if (!q.greaterThan(0)) return;
    const lot: FxLot = {
      id: `FX-${this.nextLotId++}`,
      currency,
      acquireDate: date,
      quantity: q,
      costPerUnit: rate,
      costInEur: q.mul(rate),
    };
    if (!this.lots.has(currency)) this.lots.set(currency, []);
    const lots = this.lots.get(currency)!;
    // Insert keeping the pool sorted ascending by acquireDate (FIFO frontier).
    // Find the first lot strictly newer than this one and splice in before it;
    // if none, append. localeCompare on the ISO yyyy-mm-dd dates is a date order.
    let idx = lots.length;
    for (let i = 0; i < lots.length; i++) {
      if (lots[i]!.acquireDate.localeCompare(date) > 0) {
        idx = i;
        break;
      }
    }
    lots.splice(idx, 0, lot);
  }

  /**
   * STOCK_BUY — silently CONSUME the FCY a foreign-stock purchase spends from the
   * spendable pool and PARK the carried basis under the buy's POSITION key.
   *
   * Consumes `event.costFcy` from the per-currency pool FIFO oldest-first (FCY is
   * fungible for spending). For each consumed pool lot it parks `{q: consumed,
   * rate: lot.rate}` (carrying that lot's EUR acquisition basis) under the
   * composite `(currency, positionKey)` queue; any shortfall (the pool ran out)
   * parks `{q: shortfall, rate: null}` — "uncovered", funded outside the data
   * window. The pool lots are mutated exactly as {@link consumeLots} would
   * (quantity and costInEur reduced proportionally, depleted lots shifted) so a
   * later conversion sees the correct remaining balance.
   *
   * PER-POSITION PARKING: the parked basis lands under THIS position's key
   * ({@link parkKey}), so ONLY the matching SELL ({@link unparkAndReadd}) of the
   * same position reclaims it. The spendable POOL it draws from is still shared
   * per-currency — only the parked principal is partitioned by position.
   *
   * EMITS NO FxDisposal and realizes NO gain — the divisa gain on these dollars
   * defers, carried in the parked basis, until a conversion realizes it
   * (Art. 14.2.e LIRPF). This is why re-arming the missing-prior-year-lots phantom
   * GAIN is impossible here: a buy never reaches the disposal path.
   */
  private parkPrincipal(event: FxEvent): void {
    const cost = event.costFcy;
    if (!cost || !cost.greaterThan(0)) return;
    let remaining = cost;
    const EPS = FxFifoEngine.EPS;
    const lots = this.lots.get(event.currency);
    const parkKey = FxFifoEngine.parkKey(event.currency, event.positionKey);
    if (!this.parked.has(parkKey)) this.parked.set(parkKey, []);
    const park = this.parked.get(parkKey)!;

    if (lots) {
      while (remaining.greaterThan(EPS) && lots.length > 0) {
        const lot = lots[0]!;
        const consumed = Decimal.min(remaining, lot.quantity);
        // Carry BOTH the consumed lot's EUR basis AND its ORIGINAL acquisition
        // date, so the matching sell re-adds the principal at its true age (issue
        // #230) — not the sale date, which would mis-order the FIFO frontier.
        park.push({ q: consumed, rate: lot.costPerUnit, acquireDate: lot.acquireDate });
        // Reduce the pool lot in lockstep (quantity + EUR cost), shift when empty.
        const costPortion = consumed.mul(lot.costPerUnit);
        lot.quantity = lot.quantity.minus(consumed);
        lot.costInEur = lot.costInEur.minus(costPortion);
        if (lot.quantity.lessThan(EPS)) lots.shift();
        remaining = remaining.minus(consumed);
        this.record("park", event, { quantityFcy: consumed, rate: lot.costPerUnit });
      }
    }

    // Shortfall: the pool had no (more) tracked dollars → park uncovered (no
    // tracked origin → no carried date either; the sell re-adds it at the sale
    // date, which is correct for genuinely-untracked dollars).
    if (remaining.greaterThan(EPS)) {
      park.push({ q: remaining, rate: null, acquireDate: null });
      this.record("park", event, { quantityFcy: remaining, rate: null, note: "uncovered (sin lote de origen rastreado)" });
    }
  }

  /**
   * STOCK_SELL — re-add the carried principal of a foreign-stock SALE to the
   * spendable pool at its PARKED basis, plus the trade's profit at the sale rate.
   *
   * Pulls `event.costFcy` of principal from THIS POSITION's parked FIFO
   * (`(currency, positionKey)`, {@link parkKey}) oldest-first and re-adds it to
   * the shared per-currency pool up to `min(costFcy, proceedsFcy)` worth: a
   * parked lot with a carried basis re-adds at that basis; a `null` (uncovered)
   * parked lot re-adds at the SALE rate. Any parked principal BEYOND the proceeds
   * (a stock LOSS: you got back fewer dollars than the principal) is DISCARDED —
   * those FCY genuinely left the patrimony in the losing trade, so no FX event
   * attaches to them. If THIS POSITION's parked FIFO has no match for the sell
   * (`need` remains after the position's parked queue is exhausted), the remainder
   * is re-added at the SALE rate; that is precisely what makes an unmatched sell
   * reduce to the pre-#230 full-proceeds behavior. Finally the profit
   * (`proceedsFcy − costFcy`, when positive) is added at the sale rate as fresh
   * dollars.
   *
   * PER-POSITION UNPARK (the review fix): the parked queue is looked up by THIS
   * sell's `(currency, positionKey)`, never the bare currency, so the sell can
   * only ever reclaim the principal ITS OWN matching buy parked. A sell whose
   * position parked NOTHING — the canonical case being an OPTION
   * EXERCISE/ASSIGNMENT STK disposal (fifo.ts emits these with the underlying's
   * isin/symbol and `assetCategory:"STK"` but with NO backing BUY trade, so
   * extractStockPurchaseFxEvents never parked for it) — finds an empty/absent
   * queue under its key and falls cleanly through to the unmatched-sell sale-rate
   * re-add below (the funding-absent no-op). It can no longer drain, and mis-rate,
   * a DIFFERENT same-currency position's parked basis.
   *
   * EMITS NO FxDisposal — the FX gain defers to the eventual EUR conversion that
   * consumes these re-added pool lots (Art. 14.2.e LIRPF).
   *
   * Mirrors the reference `sell` closure exactly (REFERENCE.mjs): `placed` tracks
   * how much of `readd = min(cost, proc)` has been re-added so far; the loop
   * re-adds `give = min(parkedSlice, readd − placed)` from each parked lot and
   * always fully consumes that parked slice (the part above `readd` is the
   * discarded loss); a post-loop top-up covers an unmatched sell; the profit tail
   * adds `proc − placed`. (The reference is single-position, so its per-currency
   * `pk` queue and this per-position queue are the same queue for every case it
   * covers — the keying refinement is invisible to it.)
   */
  private unparkAndReadd(event: FxEvent): void {
    const cost = event.costFcy ?? new Decimal(0);
    const proc = event.proceedsFcy ?? new Decimal(0);
    const saleRate = event.ecbRate;
    const EPS = FxFifoEngine.EPS;

    let need = cost;
    const readd = Decimal.min(cost, proc);
    let placed = new Decimal(0);
    const park = this.parked.get(FxFifoEngine.parkKey(event.currency, event.positionKey));

    if (park) {
      while (need.greaterThan(EPS) && park.length > 0) {
        const p = park[0]!;
        const x = Decimal.min(need, p.q);
        const give = Decimal.min(x, readd.minus(placed));
        if (give.greaterThan(EPS)) {
          const reAddRate = p.rate === null ? saleRate : p.rate;
          // Re-add the principal at its ORIGINAL acquisition date (carried through
          // the park), so the pool stays FIFO-ordered by genuine age (issue #230).
          // An uncovered slice (no tracked origin) re-adds at the sale date.
          const reAddDate = p.acquireDate ?? event.date;
          this.pushPoolLot(event.currency, reAddDate, give, reAddRate);
          placed = placed.plus(give);
          // Re-add recorded AFTER the parked slice is decremented below would show
          // the wrong parked balance; we decrement first, then record both moves.
        }
        // Consume the whole parked slice `x`; any part above `give` (i.e. above
        // `readd`) is the loss portion — discarded, not re-added.
        const discarded = x.minus(give);
        p.q = p.q.minus(x);
        need = need.minus(x);
        if (p.q.lessThan(EPS)) park.shift();
        if (give.greaterThan(EPS)) {
          this.record("unpark", event, { quantityFcy: give, rate: p.rate === null ? saleRate : p.rate, note: p.rate === null ? "uncovered → re-añadido al tipo de venta" : undefined });
        }
        if (discarded.greaterThan(EPS)) {
          // Loss-spent dollars that never returned: NO FX, never converted to EUR
          // ("como una hamburguesa en dólares"). Recorded so the audit trail shows
          // exactly what left the patrimony in the losing trade (issue #230).
          this.record("discard", event, { quantityFcy: discarded, rate: p.rate, note: "principal perdido en la venta — sin efecto de divisa (nunca convertido a EUR)" });
        }
      }
    }

    // Unmatched sell (no parked principal left, e.g. position bought outside the
    // data window): re-add the remainder of `readd` at the sale rate. This is the
    // branch that makes a sell-without-tracked-buy equal the full-proceeds model.
    if (need.greaterThan(EPS) && placed.lessThan(readd.minus(EPS))) {
      const g = Decimal.min(need, readd.minus(placed));
      this.pushPoolLot(event.currency, event.date, g, saleRate);
      placed = placed.plus(g);
      this.record("unpark", event, { quantityFcy: g, rate: saleRate, note: "venta sin compra rastreada → re-añadido al tipo de venta (full-proceeds)" });
    }

    // Profit (proceeds beyond principal) = fresh dollars at the sale rate.
    const profit = proc.minus(placed);
    if (profit.greaterThan(EPS)) {
      this.pushPoolLot(event.currency, event.date, profit, saleRate);
      this.record("profit", event, { quantityFcy: profit, rate: saleRate });
    }
  }

  getDisposals(): FxDisposal[] {
    return this.disposals;
  }

  getRemainingLots(): Map<string, FxLot[]> {
    return this.lots;
  }

  /**
   * Remaining PARKED principal (principal in still-open foreign-stock positions).
   * Keyed per position by {@link parkKey}: `${currency}|${positionKey}` for
   * production events, or the bare `${currency}` for positionKey-less events
   * (reference/unit harnesses). Whatever stays here at the end is principal in
   * positions still open at the period boundary — never converted, never taxed.
   */
  getParked(): Map<string, { q: Decimal; rate: Decimal | null; acquireDate: string | null }[]> {
    return this.parked;
  }
}
