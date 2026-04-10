/**
 * Modelo 720 generator.
 *
 * Generates the fixed-width text file (500 bytes/record, ISO-8859-15)
 * required by AEAT for the foreign asset declaration.
 */

import Decimal from "decimal.js";
import type { OpenPosition } from "../types/ibkr.js";
import type { EcbRateMap } from "../types/ecb.js";
import { getEcbRate } from "../engine/ecb.js";

interface Modelo720Config {
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
}

/**
 * Generate a Modelo 720 fixed-width text file from open positions.
 *
 * Only includes positions where total value per category exceeds 50,000 EUR.
 *
 * @param positions - Open positions at year end (Dec 31)
 * @param rateMap - ECB exchange rates
 * @param config - Taxpayer information
 * @returns Fixed-width text content ready for AEAT submission
 */
export function generateModelo720(
  positions: OpenPosition[],
  rateMap: EcbRateMap,
  config: Modelo720Config,
): string {
  // Filter to stocks/funds and calculate EUR values
  const entries = positions
    .filter((p) => p.assetCategory === "STK" || p.assetCategory === "FUND")
    .map((p) => {
      const yearEnd = `${config.year}-12-31`;
      const ecbRate = getEcbRate(rateMap, yearEnd, p.currency);
      const valueEur = new Decimal(p.positionValue).abs().mul(ecbRate);
      const costEur = new Decimal(p.costBasisMoney).abs().mul(ecbRate);

      return { position: p, valueEur, costEur };
    });

  // Check 50,000 EUR threshold for values category
  const totalValue = entries.reduce((s, e) => s.plus(e.valueEur), new Decimal(0));
  if (totalValue.lessThan(50000)) {
    return ""; // Below threshold, no declaration needed
  }

  // Build records
  const detailRecords = entries.map((e) =>
    buildDetailRecord(e.position, e.valueEur, e.costEur, config),
  );

  const summaryRecord = buildSummaryRecord(config, detailRecords.length, entries);

  return [summaryRecord, ...detailRecords].join("\n");
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
  const fracPart = dec.minus(dec.floor()).mul(100).floor().toString().padStart(decLen, "0");
  return intPart + fracPart;
}

function buildSummaryRecord(
  config: Modelo720Config,
  detailCount: number,
  entries: { valueEur: Decimal; costEur: Decimal }[],
): string {
  const totalAcq = entries.reduce((s, e) => s.plus(e.costEur), new Decimal(0));
  const totalVal = entries.reduce((s, e) => s.plus(e.valueEur), new Decimal(0));

  let record = "";
  record += "1";                                              // 1: Register type
  record += "720";                                            // 2-4: Model
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
  record += detailCount.toString().padStart(9, "0");          // 136-144: Detail count
  record += totalAcq.isNegative() ? "N" : " ";               // 145: Acquisition sign
  record += numPad(totalAcq.toString(), 15, 2);               // 146-162: Acquisition value
  record += totalVal.isNegative() ? "N" : " ";               // 163: Valuation sign
  record += numPad(totalVal.toString(), 15, 2);               // 164-180: Valuation value
  record += pad("", 320);                                     // 181-500: Blank

  return record;
}

function buildDetailRecord(
  pos: OpenPosition,
  valueEur: Decimal,
  costEur: Decimal,
  config: Modelo720Config,
): string {
  let record = "";
  record += "2";                                              // 1: Register type
  record += "720";                                            // 2-4: Model
  record += config.year.toString();                           // 5-8: Year
  record += pad(config.nif, 9, " ", true);                    // 9-17: NIF
  record += pad(config.nif, 9, " ", true);                    // 18-26: Declared NIF
  record += pad("", 9);                                       // 27-35: Proxy NIF
  record += pad(pos.description, 40);                         // 36-75: Name
  record += "1";                                              // 76: Declaration type (owner)
  record += pad("", 25);                                      // 77-101: Reserved
  record += "V";                                              // 102: Asset type (stocks)
  record += pad("", 26);                                      // 103-128: Reserved
  record += pad("", 2);                                       // 129-130: Country code (from ISIN)
  record += "1";                                              // 131: ID type (ISIN)
  record += pad(pos.isin, 12);                                // 132-143: ISIN
  record += pad("", 46);                                      // 144-189: Reserved
  record += pad(pos.description, 41);                         // 190-230: Entity name
  record += pad("", 184);                                     // 231-414: Reserved
  record += pad("", 8);                                       // 415-422: First acquisition date
  record += "M";                                              // 423: Type (M=existing)
  record += pad("", 8);                                       // 424-431: Sell date
  record += (costEur.isNegative() ? "N" : " ");               // 432: Acquisition sign
  record += numPad(costEur.toString(), 13, 2);                // 433-447: Acquisition value
  record += (valueEur.isNegative() ? "N" : " ");              // 448: Valuation sign
  record += numPad(valueEur.toString(), 13, 2);               // 449-462: Valuation value
  record += "A";                                              // 463: Stock representation
  record += numPad(new Decimal(pos.quantity).abs().toString(), 9, 3); // 464-475: Quantity
  record += pad("", 1);                                       // 476: Reserved
  record += numPad("100", 3, 2);                              // 477-481: Ownership %
  record += pad("", 19);                                      // 482-500: Blank

  return record;
}
