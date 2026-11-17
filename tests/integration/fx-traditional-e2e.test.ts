/**
 * «Tradicional con divisa» (issue #434) end to end, on the REAL generateTaxReport.
 *
 *  - Every scenario of the spec table gives the expected stock / FX per year.
 *  - Property: in every closed scenario, stock + FX over all years equals EUR
 *    out − EUR in − income + fees, and the stock boxes 0328/0331 equal
 *    monodivisa's in every year. No conservation mismatch.
 *  - Trace identity: Σ dispose.gainLossEur dated in the year = fxGains.netGainLoss.
 *  - The traps: same-day rotation (G1), buy first fund later (G2, 7-day window),
 *    trade-date dating (A9, A2b, r, y).
 *  - Corporate actions (G4), wash sale (G5), a Degiro-style dividend funding a
 *    loss (G3 pin), and the two IBKR fixtures with real 2025 ECB rates.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import Decimal from "decimal.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { CorporateAction } from "../../src/types/ibkr.js";
import { run, lifetime, economic, toStatement, TRAD, MONO, type Scenario } from "./fx-traditional-harness.js";
import { SCENARIOS } from "./fx-traditional-scenarios.js";
import { ECB_USD_2025_JAN_SEP } from "./ecb-usd-2025.js";

const f2 = (d: Decimal) => d.toFixed(2);

describe("«Tradicional con divisa»: spec scenarios on the real generateTaxReport", () => {
  for (const sc of SCENARIOS) {
    it(`${sc.id}: stock / FX per year match the spec table`, () => {
      const per = run(sc, { ...TRAD, fxTrace: true });
      const mono = run(sc, MONO);
      for (const [y, exp] of Object.entries(sc.expect.years)) {
        const v = per.get(Number(y))!;
        const got = [f2(v.stock), f2(v.fx), f2(v.t1633), f2(v.a1637)].slice(0, exp.length);
        expect(got, `${sc.id} ${y}`).toEqual(exp);
      }
      for (const [y, v] of per) {
        // Stock boxes always equal monodivisa's (plumbing 3).
        const m = mono.get(y)!;
        expect(v.report.capitalGains.transmissionValue.equals(m.report.capitalGains.transmissionValue), `${sc.id} ${y} 0328`).toBe(true);
        expect(v.report.capitalGains.acquisitionValue.equals(m.report.capitalGains.acquisitionValue), `${sc.id} ${y} 0331`).toBe(true);
        expect(v.report.messages.some((x) => x.id === "fx.conservation_mismatch"), `${sc.id} ${y} conservation`).toBe(false);
        // Trace identity (plumbing 5): the year's dispose rows sum to the FX net.
        const traced = (v.report.fxTrace ?? [])
          .filter((t) => t.kind === "dispose" && t.date.startsWith(String(y)))
          .reduce((s, t) => s.plus(t.gainLossEur ?? "0"), new Decimal(0));
        expect(f2(traced), `${sc.id} ${y} trace`).toBe(f2(v.fx));
      }
      // Property: the lifetime total is the economic result (g: documented data gap).
      if (sc.closed && sc.id !== "g") expect(f2(lifetime(per)), `${sc.id} invariant`).toBe(f2(economic(sc)));
    });
  }

  it("g: the deposit with no EUR origin is the documented gap: total = economic − its drift before the buy", () => {
    const sc = SCENARIOS.find((s) => s.id === "g")!;
    // Deposit assumed worth 0.90, bought at 0.95: 2000 × (0.95 − 0.90) = 100 never declared.
    expect(f2(lifetime(run(sc, TRAD)))).toBe(f2(economic(sc).minus(100)));
  });
});

describe("same-day rotation (critic G1)", () => {
  const rot = SCENARIOS.find((s) => s.id === "ROT")!;

  it("with trade times, the buy at 09:00 still uses the sale's dollars of 15:00 (same-day settlement)", () => {
    const timed: Scenario = {
      ...rot,
      ev: rot.ev.map((e) =>
        e.k === "buy" && e.sym === "BBB" ? { ...e, time: "09:00:00" } : e.k === "sell" && e.sym === "AAA" ? { ...e, time: "15:00:00" } : e,
      ),
    };
    const per = run(timed, TRAD);
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["630.00", "-230.00"]);
  });

  it("with trade times in the sale-first order: same result", () => {
    const timed: Scenario = {
      ...rot,
      ev: rot.ev.map((e) =>
        e.k === "buy" && e.sym === "BBB" ? { ...e, time: "15:00:00" } : e.k === "sell" && e.sym === "AAA" ? { ...e, time: "09:00:00" } : e,
      ),
    };
    expect(f2(lifetime(run(timed, TRAD)))).toBe(f2(economic(rot)));
  });

  it("untimed: a same-day buy paid partly with the sale's profit runs after the sale", () => {
    // Buy first, 200 of BBB's 1200 USD would find no dollars (the same-day cover only
    // re-uses the sale's principal, not its profit) and stay untracked: −41.70, 10 € off.
    const sc: Scenario = {
      id: "ROTP",
      years: [2024],
      closed: true,
      ev: [
        { k: "fund", d: "2024-02-01", usd: "1000", r: "0.90" },
        { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
        { k: "buy", d: "2024-06-03", sym: "BBB", qty: "12", px: "100", r: "0.85" },
        { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "125", r: "0.85" },
        { k: "sell", d: "2024-07-01", sym: "BBB", qty: "12", px: "110", r: "0.86" },
        { k: "conv", d: "2024-09-02", usd: "1370", r: "0.80" },
      ],
    };
    const per = run(sc, TRAD);
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["227.70", "-31.70"]);
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
    expect(per.get(2024)!.report.messages.some((m) => m.id === "report.fx_traditional_uncovered")).toBe(false);
  });

  it("untimed: the sale's re-added dollars keep their date, so the same-day buy takes them first (FIFO)", () => {
    // Buy first, BBB would take the newer 0.70 dollars and leave AAA's (dated 02-01)
    // in the pool: 2024 FX 0.00 / 2025 +50.00. Same lifetime total, wrong year split.
    const sc: Scenario = {
      id: "ROTF",
      years: [2024, 2025],
      closed: true,
      ev: [
        { k: "fund", d: "2024-02-01", usd: "1000", r: "0.90" },
        { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
        { k: "fund", d: "2024-04-01", usd: "1000", r: "0.70" },
        { k: "buy", d: "2024-06-03", sym: "BBB", qty: "10", px: "100", r: "0.85" },
        { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
        { k: "sell", d: "2024-07-01", sym: "BBB", qty: "10", px: "100", r: "0.90" },
        { k: "conv", d: "2024-09-02", usd: "1000", r: "0.80" },
        { k: "conv", d: "2025-03-03", usd: "1000", r: "0.80" },
      ],
    };
    const per = run(sc, TRAD);
    // AAA's dollars come back at 0.90 + 0.85 − 0.95 = 0.80, BBB parks them, its sale
    // re-adds them at 0.80 + 0.90 − 0.85 = 0.85: the 2024 conversion takes those.
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["-50.00", "-50.00"]);
    expect([f2(per.get(2025)!.stock), f2(per.get(2025)!.fx)]).toEqual(["0.00", "100.00"]);
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
  });

  it("an intraday round trip of one position keeps the buy before its sale", () => {
    const sc: Scenario = {
      id: "RT",
      years: [2024],
      closed: true,
      ev: [
        { k: "fund", d: "2024-02-01", usd: "1000", r: "0.90" },
        { k: "sell", d: "2024-03-01", sym: "AAA", qty: "10", px: "110", r: "0.95" },
        { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
        { k: "conv", d: "2024-06-03", usd: "1100", r: "0.80" },
      ],
    };
    const per = run(sc, TRAD);
    // Stock 1100×0.95 − 1000×0.95 = 95; dollars: 1000 at 0.90 (shift 0) + 100 at 0.95.
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["95.00", "-115.00"]);
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
  });
});

describe("same-day order ignores trade times (review)", () => {
  // Fund 2000 at 0.90, buy AAA; then one day: an intraday round trip on BBB that
  // needs margin, the sale of AAA that pays for it, and a buy of CCC.
  const day = (timed: boolean): Scenario => ({
    id: timed ? "S3d" : "S3d-untimed",
    years: [2024],
    closed: true,
    ev: [
      { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" },
      { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
      {
        k: "buy",
        d: "2024-05-02",
        sym: "BBB",
        qty: "10",
        px: "100",
        r: "0.85",
        ...(timed ? { time: "09:30:00" } : {}),
      },
      {
        k: "sell",
        d: "2024-05-02",
        sym: "BBB",
        qty: "10",
        px: "102",
        r: "0.85",
        ...(timed ? { time: "11:00:00" } : {}),
      },
      {
        k: "sell",
        d: "2024-05-02",
        sym: "AAA",
        qty: "20",
        px: "125",
        r: "0.85",
        ...(timed ? { time: "14:00:00" } : {}),
      },
      {
        k: "buy",
        d: "2024-05-02",
        sym: "CCC",
        qty: "25",
        px: "100",
        r: "0.85",
        ...(timed ? { time: "15:00:00" } : {}),
      },
      { k: "sell", d: "2024-08-01", sym: "CCC", qty: "25", px: "110", r: "0.92" },
      { k: "conv", d: "2024-10-01", usd: "2770", r: "0.80" },
    ],
  });

  for (const timed of [true, false]) {
    it(`a margin round trip before the sale that funds it: ${timed ? "timed" : "untimed"} gives the economic 416`, () => {
      const sc = day(timed);
      const per = run(sc, TRAD);
      expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["647.00", "-231.00"]);
      expect(f2(lifetime(per))).toBe(f2(economic(sc)));
      expect(per.get(2024)!.report.messages.some((m) => m.id === "report.fx_traditional_uncovered")).toBe(false);
    });
  }

  for (const timed of [true, false]) {
    it(`no phantom dollars are left for the next year (${timed ? "timed" : "untimed"})`, () => {
      const sc: Scenario = {
        id: timed ? "S3h" : "S3i",
        years: [2024, 2025],
        closed: true,
        ev: [
          ...day(timed).ev.filter((e) => !("sym" in e && e.sym === "CCC") && e.k !== "conv"),
          { k: "conv", d: "2024-10-01", usd: "2520", r: "0.80" },
          { k: "fund", d: "2025-02-03", usd: "1000", r: "0.70" },
          { k: "conv", d: "2025-05-02", usd: "1000", r: "0.75" },
        ],
      };
      const per = run(sc, TRAD);
      expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["242.00", "-26.00"]);
      expect([f2(per.get(2025)!.stock), f2(per.get(2025)!.fx)]).toEqual(["0.00", "50.00"]);
      expect(f2(lifetime(per))).toBe(f2(economic(sc)));
    });
  }

  it("hold AAA, buy more AAA and sell the old AAA on one day with an empty pool: the sale covers the buy", () => {
    const sc: Scenario = {
      id: "S3j",
      years: [2024],
      closed: true,
      ev: [
        { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" },
        { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
        { k: "buy", d: "2024-05-02", sym: "AAA", qty: "10", px: "120", r: "0.85" },
        { k: "sell", d: "2024-05-02", sym: "AAA", qty: "20", px: "120", r: "0.85" },
        { k: "sell", d: "2024-08-01", sym: "AAA", qty: "10", px: "110", r: "0.92" },
        { k: "conv", d: "2024-10-01", usd: "2300", r: "0.80" },
      ],
    };
    const per = run(sc, TRAD);
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["132.00", "-92.00"]);
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
  });
});

describe("buy first, fund later (critic G2, 7-day late-cover window)", () => {
  const mg = SCENARIOS.find((s) => s.id === "MG")!;
  const withFunding = (date: string): Scenario => ({
    ...mg,
    ev: mg.ev.map((e) => (e.k === "fund" ? { ...e, d: date } : e)),
  });

  it("funding 7 calendar days after the buy covers it", () => {
    const per = run(withFunding("2024-03-08"), TRAD);
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["225.00", "-145.00"]);
    expect(per.get(2024)!.report.messages.some((m) => m.id === "report.fx_traditional_uncovered")).toBe(false);
  });

  it("funding 8 days after does not: the buy keeps the untracked-origin path and says so", () => {
    const per = run(withFunding("2024-03-09"), TRAD);
    const r = per.get(2024)!.report;
    // The 2000 funding dollars stay in the pool; the sale re-adds the buy's 2000 at r_s.
    expect(f2(per.get(2024)!.stock)).toBe("225.00");
    expect(r.messages.find((m) => m.id === "report.fx_traditional_uncovered")?.context).toEqual({ qty: "2000.00", ccy: "USD" });
  });

  it("a sale before the funding: the funding still covers the whole buy (S5c)", () => {
    const sc: Scenario = {
      id: "S5c",
      years: [2024],
      closed: true,
      ev: [
        { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
        { k: "sell", d: "2024-03-04", sym: "AAA", qty: "10", px: "105", r: "0.93" },
        { k: "fund", d: "2024-03-05", usd: "2000", r: "0.96" },
        { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "125", r: "0.85" },
        { k: "conv", d: "2024-09-02", usd: "2300", r: "0.80" },
      ],
    };
    const per = run(sc, TRAD);
    // As if the 2000 USD had arrived before the buy: −80 = 2300 × 0.80 − 2000 × 0.96.
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["139.00", "-219.00"]);
    expect(f2(lifetime(per))).toBe("-80.00");
    expect(per.get(2024)!.report.messages.some((m) => m.id === "report.fx_traditional_uncovered")).toBe(false);
  });

  it("S5c over two years (S5g): the second year gets no phantom dollars", () => {
    const sc: Scenario = {
      id: "S5g",
      years: [2024, 2025],
      closed: true,
      ev: [
        { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
        { k: "sell", d: "2024-03-04", sym: "AAA", qty: "10", px: "105", r: "0.93" },
        { k: "fund", d: "2024-03-05", usd: "2000", r: "0.96" },
        { k: "conv", d: "2024-09-02", usd: "1050", r: "0.80" },
        { k: "sell", d: "2025-06-03", sym: "AAA", qty: "10", px: "125", r: "0.85" },
        { k: "conv", d: "2025-09-02", usd: "1250", r: "0.90" },
      ],
    };
    const per = run(sc, TRAD);
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["26.50", "-146.50"]);
    expect([f2(per.get(2025)!.stock), f2(per.get(2025)!.fx)]).toEqual(["112.50", "52.50"]);
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
  });

  // An old USD balance with no history pays for the buy (row 17, taken at r_b);
  // an unrelated EUR→USD comes a few days later. It must not cover the buy.
  const oldBalance = (fundDate: string): Scenario => ({
    id: "S5d",
    years: [2024],
    closed: true,
    ev: [
      { k: "dep", d: "2024-01-02", usd: "2000", r: "0.95" },
      { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
      { k: "fund", d: fundDate, usd: "1000", r: "0.90" },
      { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "125", r: "0.85" },
      { k: "conv", d: "2024-09-02", usd: "3500", r: "0.80" },
    ],
  });

  for (const [label, date] of [
    ["inside the window (S5d)", "2024-03-04"],
    ["outside the window (S5e, control)", "2024-03-09"],
  ] as const) {
    it(`an unrelated conversion ${label} after a buy paid from an untracked balance stays in the pool`, () => {
      const sc = oldBalance(date);
      const per = run(sc, TRAD);
      const r = per.get(2024)!.report;
      expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["225.00", "-225.00"]);
      expect(f2(lifetime(per))).toBe(f2(economic(sc)));
      expect(r.messages.some((m) => m.id === "fx.missing_prior_lots")).toBe(false);
      expect(r.messages.find((m) => m.id === "report.fx_traditional_uncovered")?.context).toEqual({
        qty: "2000.00",
        ccy: "USD",
      });
    });
  }

  it("a dividend after a half-untracked buy does not cover it (S10b)", () => {
    const sc: Scenario = {
      id: "S10b",
      years: [2024],
      closed: true,
      ev: [
        { k: "fund", d: "2024-02-01", usd: "1000", r: "0.90" },
        { k: "dep", d: "2024-02-02", usd: "1000", r: "0.95" },
        { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
        { k: "div", d: "2024-03-04", usd: "50", r: "0.93" },
        { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "125", r: "0.85" },
        { k: "conv", d: "2024-09-02", usd: "2550", r: "0.80" },
      ],
    };
    const per = run(sc, TRAD);
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["225.00", "-81.50"]);
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
    expect(per.get(2024)!.report.messages.some((m) => m.id === "fx.missing_prior_lots")).toBe(false);
  });

  it("a reinvested dividend paid 2 days after the DRIP buy still covers it", () => {
    const sc: Scenario = {
      id: "S7b",
      years: [2024, 2025],
      closed: true,
      ev: [
        { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" },
        { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
        { k: "buy", d: "2024-04-02", sym: "AAA", qty: "1", px: "85", r: "0.92" },
        { k: "div", d: "2024-04-04", usd: "100", r: "0.93" },
        { k: "sell", d: "2024-08-01", sym: "AAA", qty: "10", px: "110", r: "0.88" },
        { k: "sell", d: "2025-02-03", sym: "AAA", qty: "11", px: "80", r: "0.91" },
        { k: "conv", d: "2025-03-03", usd: "1980", r: "0.85" },
      ],
      wht: [{ d: "2024-04-04", usd: "15" }],
    };
    const per = run(sc, TRAD);
    expect([f2(per.get(2025)!.stock), f2(per.get(2025)!.fx)]).toEqual(["-227.40", "13.35"]);
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
  });

  it("a buy from a USD deposit 30 days earlier stays untracked (row 17)", () => {
    const sc: Scenario = {
      id: "DEP30",
      years: [2024],
      closed: true,
      ev: [
        { k: "dep", d: "2024-02-01", usd: "2000", r: "0.90" },
        { k: "buy", d: "2024-03-02", sym: "AAA", qty: "20", px: "100", r: "0.95" },
        { k: "fund", d: "2024-04-01", usd: "500", r: "0.92" },
        { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "125", r: "0.85" },
        { k: "conv", d: "2024-09-02", usd: "3000", r: "0.80" },
      ],
    };
    const r = run(sc, TRAD).get(2024)!.report;
    expect(r.messages.find((m) => m.id === "report.fx_traditional_uncovered")?.context).toEqual({ qty: "2000.00", ccy: "USD" });
  });
});

describe("corporate actions (critic G4): documented limitations", () => {
  const base: Scenario = {
    id: "CA",
    years: [2024],
    closed: true,
    ev: [
      { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" },
      { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
      { k: "fee", d: "2024-04-02", usd: "0", r: "0.93" },
      { k: "sell", d: "2024-06-03", sym: "CCC", qty: "20", px: "125", r: "0.85" },
      { k: "conv", d: "2024-09-02", usd: "2500", r: "0.80" },
    ],
  };
  const ca = (o: Partial<CorporateAction>): CorporateAction => ({
    transactionID: "ca1",
    accountId: "U1",
    symbol: "AAA",
    description: "",
    isin: "US0000000AA1",
    currency: "USD",
    reportDate: "20240402",
    dateTime: "20240402",
    quantity: "0",
    amount: "0",
    type: "TC",
    actionDescription: "",
    ...o,
  });

  it("ISIN change / merger: principal stays under the old ISIN, the orphan warning gives the undeclared drift", () => {
    const { st, rates } = toStatement(base);
    st.corporateActions = [ca({ description: "AAA(US0000000AA1) MERGED(Acquisition) 1 FOR 1 CCC(US0000000CC3)" })];
    // The year-end of the merger year: CCC still held, AAA has no shares.
    const held = { ...base, ev: base.ev.filter((e) => e.k !== "sell" && e.k !== "conv") };
    const { st: st2, rates: r2 } = toStatement(held);
    st2.corporateActions = st.corporateActions;
    const open = generateTaxReport(st2, r2, 2024, TRAD);
    const orphan = open.messages.find((m) => m.id === "report.fx_traditional_orphan");
    expect(orphan?.severity).toBe("warning");
    // 2000 USD bought at 0.90, the shares at 0.95: 100 € never declared.
    expect(orphan?.context).toEqual({ qty: "2000.00", ccy: "USD", security: "US0000000AA1", amount: "100.00" });

    const closed = generateTaxReport(st, rates, 2024, TRAD);
    const total = closed.capitalGains.netGainLoss.plus(closed.fxGains.netGainLoss);
    expect(f2(total)).toBe(f2(economic(base).minus(100)));
    expect(closed.messages.some((m) => m.id === "report.fx_traditional_orphan")).toBe(true);
    // Never in the default.
    expect(generateTaxReport(st, rates, 2024).messages.some((m) => m.id === "report.fx_traditional_orphan")).toBe(false);
  });

  it("spin-off: the parent's sale leaves the child's share of principal parked; orphan once the parent is gone", () => {
    const sc: Scenario = {
      ...base,
      ev: [
        { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" },
        { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
        { k: "fee", d: "2024-04-02", usd: "0", r: "0.93" },
        { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "60", r: "0.85" },
        { k: "sell", d: "2024-07-01", sym: "CCC", qty: "20", px: "60", r: "0.86" },
        { k: "conv", d: "2024-09-02", usd: "2400", r: "0.80" },
      ],
    };
    const { st, rates } = toStatement(sc);
    st.corporateActions = [ca({ type: "SO", description: "AAA(US0000000AA1) SPINOFF 1 FOR 1 CCC(US0000000CC3)" })];
    const r = generateTaxReport(st, rates, 2024, TRAD);
    // The child takes half the cost (share-count proxy, fifo.ts). The parent's sale
    // unparks only 1000 USD: 1000 stay under AAA with 1000 × (0.95 − 0.90) = 50 undeclared.
    expect(r.messages.find((m) => m.id === "report.fx_traditional_orphan")?.context).toEqual({
      qty: "1000.00",
      ccy: "USD",
      security: "US0000000AA1",
      amount: "50.00",
    });
    const total = r.capitalGains.netGainLoss.plus(r.fxGains.netGainLoss);
    expect(f2(total)).toBe(f2(economic(sc).minus(50)));
  });

  it("scrip dividend: the scrip lot has no parked principal and takes the sale-rate path", () => {
    const sc: Scenario = {
      id: "SD",
      years: [2024],
      closed: true,
      ev: [
        { k: "fund", d: "2024-02-01", usd: "1000", r: "0.90" },
        { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
        { k: "fee", d: "2024-04-02", usd: "0", r: "0.93" },
        { k: "sell", d: "2024-06-03", sym: "AAA", qty: "11", px: "120", r: "0.85" },
        { k: "conv", d: "2024-09-02", usd: "1320", r: "0.80" },
      ],
    };
    const { st, rates } = toStatement(sc);
    st.corporateActions = [ca({ type: "SD", quantity: "1", amount: "100", description: "AAA SCRIP DIVIDEND" })];
    const r = generateTaxReport(st, rates, 2024, TRAD);
    // Stock 1320×0.85 − (1000×0.95 + 100×0.93) = 79; FX: 1000 back at 0.80 (shift −0.10),
    // 100 + 220 profit at 0.85, converted at 0.80 → −16. Total 63 = 1056 − 900 − 93 (the
    // scrip's own cost, never declared as income by the engine).
    expect([f2(r.capitalGains.netGainLoss), f2(r.fxGains.netGainLoss)]).toEqual(["79.00", "-16.00"]);
    expect(r.messages.some((m) => m.id === "fx.conservation_mismatch")).toBe(false);
  });

  it("delisting with no sale: shares stay alive, nothing is booked and no orphan can fire", () => {
    const sc: Scenario = { ...base, ev: base.ev.filter((e) => e.k !== "sell" && e.k !== "conv") };
    const { st, rates } = toStatement(sc);
    st.corporateActions = [ca({ type: "DW", quantity: "-20", description: "AAA DELISTED" })];
    const r = generateTaxReport(st, rates, 2024, TRAD);
    expect(r.messages.some((m) => m.id === "fifo.corporate_action_unhandled")).toBe(true);
    expect(r.messages.some((m) => m.id === "report.fx_traditional_orphan")).toBe(false);
    expect([f2(r.capitalGains.netGainLoss), f2(r.fxGains.netGainLoss)]).toEqual(["0.00", "0.00"]);
  });

  it("call exercised into shares: the Ex stock row parks the strike; the premium stays outside (options are a non-goal)", () => {
    const rates: EcbRateMap = new Map(
      Object.entries({ "2024-01-15": "0.90", "2024-02-01": "0.92", "2024-03-15": "0.95", "2024-06-03": "0.85", "2024-09-02": "0.80" }).map(
        ([d, r]) => [d, new Map([["USD", r]])],
      ),
    );
    const code = "XYZ   240315C00050000";
    const opt = (id: string, date: string, side: string, qty: string, price: string, notes: string) =>
      `<Trade tradeID="${id}" accountId="U1" symbol="${code}" description="XYZ 20240315 50 C" conid="9150" isin="" assetCategory="OPT" currency="USD" tradeDate="${date}" settlementDate="${date}" quantity="${qty}" tradePrice="${price}" tradeMoney="0" proceeds="0" cost="0" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}" exchange="CBOE" ibCommissionCurrency="USD" ibCommission="0" taxes="0" multiplier="100" putCall="C" strike="50" expiry="20240315" underlyingSymbol="XYZ" underlyingSecurityID="XX0000000099" notes="${notes}" />`;
    const stk = (id: string, date: string, side: string, qty: string, price: string, notes: string) =>
      `<Trade tradeID="${id}" accountId="U1" symbol="XYZ" description="XYZ CORP" isin="XX0000000099" assetCategory="STK" currency="USD" tradeDate="${date}" settlementDate="${date}" quantity="${qty}" tradePrice="${price}" tradeMoney="0" proceeds="0" cost="0" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}" exchange="NYSE" ibCommissionCurrency="USD" ibCommission="0" taxes="0" multiplier="1" notes="${notes}" />`;
    const cash = (id: string, date: string, side: string, qty: string) =>
      `<Trade tradeID="${id}" accountId="U1" symbol="EUR.USD" description="EUR.USD" isin="" assetCategory="CASH" currency="USD" tradeDate="${date}" settlementDate="${date}" quantity="${qty}" tradePrice="1" tradeMoney="${qty}" proceeds="0" cost="0" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="" exchange="IDEALFX" ibCommissionCurrency="USD" ibCommission="0" taxes="0" multiplier="1" />`;
    const xml = `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20240101" toDate="20241231" period="Custom"><Trades>
      ${cash("1", "20240115", "SELL", "5200")}
      ${opt("2", "20240201", "BUY", "1", "2", "")}
      ${opt("3", "20240315", "SELL", "-1", "0", "Ex")}
      ${stk("4", "20240315", "BUY", "100", "50", "Ex")}
      ${stk("5", "20240603", "SELL", "-100", "60", "")}
      ${cash("6", "20240902", "BUY", "5000")}
      </Trades><CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
      <OptionEAE><OptionEAE accountId="U1" currency="USD" assetCategory="OPT" symbol="${code}" description="XYZ 20240315 50 C" conid="9150" isin="" underlyingSymbol="XYZ" underlyingSecurityID="XX0000000099" multiplier="100" strike="50" expiry="20240315" putCall="C" date="20240315" transactionType="Exercise" quantity="1" tradePrice="0" proceeds="0" realizedPnl="0" /></OptionEAE>
      </FlexStatement></FlexStatements></FlexQueryResponse>`;
    const statement = finalizeMergedStatement(mergeStatement(createEmptyStatement(), parseIbkrFlexXml(xml)));
    const r = generateTaxReport(statement, rates, 2024, TRAD);
    expect(r.messages.some((m) => m.id === "fx.conservation_mismatch")).toBe(false);
    // Pinned: the stock line equals monodivisa's. FX: the Ex row parks 5000 USD of the
    // 0.90 lot (bought at 0.95); the sale at 0.85 re-adds them at 0.90 + 0.85 − 0.95 = 0.80
    // plus 1000 profit at 0.85. The premium has no FX event, so 200 USD of the 0.90 lot
    // are still in the pool: the conversion of 5000 at 0.80 takes them first (−20) and
    // the 4800 shifted dollars at 0.80 give 0.
    const mono = generateTaxReport(statement, rates, 2024, MONO);
    expect(r.capitalGains.netGainLoss.equals(mono.capitalGains.netGainLoss)).toBe(true);
    expect(f2(r.fxGains.netGainLoss)).toBe("-20.00");
  });
});

describe("wash sale + lost dollars (critic G5)", () => {
  it("the blocked stock loss stays blocked; the lost-dollar row is still booked (33.5.f does not reach currency)", () => {
    const sc: Scenario = {
      id: "WS",
      years: [2024],
      closed: false,
      ev: [
        { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" },
        { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
        { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "80", r: "0.85" },
        { k: "buy", d: "2024-06-20", sym: "AAA", qty: "20", px: "80", r: "0.86" },
      ],
    };
    const r = run(sc, TRAD).get(2024)!.report;
    expect(r.capitalGains.blockedLosses.greaterThan(0)).toBe(true);
    const lost = r.fxGains.disposals.filter((d) => d.trigger === "stock_sale");
    expect(lost.map((d) => [f2(d.proceedsEur), f2(d.costBasisEur), f2(d.gainLossEur)])).toEqual([["380.00", "360.00", "20.00"]]);
  });
});

describe("Degiro AutoFX / Trading 212 EUR account: a USD dividend funds a losing buy (critic G3)", () => {
  it("pins today's behaviour: a lost-dollar row from dividend dollars with no conversion", () => {
    // TODO(#434 follow-up): once the parser flags these accounts `brokerConvertedToBase`
    // (CLAUDE.md, #96 section), no dividend lot opens and this row disappears.
    const sc: Scenario = {
      id: "DGR",
      years: [2024],
      closed: false,
      ev: [
        { k: "div", d: "2024-02-15", usd: "500", r: "1.05" },
        { k: "buy", d: "2024-03-01", sym: "AAA", qty: "5", px: "100", r: "0.95" },
        { k: "sell", d: "2024-06-03", sym: "AAA", qty: "5", px: "80", r: "0.85" },
      ],
    };
    const r = run(sc, TRAD).get(2024)!.report;
    expect([f2(r.capitalGains.netGainLoss), f2(r.fxGains.netGainLoss)]).toEqual(["-135.00", "-10.00"]);
    expect(r.messages.find((m) => m.id === "report.fx_traditional_lost_dollars")?.context).toEqual({ n: "1", ccy: "USD", amount: "-10.00" });
    // The default books nothing here.
    expect(f2(run(sc, {}).get(2024)!.fx)).toBe("0.00");
  });
});

describe("IBKR fixtures with real 2025 ECB rates", () => {
  const rates: EcbRateMap = new Map(Object.entries(ECB_USD_2025_JAN_SEP).map(([d, r]) => [d, new Map([["USD", r]])]));
  const load = (f: string) =>
    finalizeMergedStatement(
      mergeStatement(createEmptyStatement(), parseIbkrFlexXml(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf-8"))),
    );
  const fig = (f: string, o: object) => {
    const r = generateTaxReport(load(f), rates, 2025, o);
    return [f2(r.capitalGains.netGainLoss), f2(r.fxGains.netGainLoss)];
  };

  it("ibkr-434-afx-2025.xml: broker AFx account → exactly the monodivisa figures", () => {
    expect(fig("ibkr-434-afx-2025.xml", {})).toEqual(["437.48", "-219.93"]);
    expect(fig("ibkr-434-afx-2025.xml", MONO)).toEqual(["240.38", "0.00"]);
    expect(fig("ibkr-434-afx-2025.xml", TRAD)).toEqual(["240.38", "0.00"]);
  });

  it("ibkr-434-cycle-2025.xml: manual conversions → 240.38 / −57.36 (total = EUR out − EUR in)", () => {
    expect(fig("ibkr-434-cycle-2025.xml", {})).toEqual(["437.48", "-267.59"]);
    expect(fig("ibkr-434-cycle-2025.xml", MONO)).toEqual(["240.38", "0.00"]);
    expect(fig("ibkr-434-cycle-2025.xml", TRAD)).toEqual(["240.38", "-57.36"]);
  });
});

describe("property: random closed cycles (seeded)", () => {
  // Small LCG so a failure replays exactly; the seed is in the test name.
  const rng = (seed: number) => {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  };
  const day = (start: string, n: number) => {
    const t = new Date(start + "T00:00:00Z");
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };

  function cycle(seed: number): Scenario {
    const rand = rng(seed);
    const rate = () => (0.8 + Math.floor(rand() * 30) / 100).toFixed(2);
    const ev: Scenario["ev"] = [];
    const held: Record<string, number> = { AAA: 0, BBB: 0 };
    let usd = 0;
    let d = 0;
    const next = () => day("2024-01-02", (d += 1 + Math.floor(rand() * 40)));
    for (let i = 0; i < 12; i++) {
      const x = rand();
      const sym = rand() < 0.5 ? "AAA" : "BBB";
      const px = 50 + Math.floor(rand() * 100);
      if (x < 0.25 || usd < px) {
        const amt = 1000 + Math.floor(rand() * 4) * 500;
        ev.push({ k: "fund", d: next(), usd: String(amt), r: rate() });
        usd += amt;
      } else if (x < 0.55) {
        const qty = Math.max(1, Math.floor((usd / px) * rand()));
        ev.push({ k: "buy", d: next(), sym, qty: String(qty), px: String(px), r: rate() });
        held[sym]! += qty;
        usd -= qty * px;
      } else if (x < 0.85 && held[sym]! > 0) {
        const qty = Math.max(1, Math.floor(held[sym]! * rand()));
        ev.push({ k: "sell", d: next(), sym, qty: String(qty), px: String(px), r: rate() });
        held[sym]! -= qty;
        usd += qty * px;
      } else if (usd > 100) {
        const amt = Math.floor(usd * rand());
        if (amt > 0) {
          ev.push({ k: "conv", d: next(), usd: String(amt), r: rate() });
          usd -= amt;
        }
      }
    }
    for (const sym of ["AAA", "BBB"]) {
      if (held[sym]! > 0) {
        const px = 50 + Math.floor(rand() * 100);
        ev.push({ k: "sell", d: next(), sym, qty: String(held[sym]), px: String(px), r: rate() });
        usd += held[sym]! * px;
      }
    }
    if (usd > 0) ev.push({ k: "conv", d: next(), usd: String(usd), r: rate() });
    const years = [...new Set(ev.map((e) => Number(e.d.slice(0, 4))))].sort();
    return { id: `P${seed}`, years, closed: true, ev };
  }

  for (let seed = 1; seed <= 60; seed++) {
    it(`seed ${seed}: total = EUR out − EUR in; stock boxes = monodivisa; conservation holds`, () => {
      const s = cycle(seed);
      const per = run(s, TRAD);
      const mono = run(s, MONO);
      expect(f2(lifetime(per))).toBe(f2(economic(s)));
      for (const [y, v] of per) {
        expect(f2(v.stock), `${y}`).toBe(f2(mono.get(y)!.stock));
        expect(v.report.messages.some((m) => m.id === "fx.conservation_mismatch"), `${y}`).toBe(false);
      }
    });
  }
});
