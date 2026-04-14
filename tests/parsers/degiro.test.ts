import { describe, it, expect } from "vitest";
import { degiroParser } from "../../src/parsers/degiro.js";

// ---------------------------------------------------------------------------
// Fixtures: Transactions CSV
// ---------------------------------------------------------------------------

const TRANSACTIONS_CSV_ES = [
  "Fecha,Hora,Producto,ISIN,Centro de referencia,Centro de ejecución,Cantidad,Precio,,Valor,,Costes de transacción y/o terceros,,Total,,ID Orden",
  '15-03-2025,09:15,APPLE INC,US0378331005,NDQ,XNAS,10,"175,50",USD,"-1755,00",USD,"-1,00",USD,"-1756,00",USD,aaa-111',
  '20-09-2025,14:30,APPLE INC,US0378331005,NDQ,XNAS,-10,"195,00",USD,"1950,00",USD,"-1,00",USD,"1949,00",USD,bbb-222',
  '01-06-2025,10:00,VANGUARD FTSE ALL-WORLD,IE00BK5BQT80,XET,XETA,5,"110,25",EUR,"-551,25",EUR,"-2,50",EUR,"-553,75",EUR,ccc-333',
].join("\n");

const TRANSACTIONS_CSV_EN = [
  "Date,Time,Product,ISIN,Reference Exchange,Execution Venue,Quantity,Price,,Value,,Transaction and/or third,,Total,,Order ID",
  "15-03-2025,09:15,APPLE INC,US0378331005,NDQ,XNAS,10,175.50,USD,-1755.00,USD,-1.00,USD,-1756.00,USD,aaa-111",
  "20-09-2025,14:30,APPLE INC,US0378331005,NDQ,XNAS,-10,195.00,USD,1950.00,USD,-1.00,USD,1949.00,USD,bbb-222",
].join("\n");

const TRANSACTIONS_CSV_SEMICOLON = [
  "Fecha;Hora;Producto;ISIN;Centro de referencia;Centro de ejecución;Cantidad;Precio;;Valor;;Costes de transacción y/o terceros;;Total;;ID Orden",
  "15-03-2025;09:15;APPLE INC;US0378331005;NDQ;XNAS;10;175,50;USD;-1755,00;USD;-1,00;USD;-1756,00;USD;aaa-111",
].join("\n");

// ---------------------------------------------------------------------------
// Fixtures: Account CSV
// ---------------------------------------------------------------------------

const ACCOUNT_CSV_ES = [
  "Fecha,Hora,Fecha valor,Producto,ISIN,Descripción,Tipo de cambio,,Importe,,Saldo,,ID Orden",
  '15-05-2025,00:00,15-05-2025,APPLE INC,US0378331005,Dividendo,,USD,"2,50",USD,"500,00",USD,',
  '15-05-2025,00:00,15-05-2025,APPLE INC,US0378331005,Impuesto sobre dividendos,,USD,"-0,38",USD,"499,62",USD,',
].join("\n");

const ACCOUNT_CSV_EN = [
  "Date,Time,Value date,Product,ISIN,Description,FX,,Amount,,Balance,,Order ID",
  "15-05-2025,00:00,15-05-2025,APPLE INC,US0378331005,Dividend,,USD,2.50,USD,500.00,USD,",
  "15-05-2025,00:00,15-05-2025,APPLE INC,US0378331005,Withholding Tax,,USD,-0.38,USD,499.62,USD,",
].join("\n");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("degiroParser", () => {
  describe("detect", () => {
    it("should detect Transactions CSV (Spanish)", () => {
      expect(degiroParser.detect(TRANSACTIONS_CSV_ES)).toBe(true);
    });

    it("should detect Transactions CSV (English)", () => {
      expect(degiroParser.detect(TRANSACTIONS_CSV_EN)).toBe(true);
    });

    it("should detect Account CSV (Spanish)", () => {
      expect(degiroParser.detect(ACCOUNT_CSV_ES)).toBe(true);
    });

    it("should detect Account CSV (English)", () => {
      expect(degiroParser.detect(ACCOUNT_CSV_EN)).toBe(true);
    });

    it("should not detect IBKR XML", () => {
      expect(degiroParser.detect("<FlexQueryResponse>")).toBe(false);
    });

    it("should not detect random text", () => {
      expect(degiroParser.detect("hello world")).toBe(false);
    });
  });

  describe("Transactions CSV", () => {
    it("should parse Spanish transactions with EU number format", () => {
      const result = degiroParser.parse(TRANSACTIONS_CSV_ES);

      expect(result.trades).toHaveLength(3);

      const buy = result.trades[0]!;
      expect(buy.isin).toBe("US0378331005");
      expect(buy.symbol).toBe("APPLE INC");
      expect(buy.buySell).toBe("BUY");
      expect(buy.quantity).toBe("10");
      expect(buy.tradePrice).toBe("175.50");
      expect(buy.currency).toBe("USD");
      expect(buy.tradeDate).toBe("20250315");
      expect(buy.commission).toBe("-1.00");

      const sell = result.trades[1]!;
      expect(sell.buySell).toBe("SELL");
      expect(sell.quantity).toBe("-10");
      expect(sell.tradePrice).toBe("195.00");

      const eurTrade = result.trades[2]!;
      expect(eurTrade.isin).toBe("IE00BK5BQT80");
      expect(eurTrade.currency).toBe("EUR");
      expect(eurTrade.quantity).toBe("5");
    });

    it("should parse English transactions with dot decimal format", () => {
      const result = degiroParser.parse(TRANSACTIONS_CSV_EN);

      expect(result.trades).toHaveLength(2);

      const buy = result.trades[0]!;
      expect(buy.tradePrice).toBe("175.50");
      expect(buy.buySell).toBe("BUY");

      const sell = result.trades[1]!;
      expect(sell.tradePrice).toBe("195.00");
      expect(sell.buySell).toBe("SELL");
    });

    it("should handle semicolon-delimited CSV", () => {
      const result = degiroParser.parse(TRANSACTIONS_CSV_SEMICOLON);

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0]!.tradePrice).toBe("175.50");
      expect(result.trades[0]!.currency).toBe("USD");
    });

    it("should convert DD-MM-YYYY dates to YYYYMMDD", () => {
      const result = degiroParser.parse(TRANSACTIONS_CSV_EN);
      expect(result.trades[0]!.tradeDate).toBe("20250315");
      expect(result.trades[1]!.tradeDate).toBe("20250920");
    });

    it("should return empty cashTransactions and corporateActions", () => {
      const result = degiroParser.parse(TRANSACTIONS_CSV_ES);
      expect(result.cashTransactions).toHaveLength(0);
      expect(result.corporateActions).toHaveLength(0);
    });

    it("should skip rows with empty ISIN or zero quantity", () => {
      const csv = [
        "Date,Time,Product,ISIN,Reference Exchange,Execution Venue,Quantity,Price,,Value,,Transaction and/or third,,Total,,Order ID",
        "15-03-2025,09:15,DEPOSIT,,,,,0,,0,,,,,",
        "15-03-2025,09:15,APPLE INC,US0378331005,NDQ,XNAS,10,175.50,USD,-1755.00,USD,-1.00,USD,-1756.00,USD,aaa",
      ].join("\n");

      const result = degiroParser.parse(csv);
      expect(result.trades).toHaveLength(1);
    });
  });

  describe("Account CSV", () => {
    it("should parse dividends from Spanish Account CSV", () => {
      const result = degiroParser.parse(ACCOUNT_CSV_ES);

      expect(result.cashTransactions).toHaveLength(2);

      const dividend = result.cashTransactions[0]!;
      expect(dividend.type).toBe("Dividends");
      expect(dividend.amount).toBe("2.50");
      expect(dividend.isin).toBe("US0378331005");
      expect(dividend.currency).toBe("USD");
      expect(dividend.dateTime).toBe("20250515");

      const withholding = result.cashTransactions[1]!;
      expect(withholding.type).toBe("Withholding Tax");
      expect(withholding.amount).toBe("-0.38");
    });

    it("should parse dividends from English Account CSV", () => {
      const result = degiroParser.parse(ACCOUNT_CSV_EN);

      expect(result.cashTransactions).toHaveLength(2);
      expect(result.cashTransactions[0]!.type).toBe("Dividends");
      expect(result.cashTransactions[0]!.amount).toBe("2.50");
      expect(result.cashTransactions[1]!.type).toBe("Withholding Tax");
    });

    it("should return empty trades from Account CSV", () => {
      const result = degiroParser.parse(ACCOUNT_CSV_ES);
      expect(result.trades).toHaveLength(0);
    });

    it("should skip non-dividend rows in Account CSV", () => {
      const csv = [
        "Date,Time,Value date,Product,ISIN,Description,FX,,Amount,,Balance,,Order ID",
        "01-03-2025,00:00,01-03-2025,,,Deposit,,EUR,1000.00,EUR,1000.00,EUR,",
        "15-05-2025,00:00,15-05-2025,APPLE INC,US0378331005,Dividend,,USD,2.50,USD,500.00,USD,",
        "20-06-2025,00:00,20-06-2025,,,flatex Interest,,EUR,0.10,EUR,500.10,EUR,",
      ].join("\n");

      const result = degiroParser.parse(csv);
      expect(result.cashTransactions).toHaveLength(1);
      expect(result.cashTransactions[0]!.type).toBe("Dividends");
    });
  });

  describe("error handling", () => {
    it("should throw on empty input", () => {
      expect(() => degiroParser.parse("")).toThrow("vacío");
    });

    it("should throw on unrecognized CSV format", () => {
      expect(() => degiroParser.parse("Col1,Col2,Col3\na,b,c")).toThrow("no reconocido");
    });
  });
});
