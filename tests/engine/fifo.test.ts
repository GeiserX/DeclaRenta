import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
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
    // Split application generates an informational warning
    expect(engine.warnings).toHaveLength(1);
    expect(engine.warnings[0]).toContain("Split");
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

  it("should apply reverse split correctly", () => {
    const rates = makeRateMap({
      "2024-06-01": "0.92",
      "2024-09-15": "0.91",
    });

    const trades: Trade[] = [
      makeTrade({ tradeID: "1", isin: "US1234567890", tradeDate: "20240601", quantity: "100", tradePrice: "10", buySell: "BUY" }),
      makeTrade({ tradeID: "2", isin: "US1234567890", tradeDate: "20240915", quantity: "-5", tradePrice: "200", buySell: "SELL" }),
    ];

    const corporateActions: CorporateAction[] = [{
      transactionID: "CA1", accountId: "U1", symbol: "TEST", isin: "US1234567890",
      description: "TEST(US1234567890) SPLIT 1 FOR 10", currency: "USD",
      reportDate: "20240807", dateTime: "20240807", quantity: "0", amount: "0",
      type: "FS", actionDescription: "",
    }];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates, corporateActions);

    expect(disposals).toHaveLength(1);
    // After 1:10 reverse split: 100 shares → 10 shares at $100/share
    // Sell 5 of 10 → cost = 5/10 * (100*10*0.92) = 460
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("460.00");
    // Proceeds: 5 × $200 × 0.91 = 910
    expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("910.00");

    // All remaining lots should have quantity >= 1 (no fractional leftovers)
    const remaining = engine.getRemainingLots().get("US1234567890") ?? [];
    expect(remaining.every((l) => l.quantity.toNumber() >= 1)).toBe(true);
  });

  it("should handle scrip dividends (stock dividend lots)", () => {
    const rates = makeRateMap({
      "2025-03-15": "0.92",
      "2025-06-01": "0.90",
      "2025-09-20": "0.91",
    });

    const trades: Trade[] = [
      makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100", buySell: "BUY" }),
      makeTrade({ tradeID: "2", tradeDate: "2025-09-20", quantity: "-12", tradePrice: "110", buySell: "SELL" }),
    ];

    const corporateActions: CorporateAction[] = [{
      transactionID: "SD1", accountId: "U1", symbol: "AAPL", isin: "US0378331005",
      description: "AAPL(US0378331005) STOCK DIVIDEND", currency: "USD",
      reportDate: "20250601", dateTime: "20250601", quantity: "2", amount: "200",
      type: "SD", actionDescription: "",
    }];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates, corporateActions);

    // Should sell all 12: 10 from buy + 2 from scrip dividend
    const totalSold = disposals.reduce((sum, d) => sum.plus(d.quantity), new Decimal(0));
    expect(totalSold.toString()).toBe("12");

    // Total cost: 920.00 (buy: 10×100×0.92) + 180.00 (scrip: 200×0.90)
    const totalCost = disposals.reduce((sum, d) => sum.plus(d.costBasisEur), new Decimal(0));
    expect(totalCost.toFixed(2)).toBe("1100.00");
    expect(engine.warnings.some((w) => w.includes("Scrip dividend"))).toBe(true);
  });

  it("should include ECB rates in disposal output", () => {
    const rates = makeRateMap({
      "2025-03-15": "0.9200",
      "2025-09-20": "0.9100",
    });

    const trades: Trade[] = [
      makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100", buySell: "BUY" }),
      makeTrade({ tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals[0]!.currency).toBe("USD");
    expect(disposals[0]!.acquireEcbRate.toFixed(4)).toBe("0.9200");
    expect(disposals[0]!.sellEcbRate.toFixed(4)).toBe("0.9100");
  });

  it("should not make scrip dividend lots available before their date", () => {
    const rates = makeRateMap({
      "2025-03-15": "0.92",
      "2025-05-01": "0.91",
      "2025-06-01": "0.90",
    });

    const trades: Trade[] = [
      makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100", buySell: "BUY" }),
      // Sell 12 BEFORE scrip dividend date — only 10 shares available
      makeTrade({ tradeID: "2", tradeDate: "2025-05-01", quantity: "-12", tradePrice: "110", buySell: "SELL" }),
    ];

    const corporateActions: CorporateAction[] = [{
      transactionID: "SD1", accountId: "U1", symbol: "AAPL", isin: "US0378331005",
      description: "AAPL(US0378331005) STOCK DIVIDEND", currency: "USD",
      reportDate: "20250601", dateTime: "20250601", quantity: "2", amount: "200",
      type: "SD", actionDescription: "",
    }];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates, corporateActions);

    // Should sell 10 from buy lot + 2 from insufficient lots fallback (SD not yet available)
    expect(disposals).toHaveLength(2);
    expect(engine.warnings.some((w) => w.includes("Lotes insuficientes"))).toBe(true);
    // SD shares should remain unconsumed
    const remaining = engine.getRemainingLots().get("US0378331005") ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.quantity.toString()).toBe("2");
  });

  it("should drop sub-share lots after reverse split (cash-in-lieu)", () => {
    const rates = makeRateMap({ "2024-06-01": "0.92" });

    const trades: Trade[] = [
      makeTrade({ tradeID: "1", isin: "US1234567890", tradeDate: "20240601", quantity: "5", tradePrice: "10", buySell: "BUY" }),
    ];

    const corporateActions: CorporateAction[] = [{
      transactionID: "CA1", accountId: "U1", symbol: "TEST", isin: "US1234567890",
      description: "TEST(US1234567890) SPLIT 1 FOR 10", currency: "USD",
      reportDate: "20240807", dateTime: "20240807", quantity: "0", amount: "0",
      type: "FS", actionDescription: "",
    }];

    const engine = new FifoEngine();
    engine.processTrades(trades, rates, corporateActions);

    // 5 shares / 10 = 0.5 shares — should be dropped (cash-in-lieu)
    const remaining = engine.getRemainingLots().get("US1234567890") ?? [];
    expect(remaining).toHaveLength(0);
  });

  it("should include taxes in short-sale proceeds (no lots)", () => {
    const rates = makeRateMap({ "2025-09-20": "0.91" });
    const trades: Trade[] = [
      makeTrade({ tradeID: "1", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL", commission: "-5", taxes: "-3" }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("0.00");
    // Proceeds: (10 × 120 - 5 - 3) × 0.91 = 1192 × 0.91 = 1084.72
    expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("1084.72");
    expect(engine.warnings).toHaveLength(1);
  });

  it("should include taxes in insufficient-lots fallback", () => {
    const rates = makeRateMap({
      "2025-03-15": "0.92",
      "2025-09-20": "0.91",
    });

    const trades: Trade[] = [
      makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "5", tradePrice: "100", buySell: "BUY" }),
      // Sell 10 but only 5 lots available — 5 go through FIFO, 5 hit the fallback
      makeTrade({ tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL", commission: "-10", taxes: "-4" }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    // 2 disposals: 5 from lot + 5 from insufficient-lots fallback
    expect(disposals).toHaveLength(2);
    expect(engine.warnings).toHaveLength(1);
    expect(engine.warnings[0]).toContain("Lotes insuficientes");

    // Fallback disposal: 5 shares, fraction = 5/10 = 0.5
    // commission share = 10 × 0.5 = 5, taxes share = 4 × 0.5 = 2
    // proceeds = (5 × 120 - 5 - 2) × 0.91 = 593 × 0.91 = 539.63
    const fallback = disposals[1]!;
    expect(fallback.costBasisEur.toFixed(2)).toBe("0.00");
    expect(fallback.proceedsEur.toFixed(2)).toBe("539.63");
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

  describe("getDisposals() accessor", () => {
    it("should return the same disposals as processTrades", () => {
      const rates = makeRateMap({
        "2025-03-15": "0.9200",
        "2025-09-20": "0.9100",
      });

      const trades: Trade[] = [
        makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100", buySell: "BUY" }),
        makeTrade({ tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
      ];

      const engine = new FifoEngine();
      const fromProcess = engine.processTrades(trades, rates);
      const fromAccessor = engine.getDisposals();

      expect(fromAccessor).toBe(fromProcess);
      expect(fromAccessor).toHaveLength(1);
    });
  });

  describe("Short sale (no prior BUY)", () => {
    it("should produce a disposal with zero cost basis for an unknown ISIN", () => {
      const rates = makeRateMap({ "2025-06-01": "0.90" });

      const trades: Trade[] = [
        makeTrade({
          tradeID: "1",
          isin: "US9999999999",
          symbol: "UNKNOWN",
          tradeDate: "2025-06-01",
          quantity: "-5",
          tradePrice: "50",
          buySell: "SELL",
        }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates);

      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("0.00");
      expect(disposals[0]!.quantity.toString()).toBe("5");
      expect(engine.warnings).toHaveLength(1);
      expect(engine.warnings[0]).toContain("Venta sin lotes");
    });
  });

  describe("Sell exceeding available lots", () => {
    it("should produce FIFO disposal + insufficient-lots fallback", () => {
      const rates = makeRateMap({
        "2025-03-15": "0.92",
        "2025-09-20": "0.91",
      });

      const trades: Trade[] = [
        makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "5", tradePrice: "100", buySell: "BUY" }),
        makeTrade({ tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates);

      // 2 disposals: 5 from FIFO lot + 5 from insufficient-lots fallback
      expect(disposals).toHaveLength(2);
      expect(disposals[0]!.quantity.toString()).toBe("5");
      expect(disposals[0]!.costBasisEur.greaterThan(0)).toBe(true);
      expect(disposals[1]!.quantity.toString()).toBe("5");
      expect(disposals[1]!.costBasisEur.toFixed(2)).toBe("0.00");
      expect(engine.warnings).toHaveLength(1);
      expect(engine.warnings[0]).toContain("Lotes insuficientes");
    });
  });

  describe("WAR (warrant) filtering", () => {
    it("should produce no disposals for WAR asset category", () => {
      const rates = makeRateMap({
        "2025-03-15": "0.92",
        "2025-09-20": "0.91",
      });

      const trades: Trade[] = [
        makeTrade({
          tradeID: "1",
          assetCategory: "WAR",
          tradeDate: "2025-03-15",
          quantity: "10",
          tradePrice: "5",
          buySell: "BUY",
        }),
        makeTrade({
          tradeID: "2",
          assetCategory: "WAR",
          tradeDate: "2025-09-20",
          quantity: "-10",
          tradePrice: "8",
          buySell: "SELL",
        }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates);

      expect(disposals).toHaveLength(0);
    });
  });

  describe("Multi-currency verification", () => {
    it("should handle cross-currency: buy USD stock from GBP account, sell later", () => {
      // Scenario: UK-based account (GBP), buying AAPL which trades in USD.
      // IBKR reports the trade in the trade currency (USD), not the settlement
      // currency (GBP). The FIFO engine uses trade.currency for ECB conversion.
      // Settlement FX is handled by the broker — not relevant for Spanish tax.
      //
      // The gain/loss reflects both:
      //   1. The stock price movement (USD 100 → 110)
      //   2. The USD/EUR rate change (0.92 → 0.88)
      const rates: EcbRateMap = new Map();
      rates.set("2025-03-15", new Map([["USD", "0.9200"], ["GBP", "1.1500"]]));
      rates.set("2025-09-20", new Map([["USD", "0.8800"], ["GBP", "1.1300"]]));

      const trades: Trade[] = [
        makeTrade({
          tradeID: "1",
          tradeDate: "2025-03-15",
          currency: "USD",   // Trade currency is USD
          quantity: "10",
          tradePrice: "100",
          buySell: "BUY",
          commission: "0",
        }),
        makeTrade({
          tradeID: "2",
          tradeDate: "2025-09-20",
          currency: "USD",   // Still USD trade
          quantity: "-10",
          tradePrice: "110",
          buySell: "SELL",
          commission: "0",
        }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates);

      expect(disposals).toHaveLength(1);
      const d = disposals[0]!;

      // Cost: 10 × 100 USD × 0.92 EUR/USD = 920.00 EUR
      expect(d.costBasisEur.toFixed(2)).toBe("920.00");
      // Proceeds: 10 × 110 USD × 0.88 EUR/USD = 968.00 EUR
      expect(d.proceedsEur.toFixed(2)).toBe("968.00");
      // Gain: 968 - 920 = 48.00 EUR
      // Note: USD gained 10% in price but EUR/USD dropped from 0.92 to 0.88,
      // so the EUR gain is smaller than the USD gain would suggest
      expect(d.gainLossEur.toFixed(2)).toBe("48.00");

      // ECB rates in disposal should reflect the USD rates used
      expect(d.acquireEcbRate.toFixed(4)).toBe("0.9200");
      expect(d.sellEcbRate.toFixed(4)).toBe("0.8800");
      expect(d.currency).toBe("USD");
    });

    it("should handle GBP-denominated stock with correct FX conversion", () => {
      // Buy a UK stock priced in GBP
      const rates: EcbRateMap = new Map();
      rates.set("2025-03-15", new Map([["GBP", "1.1500"]]));
      rates.set("2025-09-20", new Map([["GBP", "1.1300"]]));

      const trades: Trade[] = [
        makeTrade({
          tradeID: "1",
          symbol: "SHEL",
          isin: "GB00BP6MXD84",
          tradeDate: "2025-03-15",
          currency: "GBP",
          quantity: "10",
          tradePrice: "25",
          buySell: "BUY",
          commission: "0",
        }),
        makeTrade({
          tradeID: "2",
          symbol: "SHEL",
          isin: "GB00BP6MXD84",
          tradeDate: "2025-09-20",
          currency: "GBP",
          quantity: "-10",
          tradePrice: "28",
          buySell: "SELL",
          commission: "0",
        }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates);

      expect(disposals).toHaveLength(1);
      const d = disposals[0]!;

      // Cost: 10 × 25 GBP × 1.15 EUR/GBP = 287.50 EUR
      expect(d.costBasisEur.toFixed(2)).toBe("287.50");
      // Proceeds: 10 × 28 GBP × 1.13 EUR/GBP = 316.40 EUR
      expect(d.proceedsEur.toFixed(2)).toBe("316.40");
      // Gain: 316.40 - 287.50 = 28.90 EUR
      expect(d.gainLossEur.toFixed(2)).toBe("28.90");
      expect(d.currency).toBe("GBP");
    });

    it("should track FX impact separately from price gain in cross-currency trade", () => {
      // Same stock price, different FX — should show FX-only gain/loss
      const rates: EcbRateMap = new Map();
      rates.set("2025-03-15", new Map([["USD", "0.9200"]]));
      rates.set("2025-09-20", new Map([["USD", "0.9500"]])); // USD strengthened

      const trades: Trade[] = [
        makeTrade({
          tradeID: "1",
          tradeDate: "2025-03-15",
          currency: "USD",
          quantity: "10",
          tradePrice: "100",
          buySell: "BUY",
          commission: "0",
        }),
        makeTrade({
          tradeID: "2",
          tradeDate: "2025-09-20",
          currency: "USD",
          quantity: "-10",
          tradePrice: "100", // Same price — no USD gain
          buySell: "SELL",
          commission: "0",
        }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates);

      expect(disposals).toHaveLength(1);
      const d = disposals[0]!;

      // Cost: 10 × 100 × 0.92 = 920.00 EUR
      expect(d.costBasisEur.toFixed(2)).toBe("920.00");
      // Proceeds: 10 × 100 × 0.95 = 950.00 EUR
      expect(d.proceedsEur.toFixed(2)).toBe("950.00");
      // Gain is purely from FX: 950 - 920 = 30.00 EUR
      expect(d.gainLossEur.toFixed(2)).toBe("30.00");
    });
  });

  describe("Commission in different currency", () => {
    it("should convert commission separately when commissionCurrency differs from trade currency", () => {
      const rates: EcbRateMap = new Map();
      rates.set("2025-03-15", new Map([["USD", "0.92"], ["GBP", "1.15"]]));
      rates.set("2025-09-20", new Map([["USD", "0.88"], ["GBP", "1.12"]]));

      const trades: Trade[] = [
        makeTrade({
          tradeID: "1",
          tradeDate: "2025-03-15",
          currency: "USD",
          commissionCurrency: "GBP",
          quantity: "10",
          tradePrice: "100",
          commission: "-5",
          buySell: "BUY",
        }),
        makeTrade({
          tradeID: "2",
          tradeDate: "2025-09-20",
          currency: "USD",
          commissionCurrency: "GBP",
          quantity: "-10",
          tradePrice: "110",
          commission: "-5",
          buySell: "SELL",
        }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates);

      expect(disposals).toHaveLength(1);
      const d = disposals[0]!;
      // BUY cost: 10×100×0.92 + 5×1.15 = 920 + 5.75 = 925.75
      expect(d.costBasisEur.toFixed(2)).toBe("925.75");
      // SELL proceeds: 10×110×0.88 - 5×1.12 = 968 - 5.60 = 962.40
      expect(d.proceedsEur.toFixed(2)).toBe("962.40");
    });
  });

  describe("Unknown asset category warning", () => {
    it("should warn on unknown assetCategory but still process trade", () => {
      const rates = makeRateMap({ "2025-03-15": "0.92", "2025-09-20": "0.91" });
      const trades: Trade[] = [
        makeTrade({ tradeID: "1", assetCategory: "UNKNOWN", tradeDate: "2025-03-15", buySell: "BUY", quantity: "10", tradePrice: "50" }),
        makeTrade({ tradeID: "2", assetCategory: "UNKNOWN", tradeDate: "2025-09-20", buySell: "SELL", quantity: "-10", tradePrice: "60" }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates);

      expect(disposals).toHaveLength(1);
      expect(engine.warnings.some((w) => w.includes("Categoría de activo desconocida"))).toBe(true);
    });
  });

  describe("Scrip dividend for new ISIN (no prior lots)", () => {
    it("should create lots for scrip dividend even when ISIN has no existing lots", () => {
      const rates: EcbRateMap = new Map();
      rates.set("2025-06-15", new Map([["USD", "0.91"]]));
      rates.set("2025-09-20", new Map([["USD", "0.90"]]));

      const ca: CorporateAction[] = [{
        type: "SD",
        dateTime: "20250615",
        isin: "US1234567890",
        symbol: "NEWCO",
        description: "NEWCO SCRIP DIV",
        quantity: "5",
        amount: "500",
        currency: "USD",
        proceeds: "0",
        value: "500",
      }];

      // SELL the scrip dividend shares — they should exist as lots
      const trades: Trade[] = [
        makeTrade({
          tradeID: "1",
          isin: "US1234567890",
          symbol: "NEWCO",
          tradeDate: "2025-09-20",
          currency: "USD",
          quantity: "-5",
          tradePrice: "120",
          buySell: "SELL",
        }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates, ca);

      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.isin).toBe("US1234567890");
      // Cost basis should come from the scrip dividend lot
      expect(disposals[0]!.costBasisEur.greaterThan(0)).toBe(true);
    });
  });

  describe("Spin-off corporate action", () => {
    it("should split cost basis between parent and spin-off", () => {
      const rates = makeRateMap({ "2025-01-10": "0.92", "2025-06-15": "0.91", "2025-09-20": "0.90" });

      const trades: Trade[] = [
        makeTrade({
          tradeID: "1",
          isin: "US0000000001",
          symbol: "PARENT",
          tradeDate: "2025-01-10",
          quantity: "100",
          tradePrice: "50",
          buySell: "BUY",
        }),
        // Sell spin-off shares
        makeTrade({
          tradeID: "2",
          isin: "US0000000002",
          symbol: "SPINCO",
          tradeDate: "2025-09-20",
          quantity: "-50",
          tradePrice: "20",
          buySell: "SELL",
        }),
      ];

      const ca: CorporateAction[] = [{
        type: "SO",
        dateTime: "20250615",
        isin: "US0000000001",
        symbol: "PARENT",
        description: "PARENT(US0000000001) SPINOFF 1 FOR 2 SPINCO(US0000000002)",
        quantity: "50",
        amount: "0",
        currency: "USD",
        proceeds: "0",
        value: "0",
      }];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates, ca);

      // Should have a disposal for the spin-off sale
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.isin).toBe("US0000000002");
      expect(disposals[0]!.symbol).toBe("SPINCO");
      // Spin-off should have inherited a portion of the parent's cost basis
      expect(disposals[0]!.costBasisEur.greaterThan(0)).toBe(true);
      // Check spin-off warning
      expect(engine.warnings.some((w) => w.includes("Spin-off"))).toBe(true);
    });
  });
});
