import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import * as XLSX from "xlsx";
import { revolutParser } from "../../src/parsers/revolut.js";
import { parseRevolutXlsx, detectRevolutXlsx, parseRevolutDate } from "../../src/parsers/revolut.js";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const REVOLUT_HEADER = [
  "Date acquired", "Date sold", "Symbol", "Quantity",
  "Cost basis", "Gross proceeds", "Gross PnL", "Fees", "Net PnL", "Currency",
];

// ---------------------------------------------------------------------------
// Helper: build a Revolut-like XLSX workbook in memory
// ---------------------------------------------------------------------------

function buildRevolutWorkbook(rows: (string | number)[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([REVOLUT_HEADER, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function buildEmptyWorkbook(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

// ---------------------------------------------------------------------------
// Static fixture (real Revolut sample)
// ---------------------------------------------------------------------------

const REVOLUT_XLSX = readFileSync(
  new URL("../fixtures/revolut-sample.xlsx", import.meta.url),
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("revolutParser", () => {
  // -----------------------------------------------------------------------
  // Text-based detect()
  // -----------------------------------------------------------------------
  describe("detect (text mode)", () => {
    it("should detect English Revolut headers", () => {
      const header = "Date acquired\tDate sold\tSymbol\tQuantity\tCost basis\tGross proceeds";
      expect(revolutParser.detect(header)).toBe(true);
    });

    it("should detect Spanish Revolut headers", () => {
      const header = "Fecha de adquisición\tFecha de venta\tSímbolo\tBase de coste";
      expect(revolutParser.detect(header)).toBe(true);
    });

    it("should detect alternative Spanish header (Ingresos brutos)", () => {
      const header = "Fecha de adquisición\tFecha de venta\tSímbolo\tIngresos brutos";
      expect(revolutParser.detect(header)).toBe(true);
    });

    it("should not detect eToro input", () => {
      const etoro = "Closed Positions\nAction\tAmount\tUnits\tOpen Rate\tClose Rate";
      expect(revolutParser.detect(etoro)).toBe(false);
    });

    it("should not detect random text", () => {
      expect(revolutParser.detect("hello world")).toBe(false);
    });

    it("should not false-positive on text containing both Revolut and eToro markers", () => {
      const mixed = "Date acquired\tCost basis\tClosed Positions";
      expect(revolutParser.detect(mixed)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Text-based parse() fallback
  // -----------------------------------------------------------------------
  describe("parse (text mode)", () => {
    it("should throw on empty input", () => {
      expect(() => revolutParser.parse("")).toThrow(/vacío/);
    });

    it("should throw on whitespace-only input", () => {
      expect(() => revolutParser.parse("   \n  ")).toThrow(/vacío/);
    });

    it("should throw for non-empty text (XLSX-only format)", () => {
      expect(() => revolutParser.parse("Date acquired\tDate sold\tSymbol")).toThrow(/XLSX/);
    });
  });

  // -----------------------------------------------------------------------
  // parseRevolutDate
  // -----------------------------------------------------------------------
  describe("parseRevolutDate", () => {
    it("should parse YYYY-MM-DD (primary format)", () => {
      expect(parseRevolutDate("2020-01-15")).toBe("20200115");
    });

    it("should parse DD/MM/YYYY (EU format)", () => {
      expect(parseRevolutDate("15/01/2020")).toBe("20200115");
    });

    it("should parse M/D/YYYY (US format)", () => {
      expect(parseRevolutDate("1/5/2020")).toBe("20200105");
    });

    it("should handle YYYY-MM-DD with trailing time", () => {
      expect(parseRevolutDate("2020-01-15 09:30:00")).toBe("20200115");
    });

    it("should trim whitespace", () => {
      expect(parseRevolutDate("  2020-01-15  ")).toBe("20200115");
    });

    it("should handle fallback (already YYYYMMDD)", () => {
      expect(parseRevolutDate("20200115")).toBe("20200115");
    });
  });

  // -----------------------------------------------------------------------
  // detectRevolutXlsx (binary)
  // -----------------------------------------------------------------------
  describe("detectRevolutXlsx (binary)", () => {
    it("should detect the real Revolut sample XLSX", async () => {
      expect(await detectRevolutXlsx(REVOLUT_XLSX)).toBe(true);
    });

    it("should detect a programmatic Revolut XLSX", async () => {
      const data = buildRevolutWorkbook([
        ["2020-01-01", "2020-02-10", "BTC", "0.5", "5000", "5500", "500", "0", "500", "USD"],
      ]);
      expect(await detectRevolutXlsx(data)).toBe(true);
    });

    it("should reject non-ZIP data", async () => {
      expect(await detectRevolutXlsx(Buffer.from("not a zip"))).toBe(false);
    });

    it("should reject empty buffer", async () => {
      expect(await detectRevolutXlsx(Buffer.alloc(0))).toBe(false);
    });

    it("should reject an eToro XLSX (no false positive)", async () => {
      // Build an eToro-like workbook
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([
        ["Action", "Amount", "Units", "Open Rate", "Close Rate"],
        ["Buy AAPL", "1000", "5", "180", "195"],
      ]);
      XLSX.utils.book_append_sheet(wb, ws, "Closed Positions");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
      const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      expect(await detectRevolutXlsx(data)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // parseRevolutXlsx — real fixture
  // -----------------------------------------------------------------------
  describe("parseRevolutXlsx (real fixture)", () => {
    it("should parse the sample XLSX into 4 trades (2 round-trips)", async () => {
      const statement = await parseRevolutXlsx(REVOLUT_XLSX);
      expect(statement.trades.length).toBe(4);
    });

    it("should create equal BUY and SELL legs", async () => {
      const statement = await parseRevolutXlsx(REVOLUT_XLSX);
      const buys = statement.trades.filter((t) => t.buySell === "BUY");
      const sells = statement.trades.filter((t) => t.buySell === "SELL");
      expect(buys.length).toBe(2);
      expect(sells.length).toBe(2);
    });

    it("should parse first BTC BUY leg correctly", async () => {
      const statement = await parseRevolutXlsx(REVOLUT_XLSX);
      const buy = statement.trades[0]!;
      expect(buy.symbol).toBe("BTC");
      expect(buy.buySell).toBe("BUY");
      expect(buy.tradeDate).toBe("20200101");
      expect(buy.assetCategory).toBe("CRYPTO");
      expect(buy.currency).toBe("USD");
      expect(parseFloat(buy.quantity)).toBeCloseTo(0.00435182, 6);
      expect(buy.openCloseIndicator).toBe("O");
      expect(buy.exchange).toBe("REVOLUT");
      expect(buy.cost).toBe("-38.86");
    });

    it("should parse first BTC SELL leg correctly", async () => {
      const statement = await parseRevolutXlsx(REVOLUT_XLSX);
      const sell = statement.trades[1]!;
      expect(sell.symbol).toBe("BTC");
      expect(sell.buySell).toBe("SELL");
      expect(sell.tradeDate).toBe("20200210");
      expect(sell.assetCategory).toBe("CRYPTO");
      expect(parseFloat(sell.quantity)).toBeLessThan(0);
      expect(sell.proceeds).toBe("40.52");
      expect(sell.fifoPnlRealized).toBe("1.66");
      expect(sell.openCloseIndicator).toBe("C");
    });

    it("should return empty arrays for non-trade fields", async () => {
      const statement = await parseRevolutXlsx(REVOLUT_XLSX);
      expect(statement.cashTransactions).toEqual([]);
      expect(statement.corporateActions).toEqual([]);
      expect(statement.openPositions).toEqual([]);
      expect(statement.securitiesInfo).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // parseRevolutXlsx — programmatic fixtures
  // -----------------------------------------------------------------------
  describe("parseRevolutXlsx (programmatic)", () => {
    it("should parse a stock trade as STK asset category", async () => {
      const data = buildRevolutWorkbook([
        ["2025-03-15", "2025-09-20", "AAPL", "10", "1755.00", "1950.00", "195.00", "0", "195.00", "USD"],
      ]);
      const statement = await parseRevolutXlsx(data);
      expect(statement.trades.length).toBe(2);
      const buy = statement.trades[0]!;
      const sell = statement.trades[1]!;
      expect(buy.assetCategory).toBe("STK");
      expect(sell.assetCategory).toBe("STK");
      expect(buy.symbol).toBe("AAPL");
    });

    it("should handle EUR currency trades", async () => {
      const data = buildRevolutWorkbook([
        ["2025-01-10", "2025-06-15", "SAP", "5", "800.00", "900.00", "100.00", "0", "100.00", "EUR"],
      ]);
      const statement = await parseRevolutXlsx(data);
      const buy = statement.trades[0]!;
      const sell = statement.trades[1]!;
      expect(buy.currency).toBe("EUR");
      expect(sell.currency).toBe("EUR");
    });

    it("should handle GBP currency trades", async () => {
      const data = buildRevolutWorkbook([
        ["2025-02-01", "2025-07-01", "SHEL", "20", "500.00", "550.00", "50.00", "0", "50.00", "GBP"],
      ]);
      const statement = await parseRevolutXlsx(data);
      expect(statement.trades[0]!.currency).toBe("GBP");
      expect(statement.trades[1]!.currency).toBe("GBP");
    });

    it("should assign full fee to SELL leg only", async () => {
      const data = buildRevolutWorkbook([
        ["2025-01-01", "2025-06-01", "AAPL", "10", "1000", "1200", "200", "10.00", "190", "USD"],
      ]);
      const statement = await parseRevolutXlsx(data);
      const buy = statement.trades[0]!;
      const sell = statement.trades[1]!;
      expect(buy.commission).toBe("0");
      expect(sell.commission).toBe("-10.00");
    });

    it("should handle fractional shares", async () => {
      const data = buildRevolutWorkbook([
        ["2025-01-01", "2025-06-01", "TSLA", "0.123456", "50.00", "55.00", "5.00", "0", "5.00", "USD"],
      ]);
      const statement = await parseRevolutXlsx(data);
      const buy = statement.trades[0]!;
      expect(parseFloat(buy.quantity)).toBeCloseTo(0.123456, 6);
      expect(parseFloat(buy.tradePrice)).toBeCloseTo(50 / 0.123456, 2);
    });

    it("should handle losing trades (negative PnL)", async () => {
      const data = buildRevolutWorkbook([
        ["2025-01-01", "2025-06-01", "META", "5", "1500.00", "1200.00", "-300.00", "0", "-300.00", "USD"],
      ]);
      const statement = await parseRevolutXlsx(data);
      const sell = statement.trades[1]!;
      expect(sell.fifoPnlRealized).toBe("-300");
      expect(sell.proceeds).toBe("1200");
    });

    it("should use Math.abs on cost/proceeds to prevent double-negatives", async () => {
      const data = buildRevolutWorkbook([
        ["2025-01-01", "2025-06-01", "TEST", "1", "-100", "150", "50", "0", "50", "USD"],
      ]);
      const statement = await parseRevolutXlsx(data);
      const buy = statement.trades[0]!;
      expect(buy.cost).toBe("-100");
      expect(buy.tradeMoney).toBe("-100");
    });

    it("should skip rows with zero quantity", async () => {
      const data = buildRevolutWorkbook([
        ["2025-01-01", "2025-06-01", "AAPL", "0", "0", "0", "0", "0", "0", "USD"],
        ["2025-01-01", "2025-06-01", "TSLA", "5", "1000", "1100", "100", "0", "100", "USD"],
      ]);
      const statement = await parseRevolutXlsx(data);
      expect(statement.trades.length).toBe(2); // Only TSLA
      expect(statement.trades[0]!.symbol).toBe("TSLA");
    });

    it("should skip rows with NaN quantity", async () => {
      const data = buildRevolutWorkbook([
        ["2025-01-01", "2025-06-01", "AAPL", "abc", "1000", "1100", "100", "0", "100", "USD"],
      ]);
      const statement = await parseRevolutXlsx(data);
      expect(statement.trades.length).toBe(0);
    });

    it("should skip rows with empty symbol", async () => {
      const data = buildRevolutWorkbook([
        ["2025-01-01", "2025-06-01", "", "5", "1000", "1100", "100", "0", "100", "USD"],
      ]);
      const statement = await parseRevolutXlsx(data);
      expect(statement.trades.length).toBe(0);
    });

    it("should skip blank rows between data rows", async () => {
      const data = buildRevolutWorkbook([
        ["2025-01-01", "2025-06-01", "AAPL", "5", "1000", "1100", "100", "0", "100", "USD"],
        ["", "", "", "", "", "", "", "", "", ""],
        ["2025-02-01", "2025-07-01", "TSLA", "3", "600", "700", "100", "0", "100", "USD"],
      ]);
      const statement = await parseRevolutXlsx(data);
      expect(statement.trades.length).toBe(4); // 2 round-trips
    });

    it("should return empty trades for header-only XLSX", async () => {
      const data = buildRevolutWorkbook([]);
      const statement = await parseRevolutXlsx(data);
      expect(statement.trades.length).toBe(0);
    });

    it("should return empty trades for empty XLSX", async () => {
      const data = buildEmptyWorkbook();
      const statement = await parseRevolutXlsx(data);
      expect(statement.trades.length).toBe(0);
    });

    it("should detect crypto symbols starting with digits", async () => {
      const data = buildRevolutWorkbook([
        ["2025-01-01", "2025-06-01", "1INCH", "100", "50", "60", "10", "0", "10", "USD"],
      ]);
      const statement = await parseRevolutXlsx(data);
      expect(statement.trades[0]!.assetCategory).toBe("CRYPTO");
    });

    it("should detect well-known short stock tickers as STK", async () => {
      const data = buildRevolutWorkbook([
        ["2025-01-01", "2025-06-01", "T", "10", "200", "220", "20", "0", "20", "USD"],
      ]);
      const statement = await parseRevolutXlsx(data);
      expect(statement.trades[0]!.assetCategory).toBe("STK");
    });

    it("should handle multiple trades across different years", async () => {
      const data = buildRevolutWorkbook([
        ["2024-03-15", "2024-09-20", "AAPL", "10", "1000", "1100", "100", "0", "100", "USD"],
        ["2025-01-10", "2025-06-15", "ETH", "0.5", "1500", "2000", "500", "0", "500", "USD"],
      ]);
      const statement = await parseRevolutXlsx(data);
      expect(statement.trades.length).toBe(4);
      // First pair: AAPL 2024
      expect(statement.trades[0]!.tradeDate).toBe("20240315");
      expect(statement.trades[0]!.assetCategory).toBe("STK");
      // Second pair: ETH 2025
      expect(statement.trades[2]!.tradeDate).toBe("20250110");
      expect(statement.trades[2]!.assetCategory).toBe("CRYPTO");
    });

    it("should set fxRateToBase to '1' regardless of currency (documented limitation)", async () => {
      const data = buildRevolutWorkbook([
        ["2025-01-01", "2025-06-01", "AAPL", "5", "1000", "1100", "100", "0", "100", "USD"],
      ]);
      const statement = await parseRevolutXlsx(data);
      // fxRateToBase is always "1" — the FIFO engine fetches ECB rates independently
      expect(statement.trades[0]!.fxRateToBase).toBe("1");
      expect(statement.trades[1]!.fxRateToBase).toBe("1");
    });

    it("should set isin to empty string (Revolut limitation)", async () => {
      const data = buildRevolutWorkbook([
        ["2025-01-01", "2025-06-01", "AAPL", "5", "1000", "1100", "100", "0", "100", "USD"],
      ]);
      const statement = await parseRevolutXlsx(data);
      expect(statement.trades[0]!.isin).toBe("");
      expect(statement.trades[1]!.isin).toBe("");
    });
  });
});
