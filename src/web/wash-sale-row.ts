/**
 * Anti-churning (Art. 33.5.f/g LIRPF) marker for a disposal row: the row gets a
 * highlight class, and an expandable line right under it says how much of the
 * loss is blocked and which purchases of the same security blocked it. Shared by
 * the operations annex and the results operations table so both read the same.
 */

import { t } from "../i18n/index.js";
import type { FifoDisposal } from "../types/tax.js";
import { fmtEur } from "./format.js";
import { esc } from "./esc.js";

/** ` class="wash-sale-blocked"` for a blocked disposal's row, "" otherwise. */
export function washSaleRowAttr(d: FifoDisposal): string {
  return d.washSaleBlocked ? ' class="wash-sale-blocked"' : "";
}

/** YYYY-MM-DD or YYYYMMDD → DD/MM/YYYY. */
function fmtDay(d: string): string {
  const clean = d.replace(/-/g, "").slice(0, 8);
  if (!/^\d{8}$/.test(clean)) return d;
  return `${clean.slice(6, 8)}/${clean.slice(4, 6)}/${clean.slice(0, 4)}`;
}

/**
 * The expandable line placed after a blocked disposal's row, spanning `colspan`
 * columns. Returns "" for a disposal with no blocked loss.
 */
export function renderWashSaleDetailRow(d: FifoDisposal, colspan: number): string {
  if (!d.washSaleBlocked) return "";
  const dates = (d.washSaleRepurchaseDates ?? []).map(fmtDay).join(", ");
  const datesLine = dates ? `<p>${esc(t("annex.wash_dates", { dates }))}</p>` : "";
  return `<tr class="wash-sale-detail"><td colspan="${colspan}"><details><summary>${esc(
    t("annex.wash_blocked", { amount: fmtEur(d.blockedLossEur) }),
  )}</summary>${datesLine}<p>${esc(t("annex.wash_hint"))}</p></details></td></tr>`;
}
