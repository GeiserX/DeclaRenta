/**
 * Overlapping exports from the same broker.
 *
 * Binance and Coinbase exports are picked by date range, so a user can upload
 * two files that share some rows. mergeStatement appends every trade, and the
 * only guard is the "duplicate trades" warning in validateStatement, which keys
 * on tradeID. These tests pin that the tradeID of a row does not depend on the
 * row's position in the file: the same row in two files gets the same ID (the
 * warning fires), and different rows never share one (no false warning).
 */

import { describe, expect, it } from "vitest";
import { binanceParser } from "../../src/parsers/binance.js";
import { coinbaseParser } from "../../src/parsers/coinbase.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { BrokerParser, Statement } from "../../src/types/broker.js";
import { validateStatement } from "../../src/web/validation.js";

function mergeFiles(parser: BrokerParser, ...files: string[]): Statement {
  const merged = createEmptyStatement();
  for (const f of files) mergeStatement(merged, parser.parse(f));
  return finalizeMergedStatement(merged);
}

/** The duplicate count reported by the validator, or 0 when it stays silent. */
function duplicateCount(statement: Statement): number {
  const issue = validateStatement(statement, 2024).find((i) => /duplicad/.test(i.message));
  if (!issue) return 0;
  return Number(issue.message.match(/(\d+) operación/)![1]);
}

const SPOT_HEADER = "Date(UTC),Pair,Side,Price,Executed,Amount,Fee";
const SPOT_BUY_BTC = "2024-03-10 09:00:00,BTCEUR,BUY,10000,2,20000,0";
const SPOT_SELL_BTC = "2024-03-10 15:00:00,BTCEUR,SELL,30000,1,30000,0";
const SPOT_BUY_ETH = "2024-03-10 10:00:00,ETHEUR,BUY,3000,1,3000,0";
const SPOT_BUY_ETH_2 = "2024-03-10 11:00:00,ETHEUR,BUY,3100,1,3100,0";

const TX_HEADER = "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark";
const TX_CONVERT = [
  "123,2024-03-10 12:00:00,Spot,Binance Convert,SOL,10,",
  "123,2024-03-10 12:00:00,Spot,Binance Convert,USDT,-200,",
];
const TX_OTHER = [
  "123,2024-03-10 08:00:00,Spot,Binance Convert,SOL,5,",
  "123,2024-03-10 08:00:00,Spot,Binance Convert,USDT,-100,",
];

/** An unrelated Convert on another day, used only to shift row positions. */
const TX_FILLER = [
  "123,2024-03-09 12:00:00,Spot,Binance Convert,ADA,100,",
  "123,2024-03-09 12:00:00,Spot,Binance Convert,USDT,-50,",
];

const CB_V2_HEADER = "ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";
const CB_V1_HEADER = "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";
const CB_BUY_AAA = "id-aaa,2024-03-10T09:00:00Z,Buy,BTC,2,EUR,10000,20000,20000,0,";
const CB_SELL_BBB = "id-bbb,2024-03-10T15:00:00Z,Sell,BTC,1,EUR,30000,30000,30000,0,";
const CB_BUY_CCC = "id-ccc,2024-03-10T10:00:00Z,Buy,ETH,1,EUR,3000,3000,3000,0,";
const CB_BUY_EEE = "id-eee,2024-03-10T11:00:00Z,Buy,ETH,1,EUR,3100,3100,3100,0,";
const CB_BUY_FFF = "id-fff,2024-03-10T13:00:00Z,Buy,BTC,1,EUR,12000,12000,12000,0,";

describe("overlapping Binance Trade History exports", () => {
  it("flags the one shared SELL when it sits at a different row in each file", () => {
    const file1 = [SPOT_HEADER, SPOT_BUY_BTC, SPOT_SELL_BTC].join("\n");
    const file2 = [SPOT_HEADER, SPOT_BUY_ETH, SPOT_BUY_ETH_2, SPOT_SELL_BTC].join("\n");
    expect(duplicateCount(mergeFiles(binanceParser, file1, file2))).toBe(1);
  });

  it("does not flag a BUY and a SELL that sit at the same row in two files", () => {
    const file1 = [SPOT_HEADER, SPOT_BUY_BTC].join("\n");
    const file2 = [SPOT_HEADER, SPOT_SELL_BTC].join("\n");
    expect(duplicateCount(mergeFiles(binanceParser, file1, file2))).toBe(0);
  });

  it("keeps two identical fills in one file as two trades with distinct IDs", () => {
    const file = [SPOT_HEADER, SPOT_BUY_BTC, SPOT_BUY_BTC].join("\n");
    const merged = mergeFiles(binanceParser, file);
    expect(merged.trades).toHaveLength(2);
    expect(duplicateCount(merged)).toBe(0);
  });

  it("still flags every trade when the same file is uploaded twice", () => {
    const file = [SPOT_HEADER, SPOT_BUY_BTC, SPOT_BUY_BTC, SPOT_SELL_BTC].join("\n");
    expect(duplicateCount(mergeFiles(binanceParser, file, file))).toBe(3);
  });
});

describe("overlapping Binance Transaction History exports", () => {
  it("flags the shared Convert when it sits at different rows in each file", () => {
    const file1 = [TX_HEADER, ...TX_CONVERT].join("\n");
    const file2 = [TX_HEADER, ...TX_FILLER, ...TX_CONVERT].join("\n");
    // The Convert emits a SELL USDT and a BUY SOL: both are repeated.
    expect(duplicateCount(mergeFiles(binanceParser, file1, file2))).toBe(2);
  });

  it("does not flag two different same-day Converts that sit at the same rows in two files", () => {
    const file1 = [TX_HEADER, ...TX_CONVERT].join("\n");
    const file2 = [TX_HEADER, ...TX_OTHER].join("\n");
    expect(duplicateCount(mergeFiles(binanceParser, file1, file2))).toBe(0);
  });

  it("gives a shared reward the same transaction ID in both files", () => {
    const reward = "123,2024-03-11 00:00:00,Earn,Simple Earn Flexible Interest,BTC,0.001,";
    const file1 = [TX_HEADER, reward].join("\n");
    const file2 = [TX_HEADER, ...TX_FILLER, reward].join("\n");
    const ids = mergeFiles(binanceParser, file1, file2).cashTransactions.map((c) => c.transactionID);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });
});

describe("overlapping Coinbase exports", () => {
  it("flags the shared row by its Coinbase ID when it sits at different rows", () => {
    const file1 = [CB_V2_HEADER, CB_BUY_AAA, CB_SELL_BBB].join("\n");
    const file2 = [CB_V2_HEADER, CB_BUY_CCC, CB_BUY_EEE, CB_SELL_BBB].join("\n");
    expect(duplicateCount(mergeFiles(coinbaseParser, file1, file2))).toBe(1);
  });

  it("does not flag two different same-day BTC buys that sit at the same row", () => {
    const file1 = [CB_V2_HEADER, CB_BUY_AAA].join("\n");
    const file2 = [CB_V2_HEADER, CB_BUY_FFF].join("\n");
    expect(duplicateCount(mergeFiles(coinbaseParser, file1, file2))).toBe(0);
  });

  it("gives both legs of a shared Convert distinct IDs that match across files", () => {
    const convert = "id-ddd,2024-03-10T12:00:00Z,Convert,BTC,0.1,EUR,30000,3000,3000,0,Converted 0.1 BTC to 1 ETH";
    const file1 = [CB_V2_HEADER, convert].join("\n");
    const file2 = [CB_V2_HEADER, CB_BUY_CCC, convert].join("\n");
    const one = coinbaseParser.parse(file1).trades.map((t) => t.tradeID);
    expect(new Set(one).size).toBe(2);
    expect(duplicateCount(mergeFiles(coinbaseParser, file1, file2))).toBe(2);
  });

  it("still parses a V1 export without an ID column", () => {
    const file = [CB_V1_HEADER, CB_BUY_AAA.slice("id-aaa,".length), CB_SELL_BBB.slice("id-bbb,".length)].join("\n");
    const result = coinbaseParser.parse(file);
    expect(result.trades).toHaveLength(2);
    expect(new Set(result.trades.map((t) => t.tradeID)).size).toBe(2);
  });

  it("still flags every trade when the same V2 file is uploaded twice", () => {
    const file = [CB_V2_HEADER, CB_BUY_AAA, CB_SELL_BBB].join("\n");
    expect(duplicateCount(mergeFiles(coinbaseParser, file, file))).toBe(2);
  });
});
