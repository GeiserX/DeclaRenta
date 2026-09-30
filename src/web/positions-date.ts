/**
 * Positions-date banner for Modelo 720, 721 and D-6. The rule itself lives in
 * `positionsDateMismatch` (engine/dates.ts), shared with the CLI.
 */

import { t } from "../i18n/index.js";
import { formatDateDmy, positionsDateMismatch } from "../engine/dates.js";
import type { Statement } from "../types/broker.js";
import { esc } from "./esc.js";

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
    const msg = t("section.positions_date_mismatch", { date: formatDateDmy(statement.toDate), year: String(year) });
    return { html: `<div class="banner banner-warning">${esc(msg)}</div>`, blocked: true };
  }
  if (mismatch === "unknown") {
    const msg = t("section.positions_date_unknown", { year: String(year) });
    return { html: `<div class="banner banner-info">${esc(msg)}</div>`, blocked: false };
  }
  return { html: "", blocked: false };
}
