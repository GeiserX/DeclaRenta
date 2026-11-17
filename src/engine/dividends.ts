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

/** The part of one withholding row that belongs to one dividend, in the row's own currency. */
export interface WithholdingPart {
  /** Index into `WithholdingMatch.withholdings`. */
  index: number;
  /** Signed: a withholding is negative, a refund positive. A refund can be split over several dividends. */
  amount: Decimal;
}

export interface WithholdingMatch {
  /** Every dividend and payment in lieu, in file order. */
  dividends: CashTransaction[];
  /** Every withholding row, in file order. */
  withholdings: CashTransaction[];
  /** Per dividend, the index of its pair (passes 1 and 2), or −1. */
  pair: number[];
  /** Per dividend, every withholding part that belongs to it, its pair first. */
  parts: WithholdingPart[][];
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const yearOf = (date: string): string => normalizeDate(date).slice(0, 4);

/**
 * Match every withholding row to the dividend it belongs to (issues #96, #438).
 *
 * IBKR reports dividends and withholding tax as separate CashTransaction
 * entries, matched by ISIN + date proximity (±7 days), preferring a
 * withholding in the dividend's own currency.
 *
 * A dividend's withholding can be several rows (issue #438): a partial refund
 * (−1.50, then +0.50), a reversal and a new withholding on another date (−1.50,
 * +1.50, −1.00), or one payment split in two rows. Every row that belongs to
 * the dividend counts with its sign, so the withholding is the net tax paid.
 * A refund never takes more from a dividend than that dividend withheld: the
 * rest goes to the next dividend it can correct, and only what no dividend in
 * reach withheld is left out. So no refund is lost and no row counts twice.
 */
export function matchWithholdings(cashTransactions: CashTransaction[]): WithholdingMatch {
  const dividends = cashTransactions.filter(
    (t) => t.type === "Dividends" || t.type === "Payment In Lieu Of Dividends",
  );

  const withholdings = cashTransactions.filter((t) => t.type === "Withholding Tax");
  const consumedWithholdings = new Set<number>();
  const amounts = withholdings.map((w) => new Decimal(w.amount));
  // A positive row is a refund or a reversal: it corrects a withholding, it is
  // never one. It may only join a dividend in pass 3, never be its pair, so
  // its absolute value can never count as tax paid.
  const isRefund = amounts.map((a) => a.greaterThan(0));
  // A negative dividend is a reversal of a dividend (issue #438): it paid no
  // tax, so no withholding row ever joins it. A rebooked dividend keeps its own
  // withholding, and the reversal's +X joins the dividend it reverses.
  const isReversal = dividends.map((d) => new Decimal(d.amount).isNegative());
  // A row posted in a later year than its date (IBKR posts a correction in
  // next year's statement, dated on its dividend's day) belongs to a dividend
  // of its own year. Without this, a weekly payer's next dividend, in the new
  // year and within 7 days, would take it.
  const postedLate = withholdings.map((w) => !!w.reportDate && yearOf(w.reportDate) > yearOf(w.dateTime));

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

  /** Row `index` may belong to dividend `divIndex`: within 7 days, not a reversal, same year when posted late. */
  const reaches = (index: number, divIndex: number): boolean =>
    !isReversal[divIndex] &&
    Math.abs(withholdingTimes[index]! - divTimes[divIndex]!) <= SEVEN_DAYS_MS &&
    (!postedLate[index] || yearOf(withholdings[index]!.dateTime) === yearOf(dividends[divIndex]!.dateTime));

  /** First unconsumed, non-refund withholding of the dividend's ISIN within 7 days that passes `accept`. */
  const findWithholding = (divIndex: number, accept: (w: CashTransaction) => boolean): number => {
    const div = dividends[divIndex]!;
    for (const index of withholdingIndexByIsin.get(div.isin) ?? []) {
      if (!consumedWithholdings.has(index) && !isRefund[index] && accept(withholdings[index]!) && reaches(index, divIndex)) {
        return index;
      }
    }
    return -1;
  };

  // Pass 1: same ISIN, same currency, within 7 days, first unconsumed (in
  // dividend order). This is the original matcher, so every broker that books
  // the withholding in the dividend's currency (IBKR, Degiro, ...) pairs
  // exactly as before.
  const pair = dividends.map((div, divIndex) => {
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
    if (pair[divIndex]! >= 0 || !div.isin) return;
    const index = findWithholding(divIndex, (w) => w.currency !== div.currency);
    if (index >= 0) {
      consumedWithholdings.add(index);
      pair[divIndex] = index;
    }
  });

  // Pass 3 (issue #438): every withholding row still unpaired joins a
  // dividend of its ISIN within 7 days whose pair is in the row's currency (the
  // withholding it corrects or adds to). A dividend's withholding so stays in
  // one currency: a stray row in another currency never joins it (issue #96).
  // A dividend with no pair has no tax a row could correct: every unpaired
  // withholding in its reach was already its pair in pass 1 or 2. Rows with no
  // ISIN share the "" bucket, so they also need the same symbol. A row with no
  // dividend in reach stays unpaired, as before.
  const parts: WithholdingPart[][] = pair.map((index) => (index >= 0 ? [{ index, amount: amounts[index]! }] : []));
  // What each dividend withheld so far and no refund took back, in its pair's currency.
  const capacity = pair.map((index) => (index >= 0 ? amounts[index]!.negated() : new Decimal(0)));
  const dividendIndexByIsin = new Map<string, number[]>();
  dividends.forEach((d, divIndex) => {
    const bucket = dividendIndexByIsin.get(d.isin);
    if (bucket) bucket.push(divIndex);
    else dividendIndexByIsin.set(d.isin, [divIndex]);
  });
  const candidates = (index: number): number[] => {
    const w = withholdings[index]!;
    return (dividendIndexByIsin.get(w.isin) ?? []).filter(
      (divIndex) =>
        pair[divIndex]! >= 0 &&
        withholdings[pair[divIndex]!]!.currency === w.currency &&
        (w.isin !== "" || w.symbol === dividends[divIndex]!.symbol) &&
        reaches(index, divIndex),
    );
  };
  const distance = (index: number, divIndex: number) => Math.abs(withholdingTimes[index]! - divTimes[divIndex]!);

  // 3a. Withholdings first (a second row of one payment, a new withholding
  // after a reversal): the nearest dividend, then the first in the file.
  withholdings.forEach((_w, index) => {
    if (consumedWithholdings.has(index) || isRefund[index]) return;
    let best = -1;
    for (const divIndex of candidates(index)) {
      if (best < 0 || distance(index, divIndex) < distance(index, best)) best = divIndex;
    }
    if (best < 0) return;
    consumedWithholdings.add(index);
    parts[best]!.push({ index, amount: amounts[index]! });
    capacity[best] = capacity[best]!.minus(amounts[index]!);
  });

  // 3b. Then refunds, each up to what a dividend still has withheld:
  //   1. a dividend with a withholding of exactly the refunded amount (the
  //      row this one reverses);
  //   2. a dividend that withheld at least the refund;
  //   3. any dividend that still has some withholding; the rest of the
  //      refund goes on to the next one.
  // Then nearest date, then the first dividend in the file.
  withholdings.forEach((_w, index) => {
    if (consumedWithholdings.has(index) || !isRefund[index]) return;
    const reach = candidates(index);
    let rest = amounts[index]!;
    while (rest.greaterThan(0)) {
      const rank = (divIndex: number): number =>
        capacity[divIndex]!.greaterThanOrEqualTo(rest)
          ? parts[divIndex]!.some((p) => p.amount.equals(rest.negated())) ? 1 : 2
          : 3;
      let best = -1;
      for (const divIndex of reach) {
        if (!capacity[divIndex]!.greaterThan(0)) continue;
        if (
          best < 0 ||
          rank(divIndex) < rank(best) ||
          (rank(divIndex) === rank(best) && distance(index, divIndex) < distance(index, best))
        ) {
          best = divIndex;
        }
      }
      if (best < 0) break;
      const take = Decimal.min(rest, capacity[best]!);
      parts[best]!.push({ index, amount: take });
      capacity[best] = capacity[best]!.minus(take);
      rest = rest.minus(take);
      consumedWithholdings.add(index);
    }
  });

  return { dividends, withholdings, pair, parts };
}

/**
 * Process IBKR cash transactions to extract dividends with withholdings.
 * Each dividend's withholding is the net of the parts `matchWithholdings`
 * gives it, valued in EUR.
 */
export function calculateDividends(
  cashTransactions: CashTransaction[],
  rateMap: EcbRateMap,
  options?: DividendValuationOptions,
): DividendEntry[] {
  const { dividends, withholdings, pair, parts } = matchWithholdings(cashTransactions);

  const lookup = (date: string, currency: string): Decimal | null =>
    options?.lookupRate ? options.lookupRate(date, currency) : getEcbRate(rateMap, date, currency);

  const entries: DividendEntry[] = [];
  dividends.forEach((div, divIndex) => {
    const ecbRate = lookup(normalizeDate(div.dateTime), div.currency);
    const grossAmount = new Decimal(div.amount);
    const matching = pair[divIndex]! >= 0 ? withholdings[pair[divIndex]!] : undefined;
    // Each withholding row is valued in ITS OWN currency: the dividend's rate
    // when the currencies match (unchanged), else its own rate on its own date
    // (an EUR withholding is 1:1, never multiplied by the USD rate).
    const partRates = parts[divIndex]!.map(({ index }) => {
      const w = withholdings[index]!;
      return w.currency === div.currency ? ecbRate : lookup(normalizeDate(w.dateTime), w.currency);
    });
    if (ecbRate === null || partRates.some((r) => r === null)) {
      // No rate: skip the dividend. Its withholdings stay matched so they
      // can't pair with another dividend.
      options?.onUnvalued?.(div);
      return;
    }

    // Net tax paid, in EUR: withheld rows are negative, refunds positive. A
    // refund never takes more than the dividend withheld in its currency, so
    // the net is only positive when one currency's rates differ by date (an
    // own-date rate); that counts as no tax, never as negative tax.
    const netEur = parts[divIndex]!.reduce((sum, p, i) => sum.plus(p.amount.mul(partRates[i]!)), new Decimal(0));
    const withholdingTaxEur = netEur.isNegative() ? netEur.negated() : new Decimal(0);

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
    const countryMatch = div.description.match(COUNTRY_MARKER) ?? matching?.description.match(COUNTRY_MARKER);
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
