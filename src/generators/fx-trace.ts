/**
 * FX-FIFO movement-trace serializer (audit/diagnostic export — issue #230).
 *
 * Turns the opt-in `TaxSummary.fxTrace` (an `FxTraceEvent[]`, see types/tax.ts)
 * into a downloadable artifact so a developer/advisor can verify how a 1633/1637
 * figure was built — the acquire → park → unpark → discard → dispose ledger with
 * running pool/parked balances. NEVER part of the standard UI; emitted only when
 * the caller asked for the trace (CLI `--fx-trace`, web diagnostic download).
 *
 * Two formats:
 *  - "jsonl" — one JSON object per line (machine/test-friendly, lossless).
 *  - "csv"   — a fixed-column table (human-readable, mirrors the console ledger
 *              the issue reporter keeps by hand).
 *
 * Pure string transformation, no Decimal dependency: every monetary field on
 * `FxTraceEvent` is already a decimal string.
 */

import type { FxTraceEvent } from "../types/tax.js";
import { escapeCsv } from "./csv.js";

export type FxTraceFormat = "jsonl" | "csv";

/** Stable CSV column order (matches the FxTraceEvent field order, human-first). */
const CSV_COLUMNS: readonly (keyof FxTraceEvent)[] = [
  "seq",
  "date",
  "kind",
  "currency",
  "trigger",
  "quantityFcy",
  "rate",
  "costBasisEur",
  "proceedsEur",
  "gainLossEur",
  "poolBalanceFcy",
  "parkedBalanceFcy",
  "positionKey",
  "lotId",
  "lotAcquireDate",
  "note",
];

/**
 * Serialize an FX-FIFO movement trace to JSONL or CSV.
 *
 * @param trace  the `TaxSummary.fxTrace` array (may be `undefined`/empty)
 * @param format "jsonl" (default) or "csv"
 * @returns the serialized string (empty string for an empty/absent trace, except
 *          CSV which still emits its header row so the columns are discoverable)
 */
export function serializeFxTrace(trace: FxTraceEvent[] | undefined, format: FxTraceFormat = "jsonl"): string {
  const events = trace ?? [];

  if (format === "csv") {
    const header = CSV_COLUMNS.join(",");
    const rows = events.map((e) =>
      CSV_COLUMNS.map((col) => {
        const v = e[col];
        // null (uncovered rate) and absent optionals render as an empty cell.
        if (v === undefined || v === null) return "";
        return escapeCsv(String(v));
      }).join(","),
    );
    return [header, ...rows].join("\n");
  }

  // jsonl: one compact JSON object per line. Empty trace → empty string.
  return events.map((e) => JSON.stringify(e)).join("\n");
}
