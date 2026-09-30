/**
 * The "sale without lots" and "insufficient lots" messages fire for every
 * broker, so their advice must not assume an IBKR Flex Query, and a security
 * with no ISIN (most crypto) must not print an empty "()".
 */
import { describe, it, expect, afterEach } from "vitest";
import { FifoEngine } from "../../src/engine/fifo.js";
import { localizeHint, localizeMessage, setLocale, type Locale } from "../../src/i18n/index.js";
import type { Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// A crypto sale for euros (Binance "Transaction Sold"): EUR needs no ECB rate.
const rateMap: EcbRateMap = new Map();

function cryptoTrade(overrides: Partial<Trade>): Trade {
  return {
    tradeID: "1",
    accountId: "",
    symbol: "SOL",
    description: "SOL",
    isin: "",
    assetCategory: "CRYPTO",
    currency: "EUR",
    tradeDate: "20250104",
    settlementDate: "20250104",
    quantity: "-200",
    tradePrice: "1",
    tradeMoney: "-200",
    proceeds: "200",
    cost: "0",
    fifoPnlRealized: "0",
    fxRateToBase: "1",
    buySell: "SELL",
    openCloseIndicator: "C",
    exchange: "",
    commissionCurrency: "EUR",
    commission: "0",
    taxes: "0",
    multiplier: "1",
    ...overrides,
  };
}

const LOCALES: Locale[] = ["es", "en", "ca", "eu", "gl"];

afterEach(async () => {
  await setLocale("es");
});

describe("missing-lot messages for a broker without Flex Query and an asset without ISIN", () => {
  it("a sale with no lots: no Flex Query advice and no empty () in any locale or the engine fallback", async () => {
    const engine = new FifoEngine();
    engine.processTrades([cryptoTrade({})], rateMap);
    const m = engine.messages.find((x) => x.id === "fifo.sell_without_lots");
    expect(m).toBeDefined();
    expect(m!.message).not.toContain("()");
    expect(m!.hint).not.toContain("Flex Query");
    for (const locale of LOCALES) {
      await setLocale(locale);
      expect(localizeMessage(m!), locale).not.toContain("()");
      expect(localizeMessage(m!), locale).toContain("SOL × 200");
      expect(localizeHint(m!), locale).not.toContain("Flex Query");
    }
  });

  it("a sale larger than its lots: no Flex Query advice and no empty () in any locale or the engine fallback", async () => {
    const engine = new FifoEngine();
    engine.processTrades(
      [
        cryptoTrade({ tradeID: "1", quantity: "50", tradeMoney: "50", proceeds: "-50", buySell: "BUY", openCloseIndicator: "O" }),
        cryptoTrade({ tradeID: "2", tradeDate: "20250210", settlementDate: "20250210" }),
      ],
      rateMap,
    );
    const m = engine.messages.find((x) => x.id === "fifo.insufficient_lots");
    expect(m).toBeDefined();
    expect(m!.message).not.toContain("()");
    expect(m!.hint).not.toContain("Flex Query");
    for (const locale of LOCALES) {
      await setLocale(locale);
      expect(localizeMessage(m!), locale).not.toContain("()");
      expect(localizeHint(m!), locale).not.toContain("Flex Query");
    }
  });

  it("control: a security with an ISIN still shows it in brackets", async () => {
    const engine = new FifoEngine();
    engine.processTrades(
      [cryptoTrade({ symbol: "ACME", description: "ACME", isin: "XX0000000001", assetCategory: "STK" })],
      rateMap,
    );
    const m = engine.messages.find((x) => x.id === "fifo.sell_without_lots")!;
    expect(m.message).toContain("ACME (XX0000000001)");
    await setLocale("en");
    expect(localizeMessage(m)).toContain("ACME (XX0000000001)");
  });
});
