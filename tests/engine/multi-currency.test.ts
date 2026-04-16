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
    openCloseIndicator: "O",
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
    // Cost: (10 * 100 + 5) * 0.92 = 1005 * 0.92 = 924.60 EUR
    expect(d.costBasisEur.toFixed(2)).toBe("924.60");
    // Proceeds: (10 * 120 - 5) * 0.91 = 1195 * 0.91 = 1087.45 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("1087.45");
    expect(d.gainLossEur.toFixed(2)).toBe("162.85");
  });

  it("should convert commission separately when commissionCurrency differs from trade currency", () => {
    // USD stock, GBP commission — commission must use GBP ECB rate
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
    // Buy cost: (10 * 100) * 0.92 + 5 * 1.15 = 920 + 5.75 = 925.75 EUR
    expect(d.costBasisEur.toFixed(2)).toBe("925.75");
    // Sell proceeds: (10 * 120) * 0.91 - 5 * 1.13 = 1092 - 5.65 = 1086.35 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("1086.35");
    expect(d.gainLossEur.toFixed(2)).toBe("160.60");
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
    // No commission, so just qty * price * rate
    expect(d.costBasisEur.toFixed(2)).toBe("920.00");
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
    // Buy cost: (10 * 100) * 0.92 + 10 * 1.00 = 920 + 10 = 930.00 EUR
    expect(d.costBasisEur.toFixed(2)).toBe("930.00");
    // Sell proceeds: (10 * 120) * 0.91 - 8 * 1.00 = 1092 - 8 = 1084.00 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("1084.00");
    expect(d.gainLossEur.toFixed(2)).toBe("154.00");
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
    // Lot 1 cost: (5 * 80) * 0.90 + 4 * 0.90 = 360 + 3.60 = 363.60 EUR
    expect(d1.costBasisEur.toFixed(2)).toBe("363.60");
    // Sell proceeds for 5 shares (fraction 5/10 = 0.5): (5 * 110) * 0.91 - 3 * 1.00 = 500.50 - 3.00 = 497.50
    expect(d1.proceedsEur.toFixed(2)).toBe("497.50");

    const d2 = disposals[1]!;
    // Lot 2 cost: (5 * 100) * 0.92 + 3 * 1.13 = 460 + 3.39 = 463.39 EUR
    expect(d2.costBasisEur.toFixed(2)).toBe("463.39");
    // Sell proceeds for 5 shares (fraction 5/10 = 0.5): (5 * 110) * 0.91 - 3 * 1.00 = 500.50 - 3.00 = 497.50
    expect(d2.proceedsEur.toFixed(2)).toBe("497.50");
  });
});
