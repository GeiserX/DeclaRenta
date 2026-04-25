import { describe, it, expect } from "vitest";
import { lightyearParser } from "../../src/parsers/lightyear.js";

const HEADER = "Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.";

describe("lightyearParser - branch coverage", () => {
  it("should parse interest income (no ticker)", () => {
    const input = [
      HEADER,
      "15/01/2025,REF001,,,Interest,,EUR,,,,0,5.00,0",
    ].join("\n");
    const result = lightyearParser.parse(input);
    expect(result.cashTransactions).toHaveLength(1);
    expect(result.cashTransactions[0].type).toBe("Broker Interest Received");
    expect(result.cashTransactions[0].symbol).toBe("INTEREST");
  });

  it("should parse reward income", () => {
    const input = [
      HEADER,
      "15/01/2025,REF001,,,Reward,,EUR,,,,0,10.00,0",
    ].join("\n");
    const result = lightyearParser.parse(input);
    expect(result.cashTransactions).toHaveLength(1);
    expect(result.cashTransactions[0].type).toBe("Broker Interest Received");
  });

  it("should skip zero amount interest", () => {
    const input = [
      HEADER,
      "15/01/2025,REF001,,,Interest,,EUR,,,,0,0,0",
    ].join("\n");
    const result = lightyearParser.parse(input);
    expect(result.cashTransactions).toHaveLength(0);
  });

  it("should parse distribution with withholding tax", () => {
    const input = [
      HEADER,
      "15/01/2025,REF001,VWRL,IE00B3RBWM25,Distribution,,,10,10,1,0,8.50,-1.50",
    ].join("\n");
    const result = lightyearParser.parse(input);
    expect(result.cashTransactions).toHaveLength(2);
    expect(result.cashTransactions[0].type).toBe("Dividends");
    expect(result.cashTransactions[1].type).toBe("Withholding Tax");
  });

  it("should parse dividend without withholding tax", () => {
    const input = [
      HEADER,
      "15/01/2025,REF001,AAPL,US0378331005,Dividend,,,2.50,2.50,1,0,2.50,0",
    ].join("\n");
    const result = lightyearParser.parse(input);
    expect(result.cashTransactions).toHaveLength(1);
    expect(result.cashTransactions[0].type).toBe("Dividends");
  });

  it("should skip dividend without ticker", () => {
    const input = [
      HEADER,
      "15/01/2025,REF001,,,Dividend,,,2.50,2.50,1,0,2.50,0",
    ].join("\n");
    const result = lightyearParser.parse(input);
    expect(result.cashTransactions).toHaveLength(0);
  });

  it("should skip deposit/withdrawal/conversion types", () => {
    const input = [
      HEADER,
      "15/01/2025,REF001,,,Deposit,,EUR,,,,0,100.00,0",
      "16/01/2025,REF002,,,Withdrawal,,EUR,,,,0,-50.00,0",
      "17/01/2025,REF003,,,Conversion,,EUR,,,,0,100.00,0",
    ].join("\n");
    const result = lightyearParser.parse(input);
    expect(result.trades).toHaveLength(0);
    expect(result.cashTransactions).toHaveLength(0);
  });

  it("should skip buy with no ticker", () => {
    const input = [
      HEADER,
      "15/01/2025,REF001,,,Buy,10,EUR,100,1000,1,0,1000,0",
    ].join("\n");
    const result = lightyearParser.parse(input);
    expect(result.trades).toHaveLength(0);
  });

  it("should skip buy with zero quantity", () => {
    const input = [
      HEADER,
      "15/01/2025,REF001,AAPL,US0378331005,Buy,0,USD,175,0,0.92,0,0,0",
    ].join("\n");
    const result = lightyearParser.parse(input);
    expect(result.trades).toHaveLength(0);
  });

  it("should parse sell trade with fee", () => {
    const input = [
      HEADER,
      "15/01/2025,REF001,AAPL,US0378331005,Sell,5,USD,180,900,0.92,1.50,898.50,0",
    ].join("\n");
    const result = lightyearParser.parse(input);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].buySell).toBe("SELL");
  });

  it("should handle ISO date format fallback (YYYY-MM-DD)", () => {
    const input = [
      HEADER,
      "2025-01-15,REF001,AAPL,US0378331005,Buy,10,USD,175,1750,0.92,0,1750,0",
    ].join("\n");
    const result = lightyearParser.parse(input);
    expect(result.trades).toHaveLength(1);
  });

  it("should throw on unrecognized date format", () => {
    const input = [
      HEADER,
      "Jan 15 2025,REF001,AAPL,US0378331005,Buy,10,USD,175,1750,0.92,0,1750,0",
    ].join("\n");
    expect(() => lightyearParser.parse(input)).toThrow("formato de fecha no reconocido");
  });

  it("should skip rows with empty date", () => {
    const input = [
      HEADER,
      ",REF001,AAPL,US0378331005,Buy,10,USD,175,1750,0.92,0,1750,0",
    ].join("\n");
    const result = lightyearParser.parse(input);
    expect(result.trades).toHaveLength(0);
  });

  it("should use reference as trade ID when available", () => {
    const input = [
      HEADER,
      "15/01/2025,MY-REF-123,AAPL,US0378331005,Buy,10,USD,175,1750,0.92,0,1750,0",
    ].join("\n");
    const result = lightyearParser.parse(input);
    expect(result.trades[0].tradeID).toContain("MY-REF-123");
  });

  it("should generate fallback trade ID when no reference", () => {
    const input = [
      HEADER,
      "15/01/2025,,AAPL,US0378331005,Buy,10,USD,175,1750,0.92,0,1750,0",
    ].join("\n");
    const result = lightyearParser.parse(input);
    expect(result.trades[0].tradeID).toContain("20250115");
  });

  it("should parse income with ticker (interest on a specific holding)", () => {
    const input = [
      HEADER,
      "15/01/2025,REF001,BRICEKSP,LU123456,Interest,,EUR,,,,0,3.50,0",
    ].join("\n");
    const result = lightyearParser.parse(input);
    expect(result.cashTransactions).toHaveLength(1);
    expect(result.cashTransactions[0].symbol).toBe("BRICEKSP");
  });
});

describe("lightyearParser - error cases", () => {
  it("should throw on empty input", () => {
    expect(() => lightyearParser.parse("")).toThrow("fichero vacío o sin datos");
  });

  it("should throw on non-Lightyear content", () => {
    expect(() => lightyearParser.parse("Date,Pair,Side\ndata")).toThrow("formato no reconocido");
  });

  it("should throw on header-only file", () => {
    expect(() => lightyearParser.parse(HEADER)).toThrow("fichero vacío o sin datos");
  });
});
