import { describe, it, expect } from "vitest";
import { generateTaxReport } from "../../src/generators/report.js";
import type { FlexStatement, Trade, CashTransaction } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

function makeRateMap(rates: Record<string, string>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, rate] of Object.entries(rates)) {
    map.set(date, new Map([["USD", rate]]));
  }
  return map;
}

function makeTrade(overrides: Partial<Trade>): Trade {
  const tradeDate = overrides.tradeDate ?? "2025-03-15";
  return {
    tradeID: "1",
    accountId: "U1",
    symbol: "AAPL",
    description: "APPLE INC",
    isin: "US0378331005",
    assetCategory: "STK",
    currency: "USD",
    tradeDate,
    settlementDate: tradeDate,
    quantity: "10",
    tradePrice: "100",
    tradeMoney: "1000",
    proceeds: "1000",
    cost: "1000",
    fifoPnlRealized: "0",
    fxRateToBase: "0.92",
    buySell: "BUY",
    openCloseIndicator: overrides.buySell === "SELL" ? "C" : "O",
    exchange: "NASDAQ",
    commissionCurrency: "USD",
    commission: "0",
    taxes: "0",
    multiplier: "1",
    ...overrides,
  };
}

function makeCashTx(overrides: Partial<CashTransaction>): CashTransaction {
  const dateTime = overrides.dateTime ?? "20250601";
  return {
    transactionID: "1",
    accountId: "U1",
    symbol: "AAPL",
    description: "APPLE INC",
    isin: "US0378331005",
    currency: "USD",
    dateTime,
    settleDate: dateTime,
    amount: "100",
    fxRateToBase: "0.92",
    type: "Dividends",
    ...overrides,
  };
}

function makeStatement(overrides?: Partial<FlexStatement>): FlexStatement {
  return {
    accountId: "U1",
    fromDate: "20250101",
    toDate: "20251231",
    period: "Annual",
    trades: [],
    cashTransactions: [],
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
    ...overrides,
  };
}

describe("generateTaxReport", () => {
  it("should produce capital gains from buy+sell trades", () => {
    const rates = makeRateMap({
      "2025-03-15": "0.9200",
      "2025-09-20": "0.9100",
    });

    const statement = makeStatement({
      trades: [
        makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100", buySell: "BUY" }),
        makeTrade({ tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
      ],
    });

    const report = generateTaxReport(statement, rates, 2025);

    expect(report.year).toBe(2025);
    // Proceeds: 10 × 120 × 0.91 = 1092
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("1092.00");
    // Cost: 10 × 100 × 0.92 = 920
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("920.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("172.00");
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.blockedLosses.toFixed(2)).toBe("0.00");
  });

  it("should filter disposals by target year", () => {
    const rates = makeRateMap({
      "2024-06-15": "0.9200",
      "2024-09-20": "0.9100",
    });

    const statement = makeStatement({
      trades: [
        makeTrade({ tradeID: "1", tradeDate: "2024-06-15", quantity: "10", tradePrice: "100", buySell: "BUY" }),
        makeTrade({ tradeID: "2", tradeDate: "2024-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
      ],
    });

    // Ask for 2025 — should have 0 disposals since trades are in 2024
    const report = generateTaxReport(statement, rates, 2025);
    expect(report.capitalGains.disposals).toHaveLength(0);
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("0.00");
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("0.00");
  });

  it("should calculate dividends and withholding", () => {
    const rates = makeRateMap({ "2025-06-01": "0.9200" });

    const statement = makeStatement({
      cashTransactions: [
        makeCashTx({ transactionID: "1", amount: "100", type: "Dividends" }),
        makeCashTx({ transactionID: "2", amount: "-15", type: "Withholding Tax" }),
      ],
    });

    const report = generateTaxReport(statement, rates, 2025);

    // Gross: 100 × 0.92 = 92.00
    expect(report.dividends.grossIncome.toFixed(2)).toBe("92.00");
    expect(report.dividends.entries).toHaveLength(1);
    expect(report.dividends.entries[0]!.withholdingTaxEur.toFixed(2)).toBe("13.80");
  });

  it("should calculate interest earned and paid", () => {
    const rates = makeRateMap({ "2025-08-15": "0.9100" });

    const statement = makeStatement({
      cashTransactions: [
        makeCashTx({
          transactionID: "3", symbol: "", isin: "", description: "BROKER INTEREST",
          dateTime: "20250815", amount: "50", type: "Broker Interest Received",
        }),
        makeCashTx({
          transactionID: "4", symbol: "", isin: "", description: "MARGIN INTEREST",
          dateTime: "20250815", amount: "-20", type: "Broker Interest Paid",
        }),
      ],
    });

    const report = generateTaxReport(statement, rates, 2025);

    // Interest earned: 50 × 0.91 = 45.50
    expect(report.interest.earned.toFixed(2)).toBe("45.50");
    // Interest paid: 20 × 0.91 = 18.20
    expect(report.interest.paid.toFixed(2)).toBe("18.20");
    expect(report.interest.entries).toHaveLength(2);
  });

  it("should calculate double taxation deduction", () => {
    const rates = makeRateMap({ "2025-06-01": "0.9200" });

    const statement = makeStatement({
      cashTransactions: [
        makeCashTx({ transactionID: "1", amount: "100", type: "Dividends" }),
        makeCashTx({ transactionID: "2", amount: "-15", type: "Withholding Tax" }),
      ],
    });

    const report = generateTaxReport(statement, rates, 2025);

    // Withholding: 15 × 0.92 = 13.80
    expect(report.doubleTaxation.deduction.toFixed(2)).toBe("13.80");
  });

  it("should propagate FIFO engine warnings", () => {
    const rates = makeRateMap({ "2025-09-20": "0.91" });

    const statement = makeStatement({
      trades: [
        makeTrade({ tradeID: "1", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
      ],
    });

    const report = generateTaxReport(statement, rates, 2025);
    const fifoErrors = report.messages.filter((m) => m.id === "fifo.sell_without_lots");
    expect(fifoErrors).toHaveLength(1);
    expect(fifoErrors[0]!.message).toContain("Venta sin lotes");
    expect(fifoErrors[0]!.severity).toBe("error");
  });

  it("should handle empty statement", () => {
    const rates: EcbRateMap = new Map();
    const statement = makeStatement();
    const report = generateTaxReport(statement, rates, 2025);

    expect(report.year).toBe(2025);
    expect(report.capitalGains.disposals).toHaveLength(0);
    expect(report.dividends.entries).toHaveLength(0);
    expect(report.interest.entries).toHaveLength(0);
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("0.00");
    expect(report.dividends.grossIncome.toFixed(2)).toBe("0.00");
  });

  it("should skip FX engine when skipFx is true (monodivisa mode)", () => {
    const rates = makeRateMap({
      "2025-03-15": "0.9200",
      "2025-09-20": "0.9100",
    });

    const statement = makeStatement({
      trades: [
        makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100", buySell: "BUY" }),
        makeTrade({ tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
      ],
    });

    const report = generateTaxReport(statement, rates, 2025, { skipFx: true });

    expect(report.fxGains.disposals).toHaveLength(0);
    expect(report.fxGains.transmissionValue.toFixed(2)).toBe("0.00");
    expect(report.fxGains.acquisitionValue.toFixed(2)).toBe("0.00");
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("0.00");
    // Capital gains still computed normally
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("172.00");
  });

  it("should produce non-zero FX gains when skipFx is false with manual CASH trades", () => {
    const rates = makeRateMap({
      "2025-01-10": "0.9200",
      "2025-06-15": "0.9500",
    });

    // Include a manual CASH BUY (acquire USD) and CASH SELL (dispose USD)
    // to bypass auto-convert detection and produce real FX disposals
    const statement = makeStatement({
      trades: [
        makeTrade({
          tradeID: "fx-buy", tradeDate: "2025-01-10", settlementDate: "2025-01-10",
          symbol: "EUR.USD", description: "EUR.USD", isin: "", assetCategory: "CASH",
          currency: "USD", quantity: "5000", tradePrice: "1.0870", tradeMoney: "5000",
          proceeds: "-5000", buySell: "BUY", exchange: "IDEALFX",
        }),
        makeTrade({
          tradeID: "fx-sell", tradeDate: "2025-06-15", settlementDate: "2025-06-15",
          symbol: "EUR.USD", description: "EUR.USD", isin: "", assetCategory: "CASH",
          currency: "USD", quantity: "-5000", tradePrice: "1.0526", tradeMoney: "-5000",
          proceeds: "5000", buySell: "SELL", exchange: "IDEALFX",
        }),
      ],
    });

    const report = generateTaxReport(statement, rates, 2025);
    const reportExplicit = generateTaxReport(statement, rates, 2025, { skipFx: false });

    // Both should be identical — default is no skip
    expect(report.fxGains.disposals.length).toBe(reportExplicit.fxGains.disposals.length);
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe(reportExplicit.fxGains.netGainLoss.toFixed(2));

    // Must produce non-zero FX gains (USD appreciated from 0.92 to 0.95 EUR per USD)
    expect(report.fxGains.disposals.length).toBeGreaterThan(0);
    expect(report.fxGains.netGainLoss.toNumber()).not.toBe(0);
  });

  it("should suppress FX warnings when no FX disposals exist in target year", () => {
    const rates = makeRateMap({
      "2025-03-28": "0.9234",
      "2025-04-01": "0.9234",
    });

    // Manual USD SELL in 2025 with no prior lots → engine produces warning
    // But target year is 2026 → no disposals in 2026 → warning suppressed
    const statement = makeStatement({
      trades: [
        makeTrade({
          tradeID: "fx1", tradeDate: "2025-03-28", settlementDate: "2025-04-01",
          symbol: "EUR.USD", description: "EUR.USD", isin: "", assetCategory: "CASH",
          currency: "USD", quantity: "-998", tradePrice: "1.0824", tradeMoney: "-1080.24",
          proceeds: "1080.24", buySell: "SELL", exchange: "IDEALFX",
        }),
      ],
    });

    const report = generateTaxReport(statement, rates, 2026);
    expect(report.fxGains.disposals).toHaveLength(0);
    expect(report.messages).toHaveLength(0);
  });

  it("should not include FX warnings when skipFx is true", () => {
    const rates = makeRateMap({ "2025-09-20": "0.91" });

    const statement = makeStatement({
      trades: [
        makeTrade({ tradeID: "1", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
      ],
    });

    const report = generateTaxReport(statement, rates, 2025, { skipFx: true });

    // FIFO error still present (sell without prior buy)
    expect(report.messages.some((m) => m.message.includes("Venta sin lotes"))).toBe(true);
    // But no FX-related messages (no FX engine ran)
    expect(report.messages.some((m) => m.message.includes("sin lotes previos de USD"))).toBe(false);
  });
});
