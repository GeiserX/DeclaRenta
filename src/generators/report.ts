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
import { loanCurrencies } from "../engine/fx-loan-gate.js";
import { addMonths, detectWashSales, salesWithWindowPastData } from "../engine/wash-sale.js";
import { collectIsinWindows, listAntichurningSecurities } from "../engine/antichurning-window.js";
import { calculateDividends, matchWithholdings, withholdingCountry, withholdingEur, type WithholdingMatch } from "../engine/dividends.js";
import { collapseCorrections } from "../engine/cash-corrections.js";
import { calculateDoubleTaxation } from "../engine/double-taxation.js";
import { isEcbResolvable, lookupRateInMap } from "../engine/ecb.js";
import { resolveCryptoTradeValues, lookupValuationRate, isFiatPriced } from "../engine/crypto-valuation.js";
import { buildManualRateMap } from "../engine/manual-rates.js";
import { buildManualOpeningLotTrades, normalizeManualOpeningLot } from "../engine/manual-opening-lots.js";
import { formatDateDmy, normalizeDate, parseDate } from "../engine/dates.js";
import { finiteDisposalAmounts } from "./casillas.js";
import {
  cashOutOfRange,
  corporateActionOutOfRange,
  corporateActionQuantityOutOfRange,
  isCountableAmount,
  optionExerciseOutOfRange,
  tradeOutOfRange,
  tradeQuantityOutOfRange,
} from "../engine/amount-range.js";

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
    ...(d.loanDebtPartEur !== undefined ? { loanDebtPartEur: d.loanDebtPartEur.div(n) } : {}),
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

  /**
   * The anti-churning window the user set per ISIN (#452): 2 months (LIRPF
   * 33.5.f) or 12 (33.5.g). It wins over IBKR's listing exchange and over the
   * default. Untrusted input: a key that is not an ISIN or a value that is not
   * exactly 2 or 12 is ignored. Crypto keeps its own rule (33.5.e).
   */
  windowMonthsByIsin?: Readonly<Record<string, 2 | 12>>;
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

/** Where the user sets the anti-churning window per security (#452). */
const WINDOW_PANEL_ES = "«Plazo anti-churning por valor»";

/** The past-data hint's sentence on the window length (#452). */
const PAST_DATA_WINDOW_NOTE =
  `Ese plazo es de 1 año en los valores a los que DeclaRenta aplica 1 año (porque IBKR solo los muestra en un mercado sin equivalencia, como Londres desde 2021, SIX u OTC Markets, o porque tú los marcaste) y de 2 meses en los demás valores con ISIN. Si un valor solo cotiza en un mercado así y DeclaRenta le aplica 2 meses, márcalo con 1 año en el panel ${WINDOW_PANEL_ES} (en la línea de comandos, --antichurning-1y) y calcula de nuevo.`;

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

/** `brokerSource` of an IBKR upload (`ibkrParser.name`). */
const IBKR_BROKER = "Interactive Brokers";

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
 *    with no EUR origin in the upload (deposits, older years, or an overdraft
 *    or margin loan outside the loan gate of issue #449, fx-loan-gate.ts). An acquisition
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
  /** Currencies the FX engine ran with the loan model (issue #449, fx-loan-gate.ts). */
  loanCcys: ReadonlySet<string>;
}): TaxMessage[] {
  const { stats, yearStr, titulares, fxDisposals, disposals, yearEndLots, loanCcys } = input;
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

  // One note per currency and kind: the IBKR hint (upload a Cash Report) can
  // explain only the IBKR amount (a trap: summed per currency, it offered an
  // IBKR Cash Report for another broker's dollars too).
  const kindOrder = { opening: 0, ibkr: 1, other: 2 } as const;
  const uncovered = new Map<string, { ccy: string; kind: keyof typeof kindOrder; qty: Decimal }>();
  for (const u of stats.uncovered) {
    if (!u.date.startsWith(yearStr)) continue;
    const kind = loanCcys.has(u.currency) ? "opening" : u.brokerSource === IBKR_BROKER ? "ibkr" : "other";
    const key = `${u.currency}|${kind}`;
    const prev = uncovered.get(key) ?? { ccy: u.currency, kind, qty: new Decimal(0) };
    uncovered.set(key, { ...prev, qty: prev.qty.plus(u.qty) });
  }
  const notes = [...uncovered.values()].sort((a, b) => a.ccy.localeCompare(b.ccy) || kindOrder[a.kind] - kindOrder[b.kind]);
  for (const u of notes) {
    const ccy = u.ccy;
    const qty = fmt2(perTitular(u.qty));
    // Inside the loan gate (issue #449) the only currency with no EUR origin
    // is the account's opening balance, the Cash Report's `startingCash`.
    if (u.kind === "opening") {
      out.push({
        id: "report.fx_traditional_opening",
        severity: "info",
        message: `${qty} ${ccy} del saldo inicial de tu cuenta (el «Cash Report» de IBKR) se usaron en compras de acciones y no tienen origen en euros en tus archivos. Se toman al tipo del día de compra, sin diferencia de cambio anterior.`,
        hint: `Ese saldo ya estaba en la cuenta al empezar el primer periodo que has subido. Si conoces su origen, sube también los años anteriores.`,
        context: { qty, ccy },
      });
      continue;
    }
    const message = `${qty} ${ccy} usados en compras de acciones no tienen origen en euros en tus archivos (depósitos, saldos anteriores, años que no has subido, o un descubierto o préstamo de margen del bróker). Se toman al tipo del día de compra, sin diferencia de cambio anterior.`;
    const hint = `Si cambiaste euros a ${ccy} hasta 7 días después de la compra, se usa el tipo de ese cambio. Si conoces su origen, sube también los años anteriores.`;
    // An IBKR currency with no Cash Report the loan gate accepts: say how to get the loan model.
    if (u.kind === "ibkr") {
      out.push({
        id: "report.fx_traditional_uncovered_ibkr",
        severity: "info",
        message,
        hint: `${hint} Si tu saldo en ${ccy} quedó en negativo (descubierto o margen), sube el extracto de IBKR con la sección «Cash Report». DeclaRenta trata ese saldo negativo como un préstamo en ${ccy} solo si el Cash Report cuadra con tus operaciones, es de una sola cuenta y no hay en ${ccy} depósitos, retiradas, transferencias, opciones ni posiciones cortas.`,
        context: { qty, ccy },
      });
      continue;
    }
    out.push({ id: "report.fx_traditional_uncovered", severity: "info", message, hint, context: { qty, ccy } });
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

const isDividendRow = (c: CashTransaction): boolean => c.type === "Dividends" || c.type === "Payment In Lieu Of Dividends";

/**
 * The withholding rows that may belong to a dividend the report leaves out.
 * The matcher runs as the report runs it (`collapseCorrections`, then
 * `matchWithholdings`) on the rows the report keeps plus the dividends it
 * leaves out, twice: in file order, and with those dividends listed first.
 * Pass 1 gives each dividend the first withholding in reach in list order,
 * not the nearest one, so neither order alone finds every row such a dividend
 * may own. A withholding row (below 0) that either run gives to a dividend
 * left out goes with it. The rows cannot tell whose it is: a kept dividend
 * can only deduct less, and the warning names the row. A refund (above 0)
 * always stays: it can only lower the deduction.
 */
function withholdingsOfExcluded(
  rows: CashTransaction[],
  excludedDividends: ReadonlySet<CashTransaction>,
  outOfRange: ReadonlySet<CashTransaction>,
  uncountable: ReadonlySet<CashTransaction>,
): CashTransaction[] {
  const kept = collapseCorrections(rows.filter((c) => excludedDividends.has(c) || (!outOfRange.has(c) && !uncountable.has(c))));
  // Traps: in file order a kept 50 USD dividend four days earlier took the
  // 15 USD withheld from a 9e15 USD one; with the dividends left out listed
  // first, the 9e15 USD one took a kept dividend's own 5 USD and the kept one
  // took the 150 USD. Box 0588 deducted tax never paid, each time.
  const excludedFirst = [...kept.filter((c) => excludedDividends.has(c)), ...kept.filter((c) => !excludedDividends.has(c))];
  const leaves = new Set<CashTransaction>();
  for (const order of [kept, excludedFirst]) {
    const match = matchWithholdings(order);
    match.parts.forEach((parts, divIndex) => {
      if (!excludedDividends.has(match.dividends[divIndex]!)) return;
      for (const { index, amount } of parts) if (amount.lessThan(0)) leaves.add(match.withholdings[index]!);
    });
  }
  return kept.filter((c) => leaves.has(c));
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
  //
  // A trade with a number no broker writes (`tradeOutOfRange`: past 20
  // integer digits, or not 0 and below 10^-20) is named below
  // (`report.trade_out_of_range`) and counted nowhere, so no engine or
  // formatter meets a number such as 1e1000000000 (#470). With a readable
  // quantity it still moves its shares through FIFO, in their order, with
  // amounts that are no number: a buy's lot has no cost, so a sale that takes
  // it adds its proceeds and no cost (the user may overpay, never underpay),
  // and a sale's result is left out (`finiteDisposalAmounts`). With no
  // readable quantity it books nothing. The currency engine never sees it;
  // the anti-churning evidence reads every trade, as for a trade of unknown
  // quantity. A cash row (dividend, withholding, interest, reward) with such
  // a number is named the same way and counted nowhere. A corporate action
  // with one is named too and keeps its place (a split takes its ratio from
  // the description), but its amount is no number: a cash buyout's sale is
  // left out (`finiteDisposalAmounts`) and a scrip dividend's lot has no cost.
  // An action whose quantity is out of range gets the quantity "0", so it
  // moves no share: a cash buyout of 1e1000000000 shares booked a sale of
  // that many and the web PDF ran out of memory. An option exercise with
  // such a number books nothing in FIFO (`optionExerciseOutOfRange`) and is
  // named here.
  const outOfRangeCash = statement.cashTransactions.filter((c) => cashOutOfRange(c));
  const readableCash = outOfRangeCash.length === 0
    ? statement.cashTransactions
    : statement.cashTransactions.filter((c) => !outOfRangeCash.includes(c));
  const outOfRangeActions = statement.corporateActions.filter((ca) => corporateActionOutOfRange(ca));
  const corporateActions = outOfRangeActions.length === 0
    ? statement.corporateActions
    : statement.corporateActions.map((ca) => (outOfRangeActions.includes(ca)
        ? { ...ca, amount: "NaN", ...(corporateActionQuantityOutOfRange(ca) ? { quantity: "0" } : {}) }
        : ca));
  const outOfRangeExercises = (statement.optionExercises ?? []).filter((ex) => optionExerciseOutOfRange(ex));
  const outOfRangeTrades = statement.trades.filter((tr) => tradeOutOfRange(tr));
  const outOfRange = new Set<Trade>(outOfRangeTrades);
  const countedTrades = outOfRange.size === 0 ? statement.trades : statement.trades.filter((tr) => !outOfRange.has(tr));
  // The trades whose amounts are no number: a missing rate for their quote
  // currency must not drop them, or a sale leaves its lot to a later one
  // (`resolveCryptoTradeValues`, CodeRabbit on 10e1918).
  const noValueTrades = new Set<Trade>();
  const fifoInputTrades = outOfRange.size === 0
    ? statement.trades
    : statement.trades.flatMap((tr): Trade[] => {
        if (!outOfRange.has(tr)) return [tr];
        if (tradeQuantityOutOfRange(tr)) return [];
        const noValue = { ...tr, tradePrice: "NaN", tradeMoney: "NaN", commission: "0", taxes: "0", multiplier: "1" };
        noValueTrades.add(noValue);
        return [noValue];
      });
  const valuation = resolveCryptoTradeValues(fifoInputTrades, rateMap, manualRates, noValueTrades);
  const resolvedRateMap = valuation.rateMap;
  // A cash row the read range lets through but whose value in euros fails
  // the counted bound (`isCountableAmount`: 1e12 € or more, or no number,
  // e.g. from a rate of "Infinity"), as a sale's amount does: it is named
  // (`report.cash_amount_too_large`) and counted nowhere, neither in a box
  // nor in the currency engine. Before, a dividend of -9e15 dollars put
  // -9,900,000,000,000,000.00 € in box 0029 with no message, and a value
  // that was no number zeroed the whole box (`guardNonFiniteTotals`), the
  // other rows' income included.
  const uncountableCash = readableCash.filter((c) => {
    let value: ReturnType<typeof valueIncomeEur>;
    try {
      value = valueIncomeEur(c, resolvedRateMap, manualRates);
    } catch {
      return false; // an amount that is no number: not this rule's concern
    }
    return value !== null && !isCountableAmount(value.amountEur);
  });
  // The withholding of a dividend left out (either rule above) goes with
  // it, counted nowhere and named (`report.withholding_of_excluded_dividend`).
  // A trap: left in the rows, the matcher paired it with the next dividend of
  // the security within 7 days, and box 0588 deducted a tax that dividend
  // never paid (CodeRabbit on 10e1918).
  const excludedDividends = new Set([...outOfRangeCash, ...uncountableCash].filter(isDividendRow));
  const withholdingsLeftOut = excludedDividends.size === 0
    ? []
    : withholdingsOfExcluded(statement.cashTransactions, excludedDividends, new Set(outOfRangeCash), new Set(uncountableCash));
  const cashTransactions = uncountableCash.length === 0 && withholdingsLeftOut.length === 0
    ? readableCash
    : readableCash.filter((c) => !uncountableCash.includes(c) && !withholdingsLeftOut.includes(c));

  // 0c. Crypto reward income (staking, Simple Earn interest, airdrops, referral)
  //     establishes an acquisition lot at the EUR value taxed as income, so a
  //     later sale is not double-taxed (Art. 35.1). The EUR basis is whatever the
  //     income is valued at — an explicit broker EUR value, else a rate resolved
  //     from the (now-augmented) rate map or a manual hint. Synthesize tax-neutral
  //     BUY trades (FIFO never taxes a BUY); they are EUR-denominated so they need
  //     no further valuation and go straight to the FIFO engine.
  const rewardLots = synthesizeRewardLots(cashTransactions, resolvedRateMap, manualRates);
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
  fifoEngine.processTrades(resolvedTrades, resolvedRateMap, corporateActions, statement.optionExercises);
  // A cash buyout is a sale booked inside FIFO from a TC row; anti-churning must
  // see it too, or the bought-out shares still count as held (V3282-18 total exit).
  const washSaleTrades = [...statement.trades, ...manualOpeningLotTrades, ...fifoEngine.getCashBuyoutSales()];

  // Lots still held at 31 December, for the Modelo 720 acquisition dates. When
  // the upload runs past the year end, the main pass has already consumed lots
  // with later sales, so replay only the inputs dated up to 31 December.
  const yearEnd = `${year}-12-31`;
  const tradesToYearEnd = resolvedTrades.filter((t) => normalizeDate(t.tradeDate) <= yearEnd);
  const actionsToYearEnd = corporateActions.filter((ca) => normalizeDate(ca.dateTime.slice(0, 8)) <= yearEnd);
  const exercisesToYearEnd = statement.optionExercises?.filter((ex) => normalizeDate(ex.date) <= yearEnd);
  let yearEndLots = fifoEngine.getRemainingLots();
  if (
    tradesToYearEnd.length < resolvedTrades.length ||
    actionsToYearEnd.length < corporateActions.length ||
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
  // What each uploaded file shows per account, for the one-purchase exception
  // (#453): the days it covers and its end-of-period holdings, the only proof
  // that no share was held at the window start. An unmerged statement is one
  // file. An IBKR Flex has one period per account; each holdings row goes to
  // the account it names (the parser gives a row without one its
  // FlexStatement's account), and a row of no listed account stays apart (with
  // no period it can prove nothing), even in a one-account file.
  const files = statement.holdingsBySource ?? [
    {
      accountId: statement.accountId,
      fromDate: statement.fromDate,
      toDate: statement.toDate,
      openPositions: statement.openPositions,
      cashBalances: [],
      ...(statement.accountPeriods ? { accountPeriods: statement.accountPeriods } : {}),
    },
  ];
  const accountStatements = files.flatMap((src) => {
    // A file with no account periods is a broker export of trades.
    const periods = src.accountPeriods?.length ? src.accountPeriods : [{ accountId: src.accountId, fromDate: src.fromDate ?? "", toDate: src.toDate, hasTrades: true }];
    const ids = new Set(periods.map((p) => p.accountId));
    const own = periods.map((p) => ({
      source: src.brokerSource,
      accountId: p.accountId,
      fromDate: p.fromDate,
      toDate: p.toDate,
      hasTrades: p.hasTrades,
      ...(p.hasPositions !== undefined ? { hasPositions: p.hasPositions } : {}),
      positions: src.openPositions.filter((pos) => pos.accountId === p.accountId),
    }));
    const stray = src.openPositions.filter((pos) => !ids.has(pos.accountId));
    return stray.length === 0 ? own : [...own, { source: src.brokerSource, accountId: "\u0000unlisted", toDate: src.toDate, hasTrades: false, positions: stray }];
  });
  // The anti-churning window of each ISIN (#452): the user's value, else IBKR's
  // listing exchanges. ONE map feeds the block, the definitive test (both in
  // detectWashSales) and the past-data warning (salesWithWindowPastData).
  const isinWindows = collectIsinWindows(washSaleTrades, statement.securitiesInfo, options?.windowMonthsByIsin);
  const allDisposals = detectWashSales(
    fifoEngine.getDisposals(),
    washSaleTrades,
    corporateActions,
    fifoEngine.getSplitRatios(),
    fifoEngine.getRemainingLots(),
    { statements: accountStatements },
    isinWindows,
  );
  let disposals = allDisposals.filter((d) => d.sellDate.startsWith(yearStr));
  if (titulares > 1) disposals = disposals.map((d) => splitDisposal(d, titulares));
  const securityNames = new Map<string, { symbol: string; description: string }>();
  for (const tr of washSaleTrades) if (tr.isin && !securityNames.has(tr.isin)) securityNames.set(tr.isin, { symbol: tr.symbol, description: tr.description });
  const antichurningSecurities = listAntichurningSecurities(disposals, isinWindows, year, securityNames);

  // A non-finite amount of one sale is left out alone, never the valid amounts
  // of the rest of the year (`finiteDisposalAmounts`, the casilla boxes' rule);
  // the sale is named below (`report.non_finite_disposal`).
  const transmissionValue = disposals.reduce((sum, d) => sum.plus(finiteDisposalAmounts(d).proceeds), new Decimal(0));
  const acquisitionValue = disposals.reduce((sum, d) => sum.plus(finiteDisposalAmounts(d).cost), new Decimal(0));
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
  const allCashTransactions = collapseCorrections(cashTransactions);
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
  // Issue #449: the loan model's currencies and every loan repayment of the run.
  let loanCcys: ReadonlySet<string> = new Set();
  let loanRepayments: ReturnType<FxFifoEngine["getLoanRepayments"]> = [];

  if (!options?.skipFx) {
    // Process broker auto-conversions (AFx/FXCONV) by default; the opt-out
    // (trackAutoConvert === false) restores the historical skip (issue #239).
    const trackAutoConvert = options?.trackAutoConvert !== false;
    const tradeFxEvents = FxFifoEngine.extractFxEvents(countedTrades, rateMap, trackAutoConvert);
    // The collapsed rows, the ones the income path reads (issue #439): a
    // reversed and re-credited dividend opens one lot, not three.
    // The rows it leaves out tell the loan gate which currencies' cash it
    // cannot prove (issue #449).
    const omittedCash: CashTransaction[] = [];
    const cashFxEvents = FxFifoEngine.extractCashFxEvents(allCashTransactions, rateMap, omittedCash);
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
    const stockPurchaseFxEvents = FxFifoEngine.extractStockPurchaseFxEvents(countedTrades, rateMap, trackAutoConvert);
    const manualOpeningLotFxEvents = FxFifoEngine.extractManualOpeningLotFxEvents(usableManualOpeningLots, rateMap);
    const stockProceedsFxEvents = traditionalFx
      ? FxFifoEngine.extractStockProceedsFxEvents(fifoEngine.getDisposals(), { traditionalFx: true })
      : FxFifoEngine.extractStockProceedsFxEvents(fifoEngine.getDisposals());
    // Issue #449: a currency whose cash the IBKR CashReport proves (every
    // statement's rows, also those `yearEndHoldings` left out of Modelo 720)
    // treats a balance below zero as a loan from the broker. Every other
    // currency keeps the untracked path. The gate reads the stock sales as
    // «Tradicional con divisa» does (every sale, also with proceeds ≤ 0), so
    // both methods reach the same answer on the same upload.
    const allSales = traditionalFx
      ? stockProceedsFxEvents
      : FxFifoEngine.extractStockProceedsFxEvents(fifoEngine.getDisposals(), { traditionalFx: true });
    const loan = loanCurrencies({
      events: [...tradeFxEvents, ...cashFxEvents, ...stockPurchaseFxEvents, ...manualOpeningLotFxEvents, ...allSales],
      cashBalances: statement.holdingsBySource
        ? statement.holdingsBySource.flatMap((s) => s.cashBalances)
        : (statement.cashBalances ?? []),
      trades: countedTrades,
      cashTransactions,
      omittedCash,
      corporateActions,
      trackAutoConvert,
    });
    loanCcys = new Set(loan.keys());
    // The default's own producer drops a sale with proceeds of 0 or less. In a
    // loan currency the gate counted its cash (a commission above a worthless
    // sale's gross), so the default's ledger must see that sale too (a trap:
    // the 5 USD such a commission cost stayed in the default's pool). The two
    // producers differ only in that filter, so every other currency keeps the
    // default's own sales, in the same order. A sale whose proceeds are no
    // number (`retire`, proceeds 0) is in both: it retires its principal.
    const sales =
      traditionalFx || loan.size === 0
        ? stockProceedsFxEvents
        : allSales.filter((e) => e.crossCurrency === true || e.retire === true || (e.proceedsFcy ?? new Decimal(0)).greaterThan(0) || loan.has(e.currency));
    const allFxEvents = [...tradeFxEvents, ...cashFxEvents, ...stockPurchaseFxEvents, ...manualOpeningLotFxEvents, ...sales];
    // «Tradicional con divisa» runs the same producers and engine in its own
    // mode; `new FxFifoEngine()` (no options) is the default, unchanged.
    const fxEngine = new FxFifoEngine({
      ...(traditionalFx ? { traditionalFx: true } : {}),
      ...(loan.size > 0 ? { loan } : {}),
    });
    if (options?.fxTrace) fxEngine.enableTrace();
    // «Tradicional con divisa» replays every year in the upload (no stored state)
    // and snapshots the parked principal at this year's end for the orphan check.
    const allFxDisposals = traditionalFx
      ? fxEngine.processEvents(allFxEvents, { checkpointDate: yearEnd })
      : fxEngine.processEvents(allFxEvents);
    if (traditionalFx) traditionalStats = fxEngine.getTraditionalStats();
    loanRepayments = fxEngine.getLoanRepayments();
    fxDisposals = allFxDisposals.filter((d) => d.disposeDate.startsWith(yearStr));
    if (titulares > 1) fxDisposals = fxDisposals.map((d) => splitFxDisposal(d, titulares));

    fxTransmissionValue = fxDisposals.reduce((sum, d) => sum.plus(finiteDisposalAmounts(d).proceeds), new Decimal(0));
    fxAcquisitionValue = fxDisposals.reduce((sum, d) => sum.plus(finiteDisposalAmounts(d).cost), new Decimal(0));

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
  // the correction lowers it, the user corrects that year: an autoliquidación
  // rectificativa from 2024 on, a complementaria for 2023 and earlier (#458). Each box gets
  // its own message. This year's boxes never include it: the matcher gives a
  // late-posted row only to a dividend of its own year.
  for (const { year: lateYear, spanish, amount } of priorYearWithholdingRefunds(cashTransactions, year, resolvedRateMap, manualRates)) {
    const ctx = { year: String(lateYear), reportYear: yearStr, amount: fmt2(splitInterestAmount(amount, titulares)) };
    allMessages.push(
      spanish
        ? {
            id: "report.spanish_withholding_corrected_prior_year",
            severity: "warning",
            message: `Este fichero trae correcciones de retenciones españolas de ${ctx.year} anotadas en ${ctx.reportYear}: la retención de ${ctx.year} baja ${ctx.amount} €. Si presentaste ${ctx.year} con la retención original, la casilla 0597 de ese año pudo salir alta.`,
            hint: `La retención española sobre dividendos de emisores españoles es un pago a cuenta (casilla 0597, retenciones del capital mobiliario) y solo cuenta lo retenido de verdad. Sube el fichero de ${ctx.year} junto a este y calcula ${ctx.year}: DeclaRenta suma la corrección a la retención de su dividendo. Si la casilla 0597 baja respecto a la que presentaste, corrige la declaración de ${ctx.year} (2024 y posteriores: autoliquidación rectificativa; 2023 y anteriores: autoliquidación complementaria). Las casillas de ${ctx.reportYear} no cambian.`,
            context: ctx,
          }
        : {
            id: "report.withholding_corrected_prior_year",
            severity: "warning",
            message: `Este fichero trae correcciones de retenciones en origen de ${ctx.year} anotadas en ${ctx.reportYear}: la retención de ${ctx.year} baja ${ctx.amount} €. Si presentaste ${ctx.year} con la retención original, la casilla 0588 de ese año pudo salir alta.`,
            hint: `La deducción por doble imposición internacional (casilla 0588, art. 80 LIRPF) solo admite el impuesto pagado de verdad en el extranjero. Sube el fichero de ${ctx.year} junto a este y calcula ${ctx.year}: DeclaRenta suma la corrección a la retención de su dividendo. Si la casilla 0588 baja respecto a la que presentaste, corrige la declaración de ${ctx.year} (2024 y posteriores: autoliquidación rectificativa; 2023 y anteriores: autoliquidación complementaria). Las casillas de ${ctx.reportYear} no cambian.`,
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
  // Both steps share one warning; nothing is withheld. With several brokers each
  // security is checked against the files of the brokers that trade it.
  const lastLoadedDate = [statement.toDate, ...washSaleTrades.map((tr) => tr.tradeDate)]
    .filter((d): d is string => typeof d === "string" && d.trim() !== "")
    .map((d) => normalizeDate(d.trim()).slice(0, 10))
    .reduce((max, d) => (d > max ? d : max), "");
  const endBySource = new Map<string, string>();
  for (const src of statement.holdingsBySource ?? []) {
    if (!src.brokerSource || !src.toDate) continue;
    const end = normalizeDate(src.toDate).slice(0, 10);
    const prev = endBySource.get(src.brokerSource);
    if (!prev || end > prev) endBySource.set(src.brokerSource, end);
  }
  const uncoveredWindows = lastLoadedDate
    ? salesWithWindowPastData(disposals, lastLoadedDate, washSaleTrades, endBySource, isinWindows)
    : [];
  // The return is due on 30 June of the next year. A window that ends later is
  // still open when the user files, so "if you did not buy" cannot be known yet:
  // a later buy means correcting the filed return with an autoliquidación
  // rectificativa, the only procedure from tax year 2024 on (AEAT, Manual Renta
  // 2025). For 2023 and earlier the deadline and every window have passed.
  const deadline = `${year + 1}-06-30`;
  const openAtFiling = (u: { windowEnd: string }): boolean => year >= 2024 && u.windowEnd > deadline;
  const windowGroups = [
    { id: "report.antichurning_window_past_data", sales: uncoveredWindows.filter((u) => !openAtFiling(u)) },
    { id: "report.antichurning_window_open_at_filing", sales: uncoveredWindows.filter(openAtFiling) },
  ];
  for (const { id, sales } of windowGroups) {
    if (sales.length === 0) continue;
    const windowEnd = sales.reduce((max, u) => (u.windowEnd > max ? u.windowEnd : max), "");
    const lastDate = sales.reduce((min, u) => (min === "" || u.lastDate < min ? u.lastDate : min), "");
    const base = {
      count: String(sales.length),
      year: yearStr,
      lastDate: formatDateDmy(lastDate),
      windowEnd: formatDateDmy(windowEnd),
    };
    if (id === "report.antichurning_window_past_data") {
      allMessages.push({
        id,
        severity: "warning",
        message: `Hay ${base.count} venta(s) de ${base.year} cuyo plazo de recompra de la regla anti-churning (2 meses; 1 año si el valor no cotiza en un mercado regulado del Espacio Económico Europeo ni en uno equivalente; en las criptomonedas, solo el año siguiente a la venta) termina después de la última fecha que cubren los ficheros subidos de ese bróker (${base.lastDate}). DeclaRenta no ve las compras posteriores a esa fecha.`,
        hint: `Si compraste el mismo valor después del ${base.lastDate} y dentro del plazo de esas ventas (como muy tarde, hasta el ${base.windowEnd}), parte de su pérdida puede quedar bloqueada, o la venta deja de ser una transmisión definitiva y no libera pérdidas pendientes. Sube también el fichero con las operaciones hasta el ${base.windowEnd} junto a este y calcula de nuevo. ${PAST_DATA_WINDOW_NOTE} En las criptomonedas solo cuentan las compras de la misma criptomoneda, en cualquier exchange, hechas después de la venta y, como muy tarde, hasta el ${base.windowEnd}; las anteriores a la venta no cuentan. Si no compraste, el cálculo ya es correcto.`,
        context: base,
      });
    } else {
      const ctx = { ...base, deadline: formatDateDmy(deadline) };
      allMessages.push({
        id,
        severity: "warning",
        message: `Hay ${ctx.count} venta(s) de ${ctx.year} cuyo plazo de recompra de la regla anti-churning termina el ${ctx.windowEnd} como muy tarde: después del ${ctx.deadline}, último día para presentar la declaración, y después de la última fecha que cubren los ficheros subidos de ese bróker (${ctx.lastDate}). Cuando presentes la declaración, ese plazo seguirá abierto.`,
        hint: `Antes de presentar, sube también el fichero con tus operaciones posteriores al ${ctx.lastDate} y calcula de nuevo. Si compras el mismo valor o la misma criptomoneda hasta el ${ctx.windowEnd} inclusive, parte de la pérdida de esas ventas puede quedar bloqueada, o la venta deja de ser una transmisión definitiva y no libera pérdidas pendientes. En ese caso, corrige la declaración presentada con una autoliquidación rectificativa.`,
        context: ctx,
      });
    }
  }

  // The per-ISIN anti-churning window (#452). A 1-year reading from IBKR is a
  // warning with the way back (the panel or --antichurning-2m); a 2-month
  // reading that rests on an EMIR-only decision is an open point; a window the
  // user set is listed, so the filed PDF shows which windows were set by hand.
  const entry = (s: (typeof antichurningSecurities)[number]): string => `${s.symbol || s.isin} (${s.isin}, IBKR: ${s.listingExchanges.join(", ")})`;
  const oneYearIbkr = antichurningSecurities.filter((s) => s.source === "ibkr" && s.months === 12);
  if (oneYearIbkr.length > 0) {
    const ctx = { count: String(oneYearIbkr.length), list: oneYearIbkr.map(entry).join("; ") };
    allMessages.push({
      id: "report.antichurning_one_year_ibkr",
      severity: "warning",
      message: `DeclaRenta aplica el plazo de 1 año de la regla anti-churning (art. 33.5.g LIRPF) a las ventas de ${ctx.count} valor(es) hechas en días en que IBKR solo los muestra en un mercado que no es un mercado regulado del Espacio Económico Europeo ni un mercado declarado equivalente por la Comisión Europea: ${ctx.list}.`,
      hint: `IBKR solo muestra el mercado de las líneas que has operado. Si el valor también está admitido a negociación en un mercado regulado del Espacio Económico Europeo (no basta un mercado de crecimiento ni otro sistema multilateral de negociación) o en NYSE, Nasdaq, ASX o la Bolsa de Hong Kong, le corresponden 2 meses: márcalo con 2 meses en el panel ${WINDOW_PANEL_ES} (en la línea de comandos, --antichurning-2m) y calcula de nuevo.`,
      context: ctx,
    });
  }
  const openListing = antichurningSecurities.filter((s) => s.source !== "user" && s.openDecision !== undefined);
  if (openListing.length > 0) {
    const ctx = {
      count: String(openListing.length),
      list: openListing.map((s) => `${s.symbol || s.isin} (${s.isin}, IBKR: ${(s.openListingExchanges ?? s.listingExchanges).join(", ")}, ${s.openDecision})`).join("; "),
    };
    allMessages.push({
      id: "report.antichurning_listing_open",
      severity: "info",
      message: `DeclaRenta aplica 2 meses a las ventas de ${ctx.count} valor(es) hechas en días en que IBKR los muestra en Toronto, TSX Venture, Aequitas Neo, Tokio o Singapur: ${ctx.list}. Una decisión de la Comisión Europea declara ese mercado equivalente a un mercado regulado, y la DGT acepta ese tipo de decisión (consulta V0778-25), pero ninguna consulta lo confirma para acciones.`,
      hint: `Si prefieres el criterio prudente, márcalo con 1 año en el panel ${WINDOW_PANEL_ES} (en la línea de comandos, --antichurning-1y) y calcula de nuevo.`,
      context: ctx,
    });
  }
  const userOneYear = antichurningSecurities.filter((s) => s.source === "user" && s.months === 12);
  const userTwoOverIbkr = antichurningSecurities.filter((s) => s.source === "user" && s.months === 2 && s.autoMonths === 12);
  if (userOneYear.length + userTwoOverIbkr.length > 0) {
    const names = (rows: typeof antichurningSecurities): string => rows.map((s) => `${s.symbol || s.isin} (${s.isin})`).join("; ") || "—";
    const ctx = { count: String(userOneYear.length + userTwoOverIbkr.length), oneYear: names(userOneYear), twoMonths: names(userTwoOverIbkr) };
    allMessages.push({
      id: "report.antichurning_window_user",
      severity: "info",
      message: `Has fijado a mano el plazo de la regla anti-churning de ${ctx.count} valor(es). 1 año: ${ctx.oneYear}. 2 meses, en lugar del año que daba IBKR: ${ctx.twoMonths}.`,
      hint: `DeclaRenta usa tu plazo en lugar del automático en el bloqueo de pérdidas, en la prueba de transmisión definitiva y en los avisos de plazo. Puedes cambiarlo en el panel ${WINDOW_PANEL_ES} (en la línea de comandos, --antichurning-1y o --antichurning-2m).`,
      context: ctx,
    });
  }

  // The one-purchase exception of the 2-month rule (#453, DGT V3282-18). One
  // message per outcome, counted in sales (security and day): "applied" says the
  // exception rests on the upload showing no shares at the window start;
  // "unverified" says it was withheld because the upload starts after it.
  const singlePurchaseSales = new Map<"applied" | "unverified", Map<string, string>>();
  for (const d of disposals) {
    const status = d.washSaleSinglePurchase;
    if (!status) continue;
    let sales = singlePurchaseSales.get(status);
    if (!sales) {
      sales = new Map();
      singlePurchaseSales.set(status, sales);
    }
    const day = normalizeDate(d.sellDate).slice(0, 10);
    sales.set(`${d.isin || d.symbol}|${day}`, addMonths(parseDate(day), -2).toISOString().slice(0, 10));
  }
  for (const status of ["applied", "unverified"] as const) {
    const sales = singlePurchaseSales.get(status);
    if (!sales) continue;
    const windowStart = formatDateDmy([...sales.values()].reduce((min, d) => (d < min ? d : min)));
    const ctx = { count: String(sales.size), year: yearStr, windowStart };
    if (status === "applied") {
      allMessages.push({
        id: "report.antichurning_single_purchase",
        severity: "info",
        message: `En ${ctx.count} venta(s) de ${ctx.year}, la compra de los 2 meses anteriores no cuenta como recompra: fue la única compra de ese valor en ese plazo y al empezar el plazo no tenías acciones de ese valor (excepción de compra única, DGT V3282-18). Esa compra no bloquea su pérdida ni impide que la venta libere pérdidas pendientes.`,
        hint: `DeclaRenta solo ve los ficheros subidos. Si al empezar el plazo (el primero empieza el ${ctx.windowStart}) tenías acciones de ese valor en otro bróker o cuenta que no has subido, o después las traspasaste a otra entidad, la excepción no se aplica: sube también esos ficheros y calcula de nuevo. Una compra en los 2 meses posteriores a la venta sigue bloqueando la pérdida.`,
        context: ctx,
      });
    } else {
      allMessages.push({
        id: "report.antichurning_single_purchase_unverified",
        severity: "warning",
        message: `En ${ctx.count} venta(s) de ${ctx.year} puede aplicarse la excepción de compra única de la regla de los 2 meses, pero DeclaRenta no la aplica: los ficheros subidos no demuestran que al empezar el plazo (el primero empieza el ${ctx.windowStart}) no tuvieras acciones de ese valor. La compra de los 2 meses anteriores cuenta como recompra.`,
        hint: `Si al empezar el plazo no tenías acciones de ese valor en ningún bróker, y en los 2 meses anteriores a la venta solo hiciste esa compra, esa compra no cuenta como recompra (DGT V3282-18). DeclaRenta solo la aplica cuando tus ficheros lo demuestran, cuenta por cuenta: los ficheros de cada cuenta que tiene o mueve ese valor deben cubrir sus operaciones sin huecos ni días repetidos desde el ${ctx.windowStart} hasta unas posiciones a fin de periodo con fecha igual o posterior a la venta (en IBKR, las secciones Trades y Open Positions de la Flex Query, con el campo ISIN), con todas las cantidades legibles y con las mismas acciones que dejan las operaciones de esa cuenta. Una operación de acciones sin ISIN en ese periodo, o unas acciones sin ISIN que aún tuvieras al empezarlo (por ejemplo, de Revolut), en cualquier cuenta, también lo impiden, porque pueden ser de ese valor. Un fichero que solo incluye operaciones no basta, y un traspaso entre cuentas o un lote manual dentro de ese plazo no se puede comprobar.`,
        context: ctx,
      });
    }
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
        loanCcys,
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

  // Issue #449: currency that repaid a loan from the broker this year (both
  // methods that run the FX engine). The law puts the debt's own change in
  // another base than DeclaRenta does, so the note gives that part, from
  // every repayment: also those that book nothing in 1633/1637 (the default
  // repays a loan with the shares' own sale at the loan's rate), so both
  // methods give the same figures for the same loan. Gains and losses apart:
  // they go in two boxes. The hint tells how to take the part out of
  // 1633/1637 only for the part a row there holds; for the rest (in the
  // default's stock line) DeclaRenta cannot name the box value, so the
  // `_manual` note says so (a trap: it told the user to lower 1633 by 50 €
  // when 1633 held none of it, and was 0).
  const loanRows = fxDisposals.filter((d) => d.trigger === "loan_repayment");
  const yearRepayments = loanRepayments.filter((r) => r.date.startsWith(yearStr));
  if (loanRows.length > 0 || yearRepayments.some((r) => !r.debtPartEur.isZero())) {
    const perTitular = (d: Decimal): Decimal => (titulares > 1 ? d.div(titulares) : d);
    const ccy = [...new Set([...loanRows, ...yearRepayments].map((d) => d.currency))].sort().join(", ");
    const amount = fmt2(loanRows.reduce((sum, d) => sum.plus(d.gainLossEur), new Decimal(0)));
    const sum = (sign: 1 | -1, onlyInBoxes: boolean): Decimal =>
      perTitular(
        yearRepayments.reduce(
          (acc, r) => (r.debtPartEur.mul(sign).greaterThan(0) && (!onlyInBoxes || r.inBoxes) ? acc.plus(r.debtPartEur.mul(sign)) : acc),
          new Decimal(0),
        ),
      );
    const [gainDec, lossDec, boxGainDec, boxLossDec] = [sum(1, false), sum(-1, false), sum(1, true), sum(-1, true)];
    const gain = fmt2(gainDec);
    const loss = fmt2(lossDec);
    const message = `Este año has devuelto ${ccy} que te prestó el bróker (tu saldo en ${ccy} estuvo en negativo). DeclaRenta declara ${amount} € por esas devoluciones en las casillas 1633/1637. La variación de la propia deuda, desde que se abrió hasta que la devolviste, es de ${gain} € de ganancia y ${loss} € de pérdida.`;
    const law = "El Tribunal Supremo (STS 71/2021, ECLI:ES:TS:2021:345) lleva la variación de un préstamo en moneda extranjera a la base general. La DGT la lleva a la base del ahorro (V2414-12), como hace DeclaRenta.";
    const gate = "DeclaRenta solo trata el saldo negativo como préstamo cuando el informe de efectivo (Cash Report) de IBKR cuadra con tus operaciones.";
    if (gainDec.equals(boxGainDec) && lossDec.equals(boxLossDec)) {
      allMessages.push({
        id: "report.fx_loan_repayment",
        severity: "info",
        message,
        hint: `${law} Si sigues al Supremo, declara la ganancia en la casilla 0304 y la pérdida en la casilla 0305, y quítalas de las casillas 1633/1637: baja el valor de transmisión (1633) en la ganancia y súbelo en la pérdida. ${gate}`,
        context: { ccy, amount, gain, loss },
      });
    } else {
      const boxGain = fmt2(boxGainDec);
      const boxLoss = fmt2(boxLossDec);
      allMessages.push({
        id: "report.fx_loan_repayment_manual",
        severity: "info",
        message,
        hint: `${law} Si sigues al Supremo, declara la ganancia en la casilla 0304 y la pérdida en la casilla 0305. De esas cifras, solo ${boxGain} € de ganancia y ${boxLoss} € de pérdida están en las casillas 1633/1637: baja el valor de transmisión (1633) en esa ganancia y súbelo en esa pérdida. El resto no está en 1633/1637, sino dentro del resultado de otras operaciones (por ejemplo, la venta de las acciones que compraste con el préstamo), y DeclaRenta no puede decirte qué casilla corregir: cuádralo a mano antes de presentar la declaración. ${gate}`,
        context: { ccy, amount, gain, loss, boxGain, boxLoss },
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
  // A trade with a number no broker writes: counted nowhere (see the top).
  const outOfRangeRows = [
    ...outOfRangeTrades.map((tr) => `${tr.symbol || tr.isin} (${formatDateDmy(tr.tradeDate)})`),
    ...outOfRangeCash.map((c) => `${c.symbol || c.isin || c.description} (${formatDateDmy(c.dateTime)})`),
    ...outOfRangeActions.map((ca) => `${ca.symbol || ca.isin} (${formatDateDmy(ca.dateTime.slice(0, 8))})`),
    ...outOfRangeExercises.map((ex) => `${ex.symbol || ex.underlyingSymbol} (${formatDateDmy(ex.date)})`),
  ];
  if (outOfRangeRows.length > 0) {
    const count = String(outOfRangeRows.length);
    const rows = outOfRangeRows.join(", ");
    allMessages.push({
      id: "report.trade_out_of_range",
      severity: "error",
      message: `${count} operación(es) del fichero tienen una cantidad, un precio, una comisión o un importe que ningún bróker escribe (más de 20 cifras enteras, o 20 ceros o más tras la coma): ${rows}. Sus importes no se suman a las casillas.`,
      hint: "Si la cantidad se puede leer, la compra crea su lote sin coste: la venta que lo usa suma su valor de transmisión y no su valor de adquisición, así que puedes pagar de más, nunca de menos. Una venta así no suma su resultado, ni un dividendo, un interés o una retención así su importe. Revisa esas filas en el fichero del bróker y declara su resultado a mano.",
      context: { count, rows },
    });
  }
  // A cash row worth 1e12 € or more: counted nowhere (see `uncountableCash`).
  if (uncountableCash.length > 0) {
    const count = String(uncountableCash.length);
    const rows = uncountableCash.map((c) => `${c.symbol || c.isin || c.description} (${formatDateDmy(c.dateTime)})`).join(", ");
    allMessages.push({
      id: "report.cash_amount_too_large",
      severity: "error",
      message: `${count} cobro(s) o cargo(s) del fichero tienen un valor en euros que no es un número o que llega a un billón de euros: ${rows}. Sus importes no se suman a las casillas.`,
      hint: "Suele ser un error del fichero o del tipo de cambio: ningún dividendo, interés o retención real llega a un billón de euros. Revisa esas filas en el fichero del bróker y en los tipos de cambio, y declara su importe a mano.",
      context: { count, rows },
    });
  }
  // The withholding of a dividend left out: counted nowhere with it.
  if (withholdingsLeftOut.length > 0) {
    const count = String(withholdingsLeftOut.length);
    const rows = withholdingsLeftOut.map((c) => `${c.symbol || c.isin || c.description} (${formatDateDmy(c.dateTime)})`).join(", ");
    allMessages.push({
      id: "report.withholding_of_excluded_dividend",
      severity: "warning",
      message: `${count} retención(es) del fichero pueden ser de un dividendo que no se suma: ${rows}. Tampoco se suman, para que no se descuenten de otro dividendo.`,
      hint: "Cuando declares a mano ese dividendo, declara también su retención. Si una de ellas es de otro dividendo, declárala con ese otro dividendo.",
      context: { count, rows },
    });
  }
  // A sale or currency disposal with a non-finite amount, or one past 12
  // integer digits of euros: the totals above left that amount out alone
  // (`finiteDisposalAmounts`). Name each one, so the user declares its result
  // by hand; never silent (#469 review, #470).
  const poisonedRows = [
    ...disposals.filter((d) => finiteDisposalAmounts(d).excluded).map((d) => `${d.symbol || d.isin} (${formatDateDmy(d.sellDate)})`),
    ...fxDisposals.filter((d) => finiteDisposalAmounts(d).excluded).map((d) => `${d.currency} (${formatDateDmy(d.disposeDate)})`),
  ];
  if (poisonedRows.length > 0) {
    const count = String(poisonedRows.length);
    const rows = poisonedRows.join(", ");
    allMessages.push({
      id: "report.non_finite_disposal",
      severity: "error",
      message: `${count} venta(s) tienen un importe que no es un número (NaN o infinito) o que pasa de 12 cifras enteras en euros: ${rows}. Ese importe no se suma a las casillas. El resto de las operaciones del año sí se suman.`,
      hint: "Si falta el valor de transmisión de una venta, DeclaRenta tampoco suma su valor de adquisición, para no crear una pérdida que nada justifica. Si falta el valor de adquisición, suma el de transmisión. Revisa esas operaciones en el fichero del bróker y en los tipos de cambio, y declara su resultado a mano.",
      context: { count, rows },
    });
  }
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
      antichurningSecurities,
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
