/**
 * ECB exchange rate fetcher.
 *
 * Fetches official ECB daily reference rates via the SDMX REST API.
 * Spanish tax law (Art. 37.2 LIRPF) requires using ECB official rates,
 * not broker-provided rates.
 */

import Decimal from "decimal.js";
import type { EcbRateMap } from "../types/ecb.js";

const ECB_SDMX_URL = "https://data-api.ecb.europa.eu/service/data/EXR";

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

  for (const currency of currencies) {
    const url = `${ECB_SDMX_URL}/D.${currency}.EUR.SP00.A?startPeriod=${startDate}&endPeriod=${endDate}&format=csvdata`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ECB API error for ${currency}: ${response.status} ${response.statusText}`);
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

  // Normalize date to YYYY-MM-DD
  const normalizedDate = date.length === 8
    ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
    : date;

  const d = new Date(normalizedDate);

  for (let attempt = 0; attempt < 10; attempt++) {
    const dateStr = d.toISOString().slice(0, 10);
    const rate = rateMap.get(dateStr)?.get(currency);

    if (rate) {
      return new Decimal(rate);
    }

    // Walk backward one day
    d.setDate(d.getDate() - 1);
  }

  throw new Error(`No ECB rate found for ${currency} near ${normalizedDate} (searched 10 days back)`);
}
