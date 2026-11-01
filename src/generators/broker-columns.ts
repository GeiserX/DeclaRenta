/**
 * Whether the operations listings (web annex, both PDFs) add the purchase and
 * sale broker columns.
 *
 * FIFO pools lots per ISIN across every uploaded file, so a sale at one broker
 * can consume shares bought at another; the two columns show where each side
 * happened. With a single broker every row would repeat the same name, so the
 * columns appear only when the listed sales name two or more brokers.
 */

import type { FifoDisposal } from "../types/tax.js";

export function showBrokerColumns(
  disposals: readonly Pick<FifoDisposal, "brokerSource" | "acquireBrokerSource">[],
): boolean {
  const names = new Set<string>();
  for (const d of disposals) {
    if (d.brokerSource) names.add(d.brokerSource);
    if (d.acquireBrokerSource) names.add(d.acquireBrokerSource);
    if (names.size > 1) return true;
  }
  return false;
}
