/**
 * Anti-churning (Art. 33.5.f/g LIRPF) marker for a disposal row: the row gets a
 * highlight class, and an expandable line right under it says how much of the
 * loss is blocked and which purchases of the same security blocked it, or how
 * much pending loss of earlier sales this sale releases. Shared by the operations
 * annex and the results operations table so both read the same.
 *
 * A blocked loss does not belong to the purchase that blocked it: it waits in a
 * queue per security and the next «transmisión definitiva» of that security
 * releases it, oldest first (src/engine/wash-sale.ts). So a blocked row names
 * the purchases that blocked it, and a releasing row names the loss sales whose
 * pending loss it releases.
 */

import { t } from "../i18n/index.js";
import type { FifoDisposal } from "../types/tax.js";
import { fmtEur } from "./format.js";
import { esc } from "./esc.js";

/**
 * ` class="wash-sale-blocked"` for a blocked disposal's row,
 * ` class="wash-sale-released"` for one that only releases pending losses, "" otherwise.
 */
export function washSaleRowAttr(d: FifoDisposal): string {
  if (d.washSaleBlocked) return ' class="wash-sale-blocked"';
  if (d.reintegratedLossEur.greaterThan(0)) return ' class="wash-sale-released"';
  return "";
}

/** YYYY-MM-DD or YYYYMMDD → DD/MM/YYYY. */
function fmtDay(d: string): string {
  const clean = d.replace(/-/g, "").slice(0, 8);
  if (!/^\d{8}$/.test(clean)) return d;
  return `${clean.slice(6, 8)}/${clean.slice(4, 6)}/${clean.slice(0, 4)}`;
}

/**
 * The expandable line placed after a blocked or releasing disposal's row,
 * spanning `colspan` columns. Returns "" for a disposal that neither blocks nor
 * releases a loss.
 */
export function renderWashSaleDetailRow(d: FifoDisposal, colspan: number): string {
  const blocked = d.washSaleBlocked;
  const released = d.reintegratedLossEur.greaterThan(0);
  if (!blocked && !released) return "";

  const releasedText = esc(t("annex.wash_released", { amount: fmtEur(d.reintegratedLossEur) }));
  const body: string[] = [];
  if (blocked) {
    const dates = (d.washSaleRepurchaseDates ?? []).map(fmtDay).join(", ");
    if (dates) body.push(`<p>${esc(t("annex.wash_dates", { dates }))}</p>`);
    body.push(`<p>${esc(t("annex.wash_hint"))}</p>`);
  }
  if (released) {
    if (blocked) body.push(`<p>${releasedText}</p>`);
    const from = (d.washSaleReleasedFromDates ?? []).map(fmtDay).join(", ");
    if (from) body.push(`<p>${esc(t("annex.wash_released_dates", { dates: from }))}</p>`);
    body.push(`<p>${esc(t("annex.wash_released_hint"))}</p>`);
  }
  const summary = blocked ? esc(t("annex.wash_blocked", { amount: fmtEur(d.blockedLossEur) })) : releasedText;
  const cls = blocked ? "wash-sale-detail" : "wash-sale-detail wash-sale-detail-released";
  return `<tr class="${cls}"><td colspan="${colspan}"><details><summary>${summary}</summary>${body.join("")}</details></td></tr>`;
}
