/**
 * "Pérdida bloqueada" column shared by the operations annex and the
 * operations table (Art. 33.5.f/g LIRPF, anti-churning).
 *
 * A loss sale followed by a repurchase of the same security inside the window
 * is not deductible this year; `blockedLossEur` holds the deferred part
 * (proportional to the repurchased quantity). Renta Web asks for this per
 * transmission, so the user needs to see which sales carry it, not only the
 * aggregate in the casilla card.
 */

import type { FifoDisposal } from "../types/tax.js";
import { t } from "../i18n/index.js";
import { fmtEur } from "./format.js";
import { esc } from "./esc.js";

export function hasBlockedLoss(d: FifoDisposal): boolean {
  return d.blockedLossEur.greaterThan(0);
}

/**
 * The column only appears when the report has at least one blocked loss, so
 * the common case (no anti-churning at all) keeps the tables as they were.
 */
export function showBlockedLossColumn(disposals: readonly FifoDisposal[]): boolean {
  return disposals.some(hasBlockedLoss);
}

/** Apply the operations-table filter select ("all" | "gain" | "loss" | "blocked"). */
export function filterByKind(disposals: FifoDisposal[], filter: string): FifoDisposal[] {
  if (filter === "gain") return disposals.filter((d) => d.gainLossEur.greaterThanOrEqualTo(0));
  if (filter === "loss") return disposals.filter((d) => d.gainLossEur.lessThan(0));
  if (filter === "blocked") return disposals.filter(hasBlockedLoss);
  return disposals;
}

/** Header label and its tooltip (the legal reason and what to do in Renta Web). */
export function blockedLossHeader(): { label: string; title: string } {
  return { label: esc(t("table.blocked_loss_eur")), title: esc(t("table.blocked_loss_hint")) };
}

/** The cell: blank when the sale has no blocked loss, the amount otherwise. */
export function blockedLossCell(d: FifoDisposal): string {
  return hasBlockedLoss(d)
    ? `<td class="num blocked-loss">${fmtEur(d.blockedLossEur)}</td>`
    : `<td class="num blocked-loss"></td>`;
}
