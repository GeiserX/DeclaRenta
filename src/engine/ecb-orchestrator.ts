/**
 * ECB rate-map orchestration.
 *
 * Both the CLI (`src/cli/index.ts`) and the web UI (`src/web/main.ts`) need the
 * exact same dance before they can value anything: figure out which currencies
 * and which years a parsed statement touches, fetch the official ECB daily rates
 * for each (year) batch via `fetchEcbRates`, and merge every batch into one
 * unified `EcbRateMap`. This module is the single source of truth for that
 * orchestration so the two call sites can never drift apart.
 *
 * It also memoizes per-(currency, year) so a re-run for the same — or a
 * superset of — needs reuses the already-fetched rates of past years instead of
 * doing a second network round-trip. The web reprocesses on every option toggle
 * (monodivisa, titulares, …); without this it refetched every rate each time.
 * The current year is never cached: the ECB adds a rate every business day, so
 * its batch is still growing.
 */

import type { Statement } from "../types/broker.js";
import type { EcbRateMap } from "../types/ecb.js";
import type { ManualOpeningLot } from "../types/tax.js";
import { fetchEcbRates, normalizeCurrency } from "./ecb.js";
import { normalizeDate } from "./dates.js";
import { FxFifoEngine } from "./fx-fifo.js";

/**
 * The set of (currency, year) pairs a statement needs ECB rates for.
 *
 * `currencies` is already EUR-stripped (EUR needs no rate). `years` includes
 * the declaration year and the year before every year in the set, so the 10-day
 * weekend/holiday lookback can reach late-December rates for early-January
 * transactions.
 */
export interface EcbNeeds {
  currencies: string[];
  years: number[];
}

/** Signature of the rate fetcher — injectable so tests need no real network. */
export type EcbFetcher = (year: number, currencies: string[]) => Promise<EcbRateMap>;

/** Options for {@link buildEcbRateMap}. */
export interface BuildEcbRateMapOptions {
  /**
   * Override the fetcher (tests inject a fake; production uses {@link fetchEcbRates}).
   */
  fetcher?: EcbFetcher;
  /**
   * Skip the module-level memoization cache (read AND write). Use for a
   * logically-distinct run that must not share or pollute the global cache.
   * Defaults to `false` — past years' ECB rates never change, so caching them
   * across runs is correct and saves network round-trips.
   */
  noCache?: boolean;
}

/**
 * Module-level cache of fetched per-(currency, year) rate batches.
 *
 * Keyed by `${year}:${normalizedCurrency}` so a superset request only fetches
 * the missing pairs (we cache the per-pair result, not the whole map). The
 * cached value is the slice of the rate map containing only that currency's
 * observations for that year. Past years' rates never change, so entries live
 * for the process lifetime. The current (and any later) year is neither read
 * from nor written to it, because its batch grows every business day.
 */
const rateCache = new Map<string, EcbRateMap>();

/** Cache key for one (currency, year) pair. Currency is normalized (stablecoin → fiat). */
function cacheKey(year: number, currency: string): string {
  return `${year}:${normalizeCurrency(currency)}`;
}

/** Reset the module-level rate cache. Exported for tests only. */
export function __resetEcbCache(): void {
  rateCache.clear();
}

/**
 * Derive the (currency, year) pairs a statement needs ECB rates for.
 *
 * Mirrors the logic previously duplicated in cli/index.ts and web/main.ts:
 * collect every trade/cash-transaction/open-position/cash-balance currency
 * (minus EUR), every year that has a trade OR a cash transaction
 * (dividends/interest/crypto income can fall in a year with no trades), the
 * declaration year, and the year before each of them for the early-January
 * lookback.
 */
export function deriveEcbNeeds(
  statement: Statement,
  year: number,
  manualOpeningLots: ManualOpeningLot[] = [],
): EcbNeeds {
  const currencies = new Set<string>();
  for (const t of statement.trades) {
    currencies.add(t.currency);
    // A non-EUR CASH pair (GBP.USD) also books its other side, at that side's rate.
    if (t.assetCategory === "CASH") {
      const pair = FxFifoEngine.pairCurrencies(t);
      if (pair) {
        currencies.add(pair.base);
        currencies.add(pair.quote);
      }
    }
  }
  for (const c of statement.cashTransactions) currencies.add(c.currency);
  for (const lot of manualOpeningLots) currencies.add(lot.currency);
  // Modelo 720/D-6 value year-end holdings and cash, whose currency may appear in
  // no trade or cash transaction of the file.
  for (const p of statement.openPositions) currencies.add(p.currency);
  for (const cb of statement.cashBalances ?? []) currencies.add(cb.currency);
  currencies.delete("EUR");

  const years = new Set<number>();
  for (const t of statement.trades) {
    const y = parseInt(t.tradeDate.slice(0, 4));
    if (Number.isFinite(y)) years.add(y);
  }
  // Cash transactions (dividends, interest, crypto reward income) can fall in a
  // year with NO trades — e.g. USDT Simple Earn interest in a year the user
  // didn't trade. Fetch their years too, or valuation throws "No ECB rate".
  for (const c of statement.cashTransactions) {
    const y = parseInt(normalizeDate(c.dateTime).slice(0, 4));
    if (Number.isFinite(y)) years.add(y);
  }
  for (const lot of manualOpeningLots) {
    const y = parseInt(normalizeDate(lot.acquireDate).slice(0, 4));
    if (Number.isFinite(y)) years.add(y);
  }
  years.add(year);
  // Fetch the previous year of every year so the 10-day lookback can find
  // late-December rates for early-January transactions (e.g. Jan 1-2), even
  // after a year with no activity.
  for (const y of [...years]) years.add(y - 1);

  return { currencies: [...currencies], years: [...years] };
}

/**
 * Merge every (currency, year) entry into one unified rate map. Existing
 * date→currency sub-maps are extended rather than overwritten so two currencies
 * fetched in separate batches for the same date both survive.
 */
function mergeInto(target: EcbRateMap, source: EcbRateMap): void {
  for (const [date, byCurrency] of source) {
    let dest = target.get(date);
    if (!dest) {
      dest = new Map();
      target.set(date, dest);
    }
    for (const [currency, rate] of byCurrency) {
      dest.set(currency, rate);
    }
  }
}

/**
 * Build the unified ECB rate map for a parsed statement (or pre-derived needs).
 *
 * Encapsulates the derive → fetch (one `fetchEcbRates` batch per year, all
 * years in parallel) → merge pipeline shared by CLI and web. Memoizes past
 * years per-(currency, year): a repeated call for the same needs does zero
 * network I/O for them, and a superset call fetches only the missing pairs.
 *
 * @param input - A parsed statement plus the declaration year, OR pre-derived needs.
 * @param opts - Optional injectable fetcher / cache bypass.
 * @returns The merged rate map (date → currency → EUR-per-1-FCY).
 */
export async function buildEcbRateMap(
  input: { statement: Statement; year: number; manualOpeningLots?: ManualOpeningLot[] } | EcbNeeds,
  opts: BuildEcbRateMapOptions = {},
): Promise<EcbRateMap> {
  const needs: EcbNeeds =
    "statement" in input ? deriveEcbNeeds(input.statement, input.year, input.manualOpeningLots ?? []) : input;

  const fetcher = opts.fetcher ?? fetchEcbRates;
  const currentYear = new Date().getUTCFullYear();

  const merged: EcbRateMap = new Map();
  const toFetch: Array<{ yr: number; missing: string[]; cacheable: boolean }> = [];

  for (const yr of needs.years) {
    // The current year's batch grows every business day, so it is always
    // refetched and never cached.
    const cacheable = !opts.noCache && yr < currentYear;
    // Split this year's currencies into those already cached and those missing,
    // so a superset request fetches ONLY the new pairs. Crypto currencies
    // normalize to themselves and are never ECB-resolvable — fetchEcbRates skips
    // them, so they simply never produce a cached entry (and re-asking is cheap).
    const missing: string[] = [];
    for (const currency of needs.currencies) {
      const key = cacheKey(yr, currency);
      const cached = cacheable ? rateCache.get(key) : undefined;
      if (cached) {
        mergeInto(merged, cached);
      } else {
        missing.push(currency);
      }
    }

    if (missing.length > 0) toFetch.push({ yr, missing, cacheable });
  }

  // One request batch per year, all in flight at once; merged in year order.
  const results = await Promise.all(toFetch.map(({ yr, missing }) => fetcher(yr, missing)));

  for (const [i, { yr, missing, cacheable }] of toFetch.entries()) {
    const fetched = results[i]!;
    mergeInto(merged, fetched);

    if (cacheable) {
      // Cache per (currency, year): slice the fetched map into one sub-map per
      // normalized currency so a later superset request can reuse each pair
      // independently. A missing currency that returned no rows (e.g. crypto, or
      // a fiat with no observations that year) caches an empty map so we don't
      // refetch it on the next run.
      const sliced = new Map<string, EcbRateMap>();
      for (const currency of missing) {
        sliced.set(cacheKey(yr, currency), new Map());
      }
      for (const [date, byCurrency] of fetched) {
        for (const [currency, rate] of byCurrency) {
          // `currency` here is already the normalized code fetchEcbRates stored.
          const key = `${yr}:${currency}`;
          let slice = sliced.get(key);
          if (!slice) {
            slice = new Map();
            sliced.set(key, slice);
          }
          let dest = slice.get(date);
          if (!dest) {
            dest = new Map();
            slice.set(date, dest);
          }
          dest.set(currency, rate);
        }
      }
      for (const [key, slice] of sliced) {
        rateCache.set(key, slice);
      }
    }
  }

  return merged;
}
