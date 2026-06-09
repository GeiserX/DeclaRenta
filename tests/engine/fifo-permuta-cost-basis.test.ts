import { describe, it, expect } from "vitest";
import { FifoEngine } from "../../src/engine/fifo.js";
import type { Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// Regression for the €35M phantom cost-basis bug (post v0.48.5). When a coin is
// ACQUIRED paying one currency (EUR) and DISPOSED receiving another (BTC), the
// cost basis must be the EUR actually paid at acquisition (Art. 35.1), NOT the
// FCY cost multiplied by the SELL coin's huge EUR rate (DGT V2422-20 applies
// only when acquisition and disposal share a currency — a normal FCY security).

function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

function trade(o: Partial<Trade>): Trade {
  return {
    tradeID: "t", accountId: "ACC", symbol: "USDC", description: "", isin: "",
    assetCategory: "CRYPTO", currency: "EUR", tradeDate: "2025-03-14",
    settlementDate: "2025-03-14", quantity: "300", tradePrice: "0.925",
    tradeMoney: "277.5", proceeds: "0", cost: "277.5", fifoPnlRealized: "0",
    fxRateToBase: "0", buySell: "BUY", openCloseIndicator: "O", exchange: "BINANCE",
    commissionCurrency: "EUR", commission: "0", taxes: "0", multiplier: "1", ...o,
  };
}

describe("FIFO — cross-currency permuta cost basis (€35M bug regression)", () => {
  it("uses the EUR actually paid as cost basis when buy-ccy ≠ sell-ccy", () => {
    // BUY 300 USDC paying 277.5 EUR (EUR rate = 1). SELL 300 USDC for 0.003777
    // BTC on a day BTC = 78,890 EUR. The OLD bug multiplied the 277.5 EUR cost
    // by 78,890 → €21.9M phantom cost. Correct cost = 277.5 EUR.
    const buy = trade({ buySell: "BUY", currency: "EUR", quantity: "300", tradePrice: "0.925", cost: "277.5" });
    const sell = trade({
      buySell: "SELL", openCloseIndicator: "C", currency: "BTC", symbol: "USDC",
      tradeDate: "2025-04-06", settlementDate: "2025-04-06",
      quantity: "-300", tradePrice: "0.00001259", proceeds: "0.003777", cost: "0",
      commissionCurrency: "BTC",
    });
    const rateMap = makeRateMap({
      "2025-03-14": { EUR: "1", BTC: "70000" },
      "2025-04-06": { EUR: "1", BTC: "78890.273739" },
    });
    const engine = new FifoEngine();
    const disposals = engine.processTrades([buy, sell], rateMap);

    expect(disposals).toHaveLength(1);
    const d = disposals[0]!;
    // Cost basis = 277.5 EUR paid (NOT 277.5 × 78,890 = €21.9M).
    expect(d.costBasisEur.toFixed(2)).toBe("277.50");
    // Proceeds = 0.003777 BTC × 78,890.273739 = 297.97 EUR (exact, deterministic).
    expect(d.proceedsEur.toFixed(2)).toBe("297.97");
    // Gain = +20.47 EUR (sane), never a multi-million loss.
    expect(d.gainLossEur.toFixed(2)).toBe("20.47");
    expect(Number(d.costBasisEur)).toBeLessThan(1000);
  });

  it("leaves a SAME-currency FCY disposal on the V2422-20 path (sale-date rate, FX-clean)", () => {
    // Control: buy AND sell in USD. DGT V2422-20 — both legs at the sale-date
    // rate, so 0 USD price move = 0 EUR gain even as USD/EUR drifts. This must
    // be UNCHANGED by the fix (the #219 behavior).
    const buy = trade({
      symbol: "AAPL", assetCategory: "STK", currency: "USD", buySell: "BUY",
      tradeDate: "2025-01-10", settlementDate: "2025-01-10",
      quantity: "10", tradePrice: "100", cost: "1000", commissionCurrency: "USD",
    });
    const sell = trade({
      symbol: "AAPL", assetCategory: "STK", currency: "USD", buySell: "SELL",
      openCloseIndicator: "C", tradeDate: "2025-06-01", settlementDate: "2025-06-01",
      quantity: "-10", tradePrice: "100", proceeds: "1000", cost: "0", commissionCurrency: "USD",
    });
    const rateMap = makeRateMap({
      "2025-01-10": { USD: "0.77" }, // 1.30 USD/EUR
      "2025-06-01": { USD: "0.67" }, // 1.50 USD/EUR
    });
    const engine = new FifoEngine();
    const disposals = engine.processTrades([buy, sell], rateMap);

    expect(disposals).toHaveLength(1);
    // 0 USD gain → 0 EUR gain (FX drift excluded — handled by the FX engine).
    expect(disposals[0]!.gainLossEur.toFixed(2)).toBe("0.00");
    // Both legs at the SALE-date rate: 1000 × 0.67 = 670.
    expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("670.00");
    expect(disposals[0]!.proceedsEur.toFixed(2)).toBe("670.00");
  });

  it("uses the lot's OWN acquisition rate when buy-ccy is a non-EUR coin (lotEcbRate ≠ 1)", () => {
    // Guards against a regression that hardcodes rate=1: BUY 100 USDC paying 100
    // USDT (USDT→USD, rate 0.90 → real EUR cost 90). SELL 100 USDC for 0.0012 BTC
    // (BTC = 78,890). Cost must be 90 (= 100 × 0.90), NOT 100 (rate-1 no-op) and
    // NOT 7.9M (sell-coin rate).
    const buy = trade({ buySell: "BUY", currency: "USDT", symbol: "USDC", quantity: "100", tradePrice: "1", cost: "100", commissionCurrency: "USDT" });
    const sell = trade({
      buySell: "SELL", openCloseIndicator: "C", currency: "BTC", symbol: "USDC",
      tradeDate: "2025-04-06", settlementDate: "2025-04-06",
      quantity: "-100", tradePrice: "0.000012", proceeds: "0.0012", cost: "0", commissionCurrency: "BTC",
    });
    const rateMap = makeRateMap({
      "2025-03-14": { USD: "0.90", BTC: "70000" }, // USDT normalizes to USD
      "2025-04-06": { BTC: "78890.273739" },
    });
    const d = new FifoEngine().processTrades([buy, sell], rateMap)[0]!;
    expect(d.costBasisEur.toFixed(2)).toBe("90.00");   // 100 USDT × 0.90 (lot rate)
    expect(d.proceedsEur.toFixed(2)).toBe("94.67");    // 0.0012 BTC × 78,890.27
  });

  it("treats the SAME volatile coin on both legs as crypto, NOT a V2422-20 currency", () => {
    // The Domain reviewer's HIGH case: a coin acquired via ETH→X carries
    // currency:"ETH"; disposed via X→ETH the sell is also "ETH". lot.currency ===
    // sellCurrency by string, but ETH is NOT fiat (isEcbResolvable false), so the
    // sale-date-rate (V2422-20) branch must NOT apply — its price move is permuta
    // gain. Cost = real ETH paid at acquisition (10 ETH × 2500 = 25,000 EUR), NOT
    // re-valued at the sale-date ETH price (10 × 2727 = 27,273, which would
    // UNDER-state the gain).
    const buy = trade({
      symbol: "X", currency: "ETH", buySell: "BUY", tradeDate: "2025-02-01", settlementDate: "2025-02-01",
      quantity: "0.35", tradePrice: "28.5714285714", cost: "10", commissionCurrency: "ETH", // 0.35 X for 10 ETH
    });
    const sell = trade({
      symbol: "X", currency: "ETH", buySell: "SELL", openCloseIndicator: "C",
      tradeDate: "2025-09-20", settlementDate: "2025-09-20",
      quantity: "-0.35", tradePrice: "31.4285714286", proceeds: "11", cost: "0", commissionCurrency: "ETH", // 0.35 X → 11 ETH
    });
    const rateMap = makeRateMap({
      "2025-02-01": { ETH: "2500" }, // EUR per ETH at acquisition
      "2025-09-20": { ETH: "2727.272727" }, // ETH rose by sale date
    });
    const d = new FifoEngine().processTrades([buy, sell], rateMap)[0]!;
    // Cost = 10 ETH × 2500 (acquisition rate) = 25,000 — NOT 10 × 2727 = 27,273.
    expect(d.costBasisEur.toFixed(2)).toBe("25000.00");
    // Proceeds = 11 ETH × 2727.272727 = 30,000. Gain = +5,000 (not the
    // under-stated +2,727 the sale-date-rate branch would have produced).
    expect(d.proceedsEur.toFixed(2)).toBe("30000.00");
    expect(d.gainLossEur.toFixed(2)).toBe("5000.00");
  });

  it("applies each lot's OWN acquisition rate across a multi-lot partial consumption", () => {
    // FIFO consumes lot1 (EUR @1 → 90) then 50 of lot2 (USDT/USD @0.80 → 40).
    const buy1 = trade({ tradeID: "b1", buySell: "BUY", currency: "EUR", symbol: "USDC", tradeDate: "2025-03-10", settlementDate: "2025-03-10", quantity: "100", tradePrice: "0.90", cost: "90", commissionCurrency: "EUR" });
    const buy2 = trade({ tradeID: "b2", buySell: "BUY", currency: "USDT", symbol: "USDC", tradeDate: "2025-03-12", settlementDate: "2025-03-12", quantity: "100", tradePrice: "1", cost: "100", commissionCurrency: "USDT" });
    const sell = trade({
      tradeID: "s1", buySell: "SELL", openCloseIndicator: "C", currency: "BTC", symbol: "USDC",
      tradeDate: "2025-04-06", settlementDate: "2025-04-06",
      quantity: "-150", tradePrice: "0.00002", proceeds: "0.003", cost: "0", commissionCurrency: "BTC",
    });
    const rateMap = makeRateMap({
      "2025-03-10": { EUR: "1" }, "2025-03-12": { USD: "0.80" }, "2025-04-06": { BTC: "78890" },
    });
    const ds = new FifoEngine().processTrades([buy1, buy2, sell], rateMap);
    expect(ds).toHaveLength(2);
    expect(ds[0]!.costBasisEur.toFixed(2)).toBe("90.00"); // lot1: 100 × 1 (EUR)
    expect(ds[1]!.costBasisEur.toFixed(2)).toBe("40.00"); // lot2: 50 × 0.80 (USDT→USD)
  });
});
