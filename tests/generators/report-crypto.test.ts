import { describe, it, expect } from "vitest";
import { generateTaxReport } from "../../src/generators/report.js";
import type { FlexStatement, Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// Anonymized fixtures: synthetic account IDs, no real NIF/names/balances.

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
    tradeID: "t",
    accountId: "ACC-TEST",
    symbol: "SOL",
    description: "Binance Convert",
    isin: "",
    assetCategory: "CRYPTO",
    currency: "BTC",
    tradeDate,
    settlementDate: tradeDate,
    quantity: "100",
    tradePrice: "0.0005",
    tradeMoney: "0.05",
    proceeds: "0.05",
    cost: "0.05",
    fifoPnlRealized: "0",
    fxRateToBase: "0",
    buySell: "BUY",
    openCloseIndicator: "O",
    exchange: "BINANCE",
    commissionCurrency: "BTC",
    commission: "0",
    taxes: "0",
    multiplier: "1",
    ...overrides,
  };
}

function makeStatement(trades: Trade[]): FlexStatement {
  return {
    accountId: "ACC-TEST",
    fromDate: "20250101",
    toDate: "20251231",
    period: "Annual",
    trades,
    cashTransactions: [],
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
  };
}

describe("generateTaxReport — crypto↔crypto permutas", () => {
  // A crypto↔crypto swap pair: acquire SOL (priced in BTC), later sell SOL (priced
  // in BTC). Both legs are CRYPTO with NO fiat leg. The quote currency (BTC) and
  // asset (SOL) have no ECB rate.
  const buy = makeCryptoTrade({
    tradeID: "buy-sol",
    tradeDate: "2025-04-10",
    symbol: "SOL",
    currency: "BTC",
    quantity: "100",
    tradePrice: "0.0005", // 0.0005 BTC per SOL
    buySell: "BUY",
    openCloseIndicator: "O",
  });
  const sell = makeCryptoTrade({
    tradeID: "sell-sol",
    tradeDate: "2025-09-20",
    symbol: "SOL",
    currency: "BTC",
    quantity: "-100",
    tradePrice: "0.0006", // 0.0006 BTC per SOL (appreciated)
    buySell: "SELL",
    openCloseIndicator: "C",
  });

  it("does NOT throw and surfaces unresolvedCryptoValuations when rates are sparse", () => {
    // Sparse map: only an unrelated USD rate, nothing for SOL or BTC.
    const rateMap = makeRateMap({ "2025-04-10": { USD: "0.92" } });
    const statement = makeStatement([buy, sell]);

    let report!: ReturnType<typeof generateTaxReport>;
    expect(() => {
      report = generateTaxReport(statement, rateMap, 2025);
    }).not.toThrow();

    // Both legs (BTC quote currency on two dates) are surfaced for manual entry.
    expect(report.unresolvedCryptoValuations).toBeDefined();
    expect(report.unresolvedCryptoValuations!.length).toBeGreaterThan(0);
    for (const u of report.unresolvedCryptoValuations!) {
      expect(u.currency).toBe("BTC");
    }
    // Dropped trades → no disposals computed.
    expect(report.capitalGains.disposals).toHaveLength(0);
  });

  it("values the permuta when manualRates cover BTC on both dates", () => {
    const rateMap: EcbRateMap = new Map();
    // Manual EUR-per-BTC quotes on each trade date.
    const manualRates = makeRateMap({
      "2025-04-10": { BTC: "60000.0000000000" },
      "2025-09-20": { BTC: "62000.0000000000" },
    });
    const statement = makeStatement([buy, sell]);

    const report = generateTaxReport(statement, rateMap, 2025, { manualRates });

    // Everything resolved → no unresolved entries.
    expect(report.unresolvedCryptoValuations).toBeUndefined();

    // One SOL disposal, capital gains computed.
    expect(report.capitalGains.disposals).toHaveLength(1);
    // Proceeds: 100 × 0.0006 BTC × 62000 EUR/BTC = 3720 EUR
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("3720.00");
    // Cost: 100 × 0.0005 BTC × 60000 EUR/BTC = 3000 EUR
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("3000.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("720.00");
  });
});
