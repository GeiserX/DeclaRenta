/**
 * "Ejercicio en curso" notice. The wizard defaults to the newest year in the
 * uploaded data, which in spring is often the year that has not ended yet. The
 * Review step shows the chosen year prominently, and Results, 720, 721 and D-6
 * show this banner whenever that year is still open, so provisional figures are
 * never mistaken for a closed year's return.
 */

import { t } from "../i18n/index.js";

/** True when `year` has not ended yet on `today` (the current or a later calendar year). */
export function isYearInProgress(year: number, today: Date = new Date()): boolean {
  return year >= today.getFullYear();
}

/**
 * Banner for an open year, or "" for a closed one. `withLink` adds a link to the
 * Modelo 100 step, where the year selector lives; Results omits it because the
 * selector sits right above the banner.
 */
export function renderOpenYearBanner(year: number, opts: { withLink?: boolean; today?: Date } = {}): string {
  if (!isYearInProgress(year, opts.today)) return "";
  const link = opts.withLink ? ` <a href="#renta">${t("year.in_progress_change")}</a>` : "";
  return `<div class="banner banner-warning open-year-banner"><span>${t("year.in_progress", { year: String(year) })}${link}</span></div>`;
}

/**
 * Review-step card that puts the year about to be calculated in front of the
 * user before processing. With more than one year in the data it is a selector
 * (`#review-year-select`), so a wrong default can be fixed right here; an open
 * year also gets an "en curso" tag.
 */
export function renderReviewYearCard(year: number, detectedYears: readonly number[], today: Date = new Date()): string {
  const years = detectedYears.includes(year) ? [...detectedYears] : [...detectedYears, year];
  years.sort((a, b) => b - a);
  const value =
    years.length > 1
      ? `<select id="review-year-select" class="review-year-select" aria-label="${t("review.tax_year")}">${years
          .map((y) => `<option value="${y}"${y === year ? " selected" : ""}>${y}</option>`)
          .join("")}</select>`
      : String(year);
  const tag = isYearInProgress(year, today) ? ` <span class="review-year-tag">${t("year.in_progress_tag")}</span>` : "";
  return `<div class="review-card review-year">
      <div class="review-label">${t("review.tax_year")}</div>
      <div class="review-value accent">${value}${tag}</div>
      <div class="review-year-hint">${t(years.length > 1 ? "review.tax_year_hint_choose" : "review.tax_year_hint")}</div>
    </div>`;
}
