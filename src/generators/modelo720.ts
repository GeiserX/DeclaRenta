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
import { getQ4AverageRate, hasNoMarketValue, lookupPositionRate } from "../engine/ecb.js";
import { normalizeDate } from "../engine/dates.js";
import { isClaveSubclave, isIsoCountryCode } from "./modelo720-validator.js";

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
  /**
   * `unvalued`: held securities left out of `total` because they have no
   * year-end rate or no market value. Their EUR value is unknown, so while it
   * is above 0 the category cannot be called below the threshold.
   */
  values: { exceeds: boolean; total: Decimal; unvalued: number };
  accounts: { exceeds: boolean; total: Decimal };
  realEstate: { exceeds: boolean; total: Decimal };
}

/** 720 threshold: a category is declared only when its joint value is MORE than 50,000 € ("no superen"). */
const THRESHOLD = new Decimal(50000);

/**
 * A V-category holding: a long stock, fund or bond. A short position
 * (negative value) is stock the taxpayer owes, not an asset they own.
 */
function isHeldSecurity(p: OpenPosition): boolean {
  return (p.assetCategory === "STK" || p.assetCategory === "FUND" || p.assetCategory === "BOND")
    && !new Decimal(p.positionValue).isNegative();
}

/**
 * A cash balance in EUR. The Q4 average is null when the statement does not
 * carry it (IBKR's cash report has no such field): the 31-Dec balance still
 * counts toward the obligation, but the record cannot be written without it.
 */
function cashValuesEur(cb: CashBalance, rateMap: EcbRateMap, year: number): { ending: Decimal; averageQ4: Decimal | null } | undefined {
  const yearEnd = `${year}-12-31`;
  const ecbRate = lookupPositionRate(rateMap, yearEnd, cb.currency);
  // No resolvable rate → cannot value this balance in EUR; skip it (surfaced
  // for manual review) rather than crash the threshold check / file generation.
  if (ecbRate === null) return undefined;
  return {
    ending: new Decimal(cb.endingCash).mul(ecbRate),
    averageQ4: cb.averageQ4Cash ? new Decimal(cb.averageQ4Cash).mul(ecbRate) : null,
  };
}

/**
 * The two joint sums art. 42 bis.4.e RD 1065/2007 tests for accounts: the
 * 31-Dec balances and the Q4 average balances, each summed over every
 * account. The category must be declared when EITHER passes 50,000 €.
 */
function cashCategoryTotals(
  cashBalances: CashBalance[] | undefined,
  rateMap: EcbRateMap,
  year: number,
): { endingTotal: Decimal; averageTotal: Decimal; exceeds: boolean } {
  let endingTotal = new Decimal(0);
  let averageTotal = new Decimal(0);
  for (const cb of cashBalances ?? []) {
    if (!new Decimal(cb.endingCash).greaterThan(0)) continue;
    const values = cashValuesEur(cb, rateMap, year);
    if (!values) continue;
    endingTotal = endingTotal.plus(values.ending);
    if (values.averageQ4) averageTotal = averageTotal.plus(values.averageQ4);
  }
  return {
    endingTotal,
    averageTotal,
    exceeds: endingTotal.greaterThan(THRESHOLD) || averageTotal.greaterThan(THRESHOLD),
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
 * Only categories exceeding 50K must be declared. For accounts the total is
 * the larger of the two joint sums (31-Dec balances, Q4 averages).
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
  // Calculate total value for securities (V category: long STK, FUND, BOND)
  let valuesTotal = new Decimal(0);
  let unvalued = 0;
  for (const p of positions.filter(isHeldSecurity)) {
    const ecbRate = getValuationRate(rateMap, year, p.currency, p.assetCategory);
    // Unvaluable position (no resolvable rate, or no market value in the
    // export): excluded from the EUR total and counted, never added as 0 €.
    if (ecbRate === null || hasNoMarketValue(p)) {
      unvalued++;
      continue;
    }
    valuesTotal = valuesTotal.plus(new Decimal(p.positionValue).abs().mul(ecbRate));
  }

  const cash = cashCategoryTotals(cashBalances, rateMap, year);

  const realEstateTotal = new Decimal(0);

  return {
    values: { exceeds: valuesTotal.greaterThan(THRESHOLD), total: valuesTotal, unvalued },
    accounts: { exceeds: cash.exceeds, total: Decimal.max(cash.endingTotal, cash.averageTotal) },
    realEstate: { exceeds: realEstateTotal.greaterThan(THRESHOLD), total: realEstateTotal },
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
 * and subclave (102-103), the country (129-130) and the acquisition date
 * (415-422) it was written with. A cancelled record (origin C) this year
 * repeats the codes of the record with its own acquisition date.
 */
export interface Previous720Security {
  isin: string;
  claveSubclave: string;
  country: string;
  acquireDate?: string;
}

/**
 * Something the 720 file cannot carry, so the user must declare it by hand:
 * a security with no ISIN (the BOE then wants "Z" + the issuer's country, which
 * no broker export gives us), a security or account whose country is unknown,
 * an account with no account code, or a sale of a security whose clave,
 * subclave or country in last year's file is not a valid code (a file written
 * by an older version, which left 103 blank and wrote the ISIN prefix at 129-130).
 */
export type Modelo720Omission =
  | { kind: "position"; reason: "no_isin" | "no_country"; position: OpenPosition }
  | { kind: "cash"; reason: "no_country" | "no_account"; cashBalance: CashBalance }
  | { kind: "cancelled"; reason: "invalid_code"; security: Previous720Security };

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
 * this year. Records whose origin is C were sold or closed last year, so they
 * are not held any more and are skipped.
 */
export function readPrevious720(content: string): { securities: Previous720Security[]; accounts: string[] } {
  const details = content.split(/\r?\n/).filter((line) => line.startsWith("2") && line[422] !== "C");
  return {
    securities: details
      .filter((line) => line[101] === "V" || line[101] === "I")
      .map((line) => ({
        isin: line.slice(131, 143).trim(),
        claveSubclave: line.slice(101, 103),
        country: line.slice(128, 130),
        acquireDate: line.slice(414, 422).trim() || undefined,
      }))
      .filter((security) => security.isin.length > 0),
    accounts: details
      .filter((line) => line[101] === "C")
      // Versions before 0.59.0 wrote the account in 132-143 and left 156-189 blank.
      .map((line) => line.slice(155, 189).trim() || line.slice(131, 143).trim())
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
  disposals?: FifoDisposal[],
) {
  const previousIsins = new Set((config.previousYearSecurities ?? []).map((s) => s.isin));

  // Filter to long stocks/funds/bonds and calculate EUR values
  // STK positions use Q4 average FX rate (media del cuarto trimestre);
  // FUND/BOND positions use Dec 31 spot rate (tipo de cambio a 31 de diciembre).
  const entries = positions
    .filter(isHeldSecurity)
    .flatMap((p) => {
      const ecbRate = getValuationRate(rateMap, config.year, p.currency, p.assetCategory);
      // Unvaluable position (no resolvable rate, or no market value in the
      // export): cannot be written to the fixed-width record without an EUR
      // value — skip it. The caller surfaces a warning so the user values and
      // declares it manually.
      if (ecbRate === null || hasNoMarketValue(p)) return [];
      const valueEur = new Decimal(p.positionValue).abs().mul(ecbRate);

      // One record per acquisition date of the lots held at year end
      const tranches = acquisitionTranches(new Decimal(p.quantity).abs(), valueEur, remainingLots?.get(p.isin));

      // Declaration type: A (new), M (existing), C (cancelled/sold)
      const declType: "A" | "M" = previousIsins.has(p.isin) ? "M" : "A";

      // Counts toward the 50,000 EUR threshold even when the file cannot carry it.
      return [{ position: p, valueEur, tranches, declType, omission: positionOmission(p) }];
    });

  // "C" (cancelled) records for last year's securities no longer held, dated
  // and valued by the last sale of declared shares. Without such a sale the
  // record keeps a blank date and a zero value (see findUndatedExtinctions).
  const cancelled = findCancelledSecurities(positions, config.previousYearSecurities);
  const cancelledEntries = cancelled.filter(isRepeatable).flatMap((security) => {
    const tranches = extinctionTranches(security.isin, config.year, disposals);
    return tranches.length > 0
      ? tranches.map((t) => ({ security: recordOfTranche(security, t.acquireDate, config.previousYearSecurities), ...t }))
      : [{ security, acquireDate: "", sellDate: "", valueEur: new Decimal(0) }];
  });

  // Category C: cash balances at foreign brokers. A balance with no Q4 average
  // counts toward the threshold but is not written: the record needs that
  // average and the tool never invents it (the web section asks the user to
  // add that account by hand).
  const previousAccounts = new Set(config.previousYearAccounts ?? []);
  const cashEntries = (cashBalances ?? [])
    .filter((cb) => new Decimal(cb.endingCash).greaterThan(0))
    .flatMap((cb) => {
      const values = cashValuesEur(cb, rateMap, config.year);
      return values?.averageQ4
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
  const hasValuesRecords = totalValueV.greaterThan(THRESHOLD) || cancelled.length > 0;
  const hasCashRecords = cashCategoryTotals(cashBalances, rateMap, config.year).exceeds;

  const omissions: Modelo720Omission[] = [];
  if (hasValuesRecords) {
    for (const e of entries) {
      if (e.omission) omissions.push({ kind: "position", reason: e.omission, position: e.position });
    }
    for (const security of cancelled) {
      if (!isRepeatable(security)) omissions.push({ kind: "cancelled", reason: "invalid_code", security });
    }
  }
  if (hasCashRecords) {
    for (const e of cashEntries) {
      if (e.omission) omissions.push({ kind: "cash", reason: e.omission, cashBalance: e.cashBalance });
    }
  }

  return {
    entries: hasValuesRecords ? entries.filter((e) => e.omission === null) : [],
    cancelledEntries: hasValuesRecords ? cancelledEntries : [],
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
  /** Optional: lots held at 31 December (TaxSummary.yearEndLots), one record per acquisition date */
  remainingLots?: Map<string, Lot[]>,
  cashBalances?: CashBalance[],
  /** Optional: the year's FIFO disposals, used to date and value the extinction ("C") records */
  disposals?: FifoDisposal[],
): string {
  const { entries, cancelledEntries, cashEntries } = plan720(positions, rateMap, config, remainingLots, cashBalances, disposals);

  const detailRecords = [
    ...entries.flatMap((e) => e.tranches.map((t) => buildDetailRecord(e.position, t.valueEur, t.quantity, config, t.date, e.declType))),
    ...cancelledEntries.map((c) => buildCancelledRecord(c, config)),
    ...cashEntries.map((e) => buildCashAccountRecord(e.cashBalance, e.valueEur, e.averageQ4Eur, config, e.declType)),
  ];

  // Below both thresholds, or everything above them had to be left out: no file.
  if (detailRecords.length === 0) {
    return "";
  }

  // Valoración 1 / Valoración 2 exactly as written in each type-2 record
  // (rounded to cents, signed): the type-1 sumas are the totals of those two
  // fields. V: 31-Dec value (a cancelled record: value at the extinction date) /
  // nothing. C: 31-Dec balance / Q4 average balance.
  const allEntries = [
    ...[...entries.flatMap((e) => e.tranches), ...cancelledEntries].map((e) => ({ v1: writtenAmount(e.valueEur), v2: new Decimal(0) })),
    ...cashEntries.map((e) => ({ v1: writtenAmount(e.valueEur), v2: writtenAmount(e.averageQ4Eur) })),
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
 * Securities declared last year that are no longer held. Uses the held set (all
 * V-category positions), not the valued entries: a position that is still held
 * but couldn't be valued (no year-end rate) is skipped from the records, yet it
 * must NOT be reported as cancelled/sold (that would tell AEAT the user
 * liquidated an asset they still hold). A short position is not held: a
 * declared holding now shorted was sold, so it is cancelled.
 */
function findCancelledSecurities(positions: OpenPosition[], previous: Previous720Security[] | undefined): Previous720Security[] {
  const heldIsins = new Set(positions.filter(isHeldSecurity).map((p) => p.isin));
  // Last year's file holds one record per acquisition date: one sale per ISIN.
  const cancelled = new Map<string, Previous720Security>();
  for (const s of previous ?? []) {
    if (!heldIsins.has(s.isin) && !cancelled.has(s.isin)) cancelled.set(s.isin, s);
  }
  return [...cancelled.values()];
}

/**
 * The record of last year's file an extinction tranche cancels: the one with
 * the tranche's acquisition date (415-422). One ISIN can sit at custodians in
 * two countries, one record each, so the ISIN's first record (`first`) is only
 * the fallback when no record has that date.
 */
function recordOfTranche(first: Previous720Security, acquireDate: string, previous: Previous720Security[] | undefined): Previous720Security {
  return (previous ?? []).find((s) => s.isin === first.isin && s.acquireDate === acquireDate && isRepeatable(s)) ?? first;
}

/**
 * A sale is repeated with the clave, subclave and country last year's file
 * wrote. Older versions left the subclave blank and wrote the ISIN prefix
 * (e.g. XS) as the country: repeating either would make AEAT reject the file,
 * so such a sale is left out and reported instead.
 */
function isRepeatable(s: Previous720Security): boolean {
  return isClaveSubclave(s.claveSubclave) && isIsoCountryCode(s.country);
}

/**
 * A FIFO disposal of shares the upload holds no lot for (a sale with no history
 * behind it): the engine records it with the sale date as acquisition date and
 * a zero cost ("Venta sin lotes" / "Lotes insuficientes").
 */
function isSaleWithoutLots(d: FifoDisposal): boolean {
  return recordDate(d.acquireDate) === recordDate(d.sellDate) && d.costBasisFcy.isZero() && d.holdingPeriodDays === 0;
}

/**
 * The sale that ended the holding of a previously declared ISIN. Only lots
 * bought before the declaration year were declared, so the extinction is the
 * last sale in the year that consumed such a lot: its date is the extinction
 * date (424-431) and the proceeds of those lots the value at that date
 * (valoración 1, "saldo ... en la fecha de extinción"), one tranche per
 * acquisition date. Shares bought and sold within the year were never declared,
 * so their sales neither date the extinction nor add a tranche. A sale with no
 * lot in the upload (no history) also sold declared shares; it keeps a blank
 * acquisition date, which findUndatedExtinctions reports.
 */
function extinctionTranches(
  isin: string,
  year: number,
  disposals: FifoDisposal[] | undefined,
): { acquireDate: string; sellDate: string; valueEur: Decimal }[] {
  const yearStart = `${year}0101`;
  const declared = (disposals ?? []).flatMap((d) => {
    if (d.isin !== isin || d.isShort || !recordDate(d.sellDate).startsWith(String(year))) return [];
    const acquired = recordDate(d.acquireDate);
    if (/^\d{8}$/.test(acquired) && acquired < yearStart) return [{ d, acquireDate: acquired }];
    return isSaleWithoutLots(d) ? [{ d, acquireDate: "" }] : [];
  });
  if (declared.length === 0) return [];
  const sellDate = declared.map(({ d }) => recordDate(d.sellDate)).sort().at(-1)!;
  const byAcquireDate = new Map<string, Decimal>();
  for (const { d, acquireDate } of declared) {
    if (recordDate(d.sellDate) !== sellDate) continue;
    byAcquireDate.set(acquireDate, (byAcquireDate.get(acquireDate) ?? new Decimal(0)).plus(d.proceedsEur));
  }
  return [...byAcquireDate.keys()].sort().map((acquireDate) => ({
    acquireDate,
    sellDate,
    valueEur: byAcquireDate.get(acquireDate)!,
  }));
}

/** An extinction record with a field the file leaves blank (see findUndatedExtinctions). */
export interface UndatedExtinction {
  isin: string;
  missing: "extinctionDate" | "acquisitionDate";
}

/**
 * Extinction ("C") records the file cannot fill on its own, so the caller must
 * warn the user to complete them before filing:
 * - `extinctionDate`: an ISIN declared last year, no longer held, with no sale
 *   of declared shares in the year (a transfer out, or a sale outside the
 *   uploaded data). Its record has a blank extinction date and a zero value,
 *   never an invented 31 December.
 * - `acquisitionDate`: the extinction is dated by a sale the upload holds no
 *   lot for (no history), so its acquisition date (415-422) is blank.
 */
export function findUndatedExtinctions(
  positions: OpenPosition[],
  config: Pick<Modelo720Config, "year" | "previousYearSecurities">,
  disposals?: FifoDisposal[],
): UndatedExtinction[] {
  // A sale left out for an invalid code has no record to complete; findModelo720Omissions reports it.
  const written = findCancelledSecurities(positions, config.previousYearSecurities).filter(isRepeatable);
  return written.map((s) => s.isin).flatMap((isin): UndatedExtinction[] => {
    const tranches = extinctionTranches(isin, config.year, disposals);
    if (tranches.length === 0) return [{ isin, missing: "extinctionDate" }];
    return tranches.some((t) => t.acquireDate === "") ? [{ isin, missing: "acquisitionDate" }] : [];
  });
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
  quantity: Decimal,
  config: Modelo720Config,
  acquisitionDate: string,
  declType: "A" | "M",
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
  record += pad(acquisitionDate, 8);                          // 415-422: Acquisition date (YYYYMMDD)
  record += declType;                                         // 423: Type (A=new, M=existing)
  record += pad("", 8);                                       // 424-431: Sell date
  record += valoracionField(valueEur);                        // 432-446: Valoración 1 sign + value at Dec 31
  record += " ";                                              // 447: Valoración 2 sign
  record += numPad("0", 12, 2);                               // 448-461: Valoración 2 (not informed for V)
  record += "A";                                              // 462: Clave de representación (book entry)
  record += numPad(quantity.toString(), 10, 2);               // 463-474: Número de valores
  record += pad("", 1);                                       // 475: Clave tipo inmueble (B only)
  record += ownershipField(config);                           // 476-480: Ownership %
  record += pad("", 20);                                      // 481-500: Blank

  return record;
}

/**
 * Build a "C" (cancelled) detail record for a security declared in the
 * previous year but no longer held. It repeats last year's clave, subclave and
 * country so AEAT matches it to the record it cancels; callers only pass a
 * security whose codes are valid (isRepeatable).
 */
function buildCancelledRecord(
  entry: { security: Previous720Security; acquireDate: string; sellDate: string; valueEur: Decimal },
  config: Modelo720Config,
): string {
  const { security } = entry;

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
  record += pad(entry.acquireDate, 8);                        // 415-422: Acquisition date of the lot sold
  record += "C";                                              // 423: Type (C=cancelled)
  record += pad(entry.sellDate, 8);                           // 424-431: Extinction date (the last sale)
  record += valoracionField(entry.valueEur);                  // 432-446: Valoración 1 sign + value at the extinction date
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
