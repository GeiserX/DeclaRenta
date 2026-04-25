import { describe, it, expect } from "vitest";
import { krakenParser } from "../../src/parsers/kraken.js";

describe("krakenParser - Ledgers CSV", () => {
  it("should parse staking rewards from ledgers", () => {
    const input = [
      '"txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"',
      '"L001","R001","2025-01-15 10:00:00","staking","","currency","XETH","0.01","0.0001","1.01"',
    ].join("\n");
    const result = krakenParser.parse(input);
    expect(result.cashTransactions).toHaveLength(1);
    expect(result.cashTransactions[0].symbol).toBe("ETH");
    expect(result.cashTransactions[0].type).toBe("Dividends");
  });

  it("should skip non-staking ledger entries", () => {
    const input = [
      '"txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"',
      '"L001","R001","2025-01-15 10:00:00","deposit","","currency","ZEUR","1000","0","1000"',
      '"L002","R002","2025-01-16 10:00:00","withdrawal","","currency","ZEUR","-500","1","499"',
      '"L003","R003","2025-01-17 10:00:00","trade","","currency","XXBT","0.01","0","0.01"',
    ].join("\n");
    const result = krakenParser.parse(input);
    expect(result.cashTransactions).toHaveLength(0);
  });

  it("should skip rows with empty txid", () => {
    const input = [
      '"txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"',
      '"","R001","2025-01-15 10:00:00","staking","","currency","XETH","0.01","0","1"',
    ].join("\n");
    const result = krakenParser.parse(input);
    expect(result.cashTransactions).toHaveLength(0);
  });

  it("should throw on missing required columns", () => {
    const input = [
      '"txid","refid","aclass"',
      '"L001","R001","currency"',
    ].join("\n");
    expect(() => krakenParser.parse(input)).toThrow("faltan columnas obligatorias");
  });
});

describe("krakenParser - Trades CSV", () => {
  it("should throw on missing required trade columns", () => {
    const input = [
      '"txid","ordertxid","pair"',
      '"T001","O001","XXBTEUR"',
    ].join("\n");
    expect(() => krakenParser.parse(input)).toThrow("faltan columnas obligatorias");
  });

  it("should skip rows with empty txid", () => {
    const input = [
      '"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers","trade_id"',
      '"","O001","XXBTEUR","2025-01-15 10:00:00","buy","limit","40000","400","1","0.01","0","","","T001"',
    ].join("\n");
    const result = krakenParser.parse(input);
    expect(result.trades).toHaveLength(0);
  });

  it("should handle XXBT pair (BTC)", () => {
    const input = [
      '"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers","trade_id"',
      '"T001","O001","XXBTZEUR","2025-01-15 10:00:00","buy","limit","40000","400","1","0.01","0","","","T001"',
    ].join("\n");
    const result = krakenParser.parse(input);
    expect(result.trades[0].symbol).toBe("BTC");
    expect(result.trades[0].currency).toBe("EUR");
  });

  it("should handle plain pairs like DOTUSD", () => {
    const input = [
      '"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers","trade_id"',
      '"T001","O001","DOTUSD","2025-01-15 10:00:00","sell","market","7.5","75","0.5","10","0","","","T001"',
    ].join("\n");
    const result = krakenParser.parse(input);
    expect(result.trades[0].symbol).toBe("DOT");
    expect(result.trades[0].currency).toBe("USD");
    expect(result.trades[0].buySell).toBe("SELL");
  });

  it("should handle pair with XETH quote", () => {
    const input = [
      '"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers","trade_id"',
      '"T001","O001","XXRPXETH","2025-01-15 10:00:00","buy","limit","0.0003","0.003","0","10","0","","","T001"',
    ].join("\n");
    const result = krakenParser.parse(input);
    expect(result.trades[0].symbol).toBe("XRP");
    expect(result.trades[0].currency).toBe("ETH");
  });

  it("should handle short pair fallback", () => {
    const input = [
      '"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers","trade_id"',
      '"T001","O001","ABCDEF","2025-01-15 10:00:00","buy","limit","100","100","0","1","0","","","T001"',
    ].join("\n");
    const result = krakenParser.parse(input);
    // 6-char pair, last 3 = DEF, first 3 = ABC
    expect(result.trades[0].symbol).toBe("ABC");
    expect(result.trades[0].currency).toBe("DEF");
  });

  it("should handle very short pair", () => {
    const input = [
      '"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers","trade_id"',
      '"T001","O001","AB","2025-01-15 10:00:00","buy","limit","100","100","0","1","0","","","T001"',
    ].join("\n");
    const result = krakenParser.parse(input);
    // Very short pair, fallback: symbol=AB, currency=EUR
    expect(result.trades[0].symbol).toBe("AB");
    expect(result.trades[0].currency).toBe("EUR");
  });

  it("should use semicolon delimiter when present", () => {
    const input = [
      '"txid";"ordertxid";"pair";"time";"type";"ordertype";"price";"cost";"fee";"vol"',
      '"T001";"O001";"XXBTEUR";"2025-01-15 10:00:00";"buy";"limit";"40000";"400";"1";"0.01"',
    ].join("\n");
    const result = krakenParser.parse(input);
    expect(result.trades).toHaveLength(1);
  });
});

describe("krakenParser - error cases", () => {
  it("should throw on empty input", () => {
    expect(() => krakenParser.parse("")).toThrow("fichero vacío o sin datos");
  });

  it("should throw on unrecognized format", () => {
    expect(() => krakenParser.parse("Date,Pair,Side\ndata,pair,buy")).toThrow("formato no reconocido");
  });
});

describe("krakenParser.detect", () => {
  it("should detect trades CSV", () => {
    expect(krakenParser.detect('"txid","ordertxid","pair","time"\n')).toBe(true);
  });

  it("should detect ledgers CSV", () => {
    expect(krakenParser.detect('"txid","refid","time","type","subtype","aclass"\n')).toBe(true);
  });

  it("should reject non-Kraken input", () => {
    expect(krakenParser.detect("Date,Pair,Side\n")).toBe(false);
  });
});
