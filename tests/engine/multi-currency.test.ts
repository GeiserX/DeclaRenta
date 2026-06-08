import { describe, it, expect } from "vitest";
import { FifoEngine } from "../../src/engine/fifo.js";
import type { Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

function makeTrade(overrides: Partial<Trade>): Trade {
  return {
    tradeID: "1",
    accountId: "U1",
    symbol: "AAPL",
    description: "APPLE INC",
    isin: "US0378331005",
    assetCategory: "STK",
    currency: "USD",
    tradeDate: "2025-03-15",
    settlementDate: "2025-03-18",
    quantity: "10",
    tradePrice: "100",
    tradeMoney: "1000",
    proceeds: "1000",
    cost: "1000",
    fifoPnlRealized: "0",
    fxRateToBase: "0.92",
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

describe("Multi-currency commission handling", () => {
  it("should use same rate when commissionCurrency matches trade currency", () => {
    // Both currency and commissionCurrency are USD — old and new behavior identical
    const rates: EcbRateMap = new Map();
    rates.set("2025-03-15", new Map([["USD", "0.9200"]]));
    rates.set("2025-09-20", new Map([["USD", "0.9100"]]));

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100",
        buySell: "BUY", commission: "-5", commissionCurrency: "USD",
      }),
      makeTrade({
        tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120",
        buySell: "SELL", commission: "-5", commissionCurrency: "USD",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    const d = disposals[0]!;
    // Cost in USD (1005) converted at the SALE-date rate (DGT V2422-20):
    // (10 * 100 + 5) * 0.91 = 1005 * 0.91 = 914.55 EUR
    expect(d.costBasisEur.toFixed(2)).toBe("914.55");
    // Proceeds: (10 * 120 - 5) * 0.91 = 1195 * 0.91 = 1087.45 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("1087.45");
    // Gain in USD = 190, × 0.91 = 172.90 EUR
    expect(d.gainLossEur.toFixed(2)).toBe("172.90");
  });

  it("should homogenize commission into the share currency when commissionCurrency differs from trade currency", () => {
    // USD stock, GBP commission — commission homogenized to USD via the trade-date cross-rate
    const rates: EcbRateMap = new Map();
    rates.set("2025-03-15", new Map([["USD", "0.9200"], ["GBP", "1.1500"]]));
    rates.set("2025-09-20", new Map([["USD", "0.9100"], ["GBP", "1.1300"]]));

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100",
        buySell: "BUY", commission: "-5", commissionCurrency: "GBP",
      }),
      makeTrade({
        tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120",
        buySell: "SELL", commission: "-5", commissionCurrency: "GBP",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    const d = disposals[0]!;
    // Buy cost in USD: 10*100 + commission homogenized to USD via the trade-date
    // cross-rate (5 GBP × 1.15/0.92 = 6.25 USD) = 1006.25 USD. Converted at the
    // SALE-date rate (0.91, DGT V2422-20): 1006.25 * 0.91 = 915.69 EUR
    expect(d.costBasisEur.toFixed(2)).toBe("915.69");
    // Sell proceeds in USD: 10*120 − commission homogenized to USD
    // (5 GBP × 1.13/0.91 = 6.2088 USD) = 1193.7912 USD. × 0.91 = 1086.35 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("1086.35");
    // Gain = 1086.35 − 915.69 = 170.66 EUR
    expect(d.gainLossEur.toFixed(2)).toBe("170.66");
  });

  it("should skip commission rate lookup when commission is zero", () => {
    // commissionCurrency differs but commission is 0 — should NOT attempt ECB lookup
    // Rate map deliberately omits GBP to prove no lookup happens
    const rates: EcbRateMap = new Map();
    rates.set("2025-03-15", new Map([["USD", "0.9200"]]));
    rates.set("2025-09-20", new Map([["USD", "0.9100"]]));

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100",
        buySell: "BUY", commission: "0", commissionCurrency: "GBP",
      }),
      makeTrade({
        tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120",
        buySell: "SELL", commission: "0", commissionCurrency: "GBP",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    const d = disposals[0]!;
    // No commission — cost in USD (1000) converted at the SALE-date rate (0.91): 910.00
    expect(d.costBasisEur.toFixed(2)).toBe("910.00");
    expect(d.proceedsEur.toFixed(2)).toBe("1092.00");
  });

  it("should handle EUR commission on non-EUR stock", () => {
    // USD stock with EUR commission — EUR rate = 1
    const rates: EcbRateMap = new Map();
    rates.set("2025-03-15", new Map([["USD", "0.9200"]]));
    rates.set("2025-09-20", new Map([["USD", "0.9100"]]));

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100",
        buySell: "BUY", commission: "-10", commissionCurrency: "EUR",
      }),
      makeTrade({
        tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120",
        buySell: "SELL", commission: "-8", commissionCurrency: "EUR",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    const d = disposals[0]!;
    // Buy cost in USD: 10*100 + commission homogenized to USD via the trade-date
    // cross-rate (10 EUR × 1.00/0.92 = 10.8696 USD) = 1010.8696 USD. Converted at
    // the SALE-date rate (0.91, DGT V2422-20): 1010.8696 * 0.91 = 919.89 EUR
    expect(d.costBasisEur.toFixed(2)).toBe("919.89");
    // Sell proceeds in USD: 10*120 − (8 EUR × 1.00/0.91 = 8.7912 USD) = 1191.2088 USD
    // × 0.91 = 1084.00 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("1084.00");
    // Gain = 1084.00 − 919.89 = 164.11 EUR
    expect(d.gainLossEur.toFixed(2)).toBe("164.11");
  });

  it("should handle multiple trades with mixed commission currencies", () => {
    const rates: EcbRateMap = new Map();
    rates.set("2025-01-10", new Map([["USD", "0.9000"], ["GBP", "1.1500"]]));
    rates.set("2025-03-15", new Map([["USD", "0.9200"], ["GBP", "1.1300"]]));
    rates.set("2025-09-20", new Map([["USD", "0.9100"], ["GBP", "1.1200"]]));

    const trades: Trade[] = [
      // Buy 1: USD commission
      makeTrade({
        tradeID: "1", tradeDate: "2025-01-10", quantity: "5", tradePrice: "80",
        buySell: "BUY", commission: "-4", commissionCurrency: "USD",
      }),
      // Buy 2: GBP commission on USD stock
      makeTrade({
        tradeID: "2", tradeDate: "2025-03-15", quantity: "5", tradePrice: "100",
        buySell: "BUY", commission: "-3", commissionCurrency: "GBP",
      }),
      // Sell all: EUR commission
      makeTrade({
        tradeID: "3", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "110",
        buySell: "SELL", commission: "-6", commissionCurrency: "EUR",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    // Two disposals: 5 from lot 1 + 5 from lot 2
    expect(disposals).toHaveLength(2);

    const d1 = disposals[0]!;
    // Lot 1 cost in USD: 5*80 + 4 USD commission = 404 USD, converted at the
    // SALE-date rate (0.91, DGT V2422-20): 404 * 0.91 = 367.64 EUR
    expect(d1.costBasisEur.toFixed(2)).toBe("367.64");
    // Sell proceeds for 5 shares (fraction 5/10 = 0.5): proceeds in USD =
    // 5*110 − (3 EUR × 1.00/0.91 = 3.2967 USD) = 546.7033 USD × 0.91 = 497.50
    expect(d1.proceedsEur.toFixed(2)).toBe("497.50");

    const d2 = disposals[1]!;
    // Lot 2 cost in USD: 5*100 + commission homogenized to USD
    // (3 GBP × 1.13/0.92 = 3.6848 USD) = 503.6848 USD. Converted at the
    // SALE-date rate (0.91): 503.6848 * 0.91 = 458.35 EUR
    expect(d2.costBasisEur.toFixed(2)).toBe("458.35");
    // Sell proceeds for 5 shares (fraction 5/10 = 0.5): same as d1 = 497.50
    expect(d2.proceedsEur.toFixed(2)).toBe("497.50");
  });
});
