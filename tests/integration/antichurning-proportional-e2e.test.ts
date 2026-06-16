import { describe, it, expect } from "vitest";
import { generateTaxReport } from "../../src/generators/report.js";
import type { FlexStatement, Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// End-to-end: PROPORTIONAL anti-churning (Art. 33.5.f/g LIRPF) through the WHOLE
// pipeline (generateTaxReport). The new contract (feat/antichurning-proportional)
// blocks a loss PROPORTIONAL to the repurchased quantity (DGT V0913-08 "por
// paquetes") and DEFERS it — releasing it (reintegratedLosses) when the surviving
// repurchased lot is later sold ("se integrarán a medida que se transmitan los
// valores que permanezcan en el patrimonio").
//
// report.ts computes the FISCAL capital-gains contribution as
//   netGainLoss + blockedLosses − reintegratedLosses
// and feeds that (floored at 0) into totalSavingsBase — so a partially-blocked
// loss adds only the blocked portion BACK to the taxed base, not the whole loss.
//
// Every EUR figure is hand-computed and pinned exactly. The ECB rate map is built
// IN-MEMORY (date → currency → "EUR per 1 FCY"); USD rate is 1.00 everywhere so
// EUR == FCY and the arithmetic is transparent. NO network fetch ever happens.
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
    tradePrice: "100",
    tradeMoney: "10000",
    proceeds: "10000",
    cost: "10000",
    fifoPnlRealized: "0",
    fxRateToBase: "1",
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

// ===========================================================================
// 1. PARTIAL REPURCHASE — only the proportional slice of the loss is blocked.
// ===========================================================================
//
// Hand-computed (USD rate 1.00 → EUR == USD):
//   AAPL (the loss security):
//     BUY  100 @ $100 = $10 000 cost
//     SELL 100 @ $90  = $9 000 proceeds  → loss = −€1 000
//     REBUY 30 @ $100 on 2025-07-01 (16 days later, inside the 2-month listed
//           window) → blocked = €1 000 × 30/100 = €300 (the loss on the other 70
//           is deductible now).
//   MSFT (a separate GAIN, so the base is positive and the block is observable):
//     BUY  100 @ $100 = $10 000
//     SELL 100 @ $110 = $11 000  → gain = +€1 000
//
//   Raw netGainLoss      = (+1 000 gain) + (−1 000 loss)               = €0.00
//   blockedLosses        = €300.00     reintegratedLosses = €0.00
//   fiscalCapitalGains   = 0 + 300 − 0                                  = €300.00
//   totalSavingsBase     = max(300, 0)                                  = €300.00
//
// I.e. only €700 of the €1 000 loss offsets the €1 000 gain → €300 stays taxed.
// If the OLD whole-loss model were still in force the loss would be fully blocked
// (€1 000 back) → base €1 000; if anti-churning were OFF the loss would fully
// deduct → base €0. €300 proves the PROPORTIONAL middle.
describe("antichurning e2e: partial repurchase blocks only the proportional loss", () => {
  const MSFT = "US5949181045";
  const rates = makeRateMap({
    "2025-01-10": { USD: "1.00" },
    "2025-06-15": { USD: "1.00" },
    "2025-07-01": { USD: "1.00" },
  });

  const trades: Trade[] = [
    // AAPL loss round-trip + partial repurchase.
    makeTrade({ tradeID: "aapl-buy", isin: "US0378331005", symbol: "AAPL", tradeDate: "2025-01-10", buySell: "BUY", quantity: "100", tradePrice: "100" }),
    makeTrade({ tradeID: "aapl-sell", isin: "US0378331005", symbol: "AAPL", tradeDate: "2025-06-15", buySell: "SELL", quantity: "100", tradePrice: "90" }),
    makeTrade({ tradeID: "aapl-rebuy", isin: "US0378331005", symbol: "AAPL", tradeDate: "2025-07-01", buySell: "BUY", quantity: "30", tradePrice: "100" }),
    // MSFT gain round-trip (separate security → never blocked).
    makeTrade({ tradeID: "msft-buy", isin: MSFT, symbol: "MSFT", description: "MICROSOFT", tradeDate: "2025-01-10", buySell: "BUY", quantity: "100", tradePrice: "100" }),
    makeTrade({ tradeID: "msft-sell", isin: MSFT, symbol: "MSFT", description: "MICROSOFT", tradeDate: "2025-06-15", buySell: "SELL", quantity: "100", tradePrice: "110" }),
  ];
  const report = generateTaxReport(makeStatement(trades), rates, 2025, { skipFx: true });

  it("blocks €300 (the proportional 30/100 slice), not the whole €1 000 loss", () => {
    expect(report.capitalGains.blockedLosses.toFixed(2)).toBe("300.00");
  });

  it("reintegrates nothing this year (the repurchased lot is still held)", () => {
    expect(report.capitalGains.reintegratedLosses.toFixed(2)).toBe("0.00");
  });

  it("keeps the raw netGainLoss headline at €0.00 (invariant — blocking is a separate line)", () => {
    // The +€1 000 gain and the −€1 000 raw loss net to zero. The block is NOT
    // baked into netGainLoss; it surfaces only via blockedLosses (above) and the
    // fiscal base (below).
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("0.00");
  });

  it("moves the taxed savings base by exactly the blocked amount (fiscal = net + blocked − reintegrated = €300)", () => {
    // The disposals we filed (two disposals: the AAPL loss + the MSFT gain).
    expect(report.capitalGains.disposals).toHaveLength(2);
    // Re-derive the fiscal capital-gains contribution exactly as report.ts does
    // (netGainLoss + blockedLosses − reintegratedLosses), floored at 0 for the
    // savings base. With no dividends/interest/FX it IS the whole savings base.
    const fiscalCapitalGains = report.capitalGains.netGainLoss
      .plus(report.capitalGains.blockedLosses)
      .minus(report.capitalGains.reintegratedLosses);
    expect(fiscalCapitalGains.toFixed(2)).toBe("300.00");
    // No other savings-base components in this statement.
    expect(report.dividends.grossIncome.toFixed(2)).toBe("0.00");
    expect(report.interest.earned.toFixed(2)).toBe("0.00");
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("0.00");
  });
});

// ===========================================================================
// 2. CROSS-YEAR — defer the loss in 2024, RELEASE it (reintegration) in 2025.
// ===========================================================================
//
// One statement spanning two years. generateTaxReport runs detectWashSales on
// the FULL all-year disposal set BEFORE year-filtering, so the block recorded in
// 2024 is released in 2025 when the surviving repurchased lot is sold.
//
//   BUY  100 AAPL @ $100 (2024-01-10)            → original lot
//   SELL 100 AAPL @ $90  (2024-06-01) = −€1 000  → loss-sale (consumes the lot)
//   BUY  100 AAPL @ $100 (2024-07-01)            → the repurchase, inside 2mo of
//        the sale → blocks the WHOLE €1 000 (full repurchase)
//   SELL 100 AAPL @ $130 (2025-03-01) = +€3 000  → sells the repurchased lot
//        (its FIFO acquireDate == 2024-07-01) → RELEASES the €1 000 deferred loss
//
//   Year 2024: blockedLosses = €1 000.00, reintegratedLosses = €0.00
//              (the loss-sale is in 2024; the 2025 release is filtered out)
//   Year 2025: blockedLosses = €0.00,    reintegratedLosses = €1 000.00
//              (the block was in 2024; the 2025 sale carries the release)
describe("antichurning e2e: cross-year defer (2024) then reintegrate (2025)", () => {
  const ISIN = "US0378331005";
  const rates = makeRateMap({
    "2024-01-10": { USD: "1.00" },
    "2024-06-01": { USD: "1.00" },
    "2024-07-01": { USD: "1.00" },
    "2025-03-01": { USD: "1.00" },
  });
  const trades: Trade[] = [
    makeTrade({ tradeID: "buy-orig", isin: ISIN, tradeDate: "2024-01-10", buySell: "BUY", quantity: "100", tradePrice: "100" }),
    makeTrade({ tradeID: "sell-loss", isin: ISIN, tradeDate: "2024-06-01", buySell: "SELL", quantity: "100", tradePrice: "90" }),
    makeTrade({ tradeID: "buy-repurchase", isin: ISIN, tradeDate: "2024-07-01", buySell: "BUY", quantity: "100", tradePrice: "100" }),
    makeTrade({ tradeID: "sell-repurchased", isin: ISIN, tradeDate: "2025-03-01", buySell: "SELL", quantity: "100", tradePrice: "130" }),
  ];
  const statement = makeStatement(trades);

  it("year 2024: the loss is DEFERRED (blockedLosses €1 000, nothing reintegrated)", () => {
    const report = generateTaxReport(statement, rates, 2024, { skipFx: true });
    // Only the 2024 loss-sale disposal is in this year.
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.disposals[0]!.sellDate).toBe("2024-06-01");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("-1000.00");
    expect(report.capitalGains.blockedLosses.toFixed(2)).toBe("1000.00");
    expect(report.capitalGains.reintegratedLosses.toFixed(2)).toBe("0.00");
    // Fiscal base = net + blocked − reintegrated = −1000 + 1000 − 0 = €0 → the
    // deferred loss does NOT reduce the base this year (the C1 fix).
    const fiscal = report.capitalGains.netGainLoss
      .plus(report.capitalGains.blockedLosses)
      .minus(report.capitalGains.reintegratedLosses);
    expect(fiscal.toFixed(2)).toBe("0.00");
  });

  it("year 2025: the deferred loss is RELEASED (reintegratedLosses €1 000) when the repurchased lot is sold", () => {
    const report = generateTaxReport(statement, rates, 2025, { skipFx: true });
    // Only the 2025 sale of the repurchased lot is in this year.
    expect(report.capitalGains.disposals).toHaveLength(1);
    const sale = report.capitalGains.disposals[0]!;
    expect(sale.sellDate).toBe("2025-03-01");
    expect(sale.acquireDate).toBe("2024-07-01"); // proves it sold the REPURCHASE lot
    // Raw gain on the repurchased lot: 100 × ($130 − $100) = +€3 000.
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("3000.00");
    expect(report.capitalGains.blockedLosses.toFixed(2)).toBe("0.00");
    expect(report.capitalGains.reintegratedLosses.toFixed(2)).toBe("1000.00");
    // Fiscal base = net + blocked − reintegrated = 3000 + 0 − 1000 = €2 000: the
    // €1 000 loss deferred from 2024 is now deductible against the 2025 gain.
    const fiscal = report.capitalGains.netGainLoss
      .plus(report.capitalGains.blockedLosses)
      .minus(report.capitalGains.reintegratedLosses);
    expect(fiscal.toFixed(2)).toBe("2000.00");
  });
});
