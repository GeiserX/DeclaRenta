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
import { normalizeDate, parseDate } from "./dates.js";

/**
 * A 2-letter country code written right before "Tax"/"WHT" ("- US Tax",
 * "DK TAX", "IE WHT"). Case-sensitive on the code so a bare ticker such as
 * "ES" (Eversource) or "DE" (Deere) elsewhere in the text never counts.
 */
const COUNTRY_MARKER = /\b([A-Z]{2})\s+(?:Tax|TAX|WHT)\b/;

export interface DividendValuationOptions {
  /**
   * Non-throwing EUR-per-unit lookup. When given, it replaces the ECB lookup,
   * and a dividend it cannot value (null) is left out together with its
   * matched withholding and passed to `onUnvalued`, instead of throwing. The
   * same happens when its withholding is in another currency that the lookup
   * cannot value.
   */
  lookupRate?: (date: string, currency: string) => Decimal | null;
  onUnvalued?: (dividend: CashTransaction) => void;
}

/**
 * Process IBKR cash transactions to extract dividends with withholdings.
 *
 * IBKR reports dividends and withholding tax as separate CashTransaction
 * entries. This function matches them by ISIN + date proximity, preferring a
 * withholding in the dividend's own currency.
 *
 * A dividend's withholding can be several rows (issue #438): a partial refund
 * (−1.50, then +0.50), a reversal and a new withholding on another date (−1.50,
 * +1.50, −1.00), or one payment split in two rows. Every row that belongs to
 * the dividend counts with its sign, so the withholding is the net tax paid.
 */
export function calculateDividends(
  cashTransactions: CashTransaction[],
  rateMap: EcbRateMap,
  options?: DividendValuationOptions,
): DividendEntry[] {
  const dividends = cashTransactions.filter(
    (t) => t.type === "Dividends" || t.type === "Payment In Lieu Of Dividends",
  );

  const withholdings = cashTransactions.filter((t) => t.type === "Withholding Tax");
  const consumedWithholdings = new Set<number>();
  // A positive row is a refund or a reversal: it corrects a withholding, it is
  // never one. It may only join a dividend in pass 3, never be its anchor, so
  // its absolute value can never count as tax paid.
  const isRefund = withholdings.map((w) => new Decimal(w.amount).greaterThan(0));

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  // Parse each withholding date ONCE and index by ISIN. Original indices are
  // appended in ascending order, so scanning a bucket front-to-back and taking
  // the first unconsumed one reproduces the lowest-index tie-break.
  const withholdingTimes = withholdings.map((w) => parseDate(normalizeDate(w.dateTime)).getTime());
  const withholdingIndexByIsin = new Map<string, number[]>();
  withholdings.forEach((w, index) => {
    const bucket = withholdingIndexByIsin.get(w.isin);
    if (bucket) bucket.push(index);
    else withholdingIndexByIsin.set(w.isin, [index]);
  });
  const divTimes = dividends.map((d) => parseDate(normalizeDate(d.dateTime)).getTime());

  /** First unconsumed, non-refund withholding of the dividend's ISIN within 7 days that passes `accept`. */
  const findWithholding = (divIndex: number, accept: (w: CashTransaction) => boolean): number => {
    const div = dividends[divIndex]!;
    const divTime = divTimes[divIndex]!;
    for (const index of withholdingIndexByIsin.get(div.isin) ?? []) {
      if (
        !consumedWithholdings.has(index) &&
        !isRefund[index] &&
        accept(withholdings[index]!) &&
        Math.abs(withholdingTimes[index]! - divTime) <= SEVEN_DAYS_MS
      ) {
        return index;
      }
    }
    return -1;
  };

  // Pass 1: same ISIN, same currency, within 7 days, first unconsumed (in
  // dividend order). This is the original matcher, so every broker that books
  // the withholding in the dividend's currency (IBKR, Degiro, ...) pairs
  // exactly as before.
  const matchIndexByDividend = dividends.map((div, divIndex) => {
    const index = findWithholding(divIndex, (w) => w.currency === div.currency);
    if (index >= 0) consumedWithholdings.add(index);
    return index;
  });
  // Pass 2: a dividend still unpaired takes a withholding of the same ISIN in
  // ANOTHER currency (issue #96). An EUR-only broker such as Trade Republic
  // keeps a US dividend in USD but books its withholding in EUR, so the
  // same-currency matcher never paired them and Casilla 0588 came out 0. This
  // runs after pass 1 so it can only take withholdings no same-currency
  // dividend claimed. Needs a real ISIN: rows without one share the "" bucket.
  dividends.forEach((div, divIndex) => {
    if (matchIndexByDividend[divIndex]! >= 0 || !div.isin) return;
    const index = findWithholding(divIndex, (w) => w.currency !== div.currency);
    if (index >= 0) {
      consumedWithholdings.add(index);
      matchIndexByDividend[divIndex] = index;
    }
  });

  // Pass 3 (issue #438): every withholding row still unpaired joins ONE
  // dividend of its ISIN within 7 days, so a correction or a second row of the
  // same payment counts once, with its sign. A dividend's withholding stays in
  // one currency: a dividend paired in pass 1/2 takes only rows in the currency
  // of that withholding, so a stray row in another currency never joins it
  // (issue #96). Preference, then nearest date, then the first dividend in the
  // file:
  //   1. a dividend whose pass-1/2 withholding is in the row's currency (the
  //      withholding this row corrects);
  //   2. an unpaired dividend in the row's currency;
  //   3. an unpaired dividend in another currency (a real ISIN only, as in pass 2).
  // Rows with no ISIN share the "" bucket, so they also need the same symbol.
  // A row with no dividend in reach stays unpaired, as before.
  const extraIndicesByDividend: number[][] = dividends.map(() => []);
  const dividendIndexByIsin = new Map<string, number[]>();
  dividends.forEach((d, divIndex) => {
    const bucket = dividendIndexByIsin.get(d.isin);
    if (bucket) bucket.push(divIndex);
    else dividendIndexByIsin.set(d.isin, [divIndex]);
  });
  withholdings.forEach((w, index) => {
    if (consumedWithholdings.has(index)) return;
    let best = -1;
    let bestRank = Infinity;
    let bestDistance = Infinity;
    for (const divIndex of dividendIndexByIsin.get(w.isin) ?? []) {
      const div = dividends[divIndex]!;
      const distance = Math.abs(withholdingTimes[index]! - divTimes[divIndex]!);
      if (distance > SEVEN_DAYS_MS) continue;
      if (!w.isin && w.symbol !== div.symbol) continue;
      const anchor = matchIndexByDividend[divIndex]!;
      const rank =
        anchor >= 0 ? (withholdings[anchor]!.currency === w.currency ? 1 : Infinity)
        : div.currency === w.currency ? 2
        : w.isin ? 3
        : Infinity;
      if (rank < bestRank || (rank === bestRank && distance < bestDistance)) {
        best = divIndex;
        bestRank = rank;
        bestDistance = distance;
      }
    }
    if (best >= 0 && bestRank !== Infinity) {
      consumedWithholdings.add(index);
      extraIndicesByDividend[best]!.push(index);
    }
  });

  const lookup = (date: string, currency: string): Decimal | null =>
    options?.lookupRate ? options.lookupRate(date, currency) : getEcbRate(rateMap, date, currency);

  const entries: DividendEntry[] = [];
  dividends.forEach((div, divIndex) => {
    const ecbRate = lookup(normalizeDate(div.dateTime), div.currency);
    const grossAmount = new Decimal(div.amount);
    const matchingIndex = matchIndexByDividend[divIndex]!;
    const matching = matchingIndex >= 0 ? withholdings[matchingIndex] : undefined;
    const rows = [...(matching ? [matching] : []), ...extraIndicesByDividend[divIndex]!.map((i) => withholdings[i]!)];
    // Each withholding row is valued in ITS OWN currency: the dividend's rate
    // when the currencies match (unchanged), else its own rate on its own date
    // (an EUR withholding is 1:1, never multiplied by the USD rate).
    const rowRates = rows.map((w) =>
      w.currency === div.currency ? ecbRate : lookup(normalizeDate(w.dateTime), w.currency),
    );
    if (ecbRate === null || rowRates.some((r) => r === null)) {
      // No rate: skip the dividend. Its withholdings stay consumed so they
      // can't pair with another dividend.
      options?.onUnvalued?.(div);
      return;
    }

    // Net tax paid, in EUR: withheld rows are negative, refunds positive. A net
    // refund (its withholding is not in the data) counts as no tax, never as tax.
    const netEur = rows.reduce((sum, w, i) => sum.plus(new Decimal(w.amount).mul(rowRates[i]!)), new Decimal(0));
    const withholdingTaxEur = netEur.isNegative() ? netEur.negated() : new Decimal(0);
    const countryRow = matching ?? rows[0];

    // Country precedence:
    //  1. Explicit "XX Tax" / "XX WHT" marker in the dividend description.
    //  2. The same marker in the matched withholding description (IBKR writes
    //     "AAPL(US0378331005) Cash Dividend ... - US Tax").
    //  3. The ISIN issuer-country prefix (first 2 letters). Best signal for
    //     brokers like Flatex whose German descriptions carry no country marker
    //     — without it every Flatex dividend would fall through to "XX". ES →
    //     domestic, so it stays out of the foreign double-taxation pool
    //     (Casilla 0588); its zero withholding is skipped in double-taxation.ts.
    const isinPrefix = /^[A-Z]{2}/.test(div.isin) ? div.isin.slice(0, 2) : "";
    const countryMatch = div.description.match(COUNTRY_MARKER) ?? countryRow?.description.match(COUNTRY_MARKER);
    const country = countryMatch?.[1] ?? (isinPrefix || "XX");

    entries.push({
      isin: div.isin,
      symbol: div.symbol,
      description: div.description,
      payDate: normalizeDate(div.dateTime),
      grossAmountEur: grossAmount.mul(ecbRate),
      withholdingTaxEur,
      withholdingCountry: country,
      currency: div.currency,
      ecbRate,
    });
  });
  return entries;
}
