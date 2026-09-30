/**
 * Taxable-base breakdown for the web "tax estimate" chart.
 *
 * The Renta results page shows an *indicative* savings-base figure and a
 * per-bracket breakdown in `renderTaxBracketCard` (web/charts.ts). This module
 * is the single source of truth for the arithmetic behind that figure, kept in
 * `decimal.js` so the money math never round-trips through a lossy JS `Number`
 * (DeclaRenta's hard rule). The chart API still wants plain numbers, so we
 * convert to `Number` only at the very end.
 *
 * This is the PRESENTATION figure for the chart. It applies the SAME
 * anti-churning adjustment the engine uses for `totalSavingsBase`: the
 * proportionally-blocked loss is added back (deferred, not deductible now) and
 * the reintegrated prior deferred loss is subtracted (now deductible).
 *
 * The savings base has two Art. 49 LIRPF buckets: gains/losses (capital gains
 * + FX) and capital income (dividends + interest). A negative balance in one
 * bucket offsets at most 25% of the other's positive balance in the same year,
 * then each bucket is clamped at zero. The CLI's `--prior-losses` step reads the
 * same two balances through {@link savingsBalances}.
 */

import Decimal from "decimal.js";
import { offsetCurrentYearLosses } from "./loss-carryforward.js";

/**
 * The five components feeding the displayed taxable base, as plain numbers
 * (the chart's `TaxBaseBreakdown` shape lives in web/charts.ts; we mirror its
 * fields here without importing the web layer into the engine).
 */
export interface TaxableBaseBreakdown {
  capitalGains: number;
  fxGains: number;
  dividends: number;
  interest: number;
  blockedLosses: number;
}

/** Result of {@link computeTaxableBaseBreakdown}: the breakdown plus the clamped base. */
export interface TaxableBaseResult {
  breakdown: TaxableBaseBreakdown;
  taxableBase: number;
}

/**
 * The slice of a `TaxSummary` this helper reads. Typed structurally (not by
 * importing `TaxSummary`) so the helper stays a small pure function with a
 * minimal surface.
 */
export interface TaxableBaseReport {
  capitalGains: { netGainLoss: Decimal; blockedLosses: Decimal; reintegratedLosses: Decimal };
  fxGains: { netGainLoss: Decimal };
  dividends: { grossIncome: Decimal };
  interest: { earned: Decimal };
}

/**
 * The two Art. 49 LIRPF savings balances of a report, before any compensation:
 * - `gains`: capital gains + blocked losses − reintegrated losses + FX
 *   (the fiscal figure, not the raw `netGainLoss`: a blocked loss is deferred).
 * - `income`: gross dividends + interest earned.
 */
export function savingsBalances(report: TaxableBaseReport): { gains: Decimal; income: Decimal } {
  return {
    gains: report.capitalGains.netGainLoss
      .plus(report.capitalGains.blockedLosses)
      .minus(report.capitalGains.reintegratedLosses)
      .plus(report.fxGains.netGainLoss),
    income: report.dividends.grossIncome.plus(report.interest.earned),
  };
}

/**
 * Compute the displayed taxable-base breakdown and clamped total for the tax
 * estimate chart.
 *
 * Arithmetic (in Decimal):
 * - `breakdown` carries each component (capital gains, FX gains, gross
 *   dividends, interest earned, and wash-sale `blockedLosses` added back so
 *   deferred losses don't reduce the base).
 * - `taxableBase` = the two {@link savingsBalances} after the same-year 25%
 *   cross-offset, each clamped at zero, summed.
 */
export function computeTaxableBaseBreakdown(report: TaxableBaseReport): TaxableBaseResult {
  const capitalGains = report.capitalGains.netGainLoss;
  const fxGains = report.fxGains.netGainLoss;
  const dividends = report.dividends.grossIncome;
  const interest = report.interest.earned;
  const blockedLosses = report.capitalGains.blockedLosses;

  const { gains, income } = savingsBalances(report);
  const offset = offsetCurrentYearLosses(gains, income);
  const clamped = Decimal.max(0, offset.gains).plus(Decimal.max(0, offset.income));

  return {
    breakdown: {
      capitalGains: capitalGains.toNumber(),
      fxGains: fxGains.toNumber(),
      dividends: dividends.toNumber(),
      interest: interest.toNumber(),
      blockedLosses: blockedLosses.toNumber(),
    },
    taxableBase: clamped.toNumber(),
  };
}
