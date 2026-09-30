/**
 * Positions-date guard for Modelo 720, 721 and D-6.
 *
 * These models declare what the taxpayer held on 31 December of the tax year
 * (Modelo 720 values securities at that date, Art. 42 ter RGAT). A broker's open
 * positions are the holdings and mark values on the statement's period end
 * (IBKR FlexStatement `toDate`), so a statement that ends on another date
 * cannot stand in for the year-end holdings of the selected year.
 */

import { t } from "../i18n/index.js";
import { normalizeDate } from "../engine/dates.js";
import type { Statement } from "../types/broker.js";
import { esc } from "./esc.js";

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
 * Whether the statement's positions date differs from 31 December of `year`.
 * A period end on the last weekday of the year, or any day after it up to
 * 31/12, counts as 31 December. Returns "unknown" when the broker gives no
 * period end (only IBKR does today).
 */
export function positionsDateMismatch(statement: Pick<Statement, "toDate">, year: number): boolean | "unknown" {
  if (!statement.toDate) return "unknown";
  const toDate = normalizeDate(statement.toDate);
  return !(toDate >= lastWeekdayOfYear(year) && toDate <= `${year}-12-31`);
}

/** "20200912" or "2020-09-12" → "12/09/2020" */
function fmtDate(date: string): string {
  const [y, m, d] = normalizeDate(date).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Banner for the 720/721/D-6 sections. `blocked` is true when the positions are
 * known to be from another date, and the section must not generate a file.
 */
export function renderPositionsDateBanner(
  statement: Pick<Statement, "toDate">,
  year: number,
): { html: string; blocked: boolean } {
  const mismatch = positionsDateMismatch(statement, year);
  if (mismatch === true) {
    const msg = t("section.positions_date_mismatch", { date: fmtDate(statement.toDate), year: String(year) });
    return { html: `<div class="banner banner-warning">${esc(msg)}</div>`, blocked: true };
  }
  if (mismatch === "unknown") {
    const msg = t("section.positions_date_unknown", { year: String(year) });
    return { html: `<div class="banner banner-info">${esc(msg)}</div>`, blocked: false };
  }
  return { html: "", blocked: false };
}
