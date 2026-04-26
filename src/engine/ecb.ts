/**
 * ECB exchange rate fetcher.
 *
 * Fetches official ECB daily reference rates via the SDMX REST API.
 * Spanish tax law requires using official exchange rates (Art. 47 LGT,
 * DGT consultas vinculantes), not broker-provided rates.
 */

import Decimal from "decimal.js";
import type { EcbRateMap } from "../types/ecb.js";

const ECB_SDMX_URL = "https://data-api.ecb.europa.eu/service/data/EXR";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/** Stablecoins pegged 1:1 to USD — use USD rate from ECB */
const STABLECOIN_TO_FIAT: Record<string, string> = {
  USDT: "USD", USDC: "USD", BUSD: "USD", DAI: "USD",
  TUSD: "USD", FDUSD: "USD", USDP: "USD", GUSD: "USD",
  PYUSD: "USD", EURT: "EUR", EUROC: "EUR",
};

/** Normalize a currency code: map stablecoins to their fiat equivalent */
export function normalizeCurrency(currency: string): string {
  return STABLECOIN_TO_FIAT[currency] ?? currency;
}

/**
 * Currencies known to be published by the ECB.
 * Anything not in this set (and not a stablecoin) is likely crypto and won't resolve.
 */
const ECB_CURRENCIES = new Set([
  "USD", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "SEK", "NOK", "DKK",
  "PLN", "CZK", "HUF", "RON", "BGN", "HRK", "ISK", "TRY", "ILS", "CNY",
  "HKD", "SGD", "KRW", "THB", "MXN", "BRL", "ZAR", "INR", "IDR", "MYR",
  "PHP", "RUB",
]);

/** Returns true if the currency can be resolved via ECB (fiat or stablecoin) */
export function isEcbResolvable(currency: string): boolean {
  if (currency === "EUR") return true;
  const normalized = normalizeCurrency(currency);
  return ECB_CURRENCIES.has(normalized);
}

/**
 * Fetch ECB daily exchange rates for a given year and currency.
 *
 * The ECB publishes rates as "1 EUR = X FCY". We store the inverse
 * (1 FCY = X EUR) for easier conversion of broker amounts.
 *
 * @param year - Tax year (e.g. 2025)
 * @param currencies - Currency codes to fetch (e.g. ["USD", "GBP", "CHF"])
 * @returns Map of date -> currency -> rate (EUR per 1 FCY)
 */
export async function fetchEcbRates(year: number, currencies: string[]): Promise<EcbRateMap> {
  const rateMap: EcbRateMap = new Map();
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  // Deduplicate after normalization (e.g. USDT + USDC both → USD)
  const seen = new Set<string>();
  const toFetch: string[] = [];
  for (const raw of currencies) {
    const normalized = normalizeCurrency(raw);
    if (normalized === "EUR" || seen.has(normalized)) continue;
    if (!ECB_CURRENCIES.has(normalized)) continue; // skip crypto — ECB won't have it
    seen.add(normalized);
    toFetch.push(normalized);
  }

  for (const currency of toFetch) {
    const url = `${ECB_SDMX_URL}/D.${currency}.EUR.SP00.A?startPeriod=${startDate}&endPeriod=${endDate}&format=csvdata`;

    let response: Response | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        response = await fetch(url);
        if (response.ok || (response.status !== 503 && response.status !== 429)) break;
      } catch (err: unknown) {
        lastError = err;
        response = undefined;
      }
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * 2 ** attempt));
      }
    }
    if (!response) {
      throw new Error(`ECB API network error for ${currency}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    }
    if (!response.ok) {
      const retryHint = response.status === 503 || response.status === 429
        ? " (ECB service temporarily unavailable — please try again in a few minutes)"
        : "";
      throw new Error(`ECB API error for ${currency}: ${response.status} ${response.statusText}${retryHint}`);
    }

    const csv = await response.text();
    const lines = csv.split("\n");

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;

      const fields = line.split(",");
      // CSV format: ... TIME_PERIOD is col 6, OBS_VALUE is col 7
      const date = fields[6];
      const ecbRate = fields[7]; // 1 EUR = X FCY

      if (!date || !ecbRate || ecbRate === "") continue;

      // Invert: 1 FCY = 1/X EUR
      const eurPerFcy = new Decimal(1).dividedBy(new Decimal(ecbRate)).toFixed(10);

      if (!rateMap.has(date)) {
        rateMap.set(date, new Map());
      }
      rateMap.get(date)!.set(currency, eurPerFcy);
    }
  }

  return rateMap;
}

/**
 * Get the ECB rate for a specific date and currency.
 * If the exact date is a weekend/holiday, walks backward up to 10 days.
 *
 * @param rateMap - Pre-fetched rate map
 * @param date - Date string (YYYY-MM-DD or YYYYMMDD)
 * @param currency - Currency code (e.g. "USD")
 * @returns EUR per 1 unit of foreign currency
 * @throws Error if no rate found within 10 business days
 */
export function getEcbRate(rateMap: EcbRateMap, date: string, currency: string): Decimal {
  if (currency === "EUR") return new Decimal(1);

  // Normalize stablecoins to their fiat equivalent
  const resolved = normalizeCurrency(currency);
  if (resolved === "EUR") return new Decimal(1);

  // Normalize date to YYYY-MM-DD
  const normalizedDate = date.length === 8
    ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
    : date;

  const d = new Date(normalizedDate);

  for (let attempt = 0; attempt < 10; attempt++) {
    const dateStr = d.toISOString().slice(0, 10);
    const rate = rateMap.get(dateStr)?.get(resolved);

    if (rate) {
      return new Decimal(rate);
    }

    // Walk backward one day
    d.setDate(d.getDate() - 1);
  }

  // For crypto currencies without ECB rate, return 0 (these trades can't be valued in EUR)
  if (!ECB_CURRENCIES.has(resolved)) {
    return new Decimal(0);
  }

  throw new Error(`No ECB rate found for ${currency} near ${normalizedDate} (searched 10 days back)`);
}

/**
 * Calculate the Q4 (Oct 1 - Dec 31) average exchange rate for a given currency.
 *
 * Modelo 720 requires STK positions to use the Q4 average FX rate
 * (media del cuarto trimestre) rather than the Dec 31 spot rate.
 * This averages all available daily ECB rates in Q4 for the given currency.
 *
 * @param rateMap - Pre-fetched rate map
 * @param year - Tax year
 * @param currency - Currency code
 * @returns Average EUR per 1 FCY rate for Q4, or Decimal(1) for EUR
 * @throws Error if no rates found in Q4 for the currency
 */
export function getQ4AverageRate(rateMap: EcbRateMap, year: number, currency: string): Decimal {
  if (currency === "EUR") return new Decimal(1);

  const resolved = normalizeCurrency(currency);
  if (resolved === "EUR") return new Decimal(1);

  const q4Start = `${year}-10-01`;
  const q4End = `${year}-12-31`;

  let sum = new Decimal(0);
  let count = 0;

  for (const [date, currencies] of rateMap) {
    if (date >= q4Start && date <= q4End) {
      const rate = currencies.get(resolved);
      if (rate) {
        sum = sum.plus(new Decimal(rate));
        count++;
      }
    }
  }

  if (count === 0) {
    if (!ECB_CURRENCIES.has(resolved)) return new Decimal(0);
    throw new Error(`No ECB Q4 rates found for ${currency} in ${year} (Oct-Dec)`);
  }

  return sum.dividedBy(count);
}
