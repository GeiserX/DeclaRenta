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
      expect(btcBuy.isin).toBe(""); // crypto has no ISIN — wash-sale keys on CRYPTO:${symbol}
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

    it("should parse Strategy Sold+Revenue trades (both legs)", () => {
      const csv = [
        TX_HEADER,
        "123,2025-01-13 21:37:46,Strategy,Transaction Revenue,ETH,0.00407900,",
        "123,2025-01-13 21:37:46,Strategy,Transaction Fee,ETH,-0.00000408,",
        "123,2025-01-13 21:37:46,Strategy,Transaction Sold,XRP,-5.00000000,",
      ].join("\n");
      const result = binanceParser.parse(csv);
      // SELL XRP for ETH + BUY ETH with XRP (the received coin gets a FIFO lot).
      expect(result.trades).toHaveLength(2);
      const sell = result.trades.find((t) => t.buySell === "SELL")!;
      expect(sell.symbol).toBe("XRP");
      expect(Number(sell.quantity)).toBe(-5);
      expect(sell.currency).toBe("ETH");
      const buy = result.trades.find((t) => t.buySell === "BUY")!;
      expect(buy.symbol).toBe("ETH");
      expect(buy.currency).toBe("XRP");
    });

    it("should parse Strategy Buy+Spend trades (both legs)", () => {
      const csv = [
        TX_HEADER,
        "123,2025-01-13 21:42:04,Strategy,Transaction Buy,XRP,5.00000000,",
        "123,2025-01-13 21:42:04,Strategy,Transaction Spend,ETH,-0.00407900,",
        "123,2025-01-13 21:42:04,Strategy,Transaction Fee,XRP,-0.00500000,",
      ].join("\n");
      const result = binanceParser.parse(csv);
      // BUY XRP with ETH + SELL ETH for XRP.
      expect(result.trades).toHaveLength(2);
      const buy = result.trades.find((t) => t.symbol === "XRP")!;
      expect(buy.buySell).toBe("BUY");
      expect(Number(buy.quantity)).toBe(5);
      expect(buy.currency).toBe("ETH");
      const sell = result.trades.find((t) => t.symbol === "ETH")!;
      expect(sell.buySell).toBe("SELL");
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
      // 2 from Convert (SOL↔USDT) + 2 from Sold/Revenue (XRP↔ETH) = 4
      expect(result.trades).toHaveLength(4);
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

    it("should produce 4 trades total (2 Convert + 2 Strategy legs)", () => {
      const result = binanceParser.parse(ES_TX_CSV);
      expect(result.trades).toHaveLength(4);
    });

    it("should parse real fixture file (trades + Simple Earn income)", () => {
      const fixture = readFileSync(
        new URL("../fixtures/binance-tx-es-sample.csv", import.meta.url),
        "utf-8",
      );
      expect(binanceParser.detect(fixture)).toBe(true);
      const result = binanceParser.parse(fixture);
      // Convert SOL↔USDT (2) + Strategy Sold XRP/Revenue ETH (2) = 4 trades.
      expect(result.trades).toHaveLength(4);
      // Simple Earn Flexible Interest → a crypto reward income cash transaction
      // (ahorro bucket), no longer silently dropped.
      const income = result.cashTransactions.filter((c) => c.type === "Crypto Reward Income");
      expect(income).toHaveLength(1);
      expect(income[0]!.symbol).toBe("BTC");
      expect(income[0]!.taxBucket).toBe("ahorro");
    });
  });

  // -------------------------------------------------------------------------
  // Transaction History — fiat legs, ±1s skew, income, dust, EUR_Value
  // (driven by a real user file that produced 44 errors + 66 unvalued ops)
  // -------------------------------------------------------------------------
  describe("transaction history — fiat legs, skew, income, dust", () => {
    const TX_HEADER = "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark";

    it("treats a EUR→USDT Convert as a single fiat acquisition, not a crypto disposal", () => {
      // EUR is genuine fiat: buying USDT with EUR is a plain acquisition. It must
      // NOT emit a CRYPTO SELL of EUR (which caused 'Venta sin lotes: EUR').
      const csv = [
        TX_HEADER,
        "1,2025-01-04 12:00:00,Spot,Binance Convert,USDT,106.59,",
        "1,2025-01-04 12:00:00,Spot,Binance Convert,EUR,-100,",
      ].join("\n");
      const result = binanceParser.parse(csv);
      expect(result.trades).toHaveLength(1);
      const t = result.trades[0]!;
      expect(t.buySell).toBe("BUY");
      expect(t.symbol).toBe("USDT");
      expect(t.currency).toBe("EUR");
      // No trade should ever have symbol EUR (the phantom-disposal bug).
      expect(result.trades.some((x) => x.symbol === "EUR")).toBe(false);
    });

    it("treats a crypto→EUR Convert as a single fiat disposal (SELL priced in EUR)", () => {
      const csv = [
        TX_HEADER,
        "1,2025-02-01 09:00:00,Spot,Binance Convert,EUR,250,",
        "1,2025-02-01 09:00:00,Spot,Binance Convert,SOL,-2,",
      ].join("\n");
      const result = binanceParser.parse(csv);
      expect(result.trades).toHaveLength(1);
      const t = result.trades[0]!;
      expect(t.buySell).toBe("SELL");
      expect(t.symbol).toBe("SOL");
      expect(t.currency).toBe("EUR");
    });

    it("still treats a stablecoin↔crypto Convert as a 2-leg permuta", () => {
      // USDT is a stablecoin, not fiat — SOL↔USDT remains a taxable permuta.
      const csv = [
        TX_HEADER,
        "1,2025-01-04 11:20:13,Spot,Binance Convert,SOL,10,",
        "1,2025-01-04 11:20:13,Spot,Binance Convert,USDT,-200,",
      ].join("\n");
      const result = binanceParser.parse(csv);
      expect(result.trades).toHaveLength(2);
    });

    it("pairs Convert legs that are 1 second apart (timestamp skew)", () => {
      const csv = [
        TX_HEADER,
        "1,2024-07-21 17:36:42,Spot,Binance Convert,BNB,0.0138,",
        "1,2024-07-21 17:36:43,Spot,Binance Convert,USDT,-8.30,",
      ].join("\n");
      const result = binanceParser.parse(csv);
      expect(result.trades).toHaveLength(2);
      expect(result.trades.some((t) => t.symbol === "BNB")).toBe(true);
      expect(result.trades.some((t) => t.symbol === "USDT")).toBe(true);
    });

    it("classifies Simple Earn Interest as ahorro income and airdrop/referral as general", () => {
      const csv = [
        TX_HEADER,
        "1,2025-02-10 04:00:00,Spot,Simple Earn Flexible Interest,BNB,0.001,Binance Earn",
        "1,2025-01-23 03:34:44,Spot,HODLer Airdrops Distribution,ANIME,0.87,Binance Launchpool",
        "1,2025-03-01 10:00:00,Spot,Referral Commission,BTC,0.00001,",
      ].join("\n");
      const result = binanceParser.parse(csv);
      const income = result.cashTransactions.filter((c) => c.type === "Crypto Reward Income");
      expect(income).toHaveLength(3);
      expect(income.find((c) => c.symbol === "BNB")!.taxBucket).toBe("ahorro");
      expect(income.find((c) => c.symbol === "ANIME")!.taxBucket).toBe("general");
      expect(income.find((c) => c.symbol === "BTC")!.taxBucket).toBe("general");
      // No income op should leak into trades.
      expect(result.trades).toHaveLength(0);
    });

    it("skips Simple Earn subscription/redemption (non-taxable principal moves)", () => {
      const csv = [
        TX_HEADER,
        "1,2025-02-10 04:00:00,Spot,Simple Earn Flexible Subscription,BNB,-5,",
        "1,2025-02-20 04:00:00,Spot,Simple Earn Flexible Redemption,BNB,5,",
      ].join("\n");
      const result = binanceParser.parse(csv);
      expect(result.trades).toHaveLength(0);
      expect(result.cashTransactions).toHaveLength(0);
    });

    it("handles Small Assets Exchange BNB dust as per-coin permutas", () => {
      const csv = [
        TX_HEADER,
        "1,2025-02-01 13:05:11,Spot,Small Assets Exchange BNB,TRX,-37.02,TRX to BNB",
        "1,2025-02-01 13:05:11,Spot,Small Assets Exchange BNB,ANIME,-0.87,ANIME to BNB",
        "1,2025-02-01 13:05:11,Spot,Small Assets Exchange BNB,BNB,0.0137,TRX to BNB",
        "1,2025-02-01 13:05:11,Spot,Small Assets Exchange BNB,BNB,0.00005,ANIME to BNB",
      ].join("\n");
      const result = binanceParser.parse(csv);
      // 2 dust coins → 2 permutas → 4 trades (each a SELL dust + BUY BNB).
      expect(result.trades).toHaveLength(4);
      expect(result.trades.filter((t) => t.symbol === "TRX")).toHaveLength(1);
      expect(result.trades.filter((t) => t.symbol === "ANIME")).toHaveLength(1);
    });

    it("derives EUR_Value valuation hints for crypto coins (not fiat)", () => {
      const csv = [
        "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark,EUR_Value",
        "1,2025-02-10 04:00:00,Spot,Simple Earn Flexible Interest,SOL,2,Binance Earn,80",
        "1,2025-01-04 12:00:00,Spot,Binance Convert,USDT,106.59,,99.37",
        "1,2025-01-04 12:00:00,Spot,Binance Convert,EUR,-100,,-100",
      ].join("\n");
      const result = binanceParser.parse(csv);
      const hints = result.manualRateHints ?? [];
      // SOL: 80 EUR / 2 = 40 EUR per unit.
      const sol = hints.find((h) => h.currency === "SOL");
      expect(sol).toBeDefined();
      expect(Number(sol!.eurPerUnit)).toBeCloseTo(40, 6);
      // EUR is fiat → never a hint.
      expect(hints.some((h) => h.currency === "EUR")).toBe(false);
      // The reward income carries the EUR cost basis from EUR_Value.
      const income = result.cashTransactions.find((c) => c.symbol === "SOL")!;
      expect(income.rewardCostBasisEur).toBe("80");
    });

    it("treats Simple Earn subscription/redemption of an airdropped coin as non-taxable moves", () => {
      // Real-world lifecycle: airdrop ANIME → subscribe to Earn → redeem → dust to
      // BNB. Only the airdrop (income) and the final dust permuta are taxable; the
      // subscription/redemption are skipped so no phantom disposals appear.
      const csv = [
        "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark,EUR_Value",
        "1,2025-01-23 03:34:44,Spot,HODLer Airdrops Distribution,ANIME,0.874,Binance Launchpool,0.07",
        "1,2025-01-30 23:32:41,Spot,Simple Earn Flexible Subscription,ANIME,-0.874,Binance Earn,-0.04",
        "1,2025-01-30 23:36:40,Spot,Simple Earn Flexible Redemption,ANIME,0.874,Binance Earn,0.04",
        "1,2025-02-01 13:05:11,Spot,Small Assets Exchange BNB,ANIME,-0.874,ANIME to BNB,-0.03",
        "1,2025-02-01 13:05:11,Spot,Small Assets Exchange BNB,BNB,0.00005726,ANIME to BNB,0.04",
      ].join("\n");
      const result = binanceParser.parse(csv);
      // Income: the airdrop (general bucket). Subscription/redemption skipped.
      const income = result.cashTransactions.filter((c) => c.type === "Crypto Reward Income");
      expect(income).toHaveLength(1);
      expect(income[0]!.symbol).toBe("ANIME");
      expect(income[0]!.taxBucket).toBe("general");
      // Dust permuta: ANIME → BNB = 2 trades (SELL ANIME + BUY BNB).
      expect(result.trades).toHaveLength(2);
      expect(result.trades.some((t) => t.symbol === "ANIME" && t.buySell === "SELL")).toBe(true);
    });

    it("ignores a '--' change value without throwing", () => {
      const csv = [
        TX_HEADER,
        "1,2025-02-10 04:00:00,Spot,Simple Earn Flexible Interest,BNB,--,Binance Earn",
        "1,2025-02-11 04:00:00,Spot,Simple Earn Flexible Interest,BNB,0.001,Binance Earn",
      ].join("\n");
      const result = binanceParser.parse(csv);
      expect(result.cashTransactions).toHaveLength(1);
    });
  });
});
