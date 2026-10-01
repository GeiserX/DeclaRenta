/**
 * Date parsing utilities.
 *
 * IBKR Flex Query uses YYYYMMDD format (e.g. "20250115") while
 * JavaScript's Date constructor requires YYYY-MM-DD. This module
 * provides safe parsing for both formats.
 */

/** Normalize a date string to YYYY-MM-DD format.
 *  Handles YYYYMMDD, YYYY-MM-DD, and IBKR's YYYYMMDD;HHMMSS datetime format. */
export function normalizeDate(date: string): string {
  // Strip IBKR time component (e.g. "20190916;130630" → "20190916")
  const dateOnly = date.includes(";") ? date.split(";")[0]! : date;
  return dateOnly.length === 8 && !dateOnly.includes("-")
    ? `${dateOnly.slice(0, 4)}-${dateOnly.slice(4, 6)}-${dateOnly.slice(6, 8)}`
    : dateOnly;
}

/** Parse a date string in YYYYMMDD or YYYY-MM-DD format */
export function parseDate(date: string): Date {
  return new Date(normalizeDate(date));
}

/** Calculate days between two date strings (YYYYMMDD or YYYY-MM-DD) */
export function daysBetween(from: string, to: string): number {
  return Math.floor(
    (parseDate(to).getTime() - parseDate(from).getTime()) / (1000 * 60 * 60 * 24),
  );
}

/** "20200912" or "2020-09-12" → "12/09/2020" */
export function formatDateDmy(date: string): string {
  const [y, m, d] = normalizeDate(date).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Last Monday–Friday of `year` as "YYYY-MM-DD". IBKR cuts a statement period to
 * business days, so a full-year Flex Query for 2023 ends on 29/12/2023 (31/12
 * was a Sunday). Nothing trades or gets a new mark over the weekend, so the
 * holdings on that day are the 31 December holdings.
 */
function lastWeekdayOfYear(year: number): string {
  const dow = new Date(Date.UTC(year, 11, 31)).getUTCDay(); // 0 = Sunday, 6 = Saturday
  const day = dow === 0 ? 29 : dow === 6 ? 30 : 31;
  return `${year}-12-${day}`;
}

/**
 * Whether a statement's positions date differs from 31 December of `year`.
 *
 * Modelo 720, 721 and D-6 declare what the taxpayer held on 31 December of the
 * tax year (Modelo 720 values securities at that date, Art. 42 ter RGAT). A
 * broker's open positions are the holdings and mark values on the statement's
 * period end (IBKR FlexStatement `toDate`), so a statement that ends on another
 * date cannot stand in for the year-end holdings. Shared by the web sections and
 * the CLI so both apply the same rule.
 *
 * A period end on the last weekday of the year, or any day after it up to
 * 31/12, counts as 31 December. Returns "unknown" when the broker gives no
 * period end (only IBKR does today).
 */
export function positionsDateMismatch(statement: { toDate: string }, year: number): boolean | "unknown" {
  if (!statement.toDate) return "unknown";
  return !isYearEndDate(statement.toDate, year);
}

/** Whether `date` is 31 December of `year` or the last weekday before it (see above). */
export function isYearEndDate(date: string, year: number): boolean {
  const day = normalizeDate(date);
  return day >= lastWeekdayOfYear(year) && day <= `${year}-12-31`;
}
