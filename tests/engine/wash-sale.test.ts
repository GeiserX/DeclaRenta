import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { detectWashSales } from "../../src/engine/wash-sale.js";
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
    exchange: "NASDAQ", commissionCurrency: "USD", commission: "0", taxes: "0",
  };
}

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
});
