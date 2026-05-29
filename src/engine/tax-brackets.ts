/**
 * Spanish savings-income (base del ahorro) tax brackets, year-parameterized.
 *
 * Single source of truth for the progressive savings-tax scale. Consumers
 * (double-taxation.ts, web/charts.ts) MUST use this module rather than holding
 * their own copy — divergent tables previously produced different tax estimates
 * for the same income (e.g. a stale 28 % top rate in the web charts).
 *
 * Each band's `limit` is the WIDTH of that band, not a cumulative threshold,
 * so the bands are consumed with `Decimal.min(remaining, limit)`.
 *
 * Rate history (tipo del ahorro):
 *  - 2021–2022: 19 / 21 / 23 / 26 (top band > 200 000)
 *  - 2023–2024: 19 / 21 / 23 / 27 / 28 (RDL 13/2022 added 27 % @200k–300k, 28 % >300k)
 *  - 2025+    : 19 / 21 / 23 / 27 / 30 (Ley 7/2024 raised the >300 000 band to 30 %)
 */

import Decimal from "decimal.js";

export interface SavingsBand {
  /** Width of this band in EUR (Infinity for the top band). */
  limit: Decimal;
  /** Marginal rate applied to income falling inside the band. */
  rate: Decimal;
  /** Inclusive lower threshold of the band, for labels/UI. */
  from: number;
  /** Exclusive upper threshold of the band (Infinity for the top band). */
  to: number;
}

function band(from: number, to: number, rate: number): SavingsBand {
  return {
    from,
    to,
    rate: new Decimal(rate),
    limit: to === Infinity ? new Decimal(Infinity) : new Decimal(to - from),
  };
}

const BRACKETS_2021: SavingsBand[] = [
  band(0, 6000, 0.19),
  band(6000, 50000, 0.21),
  band(50000, 200000, 0.23),
  band(200000, Infinity, 0.26),
];

const BRACKETS_2023: SavingsBand[] = [
  band(0, 6000, 0.19),
  band(6000, 50000, 0.21),
  band(50000, 200000, 0.23),
  band(200000, 300000, 0.27),
  band(300000, Infinity, 0.28),
];

const BRACKETS_2025: SavingsBand[] = [
  band(0, 6000, 0.19),
  band(6000, 50000, 0.21),
  band(50000, 200000, 0.23),
  band(200000, 300000, 0.27),
  band(300000, Infinity, 0.30),
];

/**
 * Return the savings-tax bands in force for a given tax year.
 * Years before 2023 use the 2021–2022 scale; 2023–2024 use the transitional
 * scale; 2025 onwards use the current scale.
 */
export function getSavingsBands(year: number): SavingsBand[] {
  if (year >= 2025) return BRACKETS_2025;
  if (year >= 2023) return BRACKETS_2023;
  return BRACKETS_2021;
}

/**
 * Compute the progressive Spanish savings tax on `income` for `year`.
 *
 * @param income - Savings-base income (EUR). Non-positive returns 0.
 * @param year   - Tax year, selects the bracket scale.
 */
export function calculateSavingsTax(income: Decimal, year: number): Decimal {
  let remaining = income;
  let tax = new Decimal(0);

  for (const b of getSavingsBands(year)) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const taxable = Decimal.min(remaining, b.limit);
    tax = tax.plus(taxable.mul(b.rate));
    remaining = remaining.minus(taxable);
  }

  return tax;
}
