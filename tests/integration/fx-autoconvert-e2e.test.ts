import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport } from "../../src/generators/report.js";
import type { FlexStatement, Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// End-to-end: IBKR broker AUTO-CONVERSIONS (AFx / FXCONV) are now PROCESSED by
// DEFAULT through the real generateTaxReport pipeline (issue #239).
// ---------------------------------------------------------------------------
// Previously `isFxconv()` SKIPPED every AFx/FXCONV CASH row unconditionally, so
// a broker-auto-converted currency leg produced NO FX event and its real divisa
// gain/loss was silently dropped. The reasoning behind #239: IBKR does NOT
// round-trip FCY→EUR on a stock sale — the proceeds accrue as a HELD foreign
// balance, and the broker's "AFx" line is the genuine acquisition/disposal of
// that divisa. Under Art. 33.1 LIRPF (la divisa es un elemento patrimonial:
// ganancia = valor de transmisión − valor de adquisición; timing Art. 14.2.e on
// the effective conversion to euros; DGT V2422-20 / V2324-10) that conversion is
// a real FX gain/loss. So the default now PROCESSES it.
//
// THE CONTROL (issue #239):
//   generateTaxReport(stmt, rates, year, { trackAutoConvert })
//     • undefined / true  → PROCESS AFx (the new default — the gain is computed)
//     • false             → SKIP AFx (the old behaviour — the monodivisa-style
//                            opt-out for accounts that genuinely round-trip)
//   report.ts: `trackAutoConvert = options?.trackAutoConvert !== false`, so only
//   an explicit `false` restores the skip.
//
// An AFx trade is a CASH trade carrying `notes: "AFx"` (or `exchange: "FXCONV"`,
// or a `description` containing "FXCONV" / "CASH RECEIPTS" / "CASH
// DISBURSEMENTS") — see FxFifoEngine.isFxconv(). We build them by adding
// `notes: "AFx"` to the CASH EUR.USD conversion builders below.
//
// THE SAFETY INVARIANT THAT MUST SURVIVE (guards the PR #143 phantom): the
// missing-prior-year-lot FLOOR in consumeLots (no lot → costBasisEur =
// proceedsEur, gainLossEur = 0, lotId "UNKNOWN", `fx.missing_prior_lots` info)
// STILL APPLIES when AFx is processed. Processing an AFx row must NEVER fabricate
// a phantom gain on currency whose acquisition is outside the data window.
//
// Every EUR figure is HAND-COMPUTED and pinned with .toFixed(2). The ECB rate
// map is built IN-MEMORY (date → currency → "EUR per 1 FCY"), exactly like the
// sibling integration tests — NO network fetch ever happens. All rates below are
// quoted as "EUR per 1 USD".
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
// CASH conversion builders (mirrors fx-carry-basis-e2e.test.ts). extractFxEvents
// recognises a CASH trade whose symbol "EUR.USD" has the quote side == trade
// currency ("USD") → isCurrencyQuote() true → amount = |tradeMoney|.
//   • EUR→USD funding (ACQUIRING USD): SELL EUR.USD → acquiring = true → +lot.
//   • USD→EUR conversion (DISPOSING USD): BUY EUR.USD → acquiring = false → −lot
//     (consumes USD lots FIFO and realizes the FX gain).
// The `afx` flag stamps `notes: "AFx"` so isFxconv() matches the row — i.e. it
// becomes a broker auto-conversion, skipped only under { trackAutoConvert: false }.
// ---------------------------------------------------------------------------

/** EUR→USD funding of $usd on `date` (acquire a USD lot at that date's rate). */
function fundUsd(id: string, date: string, usd: string, afx = false): Trade {
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
    // The `notes: "AFx"` marker is what makes this a broker auto-conversion;
    // without it, an identical manual conversion (the non-AFx control).
    ...(afx ? { notes: "AFx" } : {}),
  });
}

/** USD→EUR conversion of $usd on `date` (dispose USD, realize the FX gain). */
function convUsd(id: string, date: string, usd: string, afx = false): Trade {
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
    ...(afx ? { notes: "AFx" } : {}),
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

// A dividend CashTransaction (always processed by extractCashFxEvents — never
// gated by trackAutoConvert). A FCY dividend creates an acquisition lot for the
// net FCY received at the receipt-date rate.
function makeDividend(date: string, usd: string): FlexStatement["cashTransactions"][number] {
  return {
    transactionID: `div-${date}`,
    accountId: "U1",
    symbol: "AAPL",
    description: "AAPL dividend",
    isin: "US0378331005",
    currency: "USD",
    dateTime: date,
    settleDate: date,
    amount: usd,
    fxRateToBase: "0.90",
    type: "Dividends",
  };
}

const ISIN_AAPL = "US0378331005";
const ISIN_MSFT = "US5949181045";

// ===========================================================================
// S1 — AFx FUNDING ROUND-TRIP: the DEFAULT now PROCESSES the AFx leg. (Headline.)
// ===========================================================================
//
// The behavioural pin for issue #239 — a gain that was PREVIOUSLY DROPPED is now
// computed by default, and the opt-out reproduces the old zero.
//
// Rates ("EUR per 1 USD"):
//   2024-02-01 @ 0.90   AFx EUR→USD funding (acquire $10000 of USD, notes "AFx")
//   2024-09-10 @ 1.00   plain USD→EUR conversion of $10000
//
// TRADES:
//   AFx fund  EUR→USD  $10000 @ 0.90   (CASH SELL EUR.USD, notes "AFx")
//   conv      USD→EUR  $10000 @ 1.00   (CASH BUY  EUR.USD, manual)
//
// DEFAULT ({}) hand-trace (trackAutoConvert = true → AFx processed):
//   acquire +$10000 @ 0.90 → pool [{10000, 0.90}]
//   dispose −$10000 @ 1.00 → consume 10000 @0.90:
//       proceeds = 10000 × 1.00 = €10000.00
//       cost     = 10000 × 0.90 = €9000.00
//       gain     = €1000.00
//   FX net (default) = €1000.00  ✓  (the gain #239 stopped dropping)
//
// OPT-OUT ({ trackAutoConvert: false }) hand-trace (AFx SKIPPED):
//   The AFx funding is skipped → NO acquisition lot.
//   dispose −$10000 @ 1.00 with NO prior lot → missing-prior-lot FLOOR:
//       cost = proceeds = €10000.00, gain = €0.00, lotId "UNKNOWN".
//   FX net (opt-out) = €0.00  ✓  (the historical skip)
describe("autoconvert e2e S1: AFx funding round-trip — DEFAULT processes it (€1000.00), opt-out skips (€0.00)", () => {
  const rates = makeRateMap({
    "2024-02-01": { USD: "0.90" }, // AFx funding (the lot the conversion consumes)
    "2024-09-10": { USD: "1.00" }, // manual USD→EUR conversion
  });
  const statement = makeStatement([
    fundUsd("afx-fund", "2024-02-01", "10000", true), // notes "AFx"
    convUsd("conv", "2024-09-10", "10000"),
  ]);

  it("DEFAULT ({}) PROCESSES the AFx funding → realizes the €1000.00 gain that #239 stopped dropping", () => {
    const report = generateTaxReport(statement, rates, 2024, {});
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("1000.00");
    // The single conversion disposal consumed the AFx-funded lot at its 0.90 basis.
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    expect(convs).toHaveLength(1);
    expect(convs[0]!.proceedsEur.toFixed(2)).toBe("10000.00"); // 10000 × 1.00
    expect(convs[0]!.costBasisEur.toFixed(2)).toBe("9000.00"); // 10000 × 0.90 (AFx-funded basis)
    expect(convs[0]!.gainLossEur.toFixed(2)).toBe("1000.00");
    expect(convs[0]!.lotId).not.toBe("UNKNOWN"); // a REAL lot, not the missing-lot floor
  });

  it("OPT-OUT ({ trackAutoConvert: false }) SKIPS the AFx funding → the old €0.00 (floor on the orphan conversion)", () => {
    const report = generateTaxReport(statement, rates, 2024, { trackAutoConvert: false });
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("0.00");
    // The conversion now has no prior lot → missing-lot floor (gain 0, UNKNOWN).
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    expect(convs).toHaveLength(1);
    expect(convs[0]!.gainLossEur.toFixed(2)).toBe("0.00");
    expect(convs[0]!.lotId).toBe("UNKNOWN");
  });
});

// ===========================================================================
// S2 — OPT-OUT PARITY: { trackAutoConvert: false } reproduces the OLD behaviour
//      (no FX disposal arises FROM the AFx row itself).
// ===========================================================================
//
// Same shape as S1 but with the AFx leg as the DISPOSAL (the conversion itself is
// AFx), and a TRACKED manual funding lot present. Under the opt-out the AFx
// disposal is dropped entirely, so the manually-funded lot is never consumed and
// NO FX disposal is produced — byte-identical to the pre-#239 skip. Under the
// default the AFx disposal IS processed and realizes the gain, proving the two
// modes diverge exactly on the AFx row.
//
// Rates ("EUR per 1 USD"):
//   2024-02-01 @ 0.90   manual EUR→USD funding (acquire $5000, NOT AFx)
//   2024-09-10 @ 1.20   AFx USD→EUR conversion of $5000 (notes "AFx")
//
// DEFAULT: acquire $5000 @0.90; AFx dispose $5000 @1.20 → 5000×(1.20−0.90)=€1500.00.
// OPT-OUT: acquire $5000 @0.90; AFx dispose SKIPPED → NO disposal, FX net €0.00,
//          and the $5000 lot stays unconsumed (no conversion ever recorded).
describe("autoconvert e2e S2: opt-out parity — { trackAutoConvert: false } drops the AFx disposal (no FX from the AFx row)", () => {
  const rates = makeRateMap({
    "2024-02-01": { USD: "0.90" }, // manual funding (tracked lot)
    "2024-09-10": { USD: "1.20" }, // AFx conversion
  });
  const statement = makeStatement([
    fundUsd("fund", "2024-02-01", "5000"), // manual funding (no notes)
    convUsd("afx-conv", "2024-09-10", "5000", true), // AFx conversion (notes "AFx")
  ]);

  it("DEFAULT processes the AFx conversion → €1500.00 (5000 × (1.20 − 0.90))", () => {
    const report = generateTaxReport(statement, rates, 2024, {});
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("1500.00");
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    expect(convs).toHaveLength(1);
    expect(convs[0]!.costBasisEur.toFixed(2)).toBe("4500.00"); // 5000 × 0.90 (real funded lot)
  });

  it("OPT-OUT drops the AFx conversion → ZERO FX disposals, net €0.00 (old skip behaviour reproduced)", () => {
    const report = generateTaxReport(statement, rates, 2024, { trackAutoConvert: false });
    // No disposal at all: the AFx row is skipped and the funding row is a pure
    // acquisition (it never disposes), exactly like the pre-#239 engine.
    expect(report.fxGains.disposals).toHaveLength(0);
    expect(report.fxGains.transmissionValue.toFixed(2)).toBe("0.00");
    expect(report.fxGains.acquisitionValue.toFixed(2)).toBe("0.00");
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("0.00");
  });
});

// ===========================================================================
// S5 (numbering per brief) — MISSING-PRIOR-YEAR AFx CONVERSION HITS THE FLOOR,
//      NOT A PHANTOM. Guards the PR #143 phantom-gain bug from re-arming.
// ===========================================================================
//
// The most important safety pin: processing AFx by default must NOT fabricate a
// gain when the disposed currency was acquired OUTSIDE the data window. The
// missing-prior-year-lot floor in consumeLots forces gain = 0 and lotId
// "UNKNOWN", and emits the `fx.missing_prior_lots` info message.
//
// Rates ("EUR per 1 USD"):
//   2024-09-10 @ 1.30   AFx USD→EUR conversion of $10000 (notes "AFx"); NO prior
//                       USD acquisition anywhere in the data.
//
// DEFAULT hand-trace (AFx processed, but NO lot to consume):
//   dispose −$10000 @ 1.30 → consumeLots no-lot branch:
//       proceeds = 10000 × 1.30 = €13000.00
//       cost     = proceeds (FLOOR)  = €13000.00
//       gain     = €0.00,  lotId "UNKNOWN"
//   FX net = €0.00  ✓  (NOT the +€13000 phantom the pre-#143 engine would book)
describe("autoconvert e2e S5: missing-prior-year AFx conversion hits the floor (€0.00), not a phantom", () => {
  const rates = makeRateMap({
    "2024-09-10": { USD: "1.30" }, // AFx conversion with NO prior lot in the data
  });
  const statement = makeStatement([
    convUsd("afx-conv", "2024-09-10", "10000", true), // notes "AFx"; no funding row
  ]);
  const report = generateTaxReport(statement, rates, 2024, {});

  it("the floor holds: FX net €0.00 (processing AFx never fabricates a phantom gain)", () => {
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("0.00");
    expect(report.fxGains.transmissionValue.toFixed(2)).toBe("13000.00"); // proceeds DO appear
    expect(report.fxGains.acquisitionValue.toFixed(2)).toBe("13000.00"); // cost == proceeds (floor)
  });

  it("produces a disposal with lotId 'UNKNOWN' AND surfaces the fx.missing_prior_lots info", () => {
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    expect(convs).toHaveLength(1);
    expect(convs[0]!.lotId).toBe("UNKNOWN");
    expect(convs[0]!.gainLossEur.toFixed(2)).toBe("0.00");
    // The conservative info message must be present (data incomplete, gain assumed 0).
    expect(report.messages.some((m) => m.id === "fx.missing_prior_lots")).toBe(true);
  });
});

// ===========================================================================
// S (residual sweep) — a TINY AFx sweep is PROCESSED (no de-minimis skipping).
// ===========================================================================
//
// A FCY dividend establishes a real lot, then a $3.50 AFx USD→EUR sweep consumes
// part of it. The default must process even this tiny conversion → a small REAL
// disposal against the dividend lot's basis. Confirms there is no de-minimis
// threshold quietly dropping small AFx rows.
//
// Rates ("EUR per 1 USD"):
//   2024-03-15 @ 0.90   dividend $100 received (acquire $100 @0.90)
//   2024-09-10 @ 1.10   AFx USD→EUR sweep of $3.50 (notes "AFx")
//
// DEFAULT hand-trace:
//   dividend acquire +$100 @ 0.90 → pool [{100, 0.90}]
//   AFx dispose −$3.50 @ 1.10 → consume 3.50 @0.90:
//       proceeds = 3.50 × 1.10 = €3.85
//       cost     = 3.50 × 0.90 = €3.15
//       gain     = €0.70
//   FX net = €0.70  ✓
describe("autoconvert e2e (residual sweep): a tiny $3.50 AFx sweep is processed → €0.70 (no de-minimis skip)", () => {
  const rates = makeRateMap({
    "2024-03-15": { USD: "0.90" }, // dividend receipt (the lot the sweep consumes)
    "2024-09-10": { USD: "1.10" }, // AFx sweep
  });
  const statement: FlexStatement = {
    ...makeStatement([convUsd("afx-sweep", "2024-09-10", "3.50", true)]),
    cashTransactions: [makeDividend("2024-03-15", "100")],
  };
  const report = generateTaxReport(statement, rates, 2024, {});

  it("processes the tiny AFx sweep against the dividend lot → €0.70", () => {
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("0.70");
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    expect(convs).toHaveLength(1);
    expect(convs[0]!.quantity.toFixed(2)).toBe("3.50");
    expect(convs[0]!.proceedsEur.toFixed(2)).toBe("3.85"); // 3.50 × 1.10
    expect(convs[0]!.costBasisEur.toFixed(2)).toBe("3.15"); // 3.50 × 0.90 (dividend-date basis)
    expect(convs[0]!.gainLossEur.toFixed(2)).toBe("0.70");
    expect(convs[0]!.lotId).not.toBe("UNKNOWN"); // a real lot — not the floor
  });
});

// ===========================================================================
// S (real-shape NO double-count) — AFx funding feeds a buy→sell→convert
//      round-trip and is realized EXACTLY ONCE, not double-counted.
// ===========================================================================
//
// Mirrors the headline carry-basis shape (fx-carry-basis-e2e.test.ts #1) but the
// FUNDING is an AFx row. Processing the AFx funding makes it an ordinary
// acquisition lot; the stock BUY then PARKS that principal (carry-basis), the
// SELL re-adds it, and the conversion realizes the deferred gain ONCE. The result
// must equal the SAME figure a non-AFx funding row of identical economics gives
// (€155.00) — i.e. the AFx funding is consumed by the park, NOT double-injected.
//
// Rates ("EUR per 1 USD"):
//   2024-02-01 @ 0.90   AFx EUR→USD funding ($2000, notes "AFx")
//   2024-03-15 @ 0.95   stock BUY date (rate lookup only; never the carried basis)
//   2024-06-20 @ 1.00   AAPL sale (stock gain + profit re-add rate)
//   2024-09-10 @ 1.05   USD→EUR conversion (manual; realizes the deferred FX gain)
//
// TRADES:
//   AFx fund EUR→USD $2000 @ 0.90   (CASH SELL EUR.USD, notes "AFx")
//   BUY  AAPL $1000  (10 × $100)    ← consumes $1000 of the AFx-funded tracked pool
//   BUY  MSFT $1000  (10 × $100)    ← OPEN at year-end (never sold)
//   SELL AAPL $1100  (10 × $110)
//   conv USD→EUR $1100 @ 1.05       (manual)
//
// CARRY-BASIS hand-trace (identical to non-AFx funding — the AFx leg just makes
// the funding pool tracked):
//   funding pool          : [{2000, 0.90}]   (the AFx-processed acquisition)
//   AAPL buy ($1000)       : consume 1000 @0.90 → park USD|AAPL=[{1000,0.90}]; pool [{1000,0.90}]
//   MSFT buy ($1000)       : consume 1000 @0.90 → park USD|MSFT=[{1000,0.90}]; pool []
//   AAPL sell (cost 1000, proc 1100 @1.00):
//        re-add principal min(1000,1100)=1000 at CARRIED 0.90 → pool [{1000,0.90}]
//        profit 1100−1000 = 100 at sale 1.00                  → pool [{1000,0.90},{100,1.00}]
//   MSFT never sells       : its {1000,0.90} stays PARKED (deferred — correct)
//   conv $1100 @1.05       : 1000 @0.90 → 1000×(1.05−0.90) = €150.00
//                            100  @1.00 →  100×(1.05−1.00) =   €5.00
//   FX net = €155.00  ✓  (the AFx funding realized ONCE — not 2× — at conversion)
//
// THE NO-DOUBLE-COUNT PROOF: if processing the AFx funding ALSO injected a second
// phantom lot (double-count), the conversion would consume the wrong dollars and
// the figure would NOT be €155. Asserting exactly €155 — and matching the
// non-AFx control below — proves the single, correct realization.
describe("autoconvert e2e (real shape): AFx funding feeds a round-trip, realized ONCE → €155.00 (no double-count)", () => {
  const rates = makeRateMap({
    "2024-02-01": { USD: "0.90" }, // AFx funding
    "2024-03-15": { USD: "0.95" }, // buy date (irrelevant to carried basis)
    "2024-06-20": { USD: "1.00" }, // AAPL sale
    "2024-09-10": { USD: "1.05" }, // conversion
  });
  const afxStatement = makeStatement([
    fundUsd("afx-fund", "2024-02-01", "2000", true), // AFx funding (notes "AFx")
    stockBuy("buy-aapl", ISIN_AAPL, "AAPL", "2024-03-15", "10", "100"),
    stockBuy("buy-msft", ISIN_MSFT, "MSFT", "2024-03-15", "10", "100"), // OPEN at year end
    stockSell("sell-aapl", ISIN_AAPL, "AAPL", "2024-06-20", "10", "110"),
    convUsd("conv", "2024-09-10", "1100"),
  ]);
  // Control: byte-identical economics but a PLAIN (non-AFx) funding row.
  const plainStatement = makeStatement([
    fundUsd("fund", "2024-02-01", "2000"), // plain funding (no notes)
    stockBuy("buy-aapl", ISIN_AAPL, "AAPL", "2024-03-15", "10", "100"),
    stockBuy("buy-msft", ISIN_MSFT, "MSFT", "2024-03-15", "10", "100"),
    stockSell("sell-aapl", ISIN_AAPL, "AAPL", "2024-06-20", "10", "110"),
    convUsd("conv", "2024-09-10", "1100"),
  ]);

  it("realizes the AFx-funded round-trip exactly ONCE → €155.00 (not double-counted)", () => {
    const report = generateTaxReport(afxStatement, rates, 2024, {});
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("155.00");
    // A double-count would consume the wrong dollars and miss €155 (e.g. €310 if
    // the AFx funding were injected twice). Pin the exact split too.
    const convs = report.fxGains.disposals.filter((d) => d.trigger === "conversion");
    expect(convs.length).toBe(2);
    const principal = convs.find((c) => c.quantity.toFixed(0) === "1000")!;
    expect(principal.costBasisEur.toFixed(2)).toBe("900.00"); // 1000 × 0.90 (carried, not duplicated)
    expect(principal.gainLossEur.toFixed(2)).toBe("150.00");
    const profit = convs.find((c) => c.quantity.toFixed(0) === "100")!;
    expect(profit.gainLossEur.toFixed(2)).toBe("5.00");
  });

  it("equals the figure a non-AFx funding row of identical economics produces (parity, no double-count)", () => {
    const afx = generateTaxReport(afxStatement, rates, 2024, {});
    const plain = generateTaxReport(plainStatement, rates, 2024, {});
    // Processing the AFx funding gives the SAME FX net as a plain funding row —
    // the only difference between the two statements is the `notes: "AFx"` tag.
    expect(afx.fxGains.netGainLoss.toFixed(2)).toBe(plain.fxGains.netGainLoss.toFixed(2));
    expect(afx.fxGains.netGainLoss.toFixed(2)).toBe("155.00");
  });

  it("the stock capital gain is unaffected by the AFx tag (sale-date rate, €100.00)", () => {
    const report = generateTaxReport(afxStatement, rates, 2024, {});
    // Only AAPL is sold in-year: 1100 × 1.00 − 1000 × 1.00 = €100 (MSFT open → no disposal).
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("100.00");
  });
});
