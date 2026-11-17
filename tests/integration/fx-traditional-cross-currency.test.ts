/**
 * «Tradicional con divisa» (issue #434): a position bought in one currency and
 * sold in another (same ISIN, another listing). Review r5939472090.
 *
 * The stock FIFO matches the lots by ISIN, so the sale consumes the USD lot and
 * the stock line runs from the buy-date USD rate to the sale value in the
 * sale's currency. The dollars left the account inside the shares and never
 * come back as dollars, so their drift from buying the currency to buying the
 * shares is booked at the sale (`stock_sale_cross`), and the sale's own
 * currency enters its pool at the sale rate. Without it the drift stayed
 * parked under the sold position forever.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport, type ReportOptions } from "../../src/generators/report.js";
import { toStatement, TRAD, MONO, type Scenario } from "./fx-traditional-harness.js";
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
    openCloseIndicator: "",
    exchange: "IDEALFX",
    commission: "0",
    commissionCurrency: "GBP",
  });
}

function figures(st: FlexStatement, rates: EcbRateMap, options: ReportOptions) {
  const r = generateTaxReport(st, rates, 2024, { ...options, fxTrace: true });
  return { stock: r.capitalGains.netGainLoss, fx: r.fxGains.netGainLoss, report: r };
}

// Fund 1000 USD for 800 EUR, buy at 0.90, sell the same ISIN for 1000 EUR.
// Economic: 1000 − 800 = 200 EUR, stock 100 (1000 − 900) + currency 100.
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

describe("a USD position sold in EUR", () => {
  const build = () => {
    const { st, rates } = toStatement(cycle);
    relist(st, rates, { "2024-06-03": { ccy: "EUR" } });
    return { st, rates };
  };

  it("books the dollars' drift up to the share purchase: 100 stock + 100 currency = 200", () => {
    const { st, rates } = build();
    const v = figures(st, rates, TRAD);
    expect([f2(v.stock), f2(v.fx)]).toEqual(["100.00", "100.00"]);
    const rows = v.report.fxGains.disposals;
    expect(rows.map((d) => [d.trigger, f2(d.proceedsEur), f2(d.costBasisEur)])).toEqual([["stock_sale_cross", "900.00", "800.00"]]);
    // Not a losing sale, and nothing stays parked under the sold position.
    const ids = v.report.messages.map((m) => m.id);
    expect(ids).not.toContain("report.fx_traditional_lost_dollars");
    expect(ids).not.toContain("report.fx_traditional_orphan");
    expect(ids).not.toContain("fx.conservation_mismatch");
  });

  it("monodivisa keeps its stock line and computes no currency, as documented", () => {
    const { st, rates } = build();
    const v = figures(st, rates, MONO);
    expect([f2(v.stock), f2(v.fx)]).toEqual(["100.00", "0.00"]);
  });
});

describe("a USD position sold in GBP", () => {
  // Sold for 800 GBP at 1.20 (960 EUR), converted at 1.15 (920 EUR).
  // Economic: 920 − 800 = 120 EUR = stock 60 + USD drift 100 + GBP −40.
  const build = () => {
    const { st, rates } = toStatement({
      ...cycle,
      ev: cycle.ev.map((e) => (e.k === "sell" ? { ...e, px: "80" } : e)),
    });
    relist(st, rates, { "2024-06-03": { ccy: "GBP", rate: "1.20" } });
    gbpToEur(st, rates, "2024-09-02", "800", "1.15");
    return { st, rates };
  };

  it("books the USD drift at the sale and the GBP from the sale rate: 60 + 60 = 120", () => {
    const { st, rates } = build();
    const v = figures(st, rates, TRAD);
    expect([f2(v.stock), f2(v.fx)]).toEqual(["60.00", "60.00"]);
    const rows = v.report.fxGains.disposals.map((d) => [d.currency, d.trigger, f2(d.gainLossEur)]);
    expect(rows).toEqual([
      ["USD", "stock_sale_cross", "100.00"],
      ["GBP", "conversion", "-40.00"],
    ]);
    const ids = v.report.messages.map((m) => m.id);
    expect(ids).not.toContain("fx.missing_prior_lots");
    expect(ids).not.toContain("fx.conservation_mismatch");
  });
});

describe("a EUR lot sold in USD leaves the USD lot of the same ISIN parked", () => {
  // Lot 1: 5 AAA bought in EUR. Lot 2: 10 AAA bought in USD. The first sale, in
  // USD, consumes lot 1: its 550 USD are new dollars at the sale rate, and lot
  // 2's principal stays parked for its own sale.
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

  it("the first sale unparks nothing; the second returns the whole 1000", () => {
    const { st, rates } = toStatement(sc);
    relist(st, rates, { "2024-03-01": { ccy: "EUR" } });
    const v = figures(st, rates, TRAD);
    const trace = v.report.fxTrace ?? [];
    const june = trace.filter((t) => t.date === "2024-06-03" && t.positionKey === ISIN_A);
    expect(june.map((t) => [t.kind, f2(new Decimal(t.quantityFcy))])).toEqual([["profit", "550.00"]]);
    const sept = trace.filter((t) => t.date === "2024-09-02" && t.kind === "unpark");
    expect(sept.map((t) => f2(new Decimal(t.quantityFcy)))).toEqual(["1000.00"]);
    // EUR in 800 + 500, EUR out 1240: −60 = stock −72.50 + currency 12.50.
    expect([f2(v.stock), f2(v.fx)]).toEqual(["-72.50", "12.50"]);
  });
});
