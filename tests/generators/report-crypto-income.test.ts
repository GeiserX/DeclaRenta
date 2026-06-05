import { describe, it, expect } from "vitest";
import { generateTaxReport } from "../../src/generators/report.js";
import type { CashTransaction, FlexStatement, Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// Anonymized fixtures: synthetic account IDs, no real NIF/names/balances.

function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

function income(overrides: Partial<CashTransaction>): CashTransaction {
  return {
    transactionID: "inc-1",
    accountId: "ACC",
    symbol: "SOL",
    description: "Simple Earn Flexible Interest - SOL",
    isin: "",
    currency: "SOL",
    dateTime: "2025-03-01",
    settleDate: "2025-03-01",
    amount: "2",
    fxRateToBase: "1",
    type: "Crypto Reward Income",
    taxBucket: "ahorro",
    rewardQuantity: "2",
    rewardCostBasisEur: "80",
    ...overrides,
  };
}

function makeStatement(trades: Trade[], cashTransactions: CashTransaction[], manualRateHints?: FlexStatement["manualRateHints"]): FlexStatement {
  return {
    accountId: "ACC",
    fromDate: "20250101",
    toDate: "20251231",
    period: "Annual",
    trades,
    cashTransactions,
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
    ...(manualRateHints ? { manualRateHints } : {}),
  };
}

describe("generateTaxReport — crypto reward income", () => {
  it("routes staking (ahorro) income to interest/Casilla 0027 using the EUR cost basis", () => {
    const statement = makeStatement([], [income({ taxBucket: "ahorro", rewardCostBasisEur: "80", rewardQuantity: "2", amount: "2" })]);
    const report = generateTaxReport(statement, new Map(), 2025);
    expect(report.interest.earned.toFixed(2)).toBe("80.00");
    expect(report.generalGains.total.toFixed(2)).toBe("0.00");
  });

  it("routes airdrops/referral (general) income to the base-general bucket, NOT interest", () => {
    const statement = makeStatement([], [
      income({ transactionID: "air", symbol: "ANIME", currency: "ANIME", taxBucket: "general", rewardCostBasisEur: "12", rewardQuantity: "0.87", amount: "0.87", description: "HODLer airdrop" }),
    ]);
    const report = generateTaxReport(statement, new Map(), 2025);
    expect(report.generalGains.total.toFixed(2)).toBe("12.00");
    expect(report.generalGains.entries).toHaveLength(1);
    expect(report.interest.earned.toFixed(2)).toBe("0.00");
  });

  it("creates an acquisition lot so a later sale is taxed only on appreciation (no double tax)", () => {
    // Receive 2 SOL as staking valued 80 EUR (40 EUR/unit). Later sell 2 SOL for
    // 100 EUR. Gain should be 100 - 80 = 20 EUR, NOT the full 100 (which would be
    // the phantom gain if no cost-basis lot were created).
    const sell: Trade = {
      tradeID: "sell-sol", accountId: "ACC", symbol: "SOL", description: "Sell SOL",
      isin: "", assetCategory: "CRYPTO", currency: "EUR", tradeDate: "2025-09-01",
      settlementDate: "2025-09-01", quantity: "-2", tradePrice: "50", tradeMoney: "100",
      proceeds: "100", cost: "0", fifoPnlRealized: "0", fxRateToBase: "1",
      buySell: "SELL", openCloseIndicator: "C", exchange: "BINANCE",
      commissionCurrency: "EUR", commission: "0", taxes: "0", multiplier: "1",
    };
    const statement = makeStatement([sell], [
      income({ dateTime: "2025-03-01", symbol: "SOL", currency: "SOL", rewardQuantity: "2", rewardCostBasisEur: "80", amount: "2" }),
    ]);
    const report = generateTaxReport(statement, makeRateMap({ "2025-09-01": { EUR: "1" } }), 2025);
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("80.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("20.00");
  });

  it("values coin-denominated income via an EUR_Value manual-rate hint (no oracle)", () => {
    // Income amount is in SOL with no rewardCostBasisEur, but a manualRateHint
    // provides 40 EUR/SOL on the receipt date → 2 SOL = 80 EUR taxed.
    const statement = makeStatement(
      [],
      [income({ rewardCostBasisEur: undefined, amount: "2", rewardQuantity: "2", currency: "SOL", symbol: "SOL", dateTime: "2025-03-01" })],
      [{ currency: "SOL", date: "2025-03-01", eurPerUnit: "40" }],
    );
    const report = generateTaxReport(statement, new Map(), 2025);
    expect(report.interest.earned.toFixed(2)).toBe("80.00");
  });

  it("surfaces a warning when coin-denominated income cannot be valued", () => {
    const statement = makeStatement([], [
      income({ rewardCostBasisEur: undefined, currency: "SOL", symbol: "SOL", amount: "2", rewardQuantity: "2" }),
    ]);
    const report = generateTaxReport(statement, new Map(), 2025);
    expect(report.interest.earned.toFixed(2)).toBe("0.00");
    expect(report.messages.some((m) => m.id === "report.crypto_income_unvalued")).toBe(true);
  });
});
