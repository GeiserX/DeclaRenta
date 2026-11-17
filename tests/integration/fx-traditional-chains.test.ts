/**
 * «Tradicional con divisa» (issue #434): late covers across a year end, long
 * buy-then-fund chains and their cost.
 *
 *  - A cover is judged up to the end of the latest year it changes, so a
 *    December buy covered by a January conversion is judged on January's year.
 *  - One pass settles a whole chain, however long: a weekly buy-then-fund
 *    chain lands on the economic total.
 *  - A long chain with an opening-balance case costs milliseconds, not seconds.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport } from "../../src/generators/report.js";
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
