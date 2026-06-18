import { describe, it, expect } from "vitest";
import { serializeFxTrace } from "../../src/generators/fx-trace.js";
import type { FxTraceEvent } from "../../src/types/tax.js";

/**
 * Serializer tests for the FX-FIFO movement-trace export (issue #230 audit
 * artifact). These build small `FxTraceEvent[]` literals by hand — no engine
 * involved — and assert the JSONL/CSV string contract:
 *  - jsonl: one JSON.parse-able line per event; empty/undefined → empty string.
 *  - csv: a fixed header row + one row per event; null rate and absent optionals
 *    render as EMPTY cells (never "null"/"undefined"); a comma/quote in a free
 *    text field is escaped via the shared escapeCsv; empty trace → header only.
 */

/** The exact CSV header the serializer emits (CSV_COLUMNS in fx-trace.ts). */
const CSV_HEADER =
  "seq,date,kind,currency,trigger,quantityFcy,rate,costBasisEur,proceedsEur,gainLossEur,poolBalanceFcy,parkedBalanceFcy,positionKey,lotId,lotAcquireDate,note";

/** A fully-populated dispose event (every optional field present). */
function disposeEvent(): FxTraceEvent {
  return {
    seq: 2,
    date: "2025-01-03",
    kind: "dispose",
    currency: "USD",
    trigger: "conversion",
    quantityFcy: "1000",
    rate: "1.05",
    costBasisEur: "900",
    proceedsEur: "1050",
    gainLossEur: "150",
    poolBalanceFcy: "0",
    parkedBalanceFcy: "0",
    lotId: "FX-1",
    lotAcquireDate: "2025-01-01",
  };
}

/** A minimal acquire event (rate set, all dispose-only optionals absent). */
function acquireEvent(): FxTraceEvent {
  return {
    seq: 1,
    date: "2025-01-01",
    kind: "acquire",
    currency: "USD",
    trigger: "conversion",
    quantityFcy: "1000",
    rate: "0.9",
    poolBalanceFcy: "1000",
    parkedBalanceFcy: "0",
  };
}

describe("serializeFxTrace — JSONL format", () => {
  it("emits one JSON.parse-able line per event", () => {
    const trace = [acquireEvent(), disposeEvent()];
    const out = serializeFxTrace(trace, "jsonl");
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => {
        JSON.parse(line);
      }).not.toThrow();
    }
  });

  it("round-trips each event so parsed field values match the source", () => {
    const trace = [acquireEvent(), disposeEvent()];
    const out = serializeFxTrace(trace, "jsonl");
    const parsed = out.split("\n").map((l) => JSON.parse(l) as FxTraceEvent);
    expect(parsed[0]).toEqual(acquireEvent());
    expect(parsed[1]).toEqual(disposeEvent());
  });

  it("preserves a null rate as JSON null (not the string \"null\")", () => {
    const parkUncovered: FxTraceEvent = {
      seq: 1,
      date: "2025-01-02",
      kind: "park",
      currency: "USD",
      trigger: "stock_purchase",
      quantityFcy: "1000",
      rate: null,
      poolBalanceFcy: "0",
      parkedBalanceFcy: "1000",
      positionKey: "AAPL",
      note: "uncovered",
    };
    const line = serializeFxTrace([parkUncovered], "jsonl");
    const parsed = JSON.parse(line) as FxTraceEvent;
    expect(parsed.rate).toBeNull();
    expect(parsed.positionKey).toBe("AAPL");
  });

  it("returns an empty string for an empty trace", () => {
    expect(serializeFxTrace([], "jsonl")).toBe("");
  });

  it("returns an empty string for an undefined trace", () => {
    expect(serializeFxTrace(undefined, "jsonl")).toBe("");
  });

  it("defaults to jsonl when no format is given", () => {
    const trace = [acquireEvent()];
    expect(serializeFxTrace(trace)).toBe(serializeFxTrace(trace, "jsonl"));
  });
});

describe("serializeFxTrace — CSV format", () => {
  it("emits the fixed header row followed by one row per event", () => {
    const trace = [acquireEvent(), disposeEvent()];
    const rows = serializeFxTrace(trace, "csv").split("\n");
    expect(rows[0]).toBe(CSV_HEADER);
    expect(rows).toHaveLength(3); // header + 2 events
  });

  it("renders every column for a fully-populated event", () => {
    const row = serializeFxTrace([disposeEvent()], "csv").split("\n")[1];
    // seq,date,kind,currency,trigger,quantityFcy,rate,costBasisEur,proceedsEur,
    // gainLossEur,poolBalanceFcy,parkedBalanceFcy,positionKey,lotId,lotAcquireDate,note
    expect(row).toBe("2,2025-01-03,dispose,USD,conversion,1000,1.05,900,1050,150,0,0,,FX-1,2025-01-01,");
  });

  it("renders null rate as an EMPTY cell (not \"null\")", () => {
    const parkUncovered: FxTraceEvent = {
      seq: 1,
      date: "2025-01-02",
      kind: "park",
      currency: "USD",
      trigger: "stock_purchase",
      quantityFcy: "1000",
      rate: null,
      poolBalanceFcy: "0",
      parkedBalanceFcy: "1000",
      positionKey: "AAPL",
    };
    const row = serializeFxTrace([parkUncovered], "csv").split("\n")[1]!;
    const cells = row.split(",");
    // rate is column index 6 (0-based) — must be empty, never "null".
    expect(cells[6]).toBe("");
    expect(row).not.toContain("null");
  });

  it("renders absent optional fields as EMPTY cells (not \"undefined\")", () => {
    const row = serializeFxTrace([acquireEvent()], "csv").split("\n")[1]!;
    // acquire has no costBasisEur/proceedsEur/gainLossEur/positionKey/lotId/lotAcquireDate/note.
    expect(row).toBe("1,2025-01-01,acquire,USD,conversion,1000,0.9,,,,1000,0,,,,");
    expect(row).not.toContain("undefined");
  });

  it("escapes a note containing a comma so the column count stays stable", () => {
    const ev: FxTraceEvent = {
      seq: 1,
      date: "2025-01-02",
      kind: "discard",
      currency: "USD",
      trigger: "stock_sale",
      quantityFcy: "200",
      rate: "1.2",
      poolBalanceFcy: "0",
      parkedBalanceFcy: "0",
      positionKey: "AAPL",
      note: "principal perdido, sin efecto de divisa",
    };
    const row = serializeFxTrace([ev], "csv").split("\n")[1]!;
    // The comma-bearing note must be wrapped in double quotes by escapeCsv.
    expect(row).toContain('"principal perdido, sin efecto de divisa"');
    // Header columns = 15; a correctly-escaped note leaves the quoted comma
    // inside one field, so a naive split on the FIRST 14 commas still works:
    // the quoted field is the trailing one here.
    expect(row.endsWith('"principal perdido, sin efecto de divisa"')).toBe(true);
  });

  it("escapes a positionKey containing a double quote by doubling it", () => {
    const ev: FxTraceEvent = {
      seq: 1,
      date: "2025-01-02",
      kind: "park",
      currency: "USD",
      trigger: "stock_purchase",
      quantityFcy: "1000",
      rate: "0.9",
      poolBalanceFcy: "0",
      parkedBalanceFcy: "1000",
      positionKey: 'AC"ME',
    };
    const row = serializeFxTrace([ev], "csv").split("\n")[1]!;
    // escapeCsv wraps in quotes and doubles the embedded quote.
    expect(row).toContain('"AC""ME"');
  });

  it("returns just the header row for an empty trace", () => {
    expect(serializeFxTrace([], "csv")).toBe(CSV_HEADER);
  });

  it("returns just the header row for an undefined trace", () => {
    expect(serializeFxTrace(undefined, "csv")).toBe(CSV_HEADER);
  });
});
