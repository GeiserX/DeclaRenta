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

  it("matches each dividend to its own withholding across multiple issuers and dates", () => {
    // Multi-issuer, multi-date input. Withholdings are interleaved so the order
    // is not naturally aligned with the dividends — verifies the index pairs by
    // ISIN + currency + 7-day proximity rather than positional order. Includes
    // one unmatched withholding (different ISIN) and one unmatched dividend.
    const rates = makeRateMap({
      "2025-03-10": { USD: "0.90" },
      "2025-06-01": { USD: "0.92" },
      "2025-09-15": { USD: "0.85" },
    });

    const transactions: CashTransaction[] = [
      // AAPL dividend + its withholding 2 days later (within window)
      makeCashTx({
        transactionID: "1",
        isin: "US0378331005",
        symbol: "AAPL",
        dateTime: "20250601",
        amount: "100",
        type: "Dividends",
      }),
      // MSFT dividend with NO withholding present → unmatched dividend
      makeCashTx({
        transactionID: "2",
        isin: "US5949181045",
        symbol: "MSFT",
        dateTime: "20250310",
        amount: "200",
        type: "Dividends",
      }),
      // KO withholding with NO matching dividend (KO never pays) → unmatched WHT
      makeCashTx({
        transactionID: "3",
        isin: "US1912161007",
        symbol: "KO",
        dateTime: "20250915",
        amount: "-9",
        type: "Withholding Tax",
      }),
      // AAPL withholding, 2 days after the AAPL dividend
      makeCashTx({
        transactionID: "4",
        isin: "US0378331005",
        symbol: "AAPL",
        dateTime: "20250603",
        amount: "-15",
        type: "Withholding Tax",
      }),
    ];

    const entries = calculateDividends(transactions, rates);

    // Two dividends in, two entries out, in dividend input order.
    expect(entries).toHaveLength(2);

    // AAPL paired with its own withholding (15 USD * 0.92 = 13.80).
    expect(entries[0]!.symbol).toBe("AAPL");
    expect(entries[0]!.grossAmountEur.toFixed(2)).toBe("92.00");
    expect(entries[0]!.withholdingTaxEur.toFixed(2)).toBe("13.80");

    // MSFT has no withholding → 0; the KO withholding is never borrowed.
    expect(entries[1]!.symbol).toBe("MSFT");
    expect(entries[1]!.grossAmountEur.toFixed(2)).toBe("180.00");
    expect(entries[1]!.withholdingTaxEur.toFixed(2)).toBe("0.00");
  });

  it("locks indexed matching on a larger interleaved input (lowest-index tie-break)", () => {
    // Larger, deliberately mis-ordered input to guard the Map index against
    // future drift. Same ISIN appears across two dates; two AAPL withholdings
    // exist for two AAPL dividends and must pair by lowest unconsumed index so
    // each dividend keeps its own withholding rather than stealing another's.
    const rates = makeRateMap({
      "2025-01-15": { USD: "0.95" },
      "2025-02-20": { USD: "0.93" },
      "2025-04-10": { USD: "0.91" },
    });

    const transactions: CashTransaction[] = [
      // Withholdings listed FIRST and out of order relative to dividends.
      makeCashTx({
        transactionID: "w-vod",
        isin: "GB00BH4HKS39",
        symbol: "VOD",
        currency: "USD",
        dateTime: "20250220",
        amount: "-4",
        type: "Withholding Tax",
      }),
      makeCashTx({
        transactionID: "w-aapl-apr",
        isin: "US0378331005",
        symbol: "AAPL",
        currency: "USD",
        dateTime: "20250410",
        amount: "-20",
        type: "Withholding Tax",
      }),
      makeCashTx({
        transactionID: "w-aapl-jan",
        isin: "US0378331005",
        symbol: "AAPL",
        currency: "USD",
        dateTime: "20250115",
        amount: "-10",
        type: "Withholding Tax",
      }),
      // Dividends.
      makeCashTx({
        transactionID: "d-aapl-jan",
        isin: "US0378331005",
        symbol: "AAPL",
        currency: "USD",
        dateTime: "20250115",
        amount: "100",
        type: "Dividends",
      }),
      makeCashTx({
        transactionID: "d-vod",
        isin: "GB00BH4HKS39",
        symbol: "VOD",
        currency: "USD",
        dateTime: "20250220",
        amount: "50",
        type: "Dividends",
      }),
      makeCashTx({
        transactionID: "d-aapl-apr",
        isin: "US0378331005",
        symbol: "AAPL",
        currency: "USD",
        dateTime: "20250410",
        amount: "200",
        type: "Dividends",
      }),
    ];

    const entries = calculateDividends(transactions, rates);

    expect(entries).toHaveLength(3);

    // AAPL Jan dividend pairs with the Jan withholding (10 USD), not the Apr one,
    // because only the Jan withholding is within 7 days of the Jan dividend.
    expect(entries[0]!.symbol).toBe("AAPL");
    expect(entries[0]!.payDate).toBe("2025-01-15");
    expect(entries[0]!.grossAmountEur.toFixed(2)).toBe("95.00"); // 100 * 0.95
    expect(entries[0]!.withholdingTaxEur.toFixed(2)).toBe("9.50"); // 10 * 0.95

    // VOD pairs with its own (only) withholding.
    expect(entries[1]!.symbol).toBe("VOD");
    expect(entries[1]!.grossAmountEur.toFixed(2)).toBe("46.50"); // 50 * 0.93
    expect(entries[1]!.withholdingTaxEur.toFixed(2)).toBe("3.72"); // 4 * 0.93

    // AAPL Apr dividend pairs with the remaining (Apr) AAPL withholding.
    expect(entries[2]!.symbol).toBe("AAPL");
    expect(entries[2]!.payDate).toBe("2025-04-10");
    expect(entries[2]!.grossAmountEur.toFixed(2)).toBe("182.00"); // 200 * 0.91
    expect(entries[2]!.withholdingTaxEur.toFixed(2)).toBe("18.20"); // 20 * 0.91
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

    it("should fall back to the ISIN prefix when no country pattern matches", () => {
      const rates = makeRateMap({ "2025-06-01": { USD: "0.92" } });

      const transactions: CashTransaction[] = [
        makeCashTx({
          transactionID: "1",
          amount: "100",
          type: "Dividends",
          isin: "US0378331005",
          description: "SOME DIVIDEND",
        }),
      ];

      const entries = calculateDividends(transactions, rates);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.withholdingCountry).toBe("US");
    });

    it("should default to XX when there is neither a marker nor an ISIN", () => {
      const rates = makeRateMap({ "2025-06-01": { USD: "0.92" } });

      const transactions: CashTransaction[] = [
        makeCashTx({
          transactionID: "1",
          amount: "100",
          type: "Dividends",
          isin: "",
          description: "SOME DIVIDEND",
        }),
      ];

      const entries = calculateDividends(transactions, rates);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.withholdingCountry).toBe("XX");
    });

    it("should derive ES (domestic) from a Spanish ISIN — Flatex dividend", () => {
      const rates: EcbRateMap = new Map();

      const transactions: CashTransaction[] = [
        makeCashTx({
          transactionID: "1",
          amount: "60.75",
          currency: "EUR",
          type: "Dividends",
          isin: "ES0178430E18",
          description: "Dividendenzahlung ES0178430E18",
        }),
      ];

      const entries = calculateDividends(transactions, rates);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.withholdingCountry).toBe("ES");
    });

    it("should prefer an explicit Tax marker over the ISIN prefix", () => {
      const rates = makeRateMap({ "2025-06-01": { USD: "0.92" } });

      // Irish-domiciled ETF, but the broker marks US withholding explicitly.
      const transactions: CashTransaction[] = [
        makeCashTx({
          transactionID: "1",
          amount: "100",
          type: "Dividends",
          isin: "IE00B4L5Y983",
          description: "US Tax withheld on distribution",
        }),
      ];

      const entries = calculateDividends(transactions, rates);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.withholdingCountry).toBe("US");
    });
  });
});
