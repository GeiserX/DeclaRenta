/**
 * «Tradicional con divisa» (issue #434): late covers across a year end, long
 * buy-then-fund chains and their cost.
 *
 *  - A cover is judged over all the data, so a December buy covered by a
 *    January conversion is judged on January's year, and a cover with an
 *    untracked opening balance goes when a later year shows it. It stays
 *    only when dropping it would change a year already filed with it.
 *  - Judging a year's covers in batches changes no result.
 *  - One pass settles a whole chain, however long: a weekly buy-then-fund
 *    chain lands on the economic total.
 *  - A long chain with an opening-balance case costs milliseconds, not seconds.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { FxFifoEngine } from "../../src/engine/fx-fifo.js";
import { run, lifetime, economic, toStatement, TRAD, type Ev, type Scenario } from "./fx-traditional-harness.js";

const f2 = (d: Decimal) => d.toFixed(2);
const ISIN_A = "US0000000AA1";
const ISIN_B = "US0000000BB2";
const plusDays = (d: string, n: number): string => {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

describe("a December buy covered in January is judged on January's year", () => {
  it("an opening balance paid the buy: the January conversion is new money (Y6)", () => {
    // 2000 USD with no EUR origin pay AAA on 29 Dec. An unrelated 1000 USD
    // conversion on 2 Jan is in the buy's window. Covering with it leaves the
    // 2024 conversion of every dollar 1000 short: the cover must go.
    const y2023: Ev[] = [
      { k: "dep", d: "2023-01-02", usd: "2000", r: "0.95" },
      { k: "buy", d: "2023-12-29", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    ];
    const sc: Scenario = {
      id: "Y6",
      years: [2023, 2024],
      closed: true,
      ev: [
        ...y2023,
        { k: "fund", d: "2024-01-02", usd: "1000", r: "0.90" },
        { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "125", r: "0.85" },
        { k: "conv", d: "2024-09-02", usd: "3500", r: "0.80" },
      ],
    };
    const per = run(sc, TRAD);
    expect([f2(per.get(2023)!.stock), f2(per.get(2023)!.fx)]).toEqual(["0.00", "0.00"]);
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["225.00", "-225.00"]);
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
    expect(per.get(2024)!.report.messages.some((m) => m.id === "fx.missing_prior_lots")).toBe(false);
    const alone = run({ id: "Y6-2023", years: [2023], closed: false, ev: y2023 }, TRAD).get(2023)!;
    expect([f2(alone.stock), f2(alone.fx)]).toEqual([f2(per.get(2023)!.stock), f2(per.get(2023)!.fx)]);
  });

  it("the cover would leave a January buy without dollars: it is dropped (Y2)", () => {
    // The cross-year mirror of LCB: the 2 Jan conversion pays BBB (3 Jan) in
    // the plain pass, and BBB's next funding (1 Feb) is past its window.
    const sc: Scenario = {
      id: "Y2",
      years: [2023, 2024],
      closed: true,
      ev: [
        { k: "buy", d: "2023-12-29", sym: "AAA", qty: "10", px: "100", r: "0.90" },
        { k: "fund", d: "2024-01-02", usd: "1000", r: "0.91" },
        { k: "buy", d: "2024-01-03", sym: "BBB", qty: "10", px: "100", r: "0.92" },
        { k: "fund", d: "2024-02-01", usd: "1000", r: "0.93" },
        { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "105", r: "0.85" },
        { k: "sell", d: "2024-06-03", sym: "BBB", qty: "10", px: "105", r: "0.85" },
        { k: "conv", d: "2024-09-02", usd: "2100", r: "0.80" },
      ],
    };
    const v = run(sc, { ...TRAD, fxTrace: true }).get(2024)!;
    const parks = (v.report.fxTrace ?? []).filter((t) => t.kind === "park");
    expect(parks.filter((t) => t.positionKey === ISIN_B).every((t) => t.rate !== null), "BBB covered").toBe(true);
    expect(parks.filter((t) => t.positionKey === ISIN_A).map((t) => t.rate)).toEqual([null]);
    // The 2100 converted at 0.80, oldest first: BBB's 1000 at 0.91 + (0.85 − 0.92),
    // the 1 Feb 1000 at 0.93, then 100 of AAA's untracked 1000 at 0.85.
    expect([f2(v.stock), f2(v.fx)]).toEqual(["-35.00", "-175.00"]);
    expect(v.report.messages.some((m) => m.id === "fx.conservation_mismatch")).toBe(false);
  });
});

describe("one pass settles a whole buy-then-fund chain", () => {
  it("52 weeks of buying on Monday and funding on Wednesday land on the economic total", () => {
    // Plain pass: week 1's buy is untracked and each Wednesday's dollars pay
    // the next Monday. G2 hands every Wednesday to its own Monday: 52 links.
    const ev: Ev[] = [];
    for (let i = 0; i < 52; i++) {
      const r = 0.9 + (i % 5) * 0.01;
      ev.push({ k: "buy", d: plusDays("2024-01-01", 7 * i), sym: "AAA", qty: "1", px: "100", r: r.toFixed(2) });
      ev.push({ k: "fund", d: plusDays("2024-01-03", 7 * i), usd: "100", r: (r + 0.005).toFixed(3) });
    }
    ev.push({ k: "sell", d: "2024-12-30", sym: "AAA", qty: "52", px: "100", r: "0.85" });
    ev.push({ k: "conv", d: "2024-12-31", usd: "5200", r: "0.80" });
    const sc: Scenario = { id: "W52", years: [2024], closed: true, ev };
    const v = run(sc, { ...TRAD, fxTrace: true }).get(2024)!;
    expect((v.report.fxTrace ?? []).filter((t) => t.kind === "park" && t.rate === null)).toEqual([]);
    expect(f2(v.stock.plus(v.fx))).toBe(f2(economic(sc)));
    expect(f2(economic(sc))).toBe("-647.00");
    expect(v.report.messages.some((m) => m.id === "report.fx_traditional_uncovered")).toBe(false);
  });

  it("300 buy-then-fund pairs and an opening-balance case take well under a second", () => {
    // The opening-balance buy forces covers to be judged apart; the chain of
    // 300 buys follows. A weekly DCA user must not wait seconds per report.
    const ev: Ev[] = [
      { k: "dep", d: "2024-01-01", usd: "2000", r: "0.95" },
      { k: "buy", d: "2024-01-01", sym: "BBB", qty: "20", px: "100", r: "0.95" },
      { k: "fund", d: "2024-01-03", usd: "1000", r: "0.90" },
    ];
    for (let i = 0; i < 300; i++) {
      ev.push({ k: "buy", d: plusDays("2024-01-10", 2 * i), sym: "AAA", qty: "1", px: "100", r: "0.90" });
      ev.push({ k: "fund", d: plusDays("2024-01-11", 2 * i), usd: "100", r: "0.91" });
    }
    const sale = plusDays("2024-01-10", 2 * 300 + 30);
    ev.push({ k: "sell", d: sale, sym: "AAA", qty: "300", px: "100", r: "0.85" });
    ev.push({ k: "sell", d: sale, sym: "BBB", qty: "20", px: "100", r: "0.85" });
    const { st, rates } = toStatement({ id: "P300", years: [2024, 2025], closed: false, ev });
    // The report the user gets, and the one with the debug trace (CLI --fx-trace).
    for (const options of [TRAD, { ...TRAD, fxTrace: true }]) {
      const t0 = performance.now();
      generateTaxReport(st, rates, Number(sale.slice(0, 4)), options);
      const ms = performance.now() - t0;
      console.log(`P300${options.fxTrace ? " with trace" : ""}: ${ms.toFixed(0)} ms for one report`);
      expect(ms).toBeLessThan(2000);
    }
  });
});

describe("a cover is judged over all the data (untracked opening balance)", () => {
  // Every case: 1000 USD with no EUR origin (an opening balance) pay a 27 Dec
  // buy, and an unrelated EUR→USD conversion lands in the buy's window. Taking
  // it as the buy's funding makes a later disposal find no lot or leaves a
  // later buy without dollars, in a year after the cover's own year.
  const nulls = (v: { report: { fxTrace?: { kind: string; rate: unknown; quantityFcy: string }[] } }): string =>
    f2(
      (v.report.fxTrace ?? [])
        .filter((t) => t.kind === "park" && t.rate === null)
        .reduce((s, t) => s.plus(t.quantityFcy), new Decimal(0)),
    );
  const ids = (per: Map<number, { report: { messages: { id: string }[] } }>): string[] =>
    [...per].flatMap(([y, v]) =>
      v.report.messages.filter((m) => /^fx\.|uncovered/.test(m.id)).map((m) => `${y}:${m.id}`),
    );

  it("a conversion in the next year would find no lot: the cover goes (Z1)", () => {
    const sc: Scenario = {
      id: "Z1",
      years: [2023, 2024],
      closed: true,
      ev: [
        { k: "dep", d: "2023-01-02", usd: "1000", r: "0.95" },
        { k: "buy", d: "2023-12-27", sym: "AAA", qty: "10", px: "100", r: "0.90" },
        { k: "fund", d: "2023-12-29", usd: "1000", r: "0.91" },
        { k: "conv", d: "2024-03-01", usd: "1000", r: "0.85" },
        { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "110", r: "0.88" },
        { k: "conv", d: "2024-09-02", usd: "1100", r: "0.80" },
      ],
    };
    const per = run(sc, { ...TRAD, fxTrace: true });
    expect([f2(per.get(2023)!.stock), f2(per.get(2023)!.fx)]).toEqual(["0.00", "0.00"]);
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["68.00", "-148.00"]);
    expect(f2(lifetime(per))).toBe("-80.00");
    // The economic total plus 50: the untracked 1000 at the buy's 0.90, not 0.95.
    expect(f2(economic(sc).plus(50))).toBe("-80.00");
    expect(ids(per)).toEqual(["2024:report.fx_traditional_uncovered"]);
    expect(nulls(per.get(2024)!)).toBe("1000.00");
  });

  it("a buy of the next year would be left without dollars: the cover goes (X2b)", () => {
    const y2023: Ev[] = [
      { k: "dep", d: "2023-01-02", usd: "1000", r: "0.95" },
      { k: "buy", d: "2023-12-27", sym: "AAA", qty: "10", px: "100", r: "0.90" },
      { k: "fund", d: "2023-12-29", usd: "1000", r: "0.91" },
      { k: "sell", d: "2023-12-30", sym: "AAA", qty: "5", px: "110", r: "0.92" },
    ];
    const sc: Scenario = {
      id: "X2b",
      years: [2023, 2024],
      closed: true,
      ev: [
        ...y2023,
        { k: "buy", d: "2024-01-02", sym: "BBB", qty: "15", px: "100", r: "0.93" },
        { k: "fund", d: "2024-02-04", usd: "1000", r: "0.94" },
        { k: "sell", d: "2024-03-01", sym: "AAA", qty: "5", px: "105", r: "0.88" },
        { k: "sell", d: "2024-03-01", sym: "BBB", qty: "15", px: "105", r: "0.88" },
        { k: "conv", d: "2024-06-03", usd: "3150", r: "0.85" },
      ],
    };
    const per = run(sc, { ...TRAD, fxTrace: true });
    expect([f2(per.get(2023)!.stock), f2(per.get(2023)!.fx)]).toEqual(["56.00", "0.00"]);
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["3.00", "-131.50"]);
    expect(f2(lifetime(per))).toBe("-72.50");
    expect(f2(economic(sc).plus(50))).toBe("-72.50");
    expect(ids(per)).toEqual(["2023:report.fx_traditional_uncovered", "2024:report.fx_traditional_uncovered"]);
    // BBB keeps the dollars it had; only AAA's 1000 stay untracked.
    expect(nulls(per.get(2024)!)).toBe("1000.00");
    const alone = run({ id: "X2b-2023", years: [2023], closed: false, ev: y2023 }, TRAD).get(2023)!;
    expect([f2(alone.stock), f2(alone.fx)]).toEqual(["56.00", "0.00"]);
  });

  it("a three-year buy-then-fund chain whose last link has no funding: every cover goes (X3b)", () => {
    // AAA every 4 days from 20 Dec 2023 to 1 Jan 2025, each buy funded the
    // day before the next one; the first buy used the opening balance and
    // the last one has no funding. The chain would move the untracked 1000
    // from the first buy to the last one, in 2025.
    const ev: Ev[] = [{ k: "dep", d: "2023-01-02", usd: "1000", r: "0.95" }];
    const r = (k: number): string => (0.9 + (k % 7) * 0.01).toFixed(2);
    ev.push({ k: "buy", d: "2023-12-20", sym: "AAA", qty: "10", px: "100", r: r(0) });
    for (let k = 0; k < 95; k++) {
      ev.push({ k: "fund", d: plusDays("2023-12-20", 4 * k + 1), usd: "1000", r: (Number(r(k)) + 0.003).toFixed(3) });
      ev.push({ k: "buy", d: plusDays("2023-12-20", 4 * k + 2), sym: "AAA", qty: "10", px: "100", r: r(k + 1) });
    }
    ev.push({ k: "sell", d: "2023-12-31", sym: "AAA", qty: "20", px: "103", r: "0.89" });
    const y2023 = ev.filter((e) => e.d <= "2023-12-31");
    ev.push({ k: "sell", d: "2025-03-03", sym: "AAA", qty: "940", px: "97", r: "0.86" });
    ev.push({ k: "conv", d: "2025-04-01", usd: "93240", r: "0.84" });
    const sc: Scenario = { id: "X3b", years: [2023, 2024, 2025], closed: true, ev };
    const per = run(sc, { ...TRAD, fxTrace: true });
    expect(ids(per)).toEqual(["2023:report.fx_traditional_uncovered"]);
    expect(nulls(per.get(2025)!)).toBe("1000.00");
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["0.00", "0.00"]);
    // The economic total less 50: the untracked 1000 count at the buy's 0.90,
    // not at the 0.95 the opening balance was worth.
    expect(f2(lifetime(per))).toBe("-11153.40");
    expect(f2(economic(sc).plus(50))).toBe("-11153.40");
    const alone = run({ id: "X3b-2023", years: [2023], closed: false, ev: y2023 }, TRAD).get(2023)!;
    expect([f2(per.get(2023)!.stock), f2(per.get(2023)!.fx)]).toEqual([f2(alone.stock), f2(alone.fx)]);
  });

  it("dropping the cover would change the year already filed: it stays, the next year shows the note (Z2)", () => {
    // A December sale and conversion make 2023 depend on the cover. The 2024
    // conversion finds no lot because of it, but 2024 data never changes the
    // 2023 figures: 123 / 1 with or without 2024 (123 / 31 without the cover).
    const y2023: Ev[] = [
      { k: "dep", d: "2023-01-02", usd: "1000", r: "0.95" },
      { k: "buy", d: "2023-12-27", sym: "AAA", qty: "10", px: "100", r: "0.90" },
      { k: "fund", d: "2023-12-29", usd: "1000", r: "0.91" },
      { k: "sell", d: "2023-12-30", sym: "AAA", qty: "10", px: "110", r: "0.93" },
      { k: "conv", d: "2023-12-31", usd: "1100", r: "0.94" },
    ];
    const sc: Scenario = {
      id: "Z2",
      years: [2023, 2024],
      closed: true,
      ev: [...y2023, { k: "conv", d: "2024-03-01", usd: "1000", r: "0.85" }],
    };
    const per = run(sc, TRAD);
    const alone = run({ id: "Z2-2023", years: [2023], closed: false, ev: y2023 }, TRAD).get(2023)!;
    expect([f2(alone.stock), f2(alone.fx)]).toEqual(["123.00", "1.00"]);
    expect([f2(per.get(2023)!.stock), f2(per.get(2023)!.fx)]).toEqual(["123.00", "1.00"]);
    expect([f2(per.get(2024)!.stock), f2(per.get(2024)!.fx)]).toEqual(["0.00", "0.00"]);
    expect(per.get(2024)!.report.messages.some((m) => m.id === "fx.missing_prior_lots")).toBe(true);
  });
});

describe("judging a year's covers in batches changes no result", () => {
  // A batch is kept only when it holds over all the data. A cover only ever
  // takes dollars away from what comes after it, so each cover of a kept
  // batch would hold alone too: the batches are only a speed-up. Each case
  // here runs both ways, batches and every cover alone.
  const scenarios = (): Scenario[] => {
    // 30 weekly buy-then-fund pairs around an opening-balance buy (BBB) whose
    // window holds new money a later conversion spends.
    const ev: Ev[] = [{ k: "dep", d: "2024-01-02", usd: "1000", r: "0.95" }];
    const pair = (d: string, i: number): void => {
      const r = 0.9 + (i % 5) * 0.01;
      ev.push({ k: "buy", d, sym: "AAA", qty: "1", px: "100", r: r.toFixed(2) });
      ev.push({ k: "fund", d: plusDays(d, 2), usd: "100", r: (r + 0.005).toFixed(3) });
    };
    for (let i = 0; i < 12; i++) pair(plusDays("2024-02-05", 7 * i), i);
    ev.push({ k: "buy", d: "2024-05-06", sym: "BBB", qty: "10", px: "100", r: "0.92" });
    ev.push({ k: "fund", d: "2024-05-08", usd: "1000", r: "0.90" });
    ev.push({ k: "conv", d: "2024-05-20", usd: "1000", r: "0.88" });
    for (let i = 12; i < 30; i++) pair(plusDays("2024-06-03", 7 * (i - 12)), i);
    ev.push({ k: "sell", d: "2024-11-04", sym: "AAA", qty: "30", px: "105", r: "0.86" });
    ev.push({ k: "sell", d: "2024-11-05", sym: "BBB", qty: "10", px: "110", r: "0.87" });
    ev.push({ k: "conv", d: "2024-12-02", usd: "4250", r: "0.85" });
    // Three 2023 covers: the middle one fails in 2023, the last one takes a
    // 2024 conversion and holds.
    const mixed: Ev[] = [
      { k: "dep", d: "2023-01-02", usd: "1000", r: "0.95" },
      { k: "buy", d: "2023-03-01", sym: "AAA", qty: "10", px: "100", r: "0.90" },
      { k: "fund", d: "2023-03-03", usd: "1000", r: "0.91" },
      { k: "buy", d: "2023-06-01", sym: "BBB", qty: "10", px: "100", r: "0.92" },
      { k: "fund", d: "2023-06-02", usd: "1000", r: "0.93" },
      { k: "buy", d: "2023-06-05", sym: "CCC", qty: "10", px: "100", r: "0.94" },
      { k: "sell", d: "2023-12-27", sym: "AAA", qty: "10", px: "110", r: "0.96" },
      { k: "sell", d: "2023-12-27", sym: "BBB", qty: "10", px: "110", r: "0.96" },
      { k: "buy", d: "2023-12-28", sym: "AAA", qty: "10", px: "100", r: "0.95" },
      { k: "sell", d: "2023-12-29", sym: "CCC", qty: "10", px: "110", r: "0.97" },
      { k: "conv", d: "2023-12-30", usd: "1300", r: "0.99" },
      { k: "fund", d: "2024-01-03", usd: "1000", r: "0.97" },
      { k: "sell", d: "2024-03-01", sym: "AAA", qty: "10", px: "105", r: "0.88" },
      { k: "conv", d: "2024-06-03", usd: "3050", r: "0.85" },
    ];
    // Two 2023 buys paid with an opening balance, each with new money in its
    // window. Both covers hold up to 2023 and leave a 2024 conversion without
    // a lot: both go. (A batch judged only up to its own year kept both.)
    const pairZ1: Ev[] = [
      { k: "dep", d: "2023-01-02", usd: "2000", r: "0.95" },
      { k: "buy", d: "2023-12-20", sym: "AAA", qty: "10", px: "100", r: "0.90" },
      { k: "buy", d: "2023-12-21", sym: "BBB", qty: "10", px: "100", r: "0.91" },
      { k: "fund", d: "2023-12-22", usd: "1000", r: "0.92" },
      { k: "fund", d: "2023-12-24", usd: "1000", r: "0.93" },
      { k: "conv", d: "2024-03-01", usd: "1000", r: "0.85" },
      { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "110", r: "0.88" },
      { k: "sell", d: "2024-06-04", sym: "BBB", qty: "10", px: "110", r: "0.87" },
      { k: "conv", d: "2024-09-02", usd: "3200", r: "0.80" },
    ];
    return [
      { id: "BATCH-Z1", years: [2023, 2024], closed: true, ev: pairZ1 },
      { id: "BATCH-W30", years: [2024], closed: true, ev },
      { id: "BATCH-MIXED", years: [2023, 2024], closed: true, ev: mixed },
    ];
  };

  for (const sc of scenarios()) {
    it(sc.id, () => {
      const figures = (): string[] =>
        [...run(sc, TRAD)].map(
          ([y, v]) => `${y} ${f2(v.stock)} ${f2(v.fx)} ${v.report.messages.map((m) => m.id).join(",")}`,
        );
      const batched = figures();
      FxFifoEngine.coversAlone = true;
      try {
        expect(figures()).toEqual(batched);
      } finally {
        FxFifoEngine.coversAlone = false;
      }
    });
  }
});
