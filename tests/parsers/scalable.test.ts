import { describe, it, expect } from "vitest";
import { scalableParser } from "../../src/parsers/scalable.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCALABLE_CSV = [
  "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency",
  '2025-03-15;09:15;Executed;REF001;Vanguard FTSE All-World;Security;Buy;IE00BK5BQT80;10;110,25;-1102,50;-0,99;0;EUR',
  '2025-06-20;14:30;Executed;REF002;Vanguard FTSE All-World;Security;Sell;IE00BK5BQT80;-5;120,00;600,00;-0,99;0;EUR',
  '2025-01-15;10:00;Executed;REF003;Vanguard FTSE All-World;Security;Savings plan;IE00BK5BQT80;2;105,00;-210,00;0;0;EUR',
  '2025-09-01;08:00;Cancelled;REF004;iShares Core MSCI World;Security;Buy;IE00B4L5Y983;5;80,00;-400,00;-1,50;0;EUR',
  '2025-07-15;00:00;Executed;REF005;Vanguard FTSE All-World;Security;Distribution;IE00BK5BQT80;0;0;15,50;0;-2,33;EUR',
].join("\n");

const SCALABLE_CSV_BOM = "\uFEFF" + SCALABLE_CSV;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scalableParser", () => {
  describe("detect", () => {
    it("should detect Scalable Capital CSV", () => {
      expect(scalableParser.detect(SCALABLE_CSV)).toBe(true);
    });

    it("should detect CSV with BOM", () => {
      expect(scalableParser.detect(SCALABLE_CSV_BOM)).toBe(true);
    });

    it("should not detect IBKR XML", () => {
      expect(scalableParser.detect("<FlexQueryResponse>")).toBe(false);
    });

    it("should not detect Degiro CSV", () => {
      expect(
        scalableParser.detect("Fecha,Hora,Producto,ISIN,Centro de referencia,Centro de ejecución,Cantidad,Precio"),
      ).toBe(false);
    });
  });

  describe("parse trades", () => {
    it("should parse buy orders", () => {
      const result = scalableParser.parse(SCALABLE_CSV);
      const buys = result.trades.filter((t) => t.buySell === "BUY");
      // REF001 (Buy) + REF003 (Savings plan) = 2 buys, REF004 cancelled
      expect(buys).toHaveLength(2);

      const buy1 = buys[0]!;
      expect(buy1.isin).toBe("IE00BK5BQT80");
      expect(buy1.quantity).toBe("10");
      expect(buy1.tradePrice).toBe("110.25");
      expect(buy1.currency).toBe("EUR");
      expect(buy1.tradeDate).toBe("20250315");
    });

    it("should parse sell orders", () => {
      const result = scalableParser.parse(SCALABLE_CSV);
      const sells = result.trades.filter((t) => t.buySell === "SELL");
      expect(sells).toHaveLength(1);

      const sell = sells[0]!;
      expect(sell.quantity).toBe("-5");
      expect(sell.tradePrice).toBe("120.00");
      expect(sell.tradeDate).toBe("20250620");
    });

    it("should treat savings plans as buys", () => {
      const result = scalableParser.parse(SCALABLE_CSV);
      const savingsPlan = result.trades.find((t) => t.tradeID === "REF003");
      expect(savingsPlan).toBeDefined();
      expect(savingsPlan!.buySell).toBe("BUY");
      expect(savingsPlan!.quantity).toBe("2");
    });

    it("should skip cancelled orders", () => {
      const result = scalableParser.parse(SCALABLE_CSV);
      const cancelled = result.trades.find((t) => t.tradeID === "REF004");
      expect(cancelled).toBeUndefined();
    });

    it("should parse commission correctly", () => {
      const result = scalableParser.parse(SCALABLE_CSV);
      const buy = result.trades[0]!;
      expect(buy.commission).toBe("-0.99");
    });

    it("should convert YYYY-MM-DD dates to YYYYMMDD", () => {
      const result = scalableParser.parse(SCALABLE_CSV);
      expect(result.trades[0]!.tradeDate).toBe("20250315");
      expect(result.trades[1]!.tradeDate).toBe("20250620");
    });
  });

  describe("parse distributions", () => {
    it("should parse distributions as dividends", () => {
      const result = scalableParser.parse(SCALABLE_CSV);
      const divs = result.cashTransactions.filter((t) => t.type === "Dividends");
      expect(divs).toHaveLength(1);
      expect(divs[0]!.amount).toBe("15.50");
      expect(divs[0]!.isin).toBe("IE00BK5BQT80");
    });

    it("should extract withholding tax from distributions", () => {
      const result = scalableParser.parse(SCALABLE_CSV);
      const wht = result.cashTransactions.filter((t) => t.type === "Withholding Tax");
      expect(wht).toHaveLength(1);
      expect(wht[0]!.amount).toBe("-2.33");
    });
  });

  describe("parse with BOM", () => {
    it("should handle UTF-8 BOM", () => {
      const result = scalableParser.parse(SCALABLE_CSV_BOM);
      expect(result.trades.length).toBeGreaterThan(0);
    });
  });

  describe("German status localization", () => {
    it("should accept 'Ausgeführt' status", () => {
      const csv = [
        "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency",
        "2025-03-15;09:15;Ausgeführt;REF001;iShares;Security;Buy;IE00B4L5Y983;10;80,00;-800,00;-1,50;0;EUR",
      ].join("\n");
      const result = scalableParser.parse(csv);
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0]!.buySell).toBe("BUY");
    });
  });

  describe("Spanish status localization", () => {
    it("should accept 'Ejecutada' status", () => {
      const csv = [
        "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency",
        "2025-03-15;09:15;Ejecutada;REF001;Vanguard;Security;Sell;IE00BK5BQT80;-5;120,00;600,00;-0,99;0;EUR",
      ].join("\n");
      const result = scalableParser.parse(csv);
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0]!.buySell).toBe("SELL");
    });
  });

  describe("edge cases", () => {
    it("should skip rows with no ISIN", () => {
      const csv = [
        "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency",
        "2025-03-15;09:15;Executed;REF001;Cash deposit;Cash;Deposit;;0;0;500,00;0;0;EUR",
      ].join("\n");
      const result = scalableParser.parse(csv);
      expect(result.trades).toHaveLength(0);
      expect(result.cashTransactions).toHaveLength(0);
    });

    it("should skip rows with zero shares for trades", () => {
      const csv = [
        "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency",
        "2025-03-15;09:15;Executed;REF001;Test;Security;Buy;IE00BK5BQT80;0;100,00;0;0;0;EUR",
      ].join("\n");
      const result = scalableParser.parse(csv);
      expect(result.trades).toHaveLength(0);
    });

    it("should skip unrecognized trade types", () => {
      const csv = [
        "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency",
        "2025-03-15;09:15;Executed;REF001;Test;Security;Transfer;IE00BK5BQT80;5;100,00;-500;0;0;EUR",
      ].join("\n");
      const result = scalableParser.parse(csv);
      expect(result.trades).toHaveLength(0);
    });

    it("should handle distribution with no withholding tax", () => {
      const csv = [
        "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency",
        "2025-07-15;00:00;Executed;REF005;Vanguard;Security;Distribution;IE00BK5BQT80;0;0;15,50;0;0;EUR",
      ].join("\n");
      const result = scalableParser.parse(csv);
      const divs = result.cashTransactions.filter((t) => t.type === "Dividends");
      const whts = result.cashTransactions.filter((t) => t.type === "Withholding Tax");
      expect(divs).toHaveLength(1);
      expect(whts).toHaveLength(0);
    });

    it("should handle rows with empty status (treated as executed)", () => {
      const csv = [
        "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency",
        "2025-03-15;09:15;;REF001;Test;Security;Buy;IE00BK5BQT80;5;100,00;-500;0;0;EUR",
      ].join("\n");
      const result = scalableParser.parse(csv);
      expect(result.trades).toHaveLength(1);
    });

    it("should handle comma-delimited CSV", () => {
      const csv = [
        "date,time,status,reference,description,assetType,type,isin,shares,price,amount,fee,tax,currency",
        "2025-03-15,09:15,Executed,REF001,iShares,Security,Buy,IE00B4L5Y983,10,80.00,-800.00,-1.50,0,EUR",
      ].join("\n");
      const result = scalableParser.parse(csv);
      expect(result.trades).toHaveLength(1);
    });
  });

  describe("error handling", () => {
    it("should throw on empty input", () => {
      expect(() => scalableParser.parse("")).toThrow("vacío");
    });

    it("should return empty for no executed trades", () => {
      const csv = [
        "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency",
        "2025-01-01;10:00;Cancelled;REF001;Test;Security;Buy;IE00BK5BQT80;5;100;-500;0;0;EUR",
      ].join("\n");
      const result = scalableParser.parse(csv);
      expect(result.trades).toHaveLength(0);
    });

    it("throws on non-Scalable content", () => {
      expect(() => scalableParser.parse("Foo;Bar\ndata1;data2")).toThrow("formato no reconocido");
    });
  });
});
