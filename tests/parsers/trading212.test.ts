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
  // Unresolved-price skip counter (parserMessages)
  // -------------------------------------------------------------------------

  describe("unresolved-price skip counter", () => {
    it("should not emit parserMessages when every row resolves", () => {
      const result = trading212Parser.parse(TRADING212_CSV);
      expect(result.parserMessages).toBeUndefined();
    });

    it("should skip a buy with no price and a Total in a different currency, and report it once", () => {
      const csv = [
        HEADER,
        // price empty, instrument currency USD, Total in EUR → unresolvable value
        "Market buy,2024-01-15 09:30:00,US0378331005,AAPL,Apple Inc,10,,USD,0.92,,,1706.60,EUR,,trade001",
        // a normal resolvable row alongside it
        "Market buy,2024-02-10 10:15:00,US5949181045,MSFT,Microsoft Corp,5,415.00,USD,0.93,,,1929.75,EUR,,trade002",
      ].join("\n");
      const result = trading212Parser.parse(csv);

      // Only the resolvable MSFT row becomes a trade
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0]!.symbol).toBe("MSFT");

      expect(result.parserMessages).toBeDefined();
      expect(result.parserMessages).toHaveLength(1);
      const msg = result.parserMessages![0]!;
      expect(msg.id).toBe("parser.trading212.unresolved_price_skipped");
      expect(msg.severity).toBe("info");
      expect(msg.context?.skipped).toBe("1");
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

  // -------------------------------------------------------------------------
  // Fractional currency normalization (GBX → GBP ÷100)
  // -------------------------------------------------------------------------

  describe("fractional currency (GBX)", () => {
    const GBX_CSV = [
      HEADER,
      "Market buy,2024-05-10 10:00:00,GB0031215220,BARC,Barclays PLC,100,185.50,GBX,0.86,,,18550.00,GBX,,gbx001",
      "Market sell,2024-08-15 14:00:00,GB0031215220,BARC,Barclays PLC,100,210.00,GBX,0.85,,,21000.00,GBX,,gbx002",
      "Dividend (Ordinary),2024-06-01 00:00:00,GB0031215220,BARC,Barclays PLC,,,GBX,0.86,,,450.00,GBX,,gbxdiv001",
      "Dividend (Dividend tax),2024-06-01 00:00:00,GB0031215220,BARC,Barclays PLC,,,GBX,0.86,,,-45.00,GBX,,gbxtax001",
    ].join("\n");

    it("should normalize GBX price to GBP (÷100)", () => {
      const result = trading212Parser.parse(GBX_CSV);
      const buy = result.trades.find((t) => t.buySell === "BUY");
      expect(buy).toBeDefined();
      expect(buy!.currency).toBe("GBP");
      expect(buy!.tradePrice).toBe("1.855");
      expect(buy!.cost).toBe("-185.5");
    });

    it("should normalize GBX sell proceeds to GBP (÷100)", () => {
      const result = trading212Parser.parse(GBX_CSV);
      const sell = result.trades.find((t) => t.buySell === "SELL");
      expect(sell).toBeDefined();
      expect(sell!.currency).toBe("GBP");
      expect(sell!.tradePrice).toBe("2.1");
      expect(sell!.proceeds).toBe("210");
    });

    it("should normalize GBX dividends to GBP (÷100)", () => {
      const result = trading212Parser.parse(GBX_CSV);
      const div = result.cashTransactions.find((c) => c.type === "Dividends");
      expect(div).toBeDefined();
      expect(div!.currency).toBe("GBP");
      expect(div!.amount).toBe("4.5");
    });

    it("should normalize GBX withholding tax to GBP (÷100)", () => {
      const result = trading212Parser.parse(GBX_CSV);
      const wht = result.cashTransactions.find((c) => c.type === "Withholding Tax");
      expect(wht).toBeDefined();
      expect(wht!.currency).toBe("GBP");
      expect(wht!.amount).toBe("-0.45");
    });

    it("should NOT divide when currency is already GBP", () => {
      const GBP_CSV = [
        HEADER,
        "Market buy,2024-05-10 10:00:00,GB0031215220,BARC,Barclays PLC,100,1.855,GBP,0.86,,,185.50,GBP,,gbp001",
      ].join("\n");
      const result = trading212Parser.parse(GBP_CSV);
      const buy = result.trades[0]!;
      expect(buy.currency).toBe("GBP");
      expect(buy.tradePrice).toBe("1.855");
      expect(buy.cost).toBe("-185.5");
    });
  });

  // -------------------------------------------------------------------------
  // Additional committed fixtures (cash / dividends / extended / v2)
  // These use the newer Trading 212 header (extra Notes/ID/fee/merchant cols).
  // Pin structural outcomes: trade direction counts, cash-transaction types.
  // -------------------------------------------------------------------------

  describe("trading212-cash-sample.csv (cash-only: interest, cashback, FX, card)", () => {
    const csv = readFileSync(
      new URL("../fixtures/trading212-cash-sample.csv", import.meta.url),
      "utf-8",
    );

    it("should detect", () => {
      expect(trading212Parser.detect(csv)).toBe(true);
    });

    it("should parse 0 trades and 5 interest payments (skip deposit/withdrawal/cashback/FX/card)", () => {
      const result = trading212Parser.parse(csv);
      expect(result.trades).toHaveLength(0);
      const interest = result.cashTransactions.filter((c) => c.type === "Broker Interest Received");
      expect(interest).toHaveLength(5);
      // Cashback, currency conversion, deposit, withdrawal and card debit are all skipped.
      expect(result.cashTransactions).toHaveLength(5);
      expect(result.cashTransactions.every((c) => c.currency === "EUR")).toBe(true);
    });

    it("should not classify any cash row as dividend or withholding", () => {
      const result = trading212Parser.parse(csv);
      expect(result.cashTransactions.filter((c) => c.type === "Dividends")).toHaveLength(0);
      expect(result.cashTransactions.filter((c) => c.type === "Withholding Tax")).toHaveLength(0);
    });
  });

  describe("trading212-dividends-sample.csv (buys + dividends + withholdings)", () => {
    const csv = readFileSync(
      new URL("../fixtures/trading212-dividends-sample.csv", import.meta.url),
      "utf-8",
    );

    it("should detect", () => {
      expect(trading212Parser.detect(csv)).toBe(true);
    });

    it("should parse 4 buy trades (ORIO, NOVA, HELI, VEGA), no sells", () => {
      const result = trading212Parser.parse(csv);
      const buys = result.trades.filter((t) => t.buySell === "BUY");
      const sells = result.trades.filter((t) => t.buySell === "SELL");
      expect(buys).toHaveLength(4);
      expect(sells).toHaveLength(0);
      expect(new Set(buys.map((t) => t.symbol))).toEqual(new Set(["ORIO", "NOVA", "HELI", "VEGA"]));
    });

    it("should parse 5 dividends and 3 withholdings (2 dividends carry no WHT)", () => {
      const result = trading212Parser.parse(csv);
      const divs = result.cashTransactions.filter((c) => c.type === "Dividends");
      const whts = result.cashTransactions.filter((c) => c.type === "Withholding Tax");
      expect(divs).toHaveLength(5);
      expect(whts).toHaveLength(3);
    });

    it("should keep withholding amounts negative and dividend amounts positive", () => {
      const result = trading212Parser.parse(csv);
      const divs = result.cashTransactions.filter((c) => c.type === "Dividends");
      const whts = result.cashTransactions.filter((c) => c.type === "Withholding Tax");
      expect(divs.every((d) => parseFloat(d.amount) > 0)).toBe(true);
      expect(whts.every((w) => parseFloat(w.amount) < 0)).toBe(true);
    });
  });

  describe("trading212-extended-sample.csv (edge-case quotes, fractional, partial closes)", () => {
    const csv = readFileSync(
      new URL("../fixtures/trading212-extended-sample.csv", import.meta.url),
      "utf-8",
    );

    it("should detect", () => {
      expect(trading212Parser.detect(csv)).toBe(true);
    });

    it("should parse 3 buys + 4 sells (QUOT closed in two partial sells)", () => {
      const result = trading212Parser.parse(csv);
      const buys = result.trades.filter((t) => t.buySell === "BUY");
      const sells = result.trades.filter((t) => t.buySell === "SELL");
      expect(buys).toHaveLength(3);
      expect(sells).toHaveLength(4);
      // QUOT is bought once and sold twice (partial closes).
      expect(result.trades.filter((t) => t.symbol === "QUOT" && t.buySell === "SELL")).toHaveLength(2);
    });

    it("should parse 1 dividend, 1 withholding, 1 interest payment", () => {
      const result = trading212Parser.parse(csv);
      expect(result.cashTransactions.filter((c) => c.type === "Dividends")).toHaveLength(1);
      expect(result.cashTransactions.filter((c) => c.type === "Withholding Tax")).toHaveLength(1);
      expect(result.cashTransactions.filter((c) => c.type === "Broker Interest Received")).toHaveLength(1);
    });

    it("should preserve a quoted company name containing both a comma and escaped quotes", () => {
      const result = trading212Parser.parse(csv);
      const quot = result.trades.find((t) => t.symbol === "QUOT")!;
      expect(quot.description).toContain("Quoted");
      expect(quot.description).toContain("Holdings");
    });

    it("should keep high-precision fractional quantities for MICR", () => {
      const result = trading212Parser.parse(csv);
      const micrBuy = result.trades.find((t) => t.symbol === "MICR" && t.buySell === "BUY")!;
      expect(micrBuy.quantity).toBe("0.123456789");
    });
  });

  describe("trading212-v2-sample.csv (interleaved card debits, deposits, multi-fill)", () => {
    const csv = readFileSync(
      new URL("../fixtures/trading212-v2-sample.csv", import.meta.url),
      "utf-8",
    );

    it("should detect", () => {
      expect(trading212Parser.detect(csv)).toBe(true);
    });

    it("should parse 9 trades (4 buys + 5 sells) across ALFA/BRAV/CYGN", () => {
      const result = trading212Parser.parse(csv);
      const buys = result.trades.filter((t) => t.buySell === "BUY");
      const sells = result.trades.filter((t) => t.buySell === "SELL");
      expect(result.trades).toHaveLength(9);
      expect(buys).toHaveLength(4);
      expect(sells).toHaveLength(5);
      expect(new Set(result.trades.map((t) => t.symbol))).toEqual(new Set(["ALFA", "BRAV", "CYGN"]));
    });

    it("should parse 2 interest payments and no dividends/withholdings", () => {
      const result = trading212Parser.parse(csv);
      expect(result.cashTransactions.filter((c) => c.type === "Broker Interest Received")).toHaveLength(2);
      expect(result.cashTransactions).toHaveLength(2);
    });

    it("should skip every card debit, cashback and deposit row", () => {
      const result = trading212Parser.parse(csv);
      const allIds = [
        ...result.trades.map((t) => t.tradeID),
        ...result.cashTransactions.map((c) => c.transactionID),
      ];
      expect(allIds.some((id) => id.toLowerCase().includes("card-"))).toBe(false);
      expect(allIds.some((id) => id.toLowerCase().includes("cb-"))).toBe(false);
      expect(allIds.some((id) => id.toLowerCase().includes("dep-"))).toBe(false);
    });
  });
});

