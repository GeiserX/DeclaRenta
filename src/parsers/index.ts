/**
 * Broker parser registry.
 *
 * Auto-detects input format and routes to the correct parser.
 * New brokers are added by implementing BrokerParser and registering here.
 */

import type { BrokerParser } from "../types/broker.js";
import { ibkrParser } from "./ibkr.js";
import { degiroParser } from "./degiro.js";

/** All registered broker parsers, checked in order for auto-detection */
export const brokerParsers: BrokerParser[] = [ibkrParser, degiroParser];

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
