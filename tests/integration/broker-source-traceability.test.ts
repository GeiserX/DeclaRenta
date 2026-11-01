import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import Decimal from "decimal.js";
import { FifoEngine } from "../../src/engine/fifo.js";
import { FxFifoEngine, type FxEvent } from "../../src/engine/fx-fifo.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { detectBroker } from "../../src/parsers/index.js";
import { detectRevolutXlsx, parseRevolutXlsx } from "../../src/parsers/revolut.js";
import { createEmptyStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { Statement } from "../../src/types/broker.js";
import type { CashTransaction, CorporateAction, Trade } from "../../src/types/ibkr.js";

const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));

function makeTrade(overrides: Partial<Trade>): Trade {
  return {
    tradeID: "t",
    accountId: "ACC1",
    symbol: "TEST",
    description: "Test Stock",
    isin: "XX0000000001",
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
    ...overrides,
  };
}

const buy = (id: string, date: string, qty: string, broker: string): Trade =>
  makeTrade({ tradeID: id, tradeDate: date, settlementDate: date, quantity: qty, brokerSource: broker });

const sell = (id: string, date: string, qty: string, broker: string, overrides: Partial<Trade> = {}): Trade =>
  makeTrade({
    tradeID: id,
    tradeDate: date,
    settlementDate: date,
    quantity: `-${qty}`,
    tradePrice: "120",
    tradeMoney: String(Number(qty) * 120),
    proceeds: String(Number(qty) * 120),
    cost: "0",
    buySell: "SELL",
    openCloseIndicator: "C",
    brokerSource: broker,
    ...overrides,
  });

/** Every row list of a statement that can carry `brokerSource`. */
function rowLists(s: Statement): [string, { brokerSource?: string }[]][] {
  return [
    ["trades", s.trades],
    ["cashTransactions", s.cashTransactions],
    ["corporateActions", s.corporateActions],
    ["openPositions", s.openPositions],
    ["securitiesInfo", s.securitiesInfo],
    ["cashBalances", s.cashBalances ?? []],
    ["optionExercises", s.optionExercises ?? []],
  ];
}

describe("brokerSource stamped once in mergeStatement", () => {
  it("labels every row of every fixture with the parser's own name", async () => {
    const seen = new Set<string>();
    for (const file of readdirSync(FIXTURES).sort()) {
      const path = join(FIXTURES, file);
      const buf = readFileSync(path);
      let name: string;
      let statement: Statement;
      if (file.endsWith(".xlsx")) {
        if (!(await detectRevolutXlsx(buf))) continue;
        name = "Revolut";
        statement = await parseRevolutXlsx(buf);
      } else {
        const parser = detectBroker(buf.toString("utf-8"));
        if (!parser) continue;
        name = parser.name;
        try {
          statement = parser.parse(buf.toString("utf-8"));
        } catch {
          continue; // e.g. the eToro CSV sample: eToro is read from XLSX only
        }
      }
      const merged = mergeStatement(createEmptyStatement(), statement, name);
      for (const [list, rows] of rowLists(merged)) {
        for (const row of rows) {
          expect(`${file} ${list} ${row.brokerSource}`).toBe(`${file} ${list} ${name}`);
        }
      }
      seen.add(name);
    }
    // The registry names, not short forms: "Interactive Brokers", never "IBKR".
    expect([...seen].sort()).toEqual(
      expect.arrayContaining(["Binance", "Coinbase", "Degiro", "Interactive Brokers", "Kraken", "Lightyear", "Revolut"]),
    );
  });

  it("keeps a broker a parser already set, and stamps nothing without a name", () => {
    const source = createEmptyStatement();
    source.trades.push(buy("a", "20240115", "1", "Binance"), makeTrade({ tradeID: "b" }));
    const merged = mergeStatement(createEmptyStatement(), source, "Kraken");
    expect(merged.trades.map((t) => t.brokerSource)).toEqual(["Binance", "Kraken"]);

    const unnamed = createEmptyStatement();
    unnamed.trades.push(makeTrade({ tradeID: "c" }));
    expect(mergeStatement(createEmptyStatement(), unnamed).trades[0]!.brokerSource).toBeUndefined();
  });
});

describe("FifoEngine: sale broker and acquisition broker", () => {
  it("propagates brokerSource from Trade to FifoDisposal", () => {
    const engine = new FifoEngine();
    engine.processTrades([buy("b1", "20240115", "10", "Degiro"), sell("s1", "20240615", "10", "Degiro")], new Map());
    const disposals = engine.getDisposals();
    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.brokerSource).toBe("Degiro");
    expect(disposals[0]!.acquireBrokerSource).toBe("Degiro");
  });

  it("names the broker of each consumed lot when FIFO crosses brokers", () => {
    // FIFO pools lots per ISIN across brokers (Art. 37.2 LIRPF): the oldest lot
    // was bought at IBKR, the sale happened at Degiro.
    const engine = new FifoEngine();
    const disposals = engine.processTrades(
      [
        buy("b1", "20240115", "10", "Interactive Brokers"),
        buy("b2", "20240201", "10", "Degiro"),
        sell("s1", "20240615", "15", "Degiro"),
      ],
      new Map(),
    );
    expect(disposals.map((d) => [d.acquireDate, d.quantity.toString(), d.brokerSource, d.acquireBrokerSource])).toEqual([
      ["20240115", "10", "Degiro", "Interactive Brokers"],
      ["20240201", "5", "Degiro", "Degiro"],
    ]);
  });

  it("has no acquisition broker for a sale without lots", () => {
    const engine = new FifoEngine();
    const [d] = engine.processTrades([sell("s1", "20240615", "10", "Degiro")], new Map());
    expect(d!.brokerSource).toBe("Degiro");
    expect(d!.acquireBrokerSource).toBeUndefined();
  });

  it("closes a short opened at another broker with both brokers named", () => {
    const engine = new FifoEngine();
    const disposals = engine.processTrades(
      [
        sell("s1", "20240115", "10", "Interactive Brokers", { openCloseIndicator: "O" }),
        makeTrade({
          tradeID: "b1",
          tradeDate: "20240615",
          settlementDate: "20240615",
          quantity: "10",
          openCloseIndicator: "C",
          brokerSource: "Degiro",
        }),
      ],
      new Map(),
    );
    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.isShort).toBe(true);
    expect(disposals[0]!.brokerSource).toBe("Degiro");
    expect(disposals[0]!.acquireBrokerSource).toBe("Interactive Brokers");
  });

  it("keeps the parent lot's broker on the shares of a spin-off", () => {
    const ca: CorporateAction = {
      transactionID: "ca1",
      accountId: "ACC1",
      type: "SO",
      reportDate: "20240301",
      dateTime: "20240301",
      isin: "XX0000000001",
      symbol: "TEST",
      description: "TEST(XX0000000001) SPINOFF 1 FOR 2 SPINCO(XX0000000002)",
      quantity: "5",
      amount: "0",
      currency: "EUR",
      actionDescription: "",
    };
    const engine = new FifoEngine();
    const disposals = engine.processTrades(
      [
        buy("b1", "20240115", "10", "Interactive Brokers"),
        sell("s1", "20240615", "5", "Interactive Brokers", { isin: "XX0000000002", symbol: "SPINCO" }),
      ],
      new Map(),
      [ca],
    );
    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.isin).toBe("XX0000000002");
    expect(disposals[0]!.acquireBrokerSource).toBe("Interactive Brokers");
  });

  it("gives a crypto reward lot the broker of its reward, not a fixed Binance", () => {
    const reward: CashTransaction = {
      transactionID: "r1",
      accountId: "ACC1",
      symbol: "SOL",
      description: "Staking reward SOL",
      isin: "",
      currency: "SOL",
      dateTime: "2025-03-01",
      settleDate: "2025-03-01",
      amount: "2",
      fxRateToBase: "1",
      type: "Crypto Reward Income",
      taxBucket: "ahorro",
      rewardQuantity: "2",
      rewardCostBasisEur: "80",
      brokerSource: "Kraken",
    };
    const solSell = sell("s1", "2025-09-01", "2", "Kraken", {
      symbol: "SOL",
      description: "Sell SOL",
      isin: "",
      assetCategory: "CRYPTO",
      tradePrice: "50",
      tradeMoney: "100",
      proceeds: "100",
    });
    const report = generateTaxReport(
      {
        accountId: "ACC1",
        fromDate: "20250101",
        toDate: "20251231",
        period: "Annual",
        trades: [solSell],
        cashTransactions: [reward],
        corporateActions: [],
        openPositions: [],
        securitiesInfo: [],
      },
      new Map(),
      2025,
    );
    const [d] = report.capitalGains.disposals;
    expect(d!.brokerSource).toBe("Kraken");
    expect(d!.acquireBrokerSource).toBe("Kraken");
  });
});

describe("FxFifoEngine: event broker and lot broker", () => {
  const fx = (date: string, qty: string, broker: string): FxEvent => ({
    date,
    currency: "USD",
    quantity: new Decimal(qty),
    ecbRate: new Decimal("0.90"),
    trigger: "conversion",
    brokerSource: broker,
  });

  it("propagates brokerSource to FxLot, FxDisposal and the trace", () => {
    const engine = new FxFifoEngine();
    engine.enableTrace();
    engine.processEvents([fx("2024-01-15", "1000", "Interactive Brokers"), fx("2024-06-15", "-500", "Interactive Brokers")]);

    const disposals = engine.getDisposals();
    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.brokerSource).toBe("Interactive Brokers");

    const trace = engine.getTrace();
    expect(trace.length).toBeGreaterThanOrEqual(2);
    expect(trace[0]!.brokerSource).toBe("Interactive Brokers");
    expect(trace[1]!.brokerSource).toBe("Interactive Brokers");
  });

  it("propagates brokerSource when disposing without prior lots", () => {
    const engine = new FxFifoEngine();
    engine.processEvents([fx("2024-06-15", "-500", "Interactive Brokers")]);
    const disposals = engine.getDisposals();
    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.brokerSource).toBe("Interactive Brokers");
    expect(disposals[0]!.acquireBrokerSource).toBeUndefined();
  });

  it("names the broker the consumed currency came from", () => {
    // The FX pool is per currency across brokers: dollars bought at IBKR,
    // spent at Degiro.
    const engine = new FxFifoEngine();
    engine.processEvents([fx("2024-01-15", "1000", "Interactive Brokers"), fx("2024-06-15", "-500", "Degiro")]);
    const [d] = engine.getDisposals();
    expect(d!.brokerSource).toBe("Degiro");
    expect(d!.acquireBrokerSource).toBe("Interactive Brokers");
  });

  it("returns a sold position's principal to the pool with the broker it was bought with", () => {
    // USD converted at IBKR, a USD stock bought with it, the stock sold at
    // Degiro (break-even), then the dollars converted. The principal is still
    // the IBKR dollars; only the sale's profit would be Degiro's.
    const engine = new FxFifoEngine();
    engine.processEvents([
      fx("2024-01-15", "1000", "Interactive Brokers"),
      {
        kind: "stock_buy",
        date: "2024-02-01",
        currency: "USD",
        quantity: new Decimal(0),
        costFcy: new Decimal(1000),
        ecbRate: new Decimal("0.91"),
        trigger: "stock_purchase",
        positionKey: "X",
        brokerSource: "Interactive Brokers",
      },
      {
        kind: "stock_sell",
        date: "2024-03-01",
        currency: "USD",
        quantity: new Decimal(0),
        costFcy: new Decimal(1000),
        proceedsFcy: new Decimal(1000),
        ecbRate: new Decimal("0.92"),
        trigger: "stock_sale",
        positionKey: "X",
        brokerSource: "Degiro",
      },
      fx("2024-06-15", "-1000", "Degiro"),
    ]);
    const disposals = engine.getDisposals();
    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.acquireBrokerSource).toBe("Interactive Brokers");
  });
});
