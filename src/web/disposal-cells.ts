/**
 * The amount cells of one sale, as the boxes count it (`finiteDisposalAmounts`).
 * The annex, the results operations table and the casilla drill-down share
 * them, so every view of a sale adds up to the boxes (#469, #470).
 */

import type Decimal from "decimal.js";
import { t } from "../i18n/index.js";
import type { FifoDisposal } from "../types/tax.js";
import { finiteDisposalAmounts } from "../generators/casillas.js";
import { isCountableAmount } from "../engine/amount-range.js";
import { fmtEur } from "./format.js";
import { esc } from "./esc.js";

type Amounts = Pick<FifoDisposal, "proceedsEur" | "costBasisEur" | "gainLossEur">;

/**
 * An amount cell: «—» for an amount the boxes leave out because it is no
 * number or past 12 integer digits of euros (`isCountableAmount`), never
 * "NaN" and never a 2000-digit figure.
 */
export function amountCell(amount: Decimal): string {
  return isCountableAmount(amount) ? fmtEur(amount) : "—";
}

/**
 * The cost cell. A cost next to proceeds the boxes leave out is shown but
 * not added (no phantom loss), so it carries the mark «(no se suma)».
 */
export function costCell(d: Amounts): string {
  return isCountableAmount(d.costBasisEur) && !isCountableAmount(d.proceedsEur)
    ? `${fmtEur(d.costBasisEur)} <span class="muted">(${esc(t("annex.not_counted"))})</span>`
    : amountCell(d.costBasisEur);
}

/**
 * The result the boxes add for this sale, or null when they add nothing
 * (proceeds left out: «—», also when the raw result is a small number,
 * 1e15 − (1e15 − 5) is 5). With only the cost left out, the result added is
 * the proceeds.
 */
export function countedResult(d: Amounts): Decimal | null {
  return isCountableAmount(d.proceedsEur) ? finiteDisposalAmounts(d).gainLoss : null;
}
