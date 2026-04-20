import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { degiroParser } from "../../src/parsers/degiro.js";
import { binanceParser } from "../../src/parsers/binance.js";
import { coinbaseParser } from "../../src/parsers/coinbase.js";
import { krakenParser } from "../../src/parsers/kraken.js";
import { scalableParser } from "../../src/parsers/scalable.js";
import { freedom24Parser } from "../../src/parsers/freedom24.js";
import { etoroParser } from "../../src/parsers/etoro.js";

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf-8");
}

// ---------------------------------------------------------------------------
// End-to-end fixture parsing — every sample file should detect + parse cleanly
// ---------------------------------------------------------------------------

describe("fixture file integration", () => {
  describe("ibkr-sample.xml", () => {
    const xml = fixture("ibkr-sample.xml");

    it("should parse trades, dividends, positions, and securities", () => {
      const r = parseIbkrFlexXml(xml);
      expect(r.accountId).toBe("U1234567");
      expect(r.trades).toHaveLength(2);
      expect(r.cashTransactions).toHaveLength(2);
      expect(r.openPositions).toHaveLength(1);
      expect(r.securitiesInfo).toHaveLength(2);
    });
  });

  describe("degiro-transactions-sample.csv", () => {
    const csv = fixture("degiro-transactions-sample.csv");

    it("should detect", () => {
      expect(degiroParser.detect(csv)).toBe(true);
    });

    it("should parse all trades (skipping zero-price rights)", () => {
      const r = degiroParser.parse(csv);
      // 13 data rows minus 1 zero-price rights = 12 trades
      expect(r.trades).toHaveLength(12);
      expect(r.trades.every((t) => t.isin.startsWith("XX"))).toBe(true);
    });
  });

  describe("degiro-account-sample.csv", () => {
    const csv = fixture("degiro-account-sample.csv");

    it("should detect", () => {
      expect(degiroParser.detect(csv)).toBe(true);
    });

    it("should parse dividends and withholdings", () => {
      const r = degiroParser.parse(csv);
      const divs = r.cashTransactions.filter((t) => t.type === "Dividends");
      const whts = r.cashTransactions.filter((t) => t.type === "Withholding Tax");
      expect(divs).toHaveLength(4);
      expect(whts).toHaveLength(4);
    });
  });

  describe("binance-sample.csv (Trade History)", () => {
    const csv = fixture("binance-sample.csv");

    it("should detect and parse", () => {
      expect(binanceParser.detect(csv)).toBe(true);
      const r = binanceParser.parse(csv);
      expect(r.trades).toHaveLength(3);
      expect(r.trades[0]!.exchange).toBe("BINANCE");
    });
  });

  describe("binance-tx-sample.csv (Transaction History)", () => {
    const csv = fixture("binance-tx-sample.csv");

    it("should detect", () => {
      expect(binanceParser.detect(csv)).toBe(true);
    });

    it("should parse converts and strategy trades", () => {
      const r = binanceParser.parse(csv);
      // Convert SOL/USDT = 2 trades, Sold+Revenue = 1, Buy+Spend = 1 → 4 total
      expect(r.trades).toHaveLength(4);
      expect(r.trades.every((t) => t.assetCategory === "CRYPTO")).toBe(true);
    });
  });

  describe("coinbase-sample.csv (v1)", () => {
    const csv = fixture("coinbase-sample.csv");

    it("should detect and parse", () => {
      expect(coinbaseParser.detect(csv)).toBe(true);
      const r = coinbaseParser.parse(csv);
      expect(r.trades.length).toBeGreaterThan(0);
    });
  });

  describe("coinbase-v2-sample.csv (v2 with preamble)", () => {
    const csv = fixture("coinbase-v2-sample.csv");

    it("should detect through preamble", () => {
      expect(coinbaseParser.detect(csv)).toBe(true);
    });

    it("should parse trades and income", () => {
      const r = coinbaseParser.parse(csv);
      // Convert (sell+buy) + Buy ETH + Sell ETH = 4 trades; Send/Receive skipped
      expect(r.trades).toHaveLength(4);
      // Staking Income = 1 cash transaction
      expect(r.cashTransactions).toHaveLength(1);
      expect(r.cashTransactions[0]!.type).toBe("Dividends");
    });

    it("should handle euro currency symbols in values", () => {
      const r = coinbaseParser.parse(csv);
      const buy = r.trades.find((t) => t.buySell === "BUY" && t.symbol === "ETH")!;
      expect(buy).toBeDefined();
      expect(Number(buy.tradePrice)).toBeCloseTo(3200, 0);
    });
  });

  describe("kraken-trades-sample.csv", () => {
    const csv = fixture("kraken-trades-sample.csv");

    it("should detect and parse", () => {
      expect(krakenParser.detect(csv)).toBe(true);
      const r = krakenParser.parse(csv);
      expect(r.trades).toHaveLength(2);
    });
  });

  describe("kraken-ledgers-sample.csv", () => {
    const csv = fixture("kraken-ledgers-sample.csv");

    it("should detect and parse staking rewards", () => {
      expect(krakenParser.detect(csv)).toBe(true);
      const r = krakenParser.parse(csv);
      expect(r.cashTransactions).toHaveLength(2);
    });
  });

  describe("scalable-sample.csv", () => {
    const csv = fixture("scalable-sample.csv");

    it("should detect and parse", () => {
      expect(scalableParser.detect(csv)).toBe(true);
      const r = scalableParser.parse(csv);
      expect(r.trades.length).toBeGreaterThan(0);
      expect(r.cashTransactions.length).toBeGreaterThan(0);
    });
  });

  describe("freedom24-sample.json", () => {
    const json = fixture("freedom24-sample.json");

    it("should detect and parse", () => {
      expect(freedom24Parser.detect(json)).toBe(true);
      const r = freedom24Parser.parse(json);
      expect(r.trades).toHaveLength(2);
      expect(r.cashTransactions.length).toBeGreaterThan(0);
    });
  });

  describe("etoro-sample.csv", () => {
    const csv = fixture("etoro-sample.csv");

    it("should detect and parse", () => {
      expect(etoroParser.detect(csv)).toBe(true);
      const r = etoroParser.parse(csv);
      expect(r).toBeDefined();
      expect(r.trades).toBeDefined();
    });
  });
});
