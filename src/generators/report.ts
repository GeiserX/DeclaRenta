/**
 * Tax report generator.
 *
 * Generates a structured report mapping IBKR transactions to
 * Modelo 100 casilla numbers. Since Renta Web does NOT support
 * file import, this produces a human-readable report for manual entry.
 */

import Decimal from "decimal.js";
import type { CashTransaction, FlexStatement, Trade } from "../types/ibkr.js";
import type { TaxSummary, TaxMessage, FifoDisposal, FxDisposal, DividendEntry, ManualRateQuote, FxTraceEvent } from "../types/tax.js";
import type { EcbRateMap } from "../types/ecb.js";
import { FifoEngine } from "../engine/fifo.js";
import { FxFifoEngine } from "../engine/fx-fifo.js";
import { detectWashSales } from "../engine/wash-sale.js";
import { calculateDividends } from "../engine/dividends.js";
import { collapseCorrections } from "../engine/cash-corrections.js";
import { calculateDoubleTaxation } from "../engine/double-taxation.js";
import { lookupRateInMap } from "../engine/ecb.js";
import { resolveCryptoTradeValues } from "../engine/crypto-valuation.js";
import { buildManualRateMap } from "../engine/manual-rates.js";
import { normalizeDate } from "../engine/dates.js";

const DATE_RE = /\b(\d{4})-\d{2}-\d{2}\b/;

function filterByYear<T>(items: T[], yearStr: string, getText: (item: T) => string, getContext?: (item: T) => Record<string, string> | undefined): T[] {
  return items.filter((item) => {
    const ctx = getContext?.(item);
    if (ctx?.date) return ctx.date.startsWith(yearStr);
    const dateMatch = getText(item).match(DATE_RE);
    if (!dateMatch) return true;
    return dateMatch[1] === yearStr;
  });
}

/**
 * Divide a disposal's monetary fields (and quantity) by the number of titulares.
 * Rates, dates, and classification metadata are per-unit and stay unchanged.
 */
function splitDisposal(d: FifoDisposal, n: number): FifoDisposal {
  if (n <= 1) return d;
  return {
    ...d,
    quantity: d.quantity.div(n),
    proceedsEur: d.proceedsEur.div(n),
    costBasisEur: d.costBasisEur.div(n),
    gainLossEur: d.gainLossEur.div(n),
    // The FCY figures must split too, or a >1-titulares declaration over-counts
    // them by ×n once any consumer reads them.
    proceedsFcy: d.proceedsFcy.div(n),
    costBasisFcy: d.costBasisFcy.div(n),
    gainLossFcy: d.gainLossFcy.div(n),
    // Anti-churning amounts must split too, or a >1-titulares declaration
    // over-counts the deferred/released loss by ×n.
    blockedLossEur: d.blockedLossEur.div(n),
    reintegratedLossEur: d.reintegratedLossEur.div(n),
  };
}

function splitFxDisposal(d: FxDisposal, n: number): FxDisposal {
  if (n <= 1) return d;
  return {
    ...d,
    quantity: d.quantity.div(n),
    proceedsEur: d.proceedsEur.div(n),
    costBasisEur: d.costBasisEur.div(n),
    gainLossEur: d.gainLossEur.div(n),
  };
}

function splitDividend(d: DividendEntry, n: number): DividendEntry {
  if (n <= 1) return d;
  return {
    ...d,
    grossAmountEur: d.grossAmountEur.div(n),
    withholdingTaxEur: d.withholdingTaxEur.div(n),
  };
}

/** Divide an interest amount (already abs-valued EUR) by the number of titulares. */
function splitInterestAmount(amountEur: Decimal, n: number): Decimal {
  return n <= 1 ? amountEur : amountEur.div(n);
}

/**
 * Defense-in-depth boundary guard for the final report totals (audit [HIGH/ERR]).
 *
 * Every parser already rejects non-finite (`NaN`/`Infinity`) amounts at the
 * source (csv-utils `parseDecimal`, the per-broker guards), so in normal
 * operation this is a strict no-op. But a `Decimal` can still go non-finite
 * deep inside a future code path (a `div` by an unexpected zero, an overflow,
 * an unvalidated manual rate) and that poison would otherwise flow silently
 * into a casilla and render as a literal "NaN"/"Infinito" in the user's tax
 * declaration. This is the LAST line of defense at the integration boundary:
 * it scans the computed top-level monetary totals (the values that become
 * casillas / summary figures), replaces any non-finite one with `0` so the
 * rendered casilla shows 0 (never "NaN"), and reports the offending field
 * names so the caller can emit ONE loud error — the failure is never silent.
 *
 * Pure: it does not mutate its input. The caller threads the returned
 * `sanitized` map back into the report and, when `offendingFields` is
 * non-empty, pushes a single `report.non_finite_total` error message.
 *
 * @param totals - Named top-level monetary totals destined for casillas.
 * @returns The same totals with non-finite values coerced to `new Decimal(0)`,
 *          plus the (possibly empty) list of field names that were non-finite.
 */
export function guardNonFiniteTotals<K extends string>(
  totals: Record<K, Decimal>,
): { sanitized: Record<K, Decimal>; offendingFields: K[] } {
  const sanitized = {} as Record<K, Decimal>;
  const offendingFields: K[] = [];
  for (const [field, value] of Object.entries(totals) as [K, Decimal][]) {
    if (value.isFinite()) {
      sanitized[field] = value;
    } else {
      sanitized[field] = new Decimal(0);
      offendingFields.push(field);
    }
  }
  return { sanitized, offendingFields };
}

/**
 * Merge parser-supplied EUR valuation hints (e.g. a Binance EUR_Value column)
 * UNDER any explicit user manual rates: a user-typed quote for the same
 * currency+date wins. Returns undefined when neither source has any entries.
 */
function mergeManualRateHints(
  userManual: EcbRateMap | undefined,
  hints: ManualRateQuote[] | undefined,
): EcbRateMap | undefined {
  if ((!hints || hints.length === 0)) return userManual;
  const merged = buildManualRateMap(hints);
  if (userManual) {
    for (const [date, byCur] of userManual) {
      const target = merged.get(date) ?? new Map<string, string>();
      for (const [cur, rate] of byCur) target.set(cur, rate); // user wins
      merged.set(date, target);
    }
  }
  return merged;
}

/**
 * Value a cash income transaction in EUR. Precedence:
 *   1. An explicit `rewardCostBasisEur` (authoritative — already the EUR value,
 *      e.g. from a Binance EUR_Value column). Returns rate as amountEur/|amount|.
 *   2. A rate from the resolved (ECB + synthetic) map, then the manual-rate map,
 *      for the income currency on the receipt date.
 * Returns null when the income cannot be valued (caller skips + warns).
 */
function valueIncomeEur(
  t: CashTransaction,
  resolvedRateMap: EcbRateMap,
  manualRates: EcbRateMap | undefined,
): { amountEur: Decimal; rate: Decimal } | null {
  const date = normalizeDate(t.dateTime);
  const amount = new Decimal(t.amount).abs();

  // An explicit broker-stated EUR value is authoritative — even when it is 0
  // (Binance reports sub-cent micro-rewards as 0.0 EUR). Valuing at exactly that
  // amount (including zero) is correct and avoids a false "unvalued" warning.
  if (t.rewardCostBasisEur !== undefined) {
    let cost: Decimal | null;
    try {
      cost = new Decimal(t.rewardCostBasisEur);
    } catch {
      cost = null;
    }
    if (cost !== null && cost.isFinite() && cost.greaterThanOrEqualTo(0)) {
      const rate = amount.isZero() ? new Decimal(0) : cost.div(amount);
      return { amountEur: cost, rate };
    }
  }

  // A rate present in the resolved map (ECB fiat, a normalized stablecoin like
  // USDT→USD, or a synthetic crypto rate injected by the valuation pass). We
  // gate on lookupRateInMap !== null rather than isEcbResolvable() so that a
  // resolvable currency whose rate was never fetched (e.g. a USDT reward in a
  // year with no trades) degrades to the manual/skip path below instead of
  // throwing inside getEcbRate and crashing the whole report.
  const mapRate = lookupRateInMap(resolvedRateMap, date, t.currency);
  if (mapRate !== null) {
    return { amountEur: amount.mul(mapRate).abs(), rate: mapRate };
  }

  // A user/EUR_Value manual-rate hint for the coin (never a live price oracle).
  const manualRate = manualRates ? lookupRateInMap(manualRates, date, t.currency) : null;
  if (manualRate !== null) {
    return { amountEur: amount.mul(manualRate).abs(), rate: manualRate };
  }

  return null;
}

/**
 * Build tax-neutral synthetic BUY trades from crypto reward income so the FIFO
 * engine establishes an acquisition lot at the EUR value already taxed as
 * income (Art. 35.1 — no double taxation on later sale). Only rewards carrying
 * BOTH a quantity and an EUR cost basis produce a lot; the BUY's `proceeds` is 0
 * so the FIFO engine never taxes it (only later SELLs create disposals). The
 * lot's `currency:"EUR"` means the crypto-valuation pre-pass passes it through.
 */
function synthesizeRewardLots(
  cashTransactions: CashTransaction[],
  resolvedRateMap: EcbRateMap,
  manualRates: EcbRateMap | undefined,
): Trade[] {
  const lots: Trade[] = [];
  for (const t of cashTransactions) {
    if (t.type !== "Crypto Reward Income") continue;
    if (!t.rewardQuantity) continue;
    let qty: Decimal;
    try {
      qty = new Decimal(t.rewardQuantity);
    } catch {
      continue;
    }
    if (qty.lessThanOrEqualTo(0)) continue;
    // Cost basis = the EUR value taxed as income. Prefer an explicit broker EUR
    // value, else value the coin via the resolved/manual rate. If it can't be
    // valued, create NO lot (a later sale is then conservatively fully taxed).
    const valued = valueIncomeEur(t, resolvedRateMap, manualRates);
    if (valued === null) continue;
    const costEur = valued.amountEur;
    if (costEur.lessThanOrEqualTo(0)) continue;
    lots.push({
      tradeID: `reward-lot-${t.transactionID}`,
      accountId: "",
      symbol: t.symbol,
      description: `Reward acquisition - ${t.symbol}`,
      isin: "",
      assetCategory: "CRYPTO",
      currency: "EUR",
      tradeDate: normalizeDate(t.dateTime),
      settlementDate: normalizeDate(t.dateTime),
      quantity: qty.toString(),
      tradePrice: costEur.div(qty).toString(),
      tradeMoney: costEur.toString(),
      proceeds: "0",
      cost: costEur.toString(),
      fifoPnlRealized: "0",
      fxRateToBase: "1",
      buySell: "BUY",
      openCloseIndicator: "O",
      exchange: "BINANCE",
      commissionCurrency: "EUR",
      commission: "0",
      taxes: "0",
      multiplier: "1",
      brokerSource: "Binance",
    });
  }
  return lots;
}

export interface ReportOptions {
  skipFx?: boolean;
  /**
   * Track broker auto-conversions (IBKR AFx / FXCONV) as ordinary currency
   * conversions. DEFAULT true (issue #239): IBKR does NOT round-trip FCY→EUR on a
   * sale, so an auto-converted balance is genuinely held foreign currency whose
   * later conversion is a divisa gain/loss under Art. 33.1 — skipping it silently
   * dropped real FX gains. Set false for the monodivisa-style opt-out (the old
   * skip), e.g. for an account that genuinely round-trips and wants the FX leg
   * ignored. Independent of `skipFx` (which disables the whole FX engine); only
   * consulted when the FX engine runs. The missing-prior-year-lot floor still
   * applies, so processing AFx never fabricates a phantom gain.
   */
  trackAutoConvert?: boolean;
  /**
   * Number of account holders (titulares). Default 1.
   * When > 1, every reported amount is divided equally per contribuyente
   * (Art. 11.3 LIRPF: rentas atribuidas según titularidad; gananciales = 50/50).
   * The declaration is understood to be filed individually by each titular for
   * their proportional share.
   */
  titulares?: number;
  /**
   * User-supplied EUR-per-unit quotes (date → currency → rate) for crypto
   * currencies that have no ECB rate (crypto↔crypto permutas). Consulted as a
   * fallback by the crypto valuation pre-pass, never overriding ECB rates.
   */
  manualRates?: EcbRateMap;
  /**
   * Opt-in: capture the full FX-FIFO movement trace (acquire/park/unpark/discard/
   * dispose with running balances) onto `TaxSummary.fxTrace`, for audit/diagnostic
   * export (CLI `--fx-trace`, web diagnostic download). OFF by default and
   * zero-cost when off; ignored in monodivisa (`skipFx`) since the FX engine
   * doesn't run. NEVER surfaced in the standard UI.
   */
  fxTrace?: boolean;
}

/**
 * Generate a complete tax report from an IBKR Flex Statement.
 *
 * @param statement - Parsed IBKR Flex Query
 * @param rateMap - Pre-fetched ECB exchange rates
 * @param year - Tax year
 * @param options - Optional config (skipFx disables FX FIFO engine)
 * @returns TaxSummary with all casilla values calculated
 */
export function generateTaxReport(
  statement: FlexStatement,
  rateMap: EcbRateMap,
  year: number,
  options?: ReportOptions,
): TaxSummary {
  // 0a. Merge parser-supplied EUR valuation hints (e.g. a Binance EUR_Value
  //     column) into the manual-rate map, BELOW any explicit user manual rates
  //     and ECB rates in precedence. This is the only place a broker-derived EUR
  //     value enters valuation — no live price oracle is ever consulted.
  const manualRates = mergeManualRateHints(options?.manualRates, statement.manualRateHints);

  // 0b. Crypto valuation pre-pass (A/D/B). Resolves crypto↔crypto permutas to
  //    EUR via cross-leg inference or user manual quotes, injecting synthetic
  //    rates into a cloned map. Unresolvable trades are dropped (and surfaced)
  //    so the FIFO engine never throws on a non-fiat currency.
  const valuation = resolveCryptoTradeValues(statement.trades, rateMap, manualRates);
  const resolvedRateMap = valuation.rateMap;

  // 0c. Crypto reward income (staking, Simple Earn interest, airdrops, referral)
  //     establishes an acquisition lot at the EUR value taxed as income, so a
  //     later sale is not double-taxed (Art. 35.1). The EUR basis is whatever the
  //     income is valued at — an explicit broker EUR value, else a rate resolved
  //     from the (now-augmented) rate map or a manual hint. Synthesize tax-neutral
  //     BUY trades (FIFO never taxes a BUY); they are EUR-denominated so they need
  //     no further valuation and go straight to the FIFO engine.
  const rewardLots = synthesizeRewardLots(statement.cashTransactions, resolvedRateMap, manualRates);
  const resolvedTrades = [...valuation.trades, ...rewardLots];

  // 1. FIFO capital gains (process ALL years, filter to target year)
  const fifoEngine = new FifoEngine();
  fifoEngine.processTrades(
    resolvedTrades,
    resolvedRateMap,
    statement.corporateActions,
    statement.optionExercises,
  );

  // Number of account holders. >1 splits every reported amount equally per
  // contribuyente (Art. 11.3 LIRPF). Sanitized to an integer >= 1.
  // Math.max(1, NaN) is NaN, so guard finiteness explicitly (CLI --titulares abc → NaN).
  const titularesRaw = Math.floor(options?.titulares ?? 1);
  const titulares = Number.isFinite(titularesRaw) && titularesRaw >= 1 ? titularesRaw : 1;

  const yearStr = year.toString();
  // Run anti-churning on the FULL (all-year) disposal set BEFORE year-filtering,
  // so a loss blocked in one year and released when the surviving repurchased
  // shares are sold in a LATER year are matched in a merged multi-file run
  // (cross-year reintegration). For a single-year file the full set == the year
  // set, so this is identical to before. Then keep only the target year's
  // disposals for the figures (a block/release is attributed to the year of the
  // disposal that carries it).
  const allDisposals = detectWashSales(fifoEngine.getDisposals(), statement.trades);
  let disposals = allDisposals.filter((d) => d.sellDate.startsWith(yearStr));
  if (titulares > 1) disposals = disposals.map((d) => splitDisposal(d, titulares));

  const transmissionValue = disposals.reduce(
    (sum, d) => sum.plus(d.proceedsEur),
    new Decimal(0),
  );
  const acquisitionValue = disposals.reduce(
    (sum, d) => sum.plus(d.costBasisEur),
    new Decimal(0),
  );
  // Anti-churning (Art. 33.5.f/g LIRPF), PROPORTIONAL: blocked = the portion of
  // each loss deferred now (Σ blockedLossEur); reintegrated = previously-deferred
  // losses released this year because the surviving repurchased shares were sold
  // (Σ reintegratedLossEur). The fiscal capital-gains contribution adds the
  // blocked portion BACK (not deductible now) and SUBTRACTS the reintegrated
  // portion (now deductible) — see totalSavingsBase below.
  const blockedLosses = disposals.reduce((sum, d) => sum.plus(d.blockedLossEur), new Decimal(0));
  const reintegratedLosses = disposals.reduce((sum, d) => sum.plus(d.reintegratedLossEur), new Decimal(0));

  // 2. Dividends (filter to target year)
  // Collapse broker correction/reversal pairs (duplicate credit + its opposite-
  // sign storno) BEFORE the dividend/interest engines run, so a duplicated-then-
  // reversed payment nets to its real value in BOTH the gross (0029) and the
  // withholding — instead of the reversal being .abs()'d into an addition
  // (dividends.ts) that triples the retención. Only exact opposite-sign pairs
  // cancel; a file with no reversals is unchanged.
  const yearCashTransactions = collapseCorrections(
    statement.cashTransactions.filter((t) => t.dateTime.startsWith(yearStr)),
  );
  let dividendEntries = calculateDividends(yearCashTransactions, rateMap);
  if (titulares > 1) dividendEntries = dividendEntries.map((d) => splitDividend(d, titulares));
  const grossDividends = dividendEntries.reduce(
    (sum, d) => sum.plus(d.grossAmountEur),
    new Decimal(0),
  );

  // 3. Interest (already filtered to target year). Crypto reward income tagged
  //    taxBucket="ahorro" (staking, Simple Earn interest) is rendimiento del
  //    capital mobiliario and joins the interest bucket (Casilla 0027).
  const interestTransactions = yearCashTransactions.filter(
    (t) =>
      t.type === "Broker Interest Received" ||
      t.type === "Broker Interest Paid" ||
      t.type === "Bond Interest Received" ||
      t.type === "Bond Interest Paid" ||
      (t.type === "Crypto Reward Income" && t.taxBucket === "ahorro"),
  );

  let interestEarned = new Decimal(0);
  let interestPaid = new Decimal(0);
  let unresolvableInterest = 0;
  const interestEntries = interestTransactions
    .filter((t) => {
      if (valueIncomeEur(t, resolvedRateMap, manualRates) !== null) return true;
      unresolvableInterest++;
      return false;
    })
    .map((t) => {
      const { amountEur: rawEur, rate } = valueIncomeEur(t, resolvedRateMap, manualRates)!;
      const amountEur = splitInterestAmount(rawEur, titulares);
      const isEarned = t.type === "Crypto Reward Income" || t.type.includes("Received");

      if (isEarned) {
        interestEarned = interestEarned.plus(amountEur);
      } else {
        interestPaid = interestPaid.plus(amountEur);
      }

      return {
        type: isEarned ? "earned" as const : "paid" as const,
        description: t.description,
        date: normalizeDate(t.dateTime),
        amountEur,
        currency: t.currency,
        ecbRate: rate,
      };
    });

  // 3b. Base-general crypto rewards (airdrops, referral, fee rebates):
  //     ganancia patrimonial NO derivada de transmisión (Art. 33.1, base general).
  let generalGainsTotal = new Decimal(0);
  let unresolvableGeneralGains = 0;
  const generalGainEntries = yearCashTransactions
    .filter((t) => t.type === "Crypto Reward Income" && t.taxBucket === "general")
    .filter((t) => {
      if (valueIncomeEur(t, resolvedRateMap, manualRates) !== null) return true;
      unresolvableGeneralGains++;
      return false;
    })
    .map((t) => {
      const { amountEur: rawEur, rate } = valueIncomeEur(t, resolvedRateMap, manualRates)!;
      const amountEur = splitInterestAmount(rawEur, titulares);
      generalGainsTotal = generalGainsTotal.plus(amountEur);
      return {
        description: t.description,
        date: normalizeDate(t.dateTime),
        amountEur,
        symbol: t.symbol,
        currency: t.currency,
        ecbRate: rate,
      };
    });

  // 4. FX gains (Art. 33.1 LIRPF — la divisa es un elemento patrimonial:
  //    ganancia = valor de transmisión − valor de adquisición; NOT Art. 37.1.l,
  //    que regula "incorporaciones que no derivan de una transmisión"). Timing
  //    per Art. 14.2.e (la ganancia se imputa en la conversión efectiva a euros);
  //    DGT V2422-20 / V2324-10. FOUR event sources feed the FX FIFO engine in one
  //    processEvents call: explicit CASH conversions, dividend/interest FCY
  //    inflows, and (issue #230, carry-basis-defer model) foreign-stock BUYS and
  //    SELLS. A stock BUY silently CONSUMES the FCY it spends from the pool and
  //    PARKS the carried basis; a stock SELL re-adds that principal at its carried
  //    basis plus the profit at the sale rate. Neither a buy nor a sell emits an
  //    FX disposal — only a real FCY→EUR conversion realizes the deferred gain.
  //    FXCONV/AFx broker auto-conversions are PROCESSED by default (#239 — IBKR
  //    does not round-trip FCY→EUR on a sale, so an auto-converted balance is real
  //    held divisa); the opt-out (trackAutoConvert === false) restores the
  //    per-trade isFxconv() skip. Manual CASH/income and tracked stock round-trips
  //    always accrue/move FCY lots.
  // skipFx: monodivisa mode — treat all as EUR, no separate FX saldo (like Autodeclaro/Taxdown)
  let fxDisposals: ReturnType<FxFifoEngine["processEvents"]> = [];
  let fxTransmissionValue = new Decimal(0);
  let fxAcquisitionValue = new Decimal(0);
  let fxWarningsList: string[] = [];
  let fxMessagesList: TaxMessage[] = [];
  let fxTrace: FxTraceEvent[] | undefined;

  if (!options?.skipFx) {
    const fxEngine = new FxFifoEngine();
    if (options?.fxTrace) fxEngine.enableTrace();
    // Process broker auto-conversions (AFx/FXCONV) by default; the opt-out
    // (trackAutoConvert === false) restores the historical skip (issue #239).
    const trackAutoConvert = options?.trackAutoConvert !== false;
    const tradeFxEvents = FxFifoEngine.extractFxEvents(statement.trades, rateMap, trackAutoConvert);
    const cashFxEvents = FxFifoEngine.extractCashFxEvents(statement.cashTransactions, rateMap);
    // Foreign-stock round-trips (issue #230, carry-basis-defer): a FCY stock BUY
    // CONSUMES the FCY it spends from the pool and PARKS the carried basis; a FCY
    // stock SELL re-adds that principal at its carried basis plus the profit at the
    // sale rate. The BUY producer reads the FULL, unfiltered, all-year
    // `statement.trades` (a buy must park before its matching sell re-adds — the
    // 4-phase + date sort in processEvents handles same-day ordering); the SELL
    // producer reads the FULL, unsplit, pre-wash-sale disposals across ALL years —
    // NOT the year-filtered/titulares-split `disposals`. Neither emits a disposal;
    // only a later USD→EUR conversion realizes the deferred gain (Art. 14.2.e). FX
    // disposals are year-filtered below and split at splitFxDisposal.
    const stockPurchaseFxEvents = FxFifoEngine.extractStockPurchaseFxEvents(statement.trades, rateMap, trackAutoConvert);
    const stockProceedsFxEvents = FxFifoEngine.extractStockProceedsFxEvents(fifoEngine.getDisposals());
    const allFxDisposals = fxEngine.processEvents([...tradeFxEvents, ...cashFxEvents, ...stockPurchaseFxEvents, ...stockProceedsFxEvents]);
    fxDisposals = allFxDisposals.filter((d) => d.disposeDate.startsWith(yearStr));
    if (titulares > 1) fxDisposals = fxDisposals.map((d) => splitFxDisposal(d, titulares));

    fxTransmissionValue = fxDisposals.reduce((sum, d) => sum.plus(d.proceedsEur), new Decimal(0));
    fxAcquisitionValue = fxDisposals.reduce((sum, d) => sum.plus(d.costBasisEur), new Decimal(0));

    // Only show FX warnings when there are FX disposals in the target year.
    // Undated warnings (missing lots summaries) refer to events across all years —
    // showing them when the target year has zero FX activity is misleading noise.
    if (fxDisposals.length > 0) {
      fxWarningsList = filterByYear(fxEngine.warnings, yearStr, (w) => w);
      fxMessagesList = filterByYear(fxEngine.messages, yearStr, (m) => m.message, (m) => m.context);
    }
    // The trace is the FULL all-year movement ledger (audit artifact, not
    // year-filtered) so a lot's whole lifecycle reconciles. Present only on opt-in.
    if (options?.fxTrace) fxTrace = fxEngine.getTrace();
  }

  // 5. Double taxation. Art. 80 caps the deduction by the effective average
  // Spanish rate on the relevant savings-tax base, not by standalone country
  // brackets computed in isolation.
  // Anti-churning adjusts the capital-gains bucket: add back the proportionally
  // blocked (deferred) loss so it is NOT deducted now, and subtract the
  // reintegrated (now-released) prior deferred loss. This is the fiscal base, not
  // the raw netGainLoss — blocked losses no longer silently reduce the base.
  const fiscalCapitalGains = transmissionValue
    .minus(acquisitionValue)
    .plus(blockedLosses)
    .minus(reintegratedLosses);
  const totalSavingsBase = Decimal.max(fiscalCapitalGains, 0)
    .plus(Decimal.max(fxTransmissionValue.minus(fxAcquisitionValue), 0))
    .plus(grossDividends)
    .plus(interestEarned);
  const doubleTaxation = calculateDoubleTaxation(dividendEntries, year, totalSavingsBase);

  // Filter warnings to those relevant to the selected year
  const yearWarnings = filterByYear(fifoEngine.warnings, yearStr, (w) => w);
  const yearMessages = filterByYear(fifoEngine.messages, yearStr, (m) => m.message, (m) => m.context);

  // Crypto valuation pre-pass messages (filtered to the target year by date).
  const cryptoValuationMessages = filterByYear(valuation.messages, yearStr, (m) => m.message, (m) => m.context);
  const yearUnresolvedCrypto = valuation.unresolved.filter((u) => u.date.startsWith(yearStr));

  // Prepend parser warnings (unparsed sections, etc.)
  const allWarnings = [
    ...(statement.parserWarnings ?? []),
    ...yearWarnings,
    ...fxWarningsList,
    ...cryptoValuationMessages.map((m) => m.message),
  ];

  // Aggregate structured messages from all sources
  const allMessages: TaxMessage[] = [...(statement.parserMessages ?? []), ...yearMessages, ...fxMessagesList, ...cryptoValuationMessages];

  // Crypto-denominated income (staking rewards paid in the coin) can't be valued
  // via ECB rates. We skip it rather than crash; the user must value it manually.
  if (unresolvableInterest > 0) {
    const cryptoMsg = `Hay ${unresolvableInterest} ingreso(s) en criptomoneda (p. ej. recompensas de staking) que no se han podido valorar automáticamente y no están incluidos en los importes calculados.`;
    allMessages.push({
      id: "report.crypto_income_unvalued",
      severity: "warning",
      message: cryptoMsg,
      hint: "Estos ingresos se pagan en la propia cripto y no tienen tipo de cambio oficial del BCE. Calcula su valor en euros a la fecha de cobro y decláralos manualmente como rendimientos del capital mobiliario (Casilla 0027).",
      context: { count: String(unresolvableInterest) },
    });
    allWarnings.push(cryptoMsg);
  }

  if (unresolvableGeneralGains > 0) {
    const ggMsg = `Hay ${unresolvableGeneralGains} ganancia(s) patrimonial(es) en criptomoneda (p. ej. airdrops o comisiones de referidos) que no se han podido valorar automáticamente y no están incluidas en los importes calculados.`;
    allMessages.push({
      id: "report.crypto_general_gain_unvalued",
      severity: "warning",
      message: ggMsg,
      hint: "Estas rentas se reciben en la propia cripto y no tienen tipo de cambio oficial del BCE. Calcula su valor en euros a la fecha de cobro y decláralas manualmente como ganancia patrimonial no derivada de transmisión (base general).",
      context: { count: String(unresolvableGeneralGains) },
    });
    allWarnings.push(ggMsg);
  }

  // Shared-titularity notice: amounts have been split equally per contribuyente.
  if (titulares > 1) {
    allMessages.push({
      id: "report.titularidad_compartida",
      severity: "info",
      message: `Los importes mostrados están divididos entre ${titulares} titulares (la parte que corresponde a cada contribuyente). Este informe refleja la declaración de UN solo titular: cada uno de los ${titulares} titulares debe presentar su propia declaración con esta misma parte. No declares el total en una sola declaración ni sumes las partes de varios titulares en la tuya.`,
      hint: `El reparto a partes iguales (${titulares} × ${(100 / titulares).toFixed(titulares === 3 ? 2 : 0)} %) presupone titularidad por igual. Si los porcentajes de titularidad son distintos (p. ej. 70/30), ajusta los importes manualmente. En cuentas de gananciales la atribución es 50/50 (Art. 11.3 LIRPF). Puedes cambiar el número de titulares en tu perfil fiscal.`,
      context: { titulares: String(titulares), percent: (100 / titulares).toFixed(titulares === 3 ? 2 : 0) },
    });
  }

  // Reconciliation hint: explain why other tools may show different amounts (only when FX gains exist)
  if (!options?.skipFx && fxDisposals.length > 0) {
    allMessages.push({
      id: "report.competitor_reconciliation",
      severity: "info",
      message: "Si otra herramienta muestra un importe distinto, puede deberse a que no calcula las ganancias por tipo de cambio (Art. 33.1 LIRPF).",
      hint: "Puedes activar el modo monodivisa en tu perfil fiscal para comparar con herramientas como Autodeclaro o Taxdown.",
    });
  }

  // Final boundary guard (audit [HIGH/ERR]): scan every top-level monetary total
  // destined for a casilla and coerce any non-finite (NaN/Infinity) value to 0,
  // so a corrupt source amount can never render as a literal "NaN"/"Infinito" in
  // the declaration. A strict no-op when every total is finite (the normal case).
  // Derived figures (netGainLoss) are computed from the SANITIZED legs below so
  // they stay finite too. Emits exactly ONE error when anything was non-finite.
  const { sanitized: t, offendingFields: nonFiniteFields } = guardNonFiniteTotals({
    transmissionValue,
    acquisitionValue,
    blockedLosses,
    reintegratedLosses,
    grossDividends,
    interestEarned,
    interestPaid,
    generalGainsTotal,
    doubleTaxationDeduction: doubleTaxation.total,
    fxTransmissionValue,
    fxAcquisitionValue,
  });
  if (nonFiniteFields.length > 0) {
    allMessages.push({
      id: "report.non_finite_total",
      severity: "error",
      message: "Se detectó un valor no finito (NaN/Infinito) en un total calculado; revise los archivos importados.",
      hint: "Es posible que un archivo de bróker tenga un importe corrupto o un formato numérico inesperado. Revise las operaciones de origen.",
      context: { field: nonFiniteFields.join(", ") },
    });
  }

  return {
    year,
    warnings: allWarnings,
    messages: allMessages,
    unresolvedCryptoValuations: yearUnresolvedCrypto.length > 0 ? yearUnresolvedCrypto : undefined,
    capitalGains: {
      transmissionValue: t.transmissionValue,
      acquisitionValue: t.acquisitionValue,
      netGainLoss: t.transmissionValue.minus(t.acquisitionValue),
      blockedLosses: t.blockedLosses,
      reintegratedLosses: t.reintegratedLosses,
      disposals,
    },
    dividends: {
      grossIncome: t.grossDividends,
      deductibleExpenses: new Decimal(0),
      spanishWithholding: doubleTaxation.spanishWithholding,
      entries: dividendEntries,
    },
    interest: {
      earned: t.interestEarned,
      paid: t.interestPaid,
      entries: interestEntries,
    },
    generalGains: {
      total: t.generalGainsTotal,
      entries: generalGainEntries,
    },
    doubleTaxation: {
      deduction: t.doubleTaxationDeduction,
      byCountry: doubleTaxation.byCountry,
    },
    fxGains: {
      transmissionValue: t.fxTransmissionValue,
      acquisitionValue: t.fxAcquisitionValue,
      netGainLoss: t.fxTransmissionValue.minus(t.fxAcquisitionValue),
      disposals: fxDisposals,
    },
    ...(fxTrace ? { fxTrace } : {}),
  };
}
