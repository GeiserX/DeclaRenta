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
 * the reintegrated prior deferred loss is subtracted (now deductible). The chart
 * clamps the WHOLE sum at zero, while the engine clamps each savings bucket
 * separately — so the two can still differ for a taxpayer with a net loss in one
 * bucket, but they now agree on the anti-churning treatment (no more silent
 * blocked-loss divergence).
 */

import Decimal from "decimal.js";

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
 * Compute the displayed taxable-base breakdown and clamped total for the tax
 * estimate chart.
 *
 * Arithmetic (verbatim move of the previous inline web math, now in Decimal):
 * - `breakdown` carries each component (capital gains, FX gains, gross
 *   dividends, interest earned, and wash-sale `blockedLosses` added back so
 *   deferred losses don't reduce the base).
 * - `taxableBase` = max(0, capitalGains + blockedLosses + fxGains + dividends
 *   + interest) — the whole sum clamped at zero, matching the chart's prior
 *   behavior.
 */
export function computeTaxableBaseBreakdown(report: TaxableBaseReport): TaxableBaseResult {
  const capitalGains = report.capitalGains.netGainLoss;
  const fxGains = report.fxGains.netGainLoss;
  const dividends = report.dividends.grossIncome;
  const interest = report.interest.earned;
  const blockedLosses = report.capitalGains.blockedLosses;
  const reintegratedLosses = report.capitalGains.reintegratedLosses;

  const sum = capitalGains
    .plus(blockedLosses)
    .minus(reintegratedLosses)
    .plus(fxGains)
    .plus(dividends)
    .plus(interest);
  const clamped = Decimal.max(0, sum);

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
