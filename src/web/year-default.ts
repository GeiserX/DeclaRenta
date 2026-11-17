/**
 * Which tax year the web app opens on after the user loads files, and the
 * one-line notice that says the data also covers later years.
 *
 * A Renta is always filed for a closed year, so the app opens on the last
 * closed year (today's year minus 1) whenever the data covers it. The year
 * saved in the profile is deliberately ignored: it is usually left over from a
 * previous session. When the data covers no closed year it falls back to the
 * newest year present, and with no dated activity at all to the last closed year.
 */

import { t } from "../i18n/index.js";
import { isYearEndDate } from "../engine/dates.js";
import type { Statement } from "../types/broker.js";

/**
 * Years whose 31 December holdings the upload carries: each file with open
 * positions or cash balances whose period ends on a year end (31 December, or
 * the last weekday before it). Modelo 720, 721 and D-6 declare those holdings,
 * so their year must be selectable even when the file has no trades or cash
 * movements. A file that ends on another day gives no year: its holdings are
 * not any year's year-end holdings.
 */
export function holdingsYears(statement: Pick<Statement, "toDate" | "openPositions" | "cashBalances" | "holdingsBySource">): number[] {
  const sources = statement.holdingsBySource ?? [
    { toDate: statement.toDate, openPositions: statement.openPositions, cashBalances: statement.cashBalances ?? [] },
  ];
  const years = new Set<number>();
  for (const s of sources) {
    if (!s.toDate || (s.openPositions.length === 0 && s.cashBalances.length === 0)) continue;
    const y = parseInt(s.toDate.slice(0, 4), 10);
    if (Number.isFinite(y) && y >= 1900 && y < 3000 && isYearEndDate(s.toDate, y)) years.add(y);
  }
  return [...years];
}

/**
 * Pick the year to open on. `detectedYears` may be in any order.
 * - The last closed year (today's year − 1) if the data covers it.
 * - Otherwise the newest closed year in the data (a gap year, e.g. [2026, 2024]).
 * - Otherwise the newest year in the data (only the current year or later).
 * - With no years at all (an export with holdings only), the last closed year.
 */
export function pickDefaultYear(detectedYears: readonly number[], today: Date = new Date()): number {
  const lastClosed = today.getFullYear() - 1;
  if (detectedYears.includes(lastClosed)) return lastClosed;
  const closed = detectedYears.filter((y) => y < lastClosed);
  if (closed.length > 0) return Math.max(...closed);
  if (detectedYears.length > 0) return Math.max(...detectedYears);
  return lastClosed;
}

/** Years in the data newer than the one shown, ascending. */
export function newerYears(detectedYears: readonly number[], shownYear: number): number[] {
  return detectedYears.filter((y) => y > shownYear).sort((a, b) => a - b);
}

/**
 * The notice under the year selector: "Mostrando 2025; tus datos también
 * cubren 2026". Empty when the data has no year newer than the one shown.
 */
export function renderNewerYearsNotice(detectedYears: readonly number[], shownYear: number): string {
  const newer = newerYears(detectedYears, shownYear);
  if (newer.length === 0) return "";
  const text = t("results.newer_years_notice", { year: String(shownYear), years: newer.join(", ") });
  return `<div class="banner banner-info year-newer-notice"><span>${text}</span></div>`;
}
