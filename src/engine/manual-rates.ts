/**
 * Shared manual crypto-rate parsing.
 *
 * Both the web UI (localStorage) and the CLI (`--crypto-rates`) let the user
 * supply EUR-per-unit quotes for crypto↔crypto permutas that have no ECB rate.
 * This module is the single source of truth for turning those raw quotes into
 * an EcbRateMap, so the validation/normalization rules can't drift between the
 * two entry points.
 *
 * Rules applied to every quote:
 *   - date    → normalized to YYYY-MM-DD (accepts YYYYMMDD and IBKR datetimes)
 *   - currency→ upper-cased AND stablecoin-normalized (USDT→USD) so the key
 *     matches how lookups resolve currencies; otherwise a hand-typed "USDT"
 *     would be stored under a key the lookup never queries.
 *   - eurPerUnit → validated with Decimal; non-finite or ≤0 entries dropped.
 */

import Decimal from "decimal.js";
import type { EcbRateMap } from "../types/ecb.js";
import { normalizeDate } from "./dates.js";
import { normalizeCurrency } from "./ecb.js";

/** One raw manual quote as typed by the user / stored on disk. */
export interface ManualRateQuote {
  currency: string;
  date: string;
  eurPerUnit: string;
}

/**
 * Validate and normalize a single quote. Returns null if the quote is unusable
 * (bad shape or non-positive/non-finite rate) so callers can skip it.
 */
export function normalizeManualQuote(
  quote: ManualRateQuote,
): { date: string; currency: string; eurPerUnit: string } | null {
  let rate: Decimal;
  try {
    rate = new Decimal(quote.eurPerUnit);
  } catch {
    return null;
  }
  if (!rate.isFinite() || rate.lessThanOrEqualTo(0)) return null;

  return {
    date: normalizeDate(quote.date),
    currency: normalizeCurrency(quote.currency.toUpperCase()),
    eurPerUnit: quote.eurPerUnit,
  };
}

/**
 * Build an EcbRateMap (date → currency → EUR-per-1-unit) from raw quotes.
 * Invalid entries are silently skipped. Later quotes for the same currency+date
 * win (last-write-wins), matching how the UI upserts a single row.
 */
export function buildManualRateMap(quotes: ManualRateQuote[]): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const quote of quotes) {
    const norm = normalizeManualQuote(quote);
    if (norm === null) continue;
    if (!map.has(norm.date)) map.set(norm.date, new Map());
    map.get(norm.date)!.set(norm.currency, norm.eurPerUnit);
  }
  return map;
}

/**
 * Narrow arbitrary parsed JSON to ManualRateQuote[]. Tolerates corrupt data:
 * non-arrays yield [], and entries missing the three string fields are dropped.
 */
export function coerceManualQuotes(parsed: unknown): ManualRateQuote[] {
  if (!Array.isArray(parsed)) return [];
  const quotes: ManualRateQuote[] = [];
  for (const raw of parsed as unknown[]) {
    if (raw == null || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    if (
      typeof rec.currency === "string" &&
      typeof rec.date === "string" &&
      typeof rec.eurPerUnit === "string"
    ) {
      quotes.push({ currency: rec.currency, date: rec.date, eurPerUnit: rec.eurPerUnit });
    }
  }
  return quotes;
}
