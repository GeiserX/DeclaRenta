import { describe, it, expect } from "vitest";
import { generateTaxReport } from "../../src/generators/report.js";
import { binanceParser } from "../../src/parsers/binance.js";
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
    // Proceeds: 100 × 0.0006 BTC × 62000 EUR/BTC = 3720 EUR (coin received).
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("3720.00");
    // This is a crypto PERMUTA priced in BTC on BOTH legs — BTC is the coin paid
    // (buy) and received (sell), NOT a fiat currency. DGT V2422-20 (sale-date
    // rate on both legs) does NOT apply: BTC's price move is part of the permuta
    // gain, not a separately-deferred FX element. Cost = real EUR paid at
    // acquisition (Art. 35.1): 0.05 BTC × 60000 = 3000 EUR (buy-date rate), NOT
    // 0.05 × 62000 = 3100 (which would silently drop BTC's appreciation on the
    // cost leg — the old #219 over-/under-statement this fix removes).
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("3000.00");
    // Gain = 3720 − 3000 = 720.00 EUR (Art. 37.1.h: value received − acquisition).
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("720.00");
  });

  it("aggregate casillas stay sane for a fiat-bought coin sold as a permuta (no €35M)", () => {
    // End-to-end guard for the €35M aggregate bug: BUY 300 USDC paying EUR (lot
    // currency = EUR), SELL USDC for BTC (disposal currency = BTC). The headline
    // totals the USER sees — Valor de adquisición / net gain — must be sane, not
    // millions. A per-disposal unit test wouldn't catch an aggregation regression.
    const buy = makeCryptoTrade({
      tradeID: "buy-usdc", symbol: "USDC", currency: "EUR", buySell: "BUY", openCloseIndicator: "O",
      tradeDate: "2025-03-14", settlementDate: "2025-03-14", quantity: "300", tradePrice: "0.925",
      tradeMoney: "277.5", proceeds: "0", cost: "277.5", commissionCurrency: "EUR",
    });
    const sell = makeCryptoTrade({
      tradeID: "sell-usdc", symbol: "USDC", currency: "BTC", buySell: "SELL", openCloseIndicator: "C",
      tradeDate: "2025-04-06", settlementDate: "2025-04-06", quantity: "-300", tradePrice: "0.00001259",
      tradeMoney: "0.003777", proceeds: "0.003777", cost: "0", commissionCurrency: "BTC",
    });
    const rateMap = makeRateMap({
      "2025-03-14": { EUR: "1", BTC: "70000" },
      "2025-04-06": { EUR: "1", BTC: "78890.273739" },
    });
    const report = generateTaxReport(makeStatement([buy, sell]), rateMap, 2025);
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("277.50");   // NOT €21.9M
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("297.97");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("20.47");          // NOT −€35M
  });
});

describe("Binance plain SPOT trades → FIFO lots end-to-end (the ~€200 acquisition bug)", () => {
  const TX = "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark";

  function binanceToStatement(csv: string): FlexStatement {
    const p = binanceParser.parse(csv);
    return {
      accountId: "", fromDate: "", toDate: "", period: "",
      trades: p.trades, cashTransactions: p.cashTransactions,
      corporateActions: [], openPositions: [], securitiesInfo: [],
      ...(p.manualRateHints ? { manualRateHints: p.manualRateHints } : {}),
    };
  }

  it("THE BUG: a 2021 spot Buy (EUR) gives a lot the 2025 Sell consumes — no sin-lotes, real cost basis", () => {
    // Reproduces the user's symptom: spot buys were dropped → 2025 sell had cost
    // basis 0 → acquisition value collapsed to ~€200. Now the lot is found.
    const csv = [
      TX,
      "1,2021-05-01 10:00:00,Spot,Buy,DOGE,250,",
      "1,2021-05-01 10:00:00,Spot,Sell,EUR,-11.75,",
      "1,2021-05-01 10:00:00,Spot,Fee,DOGE,-0.25,",
      "1,2025-03-01 12:00:00,Spot,Sell Crypto to Fiat,DOGE,-250,Via CashBalance - Wallet/NX",
      "1,2025-03-01 12:00:00,Spot,Sell Crypto to Fiat,EUR,100,Via CashBalance - Wallet/NX",
    ].join("\n");
    const rateMap = makeRateMap({ "2021-05-01": { EUR: "1" }, "2025-03-01": { EUR: "1" } });
    const report = generateTaxReport(binanceToStatement(csv), rateMap, 2025);

    expect(report.capitalGains.disposals).toHaveLength(1);
    // The regression guard: NO "Venta sin lotes" (the user's exact error).
    expect(report.messages.some((m) => m.id === "fifo.sell_without_lots")).toBe(false);
    // Acquisition = the real EUR paid in 2021 (11.75), NOT 0 (the ~€200 collapse).
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("11.75");
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("100.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("88.25");
  });

  it("a coin bought via Convert is later sold via Sell Crypto to Fiat with a real cost basis (phases compose)", () => {
    // Lot created by phase 4 (Convert, paying USDT) and consumed by phase 6
    // (Sell Crypto to Fiat → EUR). Proves the new spot phase composes with the
    // pre-existing convert path — no sin-lotes, cost = the permuta acquisition value.
    const csv = [
      TX,
      "1,2024-01-10 10:00:00,Spot,Binance Convert,SOL,3,",
      "1,2024-01-10 10:00:00,Spot,Binance Convert,USDT,-300,",
      "1,2025-03-01 12:00:00,Spot,Sell Crypto to Fiat,SOL,-3,Via CashBalance - Wallet/NZ",
      "1,2025-03-01 12:00:00,Spot,Sell Crypto to Fiat,EUR,600,Via CashBalance - Wallet/NZ",
    ].join("\n");
    const rateMap = makeRateMap({ "2024-01-10": { USD: "0.9" }, "2025-03-01": { EUR: "1" } });
    const report = generateTaxReport(binanceToStatement(csv), rateMap, 2025);
    expect(report.messages.some((m) => m.id === "fifo.sell_without_lots")).toBe(false);
    expect(report.capitalGains.disposals).toHaveLength(1);
    // cost ≈ 300 USDT × 0.9 = €270; proceeds €600.
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("270.00");
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("600.00");
  });

  it("Commission History income lands in base general (Casilla 0304), valued via USD rate", () => {
    // USDT normalizes to USD → key the rate map on USD, never USDT.
    const csv = [TX, "1,2025-06-01 00:00:00,Spot,Commission History,USDT,10,Affiliate"].join("\n");
    const rateMap = makeRateMap({ "2025-06-01": { USD: "0.93" } });
    const report = generateTaxReport(binanceToStatement(csv), rateMap, 2025);
    // 10 USDT × 0.93 = 9.30 EUR as a general gain; not interest, not a disposal.
    expect(report.generalGains.total.toFixed(2)).toBe("9.30");
    expect(report.capitalGains.disposals).toHaveLength(0);
  });
});
