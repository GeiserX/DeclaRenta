/**
 * «Tradicional con divisa» (issue #434): edge cases found in the PR review.
 *
 *  - A late conversion covers the earlier unfunded buy first (G2); a buy that
 *    loses its funding that way is covered in turn by its own later funding.
 *  - A cover never leaves new uncovered principal: one that would is dropped
 *    alone, and a later year never undoes an earlier year's cover.
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

describe("late cover: the conversion covers the earlier unfunded buy first (G2, review r4598114581)", () => {
  // A buys with no dollars; the 03-04 conversion funds B (03-05) in the plain
  // pass. G2: it covers A first, and B, left with no dollars, is covered in
  // turn by its own funding 1 to 7 days later.
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
  const parksOf = (s: Scenario) =>
    (run(s, { ...TRAD, fxTrace: true }).get(2024)!.report.fxTrace ?? []).filter((t) => t.kind === "park");

  it("B's own funding 4 days later covers B once the conversion covers A (8 days after A)", () => {
    const funded: Scenario = {
      ...sc,
      id: "LCB3",
      ev: [...sc.ev, { k: "fund", d: "2024-03-09", usd: "1000", r: "0.95" }],
    };
    expect(parksOf(funded).every((t) => t.rate !== null), "no untracked principal").toBe(true);
    const per = run(funded, TRAD);
    // A: 1000 at 0.92 + (0.85 − 0.90); B: 1000 at 0.95 + (0.85 − 0.93); converted at 0.80.
    expect(f2(per.get(2024)!.fx)).toBe("-140.00");
    expect(f2(lifetime(per))).toBe(f2(economic(funded)));
  });

  it("with nothing to cover B, the cover of A is dropped: B keeps its conversion and A the untracked path", () => {
    const v = run(sc, { ...TRAD, fxTrace: true }).get(2024)!;
    const parks = parksOf(sc);
    const b = parks.filter((t) => t.positionKey === ISIN_B);
    expect(b.length).toBeGreaterThan(0);
    expect(b.every((t) => t.rate !== null), "B never parks uncovered").toBe(true);
    expect(parks.filter((t) => t.positionKey === ISIN_A).map((t) => t.rate)).toEqual([null]);
    // B's 1000 at 0.92 + (0.85 − 0.93) = 0.84; A's 1000 at 0.85; converted at 0.80.
    expect(f2(v.fx)).toBe("-90.00");
    expect(v.report.messages.some((m) => m.id === "fx.conservation_mismatch")).toBe(false);
  });

  it("a conversion larger than both buys covers A first and funds B with the rest", () => {
    const big: Scenario = {
      ...sc,
      id: "LCB2",
      ev: sc.ev.map((e) => (e.k === "fund" ? { ...e, usd: "2000" } : e)),
    };
    expect(parksOf(big).every((t) => t.rate !== null), "both buys covered").toBe(true);
    expect(f2(lifetime(run(big, TRAD)))).toBe(f2(economic(big)));
  });

  it("a monthly buy-then-fund chain lands on the economic total (L5)", () => {
    // Plain pass: A untracked, A's funding pays B, B's funding stays in the pool.
    const chain: Scenario = {
      id: "L5",
      years: [2024],
      closed: true,
      ev: [
        { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.90" },
        { k: "fund", d: "2024-03-04", usd: "1000", r: "0.91" },
        { k: "buy", d: "2024-04-01", sym: "BBB", qty: "10", px: "100", r: "0.93" },
        { k: "fund", d: "2024-04-03", usd: "1000", r: "0.94" },
        { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
        { k: "sell", d: "2024-06-03", sym: "BBB", qty: "10", px: "100", r: "0.85" },
        { k: "conv", d: "2024-09-02", usd: "2000", r: "0.80" },
      ],
    };
    const per = run(chain, TRAD);
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["-130.00", "-120.00"]);
    expect(f2(lifetime(per))).toBe("-250.00");
    expect(f2(lifetime(per))).toBe(f2(economic(chain)));
    expect(per.get(2024)!.report.messages.some((m) => m.id === "report.fx_traditional_uncovered")).toBe(false);
  });
});

describe("covers never leave new uncovered principal (review r4598114581, rollback)", () => {
  // 2024-06-03, empty pool: buy more AAA and sell the old AAA (a round trip,
  // first), then buy BBB. Plain pass: the new AAA parks untracked and BBB takes
  // the dollars the old AAA returned. The same-day cover would hand those
  // dollars to the new AAA and leave BBB untracked instead: it is dropped.
  const sdr = [
    { k: "buy", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
    { k: "buy", d: "2024-06-03", sym: "BBB", qty: "10", px: "100", r: "0.85" },
    { k: "sell", d: "2024-09-02", sym: "AAA", qty: "10", px: "110", r: "0.86" },
    { k: "sell", d: "2024-09-02", sym: "BBB", qty: "10", px: "110", r: "0.86" },
  ] as const satisfies Scenario["ev"];
  const sc: Scenario = {
    id: "SDR",
    years: [2023, 2024],
    closed: true,
    ev: [
      { k: "fund", d: "2023-02-01", usd: "1000", r: "0.90" },
      { k: "buy", d: "2023-03-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
      ...sdr,
      { k: "conv", d: "2024-12-02", usd: "2200", r: "0.80" },
    ],
  };

  it("BBB keeps the dollars it took without the cover", () => {
    const v = run(sc, { ...TRAD, fxTrace: true }).get(2024)!;
    const parks = (v.report.fxTrace ?? []).filter((t) => t.kind === "park" && t.date === "2024-06-03");
    expect(parks.filter((t) => t.positionKey === ISIN_B).every((t) => t.rate !== null), "BBB covered").toBe(true);
    expect(parks.some((t) => t.note?.startsWith("cobertura del mismo día"))).toBe(false);
    expect(v.report.messages.some((m) => m.id === "fx.conservation_mismatch")).toBe(false);
  });

  it("a dropped 2024 cover leaves a 2023 late cover alone (L9)", () => {
    // 2023: CCC bought with no dollars, funded 2 days later: a late cover.
    // 2024: the same-day case above. Only the 2024 cover goes.
    const y2023: Scenario["ev"] = [
      { k: "fund", d: "2023-02-01", usd: "1000", r: "0.90" },
      { k: "buy", d: "2023-03-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
      { k: "buy", d: "2023-05-02", sym: "CCC", qty: "10", px: "100", r: "0.97" },
      { k: "fund", d: "2023-05-04", usd: "1000", r: "0.99" },
      { k: "sell", d: "2023-08-01", sym: "CCC", qty: "10", px: "100", r: "0.92" },
      { k: "conv", d: "2023-08-02", usd: "1000", r: "0.93" },
    ];
    const both: Scenario = {
      id: "L9",
      years: [2023, 2024],
      closed: true,
      ev: [...y2023, ...sdr, { k: "conv", d: "2024-12-02", usd: "1200", r: "0.80" }],
    };
    const per = run(both, TRAD);
    const alone = run({ id: "L9-2023", years: [2023], closed: true, ev: y2023 }, TRAD).get(2023)!;
    // 2023 is the same with or without the 2024 events: CCC covered at 0.99.
    expect([f2(alone.stock), f2(alone.fx)]).toEqual(["-50.00", "-10.00"]);
    expect([f2(per.get(2023)!.stock), f2(per.get(2023)!.fx)]).toEqual(["-50.00", "-10.00"]);
    expect(per.get(2023)!.report.messages.some((m) => m.id === "report.fx_traditional_uncovered")).toBe(false);
    // 2024 keeps the untracked 1000 the same-day case has anyway (+10 on 0).
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["92.00", "-22.00"]);
    expect(f2(lifetime(per))).toBe("10.00");
    expect(f2(economic(both))).toBe("0.00");
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

describe("negative-cost guard (review r4598114603, r4598114654)", () => {
  // 2023: 1000 USD at 1.00 go through AAA (bought at 1.00, sold at 0.50), so
  // they come back at 0.50 with a 2023 shift of −0.50. 2024: BBB bought at 2.00
  // and sold at 1.00: 0.50 + 1.00 − 2.00 < 0, the guard books 1500 and re-adds
  // the dollars at 1.00. 2025: converted at 1.10.
  const sc: Scenario = {
    id: "GRD",
    years: [2023, 2024, 2025],
    closed: true,
    ev: [
      { k: "fund", d: "2023-02-01", usd: "1000", r: "1.00" },
      { k: "buy", d: "2023-03-01", sym: "AAA", qty: "10", px: "100", r: "1.00" },
      { k: "sell", d: "2023-06-01", sym: "AAA", qty: "10", px: "100", r: "0.50" },
      { k: "buy", d: "2024-03-01", sym: "BBB", qty: "10", px: "100", r: "2.00" },
      { k: "sell", d: "2024-06-03", sym: "BBB", qty: "10", px: "100", r: "1.00" },
      { k: "conv", d: "2025-02-03", usd: "1000", r: "1.10" },
    ],
  };

  it("the guard row reports the 2023 shift once; the re-added lot carries only the 2024 one", () => {
    const per = run(sc, { ...TRAD, fxTrace: true });
    const guard = per.get(2024)!.report.fxGains.disposals.filter((d) => d.trigger === "stock_sale_guard");
    expect(guard.map((d) => [f2(d.gainLossEur), f2(d.declaredShiftEur!)])).toEqual([["1500.00", "-500.00"]]);
    const conv = per.get(2025)!.report.fxGains.disposals;
    expect(conv.map((d) => [d.trigger, f2(d.gainLossEur), f2(d.declaredShiftEur!)])).toEqual([["conversion", "100.00", "-1000.00"]]);
    const inflight = per.get(2025)!.report.messages.find((m) => m.id === "report.fx_traditional_inflight")!;
    expect([inflight.context?.amount, inflight.context?.years]).toEqual(["-1000.00", "2024"]);
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
  });

  it("the guard's trace row has the trigger of its disposal", () => {
    const trace = run(sc, { ...TRAD, fxTrace: true }).get(2024)!.report.fxTrace ?? [];
    const rows = trace.filter((t) => t.kind === "dispose" && t.date === "2024-06-03");
    expect(rows.map((t) => t.trigger)).toEqual(["stock_sale_guard"]);
  });
});

describe("same-day cover in buy order (review r4600330140)", () => {
  // Empty pool on 2024-06-03. AAA (round trip, listed first): buy 200 untracked,
  // the old AAA returns 50, which covers 50 of it. BBB: buy 100 untracked, the
  // old BBB returns 200. Those 200 must cover AAA's 150 first (its buy ran
  // first that day), then 50 of BBB's 100. BBB's queue is older than AAA's, so
  // the parked map lists it first: covering in map order left AAA with 50
  // untracked instead of BBB, and moved 0.50 of FX from 2025 into 2024.
  const sc: Scenario = {
    id: "SDO",
    years: [2023, 2024, 2025],
    closed: true,
    ev: [
      { k: "fund", d: "2023-01-02", usd: "250", r: "0.90" },
      { k: "buy", d: "2023-01-03", sym: "BBB", qty: "2", px: "100", r: "0.91" },
      { k: "buy", d: "2023-01-04", sym: "AAA", qty: "1", px: "50", r: "0.92" },
      { k: "buy", d: "2024-06-03", sym: "AAA", qty: "4", px: "50", r: "0.85" },
      { k: "sell", d: "2024-06-03", sym: "AAA", qty: "1", px: "50", r: "0.85" },
      { k: "buy", d: "2024-06-03", sym: "BBB", qty: "1", px: "100", r: "0.85" },
      { k: "sell", d: "2024-06-03", sym: "BBB", qty: "2", px: "100", r: "0.85" },
      // The 50 USD the day spent beyond what it had: no EUR origin (economic only).
      { k: "dep", d: "2024-06-03", usd: "50", r: "0.85" },
      { k: "sell", d: "2024-09-02", sym: "AAA", qty: "4", px: "50", r: "0.86" },
      { k: "conv", d: "2024-12-02", usd: "200", r: "0.80" },
      { k: "sell", d: "2025-03-03", sym: "BBB", qty: "1", px: "100", r: "0.83" },
      { k: "conv", d: "2025-06-02", usd: "100", r: "0.82" },
    ],
  };

  it("covers AAA's 150 before BBB's 100, so BBB keeps the 50 untracked", () => {
    const trace = run(sc, { ...TRAD, fxTrace: true }).get(2024)!.report.fxTrace ?? [];
    const same = trace.filter((t) => t.kind === "park" && t.note?.startsWith("cobertura del mismo día"));
    expect(same.map((t) => [t.positionKey, f2(new Decimal(t.quantityFcy))])).toEqual([
      [ISIN_A, "50.00"],
      [ISIN_A, "150.00"],
      [ISIN_B, "50.00"],
    ]);
  });

  it("books the FX of each year by that allocation", () => {
    const per = run(sc, TRAD);
    // 2024: AAA's 50 at 0.83 + 0.01 and 150 at 0.84 + 0.01, converted at 0.80.
    expect(f2(per.get(2024)!.fx)).toBe("-9.50");
    // 2025: BBB's 50 at 0.84 − 0.02 and 50 untracked at 0.83, converted at 0.82.
    expect(f2(per.get(2025)!.fx)).toBe("-0.50");
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
  });
});
