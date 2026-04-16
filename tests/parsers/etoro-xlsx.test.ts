import { describe, it, expect } from "vitest";
import { parseEtoroXlsx, detectEtoroXlsx } from "../../src/parsers/etoro.js";
import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const CLOSED_POSITIONS_HEADER = [
  "Action", "Amount", "Units", "Open Rate", "Close Rate", "Profit(USD)",
  "Open Date", "Close Date", "Type", "Leverage", "ISIN",
];

const DIVIDENDS_HEADER = [
  "Date of Payment", "Instrument Name", "Net Dividend Received (USD)",
  "Withholding Tax Amount (USD)", "ISIN",
];

// ---------------------------------------------------------------------------
// Helper: build a minimal eToro-like XLSX workbook in memory
// ---------------------------------------------------------------------------

function buildEtoroWorkbook(opts: {
  closedPositions?: string[][];
  dividends?: string[][];
}): Uint8Array {
  const wb = XLSX.utils.book_new();

  if (opts.closedPositions) {
    const ws = XLSX.utils.aoa_to_sheet(opts.closedPositions);
    XLSX.utils.book_append_sheet(wb, ws, "Closed Positions");
  }

  if (opts.dividends) {
    const ws = XLSX.utils.aoa_to_sheet(opts.dividends);
    XLSX.utils.book_append_sheet(wb, ws, "Dividends");
  }

  // Write workbook to a buffer
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("eToro XLSX parsing", () => {
  describe("detectEtoroXlsx", () => {
    it("should detect a valid eToro XLSX", () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Buy AAPL", "1000", "5", "180", "195", "82.50", "15/03/2025 09:30:00", "20/09/2025 14:00:00", "Stocks", "1", "US0378331005"],
        ],
      });
      expect(detectEtoroXlsx(data)).toBe(true);
    });

    it("should reject non-ZIP data", () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      expect(detectEtoroXlsx(data)).toBe(false);
    });

    it("should reject empty data", () => {
      const data = new Uint8Array(0);
      expect(detectEtoroXlsx(data)).toBe(false);
    });
  });

  describe("parseEtoroXlsx — closed positions", () => {
    it("should parse basic stock trades", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Buy AAPL", "1000.00", "5.5", "180.00", "195.00", "82.50", "15/03/2025 09:30:00", "20/09/2025 14:00:00", "Stocks", "1", "US0378331005"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(2); // 1 buy + 1 sell
      const buy = result.trades.find((t) => t.buySell === "BUY");
      const sell = result.trades.find((t) => t.buySell === "SELL");
      expect(buy).toBeDefined();
      expect(buy!.symbol).toBe("AAPL");
      expect(buy!.isin).toBe("US0378331005");
      expect(sell).toBeDefined();
    });

    it("should parse CFDs (leverage > 1) as CFD asset category", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Buy AAPL", "1000", "5", "180", "195", "82.50", "15/03/2025 09:30:00", "20/09/2025 14:00:00", "Stocks", "1", "US0378331005"],
          ["Buy EURUSD", "1000", "1000", "1.08", "1.09", "10", "01/04/2025", "01/05/2025", "CFD", "2", ""],
        ],
      });

      const result = await parseEtoroXlsx(data);
      // Both AAPL (stock) and EURUSD (CFD) are parsed
      expect(result.trades).toHaveLength(4); // 2 buy+sell for AAPL + 2 buy+sell for EURUSD
      expect(result.trades[0]!.symbol).toBe("AAPL");
      expect(result.trades[0]!.assetCategory).toBe("STK");
      expect(result.trades[2]!.symbol).toBe("EURUSD");
      expect(result.trades[2]!.assetCategory).toBe("CFD");
    });

    it("should skip crypto", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Buy BTC", "500", "0.01", "50000", "55000", "50", "01/01/2025", "01/03/2025", "Crypto", "1", ""],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(0); // crypto filtered out
    });

    it("should handle multiple trades", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Buy AAPL", "1000", "5", "180", "195", "82.50", "15/03/2025 09:30:00", "20/09/2025 14:00:00", "Stocks", "1", "US0378331005"],
          ["Buy TSLA", "2000", "10", "200", "180", "-200", "01/02/2025", "15/06/2025", "Stocks", "1", "US88160R1014"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(4); // 2 buys + 2 sells
      const symbols = result.trades.map((t) => t.symbol);
      expect(symbols).toContain("AAPL");
      expect(symbols).toContain("TSLA");
    });

    it("should parse dates in DD/MM/YYYY format", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Buy AAPL", "1000", "5", "180", "195", "82.50", "15/03/2025 09:30:00", "20/09/2025 14:00:00", "Stocks", "1", "US0378331005"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades[0]!.tradeDate).toBe("20250315");
      expect(result.trades[1]!.tradeDate).toBe("20250920");
    });

    it("should calculate proceeds from amount + profit", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Buy AAPL", "1000", "5", "180", "195", "82.50", "15/03/2025", "20/09/2025", "Stocks", "1", "US0378331005"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      const sell = result.trades[1]!;
      // proceeds = amount + profit = 1000 + 82.50 = 1082.50
      expect(sell.proceeds).toBe("1082.5");
    });
  });

  describe("parseEtoroXlsx — dividends", () => {
    it("should parse dividend entries", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
        ],
        dividends: [
          DIVIDENDS_HEADER,
          ["15/06/2025", "AAPL", "42.50", "7.50", "US0378331005"],
          ["20/09/2025", "MSFT", "30.00", "5.30", "US5949181045"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      const divs = result.cashTransactions.filter((c) => c.type === "Dividends");
      const whts = result.cashTransactions.filter((c) => c.type === "Withholding Tax");

      expect(divs).toHaveLength(2);
      expect(whts).toHaveLength(2);
      expect(divs[0]!.symbol).toBe("AAPL");
      expect(divs[0]!.isin).toBe("US0378331005");
    });

    it("should include ISIN country code in dividend description", async () => {
      const data = buildEtoroWorkbook({
        dividends: [
          DIVIDENDS_HEADER,
          ["15/06/2025", "AAPL", "42.50", "7.50", "US0378331005"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      const div = result.cashTransactions.find((c) => c.type === "Dividends")!;
      expect(div.description).toContain("US");
      expect(div.description).toContain("Dividend");
    });

    it("should compute gross from net + withholding", async () => {
      const data = buildEtoroWorkbook({
        dividends: [
          DIVIDENDS_HEADER,
          ["15/06/2025", "AAPL", "42.50", "7.50", "US0378331005"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      const div = result.cashTransactions.find((c) => c.type === "Dividends")!;
      // gross = net + abs(wht) = 42.50 + 7.50 = 50.00
      expect(parseFloat(div.amount)).toBeCloseTo(50.00, 2);
    });

    it("should handle dividend with no withholding", async () => {
      const data = buildEtoroWorkbook({
        dividends: [
          DIVIDENDS_HEADER,
          ["15/06/2025", "VWCE", "100.00", "0", "IE00BK5BQT80"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      const divs = result.cashTransactions.filter((c) => c.type === "Dividends");
      const whts = result.cashTransactions.filter((c) => c.type === "Withholding Tax");
      expect(divs).toHaveLength(1);
      expect(whts).toHaveLength(0); // no withholding → no WHT entry
    });
  });

  describe("parseEtoroXlsx — empty workbook", () => {
    it("should handle workbook with no matching sheets", async () => {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([["Dummy"]]);
      XLSX.utils.book_append_sheet(wb, ws, "Other");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
      const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(0);
      expect(result.cashTransactions).toHaveLength(0);
    });

    it("should handle empty closed positions sheet", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(0);
    });
  });

  describe("parseEtoroXlsx — date format edge cases", () => {
    it("should handle ISO date format (YYYY-MM-DD)", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Buy AAPL", "1000", "5", "180", "195", "82.50", "2025-03-15 09:30:00", "2025-09-20 14:00:00", "Stocks", "1", "US0378331005"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(2);
      expect(result.trades[0]!.tradeDate).toBe("20250315");
      expect(result.trades[1]!.tradeDate).toBe("20250920");
    });

    it("should handle fallback date format (no match)", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Buy AAPL", "1000", "5", "180", "195", "82.50", "20250315", "20250920", "Stocks", "1", "US0378331005"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(2);
      expect(result.trades[0]!.tradeDate).toBe("20250315");
    });
  });

  describe("parseEtoroXlsx — filtering edge cases", () => {
    it("should skip rows with unparseable action", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["INVALID ACTION", "1000", "5", "180", "195", "82.50", "15/03/2025", "20/09/2025", "Stocks", "1", "US0378331005"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(0);
    });

    it("should skip rows with NaN units", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Buy AAPL", "1000", "abc", "180", "195", "82.50", "15/03/2025", "20/09/2025", "Stocks", "1", "US0378331005"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(0);
    });

    it("should skip ETF-like type that doesn't match", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Buy GOLD", "1000", "5", "180", "195", "82.50", "15/03/2025", "20/09/2025", "Commodity", "1", "XS0000000001"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(0);
    });

    it("should parse leverage-based CFD with correct asset category", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Buy AAPL", "1000", "5", "180", "195", "82.50", "15/03/2025", "20/09/2025", "Stocks", "5", "US0378331005"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(2);
      // Leverage 5 → CFD
      expect(result.trades[0]!.assetCategory).toBe("CFD");
      expect(result.trades[1]!.assetCategory).toBe("CFD");
    });

    it("should parse index CFDs (leveraged index positions)", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Buy SPX500", "2000", "1", "4500", "4600", "200", "01/04/2025", "01/05/2025", "Index", "10", ""],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(2);
      expect(result.trades[0]!.assetCategory).toBe("CFD");
      expect(result.trades[0]!.symbol).toBe("SPX500");
    });

    it("should accept ETF type", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Buy VWCE", "2000", "10", "100", "110", "100", "15/03/2025", "20/09/2025", "ETF", "1", "IE00BK5BQT80"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(2);
    });

    it("should handle row with no type column (missing column)", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          // Header without Type and Leverage columns
          ["Action", "Amount", "Units", "Open Rate", "Close Rate", "Profit(USD)", "Open Date", "Close Date", "ISIN"],
          ["Buy AAPL", "1000", "5", "180", "195", "82.50", "15/03/2025", "20/09/2025", "US0378331005"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      // Should still parse — no type/leverage filtering when columns missing
      expect(result.trades).toHaveLength(2);
    });

    it("should handle Sell action", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Sell AAPL", "1000", "5", "195", "180", "-82.50", "15/03/2025", "20/09/2025", "Stocks", "1", "US0378331005"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(2);
      // eToro still creates buy + sell legs regardless of action direction
      const buy = result.trades.find((t) => t.buySell === "BUY");
      const sell = result.trades.find((t) => t.buySell === "SELL");
      expect(buy).toBeDefined();
      expect(sell).toBeDefined();
    });
  });

  describe("parseEtoroXlsx — Spanish sheet names", () => {
    it("should find sheets with Spanish names", async () => {
      const wb = XLSX.utils.book_new();

      const closedSheet = XLSX.utils.aoa_to_sheet([
        CLOSED_POSITIONS_HEADER,
        ["Buy AAPL", "1000", "5", "180", "195", "82.50", "15/03/2025", "20/09/2025", "Stocks", "1", "US0378331005"],
      ]);
      XLSX.utils.book_append_sheet(wb, closedSheet, "Posiciones Cerradas");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
      const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(2);
    });
  });
});
