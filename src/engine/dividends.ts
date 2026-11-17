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

/**
 * The country of a dividend's withholding (or of a withholding row on its own,
 * with no pair). Precedence:
 *  1. Explicit "XX Tax" / "XX WHT" marker in the row's description.
 *  2. The same marker in the paired withholding's description (IBKR writes
 *     "AAPL(US0378331005) Cash Dividend ... - US Tax").
 *  3. The ISIN issuer-country prefix (first 2 letters). Best signal for
 *     brokers like Flatex whose German descriptions carry no country marker
 *     — without it every Flatex dividend would fall through to "XX". ES →
 *     domestic, so it stays out of the foreign double-taxation pool
 *     (Casilla 0588) and goes to Casilla 0597 (double-taxation.ts).
 */
export function withholdingCountry(row: CashTransaction, pair?: CashTransaction): string {
  const isinPrefix = /^[A-Z]{2}/.test(row.isin) ? row.isin.slice(0, 2) : "";
  const countryMatch = row.description.match(COUNTRY_MARKER) ?? pair?.description.match(COUNTRY_MARKER);
  return countryMatch?.[1] ?? (isinPrefix || "XX");
}

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
/** Both rows come from one broker, or one of them names none (a single-broker file). */
const sameBroker = (a: CashTransaction, b: CashTransaction): boolean =>
  !a.brokerSource || !b.brokerSource || a.brokerSource === b.brokerSource;

/**
 * Match every withholding row to the dividend it belongs to (issues #96, #438).
 *
 * IBKR reports dividends and withholding tax as separate CashTransaction
 * entries, matched by ISIN + date proximity (±7 days) at the same broker,
 * preferring a withholding in the dividend's own currency. A row or dividend
 * with no broker name (a single-broker file) matches any broker.
 *
 * A dividend's withholding can be several rows (issue #438): a partial refund
 * (−1.50, then +0.50), a reversal and a new withholding on another date (−1.50,
 * +1.50, −1.00), or one payment split in two rows. Every row that belongs to
 * the dividend counts with its sign, so the withholding is the net tax paid.
 * A refund never takes more from a dividend than that dividend withheld: the
 * rest goes to the next dividend it can correct, and only what no dividend in
 * reach withheld is left out. So no refund is lost and no row counts twice.
 */
export function matchWithholdings(
  cashTransactions: CashTransaction[],
  /**
   * Dividends that take no withholding, as if they were not in the rows (a
   * dividend `collapseCorrections` cancels against its reversal). They stay
   * in `dividends`, with no parts, so a caller can still find them.
   */
  cancelledDividends?: ReadonlySet<CashTransaction>,
): WithholdingMatch {
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
  const isReversal = dividends.map((d) => new Decimal(d.amount).isNegative() || !!cancelledDividends?.has(d));
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

  /**
   * First unconsumed, non-refund withholding of the dividend's ISIN and broker
   * within 7 days that passes `accept`. In a merged upload another broker's
   * row listed first never becomes the pair, so pass 3 (which keeps each row
   * at its own broker) finds every dividend paired with its own tax.
   */
  const findWithholding = (divIndex: number, accept: (w: CashTransaction) => boolean): number => {
    const div = dividends[divIndex]!;
    for (const index of withholdingIndexByIsin.get(div.isin) ?? []) {
      const w = withholdings[index]!;
      if (!consumedWithholdings.has(index) && !isRefund[index] && sameBroker(w, div) && accept(w) && reaches(index, divIndex)) {
        return index;
      }
    }
    return -1;
  };

  // Pass 1: same ISIN, same currency, same broker, within 7 days, first
  // unconsumed (in dividend order). In a single-broker file this is the
  // original matcher, so every broker that books the withholding in the
  // dividend's currency (IBKR, Degiro, ...) pairs exactly as before. Rows with
  // no ISIN share the "" bucket, so they also need the same symbol.
  const pair = dividends.map((div, divIndex) => {
    const index = findWithholding(divIndex, (w) => w.currency === div.currency && (div.isin !== "" || w.symbol === div.symbol));
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
  // ISIN share the "" bucket, so they also need the same symbol. A row
  // corrects only a dividend of its own broker: a refund at one broker never
  // goes to another broker's nearer dividend of the same ISIN (a row with no
  // broker name, as in a single-broker file, joins any). A row with no
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
        sameBroker(w, dividends[divIndex]!) &&
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
  // Then nearest date, then the first dividend in the file. When every
  // dividend in a refund's reach is full, an earlier refund that can go to
  // another dividend in its own reach moves there to make room, so a refund
  // is only left out when no allocation could fit it.
  const reachOf = new Map<number, number[]>();
  const reach = (index: number): number[] => {
    let r = reachOf.get(index);
    if (!r) reachOf.set(index, (r = candidates(index)));
    return r;
  };
  /** Per refund, what it gave each dividend. */
  const given = new Map<number, Map<number, Decimal>>();
  const give = (index: number, divIndex: number, amount: Decimal): void => {
    let byDividend = given.get(index);
    if (!byDividend) given.set(index, (byDividend = new Map<number, Decimal>()));
    const total = (byDividend.get(divIndex) ?? new Decimal(0)).plus(amount);
    if (total.isZero()) byDividend.delete(divIndex);
    else byDividend.set(divIndex, total);
    capacity[divIndex] = capacity[divIndex]!.minus(amount);
  };
  /**
   * Free room for refund `index` by moving earlier refunds along a chain of
   * dividends (shortest first) to one that still has capacity. Gives the
   * refund what the chain frees, up to `rest`, and returns it (0 when no chain
   * exists). Every move stays within the moved refund's own reach.
   */
  const makeRoom = (index: number, rest: Decimal): Decimal => {
    // How a dividend was reached: the refund that would move onto it, and the
    // dividend that refund leaves (−1 for refund `index` itself).
    const via = new Map<number, [number, number]>();
    const queue: number[] = [];
    for (const divIndex of reach(index)) {
      via.set(divIndex, [index, -1]);
      queue.push(divIndex);
    }
    for (let q = 0; q < queue.length; q++) {
      const at = queue[q]!;
      if (capacity[at]!.greaterThan(0)) {
        let amount = Decimal.min(rest, capacity[at]!);
        for (let d = at; via.get(d)![1] >= 0; d = via.get(d)![1]) {
          const [moved, from] = via.get(d)!;
          amount = Decimal.min(amount, given.get(moved)!.get(from)!);
        }
        for (let d = at; d >= 0; ) {
          const [moved, from] = via.get(d)!;
          give(moved, d, amount);
          if (from >= 0) give(moved, from, amount.negated());
          d = from;
        }
        return amount;
      }
      for (const [moved, byDividend] of given) {
        if (moved === index || !byDividend.get(at)?.greaterThan(0)) continue;
        for (const next of reach(moved)) {
          if (via.has(next)) continue;
          via.set(next, [moved, at]);
          queue.push(next);
        }
      }
    }
    return new Decimal(0);
  };
  const refunds: number[] = [];
  withholdings.forEach((_w, index) => {
    if (consumedWithholdings.has(index) || !isRefund[index]) return;
    refunds.push(index);
    let rest = amounts[index]!;
    while (rest.greaterThan(0)) {
      const rank = (divIndex: number): number =>
        capacity[divIndex]!.greaterThanOrEqualTo(rest)
          ? parts[divIndex]!.some((p) => p.amount.equals(rest.negated())) ? 1 : 2
          : 3;
      let best = -1;
      for (const divIndex of reach(index)) {
        if (!capacity[divIndex]!.greaterThan(0)) continue;
        if (
          best < 0 ||
          rank(divIndex) < rank(best) ||
          (rank(divIndex) === rank(best) && distance(index, divIndex) < distance(index, best))
        ) {
          best = divIndex;
        }
      }
      const take = best >= 0 ? Decimal.min(rest, capacity[best]!) : makeRoom(index, rest);
      if (take.isZero()) break;
      if (best >= 0) give(index, best, take);
      rest = rest.minus(take);
    }
  });
  // A refund's parts follow the withholdings, in file order.
  for (const index of refunds) {
    for (const [divIndex, amount] of given.get(index) ?? []) parts[divIndex]!.push({ index, amount });
  }

  return { dividends, withholdings, pair, parts };
}

/**
 * A dividend's withholding in EUR: the net of the parts `matchWithholdings`
 * gave it, each row at the dividend's rate (`divRate`) when it is in the
 * dividend's currency, else at its own rate on its own date (an EUR
 * withholding is 1:1, never multiplied by the USD rate). Null when a part has
 * no rate. A refund never takes more than the dividend withheld in its
 * currency, so the net is only positive when one currency's rates differ by
 * date (an own-date rate); that counts as no tax, never as negative tax.
 */
export function withholdingEur(
  match: WithholdingMatch,
  divIndex: number,
  divRate: Decimal,
  lookup: (date: string, currency: string) => Decimal | null,
): Decimal | null {
  const div = match.dividends[divIndex]!;
  let netEur = new Decimal(0);
  for (const { index, amount } of match.parts[divIndex]!) {
    const w = match.withholdings[index]!;
    const rate = w.currency === div.currency ? divRate : lookup(normalizeDate(w.dateTime), w.currency);
    if (rate === null) return null;
    netEur = netEur.plus(amount.mul(rate));
  }
  return netEur.isNegative() ? netEur.negated() : new Decimal(0);
}

/**
 * Process IBKR cash transactions to extract dividends with withholdings.
 * Each dividend's withholding is the net of the parts `matchWithholdings`
 * gives it, valued in EUR by `withholdingEur`.
 */
export function calculateDividends(
  cashTransactions: CashTransaction[],
  rateMap: EcbRateMap,
  options?: DividendValuationOptions,
): DividendEntry[] {
  const match = matchWithholdings(cashTransactions);
  const { dividends, withholdings, pair } = match;

  const lookup = (date: string, currency: string): Decimal | null =>
    options?.lookupRate ? options.lookupRate(date, currency) : getEcbRate(rateMap, date, currency);

  const entries: DividendEntry[] = [];
  dividends.forEach((div, divIndex) => {
    const ecbRate = lookup(normalizeDate(div.dateTime), div.currency);
    const grossAmount = new Decimal(div.amount);
    const matching = pair[divIndex]! >= 0 ? withholdings[pair[divIndex]!] : undefined;
    const withholdingTaxEur = ecbRate === null ? null : withholdingEur(match, divIndex, ecbRate, lookup);
    if (ecbRate === null || withholdingTaxEur === null) {
      // No rate: skip the dividend. Its withholdings stay matched so they
      // can't pair with another dividend.
      options?.onUnvalued?.(div);
      return;
    }

    const country = withholdingCountry(div, matching);

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
