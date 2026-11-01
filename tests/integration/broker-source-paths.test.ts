/**
 * brokerSource on the engine paths the hand-built FIFO/FX tests in
 * broker-source-traceability.test.ts do not reach: cash buyouts, scrip
 * dividends, option expiry/exercise/assignment, the FX event extractors that
 * turn trades and cash rows into FxEvents, and the FX pool lots re-added after
 * a stock sale. Each broker name is distinct so a dropped or swapped label
 * shows up as the wrong name, not just a missing one.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { FifoEngine } from "../../src/engine/fifo.js";
import { FxFifoEngine, type FxEvent } from "../../src/engine/fx-fifo.js";
import { createEmptyStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { CashTransaction, CorporateAction, OptionExercise, Trade } from "../../src/types/ibkr.js";

const A = "Interactive Brokers";
const B = "Degiro";
const C = "Trading 212";

function makeTrade(overrides: Partial<Trade>): Trade {
  return {
    tradeID: "t",
    accountId: "ACC1",
    symbol: "TEST",
    description: "Test Stock",
    isin: "XX0000000001",
    assetCategory: "STK",
    currency: "EUR",
    tradeDate: "20250115",
    settlementDate: "20250115",
    quantity: "10",
    tradePrice: "100",
    tradeMoney: "1000",
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
    ...overrides,
  };
}

function makeCa(overrides: Partial<CorporateAction>): CorporateAction {
  return {
    transactionID: "ca",
    accountId: "ACC1",
    symbol: "TEST",
    description: "",
    isin: "XX0000000001",
    currency: "EUR",
    reportDate: "20250601",
    dateTime: "20250601",
    quantity: "0",
    amount: "0",
    type: "TC",
    actionDescription: "",
    ...overrides,
  };
}

describe("mergeStatement stamps corporate actions too", () => {
  it("labels a corporate action row with the parser name", () => {
    const source = createEmptyStatement();
    source.corporateActions.push(makeCa({}));
    const merged = mergeStatement(createEmptyStatement(), source, A);
    expect(merged.corporateActions[0]!.brokerSource).toBe(A);
  });
});

describe("FifoEngine corporate actions", () => {
  it("a cash buyout is a sale at the buyout's broker of a lot bought elsewhere", () => {
    const engine = new FifoEngine();
    const disposals = engine.processTrades(
      [makeTrade({ tradeID: "b1", brokerSource: A })],
      new Map(),
      [
        makeCa({
          description: "TEST(XX0000000001) MERGED(Acquisition) FOR EUR 120.00 PER SHARE (TEST, TEST SA, XX0000000001)",
          quantity: "-10",
          amount: "1200",
          brokerSource: B,
        }),
      ],
    );
    expect(disposals.map((d) => [d.brokerSource, d.acquireBrokerSource])).toEqual([[B, A]]);
  });

  it("scrip dividend shares keep the broker of the dividend", () => {
    const engine = new FifoEngine();
    const disposals = engine.processTrades(
      [
        makeTrade({ tradeID: "b1", brokerSource: A }),
        makeTrade({
          tradeID: "s1",
          tradeDate: "20250901",
          settlementDate: "20250901",
          quantity: "-12",
          tradePrice: "110",
          tradeMoney: "-1320",
          proceeds: "1320",
          cost: "0",
          buySell: "SELL",
          openCloseIndicator: "C",
          brokerSource: C,
        }),
      ],
      new Map(),
      [makeCa({ type: "SD", description: "TEST(XX0000000001) STOCK DIVIDEND", quantity: "2", amount: "200", brokerSource: B })],
    );
    expect(disposals.map((d) => [d.quantity.toString(), d.brokerSource, d.acquireBrokerSource])).toEqual([
      ["10", C, A],
      ["2", C, B],
    ]);
  });
});

describe("FifoEngine options", () => {
  const option = (overrides: Partial<Trade>): Trade =>
    makeTrade({
      tradeID: "o1",
      symbol: "TEST 250321C00100000",
      description: "TEST 21MAR25 100 C",
      isin: "",
      assetCategory: "OPT",
      quantity: "1",
      tradePrice: "5",
      tradeMoney: "500",
      cost: "-500",
      multiplier: "100",
      putCall: "C",
      strike: "100",
      expiry: "20250321",
      underlyingSymbol: "TEST",
      underlyingIsin: "XX0000000001",
      ...overrides,
    });
  const exercise = (overrides: Partial<OptionExercise>): OptionExercise => ({
    transactionID: "ex1",
    accountId: "ACC1",
    symbol: "TEST 250321C00100000",
    description: "TEST 21MAR25 100 C",
    isin: "",
    currency: "EUR",
    date: "20250321",
    action: "Expiration",
    putCall: "C",
    strike: "100",
    expiry: "20250321",
    quantity: "1",
    proceeds: "0",
    underlyingSymbol: "TEST",
    underlyingIsin: "XX0000000001",
    multiplier: "100",
    ...overrides,
  });
  const run = (trades: Trade[], exercises: OptionExercise[]) =>
    new FifoEngine().processTrades(trades, new Map(), [], exercises);

  it("a bought option that expires names the expiry broker and the buy broker", () => {
    const disposals = run([option({ brokerSource: A })], [exercise({ brokerSource: B })]);
    expect(disposals.map((d) => [d.optionScenario, d.brokerSource, d.acquireBrokerSource])).toEqual([["expiration", B, A]]);
  });

  it("a written option that expires names the expiry broker and the writing broker", () => {
    const disposals = run(
      [option({ buySell: "SELL", quantity: "-1", tradeMoney: "-500", proceeds: "500", cost: "0", brokerSource: A })],
      [exercise({ brokerSource: B })],
    );
    expect(disposals.map((d) => [d.isShort, d.brokerSource, d.acquireBrokerSource])).toEqual([[true, B, A]]);
  });

  it("shares received by exercising a call carry the exercise broker", () => {
    const disposals = run(
      [
        option({ brokerSource: A }),
        makeTrade({
          tradeID: "s1",
          tradeDate: "20250601",
          settlementDate: "20250601",
          quantity: "-100",
          tradePrice: "120",
          tradeMoney: "-12000",
          proceeds: "12000",
          cost: "0",
          buySell: "SELL",
          openCloseIndicator: "C",
          brokerSource: C,
        }),
      ],
      [exercise({ action: "Exercise", brokerSource: B })],
    );
    const stock = disposals.filter((d) => d.assetCategory === "STK");
    expect(stock.map((d) => [d.brokerSource, d.acquireBrokerSource])).toEqual([[C, B]]);
  });

  it("an assigned call delivers shares bought elsewhere, and a shortfall names only the assignment broker", () => {
    const disposals = run(
      [
        makeTrade({ tradeID: "b1", quantity: "60", tradeMoney: "6000", cost: "-6000", brokerSource: A }),
        option({ buySell: "SELL", quantity: "-1", tradeMoney: "-500", proceeds: "500", cost: "0", brokerSource: A }),
      ],
      [exercise({ action: "Assignment", brokerSource: B })],
    );
    const stock = disposals.filter((d) => d.assetCategory === "STK");
    expect(stock.map((d) => [d.quantity.toString(), d.brokerSource, d.acquireBrokerSource])).toEqual([
      ["60", B, A],
      ["40", B, undefined],
    ]);
  });

  it("an exercised put with no shares to deliver names the exercise broker", () => {
    const disposals = run(
      [option({ symbol: "TEST 250321P00100000", description: "TEST 21MAR25 100 P", putCall: "P", brokerSource: A })],
      [exercise({ symbol: "TEST 250321P00100000", description: "TEST 21MAR25 100 P", putCall: "P", action: "Exercise", brokerSource: B })],
    );
    const stock = disposals.filter((d) => d.assetCategory === "STK");
    expect(stock.map((d) => [d.brokerSource, d.acquireBrokerSource])).toEqual([[B, undefined]]);
  });
});

describe("FxFifoEngine extractors carry the source row's broker", () => {
  const rates: EcbRateMap = new Map([
    ["2025-03-15", new Map([["USD", new Decimal("0.92")], ["GBP", new Decimal("1.18")]])],
    ["2025-03-17", new Map([["USD", new Decimal("0.92")], ["GBP", new Decimal("1.18")]])],
  ]);
  const brokers = (events: FxEvent[]) => events.map((e) => e.brokerSource);

  it("conversions, including the other leg of a non-EUR pair", () => {
    const cash = (overrides: Partial<Trade>) =>
      makeTrade({
        symbol: "EUR.USD",
        description: "EUR.USD",
        isin: "",
        assetCategory: "CASH",
        currency: "USD",
        tradeDate: "20250315",
        settlementDate: "20250315",
        quantity: "1000",
        tradeMoney: "1080",
        commission: "0",
        ...overrides,
      });
    const events = FxFifoEngine.extractFxEvents(
      [
        cash({ buySell: "SELL", quantity: "-1000", tradeMoney: "-1080", brokerSource: A }),
        cash({ buySell: "BUY", brokerSource: B }),
        cash({ symbol: "GBP.USD", description: "GBP.USD", buySell: "SELL", quantity: "-100", tradeMoney: "-127", brokerSource: C }),
      ],
      rates,
    );
    expect(brokers(events)).toEqual([A, B, C, C]);
  });

  it("dividends, a withholding refund, interest and fees", () => {
    const tx = (type: CashTransaction["type"], amount: string, brokerSource: string): CashTransaction => ({
      transactionID: `${type}-${amount}`,
      accountId: "ACC1",
      symbol: "TEST",
      description: type,
      isin: "",
      currency: "USD",
      dateTime: "2025-03-15",
      settleDate: "2025-03-15",
      amount,
      fxRateToBase: "0.92",
      type,
      brokerSource,
    });
    const events = FxFifoEngine.extractCashFxEvents(
      [
        tx("Dividends", "100", "D1"),
        tx("Withholding Tax", "5", "D2"),
        tx("Broker Interest Received", "10", "D3"),
        tx("Broker Interest Paid", "-3", "D4"),
        tx("Other Fees", "-2", "D5"),
        tx("Other Fees", "1", "D6"),
      ],
      rates,
    );
    expect([...brokers(events)].sort()).toEqual(["D1", "D2", "D3", "D4", "D5", "D6"]);
  });

  it("foreign stock buys and sales", () => {
    const usd = { currency: "USD", commissionCurrency: "USD", tradeDate: "20250315", settlementDate: "20250315" };
    const buy = makeTrade({ ...usd, tradeID: "b1", brokerSource: A });
    const sell = makeTrade({
      ...usd,
      tradeID: "s1",
      tradeDate: "20250317",
      settlementDate: "20250317",
      quantity: "-10",
      tradePrice: "120",
      tradeMoney: "-1200",
      proceeds: "1200",
      cost: "0",
      buySell: "SELL",
      openCloseIndicator: "C",
      brokerSource: B,
    });
    expect(brokers(FxFifoEngine.extractStockPurchaseFxEvents([buy], rates))).toEqual([A]);
    const disposals = new FifoEngine().processTrades([buy, sell], rates);
    expect(brokers(FxFifoEngine.extractStockProceedsFxEvents(disposals))).toEqual([B]);
  });
});

describe("FxFifoEngine pool lots and partial cover", () => {
  const fx = (date: string, qty: string, broker: string): FxEvent => ({
    date,
    currency: "USD",
    quantity: new Decimal(qty),
    ecbRate: new Decimal("0.90"),
    trigger: "conversion",
    brokerSource: broker,
  });
  const stockSell = (cost: string, proceeds: string, broker: string): FxEvent => ({
    kind: "stock_sell",
    date: "2024-03-01",
    currency: "USD",
    quantity: new Decimal(0),
    costFcy: new Decimal(cost),
    proceedsFcy: new Decimal(proceeds),
    ecbRate: new Decimal("0.92"),
    trigger: "stock_sale",
    positionKey: "X",
    brokerSource: broker,
  });

  it("the part a short pool cannot cover names the spending broker", () => {
    const engine = new FxFifoEngine();
    engine.processEvents([fx("2024-01-15", "100", A), fx("2024-06-15", "-300", B)]);
    expect(engine.getDisposals().map((d) => [d.lotId === "UNKNOWN", d.brokerSource, d.acquireBrokerSource])).toEqual([
      [false, B, A],
      [true, B, undefined],
    ]);
  });

  it("an uncovered parked buy comes back with the sale's broker", () => {
    const engine = new FxFifoEngine();
    engine.processEvents([
      {
        kind: "stock_buy",
        date: "2024-02-01",
        currency: "USD",
        quantity: new Decimal(0),
        costFcy: new Decimal(1000),
        ecbRate: new Decimal("0.91"),
        trigger: "stock_purchase",
        positionKey: "X",
        brokerSource: A,
      },
      stockSell("1000", "1000", B),
      fx("2024-06-15", "-1000", C),
    ]);
    expect(engine.getDisposals().map((d) => d.acquireBrokerSource)).toEqual([B]);
  });

  it("an unmatched sale's principal and its profit both come back with the sale's broker", () => {
    const engine = new FxFifoEngine();
    engine.processEvents([stockSell("500", "1000", B), fx("2024-06-15", "-1000", C)]);
    const disposals = engine.getDisposals();
    expect(disposals.map((d) => [d.quantity.toString(), d.acquireBrokerSource])).toEqual([
      ["500", B],
      ["500", B],
    ]);
  });
});
