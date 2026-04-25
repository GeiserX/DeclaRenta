import { describe, it, expect } from "vitest";
import { degiroParser } from "../../src/parsers/degiro.js";

describe("degiroParser - Transactions CSV branches", () => {
  it("should parse 19-col format with Valor local and FX rate", () => {
    const header = "Fecha;Hora;Producto;ISIN;Bolsa de;Centro de ejecución;Número;Precio;EUR;Valor local;EUR;Valor;EUR;Tipo de cambio;Costes de transacción;EUR;Total;EUR;ID Orden";
    const row = "15-01-2025;10:00;APPLE INC;US0378331005;NASDAQ;NASDAQ;10;175.50;USD;-1755.00;USD;-1614.60;EUR;0.92;-1.00;EUR;-1615.60;EUR;abc-123-def";
    const input = `${header}\n${row}`;
    const result = degiroParser.parse(input);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].buySell).toBe("BUY");
  });

  it("should parse sell trade (positive value)", () => {
    const header = "Fecha;Hora;Producto;ISIN;Centro de ejecución;Número;Precio;EUR;Valor;EUR;Costes de transacción;EUR;Total;EUR;ID Orden";
    const row = "15-01-2025;10:00;APPLE INC;US0378331005;NASDAQ;-10;195.00;USD;1950.00;EUR;-1.00;EUR;1949.00;EUR;abc-123";
    const input = `${header}\n${row}`;
    const result = degiroParser.parse(input);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].buySell).toBe("SELL");
  });

  it("should skip rows with zero price", () => {
    const header = "Fecha;Hora;Producto;ISIN;Centro de ejecución;Número;Precio;EUR;Valor;EUR;Costes de transacción;EUR;Total;EUR;ID Orden";
    const row = "15-01-2025;10:00;RIGHTS;US111111;NASDAQ;100;0.0000;EUR;0;EUR;0;EUR;0;EUR;abc-123";
    const input = `${header}\n${row}`;
    const result = degiroParser.parse(input);
    expect(result.trades).toHaveLength(0);
  });

  it("should skip rows with no ISIN", () => {
    const header = "Fecha;Hora;Producto;ISIN;Centro de ejecución;Número;Precio;EUR;Valor;EUR;Costes de transacción;EUR;Total;EUR;ID Orden";
    const row = "15-01-2025;10:00;SOME PRODUCT;;NASDAQ;10;100;EUR;1000;EUR;0;EUR;1000;EUR;";
    const input = `${header}\n${row}`;
    const result = degiroParser.parse(input);
    expect(result.trades).toHaveLength(0);
  });

  it("should handle AutoFX commission column", () => {
    const header = "Fecha;Hora;Producto;ISIN;Centro de ejecución;Número;Precio;EUR;Valor;EUR;Costes de transacción;EUR;Comisión AutoFX;Total;EUR;ID Orden";
    const row = "15-01-2025;10:00;APPLE;US0378331005;NASDAQ;10;175;USD;-1750;EUR;-1.00;EUR;-0.50;-1751.50;EUR;abc-123";
    const input = `${header}\n${row}`;
    const result = degiroParser.parse(input);
    expect(result.trades).toHaveLength(1);
    // Commission should include AutoFX (stored as negative)
    expect(parseFloat(result.trades[0].commission)).toBe(-1.5);
  });

  it("should handle orderId in next column when current is empty", () => {
    const header = "Fecha;Hora;Producto;ISIN;Centro de ejecución;Número;Precio;EUR;Valor;EUR;Costes de transacción;EUR;Total;EUR;ID Orden;";
    const row = "15-01-2025;10:00;APPLE;US0378331005;NASDAQ;10;175;USD;-1750;EUR;-1.00;EUR;-1751;EUR;;abc12345-def";
    const input = `${header}\n${row}`;
    const result = degiroParser.parse(input);
    expect(result.trades).toHaveLength(1);
  });

  it("should handle EUR header with embedded EUR in costs column name", () => {
    const header = "Fecha;Hora;Producto;ISIN;Centro de ejecución;Número;Precio;EUR;Valor;EUR;Costes de transacción y/o externos EUR;Total EUR;ID Orden";
    const row = "15-01-2025;10:00;APPLE;US0378331005;NASDAQ;10;175;EUR;-1750;EUR;-1.00;-1751;abc-123";
    const input = `${header}\n${row}`;
    const result = degiroParser.parse(input);
    expect(result.trades).toHaveLength(1);
  });

  it("should throw on missing required columns", () => {
    const input = "Producto;ISIN\nAPPLE;US0378331005";
    expect(() => degiroParser.parse(input)).toThrow();
  });
});

describe("degiroParser - Account CSV branches", () => {
  it("should parse dividends from account CSV", () => {
    const header = "Fecha;Hora;Producto;ISIN;Descripción;Fecha valor;Tipo de cambio;;Importe;;Saldo;;ID Orden";
    const row = "15-01-2025;10:00;APPLE INC;US0378331005;Dividendo;15-01-2025;0.92;USD;2.50;EUR;1000.00;EUR;";
    const input = `${header}\n${row}`;
    const result = degiroParser.parse(input);
    expect(result.cashTransactions).toHaveLength(1);
    expect(result.cashTransactions[0].type).toBe("Dividends");
  });

  it("should parse withholding tax from account CSV", () => {
    const header = "Fecha;Hora;Producto;ISIN;Descripción;Fecha valor;Tipo de cambio;;Importe;;Saldo;;ID Orden";
    const row = "15-01-2025;10:00;APPLE INC;US0378331005;Retención del dividendo;15-01-2025;0.92;USD;-0.38;EUR;999.62;EUR;";
    const input = `${header}\n${row}`;
    const result = degiroParser.parse(input);
    expect(result.cashTransactions).toHaveLength(1);
    expect(result.cashTransactions[0].type).toBe("Withholding Tax");
  });

  it("should recognize English withholding tax description", () => {
    const header = "Date;Time;Product;ISIN;Description;Value date;FX;;Amount;;Balance;;Order ID";
    const row = "15-01-2025;10:00;APPLE INC;US0378331005;Withholding tax;15-01-2025;0.92;USD;-0.38;EUR;999.62;EUR;";
    const input = `${header}\n${row}`;
    const result = degiroParser.parse(input);
    expect(result.cashTransactions).toHaveLength(1);
    expect(result.cashTransactions[0].type).toBe("Withholding Tax");
  });

  it("should skip non-dividend/withholding rows in account CSV", () => {
    const header = "Fecha;Hora;Producto;ISIN;Descripción;Fecha valor;Tipo de cambio;;Importe;;Saldo;;ID Orden";
    const row = "15-01-2025;10:00;;;"+ "Depósito" +";15-01-2025;;;1000;EUR;1000;EUR;";
    const input = `${header}\n${row}`;
    const result = degiroParser.parse(input);
    expect(result.cashTransactions).toHaveLength(0);
  });

  it("should handle Variación format (new account CSV layout)", () => {
    const header = "Fecha;Hora;Producto;ISIN;Descripción;Fecha valor;Tipo;Variación;;Saldo;;ID Orden";
    const row = "15-01-2025;10:00;APPLE;US0378331005;Dividendo;15-01-2025;;EUR;2.50;EUR;1000;EUR;";
    const input = `${header}\n${row}`;
    const result = degiroParser.parse(input);
    expect(result.cashTransactions).toHaveLength(1);
  });
});

describe("degiroParser - error cases", () => {
  it("should throw on empty input", () => {
    expect(() => degiroParser.parse("")).toThrow("fichero vacío o sin datos");
  });

  it("should throw on unrecognized format", () => {
    expect(() => degiroParser.parse("Random;Header;Row\ndata;data;data")).toThrow("formato no reconocido");
  });
});

describe("degiroParser.detect", () => {
  it("should detect transactions CSV", () => {
    const header = "Fecha;Hora;Producto;ISIN;Centro de ejecución;Número;Precio;EUR";
    expect(degiroParser.detect(header)).toBe(true);
  });

  it("should detect account CSV", () => {
    const header = "Fecha;Hora;Producto;ISIN;Descripción;Fecha valor";
    expect(degiroParser.detect(header)).toBe(true);
  });

  it("should reject non-Degiro input", () => {
    expect(degiroParser.detect("Date,Pair,Side")).toBe(false);
  });
});
