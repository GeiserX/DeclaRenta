import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { serializeFxTrace } from "../../src/generators/fx-trace.js";
import type { FlexStatement, Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { FxTraceEvent, FxTraceKind } from "../../src/types/tax.js";

// ===========================================================================
// End-to-end: the OPT-IN FX-FIFO MOVEMENT TRACE (`TaxSummary.fxTrace`), proven
// through the REAL generateTaxReport pipeline (issue #230 follow-up).
// ---------------------------------------------------------------------------
// `generateTaxReport(statement, rateMap, year, { fxTrace: true })` captures the
// full all-year FX-FIFO movement ledger — every acquire / park / unpark /
// discard / profit / dispose with the running pool & parked balances — onto
// `TaxSummary.fxTrace` (an `FxTraceEvent[]`). It is a pure AUDIT artifact: an
// opt-in that NEVER changes a single computed casilla and is `undefined` when
// not requested (zero-cost) and when the FX engine doesn't run at all
// (monodivisa / `skipFx`). `serializeFxTrace` (generators/fx-trace.ts) turns it
// into JSONL/CSV for a downloadable diagnostic.
//
// THE HEADLINE PROPERTY THESE TESTS PIN — the trace is a GOLDEN LEDGER that
// RECONCILES to the casilla: the realized FX gain in casillas 1633/1637
// (`report.fxGains.netGainLoss`) equals the SUM of `gainLossEur` over the
// trace's `dispose` events. The trace EXPLAINS the headline number, movement by
// movement, and a loss-sell whose dollars never reached a EUR conversion shows a
// `discard` (NOT a `dispose`) — making the "no FX on un-converted dollars"
// invariant (issue #230) visible in the audit trail while 1633/1637 stay 0.
//
// Helpers (makeRateMap / makeTrade / makeStatement / fundUsd / convUsd /
// stockBuy / stockSell + the EUR.USD SELL=fund / BUY=convert trade shapes and
// ISIN_AAPL) are copied VERBATIM from the sibling integration test
// `fx-carry-basis-e2e.test.ts`, so the exact same in-memory FlexStatement +
// EcbRateMap construction is exercised. NO network fetch ever happens.
//
// Every EUR figure and every trace kind/ordering below was VERIFIED against the
// real engine output (not guessed); each expected value is pinned with
// .toFixed(2). The engine emits the trace in (date, phase) order — pool
// acquisitions → stock-buys/park → stock-sells/unpark+profit → disposals/conv —
// see FxFifoEngine.phaseOf in src/engine/fx-fifo.ts.
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

const ISIN_AAPL = "US0378331005";

/** Sum `gainLossEur` over the trace's `dispose` events (the realized-FX legs). */
function sumDisposeGainLoss(trace: FxTraceEvent[]): Decimal {
  return trace
    .filter((e) => e.kind === "dispose")
    .reduce((s, e) => s.plus(e.gainLossEur ?? "0"), new Decimal(0));
}

// ===========================================================================
// 1. OPT-OUT IS ZERO-COST AND NON-MUTATING.
// ---------------------------------------------------------------------------
// The same FX scenario run WITHOUT `fxTrace` → `report.fxTrace` is `undefined`
// (the engine's record() is a no-op, the field is never attached). Run WITH
// `{ fxTrace: true }` → a non-empty `FxTraceEvent[]`. The load-bearing safety
// property: capturing the trace must NOT change ANY computed number — both the
// FX casilla (1633/1637 → `fxGains.netGainLoss`) and the stock casilla
// (`capitalGains.netGainLoss`) are byte-identical between the two runs. The
// trace is a pure observer.
// ===========================================================================
describe("fx-trace e2e #1: opt-out is zero-cost — fxTrace toggles presence, never changes a casilla", () => {
  const rates = makeRateMap({
    "2024-02-01": { USD: "0.90" }, // funding
    "2024-03-15": { USD: "0.95" }, // buy date
    "2024-06-20": { USD: "1.05" }, // sell
    "2024-09-10": { USD: "1.05" }, // conversion
  });
  // A real carry-basis round-trip (the same B1 shape used in test #2) so there
  // is genuine FX activity to trace, not an empty ledger.
  const trades = [
    fundUsd("fund", "2024-02-01", "1200"),
    stockBuy("buy", ISIN_AAPL, "AAPL", "2024-03-15", "10", "100"), // $1000
    stockSell("sell", ISIN_AAPL, "AAPL", "2024-06-20", "10", "120"), // $1200
    convUsd("conv", "2024-09-10", "1400"),
  ];
  // Two independent statements (don't share trade objects across runs).
  const reportOff = generateTaxReport(makeStatement(trades), rates, 2024);
  const reportOn = generateTaxReport(makeStatement(trades), rates, 2024, { fxTrace: true });

  it("omits fxTrace entirely when the option is absent (undefined, zero-cost)", () => {
    expect(reportOff.fxTrace).toBeUndefined();
  });

  it("populates fxTrace as a non-empty FxTraceEvent[] when opted in", () => {
    expect(Array.isArray(reportOn.fxTrace)).toBe(true);
    expect(reportOn.fxTrace!.length).toBeGreaterThan(0);
  });

  it("computes IDENTICAL FX and stock casillas with and without the trace (pure observer)", () => {
    // The trace must never shift a number — the headline guarantee of an opt-in
    // audit artifact. Compare the FX line (1633/1637) AND the stock line.
    expect(reportOn.fxGains.netGainLoss.toFixed(2)).toBe(reportOff.fxGains.netGainLoss.toFixed(2));
    expect(reportOn.capitalGains.netGainLoss.toFixed(2)).toBe(reportOff.capitalGains.netGainLoss.toFixed(2));
    // Pin the actual figures too (so a regression in EITHER run is caught, not
    // just a divergence): FX +180, stock +210 (the canonical B1 — see test #2).
    expect(reportOff.fxGains.netGainLoss.toFixed(2)).toBe("180.00");
    expect(reportOn.fxGains.netGainLoss.toFixed(2)).toBe("180.00");
    expect(reportOff.capitalGains.netGainLoss.toFixed(2)).toBe("210.00");
    expect(reportOn.capitalGains.netGainLoss.toFixed(2)).toBe("210.00");
  });
});

// ===========================================================================
// 2. THE GOLDEN LEDGER — a full round-trip trace RECONCILES to the casilla.
// ---------------------------------------------------------------------------
// The canonical "B1" round-trip, all rates "EUR per 1 USD":
//   fund 2024-02-01 @ 0.90   ($1200 tracked USD acquired)
//   buy  2024-03-15           AAPL $1000 (10 × $100) ← parks $1000 @0.90 carried
//   sell 2024-06-20 @ 1.05    AAPL $1200 (10 × $120) ← unpark $1000 @0.90 + profit $200 @1.05
//   conv 2024-09-10 @ 1.05    USD→EUR $1400 (= $1000 principal + $200 profit + $200 leftover funding)
//
//   Stock gain  : (1200 − 1000) USD × 1.05 = €210.00  (sale-date rate, V2422-20)
//   FX (divisa) : the conversion of $1400 @1.05 realizes the carried drift:
//        $200 profit lot     @1.05: cost €180 (200×0.90), proc €210 → gain €30
//        $1000 principal lot @0.90 carried: cost €900, proc €1050 → gain €150
//        $200 leftover fund  @1.05 (the $1200 funded − $1000 bought, never parked):
//                                   cost €210, proc €210 → gain €0
//        Σ FX gain = 30 + 150 + 0 = €180.00  → casillas 1633/1637
//   Total economic = stock 210 + FX 180 = €390 (the canonical B1 total).
//
// The TRACE emits these movements in engine order (verified against the real
// engine): acquire (funding) → park (buy) → unpark + profit (sell) → dispose×3
// (the conversion consuming the three pool lots). This test pins:
//   (a) the kinds appear in the documented order — acquire, park, unpark,
//       profit, then ALL the dispose events (the conversion legs) last;
//   (b) the SUM of `gainLossEur` over the dispose events === fxGains.netGainLoss
//       === "180.00" — the trace's realized gains reconcile to the casilla;
//   (c) the running balances tell the story (pool peaks at $1400 after profit,
//       drains to $0 after the conversion; parked returns to $0 after the sell).
// ===========================================================================
describe("fx-trace e2e #2: golden ledger — round-trip trace reconciles to the FX casilla (Σ dispose = €180.00)", () => {
  const rates = makeRateMap({
    "2024-02-01": { USD: "0.90" }, // funding ($1200 tracked)
    "2024-03-15": { USD: "0.95" }, // buy date (irrelevant to carried basis)
    "2024-06-20": { USD: "1.05" }, // sell (stock gain + profit re-add rate)
    "2024-09-10": { USD: "1.05" }, // conversion (realizes the deferred FX gain)
  });
  const statement = makeStatement([
    fundUsd("fund", "2024-02-01", "1200"),
    stockBuy("buy", ISIN_AAPL, "AAPL", "2024-03-15", "10", "100"), // $1000
    stockSell("sell", ISIN_AAPL, "AAPL", "2024-06-20", "10", "120"), // $1200
    convUsd("conv", "2024-09-10", "1400"), // $1000 principal + $200 profit + $200 leftover funding
  ]);
  const report = generateTaxReport(statement, rates, 2024, { fxTrace: true });
  const trace = report.fxTrace!;

  it("pins the headline B1 split: FX +€180.00, stock +€210.00", () => {
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("180.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("210.00");
  });

  it("emits the movement kinds in the documented lifecycle order (acquire→park→unpark→profit→dispose…)", () => {
    const kinds = trace.map((e) => e.kind);
    // The funding acquire is first; the buy parks; the sell unparks the carried
    // principal then tops up profit; the conversion's disposes come last.
    expect(kinds[0]).toBe("acquire");
    expect(kinds[1]).toBe("park");
    expect(kinds[2]).toBe("unpark");
    expect(kinds[3]).toBe("profit");
    // The remaining movements are ALL `dispose` (the conversion legs) — nothing
    // else follows the profit re-add.
    const tail = kinds.slice(4);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every((k) => k === "dispose")).toBe(true);
    // The relative order acquire < park < unpark < profit < dispose is the
    // phaseOf() contract — assert each kind appears and is ordered.
    const expectedPrefix: FxTraceKind[] = ["acquire", "park", "unpark", "profit", "dispose"];
    expect(kinds.slice(0, 5)).toEqual(expectedPrefix);
  });

  it("RECONCILES: Σ gainLossEur over the dispose events === report.fxGains.netGainLoss === €180.00", () => {
    // The golden-ledger property — the trace explains the 180. The conversion's
    // realized FX (sum of the dispose legs) IS the casilla figure.
    const disposes = trace.filter((e) => e.kind === "dispose");
    expect(disposes.length).toBeGreaterThan(0);
    const sumDispose = sumDisposeGainLoss(trace);
    expect(sumDispose.toFixed(2)).toBe("180.00");
    expect(sumDispose.toFixed(2)).toBe(report.fxGains.netGainLoss.toFixed(2));
    // Every dispose carries the conversion trigger and the conversion date.
    for (const d of disposes) {
      expect(d.trigger).toBe("conversion");
      expect(d.date).toBe("2024-09-10");
      expect(d.currency).toBe("USD");
    }
    // The carried-principal leg ($1000 @0.90 → €150 gain) is present — proof the
    // buy parked the basis and the sell carried it through to the conversion.
    const principalLeg = disposes.find((d) => d.gainLossEur === "150");
    expect(principalLeg).toBeDefined();
    expect(principalLeg!.costBasisEur).toBe("900"); // 1000 × 0.90 carried
    expect(principalLeg!.proceedsEur).toBe("1050"); // 1000 × 1.05
  });

  it("the running pool/parked balances narrate the lifecycle (park→1000, pool peaks 1400, drains to 0)", () => {
    const byKind = (k: FxTraceKind) => trace.filter((e) => e.kind === k);
    // After the funding acquire: pool holds the full $1200.
    expect(byKind("acquire")[0]!.poolBalanceFcy).toBe("1200");
    // After the buy parks $1000: pool drops to $200, parked rises to $1000.
    const park = byKind("park")[0]!;
    expect(park.poolBalanceFcy).toBe("200");
    expect(park.parkedBalanceFcy).toBe("1000");
    expect(park.positionKey).toBe(ISIN_AAPL);
    // After the profit re-add the pool peaks at $1400 (1000 principal + 200
    // leftover funding + 200 profit) and the parked queue is empty again.
    const profit = byKind("profit")[0]!;
    expect(profit.poolBalanceFcy).toBe("1400");
    expect(profit.parkedBalanceFcy).toBe("0");
    // The LAST movement is the final dispose draining the pool to zero.
    expect(trace[trace.length - 1]!.kind).toBe("dispose");
    expect(trace[trace.length - 1]!.poolBalanceFcy).toBe("0");
  });
});

// ===========================================================================
// 3. LOSS-SELL WITH NO CONVERSION → `discard`, ZERO FX (issue #230's principle).
// ---------------------------------------------------------------------------
//   fund 2024-02-01 @ 1.20   ($1000 tracked, €1200 cost)
//   buy  2024-02-01           AAPL $1000 (10 × $100) ← parks $1000 @1.20 carried
//   sell 2024-06-20 @ 0.80    AAPL $800  (10 × $80)  ← a $200 USD LOSS; no conversion
//
// The whole position closes but NO dollars are converted to EUR. The carry-basis
// SELL re-adds only min(cost, proceeds) = $800 of principal to the pool (at the
// carried 1.20) and DISCARDS the $200 of principal that didn't come back — those
// dollars left the patrimony in the losing trade and never reached a EUR
// conversion ("como una hamburguesa en dólares", Art. 14.2.e LIRPF). Because
// nothing is converted, the engine emits NO `dispose`, so casillas 1633/1637 = 0
// and `fxGains.disposals` is empty. The trace makes the un-converted $200 VISIBLE
// as a `discard` event — the audit trail shows exactly what left the patrimony
// with no FX effect.
// ===========================================================================
describe("fx-trace e2e #3: loss-sell with NO conversion → trace shows a discard, casilla FX = 0 (issue #230)", () => {
  const rates = makeRateMap({
    "2024-02-01": { USD: "1.20" }, // funding + buy
    "2024-06-20": { USD: "0.80" }, // loss sale (rate fell)
  });
  const statement = makeStatement([
    fundUsd("fund", "2024-02-01", "1000"),
    stockBuy("buy", ISIN_AAPL, "AAPL", "2024-02-01", "10", "100"), // $1000
    stockSell("sell", ISIN_AAPL, "AAPL", "2024-06-20", "10", "80"), // $800 → $200 USD loss
  ]);
  const report = generateTaxReport(statement, rates, 2024, { fxTrace: true });
  const trace = report.fxTrace!;

  it("books exactly ZERO FX with no FX disposals (un-converted dollars → no divisa)", () => {
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("0.00");
    expect(report.fxGains.disposals).toHaveLength(0);
  });

  it("the trace contains a `discard` event and NO `dispose` event", () => {
    const discards = trace.filter((e) => e.kind === "discard");
    const disposes = trace.filter((e) => e.kind === "dispose");
    expect(discards.length).toBeGreaterThan(0);
    expect(disposes).toHaveLength(0);
    // The discarded slice is the $200 of principal that never returned, under the
    // sold position's key — the audit trail of what left the patrimony with no FX.
    const discard = discards[0]!;
    expect(discard.quantityFcy).toBe("200");
    expect(discard.currency).toBe("USD");
    expect(discard.trigger).toBe("stock_sale");
    expect(discard.positionKey).toBe(ISIN_AAPL);
  });

  it("the discard reconciles with a ZERO casilla (no dispose legs to sum)", () => {
    // The golden-ledger property under a loss: there are NO dispose events, so the
    // Σ-dispose reconciliation is 0.00 — exactly the casilla. The €-loss lives in
    // the stock line (−€160 = (800 − 1000) × 0.80), NOT the divisa line.
    expect(sumDisposeGainLoss(trace).toFixed(2)).toBe("0.00");
    expect(sumDisposeGainLoss(trace).toFixed(2)).toBe(report.fxGains.netGainLoss.toFixed(2));
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("-160.00");
  });
});

// ===========================================================================
// 4. MONODIVISA (skipFx) → NO TRACE.
// ---------------------------------------------------------------------------
// The exact same loss scenario as test #3 but with `{ skipFx: true }`: monodivisa
// mode disables the WHOLE FX FIFO engine (the `if (!options?.skipFx)` block in
// report.ts never runs), so the engine — and therefore the trace — never exists.
// Even with `fxTrace: true` ALSO set, `report.fxTrace` is gracefully `undefined`
// (the trace is captured only inside the FX block). The stock cost uses the
// ACQUISITION-date rate (traditional method, Art. 35.1), so the buy→sale FX
// drift on the principal is embedded in the stock loss.
// ===========================================================================
describe("fx-trace e2e #4: monodivisa (skipFx) → fxTrace is gracefully absent even if requested", () => {
  const rates = makeRateMap({
    "2024-02-01": { USD: "1.20" },
    "2024-06-20": { USD: "0.80" },
  });
  const statement = makeStatement([
    fundUsd("fund", "2024-02-01", "1000"),
    stockBuy("buy", ISIN_AAPL, "AAPL", "2024-02-01", "10", "100"),
    stockSell("sell", ISIN_AAPL, "AAPL", "2024-06-20", "10", "80"),
  ]);
  const report = generateTaxReport(statement, rates, 2024, { skipFx: true, fxTrace: true });

  it("leaves fxTrace undefined under skipFx (the FX engine never runs)", () => {
    expect(report.fxTrace).toBeUndefined();
  });

  it("zeroes the FX block; the stock loss embeds the buy→sale FX drift (−€560.00)", () => {
    // Traditional method (Art. 35.1): cost at the buy-date rate, proceeds at the
    // sale-date rate, FX drift embedded in the stock line (FX engine off).
    //   cost     = 1000 USD × 1.20 (buy)  = 1200.00 EUR
    //   proceeds =  800 USD × 0.80 (sale) =  640.00 EUR
    //   loss     = −560.00 EUR  (= USD stock loss −160 + USD-depreciation −400)
    expect(report.fxGains.disposals).toHaveLength(0);
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("0.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("-560.00");
  });
});

// ===========================================================================
// 5. SERIALIZE THE E2E TRACE (JSONL + CSV).
// ---------------------------------------------------------------------------
// Take the populated trace from the B1 round-trip and serialize it both ways:
//   - JSONL: one compact JSON object per line → line count === trace.length, and
//     each line round-trips to an object whose `seq` matches the source event.
//   - CSV: a header row + one row per event → line count === trace.length + 1.
// This proves the audit artifact a developer/advisor downloads is a faithful,
// lossless rendering of the in-memory ledger.
// ===========================================================================
describe("fx-trace e2e #5: serialize the e2e trace — JSONL round-trips, CSV adds a header row", () => {
  const rates = makeRateMap({
    "2024-02-01": { USD: "0.90" },
    "2024-03-15": { USD: "0.95" },
    "2024-06-20": { USD: "1.05" },
    "2024-09-10": { USD: "1.05" },
  });
  const statement = makeStatement([
    fundUsd("fund", "2024-02-01", "1200"),
    stockBuy("buy", ISIN_AAPL, "AAPL", "2024-03-15", "10", "100"),
    stockSell("sell", ISIN_AAPL, "AAPL", "2024-06-20", "10", "120"),
    convUsd("conv", "2024-09-10", "1400"),
  ]);
  const report = generateTaxReport(statement, rates, 2024, { fxTrace: true });
  const trace = report.fxTrace!;

  it("has a non-empty populated trace to serialize", () => {
    expect(trace.length).toBeGreaterThan(0);
  });

  it("JSONL emits one line per event and round-trips losslessly", () => {
    const jsonl = serializeFxTrace(trace, "jsonl");
    const lines = jsonl.split("\n");
    expect(lines).toHaveLength(trace.length);
    const parsed = lines.map((l) => JSON.parse(l) as FxTraceEvent);
    // Round-trip: same number of objects, same sequence numbers in the same order.
    expect(parsed).toHaveLength(trace.length);
    expect(parsed.map((p) => p.seq)).toEqual(trace.map((e) => e.seq));
    // Spot-check that a known field survives the round-trip on the first event.
    expect(parsed[0]!.kind).toBe(trace[0]!.kind);
    expect(parsed[0]!.currency).toBe(trace[0]!.currency);
    // And that the realized FX still reconciles when re-read from JSONL.
    const sumFromJsonl = parsed
      .filter((p) => p.kind === "dispose")
      .reduce((s, p) => s.plus(p.gainLossEur ?? "0"), new Decimal(0));
    expect(sumFromJsonl.toFixed(2)).toBe(report.fxGains.netGainLoss.toFixed(2));
  });

  it("CSV emits a header row plus one row per event (trace.length + 1)", () => {
    const csv = serializeFxTrace(trace, "csv");
    const lines = csv.split("\n");
    expect(lines).toHaveLength(trace.length + 1);
    // The first line is the header (the stable column order from fx-trace.ts).
    expect(lines[0]).toContain("seq");
    expect(lines[0]).toContain("kind");
    expect(lines[0]).toContain("gainLossEur");
  });
});

// ===========================================================================
// 6. MULTI-YEAR — the trace is ALL-YEAR but the casillas are YEAR-FILTERED.
// ---------------------------------------------------------------------------
// The load-bearing reconciliation caveat (PR #238 review): the trace is the FULL
// all-year ledger (so a lot's whole lifecycle is visible), while 1633/1637 keep
// only the disposals whose `disposeDate` ∈ the declaration year. So the golden
// identity is Σ dispose.gainLossEur WHERE date∈year === fxGains.netGainLoss —
// NOT Σ over ALL years. This test pins BOTH directions so the qualifier (and the
// doc in types/tax.ts + CLAUDE.md) can never silently rot:
//
//   fund $2000 @0.90 (2023) → buy $2000 stock (2023) → sell $2000 @0.95 (2023)
//   → convert $1000 @1.05 (2023)  AND  convert $1000 @1.20 (2024)
//
// 2024 casilla = only the 2024 conversion: $1000 carried @0.90 → @1.20 = €300.
// The trace ALSO contains the 2023 conversion's dispose(s) (carried @0.90 → @1.05
// = €150), so summing ALL dispose rows = €450 ≠ €300. Filtering by year ties out.
// ===========================================================================
describe("fx-trace e2e #6: multi-year — Σ dispose reconciles to the casilla ONLY when filtered by declaration year", () => {
  const rates = makeRateMap({
    "2023-02-01": { USD: "0.90" }, // funding ($2000 tracked)
    "2023-03-15": { USD: "0.92" }, // buy
    "2023-06-20": { USD: "0.95" }, // sell (re-adds principal at carried 0.90 + profit)
    "2023-09-10": { USD: "1.05" }, // conversion #1 (2023): $1000 @0.90 → €150
    "2024-09-10": { USD: "1.20" }, // conversion #2 (2024): $1000 @0.90 → €300
  });
  const statement = makeStatement([
    fundUsd("fund", "2023-02-01", "2000"),
    stockBuy("buy", ISIN_AAPL, "AAPL", "2023-03-15", "20", "100"), // $2000
    stockSell("sell", ISIN_AAPL, "AAPL", "2023-06-20", "20", "100"), // $2000 back (flat in USD)
    convUsd("conv2023", "2023-09-10", "1000"), // convert half in 2023
    convUsd("conv2024", "2024-09-10", "1000"), // convert the other half in 2024
  ]);
  // The trace is identical regardless of which year we ask for (it's all-year);
  // generate the 2024 report so the casilla is the 2024 slice.
  const report = generateTaxReport(statement, rates, 2024, { fxTrace: true });
  const trace = report.fxTrace!;

  it("the 2024 casilla reflects ONLY the 2024 conversion (€300.00)", () => {
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("300.00");
  });

  it("summing ALL dispose rows across years does NOT match the year casilla (the trap)", () => {
    // €150 (2023) + €300 (2024) = €450 ≠ €300. This is exactly why a naive
    // full-ledger sum mis-states the box on a multi-year account.
    expect(sumDisposeGainLoss(trace).toFixed(2)).toBe("450.00");
    expect(sumDisposeGainLoss(trace).toFixed(2)).not.toBe(report.fxGains.netGainLoss.toFixed(2));
  });

  it("summing only the dispose rows DATED in the declaration year RECONCILES to the casilla", () => {
    const yearDisposes = trace.filter((e) => e.kind === "dispose" && e.date.startsWith("2024"));
    const sum = yearDisposes.reduce((s, e) => s.plus(e.gainLossEur ?? "0"), new Decimal(0));
    expect(sum.toFixed(2)).toBe(report.fxGains.netGainLoss.toFixed(2));
    expect(sum.toFixed(2)).toBe("300.00");
    // And the trace genuinely carries a 2023-dated dispose (the all-year property).
    expect(trace.some((e) => e.kind === "dispose" && e.date.startsWith("2023"))).toBe(true);
  });
});
