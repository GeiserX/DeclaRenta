import { describe, it, expect } from "vitest";
import { coinbaseParser } from "../../src/parsers/coinbase.js";
import { localizeMessage, localizeHint, setLocale } from "../../src/i18n/index.js";

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
    it("should parse Staking Income as ahorro crypto reward income (not a dividend)", () => {
      const result = coinbaseParser.parse(COINBASE_CSV);
      const staking = result.cashTransactions.filter((t) => t.description.includes("staking income"));
      expect(staking).toHaveLength(1);

      const tx = staking[0]!;
      // Staking = rendimiento del capital mobiliario (savings base, Casilla 0027).
      expect(tx.type).toBe("Crypto Reward Income");
      expect(tx.taxBucket).toBe("ahorro");
      expect(tx.symbol).toBe("ETH");
      expect(tx.currency).toBe("EUR"); // fiat spot value resolves via ECB
      expect(tx.amount).toBe("32.00");
      expect(tx.rewardCostBasisEur).toBe("32"); // fiat spot value = EUR cost basis
      expect(tx.dateTime).toBe("20240801");
    });

    it("should parse Learning Reward as base-general crypto reward income (airdrop-like)", () => {
      const result = coinbaseParser.parse(COINBASE_CSV);
      const learning = result.cashTransactions.filter((t) => t.description.includes("learning reward"));
      expect(learning).toHaveLength(1);

      expect(learning[0]!.symbol).toBe("GRT");
      expect(learning[0]!.type).toBe("Crypto Reward Income");
      // Coinbase Earn = free crypto for lessons → ganancia no derivada de
      // transmisión (base general, Casilla 0304), not savings.
      expect(learning[0]!.taxBucket).toBe("general");
    });

    it("should parse Rewards Income as ahorro crypto reward income (not a dividend)", () => {
      const result = coinbaseParser.parse(COINBASE_CSV);
      const rewards = result.cashTransactions.filter((t) => t.description.includes("rewards income"));
      expect(rewards).toHaveLength(1);

      expect(rewards[0]!.symbol).toBe("ALGO");
      expect(rewards[0]!.type).toBe("Crypto Reward Income");
      expect(rewards[0]!.taxBucket).toBe("ahorro");
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
      expect(() => coinbaseParser.parse("")).toThrow("vacío");
    });

    it("should skip rows with unknown transaction types", () => {
      const csv = [
        HEADER,
        '2024-03-15T10:30:00Z,Deposit,EUR,100.00,EUR,1.00,100.00,100.00,0.00,Bank deposit',
      ].join("\n");
      const result = coinbaseParser.parse(csv);
      expect(result.trades).toHaveLength(0);
      expect(result.cashTransactions).toHaveLength(0);
      // A fiat deposit is a known non-taxable transfer: skipped without a warning.
      expect(result.parserMessages).toBeUndefined();
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

  // -------------------------------------------------------------------------
  // Advanced Trade, extra reward labels and unrecognised types
  // -------------------------------------------------------------------------

  describe("Advanced Trade and other transaction types", () => {
    const V2_HEADER = "ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";

    it("parses Advanced Trade Buy and Sell as trades", () => {
      const csv = [
        V2_HEADER,
        'at1,2025-02-01 10:00:00 UTC,Advanced Trade Buy,BTC,0.5,EUR,€40000,€20000.00,€20050.00,€50.00,"Bought 0.5 BTC for 20050 EUR on BTC-EUR at 40,000.00 EUR/BTC"',
        'at2,2025-06-01 10:00:00 UTC,Advanced Trade Sell,BTC,-0.5,EUR,€60000,€30000.00,€29925.00,€75.00,"Sold 0.5 BTC for 29925 EUR on BTC-EUR at 60,000.00 EUR/BTC"',
      ].join("\n");
      const result = coinbaseParser.parse(csv);
      expect(result.trades).toHaveLength(2);

      const buy = result.trades.find((t) => t.buySell === "BUY")!;
      expect(buy.symbol).toBe("BTC");
      expect(buy.quantity).toBe("0.5");
      expect(buy.cost).toBe("20000.00");
      expect(buy.commission).toBe("-50");
      expect(buy.currency).toBe("EUR");

      const sell = result.trades.find((t) => t.buySell === "SELL")!;
      expect(sell.symbol).toBe("BTC");
      expect(sell.quantity).toBe("-0.5");
      expect(sell.proceeds).toBe("30000.00");
      expect(sell.commission).toBe("-75");

      expect(result.parserMessages).toBeUndefined();
    });

    it("parses the 'Advance Trade' spelling Coinbase used in some exports", () => {
      const csv = [
        V2_HEADER,
        'at1,2025-02-01 10:00:00 UTC,Advance Trade Buy,ETH,2,EUR,€3000,€6000.00,€6012.00,€12.00,Bought 2 ETH for 6012 EUR on ETH-EUR at 3000 EUR/ETH',
        'at2,2025-03-01 10:00:00 UTC,Advance Trade Sell,ETH,-1,EUR,€3500,€3500.00,€3493.00,€7.00,Sold 1 ETH for 3493 EUR on ETH-EUR at 3500 EUR/ETH',
      ].join("\n");
      const result = coinbaseParser.parse(csv);
      expect(result.trades.map((t) => `${t.buySell} ${t.symbol} ${t.quantity}`)).toEqual([
        "BUY ETH 2",
        "SELL ETH -1",
      ]);
    });

    it("warns when an Advanced Trade pair is quoted in another crypto", () => {
      const csv = [
        V2_HEADER,
        'at1,2025-02-01 10:00:00 UTC,Advanced Trade Buy,ETH,1,EUR,€3000,€3000.00,€3006.00,€6.00,Bought 1 ETH for 0.0752 BTC on ETH-BTC at 0.075 BTC/ETH',
      ].join("\n");
      const result = coinbaseParser.parse(csv);
      // The acquired coin keeps its EUR-valued lot...
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0]!.symbol).toBe("ETH");
      expect(result.trades[0]!.cost).toBe("3000.00");
      // ...and the missing BTC leg is surfaced, not dropped silently.
      expect(result.parserMessages).toHaveLength(1);
      const msg = result.parserMessages![0]!;
      expect(msg.id).toBe("coinbase.advanced_trade_quote_leg_missing");
      expect(msg.severity).toBe("warning");
      expect(msg.context).toEqual({ count: "1", pairs: "ETH-BTC" });
    });

    it("books Inflation Reward as ahorro and Coinbase Earn as base general income", () => {
      const csv = [
        V2_HEADER,
        'r1,2025-02-01 10:00:00 UTC,Inflation Reward,ATOM,1.2,EUR,€8,€9.60,€9.60,€0.00,Inflation reward',
        'r2,2025-02-02 10:00:00 UTC,Coinbase Earn,GRT,10,EUR,€0.20,€2.00,€2.00,€0.00,Coinbase Earn',
      ].join("\n");
      const result = coinbaseParser.parse(csv);
      expect(result.trades).toHaveLength(0);
      expect(result.cashTransactions.map((c) => `${c.symbol} ${c.taxBucket} ${c.amount}`)).toEqual([
        "ATOM ahorro 9.60",
        "GRT general 2.00",
      ]);
      expect(result.parserMessages).toBeUndefined();
    });

    it("skips known non-taxable transfer types without a warning", () => {
      const types = [
        "Withdrawal", "Exchange Deposit", "Exchange Withdrawal", "Pro Deposit", "Pro Withdrawal",
        "Prime Deposit", "Transfer", "Retail Staking Transfer", "Retail Unstaking Transfer",
        "Vault Withdrawal", "Cash to Savings", "Savings to Cash",
      ];
      const csv = [
        V2_HEADER,
        ...types.map((type, i) => `t${i},2025-02-01 10:00:00 UTC,${type},BTC,0.1,EUR,€40000,€4000.00,€4000.00,€0.00,`),
      ].join("\n");
      const result = coinbaseParser.parse(csv);
      expect(result.trades).toHaveLength(0);
      expect(result.cashTransactions).toHaveLength(0);
      expect(result.parserMessages).toBeUndefined();
    });

    it("warns once, naming each unrecognised type and its row count", () => {
      const csv = [
        V2_HEADER,
        'u1,2025-02-01 10:00:00 UTC,Card Spend,BTC,-0.001,EUR,€40000,€40.00,€40.00,€0.00,Card purchase',
        'u2,2025-02-02 10:00:00 UTC,Card Spend,BTC,-0.002,EUR,€40000,€80.00,€80.00,€0.00,Card purchase',
        'u3,2025-02-03 10:00:00 UTC,Interest payout,USDC,1.5,EUR,€0.92,€1.38,€1.38,€0.00,Interest',
      ].join("\n");
      const result = coinbaseParser.parse(csv);
      expect(result.trades).toHaveLength(0);
      expect(result.cashTransactions).toHaveLength(0);
      expect(result.parserMessages).toHaveLength(1);
      const msg = result.parserMessages![0]!;
      expect(msg.id).toBe("coinbase.unknown_types_skipped");
      expect(msg.severity).toBe("warning");
      expect(msg.message).toContain("Card Spend (2)");
      expect(msg.message).toContain("Interest payout (1)");
      expect(msg.context).toEqual({ count: "3", types: "Card Spend (2), Interest payout (1)" });
    });

    it("localizes both new warnings, and the es text matches the parser's Spanish", async () => {
      const csv = [
        V2_HEADER,
        'u1,2025-02-01 10:00:00 UTC,Card Spend,BTC,-0.001,EUR,€40000,€40.00,€40.00,€0.00,Card purchase',
        'at1,2025-02-01 10:00:00 UTC,Advanced Trade Sell,ETH,-1,EUR,€3000,€3000.00,€2994.00,€6.00,Sold 1 ETH for 0.0748 BTC on ETH-BTC at 0.075 BTC/ETH',
      ].join("\n");
      const msgs = coinbaseParser.parse(csv).parserMessages!;
      expect(msgs.map((m) => m.id)).toEqual([
        "coinbase.unknown_types_skipped",
        "coinbase.advanced_trade_quote_leg_missing",
      ]);
      try {
        await setLocale("es");
        for (const m of msgs) {
          expect(localizeMessage(m)).toBe(m.message);
          expect(localizeHint(m)).toBe(m.hint);
        }
        await setLocale("en");
        for (const m of msgs) {
          expect(localizeMessage(m)).not.toBe(m.message);
          expect(localizeMessage(m)).not.toContain("{{");
        }
      } finally {
        await setLocale("es");
      }
    });

    it("reads a Convert destination with a US thousands separator ('to 2,000 USDC')", () => {
      const csv = [
        V2_HEADER,
        'c1,2025-02-01 10:00:00 UTC,Convert,ETH,-1,EUR,€2000,€2000.00,€1990.00,€10.00,"Converted 1 ETH to 2,000 USDC"',
      ].join("\n");
      const result = coinbaseParser.parse(csv);
      const buy = result.trades.find((t) => t.buySell === "BUY")!;
      expect(buy.symbol).toBe("USDC");
      expect(buy.quantity).toBe("2000");
      expect(buy.tradePrice).toBe("1");
    });
  });
});
