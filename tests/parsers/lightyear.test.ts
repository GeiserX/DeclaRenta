import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { lightyearParser } from "../../src/parsers/lightyear.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HEADER = "Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.";

const LIGHTYEAR_CSV = [
  HEADER,
  "16/12/2025 06:02:35,DD-0000000001,GOOG,US02079K1079,Dividend,,USD,,14.09,,,11.98,2.11",
  "02/12/2025 06:16:10,DD-0000000002,V,US92826C8394,Dividend,,USD,,1.34,,,1.14,0.20",
  "01/12/2025 13:47:22,OR-0000000003,BRICEKSP,IE000GWTNRJ7,Buy,6.830000000,EUR,1.000000000,6.83,,0.00,6.83,",
  "01/12/2025 13:47:22,OR-0000000004,ICSUSSDP,IE00B44BQ083,Buy,21.170000000,USD,1.000000000,21.17,,0.00,21.17,",
  "01/12/2025 13:33:55,IN-0000000005,BRICEKSP,IE000GWTNRJ7,Distribution,,EUR,,7.19,,0.36,6.83,0.00",
  "01/12/2025 13:33:55,IN-0000000006,ICSUSSDP,IE00B44BQ083,Distribution,,USD,,21.98,,0.81,21.17,0.00",
  "02/10/2025 17:19:06,RW-0000000007,,,Reward,,EUR,,0.05,,,0.05,",
  "01/10/2025 03:18:28,IN-0000000008,,,Interest,,USD,,0.02,,,0.02,0.00",
  "30/07/2025 09:01:34,WL-0000000009,,,Withdrawal,,USD,,-300.00,,,-300.00,",
  "30/07/2025 04:31:04,OR-0000000010,ICSUSSDP,IE00B44BQ083,Sell,300.000000000,USD,1.000000000,300.00,,0.00,300.00,",
  "25/07/2025 07:45:01,WL-0000000011,,,Withdrawal,,USD,,-1.00,,,-1.00,",
  "07/04/2025 19:09:30,CN-0000000012,USD,,Conversion,,USD,,64.50,0.91515,,64.50,",
  "07/04/2025 19:09:30,CN-0000000013,EUR,,Conversion,,EUR,,-59.24,1.09271,0.21,-59.03,",
  "07/04/2025 16:04:53,DT-0000000014,,,Deposit,,EUR,,100.00,,0.00,100.00,",
  "15/03/2025 10:30:00,OR-0000000015,AAPL,US0378331005,Buy,10.000000000,USD,185.500000000,1855.00,0.92,0.00,1855.00,",
  "20/06/2025 14:22:11,OR-0000000016,AAPL,US0378331005,Sell,10.000000000,USD,210.300000000,2103.00,0.93,0.00,2103.00,",
].join("\n");

const LIGHTYEAR_CSV_BOM = "\uFEFF" + LIGHTYEAR_CSV;

// Static fixture (real anonymized sample)
const LIGHTYEAR_FIXTURE = readFileSync(
  new URL("../fixtures/lightyear-sample.csv", import.meta.url),
  "utf-8",
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("lightyearParser", () => {
  // -------------------------------------------------------------------------
  // Detection
  // -------------------------------------------------------------------------

  describe("detect", () => {
    it("should detect Lightyear CSV by header", () => {
      expect(lightyearParser.detect(LIGHTYEAR_CSV)).toBe(true);
    });

    it("should detect CSV with BOM", () => {
      expect(lightyearParser.detect(LIGHTYEAR_CSV_BOM)).toBe(true);
    });

    it("should not detect IBKR XML", () => {
      expect(lightyearParser.detect("<FlexQueryResponse>")).toBe(false);
    });

    it("should not detect Coinbase CSV", () => {
      expect(
        lightyearParser.detect("Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency"),
      ).toBe(false);
    });

    it("should not detect Degiro CSV", () => {
      expect(
        lightyearParser.detect("Fecha,Hora,Producto,ISIN,Bolsa,Cantidad,Precio"),
      ).toBe(false);
    });

    it("should not detect random text", () => {
      expect(lightyearParser.detect("hello world")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("should throw on empty input", () => {
      expect(() => lightyearParser.parse("")).toThrow(/vacío/);
    });

    it("should throw on header-only input", () => {
      expect(() => lightyearParser.parse(HEADER)).toThrow(/vacío/);
    });

    it("should throw on unrecognized format", () => {
      expect(() => lightyearParser.parse("Column1,Column2\nval1,val2")).toThrow(/formato/);
    });
  });

  // -------------------------------------------------------------------------
  // Buy trades
  // -------------------------------------------------------------------------

  describe("parse buy trades", () => {
    it("should parse a stock Buy transaction (AAPL)", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const buys = result.trades.filter((t) => t.buySell === "BUY" && t.symbol === "AAPL");
      expect(buys).toHaveLength(1);

      const buy = buys[0]!;
      expect(buy.symbol).toBe("AAPL");
      expect(buy.isin).toBe("US0378331005");
      expect(buy.assetCategory).toBe("STK");
      expect(buy.currency).toBe("USD");
      expect(buy.tradeDate).toBe("20250315");
      expect(buy.quantity).toBe("10");
      expect(buy.tradePrice).toBe("185.500000000");
      expect(buy.cost).toBe("-1855");
      expect(buy.commission).toBe("0");
      expect(buy.exchange).toBe("LIGHTYEAR");
      expect(buy.openCloseIndicator).toBe("O");
    });

    it("should parse money market ETF Buy (BRICEKSP in EUR)", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const buys = result.trades.filter((t) => t.buySell === "BUY" && t.symbol === "BRICEKSP");
      expect(buys).toHaveLength(1);

      const buy = buys[0]!;
      expect(buy.isin).toBe("IE000GWTNRJ7");
      expect(buy.currency).toBe("EUR");
      expect(buy.quantity).toBe("6.83");
      expect(buy.tradeDate).toBe("20251201");
    });

    it("should parse money market ETF Buy (ICSUSSDP in USD)", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const buys = result.trades.filter((t) => t.buySell === "BUY" && t.symbol === "ICSUSSDP");
      expect(buys).toHaveLength(1);

      const buy = buys[0]!;
      expect(buy.isin).toBe("IE00B44BQ083");
      expect(buy.currency).toBe("USD");
      expect(buy.quantity).toBe("21.17");
    });
  });

  // -------------------------------------------------------------------------
  // Sell trades
  // -------------------------------------------------------------------------

  describe("parse sell trades", () => {
    it("should parse a stock Sell transaction (AAPL)", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const sells = result.trades.filter((t) => t.buySell === "SELL" && t.symbol === "AAPL");
      expect(sells).toHaveLength(1);

      const sell = sells[0]!;
      expect(sell.symbol).toBe("AAPL");
      expect(sell.isin).toBe("US0378331005");
      expect(sell.tradeDate).toBe("20250620");
      expect(parseFloat(sell.quantity)).toBeLessThan(0);
      expect(sell.proceeds).toBe("2103");
      expect(sell.openCloseIndicator).toBe("C");
    });

    it("should parse a money market Sell (ICSUSSDP)", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const sells = result.trades.filter((t) => t.buySell === "SELL" && t.symbol === "ICSUSSDP");
      expect(sells).toHaveLength(1);

      const sell = sells[0]!;
      expect(sell.tradeDate).toBe("20250730");
      expect(sell.quantity).toBe("-300");
      expect(sell.proceeds).toBe("300");
    });
  });

  // -------------------------------------------------------------------------
  // Dividends
  // -------------------------------------------------------------------------

  describe("parse dividends", () => {
    it("should parse Dividend rows as cash transactions", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const divs = result.cashTransactions.filter((c) => c.type === "Dividends" && c.description.startsWith("Dividend"));
      expect(divs).toHaveLength(2);
    });

    it("should parse GOOG dividend with correct amounts", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const googDiv = result.cashTransactions.find((c) => c.symbol === "GOOG" && c.type === "Dividends");
      expect(googDiv).toBeDefined();
      expect(googDiv!.amount).toBe("14.09");
      expect(googDiv!.currency).toBe("USD");
      expect(googDiv!.isin).toBe("US02079K1079");
      expect(googDiv!.dateTime).toBe("20251216");
    });

    it("should create withholding tax entries for dividends", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const taxes = result.cashTransactions.filter((c) => c.type === "Withholding Tax");
      expect(taxes).toHaveLength(2);

      const googTax = taxes.find((c) => c.symbol === "GOOG");
      expect(googTax).toBeDefined();
      expect(googTax!.amount).toBe("-2.11");
      expect(googTax!.currency).toBe("USD");
    });

    it("should parse V dividend with withholding", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const vDiv = result.cashTransactions.find((c) => c.symbol === "V" && c.type === "Dividends");
      expect(vDiv).toBeDefined();
      expect(vDiv!.amount).toBe("1.34");

      const vTax = result.cashTransactions.find((c) => c.symbol === "V" && c.type === "Withholding Tax");
      expect(vTax).toBeDefined();
      expect(vTax!.amount).toBe("-0.2");
    });
  });

  // -------------------------------------------------------------------------
  // Distributions (money market ETFs)
  // -------------------------------------------------------------------------

  describe("parse distributions", () => {
    it("should parse Distribution rows as dividends", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const dists = result.cashTransactions.filter((c) => c.description.startsWith("Distribution"));
      expect(dists).toHaveLength(2);
    });

    it("should parse BRICEKSP distribution with fee but zero tax", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const dist = result.cashTransactions.find(
        (c) => c.symbol === "BRICEKSP" && c.type === "Dividends",
      );
      expect(dist).toBeDefined();
      expect(dist!.amount).toBe("7.19");
      expect(dist!.currency).toBe("EUR");
      expect(dist!.isin).toBe("IE000GWTNRJ7");
    });

    it("should not create withholding tax for distributions with Tax Amt. = 0", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const briceTax = result.cashTransactions.find(
        (c) => c.symbol === "BRICEKSP" && c.type === "Withholding Tax",
      );
      expect(briceTax).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Interest and Reward
  // -------------------------------------------------------------------------

  describe("parse interest and rewards", () => {
    it("should parse Interest as cash transaction", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const interest = result.cashTransactions.find((c) => c.description.includes("Interest"));
      expect(interest).toBeDefined();
      expect(interest!.amount).toBe("0.02");
      expect(interest!.currency).toBe("USD");
      expect(interest!.type).toBe("Broker Interest Received");
    });

    it("should parse Reward as cash transaction", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const reward = result.cashTransactions.find((c) => c.description.includes("Reward"));
      expect(reward).toBeDefined();
      expect(reward!.amount).toBe("0.05");
      expect(reward!.currency).toBe("EUR");
    });
  });

  // -------------------------------------------------------------------------
  // Skipped transaction types
  // -------------------------------------------------------------------------

  describe("skip non-taxable transactions", () => {
    it("should skip Deposit rows", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const deposit = result.cashTransactions.find((c) => c.description.includes("Deposit"));
      expect(deposit).toBeUndefined();
      const depositTrade = result.trades.find((t) => t.tradeID.includes("deposit"));
      expect(depositTrade).toBeUndefined();
    });

    it("should skip Withdrawal rows", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const allIds = [...result.trades.map((t) => t.tradeID), ...result.cashTransactions.map((c) => c.transactionID)];
      expect(allIds.some((id) => id.includes("withdrawal"))).toBe(false);
    });

    it("should skip Conversion rows", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const allIds = [...result.trades.map((t) => t.tradeID), ...result.cashTransactions.map((c) => c.transactionID)];
      expect(allIds.some((id) => id.includes("conversion"))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Trade counts and totals
  // -------------------------------------------------------------------------

  describe("overall counts", () => {
    it("should produce correct number of trades", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      // AAPL Buy, AAPL Sell, BRICEKSP Buy, ICSUSSDP Buy, ICSUSSDP Sell = 5
      expect(result.trades).toHaveLength(5);
    });

    it("should produce correct number of cash transactions", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      // GOOG div + GOOG tax + V div + V tax + BRICEKSP dist + ICSUSSDP dist + Reward + Interest = 8
      expect(result.cashTransactions).toHaveLength(8);
    });

    it("should return empty arrays for non-applicable fields", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      expect(result.corporateActions).toEqual([]);
      expect(result.openPositions).toEqual([]);
      expect(result.securitiesInfo).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Date parsing
  // -------------------------------------------------------------------------

  describe("date parsing", () => {
    it("should convert DD/MM/YYYY HH:MM:SS to YYYYMMDD", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const buy = result.trades.find((t) => t.symbol === "AAPL" && t.buySell === "BUY");
      expect(buy!.tradeDate).toBe("20250315");
    });

    it("should handle all dates across months correctly", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const dates = result.trades.map((t) => t.tradeDate);
      expect(dates).toContain("20250315"); // Mar
      expect(dates).toContain("20250620"); // Jun
      expect(dates).toContain("20250730"); // Jul
      expect(dates).toContain("20251201"); // Dec
    });
  });

  // -------------------------------------------------------------------------
  // Multi-currency
  // -------------------------------------------------------------------------

  describe("multi-currency", () => {
    it("should handle EUR and USD currencies", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      const currencies = new Set(result.trades.map((t) => t.currency));
      expect(currencies.has("EUR")).toBe(true);
      expect(currencies.has("USD")).toBe(true);
    });

    it("should set fxRateToBase to '1' (ECB fetched independently)", () => {
      const result = lightyearParser.parse(LIGHTYEAR_CSV);
      result.trades.forEach((t) => expect(t.fxRateToBase).toBe("1"));
    });
  });

  // -------------------------------------------------------------------------
  // Real fixture
  // -------------------------------------------------------------------------

  describe("real fixture", () => {
    it("should detect the sample CSV", () => {
      expect(lightyearParser.detect(LIGHTYEAR_FIXTURE)).toBe(true);
    });

    it("should parse the sample CSV without errors", () => {
      const result = lightyearParser.parse(LIGHTYEAR_FIXTURE);
      expect(result.trades.length).toBeGreaterThan(0);
      expect(result.cashTransactions.length).toBeGreaterThan(0);
    });

    it("should have matching trade counts with inline fixture", () => {
      const inline = lightyearParser.parse(LIGHTYEAR_CSV);
      const fixture = lightyearParser.parse(LIGHTYEAR_FIXTURE);
      expect(fixture.trades.length).toBe(inline.trades.length);
      expect(fixture.cashTransactions.length).toBe(inline.cashTransactions.length);
    });
  });
});
