/**
 * Intraday round trips with no currency of their own (issue #447), in both
 * methods that run the FX engine.
 *
 * An intraday round trip buys and sells shares of one position on the same
 * day. When the pool is short, its buy parks the rest "uncovered" (`null`):
 * the account went below zero for the day. Two traps:
 *  - its sale re-added that `null` part at the sale rate, as for an untracked
 *    opening balance, so dollars that never existed entered the pool. A
 *    conversion spent them before a later-dated late cover (IRT-EARLY: −120
 *    in «Tradicional con divisa» and −70 in the default, on an economic −40),
 *    and their transient `null` made the planner drop an earlier late cover
 *    (IRT: −90 in «Tradicional con divisa»). The sale now pays that part back
 *    first, with no FX and no pool lot;
 *  - a round trip whose later buy lost its dollars to an earlier late cover
 *    kept them `null`, while its own sale returned as many dollars to the
 *    pool, because the trial never switched on that day's same-day cover; the
 *    planner then dropped the late cover (IRT-CHAIN: −230 on an economic
 *    −180). The trial's chain now takes the same-day cover too, as it takes
 *    the late cover.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { run, lifetime, economic, TRAD, MONO, type Ev, type Scenario } from "./fx-traditional-harness.js";

const f2 = (d: Decimal) => d.toFixed(2);
const ISIN_B = "US0000000BB2";
const METHODS = [
  ["«Tradicional con divisa»", TRAD],
  ["the default", {}],
] as const;

function messages(per: ReturnType<typeof run>): string[] {
  return [...per.values()].flatMap((v) => v.report.messages.map((m) => m.id));
}

/** AAA bought 03-01 with no dollars and funded 03-04; BBB bought and sold 10 × 100 → 10 × 110 on `rt`. */
function irt(id: string, rt: string): Scenario {
  const ev: Ev[] = [
    { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.90" },
    { k: "fund", d: "2024-03-04", usd: "1000", r: "0.92" },
    { k: "buy", d: rt, sym: "BBB", qty: "10", px: "100", r: "0.95" },
    { k: "sell", d: rt, sym: "BBB", qty: "10", px: "110", r: "0.95" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
    { k: "conv", d: "2024-09-02", usd: "1100", r: "0.80" },
  ];
  return { id, years: [2024], closed: true, ev: ev.sort((a, b) => a.d.localeCompare(b.d)) };
}

describe("an intraday round trip with no dollars after a late-covered buy (issue #447)", () => {
  // EUR in 1000 × 0.92, EUR out 1100 × 0.80: −40. Stock: AAA 1000 × (0.85 −
  // 0.90) = −50, BBB 100 × 0.95 = 95. The 1000 BBB borrowed for the day are
  // paid back by its sale, so the late cover of AAA stays: AAA's 1000 come
  // back at 0.92 + (0.85 − 0.90) = 0.87 in «Tradicional con divisa» and at
  // 0.92 in the default, and the 100 of profit at 0.95.
  for (const [name, opts] of METHODS) {
    it(`${name}: round trip after the funding (IRT), −40`, () => {
      const sc = irt("IRT", "2024-04-01");
      const per = run(sc, opts);
      expect(f2(economic(sc))).toBe("-40.00");
      expect(f2(lifetime(per))).toBe("-40.00");
      expect(messages(per)).not.toContain("report.fx_traditional_uncovered");
    });

    it(`${name}: round trip between the buy and its funding (IRT-EARLY), −40`, () => {
      const sc = irt("IRT-EARLY", "2024-03-02");
      const per = run(sc, opts);
      expect(f2(lifetime(per))).toBe("-40.00");
      expect(messages(per)).not.toContain("report.fx_traditional_uncovered");
    });
  }

  it("the sale pays back the 1000 it borrowed: no pool lot, and only the profit comes back", () => {
    const per = run(irt("IRT-EARLY", "2024-03-02"), { ...TRAD, fxTrace: true });
    const day = (per.get(2024)!.report.fxTrace ?? []).filter((t) => t.date === "2024-03-02");
    expect(day.map((t) => [t.kind, t.positionKey, t.rate, t.quantityFcy, t.poolBalanceFcy])).toEqual([
      ["park", ISIN_B, null, "1000", "0"],
      ["discard", ISIN_B, null, "1000", "0"],
      ["profit", ISIN_B, "0.95", "100", "100"],
    ]);
    expect(day[1]!.note).toMatch(/^compraventa del mismo día sin divisa/);
  });

  it("«Tradicional con divisa»: the stock boxes equal monodivisa's", () => {
    for (const sc of [irt("IRT", "2024-04-01"), irt("IRT-EARLY", "2024-03-02")]) {
      const v = run(sc, TRAD).get(2024)!;
      const m = run(sc, MONO).get(2024)!;
      expect([f2(v.s0328), f2(v.s0331)]).toEqual([f2(m.s0328), f2(m.s0331)]);
    }
  });
});

describe("a round trip whose second buy loses its dollars to an earlier late cover (issue #447)", () => {
  // AAA is bought with no dollars and funded on 03-04 with 1500. Without the
  // late cover the pool pays both BBB buys of 03-05; with it, only 500 are
  // left, so the second buy parks 500 untracked while the sale of the first
  // buy's shares returns 500. The same-day cover gives those 500 to the
  // second buy; without it the trial left new untracked principal and the
  // planner dropped AAA's late cover: −230 on an economic −180.
  const sc: Scenario = {
    id: "IRT-CHAIN",
    years: [2024],
    closed: true,
    ev: [
      { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.90" },
      { k: "fund", d: "2024-03-04", usd: "1500", r: "0.92" },
      { k: "buy", d: "2024-03-05", sym: "BBB", qty: "5", px: "100", r: "0.94" },
      { k: "buy", d: "2024-03-05", sym: "BBB", qty: "5", px: "100", r: "0.94" },
      { k: "sell", d: "2024-03-05", sym: "BBB", qty: "5", px: "100", r: "0.94" },
      { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
      { k: "sell", d: "2024-07-01", sym: "BBB", qty: "5", px: "100", r: "0.90" },
      { k: "conv", d: "2024-09-02", usd: "1500", r: "0.80" },
    ],
  };

  for (const [name, opts] of METHODS) {
    it(`${name}: stock + FX equal EUR out − EUR in (−180), with no untracked note`, () => {
      const per = run(sc, opts);
      expect(f2(economic(sc))).toBe("-180.00");
      expect(f2(lifetime(per))).toBe("-180.00");
      expect(messages(per)).not.toContain("report.fx_traditional_uncovered");
    });
  }

  it("the late cover stays and the sale's 500 cover the second buy", () => {
    const trace = run(sc, { ...TRAD, fxTrace: true }).get(2024)!.report.fxTrace ?? [];
    expect(trace.filter((t) => t.note?.startsWith("cobertura tardía")).map((t) => [t.date, t.quantityFcy])).toEqual([
      ["2024-03-01", "1000"],
    ]);
    const same = trace.filter((t) => t.note?.startsWith("cobertura del mismo día"));
    expect(same.map((t) => [t.date, t.positionKey, t.rate, t.quantityFcy])).toEqual([["2024-03-05", ISIN_B, "0.92", "500"]]);
  });
});

describe("an intraday round trip sold at a loss, partly without dollars (issue #447)", () => {
  // 500 USD at 0.90; AAA is bought for 1000 and sold for 800 the same day
  // (0.95). The account went to −500, and the sale leaves it at 300. The 800
  // pay back the 500 borrowed first; 300 of the 500 tracked dollars come back
  // and 200 are lost. «Tradicional con divisa» books their drift, 200 × (0.95
  // − 0.90) = 10; the default books none (its loss-sale rule), so it lands
  // 10 below EUR out − EUR in. Before #447 the 500 tracked dollars came back
  // whole, beside 300 that never existed.
  const sc: Scenario = {
    id: "IRT-LOSS",
    years: [2024],
    closed: true,
    ev: [
      { k: "fund", d: "2024-02-01", usd: "500", r: "0.90" },
      { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
      { k: "sell", d: "2024-03-01", sym: "AAA", qty: "10", px: "80", r: "0.95" },
      { k: "conv", d: "2024-09-02", usd: "300", r: "0.80" },
    ],
  };

  it("«Tradicional con divisa»: −190 stock, 10 lost dollars, −30 conversion: −210", () => {
    const per = run(sc, TRAD);
    expect(f2(economic(sc))).toBe("-210.00");
    expect(f2(per.get(2024)!.stock)).toBe("-190.00");
    expect(f2(per.get(2024)!.fx)).toBe("-20.00");
  });

  it("the default: −190 stock and −30 conversion", () => {
    const per = run(sc, {});
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["-190.00", "-30.00"]);
  });

  for (const [name, opts] of METHODS) {
    it(`${name}: the pool ends empty, as the account does`, () => {
      const trace = run(sc, { ...opts, fxTrace: true }).get(2024)!.report.fxTrace ?? [];
      expect(trace.at(-1)!.poolBalanceFcy).toBe("0");
      expect(messages(run(sc, opts))).not.toContain("fx.conservation_mismatch");
    });
  }
});

describe("an intraday round trip with dollars the upload does not show (issue #447)", () => {
  // No conversion in the data: the buy may have used an untracked opening
  // balance. The round trip changes the pool by its profit only, so a later
  // conversion of more than that profit finds no lot for the rest, exactly as
  // without the round trip: zero FX on it and `fx.missing_prior_lots`. Before
  // #447 the sale put the 1000 in the pool at its own rate (0.95), so the
  // round trip gave the opening balance a cost it never had (−165).
  const sc = (usd: string, trip: boolean): Scenario => ({
    id: "IRT-OPEN",
    years: [2024],
    closed: false,
    ev: [
      ...(trip
        ? ([
            { k: "buy", d: "2024-04-01", sym: "BBB", qty: "10", px: "100", r: "0.95" },
            { k: "sell", d: "2024-04-01", sym: "BBB", qty: "10", px: "110", r: "0.95" },
          ] as Ev[])
        : []),
      { k: "conv", d: "2024-09-02", usd, r: "0.80" },
    ],
  });

  for (const [name, opts] of METHODS) {
    it(`${name}: converting the profit books its FX, 100 × (0.80 − 0.95) = −15`, () => {
      const v = run(sc("100", true), opts).get(2024)!;
      expect([f2(v.stock), f2(v.fx)]).toEqual(["95.00", "-15.00"]);
      expect(v.report.messages.map((m) => m.id)).not.toContain("fx.missing_prior_lots");
    });

    it(`${name}: converting 1000 more finds no lot for them, as without the round trip`, () => {
      const v = run(sc("1100", true), opts).get(2024)!;
      expect([f2(v.stock), f2(v.fx)]).toEqual(["95.00", "-15.00"]);
      expect(v.report.messages.map((m) => m.id)).toContain("fx.missing_prior_lots");
      const alone = run(sc("1000", false), opts).get(2024)!;
      expect(f2(alone.fx)).toBe("0.00");
      expect(alone.report.messages.map((m) => m.id)).toContain("fx.missing_prior_lots");
    });
  }
});

// Seeded random closed cycles: multi-lot positions, partial sales, intraday
// round trips (a sale of shares bought that day, beside held ones), rebuys and
// rotations, late funding 0 to 7 days after the buy, across a year end. Before
// #447, of the first 600 cycles 7 missed in «Tradicional con divisa» (all with
// intraday round trips; none without them); without loss sales, 4 missed in
// both methods.

function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

function day(n: number): string {
  const t = new Date("2024-11-20T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** One closed cycle; `noLoss` prices every sale above every buy. */
function cycle(seed: number, noLoss: boolean): Scenario {
  const rand = rng(seed);
  const ri = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const rate = () => (0.8 + ri(0, 40) / 100).toFixed(2);
  const sellPx = (lo: number, hi: number) => (noLoss ? ri(141, 200) : ri(lo, hi));
  const syms = ["AAA", "BBB", "CCC"];
  const ev: Ev[] = [];
  const held: Record<string, number> = { AAA: 0, BBB: 0, CCC: 0 };
  let usd = 0;
  let d = 0;
  const push = (e: Ev) => ev.push(e);
  const fundFor = (cost: number, at: number, r: string): number => {
    const need = cost - usd;
    if (need <= 0) return 0;
    const lag = ri(0, 7);
    push({ k: "fund", d: day(at + lag), usd: String(need), r: lag === 0 ? r : rate() });
    usd += need;
    return lag;
  };
  for (let i = 0; i < 16; i++) {
    d += ri(1, 12);
    const r = rate();
    const sym = syms[ri(0, 2)]!;
    const x = rand();
    if (x < 0.25) {
      const px = ri(40, 120);
      const q = ri(3, 12);
      push({ k: "buy", d: day(d), sym, qty: String(q), px: String(px), r });
      held[sym]! += q;
      const lag = fundFor(q * px, d, r);
      usd -= q * px;
      d += lag;
    } else if (x < 0.55 && held[sym]! > 0) {
      // A same-day mix: maybe an intraday buy, a sale of held (and that day's)
      // shares, maybe a rebuy or a rotation.
      const today: { e: Ev; pre?: boolean }[] = [];
      const pxS = sellPx(30, 140);
      let intradayQ = 0;
      let cost = 0;
      if (rand() < 0.35) {
        intradayQ = ri(1, 8);
        const pxB = ri(30, 140);
        today.push({ e: { k: "buy", d: day(d), sym, qty: String(intradayQ), px: String(pxB), r }, pre: true });
        cost += intradayQ * pxB;
      }
      const sq = rand() < 0.5 ? held[sym]! : ri(1, held[sym]! + intradayQ);
      today.push({ e: { k: "sell", d: day(d), sym, qty: String(sq), px: String(pxS), r } });
      const rebuy = rand() < 0.7;
      const tgt = rand() < 0.6 ? sym : syms[ri(0, 2)]!;
      let rq = 0;
      if (rebuy) {
        rq = ri(1, 12);
        const rpx = ri(30, 140);
        today.push({ e: { k: "buy", d: day(d), sym: tgt, qty: String(rq), px: String(rpx), r } });
        cost += rq * rpx;
      }
      // The upload lists the intraday buy before the sale; the rebuy anywhere after it.
      if (rebuy && rand() < 0.5) today.splice(intradayQ ? 1 : 0, 0, today.pop()!);
      for (const t of today) push(t.e);
      held[sym]! += intradayQ - sq;
      if (rebuy) held[tgt]! += rq;
      usd += sq * pxS;
      const lag = fundFor(cost, d, r);
      usd -= cost;
      d += lag;
    } else if (x < 0.7 && held[sym]! > 0) {
      const sq = rand() < 0.5 ? held[sym]! : ri(1, held[sym]!);
      const px = sellPx(30, 140);
      push({ k: "sell", d: day(d), sym, qty: String(sq), px: String(px), r });
      usd += sq * px;
      held[sym]! -= sq;
    } else if (x < 0.8 && usd > 50) {
      const amt = ri(1, Math.floor(usd));
      push({ k: "conv", d: day(d), usd: String(amt), r });
      usd -= amt;
    } else if (x < 0.85) {
      const amt = ri(100, 1500);
      push({ k: "fund", d: day(d), usd: String(amt), r });
      usd += amt;
    }
  }
  for (const sym of syms) {
    if (held[sym]! > 0) {
      d += ri(1, 4);
      const px = sellPx(40, 120);
      push({ k: "sell", d: day(d), sym, qty: String(held[sym]), px: String(px), r: rate() });
      usd += held[sym]! * px;
      held[sym] = 0;
    }
  }
  d += 3;
  if (usd > 0) push({ k: "conv", d: day(d), usd: String(usd), r: rate() });
  // A stable sort: same-day events keep the order they were pushed in.
  const out = [...ev].sort((a, b) => a.d.localeCompare(b.d));
  const years = [...new Set(out.map((e) => Number(e.d.slice(0, 4))))].sort();
  return { id: `G${seed}${noLoss ? "N" : ""}`, years, closed: true, ev: out };
}

function misses(cycles: Scenario[], opts: object): string[] {
  const out: string[] = [];
  for (const s of cycles) {
    const per = run(s, opts);
    const tot = f2(lifetime(per));
    const eco = f2(economic(s));
    const conservation = messages(per).includes("fx.conservation_mismatch");
    if (tot !== eco || conservation) out.push(`${s.id}: ${tot} vs ${eco}${conservation ? " (conservation)" : ""}`);
  }
  return out;
}

describe("random closed cycles with intraday round trips and late funding (issue #447)", () => {
  const N = 600;
  const withLoss = Array.from({ length: N }, (_, i) => cycle(i + 1, false));
  const noLoss = Array.from({ length: N }, (_, i) => cycle(i + 1, true));

  it("the generator covers the case: many cycles sell shares bought that same day", () => {
    const intraday = withLoss.filter((s) =>
      s.ev.some((e, i) => e.k === "sell" && s.ev.some((b, j) => j < i && b.k === "buy" && b.d === e.d && b.sym === e.sym)),
    );
    expect(intraday.length).toBeGreaterThan(N / 4);
  });

  it("«Tradicional con divisa»: stock + FX of every cycle equal EUR out − EUR in", () => {
    expect(misses(withLoss, TRAD)).toEqual([]);
  });

  for (const [name, opts] of METHODS) {
    it(`${name}, no loss sales: stock + FX of every cycle equal EUR out − EUR in`, () => {
      expect(misses(noLoss, opts)).toEqual([]);
    });
  }

  it("«Tradicional con divisa»: 0328/0331 equal monodivisa's in every year", () => {
    const bad: string[] = [];
    for (const s of withLoss.slice(0, 100)) {
      const trad = run(s, TRAD);
      const mono = run(s, MONO);
      for (const [y, v] of trad) {
        const m = mono.get(y)!;
        if (!v.s0328.equals(m.s0328) || !v.s0331.equals(m.s0331)) bad.push(`${s.id} ${y}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
