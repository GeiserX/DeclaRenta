/**
 * IBKR books an option exercise or assignment twice: once in the OptionEAE
 * section, and once as BookTrade rows in <Trades> — the option leg (notes
 * "Ex" / "A") AND the stock delivery leg (notes "Ex" / "A"). The engine already
 * delivers the underlying from the OptionEAE event (premium folded in, DGT
 * V0137-23), so the BookTrade legs must be skipped when that event exists, or
 * the shares are delivered twice.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { FifoEngine } from "../../src/engine/fifo.js";
import type { Trade, OptionExercise } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

const DATES = ["2025-01-10", "2025-01-15", "2025-01-17", "2025-02-20", "2025-03-01"];
const rateMap: EcbRateMap = new Map(DATES.map((d) => [d, new Map([["USD", new Decimal(1)]])]));

const HUT_ISIN = "US44812J1043";

function trade(overrides: Partial<Trade>): Trade {
  return {
    tradeID: "1",
    accountId: "U1",
    symbol: "HUT",
    description: "HUT 8 CORP",
    isin: HUT_ISIN,
    assetCategory: "STK",
    currency: "USD",
    tradeDate: "20250110",
    settlementDate: "20250110",
    quantity: "100",
    tradePrice: "50",
    tradeMoney: "5000",
    proceeds: "0",
    cost: "0",
    fifoPnlRealized: "0",
    fxRateToBase: "1",
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

function optionTrade(overrides: Partial<Trade>): Trade {
  return trade({
    conid: "111",
    symbol: "HUT   250117C00020000",
    description: "HUT 17JAN25 20 C",
    isin: "",
    assetCategory: "OPT",
    exchange: "CBOE",
    multiplier: "100",
    putCall: "C",
    strike: "20",
    expiry: "20250117",
    underlyingSymbol: "HUT",
    underlyingIsin: HUT_ISIN,
    ...overrides,
  });
}

function eae(overrides: Partial<OptionExercise>): OptionExercise {
  return {
    transactionID: "EAE1",
    accountId: "U1",
    conid: "111",
    symbol: "HUT   250117C00020000",
    description: "HUT 17JAN25 20 C",
    isin: "",
    currency: "USD",
    date: "20250117",
    action: "Exercise",
    putCall: "C",
    strike: "20",
    expiry: "20250117",
    quantity: "-6",
    proceeds: "0",
    underlyingSymbol: "HUT",
    underlyingIsin: HUT_ISIN,
    multiplier: "100",
    ...overrides,
  };
}

/** Lots that still hold shares or contracts (emptied queues are left behind as []). */
function openLots(engine: FifoEngine): string[] {
  const out: string[] = [];
  for (const [key, lots] of engine.getRemainingLots()) {
    for (const lot of lots) {
      if (!lot.quantity.isZero()) out.push(`${key}:${lot.quantity.toString()}@${lot.costInFcy.toString()}`);
    }
  }
  return out;
}

describe("IBKR exercise/assignment BookTrade legs alongside OptionEAE", () => {
  it("long call exercise: the stock BookTrade (notes Ex) does not deliver the shares a second time", () => {
    const engine = new FifoEngine();
    const trades = [
      optionTrade({ tradeDate: "20250110", quantity: "6", tradePrice: "1", tradeMoney: "600" }),
      // Option leg of the exercise (already filtered before this fix)
      optionTrade({
        tradeID: "2",
        tradeDate: "20250117",
        quantity: "-6",
        tradePrice: "0",
        tradeMoney: "0",
        buySell: "SELL",
        openCloseIndicator: "C",
        notes: "Ex",
      }),
      // Stock delivery leg of the same exercise
      trade({ tradeID: "3", tradeDate: "20250117", quantity: "600", tradePrice: "20", tradeMoney: "12000", notes: "Ex" }),
      trade({
        tradeID: "4",
        tradeDate: "20250301",
        quantity: "-600",
        tradePrice: "25",
        tradeMoney: "-15000",
        buySell: "SELL",
        openCloseIndicator: "C",
      }),
    ];

    const disposals = engine.processTrades(trades, rateMap, undefined, [eae({})]);

    expect(disposals).toHaveLength(1);
    // 600 × 20 strike + 600 premium (DGT V0137-23)
    expect(disposals[0]!.costBasisFcy.toFixed(2)).toBe("12600.00");
    expect(disposals[0]!.proceedsFcy.toFixed(2)).toBe("15000.00");
    expect(openLots(engine)).toEqual([]);
    expect(engine.messages.map((m) => m.id)).not.toContain("fifo.sell_without_lots");
  });

  it("covered call assigned: the stock (notes A) and option (notes A) BookTrades are not processed again", () => {
    const engine = new FifoEngine();
    const trades = [
      trade({ tradeDate: "20250110", quantity: "100", tradePrice: "50", tradeMoney: "5000" }),
      // Write 1 call, strike 60, premium 2.00
      optionTrade({
        tradeID: "2",
        tradeDate: "20250115",
        quantity: "-1",
        tradePrice: "2",
        tradeMoney: "-200",
        buySell: "SELL",
        openCloseIndicator: "O",
        strike: "60",
      }),
      // Assignment legs in <Trades>
      trade({
        tradeID: "3",
        tradeDate: "20250220",
        quantity: "-100",
        tradePrice: "60",
        tradeMoney: "-6000",
        buySell: "SELL",
        openCloseIndicator: "C",
        notes: "A",
      }),
      optionTrade({
        tradeID: "4",
        tradeDate: "20250220",
        quantity: "1",
        tradePrice: "0",
        tradeMoney: "0",
        buySell: "BUY",
        openCloseIndicator: "C",
        strike: "60",
        notes: "A",
      }),
    ];

    const disposals = engine.processTrades(trades, rateMap, undefined, [
      eae({ date: "20250220", action: "Assignment", quantity: "1", strike: "60" }),
    ]);

    expect(disposals).toHaveLength(1);
    // 100 × 60 strike + 200 premium received
    expect(disposals[0]!.proceedsFcy.toFixed(2)).toBe("6200.00");
    expect(disposals[0]!.costBasisFcy.toFixed(2)).toBe("5000.00");
    expect(disposals[0]!.gainLossEur.toFixed(2)).toBe("1200.00");
    expect(engine.messages.map((m) => m.id)).not.toContain("fifo.sell_without_lots");
    expect(openLots(engine)).toEqual([]);
    expect([...engine.getRemainingShortLots().values()].flat()).toEqual([]);
  });

  it("keeps the stock BookTrade when the export has no OptionEAE event for it", () => {
    const engine = new FifoEngine();
    engine.processTrades(
      [trade({ tradeDate: "20250117", quantity: "600", tradePrice: "20", tradeMoney: "12000", notes: "Ex" })],
      rateMap,
    );
    expect(openLots(engine)).toEqual([`${HUT_ISIN}:600@12000`]);
  });

  it("keeps a stock BookTrade whose OptionEAE event is for another underlying or another day", () => {
    const engine = new FifoEngine();
    engine.processTrades(
      [trade({ tradeDate: "20250117", quantity: "600", tradePrice: "20", tradeMoney: "12000", notes: "Ex" })],
      rateMap,
      undefined,
      [
        eae({ conid: "222", underlyingSymbol: "RIOT", underlyingIsin: "US7672921050" }),
        eae({ conid: "333", date: "20250115" }),
      ],
    );
    // The two events deliver their own lots ("via ejercicio"); the BookTrade lot must survive next to them.
    const bookTradeLots = (engine.getRemainingLots().get(HUT_ISIN) ?? []).filter((l) => l.description === "HUT 8 CORP");
    expect(bookTradeLots.map((l) => `${l.acquireDate}:${l.quantity.toString()}`)).toEqual(["20250117:600"]);
  });
});
