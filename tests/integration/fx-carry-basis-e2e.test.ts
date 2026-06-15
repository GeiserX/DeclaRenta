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
