/**
 * ECB exchange rate types.
 * Rates are always EUR per 1 unit of foreign currency.
 */

export interface EcbRateEntry {
  date: string;
  currency: string;
  rate: string;
}

/** Map of date -> currency -> rate (EUR per 1 FCY) */
export type EcbRateMap = Map<string, Map<string, string>>;
