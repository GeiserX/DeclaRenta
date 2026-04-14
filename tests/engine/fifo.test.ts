import { describe, it, expect } from "vitest";
import { FifoEngine } from "../../src/engine/fifo.js";
import type { Trade, CorporateAction } from "../../src/types/ibkr.js";
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
    multiplier: "1",
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

  it("should warn and use zero cost basis when selling without lots", () => {
    const rates = makeRateMap({ "2025-09-20": "0.91" });
    const trades: Trade[] = [
      makeTrade({ tradeID: "1", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("0.00");
    expect(disposals[0]!.gainLossEur.toFixed(2)).toBe(disposals[0]!.proceedsEur.toFixed(2));
    expect(engine.warnings).toHaveLength(1);
    expect(engine.warnings[0]).toContain("Venta sin lotes");
  });

  it("should apply option multiplier (×100)", () => {
    const rates = makeRateMap({
      "2025-02-01": "0.9200",
      "2025-04-01": "0.9100",
    });

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", symbol: "AAPL  250620C00200000", isin: "",
        assetCategory: "OPT", tradeDate: "2025-02-01",
        quantity: "5", tradePrice: "3.00", multiplier: "100", buySell: "BUY",
      }),
      makeTrade({
        tradeID: "2", symbol: "AAPL  250620C00200000", isin: "",
        assetCategory: "OPT", tradeDate: "2025-04-01",
        quantity: "-5", tradePrice: "5.00", multiplier: "100", buySell: "SELL",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    // Cost: 5 × 3.00 × 100 × 0.92 = 1380.00 EUR
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("1380.00");
    // Proceeds: 5 × 5.00 × 100 × 0.91 = 2275.00 EUR
    expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("2275.00");
    expect(disposals[0]!.gainLossEur.toFixed(2)).toBe("895.00");
  });

  it("should group options by symbol when ISIN is blank", () => {
    const rates = makeRateMap({
      "2025-01-10": "0.92",
      "2025-02-10": "0.92",
      "2025-03-10": "0.91",
    });

    const trades: Trade[] = [
      // Two different option series on AAPL — should NOT share lots
      makeTrade({
        tradeID: "1", symbol: "AAPL  250620C00200000", isin: "",
        assetCategory: "OPT", tradeDate: "2025-01-10",
        quantity: "5", tradePrice: "3.00", multiplier: "100", buySell: "BUY",
      }),
      makeTrade({
        tradeID: "2", symbol: "AAPL  250620P00180000", isin: "",
        assetCategory: "OPT", tradeDate: "2025-02-10",
        quantity: "5", tradePrice: "2.00", multiplier: "100", buySell: "BUY",
      }),
      // Sell the calls — should match lot 1, not lot 2
      makeTrade({
        tradeID: "3", symbol: "AAPL  250620C00200000", isin: "",
        assetCategory: "OPT", tradeDate: "2025-03-10",
        quantity: "-5", tradePrice: "5.00", multiplier: "100", buySell: "SELL",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    // Cost from call lot: 5 × 3.00 × 100 × 0.92 = 1380.00
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("1380.00");
    expect(engine.warnings).toHaveLength(0);
  });

  it("should apply stock splits correctly", () => {
    const rates = makeRateMap({
      "2024-06-01": "0.92",
      "2024-09-15": "0.91",
    });

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", isin: "US1234567890", tradeDate: "20240601",
        quantity: "10", tradePrice: "1000", buySell: "BUY",
      }),
      // After 10:1 split, sell 50 shares (originally 5 shares)
      makeTrade({
        tradeID: "2", isin: "US1234567890", tradeDate: "20240915",
        quantity: "-50", tradePrice: "110", buySell: "SELL",
      }),
    ];

    const corporateActions: CorporateAction[] = [{
      transactionID: "CA1", accountId: "U1", symbol: "TEST", isin: "US1234567890",
      description: "TEST(US1234567890) SPLIT 10 FOR 1", currency: "USD",
      reportDate: "20240807", dateTime: "20240807", quantity: "0", amount: "0",
      type: "FS", actionDescription: "",
    }];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates, corporateActions);

    expect(disposals).toHaveLength(1);
    // After split: 10 shares → 100 shares at 100/share → costPerShare = 100
    // Sell 50 × $110 × 0.91 = $5005 EUR
    expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("5005.00");
    // Cost: 50/100 of original cost (10 × 1000 × 0.92 = 9200), so 4600
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("4600.00");
    expect(engine.warnings).toHaveLength(0);
  });

  it("should calculate correct holding days with YYYYMMDD dates", () => {
    const rates = makeRateMap({
      "2025-01-15": "0.92",
      "2025-09-15": "0.91",
    });

    const trades: Trade[] = [
      makeTrade({ tradeID: "1", tradeDate: "20250115", quantity: "10", tradePrice: "100", buySell: "BUY" }),
      makeTrade({ tradeID: "2", tradeDate: "20250915", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    // Jan 15 to Sep 15 = 243 days
    expect(disposals[0]!.holdingPeriodDays).toBe(243);
  });

  it("should handle partial lot consumption with correct cost split", () => {
    const rates = makeRateMap({
      "2025-03-15": "0.92",
      "2025-09-20": "0.91",
    });

    const trades: Trade[] = [
      makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "100", tradePrice: "50", buySell: "BUY", commission: "-10" }),
      makeTrade({ tradeID: "2", tradeDate: "2025-09-20", quantity: "-30", tradePrice: "60", buySell: "SELL", commission: "-3" }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    // Buy cost: (100 × 50 + 10) × 0.92 = 4609.20 EUR for 100 shares
    // Cost per share: 4609.20 / 100 = 46.092
    // Disposal cost: 30 × 46.092 = 1382.76
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("1382.76");
    // Proceeds: (30 × 60 - 3) × 0.91 = 1635.27
    expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("1635.27");

    // Remaining lot should have 70 shares with proportional cost
    const remaining = engine.getRemainingLots();
    const lots = remaining.get("US0378331005")!;
    expect(lots).toHaveLength(1);
    expect(lots[0]!.quantity.toNumber()).toBe(70);
    expect(lots[0]!.costInEur.toFixed(2)).toBe("3226.44");
  });

  it("should include transaction taxes in cost and proceeds", () => {
    const rates = makeRateMap({
      "2025-03-15": "0.92",
      "2025-09-20": "0.91",
    });

    const trades: Trade[] = [
      makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100", buySell: "BUY", commission: "-5", taxes: "-2" }),
      makeTrade({ tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL", commission: "-5", taxes: "-3" }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    // Cost: (10 × 100 + 5 + 2) × 0.92 = 1007 × 0.92 = 926.44
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("926.44");
    // Proceeds: (10 × 120 - 5 - 3) × 0.91 = 1192 × 0.91 = 1084.72
    expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("1084.72");
  });
});
