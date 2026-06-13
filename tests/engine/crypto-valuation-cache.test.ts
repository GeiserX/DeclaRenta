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

describe("resolveCryptoTradeValues — per-call clone isolation", () => {
  it("repeated calls with the SAME source map yield identical valuations", () => {
    // SOL is priced via cross-leg (D) from a resolvable BTC rate:
    // eurRate(SOL) = eurRate(BTC) / tradePrice = 60000 / 1500 = 40.
    const rateMap = makeRateMap({ "2025-04-10": { BTC: "60000.0000000000" } });
    const trade = makeCryptoTrade({ currency: "SOL", symbol: "BTC", tradePrice: "1500" });

    const first = resolveCryptoTradeValues([trade], rateMap);
    const second = resolveCryptoTradeValues([trade], rateMap);
    const third = resolveCryptoTradeValues([trade], rateMap);

    for (const result of [first, second, third]) {
      expect(result.trades).toHaveLength(1);
      expect(result.unresolved).toHaveLength(0);
      const injected = lookupRateInMap(result.rateMap, "2025-04-10", "SOL");
      expect(injected).not.toBeNull();
      expect(injected!.toFixed(10)).toBe(new Decimal("40").toFixed(10));
    }
  });

  it("never mutates the source map even after repeated calls inject synthetic rates", () => {
    const rateMap = makeRateMap({ "2025-04-10": { BTC: "60000.0000000000" } });
    const trade = makeCryptoTrade({ currency: "SOL", symbol: "BTC", tradePrice: "1500" });

    resolveCryptoTradeValues([trade], rateMap);
    resolveCryptoTradeValues([trade], rateMap);

    // The injected SOL rate must NEVER leak back into the caller's source map:
    // each call deep-clones the map before injecting, so the original is untouched.
    expect(lookupRateInMap(rateMap, "2025-04-10", "SOL")).toBeNull();
    // The original BTC rate is intact.
    expect(lookupRateInMap(rateMap, "2025-04-10", "BTC")!.toFixed(10)).toBe(
      new Decimal("60000").toFixed(10),
    );
  });

  it("does not leak synthetic rates between two distinct source maps with overlapping dates", () => {
    // Same date, but a DIFFERENT source map must be resolved independently, never
    // served a cross-leg (D) rate inferred for the first map. mapB has NO
    // resolvable leg for the same trade → it must drop, proving no cross-map bleed.
    const mapA = makeRateMap({ "2025-04-10": { BTC: "60000.0000000000" } });
    const mapB = makeRateMap({ "2025-04-10": { USD: "0.92" } }); // no BTC/SOL leg

    const trade = makeCryptoTrade({ currency: "SOL", symbol: "BTC", tradePrice: "1500" });

    const resA = resolveCryptoTradeValues([trade], mapA);
    expect(resA.trades).toHaveLength(1);
    expect(lookupRateInMap(resA.rateMap, "2025-04-10", "SOL")!.toFixed(10)).toBe(
      new Decimal("40").toFixed(10),
    );

    const resB = resolveCryptoTradeValues([trade], mapB);
    // No SOL/BTC leg in mapB → cross-leg fails → trade dropped, SOL never injected.
    expect(resB.trades).toHaveLength(0);
    expect(resB.unresolved).toHaveLength(1);
    expect(lookupRateInMap(resB.rateMap, "2025-04-10", "SOL")).toBeNull();
    // mapA's result is unaffected by the later mapB call.
    expect(lookupRateInMap(resA.rateMap, "2025-04-10", "SOL")!.toFixed(10)).toBe(
      new Decimal("40").toFixed(10),
    );
  });

  it("a call-specific cross-leg (D) rate never shadows a later call's manual (B) quote", () => {
    // Defends the load-bearing invariant: a call-specific cross-leg (D) rate must
    // never persist into a later call's starting map, where tryResolve reads the
    // map BEFORE manual rates and a stale (D) entry would silently outrank a
    // user's authoritative manual (B) quote. With per-call cloning each call starts
    // from a fresh deep copy of the source, so no (D) rate can carry across calls.
    const rateMap = makeRateMap({ "2025-04-10": { BTC: "60000.0000000000" } });

    // Call 1: cross-leg (D) injects SOL = 60000 / 1500 = 40 into the returned map.
    const crossLegTrade = makeCryptoTrade({ currency: "SOL", symbol: "BTC", tradePrice: "1500" });
    const res1 = resolveCryptoTradeValues([crossLegTrade], rateMap);
    expect(lookupRateInMap(res1.rateMap, "2025-04-10", "SOL")!.toFixed(10)).toBe(
      new Decimal("40").toFixed(10),
    );

    // Call 2: SAME source map. A trade whose symbol leg (XRP) is NOT resolvable,
    // so the ONLY way SOL resolves is the manual (B) quote = 99. If the (D)
    // SOL=40 from call 1 had bled into call 2's starting map, the trade would
    // resolve to 40 instead. It must resolve to the manual 99.
    const manualRates = makeRateMap({ "2025-04-10": { SOL: "99.0000000000" } });
    const manualTrade = makeCryptoTrade({ currency: "SOL", symbol: "XRP", tradePrice: "1500" });
    const res2 = resolveCryptoTradeValues([manualTrade], rateMap, manualRates);

    expect(res2.trades).toHaveLength(1);
    const injected = lookupRateInMap(res2.rateMap, "2025-04-10", "SOL");
    expect(injected!.toFixed(10)).toBe(new Decimal("99").toFixed(10));
  });
});
