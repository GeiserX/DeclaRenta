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
