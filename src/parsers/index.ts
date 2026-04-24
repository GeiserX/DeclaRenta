/**
 * Broker parser registry.
 *
 * Auto-detects input format and routes to the correct parser.
 * New brokers are added by implementing BrokerParser and registering here.
 */

import type { BrokerParser } from "../types/broker.js";
import { ibkrParser } from "./ibkr.js";
import { freedom24Parser } from "./freedom24.js";
import { etoroParser } from "./etoro.js";
import { degiroParser } from "./degiro.js";
import { scalableParser } from "./scalable.js";
import { binanceParser } from "./binance.js";
import { coinbaseParser } from "./coinbase.js";
import { krakenParser } from "./kraken.js";
import { revolutParser } from "./revolut.js";
import { lightyearParser } from "./lightyear.js";

/**
 * All registered broker parsers, checked in order for auto-detection.
 * Order matters: more specific formats (XML, JSON, XLSX) before generic CSV.
 */
export const brokerParsers: BrokerParser[] = [
  ibkrParser,       // XML with <FlexQueryResponse>
  freedom24Parser,  // JSON with trades/corporate_actions/cash_flows
  revolutParser,    // XLSX with "Date acquired" + "Cost basis"
  etoroParser,      // XLSX/CSV with "Closed Positions"
  lightyearParser,  // CSV with Reference + Ticker + ISIN + CCY + Net Amt.
  degiroParser,     // CSV with ISIN + quantity + price headers
  scalableParser,   // CSV with date;time;status;reference headers
  binanceParser,    // CSV with Date(UTC),Pair,Side,Price headers
  coinbaseParser,   // CSV with Transaction Type + Spot Price headers
  krakenParser,     // CSV with txid + pair/ordertxid or refid/aclass headers
];

/**
 * Auto-detect which broker produced the input by trying each parser's detect().
 * Returns undefined if no parser matches.
 */
export function detectBroker(input: string): BrokerParser | undefined {
  return brokerParsers.find((p) => p.detect(input));
}

/**
 * Look up a broker parser by name (case-insensitive).
 * Returns undefined if no parser matches.
 */
export function getBroker(name: string): BrokerParser | undefined {
  const lower = name.toLowerCase();
  return brokerParsers.find((p) => p.name.toLowerCase().includes(lower));
}
