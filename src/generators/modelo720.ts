/**
 * Modelo 720 generator.
 *
 * Generates the fixed-width text file (500 bytes/record, ISO-8859-15)
 * required by AEAT for the foreign asset declaration.
 */

import Decimal from "decimal.js";
import type { OpenPosition, CashBalance } from "../types/ibkr.js";
import type { Lot } from "../types/tax.js";
import type { EcbRateMap } from "../types/ecb.js";
import { getEcbRate, getQ4AverageRate } from "../engine/ecb.js";

/** Get the correct valuation rate for a position: Q4 average for STK, year-end spot for others. */
function getValuationRate(rateMap: EcbRateMap, year: number, currency: string, assetCategory: string): Decimal {
  const yearEnd = `${year}-12-31`;
  if (assetCategory !== "STK") {
    return getEcbRate(rateMap, yearEnd, currency);
  }
  try {
    return getQ4AverageRate(rateMap, year, currency);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("No ECB Q4 rates found")) {
      return getEcbRate(rateMap, yearEnd, currency);
    }
    throw error;
  }
}

/** Per-category threshold status for Modelo 720 */
export interface Modelo720ThresholdResult {
  values: { exceeds: boolean; total: Decimal };
  accounts: { exceeds: boolean; total: Decimal };
  realEstate: { exceeds: boolean; total: Decimal };
}

/**
 * Check per-category 50,000 EUR thresholds for Modelo 720.
 *
 * Modelo 720 has three independent categories:
 *  - Valores (stocks, funds, bonds) — "V"
 *  - Cuentas (bank accounts) — "C" (not implemented in broker positions)
 *  - Bienes inmuebles (real estate) — "I" (not implemented in broker positions)
 *
 * Each category is evaluated independently against the 50K threshold.
 * Only categories exceeding 50K must be declared.
 *
 * @param positions - Open positions at year end
 * @param rateMap - ECB exchange rates
 * @param year - Tax year
 * @returns Per-category threshold status with totals
 */
export function checkModelo720Thresholds(
  positions: OpenPosition[],
  rateMap: EcbRateMap,
  year: number,
  cashBalances?: CashBalance[],
): Modelo720ThresholdResult {
  const THRESHOLD = new Decimal(50000);

  // Calculate total value for securities (V category: STK, FUND, BOND)
  const valuesTotal = positions
    .filter((p) => p.assetCategory === "STK" || p.assetCategory === "FUND" || p.assetCategory === "BOND")
    .reduce((sum, p) => {
      const ecbRate = getValuationRate(rateMap, year, p.currency, p.assetCategory);
      return sum.plus(new Decimal(p.positionValue).abs().mul(ecbRate));
    }, new Decimal(0));

  // Category C: cash balances at foreign brokers
  const yearEnd = `${year}-12-31`;
  const accountsTotal = (cashBalances ?? [])
    .filter((cb) => {
      const cash = new Decimal(cb.endingCash);
      return !cash.isZero();
    })
    .reduce((sum, cb) => {
      const ecbRate = cb.currency === "EUR" ? new Decimal(1) : getEcbRate(rateMap, yearEnd, cb.currency);
      return sum.plus(new Decimal(cb.endingCash).abs().mul(ecbRate));
    }, new Decimal(0));

  const realEstateTotal = new Decimal(0);

  return {
    values: { exceeds: valuesTotal.greaterThanOrEqualTo(THRESHOLD), total: valuesTotal },
    accounts: { exceeds: accountsTotal.greaterThanOrEqualTo(THRESHOLD), total: accountsTotal },
    realEstate: { exceeds: realEstateTotal.greaterThanOrEqualTo(THRESHOLD), total: realEstateTotal },
  };
}

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
  /** ISINs declared in the previous year's 720 — used to determine A/M/C declaration types */
  previousYearIsins?: string[];
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
  /** Optional: remaining lots from FIFO engine, used to extract first acquisition date */
  remainingLots?: Map<string, Lot[]>,
): string {
  const previousIsins = new Set(config.previousYearIsins ?? []);

  // Filter to stocks/funds/bonds and calculate EUR values
  // STK positions use Q4 average FX rate (media del cuarto trimestre);
  // FUND/BOND positions use Dec 31 spot rate (tipo de cambio a 31 de diciembre).
  const entries = positions
    .filter((p) => p.assetCategory === "STK" || p.assetCategory === "FUND" || p.assetCategory === "BOND")
    .map((p) => {
      const ecbRate = getValuationRate(rateMap, config.year, p.currency, p.assetCategory);
      const valueEur = new Decimal(p.positionValue).abs().mul(ecbRate);
      const costEur = new Decimal(p.costBasisMoney).abs().mul(ecbRate);

      // First acquisition date from FIFO lots (earliest lot for this ISIN)
      let firstAcquisitionDate = "";
      if (remainingLots) {
        const lots = remainingLots.get(p.isin);
        if (lots && lots.length > 0) {
          const earliest = lots.reduce((min, lot) =>
            lot.acquireDate < min ? lot.acquireDate : min, lots[0]!.acquireDate);
          firstAcquisitionDate = earliest;
        }
      }

      // Declaration type: A (new), M (existing), C (cancelled/sold)
      const declType: "A" | "M" | "C" = previousIsins.has(p.isin) ? "M" : "A";

      return { position: p, valueEur, costEur, firstAcquisitionDate, declType };
    });

  // Build "C" (cancelled) records for ISINs in previous year but not in current positions
  const currentIsins = new Set(entries.map((e) => e.position.isin));
  const cancelledIsins = [...previousIsins].filter((isin) => !currentIsins.has(isin));
  const cancelledEntries = cancelledIsins.map((isin) => ({
    isin,
    declType: "C" as const,
  }));

  // Check 50,000 EUR threshold for values category (only current positions count)
  const totalValue = entries.reduce((s, e) => s.plus(e.valueEur), new Decimal(0));
  if (totalValue.lessThan(50000) && cancelledEntries.length === 0) {
    return ""; // Below threshold and no cancellations needed
  }

  // Build records
  const detailRecords = entries.map((e) =>
    buildDetailRecord(e.position, e.valueEur, e.costEur, config, e.firstAcquisitionDate, e.declType),
  );

  // Add cancelled records
  for (const c of cancelledEntries) {
    detailRecords.push(buildCancelledRecord(c.isin, config));
  }

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
  const fracPart = dec.minus(dec.floor()).mul(new Decimal(10).pow(decLen)).floor().toString().padStart(decLen, "0");
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
  firstAcquisitionDate?: string,
  declType: "A" | "M" | "C" = "M",
): string {
  // Extract country code from ISIN prefix (first 2 characters)
  const countryCode = pos.isin.length >= 2 ? pos.isin.slice(0, 2).toUpperCase() : "  ";

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
  record += pad(countryCode, 2);                              // 129-130: Country code (from ISIN)
  record += "1";                                              // 131: ID type (ISIN)
  record += pad(pos.isin, 12);                                // 132-143: ISIN
  record += pad("", 46);                                      // 144-189: Reserved
  record += pad(pos.description, 41);                         // 190-230: Entity name
  record += pad("", 184);                                     // 231-414: Reserved
  record += pad((firstAcquisitionDate ?? "").replace(/-/g, "").slice(0, 8), 8); // 415-422: First acquisition date (YYYYMMDD)
  record += declType;                                         // 423: Type (A=new, M=existing, C=cancelled)
  record += pad("", 8);                                       // 424-431: Sell date
  record += (costEur.isNegative() ? "N" : " ");               // 432: Acquisition sign
  record += numPad(costEur.toString(), 13, 2);                // 433-447: Acquisition value
  record += (valueEur.isNegative() ? "N" : " ");              // 448: Valuation sign
  record += numPad(valueEur.toString(), 13, 2);               // 449-463: Valuation value
  record += "A";                                              // 464: Stock representation
  record += numPad(new Decimal(pos.quantity).abs().toString(), 9, 3); // 465-476: Quantity
  record += pad("", 1);                                       // 477: Reserved
  record += numPad("100", 3, 2);                              // 478-482: Ownership %
  record += pad("", 18);                                      // 483-500: Blank

  return record;
}

/**
 * Build a "C" (cancelled) detail record for an ISIN that was declared
 * in the previous year but no longer held.
 */
function buildCancelledRecord(isin: string, config: Modelo720Config): string {
  const countryCode = isin.length >= 2 ? isin.slice(0, 2).toUpperCase() : "  ";
  const yearEnd = `${config.year}1231`;

  let record = "";
  record += "2";                                              // 1: Register type
  record += "720";                                            // 2-4: Model
  record += config.year.toString();                           // 5-8: Year
  record += pad(config.nif, 9, " ", true);                    // 9-17: NIF
  record += pad(config.nif, 9, " ", true);                    // 18-26: Declared NIF
  record += pad("", 9);                                       // 27-35: Proxy NIF
  record += pad("", 40);                                      // 36-75: Name (unknown for cancelled)
  record += "1";                                              // 76: Declaration type (owner)
  record += pad("", 25);                                      // 77-101: Reserved
  record += "V";                                              // 102: Asset type (stocks)
  record += pad("", 26);                                      // 103-128: Reserved
  record += pad(countryCode, 2);                              // 129-130: Country code
  record += "1";                                              // 131: ID type (ISIN)
  record += pad(isin, 12);                                    // 132-143: ISIN
  record += pad("", 46);                                      // 144-189: Reserved
  record += pad("", 41);                                      // 190-230: Entity name
  record += pad("", 184);                                     // 231-414: Reserved
  record += pad("", 8);                                       // 415-422: First acquisition date
  record += "C";                                              // 423: Type (C=cancelled)
  record += pad(yearEnd, 8);                                  // 424-431: Sell/cancellation date
  record += " ";                                              // 432: Acquisition sign
  record += numPad("0", 13, 2);                               // 433-447: Acquisition value (0)
  record += " ";                                              // 448: Valuation sign
  record += numPad("0", 13, 2);                               // 449-463: Valuation value (0)
  record += "A";                                              // 464: Stock representation
  record += numPad("0", 9, 3);                                // 465-476: Quantity (0)
  record += pad("", 1);                                       // 477: Reserved
  record += numPad("100", 3, 2);                              // 478-482: Ownership %
  record += pad("", 18);                                      // 483-500: Blank

  return record;
}
