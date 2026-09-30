/**
 * What earlier Modelo 720 files generated in this browser declared.
 *
 * A security or account a previous 720 declared goes as M this year, and one
 * it declared that is no longer held goes as C (field 423, origen). Every time
 * the user generates a 720, the section keeps, per year and per category, what
 * the file declared and the category's joint value. That value is the base of
 * the 20,000 € rule: filing again is only required when a category grew by more
 * than that since the last declaration (arts. 42 bis.5 and 42 ter.5 RD 1065/2007).
 *
 * A category is taken from the latest earlier year whose file declared it: a
 * year that declared only accounts does not hide the securities declared before.
 * Stored in localStorage only; forget720History() clears it.
 */

import Decimal from "decimal.js";
import { readPrevious720, type Previous720Security } from "../generators/modelo720.js";

const STORAGE_KEY = "declarenta_720_history";

interface StoredYear {
  values?: { securities: Previous720Security[]; total: string };
  accounts?: { codes: string[]; total: string };
}

/** What earlier 720 files declared, per category, and the year that declared it. */
export interface Remembered720 {
  values: { year: number; securities: Previous720Security[]; total: Decimal } | null;
  accounts: { year: number; codes: string[]; total: Decimal } | null;
}

function isSecurity(s: unknown): s is Previous720Security {
  const o = s as Record<string, unknown> | null;
  return typeof o === "object" && o !== null
    && typeof o.isin === "string" && typeof o.claveSubclave === "string" && typeof o.country === "string";
}

function readTotal(total: unknown): Decimal | null {
  try {
    return typeof total === "string" ? new Decimal(total) : null;
  } catch {
    return null;
  }
}

function loadHistory(): Record<string, StoredYear> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, StoredYear>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Keep what the 720 file generated for `year` declares. `totals` are the
 * categories' joint values (the threshold totals). A file with no record of a
 * category leaves that category out, so an earlier year's stays in use.
 * Generating the same year again replaces it.
 */
export function remember720(year: number, content: string, totals: { values: Decimal; accounts: Decimal }): void {
  const details = content.split(/\r?\n/).filter((line) => line.startsWith("2"));
  const hasValues = details.some((line) => line[101] === "V" || line[101] === "I");
  const hasAccounts = details.some((line) => line[101] === "C");
  if (!hasValues && !hasAccounts) return;

  const previous = readPrevious720(content);
  const entry: StoredYear = {};
  if (hasValues) entry.values = { securities: previous.securities, total: totals.values.toString() };
  if (hasAccounts) entry.accounts = { codes: previous.accounts, total: totals.accounts.toString() };

  const history = loadHistory();
  history[String(year)] = entry;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // localStorage full or unavailable: next year starts without it, as before
  }
}

/** What the files generated here for years before `year` declared, per category. */
export function recall720(year: number): Remembered720 {
  const history = loadHistory();
  const earlier = Object.keys(history)
    .map(Number)
    .filter((y) => Number.isInteger(y) && y < year)
    .sort((a, b) => b - a);

  let values: Remembered720["values"] = null;
  let accounts: Remembered720["accounts"] = null;
  for (const y of earlier) {
    const entry = history[String(y)];
    if (!values && entry?.values && Array.isArray(entry.values.securities)) {
      const total = readTotal(entry.values.total);
      if (total) values = { year: y, securities: entry.values.securities.filter(isSecurity), total };
    }
    if (!accounts && entry?.accounts && Array.isArray(entry.accounts.codes)) {
      const total = readTotal(entry.accounts.total);
      if (total) accounts = { year: y, codes: entry.accounts.codes.filter((c): c is string => typeof c === "string"), total };
    }
  }
  return { values, accounts };
}

/** Forget every 720 generated in this browser. */
export function forget720History(): void {
  localStorage.removeItem(STORAGE_KEY);
}
