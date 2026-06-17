import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { FxFifoEngine } from "../../src/engine/fx-fifo.js";
import type { FxEvent } from "../../src/engine/fx-fifo.js";
import type { FxTraceEvent } from "../../src/types/tax.js";

/**
 * FX-FIFO engine instrumentation tests (issue #230 follow-up — the opt-in
 * movement trace). Mirrors the harness in fx-fifo-carry-basis.test.ts: ops are
 * mapped to FxEvents on strictly-ascending dates so op order == processing
 * order, then `enableTrace()` is called BEFORE `processEvents` and assertions
 * read `getTrace()`.
 *
 * The trace records one movement per pool/park mutation:
 *  - acquire — addLot (EUR→FCY conversion / dividend / interest in FCY)
 *  - dispose — consumeLots (FCY→EUR conversion) → realizes FX gain
 *  - park    — stock BUY parks principal (covered: carried basis; uncovered: rate null)
 *  - unpark  — stock SELL re-adds parked principal to the pool
 *  - profit  — stock SELL's profit re-added at the sale rate
 *  - discard — a LOSS sell drops principal that never returned (no FX, never converted)
 *
 * Running balances (poolBalanceFcy / parkedBalanceFcy) are captured AFTER the
 * movement is applied.
 */

/** Monotonic date generator so op order == processing order (same as carry-basis). */
function dater(): () => string {
  let day = 1;
  return () => {
    const d = day++;
    return `2025-01-${String(d).padStart(2, "0")}`;
  };
}

type Op =
  | ["fund", string, number, number]
  | ["conv", string, number, number]
  | ["buy", string, number] // cost (rate irrelevant — buy parks, never realizes)
  | ["sell", string, number, number, number]; // cost, proceeds, saleRate

/** Build the FxEvent stream for a list of ops, one ascending date per op. */
function toEvents(ops: Op[]): FxEvent[] {
  const next = dater();
  return ops.map((op): FxEvent => {
    const date = next();
    const currency = op[1];
    switch (op[0]) {
      case "fund":
        return { date, currency, quantity: new Decimal(op[2]), ecbRate: new Decimal(op[3]), trigger: "conversion" };
      case "conv":
        return { date, currency, quantity: new Decimal(op[2]).negated(), ecbRate: new Decimal(op[3]), trigger: "conversion" };
      case "buy":
        // ecbRate is unused by parkPrincipal; pass 1 as an inert placeholder.
        return { kind: "stock_buy", date, currency, quantity: new Decimal(0), costFcy: new Decimal(op[2]), ecbRate: new Decimal(1), trigger: "stock_purchase" };
      case "sell":
        return { kind: "stock_sell", date, currency, quantity: new Decimal(0), costFcy: new Decimal(op[2]), proceedsFcy: new Decimal(op[3]), ecbRate: new Decimal(op[4]), trigger: "stock_sale" };
    }
  });
}

/** Enable tracing, run the ops, return the recorded trace. */
function traceOf(ops: Op[]): FxTraceEvent[] {
  const engine = new FxFifoEngine();
  engine.enableTrace();
  engine.processEvents(toEvents(ops));
  return engine.getTrace();
}

/** All trace events of a given kind. */
function byKind(trace: FxTraceEvent[], kind: FxTraceEvent["kind"]): FxTraceEvent[] {
  return trace.filter((e) => e.kind === kind);
}

describe("FxFifoEngine.getTrace — OFF by default (zero-cost-when-off invariant)", () => {
  it("records nothing when enableTrace() is NOT called", () => {
    const engine = new FxFifoEngine();
    // A flow that WOULD emit acquire + dispose if tracing were on.
    engine.processEvents(toEvents([["fund", "USD", 1000, 0.9], ["conv", "USD", 1000, 1.05]]));
    expect(engine.getTrace()).toEqual([]);
  });
});

describe("FxFifoEngine.getTrace — acquire", () => {
  it("emits one acquire for a fund, with quantity, per-unit rate and pool balance", () => {
    const trace = traceOf([["fund", "USD", 1000, 0.9]]);
    expect(trace).toHaveLength(1);
    const ev = trace[0]!;
    expect(ev.kind).toBe("acquire");
    expect(ev.currency).toBe("USD");
    expect(ev.trigger).toBe("conversion");
    expect(ev.quantityFcy).toBe("1000");
    expect(ev.rate).toBe("0.9"); // costPerUnit = (1000 × 0.9) / 1000
    expect(ev.poolBalanceFcy).toBe("1000");
    expect(ev.parkedBalanceFcy).toBe("0");
  });
});

describe("FxFifoEngine.getTrace — dispose (real conversion)", () => {
  it("emits acquire then dispose with the realized FX gain and a drained pool", () => {
    // fund $1000@0.90 then convert $1000@1.05 → gain = 1000 × (1.05 − 0.90) = 150.
    const trace = traceOf([["fund", "USD", 1000, 0.9], ["conv", "USD", 1000, 1.05]]);
    expect(trace.map((e) => e.kind)).toEqual(["acquire", "dispose"]);
    const dispose = trace[1]!;
    expect(dispose.kind).toBe("dispose");
    expect(dispose.quantityFcy).toBe("1000");
    expect(dispose.rate).toBe("1.05"); // conversion (sale-out) rate
    expect(dispose.costBasisEur).toBe("900"); // 1000 × 0.90
    expect(dispose.proceedsEur).toBe("1050"); // 1000 × 1.05
    expect(dispose.gainLossEur).toBe("150");
    expect(dispose.poolBalanceFcy).toBe("0"); // lot fully consumed
    expect(dispose.lotId).toBe("FX-1");
  });
});

describe("FxFifoEngine.getTrace — park + unpark + profit (full round-trip)", () => {
  const ROUND_TRIP: Op[] = [
    ["fund", "USD", 1000, 0.9],
    ["buy", "USD", 1000],
    ["sell", "USD", 1000, 1200, 1.05],
    ["conv", "USD", 1200, 1.05],
  ];

  it("emits acquire → park → unpark → profit → dispose(s) in order", () => {
    const trace = traceOf(ROUND_TRIP);
    expect(trace.map((e) => e.kind)).toEqual(["acquire", "park", "unpark", "profit", "dispose", "dispose"]);
  });

  it("parks 1000 @0.90 (the carried acquisition basis)", () => {
    const trace = traceOf(ROUND_TRIP);
    const park = byKind(trace, "park")[0]!;
    expect(park.quantityFcy).toBe("1000");
    expect(park.rate).toBe("0.9"); // carried from the funding lot
    expect(park.poolBalanceFcy).toBe("0"); // pool drained by the buy
    expect(park.parkedBalanceFcy).toBe("1000"); // moved into the parked queue
  });

  it("unparks 1000 (principal re-added at its carried basis) and profits 200 @1.05", () => {
    const trace = traceOf(ROUND_TRIP);
    const unpark = byKind(trace, "unpark")[0]!;
    expect(unpark.quantityFcy).toBe("1000");
    expect(unpark.rate).toBe("0.9"); // re-added at the CARRIED basis, not the sale rate
    const profit = byKind(trace, "profit")[0]!;
    expect(profit.quantityFcy).toBe("200"); // proceeds 1200 − principal 1000
    expect(profit.rate).toBe("1.05"); // profit valued at the sale rate
  });

  it("keeps seq monotonic increasing with no gaps", () => {
    const trace = traceOf(ROUND_TRIP);
    expect(trace.length).toBeGreaterThan(0);
    trace.forEach((ev, i) => {
      expect(ev.seq).toBe(i + 1);
    });
  });
});

describe("FxFifoEngine.getTrace — discard (loss-sell, issue #230's hamburger in dollars)", () => {
  // fund $1000@1.20, buy $1000, sell $1000→$800@0.80 (a $200 USD loss), NO conversion.
  const LOSS_SELL: Op[] = [
    ["fund", "USD", 1000, 1.2],
    ["buy", "USD", 1000],
    ["sell", "USD", 1000, 800, 0.8],
  ];

  it("emits a discard of the 200 principal that never returned", () => {
    const trace = traceOf(LOSS_SELL);
    const discards = byKind(trace, "discard");
    expect(discards).toHaveLength(1);
    const discard = discards[0]!;
    expect(discard.quantityFcy).toBe("200"); // principal 1000 − proceeds 800
    expect(discard.currency).toBe("USD");
    expect(discard.trigger).toBe("stock_sale");
    expect(discard.rate).toBe("1.2"); // the discarded slice's CARRIED basis rate
  });

  it("emits NO dispose — nothing was converted to EUR, so no FX is realized", () => {
    const trace = traceOf(LOSS_SELL);
    expect(byKind(trace, "dispose")).toHaveLength(0);
  });

  it("records the trade as park → unpark (800) → discard (200) with no profit", () => {
    const trace = traceOf(LOSS_SELL);
    expect(trace.map((e) => e.kind)).toEqual(["acquire", "park", "unpark", "discard"]);
    const unpark = byKind(trace, "unpark")[0]!;
    expect(unpark.quantityFcy).toBe("800"); // only min(cost, proceeds) re-added
    expect(byKind(trace, "profit")).toHaveLength(0); // a loss has no profit tail
  });
});

describe("FxFifoEngine.getTrace — uncovered park (buy with no preceding fund)", () => {
  it("emits a park with a null rate and a note", () => {
    const trace = traceOf([["buy", "USD", 1000]]);
    const park = byKind(trace, "park")[0]!;
    expect(park).toBeDefined();
    expect(park.kind).toBe("park");
    expect(park.quantityFcy).toBe("1000");
    expect(park.rate).toBeNull(); // no tracked acquisition basis → uncovered
    expect(park.note).toBeDefined();
    expect(typeof park.note).toBe("string");
    expect(park.poolBalanceFcy).toBe("0"); // nothing was in the pool to consume
    expect(park.parkedBalanceFcy).toBe("1000"); // parked uncovered
  });
});

describe("FxFifoEngine.getTrace — running balances are post-event sums", () => {
  it("a park drops the pool and raises parked by the same quantity", () => {
    const trace = traceOf([["fund", "USD", 1000, 0.9], ["buy", "USD", 1000]]);
    const acquire = byKind(trace, "acquire")[0]!;
    const park = byKind(trace, "park")[0]!;
    // After the acquire: pool 1000, parked 0.
    expect(acquire.poolBalanceFcy).toBe("1000");
    expect(acquire.parkedBalanceFcy).toBe("0");
    // After the buy parks the lot: pool 0, parked 1000 (conserved).
    expect(park.poolBalanceFcy).toBe("0");
    expect(park.parkedBalanceFcy).toBe("1000");
    expect(new Decimal(park.poolBalanceFcy).plus(park.parkedBalanceFcy).toString()).toBe("1000");
  });

  it("a partial conversion leaves the pool balance at the unconverted remainder", () => {
    // fund $1000@0.90 then convert only $400@1.05 → 600 remains in the pool.
    const trace = traceOf([["fund", "USD", 1000, 0.9], ["conv", "USD", 400, 1.05]]);
    const dispose = byKind(trace, "dispose")[0]!;
    expect(dispose.quantityFcy).toBe("400");
    expect(dispose.poolBalanceFcy).toBe("600"); // 1000 − 400 left spendable
    expect(dispose.parkedBalanceFcy).toBe("0");
  });
});
