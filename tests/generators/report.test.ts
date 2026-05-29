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
  it("does not crash on crypto-denominated staking income and warns instead", () => {
    // Kraken staking rewards are paid in the staked coin (e.g. DOT), which has
    // no ECB rate. The report must skip them with a warning, not throw.
    const rates = makeRateMap({ "2025-06-01": "0.9200" });

    const statement = makeStatement({
      cashTransactions: [
        makeCashTx({
          transactionID: "stk-1",
          symbol: "DOT",
          description: "Staking reward - DOT",
          isin: "",
          currency: "DOT",
          dateTime: "20250601",
          settleDate: "20250601",
          amount: "5.5",
          type: "Broker Interest Received",
        }),
      ],
    });

    const report = generateTaxReport(statement, rates, 2025);

    // Crypto staking is excluded from computed interest (can't be valued).
    expect(report.interest.earned.toFixed(2)).toBe("0.00");
    expect(report.interest.entries).toHaveLength(0);
    // A warning tells the user to value it manually.
    expect(report.messages.some((m) => m.id === "report.crypto_income_unvalued")).toBe(true);
  });

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

    // SELL EUR.USD = selling EUR to acquire USD; BUY EUR.USD = buying EUR by disposing USD
    const statement = makeStatement({
      trades: [
        makeTrade({
          tradeID: "fx-sell", tradeDate: "2025-01-10", settlementDate: "2025-01-10",
          symbol: "EUR.USD", description: "EUR.USD", isin: "", assetCategory: "CASH",
          currency: "USD", quantity: "-5000", tradePrice: "1.0870", tradeMoney: "-5435",
          proceeds: "5435", buySell: "SELL", exchange: "IDEALFX",
        }),
        makeTrade({
          tradeID: "fx-buy", tradeDate: "2025-06-15", settlementDate: "2025-06-15",
          symbol: "EUR.USD", description: "EUR.USD", isin: "", assetCategory: "CASH",
          currency: "USD", quantity: "5000", tradePrice: "1.0526", tradeMoney: "5263",
          proceeds: "-5263", buySell: "BUY", exchange: "IDEALFX",
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

  it("should classify sell_without_lots as error with hint", () => {
    const rates = makeRateMap({ "2025-09-20": "0.91" });

    const statement = makeStatement({
      trades: [
        makeTrade({ tradeID: "1", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
      ],
    });

    const report = generateTaxReport(statement, rates, 2025);
    const msg = report.messages.find((m) => m.id === "fifo.sell_without_lots");
    expect(msg).toBeDefined();
    expect(msg!.severity).toBe("error");
    expect(msg!.hint).toBeTruthy();
  });

  it("should classify insufficient_lots as error with hint", () => {
    const rates = makeRateMap({
      "2025-03-15": "0.9200",
      "2025-09-20": "0.9100",
    });

    const statement = makeStatement({
      trades: [
        makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "5", tradePrice: "100", buySell: "BUY" }),
        makeTrade({ tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
      ],
    });

    const report = generateTaxReport(statement, rates, 2025);
    const msg = report.messages.find((m) => m.id === "fifo.insufficient_lots");
    expect(msg).toBeDefined();
    expect(msg!.severity).toBe("error");
    expect(msg!.hint).toBeTruthy();
  });

  it("should show reconciliation hint only when FX disposals exist", () => {
    const rates = makeRateMap({
      "2025-01-10": "0.9200",
      "2025-06-15": "0.9500",
    });

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
    const hint = report.messages.find((m) => m.id === "report.competitor_reconciliation");
    expect(hint).toBeDefined();
    expect(hint!.severity).toBe("info");
  });

  it("should NOT show reconciliation hint when skipFx is true", () => {
    const rates = makeRateMap({
      "2025-01-10": "0.9200",
      "2025-06-15": "0.9500",
    });

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

    const report = generateTaxReport(statement, rates, 2025, { skipFx: true });
    const hint = report.messages.find((m) => m.id === "report.competitor_reconciliation");
    expect(hint).toBeUndefined();
  });

  it("should NOT show reconciliation hint for EUR-only trades (no FX disposals)", () => {
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
    const hint = report.messages.find((m) => m.id === "report.competitor_reconciliation");
    expect(hint).toBeUndefined();
  });

  it("should keep warnings and messages in sync", () => {
    const rates = makeRateMap({ "2025-09-20": "0.91" });

    const statement = makeStatement({
      trades: [
        makeTrade({ tradeID: "1", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
      ],
    });

    const report = generateTaxReport(statement, rates, 2025);
    const nonHintMessages = report.messages.filter((m) => m.id !== "report.competitor_reconciliation");
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- verifying backward compat sync
    const warningsCount = report.warnings.length;
    expect(warningsCount).toBe(nonHintMessages.length);
  });

  describe("titulares (per-contribuyente split)", () => {
    function makeMixedStatement(): FlexStatement {
      return makeStatement({
        trades: [
          makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100", buySell: "BUY" }),
          makeTrade({ tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
        ],
        cashTransactions: [
          makeCashTx({ transactionID: "d1", dateTime: "20250601", amount: "100", type: "Dividends" }),
          makeCashTx({ transactionID: "w1", dateTime: "20250601", amount: "-15", type: "Withholding Tax" }),
          makeCashTx({
            transactionID: "i1", symbol: "", isin: "", description: "BROKER INTEREST",
            dateTime: "20250601", amount: "50", type: "Broker Interest Received",
          }),
        ],
      });
    }

    const splitRates = makeRateMap({
      "2025-03-15": "0.9200",
      "2025-09-20": "0.9100",
      "2025-06-01": "0.9200",
    });

    it("should halve every reported amount when titulares = 2", () => {
      const solo = generateTaxReport(makeMixedStatement(), splitRates, 2025);
      const split = generateTaxReport(makeMixedStatement(), splitRates, 2025, { titulares: 2 });

      expect(split.capitalGains.transmissionValue.toFixed(2))
        .toBe(solo.capitalGains.transmissionValue.div(2).toFixed(2));
      expect(split.capitalGains.acquisitionValue.toFixed(2))
        .toBe(solo.capitalGains.acquisitionValue.div(2).toFixed(2));
      expect(split.capitalGains.netGainLoss.toFixed(2))
        .toBe(solo.capitalGains.netGainLoss.div(2).toFixed(2));
      expect(split.dividends.grossIncome.toFixed(2))
        .toBe(solo.dividends.grossIncome.div(2).toFixed(2));
      expect(split.interest.earned.toFixed(2))
        .toBe(solo.interest.earned.div(2).toFixed(2));
      expect(split.doubleTaxation.deduction.toFixed(2))
        .toBe(solo.doubleTaxation.deduction.div(2).toFixed(2));

      // Per-operation amounts are split too (keeps the annex consistent).
      expect(split.capitalGains.disposals[0]!.proceedsEur.toFixed(2))
        .toBe(solo.capitalGains.disposals[0]!.proceedsEur.div(2).toFixed(2));
      expect(split.capitalGains.disposals[0]!.quantity.toFixed(2))
        .toBe(solo.capitalGains.disposals[0]!.quantity.div(2).toFixed(2));
    });

    it("should emit an info message about shared titularity when titulares > 1", () => {
      const split = generateTaxReport(makeMixedStatement(), splitRates, 2025, { titulares: 3 });
      const msg = split.messages.find((m) => m.id === "report.titularidad_compartida");
      expect(msg).toBeDefined();
      expect(msg!.severity).toBe("info");
      expect(msg!.context?.titulares).toBe("3");
    });

    it("should not change amounts or emit the message when titulares = 1", () => {
      const solo = generateTaxReport(makeMixedStatement(), splitRates, 2025);
      const explicit = generateTaxReport(makeMixedStatement(), splitRates, 2025, { titulares: 1 });

      expect(explicit.capitalGains.netGainLoss.toFixed(2)).toBe(solo.capitalGains.netGainLoss.toFixed(2));
      expect(explicit.messages.some((m) => m.id === "report.titularidad_compartida")).toBe(false);
    });

    it("should treat invalid titulares (<1 or fractional) as 1", () => {
      const solo = generateTaxReport(makeMixedStatement(), splitRates, 2025);
      const zero = generateTaxReport(makeMixedStatement(), splitRates, 2025, { titulares: 0 });
      const frac = generateTaxReport(makeMixedStatement(), splitRates, 2025, { titulares: 1.5 });

      expect(zero.capitalGains.netGainLoss.toFixed(2)).toBe(solo.capitalGains.netGainLoss.toFixed(2));
      // 1.5 floors to 1 → no split
      expect(frac.capitalGains.netGainLoss.toFixed(2)).toBe(solo.capitalGains.netGainLoss.toFixed(2));
    });

    it("should split FX disposals per contribuyente when titulares > 1", () => {
      const fxRates = makeRateMap({ "2025-01-10": "0.9200", "2025-06-15": "0.9500" });
      const fxStatement = makeStatement({
        trades: [
          makeTrade({
            tradeID: "fx-sell", tradeDate: "2025-01-10", settlementDate: "2025-01-10",
            symbol: "EUR.USD", description: "EUR.USD", isin: "", assetCategory: "CASH",
            currency: "USD", quantity: "-5000", tradePrice: "1.0870", tradeMoney: "-5435",
            proceeds: "5435", buySell: "SELL", exchange: "IDEALFX",
          }),
          makeTrade({
            tradeID: "fx-buy", tradeDate: "2025-06-15", settlementDate: "2025-06-15",
            symbol: "EUR.USD", description: "EUR.USD", isin: "", assetCategory: "CASH",
            currency: "USD", quantity: "5000", tradePrice: "1.0526", tradeMoney: "5263",
            proceeds: "-5263", buySell: "BUY", exchange: "IDEALFX",
          }),
        ],
      });

      const solo = generateTaxReport(fxStatement, fxRates, 2025);
      const split = generateTaxReport(fxStatement, fxRates, 2025, { titulares: 2 });

      expect(solo.fxGains.disposals.length).toBeGreaterThan(0);
      expect(split.fxGains.disposals.length).toBe(solo.fxGains.disposals.length);
      expect(split.fxGains.netGainLoss.toFixed(2)).toBe(solo.fxGains.netGainLoss.div(2).toFixed(2));
      expect(split.fxGains.transmissionValue.toFixed(2)).toBe(solo.fxGains.transmissionValue.div(2).toFixed(2));
      expect(split.fxGains.disposals[0]!.gainLossEur.toFixed(2))
        .toBe(solo.fxGains.disposals[0]!.gainLossEur.div(2).toFixed(2));
    });

    it("should keep titulares=3 split consistent (each third reconciles to the whole)", () => {
      const solo = generateTaxReport(makeMixedStatement(), splitRates, 2025);
      const split = generateTaxReport(makeMixedStatement(), splitRates, 2025, { titulares: 3 });

      // Each titular's net × 3 reconciles to the undivided total (within Decimal rounding).
      const reconstructed = split.capitalGains.netGainLoss.times(3);
      expect(reconstructed.toFixed(2)).toBe(solo.capitalGains.netGainLoss.toFixed(2));
      expect(split.dividends.grossIncome.times(3).toFixed(2))
        .toBe(solo.dividends.grossIncome.toFixed(2));
    });

    it("titulares=2 halves interest paid (Broker Interest Paid path)", () => {
      // The existing makeMixedStatement() only has Broker Interest Received.
      // This test exercises the paid-interest split path which was previously untested.
      const stmtWithPaid = makeStatement({
        trades: [
          makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100", buySell: "BUY" }),
          makeTrade({ tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
        ],
        cashTransactions: [
          makeCashTx({
            transactionID: "i1", symbol: "", isin: "", description: "BROKER INTEREST",
            dateTime: "20250601", amount: "50", type: "Broker Interest Received",
          }),
          makeCashTx({
            transactionID: "p1", symbol: "", isin: "", description: "MARGIN INTEREST EXPENSE",
            dateTime: "20250601", amount: "-40", type: "Broker Interest Paid",
          }),
        ],
      });

      const solo = generateTaxReport(stmtWithPaid, splitRates, 2025);
      const split = generateTaxReport(stmtWithPaid, splitRates, 2025, { titulares: 2 });

      // Paid path: 40 × 0.92 = 36.80 (abs). Solo paid = 36.80; split = 18.40.
      expect(solo.interest.paid.toFixed(2)).toBe("36.80");
      expect(split.interest.paid.toFixed(2)).toBe(solo.interest.paid.div(2).toFixed(2));

      // Earned path is unchanged in ratio
      expect(split.interest.earned.toFixed(2)).toBe(solo.interest.earned.div(2).toFixed(2));

      // Both entries appear in the split (per-entry amounts are also halved)
      expect(split.interest.entries).toHaveLength(2);
      const paidEntry = split.interest.entries.find((e) => e.type === "paid");
      expect(paidEntry).toBeDefined();
      expect(paidEntry!.amountEur.toFixed(2)).toBe(solo.interest.paid.div(2).toFixed(2));
    });

    it("titulares=2 halves a net capital loss and preserves the negative sign", () => {
      // Disposals that produce a net loss: sell below cost basis.
      // solo net = 10 × 80 × 0.91 − 10 × 100 × 0.92 = 728 − 920 = −192 EUR
      const lossRates = makeRateMap({
        "2025-03-15": "0.9200",
        "2025-09-20": "0.9100",
      });
      const lossStatement = makeStatement({
        trades: [
          makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100", buySell: "BUY" }),
          makeTrade({ tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "80", buySell: "SELL" }),
        ],
      });

      const solo = generateTaxReport(lossStatement, lossRates, 2025);
      const split = generateTaxReport(lossStatement, lossRates, 2025, { titulares: 2 });

      // Verify the solo loss is negative to guard the fixture itself
      expect(solo.capitalGains.netGainLoss.isNegative()).toBe(true);

      // Split must be exactly half
      expect(split.capitalGains.netGainLoss.toFixed(2))
        .toBe(solo.capitalGains.netGainLoss.div(2).toFixed(2));

      // Sign must be preserved (each titular's loss is still negative)
      expect(split.capitalGains.netGainLoss.isNegative()).toBe(true);

      // Per-disposal gainLossEur is also negative and halved
      expect(split.capitalGains.disposals[0]!.gainLossEur.isNegative()).toBe(true);
      expect(split.capitalGains.disposals[0]!.gainLossEur.toFixed(2))
        .toBe(solo.capitalGains.disposals[0]!.gainLossEur.div(2).toFixed(2));
    });

    it("titulares=2 splits the double-taxation deduction linearly when the foreign treaty cap binds", () => {
      // Art. 80 LIRPF: the deduction is the LESSER of (a) creditable foreign tax
      // and (b) the Spanish savings tax owed on that foreign income at the
      // effective rate of the titular's total savings base.
      //
      // This fixture deliberately straddles the 6 000 EUR savings bracket so the
      // solo base is in the 21 % band while the per-titular base (solo/2) is in the
      // 19 % band. One might expect that to make the deduction NON-linear in N.
      // It does NOT here, because cap (a) — the foreign treaty withholding — is the
      // binding constraint at both bases, and the withholding scales exactly 1/N:
      //   Dividends = 4 000 USD × 0.92 = 3 680 EUR gross per entry × 2 = 7 360 EUR
      //   Withholding = 600 USD × 0.92 = 552 EUR per entry × 2 = 1 104 EUR (US 15 % treaty)
      //   Capital gain = 10 × 120 × 0.91 − 10 × 100 × 0.92 = 172 EUR
      //   Interest earned = 50 × 0.92 = 46 EUR
      //   Solo savings base = 172 + 7 360 + 46 = 7 578 EUR  (21 % band)
      //   Per-titular base  = 7 578 / 2 = 3 789 EUR        (19 % band)
      // Spanish-tax cap (b) at either base (~19–21 % of 7 360 ≈ 1 400+) exceeds the
      // 1 104 EUR foreign withholding, so cap (a) wins and the deduction = withholding,
      // which halves cleanly: solo = 1 104.00, split = 552.00, split × 2 = solo.
      // The progressive bracket only changes the result when the Spanish cap binds
      // (low foreign withholding) — covered conceptually here; we pin the observed
      // treaty-capped values to lock the behaviour against regressions.
      const bigDividendRates = makeRateMap({
        "2025-03-15": "0.9200",
        "2025-09-20": "0.9100",
        "2025-06-01": "0.9200",
      });
      const bigDividendStatement = makeStatement({
        trades: [
          makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100", buySell: "BUY" }),
          makeTrade({ tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
        ],
        cashTransactions: [
          // Two dividend entries from US (AAPL) — large enough to push solo base > 6 000
          makeCashTx({ transactionID: "d1", dateTime: "20250601", amount: "4000", type: "Dividends" }),
          makeCashTx({ transactionID: "w1", dateTime: "20250601", amount: "-600", type: "Withholding Tax" }),
          makeCashTx({ transactionID: "d2", dateTime: "20250601", amount: "4000", type: "Dividends" }),
          makeCashTx({ transactionID: "w2", dateTime: "20250601", amount: "-600", type: "Withholding Tax" }),
          makeCashTx({
            transactionID: "i1", symbol: "", isin: "", description: "BROKER INTEREST",
            dateTime: "20250601", amount: "50", type: "Broker Interest Received",
          }),
        ],
      });

      const solo = generateTaxReport(bigDividendStatement, bigDividendRates, 2025);
      const split = generateTaxReport(bigDividendStatement, bigDividendRates, 2025, { titulares: 2 });

      // Sanity: solo savings base is above 6 000 (crosses into the 21 % band)
      const soloBase = solo.capitalGains.netGainLoss
        .plus(solo.dividends.grossIncome)
        .plus(solo.interest.earned);
      expect(soloBase.greaterThan(6000)).toBe(true);

      // Per-titular base is below 6 000 (stays in the 19 % band)
      const perTitularBase = soloBase.div(2);
      expect(perTitularBase.lessThan(6000)).toBe(true);

      // Deduction = creditable foreign withholding (1 104 EUR), the binding cap here.
      expect(solo.doubleTaxation.deduction.toFixed(2)).toBe("1104.00");
      expect(split.doubleTaxation.deduction.toFixed(2)).toBe("552.00");

      // Each titular's deduction never exceeds their share of the withholding.
      expect(
        split.doubleTaxation.deduction.lessThanOrEqualTo(solo.doubleTaxation.deduction),
      ).toBe(true);

      // When the foreign cap binds, the split is exactly linear (withholding scales 1/N),
      // even though the bases straddle the 6 000 EUR bracket. Locks the behaviour so a
      // regression to a base-independent / wrongly-scaled deduction is caught.
      expect(split.doubleTaxation.deduction.times(2).toFixed(2)).toBe(
        solo.doubleTaxation.deduction.toFixed(2),
      );
    });
  });
});
