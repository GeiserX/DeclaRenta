/**
 * Common broker parser interface.
 *
 * All broker parsers implement this interface, producing a unified
 * FlexStatement that the engine can process regardless of source broker.
 */

import type { FlexStatement } from "./ibkr.js";

/** Re-export FlexStatement as the internal statement format */
export type Statement = FlexStatement;

/** Each broker parser must implement this interface */
export interface BrokerParser {
  /** Human-readable broker name */
  readonly name: string;
  /** Supported file formats for display purposes */
  readonly formats: string[];
  /**
   * Attempt to auto-detect whether the input belongs to this broker.
   * Should be fast — only check headers/structure, not parse fully.
   */
  detect(input: string): boolean;
  /** Parse the input file(s) into a normalized Statement */
  parse(input: string): Statement;
}
