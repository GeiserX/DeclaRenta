import { describe, it, expect } from "vitest";
import { calculateDividends } from "../../src/engine/dividends.js";
import type { CashTransaction } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

function makeCashTx(overrides: Partial<CashTransaction>): CashTransaction {
  return {
    transactionID: "1",
    accountId: "U1",
    symbol: "AAPL",
    description: "APPLE INC",
    isin: "US0378331005",
    currency: "USD",
    dateTime: "20250601",
    settleDate: "20250603",
    amount: "100",
    fxRateToBase: "0.92",
    type: "Dividends",
    ...overrides,
  };
}

describe("calculateDividends", () => {
  it("should calculate dividend with matching withholding tax", () => {
    const rates = makeRateMap({ "2025-06-01": { USD: "0.92" } });

    const transactions: CashTransaction[] = [
      makeCashTx({ transactionID: "1", amount: "100", type: "Dividends" }),
      makeCashTx({ transactionID: "2", amount: "-15", type: "Withholding Tax" }),
    ];

    const entries = calculateDividends(transactions, rates);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.grossAmountEur.toFixed(2)).toBe("92.00");
    expect(entries[0]!.withholdingTaxEur.toFixed(2)).toBe("13.80");
    expect(entries[0]!.symbol).toBe("AAPL");
  });

  it("should handle dividend without withholding", () => {
    const rates = makeRateMap({ "2025-06-01": { USD: "0.92" } });

    const transactions: CashTransaction[] = [
      makeCashTx({ transactionID: "1", amount: "50", type: "Dividends" }),
    ];

    const entries = calculateDividends(transactions, rates);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.withholdingTaxEur.toFixed(2)).toBe("0.00");
  });

  it("should handle EUR dividends (rate = 1)", () => {
    const rates: EcbRateMap = new Map();

    const transactions: CashTransaction[] = [
      makeCashTx({ transactionID: "1", currency: "EUR", amount: "200", type: "Dividends" }),
      makeCashTx({ transactionID: "2", currency: "EUR", amount: "-30", type: "Withholding Tax" }),
    ];

    const entries = calculateDividends(transactions, rates);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.grossAmountEur.toFixed(2)).toBe("200.00");
    expect(entries[0]!.withholdingTaxEur.toFixed(2)).toBe("30.00");
  });

  it("should handle Payment In Lieu of Dividends", () => {
    const rates = makeRateMap({ "2025-06-01": { USD: "0.92" } });

    const transactions: CashTransaction[] = [
      makeCashTx({ transactionID: "1", amount: "75", type: "Payment In Lieu Of Dividends" }),
    ];

    const entries = calculateDividends(transactions, rates);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.grossAmountEur.toFixed(2)).toBe("69.00");
  });

  it("should match withholding by ISIN and date proximity", () => {
    const rates = makeRateMap({
      "2025-06-01": { USD: "0.92" },
      "2025-06-03": { USD: "0.91" },
    });

    const transactions: CashTransaction[] = [
      makeCashTx({ transactionID: "1", dateTime: "20250601", amount: "100", type: "Dividends" }),
      // Withholding 2 days later — should match (within 7 days)
      makeCashTx({ transactionID: "2", dateTime: "20250603", amount: "-15", type: "Withholding Tax" }),
    ];

    const entries = calculateDividends(transactions, rates);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.withholdingTaxEur.toFixed(2)).toBe("13.80");
  });

  it("should not match withholding with different ISIN", () => {
    const rates = makeRateMap({ "2025-06-01": { USD: "0.92" } });

    const transactions: CashTransaction[] = [
      makeCashTx({ transactionID: "1", isin: "US0378331005", amount: "100", type: "Dividends" }),
      makeCashTx({ transactionID: "2", isin: "US5949181045", amount: "-15", type: "Withholding Tax" }),
    ];

    const entries = calculateDividends(transactions, rates);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.withholdingTaxEur.toFixed(2)).toBe("0.00");
  });

  it("should ignore non-dividend transaction types", () => {
    const rates = makeRateMap({ "2025-06-01": { USD: "0.92" } });

    const transactions: CashTransaction[] = [
      makeCashTx({ transactionID: "1", type: "Broker Interest Received", amount: "50" }),
      makeCashTx({ transactionID: "2", type: "Dividends", amount: "100" }),
    ];

    const entries = calculateDividends(transactions, rates);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.grossAmountEur.toFixed(2)).toBe("92.00");
  });

  describe("Withholding country extraction", () => {
    it("should extract country code from description with Tax pattern", () => {
      const rates = makeRateMap({ "2025-06-01": { USD: "0.92" } });

      const transactions: CashTransaction[] = [
        makeCashTx({
          transactionID: "1",
          amount: "100",
          type: "Dividends",
          description: "US Tax - APPLE INC",
        }),
      ];

      const entries = calculateDividends(transactions, rates);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.withholdingCountry).toBe("US");
    });

    it("should default to XX when no country pattern matches", () => {
      const rates = makeRateMap({ "2025-06-01": { USD: "0.92" } });

      const transactions: CashTransaction[] = [
        makeCashTx({
          transactionID: "1",
          amount: "100",
          type: "Dividends",
          description: "SOME DIVIDEND",
        }),
      ];

      const entries = calculateDividends(transactions, rates);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.withholdingCountry).toBe("XX");
    });
  });
});
