import { describe, it, expect } from "vitest";
import { FifoEngine } from "../../src/engine/fifo.js";
import type { Trade, CorporateAction } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

function makeTrade(overrides: Partial<Trade>): Trade {
  return {
    tradeID: "T1",
    accountId: "",
    symbol: "AAPL",
    description: "APPLE INC",
    isin: "US0378331005",
    assetCategory: "STK",
    currency: "EUR",
    tradeDate: "20250315",
    settlementDate: "20250315",
    quantity: "10",
    tradePrice: "100",
    tradeMoney: "1000",
    proceeds: "0",
    cost: "1000",
    fifoPnlRealized: "0",
    fxRateToBase: "1",
    buySell: "BUY",
    openCloseIndicator: "O",
    exchange: "XETR",
    commissionCurrency: "EUR",
    commission: "-1",
    taxes: "0",
    multiplier: "1",
    ...overrides,
  };
}

describe("FifoEngine - merger simple format (TC with isin+quantity)", () => {
  it("should process simple merger corporate action (no regex match)", () => {
    const rateMap = makeRateMap({ "2025-03-15": { EUR: "1" }, "2025-06-01": { EUR: "1" } });
    const engine = new FifoEngine();

    const trades: Trade[] = [
      makeTrade({ tradeID: "T1", tradeDate: "20250315", buySell: "BUY", quantity: "10", tradePrice: "100" }),
    ];

    // TC action with quantity and isin but no regex-matching description
    const corporateActions: CorporateAction[] = [
      {
        transactionID: "CA001",
        accountId: "",
        symbol: "NEWCO",
        description: "SIMPLE ACQUISITION",
        isin: "US0378331005",
        currency: "EUR",
        reportDate: "20250601",
        dateTime: "20250601120000",
        quantity: "10",
        amount: "0",
        type: "TC",
        actionDescription: "SIMPLE ACQUISITION",
      },
    ];

    const disposals = engine.processTrades(trades, rateMap, corporateActions);
    // No disposals from just a buy + merger
    expect(disposals).toHaveLength(0);
    // The lots should have been processed (merger applied)
    expect(engine.warnings.some((w) => w.includes("Fusión"))).toBe(true);
  });

  it("should skip TC action with zero quantity", () => {
    const rateMap = makeRateMap({ "2025-03-15": { EUR: "1" } });
    const engine = new FifoEngine();

    const trades: Trade[] = [
      makeTrade({ tradeID: "T1", tradeDate: "20250315", buySell: "BUY", quantity: "10" }),
    ];

    const corporateActions: CorporateAction[] = [
      {
        transactionID: "CA001",
        accountId: "",
        symbol: "NEWCO",
        description: "ZERO QTY ACTION",
        isin: "US0378331005",
        currency: "EUR",
        reportDate: "20250601",
        dateTime: "20250601120000",
        quantity: "0",
        amount: "0",
        type: "TC",
        actionDescription: "ZERO QTY",
      },
    ];

    engine.processTrades(trades, rateMap, corporateActions);
    // No merger warning since quantity is zero
    expect(engine.warnings.filter((w) => w.includes("Fusión"))).toHaveLength(0);
  });
});

describe("FifoEngine - unknown asset category warning", () => {
  it("should warn on unknown asset category and still process", () => {
    const rateMap = makeRateMap({ "2025-03-15": { EUR: "1" }, "2025-09-15": { EUR: "1" } });
    const engine = new FifoEngine();

    const trades: Trade[] = [
      makeTrade({ tradeID: "T1", assetCategory: "NEWTYPE" as Trade["assetCategory"], buySell: "BUY", quantity: "10" }),
      makeTrade({ tradeID: "T2", assetCategory: "NEWTYPE" as Trade["assetCategory"], tradeDate: "20250915", buySell: "SELL", quantity: "-10", tradePrice: "110" }),
    ];

    const disposals = engine.processTrades(trades, rateMap);
    expect(engine.warnings.some((w) => w.includes("Categoría de activo desconocida"))).toBe(true);
    expect(disposals.length).toBeGreaterThan(0);
  });
});

describe("FifoEngine - WAR and CASH filtering", () => {
  it("should skip WAR (warrants) trades", () => {
    const rateMap = makeRateMap({ "2025-03-15": { EUR: "1" } });
    const engine = new FifoEngine();

    const trades: Trade[] = [
      makeTrade({ tradeID: "W1", assetCategory: "WAR", buySell: "BUY", quantity: "100" }),
    ];

    engine.processTrades(trades, rateMap);
    expect(engine.getRemainingLots().size).toBe(0);
  });

  it("should skip CASH (FX conversions) trades", () => {
    const rateMap = makeRateMap({ "2025-03-15": { EUR: "1" } });
    const engine = new FifoEngine();

    const trades: Trade[] = [
      makeTrade({ tradeID: "C1", assetCategory: "CASH", buySell: "BUY", quantity: "1000" }),
    ];

    engine.processTrades(trades, rateMap);
    expect(engine.getRemainingLots().size).toBe(0);
  });
});

describe("FifoEngine - sell with no lots (short sale)", () => {
  it("should warn and record disposal with zero cost basis", () => {
    const rateMap = makeRateMap({ "2025-03-15": { EUR: "1" } });
    const engine = new FifoEngine();

    const trades: Trade[] = [
      makeTrade({ tradeID: "S1", buySell: "SELL", quantity: "-10", tradePrice: "100" }),
    ];

    const disposals = engine.processTrades(trades, rateMap);
    expect(disposals).toHaveLength(1);
    expect(disposals[0].costBasisEur.toNumber()).toBe(0);
    expect(engine.warnings.some((w) => w.includes("Venta sin lotes"))).toBe(true);
  });
});

describe("FifoEngine - insufficient lots", () => {
  it("should warn on partial lot shortfall", () => {
    const rateMap = makeRateMap({ "2025-03-15": { EUR: "1" }, "2025-09-15": { EUR: "1" } });
    const engine = new FifoEngine();

    const trades: Trade[] = [
      makeTrade({ tradeID: "B1", buySell: "BUY", quantity: "5", tradePrice: "100" }),
      makeTrade({ tradeID: "S1", tradeDate: "20250915", buySell: "SELL", quantity: "-10", tradePrice: "110" }),
    ];

    const disposals = engine.processTrades(trades, rateMap);
    // Should have two disposals: one consuming the 5 lots, one for the remaining 5
    expect(disposals).toHaveLength(2);
    expect(engine.warnings.some((w) => w.includes("Lotes insuficientes"))).toBe(true);
  });
});

describe("FifoEngine - commission currency differs from trade currency", () => {
  it("should use separate ECB rate for commission in different currency", () => {
    const rateMap = makeRateMap({
      "2025-03-15": { USD: "0.92", GBP: "1.15" },
      "2025-09-15": { USD: "0.92", GBP: "1.15" },
    });
    const engine = new FifoEngine();

    const trades: Trade[] = [
      makeTrade({
        tradeID: "B1", currency: "USD", commissionCurrency: "GBP", commission: "-1",
        buySell: "BUY", quantity: "10", tradePrice: "100",
      }),
      makeTrade({
        tradeID: "S1", tradeDate: "20250915", currency: "USD", commissionCurrency: "GBP", commission: "-1",
        buySell: "SELL", quantity: "-10", tradePrice: "110",
      }),
    ];

    const disposals = engine.processTrades(trades, rateMap);
    expect(disposals).toHaveLength(1);
  });
});

describe("FifoEngine - lotKey with conid", () => {
  it("should use conid for lot grouping when no ISIN", () => {
    const rateMap = makeRateMap({ "2025-03-15": { EUR: "1" }, "2025-09-15": { EUR: "1" } });
    const engine = new FifoEngine();

    const trades: Trade[] = [
      makeTrade({ tradeID: "B1", isin: "", conid: "12345", buySell: "BUY", quantity: "10" }),
      makeTrade({ tradeID: "S1", tradeDate: "20250915", isin: "", conid: "12345", buySell: "SELL", quantity: "-10", tradePrice: "110" }),
    ];

    const disposals = engine.processTrades(trades, rateMap);
    expect(disposals).toHaveLength(1);
  });

  it("should use assetCategory:symbol for lot grouping when no ISIN and no conid", () => {
    const rateMap = makeRateMap({ "2025-03-15": { EUR: "1" }, "2025-09-15": { EUR: "1" } });
    const engine = new FifoEngine();

    const trades: Trade[] = [
      makeTrade({ tradeID: "B1", isin: "", symbol: "BTC", assetCategory: "CRYPTO", buySell: "BUY", quantity: "1" }),
      makeTrade({ tradeID: "S1", tradeDate: "20250915", isin: "", symbol: "BTC", assetCategory: "CRYPTO", buySell: "SELL", quantity: "-1", tradePrice: "110" }),
    ];

    const disposals = engine.processTrades(trades, rateMap);
    expect(disposals).toHaveLength(1);
  });
});

describe("FifoEngine - split with fractional share removal", () => {
  it("should remove sub-share lots after reverse split", () => {
    const rateMap = makeRateMap({ "2025-03-15": { EUR: "1" } });
    const engine = new FifoEngine();

    // Buy 3 shares, then reverse split 1:4 (0.25 ratio) → 0.75 shares per lot
    const trades: Trade[] = [
      makeTrade({ tradeID: "B1", buySell: "BUY", quantity: "3", tradePrice: "100" }),
    ];

    const corporateActions: CorporateAction[] = [
      {
        transactionID: "SP001",
        accountId: "",
        symbol: "AAPL",
        description: "AAPL(US0378331005) SPLIT 1 FOR 4",
        isin: "US0378331005",
        currency: "EUR",
        reportDate: "20250601",
        dateTime: "20250601120000",
        quantity: "0",
        amount: "0",
        type: "FS",
        actionDescription: "SPLIT 1 FOR 4",
      },
    ];

    engine.processTrades(trades, rateMap, corporateActions);
    // After 1:4 reverse split, 3 shares * 0.25 = 0.75 — less than 1, should be removed
    const lots = engine.getRemainingLots();
    const lotArr = lots.get("US0378331005") ?? [];
    expect(lotArr).toHaveLength(0);
  });
});

describe("FifoEngine - trades with taxes field", () => {
  it("should handle non-zero taxes in buy and sell trades", () => {
    const rateMap = makeRateMap({ "2025-03-15": { EUR: "1" }, "2025-09-15": { EUR: "1" } });
    const engine = new FifoEngine();

    const trades: Trade[] = [
      makeTrade({ tradeID: "B1", buySell: "BUY", quantity: "10", taxes: "5" }),
      makeTrade({ tradeID: "S1", tradeDate: "20250915", buySell: "SELL", quantity: "-10", tradePrice: "110", taxes: "3" }),
    ];

    const disposals = engine.processTrades(trades, rateMap);
    expect(disposals).toHaveLength(1);
  });
});
