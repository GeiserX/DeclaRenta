import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { FifoEngine } from "../../src/engine/fifo.js";
import { FxFifoEngine } from "../../src/engine/fx-fifo.js";
import type { Trade } from "../../src/types/ibkr.js";

describe("brokerSource traceability", () => {
  it("propagates brokerSource from Trade to FifoDisposal in FifoEngine", () => {
    const buy: Trade = {
      tradeID: "buy-1",
      accountId: "ACC1",
      symbol: "TEST",
      description: "Test Stock",
      isin: "US0000000001",
      assetCategory: "STK",
      currency: "EUR",
      tradeDate: "20240115",
      settlementDate: "20240115",
      quantity: "10",
      tradePrice: "100",
      tradeMoney: "-1000",
      proceeds: "0",
      cost: "-1000",
      fifoPnlRealized: "0",
      fxRateToBase: "1",
      buySell: "BUY",
      openCloseIndicator: "O",
      exchange: "TEST",
      commissionCurrency: "EUR",
      commission: "0",
      taxes: "0",
      multiplier: "1",
      brokerSource: "Degiro",
    };

    const sell: Trade = {
      tradeID: "sell-1",
      accountId: "ACC1",
      symbol: "TEST",
      description: "Test Stock",
      isin: "US0000000001",
      assetCategory: "STK",
      currency: "EUR",
      tradeDate: "20240615",
      settlementDate: "20240615",
      quantity: "-10",
      tradePrice: "120",
      tradeMoney: "1200",
      proceeds: "1200",
      cost: "0",
      fifoPnlRealized: "0",
      fxRateToBase: "1",
      buySell: "SELL",
      openCloseIndicator: "C",
      exchange: "TEST",
      commissionCurrency: "EUR",
      commission: "0",
      taxes: "0",
      multiplier: "1",
      brokerSource: "Degiro",
    };

    const engine = new FifoEngine();
    engine.processTrades([buy, sell], new Map());
    const disposals = engine.getDisposals();

    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.brokerSource).toBe("Degiro");
  });

  it("propagates brokerSource to FxLot and FxDisposal in FxFifoEngine", () => {
    const engine = new FxFifoEngine();
    engine.enableTrace();
    engine.processEvents([
      {
        date: "2024-01-15",
        currency: "USD",
        quantity: new Decimal(1000),
        ecbRate: new Decimal("0.90"),
        trigger: "conversion",
        brokerSource: "IBKR",
      },
      {
        date: "2024-06-15",
        currency: "USD",
        quantity: new Decimal(-500),
        ecbRate: new Decimal("0.95"),
        trigger: "conversion",
        brokerSource: "IBKR",
      },
    ]);

    const disposals = engine.getDisposals();
    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.brokerSource).toBe("IBKR");

    const trace = engine.getTrace();
    expect(trace.length).toBeGreaterThanOrEqual(2);
    expect(trace[0]!.brokerSource).toBe("IBKR");
    expect(trace[1]!.brokerSource).toBe("IBKR");
  });

  it("propagates brokerSource when disposing without prior lots in FxFifoEngine", () => {
    const engine = new FxFifoEngine();
    engine.processEvents([
      {
        date: "2024-06-15",
        currency: "USD",
        quantity: new Decimal(-500),
        ecbRate: new Decimal("0.95"),
        trigger: "conversion",
        brokerSource: "IBKR",
      },
    ]);
    const disposals = engine.getDisposals();
    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.brokerSource).toBe("IBKR");
  });
});
