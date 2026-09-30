/**
 * Which tax year the results open on after files are loaded, and the notice
 * shown when that year has not finished yet.
 *
 * Most people file last year's Renta with an export that also covers the first
 * months of the current year. Opening on the newest year in the data would show
 * an unfinished year's casillas by default, so the pick is:
 *   1. the year saved in the fiscal profile, when the data covers it;
 *   2. otherwise the last closed year (today's year − 1), when the data covers it;
 *   3. otherwise the newest year in the data.
 */

import { t } from "../i18n/index.js";
import { esc } from "./esc.js";

/**
 * Default tax year for the loaded data. `detectedYears` may be in any order.
 * With no years detected, keeps the saved year (or the last closed year) so
 * loading an empty file never moves the profile.
 */
export function pickDefaultYear(detectedYears: readonly number[], savedYear: number | null, today: Date): number {
  const lastClosed = today.getFullYear() - 1;
  if (savedYear !== null && detectedYears.includes(savedYear)) return savedYear;
  if (detectedYears.includes(lastClosed)) return lastClosed;
  if (detectedYears.length > 0) return Math.max(...detectedYears);
  return savedYear ?? lastClosed;
}

/** True when `year` has not ended yet on `today`, so its figures are provisional. */
export function isOpenYear(year: number, today: Date): boolean {
  return year >= today.getFullYear();
}

/** Banner for the results header when the selected year is still in progress; "" otherwise. */
export function renderOpenYearBanner(year: number, today: Date): string {
  if (!isOpenYear(year, today)) return "";
  return `<div class="banner banner-warning">${esc(t("results.open_year", { year: String(year) }))}</div>`;
}
