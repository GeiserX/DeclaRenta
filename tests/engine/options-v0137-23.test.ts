import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { FifoEngine } from "../../src/engine/fifo.js";
import type { Trade, OptionExercise } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

const rateMap: EcbRateMap = new Map([
  ["2025-01-10", new Map([["USD", new Decimal("0.92")]])],
  ["2025-01-15", new Map([["USD", new Decimal("0.92")]])],
  ["2025-02-01", new Map([["USD", new Decimal("0.93")]])],
  ["2025-03-15", new Map([["USD", new Decimal("0.94")]])],
  ["2025-03-21", new Map([["USD", new Decimal("0.94")]])],
  ["2025-06-20", new Map([["USD", new Decimal("0.95")]])],
  ["2025-06-21", new Map([["USD", new Decimal("0.95")]])],
]);

function makeOptionTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    tradeID: "1",
    accountId: "U1",
    symbol: "AAPL 250321C00200000",
    description: "AAPL 21MAR25 200 C",
    isin: "",
    assetCategory: "OPT",
    currency: "USD",
    tradeDate: "20250115",
    settlementDate: "20250117",
    quantity: "1",
    tradePrice: "5.50",
    tradeMoney: "550",
    proceeds: "0",
    cost: "550",
    fifoPnlRealized: "0",
    fxRateToBase: "0.92",
    buySell: "BUY",
    openCloseIndicator: "O",
    exchange: "CBOE",
    commissionCurrency: "USD",
    commission: "1.50",
    taxes: "0",
    multiplier: "100",
    putCall: "C",
    strike: "200",
    expiry: "20250321",
    underlyingSymbol: "AAPL",
    underlyingIsin: "US0378331005",
    ...overrides,
  };
}

function makeStockTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    tradeID: "2",
    accountId: "U1",
    symbol: "AAPL",
    description: "APPLE INC",
    isin: "US0378331005",
    assetCategory: "STK",
    currency: "USD",
    tradeDate: "20250110",
    settlementDate: "20250112",
    quantity: "100",
    tradePrice: "180",
    tradeMoney: "18000",
    proceeds: "0",
    cost: "18000",
    fifoPnlRealized: "0",
    fxRateToBase: "0.92",
    buySell: "BUY",
    openCloseIndicator: "O",
    exchange: "NASDAQ",
    commissionCurrency: "USD",
    commission: "1",
    taxes: "0",
    multiplier: "1",
    ...overrides,
  };
}

function makeExercise(overrides: Partial<OptionExercise> = {}): OptionExercise {
  return {
    transactionID: "100",
    accountId: "U1",
    symbol: "AAPL 250321C00200000",
    description: "AAPL 21MAR25 200 C",
    isin: "",
    currency: "USD",
    date: "20250321",
    action: "Exercise",
    putCall: "C",
    strike: "200",
    expiry: "20250321",
    quantity: "1",
    proceeds: "0",
    underlyingSymbol: "AAPL",
    underlyingIsin: "US0378331005",
    multiplier: "100",
    ...overrides,
  };
}

describe("Options taxation — DGT V0137-23 (Art. 37.1.m LIRPF)", () => {
  describe("Scenario 1: Expiration", () => {
    it("buyer: option expires worthless → full premium loss", () => {
      const engine = new FifoEngine();
      engine.processTrades([makeOptionTrade()], rateMap);

      engine.processOptionExercises([
        makeExercise({ action: "Expiration", quantity: "1" }),
      ], rateMap);

      const disposals = engine.getDisposals();
      expect(disposals).toHaveLength(1);

      const d = disposals[0]!;
      expect(d.assetCategory).toBe("OPT");
      expect(d.optionScenario).toBe("expiration");
      expect(d.putCall).toBe("C");
      expect(d.strike).toBe("200");
      expect(d.proceedsEur.toFixed(2)).toBe("0.00");
      // Cost = 1 contract × $5.50 × 100 multiplier × 0.92 + $1.50 commission × 0.92
      // = 550 * 0.92 + 1.50 * 0.92 = 506.00 + 1.38 = 507.38
      expect(d.costBasisEur.toFixed(2)).toBe("507.38");
      expect(d.gainLossEur.toFixed(2)).toBe("-507.38");
    });

    it("writer: option expires worthless → full premium gain", () => {
      const engine = new FifoEngine();
      // Writer sells (writes) option: SELL+O
      engine.processTrades([makeOptionTrade({
        buySell: "SELL",
        openCloseIndicator: "O",
        tradePrice: "5.50",
        quantity: "1",
      })], rateMap);

      engine.processOptionExercises([
        makeExercise({ action: "Expiration", quantity: "1" }),
      ], rateMap);

      const disposals = engine.getDisposals();
      expect(disposals).toHaveLength(1);

      const d = disposals[0]!;
      expect(d.assetCategory).toBe("OPT");
      expect(d.optionScenario).toBe("expiration");
      expect(d.isShort).toBe(true);
      // Writer received premium: 1 × 5.50 × 100 × 0.92 - 1.50 × 0.92 = 506.00 - 1.38 = 504.62
      expect(d.proceedsEur.toFixed(2)).toBe("504.62");
      expect(d.costBasisEur.toFixed(2)).toBe("0.00");
      expect(d.gainLossEur.toFixed(2)).toBe("504.62");
    });
  });

  describe("Scenario 2: Early close (opposite trade)", () => {
    it("buyer closes with SELL+C → gain/loss on premium difference", () => {
      const engine = new FifoEngine();
      // Buy option at $5.50
      engine.processTrades([
        makeOptionTrade({ tradeDate: "20250115" }),
        // Sell to close at $8.00 two months later
        makeOptionTrade({
          tradeID: "3",
          buySell: "SELL",
          openCloseIndicator: "C",
          tradeDate: "20250315",
          tradePrice: "8.00",
          tradeMoney: "800",
          commission: "1.50",
        }),
      ], rateMap);

      const disposals = engine.getDisposals();
      expect(disposals).toHaveLength(1);

      const d = disposals[0]!;
      expect(d.assetCategory).toBe("OPT");
      expect(d.optionScenario).toBe("close");
      expect(d.putCall).toBe("C");
      // Proceeds: 1 × 8.00 × 100 × 0.94 - 1.50 × 0.94 = 752.00 - 1.41 = 750.59
      expect(d.proceedsEur.toFixed(2)).toBe("750.59");
      // Cost: 507.38 (as calculated above)
      expect(d.costBasisEur.toFixed(2)).toBe("507.38");
      expect(d.gainLossEur.greaterThan(0)).toBe(true);
    });

    it("writer closes with BUY+C → gain/loss on premium difference", () => {
      const engine = new FifoEngine();
      // Write (sell) option at $5.50
      engine.processTrades([
        makeOptionTrade({
          buySell: "SELL",
          openCloseIndicator: "O",
          tradeDate: "20250115",
        }),
        // Buy to close at $3.00 (profit for writer)
        makeOptionTrade({
          tradeID: "4",
          buySell: "BUY",
          openCloseIndicator: "C",
          tradeDate: "20250201",
          tradePrice: "3.00",
          tradeMoney: "300",
          commission: "1.50",
        }),
      ], rateMap);

      const disposals = engine.getDisposals();
      expect(disposals).toHaveLength(1);

      const d = disposals[0]!;
      expect(d.isShort).toBe(true);
      expect(d.assetCategory).toBe("OPT");
      // Writer opened at $5.50: proceeds = 504.62 (premium received minus commission)
      // Writer closed at $3.00: cost = 1 × 3.00 × 100 × 0.93 + 1.50 × 0.93 = 279.00 + 1.395 = 280.395
      expect(d.proceedsEur.toFixed(2)).toBe("504.62");
      expect(d.gainLossEur.greaterThan(0)).toBe(true);
    });
  });

  describe("Scenario 3: Exercise with physical delivery (V0137-23)", () => {
    it("call buyer exercises → no separate OPT disposal, premium integrates into share cost", () => {
      const engine = new FifoEngine();
      engine.processTrades([makeOptionTrade()], rateMap);

      engine.processOptionExercises([makeExercise()], rateMap);

      const disposals = engine.getDisposals();
      // V0137-23: no separate option disposal on exercise
      expect(disposals).toHaveLength(0);

      // Shares acquired with cost = strike × shares × ecbRate + premium
      const lots = engine.getRemainingLots().get("US0378331005");
      expect(lots).toHaveLength(1);
      expect(lots![0]!.quantity.toString()).toBe("100");
      expect(lots![0]!.pricePerShare.toString()).toBe("200");
      // Cost > bare strike cost (18800) because premium is integrated
      const bareStrikeCost = new Decimal("18800");
      expect(lots![0]!.costInEur.greaterThan(bareStrikeCost)).toBe(true);
    });

    it("call buyer exercises with marketPrice → uses market price, not strike", () => {
      const engine = new FifoEngine();
      engine.processTrades([makeOptionTrade()], rateMap);

      // Market price $220 (higher than $200 strike)
      engine.processOptionExercises([makeExercise({ marketPrice: "220" })], rateMap);

      const disposals = engine.getDisposals();
      expect(disposals).toHaveLength(0);

      const lots = engine.getRemainingLots().get("US0378331005");
      expect(lots).toHaveLength(1);
      expect(lots![0]!.pricePerShare.toString()).toBe("220");
      // Base cost: 100 × $220 × 0.94 = 20680, plus premium
      const bareMarketCost = new Decimal("20680");
      expect(lots![0]!.costInEur.greaterThan(bareMarketCost)).toBe(true);
    });

    it("put buyer exercises → no OPT disposal, premium reduces sale proceeds", () => {
      const engine = new FifoEngine();
      engine.processTrades([
        makeStockTrade(),
        makeOptionTrade({
          tradeID: "5",
          symbol: "AAPL 250321P00200000",
          description: "AAPL 21MAR25 200 P",
          putCall: "P",
          tradeDate: "20250115",
        }),
      ], rateMap);

      engine.processOptionExercises([
        makeExercise({
          action: "Exercise",
          putCall: "P",
          symbol: "AAPL 250321P00200000",
          description: "AAPL 21MAR25 200 P",
        }),
      ], rateMap);

      const disposals = engine.getDisposals();
      // Only STK disposal (share sale), no separate OPT disposal
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.assetCategory).toBe("STK");
      expect(disposals[0]!.symbol).toBe("AAPL");
      expect(disposals[0]!.quantity.toString()).toBe("100");
      // Proceeds < bare strike proceeds (18800) because premium is subtracted
      const bareStrikeProceeds = new Decimal("18800");
      expect(disposals[0]!.proceedsEur.lessThan(bareStrikeProceeds)).toBe(true);
      expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("16560.92");
    });

    it("call writer assigned → no OPT disposal, premium adds to sale proceeds", () => {
      const engine = new FifoEngine();
      engine.processTrades([
        makeStockTrade(),
        makeOptionTrade({
          tradeID: "6",
          buySell: "SELL",
          openCloseIndicator: "O",
          tradeDate: "20250115",
        }),
      ], rateMap);

      engine.processOptionExercises([
        makeExercise({ action: "Assignment", quantity: "1" }),
      ], rateMap);

      const disposals = engine.getDisposals();
      // Only STK disposal (share delivery), no separate OPT disposal
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.assetCategory).toBe("STK");
      expect(disposals[0]!.symbol).toBe("AAPL");
      expect(disposals[0]!.quantity.toString()).toBe("100");
      // Proceeds > bare strike proceeds (18800) because premium is added
      const bareStrikeProceeds = new Decimal("18800");
      expect(disposals[0]!.proceedsEur.greaterThan(bareStrikeProceeds)).toBe(true);
    });

    it("put writer assigned → no OPT disposal, premium reduces share cost", () => {
      const engine = new FifoEngine();
      engine.processTrades([
        makeOptionTrade({
          tradeID: "7",
          symbol: "AAPL 250321P00200000",
          description: "AAPL 21MAR25 200 P",
          putCall: "P",
          buySell: "SELL",
          openCloseIndicator: "O",
          tradeDate: "20250115",
        }),
      ], rateMap);

      engine.processOptionExercises([
        makeExercise({
          action: "Assignment",
          putCall: "P",
          symbol: "AAPL 250321P00200000",
          description: "AAPL 21MAR25 200 P",
        }),
      ], rateMap);

      const disposals = engine.getDisposals();
      // No disposals — shares are acquired into lots
      expect(disposals).toHaveLength(0);

      // Shares acquired with cost = strike × shares × rate - premium
      const lots = engine.getRemainingLots().get("US0378331005");
      expect(lots).toHaveLength(1);
      expect(lots![0]!.quantity.toString()).toBe("100");
      expect(lots![0]!.pricePerShare.toString()).toBe("200");
      // Cost < bare strike cost (18800) because writer's premium reduces it
      const bareStrikeCost = new Decimal("18800");
      expect(lots![0]!.costInEur.lessThan(bareStrikeCost)).toBe(true);
    });
  });

  describe("Anti-churning exemption", () => {
    it("OPT is exempt from wash sale rule (Art. 33.5.f)", () => {
      const engine = new FifoEngine();
      // Buy and sell option at a loss, then buy again immediately
      engine.processTrades([
        makeOptionTrade({ tradeDate: "20250115" }),
        makeOptionTrade({
          tradeID: "8",
          buySell: "SELL",
          openCloseIndicator: "C",
          tradeDate: "20250201",
          tradePrice: "3.00",
          tradeMoney: "300",
          commission: "1.50",
        }),
        makeOptionTrade({
          tradeID: "9",
          buySell: "BUY",
          openCloseIndicator: "O",
          tradeDate: "20250201",
          tradePrice: "2.80",
          tradeMoney: "280",
          commission: "1.50",
        }),
      ], rateMap);

      const disposals = engine.getDisposals();
      expect(disposals).toHaveLength(1);
      // OPT is in WASH_SALE_EXEMPT set, so washSaleBlocked stays false
      expect(disposals[0]!.washSaleBlocked).toBe(false);
      expect(disposals[0]!.assetCategory).toBe("OPT");
    });
  });

  describe("Edge cases", () => {
    it("exercise without prior option lots emits warning but creates underlying", () => {
      const engine = new FifoEngine();
      engine.processTrades([], rateMap);

      engine.processOptionExercises([makeExercise()], rateMap);

      expect(engine.warnings.some((w) => w.includes("sin lotes de opción"))).toBe(true);
      const lots = engine.getRemainingLots().get("US0378331005");
      expect(lots).toHaveLength(1);
      expect(lots![0]!.quantity.toString()).toBe("100");
    });

    it("multiple contracts partially expired", () => {
      const engine = new FifoEngine();
      // Buy 3 contracts
      engine.processTrades([
        makeOptionTrade({ quantity: "3", tradeMoney: "1650" }),
      ], rateMap);

      // Only 2 expire (1 was closed separately via trade)
      engine.processOptionExercises([
        makeExercise({ action: "Expiration", quantity: "2" }),
      ], rateMap);

      const disposals = engine.getDisposals();
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.quantity.toString()).toBe("2");
      expect(disposals[0]!.optionScenario).toBe("expiration");

      // 1 contract remains in lots
      const key = `OPT:${makeOptionTrade().symbol}`;
      const remaining = engine.getRemainingLots().get(key);
      expect(remaining).toHaveLength(1);
      expect(remaining![0]!.quantity.toString()).toBe("1");
    });

    it("option fields propagate to disposal on early close", () => {
      const engine = new FifoEngine();
      engine.processTrades([
        makeOptionTrade(),
        makeOptionTrade({
          tradeID: "10",
          buySell: "SELL",
          openCloseIndicator: "C",
          tradeDate: "20250201",
          tradePrice: "7.00",
          tradeMoney: "700",
        }),
      ], rateMap);

      const d = engine.getDisposals()[0]!;
      expect(d.optionScenario).toBe("close");
      expect(d.putCall).toBe("C");
      expect(d.strike).toBe("200");
      expect(d.expiry).toBe("20250321");
      expect(d.underlyingSymbol).toBe("AAPL");
      expect(d.underlyingIsin).toBe("US0378331005");
    });
  });
});
