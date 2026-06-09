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
    // Proceeds = 0.003777 BTC × 78,890.27 ≈ 297.97 EUR.
    expect(Number(d.proceedsEur)).toBeCloseTo(297.97, 1);
    // Gain ≈ +20.47 EUR (sane), never a multi-million loss.
    expect(Number(d.gainLossEur)).toBeCloseTo(20.47, 1);
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
});
