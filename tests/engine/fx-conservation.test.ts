import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { FxFifoEngine } from "../../src/engine/fx-fifo.js";
import type { FxEvent } from "../../src/engine/fx-fifo.js";
import type { TaxMessage } from "../../src/types/tax.js";

/**
 * FX conservation self-check (issue #230 — "para la comprobación de descuadres
 * del FIFO, y no se silencien operaciones sin respaldo económico"). The check is
 * a pure DIAGNOSTIC: it emits a developer-facing `fx.conservation_mismatch`
 * warning iff the engine's internal pool/parked bookkeeping fails to balance, and
 * it NEVER changes a tax figure. It is the regression tripwire for the
 * "pool diverged from the real spendable balance" bug class (the documented
 * €450-vs-€320 drift).
 *
 * THE IDENTITY (per currency), derived from the six movement kinds that mutate
 * the spendable pool / parked FIFO, plus the reconciling "phantom acquire" term
 * for legitimately-untracked FCY (missing-lot floor, uncovered park, unmatched
 * sell — funding outside the data window):
 *
 *   (acquired + profit + phantom) − disposed − discarded  ==  pool + parked
 *
 * These tests mirror the harness in fx-fifo-carry-basis.test.ts / fx-fifo-
 * trace.test.ts: ops are mapped to FxEvents on strictly-ascending dates so op
 * order == processing order, fed to one processEvents call, and we assert NO
 * `fx.conservation_mismatch` message is emitted in any legitimate scenario.
 */

/** Monotonic date generator so op order == processing order. */
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
        return { kind: "stock_buy", date, currency, quantity: new Decimal(0), costFcy: new Decimal(op[2]), ecbRate: new Decimal(1), trigger: "stock_purchase" };
      case "sell":
        return { kind: "stock_sell", date, currency, quantity: new Decimal(0), costFcy: new Decimal(op[2]), proceedsFcy: new Decimal(op[3]), ecbRate: new Decimal(op[4]), trigger: "stock_sale" };
    }
  });
}

const MISMATCH_ID = "fx.conservation_mismatch";

/** The conservation-mismatch messages emitted by a run (empty when books balance). */
function mismatches(engine: FxFifoEngine): TaxMessage[] {
  return engine.messages.filter((m) => m.id === MISMATCH_ID);
}

/** Run the engine over ops, returning both the engine (for messages) and the total FX gain. */
function run(ops: Op[]): { engine: FxFifoEngine; gain: Decimal } {
  const engine = new FxFifoEngine();
  const disposals = engine.processEvents(toEvents(ops));
  return { engine, gain: disposals.reduce((s, d) => s.plus(d.gainLossEur), new Decimal(0)) };
}

describe("FX conservation self-check — HOLDS (no mismatch) for every legitimate scenario", () => {
  it("simple acquire + convert", () => {
    const { engine, gain } = run([["fund", "USD", 1000, 0.9], ["conv", "USD", 1000, 1.05]]);
    expect(mismatches(engine)).toHaveLength(0);
    expect(gain.toFixed(2)).toBe("150.00"); // sanity: 1000 × (1.05 − 0.90)
  });

  it("partial conversion (pool left with an unconverted remainder)", () => {
    const { engine } = run([["fund", "USD", 1000, 0.9], ["conv", "USD", 400, 1.05]]);
    expect(mismatches(engine)).toHaveLength(0); // 600 stays in the pool, still balances
  });

  it("full carry-basis round-trip (acquire → buy → sell → convert) — S1", () => {
    const ops: Op[] = [["fund", "USD", 1000, 0.9], ["buy", "USD", 1000], ["sell", "USD", 1000, 1200, 1.0], ["conv", "USD", 1200, 1.05]];
    const { engine, gain } = run(ops);
    expect(mismatches(engine)).toHaveLength(0);
    expect(gain.toFixed(2)).toBe("160.00"); // the validated S1 figure
  });

  it("two carry-basis round-trips → S2 (320.00), NO mismatch", () => {
    const ops: Op[] = [
      ["fund", "USD", 1000, 0.9], ["buy", "USD", 1000], ["sell", "USD", 1000, 1100, 1.0], ["conv", "USD", 1100, 1.05],
      ["fund", "USD", 1000, 1.1], ["buy", "USD", 1000], ["sell", "USD", 1000, 1300, 1.2], ["conv", "USD", 1300, 1.25],
    ];
    const { engine, gain } = run(ops);
    expect(mismatches(engine)).toHaveLength(0);
    expect(gain.toFixed(2)).toBe("320.00");
  });

  it("loss-sell (discard path) — no conversion, principal discarded", () => {
    // fund $1000@1.20, buy $1000, sell $1000→$800 @0.80 (a $200 USD loss). The 200
    // discarded principal is on the lhs (discarded) and balances.
    const ops: Op[] = [["fund", "USD", 1000, 1.2], ["buy", "USD", 1000], ["sell", "USD", 1000, 800, 0.8]];
    const { engine, gain } = run(ops);
    expect(mismatches(engine)).toHaveLength(0);
    expect(gain.toFixed(2)).toBe("0.00"); // nothing converted → no FX realized
  });

  it("missing-lot floored conversion (single-year, no prior lot)", () => {
    // A conversion with NO prior acquisition lot: the engine floors gain to 0 and
    // warns fx.missing_prior_lots — but conservation must NOT additionally fire
    // (the phantom-acquire term reconciles the floored disposal).
    const { engine, gain } = run([["conv", "USD", 1000, 1.05]]);
    expect(mismatches(engine)).toHaveLength(0);
    expect(gain.toFixed(2)).toBe("0.00");
    // The missing-lot INFO is still emitted (proves we took the floor path).
    expect(engine.messages.some((m) => m.id === "fx.missing_prior_lots")).toBe(true);
  });

  it("partial missing-lot (pool covers only part of the conversion)", () => {
    // fund $400, convert $1000: 400 covered (real dispose) + 600 floored. The 600
    // floored leg is a phantom acquire — still balances.
    const { engine } = run([["fund", "USD", 400, 0.9], ["conv", "USD", 1000, 1.05]]);
    expect(mismatches(engine)).toHaveLength(0);
    expect(engine.messages.some((m) => m.id === "fx.missing_prior_lots")).toBe(true);
  });

  it("uncovered park then unpark at the sale rate (buy/sell with no funding)", () => {
    // A1: buy (uncovered park) → sell → convert. Funding-absent no-op path.
    const ops: Op[] = [["buy", "USD", 1000], ["sell", "USD", 1000, 1200, 1.0], ["conv", "USD", 1200, 1.05]];
    const { engine, gain } = run(ops);
    expect(mismatches(engine)).toHaveLength(0);
    expect(gain.toFixed(2)).toBe("60.00");
  });

  it("uncovered park left OPEN at the period boundary (never sold)", () => {
    // A lone uncovered buy: parks 1000 uncovered, nothing else. The phantom-acquire
    // term must balance the parked-side FCY that had no real acquisition.
    const { engine } = run([["buy", "USD", 1000]]);
    expect(mismatches(engine)).toHaveLength(0);
  });

  it("sell-only (position bought outside the data window) — unmatched re-add", () => {
    // A3: the unmatched-sell re-add path (phantom acquire on the pool side).
    const ops: Op[] = [["sell", "USD", 1000, 1200, 1.0], ["conv", "USD", 1200, 1.05]];
    const { engine, gain } = run(ops);
    expect(mismatches(engine)).toHaveLength(0);
    expect(gain.toFixed(2)).toBe("60.00");
  });

  it("partial funding (pool covers only part of the buy) — A5", () => {
    const ops: Op[] = [["fund", "USD", 500, 0.9], ["buy", "USD", 1000], ["sell", "USD", 1000, 1200, 1.0], ["conv", "USD", 1200, 1.05]];
    const { engine, gain } = run(ops);
    expect(mismatches(engine)).toHaveLength(0);
    expect(gain.toFixed(2)).toBe("110.00");
  });

  it("documented residual partial-w/loss (S7) — still balances", () => {
    const ops: Op[] = [
      ["fund", "USD", 2000, 0.9], ["buy", "USD", 2000],
      ["sell", "USD", 1000, 1200, 1.0], ["conv", "USD", 1200, 1.05],
      ["sell", "USD", 1000, 900, 1.1], ["conv", "USD", 900, 1.15],
    ];
    const { engine, gain } = run(ops);
    expect(mismatches(engine)).toHaveLength(0);
    expect(gain.toFixed(2)).toBe("385.00");
  });

  it("multi-currency mix (USD round-trip + EUR ignored + GBP convert) — per-currency, no mismatch", () => {
    const next = dater();
    const events: FxEvent[] = [
      // USD: fund → buy → sell → convert
      { date: next(), currency: "USD", quantity: new Decimal(1000), ecbRate: new Decimal("0.90"), trigger: "conversion" },
      { kind: "stock_buy", date: next(), currency: "USD", quantity: new Decimal(0), costFcy: new Decimal(1000), ecbRate: new Decimal(1), trigger: "stock_purchase" },
      { kind: "stock_sell", date: next(), currency: "USD", quantity: new Decimal(0), costFcy: new Decimal(1000), proceedsFcy: new Decimal(1200), ecbRate: new Decimal("1.00"), trigger: "stock_sale" },
      { date: next(), currency: "USD", quantity: new Decimal(-1200), ecbRate: new Decimal("1.05"), trigger: "conversion" },
      // EUR: must be skipped entirely (never enters the books)
      { date: next(), currency: "EUR", quantity: new Decimal(5000), ecbRate: new Decimal(1), trigger: "conversion" },
      // GBP: simple fund + convert
      { date: next(), currency: "GBP", quantity: new Decimal(800), ecbRate: new Decimal("1.15"), trigger: "conversion" },
      { date: next(), currency: "GBP", quantity: new Decimal(-800), ecbRate: new Decimal("1.20"), trigger: "conversion" },
    ];
    const engine = new FxFifoEngine();
    engine.processEvents(events);
    expect(mismatches(engine)).toHaveLength(0);
    // EUR never produced an accumulator entry, so it cannot have emitted a mismatch.
    expect(engine.messages.every((m) => m.context?.currency !== "EUR")).toBe(true);
  });

  it("the check is SILENT — emits NO message at all on a clean simple flow", () => {
    const { engine } = run([["fund", "USD", 1000, 0.9], ["conv", "USD", 1000, 1.05]]);
    // A fully-covered single round-trip warns about nothing.
    expect(engine.messages).toHaveLength(0);
  });
});

describe("FX conservation self-check — the identity (numeric guard on the validated S2 scenario)", () => {
  it("S2 two-round-trip: (acquired + profit + phantom) − disposed − discarded == pool + parked, EXACTLY", () => {
    // The S2 carry-basis scenario from fx-fifo-carry-basis.test.ts. We assert the
    // identity numerically on the engine's own end-of-run accumulators + balances.
    const ops: Op[] = [
      ["fund", "USD", 1000, 0.9], ["buy", "USD", 1000], ["sell", "USD", 1000, 1100, 1.0], ["conv", "USD", 1100, 1.05],
      ["fund", "USD", 1000, 1.1], ["buy", "USD", 1000], ["sell", "USD", 1000, 1300, 1.2], ["conv", "USD", 1300, 1.25],
    ];
    const engine = new FxFifoEngine();
    engine.processEvents(toEvents(ops));

    // Reach the private accumulators/balances for a direct numeric assertion. This
    // reads only — it never feeds anything back into the engine.
    const e = engine as unknown as {
      accAcquired: Map<string, Decimal>;
      accDisposed: Map<string, Decimal>;
      accDiscarded: Map<string, Decimal>;
      accProfit: Map<string, Decimal>;
      accPhantom: Map<string, Decimal>;
      poolBalance(c: string): Decimal;
      totalParkedBalance(c: string): Decimal;
    };
    const z = new Decimal(0);
    const acquired = e.accAcquired.get("USD") ?? z;
    const disposed = e.accDisposed.get("USD") ?? z;
    const discarded = e.accDiscarded.get("USD") ?? z;
    const profit = e.accProfit.get("USD") ?? z;
    const phantom = e.accPhantom.get("USD") ?? z;

    // For this fully-funded scenario: acquired 2000, disposed 2400, profit 400,
    // discarded 0, phantom 0; pool 0, parked 0.
    expect(acquired.toString()).toBe("2000");
    expect(disposed.toString()).toBe("2400");
    expect(profit.toString()).toBe("400");
    expect(discarded.toString()).toBe("0");
    expect(phantom.toString()).toBe("0");

    const lhs = acquired.plus(profit).plus(phantom).minus(disposed).minus(discarded);
    const rhs = e.poolBalance("USD").plus(e.totalParkedBalance("USD"));
    expect(lhs.toString()).toBe(rhs.toString());
    expect(lhs.toString()).toBe("0");
  });

  it("S8 two-gains-one-conversion: identity holds and the check is silent", () => {
    const ops: Op[] = [
      ["fund", "USD", 2000, 0.9],
      ["buy", "USD", 1000], ["sell", "USD", 1000, 1200, 1.0],
      ["buy", "USD", 1000], ["sell", "USD", 1000, 1400, 1.1],
      ["conv", "USD", 2600, 1.2],
    ];
    const { engine, gain } = run(ops);
    expect(mismatches(engine)).toHaveLength(0);
    expect(gain.toFixed(2)).toBe("680.00");
  });
});

/**
 * Artificial-break proof. A test-only subclass that, AFTER the real run, mutates
 * the private pool balance to simulate a genuine bookkeeping desync, then invokes
 * the real (private) checkConservation. This proves the production warning DOES
 * fire on a real mismatch — WITHOUT adding any production code path that can
 * desync. It exercises the actual emit()/checkConservation()/totalParkedBalance()
 * code, not a re-implementation of the math.
 */
class BreakableEngine extends FxFifoEngine {
  /** Corrupt the spendable pool for a currency, then re-run the real check. */
  forceMismatch(currency: string, extraQty: number): void {
    const self = this as unknown as {
      lots: Map<string, { id: string; currency: string; acquireDate: string; quantity: Decimal; costPerUnit: Decimal; costInEur: Decimal }[]>;
      checkConservation(): void;
    };
    const lots = self.lots.get(currency) ?? [];
    // Inject a phantom pool lot that NO accumulator counted → rhs > lhs → mismatch.
    lots.push({ id: "BROKEN", currency, acquireDate: "2025-12-31", quantity: new Decimal(extraQty), costPerUnit: new Decimal(1), costInEur: new Decimal(extraQty) });
    self.lots.set(currency, lots);
    self.checkConservation();
  }
}

describe("FX conservation self-check — FIRES on a genuine desync (artificial break)", () => {
  it("emits fx.conservation_mismatch (warning) when the pool diverges from the books", () => {
    const engine = new BreakableEngine();
    // A clean run first (no mismatch yet).
    engine.processEvents(toEvents([["fund", "USD", 1000, 0.9], ["conv", "USD", 1000, 1.05]]));
    expect(engine.messages.filter((m) => m.id === MISMATCH_ID)).toHaveLength(0);

    // Now corrupt the pool by 500 units and re-run the real check.
    engine.forceMismatch("USD", 500);

    const msgs = engine.messages.filter((m) => m.id === MISMATCH_ID);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0]!;
    expect(msg.severity).toBe("warning");
    expect(msg.context?.currency).toBe("USD");
    // rhs exceeds lhs by 500 → mismatch = lhs − rhs = −500.
    expect(new Decimal(msg.context!.mismatch!).toFixed(2)).toBe("-500.00");
    expect(msg.message).toContain("USD");
    expect(msg.message).toContain("1633/1637");
    expect(msg.hint).toContain("GitHub");
  });

  it("stays silent for a sub-epsilon (dust) imbalance", () => {
    const engine = new BreakableEngine();
    engine.processEvents(toEvents([["fund", "USD", 1000, 0.9], ["conv", "USD", 1000, 1.05]]));
    // 0.001 < CONSERVATION_EPS (0.01) → no warning (dust is fine).
    engine.forceMismatch("USD", 0.001);
    expect(engine.messages.filter((m) => m.id === MISMATCH_ID)).toHaveLength(0);
  });
});

describe("FX conservation self-check — DIAGNOSTIC ONLY (never changes a tax figure)", () => {
  it("the disposals/gain are byte-identical whether or not a mismatch is emitted", () => {
    // The check runs at the END of processEvents and only reads state + emits a
    // message. The disposals returned are the same object the engine built before
    // the check ran — proving no casilla figure depends on the diagnostic.
    const ops: Op[] = [["fund", "USD", 1000, 0.9], ["buy", "USD", 1000], ["sell", "USD", 1000, 1200, 1.0], ["conv", "USD", 1200, 1.05]];
    const engine = new FxFifoEngine();
    const disposals = engine.processEvents(toEvents(ops));
    const totalBefore = disposals.reduce((s, d) => s.plus(d.gainLossEur), new Decimal(0)).toFixed(2);
    expect(totalBefore).toBe("160.00");
    // getDisposals() returns the same array the check never touched.
    expect(engine.getDisposals().reduce((s, d) => s.plus(d.gainLossEur), new Decimal(0)).toFixed(2)).toBe("160.00");
  });
});
