import { describe, expect, it } from "vitest";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
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
