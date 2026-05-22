import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { FxFifoEngine } from "../../src/engine/fx-fifo.js";
import type { FxEvent } from "../../src/engine/fx-fifo.js";
import type { Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

function makeEvent(overrides: Partial<FxEvent> = {}): FxEvent {
  return {
    date: "2025-03-15",
    currency: "USD",
    quantity: new Decimal(1000),
    ecbRate: new Decimal("0.92"),
    trigger: "conversion",
    ...overrides,
  };
}

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    tradeID: "1",
    accountId: "U1",
    symbol: "EUR.USD",
    description: "",
    isin: "",
    assetCategory: "CASH",
    currency: "USD",
    tradeDate: "20250315",
    settlementDate: "20250317",
    quantity: "1000",
    tradePrice: "1.08",
    tradeMoney: "1080",
    proceeds: "0",
    cost: "0",
    fifoPnlRealized: "0",
    fxRateToBase: "0.92",
    buySell: "BUY",
    openCloseIndicator: "O",
    exchange: "IDEALFX",
    commissionCurrency: "USD",
    commission: "2",
    taxes: "0",
    multiplier: "1",
    ...overrides,
  };
}

const rateMap: EcbRateMap = new Map([
  ["2025-03-15", new Map([["USD", new Decimal("0.92")]])],
  ["2025-03-14", new Map([["USD", new Decimal("0.92")]])],
  ["2025-06-15", new Map([["USD", new Decimal("0.95")]])],
  ["2025-06-14", new Map([["USD", new Decimal("0.95")]])],
  ["2025-09-01", new Map([["USD", new Decimal("0.90")]])],
]);

describe("FxFifoEngine", () => {
  describe("processEvents", () => {
    it("should create lot on positive quantity (acquiring FCY)", () => {
      const engine = new FxFifoEngine();
      engine.processEvents([makeEvent()]);

      const lots = engine.getRemainingLots().get("USD");
      expect(lots).toHaveLength(1);
      expect(lots![0]!.quantity.toString()).toBe("1000");
      expect(lots![0]!.costPerUnit.toString()).toBe("0.92");
    });

    it("should consume lots on negative quantity (disposing FCY)", () => {
      const engine = new FxFifoEngine();
      engine.processEvents([
        makeEvent({ quantity: new Decimal(1000) }),
        makeEvent({ date: "2025-06-15", quantity: new Decimal(-500), ecbRate: new Decimal("0.95") }),
      ]);

      const lots = engine.getRemainingLots().get("USD");
      expect(lots).toHaveLength(1);
      expect(lots![0]!.quantity.toString()).toBe("500");

      const disposals = engine.getDisposals();
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.quantity.toString()).toBe("500");
      expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("475.00"); // 500 * 0.95
      expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("460.00"); // 500 * 0.92
      expect(disposals[0]!.gainLossEur.toFixed(2)).toBe("15.00");
    });

    it("should apply FIFO — consume oldest lots first", () => {
      const engine = new FxFifoEngine();
      engine.processEvents([
        makeEvent({ date: "2025-03-15", quantity: new Decimal(1000), ecbRate: new Decimal("0.92") }),
        makeEvent({ date: "2025-06-15", quantity: new Decimal(500), ecbRate: new Decimal("0.95") }),
        makeEvent({ date: "2025-09-01", quantity: new Decimal(-1200), ecbRate: new Decimal("0.90") }),
      ]);

      const disposals = engine.getDisposals();
      expect(disposals).toHaveLength(2);

      // First disposal: 1000 from lot 1 (cost 0.92, proceeds 0.90 → loss)
      expect(disposals[0]!.quantity.toString()).toBe("1000");
      expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("920.00");
      expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("900.00");
      expect(disposals[0]!.gainLossEur.toFixed(2)).toBe("-20.00");

      // Second disposal: 200 from lot 2 (cost 0.95, proceeds 0.90 → loss)
      expect(disposals[1]!.quantity.toString()).toBe("200");
      expect(disposals[1]!.costBasisEur.toFixed(2)).toBe("190.00");
      expect(disposals[1]!.proceedsEur.toFixed(2)).toBe("180.00");
      expect(disposals[1]!.gainLossEur.toFixed(2)).toBe("-10.00");
    });

    it("should skip EUR events", () => {
      const engine = new FxFifoEngine();
      engine.processEvents([makeEvent({ currency: "EUR", quantity: new Decimal(5000) })]);

      expect(engine.getRemainingLots().size).toBe(0);
      expect(engine.getDisposals()).toHaveLength(0);
    });

    it("should warn when disposing without prior lots and record zero-gain disposal", () => {
      const engine = new FxFifoEngine();
      engine.processEvents([
        makeEvent({ quantity: new Decimal(-500), ecbRate: new Decimal("0.95") }),
      ]);

      expect(engine.warnings).toHaveLength(1);
      expect(engine.warnings[0]).toMatch(/sin lotes previos/);
      const disposals = engine.getDisposals();
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.gainLossEur.toFixed(2)).toBe("0.00");
      expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("475.00");
      expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("475.00");
    });

    it("should warn and record zero-gain disposal for insufficient lots", () => {
      const engine = new FxFifoEngine();
      engine.processEvents([
        makeEvent({ quantity: new Decimal(300), ecbRate: new Decimal("0.92") }),
        makeEvent({ date: "2025-06-15", quantity: new Decimal(-500), ecbRate: new Decimal("0.95") }),
      ]);

      const disposals = engine.getDisposals();
      expect(disposals).toHaveLength(2);
      // First: 300 from lot (real gain/loss)
      expect(disposals[0]!.quantity.toString()).toBe("300");
      expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("276.00");
      expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("285.00");
      // Second: 200 overflow — zero gain (cost = proceeds, no phantom profit)
      expect(disposals[1]!.quantity.toString()).toBe("200");
      expect(disposals[1]!.costBasisEur.toFixed(2)).toBe("190.00");
      expect(disposals[1]!.proceedsEur.toFixed(2)).toBe("190.00");
      expect(disposals[1]!.gainLossEur.toFixed(2)).toBe("0.00");
      expect(engine.warnings.some((w) => w.includes("sin lotes previos suficientes"))).toBe(true);
    });

    it("should calculate holding period days correctly", () => {
      const engine = new FxFifoEngine();
      engine.processEvents([
        makeEvent({ date: "2025-03-15", quantity: new Decimal(1000) }),
        makeEvent({ date: "2025-06-15", quantity: new Decimal(-500), ecbRate: new Decimal("0.95") }),
      ]);

      const d = engine.getDisposals()[0]!;
      // Mar 15 to Jun 15 = 92 days
      expect(d.holdingPeriodDays).toBe(92);
    });

    it("should track multiple currencies independently", () => {
      const engine = new FxFifoEngine();
      engine.processEvents([
        makeEvent({ currency: "USD", quantity: new Decimal(1000), ecbRate: new Decimal("0.92") }),
        makeEvent({ currency: "GBP", quantity: new Decimal(500), ecbRate: new Decimal("1.15") }),
        makeEvent({ date: "2025-06-15", currency: "USD", quantity: new Decimal(-1000), ecbRate: new Decimal("0.95") }),
      ]);

      const usdLots = engine.getRemainingLots().get("USD") ?? [];
      const gbpLots = engine.getRemainingLots().get("GBP") ?? [];
      expect(usdLots).toHaveLength(0);
      expect(gbpLots).toHaveLength(1);
      expect(gbpLots[0]!.quantity.toString()).toBe("500");
    });
  });

  describe("extractFxEvents", () => {
    it("should extract BUY CASH as positive FX event", () => {
      const trades = [makeTrade({ buySell: "BUY", quantity: "1000" })];
      const events = FxFifoEngine.extractFxEvents(trades, rateMap);

      expect(events).toHaveLength(1);
      expect(events[0]!.quantity.toString()).toBe("1000");
      expect(events[0]!.trigger).toBe("conversion");
    });

    it("should extract SELL CASH as negative FX event", () => {
      const trades = [makeTrade({ buySell: "SELL", quantity: "1000" })];
      const events = FxFifoEngine.extractFxEvents(trades, rateMap);

      expect(events).toHaveLength(1);
      expect(events[0]!.quantity.toString()).toBe("-1000");
      expect(events[0]!.trigger).toBe("conversion");
    });

    it("should skip FXCONV trades (automatic conversions)", () => {
      const trades = [
        makeTrade({ description: "FXCONV" }),
        makeTrade({ description: "CASH RECEIPTS / DISBURSEMENTS" }),
      ];
      const events = FxFifoEngine.extractFxEvents(trades, rateMap);
      expect(events).toHaveLength(0);
    });

    it("should only extract CASH trades, ignoring STK trades entirely", () => {
      const trades = [
        makeTrade({ assetCategory: "CASH", description: "EUR.USD", buySell: "BUY", quantity: "10000", currency: "USD" }),
        makeTrade({ assetCategory: "STK", symbol: "AAPL", buySell: "BUY", tradeMoney: "5000", currency: "USD" }),
      ];
      const events = FxFifoEngine.extractFxEvents(trades, rateMap);

      expect(events).toHaveLength(1);
      expect(events[0]!.trigger).toBe("conversion");
      expect(events[0]!.quantity.toString()).toBe("10000");
    });

    it("should skip EUR trades", () => {
      const trades = [makeTrade({ currency: "EUR" })];
      const events = FxFifoEngine.extractFxEvents(trades, rateMap);
      expect(events).toHaveLength(0);
    });

    it("should skip non-CASH asset categories", () => {
      const trades = [
        makeTrade({ assetCategory: "STK", currency: "USD", tradeMoney: "5000" }),
        makeTrade({ assetCategory: "WAR", currency: "USD", tradeMoney: "1000" }),
        makeTrade({ assetCategory: "OPT", currency: "USD", tradeMoney: "2000" }),
      ];
      const events = FxFifoEngine.extractFxEvents(trades, rateMap);
      expect(events).toHaveLength(0);
    });
  });

  describe("integration: acquire and dispose", () => {
    it("should produce correct FX gain for a conversion round-trip in USD", () => {
      // Day 1: Convert EUR → USD 1100 (rate 0.92 EUR/USD)
      // Day 30: Convert USD 1100 back (rate 0.95 EUR/USD) — FX gain
      // Day 60: Convert EUR → USD 1200 (rate 0.90 EUR/USD) — new lot
      const engine = new FxFifoEngine();
      engine.processEvents([
        { date: "2025-01-01", currency: "USD", quantity: new Decimal(1100), ecbRate: new Decimal("0.92"), trigger: "conversion" },
        { date: "2025-01-31", currency: "USD", quantity: new Decimal(-1100), ecbRate: new Decimal("0.95"), trigger: "conversion" },
        { date: "2025-03-01", currency: "USD", quantity: new Decimal(1200), ecbRate: new Decimal("0.90"), trigger: "conversion" },
      ]);

      const disposals = engine.getDisposals();
      expect(disposals).toHaveLength(1);

      // FX gain on the disposal:
      // Acquired 1100 USD at 0.92 = cost 1012 EUR
      // Disposed at 0.95 = proceeds 1045 EUR
      // FX gain = 1045 - 1012 = 33 EUR
      expect(disposals[0]!.gainLossEur.toFixed(2)).toBe("33.00");
      expect(disposals[0]!.trigger).toBe("conversion");

      // Remaining: 1200 USD lot from second acquisition at rate 0.90
      const remaining = engine.getRemainingLots().get("USD");
      expect(remaining).toHaveLength(1);
      expect(remaining![0]!.quantity.toString()).toBe("1200");
      expect(remaining![0]!.costPerUnit.toString()).toBe("0.9");

      // Verify lotId traceability
      expect(disposals[0]!.lotId).toBe("FX-1");
    });
  });

  describe("extractCashFxEvents", () => {
    it("should extract dividend as positive FX event (acquiring FCY)", () => {
      const txs = [{
        transactionID: "1", accountId: "U1", symbol: "AAPL", description: "AAPL dividend",
        isin: "US0378331005", currency: "USD", dateTime: "20250315",
        settleDate: "20250317", amount: "100", fxRateToBase: "0.92", type: "Dividends" as const,
      }];
      const events = FxFifoEngine.extractCashFxEvents(txs, rateMap);
      expect(events).toHaveLength(1);
      expect(events[0]!.quantity.toString()).toBe("100");
      expect(events[0]!.trigger).toBe("dividend");
    });

    it("should extract withholding tax as negative FX event (disposing FCY)", () => {
      const txs = [{
        transactionID: "2", accountId: "U1", symbol: "AAPL", description: "US WHT",
        isin: "US0378331005", currency: "USD", dateTime: "20250315",
        settleDate: "20250317", amount: "-15", fxRateToBase: "0.92", type: "Withholding Tax" as const,
      }];
      const events = FxFifoEngine.extractCashFxEvents(txs, rateMap);
      expect(events).toHaveLength(1);
      expect(events[0]!.quantity.toString()).toBe("-15");
      expect(events[0]!.trigger).toBe("dividend");
    });

    it("should extract interest received as positive FX event", () => {
      const txs = [{
        transactionID: "3", accountId: "U1", symbol: "", description: "USD Interest",
        isin: "", currency: "USD", dateTime: "20250315",
        settleDate: "20250317", amount: "25", fxRateToBase: "0.92", type: "Broker Interest Received" as const,
      }];
      const events = FxFifoEngine.extractCashFxEvents(txs, rateMap);
      expect(events).toHaveLength(1);
      expect(events[0]!.quantity.toString()).toBe("25");
      expect(events[0]!.trigger).toBe("interest");
    });

    it("should extract interest paid as negative FX event", () => {
      const txs = [{
        transactionID: "4", accountId: "U1", symbol: "", description: "USD Margin Interest",
        isin: "", currency: "USD", dateTime: "20250315",
        settleDate: "20250317", amount: "-10", fxRateToBase: "0.92", type: "Broker Interest Paid" as const,
      }];
      const events = FxFifoEngine.extractCashFxEvents(txs, rateMap);
      expect(events).toHaveLength(1);
      expect(events[0]!.quantity.toString()).toBe("-10");
      expect(events[0]!.trigger).toBe("interest");
    });

    it("should skip EUR transactions", () => {
      const txs = [{
        transactionID: "5", accountId: "U1", symbol: "VWCE", description: "VWCE dividend",
        isin: "IE00BK5BQT80", currency: "EUR", dateTime: "20250315",
        settleDate: "20250317", amount: "50", fxRateToBase: "1", type: "Dividends" as const,
      }];
      const events = FxFifoEngine.extractCashFxEvents(txs, rateMap);
      expect(events).toHaveLength(0);
    });

    it("should extract fees as negative FX event", () => {
      const txs = [{
        transactionID: "6", accountId: "U1", symbol: "", description: "Other fee",
        isin: "", currency: "USD", dateTime: "20250315",
        settleDate: "20250317", amount: "-5", fxRateToBase: "0.92", type: "Other Fees" as const,
      }];
      const events = FxFifoEngine.extractCashFxEvents(txs, rateMap);
      expect(events).toHaveLength(1);
      expect(events[0]!.quantity.toString()).toBe("-5");
      expect(events[0]!.trigger).toBe("commission");
    });
  });

  describe("lotId traceability", () => {
    it("should assign unique lot IDs and reference them in disposals", () => {
      const engine = new FxFifoEngine();
      engine.processEvents([
        makeEvent({ date: "2025-03-15", quantity: new Decimal(1000), ecbRate: new Decimal("0.92") }),
        makeEvent({ date: "2025-06-15", quantity: new Decimal(500), ecbRate: new Decimal("0.95") }),
        makeEvent({ date: "2025-09-01", quantity: new Decimal(-1200), ecbRate: new Decimal("0.90") }),
      ]);

      const disposals = engine.getDisposals();
      expect(disposals[0]!.lotId).toBe("FX-1");
      expect(disposals[1]!.lotId).toBe("FX-2");
    });
  });

  describe("FXCONV/AFx per-trade filtering", () => {
    it("should skip FXCONV-described CASH trades", () => {
      const trades = [
        makeTrade({ assetCategory: "CASH", description: "FXCONV", currency: "USD" }),
        makeTrade({ assetCategory: "CASH", description: "EUR.USD", buySell: "BUY", quantity: "1000", currency: "USD" }),
      ];
      const events = FxFifoEngine.extractFxEvents(trades, rateMap);
      expect(events).toHaveLength(1);
      expect(events[0]!.quantity.toString()).toBe("1000");
    });

    it("should skip AFx-noted CASH trades", () => {
      const trades = [
        makeTrade({ assetCategory: "CASH", description: "EUR.USD", notes: "AFx", buySell: "BUY", quantity: "1000", currency: "USD" }),
      ];
      const events = FxFifoEngine.extractFxEvents(trades, rateMap);
      expect(events).toHaveLength(0);
    });

    it("should skip AFx;P-noted CASH trades", () => {
      const trades = [
        makeTrade({ assetCategory: "CASH", description: "EUR.USD", notes: "AFx;P", buySell: "BUY", quantity: "500", currency: "USD" }),
      ];
      const events = FxFifoEngine.extractFxEvents(trades, rateMap);
      expect(events).toHaveLength(0);
    });

    it("should skip exchange=FXCONV CASH trades", () => {
      const trades = [
        makeTrade({ assetCategory: "CASH", description: "EUR.USD", exchange: "FXCONV", currency: "USD" }),
      ];
      const events = FxFifoEngine.extractFxEvents(trades, rateMap);
      expect(events).toHaveLength(0);
    });

    it("should NOT skip when notes is empty or undefined", () => {
      const trades = [
        makeTrade({ assetCategory: "CASH", description: "EUR.USD", buySell: "BUY", notes: "", quantity: "1000", currency: "USD" }),
        makeTrade({ assetCategory: "CASH", description: "EUR.USD", buySell: "BUY", notes: undefined, quantity: "2000", currency: "USD" }),
      ];
      const events = FxFifoEngine.extractFxEvents(trades, rateMap);
      expect(events).toHaveLength(2);
    });

    it("should NOT skip when notes contains unrelated values like P", () => {
      const trades = [
        makeTrade({ assetCategory: "CASH", description: "EUR.USD", buySell: "BUY", notes: "P", quantity: "1000", currency: "USD" }),
      ];
      const events = FxFifoEngine.extractFxEvents(trades, rateMap);
      expect(events).toHaveLength(1);
    });

    it("should handle hybrid account: manual conversions processed, AFx skipped", () => {
      const trades = [
        makeTrade({ tradeID: "1", assetCategory: "CASH", description: "EUR.USD", notes: "AFx", buySell: "BUY", quantity: "500", currency: "USD" }),
        makeTrade({ tradeID: "2", assetCategory: "CASH", description: "EUR.USD", buySell: "BUY", quantity: "1000", currency: "USD" }),
        makeTrade({ tradeID: "3", assetCategory: "STK", symbol: "AAPL", buySell: "BUY", tradeMoney: "800", currency: "USD" }),
      ];
      const events = FxFifoEngine.extractFxEvents(trades, rateMap);
      // Only the manual CASH BUY (tradeID 2) generates an event; AFx skipped, STK ignored
      expect(events).toHaveLength(1);
      expect(events[0]!.quantity.toString()).toBe("1000");
      expect(events[0]!.trigger).toBe("conversion");
    });

    it("should produce zero FX events when all CASH trades are AFx", () => {
      const trades = [
        makeTrade({ assetCategory: "CASH", description: "EUR.USD", notes: "AFx", buySell: "BUY", quantity: "5000", currency: "USD" }),
        makeTrade({ assetCategory: "STK", symbol: "AAPL", buySell: "BUY", tradeMoney: "3000", currency: "USD" }),
        makeTrade({ assetCategory: "STK", symbol: "AAPL", buySell: "SELL", tradeMoney: "3500", currency: "USD" }),
      ];
      const events = FxFifoEngine.extractFxEvents(trades, rateMap);
      expect(events).toHaveLength(0);

      const engine = new FxFifoEngine();
      engine.processEvents(events);
      expect(engine.getDisposals()).toHaveLength(0);
    });

    it("should always process cash transactions (dividends create FX lots)", () => {
      const txs = [{
        transactionID: "1", accountId: "U1", symbol: "AAPL", description: "AAPL dividend",
        isin: "US0378331005", currency: "USD", dateTime: "20250315",
        settleDate: "20250317", amount: "100", fxRateToBase: "0.92", type: "Dividends" as const,
      }];
      const events = FxFifoEngine.extractCashFxEvents(txs, rateMap);
      expect(events).toHaveLength(1);
      expect(events[0]!.quantity.toString()).toBe("100");
      expect(events[0]!.trigger).toBe("dividend");
    });
  });
});
