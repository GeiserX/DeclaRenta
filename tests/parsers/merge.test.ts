import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import { krakenParser } from "../../src/parsers/kraken.js";
import { coinbaseParser } from "../../src/parsers/coinbase.js";
import { degiroParser } from "../../src/parsers/degiro.js";
import { lightyearParser } from "../../src/parsers/lightyear.js";
import { scalableParser } from "../../src/parsers/scalable.js";
import { trading212Parser } from "../../src/parsers/trading212.js";
import { binanceParser } from "../../src/parsers/binance.js";
import { generateTaxReport } from "../../src/generators/report.js";
import type { Statement } from "../../src/types/broker.js";

function makeStatement(overrides: Partial<Statement>): Statement {
  return {
    accountId: "",
    fromDate: "",
    toDate: "",
    period: "",
    trades: [],
    cashTransactions: [],
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
    ...overrides,
  };
}

describe("statement merge utilities", () => {
  it("creates an empty statement with optional collections initialized", () => {
    const statement = createEmptyStatement();

    expect(statement.trades).toEqual([]);
    expect(statement.cashBalances).toEqual([]);
    expect(statement.optionExercises).toEqual([]);
    expect(statement.parserWarnings).toEqual([]);
  });

  it("appends all declaration-relevant arrays instead of overwriting later files", () => {
    const target = createEmptyStatement();
    const first = makeStatement({
      accountId: "A1",
      fromDate: "20240101",
      toDate: "20241231",
      period: "2024",
      openPositions: [{
        accountId: "A1",
        symbol: "AAA",
        description: "AAA",
        isin: "US0000000001",
        currency: "USD",
        assetCategory: "STK",
        quantity: "1",
        costBasisMoney: "10",
        costBasisPrice: "10",
        markPrice: "10",
        positionValue: "10",
        fifoPnlUnrealized: "0",
        fxRateToBase: "1",
      }],
      cashBalances: [{ accountId: "A1", currency: "USD", endingCash: "100", endingSettledCash: "100", averageQ4Cash: "90" }],
      parserWarnings: ["first warning"],
    });
    const second = makeStatement({
      accountId: "A2",
      fromDate: "20230101",
      toDate: "20251231",
      period: "2025",
      openPositions: [{
        accountId: "A2",
        symbol: "BBB",
        description: "BBB",
        isin: "IE0000000002",
        currency: "EUR",
        assetCategory: "FUND",
        quantity: "2",
        costBasisMoney: "20",
        costBasisPrice: "10",
        markPrice: "11",
        positionValue: "22",
        fifoPnlUnrealized: "2",
        fxRateToBase: "1",
      }],
      cashBalances: [{ accountId: "A2", currency: "EUR", endingCash: "200", endingSettledCash: "200", averageQ4Cash: "180" }],
      optionExercises: [{
        transactionID: "EX1",
        accountId: "A2",
        symbol: "BBB 202501 C10",
        description: "BBB call",
        isin: "",
        currency: "EUR",
        date: "20250115",
        action: "Exercise",
        putCall: "C",
        strike: "10",
        expiry: "20250117",
        quantity: "1",
        proceeds: "0",
        underlyingSymbol: "BBB",
        underlyingIsin: "IE0000000002",
        multiplier: "100",
      }],
      parserWarnings: ["second warning"],
    });

    mergeStatement(target, first);
    mergeStatement(target, second);

    expect(target.accountId).toBe("A1");
    expect(target.fromDate).toBe("20230101");
    expect(target.toDate).toBe("20251231");
    expect(target.openPositions.map((p) => p.symbol)).toEqual(["AAA", "BBB"]);
    expect(target.cashBalances?.map((b) => b.accountId)).toEqual(["A1", "A2"]);
    expect(target.optionExercises?.map((e) => e.transactionID)).toEqual(["EX1"]);
    expect(target.parserWarnings).toEqual(["first warning", "second warning"]);
  });

  it("carries every file's manualRateHints through the merge", () => {
    const target = createEmptyStatement();
    mergeStatement(target, makeStatement({ manualRateHints: [{ currency: "AAA", date: "20250101", eurPerUnit: "1.5" }] }));
    mergeStatement(target, makeStatement({ manualRateHints: [{ currency: "BBB", date: "20250102", eurPerUnit: "2" }] }));
    finalizeMergedStatement(target);

    expect(target.manualRateHints).toEqual([
      { currency: "AAA", date: "20250101", eurPerUnit: "1.5" },
      { currency: "BBB", date: "20250102", eurPerUnit: "2" },
    ]);
  });

  function makeTrade(overrides: Partial<Statement["trades"][number]>): Statement["trades"][number] {
    return {
      tradeID: "T1",
      accountId: "",
      symbol: "AAA",
      description: "AAA",
      isin: "US0000000001",
      assetCategory: "STK",
      currency: "USD",
      tradeDate: "20250101",
      settlementDate: "20250101",
      quantity: "1",
      tradePrice: "10",
      tradeMoney: "10",
      proceeds: "0",
      cost: "10",
      fifoPnlRealized: "0",
      fxRateToBase: "1",
      buySell: "BUY",
      openCloseIndicator: "O",
      exchange: "NYSE",
      commissionCurrency: "USD",
      commission: "0",
      taxes: "0",
      multiplier: "1",
      ...overrides,
    };
  }

  it("reconciliation leaves non-Flatex trades (IBKR AFx notes) untouched", () => {
    const statement = makeStatement({
      trades: [makeTrade({ notes: "AFx", commission: "0" })],
    });

    finalizeMergedStatement(statement);

    expect(statement.trades[0]!.notes).toBe("AFx");
    expect(statement.trades[0]!.commission).toBe("0");
    expect(statement.pendingOrderLegs).toBeUndefined();
  });

  it("reconciles Flatex commission, clears the scratch note, and drops pendingOrderLegs", () => {
    const statement = makeStatement({
      trades: [
        makeTrade({
          isin: "US94106L1098",
          buySell: "BUY",
          currency: "EUR",
          commissionCurrency: "EUR",
          tradeMoney: "3762.4",
          notes: "flatex-order:329432092",
        }),
      ],
      pendingOrderLegs: [
        { orderKey: "329432092", netAmount: "-3770.3", isin: "US94106L1098", currency: "EUR", tradeDate: "20250101" },
      ],
    });

    finalizeMergedStatement(statement);

    const trade = statement.trades[0]!;
    expect(trade.commission).toBe("7.9");
    expect(trade.cost).toBe("10"); // gross, unchanged by reconciliation
    expect(trade.notes).toBeUndefined();
    expect(statement.pendingOrderLegs).toBeUndefined();
  });

  it("gives each partial fill of one Flatex order its own commission", () => {
    // One order filled on two days: one Depot row and one cash leg per fill,
    // all sharing the order number. Legs listed newest first, as Flatex does.
    const statement = makeStatement({
      trades: [
        makeTrade({ tradeID: "F1", currency: "EUR", tradeDate: "20250310", quantity: "10", tradeMoney: "1000", notes: "flatex-order:329000001" }),
        makeTrade({ tradeID: "F2", currency: "EUR", tradeDate: "20250311", quantity: "30", tradeMoney: "3000", notes: "flatex-order:329000001" }),
      ],
      pendingOrderLegs: [
        { orderKey: "329000001", netAmount: "-3007.9", isin: "US0000000001", currency: "EUR", tradeDate: "20250311" },
        { orderKey: "329000001", netAmount: "-1007.9", isin: "US0000000001", currency: "EUR", tradeDate: "20250310" },
      ],
    });

    finalizeMergedStatement(statement);

    expect(statement.trades.map((t) => [t.tradeID, t.commission])).toEqual([
      ["F1", "7.9"],
      ["F2", "7.9"],
    ]);
    expect(statement.parserMessages ?? []).toEqual([]);
  });

  it("splits one combined cash leg across the fills pro rata and says so", () => {
    const statement = makeStatement({
      trades: [
        makeTrade({ tradeID: "F1", currency: "EUR", tradeDate: "20250310", tradeMoney: "1000", notes: "flatex-order:329000001" }),
        makeTrade({ tradeID: "F2", currency: "EUR", tradeDate: "20250311", tradeMoney: "3000", notes: "flatex-order:329000001" }),
      ],
      pendingOrderLegs: [
        { orderKey: "329000001", netAmount: "-4015.8", isin: "US0000000001", currency: "EUR", tradeDate: "20250311" },
      ],
    });

    finalizeMergedStatement(statement);

    expect(statement.trades.map((t) => t.commission)).toEqual(["3.95", "11.85"]);
    const msg = statement.parserMessages!.find((m) => m.id === "flatex.commission.multi_fill_prorated");
    expect(msg?.context).toEqual({ orders: "1" });
  });

  it("does not derive a commission when the cash leg is in another currency", () => {
    // USD venue price, EUR cash account: |net| − gross would be the FX
    // difference (142.1), not the fee.
    const statement = makeStatement({
      trades: [
        makeTrade({ currency: "USD", commissionCurrency: "USD", tradeMoney: "1000", notes: "flatex-order:329000002" }),
      ],
      pendingOrderLegs: [
        { orderKey: "329000002", netAmount: "-857.9", isin: "US0000000001", currency: "EUR", tradeDate: "20250101" },
      ],
    });

    finalizeMergedStatement(statement);

    expect(statement.trades[0]!.commission).toBe("0");
    expect(statement.trades[0]!.commissionCurrency).toBe("USD");
    const msg = statement.parserMessages!.find((m) => m.id === "flatex.commission.cross_currency");
    expect(msg?.context).toEqual({ trades: "1" });
    expect(statement.parserMessages!.some((m) => m.id === "flatex.commission.unmatched_trades")).toBe(false);
  });

  it("sorts merged chronological collections deterministically", () => {
    const statement = makeStatement({
      trades: [
        {
          tradeID: "2",
          accountId: "",
          symbol: "AAA",
          description: "AAA",
          isin: "US0000000001",
          assetCategory: "STK",
          currency: "USD",
          tradeDate: "20250102",
          settlementDate: "20250102",
          quantity: "1",
          tradePrice: "10",
          tradeMoney: "-10",
          proceeds: "0",
          cost: "-10",
          fifoPnlRealized: "0",
          fxRateToBase: "1",
          buySell: "BUY",
          openCloseIndicator: "O",
          exchange: "NYSE",
          commissionCurrency: "USD",
          commission: "0",
          taxes: "0",
          multiplier: "1",
        },
        {
          tradeID: "1",
          accountId: "",
          symbol: "AAA",
          description: "AAA",
          isin: "US0000000001",
          assetCategory: "STK",
          currency: "USD",
          tradeDate: "20250101",
          settlementDate: "20250101",
          quantity: "1",
          tradePrice: "10",
          tradeMoney: "-10",
          proceeds: "0",
          cost: "-10",
          fifoPnlRealized: "0",
          fxRateToBase: "1",
          buySell: "BUY",
          openCloseIndicator: "O",
          exchange: "NYSE",
          commissionCurrency: "USD",
          commission: "0",
          taxes: "0",
          multiplier: "1",
        },
      ],
      cashTransactions: [
        { transactionID: "C2", accountId: "", symbol: "AAA", description: "div", isin: "US0000000001", currency: "USD", dateTime: "20250103", settleDate: "20250103", amount: "1", fxRateToBase: "1", type: "Dividends" },
        { transactionID: "C1", accountId: "", symbol: "AAA", description: "div", isin: "US0000000001", currency: "USD", dateTime: "20250102", settleDate: "20250102", amount: "1", fxRateToBase: "1", type: "Dividends" },
      ],
      corporateActions: [
        { transactionID: "CA2", accountId: "", symbol: "AAA", description: "split", isin: "US0000000001", currency: "USD", reportDate: "20250104", dateTime: "20250104", quantity: "0", amount: "0", type: "FS", actionDescription: "split" },
        { transactionID: "CA1", accountId: "", symbol: "AAA", description: "split", isin: "US0000000001", currency: "USD", reportDate: "20250101", dateTime: "20250101", quantity: "0", amount: "0", type: "FS", actionDescription: "split" },
      ],
      optionExercises: [
        { transactionID: "EX2", accountId: "", symbol: "AAA", description: "call", isin: "", currency: "USD", date: "20250105", action: "Exercise", putCall: "C", strike: "10", expiry: "20250117", quantity: "1", proceeds: "0", underlyingSymbol: "AAA", underlyingIsin: "US0000000001", multiplier: "100" },
        { transactionID: "EX1", accountId: "", symbol: "AAA", description: "call", isin: "", currency: "USD", date: "20250102", action: "Exercise", putCall: "C", strike: "10", expiry: "20250117", quantity: "1", proceeds: "0", underlyingSymbol: "AAA", underlyingIsin: "US0000000001", multiplier: "100" },
      ],
    });

    finalizeMergedStatement(statement);

    expect(statement.trades.map((t) => t.tradeID)).toEqual(["1", "2"]);
    expect(statement.cashTransactions.map((t) => t.transactionID)).toEqual(["C1", "C2"]);
    expect(statement.corporateActions.map((a) => a.transactionID)).toEqual(["CA1", "CA2"]);
    expect(statement.optionExercises?.map((e) => e.transactionID)).toEqual(["EX1", "EX2"]);
  });
});

// Art. 37.2 LIRPF: a sale consumes the units acquired first. Two buys on the
// same day at different prices must be consumed in the order they executed,
// whatever their trade IDs look like and whichever way the export is sorted.
describe("same-day trade order through merge and finalize", () => {
  function acquisitionValue(parsed: Statement): string {
    const merged = createEmptyStatement();
    mergeStatement(merged, parsed);
    finalizeMergedStatement(merged);
    const report = generateTaxReport(merged, new Map(), 2025, { skipFx: true });
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("300.00");
    return report.capitalGains.acquisitionValue.toFixed(2);
  }

  const krakenHeader = '"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers"';
  // Random Kraken txids: the 09:00 buy has the ID that sorts last.
  const krakenRows = [
    '"TZZZ","O1","XBTEUR","2025-01-10 09:00:00","buy","limit","100.00","100.00","0","1","0.0","","L1"',
    '"TAAA","O2","XBTEUR","2025-01-10 15:00:00","buy","limit","200.00","200.00","0","1","0.0","","L2"',
    '"TMMM","O3","XBTEUR","2025-02-10 10:00:00","sell","limit","300.00","300.00","0","1","0.0","","L3"',
  ];

  it("Kraken: the 09:00 buy is consumed first even though its txid sorts last", () => {
    const csv = [krakenHeader, ...krakenRows].join("\n");
    expect(acquisitionValue(krakenParser.parse(csv))).toBe("100.00");
  });

  it("Kraken: a newest-first export still consumes the 09:00 buy first", () => {
    const csv = [krakenHeader, ...[...krakenRows].reverse()].join("\n");
    expect(acquisitionValue(krakenParser.parse(csv))).toBe("100.00");
  });

  it("Coinbase: rows 9 and 10 on the same day keep their time order ('-10' sorts before '-9' as text)", () => {
    const header = "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees),Fees,Notes";
    const sends = Array.from({ length: 8 }, (_, k) => `2025-01-0${k + 1}T08:00:00Z,Send,ETH,-0.1,EUR,3000,300,300,0,Sent`);
    const csv = [
      header,
      ...sends,
      "2025-01-10T09:00:00Z,Buy,BTC,1,EUR,100,100,100,0,Bought 1 BTC",
      "2025-01-10T15:00:00Z,Buy,BTC,1,EUR,200,200,200,0,Bought 1 BTC",
      "2025-02-10T10:00:00Z,Sell,BTC,1,EUR,300,300,300,0,Sold 1 BTC",
    ].join("\n");
    expect(acquisitionValue(coinbaseParser.parse(csv))).toBe("100.00");
  });

  it("Degiro: a newest-first export consumes the earlier same-day buy first", () => {
    const csv = [
      "Fecha,Hora,Producto,ISIN,Bolsa de,Centro de ejecución,Número,Precio,,Valor local,,Valor,,Tipo de cambio,Costes de transacción,,Total,,ID Orden",
      "10-02-2025,10:00,BETA CHIPS INC,XX0000000002,TDG,XGAT,-1,300.0000,EUR,300.00,EUR,300.00,EUR,,0.00,EUR,300.00,EUR,cccc1111-2222-3333-4444-555566667777",
      "10-01-2025,15:00,BETA CHIPS INC,XX0000000002,TDG,XGAT,1,200.0000,EUR,-200.00,EUR,-200.00,EUR,,0.00,EUR,-200.00,EUR,aaaa1111-2222-3333-4444-555566667777",
      "10-01-2025,09:00,BETA CHIPS INC,XX0000000002,TDG,XGAT,1,100.0000,EUR,-100.00,EUR,-100.00,EUR,,0.00,EUR,-100.00,EUR,bbbb1111-2222-3333-4444-555566667777",
    ].join("\n");
    expect(acquisitionValue(degiroParser.parse(csv))).toBe("100.00");
  });

  function fixture(name: string): string {
    return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf-8");
  }

  it.each([
    ["degiro-transactions-sample.csv", degiroParser, "19:52:00"],
    ["kraken-trades-sample.csv", krakenParser, "10:30:00"],
    ["coinbase-sample.csv", coinbaseParser, "10:30:00"],
    ["lightyear-sample.csv", lightyearParser, "13:47:22"],
    ["scalable-sample.csv", scalableParser, "09:15:00"],
    ["trading212-sample.csv", trading212Parser, "09:30:00"],
    ["binance-sample.csv", binanceParser, "10:30:00"],
    ["binance-spot-es-sample.csv", binanceParser, "01:00:45"],
  ])("%s: trades carry the time of day of their row", (name, parser, time) => {
    const trades = parser.parse(fixture(name)).trades;
    expect(trades[0]!.tradeTime).toBe(time);
    expect(trades.every((t) => /^\d{2}:\d{2}:\d{2}$/.test(t.tradeTime ?? ""))).toBe(true);
  });
});
