/**
 * Broker correction/reversal collapsing.
 *
 * Brokers (DEGIRO especially) sometimes credit a cash movement, then credit a
 * DUPLICATE of it by mistake, then issue a CORRECTION (storno/reversal) that
 * reverses the duplicate with an opposite-sign line of the same magnitude. The
 * economic reality is the single original movement, but the raw transaction
 * stream contains the original + duplicate + reversal.
 *
 * If those rows reach the dividend/interest engines unnetted, two things break:
 *   • Gross income (Casilla 0029) double-counts the duplicate (only partially
 *     self-correcting, because the reversal carries `type:"Dividends"` and is
 *     summed with its sign — fragile, and wrong if the pair straddles a filter).
 *   • Withholding is computed per matched entry as `.abs()` (dividends.ts), so a
 *     −€19 original, a −€19 duplicate and a +€19 reversal all become +€19 and
 *     ADD to €57 instead of netting to the real €19.
 *
 * The fix is to cancel exact reversal pairs at the SOURCE, before any consumer
 * runs. A reversal is, by construction, an opposite-sign line of identical
 * magnitude for the same (type, security, currency, date). We pair each positive
 * with an equal-magnitude negative in its group and drop both. Whatever is left
 * is the genuine net movement.
 *
 * DELIBERATELY CONSERVATIVE — only EXACT opposite-sign pairs cancel:
 *   • Two SAME-sign rows of equal magnitude (e.g. two real −€19 withholdings on
 *     two real dividends) are NOT a reversal and are left untouched.
 *   • A +X cancels a −X only; a partial/rounded reversal whose magnitude differs
 *     does not match and falls through to today's behavior (no worse than now).
 * So a file with no reversals is byte-identical after this pass.
 */

import Decimal from "decimal.js";
import type { CashTransaction } from "../types/ibkr.js";
import { normalizeDate } from "./dates.js";

/**
 * Cancel exact opposite-sign reversal pairs in a cash-transaction stream.
 *
 * Groups by `(type, isin, currency, normalized date, |amount|)`. Within each
 * group, cancels `min(#positive, #negative)` pairs (a reversal annihilates one
 * same-magnitude movement of the opposite sign), preserving the original order
 * of every surviving row (the dividend matcher relies on index order for its
 * lowest-index tie-break, so order must be stable).
 *
 * Pure: returns a new array; never mutates the input.
 */
export function collapseCorrections(transactions: CashTransaction[]): CashTransaction[] {
  // Bucket original indices by the reversal-pair key, split by sign.
  const groups = new Map<string, { positives: number[]; negatives: number[] }>();

  transactions.forEach((tx, index) => {
    const amount = new Decimal(tx.amount);
    if (amount.isZero()) return; // a zero line can't be (or cancel) a reversal
    const key = `${tx.type}|${tx.isin}|${tx.currency}|${normalizeDate(tx.dateTime)}|${amount.abs().toString()}`;
    const group = groups.get(key) ?? { positives: [], negatives: [] };
    if (amount.isPositive()) group.positives.push(index);
    else group.negatives.push(index);
    groups.set(key, group);
  });

  // Mark min(pos,neg) pairs per group as cancelled, taking the HIGHEST indices
  // on each side first. This preserves the EARLIEST (original) rows — both the
  // intuitive outcome ("the duplicate and its reversal cancel, the original
  // survives") and the one the dividend matcher's lowest-index tie-break expects.
  const cancelled = new Set<number>();
  for (const { positives, negatives } of groups.values()) {
    const pairs = Math.min(positives.length, negatives.length);
    for (let i = 0; i < pairs; i++) {
      cancelled.add(positives[positives.length - 1 - i]!);
      cancelled.add(negatives[negatives.length - 1 - i]!);
    }
  }

  if (cancelled.size === 0) return transactions; // no reversals → unchanged (identity)
  return transactions.filter((_, index) => !cancelled.has(index));
}
