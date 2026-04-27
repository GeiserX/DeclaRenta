import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { FxFifoEngine } from "../../src/engine/fx-fifo.js";
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

  // -------------------------------------------------------------------------
  // New anonymized real-world fixtures (v2)
  // -------------------------------------------------------------------------

  describe("ibkr-autoconvert.xml (EUR-base, AFx auto-convert)", () => {
    const xml = fixture("ibkr-autoconvert.xml");

    it("should parse all sections", () => {
      const r = parseIbkrFlexXml(xml);
      expect(r.accountId).toBe("U99999901");
      expect(r.trades).toHaveLength(16);
      expect(r.cashTransactions).toHaveLength(3);
      expect(r.openPositions).toHaveLength(3);
      expect(r.securitiesInfo).toHaveLength(4);
      expect(r.cashBalances).toHaveLength(3);
    });

    it("should correctly parse AFx notes on CASH trades", () => {
      const r = parseIbkrFlexXml(xml);
      const afxTrades = r.trades.filter((t) => (t.notes || "").includes("AFx"));
      expect(afxTrades).toHaveLength(11);
      expect(afxTrades.every((t) => t.assetCategory === "CASH")).toBe(true);
      expect(afxTrades.every((t) => t.exchange === "IDEALFX")).toBe(true);
    });

    it("should detect auto-convert via AFx notes", () => {
      const r = parseIbkrFlexXml(xml);
      expect(FxFifoEngine.detectAutoConvert(r.trades)).toBe(true);
    });

    it("should have 5 STK trades across EUR and USD", () => {
      const r = parseIbkrFlexXml(xml);
      const stk = r.trades.filter((t) => t.assetCategory === "STK");
      expect(stk).toHaveLength(5);
      expect(stk.filter((t) => t.currency === "EUR")).toHaveLength(2);
      expect(stk.filter((t) => t.currency === "USD")).toHaveLength(3);
    });
  });

  describe("ibkr-options.xml (options + exercises/expirations)", () => {
    const xml = fixture("ibkr-options.xml");

    it("should parse trades and option exercises", () => {
      const r = parseIbkrFlexXml(xml);
      expect(r.accountId).toBe("U99999902");
      expect(r.trades).toHaveLength(7);
      expect(r.optionExercises).toHaveLength(7);
      expect(r.openPositions).toHaveLength(3);
    });

    it("should distinguish OPT from STK trades", () => {
      const r = parseIbkrFlexXml(xml);
      expect(r.trades.filter((t) => t.assetCategory === "OPT")).toHaveLength(5);
      expect(r.trades.filter((t) => t.assetCategory === "STK")).toHaveLength(2);
    });

    it("should parse OptionEAE entries with strike/expiry metadata", () => {
      const r = parseIbkrFlexXml(xml);
      expect(r.optionExercises!.length).toBe(7);
      expect(r.optionExercises!.every((e) => e.strike !== undefined)).toBe(true);
      expect(r.optionExercises!.every((e) => e.putCall === "C")).toBe(true);
    });

    it("should preserve option metadata (strike, expiry, putCall)", () => {
      const r = parseIbkrFlexXml(xml);
      const opt = r.trades.find((t) => t.assetCategory === "OPT")!;
      expect(opt.strike).toBeDefined();
      expect(opt.expiry).toBeDefined();
      expect(opt.putCall).toBe("C");
      expect(Number(opt.multiplier)).toBe(100);
    });
  });

  describe("ibkr-multicurrency.xml (CAD + USD multi-currency)", () => {
    const xml = fixture("ibkr-multicurrency.xml");

    it("should parse all trades across currencies", () => {
      const r = parseIbkrFlexXml(xml);
      expect(r.accountId).toBe("U99999903");
      expect(r.trades).toHaveLength(15);
    });

    it("should have CAD and USD trades", () => {
      const r = parseIbkrFlexXml(xml);
      const cad = r.trades.filter((t) => t.currency === "CAD");
      const usd = r.trades.filter((t) => t.currency === "USD");
      expect(cad).toHaveLength(10);
      expect(usd).toHaveLength(5);
    });

    it("should detect auto-convert via heuristic (non-EUR trades, no manual CASH)", () => {
      const r = parseIbkrFlexXml(xml);
      // Heuristic: has non-EUR securities but no manual CASH trades → auto-convert
      expect(FxFifoEngine.detectAutoConvert(r.trades)).toBe(true);
    });

    it("should have buy+sell pairs for FIFO testing", () => {
      const r = parseIbkrFlexXml(xml);
      const buys = r.trades.filter((t) => t.buySell === "BUY");
      const sells = r.trades.filter((t) => t.buySell === "SELL");
      expect(buys.length).toBeGreaterThan(0);
      expect(sells.length).toBeGreaterThan(0);
    });
  });

  describe("degiro-transactions-v2-sample.csv (Spanish locale, real structure)", () => {
    const csv = fixture("degiro-transactions-v2-sample.csv");

    it("should detect as DeGiro format", () => {
      expect(degiroParser.detect(csv)).toBe(true);
    });

    it("should parse all 19 trades (no zero-price rows)", () => {
      const r = degiroParser.parse(csv);
      expect(r.trades).toHaveLength(19);
    });

    it("should handle Spanish number format (comma decimal)", () => {
      const r = degiroParser.parse(csv);
      const trade = r.trades[0]!;
      expect(Number(trade.tradePrice)).toBeGreaterThan(0);
      expect(trade.currency).toBe("USD");
    });

    it("should parse multiple symbols", () => {
      const r = degiroParser.parse(csv);
      const symbols = new Set(r.trades.map((t) => t.symbol));
      expect(symbols.size).toBeGreaterThan(1);
    });
  });

  describe("binance-v2-sample.csv (Transaction History with converts + strategy)", () => {
    const csv = fixture("binance-v2-sample.csv");

    it("should detect as Binance format", () => {
      expect(binanceParser.detect(csv)).toBe(true);
    });

    it("should parse converts and strategy trades", () => {
      const r = binanceParser.parse(csv);
      expect(r.trades).toHaveLength(12);
      expect(r.trades.every((t) => t.assetCategory === "CRYPTO")).toBe(true);
    });

    it("should skip deposits and internal transfers", () => {
      const r = binanceParser.parse(csv);
      expect(r.trades.every((t) => !t.description.includes("Deposit"))).toBe(true);
      expect(r.trades.every((t) => !t.description.includes("Transfer"))).toBe(true);
    });

    it("should pair Binance Convert rows into buy+sell trades", () => {
      const r = binanceParser.parse(csv);
      const converts = r.trades.filter((t) => t.description.includes("Convert"));
      expect(converts.length).toBeGreaterThan(0);
      expect(converts.length % 2).toBe(0);
    });
  });

  describe("coinbase-v3-sample.csv (v2 format with preamble)", () => {
    const csv = fixture("coinbase-v3-sample.csv");

    it("should detect through preamble rows", () => {
      expect(coinbaseParser.detect(csv)).toBe(true);
    });

    it("should parse Convert as sell+buy pair", () => {
      const r = coinbaseParser.parse(csv);
      expect(r.trades).toHaveLength(2);
      const sell = r.trades.find((t) => t.buySell === "SELL");
      const buy = r.trades.find((t) => t.buySell === "BUY");
      expect(sell).toBeDefined();
      expect(buy).toBeDefined();
      expect(sell!.symbol).toBe("BTC");
      expect(buy!.symbol).toBe("SOL");
    });

    it("should skip Send and Receive (non-taxable transfers)", () => {
      const r = coinbaseParser.parse(csv);
      expect(r.trades.every((t) => t.symbol !== "SOL" || t.buySell !== "SELL")).toBe(true);
    });
  });
});
