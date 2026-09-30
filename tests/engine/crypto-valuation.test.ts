import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { resolveCryptoTradeValues } from "../../src/engine/crypto-valuation.js";
import { lookupRateInMap } from "../../src/engine/ecb.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Trade } from "../../src/types/ibkr.js";

// All fixtures below are ANONYMIZED: synthetic account IDs, no real NIF/names.

function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

/**
 * Build a minimal CRYPTO swap Trade. `currency` is the quote coin (the side that
 * may be unresolvable); `symbol` is the asset coin; `tradePrice` is units of
 * `currency` per 1 `symbol`.
 */
function makeCryptoTrade(overrides: Partial<Trade>): Trade {
  const tradeDate = overrides.tradeDate ?? "2025-04-10";
  return {
    tradeID: "t1",
    accountId: "ACC-TEST",
    symbol: "BTC",
    description: "Convert SOL to BTC",
    isin: "",
    assetCategory: "CRYPTO",
    currency: "SOL",
    tradeDate,
    settlementDate: tradeDate,
    quantity: "0.02",
    tradePrice: "1500",
    tradeMoney: "30",
    proceeds: "30",
    cost: "30",
    fifoPnlRealized: "0",
    fxRateToBase: "0",
    buySell: "BUY",
    openCloseIndicator: "O",
    exchange: "BINANCE",
    commissionCurrency: "SOL",
    commission: "0",
    taxes: "0",
    multiplier: "1",
    ...overrides,
  };
}

describe("resolveCryptoTradeValues", () => {
  describe("(D) cross-leg inference", () => {
    it("infers the SOL rate from a resolvable BTC leg, keeps the trade, leaves the original map unmutated", () => {
      // BTC is resolvable via a direct synthetic rate (EUR per 1 BTC).
      // tradePrice = 1500 SOL per 1 BTC. So eurRate(SOL) = eurRate(BTC) / 1500.
      const btcRate = "60000.0000000000"; // EUR per BTC
      const rateMap = makeRateMap({ "2025-04-10": { BTC: btcRate } });
      const trade = makeCryptoTrade({
        currency: "SOL",
        symbol: "BTC",
        tradePrice: "1500",
        commissionCurrency: "SOL",
        commission: "0",
      });

      const result = resolveCryptoTradeValues([trade], rateMap);

      // Trade is kept.
      expect(result.trades).toHaveLength(1);
      expect(result.unresolved).toHaveLength(0);

      // Injected SOL rate = eurRate(BTC) / tradePrice = 60000 / 1500 = 40.
      const injected = lookupRateInMap(result.rateMap, "2025-04-10", "SOL");
      expect(injected).not.toBeNull();
      const expected = new Decimal(btcRate).div(new Decimal("1500"));
      expect(injected!.toFixed(10)).toBe(expected.toFixed(10));

      // Original map is NOT mutated (no SOL entry leaked back).
      expect(lookupRateInMap(rateMap, "2025-04-10", "SOL")).toBeNull();
    });
  });

  describe("(B) manual rate path", () => {
    it("keeps and resolves a swap via manualRates when neither leg is ECB-resolvable", () => {
      // Neither SOL nor BTC are in the ECB map; manual provides SOL directly.
      const rateMap: EcbRateMap = new Map();
      const manualRates = makeRateMap({ "2025-04-10": { SOL: "42.0000000000" } });
      const trade = makeCryptoTrade({ currency: "SOL", symbol: "BTC", tradePrice: "1500" });

      const result = resolveCryptoTradeValues([trade], rateMap, manualRates);

      expect(result.trades).toHaveLength(1);
      expect(result.unresolved).toHaveLength(0);
      const injected = lookupRateInMap(result.rateMap, "2025-04-10", "SOL");
      expect(injected!.toFixed(2)).toBe("42.00");
    });
  });

  describe("(A) skip + warn", () => {
    it("drops the trade and surfaces one no-cross-leg unresolved entry plus one warning", () => {
      // Neither leg resolvable, no manual rate → cross-leg attempted but fails.
      const rateMap: EcbRateMap = new Map();
      const trade = makeCryptoTrade({ currency: "SOL", symbol: "BTC", tradePrice: "1500" });

      const result = resolveCryptoTradeValues([trade], rateMap);

      expect(result.trades).toHaveLength(0);
      expect(result.unresolved).toHaveLength(1);
      expect(result.unresolved[0]!.currency).toBe("SOL");
      expect(result.unresolved[0]!.reason).toBe("no-cross-leg");

      const warnings = result.messages.filter((m) => m.id === "report.crypto_valuation_unresolved");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.severity).toBe("warning");
    });
  });

  describe("commission neutralization", () => {
    it("keeps a resolvable trade but neutralizes a commission in an unresolvable coin", () => {
      // Trade currency SOL is resolvable via manual; commission is in a different
      // unresolvable coin (DOGE) → commission neutralized, info message emitted.
      const rateMap: EcbRateMap = new Map();
      const manualRates = makeRateMap({ "2025-04-10": { SOL: "42.0000000000" } });
      const trade = makeCryptoTrade({
        currency: "SOL",
        symbol: "BTC",
        tradePrice: "1500",
        commission: "1.5",
        commissionCurrency: "DOGE",
      });

      const result = resolveCryptoTradeValues([trade], rateMap, manualRates);

      expect(result.trades).toHaveLength(1);
      const kept = result.trades[0]!;
      expect(kept.commission).toBe("0");
      expect(kept.commissionCurrency).toBe("SOL");

      const info = result.messages.filter((m) => m.id === "report.crypto_commission_neutralized");
      expect(info).toHaveLength(1);
      expect(info[0]!.severity).toBe("info");
    });
  });

  describe("paired Convert legs resolve or drop together (permuta symmetry)", () => {
    // A Binance Convert SOL→BTC emits TWO legs sharing a timestamp:
    //   SELL: symbol=SOL, currency=BTC, tradePrice = BTC per 1 SOL
    //   BUY:  symbol=BTC, currency=SOL, tradePrice = SOL per 1 BTC  (reciprocal)
    // Because cross-leg inference is available on BOTH legs, each resolves iff
    // (R(SOL) OR R(BTC)); the conditions are identical, so the legs can never
    // split (one kept, one dropped) — which would corrupt FIFO lots.
    function makeConvertPair(opts: { sellTradePrice: string; buyTradePrice: string }): Trade[] {
      const date = "2025-04-10";
      const sell = makeCryptoTrade({
        tradeID: "conv-sell", symbol: "SOL", currency: "BTC",
        buySell: "SELL", openCloseIndicator: "C",
        tradePrice: opts.sellTradePrice, commissionCurrency: "BTC",
        description: "Convert SOL to BTC", tradeDate: date,
      });
      const buy = makeCryptoTrade({
        tradeID: "conv-buy", symbol: "BTC", currency: "SOL",
        buySell: "BUY", openCloseIndicator: "O",
        tradePrice: opts.buyTradePrice, commissionCurrency: "SOL",
        description: "Convert SOL to BTC", tradeDate: date,
      });
      return [sell, buy];
    }

    it("keeps BOTH legs when only the BTC side is ECB/synthetic-resolvable", () => {
      // 1 SOL = 0.000666... BTC (sell price); 1 BTC = 1500 SOL (buy price).
      const pair = makeConvertPair({ sellTradePrice: new Decimal(1).div(1500).toString(), buyTradePrice: "1500" });
      const rateMap = makeRateMap({ "2025-04-10": { BTC: "60000.0000000000" } });

      const result = resolveCryptoTradeValues(pair, rateMap);

      expect(result.trades).toHaveLength(2);
      expect(result.unresolved).toHaveLength(0);
    });

    it("drops BOTH legs together when neither side is resolvable", () => {
      const pair = makeConvertPair({ sellTradePrice: new Decimal(1).div(1500).toString(), buyTradePrice: "1500" });
      const rateMap: EcbRateMap = new Map();

      const result = resolveCryptoTradeValues(pair, rateMap);

      expect(result.trades).toHaveLength(0);
      // Deduped per currency+date, but both coins surface (BTC and SOL).
      const currencies = result.unresolved.map((u) => u.currency).sort();
      expect(currencies).toEqual(["BTC", "SOL"]);
    });
  });

  describe("a coin price is never reused on a later day", () => {
    // 2025-03-03: BUY 2000 USDT paying ETH at 0.0005 ETH/USDT. USDT resolves via
    // USD (1 EUR), so (D) infers ETH = 1 / 0.0005 = 2000 EUR on 03-03 only.
    // 2025-03-06: SELL 1 BTC for 30 ETH. BTC has no rate, so ETH must come from
    // a quote for 03-06 itself, never from the 03-03 inference three days back.
    const rateMap = makeRateMap({
      "2025-03-03": { USD: "1.0000000000" },
      "2025-03-06": { USD: "1.0000000000" },
    });
    const inferEth = makeCryptoTrade({
      tradeID: "buy-usdt",
      tradeDate: "2025-03-03",
      symbol: "USDT",
      currency: "ETH",
      tradePrice: "0.0005",
      quantity: "2000",
      commissionCurrency: "ETH",
    });
    const laterSwap = makeCryptoTrade({
      tradeID: "sell-btc",
      tradeDate: "2025-03-06",
      symbol: "BTC",
      currency: "ETH",
      tradePrice: "30",
      quantity: "-1",
      buySell: "SELL",
      openCloseIndicator: "C",
      commissionCurrency: "ETH",
    });

    it("values the later swap at the user's manual quote for that day, not the earlier inferred price", () => {
      const manualRates = makeRateMap({ "2025-03-06": { ETH: "3000" } });

      const result = resolveCryptoTradeValues([inferEth, laterSwap], rateMap, manualRates);

      expect(result.trades).toHaveLength(2);
      expect(result.unresolved).toHaveLength(0);
      expect(lookupRateInMap(result.rateMap, "2025-03-03", "ETH")!.toFixed(2)).toBe("2000.00");
      expect(lookupRateInMap(result.rateMap, "2025-03-06", "ETH")!.toFixed(2)).toBe("3000.00");
    });

    it("skips and warns on the later swap when no quote exists for its own day", () => {
      const result = resolveCryptoTradeValues([inferEth, laterSwap], rateMap);

      expect(result.trades.map((t) => t.tradeID)).toEqual(["buy-usdt"]);
      expect(result.unresolved).toHaveLength(1);
      expect(result.unresolved[0]).toMatchObject({ currency: "ETH", date: "2025-03-06", reason: "no-cross-leg" });
      expect(result.messages.some((m) => m.id === "report.crypto_valuation_unresolved")).toBe(true);
    });

    it("still reuses an inferred price for another swap on the SAME day", () => {
      const sameDaySwap = { ...laterSwap, tradeID: "sell-btc-same-day", tradeDate: "2025-03-03", settlementDate: "2025-03-03" };

      const result = resolveCryptoTradeValues([inferEth, sameDaySwap], rateMap);

      expect(result.trades).toHaveLength(2);
      expect(result.unresolved).toHaveLength(0);
    });

    it("keeps the weekend walk-back for ECB fiat and stablecoins", () => {
      // Sunday 2025-03-09, last ECB fix on Friday 2025-03-07.
      const fridayOnly = makeRateMap({ "2025-03-07": { USD: "0.9200000000" } });
      const sundayBuy = makeCryptoTrade({ tradeDate: "2025-03-09", symbol: "BTC", currency: "USDT", tradePrice: "80000", quantity: "0.01" });

      const result = resolveCryptoTradeValues([sundayBuy], fridayOnly);

      expect(result.trades).toHaveLength(1);
      expect(result.unresolved).toHaveLength(0);
      expect(lookupRateInMap(result.rateMap, "2025-03-09", "USDT")!.toFixed(2)).toBe("0.92");
    });

    it.each(["EURT", "EUROC"])("still values a %s-quoted trade at 1:1 with EUR", (euroCoin) => {
      const buy = makeCryptoTrade({ tradeDate: "2025-03-06", symbol: "BTC", currency: euroCoin, tradePrice: "80000", quantity: "0.01", commissionCurrency: euroCoin });

      const result = resolveCryptoTradeValues([buy], new Map());

      expect(result.trades).toHaveLength(1);
      expect(result.unresolved).toEqual([]);
      expect(lookupRateInMap(result.rateMap, "2025-03-06", euroCoin)!.toFixed(2)).toBe("1.00");
    });
  });

  describe("pass-through", () => {
    it("returns a plain USD stock trade unchanged", () => {
      const rateMap = makeRateMap({ "2025-03-15": { USD: "0.92" } });
      const stock: Trade = {
        tradeID: "s1",
        accountId: "ACC-TEST",
        symbol: "AAPL",
        description: "APPLE INC",
        isin: "US0378331005",
        assetCategory: "STK",
        currency: "USD",
        tradeDate: "2025-03-15",
        settlementDate: "2025-03-15",
        quantity: "10",
        tradePrice: "100",
        tradeMoney: "1000",
        proceeds: "1000",
        cost: "1000",
        fifoPnlRealized: "0",
        fxRateToBase: "0.92",
        buySell: "BUY",
        openCloseIndicator: "O",
        exchange: "NASDAQ",
        commissionCurrency: "USD",
        commission: "1",
        taxes: "0",
        multiplier: "1",
      };

      const result = resolveCryptoTradeValues([stock], rateMap);

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0]).toBe(stock); // same reference — untouched
      expect(result.unresolved).toHaveLength(0);
      expect(result.messages).toHaveLength(0);
    });
  });
});
