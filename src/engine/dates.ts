/**
 * Date parsing utilities.
 *
 * IBKR Flex Query uses YYYYMMDD format (e.g. "20250115") while
 * JavaScript's Date constructor requires YYYY-MM-DD. This module
 * provides safe parsing for both formats.
 */

/** Parse a date string in YYYYMMDD or YYYY-MM-DD format */
export function parseDate(date: string): Date {
  const normalized = date.length === 8
    ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
    : date;
  return new Date(normalized);
}

/** Calculate days between two date strings (YYYYMMDD or YYYY-MM-DD) */
export function daysBetween(from: string, to: string): number {
  return Math.floor(
    (parseDate(to).getTime() - parseDate(from).getTime()) / (1000 * 60 * 60 * 24),
  );
}
