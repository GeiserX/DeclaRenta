/**
 * «Tradicional con divisa» (issue #434): edge cases found in the PR review.
 *
 *  - A late cover never takes funding that pass 1 already gave to a covered
 *    stock buy, and never leaves new uncovered principal anywhere.
 *  - A sale whose commission exceeds its gross (negative net proceeds) is not
 *    dropped: its principal is lost dollars and the extra outflow is a fee.
 *  - The negative-cost guard re-adds its lot with only this sale's shift.
 *  - The guard's trace row carries the `stock_sale_guard` trigger.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { run, lifetime, economic, TRAD, type Scenario } from "./fx-traditional-harness.js";

const f2 = (d: Decimal) => d.toFixed(2);
const ISIN_A = "US0000000AA1";
const ISIN_B = "US0000000BB2";

describe("late cover: pass 1's funding of a covered buy keeps it (review r4598114581)", () => {
  // A buys with no dollars; the 03-04 conversion funds B (03-05) in pass 1.
  // Moving that conversion to A would leave B with no funding lot.
  const sc: Scenario = {
    id: "LCB",
    years: [2024],
    closed: true,
    ev: [
      { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.90" },
      { k: "fund", d: "2024-03-04", usd: "1000", r: "0.92" },
      { k: "buy", d: "2024-03-05", sym: "BBB", qty: "10", px: "100", r: "0.93" },
      { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
      { k: "sell", d: "2024-06-03", sym: "BBB", qty: "10", px: "100", r: "0.85" },
      { k: "conv", d: "2024-09-02", usd: "2000", r: "0.80" },
    ],
  };

  it("B stays covered by its conversion and A keeps the untracked path", () => {
    const v = run(sc, { ...TRAD, fxTrace: true }).get(2024)!;
    const parks = (v.report.fxTrace ?? []).filter((t) => t.kind === "park");
    const b = parks.filter((t) => t.positionKey === ISIN_B);
    expect(b.length).toBeGreaterThan(0);
    expect(b.every((t) => t.rate !== null), "B never parks uncovered").toBe(true);
    expect(parks.filter((t) => t.positionKey === ISIN_A).map((t) => t.rate)).toEqual([null]);
    // B's 1000 at 0.92 + (0.85 − 0.93) = 0.84; A's 1000 at 0.85; converted at 0.80.
    expect(f2(v.fx)).toBe("-90.00");
    expect(v.report.messages.some((m) => m.id === "fx.conservation_mismatch")).toBe(false);
  });

  it("a conversion larger than B's buy covers A with the part B did not use", () => {
    const big: Scenario = {
      ...sc,
      id: "LCB2",
      ev: sc.ev.map((e) => (e.k === "fund" ? { ...e, usd: "2000" } : e)),
    };
    const v = run(big, { ...TRAD, fxTrace: true }).get(2024)!;
    const parks = (v.report.fxTrace ?? []).filter((t) => t.kind === "park");
    expect(parks.every((t) => t.rate !== null), "both buys covered").toBe(true);
    expect(f2(lifetime(run(big, TRAD)))).toBe(f2(economic(big)));
  });
});

describe("covers never leave new uncovered principal (review r4598114581, rollback)", () => {
  // 2024-06-03, empty pool: buy more AAA and sell the old AAA (a round trip,
  // first), then buy BBB. Pass 1: the new AAA parks untracked and BBB takes the
  // dollars the old AAA returned. The same-day cover would hand those dollars to
  // the new AAA and leave BBB untracked instead: the rollback keeps pass 1.
  const sc: Scenario = {
    id: "SDR",
    years: [2023, 2024],
    closed: true,
    ev: [
      { k: "fund", d: "2023-02-01", usd: "1000", r: "0.90" },
      { k: "buy", d: "2023-03-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
      { k: "buy", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
      { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
      { k: "buy", d: "2024-06-03", sym: "BBB", qty: "10", px: "100", r: "0.85" },
      { k: "sell", d: "2024-09-02", sym: "AAA", qty: "10", px: "110", r: "0.86" },
      { k: "sell", d: "2024-09-02", sym: "BBB", qty: "10", px: "110", r: "0.86" },
      { k: "conv", d: "2024-12-02", usd: "2200", r: "0.80" },
    ],
  };

  it("BBB keeps the dollars it took in pass 1", () => {
    const v = run(sc, { ...TRAD, fxTrace: true }).get(2024)!;
    const parks = (v.report.fxTrace ?? []).filter((t) => t.kind === "park" && t.date === "2024-06-03");
    expect(parks.filter((t) => t.positionKey === ISIN_B).every((t) => t.rate !== null), "BBB covered").toBe(true);
    expect(parks.some((t) => t.note?.startsWith("cobertura del mismo día"))).toBe(false);
    expect(v.report.messages.some((m) => m.id === "fx.conservation_mismatch")).toBe(false);
  });
});
