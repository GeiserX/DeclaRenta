/**
 * «Tradicional con divisa» (issue #446): a same-day sale and rebuy of a HELD
 * position, with late funding in play.
 *
 * A trap: the day's legs ran as a round trip (buy first), so the rebuy found
 * the pool empty before the sale returned the old principal. In the cover
 * pass that buy parked "uncovered" (or took a later conversion as its late
 * cover), so the planner judged an earlier late cover as one that leaves new
 * uncovered principal and dropped it. The earlier buy then kept the untracked
 * path and its funding stayed in the pool as dollars nobody spent: the
 * currency total stopped matching EUR out − EUR in. Of 200 random closed
 * cycles, 26 missed in this method. Now a sale of shares bought on an EARLIER
 * day (`heldBefore`) runs before the rebuy in every method that runs the FX
 * engine, as the default does since #445.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { run, lifetime, economic, toStatement, TRAD, MONO, type Ev, type Scenario } from "./fx-traditional-harness.js";

const f2 = (d: Decimal) => d.toFixed(2);
const ISIN_A = "US0000000AA1";
const ISIN_B = "US0000000BB2";

describe("same-day sale and rebuy of a held position with a late cover (issue #446)", () => {
  // AAA is bought with no dollars and funded 3 days later (a late cover). BBB
  // is funded and bought on 04-01, then sold and bought back on 05-02 with no
  // other dollars. Run as a round trip, the rebuy parked "uncovered", the late
  // cover of AAA was dropped, and AAA's 1000 USD stayed in the pool:
  // −320 on an economic −270.
  const sc: Scenario = {
    id: "HB446",
    years: [2024],
    closed: true,
    ev: [
      { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.90" },
      { k: "fund", d: "2024-03-04", usd: "1000", r: "0.92" },
      { k: "fund", d: "2024-04-01", usd: "1000", r: "0.95" },
      { k: "buy", d: "2024-04-01", sym: "BBB", qty: "10", px: "100", r: "0.95" },
      { k: "sell", d: "2024-05-02", sym: "BBB", qty: "10", px: "100", r: "0.97" },
      { k: "buy", d: "2024-05-02", sym: "BBB", qty: "10", px: "100", r: "0.97" },
      { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
      { k: "sell", d: "2024-06-03", sym: "BBB", qty: "10", px: "100", r: "0.85" },
      { k: "conv", d: "2024-09-02", usd: "2000", r: "0.80" },
    ],
  };

  it("stock + FX equal EUR out − EUR in, and the stock line equals monodivisa's", () => {
    const per = run(sc, TRAD);
    const mono = run(sc, MONO).get(2024)!;
    const v = per.get(2024)!;
    // EUR in 920 + 950, EUR out 2000 × 0.80 = 1600.
    expect(f2(economic(sc))).toBe("-270.00");
    expect(f2(lifetime(per))).toBe("-270.00");
    // Stock: AAA 10 × 100 × (0.85 − 0.90) = −50; BBB 1000 × (0.97 − 0.95) = 20
    // and 1000 × (0.85 − 0.97) = −120.
    expect([f2(v.stock), f2(v.s0328), f2(v.s0331)]).toEqual([f2(mono.stock), f2(mono.s0328), f2(mono.s0331)]);
    expect(f2(v.stock)).toBe("-150.00");
    // FX: AAA's 1000 come back at 0.92 + (0.85 − 0.90) = 0.87; BBB's at
    // 0.95 + (0.97 − 0.95) = 0.97 on 05-02, then 0.97 + (0.85 − 0.97) = 0.85;
    // converted at 0.80: 1600 − 870 − 850.
    expect([f2(v.t1633), f2(v.a1637), f2(v.fx)]).toEqual(["1600.00", "1720.00", "-120.00"]);
    expect(v.report.messages.map((m) => m.id)).not.toContain("report.fx_traditional_uncovered");
    expect(v.report.messages.map((m) => m.id)).not.toContain("fx.conservation_mismatch");
  });

  it("the late cover of AAA stays and the sale's dollars fund the rebuy", () => {
    const trace = run(sc, { ...TRAD, fxTrace: true }).get(2024)!.report.fxTrace ?? [];
    expect(trace.filter((t) => t.kind === "park").every((t) => t.rate !== null), "no untracked principal").toBe(true);
    expect(trace.filter((t) => t.kind === "park" && t.positionKey === ISIN_A).map((t) => t.rate)).toEqual(["0.92"]);
    const may = trace.filter((t) => t.date === "2024-05-02");
    expect(may.map((t) => [t.kind, t.positionKey, t.rate, t.quantityFcy])).toEqual([
      ["unpark", ISIN_B, "0.97", "1000"],
      ["park", ISIN_B, "0.97", "1000"],
    ]);
    // Every dollar is converted: the pool ends empty.
    expect(trace[trace.length - 1]!.poolBalanceFcy).toBe("0");
  });

  it("a sale of shares bought that same day still runs after their buy", () => {
    // An intraday round trip with the dollars already in the pool: the buy
    // parks them before the sale returns them, so nothing is untracked.
    const intraday: Scenario = {
      id: "INTRADAY-T",
      years: [2024],
      closed: true,
      ev: [
        { k: "fund", d: "2024-02-01", usd: "1000", r: "0.80" },
        { k: "buy", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
        { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "110", r: "0.85" },
        { k: "conv", d: "2024-10-01", usd: "1100", r: "1.00" },
      ],
    };
    const per = run(intraday, { ...TRAD, fxTrace: true });
    expect(f2(lifetime(per))).toBe(f2(economic(intraday)));
    const june = per.get(2024)!.report.fxTrace!.filter((t) => t.date === "2024-06-03");
    expect(june.map((t) => [t.kind, t.quantityFcy])).toEqual([
      ["park", "1000"],
      ["unpark", "1000"],
      ["profit", "100"],
    ]);
  });
});

describe("«Tradicional con divisa»: a cross-currency sale keeps stock FIFO order beside a same-day rebuy (issue #446)", () => {
  // The mirror of the default's PR #445 case. Two 1000 USD lots of AAA:
  // funded at 0.80 and 0.70, bought at 0.90 and 1.00. On one day lot 1 is
  // sold in EUR, lot 2 in USD, and AAA is bought back in USD. The stock FIFO
  // gives the EUR sale lot 1, so its drift is 1000 × (0.90 − 0.80) = 100, and
  // lot 2's dollars come back at 0.70 + (0.85 − 1.00) = 0.55 for the rebuy.
  const sc: Scenario = {
    id: "XHELD-T",
    years: [2024],
    closed: false,
    ev: [
      { k: "fund", d: "2024-02-01", usd: "1000", r: "0.80" },
      { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.90" },
      { k: "fund", d: "2024-04-01", usd: "1000", r: "0.70" },
      { k: "buy", d: "2024-05-02", sym: "AAA", qty: "10", px: "100", r: "1.00" },
      { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
      { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
      { k: "buy", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
    ],
  };

  it("releases lot 1's slice and parks the rebuy on lot 2's dollars", () => {
    const { st, rates } = toStatement(sc);
    const eurSale = st.trades.find((t) => t.tradeDate === "2024-06-03" && t.buySell === "SELL")!;
    eurSale.currency = "EUR";
    eurSale.commissionCurrency = "EUR";
    const r = generateTaxReport(st, rates, 2024, { ...TRAD, fxTrace: true });
    expect(r.fxGains.disposals.map((d) => [d.trigger, f2(d.proceedsEur), f2(d.costBasisEur)])).toEqual([
      ["stock_sale_cross", "900.00", "800.00"],
    ]);
    const rebuy = (r.fxTrace ?? []).filter((t) => t.date === "2024-06-03" && t.kind === "park");
    expect(rebuy.map((t) => [f2(new Decimal(t.quantityFcy)), t.rate])).toEqual([["1000.00", "0.55"]]);
  });
});

describe("a cross-currency sale's own proceeds fund a same-day rebuy in that currency (issue #446)", () => {
  // AAA is bought in EUR, sold in USD and bought back in USD on 05-02. BBB is
  // bought 03-01 with no dollars and funded 03-04 (a late cover at 0.92).
  // The USD sale's 1000 must arrive before the USD rebuy: run after it, the
  // rebuy parked the 03-04 funding, the planner dropped BBB's late cover and
  // the funding stayed in the pool (−370 on an economic −320).
  // EUR out − EUR in = 1600 − 920 − 1000 = −320. Stock as monodivisa: −200.
  // FX: BBB's dollars come back at 0.92 + (0.85 − 0.90) = 0.87, the sale's at
  // 0.97 + (0.85 − 0.97) = 0.85, and 2000 USD go out at 0.80:
  // 1600 − 870 − 850 = −120.
  const sc: Scenario = {
    id: "XEUR-REBUY",
    years: [2024],
    closed: true,
    ev: [
      { k: "buy", d: "2024-02-01", sym: "AAA", qty: "10", px: "100", r: "0.93" },
      { k: "buy", d: "2024-03-01", sym: "BBB", qty: "10", px: "100", r: "0.90" },
      { k: "fund", d: "2024-03-04", usd: "1000", r: "0.92" },
      { k: "sell", d: "2024-05-02", sym: "AAA", qty: "10", px: "100", r: "0.97" },
      { k: "buy", d: "2024-05-02", sym: "AAA", qty: "10", px: "100", r: "0.97" },
      { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
      { k: "sell", d: "2024-06-03", sym: "BBB", qty: "10", px: "100", r: "0.85" },
      { k: "conv", d: "2024-09-02", usd: "2000", r: "0.80" },
    ],
  };
  const report = (o: typeof TRAD) => {
    const { st, rates } = toStatement(sc);
    const eurBuy = st.trades.find((t) => t.tradeDate === "2024-02-01")!;
    eurBuy.currency = "EUR";
    eurBuy.commissionCurrency = "EUR";
    return generateTaxReport(st, rates, 2024, { ...o, fxTrace: true });
  };

  it("«Tradicional con divisa»: stock = monodivisa, FX −120, total −320, no untracked note", () => {
    const r = report(TRAD);
    const mono = report(MONO);
    expect(f2(r.capitalGains.netGainLoss)).toBe(f2(mono.capitalGains.netGainLoss));
    expect(f2(r.capitalGains.netGainLoss)).toBe("-200.00");
    expect(f2(r.fxGains.netGainLoss)).toBe("-120.00");
    expect(r.messages.map((m) => m.id)).not.toContain("report.fx_traditional_uncovered");
  });

  it("the default's total stays at −320", () => {
    const r = report({});
    expect(f2(r.capitalGains.netGainLoss.plus(r.fxGains.netGainLoss))).toBe("-320.00");
  });
});

// ── Seeded property test: random closed cycles ───────────────────────────────
// Late funding (0 to 6 days after an unfunded buy), same-day rotations and
// rebuys of held positions, plain sales and conversions; no loss sales are
// forced, but some happen. Every cycle is closed, so stock + FX of all years
// must equal EUR out − EUR in in every method that runs the FX engine, and the
// mode's stock boxes must equal monodivisa's.

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

function day(n: number): string {
  const t = new Date("2024-01-02T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function cycle(seed: number): Scenario {
  const rand = rng(seed);
  const rate = () => (0.8 + Math.floor(rand() * 30) / 100).toFixed(2);
  const ev: Ev[] = [];
  const held: Record<string, { q: number; px: number }> = { AAA: { q: 0, px: 0 }, BBB: { q: 0, px: 0 } };
  let usd = 0;
  let d = 0;
  for (let i = 0; i < 14; i++) {
    d += 1 + Math.floor(rand() * 20);
    const x = rand();
    const sym = rand() < 0.5 ? "AAA" : "BBB";
    const other = sym === "AAA" ? "BBB" : "AAA";
    const r = rate();
    if (x < 0.3) {
      // Buy now, fund 0 to 6 days later.
      const px = 50 + Math.floor(rand() * 50);
      const qty = 5 + Math.floor(rand() * 10);
      if (held[sym]!.q > 0) continue;
      ev.push({ k: "buy", d: day(d), sym, qty: String(qty), px: String(px), r });
      held[sym] = { q: qty, px };
      const lag = Math.floor(rand() * 7);
      const fund = Math.max(0, qty * px - usd);
      if (fund > 0) {
        ev.push({ k: "fund", d: day(d + lag), usd: String(fund), r: lag === 0 ? r : rate() });
        usd += fund;
      }
      usd -= qty * px;
      d += lag;
    } else if (x < 0.5 && held[sym]!.q > 0) {
      // Same-day sale and rebuy, or rotation into the other position.
      const h = held[sym]!;
      const px = h.px + Math.floor(rand() * 20);
      ev.push({ k: "sell", d: day(d), sym, qty: String(h.q), px: String(px), r });
      usd += h.q * px;
      const tgt = rand() < 0.5 ? sym : other;
      held[sym] = { q: 0, px: 0 };
      if (held[tgt]!.q === 0) {
        const q = Math.max(1, Math.floor(usd / px));
        ev.push({ k: "buy", d: day(d), sym: tgt, qty: String(q), px: String(px), r });
        held[tgt] = { q, px };
        usd -= q * px;
      }
    } else if (x < 0.7 && held[sym]!.q > 0) {
      const h = held[sym]!;
      const px = h.px + Math.floor(rand() * 20);
      ev.push({ k: "sell", d: day(d), sym, qty: String(h.q), px: String(px), r });
      usd += h.q * px;
      held[sym] = { q: 0, px: 0 };
    } else if (usd > 100) {
      const amt = Math.floor(usd * rand());
      if (amt > 0) {
        ev.push({ k: "conv", d: day(d), usd: String(amt), r });
        usd -= amt;
      }
    } else {
      ev.push({ k: "fund", d: day(d), usd: "1000", r });
      usd += 1000;
    }
  }
  for (const sym of ["AAA", "BBB"]) {
    const h = held[sym]!;
    if (h.q > 0) {
      d += 3;
      ev.push({ k: "sell", d: day(d), sym, qty: String(h.q), px: String(h.px), r: rate() });
      usd += h.q * h.px;
    }
  }
  d += 3;
  if (usd > 0) ev.push({ k: "conv", d: day(d), usd: String(usd), r: rate() });
  ev.sort((a, b) => a.d.localeCompare(b.d));
  const years = [...new Set(ev.map((e) => Number(e.d.slice(0, 4))))].sort();
  return { id: `Q${seed}`, years, closed: true, ev };
}

describe("random closed cycles with late funding and same-day rebuys (issue #446)", () => {
  const N = 200;
  const cycles = Array.from({ length: N }, (_, i) => cycle(i + 1));

  it("the generator covers the case: some cycles rebuy a held position the same day", () => {
    const rebuys = cycles.filter((s) =>
      s.ev.some((e, i) => e.k === "sell" && s.ev.some((b, j) => j !== i && b.k === "buy" && b.d === e.d && b.sym === e.sym)),
    );
    expect(rebuys.length).toBeGreaterThan(40);
  });

  for (const [name, opts] of [
    ["«Tradicional con divisa»", TRAD],
    ["the default", {}],
  ] as const) {
    it(`${name}: stock + FX of every cycle equal EUR out − EUR in`, () => {
      const misses: string[] = [];
      for (const s of cycles) {
        const per = run(s, opts);
        const conservation = [...per.values()].some((v) =>
          v.report.messages.some((m) => m.id === "fx.conservation_mismatch"),
        );
        const tot = f2(lifetime(per));
        const eco = f2(economic(s));
        if (tot !== eco || conservation) misses.push(`${s.id}: ${tot} vs ${eco}${conservation ? " (conservation)" : ""}`);
      }
      expect(misses).toEqual([]);
    });
  }

  it("«Tradicional con divisa»: 0328/0331 equal monodivisa's in every year", () => {
    const misses: string[] = [];
    for (const s of cycles.slice(0, 50)) {
      const trad = run(s, TRAD);
      const mono = run(s, MONO);
      for (const [y, v] of trad) {
        const m = mono.get(y)!;
        if (!v.s0328.equals(m.s0328) || !v.s0331.equals(m.s0331)) misses.push(`${s.id} ${y}`);
      }
    }
    expect(misses).toEqual([]);
  });
});
