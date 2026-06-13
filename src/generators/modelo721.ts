/**
 * Modelo 721 stub generator.
 *
 * Modelo 721 is the declaration of crypto assets held on foreign exchanges
 * when their total value exceeds 50,000 EUR at Dec 31.
 *
 * Format: The real AEAT format is XML (Orden HFP/886/2023, with XML schemas).
 * This stub currently uses a fixed-width layout for prototyping only —
 * it must be migrated to XML before production use.
 */

import Decimal from "decimal.js";
import type { OpenPosition } from "../types/ibkr.js";
import type { EcbRateMap } from "../types/ecb.js";
import { lookupPositionRate } from "../engine/ecb.js";

export interface Modelo721Entry {
  /** Crypto asset identifier (e.g., BTC, ETH) */
  assetId: string;
  description: string;
  /** Exchange name (e.g., Coinbase, Binance) */
  exchangeName: string;
  /** Country code of the exchange */
  countryCode: string;
  /** Quantity held at Dec 31 */
  quantity: Decimal;
  /** Valuation in EUR at Dec 31 */
  valuationEur: Decimal;
  /** Acquisition cost in EUR */
  acquisitionCostEur: Decimal;
}

/** Crypto asset categories that qualify for Modelo 721 (never CASH — fiat belongs in 720). */
const CRYPTO_CATEGORIES = new Set(["CRYPTO"]);

/** A valued 721 position plus the per-position EUR valuation for display. */
export interface Modelo721ValuedPosition {
  entry: Modelo721Entry;
  /** Year-end EUR valuation, or null when the currency has no resolvable rate. */
  valuationEur: Decimal | null;
}

export interface Modelo721Valuation {
  positions: Modelo721ValuedPosition[];
  /** Positions whose currency had no resolvable year-end rate (surfaced for manual valuation). */
  unvaluedCount: number;
  /** Sum of all resolvable year-end valuations (EUR). */
  totalValueEur: Decimal;
}

/**
 * Build valued Modelo 721 entries from open positions — the single source of
 * truth for 721 crypto valuation (web section and any future generator consume this).
 *
 * Only `assetCategory === "CRYPTO"` positions with a positive value qualify
 * (fiat/CASH belongs in Modelo 720). Each position is valued at the year-end
 * ECB rate via {@link lookupPositionRate}; positions whose currency has no
 * resolvable rate (e.g. the crypto coin itself) are kept with `valuationEur: null`
 * and counted in `unvaluedCount` so callers can surface them for manual valuation.
 *
 * Exchange name and country code are left blank: open positions carry no reliable
 * exchange/country data, and deriving them from the ISIN prefix is forbidden for
 * crypto (Art. — see Modelo 721 Crypto Filtering rules). The acquisition cost is
 * taken from `costBasisMoney` (already in EUR) when present.
 */
export function buildModelo721Entries(
  openPositions: OpenPosition[],
  rateMap: EcbRateMap,
  yearEnd: string,
): Modelo721Valuation {
  const positions: Modelo721ValuedPosition[] = [];
  let unvaluedCount = 0;
  let totalValueEur = new Decimal(0);

  for (const p of openPositions) {
    if (!CRYPTO_CATEGORIES.has(p.assetCategory)) continue;
    if (!new Decimal(p.positionValue).greaterThan(0)) continue;

    const rate = lookupPositionRate(rateMap, yearEnd, p.currency);
    const valuationEur = rate === null ? null : new Decimal(p.positionValue).mul(rate);
    if (valuationEur === null) {
      unvaluedCount++;
    } else {
      totalValueEur = totalValueEur.plus(valuationEur);
    }

    const acquisitionCostEur = rate === null
      ? new Decimal(0)
      : new Decimal(p.costBasisMoney || "0").mul(rate);

    positions.push({
      entry: {
        assetId: p.symbol || p.description || p.isin,
        description: p.description || p.symbol || p.isin,
        exchangeName: "",
        countryCode: "",
        quantity: new Decimal(p.quantity),
        valuationEur: valuationEur ?? new Decimal(0),
        acquisitionCostEur,
      },
      valuationEur,
    });
  }

  return { positions, unvaluedCount, totalValueEur };
}

interface Modelo721Config {
  nif: string;
  surname: string;
  name: string;
  year: number;
  phone: string;
  contactName: string;
  declarationId: string;
  isComplementary: boolean;
  isReplacement: boolean;
  previousDeclarationId?: string;
  /** Internal/test-only escape hatch for the legacy fixed-width prototype. */
  allowPrototypeOutput?: boolean;
}

function pad(value: string, length: number, char = " ", alignRight = false): string {
  if (alignRight) {
    return value.slice(0, length).padStart(length, char);
  }
  return value.slice(0, length).padEnd(length, char);
}

function numPad(value: string, intLen: number, decLen: number): string {
  const dec = new Decimal(value).abs();
  const intPart = dec.floor().toString().padStart(intLen, "0");
  const fracPart = dec.minus(dec.floor()).mul(new Decimal(10).pow(decLen)).floor().toString().padStart(decLen, "0");
  return intPart + fracPart;
}

/**
 * Generate Modelo 721 stub (fixed-width prototype — real format is XML per Orden HFP/886/2023).
 *
 * @param entries - Crypto positions at year end
 * @param config - Taxpayer information
 * @returns Fixed-width text content, or empty string if below 50K threshold
 */
export function generateModelo721(
  entries: Modelo721Entry[],
  config: Modelo721Config,
): string {
  if (!config.allowPrototypeOutput) {
    throw new Error("Modelo 721 official output is not implemented yet. AEAT external-program submission requires XML per Orden HFP/886/2023; the old fixed-width prototype is disabled.");
  }

  // Check 50,000 EUR threshold
  const totalValue = entries.reduce((s, e) => s.plus(e.valuationEur), new Decimal(0));
  if (totalValue.lessThan(50000)) {
    return "";
  }

  const detailRecords = entries.map((e) => buildDetailRecord721(e, config));
  const summaryRecord = buildSummaryRecord721(config, entries);

  return [summaryRecord, ...detailRecords].join("\n");
}

function buildSummaryRecord721(config: Modelo721Config, entries: Modelo721Entry[]): string {
  const totalAcq = entries.reduce((s, e) => s.plus(e.acquisitionCostEur), new Decimal(0));
  const totalVal = entries.reduce((s, e) => s.plus(e.valuationEur), new Decimal(0));

  let record = "";
  record += "1";                                              // 1: Register type
  record += "721";                                            // 2-4: Model
  record += config.year.toString();                           // 5-8: Year
  record += pad(config.nif, 9, " ", true);                    // 9-17: NIF
  record += pad(config.surname + " " + config.name, 40);     // 18-57: Name
  record += "T";                                              // 58: Transmission type
  record += pad(config.phone, 9, "0", true);                  // 59-67: Phone
  record += pad(config.contactName, 40);                      // 68-107: Contact
  record += pad(config.declarationId, 13, "0", true);         // 108-120: Declaration ID
  record += config.isComplementary ? "C" : " ";               // 121: Complementary
  record += config.isReplacement ? "S" : " ";                 // 122: Replacement
  record += pad(config.previousDeclarationId ?? "", 13, "0", true); // 123-135: Previous ID
  record += entries.length.toString().padStart(9, "0");        // 136-144: Detail count
  record += totalAcq.isNegative() ? "N" : " ";               // 145: Acquisition sign
  record += numPad(totalAcq.toString(), 15, 2);               // 146-162: Acquisition value
  record += totalVal.isNegative() ? "N" : " ";               // 163: Valuation sign
  record += numPad(totalVal.toString(), 15, 2);               // 164-180: Valuation value
  record += pad("", 320);                                     // 181-500: Blank

  return record;
}

function buildDetailRecord721(
  entry: Modelo721Entry,
  config: Modelo721Config,
): string {
  let record = "";
  record += "2";                                              // 1: Register type
  record += "721";                                            // 2-4: Model
  record += config.year.toString();                           // 5-8: Year
  record += pad(config.nif, 9, " ", true);                    // 9-17: NIF
  record += pad(config.nif, 9, " ", true);                    // 18-26: Declared NIF
  record += pad("", 9);                                       // 27-35: Proxy NIF
  record += pad(entry.description, 40);                       // 36-75: Description
  record += "1";                                              // 76: Declaration type (owner)
  record += pad("", 25);                                      // 77-101: Reserved
  record += "C";                                              // 102: Asset type (C=crypto)
  record += pad("", 26);                                      // 103-128: Reserved
  record += pad(entry.countryCode, 2);                        // 129-130: Country code
  record += "9";                                              // 131: ID type (9=other)
  record += pad(entry.assetId, 12);                           // 132-143: Asset ID
  record += pad("", 46);                                      // 144-189: Reserved
  record += pad(entry.exchangeName, 41);                      // 190-230: Exchange name
  record += pad("", 184);                                     // 231-414: Reserved
  record += pad("", 8);                                       // 415-422: Acquisition date
  record += "M";                                              // 423: Type (M=existing)
  record += pad("", 8);                                       // 424-431: Sell date
  record += entry.acquisitionCostEur.isNegative() ? "N" : " "; // 432: Acquisition sign
  record += numPad(entry.acquisitionCostEur.toString(), 13, 2); // 433-447: Acquisition value
  record += entry.valuationEur.isNegative() ? "N" : " ";     // 448: Valuation sign
  record += numPad(entry.valuationEur.toString(), 13, 2);     // 449-462: Valuation value
  record += " ";                                              // 463: Reserved
  record += numPad(entry.quantity.toString(), 9, 3);          // 464-475: Quantity
  record += pad("", 1);                                       // 476: Reserved
  record += numPad("100", 3, 2);                              // 477-481: Ownership %
  record += pad("", 18);                                      // 483-500: Blank

  return record;
}
