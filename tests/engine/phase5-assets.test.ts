import { describe, it, expect } from "vitest";
import { FifoEngine } from "../../src/engine/fifo.js";
import { detectWashSales } from "../../src/engine/wash-sale.js";
import type { Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

function makeTrade(overrides: Partial<Trade>): Trade {
  return {
    tradeID: "1", accountId: "U1", symbol: "AAPL", description: "APPLE INC",
    isin: "US0378331005", assetCategory: "STK", currency: "USD",
    tradeDate: "2025-03-15", settlementDate: "2025-03-18",
    quantity: "10", tradePrice: "100", tradeMoney: "1000",
    proceeds: "1000", cost: "1000", fifoPnlRealized: "0",
    fxRateToBase: "0.92", buySell: "BUY", openCloseIndicator: "O",
    exchange: "NASDAQ", commissionCurrency: "USD", commission: "0",
    taxes: "0", multiplier: "1", ...overrides,
  };
}

function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

// ---------------------------------------------------------------------------
// 1. Futures (FUT)
// ---------------------------------------------------------------------------
describe("Phase 5 — Futures (FUT)", () => {
  it("should calculate gain with multiplier on ES futures", () => {
    const rates = makeRateMap({
      "2025-03-15": { "USD": "0.92" },
      "2025-09-20": { "USD": "0.92" },
    });

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", symbol: "ESU5", isin: "", assetCategory: "FUT",
        tradeDate: "2025-03-15", quantity: "5", tradePrice: "5000",
        multiplier: "50", buySell: "BUY",
      }),
      makeTrade({
        tradeID: "2", symbol: "ESU5", isin: "", assetCategory: "FUT",
        tradeDate: "2025-09-20", quantity: "-5", tradePrice: "5100",
        multiplier: "50", buySell: "SELL",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    const d = disposals[0]!;

    // Cost: 5 * 5000 * 50 * 0.92 = 1,150,000 EUR
    expect(d.costBasisEur.toFixed(2)).toBe("1150000.00");
    // Proceeds: 5 * 5100 * 50 * 0.92 = 1,173,000 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("1173000.00");
    // Gain: 1,173,000 - 1,150,000 = 23,000 EUR
    expect(d.gainLossEur.toFixed(2)).toBe("23000.00");
    expect(d.assetCategory).toBe("FUT");
  });

  it("should key futures lots by symbol (not empty ISIN)", () => {
    const rates = makeRateMap({
      "2025-03-15": { "USD": "0.92" },
      "2025-09-20": { "USD": "0.92" },
    });

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", symbol: "ESU5", isin: "", assetCategory: "FUT",
        tradeDate: "2025-03-15", quantity: "2", tradePrice: "5000",
        multiplier: "50", buySell: "BUY",
      }),
      // Different symbol — should NOT share lots
      makeTrade({
        tradeID: "2", symbol: "NQU5", isin: "", assetCategory: "FUT",
        tradeDate: "2025-03-15", quantity: "2", tradePrice: "18000",
        multiplier: "20", buySell: "BUY",
      }),
      // Sell ESU5 — should match only ESU5 lots
      makeTrade({
        tradeID: "3", symbol: "ESU5", isin: "", assetCategory: "FUT",
        tradeDate: "2025-09-20", quantity: "-2", tradePrice: "5100",
        multiplier: "50", buySell: "SELL",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.symbol).toBe("ESU5");
    expect(engine.warnings).toHaveLength(0);

    // NQ lots should remain untouched (keyed by assetCategory:symbol when ISIN is empty)
    const nqLots = engine.getRemainingLots().get("FUT:NQU5") ?? [];
    expect(nqLots).toHaveLength(1);
    expect(nqLots[0]!.quantity.toNumber()).toBe(2);
  });

  it("should NOT apply anti-churning to futures losses", () => {
    const rates = makeRateMap({
      "2025-03-15": { "USD": "0.92" },
      "2025-06-15": { "USD": "0.92" },
      "2025-07-01": { "USD": "0.92" },
    });

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", symbol: "ESU5", isin: "", assetCategory: "FUT",
        tradeDate: "2025-03-15", quantity: "5", tradePrice: "5000",
        multiplier: "50", buySell: "BUY",
      }),
      // Sell at a loss
      makeTrade({
        tradeID: "2", symbol: "ESU5", isin: "", assetCategory: "FUT",
        tradeDate: "2025-06-15", quantity: "-5", tradePrice: "4900",
        multiplier: "50", buySell: "SELL",
      }),
      // Repurchase within 2 months
      makeTrade({
        tradeID: "3", symbol: "ESU5", isin: "", assetCategory: "FUT",
        tradeDate: "2025-07-01", quantity: "5", tradePrice: "4950",
        multiplier: "50", buySell: "BUY",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);
    const checked = detectWashSales(disposals, trades);

    expect(checked).toHaveLength(1);
    // Loss: (4900-5000)*5*50*0.92 = -23,000 EUR
    expect(checked[0]!.gainLossEur.toFixed(2)).toBe("-23000.00");
    // Futures are NOT "valores homogeneos" — anti-churning must NOT block
    expect(checked[0]!.washSaleBlocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Bonds (BOND)
// ---------------------------------------------------------------------------
describe("Phase 5 — Bonds (BOND)", () => {
  it("should calculate bond gain with ECB rates", () => {
    const rates = makeRateMap({
      "2025-02-01": { "USD": "0.92" },
      "2025-08-01": { "USD": "0.91" },
    });

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", symbol: "T 4.25 02/15/54", isin: "US912828ZT58",
        assetCategory: "BOND", tradeDate: "2025-02-01",
        quantity: "10", tradePrice: "98", multiplier: "1", buySell: "BUY",
      }),
      makeTrade({
        tradeID: "2", symbol: "T 4.25 02/15/54", isin: "US912828ZT58",
        assetCategory: "BOND", tradeDate: "2025-08-01",
        quantity: "-10", tradePrice: "102", multiplier: "1", buySell: "SELL",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    const d = disposals[0]!;

    // Cost: 10 * 98 * 1 * 0.92 = 901.60 EUR
    expect(d.costBasisEur.toFixed(2)).toBe("901.60");
    // Proceeds: 10 * 102 * 1 * 0.91 = 928.20 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("928.20");
    // Gain: 928.20 - 901.60 = 26.60 EUR
    expect(d.gainLossEur.toFixed(2)).toBe("26.60");
    expect(d.assetCategory).toBe("BOND");
  });

  it("should apply anti-churning to bond losses (valores homogeneos)", () => {
    const rates = makeRateMap({
      "2025-02-01": { "USD": "0.92" },
      "2025-06-15": { "USD": "0.92" },
      "2025-07-01": { "USD": "0.92" },
    });

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", isin: "US912828ZT58", assetCategory: "BOND",
        tradeDate: "2025-02-01", quantity: "10", tradePrice: "100",
        multiplier: "1", buySell: "BUY",
      }),
      // Sell at a loss
      makeTrade({
        tradeID: "2", isin: "US912828ZT58", assetCategory: "BOND",
        tradeDate: "2025-06-15", quantity: "-10", tradePrice: "90",
        multiplier: "1", buySell: "SELL",
      }),
      // Repurchase within 2 months
      makeTrade({
        tradeID: "3", isin: "US912828ZT58", assetCategory: "BOND",
        tradeDate: "2025-07-01", quantity: "10", tradePrice: "92",
        multiplier: "1", buySell: "BUY",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);
    const checked = detectWashSales(disposals, trades);

    expect(checked).toHaveLength(1);
    // Loss: (90-100)*10*1*0.92 = -92.00 EUR
    expect(checked[0]!.gainLossEur.toFixed(2)).toBe("-92.00");
    // Bonds ARE "valores homogeneos" — anti-churning MUST block this loss
    expect(checked[0]!.washSaleBlocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Forex / CASH — excluded from FIFO processing
// FX gain/loss is already embedded in securities trades via ECB rate conversion.
// Processing CASH separately would double-count forex movements.
// ---------------------------------------------------------------------------
describe("Phase 5 — Forex / CASH", () => {
  it("should exclude CASH trades from FIFO (no disposals)", () => {
    const rates = makeRateMap({
      "2025-03-15": { "GBP": "1.15" },
      "2025-09-20": { "GBP": "1.18" },
    });

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", symbol: "GBP.USD", isin: "", assetCategory: "CASH",
        currency: "GBP", tradeDate: "2025-03-15",
        quantity: "10000", tradePrice: "1", multiplier: "1", buySell: "BUY",
        commissionCurrency: "GBP", commission: "0",
      }),
      makeTrade({
        tradeID: "2", symbol: "GBP.USD", isin: "", assetCategory: "CASH",
        currency: "GBP", tradeDate: "2025-09-20",
        quantity: "-10000", tradePrice: "1", multiplier: "1", buySell: "SELL",
        commissionCurrency: "GBP", commission: "0",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    // CASH trades are filtered out — FX gain/loss is captured via ECB rates on securities
    expect(disposals).toHaveLength(0);
    expect(engine.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. CFDs
// ---------------------------------------------------------------------------
describe("Phase 5 — CFDs", () => {
  it("should calculate CFD gain on DAX contract", () => {
    const rates = makeRateMap({
      "2025-04-01": { "EUR": "1" },
      "2025-06-01": { "EUR": "1" },
    });

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", symbol: "DAX", isin: "", assetCategory: "CFD",
        currency: "EUR", tradeDate: "2025-04-01",
        quantity: "100", tradePrice: "18000", multiplier: "1", buySell: "BUY",
        commissionCurrency: "EUR", commission: "0",
      }),
      makeTrade({
        tradeID: "2", symbol: "DAX", isin: "", assetCategory: "CFD",
        currency: "EUR", tradeDate: "2025-06-01",
        quantity: "-100", tradePrice: "18500", multiplier: "1", buySell: "SELL",
        commissionCurrency: "EUR", commission: "0",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    const d = disposals[0]!;

    // Cost: 100 * 18000 * 1 * 1 = 1,800,000 EUR
    expect(d.costBasisEur.toFixed(2)).toBe("1800000.00");
    // Proceeds: 100 * 18500 * 1 * 1 = 1,850,000 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("1850000.00");
    // Gain: 1,850,000 - 1,800,000 = 50,000 EUR
    expect(d.gainLossEur.toFixed(2)).toBe("50000.00");
    expect(d.assetCategory).toBe("CFD");
  });

  it("should NOT apply anti-churning to CFD losses", () => {
    const rates = makeRateMap({
      "2025-04-01": { "USD": "0.92" },
      "2025-06-15": { "USD": "0.92" },
      "2025-07-01": { "USD": "0.92" },
    });

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", symbol: "AAPL.CFD", isin: "", assetCategory: "CFD",
        tradeDate: "2025-04-01", quantity: "100", tradePrice: "200",
        multiplier: "1", buySell: "BUY",
      }),
      // Sell at a loss
      makeTrade({
        tradeID: "2", symbol: "AAPL.CFD", isin: "", assetCategory: "CFD",
        tradeDate: "2025-06-15", quantity: "-100", tradePrice: "190",
        multiplier: "1", buySell: "SELL",
      }),
      // Repurchase within 2 months
      makeTrade({
        tradeID: "3", symbol: "AAPL.CFD", isin: "", assetCategory: "CFD",
        tradeDate: "2025-07-01", quantity: "100", tradePrice: "192",
        multiplier: "1", buySell: "BUY",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);
    const checked = detectWashSales(disposals, trades);

    expect(checked).toHaveLength(1);
    // Loss: (190-200)*100*1*0.92 = -920.00 EUR
    expect(checked[0]!.gainLossEur.toFixed(2)).toBe("-920.00");
    // CFDs are NOT "valores homogeneos" — must NOT block
    expect(checked[0]!.washSaleBlocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Options exercise/expiration (OPT)
// ---------------------------------------------------------------------------
describe("Phase 5 — Options (OPT)", () => {
  it("should calculate gain on call option close with multiplier", () => {
    const rates = makeRateMap({
      "2025-02-01": { "USD": "0.92" },
      "2025-04-01": { "USD": "0.91" },
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
    const d = disposals[0]!;

    // Cost: 5 * 3.00 * 100 * 0.92 = 1,380.00 EUR
    expect(d.costBasisEur.toFixed(2)).toBe("1380.00");
    // Proceeds: 5 * 5.00 * 100 * 0.91 = 2,275.00 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("2275.00");
    // Gain: 2275 - 1380 = 895.00 EUR
    expect(d.gainLossEur.toFixed(2)).toBe("895.00");
    expect(d.assetCategory).toBe("OPT");
  });

  it("should calculate total loss when put option expires worthless", () => {
    const rates = makeRateMap({
      "2025-02-01": { "USD": "0.92" },
      "2025-06-20": { "USD": "0.92" },
    });

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", symbol: "AAPL  250620P00180000", isin: "",
        assetCategory: "OPT", tradeDate: "2025-02-01",
        quantity: "3", tradePrice: "4.50", multiplier: "100", buySell: "BUY",
      }),
      // Expires worthless — sold at $0
      makeTrade({
        tradeID: "2", symbol: "AAPL  250620P00180000", isin: "",
        assetCategory: "OPT", tradeDate: "2025-06-20",
        quantity: "-3", tradePrice: "0.00", multiplier: "100", buySell: "SELL",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    const d = disposals[0]!;

    // Cost: 3 * 4.50 * 100 * 0.92 = 1,242.00 EUR
    expect(d.costBasisEur.toFixed(2)).toBe("1242.00");
    // Proceeds: 3 * 0 * 100 * 0.92 = 0.00 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("0.00");
    // Total loss = -1,242.00 EUR (entire premium lost)
    expect(d.gainLossEur.toFixed(2)).toBe("-1242.00");
  });

  it("should NOT apply anti-churning to option losses", () => {
    const rates = makeRateMap({
      "2025-02-01": { "USD": "0.92" },
      "2025-06-20": { "USD": "0.92" },
      "2025-07-01": { "USD": "0.92" },
    });

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", symbol: "AAPL  250620P00180000", isin: "",
        assetCategory: "OPT", tradeDate: "2025-02-01",
        quantity: "3", tradePrice: "4.50", multiplier: "100", buySell: "BUY",
      }),
      makeTrade({
        tradeID: "2", symbol: "AAPL  250620P00180000", isin: "",
        assetCategory: "OPT", tradeDate: "2025-06-20",
        quantity: "-3", tradePrice: "0.00", multiplier: "100", buySell: "SELL",
      }),
      // Buy new put within 2 months
      makeTrade({
        tradeID: "3", symbol: "AAPL  250620P00180000", isin: "",
        assetCategory: "OPT", tradeDate: "2025-07-01",
        quantity: "3", tradePrice: "2.00", multiplier: "100", buySell: "BUY",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);
    const checked = detectWashSales(disposals, trades);

    expect(checked).toHaveLength(1);
    expect(checked[0]!.gainLossEur.toFixed(2)).toBe("-1242.00");
    // Options are NOT "valores homogeneos" — must NOT block
    expect(checked[0]!.washSaleBlocked).toBe(false);
  });

  it("should NOT apply anti-churning to crypto losses", () => {
    const rates = makeRateMap({
      "2025-03-01": { "USD": "0.92" },
      "2025-06-01": { "USD": "0.91" },
      "2025-06-15": { "USD": "0.91" },
    });

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", symbol: "BTC", isin: "",
        assetCategory: "CRYPTO", tradeDate: "2025-03-01",
        quantity: "1", tradePrice: "60000", buySell: "BUY",
      }),
      makeTrade({
        tradeID: "2", symbol: "BTC", isin: "",
        assetCategory: "CRYPTO", tradeDate: "2025-06-01",
        quantity: "-1", tradePrice: "50000", buySell: "SELL",
      }),
      // Repurchase within 2 months
      makeTrade({
        tradeID: "3", symbol: "BTC", isin: "",
        assetCategory: "CRYPTO", tradeDate: "2025-06-15",
        quantity: "1", tradePrice: "51000", buySell: "BUY",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);
    const checked = detectWashSales(disposals, trades);

    expect(checked).toHaveLength(1);
    // Crypto is NOT "valores homogeneos" — must NOT block
    expect(checked[0]!.washSaleBlocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Multi-divisa (cross-currency commissions)
// ---------------------------------------------------------------------------
describe("Phase 5 — Multi-divisa (cross-currency)", () => {
  it("should convert GBP stock with USD commission using separate ECB rates", () => {
    const rates = makeRateMap({
      "2025-03-15": { "GBP": "1.15", "USD": "0.92" },
      "2025-09-20": { "GBP": "1.13", "USD": "0.91" },
    });

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", symbol: "SHEL", isin: "GB00BP6MXD84",
        currency: "GBP", commissionCurrency: "USD",
        tradeDate: "2025-03-15", quantity: "100", tradePrice: "25",
        multiplier: "1", buySell: "BUY", commission: "-10",
      }),
      makeTrade({
        tradeID: "2", symbol: "SHEL", isin: "GB00BP6MXD84",
        currency: "GBP", commissionCurrency: "USD",
        tradeDate: "2025-09-20", quantity: "-100", tradePrice: "28",
        multiplier: "1", buySell: "SELL", commission: "-10",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    const d = disposals[0]!;

    // Buy cost: (100 * 25 * 1 * 1.15) + (10 * 0.92) = 2875.00 + 9.20 = 2884.20 EUR
    expect(d.costBasisEur.toFixed(2)).toBe("2884.20");
    // Sell proceeds: (100 * 28 * 1 * 1.13) - (10 * 0.91) = 3164.00 - 9.10 = 3154.90 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("3154.90");
    // Gain: 3154.90 - 2884.20 = 270.70 EUR
    expect(d.gainLossEur.toFixed(2)).toBe("270.70");

    // ECB rates should reflect trade currency (GBP), not commission currency
    expect(d.acquireEcbRate.toFixed(4)).toBe("1.1500");
    expect(d.sellEcbRate.toFixed(4)).toBe("1.1300");
    expect(d.currency).toBe("GBP");
  });

  it("should handle EUR stock with USD commission", () => {
    const rates = makeRateMap({
      "2025-03-15": { "USD": "0.92" },
      "2025-09-20": { "USD": "0.91" },
    });

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", symbol: "SAP", isin: "DE0007164600",
        currency: "EUR", commissionCurrency: "USD",
        tradeDate: "2025-03-15", quantity: "50", tradePrice: "200",
        multiplier: "1", buySell: "BUY", commission: "-5",
      }),
      makeTrade({
        tradeID: "2", symbol: "SAP", isin: "DE0007164600",
        currency: "EUR", commissionCurrency: "USD",
        tradeDate: "2025-09-20", quantity: "-50", tradePrice: "210",
        multiplier: "1", buySell: "SELL", commission: "-5",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    const d = disposals[0]!;

    // Buy cost: (50 * 200 * 1 * 1) + (5 * 0.92) = 10000 + 4.60 = 10004.60 EUR
    expect(d.costBasisEur.toFixed(2)).toBe("10004.60");
    // Sell proceeds: (50 * 210 * 1 * 1) - (5 * 0.91) = 10500 - 4.55 = 10495.45 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("10495.45");
    // Gain: 10495.45 - 10004.60 = 490.85 EUR
    expect(d.gainLossEur.toFixed(2)).toBe("490.85");
  });
});

// ---------------------------------------------------------------------------
// 7. Short positions
// ---------------------------------------------------------------------------
describe("Phase 5 — Short positions", () => {
  it("should warn and use zero cost basis for short sale (sell first)", () => {
    const rates = makeRateMap({
      "2025-03-15": { "USD": "0.92" },
      "2025-06-15": { "USD": "0.91" },
    });

    const trades: Trade[] = [
      // Sell first — no lots exist
      makeTrade({
        tradeID: "1", tradeDate: "2025-03-15",
        quantity: "-50", tradePrice: "150", buySell: "SELL",
      }),
      // Buy to cover later
      makeTrade({
        tradeID: "2", tradeDate: "2025-06-15",
        quantity: "50", tradePrice: "140", buySell: "BUY",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    const d = disposals[0]!;

    // Short sale: costBasis = 0 (no lots to consume)
    expect(d.costBasisEur.toFixed(2)).toBe("0.00");
    // Proceeds: 50 * 150 * 1 * 0.92 = 6,900.00 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("6900.00");
    // Gain = proceeds (since cost = 0)
    expect(d.gainLossEur.toFixed(2)).toBe("6900.00");

    // Should have warning about missing lots
    expect(engine.warnings).toHaveLength(1);
    expect(engine.warnings[0]).toContain("Venta sin lotes");

    // The buy-to-cover creates a lot that remains unconsumed
    const remaining = engine.getRemainingLots().get("US0378331005") ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.quantity.toNumber()).toBe(50);
  });

  it("should warn when selling more shares than available lots", () => {
    const rates = makeRateMap({
      "2025-03-15": { "USD": "0.92" },
      "2025-09-20": { "USD": "0.91" },
    });

    const trades: Trade[] = [
      makeTrade({
        tradeID: "1", tradeDate: "2025-03-15",
        quantity: "10", tradePrice: "100", buySell: "BUY",
      }),
      // Sell 25 but only 10 lots available
      makeTrade({
        tradeID: "2", tradeDate: "2025-09-20",
        quantity: "-25", tradePrice: "120", buySell: "SELL",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    // 2 disposals: 10 from lot + 15 from insufficient-lots fallback
    expect(disposals).toHaveLength(2);

    // First disposal: 10 shares consumed from lot
    expect(disposals[0]!.quantity.toNumber()).toBe(10);
    // Cost: 10 * 100 * 0.92 = 920.00 EUR
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("920.00");
    // Proceeds: (10 * 120) * 0.91 * (10/25) share... actually full per consumed
    // Proceeds: 10/25 fraction of total: (10 * 120 * 0.91) = 1092 * (10/25)...
    // No: proceeds per consumed = consumed * price * mult * ecbRate - commShare
    // = (10 * 120 * 1 * 0.91) - 0 = 1092.00 EUR... but with fractional commission
    // Commission is 0, taxes is 0, so: proceeds = 10 * 120 * 1 * 0.91 = 1092.00
    // BUT fractionOfSale = 10/25 = 0.4, commissionShare = 0*0.4 = 0, taxesShare = 0
    // proceedsBaseEur = 10 * 120 * 1 * 0.91 = 1092; no taxes/comm deductions
    // Wait — re-reading code: proceedsBaseEur = consumed * price * mult - taxesShare) * ecbRate
    // = (10 * 120 * 1 - 0) * 0.91 = 1092.00. Then - commissionShare = 0.
    expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("1092.00");

    // Second disposal: 15 shares with zero cost basis (insufficient lots)
    expect(disposals[1]!.quantity.toNumber()).toBe(15);
    expect(disposals[1]!.costBasisEur.toFixed(2)).toBe("0.00");
    // Proceeds: (15 * 120 * 1 - 0) * 0.91 = 1638.00 EUR
    expect(disposals[1]!.proceedsEur.toFixed(2)).toBe("1638.00");

    // Should have warning about insufficient lots
    expect(engine.warnings).toHaveLength(1);
    expect(engine.warnings[0]).toContain("Lotes insuficientes");
  });

  it("should handle short CFD with zero-cost warning", () => {
    const rates = makeRateMap({
      "2025-04-01": { "USD": "0.92" },
      "2025-06-01": { "USD": "0.92" },
    });

    const trades: Trade[] = [
      // Short CFD — sell first
      makeTrade({
        tradeID: "1", symbol: "TSLA.CFD", isin: "", assetCategory: "CFD",
        tradeDate: "2025-04-01", quantity: "-50", tradePrice: "250",
        multiplier: "1", buySell: "SELL",
      }),
      // Buy to cover
      makeTrade({
        tradeID: "2", symbol: "TSLA.CFD", isin: "", assetCategory: "CFD",
        tradeDate: "2025-06-01", quantity: "50", tradePrice: "230",
        multiplier: "1", buySell: "BUY",
      }),
    ];

    const engine = new FifoEngine();
    const disposals = engine.processTrades(trades, rates);

    expect(disposals).toHaveLength(1);
    const d = disposals[0]!;

    expect(d.costBasisEur.toFixed(2)).toBe("0.00");
    // Proceeds: 50 * 250 * 1 * 0.92 = 11,500 EUR
    expect(d.proceedsEur.toFixed(2)).toBe("11500.00");
    expect(d.assetCategory).toBe("CFD");
    expect(engine.warnings).toHaveLength(1);
    expect(engine.warnings[0]).toContain("Venta sin lotes");
  });
});
