import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { detectWashSales, addMonths } from "../../src/engine/wash-sale.js";
import type { FifoDisposal } from "../../src/types/tax.js";
import type { Trade } from "../../src/types/ibkr.js";

function makeDisposal(overrides: Partial<FifoDisposal>): FifoDisposal {
  return {
    isin: "US0378331005",
    symbol: "AAPL",
    description: "APPLE INC",
    sellDate: "2025-06-15",
    acquireDate: "2025-01-10",
    quantity: new Decimal(10),
    proceedsEur: new Decimal(900),
    costBasisEur: new Decimal(1000),
    gainLossEur: new Decimal(-100),
    holdingPeriodDays: 156,
    currency: "USD",
    sellEcbRate: new Decimal("0.91"),
    acquireEcbRate: new Decimal("0.92"),
    assetCategory: "STK",
    washSaleBlocked: false,
    ...overrides,
  };
}

function makeTrade(isin: string, date: string, buySell: "BUY" | "SELL"): Trade {
  return {
    tradeID: "1", accountId: "U1", symbol: "AAPL", description: "APPLE INC",
    isin, assetCategory: "STK", currency: "USD", tradeDate: date,
    settlementDate: date, quantity: "10", tradePrice: "100",
    tradeMoney: "1000", proceeds: "1000", cost: "1000",
    fifoPnlRealized: "0", fxRateToBase: "1", buySell,
    openCloseIndicator: buySell === "BUY" ? "O" : "C",
    exchange: "NASDAQ", commissionCurrency: "USD", commission: "0", taxes: "0", multiplier: "1",
  };
}

describe("addMonths (calendar-clamped)", () => {
  it("clamps Jan 31 + 1 month to the last day of February (non-leap)", () => {
    const result = addMonths(new Date(2025, 0, 31), 1); // 2025-01-31, Feb 2025 = 28d
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(28); // clamped, NOT Mar 2/3
  });

  it("clamps Jan 31 + 1 month to Feb 29 in a leap year", () => {
    const result = addMonths(new Date(2024, 0, 31), 1); // 2024-01-31, Feb 2024 = 29d
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(29);
  });

  it("clamps Dec 31 + 2 months to the last day of February next year", () => {
    const result = addMonths(new Date(2025, 11, 31), 2); // 2025-12-31 → Feb 2026
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(28); // clamped, NOT Mar 2/3
  });

  it("clamps Mar 31 - 1 month to the last day of February (no overflow)", () => {
    const result = addMonths(new Date(2025, 2, 31), -1); // 2025-03-31 → Feb 2025
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(28);
  });

  it("preserves the day when the target month is long enough", () => {
    const result = addMonths(new Date(2025, 0, 15), 1); // 2025-01-15 → 2025-02-15
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(15);
  });
});

describe("detectWashSales", () => {
  it("should block loss when repurchased within 2 months after sale", () => {
    const disposals = [makeDisposal({ sellDate: "2025-06-15", gainLossEur: new Decimal(-100) })];
    const trades = [
      makeTrade("US0378331005", "2025-06-15", "SELL"),
      makeTrade("US0378331005", "2025-07-01", "BUY"), // Repurchase 16 days later
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(true);
  });

  it("should block loss when purchased within 2 months before sale", () => {
    const disposals = [makeDisposal({ sellDate: "2025-06-15", gainLossEur: new Decimal(-100) })];
    const trades = [
      makeTrade("US0378331005", "2025-05-20", "BUY"), // Purchase 26 days before
      makeTrade("US0378331005", "2025-06-15", "SELL"),
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(true);
  });

  it("should NOT block loss when no repurchase within 2 months", () => {
    const disposals = [makeDisposal({ sellDate: "2025-06-15", gainLossEur: new Decimal(-100) })];
    const trades = [
      makeTrade("US0378331005", "2025-01-10", "BUY"), // Original purchase (>2 months before)
      makeTrade("US0378331005", "2025-06-15", "SELL"),
      makeTrade("US0378331005", "2025-12-01", "BUY"), // >2 months after
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(false);
  });

  it("should NOT block gains", () => {
    const disposals = [makeDisposal({ gainLossEur: new Decimal(200) })];
    const trades = [
      makeTrade("US0378331005", "2025-06-15", "SELL"),
      makeTrade("US0378331005", "2025-06-20", "BUY"),
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(false);
  });

  it("should NOT block loss for different ISIN", () => {
    const disposals = [makeDisposal({ sellDate: "2025-06-15", gainLossEur: new Decimal(-100) })];
    const trades = [
      makeTrade("US0378331005", "2025-06-15", "SELL"),
      makeTrade("US5949181045", "2025-06-20", "BUY"), // Different ISIN (MSFT)
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(false);
  });

  it("should block loss for empty-ISIN trades using symbol fallback", () => {
    const disposals = [makeDisposal({
      isin: "",
      symbol: "AAPL",
      sellDate: "2025-06-15",
      gainLossEur: new Decimal(-100),
    })];
    const trades = [
      { ...makeTrade("", "2025-06-15", "SELL"), symbol: "AAPL", isin: "" },
      { ...makeTrade("", "2025-07-01", "BUY"), symbol: "AAPL", isin: "" },
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(true);
  });

  it("should NOT match empty-ISIN trades with different symbols", () => {
    const disposals = [makeDisposal({
      isin: "",
      symbol: "AAPL",
      sellDate: "2025-06-15",
      gainLossEur: new Decimal(-100),
    })];
    const trades = [
      { ...makeTrade("", "2025-06-15", "SELL"), symbol: "AAPL", isin: "" },
      { ...makeTrade("", "2025-07-01", "BUY"), symbol: "MSFT", isin: "" },
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(false);
  });

  it("should use 1-year window for CRYPTO asset category", () => {
    const disposals = [makeDisposal({
      isin: "",
      symbol: "BTC",
      assetCategory: "CRYPTO",
      sellDate: "2025-06-15",
      gainLossEur: new Decimal(-500),
    })];
    const trades = [
      { ...makeTrade("", "2025-06-15", "SELL"), symbol: "BTC", isin: "", assetCategory: "CRYPTO" as const },
      { ...makeTrade("", "2026-03-01", "BUY"), symbol: "BTC", isin: "", assetCategory: "CRYPTO" as const },
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(true);
  });

  it("should use 1-year window for unlisted (no-ISIN, non-crypto) asset", () => {
    // STK with NO ISIN → treated as unlisted → 12-month window.
    const disposals = [makeDisposal({
      isin: "",
      symbol: "PRIVCO",
      assetCategory: "STK",
      sellDate: "2025-06-15",
      gainLossEur: new Decimal(-300),
    })];
    const trades = [
      { ...makeTrade("", "2025-06-15", "SELL"), symbol: "PRIVCO", isin: "" },
      // Repurchase ~9 months later: outside 2mo, inside 12mo window.
      { ...makeTrade("", "2026-03-01", "BUY"), symbol: "PRIVCO", isin: "" },
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(true);
  });

  it("should use 2-month window for listed STK with a real ISIN (no 12mo block)", () => {
    const disposals = [makeDisposal({
      isin: "US0378331005",
      symbol: "AAPL",
      assetCategory: "STK",
      sellDate: "2025-06-15",
      gainLossEur: new Decimal(-100),
    })];
    const trades = [
      makeTrade("US0378331005", "2025-06-15", "SELL"),
      // ~9 months later: outside the 2-month listed window → not blocked.
      makeTrade("US0378331005", "2026-03-01", "BUY"),
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(false);
  });

  it("should NOT block loss for options (OPT assetCategory)", () => {
    const disposals = [makeDisposal({
      sellDate: "2025-06-15",
      gainLossEur: new Decimal(-500),
      assetCategory: "OPT",
      symbol: "AAPL 250620C00200000",
    })];
    const trades = [
      makeTrade("US0378331005", "2025-06-15", "SELL"),
      makeTrade("US0378331005", "2025-06-20", "BUY"), // Same ISIN repurchase
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(false); // Options excluded
  });
});
