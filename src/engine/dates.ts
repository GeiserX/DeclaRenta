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

/** Calculate day of year (1-366) for a date string (YYYYMMDD or YYYY-MM-DD) */
export function getDayOfYear(date: string): number {
  const parsed = parseDate(date);
  const year = parsed.getFullYear();
  const start = new Date(year, 0, 1);
  const diff = parsed.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
}
