import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
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

  // -------------------------------------------------------------------------
  // Transaction History format (User_ID,UTC_Time,Account,Operation,Coin,Change)
  // -------------------------------------------------------------------------

  describe("transaction history format", () => {
    const TX_HEADER = "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark";

    it("should detect transaction history CSV", () => {
      const csv = [TX_HEADER, "123,2025-01-04 11:20:13,Spot,Deposit,USDT,100,"].join("\n");
      expect(binanceParser.detect(csv)).toBe(true);
    });

    it("should skip deposits and transfers", () => {
      const csv = [
        TX_HEADER,
        "123,2025-01-04 11:08:17,Spot,Deposit,USDT,500,",
        "123,2025-01-04 11:27:37,Spot,Transfer Between Main and Funding Wallet,SOL,-10,",
      ].join("\n");
      const result = binanceParser.parse(csv);
      expect(result.trades).toHaveLength(0);
    });

    it("should parse Binance Convert pairs", () => {
      const csv = [
        TX_HEADER,
        "123,2025-01-04 11:20:13,Spot,Binance Convert,SOL,10,",
        "123,2025-01-04 11:20:13,Spot,Binance Convert,USDT,-200,",
      ].join("\n");
      const result = binanceParser.parse(csv);
      expect(result.trades).toHaveLength(2);
      const sell = result.trades.find((t) => t.buySell === "SELL")!;
      const buy = result.trades.find((t) => t.buySell === "BUY")!;
      expect(sell.symbol).toBe("USDT");
      expect(buy.symbol).toBe("SOL");
      expect(Number(sell.quantity)).toBeLessThan(0);
      expect(Number(buy.quantity)).toBeGreaterThan(0);
    });

    it("should parse Strategy Sold+Revenue trades", () => {
      const csv = [
        TX_HEADER,
        "123,2025-01-13 21:37:46,Strategy,Transaction Revenue,ETH,0.00407900,",
        "123,2025-01-13 21:37:46,Strategy,Transaction Fee,ETH,-0.00000408,",
        "123,2025-01-13 21:37:46,Strategy,Transaction Sold,XRP,-5.00000000,",
      ].join("\n");
      const result = binanceParser.parse(csv);
      expect(result.trades).toHaveLength(1);
      const trade = result.trades[0]!;
      expect(trade.buySell).toBe("SELL");
      expect(trade.symbol).toBe("XRP");
      expect(Number(trade.quantity)).toBe(-5);
      expect(trade.currency).toBe("ETH");
    });

    it("should parse Strategy Buy+Spend trades", () => {
      const csv = [
        TX_HEADER,
        "123,2025-01-13 21:42:04,Strategy,Transaction Buy,XRP,5.00000000,",
        "123,2025-01-13 21:42:04,Strategy,Transaction Spend,ETH,-0.00407900,",
        "123,2025-01-13 21:42:04,Strategy,Transaction Fee,XRP,-0.00500000,",
      ].join("\n");
      const result = binanceParser.parse(csv);
      expect(result.trades).toHaveLength(1);
      const trade = result.trades[0]!;
      expect(trade.buySell).toBe("BUY");
      expect(trade.symbol).toBe("XRP");
      expect(Number(trade.quantity)).toBe(5);
      expect(trade.currency).toBe("ETH");
    });

    it("should handle mixed operations in real-world data", () => {
      const csv = [
        TX_HEADER,
        "123,2025-01-04 11:08:17,Spot,Deposit,USDT,500,",
        "123,2025-01-04 11:20:13,Spot,Binance Convert,SOL,10,",
        "123,2025-01-04 11:20:13,Spot,Binance Convert,USDT,-200,",
        "123,2025-01-13 21:37:46,Strategy,Transaction Revenue,ETH,0.00407900,",
        "123,2025-01-13 21:37:46,Strategy,Transaction Fee,ETH,-0.00000408,",
        "123,2025-01-13 21:37:46,Strategy,Transaction Sold,XRP,-5.00000000,",
      ].join("\n");
      const result = binanceParser.parse(csv);
      // 2 from Convert + 1 from Sold/Revenue = 3
      expect(result.trades).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // Spanish headers (Historial de operaciones de spot)
  // -------------------------------------------------------------------------

  describe("Spanish spot CSV (Tiempo,Par,Lado,Precio,Ejecutado,Cantidad,Tarifa)", () => {
    const ES_SPOT_HEADER = "Tiempo,Par,Lado,Precio,Ejecutado,Cantidad,Tarifa";

    const ES_SPOT_CSV = [
      ES_SPOT_HEADER,
      "25-12-31 01:00:45,CTKBTC,SELL,0.000003,285.7CTK,0.0008571BTC,0.00006618BNB",
      "25-03-15 10:30:00,AAVEBTC,BUY,0.003,0.13AAVE,0.00039BTC,0.0000312BNB",
      "25-06-20 14:22:11,LINKBTC,SELL,0.0002,50LINK,0.01BTC,0.0008BNB",
    ].join("\n");

    it("should detect Spanish spot header", () => {
      expect(binanceParser.detect(ES_SPOT_CSV)).toBe(true);
    });

    it("should detect Spanish spot header with BOM", () => {
      expect(binanceParser.detect("﻿" + ES_SPOT_CSV)).toBe(true);
    });

    it("should parse 2-digit year dates correctly", () => {
      const result = binanceParser.parse(ES_SPOT_CSV);
      expect(result.trades[0]!.tradeDate).toBe("20251231");
      expect(result.trades[1]!.tradeDate).toBe("20250315");
      expect(result.trades[2]!.tradeDate).toBe("20250620");
    });

    it("should parse Ejecutado column with asset suffix", () => {
      const result = binanceParser.parse(ES_SPOT_CSV);
      const sell = result.trades.find((t) => t.symbol === "CTK")!;
      expect(sell.quantity).toBe("-285.7");
      expect(sell.buySell).toBe("SELL");
    });

    it("should parse Cantidad column with asset suffix", () => {
      const result = binanceParser.parse(ES_SPOT_CSV);
      const sell = result.trades.find((t) => t.symbol === "CTK")!;
      expect(sell.tradeMoney).toBe("0.0008571");
    });

    it("should parse Tarifa (fee) with asset suffix", () => {
      const result = binanceParser.parse(ES_SPOT_CSV);
      const sell = result.trades.find((t) => t.symbol === "CTK")!;
      expect(sell.commission).toBe("-0.00006618");
      expect(sell.commissionCurrency).toBe("BNB");
    });

    it("should parse BUY trades from Spanish CSV", () => {
      const result = binanceParser.parse(ES_SPOT_CSV);
      const buy = result.trades.find((t) => t.symbol === "AAVE")!;
      expect(buy.buySell).toBe("BUY");
      expect(buy.quantity).toBe("0.13");
      expect(buy.currency).toBe("BTC");
    });

    it("should parse correct trade count", () => {
      const result = binanceParser.parse(ES_SPOT_CSV);
      expect(result.trades).toHaveLength(3);
    });

    it("should parse real fixture file", () => {
      const fixture = readFileSync(
        new URL("../fixtures/binance-spot-es-sample.csv", import.meta.url),
        "utf-8",
      );
      expect(binanceParser.detect(fixture)).toBe(true);
      const result = binanceParser.parse(fixture);
      expect(result.trades).toHaveLength(5);
    });
  });

  // -------------------------------------------------------------------------
  // Spanish transaction history (ID de usuario,Tiempo,Cuenta,Operación,...)
  // -------------------------------------------------------------------------

  describe("Spanish transaction history CSV (Operación,Moneda,Cambio)", () => {
    const ES_TX_HEADER = "ID de usuario,Tiempo,Cuenta,Operación,Moneda,Cambio,Observación";

    const ES_TX_CSV = [
      ES_TX_HEADER,
      "123456789,25-01-04 11:08:17,Spot,Deposit,USDT,500,",
      "123456789,25-01-04 11:20:13,Spot,Binance Convert,SOL,10,",
      "123456789,25-01-04 11:20:13,Spot,Binance Convert,USDT,-200,",
      "123456789,25-01-13 21:37:46,Strategy,Transaction Revenue,ETH,0.00407900,",
      "123456789,25-01-13 21:37:46,Strategy,Transaction Fee,ETH,-0.00000408,",
      "123456789,25-01-13 21:37:46,Strategy,Transaction Sold,XRP,-5.00000000,",
    ].join("\n");

    it("should detect Spanish transaction history header", () => {
      expect(binanceParser.detect(ES_TX_CSV)).toBe(true);
    });

    it("should detect with BOM", () => {
      expect(binanceParser.detect("﻿" + ES_TX_CSV)).toBe(true);
    });

    it("should skip deposits", () => {
      const result = binanceParser.parse(ES_TX_CSV);
      const deposits = result.trades.filter((t) => t.tradeID.includes("deposit"));
      expect(deposits).toHaveLength(0);
    });

    it("should parse Binance Convert pairs with 2-digit year", () => {
      const result = binanceParser.parse(ES_TX_CSV);
      const sell = result.trades.find((t) => t.buySell === "SELL" && t.symbol === "USDT");
      const buy = result.trades.find((t) => t.buySell === "BUY" && t.symbol === "SOL");
      expect(sell).toBeDefined();
      expect(buy).toBeDefined();
      expect(sell!.tradeDate).toBe("20250104");
      expect(buy!.tradeDate).toBe("20250104");
    });

    it("should parse Strategy Sold+Revenue trades", () => {
      const result = binanceParser.parse(ES_TX_CSV);
      const trade = result.trades.find((t) => t.symbol === "XRP");
      expect(trade).toBeDefined();
      expect(trade!.buySell).toBe("SELL");
      expect(trade!.tradeDate).toBe("20250113");
    });

    it("should produce 3 trades total (2 Convert + 1 Strategy)", () => {
      const result = binanceParser.parse(ES_TX_CSV);
      expect(result.trades).toHaveLength(3);
    });

    it("should parse real fixture file", () => {
      const fixture = readFileSync(
        new URL("../fixtures/binance-tx-es-sample.csv", import.meta.url),
        "utf-8",
      );
      expect(binanceParser.detect(fixture)).toBe(true);
      const result = binanceParser.parse(fixture);
      expect(result.trades).toHaveLength(3);
    });
  });
});
