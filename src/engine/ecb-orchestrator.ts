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
 * superset of — needs reuses the already-fetched immutable historical rates
 * instead of doing a second network round-trip. The web reprocesses on every
 * option toggle (monodivisa, titulares, …); without this it refetched every
 * rate each time.
 */

import type { Statement } from "../types/broker.js";
import type { EcbRateMap } from "../types/ecb.js";
import { fetchEcbRates, normalizeCurrency } from "./ecb.js";
import { normalizeDate } from "./dates.js";

/**
 * The set of (currency, year) pairs a statement needs ECB rates for.
 *
 * `currencies` is already EUR-stripped (EUR needs no rate). `years` includes
 * the declaration year and `minYear - 1` so the 10-day weekend/holiday lookback
 * can reach late-December rates for early-January transactions.
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
   * Defaults to `false` — ECB rates are immutable historical data, so caching
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
 * observations for that year. ECB historical rates never change, so entries
 * live for the process lifetime.
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
 * collect every trade/cash-transaction currency (minus EUR), every year that
 * has a trade OR a cash transaction (dividends/interest/crypto income can fall
 * in a year with no trades), the declaration year, and `minYear - 1` for the
 * early-January lookback.
 */
export function deriveEcbNeeds(statement: Statement, year: number): EcbNeeds {
  const currencies = new Set<string>();
  for (const t of statement.trades) currencies.add(t.currency);
  for (const c of statement.cashTransactions) currencies.add(c.currency);
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
  years.add(year);
  // Fetch the previous year for the earliest year so the 10-day lookback can
  // find late-December rates for early-January transactions (e.g. Jan 1-2).
  if (years.size > 0) {
    years.add(Math.min(...years) - 1);
  }

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
 * Encapsulates the derive → fetch (per-year batched, preserving the existing
 * `fetchEcbRates` behavior) → merge pipeline shared by CLI and web. Memoizes
 * per-(currency, year): a repeated call for the same needs does zero network
 * I/O, and a superset call fetches only the missing pairs.
 *
 * @param input - A parsed statement plus the declaration year, OR pre-derived needs.
 * @param opts - Optional injectable fetcher / cache bypass.
 * @returns The merged rate map (date → currency → EUR-per-1-FCY).
 */
export async function buildEcbRateMap(
  input: { statement: Statement; year: number } | EcbNeeds,
  opts: BuildEcbRateMapOptions = {},
): Promise<EcbRateMap> {
  const needs: EcbNeeds = "statement" in input
    ? deriveEcbNeeds(input.statement, input.year)
    : input;

  const fetcher = opts.fetcher ?? fetchEcbRates;
  const useCache = !opts.noCache;

  const merged: EcbRateMap = new Map();

  for (const yr of needs.years) {
    // Split this year's currencies into those already cached and those missing,
    // so a superset request fetches ONLY the new pairs. Crypto currencies
    // normalize to themselves and are never ECB-resolvable — fetchEcbRates skips
    // them, so they simply never produce a cached entry (and re-asking is cheap).
    const missing: string[] = [];
    for (const currency of needs.currencies) {
      const key = cacheKey(yr, currency);
      const cached = useCache ? rateCache.get(key) : undefined;
      if (cached) {
        mergeInto(merged, cached);
      } else {
        missing.push(currency);
      }
    }

    if (missing.length === 0) continue;

    const fetched = await fetcher(yr, missing);
    mergeInto(merged, fetched);

    if (useCache) {
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
