/**
 * «Criterio DGT (multidivisa)», the default method (issue #437): every FX event
 * is dated, valued, ordered and assigned to a tax year on its TRADE date, as
 * «Tradicional con divisa» already does (rule R0, #434).
 *
 * A trap: the default dated FX events on their settlement date. A same-day
 * "convert EUR→USD, buy a US stock" settles the stock T+1 and the currency
 * T+2, so the buy ran before its own funding, parked "uncovered", and the
 * funding lot stayed in the pool: 2000 USD that no longer existed. A later
 * conversion consumed them as real lots (−100 on an economic 0) and the
 * `fx.missing_prior_lots` note never fired.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { run, lifetime, economic, type Scenario } from "./fx-traditional-harness.js";

const f2 = (d: Decimal) => d.toFixed(2);

// A9 (spec §1.2): convert and buy on one day, stock T+1 and FX T+2, the same on
// the sale side. Then fund 2000 USD at 0.80 and convert them back at 0.80: that
// later pair is worth exactly 0.
const a9: Scenario["ev"] = [
  { k: "fund", d: "2024-03-01", usd: "2000", r: "0.95" },
  { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
  { k: "fee", d: "2024-03-04", usd: "0", r: "0.95" },
  { k: "fee", d: "2024-03-05", usd: "0", r: "0.95" },
  { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "125", r: "0.85" },
  { k: "conv", d: "2024-06-03", usd: "2500", r: "0.85" },
  { k: "fee", d: "2024-06-04", usd: "0", r: "0.85" },
  { k: "fee", d: "2024-06-05", usd: "0", r: "0.85" },
];
const settle = { "2024-03-01": "SPLIT", "2024-06-03": "SPLIT" } as const;

const lastPool = (r: ReturnType<typeof run>, year: number): string => {
  const trace = r.get(year)!.report.fxTrace ?? [];
  return new Decimal(trace[trace.length - 1]?.poolBalanceFcy ?? "0").toFixed(2);
};

describe("default method: same-day convert and buy settling T+1 / T+2 (issue #437)", () => {
  it("leaves no phantom dollars: the closed cycle equals EUR out − EUR in", () => {
    const sc: Scenario = { id: "A9", years: [2024], closed: true, settle, ev: a9 };
    const per = run(sc, { fxTrace: true });
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
    expect(f2(per.get(2024)!.stock)).toBe("425.00");
    expect(f2(per.get(2024)!.fx)).toBe("-200.00");
    // Every dollar bought was spent or converted: nothing is left in the pool.
    expect(lastPool(per, 2024)).toBe("0.00");
    // The buy found its funding: no park without a tracked origin.
    const parks = per.get(2024)!.report.fxTrace!.filter((t) => t.kind === "park");
    expect(parks.map((t) => [t.date, t.rate, t.quantityFcy])).toEqual([["2024-03-01", "0.95", "2000"]]);
  });

  it("a later fund-and-convert at one rate books 0, not −100 on the phantom dollars", () => {
    const sc: Scenario = {
      id: "A9-later",
      years: [2024],
      closed: true,
      settle,
      ev: [...a9, { k: "fund", d: "2024-09-02", usd: "2000", r: "0.80" }, { k: "conv", d: "2024-10-01", usd: "2000", r: "0.80" }],
    };
    const per = run(sc, { fxTrace: true });
    const oct = per.get(2024)!.report.fxGains.disposals.filter((d) => d.disposeDate === "2024-10-01");
    expect(oct.map((d) => [d.acquireDate, f2(d.gainLossEur)])).toEqual([["2024-09-02", "0.00"]]);
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
  });

  it("a conversion of dollars the upload never shows finds no lot and says so", () => {
    // After A9 every tracked dollar is gone. 1000 USD converted in October came
    // from outside the upload: gain 0 and the missing-lots note, not a gain on
    // the phantom dollars.
    const sc: Scenario = {
      id: "A9-missing",
      years: [2024],
      closed: false,
      settle,
      ev: [...a9, { k: "conv", d: "2024-10-01", usd: "1000", r: "0.80" }],
    };
    const r = run(sc, {}).get(2024)!.report;
    const oct = r.fxGains.disposals.filter((d) => d.disposeDate === "2024-10-01");
    expect(oct.map((d) => [d.lotId, f2(d.gainLossEur)])).toEqual([["UNKNOWN", "0.00"]]);
    expect(r.messages.map((m) => m.id)).toContain("fx.missing_prior_lots");
    expect(f2(r.fxGains.netGainLoss)).toBe("-200.00");
  });
});

describe("default method: same-day order of stock legs (issue #437)", () => {
  // Sell AAA and buy BBB on one trade date with no other dollars in the pool.
  // A trap: the default ran every same-day buy before every sale, so BBB parked
  // "uncovered" while AAA's 1000 USD went back to the pool, where they stayed
  // as dollars already spent on BBB. The sale of a position not bought that day
  // now runs first, as in «Tradicional con divisa».
  const sc: Scenario = {
    id: "ROT",
    years: [2024],
    closed: true,
    ev: [
      { k: "fund", d: "2024-02-01", usd: "1000", r: "0.80" },
      { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.90" },
      { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
      { k: "buy", d: "2024-06-03", sym: "BBB", qty: "10", px: "100", r: "0.85" },
      { k: "fund", d: "2024-07-01", usd: "1000", r: "0.70" },
      { k: "sell", d: "2024-09-02", sym: "BBB", qty: "10", px: "100", r: "0.95" },
      { k: "conv", d: "2024-10-01", usd: "2000", r: "1.00" },
    ],
  };

  it("the rotation's buy takes the dollars the sale returned: nothing phantom is left", () => {
    const per = run(sc, { fxTrace: true });
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
    expect(lastPool(per, 2024)).toBe("0.00");
    const june = per.get(2024)!.report.fxTrace!.filter((t) => t.date === "2024-06-03");
    expect(june.map((t) => [t.kind, t.positionKey, t.rate])).toEqual([
      ["unpark", "US0000000AA1", "0.8"],
      ["park", "US0000000BB2", "0.8"],
    ]);
  });
});
