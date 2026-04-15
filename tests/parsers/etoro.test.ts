import { describe, it, expect } from "vitest";
import { etoroParser } from "../../src/parsers/etoro.js";

// ---------------------------------------------------------------------------
// Fixtures (text/CSV mode — XLSX binary tested separately)
// ---------------------------------------------------------------------------

const ETORO_TEXT = [
  "Closed Positions",
  "Action,Amount,Units,Open Rate,Close Rate,Profit(USD),Open Date,Close Date,Type,Leverage,ISIN",
  "Buy AAPL,1000.00,5.5,180.00,195.00,82.50,15/03/2025 09:30:00,20/09/2025 14:00:00,Stocks,1,US0378331005",
  "Buy TSLA,2000.00,10,200.00,180.00,-200.00,01/02/2025 10:00:00,15/06/2025 11:00:00,Stocks,1,US88160R1014",
  "Buy BTC,500.00,0.01,50000.00,55000.00,50.00,01/01/2025 08:00:00,01/03/2025 12:00:00,Crypto,1,",
  "Buy EURUSD,1000.00,1000,1.0800,1.0900,10.00,01/04/2025 09:00:00,01/05/2025 09:00:00,CFD,2,",
].join("\n");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("etoroParser", () => {
  describe("detect", () => {
    it("should detect eToro text with Closed Positions", () => {
      expect(etoroParser.detect(ETORO_TEXT)).toBe(true);
    });

    it("should not detect Degiro CSV", () => {
      expect(
        etoroParser.detect("Fecha,Hora,Producto,ISIN,Centro de referencia,Cantidad,Precio"),
      ).toBe(false);
    });

    it("should not detect random text", () => {
      expect(etoroParser.detect("hello world")).toBe(false);
    });
  });

  describe("text mode parse", () => {
    it("should not crash on text input", () => {
      // Text mode is a fallback — returns empty structure for now
      // Primary path is parseEtoroXlsx for binary XLSX
      const result = etoroParser.parse(ETORO_TEXT);
      expect(result).toBeDefined();
      expect(result.trades).toBeDefined();
      expect(result.cashTransactions).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("should throw on empty input", () => {
      expect(() => etoroParser.parse("")).toThrow("vacío");
    });
  });
});
