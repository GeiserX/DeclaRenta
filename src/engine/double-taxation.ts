/**
 * Double taxation deduction calculator (Art. 80 LIRPF, Casilla 0588).
 *
 * Spain allows a deduction for foreign taxes paid on dividends/interest,
 * limited to the lesser of: the foreign tax actually paid (capped at the
 * relevant double-tax-treaty rate), or the Spanish tax that would have been
 * due on that income.
 */

import Decimal from "decimal.js";
import type { DividendEntry } from "../types/tax.js";
import { calculateSavingsTax } from "./tax-brackets.js";

/**
 * Maximum dividend withholding rate that the source country may levy under
 * its double-tax treaty with Spain. Spain only credits foreign tax UP TO this
 * capped rate; any excess withheld at source is NOT creditable in Spain — it
 * must be reclaimed from the source country's tax authority (devolución del
 * exceso de retención en origen).
 *
 * Most Spanish treaties cap dividend withholding at 15 %, so we use that as a
 * conservative default for all countries and seed the map with explicit
 * entries where useful. The map is intentionally minimal and overridable.
 */
const DEFAULT_TREATY_RATE = new Decimal(0.15);

const TREATY_DIVIDEND_RATES: Record<string, Decimal> = {
  US: new Decimal(0.15),
};

function treatyRate(country: string): Decimal {
  return TREATY_DIVIDEND_RATES[country] ?? DEFAULT_TREATY_RATE;
}

/**
 * Calculate the double taxation deduction per country.
 *
 * For each country, the deduction is the lesser of:
 * - Foreign withholding tax paid, capped at the treaty dividend rate × gross
 * - Spanish tax that would apply to the gross income from that country
 */
export function calculateDoubleTaxation(
  dividends: DividendEntry[],
  year: number,
  totalSavingsBase?: Decimal,
): { total: Decimal; byCountry: Record<string, { taxPaid: Decimal; deductionAllowed: Decimal }>; spanishWithholding: Decimal } {
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
  // The Spanish retención a cuenta (casilla 0597): an ES-issuer dividend's
  // withholding is a domestic pago a cuenta, excluded from the foreign 0588
  // credit below, but it must still be surfaced (it was previously dropped).
  const spanishWithholding = byCountry["ES"]?.taxPaid ?? new Decimal(0);
  const result: Record<string, { taxPaid: Decimal; deductionAllowed: Decimal }> = {};
  const effectiveSavingsRate = totalSavingsBase && totalSavingsBase.greaterThan(0)
    ? calculateSavingsTax(totalSavingsBase, year).dividedBy(totalSavingsBase)
    : undefined;

  for (const [country, data] of Object.entries(byCountry)) {
    // Spain is domestic: any "withholding" on an ES security is a retención a
    // cuenta (paid into the Spanish system), not a foreign tax eligible for the
    // Art. 80 double-taxation deduction. Never count it as a foreign credit.
    if (country === "ES") continue;
    if (data.taxPaid.isZero()) continue;

    const spanishTax = effectiveSavingsRate
      ? data.grossIncome.mul(effectiveSavingsRate)
      : calculateSavingsTax(data.grossIncome, year);

    // Treaty cap: Spain only credits foreign tax up to the treaty dividend
    // rate. Excess withholding is reclaimable at source, not here.
    const creditableForeignTax = Decimal.min(
      data.taxPaid,
      data.grossIncome.mul(treatyRate(country)),
    );

    // Deduction = lesser of creditable foreign tax or Spanish tax due
    const deduction = Decimal.min(creditableForeignTax, spanishTax);

    result[country] = {
      // taxPaid stays the ACTUAL paid amount for display purposes.
      taxPaid: data.taxPaid,
      deductionAllowed: deduction,
    };

    total = total.plus(deduction);
  }

  return { total, byCountry: result, spanishWithholding };
}
