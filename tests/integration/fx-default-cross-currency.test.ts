/**
 * «Criterio DGT (multidivisa)», the default method (issue #441): a position
 * bought in one currency and sold in another (the same ISIN on another
 * listing; the stock FIFO matches lots by ISIN).
 *
 * The default's stock line for such a sale is already `P × r_s − C × r_b`
 * (fifo.ts disposalEur: the cost of a lot in another currency goes at its own
 * buy-date rate, so it cannot be computed in one currency as V2422-20 does).
 * The dollars left the account inside the shares at `r_b` and never come
 * back as dollars, so their drift from buying the currency to buying the
 * shares, `C × (r_b − r_lot)`, is declared at the sale (`stock_sale_cross`),
 * the moment the default learns they will not come back. The sale's own
 * currency, when foreign, enters its pool whole at the sale rate.
 *
 * A trap: the `currency === "EUR"` skip left a USD lot sold in EUR parked
 * forever (100 declared on an economic 200); a GBP sale left the USD parked
 * (20 on 120); and a EUR lot sold in USD unparked the USD principal of
 * another lot of the same ISIN (−65 on −60).
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { toStatement, type Scenario } from "./fx-traditional-harness.js";
import type { FlexStatement } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

const f2 = (d: Decimal) => d.toFixed(2);
const ISIN_A = "US0000000AA1";

/** Re-list the trades of the given dates in `ccy` (another listing of the same ISIN). */
function relist(st: FlexStatement, rates: EcbRateMap, at: Record<string, { ccy: string; rate?: string }>): void {
  for (const t of st.trades) {
    const r = at[t.tradeDate];
    if (!r || t.assetCategory !== "STK") continue;
    t.currency = r.ccy;
    t.commissionCurrency = r.ccy;
    if (r.rate) rates.get(t.tradeDate)!.set(r.ccy, r.rate);
  }
}

/** A GBP → EUR conversion (BUY EUR.GBP), with its GBP rate. */
function gbpToEur(st: FlexStatement, rates: EcbRateMap, d: string, gbp: string, r: string): void {
  if (!rates.has(d)) rates.set(d, new Map());
  rates.get(d)!.set("GBP", r);
  st.trades.push({
    ...st.trades[0]!,
    tradeID: "gbp" + d,
    symbol: "EUR.GBP",
    description: "EUR.GBP",
    isin: "",
    assetCategory: "CASH",
    currency: "GBP",
    tradeDate: d,
    settlementDate: d,
    quantity: gbp,
    tradePrice: "1",
    tradeMoney: gbp,
    proceeds: `-${gbp}`,
    cost: gbp,
    buySell: "BUY",
    openCloseIndicator: "O", // what the IBKR parser sets when the row has none
    exchange: "IDEALFX",
    commission: "0",
    commissionCurrency: "GBP",
  });
}

function figures(st: FlexStatement, rates: EcbRateMap) {
  const r = generateTaxReport(st, rates, 2024, { fxTrace: true });
  return { stock: r.capitalGains.netGainLoss, fx: r.fxGains.netGainLoss, report: r };
}

// Fund 1000 USD for 800 EUR, buy at 0.90, sell the same ISIN for 1000 EUR.
const cycle: Scenario = {
  id: "XEUR",
  years: [2024],
  closed: true,
  ev: [
    { k: "fund", d: "2024-02-01", usd: "1000", r: "0.80" },
    { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.90" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "100", r: "0.85" },
  ],
};

describe("default: a USD position sold in EUR (issue #441)", () => {
  const build = (px = "100") => {
    const { st, rates } = toStatement({ ...cycle, ev: cycle.ev.map((e) => (e.k === "sell" ? { ...e, px } : e)) });
    relist(st, rates, { "2024-06-03": { ccy: "EUR" } });
    return { st, rates };
  };

  it("declares the dollars' drift up to the share purchase: 100 stock + 100 currency = 1000 − 800", () => {
    const v = figures(build().st, build().rates);
    expect([f2(v.stock), f2(v.fx)]).toEqual(["100.00", "100.00"]);
    const rows = v.report.fxGains.disposals;
    expect(rows.map((d) => [d.trigger, d.disposeDate, f2(d.proceedsEur), f2(d.costBasisEur)])).toEqual([
      ["stock_sale_cross", "2024-06-03", "900.00", "800.00"],
    ]);
    // Nothing stays parked under the sold position, and the books balance.
    const trace = v.report.fxTrace ?? [];
    expect(trace[trace.length - 1]!.parkedBalanceFcy).toBe("0");
    expect(v.report.messages.map((m) => m.id)).not.toContain("fx.conservation_mismatch");
  });

  it("a loss sale too: the whole principal left at the buy rate (−400 stock + 100 currency = 500 − 800)", () => {
    const v = figures(build("50").st, build("50").rates);
    expect([f2(v.stock), f2(v.fx)]).toEqual(["-400.00", "100.00"]);
  });
});

describe("default: a USD position sold in GBP (issue #441)", () => {
  // Sold for 800 GBP at 1.20 (960 EUR), converted at 1.15 (920 EUR).
  // Economic: 920 − 800 = 120 EUR = stock 60 + USD drift 100 + GBP −40.
  it("declares the USD drift at the sale and the GBP from the sale rate: 60 + 60 = 120", () => {
    const { st, rates } = toStatement({ ...cycle, ev: cycle.ev.map((e) => (e.k === "sell" ? { ...e, px: "80" } : e)) });
    relist(st, rates, { "2024-06-03": { ccy: "GBP", rate: "1.20" } });
    gbpToEur(st, rates, "2024-09-02", "800", "1.15");
    const v = figures(st, rates);
    expect([f2(v.stock), f2(v.fx)]).toEqual(["60.00", "60.00"]);
    expect(v.report.fxGains.disposals.map((d) => [d.currency, d.trigger, f2(d.gainLossEur)])).toEqual([
      ["USD", "stock_sale_cross", "100.00"],
      ["GBP", "conversion", "-40.00"],
    ]);
    const ids = v.report.messages.map((m) => m.id);
    expect(ids).not.toContain("fx.missing_prior_lots");
    expect(ids).not.toContain("fx.conservation_mismatch");
  });
});

describe("default: a EUR lot sold in USD leaves the USD lot of the same ISIN parked (issue #441)", () => {
  // Lot 1: 5 AAA bought in EUR. Lot 2: 10 AAA bought in USD. The first sale,
  // in USD, consumes lot 1: its 550 USD are new dollars at the sale rate, and
  // lot 2's principal stays parked for its own sale.
  const sc: Scenario = {
    id: "XREV",
    years: [2024],
    closed: true,
    ev: [
      { k: "fund", d: "2024-02-01", usd: "1000", r: "0.80" },
      { k: "buy", d: "2024-03-01", sym: "AAA", qty: "5", px: "100", r: "0.88" },
      { k: "buy", d: "2024-03-04", sym: "AAA", qty: "10", px: "100", r: "0.90" },
      { k: "sell", d: "2024-06-03", sym: "AAA", qty: "5", px: "110", r: "0.85" },
      { k: "sell", d: "2024-09-02", sym: "AAA", qty: "10", px: "100", r: "0.86" },
      { k: "conv", d: "2024-12-02", usd: "1550", r: "0.80" },
    ],
  };

  it("the first sale unparks nothing; the second returns the whole 1000; total = 1240 − 1300", () => {
    const { st, rates } = toStatement(sc);
    relist(st, rates, { "2024-03-01": { ccy: "EUR" } });
    const v = figures(st, rates);
    const trace = v.report.fxTrace ?? [];
    const june = trace.filter((t) => t.date === "2024-06-03" && t.positionKey === ISIN_A);
    expect(june.map((t) => [t.kind, f2(new Decimal(t.quantityFcy))])).toEqual([["profit", "550.00"]]);
    const sept = trace.filter((t) => t.date === "2024-09-02" && t.kind === "unpark");
    expect(sept.map((t) => f2(new Decimal(t.quantityFcy)))).toEqual(["1000.00"]);
    expect(f2(v.stock.plus(v.fx))).toBe("-60.00");
  });
});

describe("default: a USD position delivered by a EUR option exercise (issue #441)", () => {
  // Fund 1000 USD for 800, buy 10 AAA at 0.90, then a EUR put on the same ISIN
  // is exercised: the 10 shares go for 1000 EUR at the strike. 1000 − 800 = 200.
  it("declares the dollars' drift up to the share purchase: 100 stock + 100 currency", () => {
    const { st, rates } = toStatement({ ...cycle, ev: cycle.ev.filter((e) => e.k !== "sell") });
    rates.set("2024-06-03", new Map([["USD", "0.85"]]));
    st.optionExercises = [
      {
        transactionID: "ex1",
        accountId: "U1",
        symbol: "AAA 240621P00100000",
        description: "AAA 21JUN24 100 P",
        isin: "",
        currency: "EUR",
        date: "2024-06-03",
        action: "Exercise",
        putCall: "P",
        strike: "100",
        expiry: "2024-06-21",
        quantity: "1",
        proceeds: "0",
        underlyingSymbol: "AAA",
        underlyingIsin: ISIN_A,
        multiplier: "10",
      },
    ];
    const v = figures(st, rates);
    expect([f2(v.stock), f2(v.fx)]).toEqual(["100.00", "100.00"]);
    expect(v.report.fxGains.disposals.map((d) => d.trigger)).toEqual(["stock_sale_cross"]);
  });
});
