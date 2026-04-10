/**
 * Double taxation deduction calculator (Art. 80 LIRPF, Casilla 0588).
 *
 * Spain allows a deduction for foreign taxes paid on dividends/interest,
 * limited to the lesser of: the foreign tax actually paid, or the Spanish
 * tax that would have been due on that income.
 */

import Decimal from "decimal.js";
import type { DividendEntry } from "../types/tax.js";

/** Spanish savings tax brackets for 2025 */
const SAVINGS_TAX_BRACKETS = [
  { limit: new Decimal(6000), rate: new Decimal(0.19) },
  { limit: new Decimal(44000), rate: new Decimal(0.21) },
  { limit: new Decimal(150000), rate: new Decimal(0.23) },
  { limit: new Decimal(100000), rate: new Decimal(0.27) },
  { limit: new Decimal(Infinity), rate: new Decimal(0.30) },
];

/**
 * Calculate the double taxation deduction per country.
 *
 * For each country, the deduction is the lesser of:
 * - Total foreign withholding tax paid to that country
 * - Spanish tax that would apply to the gross income from that country
 */
export function calculateDoubleTaxation(
  dividends: DividendEntry[],
): { total: Decimal; byCountry: Record<string, { taxPaid: Decimal; deductionAllowed: Decimal }> } {
  const byCountry: Record<string, { grossIncome: Decimal; taxPaid: Decimal }> = {};

  for (const div of dividends) {
    const country = div.withholdingCountry;
    if (!byCountry[country]) {
      byCountry[country] = { grossIncome: new Decimal(0), taxPaid: new Decimal(0) };
    }
    byCountry[country].grossIncome = byCountry[country].grossIncome.plus(div.grossAmountEur);
    byCountry[country].taxPaid = byCountry[country].taxPaid.plus(div.withholdingTaxEur);
  }

  let total = new Decimal(0);
  const result: Record<string, { taxPaid: Decimal; deductionAllowed: Decimal }> = {};

  for (const [country, data] of Object.entries(byCountry)) {
    if (data.taxPaid.isZero()) continue;

    // Calculate Spanish tax on this income using marginal savings rate
    const spanishTax = calculateSavingsTax(data.grossIncome);

    // Deduction = lesser of foreign tax paid or Spanish tax due
    const deduction = Decimal.min(data.taxPaid, spanishTax);

    result[country] = {
      taxPaid: data.taxPaid,
      deductionAllowed: deduction,
    };

    total = total.plus(deduction);
  }

  return { total, byCountry: result };
}

function calculateSavingsTax(income: Decimal): Decimal {
  let remaining = income;
  let tax = new Decimal(0);

  for (const bracket of SAVINGS_TAX_BRACKETS) {
    if (remaining.lessThanOrEqualTo(0)) break;

    const taxable = Decimal.min(remaining, bracket.limit);
    tax = tax.plus(taxable.mul(bracket.rate));
    remaining = remaining.minus(taxable);
  }

  return tax;
}
