import { describe, it, expect } from "vitest";
import { coinbaseParser } from "../../src/parsers/coinbase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HEADER = "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";

const COINBASE_CSV = [
  HEADER,
  '2024-03-15T10:30:00Z,Buy,BTC,0.05,EUR,52000.00,2600.00,2639.00,39.00,Bought 0.05 BTC',
  '2024-06-20T14:00:00Z,Sell,ETH,2.00,EUR,3500.00,7000.00,6930.00,70.00,Sold 2 ETH',
  '2024-08-01T08:00:00Z,Staking Income,ETH,0.01,EUR,3200.00,32.00,32.00,0.00,Staking reward',
  '2024-09-10T12:00:00Z,Send,BTC,0.02,EUR,55000.00,1100.00,1100.00,0.00,Sent to wallet',
  '2024-09-15T09:00:00Z,Receive,BTC,0.03,EUR,54000.00,1620.00,1620.00,0.00,Received from wallet',
  '2024-10-05T16:00:00Z,Convert,BTC,0.10,EUR,60000.00,6000.00,6000.00,50.00,Converted 0.10 BTC to 100 SOL',
  '2024-11-01T07:30:00Z,Learning Reward,GRT,5.00,EUR,0.20,1.00,1.00,0.00,Earned GRT',
  '2024-12-01T20:00:00Z,Rewards Income,ALGO,10.00,EUR,0.15,1.50,1.50,0.00,ALGO rewards',
].join("\n");

const COINBASE_CSV_BOM = "\uFEFF" + COINBASE_CSV;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("coinbaseParser", () => {
  // -------------------------------------------------------------------------
  // Detection
  // -------------------------------------------------------------------------

  describe("detect", () => {
    it("should detect Coinbase CSV by header", () => {
      expect(coinbaseParser.detect(COINBASE_CSV)).toBe(true);
    });

    it("should detect CSV with BOM", () => {
      expect(coinbaseParser.detect(COINBASE_CSV_BOM)).toBe(true);
    });

    it("should not detect IBKR XML", () => {
      expect(coinbaseParser.detect("<FlexQueryResponse>")).toBe(false);
    });

    it("should not detect Scalable Capital CSV", () => {
      expect(
        coinbaseParser.detect("date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency"),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Buy trades
  // -------------------------------------------------------------------------

  describe("parse buy trades", () => {
    it("should parse a Buy transaction", () => {
      const result = coinbaseParser.parse(COINBASE_CSV);
      const buys = result.trades.filter((t) => t.buySell === "BUY" && t.symbol === "BTC" && !t.tradeID.includes("convert"));
      expect(buys).toHaveLength(1);

      const buy = buys[0]!;
      expect(buy.symbol).toBe("BTC");
      expect(buy.assetCategory).toBe("CRYPTO");
      expect(buy.quantity).toBe("0.05");
      expect(buy.tradePrice).toBe("52000.00");
      expect(buy.tradeDate).toBe("20240315");
      expect(buy.commission).toBe("-39");
      expect(buy.cost).toBe("2600.00");
      expect(buy.isin).toBe("");
      expect(buy.exchange).toBe("COINBASE");
    });
  });

  // -------------------------------------------------------------------------
  // Sell trades
  // -------------------------------------------------------------------------

  describe("parse sell trades", () => {
    it("should parse a Sell transaction", () => {
      const result = coinbaseParser.parse(COINBASE_CSV);
      const sells = result.trades.filter((t) => t.buySell === "SELL" && t.symbol === "ETH" && !t.tradeID.includes("convert"));
      expect(sells).toHaveLength(1);

      const sell = sells[0]!;
      expect(sell.symbol).toBe("ETH");
      expect(sell.quantity).toBe("-2");
      expect(sell.tradePrice).toBe("3500.00");
      expect(sell.tradeDate).toBe("20240620");
      expect(sell.commission).toBe("-70");
      expect(sell.proceeds).toBe("7000.00");
      expect(sell.openCloseIndicator).toBe("C");
    });
  });

  // -------------------------------------------------------------------------
  // Income (staking, learning, rewards)
  // -------------------------------------------------------------------------

  describe("parse income transactions", () => {
    it("should parse Staking Income as Dividends cash transaction", () => {
      const result = coinbaseParser.parse(COINBASE_CSV);
      const staking = result.cashTransactions.filter((t) => t.description.includes("staking income"));
      expect(staking).toHaveLength(1);

      const tx = staking[0]!;
      expect(tx.type).toBe("Dividends");
      expect(tx.symbol).toBe("ETH");
      expect(tx.amount).toBe("32.00");
      expect(tx.dateTime).toBe("20240801");
    });

    it("should parse Learning Reward as Dividends cash transaction", () => {
      const result = coinbaseParser.parse(COINBASE_CSV);
      const learning = result.cashTransactions.filter((t) => t.description.includes("learning reward"));
      expect(learning).toHaveLength(1);

      expect(learning[0]!.symbol).toBe("GRT");
      expect(learning[0]!.type).toBe("Dividends");
    });

    it("should parse Rewards Income as Dividends cash transaction", () => {
      const result = coinbaseParser.parse(COINBASE_CSV);
      const rewards = result.cashTransactions.filter((t) => t.description.includes("rewards income"));
      expect(rewards).toHaveLength(1);

      expect(rewards[0]!.symbol).toBe("ALGO");
      expect(rewards[0]!.type).toBe("Dividends");
      expect(rewards[0]!.amount).toBe("1.50");
    });
  });

  // -------------------------------------------------------------------------
  // Convert
  // -------------------------------------------------------------------------

  describe("parse convert transactions", () => {
    it("should create two trades for a Convert (sell source + buy destination)", () => {
      const result = coinbaseParser.parse(COINBASE_CSV);
      const convertTrades = result.trades.filter((t) => t.tradeID.includes("convert"));
      expect(convertTrades).toHaveLength(2);

      const sellSide = convertTrades.find((t) => t.buySell === "SELL")!;
      expect(sellSide.symbol).toBe("BTC");
      expect(sellSide.quantity).toBe("-0.1");
      expect(sellSide.commission).toBe("-50");

      const buySide = convertTrades.find((t) => t.buySell === "BUY")!;
      expect(buySide.symbol).toBe("SOL");
      expect(buySide.quantity).toBe("100");
      expect(buySide.commission).toBe("0");
    });
  });

  // -------------------------------------------------------------------------
  // Skip Send/Receive
  // -------------------------------------------------------------------------

  describe("skip non-taxable transfers", () => {
    it("should skip Send transactions", () => {
      const result = coinbaseParser.parse(COINBASE_CSV);
      const sends = result.trades.filter((t) => t.tradeID.includes("send"));
      expect(sends).toHaveLength(0);
    });

    it("should skip Receive transactions", () => {
      const result = coinbaseParser.parse(COINBASE_CSV);
      const receives = result.trades.filter((t) => t.tradeID.includes("receive"));
      expect(receives).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    it("should handle BOM-prefixed input", () => {
      const result = coinbaseParser.parse(COINBASE_CSV_BOM);
      expect(result.trades.length).toBeGreaterThan(0);
    });

    it("should throw on empty input", () => {
      expect(() => coinbaseParser.parse("")).toThrow("vacio");
    });

    it("should skip rows with unknown transaction types", () => {
      const csv = [
        HEADER,
        '2024-03-15T10:30:00Z,Deposit,EUR,100.00,EUR,1.00,100.00,100.00,0.00,Bank deposit',
      ].join("\n");
      const result = coinbaseParser.parse(csv);
      expect(result.trades).toHaveLength(0);
      expect(result.cashTransactions).toHaveLength(0);
    });

    it("should skip rows with zero quantity on buy/sell", () => {
      const csv = [
        HEADER,
        '2024-03-15T10:30:00Z,Buy,BTC,0,EUR,52000.00,0,0,0,Zero buy',
      ].join("\n");
      const result = coinbaseParser.parse(csv);
      expect(result.trades).toHaveLength(0);
    });
  });

  describe("error handling", () => {
    it("throws on non-Coinbase content", () => {
      expect(() => coinbaseParser.parse("Foo,Bar\ndata1,data2")).toThrow("formato no reconocido");
    });
  });

  // -------------------------------------------------------------------------
  // V2 format (Price Currency / Price at Transaction, with preamble)
  // -------------------------------------------------------------------------

  describe("v2 format", () => {
    const V2_HEADER = "ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";

    const V2_CSV_WITH_PREAMBLE = [
      ",,,,,,,,,,",
      "Transactions,,,,,,,,,,",
      "User,John Doe,abc-123,,,,,,,,",
      V2_HEADER,
      'tx001,2025-01-03 22:35:59 UTC,Convert,BTC,-0.00000189,EUR,€1.21732403,€8.89999,€1.08178,-€0.814036357017,Converted 0.00000189 BTC to 1.5 SOL',
      'tx002,2025-01-04 07:12:27 UTC,Buy,SOL,1.5,EUR,€10.3293,€15.49,€15.99,€0.50,Bought SOL',
    ].join("\n");

    it("should detect v2 format with preamble", () => {
      expect(coinbaseParser.detect(V2_CSV_WITH_PREAMBLE)).toBe(true);
    });

    it("should parse v2 format skipping preamble", () => {
      const result = coinbaseParser.parse(V2_CSV_WITH_PREAMBLE);
      // Convert produces sell + buy, Buy produces 1 trade
      expect(result.trades.length).toBeGreaterThanOrEqual(2);
    });

    it("should handle € currency symbols in values", () => {
      const csv = [
        V2_HEADER,
        'tx001,2025-01-04 07:12:27 UTC,Buy,SOL,1.5,EUR,€10.3293,€15.49,€15.99,€0.50,Bought SOL',
      ].join("\n");
      const result = coinbaseParser.parse(csv);
      expect(result.trades).toHaveLength(1);
      const trade = result.trades[0]!;
      expect(trade.buySell).toBe("BUY");
      expect(trade.symbol).toBe("SOL");
      expect(Number(trade.tradePrice)).toBeCloseTo(10.3293, 2);
    });

    it("should detect v2 header without preamble", () => {
      expect(coinbaseParser.detect(V2_HEADER)).toBe(true);
    });
  });
});
