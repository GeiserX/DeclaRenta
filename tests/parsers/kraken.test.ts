import { describe, it, expect } from "vitest";
import { krakenParser } from "../../src/parsers/kraken.js";

// ---------------------------------------------------------------------------
// Fixtures — Trades CSV
// ---------------------------------------------------------------------------

const TRADES_CSV = [
  '"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers"',
  '"TXID1","ORDERID1","XBTEUR","2024-01-15 10:30:00","buy","limit","42000.50","21000.25","5.25","0.5","0.0","","LID1"',
  '"TXID2","ORDERID2","ETHEUR","2024-02-20 14:00:00","sell","market","2800.00","14000.00","3.50","5.0","0.0","","LID2"',
  '"TXID3","ORDERID3","DOTUSD","2024-03-10 09:15:00","buy","limit","7.50","750.00","1.00","100.0","0.0","","LID3"',
].join("\n");

const TRADES_CSV_BOM = "\uFEFF" + TRADES_CSV;

// ---------------------------------------------------------------------------
// Fixtures — Ledgers CSV
// ---------------------------------------------------------------------------

const LEDGERS_CSV = [
  '"txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"',
  '"LID1","REFID1","2024-01-15 10:30:00","trade","","currency","ZEUR","-21005.50","0.00","50000.00"',
  '"LID2","REFID1","2024-01-15 10:30:00","trade","","currency","XXBT","0.5","0.0005","1.5"',
  '"LID3","REFID2","2024-06-01 00:00:00","staking","","currency","XETH","0.025","0.0001","5.025"',
  '"LID4","REFID3","2024-07-15 12:00:00","staking","","currency","DOT","1.5","0.01","100.0"',
].join("\n");

// ---------------------------------------------------------------------------
// Tests — detect()
// ---------------------------------------------------------------------------

describe("krakenParser", () => {
  describe("detect", () => {
    it("should detect Kraken Trades CSV", () => {
      expect(krakenParser.detect(TRADES_CSV)).toBe(true);
    });

    it("should detect Kraken Ledgers CSV", () => {
      expect(krakenParser.detect(LEDGERS_CSV)).toBe(true);
    });

    it("should detect CSV with BOM", () => {
      expect(krakenParser.detect(TRADES_CSV_BOM)).toBe(true);
    });

    it("should not detect Scalable Capital CSV", () => {
      expect(
        krakenParser.detect("date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency"),
      ).toBe(false);
    });

    it("should not detect IBKR XML", () => {
      expect(krakenParser.detect("<FlexQueryResponse>")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Tests — Trades CSV parsing
  // ---------------------------------------------------------------------------

  describe("parse Trades CSV", () => {
    it("should parse a BTC buy trade", () => {
      const result = krakenParser.parse(TRADES_CSV);
      const buy = result.trades.find((t) => t.tradeID === "TXID1");
      expect(buy).toBeDefined();
      expect(buy!.symbol).toBe("BTC");
      expect(buy!.description).toBe("BTC/EUR");
      expect(buy!.buySell).toBe("BUY");
      expect(buy!.quantity).toBe("0.5");
      expect(buy!.tradePrice).toBe("42000.50");
      expect(buy!.tradeMoney).toBe("21000.25");
      expect(buy!.currency).toBe("EUR");
      expect(buy!.assetCategory).toBe("CRYPTO");
      expect(buy!.isin).toBe("");
      expect(buy!.exchange).toBe("KRAKEN");
    });

    it("should parse an ETH sell trade", () => {
      const result = krakenParser.parse(TRADES_CSV);
      const sell = result.trades.find((t) => t.tradeID === "TXID2");
      expect(sell).toBeDefined();
      expect(sell!.symbol).toBe("ETH");
      expect(sell!.buySell).toBe("SELL");
      expect(sell!.quantity).toBe("-5");
      expect(sell!.proceeds).toBe("14000");
      expect(sell!.cost).toBe("0");
      expect(sell!.openCloseIndicator).toBe("C");
    });

    it("should handle pairs without X/Z prefix (DOTUSD)", () => {
      const result = krakenParser.parse(TRADES_CSV);
      const dot = result.trades.find((t) => t.tradeID === "TXID3");
      expect(dot).toBeDefined();
      expect(dot!.symbol).toBe("DOT");
      expect(dot!.currency).toBe("USD");
    });

    it("should convert Kraken datetime to YYYYMMDD", () => {
      const result = krakenParser.parse(TRADES_CSV);
      expect(result.trades[0]!.tradeDate).toBe("20240115");
      expect(result.trades[1]!.tradeDate).toBe("20240220");
      expect(result.trades[2]!.tradeDate).toBe("20240310");
    });

    it("should extract fees as negative commission", () => {
      const result = krakenParser.parse(TRADES_CSV);
      const buy = result.trades.find((t) => t.tradeID === "TXID1");
      expect(buy!.commission).toBe("-5.25");
    });

    it("should set zero commission when fee is zero", () => {
      const csv = [
        '"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers"',
        '"TX0","ORD0","XBTEUR","2024-01-01 00:00:00","buy","limit","40000","4000","0","0.1","0","",""',
      ].join("\n");
      const result = krakenParser.parse(csv);
      expect(result.trades[0]!.commission).toBe("0");
    });

    it("should handle BOM in Trades CSV", () => {
      const result = krakenParser.parse(TRADES_CSV_BOM);
      expect(result.trades.length).toBe(3);
    });

    it("should return empty cashTransactions for Trades CSV", () => {
      const result = krakenParser.parse(TRADES_CSV);
      expect(result.cashTransactions).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Tests — Kraken symbol mapping
  // ---------------------------------------------------------------------------

  describe("symbol mapping", () => {
    it("should map XXBT pair to BTC", () => {
      const csv = [
        '"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers"',
        '"TX1","ORD1","XXBTXETH","2024-01-01 00:00:00","buy","limit","15","150","0.1","10","0","",""',
      ].join("\n");
      const result = krakenParser.parse(csv);
      expect(result.trades[0]!.symbol).toBe("BTC");
    });

    it("should map XBTEUR to BTC/EUR", () => {
      const result = krakenParser.parse(TRADES_CSV);
      const btc = result.trades.find((t) => t.tradeID === "TXID1");
      expect(btc!.symbol).toBe("BTC");
      expect(btc!.currency).toBe("EUR");
    });

    it("should keep unknown short symbols unchanged", () => {
      const csv = [
        '"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers"',
        '"TX1","ORD1","ADAEUR","2024-01-01 00:00:00","buy","limit","0.5","50","0.1","100","0","",""',
      ].join("\n");
      const result = krakenParser.parse(csv);
      expect(result.trades[0]!.symbol).toBe("ADA");
    });
  });

  // ---------------------------------------------------------------------------
  // Tests — Ledgers CSV parsing (staking)
  // ---------------------------------------------------------------------------

  describe("parse Ledgers CSV", () => {
    it("should parse staking rewards as CashTransactions", () => {
      const result = krakenParser.parse(LEDGERS_CSV);
      expect(result.cashTransactions).toHaveLength(2);
    });

    it("should map staking ETH reward correctly", () => {
      const result = krakenParser.parse(LEDGERS_CSV);
      const ethStake = result.cashTransactions.find((t) => t.symbol === "ETH");
      expect(ethStake).toBeDefined();
      expect(ethStake!.type).toBe("Dividends");
      expect(ethStake!.description).toBe("Staking reward - ETH");
      expect(ethStake!.dateTime).toBe("20240601");
      expect(parseFloat(ethStake!.amount)).toBeCloseTo(0.0249, 4);
    });

    it("should map staking DOT reward with clean symbol", () => {
      const result = krakenParser.parse(LEDGERS_CSV);
      const dotStake = result.cashTransactions.find((t) => t.symbol === "DOT");
      expect(dotStake).toBeDefined();
      expect(dotStake!.dateTime).toBe("20240715");
      expect(parseFloat(dotStake!.amount)).toBeCloseTo(1.49, 2);
    });

    it("should ignore non-staking ledger entries", () => {
      const result = krakenParser.parse(LEDGERS_CSV);
      // LID1 and LID2 are type=trade, should be ignored
      const tradeEntries = result.cashTransactions.filter((t) =>
        t.transactionID.includes("LID1") || t.transactionID.includes("LID2"),
      );
      expect(tradeEntries).toHaveLength(0);
    });

    it("should return empty trades for Ledgers CSV", () => {
      const result = krakenParser.parse(LEDGERS_CSV);
      expect(result.trades).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Tests — error handling
  // ---------------------------------------------------------------------------

  describe("error handling", () => {
    it("should throw on empty input", () => {
      expect(() => krakenParser.parse("")).toThrow("vacío");
    });

    it("should throw on unrecognized format", () => {
      expect(() => krakenParser.parse("col1,col2,col3\na,b,c")).toThrow("no reconocido");
    });

    it("should skip rows with empty txid", () => {
      const csv = [
        '"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers"',
        '"","ORDERID1","XBTEUR","2024-01-15 10:30:00","buy","limit","42000","21000","5","0.5","0","",""',
      ].join("\n");
      const result = krakenParser.parse(csv);
      expect(result.trades).toHaveLength(0);
    });
  });
});
