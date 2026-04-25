import { describe, it, expect } from "vitest";
import { scalableParser } from "../../src/parsers/scalable.js";

const HEADER = "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency";

describe("scalableParser - branch coverage", () => {
  it("should parse dividend with withholding tax", () => {
    const input = [
      HEADER,
      "2025-01-15;10:00;executed;REF001;Vanguard FTSE;ETF;distribution;IE00B3RBWM25;0;0;5.00;0;-0.75;EUR",
    ].join("\n");
    const result = scalableParser.parse(input);
    expect(result.cashTransactions).toHaveLength(2);
    expect(result.cashTransactions[0].type).toBe("Dividends");
    expect(result.cashTransactions[1].type).toBe("Withholding Tax");
  });

  it("should parse dividend without withholding tax", () => {
    const input = [
      HEADER,
      "2025-01-15;10:00;executed;REF001;Vanguard FTSE;ETF;dividend;IE00B3RBWM25;0;0;5.00;0;0;EUR",
    ].join("\n");
    const result = scalableParser.parse(input);
    expect(result.cashTransactions).toHaveLength(1);
    expect(result.cashTransactions[0].type).toBe("Dividends");
  });

  it("should parse sell trade", () => {
    const input = [
      HEADER,
      "2025-01-15;10:00;executed;REF001;iShares MSCI;ETF;sell;IE00B4L5Y983;-50;45.00;2250;-1.00;0;EUR",
    ].join("\n");
    const result = scalableParser.parse(input);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].buySell).toBe("SELL");
  });

  it("should parse savings plan as buy", () => {
    const input = [
      HEADER,
      "2025-01-15;10:00;executed;REF001;iShares MSCI;ETF;savings plan;IE00B4L5Y983;10;45.00;450;0;0;EUR",
    ].join("\n");
    const result = scalableParser.parse(input);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].buySell).toBe("BUY");
  });

  it("should skip non-executed transactions", () => {
    const input = [
      HEADER,
      "2025-01-15;10:00;cancelled;REF001;iShares MSCI;ETF;buy;IE00B4L5Y983;10;45.00;450;0;0;EUR",
    ].join("\n");
    const result = scalableParser.parse(input);
    expect(result.trades).toHaveLength(0);
  });

  it("should skip rows without ISIN", () => {
    const input = [
      HEADER,
      "2025-01-15;10:00;executed;REF001;Some Product;ETF;buy;;10;45.00;450;0;0;EUR",
    ].join("\n");
    const result = scalableParser.parse(input);
    expect(result.trades).toHaveLength(0);
  });

  it("should skip rows with zero shares", () => {
    const input = [
      HEADER,
      "2025-01-15;10:00;executed;REF001;iShares MSCI;ETF;buy;IE00B4L5Y983;0;45.00;0;0;0;EUR",
    ].join("\n");
    const result = scalableParser.parse(input);
    expect(result.trades).toHaveLength(0);
  });

  it("should skip unrecognized transaction types", () => {
    const input = [
      HEADER,
      "2025-01-15;10:00;executed;REF001;Fee;FEE;fee;IE00B4L5Y983;0;0;-1.00;0;0;EUR",
    ].join("\n");
    const result = scalableParser.parse(input);
    expect(result.trades).toHaveLength(0);
  });

  it("should handle comma delimiter fallback", () => {
    const header = "date,time,status,reference,description,assetType,type,isin,shares,price,amount,fee,tax,currency";
    const row = "2025-01-15,10:00,executed,REF001,iShares MSCI,ETF,buy,IE00B4L5Y983,10,45.00,450,0,0,EUR";
    const input = `${header}\n${row}`;
    const result = scalableParser.parse(input);
    expect(result.trades).toHaveLength(1);
  });

  it("should handle positive withholding tax amount (converts to negative)", () => {
    const input = [
      HEADER,
      "2025-01-15;10:00;executed;REF001;Vanguard;ETF;distribution;IE00B3RBWM25;0;0;5.00;0;0.75;EUR",
    ].join("\n");
    const result = scalableParser.parse(input);
    const wht = result.cashTransactions.find((ct) => ct.type === "Withholding Tax");
    expect(wht).toBeDefined();
    expect(wht.amount).toBe("-0.75");
  });

  it("should allow empty status field (treated as executed)", () => {
    const input = [
      HEADER,
      "2025-01-15;10:00;;REF001;iShares MSCI;ETF;buy;IE00B4L5Y983;10;45.00;450;0;0;EUR",
    ].join("\n");
    const result = scalableParser.parse(input);
    expect(result.trades).toHaveLength(1);
  });

  it("should use reference as trade ID", () => {
    const input = [
      HEADER,
      "2025-01-15;10:00;executed;MY-REF-456;iShares;ETF;buy;IE00B4L5Y983;10;45.00;450;0;0;EUR",
    ].join("\n");
    const result = scalableParser.parse(input);
    expect(result.trades[0].tradeID).toBe("MY-REF-456");
  });

  it("should generate fallback trade ID when no reference", () => {
    const input = [
      HEADER,
      "2025-01-15;10:00;executed;;iShares;ETF;buy;IE00B4L5Y983;10;45.00;450;0;0;EUR",
    ].join("\n");
    const result = scalableParser.parse(input);
    expect(result.trades[0].tradeID).toContain("scalable");
  });
});

describe("scalableParser - error cases", () => {
  it("should throw on empty input", () => {
    expect(() => scalableParser.parse("")).toThrow("fichero vacío o sin datos");
  });

  it("should throw on unrecognized format", () => {
    expect(() => scalableParser.parse("Date;Pair;Side\ndata;pair;buy")).toThrow("formato no reconocido");
  });
});

describe("scalableParser.detect", () => {
  it("should detect Scalable CSV", () => {
    expect(scalableParser.detect(HEADER + "\n")).toBe(true);
  });

  it("should reject non-Scalable input", () => {
    expect(scalableParser.detect("Date,Pair,Side\n")).toBe(false);
  });
});
