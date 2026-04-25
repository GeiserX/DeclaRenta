import { describe, it, expect } from "vitest";
import { binanceParser } from "../../src/parsers/binance.js";

describe("binanceParser - Transaction History format", () => {
  it("should parse Binance Convert operations (two rows, same timestamp)", () => {
    const input = [
      "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark",
      "123,2025-01-15 10:00:00,Spot,Binance Convert,USDT,-100,",
      "123,2025-01-15 10:00:00,Spot,Binance Convert,BTC,0.002,",
    ].join("\n");
    const result = binanceParser.parse(input);
    expect(result.trades).toHaveLength(2);
    expect(result.trades[0].buySell).toBe("SELL");
    expect(result.trades[0].symbol).toBe("USDT");
    expect(result.trades[1].buySell).toBe("BUY");
    expect(result.trades[1].symbol).toBe("BTC");
  });

  it("should parse Transaction Sold + Revenue pairs", () => {
    const input = [
      "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark",
      "123,2025-01-15 10:00:00,Spot,Transaction Sold,BTC,-0.01,",
      "123,2025-01-15 10:00:00,Spot,Transaction Revenue,EUR,400,",
    ].join("\n");
    const result = binanceParser.parse(input);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].buySell).toBe("SELL");
    expect(result.trades[0].symbol).toBe("BTC");
  });

  it("should parse Transaction Buy + Spend pairs", () => {
    const input = [
      "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark",
      "123,2025-01-15 10:00:00,Spot,Transaction Buy,ETH,1,",
      "123,2025-01-15 10:00:00,Spot,Transaction Spend,EUR,-3000,",
    ].join("\n");
    const result = binanceParser.parse(input);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].buySell).toBe("BUY");
    expect(result.trades[0].symbol).toBe("ETH");
  });

  it("should handle Transaction Fee with Sold + Revenue", () => {
    const input = [
      "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark",
      "123,2025-01-15 10:00:00,Spot,Transaction Sold,BTC,-0.01,",
      "123,2025-01-15 10:00:00,Spot,Transaction Revenue,EUR,400,",
      "123,2025-01-15 10:00:00,Spot,Transaction Fee,EUR,-2,",
    ].join("\n");
    const result = binanceParser.parse(input);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].commission).not.toBe("0");
  });

  it("should handle Transaction Fee with Buy + Spend", () => {
    const input = [
      "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark",
      "123,2025-01-15 10:00:00,Spot,Transaction Buy,ETH,1,",
      "123,2025-01-15 10:00:00,Spot,Transaction Spend,EUR,-3000,",
      "123,2025-01-15 10:00:00,Spot,Transaction Fee,ETH,-0.01,",
    ].join("\n");
    const result = binanceParser.parse(input);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].commission).not.toBe("0");
  });

  it("should skip deposit and withdraw operations", () => {
    const input = [
      "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark",
      "123,2025-01-15 10:00:00,Spot,Deposit,BTC,0.5,",
      "123,2025-01-16 10:00:00,Spot,Withdraw,BTC,-0.3,",
    ].join("\n");
    const result = binanceParser.parse(input);
    expect(result.trades).toHaveLength(0);
  });

  it("should skip transfer operations", () => {
    const input = [
      "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark",
      "123,2025-01-15 10:00:00,Spot,Transfer Between Main and Funding Wallet,BTC,0.5,",
    ].join("\n");
    const result = binanceParser.parse(input);
    expect(result.trades).toHaveLength(0);
  });

  it("should skip zero change rows", () => {
    const input = [
      "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark",
      "123,2025-01-15 10:00:00,Spot,Binance Convert,BTC,0,",
    ].join("\n");
    const result = binanceParser.parse(input);
    expect(result.trades).toHaveLength(0);
  });

  it("should throw on missing required columns", () => {
    const input = [
      "User_ID,UTC_Time,Account",
      "123,2025-01-15 10:00:00,Spot",
    ].join("\n");
    expect(() => binanceParser.parse(input)).toThrow();
  });
});

describe("binanceParser - Trade History format", () => {
  it("should parse trade with fee containing asset code", () => {
    const input = [
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
      "2025-01-15 10:30:00,BTCEUR,BUY,40000,0.01,400,0.001BTC",
    ].join("\n");
    const result = binanceParser.parse(input);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].commissionCurrency).toBe("BTC");
  });

  it("should parse trade with numeric-only fee", () => {
    const input = [
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
      "2025-01-15 10:30:00,ETHEUR,SELL,3000,1,3000,1.5",
    ].join("\n");
    const result = binanceParser.parse(input);
    expect(result.trades[0].buySell).toBe("SELL");
  });

  it("should parse trade with empty fee", () => {
    const input = [
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
      "2025-01-15 10:30:00,BTCEUR,BUY,40000,0.01,400,",
    ].join("\n");
    const result = binanceParser.parse(input);
    expect(result.trades[0].commission).toBe("0");
  });

  it("should parse USDT pair", () => {
    const input = [
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
      "2025-01-15 10:30:00,BTCUSDT,BUY,40000,0.01,400,0.001BTC",
    ].join("\n");
    const result = binanceParser.parse(input);
    expect(result.trades[0].currency).toBe("USDT");
  });

  it("should parse FDUSD pair", () => {
    const input = [
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
      "2025-01-15 10:30:00,BTCFDUSD,BUY,40000,0.01,400,0",
    ].join("\n");
    const result = binanceParser.parse(input);
    expect(result.trades[0].currency).toBe("FDUSD");
  });

  it("should throw on unsupported pair", () => {
    const input = [
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
      "2025-01-15 10:30:00,X,BUY,40000,0.01,400,0",
    ].join("\n");
    expect(() => binanceParser.parse(input)).toThrow("par no soportado");
  });

  it("should skip rows with non buy/sell side", () => {
    const input = [
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
      "2025-01-15 10:30:00,BTCEUR,CONVERT,40000,0.01,400,0",
    ].join("\n");
    const result = binanceParser.parse(input);
    expect(result.trades).toHaveLength(0);
  });
});

describe("binanceParser.parse - empty/error cases", () => {
  it("should throw on empty CSV with content but no valid header", () => {
    expect(() => binanceParser.parse("some random content\nanother line")).toThrow("formato no reconocido");
  });

  it("should throw on completely empty file", () => {
    expect(() => binanceParser.parse("")).toThrow("fichero vacio o sin datos");
  });

  it("should throw on header-only file (tx format)", () => {
    const input = "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark";
    expect(() => binanceParser.parse(input)).toThrow("fichero vacio o sin datos");
  });
});

describe("binanceParser.detect", () => {
  it("should detect Trade History format", () => {
    expect(binanceParser.detect("Date(UTC),Pair,Side,Price,Executed,Amount,Fee\n")).toBe(true);
  });

  it("should detect Transaction History format", () => {
    expect(binanceParser.detect("User_ID,UTC_Time,Account,Operation,Coin,Change,Remark\n")).toBe(true);
  });

  it("should reject non-Binance input", () => {
    expect(binanceParser.detect("Timestamp,Transaction Type,Asset\n")).toBe(false);
  });
});
