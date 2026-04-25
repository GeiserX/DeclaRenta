import { describe, it, expect } from "vitest";
import { coinbaseParser } from "../../src/parsers/coinbase.js";

const V2_HEADER = "ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";

describe("coinbaseParser.detect", () => {
  it("should detect V1 format", () => {
    const input = "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total,Fees,Notes\n";
    expect(coinbaseParser.detect(input)).toBe(true);
  });

  it("should detect V2 format", () => {
    expect(coinbaseParser.detect(V2_HEADER + "\n")).toBe(true);
  });

  it("should reject non-Coinbase CSV", () => {
    expect(coinbaseParser.detect("Date,Pair,Side,Price\n")).toBe(false);
  });
});

describe("coinbaseParser.parse - edge cases", () => {
  it("should throw on empty input", () => {
    expect(() => coinbaseParser.parse("")).toThrow("fichero vacio o sin datos");
  });

  it("should throw on non-Coinbase content", () => {
    expect(() => coinbaseParser.parse("Date,Pair,Side\ndata")).toThrow("formato no reconocido");
  });

  it("should throw when only header, no data rows", () => {
    const input = "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";
    expect(() => coinbaseParser.parse(input)).toThrow("fichero vacio o sin datos");
  });

  it("should skip preamble lines before header", () => {
    const input = [
      "Coinbase Account Report",
      "Generated: 2025-01-01",
      "",
      "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes",
      "2025-01-15T10:00:00Z,Buy,BTC,0.01,EUR,40000,400,405,5,",
    ].join("\n");
    const result = coinbaseParser.parse(input);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].symbol).toBe("BTC");
    expect(result.trades[0].buySell).toBe("BUY");
  });

  it("should parse sell transactions", () => {
    const input = [
      "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes",
      "2025-03-15T10:00:00Z,Sell,ETH,1.5,EUR,3000,4500,4490,10,",
    ].join("\n");
    const result = coinbaseParser.parse(input);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].buySell).toBe("SELL");
  });

  it("should parse convert transactions with notes", () => {
    const input = [
      "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes",
      "2025-03-15T10:00:00Z,Convert,BTC,0.01,EUR,40000,400,395,5,Converted 0.01 BTC to 10 ETH",
    ].join("\n");
    const result = coinbaseParser.parse(input);
    // Convert produces SELL + BUY
    expect(result.trades).toHaveLength(2);
    expect(result.trades[0].buySell).toBe("SELL");
    expect(result.trades[1].buySell).toBe("BUY");
    expect(result.trades[1].symbol).toBe("ETH");
  });

  it("should parse convert without notes (no buy leg)", () => {
    const input = [
      "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes",
      "2025-03-15T10:00:00Z,Convert,BTC,0.01,EUR,40000,400,395,5,",
    ].join("\n");
    const result = coinbaseParser.parse(input);
    // Convert with no notes only produces SELL leg
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].buySell).toBe("SELL");
  });

  it("should parse staking income as cash transaction", () => {
    const input = [
      "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes",
      "2025-03-15T10:00:00Z,Staking Income,ETH,0.001,EUR,3000,3,3,0,Staking reward",
    ].join("\n");
    const result = coinbaseParser.parse(input);
    expect(result.trades).toHaveLength(0);
    expect(result.cashTransactions).toHaveLength(1);
    expect(result.cashTransactions[0].type).toBe("Dividends");
  });

  it("should parse rewards income as cash transaction", () => {
    const input = [
      "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes",
      "2025-03-15T10:00:00Z,Rewards Income,BTC,0.0001,EUR,40000,4,4,0,",
    ].join("\n");
    const result = coinbaseParser.parse(input);
    expect(result.cashTransactions).toHaveLength(1);
    expect(result.cashTransactions[0].type).toBe("Dividends");
  });

  it("should parse learning reward as cash transaction", () => {
    const input = [
      "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes",
      "2025-03-15T10:00:00Z,Learning Reward,XLM,10,EUR,0.5,5,5,0,Earn quiz",
    ].join("\n");
    const result = coinbaseParser.parse(input);
    expect(result.cashTransactions).toHaveLength(1);
  });

  it("should skip send and receive transactions", () => {
    const input = [
      "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes",
      "2025-03-15T10:00:00Z,Send,BTC,0.5,EUR,40000,20000,20000,0,",
      "2025-03-16T10:00:00Z,Receive,ETH,1,EUR,3000,3000,3000,0,",
    ].join("\n");
    const result = coinbaseParser.parse(input);
    expect(result.trades).toHaveLength(0);
    expect(result.cashTransactions).toHaveLength(0);
  });

  it("should skip rows with zero quantity", () => {
    const input = [
      "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes",
      "2025-03-15T10:00:00Z,Buy,BTC,0,EUR,40000,0,0,0,",
    ].join("\n");
    const result = coinbaseParser.parse(input);
    expect(result.trades).toHaveLength(0);
  });

  it("should skip rows with missing asset or timestamp", () => {
    const input = [
      "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes",
      ",Buy,,1,EUR,40000,40000,40000,0,",
    ].join("\n");
    const result = coinbaseParser.parse(input);
    expect(result.trades).toHaveLength(0);
  });

  it("should handle missing columns gracefully", () => {
    const input = [
      "Timestamp,Transaction Type,Asset",
      "2025-03-15T10:00:00Z,Buy,BTC",
    ].join("\n");
    // Won't detect as Coinbase because missing required headers
    expect(coinbaseParser.detect(input)).toBe(false);
  });

  it("should handle zero fees", () => {
    const input = [
      "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes",
      "2025-03-15T10:00:00Z,Buy,BTC,0.01,EUR,40000,400,400,0,",
    ].join("\n");
    const result = coinbaseParser.parse(input);
    expect(result.trades[0].commission).toBe("0");
  });

  it("should handle V2 format headers", () => {
    const input = [
      V2_HEADER,
      "abc123,2025-03-15T10:00:00Z,Buy,BTC,0.01,EUR,40000,400,405,5,",
    ].join("\n");
    const result = coinbaseParser.parse(input);
    expect(result.trades).toHaveLength(1);
  });
});
