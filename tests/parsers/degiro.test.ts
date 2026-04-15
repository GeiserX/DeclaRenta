import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
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

  describe("real Degiro Account export (12-column format)", () => {
    const realCsv = readFileSync(new URL("../fixtures/degiro-account-real.csv", import.meta.url), "utf-8");

    it("should detect the real Account CSV", () => {
      expect(degiroParser.detect(realCsv)).toBe(true);
    });

    it("should parse dividends and retenciones", () => {
      const result = degiroParser.parse(realCsv);
      // 4 dividends + 4 retenciones = 8, skip cash sweep + STT + deposit
      const dividends = result.cashTransactions.filter((t) => t.type === "Dividends");
      const withholdings = result.cashTransactions.filter((t) => t.type === "Withholding Tax");
      expect(dividends.length).toBe(4);
      expect(withholdings.length).toBe(4);
    });

    it("should parse EUR dividend correctly", () => {
      const result = degiroParser.parse(realCsv);
      const mapfreDividend = result.cashTransactions.find(
        (t) => t.isin === "ES0124244E34" && t.type === "Dividends",
      )!;
      expect(mapfreDividend).toBeDefined();
      expect(mapfreDividend.amount).toBe("62.38");
      expect(mapfreDividend.currency).toBe("EUR");
      expect(mapfreDividend.symbol).toBe("MAPFRE");
    });

    it("should parse USD dividend with withholding", () => {
      const result = degiroParser.parse(realCsv);
      const tsmcDiv = result.cashTransactions.find(
        (t) => t.isin === "US8740391003" && t.type === "Dividends",
      )!;
      const tsmcWht = result.cashTransactions.find(
        (t) => t.isin === "US8740391003" && t.type === "Withholding Tax",
      )!;
      expect(tsmcDiv.amount).toBe("2.42");
      expect(tsmcDiv.currency).toBe("USD");
      expect(tsmcWht.amount).toBe("-0.51");
      expect(tsmcWht.currency).toBe("USD");
    });

    it("should skip Spanish Transaction Tax and non-dividend rows", () => {
      const result = degiroParser.parse(realCsv);
      // STT, deposit, and cash sweep should NOT appear
      const all = result.cashTransactions;
      expect(all.every((t) => t.type === "Dividends" || t.type === "Withholding Tax")).toBe(true);
    });

    it("should return empty trades from Account CSV", () => {
      const result = degiroParser.parse(realCsv);
      expect(result.trades).toHaveLength(0);
    });
  });

  describe("Account CSV — new format with Variación column", () => {
    it("should parse new-format Account CSV with Variación header", () => {
      // Real format: "Tipo,Variación,,Saldo,," — Variación col has currency, next col has amount
      const csv = [
        "Fecha,Hora,Fecha valor,Producto,ISIN,Descripción,Tipo,Variación,,Saldo,,ID Orden",
        "15-05-2025,00:00,15-05-2025,APPLE INC,US0378331005,Dividendo,,USD,2.50,USD,500.00,",
        "15-05-2025,00:00,15-05-2025,APPLE INC,US0378331005,Retención del dividendo,,USD,-0.38,USD,499.62,",
      ].join("\n");

      const result = degiroParser.parse(csv);
      const divs = result.cashTransactions.filter((t) => t.type === "Dividends");
      const whts = result.cashTransactions.filter((t) => t.type === "Withholding Tax");
      expect(divs).toHaveLength(1);
      expect(divs[0]!.amount).toBe("2.50");
      expect(whts).toHaveLength(1);
      expect(whts[0]!.amount).toBe("-0.38");
    });
  });

  describe("Account CSV — Dutch language", () => {
    it("should detect and parse Dutch Account CSV", () => {
      const csv = [
        "Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,Wisselkoers,,Mutatie,,Saldo,,Order ID",
        "15-05-2025,00:00,15-05-2025,APPLE INC,US0378331005,Dividend,,USD,2.50,USD,500.00,USD,",
      ].join("\n");

      expect(degiroParser.detect(csv)).toBe(true);
      const result = degiroParser.parse(csv);
      expect(result.cashTransactions).toHaveLength(1);
      expect(result.cashTransactions[0]!.type).toBe("Dividends");
    });
  });

  describe("Account CSV — German language", () => {
    it("should detect and parse German Account CSV", () => {
      const csv = [
        "Datum,Uhrzeit,Wertdatum,Produkt,ISIN,Beschreibung,Währung,,Änderung,,Kontostand,,Auftrags-ID",
        "15-05-2025,00:00,15-05-2025,APPLE INC,US0378331005,Dividend,,USD,2.50,USD,500.00,USD,",
      ].join("\n");

      expect(degiroParser.detect(csv)).toBe(true);
      const result = degiroParser.parse(csv);
      expect(result.cashTransactions).toHaveLength(1);
    });
  });

  describe("Transactions CSV — edge cases", () => {
    it("should handle BOM in CSV", () => {
      const csv = "\uFEFF" + TRANSACTIONS_CSV_EN;
      const result = degiroParser.parse(csv);
      expect(result.trades).toHaveLength(2);
    });

    it("should detect semicolon-delimited CSV", () => {
      expect(degiroParser.detect(TRANSACTIONS_CSV_SEMICOLON)).toBe(true);
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

  describe("real Degiro Transactions export (19-column format)", () => {
    const realCsv = readFileSync(new URL("../fixtures/degiro-transactions-real.csv", import.meta.url), "utf-8");

    it("should detect the real Degiro CSV", () => {
      expect(degiroParser.detect(realCsv)).toBe(true);
    });

    it("should parse trades from the real export", () => {
      const result = degiroParser.parse(realCsv);
      // 13 data rows minus 1 zero-price rights assignment = 12 trades
      expect(result.trades.length).toBe(12);
    });

    it("should parse USD buy with FX rate correctly", () => {
      const result = degiroParser.parse(realCsv);
      const nuscaleBuy = result.trades.find(
        (t) => t.isin === "US67079K1007" && t.buySell === "BUY" && t.quantity === "1",
      )!;
      expect(nuscaleBuy).toBeDefined();
      expect(nuscaleBuy.symbol).toBe("NUSCALE POWER CORP");
      expect(nuscaleBuy.tradePrice).toBe("22.2000");
      expect(nuscaleBuy.currency).toBe("USD");
      expect(nuscaleBuy.tradeDate).toBe("20241108");
      expect(nuscaleBuy.fxRateToBase).toBe("1.0702");
      expect(nuscaleBuy.tradeMoney).toBe("-22.20");
    });

    it("should parse USD sell with negative quantity", () => {
      const result = degiroParser.parse(realCsv);
      const nuscaleSell = result.trades.find(
        (t) => t.isin === "US67079K1007" && t.buySell === "SELL" && t.quantity === "-58",
      )!;
      expect(nuscaleSell).toBeDefined();
      expect(nuscaleSell.tradePrice).toBe("9.1000");
      expect(nuscaleSell.fxRateToBase).toBe("1.1094");
      expect(nuscaleSell.tradeMoney).toBe("527.80");
    });

    it("should default FX rate to 1 for EUR trades", () => {
      const result = degiroParser.parse(realCsv);
      const eurTrade = result.trades.find((t) => t.currency === "EUR")!;
      expect(eurTrade).toBeDefined();
      expect(eurTrade.fxRateToBase).toBe("1");
    });

    it("should skip zero-price rights assignments", () => {
      const result = degiroParser.parse(realCsv);
      const rights = result.trades.find((t) => t.symbol.includes("RTS"));
      expect(rights).toBeUndefined();
    });

    it("should parse commission correctly", () => {
      const result = degiroParser.parse(realCsv);
      // NUSCALE 7-share buy has -2.00 commission
      const withComm = result.trades.find(
        (t) => t.isin === "US67079K1007" && t.quantity === "7",
      )!;
      expect(withComm.commission).toBe("-2.00");
      // NUSCALE 1-share buy has no commission (empty field)
      const noComm = result.trades.find(
        (t) => t.isin === "US67079K1007" && t.quantity === "1",
      )!;
      expect(noComm.commission).toBe("0");
    });
  });
});
