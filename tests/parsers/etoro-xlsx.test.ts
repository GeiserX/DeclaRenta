import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
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
    it("should detect a valid eToro XLSX", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Buy AAPL", "1000", "5", "180", "195", "82.50", "15/03/2025 09:30:00", "20/09/2025 14:00:00", "Stocks", "1", "US0378331005"],
        ],
      });
      expect(await detectEtoroXlsx(data)).toBe(true);
    });

    it("should reject non-ZIP data", async () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      expect(await detectEtoroXlsx(data)).toBe(false);
    });

    it("should reject empty data", async () => {
      const data = new Uint8Array(0);
      expect(await detectEtoroXlsx(data)).toBe(false);
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

    it("should parse Commodity type as CFD (eToro commodities are always derivatives)", async () => {
      const data = buildEtoroWorkbook({
        closedPositions: [
          CLOSED_POSITIONS_HEADER,
          ["Buy GOLD", "1000", "5", "180", "195", "82.50", "15/03/2025", "20/09/2025", "Commodity", "1", "XS0000000001"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(2); // buy + sell legs
      expect(result.trades[0]!.assetCategory).toBe("CFD");
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

  describe("parseEtoroXlsx — Spanish export format (full)", () => {
    const SPANISH_CLOSED_HEADER = [
      "ID de posición", "Acción", "Long / Short", "Importe", "Unidades",
      "Fecha de apertura", "Fecha de cierre", "Apalancamiento",
      "Comisiones de diferencial (USD)", "Diferencial de mercado (USD)",
      "Ganancias (USD)", "Ganancias (EUR)", "Tipo de cambio de apertura (USD)",
      "Tipo de cambio al cierre (USD)", "Tasa de apertura", "Tasa de cierre",
      "Tasa de Take Profit", "Tasa de Stop Loss",
      "Comisiones nocturnas y dividendos", "Copiado desde", "Tipo", "ISIN", "Notas",
    ];

    const SPANISH_DIVIDENDS_HEADER = [
      "Fecha de pago", "Nombre del instrumento", "Dividendo neto recibido (USD)",
      "Net dividends", "Currency", "Con deducción/sin deducción",
      "Dividendos con deducción (AUD)", "Dividendo neto recibido (EUR)",
      "Tasa de retención fiscal (%)", "Importe de la retención tributaria (USD)",
      "Importe de la retención tributaria (EUR)", "ID de posición", "Tipo", "ISIN",
    ];

    const SPANISH_ACTIVITY_HEADER = [
      "Fecha", "Tipo", "Detalles", "Importe", "Unidades",
      "Cambio de capital realizado", "Capital realizado", "Saldo",
      "ID de posición", "Tipo de activo", "Importe no retirable",
    ];

    function buildSpanishWorkbook(opts: {
      closedPositions?: string[][];
      dividends?: string[][];
      activity?: string[][];
    }): Uint8Array {
      const wb = XLSX.utils.book_new();
      if (opts.closedPositions) {
        const ws = XLSX.utils.aoa_to_sheet(opts.closedPositions);
        XLSX.utils.book_append_sheet(wb, ws, "Posiciones cerradas");
      }
      if (opts.dividends) {
        const ws = XLSX.utils.aoa_to_sheet(opts.dividends);
        XLSX.utils.book_append_sheet(wb, ws, "Dividendos");
      }
      if (opts.activity) {
        const ws = XLSX.utils.aoa_to_sheet(opts.activity);
        XLSX.utils.book_append_sheet(wb, ws, "Actividad de la cuenta");
      }
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }

    it("should detect Spanish eToro workbook", async () => {
      const data = buildSpanishWorkbook({
        closedPositions: [SPANISH_CLOSED_HEADER],
      });
      expect(await detectEtoroXlsx(data)).toBe(true);
    });

    it("should parse Long positions using 'Acción' as symbol and 'Long / Short' for direction", async () => {
      const data = buildSpanishWorkbook({
        closedPositions: [
          SPANISH_CLOSED_HEADER,
          // ID, Acción, Long/Short, Importe, Unidades, FechaApertura, FechaCierre, Apalancamiento,
          // ComDif(USD), DifMercado(USD), Ganancias(USD), Ganancias(EUR), TipoCambioAp, TipoCambioCi,
          // TasaApertura, TasaCierre, TP, SL, Comisiones, Copiado, Tipo, ISIN, Notas
          ["123", "Apple Inc (AAPL)", "Long", "1000", "5.5", "15/03/2024 09:30:00", "20/09/2025 14:00:00",
           "1", "0", "-0.5", "100", "91.50", "1.08", "1.10", "180", "200", "0", "0", "0", "-", "Acciones", "US0378331005", ""],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(2);

      const buy = result.trades[0]!;
      expect(buy.buySell).toBe("BUY");
      expect(buy.symbol).toBe("Apple Inc (AAPL)");
      expect(buy.isin).toBe("US0378331005");
      expect(buy.currency).toBe("EUR");
      expect(buy.quantity).toBe("5.5");
      expect(buy.tradePrice).toBe("180");
      expect(buy.tradeDate).toBe("20240315");

      const sell = result.trades[1]!;
      expect(sell.buySell).toBe("SELL");
      expect(sell.tradeDate).toBe("20250920");
      expect(sell.tradePrice).toBe("200");
      expect(sell.fifoPnlRealized).toBe("91.50");
      expect(sell.currency).toBe("EUR");
    });

    it("should parse Short positions with inverted buy/sell legs", async () => {
      const data = buildSpanishWorkbook({
        closedPositions: [
          SPANISH_CLOSED_HEADER,
          ["456", "Tesla (TSLA)", "Short", "2000", "10", "01/02/2025 10:00:00", "15/06/2025 16:00:00",
           "1", "0", "0", "50", "45", "1.09", "1.10", "250", "200", "0", "0", "0", "-", "Acciones", "US88160R1014", ""],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(2);
      // Short: opening leg is SELL, closing leg is BUY
      expect(result.trades[0]!.buySell).toBe("SELL");
      expect(result.trades[1]!.buySell).toBe("BUY");
    });

    it("should build a PROFITABLE short with open-high/close-low legs and O/C indicators", async () => {
      // Short 10 units, open @250 (sell high), close @200 (buy back low) → profit.
      // FIFO computes P/L from tradePrice: openProceeds (qty*openRate) − closeCost
      // (qty*closeRate) = 10*250 − 10*200 = +500 (in native units, before ECB).
      const data = buildSpanishWorkbook({
        closedPositions: [
          SPANISH_CLOSED_HEADER,
          ["456", "Tesla (TSLA)", "Short", "2000", "10", "01/02/2025 10:00:00", "15/06/2025 16:00:00",
           "1", "0", "0", "500", "455", "1.09", "1.10", "250", "200", "0", "0", "0", "-", "Acciones", "US88160R1014", ""],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(2);
      const open = result.trades[0]!;
      const close = result.trades[1]!;
      // Opening short leg: SELL + O at the OPEN rate
      expect(open.buySell).toBe("SELL");
      expect(open.openCloseIndicator).toBe("O");
      expect(open.tradePrice).toBe("250");
      expect(open.quantity).toBe("10");
      // Closing leg: BUY + C at the CLOSE (lower) rate
      expect(close.buySell).toBe("BUY");
      expect(close.openCloseIndicator).toBe("C");
      expect(close.tradePrice).toBe("200");
      expect(close.quantity).toBe("-10");
      // openRate (250) > closeRate (200) → engine yields a positive gain
      expect(new Decimal(open.tradePrice).greaterThan(close.tradePrice)).toBe(true);
    });

    it("should build a LOSING short with open-low/close-high legs", async () => {
      // Short 10 units, open @200 (sell low), close @250 (buy back high) → loss.
      const data = buildSpanishWorkbook({
        closedPositions: [
          SPANISH_CLOSED_HEADER,
          ["789", "Tesla (TSLA)", "Short", "2000", "10", "01/02/2025 10:00:00", "15/06/2025 16:00:00",
           "1", "0", "0", "-500", "-455", "1.09", "1.10", "200", "250", "0", "0", "0", "-", "Acciones", "US88160R1014", ""],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(2);
      const open = result.trades[0]!;
      const close = result.trades[1]!;
      expect(open.buySell).toBe("SELL");
      expect(open.openCloseIndicator).toBe("O");
      expect(open.tradePrice).toBe("200");
      expect(close.buySell).toBe("BUY");
      expect(close.openCloseIndicator).toBe("C");
      expect(close.tradePrice).toBe("250");
      // openRate (200) < closeRate (250) → engine yields a loss
      expect(new Decimal(open.tradePrice).lessThan(close.tradePrice)).toBe(true);
    });

    it("should handle parenthesized negative profits like (16.63)", async () => {
      const data = buildSpanishWorkbook({
        closedPositions: [
          SPANISH_CLOSED_HEADER,
          ["789", "ProSieben (PSM.DE)", "Long", "83.11", "7.84", "08/02/2023 15:36:21", "26/08/2025 14:04:10",
           "1", "0", "-0.07", "(16.63)", "(14.29)", "1.07", "1.16", "9.89", "8.07", "0", "0", "0.95", "-", "Acciones", "DE000PSM7770", ""],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(2);
      const sell = result.trades[1]!;
      // Proceeds = amount + profit = 83.11 + (-14.29) = 68.82
      expect(parseFloat(sell.proceeds)).toBeCloseTo(68.82, 2);
      expect(sell.fifoPnlRealized).toBe("-14.29");
    });

    it("should use EUR dividend columns when available", async () => {
      const data = buildSpanishWorkbook({
        closedPositions: [SPANISH_CLOSED_HEADER],
        dividends: [
          SPANISH_DIVIDENDS_HEADER,
          // FechaPago, Instrumento, NetUSD, NetDividends, Currency, Deducción, DedAUD,
          // NetEUR, TasaRet%, RetUSD, RetEUR, ID, Tipo, ISIN
          ["02/01/2025", "Paramount Skydance Corp", "1.08", "0", "", "-", "-",
           "1.0518", "15 %", "0.1906", "0.1856", "123", "Stocks", "US69932A2042"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      const divs = result.cashTransactions.filter((c) => c.type === "Dividends");
      const whts = result.cashTransactions.filter((c) => c.type === "Withholding Tax");

      expect(divs).toHaveLength(1);
      expect(whts).toHaveLength(1);
      expect(divs[0]!.currency).toBe("EUR");
      expect(divs[0]!.isin).toBe("US69932A2042");
      expect(divs[0]!.description).toContain("US");
      // Gross = net / (1 - rate) = 1.0518 / (1 - 0.15) = ~1.2374
      expect(parseFloat(divs[0]!.amount)).toBeCloseTo(1.2374, 3);
      expect(whts[0]!.currency).toBe("EUR");
    });

    it("should handle 0% withholding (UK dividends)", async () => {
      const data = buildSpanishWorkbook({
        closedPositions: [SPANISH_CLOSED_HEADER],
        dividends: [
          SPANISH_DIVIDENDS_HEADER,
          ["21/03/2025", "easyJet", "12.41", "0", "", "-", "-",
           "11.4747", "0 %", "0.0000", "0.0000", "630", "Stocks", "GB00B7KR2P84"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      const divs = result.cashTransactions.filter((c) => c.type === "Dividends");
      const whts = result.cashTransactions.filter((c) => c.type === "Withholding Tax");

      expect(divs).toHaveLength(1);
      expect(whts).toHaveLength(0);
      // 0% WHT → gross = net
      expect(divs[0]!.amount).toBe("11.4747");
    });

    it("should parse interest from Account Activity sheet", async () => {
      const data = buildSpanishWorkbook({
        closedPositions: [SPANISH_CLOSED_HEADER],
        activity: [
          SPANISH_ACTIVITY_HEADER,
          ["01/01/2025 06:01:43", "Pago de intereses", "-", "0.26", "-", "0.26", "7843.61", "0.26", "-", "-", "0"],
          ["01/03/2025 06:01:15", "Pago de intereses", "-", "0.10", "-", "0.10", "7903.58", "60.23", "-", "-", "0"],
          ["02/01/2025 00:19:24", "Dividendo", "PSKY/USD", "1.08", "-", "1.08", "7844.69", "1.34", "123", "Acciones", "0"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      const interest = result.cashTransactions.filter((c) => c.type === "Broker Interest Received");
      expect(interest).toHaveLength(2);
      expect(interest[0]!.amount).toBe("0.26");
      expect(interest[0]!.dateTime).toBe("20250101");
      expect(interest[1]!.amount).toBe("0.1");
    });

    it("should skip non-interest rows in Account Activity", async () => {
      const data = buildSpanishWorkbook({
        closedPositions: [SPANISH_CLOSED_HEADER],
        activity: [
          SPANISH_ACTIVITY_HEADER,
          ["02/01/2025 00:19:24", "Dividendo", "PSKY/USD", "1.08", "-", "1.08", "7844.69", "1.34", "123", "Acciones", "0"],
          ["13/03/2025 15:27:24", "Comisión", "Al abrir", "(1.00)", "-", "0", "7908.06", "1.00", "123", "Acciones", "0"],
          ["13/03/2025 15:27:24", "Posición abierta", "PAH3.DE/EUR", "63.71", "1.54", "0", "7908.06", "1.00", "123", "Acciones", "0"],
        ],
      });

      const result = await parseEtoroXlsx(data);
      const interest = result.cashTransactions.filter((c) => c.type === "Broker Interest Received");
      expect(interest).toHaveLength(0);
    });

    it("should classify CFDs by type or leverage in Spanish format", async () => {
      const data = buildSpanishWorkbook({
        closedPositions: [
          SPANISH_CLOSED_HEADER,
          // CFD by type
          ["111", "Energy Transfer LP", "Long", "500", "100", "01/01/2025", "01/03/2025",
           "1", "0", "0", "50", "45", "1.08", "1.10", "5", "5.5", "0", "0", "0", "-", "CFD", "US29273V1008", ""],
          // CFD by leverage > 1
          ["222", "AAPL Leveraged", "Long", "1000", "5", "01/01/2025", "01/06/2025",
           "5", "0", "0", "200", "180", "1.08", "1.10", "180", "220", "0", "0", "0", "-", "Acciones", "US0378331005", ""],
        ],
      });

      const result = await parseEtoroXlsx(data);
      expect(result.trades).toHaveLength(4);
      expect(result.trades[0]!.assetCategory).toBe("CFD");
      expect(result.trades[2]!.assetCategory).toBe("CFD");
    });
  });
});
