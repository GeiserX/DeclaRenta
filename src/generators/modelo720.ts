/**
 * Modelo 720 generator.
 *
 * Generates the fixed-width text file (500 bytes/record, ISO-8859-15)
 * required by AEAT for the foreign asset declaration.
 */

import Decimal from "decimal.js";
import type { OpenPosition, CashBalance } from "../types/ibkr.js";
import type { FifoDisposal, Lot } from "../types/tax.js";
import type { EcbRateMap } from "../types/ecb.js";
import { getQ4AverageRate, lookupPositionRate } from "../engine/ecb.js";
import { normalizeDate } from "../engine/dates.js";

/**
 * Get the valuation rate for a position: Q4 average for STK, year-end spot for
 * others. Returns null when the currency has no resolvable rate (e.g. a crypto
 * coin, or a fiat whose year-end rate was never fetched) so callers can skip the
 * position from EUR totals and surface it for manual valuation rather than
 * crashing the whole declaration.
 */
function getValuationRate(rateMap: EcbRateMap, year: number, currency: string, assetCategory: string): Decimal | null {
  const yearEnd = `${year}-12-31`;
  if (assetCategory !== "STK") {
    return lookupPositionRate(rateMap, yearEnd, currency);
  }
  try {
    return getQ4AverageRate(rateMap, year, currency);
  } catch (error: unknown) {
    // No Q4 data (or non-fiat) → fall back to the non-throwing year-end spot.
    if (error instanceof Error && (error.message.startsWith("No ECB Q4 rates found") || error.message.startsWith("No ECB Q4 rate available"))) {
      return lookupPositionRate(rateMap, yearEnd, currency);
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

function cashValuesEur(cb: CashBalance, rateMap: EcbRateMap, year: number): { ending: Decimal; averageQ4: Decimal } | undefined {
  if (!cb.averageQ4Cash) return undefined;
  const yearEnd = `${year}-12-31`;
  const ecbRate = lookupPositionRate(rateMap, yearEnd, cb.currency);
  // No resolvable rate → cannot value this balance in EUR; skip it (surfaced
  // for manual review) rather than crash the threshold check / file generation.
  if (ecbRate === null) return undefined;
  return {
    ending: new Decimal(cb.endingCash).mul(ecbRate),
    averageQ4: new Decimal(cb.averageQ4Cash).mul(ecbRate),
  };
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
      // Unvaluable position (no resolvable rate) — excluded from the EUR total.
      if (ecbRate === null) return sum;
      return sum.plus(new Decimal(p.positionValue).abs().mul(ecbRate));
    }, new Decimal(0));

  const accountsTotal = (cashBalances ?? [])
    .filter((cb) => new Decimal(cb.endingCash).greaterThan(0))
    .reduce((sum, cb) => {
      const values = cashValuesEur(cb, rateMap, year);
      return values ? sum.plus(Decimal.max(values.ending, values.averageQ4)) : sum;
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
  /** Optional: lots held at 31 December (TaxSummary.yearEndLots), one record per acquisition date */
  remainingLots?: Map<string, Lot[]>,
  cashBalances?: CashBalance[],
  /** Optional: the year's FIFO disposals, used to date and value the extinction ("C") records */
  disposals?: FifoDisposal[],
): string {
  const previousIsins = new Set(config.previousYearIsins ?? []);

  // Filter to stocks/funds/bonds and calculate EUR values
  // STK positions use Q4 average FX rate (media del cuarto trimestre);
  // FUND/BOND positions use Dec 31 spot rate (tipo de cambio a 31 de diciembre).
  const entries = positions
    .filter((p) => p.assetCategory === "STK" || p.assetCategory === "FUND" || p.assetCategory === "BOND")
    .flatMap((p) => {
      const ecbRate = getValuationRate(rateMap, config.year, p.currency, p.assetCategory);
      // Unvaluable position (no resolvable rate): cannot be written to the
      // fixed-width record without an EUR value — skip it. The caller surfaces a
      // warning so the user values and declares it manually.
      if (ecbRate === null) return [];
      const valueEur = new Decimal(p.positionValue).abs().mul(ecbRate);

      // One record per acquisition date of the lots held at year end
      const tranches = acquisitionTranches(new Decimal(p.quantity).abs(), valueEur, remainingLots?.get(p.isin));

      // Declaration type: A (new), M (existing), C (cancelled/sold)
      const declType: "A" | "M" | "C" = previousIsins.has(p.isin) ? "M" : "A";

      return [{ position: p, valueEur, tranches, declType }];
    });

  // "C" (cancelled) records for ISINs in previous year but no longer HELD, dated
  // and valued by the sale that ended the holding. Without such a sale the
  // record keeps a blank date and a zero value (see findUndatedExtinctions).
  const cancelledEntries = findCancelledIsins(positions, config.previousYearIsins).flatMap((isin) => {
    const tranches = extinctionTranches(isin, config.year, disposals);
    return tranches.length > 0
      ? tranches.map((t) => ({ isin, ...t }))
      : [{ isin, acquireDate: "", sellDate: "", valueEur: new Decimal(0) }];
  });

  // Category C: cash balances at foreign brokers
  const cashEntries = (cashBalances ?? [])
    .filter((cb) => new Decimal(cb.endingCash).greaterThan(0))
    .flatMap((cb) => {
      const values = cashValuesEur(cb, rateMap, config.year);
      return values ? [{ cashBalance: cb, valueEur: values.ending, averageQ4Eur: values.averageQ4 }] : [];
    });

  // Check 50,000 EUR threshold per category independently
  const totalValueV = entries.reduce((s, e) => s.plus(e.valueEur), new Decimal(0));
  const totalValueC = cashEntries.reduce((s, e) => s.plus(e.valueEur), new Decimal(0));
  const hasValuesRecords = totalValueV.greaterThanOrEqualTo(50000) || cancelledEntries.length > 0;
  const hasCashRecords = totalValueC.greaterThanOrEqualTo(50000);

  if (!hasValuesRecords && !hasCashRecords) {
    return "";
  }

  // Build records
  const detailRecords: string[] = [];

  // Category V records (securities)
  if (hasValuesRecords) {
    for (const e of entries) {
      for (const t of e.tranches) {
        detailRecords.push(buildDetailRecord(e.position, t.valueEur, t.quantity, config, t.date, e.declType));
      }
    }
    for (const c of cancelledEntries) {
      detailRecords.push(buildCancelledRecord(c, config));
    }
  }

  // Category C records (cash accounts)
  if (hasCashRecords) {
    for (const e of cashEntries) {
      detailRecords.push(buildCashAccountRecord(e.cashBalance, e.valueEur, e.averageQ4Eur, config));
    }
  }

  // Valoración 1 / Valoración 2 exactly as written in each type-2 record
  // (rounded to cents, signed): the type-1 sumas are the totals of those two
  // fields. V: 31-Dec value (a cancelled record: value at the extinction date) /
  // nothing. C: 31-Dec balance / Q4 average balance.
  const allEntries = [
    ...(hasValuesRecords
      ? [...entries.flatMap((e) => e.tranches), ...cancelledEntries].map((e) => ({ v1: writtenAmount(e.valueEur), v2: new Decimal(0) }))
      : []),
    ...(hasCashRecords
      ? cashEntries.map((e) => ({ v1: writtenAmount(e.valueEur), v2: writtenAmount(e.averageQ4Eur) }))
      : []),
  ];
  const summaryRecord = buildSummaryRecord(config, detailRecords.length, allEntries);

  return [summaryRecord, ...detailRecords].join("\n");
}

/** A date as the 8-digit YYYYMMDD the record fields carry. */
function recordDate(date: string): string {
  return normalizeDate(date).replace(/-/g, "").slice(0, 8);
}

/**
 * Split a held position into one tranche per acquisition date. The BOE asks for
 * "tantos registros como fechas de adquisición diferentes existan" (claves V and
 * I, field 415-422). The shares held at 31 December are the newest lots (FIFO,
 * Art. 37.2 LIRPF), so lots are taken newest first up to the position quantity;
 * a quantity the lots do not cover keeps a blank date. The value is prorated by
 * quantity, and the last tranche takes the remainder so the written amounts add
 * up to the position's written value.
 */
function acquisitionTranches(
  quantity: Decimal,
  valueEur: Decimal,
  lots: Lot[] | undefined,
): { date: string; quantity: Decimal; valueEur: Decimal }[] {
  const byDate = new Map<string, Decimal>();
  let left = quantity;
  const newestFirst = (lots ?? [])
    .filter((lot) => lot.quantity.greaterThan(0))
    .sort((a, b) => recordDate(b.acquireDate).localeCompare(recordDate(a.acquireDate)));
  for (const lot of newestFirst) {
    if (!left.greaterThan(0)) break;
    const taken = Decimal.min(lot.quantity, left);
    const date = recordDate(lot.acquireDate);
    byDate.set(date, (byDate.get(date) ?? new Decimal(0)).plus(taken));
    left = left.minus(taken);
  }
  if (left.greaterThan(0) || byDate.size === 0) byDate.set("", (byDate.get("") ?? new Decimal(0)).plus(left));

  const dates = [...byDate.keys()].sort();
  let written = new Decimal(0);
  return dates.map((date, i) => {
    const trancheQuantity = byDate.get(date)!;
    const trancheValue = i === dates.length - 1
      ? writtenAmount(valueEur).minus(written)
      : writtenAmount(valueEur.mul(trancheQuantity).div(quantity));
    written = written.plus(trancheValue);
    return { date, quantity: trancheQuantity, valueEur: trancheValue };
  });
}

/**
 * ISINs declared last year that are no longer held. Uses the held set (all
 * V-category positions), not the valued entries: a position that is still held
 * but couldn't be valued (no year-end rate) is skipped from the records, yet it
 * must NOT be reported as cancelled/sold (that would tell AEAT the user
 * liquidated an asset they still hold).
 */
function findCancelledIsins(positions: OpenPosition[], previousYearIsins: string[] | undefined): string[] {
  const heldIsins = new Set(
    positions
      .filter((p) => p.assetCategory === "STK" || p.assetCategory === "FUND" || p.assetCategory === "BOND")
      .map((p) => p.isin),
  );
  return [...new Set(previousYearIsins ?? [])].filter((isin) => !heldIsins.has(isin));
}

/**
 * The sale that ended the holding of a previously declared ISIN: its last sale
 * in the year. Its date is the extinction date (424-431) and its proceeds the
 * value at that date (valoración 1, "saldo ... en la fecha de extinción").
 * One tranche per acquisition date of the lots it consumed. A lot bought in the
 * declaration year cannot be the one declared last year (and a sale without
 * lots carries its own date), so those keep a blank acquisition date.
 */
function extinctionTranches(
  isin: string,
  year: number,
  disposals: FifoDisposal[] | undefined,
): { acquireDate: string; sellDate: string; valueEur: Decimal }[] {
  const sales = (disposals ?? []).filter(
    (d) => d.isin === isin && !d.isShort && recordDate(d.sellDate).startsWith(String(year)),
  );
  if (sales.length === 0) return [];
  const sellDate = sales.map((d) => recordDate(d.sellDate)).sort().at(-1)!;
  const byAcquireDate = new Map<string, Decimal>();
  for (const d of sales) {
    if (recordDate(d.sellDate) !== sellDate) continue;
    const acquired = recordDate(d.acquireDate);
    const key = acquired < `${year}0101` ? acquired : "";
    byAcquireDate.set(key, (byAcquireDate.get(key) ?? new Decimal(0)).plus(d.proceedsEur));
  }
  return [...byAcquireDate.keys()].sort().map((acquireDate) => ({
    acquireDate,
    sellDate,
    valueEur: byAcquireDate.get(acquireDate)!,
  }));
}

/**
 * ISINs declared last year, no longer held, and with no sale in the year to
 * date their extinction (a transfer out, or a sale outside the uploaded data).
 * Their "C" record is written with a blank extinction date and a zero value,
 * never an invented 31 December, so the caller must warn the user to fill both.
 */
export function findUndatedExtinctions(
  positions: OpenPosition[],
  config: Pick<Modelo720Config, "year" | "previousYearIsins">,
  disposals?: FifoDisposal[],
): string[] {
  return findCancelledIsins(positions, config.previousYearIsins).filter(
    (isin) => extinctionTranches(isin, config.year, disposals).length === 0,
  );
}

/**
 * The ISINs a previous year's Modelo 720 file declared as still held, for
 * `modelo720 --previous-720`: securities records (clave 102 = "V") whose origin
 * (423) is not "C". An extinction was already declared gone, and an account
 * record ("C" at 102) carries an account id at 132-143, not an ISIN.
 */
export function parsePrevious720Isins(content: string): string[] {
  const isins = content
    .split("\n")
    .filter((line) => line[0] === "2" && line[101] === "V" && line[422] !== "C")
    .map((line) => line.slice(131, 143).trim())
    .filter((isin) => isin.length > 0);
  return [...new Set(isins)];
}

function pad(value: string, length: number, char = " ", alignRight = false): string {
  if (alignRight) {
    return value.slice(0, length).padStart(length, char);
  }
  return value.slice(0, length).padEnd(length, char);
}

/**
 * Format a free-text field (names, addresses, entity descriptions) into a
 * fixed-width column.
 *
 * Unlike numeric/coded fields, free text can come straight from a broker export
 * (e.g. a security/entity name) and may contain control characters or newlines.
 * Those bytes would corrupt the fixed-width 500-byte AEAT record (a newline ends
 * the record early; a control char shifts the visible glyph stream and can inject
 * into adjacent fields). We replace every control character — C0 (\x00-\x1F incl.
 * TAB/CR/LF), DEL (\x7F) and C1 (\x80-\x9F) — with a single space BEFORE slicing
 * and padding, so column widths and positions are identical to a clean value.
 *
 * @param value - Raw text (possibly broker-supplied)
 * @param length - Fixed column width in characters
 * @param alignRight - Right-align (pad on the left) instead of left-align
 */
function fixedWidthText(value: string, length: number, alignRight = false): string {
  const sanitized = value.replace(/[\x00-\x1F\x7F-\x9F]/g, " ");
  return pad(sanitized, length, " ", alignRight);
}

function numPad(value: string, intLen: number, decLen: number): string {
  // Round to `decLen` decimals (ROUND_HALF_UP) BEFORE splitting int/frac, so
  // AEAT receives rounded values (not truncated) and any rounding that bumps
  // the integer part (e.g. 1.999 → 2.00) is reflected in the integer field.
  const dec = new Decimal(value).abs().toDecimalPlaces(decLen, Decimal.ROUND_HALF_UP);
  const intDigits = dec.floor().toString();
  if (intDigits.length > intLen) {
    // A rounding carry (or an oversized input) pushed the integer part past the
    // fixed field width. Padding would silently shift every following byte and
    // corrupt the 500-byte record — fail fast instead.
    throw new Error(`Modelo 720: importe ${dec.toString()} excede el campo de ${intLen} dígitos enteros`);
  }
  const intPart = intDigits.padStart(intLen, "0");
  const fracPart = dec.minus(dec.floor()).mul(new Decimal(10).pow(decLen)).round().toString().padStart(decLen, "0");
  return intPart + fracPart;
}

/**
 * An amount as a type-2 valoración carries it: rounded half-up to cents, with
 * its sign. The type-1 sumas add up these values, not the unrounded ones, so
 * the totals match the details to the cent.
 */
function writtenAmount(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Sign column plus 14-digit importe (12 integer + 2 decimals) of a type-2
 * valoración: "N" when the written amount is negative, a space otherwise.
 */
function valoracionField(value: Decimal): string {
  const written = writtenAmount(value);
  return (written.lessThan(0) ? "N" : " ") + numPad(written.toString(), 12, 2);
}

function buildSummaryRecord(
  config: Modelo720Config,
  detailCount: number,
  entries: { v1: Decimal; v2: Decimal }[],
): string {
  const totalV1 = entries.reduce((s, e) => s.plus(e.v1), new Decimal(0));
  const totalV2 = entries.reduce((s, e) => s.plus(e.v2), new Decimal(0));

  let record = "";
  record += "1";                                              // 1: Register type
  record += "720";                                            // 2-4: Model
  record += config.year.toString();                           // 5-8: Year
  record += pad(config.nif, 9, " ", true);                    // 9-17: NIF
  record += fixedWidthText(config.surname + " " + config.name, 40); // 18-57: Name
  record += "T";                                              // 58: Transmission type
  record += pad(config.phone, 9, "0", true);                  // 59-67: Phone
  record += fixedWidthText(config.contactName, 40);           // 68-107: Contact
  record += pad(config.declarationId, 13, "0", true);         // 108-120: Declaration ID
  record += config.isComplementary ? "C" : " ";               // 121: Complementary
  record += config.isReplacement ? "S" : " ";                 // 122: Replacement
  record += pad(config.previousDeclarationId ?? "", 13, "0", true); // 123-135: Previous ID
  record += detailCount.toString().padStart(9, "0");          // 136-144: Detail count
  record += totalV1.isNegative() ? "N" : " ";                // 145: Suma valoración 1 sign
  record += numPad(totalV1.toString(), 15, 2);                // 146-162: Suma valoración 1
  record += totalV2.isNegative() ? "N" : " ";                // 163: Suma valoración 2 sign
  record += numPad(totalV2.toString(), 15, 2);                // 164-180: Suma valoración 2
  record += pad("", 320);                                     // 181-500: Blank

  return record;
}

function buildDetailRecord(
  pos: OpenPosition,
  valueEur: Decimal,
  quantity: Decimal,
  config: Modelo720Config,
  acquisitionDate: string,
  declType: "A" | "M" | "C",
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
  record += fixedWidthText(config.surname + " " + config.name, 40); // 36-75: Name (declarant/holder)
  record += "1";                                              // 76: Declaration type (owner)
  record += pad("", 25);                                      // 77-101: Reserved
  record += "V";                                              // 102: Asset type (stocks)
  record += pad("", 26);                                      // 103-128: Reserved
  record += pad(countryCode, 2);                              // 129-130: Country code (from ISIN)
  record += "1";                                              // 131: ID type (ISIN)
  record += pad(pos.isin, 12);                                // 132-143: ISIN
  record += pad("", 46);                                      // 144-189: Reserved
  record += fixedWidthText(pos.description, 41);              // 190-230: Entity name
  record += pad("", 184);                                     // 231-414: Reserved
  record += pad(acquisitionDate, 8);                          // 415-422: Acquisition date (YYYYMMDD)
  record += declType;                                         // 423: Type (A=new, M=existing, C=cancelled)
  record += pad("", 8);                                       // 424-431: Sell date
  record += valoracionField(valueEur);                        // 432-446: Valoración 1 sign + value at Dec 31
  record += " ";                                              // 447: Valoración 2 sign
  record += numPad("0", 12, 2);                               // 448-461: Valoración 2 (not informed for V)
  record += "A";                                              // 462: Clave de representación (book entry)
  record += numPad(quantity.toString(), 10, 2);               // 463-474: Número de valores
  record += pad("", 1);                                       // 475: Clave tipo inmueble (B only)
  record += numPad("100", 3, 2);                              // 476-480: Ownership %
  record += pad("", 20);                                      // 481-500: Blank

  return record;
}

/**
 * Build a "C" (cancelled) detail record for an ISIN that was declared
 * in the previous year but no longer held.
 */
function buildCancelledRecord(
  entry: { isin: string; acquireDate: string; sellDate: string; valueEur: Decimal },
  config: Modelo720Config,
): string {
  const { isin } = entry;
  const countryCode = isin.length >= 2 ? isin.slice(0, 2).toUpperCase() : "  ";

  let record = "";
  record += "2";                                              // 1: Register type
  record += "720";                                            // 2-4: Model
  record += config.year.toString();                           // 5-8: Year
  record += pad(config.nif, 9, " ", true);                    // 9-17: NIF
  record += pad(config.nif, 9, " ", true);                    // 18-26: Declared NIF
  record += pad("", 9);                                       // 27-35: Proxy NIF
  record += fixedWidthText(config.surname + " " + config.name, 40); // 36-75: Name (declarant/holder)
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
  record += pad(entry.acquireDate, 8);                        // 415-422: Acquisition date of the lot sold
  record += "C";                                              // 423: Type (C=cancelled)
  record += pad(entry.sellDate, 8);                           // 424-431: Extinction date (the last sale)
  record += valoracionField(entry.valueEur);                  // 432-446: Valoración 1 sign + value at the extinction date
  record += " ";                                              // 447: Valoración 2 sign
  record += numPad("0", 12, 2);                               // 448-461: Valoración 2 (0)
  record += "A";                                              // 462: Clave de representación (book entry)
  record += numPad("0", 10, 2);                               // 463-474: Número de valores (0)
  record += pad("", 1);                                       // 475: Clave tipo inmueble (B only)
  record += numPad("100", 3, 2);                              // 476-480: Ownership %
  record += pad("", 20);                                      // 481-500: Blank

  return record;
}

/**
 * Build a Category C (Cuentas) detail record for a cash balance
 * at a foreign broker.
 */
function buildCashAccountRecord(
  cb: CashBalance,
  valueEur: Decimal,
  averageQ4Eur: Decimal,
  config: Modelo720Config,
): string {
  const brokerName = cb.institutionName ?? "FOREIGN BROKER";
  const countryCode = cb.countryCode ?? "XX";

  let record = "";
  record += "2";                                              // 1: Register type
  record += "720";                                            // 2-4: Model
  record += config.year.toString();                           // 5-8: Year
  record += pad(config.nif, 9, " ", true);                    // 9-17: NIF
  record += pad(config.nif, 9, " ", true);                    // 18-26: Declared NIF
  record += pad("", 9);                                       // 27-35: Proxy NIF
  record += fixedWidthText(brokerName, 40);                   // 36-75: Entity name
  record += "1";                                              // 76: Declaration type (owner)
  record += pad("", 25);                                      // 77-101: Reserved
  record += "C";                                              // 102: Asset type (accounts)
  record += pad("", 26);                                      // 103-128: Reserved
  record += pad(countryCode, 2);                              // 129-130: Country code
  record += "5";                                              // 131: ID type (other)
  record += pad(cb.accountId || config.nif, 12);              // 132-143: Account identifier
  record += pad("", 46);                                      // 144-189: Reserved
  record += fixedWidthText(brokerName, 41);                   // 190-230: Entity name
  record += pad("", 184);                                     // 231-414: Reserved
  record += pad((cb.openedDate ?? "").replace(/-/g, "").slice(0, 8), 8); // 415-422: Opening date
  record += "A";                                              // 423: Type (A=new)
  record += pad("", 8);                                       // 424-431: Close date
  record += valoracionField(valueEur);                        // 432-446: Valoración 1 sign + balance at Dec 31
  record += valoracionField(averageQ4Eur);                    // 447-461: Valoración 2 sign + Q4 average balance
  record += pad("", 1);                                       // 462: Clave de representación (V/I only)
  record += numPad("0", 10, 2);                               // 463-474: Número de valores (V/I only, zeros)
  record += pad("", 1);                                       // 475: Clave tipo inmueble (B only)
  record += numPad("100", 3, 2);                              // 476-480: Ownership %
  record += pad("", 20);                                      // 481-500: Blank

  return record;
}
