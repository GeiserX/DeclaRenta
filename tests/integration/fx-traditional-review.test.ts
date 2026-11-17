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
import { generateTaxReport } from "../../src/generators/report.js";
import { run, lifetime, economic, toStatement, TRAD, MONO, type Scenario } from "./fx-traditional-harness.js";

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

describe("a sale whose commission exceeds its gross (review r4598114592)", () => {
  // Fund 1001 USD, buy 1000 USD of AAA, sell it at 0 paying a 1 USD commission:
  // net proceeds −1 USD. Every dollar leaves the account.
  const sc: Scenario = {
    id: "NEGP",
    years: [2024],
    closed: true,
    ev: [
      { k: "fund", d: "2024-02-01", usd: "1001", r: "0.90" },
      { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
      { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "0", r: "0.85" },
    ],
  };
  const withCommission = (options: Parameters<typeof generateTaxReport>[3]) => {
    const { st, rates } = toStatement(sc);
    const sell = st.trades.find((t) => t.buySell === "SELL" && t.symbol === "AAA")!;
    sell.commission = "-1";
    return generateTaxReport(st, rates, 2024, options);
  };

  it("books the principal as lost dollars and the extra dollar as a fee", () => {
    const r = withCommission({ ...TRAD, fxTrace: true });
    const lost = r.fxGains.disposals.filter((d) => d.trigger === "stock_sale");
    // 1000 USD bought at 0.90, shares bought at 0.95: 50 € of drift.
    expect(lost.map((d) => [d.quantity.toString(), f2(d.gainLossEur)])).toEqual([["1000", "50.00"]]);
    const fee = r.fxGains.disposals.filter((d) => d.trigger === "commission");
    // 1 USD bought at 0.90, paid at 0.85.
    expect(fee.map((d) => [d.quantity.toString(), f2(d.gainLossEur)])).toEqual([["1", "-0.05"]]);
    // Nothing stays parked and the pool is empty: the cycle closes.
    const last = (r.fxTrace ?? []).at(-1)!;
    expect([last.poolBalanceFcy, last.parkedBalanceFcy]).toEqual(["0", "0"]);
    // Stock −1 × 0.85 − 1000 × 0.95, FX 50 − 0.05: total = −1001 × 0.90.
    expect(f2(r.capitalGains.netGainLoss.plus(r.fxGains.netGainLoss))).toBe("-900.90");
    expect(r.messages.some((m) => m.id === "fx.conservation_mismatch")).toBe(false);
    expect(r.messages.some((m) => m.id === "fx.missing_prior_lots")).toBe(false);
  });

  it("default and monodivisa ignore the sale, as before", () => {
    const d = withCommission({ fxTrace: true });
    expect(d.fxGains.disposals).toEqual([]);
    expect((d.fxTrace ?? []).some((t) => t.trigger === "stock_sale")).toBe(false);
    expect(withCommission(MONO).fxGains.disposals).toEqual([]);
  });
});
