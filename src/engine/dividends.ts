/**
 * Dividend and withholding tax processor.
 *
 * Groups dividends with their corresponding withholding tax entries
 * and converts to EUR using ECB official rates.
 */

import Decimal from "decimal.js";
import type { CashTransaction } from "../types/ibkr.js";
import type { DividendEntry } from "../types/tax.js";
import type { EcbRateMap } from "../types/ecb.js";
import { getEcbRate } from "./ecb.js";

/**
 * Process IBKR cash transactions to extract dividends with withholdings.
 *
 * IBKR reports dividends and withholding tax as separate CashTransaction
 * entries. This function matches them by ISIN + date proximity.
 */
export function calculateDividends(
  cashTransactions: CashTransaction[],
  rateMap: EcbRateMap,
): DividendEntry[] {
  const dividends = cashTransactions.filter(
    (t) => t.type === "Dividends" || t.type === "Payment In Lieu Of Dividends",
  );

  const withholdings = cashTransactions.filter((t) => t.type === "Withholding Tax");

  return dividends.map((div) => {
    const ecbRate = getEcbRate(rateMap, div.dateTime.slice(0, 10), div.currency);
    const grossAmount = new Decimal(div.amount);

    // Find matching withholding (same ISIN, same or close date)
    const matching = withholdings.find(
      (w) =>
        w.isin === div.isin &&
        w.currency === div.currency &&
        Math.abs(
          new Date(w.dateTime.slice(0, 10)).getTime() - new Date(div.dateTime.slice(0, 10)).getTime(),
        ) <= 7 * 24 * 60 * 60 * 1000, // Within 7 days
    );

    const withholdingAmount = matching ? new Decimal(matching.amount).abs() : new Decimal(0);

    // Extract country from description (e.g. "US Tax" -> "US")
    const countryMatch = div.description.match(/\b([A-Z]{2})\b.*(?:Tax|WHT)/i) ??
      matching?.description.match(/\b([A-Z]{2})\b/);
    const country = countryMatch?.[1] ?? "XX";

    return {
      isin: div.isin,
      symbol: div.symbol,
      description: div.description,
      payDate: div.dateTime.slice(0, 10),
      grossAmountEur: grossAmount.mul(ecbRate),
      withholdingTaxEur: withholdingAmount.mul(ecbRate),
      withholdingCountry: country,
      currency: div.currency,
      ecbRate,
    };
  });
}
