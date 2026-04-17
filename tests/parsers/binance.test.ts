import { describe, it, expect } from "vitest";
import { binanceParser } from "../../src/parsers/binance.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BINANCE_CSV = [
  "Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
  "2025-01-15 10:30:00,BTCEUR,BUY,42000.00,0.05,2100.00,0.001BTC",
  "2025-03-20 14:00:00,ETHEUR,SELL,3200.00,1.5,4800.00,0.01ETH",
  "2025-02-10 08:00:00,SOLUSDT,BUY,98.50,10,985.00,0.5USDT",
].join("\n");

const BINANCE_CSV_BOM = "\uFEFF" + BINANCE_CSV;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("binanceParser", () => {
  describe("detect", () => {
    it("should detect Binance CSV", () => {
      expect(binanceParser.detect(BINANCE_CSV)).toBe(true);
    });

    it("should detect CSV with BOM", () => {
      expect(binanceParser.detect(BINANCE_CSV_BOM)).toBe(true);
    });

    it("should not detect IBKR XML", () => {
      expect(binanceParser.detect("<FlexQueryResponse>")).toBe(false);
    });

    it("should not detect Coinbase CSV", () => {
      expect(
        binanceParser.detect(
          "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes",
        ),
      ).toBe(false);
    });

    it("should not detect random text", () => {
      expect(binanceParser.detect("hello world")).toBe(false);
    });
  });

  describe("parse buy trades", () => {
    it("should parse buy orders", () => {
      const result = binanceParser.parse(BINANCE_CSV);
      const buys = result.trades.filter((t) => t.buySell === "BUY");
      expect(buys).toHaveLength(2);

      const btcBuy = buys[0]!;
      expect(btcBuy.symbol).toBe("BTC");
      expect(btcBuy.isin).toBe("BTC");
      expect(btcBuy.assetCategory).toBe("CRYPTO");
      expect(btcBuy.currency).toBe("EUR");
      expect(btcBuy.quantity).toBe("0.05");
      expect(btcBuy.tradePrice).toBe("42000");
      expect(btcBuy.tradeDate).toBe("20250115");
      expect(btcBuy.buySell).toBe("BUY");
      expect(btcBuy.openCloseIndicator).toBe("O");
      expect(btcBuy.exchange).toBe("BINANCE");
    });
  });

  describe("parse sell trades", () => {
    it("should parse sell orders", () => {
      const result = binanceParser.parse(BINANCE_CSV);
      const sells = result.trades.filter((t) => t.buySell === "SELL");
      expect(sells).toHaveLength(1);

      const sell = sells[0]!;
      expect(sell.symbol).toBe("ETH");
      expect(sell.currency).toBe("EUR");
      expect(sell.quantity).toBe("-1.5");
      expect(sell.tradePrice).toBe("3200");
      expect(sell.tradeDate).toBe("20250320");
      expect(sell.buySell).toBe("SELL");
      expect(sell.openCloseIndicator).toBe("C");
    });
  });

  describe("fee parsing with asset suffix", () => {
    it("should parse fee amount from fee string with asset suffix", () => {
      const result = binanceParser.parse(BINANCE_CSV);
      const btcBuy = result.trades.find((t) => t.symbol === "BTC")!;
      expect(btcBuy.commission).toBe("-0.001");
      expect(btcBuy.commissionCurrency).toBe("BTC");
    });

    it("should parse USDT fee correctly", () => {
      const result = binanceParser.parse(BINANCE_CSV);
      const solBuy = result.trades.find((t) => t.symbol === "SOL")!;
      expect(solBuy.commission).toBe("-0.5");
      expect(solBuy.commissionCurrency).toBe("USDT");
    });

    it("should handle zero fee", () => {
      const csv = [
        "Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
        "2025-01-15 10:30:00,BTCEUR,BUY,42000.00,0.01,420.00,",
      ].join("\n");
      const result = binanceParser.parse(csv);
      expect(result.trades[0]!.commission).toBe("0");
    });
  });

  describe("pair parsing", () => {
    it("should parse BTCEUR pair correctly", () => {
      const result = binanceParser.parse(BINANCE_CSV);
      const btcTrade = result.trades.find((t) => t.symbol === "BTC")!;
      expect(btcTrade.symbol).toBe("BTC");
      expect(btcTrade.currency).toBe("EUR");
    });

    it("should parse SOLUSDT pair correctly", () => {
      const result = binanceParser.parse(BINANCE_CSV);
      const solTrade = result.trades.find((t) => t.symbol === "SOL")!;
      expect(solTrade.symbol).toBe("SOL");
      expect(solTrade.currency).toBe("USDT");
    });

    it("should handle multiple pairs in same export", () => {
      const result = binanceParser.parse(BINANCE_CSV);
      const symbols = result.trades.map((t) => t.symbol);
      expect(symbols).toContain("BTC");
      expect(symbols).toContain("ETH");
      expect(symbols).toContain("SOL");
    });
  });

  describe("date conversion", () => {
    it("should convert UTC dates to YYYYMMDD", () => {
      const result = binanceParser.parse(BINANCE_CSV);
      expect(result.trades[0]!.tradeDate).toBe("20250115");
      expect(result.trades[1]!.tradeDate).toBe("20250320");
      expect(result.trades[2]!.tradeDate).toBe("20250210");
    });
  });

  describe("empty and edge cases", () => {
    it("should throw on empty input", () => {
      expect(() => binanceParser.parse("")).toThrow("vacio");
    });

    it("should throw on header-only input", () => {
      const csv = "Date(UTC),Pair,Side,Price,Executed,Amount,Fee";
      expect(() => binanceParser.parse(csv)).toThrow("vacio");
    });

    it("should skip rows with unknown side", () => {
      const csv = [
        "Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
        "2025-01-15 10:30:00,BTCEUR,TRANSFER,42000.00,0.05,2100.00,0.001BTC",
      ].join("\n");
      const result = binanceParser.parse(csv);
      expect(result.trades).toHaveLength(0);
    });

    it("should return empty cashTransactions and corporateActions", () => {
      const result = binanceParser.parse(BINANCE_CSV);
      expect(result.cashTransactions).toHaveLength(0);
      expect(result.corporateActions).toHaveLength(0);
    });
  });

  describe("error handling", () => {
    it("throws on non-Binance content", () => {
      expect(() => binanceParser.parse("Foo,Bar\ndata1,data2")).toThrow("formato no reconocido");
    });
  });
});
