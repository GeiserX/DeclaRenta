import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { FifoEngine } from "../../src/engine/fifo.js";
import type { Trade, OptionExercise } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

/**
 * Coverage for FIFO disposal branches that the option-lifecycle audit flagged as
 * untested. Each test builds a minimal Transaction input and asserts the
 * fiscally-correct disposal (gain/loss, dates, quantities, basis) reasoned out
 * by hand — NOT a snapshot of whatever the engine happens to emit.
 *
 * Branches covered:
 *   1. C;O roll (close-then-open in one action).
 *   2. Short over-close → flip to long (BUY+C for more than the open short qty).
 *   3. resolveUnderlyingKey symbol-scan path (option exercise, empty underlyingIsin).
 *   4. Exercise with MISSING underlying lots (put exercise, no shares held).
 *   5. Exercise/assignment with INSUFFICIENT underlying quantity.
 */

function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    const inner = new Map<string, Decimal>();
    for (const [ccy, rate] of Object.entries(currencies)) inner.set(ccy, new Decimal(rate));
    map.set(date, inner);
  }
  return map;
}

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    tradeID: "T1",
    accountId: "U1",
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

function makeOptionTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    tradeID: "OPT1",
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
    tradeID: "STK1",
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
    transactionID: "EAE1",
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

describe("FIFO branch coverage — option lifecycle (untested disposal paths)", () => {
  describe("1. C;O roll (close-then-open in one action)", () => {
    it("SELL with C;O on a long position closes the long via FIFO and warns it is a roll", () => {
      // Buy 10 @ 100 EUR (commission 1 → lot cost 1001), then a single C;O SELL of
      // 10 @ 120 EUR (commission 1) that closes the long. EUR rate = 1, so EUR == FCY.
      const rateMap = makeRateMap({ "2025-03-15": { EUR: "1" }, "2025-06-01": { EUR: "1" } });
      const engine = new FifoEngine();

      const trades: Trade[] = [
        makeTrade({ tradeID: "B1", tradeDate: "20250315", buySell: "BUY", quantity: "10", tradePrice: "100", commission: "-1" }),
        makeTrade({ tradeID: "R1", tradeDate: "20250601", buySell: "SELL", openCloseIndicator: "C;O", quantity: "-10", tradePrice: "120", commission: "-1" }),
      ];

      const disposals = engine.processTrades(trades, rateMap);

      // C;O routes a SELL to consumeLots → one disposal closing the long.
      expect(disposals).toHaveLength(1);
      const d = disposals[0]!;
      expect(d.quantity.toString()).toBe("10");
      expect(d.acquireDate).toBe("20250315");
      expect(d.sellDate).toBe("20250601");
      // proceeds = 10×120 − 1 = 1199; cost = 1001; gain = 198 (EUR, rate 1).
      expect(d.proceedsEur.toString()).toBe("1199");
      expect(d.costBasisEur.toString()).toBe("1001");
      expect(d.gainLossEur.toString()).toBe("198");
      // The roll info message fires.
      expect(engine.warnings.some((w) => w.includes("Operación C;O (roll)"))).toBe(true);
      // Long fully consumed.
      expect(engine.getRemainingLots().get("US0378331005") ?? []).toHaveLength(0);
    });
  });

  describe("2. Short over-close → flip to long", () => {
    it("BUY+C for more than the open short qty closes the short and opens a new long for the excess", () => {
      // Open SHORT 10 @ 100 USD (commission 0 → open proceeds 1000 USD) on 2025-01-15,
      // then BUY+C 15 @ 90 USD (commission 0) on 2025-02-01. Close 10, flip 5 to long.
      const rateMap = makeRateMap({
        "2025-01-15": { USD: "0.92" },
        "2025-02-01": { USD: "0.93" },
      });
      const engine = new FifoEngine();

      const trades: Trade[] = [
        makeTrade({
          tradeID: "SH1", currency: "USD", commissionCurrency: "USD", commission: "0",
          tradeDate: "20250115", buySell: "SELL", openCloseIndicator: "O", quantity: "-10", tradePrice: "100",
        }),
        makeTrade({
          tradeID: "BC1", currency: "USD", commissionCurrency: "USD", commission: "0",
          tradeDate: "20250201", buySell: "BUY", openCloseIndicator: "C", quantity: "15", tradePrice: "90",
        }),
      ];

      const disposals = engine.processTrades(trades, rateMap);

      // Exactly one short-close disposal (10 contracts); the 5-share excess is a new
      // long lot, not a disposal.
      expect(disposals).toHaveLength(1);
      const d = disposals[0]!;
      expect(d.isShort).toBe(true);
      expect(d.quantity.toString()).toBe("10");
      expect(d.acquireDate).toBe("20250115");
      expect(d.sellDate).toBe("20250201");
      // Short gain in FCY = open proceeds 1000 − close cost 900 = 100 USD; both legs
      // convert at the close-date rate (0.93): proceeds 930, cost 837, gain 93 EUR.
      expect(d.proceedsEur.toString()).toBe("930");
      expect(d.costBasisEur.toString()).toBe("837");
      expect(d.gainLossEur.toString()).toBe("93");

      // The short queue is now empty; a new LONG lot of 5 exists at cost 450 USD.
      expect(engine.getRemainingShortLots().get("US0378331005") ?? []).toHaveLength(0);
      const longLots = engine.getRemainingLots().get("US0378331005");
      expect(longLots).toHaveLength(1);
      expect(longLots![0]!.quantity.toString()).toBe("5");
      expect(longLots![0]!.costInFcy.toString()).toBe("450");
      expect(longLots![0]!.isShort).toBeUndefined();
    });
  });

  describe("3. resolveUnderlyingKey symbol-scan path", () => {
    it("call buyer exercise with empty underlyingIsin resolves the underlying lot by symbol scan", () => {
      // Hold STK AAPL keyed by ISIN, plus a long CALL option lot (empty option ISIN).
      // The exercise carries an EMPTY underlyingIsin but underlyingSymbol "AAPL", so
      // resolveUnderlyingKey must scan existing lots and find the ISIN-keyed STK lots.
      const rateMap = makeRateMap({
        "2025-01-10": { USD: "0.92" },
        "2025-01-15": { USD: "0.92" },
        "2025-03-21": { USD: "0.94" },
      });
      const engine = new FifoEngine();

      engine.processTrades([
        makeStockTrade({ tradeID: "STK1", tradeDate: "20250110" }),
        makeOptionTrade({ tradeID: "OPT1", tradeDate: "20250115", underlyingIsin: "" }),
      ], rateMap);

      // Exercise with empty underlyingIsin — forces the symbol-scan branch.
      engine.processOptionExercises([
        makeExercise({ underlyingIsin: "" }),
      ], rateMap);

      // Call buyer exercise creates no disposal (premium folds into share cost).
      const disposals = engine.getDisposals();
      expect(disposals).toHaveLength(0);

      // The 100 exercised shares must land under the EXISTING ISIN-keyed lots, not a
      // fresh STK:AAPL bucket. So US0378331005 now holds 200 shares total (100 + 100).
      const lots = engine.getRemainingLots().get("US0378331005");
      expect(lots).toHaveLength(2);
      const totalQty = lots!.reduce((s, l) => s.plus(l.quantity), new Decimal(0));
      expect(totalQty.toString()).toBe("200");

      // The freshest lot (the exercise delivery) is priced at the strike (200) and its
      // cost integrates the premium: 100×200 + 551.50 = 20551.5 USD.
      const exerciseLot = lots![1]!;
      expect(exerciseLot.quantity.toString()).toBe("100");
      expect(exerciseLot.pricePerShare.toString()).toBe("200");
      expect(exerciseLot.costInFcy.toString()).toBe("20551.5");

      // No symbol-scan fallback bucket was created.
      expect(engine.getRemainingLots().get("STK:AAPL")).toBeUndefined();
    });
  });

  describe("4. Exercise with MISSING underlying lots", () => {
    it("put buyer exercise with no underlying shares records a zero-basis delivery and warns", () => {
      // A long PUT option lot exists, but NO underlying AAPL shares are held. Exercising
      // the put sells 100 shares at strike 200 with no cost basis → full proceeds taxed.
      const rateMap = makeRateMap({
        "2025-01-15": { USD: "0.92" },
        "2025-03-21": { USD: "0.94" },
      });
      const engine = new FifoEngine();

      engine.processTrades([
        makeOptionTrade({
          tradeID: "OPT1",
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
      // One STK delivery disposal with zero cost basis.
      expect(disposals).toHaveLength(1);
      const d = disposals[0]!;
      expect(d.assetCategory).toBe("STK");
      expect(d.optionScenario).toBe("exercise");
      expect(d.quantity.toString()).toBe("100");
      expect(d.acquireDate).toBe("2025-03-21"); // no real acquisition → normalized exercise date
      expect(d.costBasisEur.toString()).toBe("0");
      // net proceeds = strike 200×100 − premium 551.50 = 19448.50 USD, @0.94 = 18281.59 EUR.
      expect(d.proceedsEur.toFixed(2)).toBe("18281.59");
      expect(d.gainLossEur.toFixed(2)).toBe("18281.59");
      expect(engine.warnings.some((w) => w.includes("sin lotes del subyacente"))).toBe(true);
    });
  });

  describe("5. Exercise/assignment with INSUFFICIENT underlying quantity", () => {
    it("put exercise selling more shares than held splits into a real + a zero-basis disposal", () => {
      // Hold only 50 AAPL shares, but exercise a PUT for 100 shares at strike 200.
      // 50 shares consume the real lot; the other 50 hit the insufficient-lots path.
      const rateMap = makeRateMap({
        "2025-01-10": { USD: "0.92" },
        "2025-01-15": { USD: "0.92" },
        "2025-03-21": { USD: "0.94" },
      });
      const engine = new FifoEngine();

      engine.processTrades([
        makeStockTrade({ tradeID: "STK1", quantity: "50", tradeDate: "20250110" }),
        makeOptionTrade({
          tradeID: "OPT1",
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
      // Two STK disposals: 50 against the real lot, 50 against the shortfall.
      expect(disposals).toHaveLength(2);

      // Net proceeds for the full 100 shares = 200×100 − 551.50 = 19448.50 USD,
      // split 50/50 → 9724.25 USD each leg.
      const real = disposals[0]!;
      expect(real.quantity.toString()).toBe("50");
      expect(real.acquireDate).toBe("20250110"); // consumed the real lot
      // cost = (50×180 + 1)/50 × 50 = 9001 USD; same-currency → both legs @0.94.
      expect(real.proceedsEur.toFixed(3)).toBe("9140.795");
      expect(real.costBasisEur.toFixed(2)).toBe("8460.94");
      expect(real.gainLossEur.toFixed(3)).toBe("679.855");

      const shortfall = disposals[1]!;
      expect(shortfall.quantity.toString()).toBe("50");
      expect(shortfall.acquireDate).toBe("2025-03-21"); // no lot → normalized exercise date
      expect(shortfall.costBasisEur.toString()).toBe("0");
      expect(shortfall.proceedsEur.toFixed(3)).toBe("9140.795");
      expect(shortfall.gainLossEur.toFixed(3)).toBe("9140.795");

      expect(engine.warnings.some((w) => w.includes("Lotes insuficientes del subyacente"))).toBe(true);
    });
  });
});
