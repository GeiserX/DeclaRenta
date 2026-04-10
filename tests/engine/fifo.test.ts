import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { FifoEngine } from "../../src/engine/fifo.js";
import type { Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

function makeRateMap(rates: Record<string, string>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, rate] of Object.entries(rates)) {
    map.set(date, new Map([["USD", rate]]));
  }
  return map;
}

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
    ...overrides,
  };
}

describe("FifoEngine", () => {
  it("should calculate simple buy and sell", () => {
    const rates = makeRateMap({
      "2025-03-15": "0.9200", // 1 USD = 0.92 EUR
      "2025-09-20": "0.9100",
    });

    const trades: Trade[] = [
      makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100", buySell: "BUY" }),
      makeTrade({ tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    const d = disposals[0]!;

    // Cost: 10 * 100 USD * 0.92 = 920 EUR
    expect(d.costBasisEur.toFixed(2)).toBe("920.00");
    // Proceeds: 10 * 120 USD * 0.91 = 1092 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("1092.00");
    // Gain: 1092 - 920 = 172 EUR
    expect(d.gainLossEur.toFixed(2)).toBe("172.00");
  });

  it("should consume lots in FIFO order", () => {
    const rates = makeRateMap({
      "2025-01-10": "0.9000",
      "2025-03-15": "0.9200",
      "2025-09-20": "0.9100",
    });

    const trades: Trade[] = [
      makeTrade({ tradeID: "1", tradeDate: "2025-01-10", quantity: "5", tradePrice: "80", buySell: "BUY" }),
      makeTrade({ tradeID: "2", tradeDate: "2025-03-15", quantity: "5", tradePrice: "100", buySell: "BUY" }),
      makeTrade({ tradeID: "3", tradeDate: "2025-09-20", quantity: "-7", tradePrice: "120", buySell: "SELL" }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    // Should produce 2 disposals: 5 from first lot + 2 from second lot
    expect(disposals).toHaveLength(2);
    expect(disposals[0]!.quantity.toString()).toBe("5");
    expect(disposals[0]!.acquireDate).toBe("2025-01-10");
    expect(disposals[1]!.quantity.toString()).toBe("2");
    expect(disposals[1]!.acquireDate).toBe("2025-03-15");
  });

  it("should handle EUR trades (rate = 1)", () => {
    const rates: EcbRateMap = new Map();

    const trades: Trade[] = [
      makeTrade({ tradeID: "1", currency: "EUR", tradeDate: "2025-03-15", quantity: "10", tradePrice: "50", buySell: "BUY" }),
      makeTrade({ tradeID: "2", currency: "EUR", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "60", buySell: "SELL" }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("500.00");
    expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("600.00");
    expect(disposals[0]!.gainLossEur.toFixed(2)).toBe("100.00");
  });

  it("should throw when selling without lots", () => {
    const rates = makeRateMap({ "2025-09-20": "0.91" });
    const trades: Trade[] = [
      makeTrade({ tradeID: "1", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
    ];

    const engine = new FifoEngine();
    expect(() => engine.processTrades(trades, rates)).toThrow("no lots available");
  });
});
