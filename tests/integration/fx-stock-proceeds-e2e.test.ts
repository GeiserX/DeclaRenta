import { describe, it, expect } from "vitest";
import { generateTaxReport } from "../../src/generators/report.js";
import type { FlexStatement, Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// End-to-end: foreign-currency STOCK SALE proceeds → FX FIFO → casillas 1633/1637
// ---------------------------------------------------------------------------
// Issue #230 ("Model D"): selling a foreign-currency security pushes its FCY
// proceeds into the FX FIFO as an ACQUISITION lot (the dollars you receive
// selling a USD stock are real, fungible dollars). The FX gain is DEFERRED
// until a later FCY→EUR conversion consumes that lot (Art. 14.2.e LIRPF;
// DGT V2422-20 / V1613-25 / V0463-21). These tests drive the WHOLE pipeline
// through generateTaxReport for the headline scenario the PR review flagged as
// having no end-to-end coverage: buy USD stock → sell USD stock → convert
// USD→EUR → an FX gain lands in 1633/1637.
//
// Every EUR figure is hand-computed and pinned exactly. The ECB rate map is
// built IN-MEMORY (date → currency → "EUR per 1 FCY"), exactly like the other
// integration/generator tests — NO network fetch ever happens.
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
// Reusable building blocks for the AAPL buy/sell pair.
// ---------------------------------------------------------------------------

/** BUY 100 AAPL @ $150 on 2024-03-15. */
const AAPL_BUY: Trade = makeTrade({
  tradeID: "buy-aapl",
  tradeDate: "2024-03-15",
  settlementDate: "2024-03-15",
  buySell: "BUY",
  quantity: "100",
  tradePrice: "150",
  tradeMoney: "15000",
  proceeds: "-15000",
  cost: "15000",
});

/** SELL 100 AAPL @ $200 on 2024-06-20 → $20,000 of real USD received. */
const AAPL_SELL: Trade = makeTrade({
  tradeID: "sell-aapl",
  tradeDate: "2024-06-20",
  settlementDate: "2024-06-20",
  buySell: "SELL",
  quantity: "100",
  tradePrice: "200",
  tradeMoney: "20000",
  proceeds: "20000",
  cost: "20000",
});

/**
 * Build a CASH USD→EUR conversion trade of the full $20,000 proceeds.
 *
 * Shape recognised by FxFifoEngine.extractFxEvents: assetCategory "CASH",
 * non-EUR currency, symbol "EUR.USD" (so the quote side == trade.currency
 * "USD" → isCurrencyQuote() true → amount taken from |tradeMoney|), and BUY
 * EUR.USD = buying EUR by DISPOSING USD → an FCY disposal that consumes USD
 * lots (converts USD→EUR). Not FXCONV/AFx, so it is a genuine manual conversion.
 */
function usdToEurConversion(date: string): Trade {
  return makeTrade({
    tradeID: "conv-usd-eur",
    symbol: "EUR.USD",
    description: "EUR.USD",
    isin: "",
    assetCategory: "CASH",
    currency: "USD",
    tradeDate: date,
    settlementDate: date,
    quantity: "20000",
    tradePrice: "0.952380952",
    tradeMoney: "20000",
    proceeds: "-20000",
    cost: "20000",
    buySell: "BUY",
    exchange: "IDEALFX",
  });
}

// ===========================================================================
// 1. HEADLINE — foreign-stock sale + later conversion → FX gain in 1633/1637.
// ===========================================================================
//
// Hand-computed EUR figures (all rates are "EUR per 1 USD"):
//   buy  2024-03-15 @ 0.90  (informational only — never enters the stock gain)
//   sell 2024-06-20 @ 0.95
//   conv 2024-09-10 @ 1.05
//
// STOCK (fifo.ts: same-currency fiat security → BOTH legs at the SALE-date rate,
//        V2422-20 — the buy↔sale FX drift is stripped out into the FX engine):
//   proceeds = 100 × $200 × 0.95 = €19 000.00
//   cost     = 100 × $150 × 0.95 = €14 250.00
//   gain     =                       €4 750.00
//
// FX (issue #230): the sale injects a $20 000 acquisition lot at the sale-date
//     rate 0.95 (costInEur = €19 000); the conversion disposes $20 000 at 1.05:
//   1633 transmissión = $20 000 × 1.05 = €21 000.00
//   1637 adquisición  = $20 000 × 0.95 = €19 000.00  (the stock-proceeds lot)
//   FX gain           =                    €2 000.00
//
// Reconciliation identity (CLAUDE.md): total economic profit (EUR)
//   = stock-line gain + FX-line gain = €4 750 + €2 000 = €6 750.
describe("issue #230 e2e: USD stock sale + later USD→EUR conversion → FX gain (1633/1637)", () => {
  const rates = makeRateMap({
    "2024-03-15": { USD: "0.90" }, // buy date (informational only for the STK gain)
    "2024-06-20": { USD: "0.95" }, // sell date → stock gain + FX lot basis
    "2024-09-10": { USD: "1.05" }, // conversion date → FX proceeds
  });
  const statement = makeStatement([AAPL_BUY, AAPL_SELL, usdToEurConversion("2024-09-10")]);
  const report = generateTaxReport(statement, rates, 2024);

  it("computes the stock capital gain at the sale-date rate (V2422-20)", () => {
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("19000.00");
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("14250.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("4750.00");
    expect(report.capitalGains.blockedLosses.toFixed(2)).toBe("0.00");
  });

  it("realizes the deferred FX gain on the conversion (1633/1637)", () => {
    expect(report.fxGains.disposals.length).toBeGreaterThan(0);
    // The conversion disposal consumes the stock-sale acquisition lot.
    const conv = report.fxGains.disposals.find((d) => d.trigger === "conversion")!;
    expect(conv).toBeDefined();
    expect(conv.currency).toBe("USD");
    expect(conv.disposeDate).toBe("2024-09-10");
    expect(conv.acquireDate).toBe("2024-06-20"); // the sale-date lot, not the buy date
    expect(conv.proceedsEur.toFixed(2)).toBe("21000.00");
    expect(conv.costBasisEur.toFixed(2)).toBe("19000.00");
    expect(conv.gainLossEur.toFixed(2)).toBe("2000.00");
  });

  it("pins the FX casilla totals: 1633 = 21000.00, 1637 = 19000.00, net = 2000.00", () => {
    expect(report.fxGains.transmissionValue.toFixed(2)).toBe("21000.00");
    expect(report.fxGains.acquisitionValue.toFixed(2)).toBe("19000.00");
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("2000.00");
  });

  it("satisfies the reconciliation identity: stock gain + FX gain = 6750.00", () => {
    const total = report.capitalGains.netGainLoss.plus(report.fxGains.netGainLoss);
    expect(total.toFixed(2)).toBe("6750.00");
  });
});

// ===========================================================================
// 2. DEFERRAL — foreign-stock sale with NO conversion → no FX gain.
// ===========================================================================
//
// Same buy+sell, but the proceeds are never converted to EUR. The sale creates
// the $20 000 USD acquisition lot, but with nothing to consume it the FX gain is
// DEFERRED (Art. 14.2.e — "se imputará en el momento del cobro o del pago").
// The stock gain is still €4 750; the FX block is empty and zero.
describe("issue #230 e2e: sell foreign stock but never convert → FX deferred (no disposal)", () => {
  const rates = makeRateMap({
    "2024-03-15": { USD: "0.90" },
    "2024-06-20": { USD: "0.95" },
  });
  const statement = makeStatement([AAPL_BUY, AAPL_SELL]);
  const report = generateTaxReport(statement, rates, 2024);

  it("still computes the stock capital gain (4750.00)", () => {
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("4750.00");
  });

  it("produces NO FX disposal — the lot was created but not consumed", () => {
    expect(report.fxGains.disposals).toHaveLength(0);
    expect(report.fxGains.transmissionValue.toFixed(2)).toBe("0.00");
    expect(report.fxGains.acquisitionValue.toFixed(2)).toBe("0.00");
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("0.00");
  });
});

// ===========================================================================
// 3. MONODIVISA — same as #1 but skipFx:true → no stock-FX, stock gain intact.
// ===========================================================================
//
// Monodivisa mode (Autodeclaro/Taxdown parity) disables the FX FIFO engine
// entirely. The foreign-stock-proceeds producer lives inside the same skipFx
// block, so it is suppressed too: no FX disposal, all FX casillas zero. The
// EUR stock gain is unaffected (still computed via ECB rates).
describe("issue #230 e2e: monodivisa (skipFx) suppresses stock-FX, keeps the stock gain", () => {
  const rates = makeRateMap({
    "2024-03-15": { USD: "0.90" },
    "2024-06-20": { USD: "0.95" },
    "2024-09-10": { USD: "1.05" },
  });
  const statement = makeStatement([AAPL_BUY, AAPL_SELL, usdToEurConversion("2024-09-10")]);
  const report = generateTaxReport(statement, rates, 2024, { skipFx: true });

  it("keeps the stock capital gain identical to the FX-on case (4750.00)", () => {
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("19000.00");
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("14250.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("4750.00");
  });

  it("zeroes the entire FX block (no separate FX saldo in monodivisa)", () => {
    expect(report.fxGains.disposals).toHaveLength(0);
    expect(report.fxGains.transmissionValue.toFixed(2)).toBe("0.00");
    expect(report.fxGains.acquisitionValue.toFixed(2)).toBe("0.00");
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("0.00");
  });
});

// ===========================================================================
// 4. MULTI-YEAR — sale in 2024, conversion in 2025.
// ===========================================================================
//
// The stock-sale acquisition lot must accrue across years (report.ts feeds the
// FULL, unfiltered fifoEngine.getDisposals() into the FX engine). The FX
// disposal is attributed to the conversion year:
//   • Year 2025 → the FX disposal appears (€2 000 net, 1633 €21 000 / 1637
//     €19 000); the stock SELL was in 2024 so it is filtered out of 2025's
//     capital-gains block.
//   • Year 2024 → the stock gain appears (€4 750), but the conversion is in
//     2025, so NO FX disposal exists in 2024 (lot created, gain deferred).
describe("issue #230 e2e: multi-year — sale 2024, conversion 2025", () => {
  const rates = makeRateMap({
    "2024-03-15": { USD: "0.90" },
    "2024-06-20": { USD: "0.95" },
    "2025-09-10": { USD: "1.05" }, // conversion now in 2025
  });
  const statement = makeStatement([AAPL_BUY, AAPL_SELL, usdToEurConversion("2025-09-10")]);

  it("year 2025: FX disposal appears (the 2024 sale lot is available across years)", () => {
    const report = generateTaxReport(statement, rates, 2025);
    // The 2024 stock SELL is outside 2025 → no capital-gain disposal this year.
    expect(report.capitalGains.disposals).toHaveLength(0);
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("0.00");
    // The conversion (2025) consumes the 2024 stock-proceeds lot.
    expect(report.fxGains.disposals.length).toBeGreaterThan(0);
    const conv = report.fxGains.disposals.find((d) => d.trigger === "conversion")!;
    expect(conv.disposeDate).toBe("2025-09-10");
    expect(conv.acquireDate).toBe("2024-06-20");
    expect(report.fxGains.transmissionValue.toFixed(2)).toBe("21000.00");
    expect(report.fxGains.acquisitionValue.toFixed(2)).toBe("19000.00");
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("2000.00");
  });

  it("year 2024: stock gain appears, FX deferred (no 2024 FX disposal)", () => {
    const report = generateTaxReport(statement, rates, 2024);
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("4750.00");
    expect(report.fxGains.disposals).toHaveLength(0);
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("0.00");
  });
});
