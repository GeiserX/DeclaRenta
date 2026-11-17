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
  // 2024-06-03, 500 USD in the pool: buy 20 AAA (1000 USD: 500 tracked, 500
  // untracked), sell 10 of them (an intraday round trip, first), then buy BBB
  // for 500. Plain pass: the sale returns AAA's 500 tracked dollars and BBB
  // takes them; AAA keeps 500 untracked. The same-day cover would hand those
  // dollars back to AAA's untracked 500 and leave BBB untracked instead: it is
  // dropped. The day spends 500 USD the upload never shows (`dep`, valued at
  // the day's rate for the economic total only).
  // Until #446 this case sold an AAA held since 2023 and bought it back; that
  // sale now runs before every buy of its day (see the next describe), so the
  // intraday round trip is what can still reach the same-day cover.
  const sdr = [
    { k: "fund", d: "2024-02-01", usd: "500", r: "0.90" },
    { k: "buy", d: "2024-06-03", sym: "AAA", qty: "20", px: "50", r: "0.85" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "50", r: "0.85" },
    { k: "buy", d: "2024-06-03", sym: "BBB", qty: "5", px: "100", r: "0.85" },
    { k: "dep", d: "2024-06-03", usd: "500", r: "0.85" },
    { k: "sell", d: "2024-09-02", sym: "AAA", qty: "10", px: "55", r: "0.86" },
    { k: "sell", d: "2024-09-02", sym: "BBB", qty: "5", px: "110", r: "0.86" },
  ] as const satisfies Scenario["ev"];
  const sc: Scenario = {
    id: "SDR",
    years: [2024],
    closed: true,
    ev: [...sdr, { k: "conv", d: "2024-12-02", usd: "1100", r: "0.80" }],
  };

  it("BBB keeps the dollars it took without the cover", () => {
    const per = run(sc, { ...TRAD, fxTrace: true });
    const v = per.get(2024)!;
    const parks = (v.report.fxTrace ?? []).filter((t) => t.kind === "park" && t.date === "2024-06-03");
    expect(parks.map((t) => [t.positionKey, t.rate, t.quantityFcy])).toEqual([
      [ISIN_A, "0.9", "500"],
      [ISIN_A, null, "500"],
      [ISIN_B, "0.9", "500"],
    ]);
    expect(parks.some((t) => t.note?.startsWith("cobertura del mismo día"))).toBe(false);
    expect(v.report.messages.some((m) => m.id === "fx.conservation_mismatch")).toBe(false);
    // Stock (monodivisa's): AAA 0 + 10 × (55 × 0.86 − 50 × 0.85), BBB 5 × (110
    // × 0.86 − 100 × 0.85). FX: AAA's untracked 500 back at 0.86, BBB's 500 at
    // 0.90 + (0.86 − 0.85), both profits at 0.86, converted at 0.80.
    expect([f2(v.stock), f2(v.fx)]).toEqual([f2(run(sc, MONO).get(2024)!.stock), "-91.00"]);
    expect(f2(v.stock)).toBe("96.00");
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
  });

  it("a dropped 2024 cover leaves a 2023 late cover alone (L9)", () => {
    // 2023: CCC bought with no dollars, funded 2 days later: a late cover.
    // 2024: the same-day case above. Only the 2024 cover goes.
    const y2023: Scenario["ev"] = [
      { k: "buy", d: "2023-05-02", sym: "CCC", qty: "10", px: "100", r: "0.97" },
      { k: "fund", d: "2023-05-04", usd: "1000", r: "0.99" },
      { k: "sell", d: "2023-08-01", sym: "CCC", qty: "10", px: "100", r: "0.92" },
      { k: "conv", d: "2023-08-02", usd: "1000", r: "0.93" },
    ];
    const both: Scenario = {
      id: "L9",
      years: [2023, 2024],
      closed: true,
      ev: [...y2023, ...sdr, { k: "conv", d: "2024-12-02", usd: "1100", r: "0.80" }],
    };
    const per = run(both, TRAD);
    const alone = run({ id: "L9-2023", years: [2023], closed: true, ev: y2023 }, TRAD).get(2023)!;
    // 2023 is the same with or without the 2024 events: CCC covered at 0.99.
    expect([f2(alone.stock), f2(alone.fx)]).toEqual(["-50.00", "-10.00"]);
    expect([f2(per.get(2023)!.stock), f2(per.get(2023)!.fx)]).toEqual(["-50.00", "-10.00"]);
    expect(per.get(2023)!.report.messages.some((m) => m.id === "report.fx_traditional_uncovered")).toBe(false);
    // 2024 is the same-day case alone: the dropped cover changes nothing there.
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["96.00", "-91.00"]);
    expect(f2(lifetime(per))).toBe(f2(economic(both)));
  });
});

describe("a held position sold and bought back the same day: the sale runs first (issue #446)", () => {
  // AAA held since 2023 (1000 USD at 0.90, shares at 0.95). On 2024-06-03,
  // with an empty pool, more AAA is bought, the old AAA is sold, and BBB is
  // bought, in that upload order. The sale of the old shares runs before every
  // buy of its day and returns 1000 USD at 0.90 + (0.85 − 0.95) = 0.80; the
  // AAA rebuy (a round trip, before a plain buy) takes them, and BBB, the last
  // buy of the day, parks the 1000 USD the day never had. Before #446 the
  // rebuy ran first and parked untracked, BBB took the old AAA's dollars, and
  // a same-day cover was tried and dropped; both allocations leave 1000 USD
  // untracked and give the same figures, because both positions are bought
  // and sold on the same days at the same rates.
  const sc: Scenario = {
    id: "SDR-HELD",
    years: [2023, 2024],
    closed: true,
    ev: [
      { k: "fund", d: "2023-02-01", usd: "1000", r: "0.90" },
      { k: "buy", d: "2023-03-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
      { k: "buy", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
      { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
      { k: "buy", d: "2024-06-03", sym: "BBB", qty: "10", px: "100", r: "0.85" },
      { k: "dep", d: "2024-06-03", usd: "1000", r: "0.85" },
      { k: "sell", d: "2024-09-02", sym: "AAA", qty: "10", px: "110", r: "0.86" },
      { k: "sell", d: "2024-09-02", sym: "BBB", qty: "10", px: "110", r: "0.86" },
      { k: "conv", d: "2024-12-02", usd: "2200", r: "0.80" },
    ],
  };

  it("the rebuy takes the sale's dollars and BBB parks the untracked 1000", () => {
    const v = run(sc, { ...TRAD, fxTrace: true }).get(2024)!;
    const day = (v.report.fxTrace ?? []).filter((t) => t.date === "2024-06-03");
    expect(day.map((t) => [t.kind, t.positionKey, t.rate, t.quantityFcy])).toEqual([
      ["unpark", ISIN_A, "0.8", "1000"],
      ["park", ISIN_A, "0.8", "1000"],
      ["park", ISIN_B, null, "1000"],
    ]);
    expect(v.report.messages.some((m) => m.id === "fx.conservation_mismatch")).toBe(false);
  });

  it("books stock + FX = EUR out − EUR in, with monodivisa's stock line", () => {
    const per = run(sc, TRAD);
    const v = per.get(2024)!;
    // Stock: old AAA 1000 × (0.85 − 0.95) = −100; new AAA and BBB each
    // 1100 × 0.86 − 1000 × 0.85 = 96.
    expect([f2(v.stock), f2(v.s0328), f2(v.s0331)]).toEqual(
      (["stock", "s0328", "s0331"] as const).map((k) => f2(run(sc, MONO).get(2024)![k])),
    );
    expect(f2(v.stock)).toBe("92.00");
    // FX: AAA's 1000 back at 0.80 + (0.86 − 0.85) = 0.81, BBB's untracked 1000
    // at 0.86, both profits at 0.86; 2200 converted at 0.80: 1760 − 1842.
    expect(f2(v.fx)).toBe("-82.00");
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
    expect(f2(economic(sc))).toBe("10.00");
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

describe("held sales fund the day's buys in buy order (review r4600330140, issue #446)", () => {
  // Empty pool on 2024-06-03. AAA (listed first): buy 200, sell the old AAA
  // (50). BBB: buy 100, sell the old BBB (200). Both sales are of shares held
  // since 2023, so they run first and return 250 USD: AAA's 50 at
  // 0.90 + (0.85 − 0.92) = 0.83 and BBB's 200 at 0.90 + (0.85 − 0.91) = 0.84.
  // Then the buys take them in the order they ran: AAA's 200 (50 at 0.83, 150
  // at 0.84), then BBB's 100 (50 at 0.84, 50 untracked). Until #446 the buys
  // ran first, parked untracked, and the same-day cover gave the same
  // allocation (covering in parked-map order instead left AAA with the 50
  // untracked and moved 0.50 of FX from 2025 into 2024).
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

  it("AAA's buy takes 50 + 150 before BBB's, so BBB keeps the 50 untracked", () => {
    const trace = run(sc, { ...TRAD, fxTrace: true }).get(2024)!.report.fxTrace ?? [];
    const day = trace.filter((t) => t.date === "2024-06-03");
    expect(day.map((t) => [t.kind, t.positionKey, t.rate, f2(new Decimal(t.quantityFcy))])).toEqual([
      ["unpark", ISIN_A, "0.83", "50.00"],
      ["unpark", ISIN_B, "0.84", "200.00"],
      ["park", ISIN_A, "0.83", "50.00"],
      ["park", ISIN_A, "0.84", "150.00"],
      ["park", ISIN_B, "0.84", "50.00"],
      ["park", ISIN_B, null, "50.00"],
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

describe("same-day cover in buy order (review r4600330140)", () => {
  // Since #446 a same-day cover can only follow an intraday round trip: a sale
  // of shares bought that same day. BBB's parked queue is the older one (BBB
  // was bought and sold in 2023), so the parked map lists it first. On
  // 2024-06-03, with 100 USD in the pool: AAA buys 300 (100 tracked at 0.70,
  // 200 untracked) and sells a third for 140; that sale covers 140 of AAA's
  // untracked 200. BBB buys 400 (untracked) and sells half for 240; the first
  // 200 pay back what the sold half borrowed that day (#447), and the 40 of
  // profit cover 40 of AAA's last 60 first (its buy ran first that day), so
  // BBB keeps its other 200 untracked and sells them in 2025, and AAA sells
  // its last 20 untracked in 2024. Covering in map order gave the 40 to BBB
  // and left AAA with 60 untracked. Before #447 the sale also put the 200 it
  // paid back in the pool as dollars bought at 0.85, and they covered AAA's
  // 20 and 140 of BBB's.
  const sc: Scenario = {
    id: "SDO-INTRADAY",
    years: [2023, 2024, 2025],
    closed: true,
    ev: [
      { k: "fund", d: "2023-01-02", usd: "100", r: "0.90" },
      { k: "buy", d: "2023-01-03", sym: "BBB", qty: "1", px: "100", r: "0.91" },
      { k: "sell", d: "2023-02-01", sym: "BBB", qty: "1", px: "100", r: "0.93" },
      { k: "conv", d: "2023-03-01", usd: "100", r: "0.95" },
      { k: "fund", d: "2024-02-01", usd: "100", r: "0.70" },
      { k: "buy", d: "2024-06-03", sym: "AAA", qty: "3", px: "100", r: "0.85" },
      { k: "sell", d: "2024-06-03", sym: "AAA", qty: "1", px: "140", r: "0.85" },
      { k: "buy", d: "2024-06-03", sym: "BBB", qty: "4", px: "100", r: "0.85" },
      { k: "sell", d: "2024-06-03", sym: "BBB", qty: "2", px: "120", r: "0.85" },
      // The 220 USD the day spent beyond what it had (economic only).
      { k: "dep", d: "2024-06-03", usd: "220", r: "0.85" },
      { k: "sell", d: "2024-09-02", sym: "AAA", qty: "2", px: "100", r: "0.86" },
      { k: "conv", d: "2024-12-02", usd: "200", r: "0.80" },
      { k: "sell", d: "2025-03-03", sym: "BBB", qty: "2", px: "100", r: "0.83" },
      { k: "conv", d: "2025-06-02", usd: "200", r: "0.82" },
    ],
  };

  it("covers AAA's untracked slice before BBB's, after BBB pays back what it borrowed", () => {
    const per = run(sc, { ...TRAD, fxTrace: true });
    const trace = per.get(2024)!.report.fxTrace ?? [];
    const same = trace.filter((t) => t.kind === "park" && t.note?.startsWith("cobertura del mismo día"));
    expect(same.map((t) => [t.positionKey, t.rate, t.quantityFcy])).toEqual([
      [ISIN_A, "0.7", "100"],
      [ISIN_A, "0.85", "40"],
      [ISIN_A, "0.85", "40"],
    ]);
    const repaid = trace.filter((t) => t.kind === "discard" && t.note?.startsWith("compraventa del mismo día"));
    expect(repaid.map((t) => [t.date, t.positionKey, t.quantityFcy])).toEqual([["2024-06-03", ISIN_B, "200"]]);
    // The untracked principal later sales re-add at their own rate: AAA's 20, BBB's 200.
    const later = (per.get(2025)!.report.fxTrace ?? []).filter((t) => t.kind === "unpark" && t.date > "2024-06-03");
    expect(later.filter((t) => t.note?.startsWith("uncovered")).map((t) => [t.date, t.positionKey, t.quantityFcy])).toEqual([
      ["2024-09-02", ISIN_A, "20"],
      ["2025-03-03", ISIN_B, "200"],
    ]);
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
  });
});
