import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { FxFifoEngine } from "../../src/engine/fx-fifo.js";
import type { FxEvent } from "../../src/engine/fx-fifo.js";
import type { FifoDisposal } from "../../src/types/tax.js";

/**
 * Minimal FifoDisposal builder. extractStockProceedsFxEvents only reads
 * currency, assetCategory, proceedsFcy, sellDate and sellEcbRate — the rest are
 * filled with inert values so the object satisfies the interface. Override only
 * the fields a test cares about.
 */
function makeDisposal(overrides: Partial<FifoDisposal> = {}): FifoDisposal {
  return {
    isin: "US0378331005",
    symbol: "AAPL",
    description: "Apple Inc.",
    sellDate: "2025-03-15",
    acquireDate: "2025-01-10",
    quantity: new Decimal(10),
    gainLossFcy: new Decimal(0),
    proceedsFcy: new Decimal(1200),
    costBasisFcy: new Decimal(1000),
    proceedsEur: new Decimal(0),
    costBasisEur: new Decimal(0),
    gainLossEur: new Decimal(0),
    holdingPeriodDays: 64,
    currency: "USD",
    sellEcbRate: new Decimal("0.92"),
    acquireEcbRate: new Decimal("0.90"),
    assetCategory: "STK",
    washSaleBlocked: false,
    ...overrides,
  };
}

describe("FxFifoEngine.extractStockProceedsFxEvents", () => {
  describe("extraction filtering", () => {
    it("a USD STK disposal → one positive stock_sale event (qty = proceedsFcy, sale-date rate)", () => {
      const events = FxFifoEngine.extractStockProceedsFxEvents([
        makeDisposal({
          currency: "USD",
          assetCategory: "STK",
          proceedsFcy: new Decimal(1200),
          sellDate: "2025-03-15",
          sellEcbRate: new Decimal("0.92"),
        }),
      ]);

      expect(events).toHaveLength(1);
      const e = events[0]!;
      expect(e.currency).toBe("USD");
      expect(e.quantity.toString()).toBe("1200"); // FULL net proceeds, NOT the gain
      expect(e.ecbRate.toString()).toBe("0.92"); // sale-date ECB rate
      expect(e.date).toBe("2025-03-15");
      expect(e.trigger).toBe("stock_sale");
      expect(e.quantity.greaterThan(0)).toBe(true); // acquisition (positive)
    });

    it("normalizes an IBKR ;HHMMSS sellDate to YYYY-MM-DD", () => {
      const events = FxFifoEngine.extractStockProceedsFxEvents([
        makeDisposal({ sellDate: "20250315;130630" }),
      ]);
      expect(events).toHaveLength(1);
      expect(events[0]!.date).toBe("2025-03-15");
    });

    it("FUND and BOND disposals also produce stock_sale events", () => {
      const events = FxFifoEngine.extractStockProceedsFxEvents([
        makeDisposal({ assetCategory: "FUND", proceedsFcy: new Decimal(500) }),
        makeDisposal({ assetCategory: "BOND", proceedsFcy: new Decimal(800) }),
      ]);
      expect(events).toHaveLength(2);
      expect(events.map((e) => e.quantity.toString())).toEqual(["500", "800"]);
      expect(events.every((e) => e.trigger === "stock_sale")).toBe(true);
    });

    it("a CRYPTO disposal → NO event (filtered)", () => {
      const events = FxFifoEngine.extractStockProceedsFxEvents([
        makeDisposal({ assetCategory: "CRYPTO", currency: "USD", proceedsFcy: new Decimal(900) }),
      ]);
      expect(events).toHaveLength(0);
    });

    it("an OPT/FOP disposal → NO event (filtered)", () => {
      const events = FxFifoEngine.extractStockProceedsFxEvents([
        makeDisposal({ assetCategory: "OPT", proceedsFcy: new Decimal(700) }),
        makeDisposal({ assetCategory: "FOP", proceedsFcy: new Decimal(700) }),
        makeDisposal({ assetCategory: "CASH", proceedsFcy: new Decimal(700) }),
      ]);
      expect(events).toHaveLength(0);
    });

    it("a EUR disposal → NO event (no FX effect for the home currency)", () => {
      const events = FxFifoEngine.extractStockProceedsFxEvents([
        makeDisposal({ currency: "EUR", assetCategory: "STK", proceedsFcy: new Decimal(1200) }),
      ]);
      expect(events).toHaveLength(0);
    });

    it("a non-resolvable currency → NO event (genuine fiat FCY only)", () => {
      // A coin-denominated proceeds (e.g. a crypto permuta mislabelled, or any
      // currency ECB never quotes) has no ECB rate → cannot enter the FX FIFO.
      const events = FxFifoEngine.extractStockProceedsFxEvents([
        makeDisposal({ currency: "SOL", assetCategory: "STK", proceedsFcy: new Decimal(1200) }),
      ]);
      expect(events).toHaveLength(0);
    });

    it("proceedsFcy = 0 → NO event (defensive non-positive skip)", () => {
      const events = FxFifoEngine.extractStockProceedsFxEvents([
        makeDisposal({ proceedsFcy: new Decimal(0) }),
      ]);
      expect(events).toHaveLength(0);
    });

    it("negative proceedsFcy → NO event (defensive non-positive skip)", () => {
      const events = FxFifoEngine.extractStockProceedsFxEvents([
        makeDisposal({ proceedsFcy: new Decimal("-100") }),
      ]);
      expect(events).toHaveLength(0);
    });
  });

  describe("short-close exclusion (isShort guard)", () => {
    it("a SHORT STK close → NO event (a cover SPENDS FCY; its FifoDisposal carries the OPEN proceeds dated at the CLOSE)", () => {
      // A short cover (BUY+C closing a SELL+O) must NOT seed an acquisition lot.
      // proceedsFcy here is the FCY received when the short was OPENED (possibly a
      // prior year) but the disposal is dated at the CLOSE; booking it as a
      // close-dated acquisition would mis-date, mis-rate, and over-state held FCY.
      const events = FxFifoEngine.extractStockProceedsFxEvents([
        makeDisposal({
          isShort: true,
          assetCategory: "STK",
          currency: "USD",
          proceedsFcy: new Decimal(1200),
        }),
      ]);
      expect(events).toHaveLength(0);
    });

    it("it is SPECIFICALLY isShort doing the exclusion: same disposal long → event, short → none", () => {
      // Two disposals identical in every FX-relevant field (currency, category,
      // proceedsFcy, sellDate, sellEcbRate) — the ONLY difference is isShort. The
      // long one produces an event; the short one is excluded. This isolates the
      // isShort guard from every other filter (currency/category/resolvable/positive).
      const long = FxFifoEngine.extractStockProceedsFxEvents([
        makeDisposal({
          isShort: false,
          assetCategory: "STK",
          currency: "USD",
          proceedsFcy: new Decimal(1200),
          sellDate: "2025-03-15",
          sellEcbRate: new Decimal("0.92"),
        }),
      ]);
      const short = FxFifoEngine.extractStockProceedsFxEvents([
        makeDisposal({
          isShort: true,
          assetCategory: "STK",
          currency: "USD",
          proceedsFcy: new Decimal(1200),
          sellDate: "2025-03-15",
          sellEcbRate: new Decimal("0.92"),
        }),
      ]);

      // The long disposal emits exactly the expected acquisition lot.
      expect(long).toHaveLength(1);
      expect(long[0]!.currency).toBe("USD");
      expect(long[0]!.quantity.toString()).toBe("1200");
      expect(long[0]!.ecbRate.toString()).toBe("0.92");
      expect(long[0]!.trigger).toBe("stock_sale");
      // Flipping only isShort to true removes it — proof the flag is the cause.
      expect(short).toHaveLength(0);
    });

    it("isShort undefined behaves like a long (the guard only fires on a truthy flag)", () => {
      // makeDisposal omits isShort here → it is undefined on the object. The guard
      // `if (d.isShort) continue;` is falsy for undefined, so a normal long sale
      // still produces its event (guarding against an over-eager `!= null` check).
      const events = FxFifoEngine.extractStockProceedsFxEvents([
        makeDisposal({
          assetCategory: "STK",
          currency: "USD",
          proceedsFcy: new Decimal(1200),
        }),
      ]);
      expect(events).toHaveLength(1);
      expect(events[0]!.quantity.toString()).toBe("1200");
    });

    it("mixed list (long gain, short close, long loss) → only the two LONGS emit; the short is excluded", () => {
      // Long GAIN:  received 1200 USD @ 0.92 → acquisition lot of 1200.
      // SHORT close: 5000 GBP open-proceeds dated at the close → EXCLUDED entirely.
      // Long LOSS:  received 800 USD @ 0.93 → acquisition lot of 800 (P&L sign irrelevant).
      const longGain = makeDisposal({
        symbol: "AAPL",
        currency: "USD",
        assetCategory: "STK",
        proceedsFcy: new Decimal(1200),
        costBasisFcy: new Decimal(1000),
        gainLossFcy: new Decimal(200),
        sellDate: "2025-03-15",
        sellEcbRate: new Decimal("0.92"),
      });
      const shortClose = makeDisposal({
        symbol: "TSLA",
        isShort: true,
        currency: "GBP",
        assetCategory: "STK",
        proceedsFcy: new Decimal(5000),
        costBasisFcy: new Decimal(4500),
        gainLossFcy: new Decimal(500),
        sellDate: "2025-04-20",
        sellEcbRate: new Decimal("1.17"),
      });
      const longLoss = makeDisposal({
        symbol: "MSFT",
        currency: "USD",
        assetCategory: "STK",
        proceedsFcy: new Decimal(800),
        costBasisFcy: new Decimal(1000),
        gainLossFcy: new Decimal("-200"),
        sellDate: "2025-05-10",
        sellEcbRate: new Decimal("0.93"),
      });

      const events = FxFifoEngine.extractStockProceedsFxEvents([longGain, shortClose, longLoss]);

      // Exactly the two LONG disposals produced events; the short produced none.
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.trigger === "stock_sale")).toBe(true);

      // Both surviving events are the USD longs (1200 then 800), in input order.
      expect(events.map((e) => e.currency)).toEqual(["USD", "USD"]);
      expect(events.map((e) => e.quantity.toString())).toEqual(["1200", "800"]);
      expect(events.map((e) => e.ecbRate.toString())).toEqual(["0.92", "0.93"]);

      // The short's currency and proceeds appear NOWHERE in the output.
      expect(events.some((e) => e.currency === "GBP")).toBe(false);
      expect(events.some((e) => e.quantity.toString() === "5000")).toBe(false);
    });
  });

  describe("gain and loss both produce the lot (the P&L sign is irrelevant)", () => {
    it("a GAIN sale AND a LOSS sale each emit a stock_sale acquisition event", () => {
      // Gain: received 1200 USD for stock that cost 1000 USD (gainLossFcy +200).
      // Loss: received 800 USD for stock that cost 1000 USD (gainLossFcy -200).
      // Both hand the taxpayer real dollars → both create an FX acquisition lot.
      const gain = makeDisposal({
        proceedsFcy: new Decimal(1200),
        costBasisFcy: new Decimal(1000),
        gainLossFcy: new Decimal(200),
      });
      const loss = makeDisposal({
        proceedsFcy: new Decimal(800),
        costBasisFcy: new Decimal(1000),
        gainLossFcy: new Decimal("-200"),
      });

      const events = FxFifoEngine.extractStockProceedsFxEvents([gain, loss]);
      expect(events).toHaveLength(2);
      // Quantity tracks PROCEEDS, never the gain — so the loss sale still emits 800.
      expect(events[0]!.quantity.toString()).toBe("1200");
      expect(events[1]!.quantity.toString()).toBe("800");
      expect(events.every((e) => e.quantity.greaterThan(0))).toBe(true);
      expect(events.every((e) => e.trigger === "stock_sale")).toBe(true);
    });
  });

  describe("end-to-end through processEvents (reconciliation & deferral)", () => {
    it("a later USD→EUR conversion consumes the stock_sale lot FIFO-oldest-first", () => {
      // Lots, oldest first:
      //   [1] 2025-01-10 conversion  acquire 1000 USD @ 0.90 → cost 900 EUR
      //   [2] 2025-03-15 stock_sale  acquire 1200 USD @ 0.92 → cost 1104 EUR
      // Then 2025-06-15 conversion dispose 1500 USD @ 0.95.
      // FIFO: 1000 from lot[1] (cost 0.90), 500 from lot[2] (cost 0.92).
      const stockEvents = FxFifoEngine.extractStockProceedsFxEvents([
        makeDisposal({
          currency: "USD",
          assetCategory: "STK",
          proceedsFcy: new Decimal(1200),
          sellDate: "2025-03-15",
          sellEcbRate: new Decimal("0.92"),
        }),
      ]);

      const conversionAcquire: FxEvent = {
        date: "2025-01-10",
        currency: "USD",
        quantity: new Decimal(1000),
        ecbRate: new Decimal("0.90"),
        trigger: "conversion",
      };
      const conversionDispose: FxEvent = {
        date: "2025-06-15",
        currency: "USD",
        quantity: new Decimal(-1500),
        ecbRate: new Decimal("0.95"),
        trigger: "conversion",
      };

      // All three events feed the SAME processEvents call (the intended wiring).
      const engine = new FxFifoEngine();
      engine.processEvents([conversionAcquire, ...stockEvents, conversionDispose]);

      const disposals = engine.getDisposals();
      expect(disposals).toHaveLength(2);

      // Disposal 1: 1000 USD from the conversion lot (cost 0.90).
      expect(disposals[0]!.quantity.toString()).toBe("1000");
      expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("900.00"); // 1000 × 0.90
      expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("950.00"); // 1000 × 0.95
      expect(disposals[0]!.gainLossEur.toFixed(2)).toBe("50.00");
      expect(disposals[0]!.lotId).toBe("FX-1");

      // Disposal 2: 500 USD from the stock_sale lot (cost 0.92).
      expect(disposals[1]!.quantity.toString()).toBe("500");
      expect(disposals[1]!.costBasisEur.toFixed(2)).toBe("460.00"); // 500 × 0.92
      expect(disposals[1]!.proceedsEur.toFixed(2)).toBe("475.00"); // 500 × 0.95
      expect(disposals[1]!.gainLossEur.toFixed(2)).toBe("15.00");
      expect(disposals[1]!.lotId).toBe("FX-2");

      // Total FX gain across the conversion = 50 + 15 = 65 EUR.
      const totalGain = disposals.reduce((s, d) => s.plus(d.gainLossEur), new Decimal(0));
      expect(totalGain.toFixed(2)).toBe("65.00");

      // Remaining: 700 USD left in the stock_sale lot (1200 − 500), no warnings.
      const remaining = engine.getRemainingLots().get("USD")!;
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.quantity.toString()).toBe("700");
      expect(remaining[0]!.costPerUnit.toString()).toBe("0.92");
      expect(engine.warnings).toHaveLength(0);
    });

    it("a stock_sale lot with NO later conversion → ZERO disposals (deferred, Art. 14.2.e)", () => {
      // Receiving the foreign currency is not itself taxable; with no conversion
      // the lot just sits in the queue, untaxed. The gain is deferred, not lost.
      const stockEvents = FxFifoEngine.extractStockProceedsFxEvents([
        makeDisposal({
          currency: "USD",
          assetCategory: "STK",
          proceedsFcy: new Decimal(1200),
          sellDate: "2025-03-15",
          sellEcbRate: new Decimal("0.92"),
        }),
      ]);

      const engine = new FxFifoEngine();
      engine.processEvents(stockEvents);

      // Deferral: the lot exists but nothing is taxed.
      expect(engine.getDisposals()).toHaveLength(0);
      const lots = engine.getRemainingLots().get("USD")!;
      expect(lots).toHaveLength(1);
      expect(lots[0]!.quantity.toString()).toBe("1200");
      expect(lots[0]!.costInEur.toFixed(2)).toBe("1104.00"); // 1200 × 0.92
      expect(engine.warnings).toHaveLength(0); // no "sin lotes" — nothing disposed
    });
  });
});
