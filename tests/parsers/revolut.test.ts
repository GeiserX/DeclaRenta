import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
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

// ===========================================================================
// Transaction-log format tests
// ===========================================================================

const TXN_LOG_HEADER = [
  "Date", "Ticker", "Type", "Quantity", "Price per share",
  "Total Amount", "Currency", "FX Rate",
];

function buildTxnLogWorkbook(rows: (string | number)[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([TXN_LOG_HEADER, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

const TXN_LOG_FIXTURE_PATH = new URL("../fixtures/revolut-txnlog-sample.xlsx", import.meta.url);
const TXN_LOG_XLSX = existsSync(TXN_LOG_FIXTURE_PATH)
  ? readFileSync(TXN_LOG_FIXTURE_PATH)
  : null;

describe("revolutParser — transaction-log format", () => {
  // -----------------------------------------------------------------------
  // Detection
  // -----------------------------------------------------------------------
  describe("detectRevolutXlsx (transaction-log)", () => {
    it("should detect a transaction-log XLSX", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:02.425Z", "AAPL", "BUY - MARKET", "1", "USD 180", "USD 180", "USD", "1.08"],
      ]);
      expect(await detectRevolutXlsx(data)).toBe(true);
    });

    it("should detect the transaction-log fixture", async () => {
      if (!TXN_LOG_XLSX) return;
      expect(await detectRevolutXlsx(TXN_LOG_XLSX)).toBe(true);
    });

    it("should return false for corrupted XLSX (valid ZIP magic but bad content)", async () => {
      // PK\x03\x04 magic bytes followed by garbage
      const corrupted = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0xFF, 0xFF, 0xFF, 0xFF]);
      expect(await detectRevolutXlsx(corrupted)).toBe(false);
    });

    it("should not false-positive on a non-Revolut XLSX with 'Date' header", async () => {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([
        ["Date", "Action", "No. of shares", "Price / share"],
        ["2025-01-01", "Buy", "10", "100"],
      ]);
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
      const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      expect(await detectRevolutXlsx(data)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Text-based detect (transaction-log)
  // -----------------------------------------------------------------------
  describe("detect (text, transaction-log)", () => {
    it("should detect transaction-log headers", () => {
      const header = "Date\tTicker\tType\tQuantity\tPrice per share\tTotal Amount\tCurrency\tFX Rate";
      expect(revolutParser.detect(header)).toBe(true);
    });

    it("should not false-positive on Trading 212 headers", () => {
      const header = "Action\tTime\tISIN\tTicker\tName\tNo. of shares\tPrice / share\tCurrency\tTotal Amount";
      expect(revolutParser.detect(header)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // parseRevolutDate — ISO 8601 timestamps
  // -----------------------------------------------------------------------
  describe("parseRevolutDate (ISO 8601 timestamps)", () => {
    it("should parse ISO 8601 with milliseconds", () => {
      expect(parseRevolutDate("2025-10-20T06:00:02.425Z")).toBe("20251020");
    });

    it("should parse ISO 8601 with microseconds", () => {
      expect(parseRevolutDate("2025-10-19T00:02:32.169239Z")).toBe("20251019");
    });

    it("should parse ISO 8601 without fractional seconds", () => {
      expect(parseRevolutDate("2025-12-30T00:08:20Z")).toBe("20251230");
    });
  });

  // -----------------------------------------------------------------------
  // Full parsing — programmatic fixtures
  // -----------------------------------------------------------------------
  describe("parseRevolutXlsx (transaction-log, programmatic)", () => {
    it("should parse BUY - MARKET trades", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:02.425Z", "AAPL", "BUY - MARKET", "3.19", "USD 156.10", "USD 498", "USD", "1.08"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades.length).toBe(1);
      const buy = stmt.trades[0]!;
      expect(buy.buySell).toBe("BUY");
      expect(buy.symbol).toBe("AAPL");
      expect(parseFloat(buy.quantity)).toBeCloseTo(3.19, 2);
      expect(parseFloat(buy.tradePrice)).toBeCloseTo(156.1, 1);
      expect(buy.currency).toBe("USD");
      expect(buy.tradeDate).toBe("20251020");
      expect(buy.exchange).toBe("REVOLUT");
      expect(buy.openCloseIndicator).toBe("O");
      expect(buy.assetCategory).toBe("STK");
    });

    it("should parse SELL - MARKET trades", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:00Z", "AAPL", "BUY - MARKET", "5", "USD 150", "USD 750", "USD", "1.08"],
        ["2025-11-10T15:33:15.722Z", "AAPL", "SELL - MARKET", "5", "USD 177.75", "USD 888.75", "USD", "1.158"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades.length).toBe(2);
      const sell = stmt.trades[1]!;
      expect(sell.buySell).toBe("SELL");
      expect(sell.symbol).toBe("AAPL");
      expect(parseFloat(sell.quantity)).toBeLessThan(0);
      expect(sell.proceeds).toBe("888.75");
      expect(sell.openCloseIndicator).toBe("C");
      expect(sell.tradeDate).toBe("20251110");
    });

    it("should parse SELL - LIMIT trades", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:00Z", "GZMO", "BUY - MARKET", "5", "USD 30", "USD 150", "USD", "1.08"],
        ["2025-11-10T20:57:52.676Z", "GZMO", "SELL - LIMIT", "5", "USD 30", "USD 149.99", "USD", "1.159"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      const sell = stmt.trades[1]!;
      expect(sell.buySell).toBe("SELL");
      expect(sell.proceeds).toBe("149.99");
    });

    it("should parse EUR trades with FX Rate 1", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:02.425Z", "SAP", "BUY - MARKET", "3.19", "EUR 15.61", "EUR 50", "EUR", "1"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      const buy = stmt.trades[0]!;
      expect(buy.currency).toBe("EUR");
      expect(parseFloat(buy.tradePrice)).toBeCloseTo(15.61, 2);
    });

    it("should extract CASH TOP-UP as Deposits/Withdrawals", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-19T00:02:32.169239Z", "", "CASH TOP-UP", "", "", "EUR 250", "EUR", "1"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades.length).toBe(0);
      expect(stmt.cashTransactions.length).toBe(1);
      const cash = stmt.cashTransactions[0]!;
      expect(cash.type).toBe("Deposits/Withdrawals");
      expect(cash.description).toBe("CASH TOP-UP");
      expect(parseFloat(cash.amount)).toBe(250);
      expect(cash.currency).toBe("EUR");
    });

    it("should extract CASH WITHDRAWAL as Deposits/Withdrawals with negative amount", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-12-30T00:08:20.679435Z", "", "CASH WITHDRAWAL", "", "", "EUR -160.80", "EUR", "1"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.cashTransactions.length).toBe(1);
      const cash = stmt.cashTransactions[0]!;
      expect(cash.type).toBe("Deposits/Withdrawals");
      expect(parseFloat(cash.amount)).toBe(-160.8);
    });

    it("should skip REWARD rows (no ticker)", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-12-19T17:16:01.651593Z", "", "REWARD", "", "", "USD 0.75", "USD", "1.1743"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades.length).toBe(0);
      expect(stmt.cashTransactions.length).toBe(0);
    });

    it("should infer open positions from unmatched buys", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:00Z", "MELI", "BUY - MARKET", "0.07138129", "USD 2085", "USD 148.83", "USD", "1.082"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades.length).toBe(1);
      expect(stmt.openPositions.length).toBe(1);
      const pos = stmt.openPositions[0]!;
      expect(pos.symbol).toBe("MELI");
      expect(parseFloat(pos.quantity)).toBeCloseTo(0.07138129, 6);
      expect(parseFloat(pos.costBasisMoney)).toBeCloseTo(148.83, 2);
      expect(pos.currency).toBe("USD");
      expect(pos.assetCategory).toBe("STK");
    });

    it("should reduce open position when partially sold", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:00Z", "AAPL", "BUY - MARKET", "10", "USD 150", "USD 1500", "USD", "1.08"],
        ["2025-11-10T15:00:00Z", "AAPL", "SELL - MARKET", "6", "USD 160", "USD 960", "USD", "1.15"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades.length).toBe(2);
      expect(stmt.openPositions.length).toBe(1);
      const pos = stmt.openPositions[0]!;
      expect(pos.symbol).toBe("AAPL");
      expect(parseFloat(pos.quantity)).toBeCloseTo(4, 0);
    });

    it("should not create open position when fully sold", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:00Z", "AAPL", "BUY - MARKET", "10", "USD 150", "USD 1500", "USD", "1.08"],
        ["2025-11-10T15:00:00Z", "AAPL", "SELL - MARKET", "10", "USD 160", "USD 1600", "USD", "1.15"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.openPositions.length).toBe(0);
    });

    it("should handle fractional shares (up to 8 decimals)", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:00Z", "BRK.B", "BUY - MARKET", "1.43231884", "USD 69", "USD 98.83", "USD", "1.08"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(parseFloat(stmt.trades[0]!.quantity)).toBeCloseTo(1.43231884, 6);
    });

    it("should detect crypto symbols (BTC)", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-12-15T12:00:00Z", "BTC", "BUY - MARKET", "0.001", "USD 42000", "USD 42", "USD", "1.05"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades[0]!.assetCategory).toBe("CRYPTO");
    });

    it("should handle multiple buys of same symbol", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:00Z", "ACME", "BUY - MARKET", "3", "EUR 15.61", "EUR 46.83", "EUR", "1"],
        ["2025-11-07T10:00:00Z", "ACME", "BUY - MARKET", "7", "EUR 14.35", "EUR 100.45", "EUR", "1"],
        ["2025-12-22T16:56:00Z", "ACME", "SELL - LIMIT", "10", "EUR 16.08", "EUR 160.80", "EUR", "1"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades.length).toBe(3);
      expect(stmt.openPositions.length).toBe(0);
    });

    it("should skip blank rows", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:00Z", "AAPL", "BUY - MARKET", "5", "USD 150", "USD 750", "USD", "1.08"],
        ["", "", "", "", "", "", "", ""],
        ["2025-11-10T15:00:00Z", "AAPL", "SELL - MARKET", "5", "USD 160", "USD 800", "USD", "1.15"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades.length).toBe(2);
    });

    it("should skip rows with zero quantity", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:00Z", "AAPL", "BUY - MARKET", "0", "USD 150", "USD 0", "USD", "1.08"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades.length).toBe(0);
    });

    it("should return empty arrays for empty sheet", async () => {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([TXN_LOG_HEADER]);
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
      const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades.length).toBe(0);
      expect(stmt.cashTransactions.length).toBe(0);
      expect(stmt.openPositions.length).toBe(0);
    });

    it("should set fxRateToBase to '1' (ECB engine handles FX)", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:00Z", "AAPL", "BUY - MARKET", "5", "USD 150", "USD 750", "USD", "1.08"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades[0]!.fxRateToBase).toBe("1");
    });

    it("should set isin to empty string", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:00Z", "AAPL", "BUY - MARKET", "5", "USD 150", "USD 750", "USD", "1.08"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades[0]!.isin).toBe("");
    });

    it("should set fxRateToBase on cash transactions for non-EUR currencies", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-19T00:00:00Z", "", "CASH TOP-UP", "", "", "USD 200", "USD", "1.08"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      const cash = stmt.cashTransactions[0]!;
      expect(parseFloat(cash.fxRateToBase)).toBeCloseTo(1 / 1.08, 4);
    });

    it("should set fxRateToBase to '1' on EUR cash transactions", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-19T00:00:00Z", "", "CASH TOP-UP", "", "", "EUR 250", "EUR", "1"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.cashTransactions[0]!.fxRateToBase).toBe("1");
    });

    it("should parse BUY - LIMIT trades", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:00Z", "MSFT", "BUY - LIMIT", "2", "USD 400", "USD 800", "USD", "1.08"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades.length).toBe(1);
      expect(stmt.trades[0]!.buySell).toBe("BUY");
      expect(stmt.trades[0]!.symbol).toBe("MSFT");
      expect(parseFloat(stmt.trades[0]!.quantity)).toBe(2);
    });

    it("should handle negative quantity by taking absolute value", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:00Z", "AAPL", "BUY - MARKET", "-5", "USD 150", "USD 750", "USD", "1.08"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades.length).toBe(1);
      expect(parseFloat(stmt.trades[0]!.quantity)).toBe(5);
    });

    it("should cap sell at net position (sell exceeding buys)", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:00Z", "AAPL", "BUY - MARKET", "3", "USD 150", "USD 450", "USD", "1.08"],
        ["2025-11-10T15:00:00Z", "AAPL", "SELL - MARKET", "10", "USD 160", "USD 1600", "USD", "1.15"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades.length).toBe(2);
      // Position should not go negative — open positions should be empty (capped at 0)
      expect(stmt.openPositions.length).toBe(0);
    });

    it("should skip rows with Infinity quantity", async () => {
      const data = buildTxnLogWorkbook([
        ["2025-10-20T06:00:00Z", "AAPL", "BUY - MARKET", "Infinity", "USD 150", "USD 750", "USD", "1.08"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Real fixture (transaction-log)
  // -----------------------------------------------------------------------
  describe("parseRevolutXlsx (transaction-log fixture)", () => {
    it("should parse the fixture with correct counts", async () => {
      if (!TXN_LOG_XLSX) return;
      const stmt = await parseRevolutXlsx(TXN_LOG_XLSX);
      // 5 BUY + 4 SELL = 9 trade rows in the fixture (some symbols bought multiple times)
      const buys = stmt.trades.filter(t => t.buySell === "BUY");
      const sells = stmt.trades.filter(t => t.buySell === "SELL");
      expect(buys.length).toBeGreaterThan(0);
      expect(sells.length).toBeGreaterThan(0);
      expect(stmt.trades.length).toBe(buys.length + sells.length);
    });

    it("should extract cash transactions from fixture", async () => {
      if (!TXN_LOG_XLSX) return;
      const stmt = await parseRevolutXlsx(TXN_LOG_XLSX);
      expect(stmt.cashTransactions.length).toBeGreaterThan(0);
      const topups = stmt.cashTransactions.filter(c => c.description === "CASH TOP-UP");
      const withdrawals = stmt.cashTransactions.filter(c => c.description === "CASH WITHDRAWAL");
      expect(topups.length).toBeGreaterThan(0);
      expect(withdrawals.length).toBeGreaterThan(0);
    });

    it("should infer open positions from fixture", async () => {
      if (!TXN_LOG_XLSX) return;
      const stmt = await parseRevolutXlsx(TXN_LOG_XLSX);
      // BTC is bought but never sold in the fixture
      const btcPos = stmt.openPositions.find(p => p.symbol === "BTC");
      expect(btcPos).toBeDefined();
      expect(btcPos!.assetCategory).toBe("CRYPTO");
    });

    it("should not have ACME as open position (fully sold in fixture)", async () => {
      if (!TXN_LOG_XLSX) return;
      const stmt = await parseRevolutXlsx(TXN_LOG_XLSX);
      const acmePos = stmt.openPositions.find(p => p.symbol === "ACME");
      expect(acmePos).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Format coexistence: both formats still detected and parsed
  // -----------------------------------------------------------------------
  describe("format coexistence", () => {
    it("should still detect closed-positions format", async () => {
      const data = buildRevolutWorkbook([
        ["2020-01-01", "2020-02-10", "AAPL", "5", "1000", "1100", "100", "0", "100", "USD"],
      ]);
      expect(await detectRevolutXlsx(data)).toBe(true);
    });

    it("should still parse closed-positions format correctly", async () => {
      const data = buildRevolutWorkbook([
        ["2020-01-01", "2020-02-10", "AAPL", "5", "1000", "1100", "100", "0", "100", "USD"],
      ]);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades.length).toBe(2);
      expect(stmt.trades[0]!.buySell).toBe("BUY");
      expect(stmt.trades[1]!.buySell).toBe("SELL");
    });

    it("should return empty statement for sheet with no content", async () => {
      // Build a workbook with a sheet that has absolutely no cells
      const xlsx = await import("xlsx");
      const wb = xlsx.utils.book_new();
      const ws: import("xlsx").WorkSheet = {};
      xlsx.utils.book_append_sheet(wb, ws, "Empty");
      const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
      const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      const stmt = await parseRevolutXlsx(data);
      expect(stmt.trades.length).toBe(0);
      expect(stmt.cashTransactions.length).toBe(0);
      expect(stmt.openPositions.length).toBe(0);
    });

    it("should route transaction-log to new parser and closed-positions to old", async () => {
      const txnData = buildTxnLogWorkbook([
        ["2025-10-20T06:00:00Z", "AAPL", "BUY - MARKET", "5", "USD 150", "USD 750", "USD", "1.08"],
      ]);
      const closedData = buildRevolutWorkbook([
        ["2020-01-01", "2020-02-10", "AAPL", "5", "1000", "1100", "100", "0", "100", "USD"],
      ]);
      const txnStmt = await parseRevolutXlsx(txnData);
      const closedStmt = await parseRevolutXlsx(closedData);
      // Transaction-log has cash transaction support
      expect(txnStmt.trades.length).toBe(1);
      expect(txnStmt.trades[0]!.tradeID).toMatch(/^revolut-buy-/);
      // Closed-positions has paired buy/sell legs
      expect(closedStmt.trades.length).toBe(2);
      expect(closedStmt.trades[0]!.tradeID).toMatch(/^revolut-open-/);
    });
  });
});
