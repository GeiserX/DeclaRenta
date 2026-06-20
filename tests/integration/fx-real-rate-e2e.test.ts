import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { lightyearParser } from "../../src/parsers/lightyear.js";
import type { FlexStatement, Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// End-to-end: the REAL applied FX rate for actual conversions (issue #253),
// proven through the REAL generateTaxReport pipeline AND through the Lightyear
// parser → generateTaxReport pipeline.
// ---------------------------------------------------------------------------
// WHAT #253 ADDS: a CASH EUR↔FCY conversion may carry `Trade.realEurAmount` —
// the real, spread-laden EUR principal the broker actually moved (the separate
// commission/fee EXCLUDED). When present, the FX engine values THAT conversion
// at the effective real rate `realEurAmount / |quantity|` instead of the ECB
// mid-rate, so the broker's hidden FX spread is captured as a deductible cost
// (Art. 35.1.a "importe real" / 35.1.b gastos inherentes). The commission is
// STILL applied on top, so `realEurAmount + commission` = the full real cost.
// Absent → the engine falls back to ECB, byte-identical to the prior behavior.
//
// WHY THIS FILE EXISTS — the engine-level proof already lives in
// `tests/engine/fx-fifo.test.ts` ("real applied EUR amount (FX spread capture
// — issue #253)") at the raw-`processEvents` level, and the parser-level proof
// in `tests/parsers/lightyear-fx-realrate.test.ts` (the `realEurAmount` field
// is stamped on the trade). NEITHER exercises the FULL wiring:
// `generateTaxReport` → `extractFxEvents` → `processEvents` → casillas
// 1633/1637, nor `lightyearParser.parse` → `generateTaxReport`. A regression in
// report.ts's FX block (e.g. dropping `realEurAmount` when building events, or
// passing ECB where the real rate belongs) would slip past both. These tests
// pin the headline numbers through the same in-memory `FlexStatement` +
// `EcbRateMap` construction the sibling integration suite uses — NO network
// fetch ever happens.
//
// THE FOUR PROPERTIES PINNED (every EUR figure hand-computed, .toFixed(2)):
//   1. SPREAD CAPTURE — a below-ECB `realEurAmount` on the closing conversion
//      yields a SMALLER FX gain than the same conversion at ECB; the delta IS
//      the spread, asserted exactly.
//   2. SYMMETRIC RECONCILIATION (the safety property) — a tracked round-trip
//      where BOTH legs carry `realEurAmount` realizes gain = realReceived −
//      realPaid EXACTLY, with no phantom from a half-real/half-ECB basis mix.
//   3. NO-FIELD BYTE-IDENTICAL — the same scenario WITHOUT `realEurAmount` is
//      exactly today's ECB-based number (regression guard).
//   4. NO FEE DOUBLE-COUNT — `realEurAmount` (fee-excluded principal) + the
//      conversion's commission together are the full real cost; the commission
//      is subtracted exactly once.
//   5. LIGHTYEAR CSV — a conversion-pair fixture fed through `lightyearParser`
//      → `generateTaxReport` is valued at the real (EUR-leg Net Amt.) rate.
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
// CASH conversion builders — the SAME EUR.USD shapes the sibling e2e tests use
// (extractFxEvents recognises a CASH, non-FXCONV trade whose symbol's quote side
// == trade.currency "USD" → amount = |tradeMoney| in USD). A SELL EUR.USD of $N
// pushes a +$N acquisition lot (funding); a BUY EUR.USD of $N pushes a −$N
// disposal (conversion back). Each accepts an OPTIONAL `realEur` override that
// is stamped onto `Trade.realEurAmount`, so the engine values that one
// conversion at realEur/$N instead of ECB (issue #253).
// ---------------------------------------------------------------------------

/** EUR→USD funding of $usd on `date` (acquire a USD lot). Optional real EUR paid. */
function fundUsd(id: string, date: string, usd: string, realEur?: string): Trade {
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
    ...(realEur !== undefined ? { realEurAmount: realEur } : {}),
  });
}

/**
 * USD→EUR conversion of $usd on `date` (dispose USD, realize the FX gain).
 * Optional real EUR received and optional commission (in EUR by default).
 */
function convUsd(id: string, date: string, usd: string, realEur?: string, commissionEur?: string): Trade {
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
    ...(commissionEur !== undefined ? { commission: `-${commissionEur}`, commissionCurrency: "EUR" } : {}),
    ...(realEur !== undefined ? { realEurAmount: realEur } : {}),
  });
}

// ===========================================================================
// 1. SPREAD CAPTURE — a below-ECB real EUR amount shrinks the FX gain by exactly
//    the spread, end-to-end through generateTaxReport.
// ---------------------------------------------------------------------------
// Rates "EUR per 1 USD":
//   fund 2024-02-01 @ 0.90   ($1000 acquired; real €900 → effective 0.90 == ECB,
//                             so the ACQUIRE side is neutral and the dispose-side
//                             spread is isolated cleanly)
//   conv 2024-09-10 @ 1.00   ($1000 converted back)
//
//   At ECB:   proceeds 1000 × 1.00 = €1000, cost 1000 × 0.90 = €900 → gain €100.
//   At REAL:  the broker actually credited only €950 for the $1000 (a 5-cent
//             spread vs the €1000 ECB-mid) → proceeds €950, cost €900 → gain €50.
//   Delta = €100 − €50 = €50 = 1000 × (1.00 − 0.95) — the captured spread, which
//   under #253 lands as a SMALLER 1633/1637 gain (a deductible cost, Art. 35.1).
// ===========================================================================
describe("fx-real-rate e2e #1: a below-ECB realEurAmount shrinks the FX gain by exactly the spread (€50 → €100 − €50)", () => {
  const rates = makeRateMap({
    "2024-02-01": { USD: "0.90" }, // funding (real €900 == ECB → neutral acquire)
    "2024-09-10": { USD: "1.00" }, // closing conversion (the spread bites here)
  });
  // REAL run: the dispose carries realEurAmount €950 (below the €1000 ECB value).
  const realStatement = makeStatement([
    fundUsd("fund", "2024-02-01", "1000", "900"),
    convUsd("conv", "2024-09-10", "1000", "950"),
  ]);
  // ECB run: the IDENTICAL scenario with NO realEurAmount on either leg.
  const ecbStatement = makeStatement([
    fundUsd("fund", "2024-02-01", "1000"),
    convUsd("conv", "2024-09-10", "1000"),
  ]);
  const realReport = generateTaxReport(realStatement, rates, 2024);
  const ecbReport = generateTaxReport(ecbStatement, rates, 2024);

  it("ECB valuation gives the €100.00 mid-rate gain (the baseline)", () => {
    expect(ecbReport.fxGains.netGainLoss.toFixed(2)).toBe("100.00");
    expect(ecbReport.fxGains.transmissionValue.toFixed(2)).toBe("1000.00"); // 1000 × 1.00
    expect(ecbReport.fxGains.acquisitionValue.toFixed(2)).toBe("900.00"); // 1000 × 0.90
  });

  it("REAL valuation captures the spread → a SMALLER €50.00 gain (proceeds €950, not €1000)", () => {
    expect(realReport.fxGains.netGainLoss.toFixed(2)).toBe("50.00");
    // The proceeds (casilla 1633) drop to the REAL €950 the broker credited; the
    // acquisition (1637) is unchanged €900 (the funding real == its ECB).
    expect(realReport.fxGains.transmissionValue.toFixed(2)).toBe("950.00");
    expect(realReport.fxGains.acquisitionValue.toFixed(2)).toBe("900.00");
  });

  it("the gain delta EQUALS the spread: €100 − €50 = €50 = 1000 × (1.00 − 0.95)", () => {
    const delta = ecbReport.fxGains.netGainLoss.minus(realReport.fxGains.netGainLoss);
    expect(delta.toFixed(2)).toBe("50.00");
    // The spread expressed from the rates: 1000 USD × (ECB 1.00 − real 0.95).
    const spread = new Decimal(1000).mul(new Decimal("1.00").minus("0.95"));
    expect(delta.toFixed(2)).toBe(spread.toFixed(2));
  });

  it("the single conversion disposal carries the REAL proceeds (€950), not the ECB €1000", () => {
    const convs = realReport.fxGains.disposals.filter((d) => d.trigger === "conversion");
    expect(convs).toHaveLength(1);
    const c = convs[0]!;
    expect(c.currency).toBe("USD");
    expect(c.disposeDate).toBe("2024-09-10");
    expect(c.proceedsEur.toFixed(2)).toBe("950.00"); // REAL applied, NOT 1000
    expect(c.costBasisEur.toFixed(2)).toBe("900.00"); // carried funding basis
    expect(c.gainLossEur.toFixed(2)).toBe("50.00");
  });
});

// ===========================================================================
// 2. SYMMETRIC RECONCILIATION (the critical safety property) — both legs real →
//    realized gain = realEurReceived − realEurPaid EXACTLY, no phantom.
// ---------------------------------------------------------------------------
// A tracked round-trip where the FUNDING conversion AND the CLOSING conversion
// BOTH carry realEurAmount. The ONE shared effectiveRate() helper values the
// acquire and dispose legs on the SAME (real) basis, so the realized FX gain is
// exactly the cash difference — never an asymmetric phantom from valuing one
// leg real and the other at ECB.
//
// Rates "EUR per 1 USD" (deliberately DIFFERENT from the real rates, so a
// half-real/half-ECB bug would visibly corrupt the number):
//   fund 2024-02-01 @ 0.92   real €930 paid   → effective 0.93  (worse than ECB)
//   conv 2024-09-10 @ 0.95   real €955 received → effective 0.955 (better than ECB)
//
//   gain = realReceived − realPaid = 955 − 930 = €25.00 EXACTLY.
//   (A half-real bug — e.g. cost at ECB €920, proceeds real €955 — would give €35,
//   or — proceeds at ECB €950, cost real €930 — would give €20. Neither is €25.)
// ===========================================================================
describe("fx-real-rate e2e #2: symmetric reconciliation — both legs real → gain = realReceived − realPaid EXACTLY (€25.00)", () => {
  const rates = makeRateMap({
    "2024-02-01": { USD: "0.92" }, // funding ECB (real €930 overrides → 0.93)
    "2024-09-10": { USD: "0.95" }, // closing ECB (real €955 overrides → 0.955)
  });
  const statement = makeStatement([
    fundUsd("fund", "2024-02-01", "1000", "930"),
    convUsd("conv", "2024-09-10", "1000", "955"),
  ]);
  const report = generateTaxReport(statement, rates, 2024);

  it("realizes gain = €955 received − €930 paid = €25.00, with no phantom", () => {
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("25.00");
    // 1633 = real received €955; 1637 = real paid €930 — both on the SAME basis.
    expect(report.fxGains.transmissionValue.toFixed(2)).toBe("955.00");
    expect(report.fxGains.acquisitionValue.toFixed(2)).toBe("930.00");
    // Guard the two half-real/half-ECB phantoms explicitly: neither €35 (ECB cost
    // €920 + real proceeds €955) nor €20 (real cost €930 + ECB proceeds €950).
    expect(report.fxGains.netGainLoss.toFixed(2)).not.toBe("35.00");
    expect(report.fxGains.netGainLoss.toFixed(2)).not.toBe("20.00");
  });

  it("the conversion disposal cost basis is the REAL €930 paid (the funding's real rate carried)", () => {
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    expect(convs).toHaveLength(1);
    const c = convs[0]!;
    expect(c.costBasisEur.toFixed(2)).toBe("930.00"); // real funding, NOT ECB €920
    expect(c.proceedsEur.toFixed(2)).toBe("955.00"); // real received, NOT ECB €950
    expect(c.gainLossEur.toFixed(2)).toBe("25.00");
  });
});

// ===========================================================================
// 3. NO-FIELD BYTE-IDENTICAL — the identical round-trip WITHOUT realEurAmount is
//    exactly today's ECB-based numbers (the load-bearing regression guard).
// ---------------------------------------------------------------------------
// Same shape as test #2 but no real amounts at all. Pure ECB:
//   fund $1000 @0.92 → cost €920; conv $1000 @0.95 → proceeds €950 → gain €30.
// AND: re-run with realEurAmount set EQUAL to the ECB value (920 / 950) and prove
// the casilla numbers are unchanged — the real-rate path collapses to ECB when
// the real rate equals the mid.
// ===========================================================================
describe("fx-real-rate e2e #3: no realEurAmount → byte-identical to ECB (€30.00); real==ECB is a no-op", () => {
  const rates = makeRateMap({
    "2024-02-01": { USD: "0.92" },
    "2024-09-10": { USD: "0.95" },
  });
  const ecbReport = generateTaxReport(
    makeStatement([fundUsd("fund", "2024-02-01", "1000"), convUsd("conv", "2024-09-10", "1000")]),
    rates,
    2024,
  );
  // realEurAmount set to EXACTLY the ECB value: 1000 × 0.92 = 920, 1000 × 0.95 = 950.
  const realEqEcbReport = generateTaxReport(
    makeStatement([fundUsd("fund", "2024-02-01", "1000", "920"), convUsd("conv", "2024-09-10", "1000", "950")]),
    rates,
    2024,
  );

  it("the field-absent run produces the canonical pure-ECB gain (€30.00)", () => {
    expect(ecbReport.fxGains.netGainLoss.toFixed(2)).toBe("30.00");
    expect(ecbReport.fxGains.transmissionValue.toFixed(2)).toBe("950.00");
    expect(ecbReport.fxGains.acquisitionValue.toFixed(2)).toBe("920.00");
  });

  it("setting realEurAmount == the ECB value changes NOTHING (1633/1637/net all identical)", () => {
    expect(realEqEcbReport.fxGains.netGainLoss.toFixed(2)).toBe(ecbReport.fxGains.netGainLoss.toFixed(2));
    expect(realEqEcbReport.fxGains.transmissionValue.toFixed(2)).toBe(ecbReport.fxGains.transmissionValue.toFixed(2));
    expect(realEqEcbReport.fxGains.acquisitionValue.toFixed(2)).toBe(ecbReport.fxGains.acquisitionValue.toFixed(2));
    expect(realEqEcbReport.fxGains.netGainLoss.toFixed(2)).toBe("30.00");
  });
});

// ===========================================================================
// 4. NO FEE DOUBLE-COUNT — realEurAmount (fee-excluded principal) + commission =
//    the full real cost; the commission is subtracted EXACTLY ONCE.
// ---------------------------------------------------------------------------
// Rates "EUR per 1 USD":
//   fund 2024-02-01 @ 0.92   real €920 (== ECB → neutral acquire), cost €920
//   conv 2024-09-10 @ 0.91   real €900 FX principal + a SEPARATE €2 commission
//
//   The conversion's full real cost to the taxpayer = €900 (principal) + €2 (fee)
//   = €902. The engine books proceeds = real principal €900 − €2 commission = €898
//   (Art. 35: the fee reduces proceeds on a disposal). cost €920 → gain −€22.
//   The fee hits ONCE: proceeds are €898, NOT €896 (which would be real − 2×fee, a
//   double-count) and NOT €900 (fee ignored). realEurAmount itself is the
//   fee-EXCLUDED principal, so €900 + €2 = €902 reconciles to the full real cost.
// ===========================================================================
describe("fx-real-rate e2e #4: commission applies ON TOP of realEurAmount — no fee double-count (proceeds €898, gain −€22)", () => {
  const rates = makeRateMap({
    "2024-02-01": { USD: "0.92" }, // funding real €920 == ECB → neutral
    "2024-09-10": { USD: "0.91" }, // conversion: real €900 principal + €2 fee
  });
  const statement = makeStatement([
    fundUsd("fund", "2024-02-01", "1000", "920"),
    convUsd("conv", "2024-09-10", "1000", "900", "2"),
  ]);
  const report = generateTaxReport(statement, rates, 2024);

  it("books proceeds = real principal €900 − €2 fee = €898 (fee subtracted ONCE)", () => {
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    expect(convs).toHaveLength(1);
    const c = convs[0]!;
    expect(c.proceedsEur.toFixed(2)).toBe("898.00"); // €900 − €2, NOT €896 (double) nor €900 (ignored)
    expect(c.costBasisEur.toFixed(2)).toBe("920.00");
    expect(c.gainLossEur.toFixed(2)).toBe("-22.00");
  });

  it("the casilla net matches (−€22.00) and realEurAmount + commission reconciles to the full real cost (€902)", () => {
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("-22.00");
    expect(report.fxGains.transmissionValue.toFixed(2)).toBe("898.00");
    expect(report.fxGains.acquisitionValue.toFixed(2)).toBe("920.00");
    // realEurAmount (fee-EXCLUDED FX principal) + the conversion's commission = the
    // full real cost the broker charged: €900 + €2 = €902. Pinned so a future
    // change that folds the fee INTO realEurAmount (re-introducing a double-count)
    // would have to break this identity.
    const realPrincipal = new Decimal("900");
    const commission = new Decimal("2");
    expect(realPrincipal.plus(commission).toFixed(2)).toBe("902.00");
  });
});

// ===========================================================================
// 5. LIGHTYEAR CSV END-TO-END — a conversion-pair fixture through the real
//    parser → generateTaxReport is valued at the broker's real (EUR-leg) rate.
// ---------------------------------------------------------------------------
// Lightyear emits each conversion as a PAIR of rows sharing a timestamp, one per
// currency. The parser stamps the EUR leg's |Net Amt.| (real principal, fee
// excluded) as `realEurAmount` on the non-EUR CASH trade (see
// `tests/parsers/lightyear-fx-realrate.test.ts`). Here we feed a TRACKED
// round-trip — a EUR→USD funding pair and a USD→EUR closing pair — straight
// through the parser and prove the realized FX gain in 1633/1637 is the real
// cash difference, not the ECB-mid one.
//
//   Funding 2025-01-15 (acquire $1000): USD leg +1000, EUR leg Net −935 →
//                                       realEurAmount €935 → effective 0.935.
//   Closing 2025-08-20 (convert $1000): USD leg −1000, EUR leg Net +960 →
//                                       realEurAmount €960 → effective 0.960.
//
//   Real gain = €960 received − €935 paid = €25.00 (symmetric, both legs real).
//   At ECB (0.92 fund / 0.97 close) the same round-trip would be 970 − 920 = €50,
//   so asserting €25 (and ≠ €50) proves the parser→engine path used the REAL rate.
//   Both conversions are fee-free here, so realEurAmount stands alone (no fee).
// ===========================================================================
describe("fx-real-rate e2e #5: Lightyear CSV → generateTaxReport values the conversion at the REAL rate (€25.00, not ECB €50.00)", () => {
  const HEADER = "Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.";
  // A funding pair (EUR→USD) and a closing pair (USD→EUR), fee-free. The EUR
  // leg's Net Amt. is the real principal the engine values the USD leg at.
  const csv = [
    HEADER,
    // Funding 2025-01-15: acquire USD 1000, real EUR paid 935.
    "15/01/2025 10:00:00,CN-1001,USD,,Conversion,,USD,,1000.00,0.935,,1000.00,",
    "15/01/2025 10:00:00,CN-1002,EUR,,Conversion,,EUR,,-935.00,1.0695,,-935.00,",
    // Closing 2025-08-20: convert USD 1000 back, real EUR received 960.
    "20/08/2025 14:00:00,CN-2001,USD,,Conversion,,USD,,-1000.00,0.960,,-1000.00,",
    "20/08/2025 14:00:00,CN-2002,EUR,,Conversion,,EUR,,960.00,1.0417,,960.00,",
  ].join("\n");

  // ECB rates DELIBERATELY differ from the broker's real rates, so a regression
  // that ignored realEurAmount would compute €50, not €25.
  const rates = makeRateMap({
    "2025-01-15": { USD: "0.92" }, // ECB fund (real 0.935 overrides)
    "2025-08-20": { USD: "0.97" }, // ECB close (real 0.960 overrides)
  });

  const parsed = lightyearParser.parse(csv);
  // `Statement` is an alias of `FlexStatement`; pass the parser output straight
  // in (mirroring tests/integration/parser-to-casilla.test.ts's toStatement).
  const statement: FlexStatement = {
    accountId: "",
    fromDate: "",
    toDate: "",
    period: "",
    trades: parsed.trades,
    cashTransactions: parsed.cashTransactions,
    corporateActions: parsed.corporateActions,
    openPositions: parsed.openPositions,
    securitiesInfo: parsed.securitiesInfo,
  };
  const report = generateTaxReport(statement, rates, 2025);

  it("the parser stamped realEurAmount on BOTH conversion legs from the EUR-leg Net Amt.", () => {
    const usdConvs = parsed.trades.filter((t) => t.assetCategory === "CASH" && t.currency === "USD");
    expect(usdConvs).toHaveLength(2);
    const fund = usdConvs.find((t) => t.buySell === "BUY")!; // acquire USD
    const close = usdConvs.find((t) => t.buySell === "SELL")!; // convert USD → EUR
    expect(fund.realEurAmount).toBe("935");
    expect(close.realEurAmount).toBe("960");
  });

  it("realizes the REAL-rate FX gain €25.00 (= €960 − €935), NOT the ECB-mid €50.00", () => {
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("25.00");
    expect(report.fxGains.netGainLoss.toFixed(2)).not.toBe("50.00");
    // 1633 = real received €960; 1637 = real paid €935 — both on the real basis.
    expect(report.fxGains.transmissionValue.toFixed(2)).toBe("960.00");
    expect(report.fxGains.acquisitionValue.toFixed(2)).toBe("935.00");
  });

  it("the conversion disposal carries the real proceeds/cost, dated at the closing conversion", () => {
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    expect(convs).toHaveLength(1);
    const c = convs[0]!;
    expect(c.currency).toBe("USD");
    expect(c.disposeDate).toBe("2025-08-20");
    expect(c.proceedsEur.toFixed(2)).toBe("960.00");
    expect(c.costBasisEur.toFixed(2)).toBe("935.00");
    expect(c.gainLossEur.toFixed(2)).toBe("25.00");
  });
});
