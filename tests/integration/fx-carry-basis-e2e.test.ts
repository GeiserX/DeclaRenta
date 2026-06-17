import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport } from "../../src/generators/report.js";
import type { FlexStatement, Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// End-to-end: the CARRY-BASIS FX model proven through the REAL generateTaxReport
// pipeline, with TRACKED funding so carry-basis actually BITES.
// ---------------------------------------------------------------------------
// Issue #230 follow-up (supersedes the v0.49.0 full-proceeds model): a
// foreign-currency stock BUY SILENTLY CONSUMES the FCY it spends from the FX
// pool and PARKS the carried EUR basis of those dollars inside the open
// position; a foreign-currency stock SELL re-adds that principal at its CARRIED
// (original-acquisition) basis plus the trading profit at the sale-date rate.
// Neither emits an FxDisposal — only a real FCY→EUR conversion realizes the
// deferred gain (Art. 14.2.e LIRPF; DGT V2324-10).
//
// WHY THIS FILE EXISTS — the coverage gap the /review-pr! panel flagged HIGH:
// every OTHER end-to-end test through generateTaxReport uses an UNCOVERED buy
// (no preceding EUR→USD funding conversion in the data), so
// `extractStockPurchaseFxEvents` always parks "uncovered" and the whole
// pipeline collapses to the OLD full-proceeds behavior — the carry-basis
// CORRECTION is never exercised through the real wiring. These tests build
// TRACKED EUR→USD funding that a stock BUY actually consumes, so the parked
// basis is real and a later conversion is rated against the CARRIED rate, not
// the sale rate. Each test ALSO hand-computes what the OLD full-proceeds model
// would have produced and asserts the result is NOT that — a guard that fails
// the moment someone breaks `extractStockPurchaseFxEvents` (the producer that
// makes the buy consume the funding).
//
// THE DIVERGENCE MECHANISM (hand-reasoned, used by every test below): when
// EVERY dollar that ever exists is eventually converted to EUR, carry-basis and
// full-proceeds give the SAME total — the gain telescopes to
// Σ qty × (convRate − fundRate). The two models diverge ONLY when some FCY is
// permanently LOCKED inside a stock position still OPEN at the period boundary:
//   • carry-basis  → that principal stays PARKED (deferred, correctly never
//                    converted, never taxed);
//   • full-proceeds → a buy removed nothing, so those dollars sit in the
//                    spendable pool and a later conversion CONSUMES them,
//                    realizing a gain (or loss) on currency still locked in an
//                    open position — a phantom.
// So every scenario below leaves exactly one position OPEN at year-end; the
// carry-vs-full gap is precisely the FX drift on that locked principal.
//
// Every EUR figure is hand-computed and pinned with .toFixed(2). The ECB rate
// map is built IN-MEMORY (date → currency → "EUR per 1 FCY"), exactly like the
// sibling integration/generator tests — NO network fetch ever happens.
// ===========================================================================

/** Build an in-memory ECB rate map (date → currency → "EUR per 1 FCY"). */
function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

/** Build a Trade from overrides, filling the required Flex fields with sane defaults. */
function makeTrade(overrides: Partial<Trade>): Trade {
  const tradeDate = overrides.tradeDate ?? "2024-03-15";
  return {
    tradeID: "1",
    accountId: "U1",
    symbol: "AAPL",
    description: "APPLE INC",
    isin: "US0378331005",
    assetCategory: "STK",
    currency: "USD",
    tradeDate,
    settlementDate: overrides.settlementDate ?? tradeDate,
    quantity: "100",
    tradePrice: "150",
    tradeMoney: "15000",
    proceeds: "15000",
    cost: "15000",
    fifoPnlRealized: "0",
    fxRateToBase: "0.90",
    buySell: "BUY",
    openCloseIndicator: overrides.buySell === "SELL" ? "C" : "O",
    exchange: "NASDAQ",
    commissionCurrency: "USD",
    commission: "0",
    taxes: "0",
    multiplier: "1",
    ...overrides,
  };
}

/** Wrap trades into the FlexStatement shape generateTaxReport expects (no parser, no network). */
function makeStatement(trades: Trade[]): FlexStatement {
  return {
    accountId: "U1",
    fromDate: "20240101",
    toDate: "20251231",
    period: "Annual",
    trades,
    cashTransactions: [],
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
  };
}

// ---------------------------------------------------------------------------
// CASH conversion builders. extractFxEvents (fx-fifo.ts) recognises a CASH,
// non-FXCONV trade whose symbol is "EUR.USD" (quote side == trade.currency
// "USD" → isCurrencyQuote() true → amount = |tradeMoney|).
//   • EUR→USD funding (ACQUIRING USD): BUY EUR.USD acquires EUR by disposing
//     USD, so it is the SELL EUR.USD direction that acquires USD: with the quote
//     == USD, `acquiring = buySell === "SELL"`. So a SELL EUR.USD of $N pushes a
//     +$N acquisition lot — the TRACKED funding a later stock BUY consumes.
//   • USD→EUR conversion (DISPOSING USD): BUY EUR.USD (buying EUR by disposing
//     USD) → `acquiring = false` → a −$N disposal that consumes USD lots FIFO
//     and realizes the deferred FX gain.
// ---------------------------------------------------------------------------

/** EUR→USD funding of $usd on `date` (acquire a USD lot at that date's rate). */
function fundUsd(id: string, date: string, usd: string): Trade {
  return makeTrade({
    tradeID: id,
    symbol: "EUR.USD",
    description: "EUR.USD",
    isin: "",
    assetCategory: "CASH",
    currency: "USD",
    tradeDate: date,
    settlementDate: date,
    quantity: usd,
    tradePrice: "1",
    tradeMoney: usd,
    proceeds: usd,
    cost: usd,
    buySell: "SELL", // SELL EUR.USD = acquire USD (quote side) → +lot
    openCloseIndicator: "",
    exchange: "IDEALFX",
  });
}

/** USD→EUR conversion of $usd on `date` (dispose USD, realize the FX gain). */
function convUsd(id: string, date: string, usd: string): Trade {
  return makeTrade({
    tradeID: id,
    symbol: "EUR.USD",
    description: "EUR.USD",
    isin: "",
    assetCategory: "CASH",
    currency: "USD",
    tradeDate: date,
    settlementDate: date,
    quantity: usd,
    tradePrice: "1",
    tradeMoney: usd,
    proceeds: `-${usd}`,
    cost: usd,
    buySell: "BUY", // BUY EUR.USD = dispose USD (quote side) → −lot (conversion)
    openCloseIndicator: "",
    exchange: "IDEALFX",
  });
}

/** A long STK BUY of `usd` worth (qty × $price = usd) on `date`. */
function stockBuy(id: string, isin: string, symbol: string, date: string, qty: string, price: string): Trade {
  const money = new Decimal(qty).mul(price).toString();
  return makeTrade({
    tradeID: id,
    isin,
    symbol,
    description: symbol,
    tradeDate: date,
    buySell: "BUY",
    quantity: qty,
    tradePrice: price,
    tradeMoney: money,
    proceeds: `-${money}`,
    cost: money,
  });
}

/** A long STK SELL of `usd` worth (qty × $price = usd) on `date`. */
function stockSell(id: string, isin: string, symbol: string, date: string, qty: string, price: string): Trade {
  const money = new Decimal(qty).mul(price).toString();
  return makeTrade({
    tradeID: id,
    isin,
    symbol,
    description: symbol,
    tradeDate: date,
    buySell: "SELL",
    quantity: qty,
    tradePrice: price,
    tradeMoney: money,
    proceeds: money,
    cost: money,
  });
}

// Stable ISINs for the distinct positions used below (per-position parking keys
// on isin || symbol, so each position parks/unparks its OWN principal).
const ISIN_AAPL = "US0378331005";
const ISIN_MSFT = "US5949181045";
const ISIN_NVDA = "US67066G1040";

// ===========================================================================
// 1. THE HEADLINE CARRY-BASIS CORRECTION, END-TO-END.
// ===========================================================================
//
// All rates are "EUR per 1 USD":
//   fund 2024-02-01 @ 0.90   ($2000 of TRACKED USD acquired, basis 0.90)
//   buys 2024-03-15 @ 0.95   (buy-date rate — IRRELEVANT to the carried basis)
//   sell 2024-06-20 @ 1.00   (AAPL sale rate → stock gain + profit re-add rate)
//   conv 2024-09-10 @ 1.05   (USD→EUR conversion → realizes the deferred FX gain)
//
// TRADES:
//   fund EUR→USD  $2000 @ 0.90
//   BUY  AAPL     $1000  (10 × $100)   ← consumes $1000 of the tracked funding
//   BUY  MSFT     $1000  (10 × $100)   ← OPEN at year-end (never sold)
//   SELL AAPL     $1100  (10 × $110)
//   conv USD→EUR  $1100 @ 1.05
//
// CARRY-BASIS hand-trace (the engine's parked-FIFO, per-position):
//   funding pool          : [{2000, 0.90}]
//   AAPL buy ($1000)       : consume 1000 @0.90 → park USD|AAPL=[{1000,0.90}];  pool [{1000,0.90}]
//   MSFT buy ($1000)       : consume 1000 @0.90 → park USD|MSFT=[{1000,0.90}];  pool []
//   AAPL sell (cost 1000, proc 1100 @1.00):
//        re-add principal min(1000,1100)=1000 at CARRIED 0.90  → pool [{1000,0.90}]
//        profit 1100−1000 = 100 at sale 1.00                   → pool [{1000,0.90},{100,1.00}]
//   MSFT never sells       : its {1000,0.90} stays PARKED (deferred — correct)
//   conv $1100 @1.05       : 1000 @0.90 → 1000×(1.05−0.90) = €150.00
//                            100  @1.00 →  100×(1.05−1.00) =   €5.00
//   FX net (carry)         :                                  = €155.00  ✓
//
// OLD FULL-PROCEEDS hand-trace (buy = no-op, sell pushes FULL proceeds @ sale):
//   funding pool          : [{2000, 0.90}]
//   buys                  : NO-OP (the bug: a buy removed nothing)
//   AAPL sell             : push {1100, 1.00}        → pool [{2000,0.90},{1100,1.00}]
//   conv $1100 @1.05      : consume 1100 of {2000,0.90} → 1100×(1.05−0.90) = €165.00
//   FX (full-proceeds)    :                                                = €165.00
//
// The €10 difference IS the FX drift on MSFT's locked $1000 that full-proceeds
// wrongly converts at 0.90 (1000 × (1.05 − 0.90) = 150 would leak in across the
// whole period) — here surfaced as the conversion picking the wrong basis. The
// carry model defers MSFT's principal, so the conversion is rated against AAPL's
// carried 0.90 + profit only → €155, NOT €165. Asserting €155 (and ≠ €165)
// PROVES the buy consumed the tracked funding (carry-basis is live in the
// pipeline), not the uncovered-park full-proceeds fallback.
describe("carry-basis e2e #1: tracked funding consumed by a buy → conversion rated at CARRIED basis (€155, not €165)", () => {
  const rates = makeRateMap({
    "2024-02-01": { USD: "0.90" }, // funding (the tracked lot the buy consumes)
    "2024-03-15": { USD: "0.95" }, // buy date — never enters the carried basis
    "2024-06-20": { USD: "1.00" }, // AAPL sale → stock gain + profit re-add rate
    "2024-09-10": { USD: "1.05" }, // conversion → realizes the deferred FX gain
  });
  const statement = makeStatement([
    fundUsd("fund", "2024-02-01", "2000"),
    stockBuy("buy-aapl", ISIN_AAPL, "AAPL", "2024-03-15", "10", "100"),
    stockBuy("buy-msft", ISIN_MSFT, "MSFT", "2024-03-15", "10", "100"), // OPEN at year end
    stockSell("sell-aapl", ISIN_AAPL, "AAPL", "2024-06-20", "10", "110"),
    convUsd("conv", "2024-09-10", "1100"),
  ]);
  const report = generateTaxReport(statement, rates, 2024);

  it("realizes the CARRY-BASIS FX gain (€155.00), NOT the full-proceeds €165.00", () => {
    // The headline assertion: the conversion consumed AAPL's CARRIED 0.90
    // principal + the profit, with MSFT's principal correctly deferred.
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("155.00");
    // Guard against a regression to the OLD full-proceeds model. If
    // extractStockPurchaseFxEvents stops consuming the tracked funding, the buy
    // parks "uncovered", the conversion eats the funding lot at 0.90, and this
    // becomes €165.00 — this guard catches exactly that.
    expect(report.fxGains.netGainLoss.toFixed(2)).not.toBe("165.00");
  });

  it("splits the conversion into carried-principal + sale-rate-profit disposals (proves the buy parked the basis)", () => {
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    expect(convs.length).toBe(2);
    for (const c of convs) {
      expect(c.currency).toBe("USD");
      expect(c.disposeDate).toBe("2024-09-10");
    }
    // Principal leg: $1000 re-added at the CARRIED 0.90 → cost €900, gain €150.
    const principal = convs.find((c) => c.quantity.toFixed(0) === "1000")!;
    expect(principal.proceedsEur.toFixed(2)).toBe("1050.00"); // 1000 × 1.05
    expect(principal.costBasisEur.toFixed(2)).toBe("900.00"); // 1000 × 0.90 (CARRIED, not 1.00)
    expect(principal.gainLossEur.toFixed(2)).toBe("150.00");
    // Profit leg: $100 at the sale rate 1.00 → cost €100, gain €5.
    const profit = convs.find((c) => c.quantity.toFixed(0) === "100")!;
    expect(profit.proceedsEur.toFixed(2)).toBe("105.00"); // 100 × 1.05
    expect(profit.costBasisEur.toFixed(2)).toBe("100.00"); // 100 × 1.00 (sale-rate profit)
    expect(profit.gainLossEur.toFixed(2)).toBe("5.00");
  });

  it("pins the FX casilla totals: 1633 = €1155.00, 1637 = €1000.00, net = €155.00", () => {
    // 1633 = 1050 + 105 = 1155; 1637 = 900 + 100 = 1000; net = 155.
    expect(report.fxGains.transmissionValue.toFixed(2)).toBe("1155.00");
    expect(report.fxGains.acquisitionValue.toFixed(2)).toBe("1000.00");
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("155.00");
  });

  it("computes the stock gain independently at the sale-date rate (V2422-20): €100.00", () => {
    // Only AAPL is sold in-year: proceeds 1100 × 1.00 − cost 1000 × 1.00 = €100.
    // (MSFT is still open → no disposal.) The stock line is FX-stripped by design;
    // the buy↔sale drift on the principal lives in the FX line above.
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("1100.00");
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("1000.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("100.00");
  });
});

// ===========================================================================
// 2. TWO-ROUND-TRIP THROUGH generateTaxReport — carry €310, full-proceeds €330.
// ===========================================================================
//
// The €320-not-€450 spirit end-to-end: fund TRACKED USD, run TWO complete
// stock round-trips that each close, leave a THIRD position OPEN locking cheap
// dollars, then convert. The carry total is the carry-basis-correct figure; the
// full-proceeds model drifts HIGHER because it leaks the open position's cheap
// principal into the conversion.
//
// Rates "EUR per 1 USD":
//   fund 2024-01-10 @ 0.90   ($3000 tracked)
//   buys 2024-03-15 @ 0.95
//   sells 2024-06-20 @ 1.00
//   conv 2024-09-10 @ 1.05
//
// TRADES:
//   fund EUR→USD $3000 @ 0.90
//   BUY  AAPL $1000  → SELL AAPL $1100   (round-trip 1, closed)
//   BUY  MSFT $1000  → SELL MSFT $1100   (round-trip 2, closed)
//   BUY  NVDA $1000  (OPEN at year-end — locks $1000 of 0.90 dollars)
//   conv USD→EUR $2200 @ 1.05            (only the two sales' proceeds)
//
// CARRY-BASIS hand-trace (per-position parking):
//   funding pool                 : [{3000, 0.90}]
//   AAPL buy : park USD|AAPL=[{1000,0.90}]; pool [{2000,0.90}]
//   MSFT buy : park USD|MSFT=[{1000,0.90}]; pool [{1000,0.90}]
//   NVDA buy : park USD|NVDA=[{1000,0.90}]; pool []          ← stays parked (open)
//   AAPL sell (cost 1000, proc 1100 @1.00): re-add 1000 @0.90 + 100 @1.00
//   MSFT sell (cost 1000, proc 1100 @1.00): re-add 1000 @0.90 + 100 @1.00
//   pool now : [{1000,0.90},{100,1.00},{1000,0.90},{100,1.00}]  (= $2200)
//   conv $2200 @1.05 :
//        1000 @0.90 → 150   +   100 @1.00 → 5
//      + 1000 @0.90 → 150   +   100 @1.00 → 5
//   FX net (carry)   :                                       = €310.00  ✓
//   NVDA's {1000,0.90} stays PARKED (deferred — correct: still an open position).
//
// OLD FULL-PROCEEDS hand-trace (buys no-op; sells push full proceeds @1.00):
//   funding pool : [{3000, 0.90}]
//   AAPL sell push {1100,1.00}; MSFT sell push {1100,1.00}
//   pool : [{3000,0.90},{1100,1.00},{1100,1.00}]
//   conv $2200 @1.05 : consume 2200 entirely from {3000,0.90} → 2200×(1.05−0.90)
//   FX (full-proceeds) : 2200 × 0.15                                  = €330.00
//
// The €20 gap = NVDA's locked $1000 × (1.05 − 0.90): full-proceeds converts those
// cheap dollars (they sit in the pool because the buy removed nothing); carry
// keeps them parked. Asserting €310 (≠ €330) proves BOTH buys consumed tracked
// funding AND the open buy's principal was deferred — across two round-trips.
describe("carry-basis e2e #2: two round-trips + one open position → carry €310, NOT full-proceeds €330", () => {
  const rates = makeRateMap({
    "2024-01-10": { USD: "0.90" }, // funding ($3000 tracked)
    "2024-03-15": { USD: "0.95" }, // buys
    "2024-06-20": { USD: "1.00" }, // sells
    "2024-09-10": { USD: "1.05" }, // conversion
  });
  const statement = makeStatement([
    fundUsd("fund", "2024-01-10", "3000"),
    stockBuy("buy-aapl", ISIN_AAPL, "AAPL", "2024-03-15", "10", "100"),
    stockBuy("buy-msft", ISIN_MSFT, "MSFT", "2024-03-15", "10", "100"),
    stockBuy("buy-nvda", ISIN_NVDA, "NVDA", "2024-03-15", "10", "100"), // OPEN at year end
    stockSell("sell-aapl", ISIN_AAPL, "AAPL", "2024-06-20", "10", "110"),
    stockSell("sell-msft", ISIN_MSFT, "MSFT", "2024-06-20", "10", "110"),
    convUsd("conv", "2024-09-10", "2200"),
  ]);
  const report = generateTaxReport(statement, rates, 2024);

  it("totals the CARRY-BASIS FX gain (€310.00), NOT the full-proceeds €330.00", () => {
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("310.00");
    // Full-proceeds would leak NVDA's locked $1000 @0.90 into the conversion → €330.
    expect(report.fxGains.netGainLoss.toFixed(2)).not.toBe("330.00");
  });

  it("produces four conversion disposals (two carried-principal + two profit) summing to €310", () => {
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    expect(convs.length).toBe(4);
    const sum = (pick: (d: (typeof convs)[number]) => Decimal) =>
      convs.reduce((s, d) => s.plus(pick(d)), new Decimal(0));
    // 1633 = 2 × (1050 + 105) = 2310; 1637 = 2 × (900 + 100) = 2000; net = 310.
    expect(sum((d) => d.proceedsEur).toFixed(2)).toBe("2310.00");
    expect(sum((d) => d.costBasisEur).toFixed(2)).toBe("2000.00");
    expect(sum((d) => d.gainLossEur).toFixed(2)).toBe("310.00");
    // Exactly two principal legs at the CARRIED 0.90 (cost €900 each) — the
    // load-bearing proof that BOTH buys consumed tracked funding.
    const principalLegs = convs.filter((c) => c.quantity.toFixed(0) === "1000");
    expect(principalLegs.length).toBe(2);
    for (const p of principalLegs) expect(p.costBasisEur.toFixed(2)).toBe("900.00");
  });

  it("pins the FX casilla totals: 1633 = €2310.00, 1637 = €2000.00, net = €310.00", () => {
    expect(report.fxGains.transmissionValue.toFixed(2)).toBe("2310.00");
    expect(report.fxGains.acquisitionValue.toFixed(2)).toBe("2000.00");
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("310.00");
  });

  it("computes the stock gain at the sale-date rate for the two closed round-trips: €200.00", () => {
    // AAPL + MSFT each: 1100 × 1.00 − 1000 × 1.00 = €100 → €200 total. NVDA open → no disposal.
    expect(report.capitalGains.disposals).toHaveLength(2);
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("200.00");
  });
});

// ===========================================================================
// 3. MULTI-ROUND + "tracked funding consumed by a buy → later micro-conversion
//    of the LEFTOVER defers/avoids a phantom" (simplified real-file pattern).
// ===========================================================================
//
// The real-file pattern: a buy consumes MOST of a mixed-rate pool, then a small
// USD→EUR conversion of the leftover must be rated against the RIGHT remaining
// dollars — not against cheap dollars that were actually spent on the still-open
// stock. Here the leftover is the PRICIER tranche, so the carry model yields a
// small LOSS while full-proceeds fabricates a phantom GAIN.
//
// Rates "EUR per 1 USD":
//   fund-A 2024-01-10 @ 0.90   ($100 cheap)
//   fund-B 2024-02-10 @ 1.10   ($900 pricey)
//   buy    2024-03-15 @ 0.95   (buy-date rate — irrelevant to carried basis)
//   conv   2024-09-10 @ 1.05
//
// TRADES:
//   fund EUR→USD $100  @ 0.90
//   fund EUR→USD $900  @ 1.10
//   BUY  AAPL    $900  (9 × $100)  ← OPEN at year-end; consumes $900 oldest-first
//   conv USD→EUR $100  @ 1.05      ← the leftover micro-conversion
//
// CARRY-BASIS hand-trace:
//   funding pool : [{100, 0.90}, {900, 1.10}]
//   AAPL buy ($900) consumes oldest-first: 100 @0.90 (parked) + 800 @1.10 (parked)
//        → pool LEFTOVER = [{100, 1.10}]   (the un-spent pricey tail)
//        → park USD|AAPL = [{100,0.90},{800,1.10}]  (deferred — AAPL still open)
//   conv $100 @1.05 : consume 100 @1.10 → 100 × (1.05 − 1.10) = −€5.00
//   FX net (carry)  :                                          = −€5.00  ✓
//
// OLD FULL-PROCEEDS hand-trace (buy = no-op → nothing removed from the pool):
//   funding pool : [{100, 0.90}, {900, 1.10}]   (unchanged)
//   conv $100 @1.05 : consume the OLDEST 100 @0.90 → 100 × (1.05 − 0.90) = +€15.00
//   FX (full-proceeds) :                                                 = +€15.00
//
// The buy "protected" the cheap $100 (it was really spent acquiring the open
// AAPL position): carry rates the leftover conversion against the pricey $1.10
// tail (a true −€5 loss), while full-proceeds books a +€15 PHANTOM gain on
// dollars no longer freely available. Asserting −€5.00 (≠ +€15.00) proves the
// buy consumed the RIGHT (oldest) funding lot and the leftover was rated
// against the correct remaining dollars.
describe("carry-basis e2e #3: buy consumes the cheap tranche → leftover micro-conversion is −€5 (carry), NOT +€15 (phantom)", () => {
  const rates = makeRateMap({
    "2024-01-10": { USD: "0.90" }, // $100 cheap funding
    "2024-02-10": { USD: "1.10" }, // $900 pricey funding
    "2024-03-15": { USD: "0.95" }, // buy date (irrelevant to carried basis)
    "2024-09-10": { USD: "1.05" }, // leftover conversion
  });
  const statement = makeStatement([
    fundUsd("fund-a", "2024-01-10", "100"),
    fundUsd("fund-b", "2024-02-10", "900"),
    stockBuy("buy-aapl", ISIN_AAPL, "AAPL", "2024-03-15", "9", "100"), // $900, OPEN at year end
    convUsd("conv", "2024-09-10", "100"),
  ]);
  const report = generateTaxReport(statement, rates, 2024);

  it("rates the leftover conversion against the RIGHT remaining lot → −€5.00, NOT the phantom +€15.00", () => {
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("-5.00");
    // Full-proceeds (buy removes nothing) would convert the OLDEST cheap $100
    // @0.90 → +€15.00. That is the phantom this guard catches.
    expect(report.fxGains.netGainLoss.toFixed(2)).not.toBe("15.00");
  });

  it("the single conversion disposal is $100 rated at the pricey 1.10 carried basis", () => {
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    expect(convs.length).toBe(1);
    const c = convs[0]!;
    expect(c.currency).toBe("USD");
    expect(c.quantity.toFixed(0)).toBe("100");
    expect(c.proceedsEur.toFixed(2)).toBe("105.00"); // 100 × 1.05
    expect(c.costBasisEur.toFixed(2)).toBe("110.00"); // 100 × 1.10 (the pricey tail, NOT 0.90)
    expect(c.gainLossEur.toFixed(2)).toBe("-5.00");
  });

  it("no stock disposal (AAPL never sold) — the cheap principal stays deferred", () => {
    // The cheap $100 + $800 the buy consumed is PARKED, not converted: the FX
    // drift on currency still locked in an open position is correctly NOT realized.
    expect(report.capitalGains.disposals).toHaveLength(0);
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("0.00");
  });
});

// ===========================================================================
// 4. MONODIVISA — Test #1's statement with { skipFx: true } → all FX zero.
// ===========================================================================
//
// Monodivisa mode (Autodeclaro/Taxdown parity) disables the whole FX FIFO
// engine — including the carry-basis stock-buy/sell producers (they live inside
// the same `skipFx` block in report.ts). So the headline scenario that produces
// €155 of carry-basis FX gain with FX ON produces ZERO FX with FX OFF, while the
// EUR stock gain (computed via ECB rates) is unchanged at €100.
describe("carry-basis e2e #4: monodivisa (skipFx) zeroes the carry-basis FX, keeps the stock gain", () => {
  const rates = makeRateMap({
    "2024-02-01": { USD: "0.90" },
    "2024-03-15": { USD: "0.95" },
    "2024-06-20": { USD: "1.00" },
    "2024-09-10": { USD: "1.05" },
  });
  const statement = makeStatement([
    fundUsd("fund", "2024-02-01", "2000"),
    stockBuy("buy-aapl", ISIN_AAPL, "AAPL", "2024-03-15", "10", "100"),
    stockBuy("buy-msft", ISIN_MSFT, "MSFT", "2024-03-15", "10", "100"),
    stockSell("sell-aapl", ISIN_AAPL, "AAPL", "2024-06-20", "10", "110"),
    convUsd("conv", "2024-09-10", "1100"),
  ]);
  const report = generateTaxReport(statement, rates, 2024, { skipFx: true });

  it("zeroes the entire FX block (no carry-basis events emitted at all)", () => {
    expect(report.fxGains.disposals).toHaveLength(0);
    expect(report.fxGains.transmissionValue.toFixed(2)).toBe("0.00");
    expect(report.fxGains.acquisitionValue.toFixed(2)).toBe("0.00");
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("0.00");
  });

  it("keeps the stock capital gain identical to the FX-on case (€100.00)", () => {
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("1100.00");
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("1000.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("100.00");
  });
});

// ===========================================================================
// 5. T+2 SETTLEMENT TIMING — the buy must park on the cash SETTLEMENT date, not
//    the trade date, or a funding conversion that settles AFTER the stock trade
//    date sorts too late and the buy parks "uncovered" (silent regression to
//    full-proceeds even though the account IS tracked). (CodeRabbit #232 finding.)
// ===========================================================================
//
// Funding EUR→USD $2000: trade-dated 2024-02-01 but SETTLES 2024-02-05 @ 0.90.
// Two stock BUYs ($1000 each): trade-dated 2024-02-03 (BEFORE funding settles)
//   but settling 2024-02-07 (AFTER). AAPL is sold; MSFT stays OPEN at year end.
// Dating the park on the buys' SETTLEMENT (02-07 > 02-05) lets them consume the
// funding lot → AAPL carries 0.90, MSFT's $1000 defers → conv $1100 = €155.
// Dating it on the TRADE date (02-03 < 02-05) would sort BOTH buys before the
// funding acquire → the pool is empty → both park UNCOVERED → the conversion
// eats the funding lot at 0.90 directly → €165 (the silent T+2 regression).
// The open MSFT position is what makes the two datings DIVERGE in the final
// number (a single position nets to €155 either way — the gap only surfaces when
// principal is left parked/deferred). This is the multi-position construction
// that actually exercises CodeRabbit #232's settlement-timing finding.
describe("carry-basis e2e #5: funding that settles AFTER the stock trade date is still consumed (T+2)", () => {
  const rates = makeRateMap({
    "2024-02-05": { USD: "0.90" }, // funding SETTLEMENT date (the tracked lot)
    "2024-02-03": { USD: "0.92" }, // stock buy TRADE date (rate lookup only; never the carried basis)
    "2024-02-07": { USD: "0.93" }, // stock buy SETTLEMENT date (where the park is dated)
    "2024-06-20": { USD: "1.00" }, // sale
    "2024-09-10": { USD: "1.05" }, // conversion
  });
  // Funding: trade 02-01, settle 02-05.
  const fund = makeTrade({
    tradeID: "fund", symbol: "EUR.USD", description: "EUR.USD", isin: "",
    assetCategory: "CASH", currency: "USD", tradeDate: "2024-02-01",
    settlementDate: "2024-02-05", quantity: "2000", tradePrice: "1",
    tradeMoney: "2000", proceeds: "2000", cost: "2000",
    buySell: "SELL", openCloseIndicator: "", exchange: "IDEALFX",
  });
  // Both buys: trade 02-03 (before funding settles), settle 02-07 (after).
  const buyAapl = makeTrade({
    tradeID: "buy-aapl", isin: ISIN_AAPL, symbol: "AAPL", description: "AAPL",
    tradeDate: "2024-02-03", settlementDate: "2024-02-07", buySell: "BUY",
    quantity: "10", tradePrice: "100", tradeMoney: "1000", proceeds: "-1000", cost: "1000",
  });
  const buyMsft = makeTrade({
    tradeID: "buy-msft", isin: ISIN_MSFT, symbol: "MSFT", description: "MSFT",
    tradeDate: "2024-02-03", settlementDate: "2024-02-07", buySell: "BUY",
    quantity: "10", tradePrice: "100", tradeMoney: "1000", proceeds: "-1000", cost: "1000",
  });
  const statement = makeStatement([
    fund, buyAapl, buyMsft,
    stockSell("sell", ISIN_AAPL, "AAPL", "2024-06-20", "10", "110"),
    convUsd("conv", "2024-09-10", "1100"),
  ]);
  const report = generateTaxReport(statement, rates, 2024);

  it("parks on settlement → consumes the late-settling funding → carried €155, not uncovered €165", () => {
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("155.00");
    // The regression guard: trade-date parking would sort both buys before the
    // funding acquire, leaving them uncovered, and the conversion would eat the
    // funding lot directly → €165.00. Verified to flip exactly that way.
    expect(report.fxGains.netGainLoss.toFixed(2)).not.toBe("165.00");
  });

  it("the conversion's principal leg carries the 0.90 funding basis (proves coverage)", () => {
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    const principal = convs.find((c) => c.quantity.toFixed(0) === "1000")!;
    expect(principal).toBeDefined();
    expect(principal.costBasisEur.toFixed(2)).toBe("900.00"); // 1000 × 0.90 carried funding basis
  });
});

// ===========================================================================
// Issue #230 (elmasvital): a foreign-currency stock sold at a LOSS, where the
// resulting dollars are NEVER converted to EUR, generates ZERO divisa gain/loss
// ("como si te hubieras comprado una hamburguesa en dólares"). Casillas
// 1633/1637 must contain ONLY amounts actually transmitted (FCY→EUR) in the
// year. The dollars that left the FX FIFO inside the losing position never
// reached a EUR conversion (Art. 14.2.e: "se imputará en el momento del cobro o
// del pago"), so there is nothing to compute. These tests pin that invariant at
// the casilla level so it can never silently regress.
//
// Funding is TRACKED ($1000 @1.20) so the buy genuinely PARKS a carried basis
// and the sell genuinely DISCARDS the lost principal — i.e. this exercises the
// real carry-basis discard path, not the uncovered no-op.
// ===========================================================================
describe("issue #230: FCY stock loss-sell with NO EUR conversion → divisa 1633/1637 = 0", () => {
  // 02-01 fund $1000 @1.20 (€1200 cost); buy $1000 of AAPL; sell for $800 (a
  // $200 USD loss) on 06-20 @0.80. The whole position is closed but NO dollars
  // are converted to EUR. The €-loss lives entirely in the stock line; the
  // divisa element is untouched because nothing was transmitted to euros.
  const rates = makeRateMap({
    "2024-02-01": { USD: "1.20" }, // funding + buy
    "2024-06-20": { USD: "0.80" }, // loss sale (rate fell)
  });
  const fund = makeTrade({
    tradeID: "fund", symbol: "EUR.USD", description: "EUR.USD", isin: "",
    assetCategory: "CASH", currency: "USD", tradeDate: "2024-02-01",
    settlementDate: "2024-02-01", quantity: "1000", tradePrice: "1",
    tradeMoney: "1000", proceeds: "1000", cost: "1000",
    buySell: "SELL", openCloseIndicator: "", exchange: "IDEALFX",
  });
  const statement = makeStatement([
    fund,
    stockBuy("buy", ISIN_AAPL, "AAPL", "2024-02-01", "10", "100"), // $1000
    stockSell("sell", ISIN_AAPL, "AAPL", "2024-06-20", "10", "80"), // $800 → $200 USD loss
  ]);
  const report = generateTaxReport(statement, rates, 2024);

  it("emits NO FX disposal and books exactly 0 in casillas 1633/1637", () => {
    expect(report.fxGains.disposals).toHaveLength(0);
    expect(report.fxGains.transmissionValue.toFixed(2)).toBe("0.00"); // 1633
    expect(report.fxGains.acquisitionValue.toFixed(2)).toBe("0.00"); // 1637
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("0.00");
  });

  it("the loss lands entirely in the stock line, not the divisa line (V2422-20)", () => {
    // Stock loss at the sale-date rate: (800 − 1000) USD × 0.80 = −€160.
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("-160.00");
  });
});

// ---------------------------------------------------------------------------
// Same loss-sale, but the SURVIVING dollars ARE later converted. Only that real
// conversion reaches 1633/1637 (valued against the carried funding basis); the
// principal discarded in the loss contributes NOTHING — confirming the discard
// is clean and only real FCY→EUR transmissions are taxed.
// ---------------------------------------------------------------------------
describe("issue #230: only the real conversion of the surviving dollars hits 1633/1637", () => {
  const rates = makeRateMap({
    "2024-02-01": { USD: "1.20" }, // funding + buy
    "2024-06-20": { USD: "0.80" }, // loss sale
    "2024-09-10": { USD: "0.80" }, // conversion of the surviving $800
  });
  const fund = makeTrade({
    tradeID: "fund", symbol: "EUR.USD", description: "EUR.USD", isin: "",
    assetCategory: "CASH", currency: "USD", tradeDate: "2024-02-01",
    settlementDate: "2024-02-01", quantity: "1000", tradePrice: "1",
    tradeMoney: "1000", proceeds: "1000", cost: "1000",
    buySell: "SELL", openCloseIndicator: "", exchange: "IDEALFX",
  });
  const statement = makeStatement([
    fund,
    stockBuy("buy", ISIN_AAPL, "AAPL", "2024-02-01", "10", "100"), // $1000
    stockSell("sell", ISIN_AAPL, "AAPL", "2024-06-20", "10", "80"), // $800 back
    convUsd("conv", "2024-09-10", "800"), // convert the surviving $800 @0.80
  ]);
  const report = generateTaxReport(statement, rates, 2024);

  it("converts ONLY the surviving $800 at the carried 1.20 basis (the lost $200 is gone, never taxed)", () => {
    // The 800 surviving dollars carry the 1.20 funding basis (re-added at carried
    // basis by the sell): 800 × (0.80 − 1.20) = −€320. The $200 of principal lost
    // inside the falling stock is discarded — it generates NO divisa entry.
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    const total = convs.reduce((s, d) => s.plus(d.gainLossEur), new Decimal(0));
    expect(total.toFixed(2)).toBe("-320.00");
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("-320.00");
    // Only 800 USD ever transmitted to EUR — never the full 1000.
    const qty = convs.reduce((s, d) => s.plus(d.quantity), new Decimal(0));
    expect(qty.toFixed(0)).toBe("800");
  });
});

// ===========================================================================
// FIFO CONSUMPTION ORDER — re-added principal keeps its ORIGINAL acquisition
// date, so a later conversion consumes the genuinely-oldest dollars first.
// ---------------------------------------------------------------------------
// Issue #230 follow-up (elmasvital, comment 4729376344). The spendable pool is
// consumed oldest-first by array position; a foreign-stock SELL re-adds its
// principal to that pool. If the re-add were stamped with the SALE date (the
// pre-fix behavior), a funding lot acquired BETWEEN the buy and the sale would
// sit AHEAD of the re-added (genuinely-older) principal, and a partial
// conversion would consume that NEWER funding first — mis-rating the conversion
// and shifting an FX gain into the WRONG TAX YEAR. The fix carries each parked
// slice's ORIGINAL acquireDate through the round-trip and re-adds the principal
// at that date (DGT V0282-22: the returned principal keeps its original
// acquisition; only the trading PROFIT is newly-acquired at the sale rate).
//
// THE DISCRIMINATING SHAPE (all rates "EUR per 1 USD"):
//   2023-01-01  fund $1000 @0.80   (lot A — the genuinely-OLDEST dollars)
//   2023-02-01  buy 10 AAPL @$100  (parks lot A's $1000 principal @0.80)
//   2023-03-01  fund $1000 @1.10   (lot B — funded AFTER the buy, NEWER)
//   2023-06-01  sell 10 AAPL @$100 (USD-flat; re-adds the $1000 principal —
//                                   carried basis 0.80, ORIGINAL date 2023-01-01)
//   2023-09-01  convert $1000 @1.20  → tax year 2023 (PARTIAL — one lot's worth)
//   2024-03-01  convert $1000 @1.30  → tax year 2024 (the rest)
//
// Correct origin-FIFO: 2023 consumes the @0.80 principal first (oldest) →
//   gain = 1000×(1.20−0.80) = €400; 2024 consumes lot B @1.10 →
//   gain = 1000×(1.30−1.10) = €200. Lifetime = €600.
// The pre-fix sale-date stamp gave €100 / €500 (lot B consumed first in 2023) —
// same €600 lifetime but €300 in the WRONG year. This test pins the correct split.
describe("issue #230: re-added principal keeps its original acquisition date (FIFO order across years)", () => {
  const rates = makeRateMap({
    "2023-01-01": { USD: "0.80" },
    "2023-02-01": { USD: "0.80" },
    "2023-03-01": { USD: "1.10" },
    "2023-06-01": { USD: "1.00" },
    "2023-09-01": { USD: "1.20" },
    "2024-03-01": { USD: "1.30" },
  });
  const trades = [
    fundUsd("fA", "2023-01-01", "1000"), // lot A @0.80 — oldest
    stockBuy("buy", ISIN_AAPL, "AAPL", "2023-02-01", "10", "100"), // parks lot A @0.80
    fundUsd("fB", "2023-03-01", "1000"), // lot B @1.10 — newer funding
    stockSell("sell", ISIN_AAPL, "AAPL", "2023-06-01", "10", "100"), // re-adds $1000 @0.80, ORIGINAL date 2023-01-01
    convUsd("c23", "2023-09-01", "1000"), // partial conversion in 2023
    convUsd("c24", "2024-03-01", "1000"), // remainder in 2024
  ];
  const statement = makeStatement(trades);

  it("2023 consumes the genuinely-oldest (@0.80) dollars first → €400, not €100", () => {
    const report = generateTaxReport(statement, rates, 2023);
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    const gain = convs.reduce((s, d) => s.plus(d.gainLossEur), new Decimal(0));
    // Origin-FIFO consumes the re-added principal (carried 0.80, original date
    // 2023-01-01) before the 2023-03 funding @1.10. €100 here = the wrong-year bug.
    expect(gain.toFixed(2)).toBe("400.00");
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("400.00");
    // The consumed lot is dated at its ORIGINAL acquisition (2023-01-01), NOT the
    // 2023-06-01 sale; cost basis is the carried €800 (1000 × 0.80), not €1100.
    expect(convs[0]!.acquireDate).toBe("2023-01-01");
    expect(convs[0]!.costBasisEur.toFixed(2)).toBe("800.00");
  });

  it("2024 consumes the newer (@1.10) funding → €200, not €500", () => {
    const report = generateTaxReport(statement, rates, 2024);
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    const gain = convs.reduce((s, d) => s.plus(d.gainLossEur), new Decimal(0));
    expect(gain.toFixed(2)).toBe("200.00");
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("200.00");
    // 2024 now consumes lot B, dated 2023-03-01 @1.10 → cost €1100.
    expect(convs[0]!.acquireDate).toBe("2023-03-01");
    expect(convs[0]!.costBasisEur.toFixed(2)).toBe("1100.00");
  });

  it("lifetime FX gain is €600 regardless of split (conservation check)", () => {
    const g23 = generateTaxReport(statement, rates, 2023).fxGains.netGainLoss;
    const g24 = generateTaxReport(statement, rates, 2024).fxGains.netGainLoss;
    expect(g23.plus(g24).toFixed(2)).toBe("600.00");
  });
});

// ---------------------------------------------------------------------------
// TAIL-APPEND branch of the sorted splice: a re-add NEWER than a surviving
// older lot must append AFTER it, so the older lot converts first. The PROFIT
// slice is exactly such a re-add — it is always dated at the SALE (the newest
// date) and re-added at the sale rate (DGT V0282-22: profit dollars are newly
// acquired). A wrong "always prepend" splice would consume the profit before
// the older principal and mis-rate the conversion.
// ---------------------------------------------------------------------------
describe("issue #230: profit slice (sale-dated) appends after older principal — older converts first", () => {
  const rates = makeRateMap({
    "2023-01-01": { USD: "0.80" }, // funding (oldest dollars)
    "2023-02-01": { USD: "0.80" }, // buy 5 AAPL @ $100 (parks $500 @0.80, dated 2023-01-01)
    "2023-06-01": { USD: "1.00" }, // sell 5 @ $200 → $500 principal + $500 profit (profit @1.00)
    "2023-09-01": { USD: "1.20" }, // convert the $1000 of @0.80 dollars
    "2024-03-01": { USD: "1.30" }, // convert the $500 profit (@1.00)
  });
  const trades = [
    fundUsd("f", "2023-01-01", "1000"), // $1000 @0.80
    stockBuy("buy", ISIN_AAPL, "AAPL", "2023-02-01", "5", "100"), // spends $500 @0.80, leaves $500 in pool
    stockSell("sell", ISIN_AAPL, "AAPL", "2023-06-01", "5", "200"), // $1000: $500 principal @0.80 + $500 profit @1.00
    convUsd("c23", "2023-09-01", "1000"), // consume the two @0.80 lots
    convUsd("c24", "2024-03-01", "500"), // consume the profit lot
  ];
  const statement = makeStatement(trades);

  it("2023 consumes the @0.80 dollars (survivor + re-added principal), not the newer profit → €400", () => {
    const report = generateTaxReport(statement, rates, 2023);
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    const gain = convs.reduce((s, d) => s.plus(d.gainLossEur), new Decimal(0));
    // €300 would mean the sale-dated profit was wrongly consumed first.
    expect(gain.toFixed(2)).toBe("400.00");
    // Every consumed lot here is an @0.80 dollar dated at the original 2023-01-01.
    for (const c of convs) expect(c.acquireDate).toBe("2023-01-01");
  });

  it("2024 consumes the profit lot LAST, dated at the sale (2023-06-01) @1.00 → €150", () => {
    const report = generateTaxReport(statement, rates, 2024);
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    const gain = convs.reduce((s, d) => s.plus(d.gainLossEur), new Decimal(0));
    expect(gain.toFixed(2)).toBe("150.00");
    expect(convs[0]!.acquireDate).toBe("2023-06-01"); // the profit, appended at the tail
    expect(convs[0]!.costBasisEur.toFixed(2)).toBe("500.00"); // 500 × 1.00
  });
});

// ---------------------------------------------------------------------------
// CROSS-POSITION ordering (the fix's core purpose): two same-currency positions
// re-add principal carrying DIFFERENT original dates into the SHARED per-currency
// pool. They are SOLD in the OPPOSITE order to their funding, so only carrying
// the original acquisition date keeps the shared pool FIFO-correct across
// positions. The conversion must consume the genuinely-oldest dollars first,
// regardless of which position was sold first.
// ---------------------------------------------------------------------------
describe("issue #230: two same-currency positions re-add with different original dates → shared pool in genuine-age order", () => {
  const rates = makeRateMap({
    "2023-01-01": { USD: "0.70" }, // fund lot for AAPL (the genuinely-OLDEST dollars)
    "2023-02-01": { USD: "0.90" }, // fund lot for MSFT (newer)
    "2023-03-01": { USD: "0.80" }, // buy AAPL (consumes the @0.70 lot, parks @0.70 dated 2023-01-01)
    "2023-04-01": { USD: "0.85" }, // buy MSFT (consumes the @0.90 lot, parks @0.90 dated 2023-02-01)
    "2023-05-01": { USD: "0.95" }, // sell MSFT FIRST (re-adds @0.90, original date 2023-02-01)
    "2023-06-01": { USD: "1.00" }, // sell AAPL SECOND (re-adds @0.70, original date 2023-01-01)
    "2023-09-01": { USD: "1.20" }, // convert $1000 → must hit the @0.70 (AAPL) dollars first
    "2024-03-01": { USD: "1.30" }, // convert $1000 → then the @0.90 (MSFT) dollars
  });
  const trades = [
    fundUsd("fA", "2023-01-01", "1000"), // @0.70 — oldest
    fundUsd("fB", "2023-02-01", "1000"), // @0.90 — newer
    stockBuy("buyA", ISIN_AAPL, "AAPL", "2023-03-01", "10", "100"), // consumes @0.70 → parks AAPL @0.70 (2023-01-01)
    stockBuy("buyM", ISIN_MSFT, "MSFT", "2023-04-01", "10", "100"), // consumes @0.90 → parks MSFT @0.90 (2023-02-01)
    stockSell("sellM", ISIN_MSFT, "MSFT", "2023-05-01", "10", "100"), // sold FIRST; re-adds @0.90 dated 2023-02-01
    stockSell("sellA", ISIN_AAPL, "AAPL", "2023-06-01", "10", "100"), // sold SECOND; re-adds @0.70 dated 2023-01-01
    convUsd("c23", "2023-09-01", "1000"),
    convUsd("c24", "2024-03-01", "1000"),
  ];
  const statement = makeStatement(trades);

  it("2023 consumes AAPL's @0.70 dollars first (oldest original date, though sold LAST) → €500", () => {
    const report = generateTaxReport(statement, rates, 2023);
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    const gain = convs.reduce((s, d) => s.plus(d.gainLossEur), new Decimal(0));
    // €300 would mean MSFT's @0.90 (sold first, re-added first) was consumed first — the bug.
    expect(gain.toFixed(2)).toBe("500.00");
    expect(convs[0]!.acquireDate).toBe("2023-01-01"); // AAPL's original funding, not the 2023-06-01 sale
    expect(convs[0]!.costBasisEur.toFixed(2)).toBe("700.00"); // 1000 × 0.70
  });

  it("2024 then consumes MSFT's @0.90 dollars → €400 (lifetime €900 conserved)", () => {
    const report = generateTaxReport(statement, rates, 2024);
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    const gain = convs.reduce((s, d) => s.plus(d.gainLossEur), new Decimal(0));
    expect(gain.toFixed(2)).toBe("400.00");
    expect(convs[0]!.acquireDate).toBe("2023-02-01"); // MSFT's original funding
    expect(convs[0]!.costBasisEur.toFixed(2)).toBe("900.00"); // 1000 × 0.90
    const g23 = generateTaxReport(statement, rates, 2023).fxGains.netGainLoss;
    expect(g23.plus(gain).toFixed(2)).toBe("900.00");
  });
});
