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
import { getQ4AverageRate, lookupPositionRate } from "../engine/ecb.js";
import { isIsoCountryCode } from "./modelo720-validator.js";

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
 *  - Valores (stocks, bonds) — "V", and foreign funds (IIC) — "I", measured together
 *  - Cuentas (bank accounts) — "C"
 *  - Bienes inmuebles (real estate) — "B" (not implemented in broker positions)
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

/**
 * Country written in positions 129-130 of a security record, or null when it is
 * unknown. Clave V: where the securities are deposited (the broker's country).
 * Clave I (foreign funds): where the fund is situated, which the ISIN's country
 * prefix gives.
 */
export function modelo720PositionCountry(p: OpenPosition): string | null {
  const code = (p.assetCategory === "FUND" ? p.isin.slice(0, 2) : p.custodianCountry ?? "").toUpperCase();
  return isIsoCountryCode(code) ? code : null;
}

/**
 * A security last year's file declared (a V or I record): the ISIN, the clave
 * and subclave (102-103) and the country (129-130) it was written with. A
 * cancelled record (origin C) this year repeats them.
 */
export interface Previous720Security {
  isin: string;
  claveSubclave: string;
  country: string;
}

/**
 * Something the 720 file cannot carry, so the user must declare it by hand:
 * a security with no ISIN (the BOE then wants "Z" + the issuer's country, which
 * no broker export gives us), a security or account whose country is unknown,
 * an account with no account code, or a sale of a security whose country in
 * last year's file is not a valid code (a file written by an older version).
 */
export type Modelo720Omission =
  | { kind: "position"; reason: "no_isin" | "no_country"; position: OpenPosition }
  | { kind: "cash"; reason: "no_country" | "no_account"; cashBalance: CashBalance }
  | { kind: "cancelled"; reason: "no_country"; security: Previous720Security };

function positionOmission(p: OpenPosition): "no_isin" | "no_country" | null {
  if (p.isin.trim() === "") return "no_isin";
  if (modelo720PositionCountry(p) === null) return "no_country";
  return null;
}

/** 144 + 156-189: "I" and the compact IBAN, or "O" and the broker's own account number. */
function accountCode(cb: CashBalance): { key: "I" | "O"; code: string } {
  const compact = cb.accountId.replace(/\s/g, "").toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)
    ? { key: "I", code: compact }
    : { key: "O", code: fixedWidthText(cb.accountId, 34).trim() };
}

function cashOmission(cb: CashBalance): "no_country" | "no_account" | null {
  if (cb.accountId.trim() === "") return "no_account";
  if (!isIsoCountryCode((cb.countryCode ?? "").toUpperCase())) return "no_country";
  return null;
}

function isValuesCategory(p: OpenPosition): boolean {
  return p.assetCategory === "STK" || p.assetCategory === "FUND" || p.assetCategory === "BOND";
}

/**
 * The securities, sales and cash accounts that `generateModelo720` leaves out
 * of the file. Only categories the file has to carry count: an asset below the
 * 50,000 EUR threshold is not declared at all, so it is never an omission.
 * Callers show them so the user declares them by hand.
 */
export function findModelo720Omissions(
  positions: OpenPosition[],
  rateMap: EcbRateMap,
  config: Modelo720PlanConfig,
  cashBalances?: CashBalance[],
): Modelo720Omission[] {
  return plan720(positions, rateMap, config, undefined, cashBalances).omissions;
}

/**
 * Número identificativo de la declaración (type 1, 108-120): 13 digits whose
 * first three are 720 (Orden HAP/72/2013, art. 1). The other ten are the Unix
 * time in seconds, so two files generated apart never share a number.
 */
export function modelo720DeclarationId(now: Date = new Date()): string {
  return "720" + String(Math.floor(now.getTime() / 1000) % 10_000_000_000).padStart(10, "0");
}

/**
 * Read last year's 720 file: its V/I records (ISIN, clave + subclave, country)
 * and the account codes of its C records, which decide the A/M/C origin (423)
 * this year.
 */
export function readPrevious720(content: string): { securities: Previous720Security[]; accounts: string[] } {
  const details = content.split(/\r?\n/).filter((line) => line.startsWith("2"));
  return {
    securities: details
      .filter((line) => line[101] === "V" || line[101] === "I")
      .map((line) => ({ isin: line.slice(131, 143).trim(), claveSubclave: line.slice(101, 103), country: line.slice(128, 130) }))
      .filter((security) => security.isin.length > 0),
    accounts: details
      .filter((line) => line[101] === "C")
      .map((line) => line.slice(155, 189).trim())
      .filter((account) => account.length > 0),
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
  /** V/I records of the previous year's 720 (readPrevious720): A/M origin, and the C records of what was sold */
  previousYearSecurities?: Previous720Security[];
  /** Account codes (156-189) declared in the previous year's 720 — A or M for cash accounts */
  previousYearAccounts?: string[];
  /**
   * Number of holders sharing every asset (profile titulares). Each declares
   * 100 / titulares % in 476-480 and the full, unprorated value. Default 1.
   */
  titulares?: number;
}

/** The parts of the config that decide which records the file carries. */
type Modelo720PlanConfig = Pick<Modelo720Config, "year" | "previousYearSecurities" | "previousYearAccounts">;

/**
 * What the 720 file carries and what it leaves out. The 50,000 EUR threshold
 * applies per category (V/I securities, C accounts); a category below it is not
 * declared, so nothing in it is written or reported as omitted.
 */
function plan720(
  positions: OpenPosition[],
  rateMap: EcbRateMap,
  config: Modelo720PlanConfig,
  remainingLots?: Map<string, Lot[]>,
  cashBalances?: CashBalance[],
) {
  const previousSecurities = config.previousYearSecurities ?? [];
  const previousIsins = new Set(previousSecurities.map((s) => s.isin));

  // Filter to stocks/funds/bonds and calculate EUR values
  // STK positions use Q4 average FX rate (media del cuarto trimestre);
  // FUND/BOND positions use Dec 31 spot rate (tipo de cambio a 31 de diciembre).
  const entries = positions
    .filter(isValuesCategory)
    .flatMap((p) => {
      const ecbRate = getValuationRate(rateMap, config.year, p.currency, p.assetCategory);
      // Unvaluable position (no resolvable rate): cannot be written to the
      // fixed-width record without an EUR value — skip it. The caller surfaces a
      // warning so the user values and declares it manually.
      if (ecbRate === null) return [];
      const valueEur = new Decimal(p.positionValue).abs().mul(ecbRate);

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
      const declType: "A" | "M" = previousIsins.has(p.isin) ? "M" : "A";

      // Counts toward the 50,000 EUR threshold even when the file cannot carry it.
      return [{ position: p, valueEur, firstAcquisitionDate, declType, omission: positionOmission(p) }];
    });

  // "C" (cancelled) records for last year's securities no longer HELD. Use the
  // held set (all V-category positions), NOT `entries` — a position that is
  // still held but couldn't be valued (no year-end rate) is skipped from
  // `entries`, yet it must NOT be reported as cancelled/sold (that would tell
  // AEAT the user liquidated an asset they still hold).
  const heldIsins = new Set(positions.filter(isValuesCategory).map((p) => p.isin));
  const cancelled = previousSecurities.filter((s) => !heldIsins.has(s.isin));

  // Category C: cash balances at foreign brokers
  const previousAccounts = new Set(config.previousYearAccounts ?? []);
  const cashEntries = (cashBalances ?? [])
    .filter((cb) => new Decimal(cb.endingCash).greaterThan(0))
    .flatMap((cb) => {
      const values = cashValuesEur(cb, rateMap, config.year);
      return values
        ? [{
          cashBalance: cb,
          valueEur: values.ending,
          averageQ4Eur: values.averageQ4,
          declType: previousAccounts.has(accountCode(cb).code) ? "M" as const : "A" as const,
          omission: cashOmission(cb),
        }]
        : [];
    });

  // Check 50,000 EUR threshold per category independently
  const totalValueV = entries.reduce((s, e) => s.plus(e.valueEur), new Decimal(0));
  const totalValueC = cashEntries.reduce((s, e) => s.plus(e.valueEur), new Decimal(0));
  const hasValuesRecords = totalValueV.greaterThanOrEqualTo(50000) || cancelled.length > 0;
  const hasCashRecords = totalValueC.greaterThanOrEqualTo(50000);

  const omissions: Modelo720Omission[] = [];
  if (hasValuesRecords) {
    for (const e of entries) {
      if (e.omission) omissions.push({ kind: "position", reason: e.omission, position: e.position });
    }
    // Last year's file wrote an invalid country (an older version wrote the
    // ISIN prefix, e.g. XS): repeating it would make AEAT reject the file.
    for (const security of cancelled) {
      if (!isIsoCountryCode(security.country)) omissions.push({ kind: "cancelled", reason: "no_country", security });
    }
  }
  if (hasCashRecords) {
    for (const e of cashEntries) {
      if (e.omission) omissions.push({ kind: "cash", reason: e.omission, cashBalance: e.cashBalance });
    }
  }

  return {
    entries: hasValuesRecords ? entries.filter((e) => e.omission === null) : [],
    cancelled: hasValuesRecords ? cancelled.filter((s) => isIsoCountryCode(s.country)) : [],
    cashEntries: hasCashRecords ? cashEntries.filter((e) => e.omission === null) : [],
    omissions,
  };
}

/**
 * Generate a Modelo 720 fixed-width text file from open positions.
 *
 * Only includes positions where total value per category exceeds 50,000 EUR.
 * `findModelo720Omissions` lists what the file had to leave out.
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
  cashBalances?: CashBalance[],
): string {
  const { entries, cancelled, cashEntries } = plan720(positions, rateMap, config, remainingLots, cashBalances);

  const detailRecords = [
    ...entries.map((e) => buildDetailRecord(e.position, e.valueEur, config, e.firstAcquisitionDate, e.declType)),
    ...cancelled.map((s) => buildCancelledRecord(s, config)),
    ...cashEntries.map((e) => buildCashAccountRecord(e.cashBalance, e.valueEur, e.averageQ4Eur, config, e.declType)),
  ];

  // Below both thresholds, or everything above them had to be left out: no file.
  if (detailRecords.length === 0) {
    return "";
  }

  // Valoración 1 / Valoración 2 exactly as written in each type-2 record
  // (rounded to cents, signed): the type-1 sumas are the totals of those two
  // fields (cancelled records add 0). V: 31-Dec value / nothing. C: 31-Dec
  // balance / Q4 average balance.
  const allEntries = [
    ...entries.map((e) => ({ v1: writtenAmount(e.valueEur), v2: new Decimal(0) })),
    ...cashEntries.map((e) => ({ v1: writtenAmount(e.valueEur), v2: writtenAmount(e.averageQ4Eur) })),
  ];
  const summaryRecord = buildSummaryRecord(config, detailRecords.length, allEntries);

  return [summaryRecord, ...detailRecords].join("\n");
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
  const sanitized = value
    // The BOE wants every text field "en mayúsculas sin caracteres especiales,
    // y sin vocales acentuadas", with Ñ and Ç kept: split each letter from its
    // accent, drop every accent except the tilde on N and the cedilla on C.
    .normalize("NFD")
    .replace(/(?<![Nn])\u0303|(?<![Cc])\u0327|[\u0300-\u0302\u0304-\u0326\u0328-\u036f]/g, "")
    .normalize("NFC")
    .toUpperCase()
    .replace(/[\x00-\x1F\x7F-\x9F]/g, " ")
    // Anything left outside Latin-1 has no byte in the file.
    .replace(/[^\x00-\xFF]/g, " ");
  return pad(sanitized, length, " ", alignRight);
}

/** Declarant's name as positions 18-57 (type 1) and 36-75 (type 2) carry it. */
function declarantName(config: Modelo720Config): string {
  return fixedWidthText(config.surname + " " + config.name, 40);
}

/**
 * Teléfono (type 1, 59-67): nine digits. Drops spaces, signs and the +34 / 0034
 * prefix, keeping the last nine digits.
 */
function phoneField(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length > 9 && digits.startsWith("0034")) digits = digits.slice(4);
  else if (digits.length > 9 && digits.startsWith("34")) digits = digits.slice(2);
  return digits.slice(-9).padStart(9, "0");
}

/** Porcentaje de participación (476-480): each holder's equal share. */
function ownershipField(config: Modelo720Config): string {
  const titulares = config.titulares ?? 1;
  if (!Number.isInteger(titulares) || titulares < 1) {
    throw new Error(`Modelo 720: número de titulares inválido: ${titulares}`);
  }
  return numPad(new Decimal(100).div(titulares).toString(), 3, 2);
}

/** Clave (102) and subclave (103) of a security record. */
function claveSubclave(assetCategory: string): string {
  if (assetCategory === "FUND") return "I0"; // IIC situated abroad; subclave "a cero"
  if (assetCategory === "BOND") return "V2"; // cesión de capitales propios a terceros
  return "V1"; // participación en entidades jurídicas
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
  record += declarantName(config);                            // 18-57: Name
  record += "T";                                              // 58: Transmission type
  record += phoneField(config.phone);                         // 59-67: Phone
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
  config: Modelo720Config,
  firstAcquisitionDate?: string,
  declType: "A" | "M" | "C" = "M",
): string {
  const countryCode = modelo720PositionCountry(pos) ?? "  ";

  let record = "";
  record += "2";                                              // 1: Register type
  record += "720";                                            // 2-4: Model
  record += config.year.toString();                           // 5-8: Year
  record += pad(config.nif, 9, " ", true);                    // 9-17: NIF
  record += pad(config.nif, 9, " ", true);                    // 18-26: Declared NIF
  record += pad("", 9);                                       // 27-35: Proxy NIF
  record += declarantName(config);                            // 36-75: Name (declarant/holder)
  record += "1";                                              // 76: Declaration type (owner)
  record += pad("", 25);                                      // 77-101: Reserved
  record += claveSubclave(pos.assetCategory);                 // 102-103: Clave (V/I) + subclave
  record += pad("", 25);                                      // 104-128: Tipo de derecho real (B only)
  record += pad(countryCode, 2);                              // 129-130: Custodian (V) or fund (I) country
  record += "1";                                              // 131: ID type (ISIN)
  record += pad(pos.isin, 12);                                // 132-143: ISIN
  record += pad("", 46);                                      // 144-189: Reserved
  record += fixedWidthText(pos.description, 41);              // 190-230: Entity name
  record += pad("", 184);                                     // 231-414: Reserved
  record += pad((firstAcquisitionDate ?? "").replace(/-/g, "").slice(0, 8), 8); // 415-422: First acquisition date (YYYYMMDD)
  record += declType;                                         // 423: Type (A=new, M=existing, C=cancelled)
  record += pad("", 8);                                       // 424-431: Sell date
  record += valoracionField(valueEur);                        // 432-446: Valoración 1 sign + value at Dec 31
  record += " ";                                              // 447: Valoración 2 sign
  record += numPad("0", 12, 2);                               // 448-461: Valoración 2 (not informed for V)
  record += "A";                                              // 462: Clave de representación (book entry)
  record += numPad(new Decimal(pos.quantity).abs().toString(), 10, 2); // 463-474: Número de valores
  record += pad("", 1);                                       // 475: Clave tipo inmueble (B only)
  record += ownershipField(config);                           // 476-480: Ownership %
  record += pad("", 20);                                      // 481-500: Blank

  return record;
}

/**
 * Build a "C" (cancelled) detail record for a security declared in the
 * previous year but no longer held. It repeats last year's clave, subclave and
 * country so AEAT matches it to the record it cancels.
 */
function buildCancelledRecord(security: Previous720Security, config: Modelo720Config): string {
  const yearEnd = `${config.year}1231`;

  let record = "";
  record += "2";                                              // 1: Register type
  record += "720";                                            // 2-4: Model
  record += config.year.toString();                           // 5-8: Year
  record += pad(config.nif, 9, " ", true);                    // 9-17: NIF
  record += pad(config.nif, 9, " ", true);                    // 18-26: Declared NIF
  record += pad("", 9);                                       // 27-35: Proxy NIF
  record += declarantName(config);                            // 36-75: Name (declarant/holder)
  record += "1";                                              // 76: Declaration type (owner)
  record += pad("", 25);                                      // 77-101: Reserved
  record += pad(security.claveSubclave, 2);                   // 102-103: Clave + subclave, as last year
  record += pad("", 25);                                      // 104-128: Tipo de derecho real (B only)
  record += pad(security.country, 2);                         // 129-130: Country code, as last year
  record += "1";                                              // 131: ID type (ISIN)
  record += pad(security.isin, 12);                           // 132-143: ISIN
  record += pad("", 46);                                      // 144-189: Reserved
  record += pad("", 41);                                      // 190-230: Entity name
  record += pad("", 184);                                     // 231-414: Reserved
  record += pad("", 8);                                       // 415-422: First acquisition date
  record += "C";                                              // 423: Type (C=cancelled)
  record += pad(yearEnd, 8);                                  // 424-431: Sell/cancellation date
  record += " ";                                              // 432: Valoración 1 sign
  record += numPad("0", 12, 2);                               // 433-446: Valoración 1 (0)
  record += " ";                                              // 447: Valoración 2 sign
  record += numPad("0", 12, 2);                               // 448-461: Valoración 2 (0)
  record += "A";                                              // 462: Clave de representación (book entry)
  record += numPad("0", 10, 2);                               // 463-474: Número de valores (0)
  record += pad("", 1);                                       // 475: Clave tipo inmueble (B only)
  record += ownershipField(config);                           // 476-480: Ownership %
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
  declType: "A" | "M",
): string {
  const brokerName = cb.institutionName ?? "FOREIGN BROKER";
  // Callers skip accounts without a valid country (cashOmission).
  const countryCode = (cb.countryCode ?? "").toUpperCase();
  const account = accountCode(cb);

  let record = "";
  record += "2";                                              // 1: Register type
  record += "720";                                            // 2-4: Model
  record += config.year.toString();                           // 5-8: Year
  record += pad(config.nif, 9, " ", true);                    // 9-17: NIF
  record += pad(config.nif, 9, " ", true);                    // 18-26: Declared NIF
  record += pad("", 9);                                       // 27-35: Proxy NIF
  record += declarantName(config);                            // 36-75: Name (declarant/holder)
  record += "1";                                              // 76: Declaration type (owner)
  record += pad("", 25);                                      // 77-101: Reserved
  record += "C5";                                             // 102-103: Clave C + subclave 5 (otras cuentas)
  record += pad("", 25);                                      // 104-128: Tipo de derecho real (B only)
  record += pad(countryCode, 2);                              // 129-130: Country code
  record += "0";                                              // 131: Clave de identificación (V/I only, a cero)
  record += pad("", 12);                                      // 132-143: Identificación de valores (V/I only)
  record += account.key;                                      // 144: Clave identificación de cuenta (I=IBAN, O=other)
  record += pad("", 11);                                      // 145-155: BIC (not in broker exports)
  record += pad(account.code, 34);                            // 156-189: Código de cuenta
  record += fixedWidthText(brokerName, 41);                   // 190-230: Entity name
  record += pad("", 184);                                     // 231-414: Reserved
  record += pad((cb.openedDate ?? "").replace(/-/g, "").slice(0, 8), 8); // 415-422: Opening date
  record += declType;                                         // 423: Type (A=new, M=declared before)
  record += pad("", 8);                                       // 424-431: Close date
  record += valoracionField(valueEur);                        // 432-446: Valoración 1 sign + balance at Dec 31
  record += valoracionField(averageQ4Eur);                    // 447-461: Valoración 2 sign + Q4 average balance
  record += pad("", 1);                                       // 462: Clave de representación (V/I only)
  record += numPad("0", 10, 2);                               // 463-474: Número de valores (V/I only, zeros)
  record += pad("", 1);                                       // 475: Clave tipo inmueble (B only)
  record += ownershipField(config);                           // 476-480: Ownership %
  record += pad("", 20);                                      // 481-500: Blank

  return record;
}
