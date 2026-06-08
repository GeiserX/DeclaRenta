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
    openCloseIndicator: overrides.buySell === "SELL" ? "C" : "O",
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

    // Cost in USD (1000) converted at the SALE-date rate (DGT V2422-20):
    // 10 * 100 USD * 0.91 = 910 EUR
    expect(d.costBasisEur.toFixed(2)).toBe("910.00");
    // Proceeds: 10 * 120 USD * 0.91 = 1092 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("1092.00");
    // Gain: 1092 - 910 = 182 EUR (gain computed in USD = 200, × 0.91 sale rate)
    expect(d.gainLossEur.toFixed(2)).toBe("182.00");
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
    // Cost in USD (1500) converted at the SALE-date rate: 5 × 3.00 × 100 × 0.91 = 1365.00 EUR
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("1365.00");
    // Proceeds: 5 × 5.00 × 100 × 0.91 = 2275.00 EUR
    expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("2275.00");
    // Gain in USD = 1000, × 0.91 sale rate = 910.00 EUR
    expect(disposals[0]!.gainLossEur.toFixed(2)).toBe("910.00");
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
    // Cost from call lot in USD (1500) converted at the SALE-date rate (0.91): 5 × 3.00 × 100 × 0.91 = 1365.00
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("1365.00");
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
    // Cost in USD: 50/100 of original 10000 USD = 5000 USD, converted at the
    // SALE-date rate (0.91): 5000 × 0.91 = 4550.00 EUR
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("4550.00");
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
    // Buy cost in USD: 100 × 50 + 10 = 5010 USD for 100 shares
    // Cost per share: 5010 / 100 = 50.1 USD
    // Disposal cost in USD: 30 × 50.1 = 1503 USD, converted at the SALE-date rate
    // (0.91): 1503 × 0.91 = 1367.73 EUR
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("1367.73");
    // Proceeds: (30 × 60 - 3) × 0.91 = 1635.27
    expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("1635.27");

    // Remaining lot should have 70 shares with proportional cost (in FCY/USD)
    const remaining = engine.getRemainingLots();
    const lots = remaining.get("US0378331005")!;
    expect(lots).toHaveLength(1);
    expect(lots[0]!.quantity.toNumber()).toBe(70);
    // 70 × 50.1 = 3507.00 USD
    expect(lots[0]!.costInFcy.toFixed(2)).toBe("3507.00");
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
    // Sell 5 of 10 → cost in USD = 5/10 * (100*10) = 500 USD, converted at the
    // SALE-date rate (0.91): 500 × 0.91 = 455.00 EUR
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("455.00");
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

    // Cost basis is converted at the SALE-date rate (0.91, DGT V2422-20):
    // buy 10 × 100 USD = 1000 USD × 0.91 = 910.00; scrip 2 shares = 200 USD × 0.91 = 182.00
    const totalCost = disposals.reduce((sum, d) => sum.plus(d.costBasisEur), new Decimal(0));
    expect(totalCost.toFixed(2)).toBe("1092.00");
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
    // Cost in USD: 10 × 100 + 5 + 2 = 1007 USD, converted at the SALE-date rate
    // (0.91): 1007 × 0.91 = 916.37 EUR
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("916.37");
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

      // Cost in USD (1000) converted at the SALE-date rate (DGT V2422-20):
      // 10 × 100 USD × 0.88 EUR/USD = 880.00 EUR
      expect(d.costBasisEur.toFixed(2)).toBe("880.00");
      // Proceeds: 10 × 110 USD × 0.88 EUR/USD = 968.00 EUR
      expect(d.proceedsEur.toFixed(2)).toBe("968.00");
      // Gain: the USD stock gain (100 USD) converted at the sale-date rate:
      // 100 × 0.88 = 88.00 EUR. FX drift on the cost is a SEPARATE currency gain.
      expect(d.gainLossEur.toFixed(2)).toBe("88.00");

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

      // Cost in GBP (250) converted at the SALE-date rate (DGT V2422-20):
      // 10 × 25 GBP × 1.13 EUR/GBP = 282.50 EUR
      expect(d.costBasisEur.toFixed(2)).toBe("282.50");
      // Proceeds: 10 × 28 GBP × 1.13 EUR/GBP = 316.40 EUR
      expect(d.proceedsEur.toFixed(2)).toBe("316.40");
      // Gain: GBP stock gain (30 GBP) × sale-date rate 1.13 = 33.90 EUR
      expect(d.gainLossEur.toFixed(2)).toBe("33.90");
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

      // Under DGT V2422-20 the stock gain is computed in USD (1000 − 1000 = 0)
      // and converted at the sale-date rate, so the STOCK gain is exactly 0.
      // The FX move (0.92 → 0.95) is a SEPARATE currency gain handled by the FX
      // engine — it no longer leaks into the stock gain.
      // Cost: 10 × 100 × 0.95 (sale-date rate) = 950.00 EUR
      expect(d.costBasisEur.toFixed(2)).toBe("950.00");
      // Proceeds: 10 × 100 × 0.95 = 950.00 EUR
      expect(d.proceedsEur.toFixed(2)).toBe("950.00");
      // Stock gain is exactly 0 (FX gain is tracked separately).
      expect(d.gainLossEur.toFixed(2)).toBe("0.00");
    });
  });

  describe("Commission in different currency", () => {
    it("should homogenize commission into the share currency when commissionCurrency differs from trade currency", () => {
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
      // BUY cost in USD: 10×100 + commission homogenized to USD via the trade-date
      // cross-rate (5 GBP × 1.15/0.92 = 6.25 USD) = 1006.25 USD. Converted at the
      // SALE-date rate (0.88, DGT V2422-20): 1006.25 × 0.88 = 885.50 EUR
      expect(d.costBasisEur.toFixed(2)).toBe("885.50");
      // SELL proceeds in USD: 10×110 − commission homogenized to USD
      // (5 GBP × 1.12/0.88 = 6.3636 USD) = 1093.6364 USD. × 0.88 = 962.40 EUR
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

  describe("Short positions (SELL+O → BUY+C)", () => {
    it("should handle basic short sale lifecycle", () => {
      const rates = makeRateMap({ "2025-03-15": "0.9200", "2025-06-15": "0.9100" });
      const trades: Trade[] = [
        makeTrade({
          tradeID: "1", tradeDate: "2025-03-15", quantity: "-10", tradePrice: "150",
          buySell: "SELL", openCloseIndicator: "O",
        }),
        makeTrade({
          tradeID: "2", tradeDate: "2025-06-15", quantity: "10", tradePrice: "140",
          buySell: "BUY", openCloseIndicator: "C",
        }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates);

      expect(disposals).toHaveLength(1);
      const d = disposals[0]!;
      expect(d.isShort).toBe(true);
      // Gain computed in the share currency (USD), converted at the CLOSE-date
      // rate (DGT V2422-20): gain_usd = 10*150 - 10*140 = 100 USD; ×0.91 = 91.
      expect(d.gainLossFcy.toFixed(2)).toBe("100.00");
      // Both legs displayed at the close-date rate (0.91): proceeds 1500×0.91,
      // cost 1400×0.91, so proceeds − cost === gain exactly.
      expect(d.proceedsEur.toFixed(2)).toBe("1365.00");
      expect(d.costBasisEur.toFixed(2)).toBe("1274.00");
      expect(d.gainLossEur.toFixed(2)).toBe("91.00");
    });

    it("should handle short sale at a loss", () => {
      const rates = makeRateMap({ "2025-03-15": "0.9200", "2025-06-15": "0.9100" });
      const trades: Trade[] = [
        makeTrade({
          tradeID: "1", tradeDate: "2025-03-15", quantity: "-10", tradePrice: "100",
          buySell: "SELL", openCloseIndicator: "O",
        }),
        makeTrade({
          tradeID: "2", tradeDate: "2025-06-15", quantity: "10", tradePrice: "130",
          buySell: "BUY", openCloseIndicator: "C",
        }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates);

      expect(disposals).toHaveLength(1);
      const d = disposals[0]!;
      expect(d.isShort).toBe(true);
      // Short gain computed in USD, converted at the CLOSE-date rate (0.91):
      // open proceeds = 10 * 100 * 0.91 = 910
      expect(d.proceedsEur.toFixed(2)).toBe("910.00");
      // close cost = 10 * 130 * 0.91 = 1183
      expect(d.costBasisEur.toFixed(2)).toBe("1183.00");
      // loss in USD = 1000 - 1300 = -300, × 0.91 = -273.00
      expect(d.gainLossEur.toFixed(2)).toBe("-273.00");
    });

    it("should consume short lots in FIFO order", () => {
      const rates = makeRateMap({
        "2025-01-10": "0.9000", "2025-03-15": "0.9200", "2025-06-15": "0.9100",
      });
      const trades: Trade[] = [
        makeTrade({
          tradeID: "1", tradeDate: "2025-01-10", quantity: "-5", tradePrice: "100",
          buySell: "SELL", openCloseIndicator: "O",
        }),
        makeTrade({
          tradeID: "2", tradeDate: "2025-03-15", quantity: "-5", tradePrice: "110",
          buySell: "SELL", openCloseIndicator: "O",
        }),
        makeTrade({
          tradeID: "3", tradeDate: "2025-06-15", quantity: "10", tradePrice: "90",
          buySell: "BUY", openCloseIndicator: "C",
        }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates);

      expect(disposals).toHaveLength(2);
      // First disposal consumes the Jan short lot
      expect(disposals[0]!.acquireDate).toBe("2025-01-10");
      // Open proceeds converted at the CLOSE-date rate (0.91): 5*100*0.91
      expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("455.00");
      // Second disposal consumes the Mar short lot
      expect(disposals[1]!.acquireDate).toBe("2025-03-15");
      expect(disposals[1]!.proceedsEur.toFixed(2)).toBe("500.50"); // 5*110*0.91
    });

    it("should fall back to addLot when BUY+C has no short lots", () => {
      const rates = makeRateMap({ "2025-03-15": "0.9200", "2025-06-15": "0.9100" });
      const trades: Trade[] = [
        makeTrade({
          tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100",
          buySell: "BUY", openCloseIndicator: "C",
        }),
        makeTrade({
          tradeID: "2", tradeDate: "2025-06-15", quantity: "-10", tradePrice: "120",
          buySell: "SELL", openCloseIndicator: "C",
        }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates);

      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.isShort).toBeUndefined();
    });

    it("should handle partial close of short position", () => {
      const rates = makeRateMap({ "2025-03-15": "0.9200", "2025-06-15": "0.9100" });
      const trades: Trade[] = [
        makeTrade({
          tradeID: "1", tradeDate: "2025-03-15", quantity: "-10", tradePrice: "100",
          buySell: "SELL", openCloseIndicator: "O",
        }),
        makeTrade({
          tradeID: "2", tradeDate: "2025-06-15", quantity: "4", tradePrice: "90",
          buySell: "BUY", openCloseIndicator: "C",
        }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates);

      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.quantity.toNumber()).toBe(4);
      expect(disposals[0]!.isShort).toBe(true);
    });

    it("should handle short option with multiplier", () => {
      const rates = makeRateMap({ "2025-03-15": "0.9200", "2025-06-15": "0.9100" });
      const trades: Trade[] = [
        makeTrade({
          tradeID: "1", tradeDate: "2025-03-15", assetCategory: "OPT",
          quantity: "-1", tradePrice: "5", multiplier: "100",
          buySell: "SELL", openCloseIndicator: "O",
        }),
        makeTrade({
          tradeID: "2", tradeDate: "2025-06-15", assetCategory: "OPT",
          quantity: "1", tradePrice: "2", multiplier: "100",
          buySell: "BUY", openCloseIndicator: "C",
        }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates);

      expect(disposals).toHaveLength(1);
      const d = disposals[0]!;
      expect(d.isShort).toBe(true);
      // Short gain computed in USD, converted at the CLOSE-date rate (0.91):
      // open proceeds = 1 * 5 * 100 * 0.91 = 455
      expect(d.proceedsEur.toFixed(2)).toBe("455.00");
      // close cost = 1 * 2 * 100 * 0.91 = 182
      expect(d.costBasisEur.toFixed(2)).toBe("182.00");
      // gain in USD = 500 - 200 = 300, × 0.91 = 273.00
      expect(d.gainLossEur.toFixed(2)).toBe("273.00");
    });

    it("should handle short option expiring worthless (BUY+C at price 0)", () => {
      const rates = makeRateMap({ "2025-03-15": "0.9200", "2025-06-20": "0.9100" });
      const trades: Trade[] = [
        makeTrade({
          tradeID: "1", tradeDate: "2025-03-15", assetCategory: "OPT",
          quantity: "-1", tradePrice: "3.50", multiplier: "100",
          buySell: "SELL", openCloseIndicator: "O",
        }),
        makeTrade({
          tradeID: "2", tradeDate: "2025-06-20", assetCategory: "OPT",
          quantity: "1", tradePrice: "0", multiplier: "100",
          buySell: "BUY", openCloseIndicator: "C",
        }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates);

      expect(disposals).toHaveLength(1);
      const d = disposals[0]!;
      expect(d.isShort).toBe(true);
      // Short gain converted at the CLOSE-date rate (0.91, DGT V2422-20):
      // open proceeds = 1 * 3.50 * 100 * 0.91 = 318.50
      expect(d.proceedsEur.toFixed(2)).toBe("318.50");
      // close cost = 1 * 0 * 100 * 0.91 = 0
      expect(d.costBasisEur.toFixed(2)).toBe("0.00");
      // gain = full premium in USD (350) × 0.91 = 318.50
      expect(d.gainLossEur.toFixed(2)).toBe("318.50");
    });
  });

  describe("Same-day SELL and BUY ordering", () => {
    it("should consume the oldest lot first even when a same-day BUY exists", () => {
      // Older lot from January, then on the SAME day a BUY (10 @ 200) and a
      // SELL (10) occur. FIFO must consume the oldest (January) lot, NOT the
      // fresh same-day repurchase. The same-day buy is a valid lot but sits at
      // the back of the FIFO queue.
      const rates = makeRateMap({
        "2025-01-10": "0.90",
        "2025-06-15": "0.91",
      });

      const trades: Trade[] = [
        makeTrade({ tradeID: "1", tradeDate: "2025-01-10", quantity: "10", tradePrice: "100", buySell: "BUY" }),
        makeTrade({ tradeID: "2", tradeDate: "2025-06-15", quantity: "10", tradePrice: "200", buySell: "BUY" }),
        makeTrade({ tradeID: "3", tradeDate: "2025-06-15", quantity: "-10", tradePrice: "210", buySell: "SELL" }),
      ];

      const engine = new FifoEngine();
      const disposals = engine.processTrades(trades, rates);

      // One disposal, fully satisfied by the January lot (oldest acquisition)
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.acquireDate).toBe("2025-01-10");
      expect(disposals[0]!.quantity.toString()).toBe("10");
      // Cost basis = January lot in USD (1000), converted at the SALE-date rate
      // (0.91, DGT V2422-20): 10 × 100 × 0.91 = 910.00 (not the 200-priced same-day buy)
      expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("910.00");

      // The same-day BUY lot remains untouched (10 @ 200)
      const remaining = engine.getRemainingLots().get("US0378331005") ?? [];
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.quantity.toString()).toBe("10");
      expect(remaining[0]!.acquireDate).toBe("2025-06-15");
    });
  });

  describe("Reverse split cost-basis conservation", () => {
    it("should preserve total cost basis when quantity does not divide evenly", () => {
      // 25 shares with a 1:10 reverse split → 2.5 shares. The fractional
      // remainder must NOT silently lose its cost basis: the surviving lots
      // plus any disposed shares must conserve the original total cost.
      const rates = makeRateMap({ "2024-06-01": "0.92" });

      const trades: Trade[] = [
        makeTrade({ tradeID: "1", isin: "US1234567890", tradeDate: "20240601", quantity: "25", tradePrice: "10", buySell: "BUY" }),
      ];

      const corporateActions: CorporateAction[] = [{
        transactionID: "CA1", accountId: "U1", symbol: "TEST", isin: "US1234567890",
        description: "TEST(US1234567890) SPLIT 1 FOR 10", currency: "USD",
        reportDate: "20240807", dateTime: "20240807", quantity: "0", amount: "0",
        type: "FS", actionDescription: "",
      }];

      const engine = new FifoEngine();
      engine.processTrades(trades, rates, corporateActions);

      // Original total cost in USD (FCY): 25 × 10 = 250.00 USD
      const remaining = engine.getRemainingLots().get("US1234567890") ?? [];
      // 2.5 shares → 2 whole shares survive, 0.5 becomes cash-in-lieu
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.quantity.toString()).toBe("2.5");
      // Total cost basis (in FCY/USD) must be fully conserved on the surviving lot
      expect(remaining[0]!.costInFcy.toFixed(2)).toBe("250.00");
    });
  });
});

describe("FCY-denominated stock gain (DGT V2422-20 / V0152-26, issue #219)", () => {
  it("yields 0 EUR gain when a USD stock is sold flat in USD despite an FX rate change", () => {
    // The V2422-20 worked example: buy 10 GOOG @120 USD (1200 USD), sell 10 @120
    // USD (1200 USD). Stock P&L in USD = 0 → EUR gain MUST be 0, even though the
    // USD/EUR rate moved 1.3 → 1.5 between buy and sell. The FX move is a SEPARATE
    // currency gain (Art. 33, handled by the FX engine), not a stock gain.
    const rates = makeRateMap({
      "2025-10-08": "1.30", // buy date
      "2025-10-15": "1.50", // sell date (rate moved, must NOT leak into stock gain)
    });
    const engine = new FifoEngine();
    engine.processTrades(
      [
        makeTrade({ symbol: "GOOG", isin: "US02079K1079", buySell: "BUY", openCloseIndicator: "O",
          tradeDate: "2025-10-08", quantity: "10", tradePrice: "120", currency: "USD" }),
        makeTrade({ symbol: "GOOG", isin: "US02079K1079", buySell: "SELL", openCloseIndicator: "C",
          tradeDate: "2025-10-15", quantity: "10", tradePrice: "120", currency: "USD" }),
      ],
      rates, [], [],
    );
    const disposals = engine.getDisposals();
    expect(disposals).toHaveLength(1);
    const d = disposals[0]!;
    // Gain in the share currency is exactly 0 → EUR gain is exactly 0.
    expect(d.gainLossFcy.toFixed(2)).toBe("0.00");
    expect(d.gainLossEur.toFixed(2)).toBe("0.00");
    // proceeds and cost are presented at the SAME (sale-date) rate, so
    // proceedsEur - costBasisEur === gainLossEur exactly.
    expect(d.proceedsEur.minus(d.costBasisEur).toFixed(2)).toBe("0.00");
    expect(d.proceedsEur.toFixed(2)).toBe("1800.00"); // 1200 USD × 1.50
    expect(d.costBasisEur.toFixed(2)).toBe("1800.00"); // 1200 USD × 1.50 (sale-date rate)
  });

  it("converts a real USD stock gain at the sale-date rate (not the buy-date rate)", () => {
    // Buy 10 @100 USD (1000 USD), sell 10 @130 USD (1300 USD) → +300 USD stock gain.
    // Convert the DIFFERENCE at the sale-date rate: 300 × 1.10 = 330 EUR.
    const rates = makeRateMap({ "2025-03-15": "0.90", "2025-09-20": "1.10" });
    const engine = new FifoEngine();
    engine.processTrades(
      [
        makeTrade({ buySell: "BUY", openCloseIndicator: "O", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100", currency: "USD" }),
        makeTrade({ buySell: "SELL", openCloseIndicator: "C", tradeDate: "2025-09-20", quantity: "10", tradePrice: "130", currency: "USD" }),
      ],
      rates, [], [],
    );
    const d = engine.getDisposals()[0]!;
    expect(d.gainLossFcy.toFixed(2)).toBe("300.00");
    expect(d.gainLossEur.toFixed(2)).toBe("330.00");
  });

  it("converts every FIFO lot's FCY cost at the SINGLE sale-date rate", () => {
    // Two lots bought at very different rates (0.80, 1.20); both must convert at
    // the ONE sale-date rate (1.00), never at their own buy rates — the crux of
    // V2422-20. Old method would mix per-lot buy rates into the EUR cost.
    const rates = makeRateMap({ "2025-01-10": "0.80", "2025-03-15": "1.20", "2025-09-20": "1.00" });
    const engine = new FifoEngine();
    const ds = engine.processTrades(
      [
        makeTrade({ tradeID: "1", tradeDate: "2025-01-10", quantity: "5", tradePrice: "100", buySell: "BUY" }),
        makeTrade({ tradeID: "2", tradeDate: "2025-03-15", quantity: "5", tradePrice: "100", buySell: "BUY" }),
        makeTrade({ tradeID: "3", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "150", buySell: "SELL" }),
      ],
      rates, [], [],
    );
    expect(ds).toHaveLength(2);
    for (const d of ds) {
      expect(d.costBasisFcy.toFixed(2)).toBe("500.00"); // 5 × 100 USD
      expect(d.costBasisEur.toFixed(2)).toBe("500.00"); // × 1.00 sale rate (NOT 0.80/1.20)
      expect(d.proceedsFcy.toFixed(2)).toBe("750.00");
      expect(d.gainLossEur.toFixed(2)).toBe("250.00"); // 250 USD × 1.00
    }
  });

  it("converts an FCY LOSS at the sale-date rate (not the buy rate)", () => {
    // Buy 10 @100 USD (1000 USD), sell 10 @70 USD (700 USD) → −300 USD; rate 0.90→1.10.
    const rates = makeRateMap({ "2025-03-15": "0.90", "2025-09-20": "1.10" });
    const d = new FifoEngine().processTrades(
      [
        makeTrade({ buySell: "BUY", openCloseIndicator: "O", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100", currency: "USD" }),
        makeTrade({ buySell: "SELL", openCloseIndicator: "C", tradeDate: "2025-09-20", quantity: "10", tradePrice: "70", currency: "USD" }),
      ],
      rates, [], [],
    )[0]!;
    expect(d.gainLossFcy.toFixed(2)).toBe("-300.00");
    // −300 × 1.10 = −330. Old buy/sell-mixed method gave 770−900 = −130 → fails on revert.
    expect(d.gainLossEur.toFixed(2)).toBe("-330.00");
  });
});
