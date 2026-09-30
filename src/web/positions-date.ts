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
 * Whether the statement's positions date differs from 31 December of `year`.
 * Returns "unknown" when the broker gives no period end (only IBKR does today).
 */
export function positionsDateMismatch(statement: Pick<Statement, "toDate">, year: number): boolean | "unknown" {
  if (!statement.toDate) return "unknown";
  return normalizeDate(statement.toDate) !== `${year}-12-31`;
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
