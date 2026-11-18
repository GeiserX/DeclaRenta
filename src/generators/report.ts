/**
 * Tax report generator.
 *
 * Generates a structured report mapping IBKR transactions to
 * Modelo 100 casilla numbers. Since Renta Web does NOT support
 * file import, this produces a human-readable report for manual entry.
 */

import Decimal from "decimal.js";
import type { CashTransaction, FlexStatement, Trade } from "../types/ibkr.js";
import type {
  TaxSummary,
  TaxMessage,
  FifoDisposal,
  Lot,
  FxDisposal,
  DividendEntry,
  ManualRateQuote,
  FxTraceEvent,
  FxMethod,
  ManualOpeningLot,
} from "../types/tax.js";
import type { EcbRateMap } from "../types/ecb.js";
import { FifoEngine } from "../engine/fifo.js";
import { FxFifoEngine } from "../engine/fx-fifo.js";
import { detectWashSales, salesWithWindowPastData } from "../engine/wash-sale.js";
import { calculateDividends, matchWithholdings, withholdingCountry, withholdingEur, type WithholdingMatch } from "../engine/dividends.js";
import { collapseCorrections } from "../engine/cash-corrections.js";
import { calculateDoubleTaxation } from "../engine/double-taxation.js";
import { isEcbResolvable, lookupRateInMap } from "../engine/ecb.js";
import { resolveCryptoTradeValues, lookupValuationRate, isFiatPriced } from "../engine/crypto-valuation.js";
import { buildManualRateMap } from "../engine/manual-rates.js";
import { buildManualOpeningLotTrades, normalizeManualOpeningLot } from "../engine/manual-opening-lots.js";
import { formatDateDmy, normalizeDate } from "../engine/dates.js";

const DATE_RE = /\b(\d{4})-\d{2}-\d{2}\b/;

function filterByYear<T>(
  items: T[],
  yearStr: string,
  getText: (item: T) => string,
  getContext?: (item: T) => Record<string, string> | undefined,
): T[] {
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
    ...(d.declaredShiftEur !== undefined ? { declaredShiftEur: d.declaredShiftEur.div(n) } : {}),
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

/**
 * Withholding corrections in this year's rows for dividends of earlier years
 * (issue #438), as the net EUR refund per earlier year, oldest first. This
 * year's rows are the ones posted in `year`: the broker's posting date
 * (`reportDate`, IBKR) when the export has it, else the row's own date.
 *
 * For a dividend posted before `year` (filed with its year's statement) the
 * drop is its withholding as filed (the matcher on the rows posted before
 * `year`) minus its withholding with this year's rows too (the rows posted up
 * to `year`), each valued as `calculateDividends` values it. Comparing whole
 * withholdings, not this year's parts, counts a filed refund that a late one
 * pushes to another dividend: it leaves its dividend, so that dividend's drop
 * shows, and when it lands on a dividend posted in `year` it lowers that
 * year's own boxes and never the earlier one's. A part of this year's row
 * that joins no dividend counts at its own date's rate for the year it is
 * dated in, or for `year − 1` when dated in the first 7 days of `year` (only a
 * late-December dividend is in its reach). Each run matches the rows the
 * report matches (collapseCorrections on that run's rows), so a reversed
 * dividend never takes a withholding the report gives to its rebooked one; a
 * dividend that a reversal posted in `year` cancels stays in the run with no
 * withholding, so its whole filed withholding is the drop. A dividend with a
 * part that has no rate, before or after, is left out, as is an unjoined part
 * with no rate. The country is the dividend's withholding country (the row's
 * own when unjoined): a Spanish one went to casilla 0597, any other to 0588.
 * Years whose net raises the withholding (≤ 0) are dropped.
 */
function priorYearWithholdingRefunds(
  cashTransactions: CashTransaction[],
  year: number,
  resolvedRateMap: EcbRateMap,
  manualRates: EcbRateMap | undefined,
): { year: number; spanish: boolean; amount: Decimal }[] {
  const yearOf = (date: string) => Number(normalizeDate(date).slice(0, 4));
  const postedYear = (t: CashTransaction) => yearOf(t.reportDate || t.dateTime);
  const lookup = (date: string, currency: string) => lookupIncomeRate(date, currency, resolvedRateMap, manualRates);
  const byYear = new Map<string, { year: number; spanish: boolean; amount: Decimal }>();
  const add = (earlierYear: number, country: string, amountEur: Decimal) => {
    const spanish = country === "ES";
    const key = `${earlierYear}|${spanish}`;
    const prev = byYear.get(key)?.amount ?? new Decimal(0);
    byYear.set(key, { year: earlierYear, spanish, amount: prev.plus(amountEur) });
  };

  // Each run matches the rows the report matches: collapseCorrections on the
  // same rows, so a withholding joins the dividend it joins in the report, and
  // a reversed dividend never takes one. A cancelled dividend stays in the run
  // with no withholding, so one filed and reversed in `year` is still found
  // below and its whole filed withholding is the drop.
  const run = (rows: CashTransaction[]) => {
    const kept = new Set(collapseCorrections(rows));
    const isDividend = (t: CashTransaction) => t.type === "Dividends" || t.type === "Payment In Lieu Of Dividends";
    return matchWithholdings(
      rows.filter((t) => kept.has(t) || isDividend(t)),
      new Set(rows.filter((t) => !kept.has(t) && isDividend(t))),
    );
  };
  const filed = run(cashTransactions.filter((t) => postedYear(t) < year));
  const now = run(cashTransactions.filter((t) => postedYear(t) <= year));
  const nowIndex = new Map(now.dividends.map((div, divIndex) => [div, divIndex]));
  const value = (match: WithholdingMatch, divIndex: number) => {
    const div = match.dividends[divIndex]!;
    const rate = lookup(normalizeDate(div.dateTime), div.currency);
    const eur = rate === null ? null : withholdingEur(match, divIndex, rate, lookup);
    const pair = match.pair[divIndex]!;
    return eur === null ? null : { eur, country: withholdingCountry(div, pair >= 0 ? match.withholdings[pair] : undefined) };
  };
  // Every dividend of the filed run was posted before `year`, and the rows
  // posted before `year` are in both runs, so it is in the new run too.
  filed.dividends.forEach((div, divIndex) => {
    const before = value(filed, divIndex);
    const after = value(now, nowIndex.get(div)!);
    if (!before || !after) return;
    add(yearOf(div.dateTime), before.country, before.eur);
    add(yearOf(div.dateTime), after.country, after.eur.negated());
  });

  const matched = now.withholdings.map(() => new Decimal(0));
  for (const divParts of now.parts) for (const { index, amount } of divParts) matched[index] = matched[index]!.plus(amount);
  now.withholdings.forEach((w, index) => {
    if (postedYear(w) !== year) return;
    const unmatched = new Decimal(w.amount).minus(matched[index]!);
    if (unmatched.isZero()) return;
    const date = normalizeDate(w.dateTime);
    const earlierYear = yearOf(date) < year ? yearOf(date) : date <= `${year}-01-07` ? year - 1 : null;
    const rate = earlierYear === null ? null : lookup(date, w.currency);
    if (earlierYear !== null && rate !== null) add(earlierYear, withholdingCountry(w), unmatched.mul(rate));
  });
  return [...byYear.values()]
    .filter(({ amount }) => amount.greaterThan(0))
    .sort((a, b) => a.year - b.year || Number(a.spanish) - Number(b.spanish));
}

/** Divide an interest amount in EUR by the number of titulares. */
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
  if (!hints || hints.length === 0) return userManual;
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
 * Non-throwing EUR-per-unit rate for cash income (interest, rewards, dividends).
 * EUR, ECB fiat and stablecoins: the resolved map (weekend walk-back), then the
 * manual-rate map. Any other coin: the manual-rate map, then a synthetic rate,
 * both for the exact date. Null when nothing values it.
 */
function lookupIncomeRate(
  date: string,
  currency: string,
  resolvedRateMap: EcbRateMap,
  manualRates: EcbRateMap | undefined,
): Decimal | null {
  const mapRate = lookupValuationRate(resolvedRateMap, date, currency);
  const manualRate = manualRates ? lookupValuationRate(manualRates, date, currency) : null;
  return isFiatPriced(currency) ? (mapRate ?? manualRate) : (manualRate ?? mapRate);
}

/**
 * Value a cash income transaction in EUR. Precedence:
 *   1. An explicit `rewardCostBasisEur` (authoritative — already the EUR value,
 *      e.g. from a Binance EUR_Value column). Returns rate as amountEur/|amount|.
 *   2. For EUR, ECB fiat and stablecoins: the resolved map (weekend walk-back), then the
 *      manual-rate map. For any other coin: the manual-rate map, then a synthetic
 *      rate, both for the exact receipt date.
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
  // USDT→USD, or a synthetic crypto rate injected by the valuation pass), or a
  // user/EUR_Value manual-rate hint for the coin (never a live price oracle).
  // Lookups return null instead of throwing, so a resolvable currency whose rate
  // was never fetched (e.g. a USDT reward in a year with no trades) degrades to
  // the skip path instead of crashing the whole report. For a coin (not ECB
  // fiat/stablecoin) both lookups match the receipt date exactly and the manual
  // quote wins, the same order as the valuation pass, so a price inferred on an
  // earlier day is never reused for this reward.
  const rate = lookupIncomeRate(date, t.currency, resolvedRateMap, manualRates);
  if (rate !== null) {
    return { amountEur: amount.mul(rate).abs(), rate };
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
      brokerSource: t.brokerSource,
    });
  }
  return lots;
}

function resolveManualOpeningLots(
  lots: ManualOpeningLot[],
  resolvedRateMap: EcbRateMap,
): { usableLots: ManualOpeningLot[]; skippedMessages: TaxMessage[] } {
  const usableLots: ManualOpeningLot[] = [];
  const skippedMessages: TaxMessage[] = [];

  for (const rawLot of lots) {
    const lot = normalizeManualOpeningLot(rawLot);
    if (!lot) continue;

    if (lot.currency !== "EUR") {
      const rate = isEcbResolvable(lot.currency)
        ? lookupRateInMap(resolvedRateMap, lot.acquireDate, lot.currency)
        : null;
      if (rate === null) {
        skippedMessages.push({
          id: "report.manual_opening_lot_unvalued",
          severity: "warning",
          message: `No se ha podido valorar el lote manual transferido de ${lot.symbol || lot.isin} (${lot.currency}, ${lot.acquireDate}) y se ignorará en los cálculos automáticos.`,
          hint: "Incluye el año de adquisición para que se cargue el tipo ECB correspondiente, o revisa que la divisa del lote sea una moneda fiat resoluble por el BCE. Mientras no haya tipo disponible, este lote no se puede usar como coste base ni como base de divisa.",
          context: {
            symbol: lot.symbol,
            isin: lot.isin,
            currency: lot.currency,
            acquireDate: lot.acquireDate,
          },
        });
        continue;
      }
    }

    usableLots.push(lot);
  }

  return { usableLots, skippedMessages };
}

export interface ReportOptions {
  /**
   * «Tradicional sin divisa (monodivisa)»: the whole FX engine is off and the
   * stock cost goes at the buy-date rate. Wins over `traditionalFx`.
   */
  skipFx?: boolean;
  /**
   * «Tradicional con divisa» (issue #434): the stock line of monodivisa (cost at
   * the buy-date rate, proceeds at the sale-date rate) PLUS the currency tracked
   * FIFO and taxed when it leaves the account. Currency a sale returns costs
   * what it cost plus the drift the stock line already declared. Every FX event
   * is dated on its trade date. Ignored when `skipFx` is set.
   */
  traditionalFx?: boolean;
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

  /**
   * User-supplied opening lots for positions transferred from another broker.
   * Injected as synthetic BUY trades before FIFO so later sales consume them
   * normally and can be split across multiple dates/prices.
   */
  manualOpeningLots?: ManualOpeningLot[];
}

/** The engine options for one of the three {@link FxMethod}s. */
export function reportOptionsForMethod(method: FxMethod): { skipFx: boolean; traditionalFx: boolean } {
  return { skipFx: method === "monodivisa", traditionalFx: method === "tradicional-divisa" };
}

/** Spanish name of each method, as the engine's own messages print it. */
const FX_METHOD_NAME_ES: Record<FxMethod, string> = {
  multidivisa: "Criterio DGT (multidivisa)",
  "tradicional-divisa": "Tradicional con divisa",
  monodivisa: "Tradicional sin divisa (monodivisa)",
};

/** Hint of `report.competitor_reconciliation` (default method). */
const COMPETITOR_RECONCILIATION_HINT =
  "Puedes comparar con otro método en el paso «Revisar y elegir método» (en la línea de comandos, --fx-method). «Tradicional con divisa» valora las acciones al tipo del día de compra y al del día de venta, y también calcula tu divisa. «Tradicional sin divisa (monodivisa)» valora las acciones igual, pero no calcula ningún resultado de divisa, tampoco en las conversiones USD→EUR.";

/** Message of `report.fx_method_consistency` (default method). */
const FX_METHOD_CONSISTENCY_MESSAGE =
  "DeclaRenta calcula con el «Criterio DGT (multidivisa)»: la ganancia de divisa se difiere hasta que conviertes la moneda extranjera a euros (Art. 14.2.e LIRPF; DGT V0152-26). Hay otros dos métodos: «Tradicional con divisa» y «Tradicional sin divisa (monodivisa)».";

/** Hint of `report.monodivisa_conversions_skipped`. */
const MONODIVISA_CONVERSIONS_SKIPPED_HINT =
  "Si has convertido divisa (por ejemplo, de USD a EUR), elige «Tradicional con divisa» en el paso «Revisar y elegir método» (en la línea de comandos, --fx-method tradicional-divisa). Valora las acciones igual y sí calcula tus conversiones. El «Criterio DGT (multidivisa)» también las calcula.";

/** Amount or quantity in a message context: two decimals, as the other messages. */
const fmt2 = (d: Decimal): string => d.toFixed(2);

/**
 * The messages of «Tradicional con divisa» (issue #434). Each Spanish text here
 * is byte-identical to the `es` locale key of the same id with the same context
 * (tests/generators/report-traditional-fx.test.ts checks it).
 *  - `fx_traditional_method` (info, always): what the method does and its basis.
 *  - `fx_traditional_risk` (warning, always): Hacienda applies the default
 *    method to shares and can recompute.
 *  - `fx_traditional_no_conversion` (info): no conversion this year, with
 *    foreign-currency sales.
 *  - `fx_traditional_lost_dollars` (info): the year has lost-dollar rows.
 *  - `fx_traditional_guard` (info): the year has negative-cost guard rows
 *    (the currency came back, but its fall exceeds its cost).
 *  - `fx_traditional_inflight` (warning, |amount| ≥ 1 €): currency converted
 *    this year carries drift a stock sale of an EARLIER year declared; off by
 *    that amount if that year was filed with the default method.
 *  - `fx_traditional_uncovered` (info): a sale this year returned principal
 *    with no EUR origin in the upload (deposits, older years). An acquisition
 *    1 to 7 calendar days AFTER the buy covers it instead, first, even when it
 *    paid a later buy (that buy then takes its own late funding), unless
 *    covering makes a disposal find no lot or leaves another buy untracked in
 *    any year of the upload. A cover that fails only after its own years (the
 *    buy's and the acquisition's) stays when dropping it would change a year
 *    already filed with it; the failing year then shows this note or
 *    `fx.missing_prior_lots` (late-cover rule, FxFifoEngine.LATE_COVER_DAYS).
 *  - `fx_traditional_orphan` (warning): principal still parked under a position
 *    with no shares at the year end (ISIN change, merger, spin-off): its drift
 *    before the purchase is never declared.
 */
function traditionalFxMessages(input: {
  stats: ReturnType<FxFifoEngine["getTraditionalStats"]>;
  yearStr: string;
  titulares: number;
  fxDisposals: FxDisposal[];
  disposals: FifoDisposal[];
  yearEndLots: Map<string, Lot[]>;
}): TaxMessage[] {
  const { stats, yearStr, titulares, fxDisposals, disposals, yearEndLots } = input;
  const perTitular = (d: Decimal): Decimal => (titulares > 1 ? d.div(titulares) : d);
  const uniq = (xs: string[]): string => [...new Set(xs)].sort().join(", ");
  const out: TaxMessage[] = [
    {
      id: "report.fx_traditional_method",
      severity: "info",
      message:
        "Método «Tradicional con divisa». Las acciones en divisa se valoran al tipo del BCE del día de compra (coste) y del día de venta (venta). La divisa tributa por FIFO cuando sale de tu cuenta: al cambiarla a euros o a otra divisa, al pagar comisiones o intereses, o al perderla en una venta con pérdidas. Una venta te devuelve la divisa invertida y, si ganas, la ganancia. La divisa invertida cuesta lo que te costó, más la variación del tipo de cambio entre la compra y la venta de las acciones, que ya va en el resultado de esa venta. La ganancia entra al tipo del día de la venta. La divisa invertida que no recuperas tributa aparte, en esa venta. Así cada variación de la divisa se declara una sola vez.",
      hint: "La DGT valora así las participaciones de fondos en divisa (V2324-10, V0775-21). Para acciones, Hacienda calcula la ganancia en divisa y la pasa a euros al tipo del día de la venta (V1740-17, V2422-20, V0152-26): es el «Criterio DGT (multidivisa)». En los dos métodos, la divisa que cambias tributa al cambiarla (V2466-08). La divisa perdida en una venta con pérdidas tributa el año de la venta, como en los fondos (V0775-21, V2324-10). Autodeclaro describe la misma valoración de acciones, con los tipos de cambio del extracto de tu bróker, pero no publica cómo calcula la divisa. Usa el mismo método todos los años.",
    },
    {
      id: "report.fx_traditional_risk",
      severity: "warning",
      message:
        "Hacienda aplica a las acciones el «Criterio DGT (multidivisa)» (V1740-17). En 2025 rechazó este mismo cálculo para un piso en dólares (V1615-25). Si revisa tu declaración, puede recalcularla con ese criterio.",
      hint: "Si en el ciclo completo (euros → divisa → acciones → divisa → euros) no hay ventas con pérdidas, los dos métodos suelen dar casi el mismo total. Cambia en qué año y en qué casilla sale cada parte, y también puede cambiar la deducción por doble imposición (casilla 0588). Con ventas con pérdidas, este método declara también la divisa perdida y el total es distinto. Ninguna consulta de la DGT respalda este método para acciones. Si Hacienda recalcula, puede cobrar intereses de demora por el impuesto que este método lleva a un año posterior.",
    },
  ];

  const FX_ASSET_CATEGORIES = new Set(["STK", "FUND", "BOND"]);
  const fcySales = disposals.filter((d) => d.currency !== "EUR" && FX_ASSET_CATEGORIES.has(d.assetCategory));
  if (fcySales.length > 0 && !fxDisposals.some((d) => d.trigger === "conversion")) {
    const ccy = uniq(fcySales.map((d) => d.currency));
    out.push({
      id: "report.fx_traditional_no_conversion",
      severity: "info",
      message: `No has cambiado divisa este año. La variación del ${ccy} mientras tenías las acciones ya está en su ganancia o pérdida. La variación mientras tienes los ${ccy} en efectivo se declarará cuando los cambies.`,
      hint: "Con este método, la divisa solo se suma a las casillas 1633/1637 cuando sale de tu cuenta: cambios a euros o a otra divisa, comisiones, intereses pagados y divisa perdida en ventas con pérdidas.",
      context: { ccy },
    });
  }

  const lostRows = fxDisposals.filter((d) => d.trigger === "stock_sale");
  if (lostRows.length > 0) {
    const ccy = uniq(lostRows.map((d) => d.currency));
    const n = String(stats.lostDollarSales.filter((x) => x.date.startsWith(yearStr)).length);
    const amount = fmt2(lostRows.reduce((sum, d) => sum.plus(d.gainLossEur), new Decimal(0)));
    out.push({
      id: "report.fx_traditional_lost_dollars",
      severity: "info",
      message: `En ${n} venta(s) con pérdidas recuperaste menos ${ccy} de los que invertiste. Esos ${ccy} perdidos salen de tu cuenta. Su diferencia de cambio, desde que los compraste hasta que compraste las acciones (${amount} €), se declara este año en las casillas 1633/1637.`,
      hint: `El «Criterio DGT (multidivisa)» no declara nada en este caso, porque esos ${ccy} nunca se cambiaron a euros. Este método sí lo declara, como la DGT en los fondos en divisa (V0775-21, V2324-10): la variación de la divisa antes de la compra tributa el año de la venta. El orden FIFO decide qué ${ccy} se perdieron. Lo verás en el detalle de las casillas 1633/1637 como «Divisa perdida en una venta con pérdidas».`,
      context: { n, ccy, amount },
    });
  }

  // Negative-cost guard rows: the currency came back, so they are not lost dollars.
  const guardRows = fxDisposals.filter((d) => d.trigger === "stock_sale_guard");
  if (guardRows.length > 0) {
    const ccy = uniq(guardRows.map((d) => d.currency));
    const n = String(stats.guardSales.filter((x) => x.date.startsWith(yearStr)).length);
    const amount = fmt2(guardRows.reduce((sum, d) => sum.plus(d.gainLossEur), new Decimal(0)));
    out.push({
      id: "report.fx_traditional_guard",
      severity: "info",
      message: `En ${n} venta(s), la caída del ${ccy} desde la compra de las acciones supera lo que te costó esa divisa. Su diferencia de cambio hasta la compra de las acciones (${amount} €) se declara este año en las casillas 1633/1637, y esos ${ccy} vuelven al tipo del día de la venta.`,
      hint: `Pasa cuando el tipo de cambio se mueve mucho (más o menos el doble) entre la compra de la divisa y la venta de las acciones. Sin esta regla, esos ${ccy} tendrían un coste negativo. Lo verás en el detalle de las casillas 1633/1637 como «Variación de la divisa hasta la compra de las acciones».`,
      context: { n, ccy, amount },
    });
  }

  for (const [key, v] of [...stats.inflight].sort(([a], [b]) => a.localeCompare(b))) {
    if (!key.startsWith(`${yearStr}|`)) continue;
    const amountDec = perTitular(v.amount);
    if (amountDec.abs().lessThan(1)) continue;
    const ccy = key.slice(yearStr.length + 1);
    const qty = fmt2(perTitular(v.qty));
    const years = [...v.years].sort((a, b) => a - b).join(", ");
    const amount = fmt2(amountDec);
    out.push({
      id: "report.fx_traditional_inflight",
      severity: "warning",
      message: `Has cambiado este año ${qty} ${ccy} que vienen de ventas de acciones de ${years}. Este método da por hecho que la variación del ${ccy} mientras tenías esas acciones (${amount} €) ya se declaró dentro de la ganancia o pérdida de aquel año.`,
      hint: "Así es si aquel año usaste «Tradicional con divisa» o «Tradicional sin divisa (monodivisa)». Si usaste el «Criterio DGT (multidivisa)», tu resultado de divisa de este año está desviado en esa cantidad. Usa el mismo método que entonces.",
      context: { qty, ccy, years, amount },
    });
  }

  const uncovered = new Map<string, Decimal>();
  for (const u of stats.uncovered) {
    if (!u.date.startsWith(yearStr)) continue;
    uncovered.set(u.currency, (uncovered.get(u.currency) ?? new Decimal(0)).plus(u.qty));
  }
  for (const [ccy, q] of [...uncovered].sort(([a], [b]) => a.localeCompare(b))) {
    const qty = fmt2(perTitular(q));
    out.push({
      id: "report.fx_traditional_uncovered",
      severity: "info",
      message: `${qty} ${ccy} usados en compras de acciones no tienen origen en euros en tus archivos (depósitos, saldos anteriores o años que no has subido). Se toman al tipo del día de compra, sin diferencia de cambio anterior.`,
      hint: `Si cambiaste euros a ${ccy} hasta 7 días después de la compra, se usa el tipo de ese cambio. Si conoces su origen, sube también los años anteriores.`,
      context: { qty, ccy },
    });
  }

  // Orphan detector: keyed like FxFifoEngine.positionKey (isin || symbol).
  const held = new Set<string>();
  for (const lots of yearEndLots.values()) {
    for (const l of lots) if (l.quantity.greaterThan(0)) held.add(l.isin || l.symbol);
  }
  for (const p of stats.parkedAtCheckpoint) {
    if (held.has(p.positionKey)) continue;
    const amountDec = perTitular(p.undeclaredEur);
    if (fmt2(amountDec.abs()) === "0.00") continue; // no drift left undeclared
    const qty = fmt2(perTitular(p.qty));
    const amount = fmt2(amountDec);
    out.push({
      id: "report.fx_traditional_orphan",
      severity: "warning",
      message: `La diferencia de cambio de ${qty} ${p.currency} invertidos en ${p.positionKey} no se ha podido asignar a ninguna venta (posible cambio de ISIN, fusión o escisión). Revísala a mano.`,
      hint: `Esos ${p.currency} se usaron para comprar ${p.positionKey}. A 31 de diciembre ya no tienes esas acciones y ninguna venta los ha recuperado. Su variación desde que compraste los ${p.currency} hasta que compraste las acciones (${amount} €) no se ha declarado.`,
      context: { qty, ccy: p.currency, security: p.positionKey, amount },
    });
  }
  return out;
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
  // 0d. User-supplied opening lots for transferred positions are modeled as
  //     synthetic BUY trades. This lets the normal FIFO pass consume multiple
  //     manual lots (different dates/prices) without a parallel cost-basis path.
  const { usableLots: usableManualOpeningLots, skippedMessages: manualOpeningLotMessages } = resolveManualOpeningLots(
    options?.manualOpeningLots ?? [],
    resolvedRateMap,
  );
  const manualOpeningLotTrades = buildManualOpeningLotTrades(usableManualOpeningLots);
  const resolvedTrades = [...valuation.trades, ...rewardLots, ...manualOpeningLotTrades];

  // 1. FIFO capital gains (process ALL years, filter to target year).
  //    Monodivisa (skipFx) → traditional cost basis: a FCY security's cost is
  //    converted at the ACQUISITION-date rate (Art. 35.1), embedding the buy→sale
  //    FX drift in the stock line since the FX engine is off. Default (rigorous):
  //    same-fiat cost at the sale-date rate (V2422-20), drift to the FX engine.
  //    «Tradicional con divisa» (traditionalFx) shares monodivisa's stock line and
  //    keeps the FX engine on in its own mode (see FxFifoEngine.unparkTraditional).
  const traditionalFx = options?.traditionalFx === true && options.skipFx !== true;
  const traditionalCost = options?.skipFx === true || traditionalFx;
  // markLotCurrency whenever the FX engine runs: a lot sold in another currency
  // than it was bought in releases its own currency's parked principal (#434,
  // #441). Monodivisa computes no currency and keeps its disposals' shape.
  const fifoEngine = new FifoEngine({
    traditionalCostBasis: traditionalCost,
    ...(options?.skipFx === true ? {} : { markLotCurrency: true }),
  });
  fifoEngine.processTrades(resolvedTrades, resolvedRateMap, statement.corporateActions, statement.optionExercises);
  // A cash buyout is a sale booked inside FIFO from a TC row; anti-churning must
  // see it too, or the bought-out shares still count as held (V3282-18 total exit).
  const washSaleTrades = [...statement.trades, ...manualOpeningLotTrades, ...fifoEngine.getCashBuyoutSales()];

  // Lots still held at 31 December, for the Modelo 720 acquisition dates. When
  // the upload runs past the year end, the main pass has already consumed lots
  // with later sales, so replay only the inputs dated up to 31 December.
  const yearEnd = `${year}-12-31`;
  const tradesToYearEnd = resolvedTrades.filter((t) => normalizeDate(t.tradeDate) <= yearEnd);
  const actionsToYearEnd = statement.corporateActions.filter((ca) => normalizeDate(ca.dateTime.slice(0, 8)) <= yearEnd);
  const exercisesToYearEnd = statement.optionExercises?.filter((ex) => normalizeDate(ex.date) <= yearEnd);
  let yearEndLots = fifoEngine.getRemainingLots();
  if (
    tradesToYearEnd.length < resolvedTrades.length ||
    actionsToYearEnd.length < statement.corporateActions.length ||
    (exercisesToYearEnd?.length ?? 0) < (statement.optionExercises?.length ?? 0)
  ) {
    const yearEndEngine = new FifoEngine({ traditionalCostBasis: traditionalCost });
    yearEndEngine.processTrades(tradesToYearEnd, resolvedRateMap, actionsToYearEnd, exercisesToYearEnd);
    yearEndLots = yearEndEngine.getRemainingLots();
  }

  // Number of account holders. >1 splits every reported amount equally per
  // contribuyente (Art. 11.3 LIRPF). Sanitized to an integer >= 1.
  // Math.max(1, NaN) is NaN, so guard finiteness explicitly (CLI --titulares abc → NaN).
  const titularesRaw = Math.floor(options?.titulares ?? 1);
  const titulares = Number.isFinite(titularesRaw) && titularesRaw >= 1 ? titularesRaw : 1;

  const yearStr = year.toString();
  // Run anti-churning on the FULL (all-year) disposal set BEFORE year-filtering,
  // so a loss blocked in one year and released by a definitive transmission in a
  // LATER year are matched in a merged multi-file run (cross-year release). For
  // a single-year file the full set == the year set, so this is identical to
  // before. Then keep only the target year's
  // disposals for the figures (a block/release is attributed to the year of the
  // disposal that carries it).
  const allDisposals = detectWashSales(
    fifoEngine.getDisposals(),
    washSaleTrades,
    statement.corporateActions,
    fifoEngine.getSplitRatios(),
    fifoEngine.getRemainingLots(),
  );
  let disposals = allDisposals.filter((d) => d.sellDate.startsWith(yearStr));
  if (titulares > 1) disposals = disposals.map((d) => splitDisposal(d, titulares));

  const transmissionValue = disposals.reduce((sum, d) => sum.plus(d.proceedsEur), new Decimal(0));
  const acquisitionValue = disposals.reduce((sum, d) => sum.plus(d.costBasisEur), new Decimal(0));
  // Anti-churning (Art. 33.5.f/g LIRPF), PROPORTIONAL: blocked = the portion of
  // each loss deferred now (Σ blockedLossEur); reintegrated = previously-deferred
  // losses released this year by definitive transmissions of the same security
  // (Σ reintegratedLossEur). The fiscal capital-gains contribution adds the
  // blocked portion BACK (not deductible now) and SUBTRACTS the reintegrated
  // portion (now deductible) — see totalSavingsBase below.
  const blockedLosses = disposals.reduce((sum, d) => sum.plus(d.blockedLossEur), new Decimal(0));
  const reintegratedLosses = disposals.reduce((sum, d) => sum.plus(d.reintegratedLossEur), new Decimal(0));

  // 2. Dividends (filter to target year)
  // Collapse broker correction/reversal pairs (duplicate credit + its opposite-
  // sign storno) BEFORE the dividend/interest engines run, so a duplicated-then-
  // reversed payment nets to its real value in BOTH the gross (0029) and the
  // withholding. Only exact opposite-sign pairs cancel; a file with no
  // reversals is unchanged. Corrections it leaves (a partial refund, a reversal
  // on another date) still net in dividends.ts, which sums every withholding
  // row of a dividend with its sign (issue #438).
  // A withholding can be booked days away from its dividend, so a late-December
  // dividend may have its withholding in January (and the other way round).
  // Match over every cash row in the statement, then keep the dividends paid in
  // the year. A fixed window around the year would cut some dividends off from
  // their own withholding and hand it to an in-year dividend of the same ISIN.
  // collapseCorrections pairs rows by exact date, so running it on every row
  // leaves the in-year rows unchanged.
  const allCashTransactions = collapseCorrections(statement.cashTransactions);
  const yearCashTransactions = allCashTransactions.filter((t) => t.dateTime.startsWith(yearStr));
  // Dividends are valued like interest: a currency with no ECB or manual rate
  // (e.g. IBKR's CNH) is skipped with a warning instead of aborting the report.
  const unvaluedDividendCurrencies = new Map<string, number>();
  let dividendEntries = calculateDividends(allCashTransactions, resolvedRateMap, {
    lookupRate: (date, currency) => lookupIncomeRate(date, currency, resolvedRateMap, manualRates),
    onUnvalued: (div) => {
      if (!div.dateTime.startsWith(yearStr)) return;
      unvaluedDividendCurrencies.set(div.currency, (unvaluedDividendCurrencies.get(div.currency) ?? 0) + 1);
    },
  }).filter((d) => d.payDate.startsWith(yearStr));
  if (titulares > 1) dividendEntries = dividendEntries.map((d) => splitDividend(d, titulares));
  const grossDividends = dividendEntries.reduce((sum, d) => sum.plus(d.grossAmountEur), new Decimal(0));

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
      const isEarned = t.type === "Crypto Reward Income" || t.type.includes("Received");
      // Each row counts with its direction: a receipt (+) adds to the interest
      // earned and a charge (−) to the interest paid; a negative received row (a
      // reversal) lowers the earned and a positive paid row (a refund) lowers the
      // paid. Same-day opposite rows at two brokers so net instead of adding up.
      const direction = new Decimal(t.amount).isNegative() === isEarned ? -1 : 1;
      const amountEur = splitInterestAmount(rawEur, titulares).mul(direction);

      if (isEarned) {
        interestEarned = interestEarned.plus(amountEur);
      } else {
        interestPaid = interestPaid.plus(amountEur);
      }

      return {
        type: isEarned ? ("earned" as const) : ("paid" as const),
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
  //    basis plus the profit at the sale rate. In the default, neither a buy nor
  //    a sale in the lot's own currency emits an FX disposal — only a real
  //    FCY→EUR conversion realizes the deferred gain; a sale in another currency
  //    than its lot books `stock_sale_cross` (#441), and «Tradicional con
  //    divisa» books lost dollars (`stock_sale`).
  //    FXCONV/AFx broker auto-conversions are PROCESSED by default (#239 — IBKR
  //    does not round-trip FCY→EUR on a sale, so an auto-converted balance is real
  //    held divisa); the opt-out (trackAutoConvert === false) restores the
  //    per-trade isFxconv() skip. Manual CASH/income and tracked stock round-trips
  //    always accrue/move FCY lots.
  // skipFx: monodivisa mode — the WHOLE FX engine is off: no FX result at all, not
  // even for the taxpayer's own FCY→EUR conversions or broker AFx/FXCONV ones. It
  // matches tools like Autodeclaro/Taxdown only in how shares are valued (buy at
  // the buy-date rate, sale at the sale-date rate; see traditionalCostBasis).
  let fxDisposals: ReturnType<FxFifoEngine["processEvents"]> = [];
  let fxTransmissionValue = new Decimal(0);
  let fxAcquisitionValue = new Decimal(0);
  let fxMessagesList: TaxMessage[] = [];
  let fxTrace: FxTraceEvent[] | undefined;
  let traditionalStats: ReturnType<FxFifoEngine["getTraditionalStats"]> | undefined;

  if (!options?.skipFx) {
    // «Tradicional con divisa» runs the same producers and engine in its own
    // mode; `new FxFifoEngine()` (no options) is the default, unchanged.
    const fxEngine = traditionalFx ? new FxFifoEngine({ traditionalFx: true }) : new FxFifoEngine();
    if (options?.fxTrace) fxEngine.enableTrace();
    // Process broker auto-conversions (AFx/FXCONV) by default; the opt-out
    // (trackAutoConvert === false) restores the historical skip (issue #239).
    const trackAutoConvert = options?.trackAutoConvert !== false;
    const tradeFxEvents = FxFifoEngine.extractFxEvents(statement.trades, rateMap, trackAutoConvert);
    // The collapsed rows, the ones the income path reads (issue #439): a
    // reversed and re-credited dividend opens one lot, not three.
    const cashFxEvents = FxFifoEngine.extractCashFxEvents(allCashTransactions, rateMap);
    // Foreign-stock round-trips (issue #230, carry-basis-defer): a FCY stock BUY
    // CONSUMES the FCY it spends from the pool and PARKS the carried basis; a FCY
    // stock SELL re-adds that principal at its carried basis plus the profit at the
    // sale rate. The BUY producer reads the FULL, unfiltered, all-year
    // `statement.trades` (a buy must park before its matching sell re-adds — the
    // trade-date sort in processEvents handles same-day ordering); the SELL
    // producer reads the FULL, unsplit, pre-wash-sale disposals across ALL years —
    // NOT the year-filtered/titulares-split `disposals`. Neither emits a disposal;
    // only a later USD→EUR conversion realizes the deferred gain (Art. 14.2.e). FX
    // disposals are year-filtered below and split at splitFxDisposal.
    const stockPurchaseFxEvents = FxFifoEngine.extractStockPurchaseFxEvents(statement.trades, rateMap, trackAutoConvert);
    const manualOpeningLotFxEvents = FxFifoEngine.extractManualOpeningLotFxEvents(usableManualOpeningLots, rateMap);
    const stockProceedsFxEvents = traditionalFx
      ? FxFifoEngine.extractStockProceedsFxEvents(fifoEngine.getDisposals(), { traditionalFx: true })
      : FxFifoEngine.extractStockProceedsFxEvents(fifoEngine.getDisposals());
    const allFxEvents = [
      ...tradeFxEvents,
      ...cashFxEvents,
      ...stockPurchaseFxEvents,
      ...manualOpeningLotFxEvents,
      ...stockProceedsFxEvents,
    ];
    // «Tradicional con divisa» replays every year in the upload (no stored state)
    // and snapshots the parked principal at this year's end for the orphan check.
    const allFxDisposals = traditionalFx
      ? fxEngine.processEvents(allFxEvents, { checkpointDate: yearEnd })
      : fxEngine.processEvents(allFxEvents);
    if (traditionalFx) traditionalStats = fxEngine.getTraditionalStats();
    fxDisposals = allFxDisposals.filter((d) => d.disposeDate.startsWith(yearStr));
    if (titulares > 1) fxDisposals = fxDisposals.map((d) => splitFxDisposal(d, titulares));

    fxTransmissionValue = fxDisposals.reduce((sum, d) => sum.plus(d.proceedsEur), new Decimal(0));
    fxAcquisitionValue = fxDisposals.reduce((sum, d) => sum.plus(d.costBasisEur), new Decimal(0));

    // Only show FX warnings when there are FX disposals in the target year.
    // Undated warnings (missing lots summaries) refer to events across all years —
    // showing them when the target year has zero FX activity is misleading noise.
    if (fxDisposals.length > 0) {
      fxMessagesList = filterByYear(
        fxEngine.messages,
        yearStr,
        (m) => m.message,
        (m) => m.context,
      );
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
  const fiscalCapitalGains = transmissionValue.minus(acquisitionValue).plus(blockedLosses).minus(reintegratedLosses);
  const totalSavingsBase = Decimal.max(fiscalCapitalGains, 0)
    .plus(Decimal.max(fxTransmissionValue.minus(fxAcquisitionValue), 0))
    .plus(grossDividends)
    .plus(interestEarned);
  const doubleTaxation = calculateDoubleTaxation(dividendEntries, year, totalSavingsBase);

  // Filter messages to those relevant to the selected year
  const yearMessages = filterByYear(
    fifoEngine.messages,
    yearStr,
    (m) => m.message,
    (m) => m.context,
  );

  // Crypto valuation pre-pass messages (filtered to the target year by date).
  const cryptoValuationMessages = filterByYear(
    valuation.messages,
    yearStr,
    (m) => m.message,
    (m) => m.context,
  );
  const yearUnresolvedCrypto = valuation.unresolved.filter((u) => u.date.startsWith(yearStr));

  // Aggregate structured messages from all sources
  const allMessages: TaxMessage[] = [
    ...(statement.parserMessages ?? []),
    ...yearMessages,
    ...fxMessagesList,
    ...manualOpeningLotMessages,
    ...cryptoValuationMessages,
  ];

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
  }

  if (unvaluedDividendCurrencies.size > 0) {
    const count = [...unvaluedDividendCurrencies.values()].reduce((a, b) => a + b, 0);
    const currencies = [...unvaluedDividendCurrencies.keys()].sort().join(", ");
    const divMsg = `Hay ${count} dividendo(s) en ${currencies} que no se han podido valorar automáticamente y no están incluidos en los importes calculados.`;
    allMessages.push({
      id: "report.dividend_unvalued",
      severity: "warning",
      message: divMsg,
      hint: "El BCE no publica un tipo de cambio oficial para esa divisa en la fecha de cobro. Calcula el importe en euros a esa fecha, súmalo a mano a la casilla 0029 y ten en cuenta su retención en la deducción por doble imposición internacional (casilla 0588).",
      context: { count: String(count), currencies },
    });
  }

  // A withholding correction posted in this year for a dividend of an earlier
  // year (issue #438): IBKR keeps the dividend's date in dateTime and posts the
  // rows later (reportDate); other brokers date a refund on its own day, in
  // January for a late-December dividend. That year's 0588 (foreign tax) or
  // 0597 (Spanish retención) was computed with the original withholding; when
  // the correction lowers it, the user may owe a complementaria. Each box gets
  // its own message. This year's boxes never include it: the matcher gives a
  // late-posted row only to a dividend of its own year.
  for (const { year: lateYear, spanish, amount } of priorYearWithholdingRefunds(statement.cashTransactions, year, resolvedRateMap, manualRates)) {
    const ctx = { year: String(lateYear), reportYear: yearStr, amount: fmt2(splitInterestAmount(amount, titulares)) };
    allMessages.push(
      spanish
        ? {
            id: "report.spanish_withholding_corrected_prior_year",
            severity: "warning",
            message: `Este fichero trae correcciones de retenciones españolas de ${ctx.year} anotadas en ${ctx.reportYear}: la retención de ${ctx.year} baja ${ctx.amount} €. Si presentaste ${ctx.year} con la retención original, la casilla 0597 de ese año pudo salir alta.`,
            hint: `La retención española sobre dividendos de emisores españoles es un pago a cuenta (casilla 0597, retenciones del capital mobiliario) y solo cuenta lo retenido de verdad. Sube el fichero de ${ctx.year} junto a este y calcula ${ctx.year}: DeclaRenta suma la corrección a la retención de su dividendo. Si la casilla 0597 baja respecto a la que presentaste, puede hacer falta una declaración complementaria de ${ctx.year}. Las casillas de ${ctx.reportYear} no cambian.`,
            context: ctx,
          }
        : {
            id: "report.withholding_corrected_prior_year",
            severity: "warning",
            message: `Este fichero trae correcciones de retenciones en origen de ${ctx.year} anotadas en ${ctx.reportYear}: la retención de ${ctx.year} baja ${ctx.amount} €. Si presentaste ${ctx.year} con la retención original, la casilla 0588 de ese año pudo salir alta.`,
            hint: `La deducción por doble imposición internacional (casilla 0588, art. 80 LIRPF) solo admite el impuesto pagado de verdad en el extranjero. Sube el fichero de ${ctx.year} junto a este y calcula ${ctx.year}: DeclaRenta suma la corrección a la retención de su dividendo. Si la casilla 0588 baja respecto a la que presentaste, puede hacer falta una declaración complementaria de ${ctx.year}. Las casillas de ${ctx.reportYear} no cambian.`,
            context: ctx,
          },
    );
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
  }

  // Anti-churning sees only the uploaded trades. A sale of this year whose
  // repurchase window runs past the last date the upload covers could still be
  // blocked (a loss) or turn non-definitive (a release) by a buy we cannot see.
  // Both steps share this one warning; nothing is withheld.
  const lastLoadedDate = [statement.toDate, ...washSaleTrades.map((tr) => tr.tradeDate)]
    .filter((d): d is string => typeof d === "string" && d.trim() !== "")
    .map((d) => normalizeDate(d.trim()).slice(0, 10))
    .reduce((max, d) => (d > max ? d : max), "");
  const uncoveredWindows = lastLoadedDate ? salesWithWindowPastData(disposals, lastLoadedDate) : [];
  if (uncoveredWindows.length > 0) {
    const windowEnd = uncoveredWindows.reduce((max, u) => (u.windowEnd > max ? u.windowEnd : max), "");
    const ctx = {
      count: String(uncoveredWindows.length),
      year: yearStr,
      lastDate: formatDateDmy(lastLoadedDate),
      windowEnd: formatDateDmy(windowEnd),
    };
    allMessages.push({
      id: "report.antichurning_window_past_data",
      severity: "warning",
      message: `Hay ${ctx.count} venta(s) de ${ctx.year} cuyo plazo de recompra de la regla anti-churning (2 meses, o 1 año si el valor no cotiza) termina después de la última fecha de los ficheros subidos (${ctx.lastDate}). DeclaRenta no ve las compras posteriores a esa fecha.`,
      hint: `Si compraste el mismo valor después del ${ctx.lastDate} y dentro del plazo de esas ventas (como muy tarde, hasta el ${ctx.windowEnd}), parte de su pérdida puede quedar bloqueada, o la venta deja de ser una transmisión definitiva y no libera pérdidas pendientes. Sube también el fichero con las operaciones hasta el ${ctx.windowEnd} junto a este y calcula de nuevo. Si no compraste, el cálculo ya es correcto.`,
      context: ctx,
    });
  }

  // Shared-titularity notice: amounts have been split equally per contribuyente.
  if (titulares > 1) {
    allMessages.push({
      id: "report.titularidad_compartida",
      severity: "info",
      message: `Los importes mostrados están divididos entre ${titulares} titulares (la parte que corresponde a cada contribuyente). Este informe refleja la declaración de UN solo titular: cada uno de los ${titulares} titulares debe presentar su propia declaración con esta misma parte. No declares el total en una sola declaración ni sumes las partes de varios titulares en la tuya.`,
      hint: `El reparto a partes iguales (${titulares} × ${(100 / titulares).toFixed(titulares === 3 ? 2 : 0)} %) presupone titularidad por igual. Si los porcentajes de titularidad son distintos (p. ej. 70/30), ajusta los importes manualmente. En cuentas de gananciales la atribución es 50/50 (Art. 11.3 LIRPF). Puedes cambiar el número de titulares en el paso «Revisar y elegir método» (en la línea de comandos, --titulares).`,
      context: { titulares: String(titulares), percent: (100 / titulares).toFixed(titulares === 3 ? 2 : 0) },
    });
  }

  // Reconciliation hint: explain why other tools may show different amounts (only when FX gains exist)
  if (traditionalFx) {
    allMessages.push(
      ...traditionalFxMessages({
        stats: traditionalStats!,
        yearStr,
        titulares,
        fxDisposals,
        disposals,
        yearEndLots,
      }),
    );
  } else if (!options?.skipFx && fxDisposals.length > 0) {
    allMessages.push({
      id: "report.competitor_reconciliation",
      severity: "info",
      message:
        "Si otra herramienta muestra un importe distinto, puede deberse a que no calcula las ganancias por tipo de cambio (Art. 33.1 LIRPF).",
      hint: COMPETITOR_RECONCILIATION_HINT,
    });
    // Method-consistency warning: the FX gain on a foreign currency is realized
    // here only when the currency is converted to euros (defer / carry-basis,
    // Art. 14.2.e LIRPF; DGT V0152-26). A different admitted method realizes it at
    // each foreign-currency purchase. The two must NOT be mixed across years.
    allMessages.push({
      id: "report.fx_method_consistency",
      severity: "info",
      message: FX_METHOD_CONSISTENCY_MESSAGE,
      hint: "No mezcles métodos entre ejercicios: si un año declaraste con otro criterio (o con otra herramienta), la base de divisa arrastrada puede duplicarse u omitirse. Para divisa adquirida antes del periodo de tu informe, incluye los años anteriores en la exportación del bróker.",
    });
  } else if (!options?.skipFx && fxDisposals.length === 0) {
    // Never-converted case: the user holds (and trades with) a foreign currency
    // but made NO FCY→EUR conversion this year, so no currency amount is added
    // to casillas 1633/1637 (options, crypto or funds may still fill them).
    // Only surface this when there are foreign-currency
    // SECURITIES disposals (STK/FUND/BOND, non-EUR) — i.e. the user genuinely
    // holds divisa — so it never fires on pure-EUR or crypto-only files. Heads
    // off the most common "why doesn't my number match IBKR?" question.
    const FX_ASSET_CATEGORIES = new Set(["STK", "FUND", "BOND"]);
    const hasForeignCurrencySecurities = disposals.some(
      (d) => d.currency !== "EUR" && FX_ASSET_CATEGORIES.has(d.assetCategory),
    );
    if (hasForeignCurrencySecurities) {
      allMessages.push({
        id: "report.fx_deferred_no_conversion",
        severity: "info",
        message:
          "No has convertido divisa a euros este ejercicio, por lo que no hay ganancia por tipo de cambio que declarar (no se suma ningún importe de divisa a las casillas 1633/1637). La diferencia de cambio mientras mantienes la moneda queda diferida hasta que la conviertas efectivamente a euros (Art. 14.2.e LIRPF; DGT V0152-26).",
        hint: "Tu bróker (p. ej. IBKR) puede mostrar una «realized forex gain» aunque no hayas pasado a euros: usa el criterio fiscal de EE. UU., no el español. Con el «Criterio DGT (multidivisa)», la ganancia de divisa solo se declara al cambiarla a euros o a otra divisa.",
      });
    }
  }

  // Monodivisa drops every currency conversion silently (the FX engine is off), so
  // say how many this year's file had. Mirrors extractFxEvents' filter: a non-EUR
  // CASH trade, minus AFx/FXCONV rows when the user also opted out of those.
  if (options?.skipFx) {
    const trackAutoConvert = options.trackAutoConvert !== false;
    const skippedConversions = statement.trades.filter(
      (tr) =>
        tr.assetCategory === "CASH" &&
        tr.currency !== "EUR" &&
        (trackAutoConvert || !FxFifoEngine.isFxconv(tr)) &&
        normalizeDate(tr.tradeDate || tr.settlementDate).startsWith(yearStr),
    ).length;
    if (skippedConversions > 0) {
      allMessages.push({
        id: "report.monodivisa_conversions_skipped",
        severity: "info",
        message: `El método «${FX_METHOD_NAME_ES.monodivisa}» ha dejado sin calcular ${skippedConversions} conversión(es) de divisa de este ejercicio (manuales o automáticas del bróker). Este método no calcula ningún resultado de divisa (casillas 1633/1637).`,
        hint: MONODIVISA_CONVERSIONS_SKIPPED_HINT,
        context: { count: String(skippedConversions) },
      });
    }
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
    settings: {
      monodivisa: options?.skipFx === true,
      // Written only when on, so default and monodivisa settings stay as before.
      ...(traditionalFx ? { traditionalFx: true as const } : {}),
      trackAutoConvert: options?.trackAutoConvert !== false,
      titulares,
    },
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
    yearEndLots,
  };
}
