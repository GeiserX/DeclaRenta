import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { trading212Parser } from "../../src/parsers/trading212.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HEADER = "Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Notes,ID";

const TRADING212_CSV = [
  HEADER,
  "Market buy,2024-01-15 09:30:00,US0378331005,AAPL,Apple Inc,10,185.50,USD,0.92,,,1706.60,EUR,,trade001",
  "Market buy,2024-02-10 10:15:00,US5949181045,MSFT,Microsoft Corp,5,415.00,USD,0.93,,,1929.75,EUR,,trade002",
  "Market sell,2024-06-20 14:22:00,US0378331005,AAPL,Apple Inc,10,210.30,USD,0.93,283.00,USD,1955.79,EUR,,trade003",
  "Limit buy,2024-03-05 11:00:00,IE00B4L5Y983,IWDA,iShares Core MSCI World ETF,3,95.20,EUR,1.00,,,285.60,EUR,,trade004",
  "Limit sell,2024-09-12 15:30:00,IE00B4L5Y983,IWDA,iShares Core MSCI World ETF,3,102.50,EUR,1.00,21.90,EUR,307.50,EUR,,trade005",
  "Dividend (Ordinary),2024-03-15 00:00:00,US0378331005,AAPL,Apple Inc,,,USD,0.92,,,2.35,USD,,div001",
  "Dividend (Dividend tax),2024-03-15 00:00:00,US0378331005,AAPL,Apple Inc,,,USD,0.92,,,-0.47,USD,,divtax001",
  "Dividend (Ordinary),2024-06-15 00:00:00,US5949181045,MSFT,Microsoft Corp,,,USD,0.93,,,3.12,USD,,div002",
  "Interest on cash,2024-01-31 00:00:00,,,,,,,1.00,,,0.48,EUR,,int001",
  "Deposit,2024-01-10 08:00:00,,,,,,,1.00,,,1000.00,EUR,,dep001",
  "Withdrawal,2024-12-01 09:00:00,,,,,,,1.00,,,-500.00,EUR,,wit001",
  "Currency conversion,2024-04-01 10:00:00,,,,,,USD,0.92,,,460.00,USD,,conv001",
].join("\n");

const TRADING212_CSV_BOM = "﻿" + TRADING212_CSV;

const TRADING212_FIXTURE = readFileSync(
  new URL("../fixtures/trading212-sample.csv", import.meta.url),
  "utf-8",
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("trading212Parser", () => {
  // -------------------------------------------------------------------------
  // Detection
  // -------------------------------------------------------------------------

  describe("detect", () => {
    it("should detect Trading 212 CSV by header", () => {
      expect(trading212Parser.detect(TRADING212_CSV)).toBe(true);
    });

    it("should detect CSV with BOM", () => {
      expect(trading212Parser.detect(TRADING212_CSV_BOM)).toBe(true);
    });

    it("should not detect IBKR XML", () => {
      expect(trading212Parser.detect("<FlexQueryResponse>")).toBe(false);
    });

    it("should not detect Lightyear CSV", () => {
      expect(
        trading212Parser.detect("Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount"),
      ).toBe(false);
    });

    it("should not detect Degiro CSV", () => {
      expect(
        trading212Parser.detect("Fecha,Hora,Producto,ISIN,Bolsa,Cantidad,Precio"),
      ).toBe(false);
    });

    it("should not detect random text", () => {
      expect(trading212Parser.detect("hello world")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("should throw on empty input", () => {
      expect(() => trading212Parser.parse("")).toThrow(/vacío/);
    });

    it("should throw on header-only input", () => {
      expect(() => trading212Parser.parse(HEADER)).toThrow(/vacío/);
    });

    it("should throw on unrecognized format", () => {
      expect(() => trading212Parser.parse("Column1,Column2\nval1,val2")).toThrow(/formato/);
    });
  });

  // -------------------------------------------------------------------------
  // Buy trades
  // -------------------------------------------------------------------------

  describe("parse buy trades", () => {
    it("should parse a Market buy (AAPL)", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      const buys = result.trades.filter((t) => t.buySell === "BUY" && t.symbol === "AAPL");
      expect(buys).toHaveLength(1);

      const buy = buys[0]!;
      expect(buy.symbol).toBe("AAPL");
      expect(buy.isin).toBe("US0378331005");
      expect(buy.assetCategory).toBe("STK");
      expect(buy.currency).toBe("USD");
      expect(buy.tradeDate).toBe("20240115");
      expect(buy.quantity).toBe("10");
      expect(buy.tradePrice).toBe("185.5");
      expect(buy.cost).toBe("-1855");
      expect(buy.commission).toBe("0");
      expect(buy.exchange).toBe("TRADING212");
      expect(buy.openCloseIndicator).toBe("O");
    });

    it("should parse a Limit buy (IWDA in EUR)", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      const buys = result.trades.filter((t) => t.buySell === "BUY" && t.symbol === "IWDA");
      expect(buys).toHaveLength(1);

      const buy = buys[0]!;
      expect(buy.isin).toBe("IE00B4L5Y983");
      expect(buy.currency).toBe("EUR");
      expect(buy.tradeDate).toBe("20240305");
      expect(buy.quantity).toBe("3");
    });
  });

  // -------------------------------------------------------------------------
  // Sell trades
  // -------------------------------------------------------------------------

  describe("parse sell trades", () => {
    it("should parse a Market sell (AAPL)", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      const sells = result.trades.filter((t) => t.buySell === "SELL" && t.symbol === "AAPL");
      expect(sells).toHaveLength(1);

      const sell = sells[0]!;
      expect(sell.symbol).toBe("AAPL");
      expect(sell.tradeDate).toBe("20240620");
      expect(parseFloat(sell.quantity)).toBeLessThan(0);
      expect(sell.proceeds).toBe("2103");
      expect(sell.openCloseIndicator).toBe("C");
    });

    it("should parse a Limit sell (IWDA)", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      const sells = result.trades.filter((t) => t.buySell === "SELL" && t.symbol === "IWDA");
      expect(sells).toHaveLength(1);

      const sell = sells[0]!;
      expect(sell.tradeDate).toBe("20240912");
      expect(sell.quantity).toBe("-3");
      expect(sell.proceeds).toBe("307.5");
    });
  });

  // -------------------------------------------------------------------------
  // Dividends
  // -------------------------------------------------------------------------

  describe("parse dividends", () => {
    it("should parse Dividend rows as cash transactions", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      const divs = result.cashTransactions.filter((c) => c.type === "Dividends");
      expect(divs).toHaveLength(2);
    });

    it("should parse AAPL dividend correctly", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      const div = result.cashTransactions.find((c) => c.symbol === "AAPL" && c.type === "Dividends");
      expect(div).toBeDefined();
      expect(div!.amount).toBe("2.35");
      expect(div!.currency).toBe("USD");
      expect(div!.isin).toBe("US0378331005");
      expect(div!.dateTime).toBe("20240315");
    });

    it("should parse MSFT dividend correctly", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      const div = result.cashTransactions.find((c) => c.symbol === "MSFT" && c.type === "Dividends");
      expect(div).toBeDefined();
      expect(div!.amount).toBe("3.12");
    });
  });

  // -------------------------------------------------------------------------
  // Withholding tax
  // -------------------------------------------------------------------------

  describe("parse withholding tax", () => {
    it("should parse Dividend (Dividend tax) as Withholding Tax", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      const wht = result.cashTransactions.filter((c) => c.type === "Withholding Tax");
      expect(wht).toHaveLength(1);
    });

    it("should parse AAPL withholding correctly", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      const wht = result.cashTransactions.find((c) => c.type === "Withholding Tax");
      expect(wht).toBeDefined();
      expect(wht!.symbol).toBe("AAPL");
      expect(wht!.isin).toBe("US0378331005");
      expect(wht!.currency).toBe("USD");
      expect(wht!.dateTime).toBe("20240315");
      expect(parseFloat(wht!.amount)).toBeLessThan(0);
      expect(wht!.amount).toBe("-0.47");
    });

    it("should not classify Dividend (Dividend tax) as a regular dividend", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      const divs = result.cashTransactions.filter(
        (c) => c.type === "Dividends" && c.symbol === "AAPL",
      );
      expect(divs).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Interest on cash
  // -------------------------------------------------------------------------

  describe("parse interest", () => {
    it("should parse Interest on cash as cash transaction", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      const interest = result.cashTransactions.find((c) => c.type === "Broker Interest Received");
      expect(interest).toBeDefined();
      expect(interest!.amount).toBe("0.48");
      expect(interest!.currency).toBe("EUR");
    });
  });

  // -------------------------------------------------------------------------
  // Skipped transaction types
  // -------------------------------------------------------------------------

  describe("skip non-taxable transactions", () => {
    it("should skip Deposit rows", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      const allIds = [...result.trades.map((t) => t.tradeID), ...result.cashTransactions.map((c) => c.transactionID)];
      expect(allIds.some((id) => id.toLowerCase().includes("dep001"))).toBe(false);
    });

    it("should skip Withdrawal rows", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      const allIds = [...result.trades.map((t) => t.tradeID), ...result.cashTransactions.map((c) => c.transactionID)];
      expect(allIds.some((id) => id.toLowerCase().includes("wit001"))).toBe(false);
    });

    it("should skip Currency conversion rows", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      const allIds = [...result.trades.map((t) => t.tradeID), ...result.cashTransactions.map((c) => c.transactionID)];
      expect(allIds.some((id) => id.toLowerCase().includes("conv001"))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Trade counts
  // -------------------------------------------------------------------------

  describe("overall counts", () => {
    it("should produce correct number of trades", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      // AAPL buy, MSFT buy, AAPL sell, IWDA buy, IWDA sell = 5
      expect(result.trades).toHaveLength(5);
    });

    it("should produce correct number of cash transactions", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      // AAPL div, AAPL withholding, MSFT div, interest = 4
      expect(result.cashTransactions).toHaveLength(4);
    });

    it("should return empty arrays for non-applicable fields", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      expect(result.corporateActions).toEqual([]);
      expect(result.openPositions).toEqual([]);
      expect(result.securitiesInfo).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Date parsing
  // -------------------------------------------------------------------------

  describe("date parsing", () => {
    it("should convert YYYY-MM-DD HH:MM:SS to YYYYMMDD", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      const buy = result.trades.find((t) => t.symbol === "AAPL" && t.buySell === "BUY");
      expect(buy!.tradeDate).toBe("20240115");
    });
  });

  // -------------------------------------------------------------------------
  // fxRateToBase
  // -------------------------------------------------------------------------

  describe("fx rate", () => {
    it("should set fxRateToBase to '1' (ECB fetched independently)", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      result.trades.forEach((t) => { expect(t.fxRateToBase).toBe("1"); });
    });
  });

  // -------------------------------------------------------------------------
  // Real fixture (trading212-sample.csv)
  // -------------------------------------------------------------------------

  describe("real fixture (trading212-sample.csv)", () => {
    it("should detect", () => {
      expect(trading212Parser.detect(TRADING212_FIXTURE)).toBe(true);
    });

    it("should parse 9 trades, 3 dividends, 2 WHTs, 2 interests", () => {
      const result = trading212Parser.parse(TRADING212_FIXTURE);
      expect(result.trades).toHaveLength(9);
      const divs = result.cashTransactions.filter((t) => t.type === "Dividends");
      const whts = result.cashTransactions.filter((t) => t.type === "Withholding Tax");
      const interest = result.cashTransactions.filter((t) => t.type === "Broker Interest Received");
      expect(divs).toHaveLength(3);
      expect(whts).toHaveLength(2);
      expect(interest).toHaveLength(2);
    });

    it("should handle quoted company name with comma (Echo Digital, Inc.)", () => {
      const result = trading212Parser.parse(TRADING212_FIXTURE);
      const echo = result.trades.filter((t) => t.symbol === "ECHO");
      expect(echo).toHaveLength(2);
      expect(echo[0]!.description).toContain("Echo Digital");
    });

    it("should handle fractional quantities and blank ID", () => {
      const result = trading212Parser.parse(TRADING212_FIXTURE);
      const fractional = result.trades.find((t) => t.symbol === "ECHO" && t.quantity === "0.5");
      expect(fractional).toBeDefined();
    });
  });
});
