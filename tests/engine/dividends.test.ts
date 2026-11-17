import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { calculateDividends, matchWithholdings } from "../../src/engine/dividends.js";
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

    it("does not take a 2-letter ticker for the country (IBKR, ticker ES with a US ISIN)", () => {
      const rates = makeRateMap({ "2025-06-01": { USD: "0.92" } });

      // Eversource trades as ES. IBKR puts the ticker first and the real
      // withholding country before "Tax".
      const transactions: CashTransaction[] = [
        makeCashTx({
          transactionID: "1",
          symbol: "ES",
          isin: "US30040W1080",
          amount: "100",
          type: "Dividends",
          description: "ES(US30040W1080) Cash Dividend USD 0.7125 per Share (Ordinary Dividend)",
        }),
        makeCashTx({
          transactionID: "2",
          symbol: "ES",
          isin: "US30040W1080",
          amount: "-15",
          type: "Withholding Tax",
          description: "ES(US30040W1080) Cash Dividend USD 0.7125 per Share - US Tax",
        }),
      ];

      const entries = calculateDividends(transactions, rates);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.withholdingCountry).toBe("US");
    });

    it("keeps an explicit IBKR country marker over the ISIN (ADR with DK TAX)", () => {
      const rates = makeRateMap({ "2025-06-01": { USD: "0.92" } });

      const transactions: CashTransaction[] = [
        makeCashTx({
          transactionID: "1",
          symbol: "NVO",
          isin: "US6701002056",
          amount: "100",
          type: "Dividends",
          description: "NVO(US6701002056) CASH DIVIDEND USD 0.58432 PER SHARE (Ordinary Dividend)",
        }),
        makeCashTx({
          transactionID: "2",
          symbol: "NVO",
          isin: "US6701002056",
          amount: "-27",
          type: "Withholding Tax",
          description: "NVO(US6701002056) CASH DIVIDEND USD 0.58432 PER SHARE - DK TAX",
        }),
      ];

      const entries = calculateDividends(transactions, rates);

      expect(entries[0]!.withholdingCountry).toBe("DK");
    });

    it("uses the ISIN when the withholding only names the ticker (Trading 212, ticker DE)", () => {
      const rates = makeRateMap({ "2025-06-01": { USD: "0.92" } });

      // Deere trades as DE, which must not become Germany.
      const transactions: CashTransaction[] = [
        makeCashTx({
          transactionID: "1",
          symbol: "DE",
          isin: "US2441991054",
          amount: "100",
          type: "Dividends",
          description: "Dividend (Ordinary) - DE",
        }),
        makeCashTx({
          transactionID: "2",
          symbol: "DE",
          isin: "US2441991054",
          amount: "-15",
          type: "Withholding Tax",
          description: "Withholding tax - DE",
        }),
      ];

      const entries = calculateDividends(transactions, rates);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.withholdingCountry).toBe("US");
    });
  });

  describe("non-throwing rate lookup", () => {
    it("skips a dividend it cannot value, with its withholding, and reports it", () => {
      const transactions: CashTransaction[] = [
        makeCashTx({ transactionID: "1", currency: "CNH", isin: "CNE000001R84", amount: "100", type: "Dividends" }),
        makeCashTx({ transactionID: "2", currency: "CNH", isin: "CNE000001R84", amount: "-10", type: "Withholding Tax" }),
        makeCashTx({ transactionID: "3", amount: "100", type: "Dividends" }),
        makeCashTx({ transactionID: "4", amount: "-15", type: "Withholding Tax" }),
      ];
      const unvalued: string[] = [];

      const entries = calculateDividends(transactions, new Map(), {
        lookupRate: (_date, currency) => (currency === "USD" ? new Decimal("0.92") : null),
        onUnvalued: (div) => unvalued.push(div.transactionID),
      });

      expect(unvalued).toEqual(["1"]);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.currency).toBe("USD");
      expect(entries[0]!.withholdingTaxEur.toFixed(2)).toBe("13.80");
    });
  });

  // Issue #96: an EUR-only broker (Trade Republic) keeps a US dividend in USD
  // but books its withholding in EUR. The matcher used to require the same
  // currency, so the two never paired and Casilla 0588 lost the US tax.
  describe("withholding in another currency (issue #96)", () => {
    it("pairs an EUR withholding with its USD dividend and values it 1:1, not at the USD rate", () => {
      const rates = makeRateMap({ "2025-03-14": { USD: "0.918" } });
      const transactions: CashTransaction[] = [
        makeCashTx({ transactionID: "d", isin: "US0000001001", dateTime: "20250314", amount: "10", type: "Dividends" }),
        makeCashTx({ transactionID: "w", isin: "US0000001001", currency: "EUR", dateTime: "20250314", amount: "-1.35", type: "Withholding Tax" }),
      ];

      const entries = calculateDividends(transactions, rates);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.currency).toBe("USD");
      expect(entries[0]!.grossAmountEur.toFixed(4)).toBe("9.1800");
      // 1.35 EUR, never 1.35 x 0.918 = 1.2393.
      expect(entries[0]!.withholdingTaxEur.toFixed(4)).toBe("1.3500");
    });

    it("values a USD withholding of an EUR dividend at the USD rate of the withholding's own date", () => {
      const rates = makeRateMap({ "2025-03-14": { USD: "0.90" }, "2025-03-17": { USD: "0.80" } });
      const transactions: CashTransaction[] = [
        makeCashTx({ transactionID: "d", isin: "US0000001001", currency: "EUR", dateTime: "20250314", amount: "50", type: "Dividends" }),
        makeCashTx({ transactionID: "w", isin: "US0000001001", currency: "USD", dateTime: "20250317", amount: "-10", type: "Withholding Tax" }),
      ];

      const entries = calculateDividends(transactions, rates);

      expect(entries[0]!.grossAmountEur.toFixed(2)).toBe("50.00");
      expect(entries[0]!.withholdingTaxEur.toFixed(2)).toBe("8.00");
    });

    it("prefers a same-currency withholding over a lower-index one in another currency", () => {
      // IBKR-style row: USD dividend + USD withholding, valued at the dividend
      // rate exactly as before. A stray EUR withholding of the same ISIN sits
      // first in the file and must not win.
      const rates = makeRateMap({ "2025-06-01": { USD: "0.92" } });
      const transactions: CashTransaction[] = [
        makeCashTx({ transactionID: "w-eur", currency: "EUR", amount: "-4", type: "Withholding Tax" }),
        makeCashTx({ transactionID: "d", amount: "100", type: "Dividends" }),
        makeCashTx({ transactionID: "w-usd", amount: "-15", type: "Withholding Tax" }),
      ];

      const entries = calculateDividends(transactions, rates);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.withholdingTaxEur.toFixed(2)).toBe("13.80");
    });

    it("never lets a cross-currency fallback take a withholding that a same-currency dividend claims", () => {
      // Two payments of one ISIN in the window: a USD dividend with no
      // withholding of its own (first in the file), and an EUR dividend whose
      // EUR withholding follows. The EUR withholding belongs to the EUR one.
      const rates = makeRateMap({ "2025-06-01": { USD: "0.92" }, "2025-06-03": { USD: "0.92" } });
      const transactions: CashTransaction[] = [
        makeCashTx({ transactionID: "d-usd", amount: "100", type: "Dividends" }),
        makeCashTx({ transactionID: "d-eur", currency: "EUR", dateTime: "20250603", amount: "80", type: "Dividends" }),
        makeCashTx({ transactionID: "w-eur", currency: "EUR", dateTime: "20250603", amount: "-12", type: "Withholding Tax" }),
      ];

      const entries = calculateDividends(transactions, rates);

      expect(entries.map((e) => [e.currency, e.withholdingTaxEur.toFixed(2)])).toEqual([
        ["USD", "0.00"],
        ["EUR", "12.00"],
      ]);
    });

    it("does not pair across currencies when the rows carry no ISIN", () => {
      const rates = makeRateMap({ "2025-06-01": { USD: "0.92" } });
      const transactions: CashTransaction[] = [
        makeCashTx({ transactionID: "d", isin: "", amount: "100", type: "Dividends" }),
        makeCashTx({ transactionID: "w", isin: "", currency: "EUR", amount: "-4", type: "Withholding Tax" }),
      ];

      const entries = calculateDividends(transactions, rates);

      expect(entries[0]!.withholdingTaxEur.toFixed(2)).toBe("0.00");
    });

    it("reports the dividend as unvalued when its other-currency withholding has no rate", () => {
      const unvalued: string[] = [];
      const transactions: CashTransaction[] = [
        makeCashTx({ transactionID: "d", amount: "100", type: "Dividends" }),
        makeCashTx({ transactionID: "w", currency: "CNH", amount: "-10", type: "Withholding Tax" }),
      ];

      const entries = calculateDividends(transactions, new Map(), {
        lookupRate: (_date, currency) => (currency === "USD" ? new Decimal("0.92") : null),
        onUnvalued: (div) => unvalued.push(div.transactionID),
      });

      expect(entries).toHaveLength(0);
      expect(unvalued).toEqual(["d"]);
    });
  });
});

// Issue #438: a dividend's withholding can arrive as several rows, a partial
// refund (−1.50 then +0.50) or a reversal on another date (−1.50, +1.50, −1.00).
// collapseCorrections cancels only exact same-date pairs, and the matcher used
// to take ONE row per dividend and its absolute value, so 0588 came out 1.50
// instead of 1.00. Every withholding row of the dividend now counts with its sign.
describe("withholding corrections (issue #438)", () => {
  const rates = makeRateMap({
    "2025-03-10": { USD: "0.90" },
    "2025-03-12": { USD: "0.80" },
    "2025-06-10": { USD: "0.95" },
  });
  const div = (id: string, extra: Partial<CashTransaction> = {}) =>
    makeCashTx({ transactionID: id, dateTime: "20250310", amount: "10", type: "Dividends", ...extra });
  const wht = (id: string, amount: string, extra: Partial<CashTransaction> = {}) =>
    makeCashTx({ transactionID: id, dateTime: "20250310", amount, type: "Withholding Tax", ...extra });

  it("a partial refund on a later date lowers the withholding: 1.50 − 0.50 = 1.00 USD", () => {
    const entries = calculateDividends([div("d"), wht("w1", "-1.50"), wht("w2", "0.50", { dateTime: "20250312" })], rates);
    expect(entries).toHaveLength(1);
    // Valued at the dividend's rate, like a same-currency withholding always was.
    expect(entries[0]!.withholdingTaxEur.toFixed(4)).toBe("0.9000");
  });

  it("a reversal and a new withholding on another date: −1.50 / +1.50 / −1.00 = 1.00 USD", () => {
    const entries = calculateDividends(
      [div("d"), wht("w1", "-1.50"), wht("w2", "1.50", { dateTime: "20250312" }), wht("w3", "-1.00", { dateTime: "20250312" })],
      rates,
    );
    expect(entries[0]!.withholdingTaxEur.toFixed(4)).toBe("0.9000");
  });

  it("the order of the rows in the file does not matter", () => {
    const rows = [div("d"), wht("w1", "-1.50"), wht("w2", "1.50", { dateTime: "20250312" }), wht("w3", "-1.00", { dateTime: "20250312" })];
    for (const order of [[0, 1, 2, 3], [2, 3, 1, 0], [3, 2, 0, 1], [1, 2, 0, 3]]) {
      const entries = calculateDividends(order.map((i) => rows[i]!), rates);
      expect(entries[0]!.withholdingTaxEur.toFixed(4), order.join(",")).toBe("0.9000");
    }
  });

  it("a positive row is never a dividend's withholding on its own (no absolute value)", () => {
    // Only the refund is in the data (the original withholding sits in a file
    // that was not uploaded): this dividend paid no tax we can see.
    const entries = calculateDividends([div("d"), wht("w", "0.50")], rates);
    expect(entries[0]!.withholdingTaxEur.toFixed(4)).toBe("0.0000");
  });

  it("two dividends of one ISIN on one day keep their own withholdings and every correction counts once", () => {
    // Ordinary 10.00 and special 5.00 the same day; the special one's −0.75
    // is corrected to −0.50 (+0.75 / −0.50) two days later.
    const entries = calculateDividends(
      [
        div("d1"),
        div("d2", { amount: "5" }),
        wht("w1", "-1.50"),
        wht("w2", "-0.75"),
        wht("w3", "0.75", { dateTime: "20250312" }),
        wht("w4", "-0.50", { dateTime: "20250312" }),
      ],
      rates,
    );
    expect(entries).toHaveLength(2);
    const total = entries.reduce((s, e) => s.plus(e.withholdingTaxEur), new Decimal(0));
    expect(total.toFixed(4)).toBe("1.8000"); // (1.50 + 0.50) × 0.90
    for (const e of entries) expect(e.withholdingTaxEur.greaterThanOrEqualTo(0)).toBe(true);
  });

  it("a correction of one ISIN never moves to another ISIN's dividend", () => {
    const entries = calculateDividends(
      [
        div("d-aapl"),
        wht("w-aapl", "-1.50"),
        div("d-msft", { isin: "US5949181045", symbol: "MSFT" }),
        wht("w-msft", "-1.50", { isin: "US5949181045", symbol: "MSFT" }),
        wht("w-msft-refund", "0.50", { isin: "US5949181045", symbol: "MSFT", dateTime: "20250312" }),
      ],
      rates,
    );
    expect(entries.map((e) => [e.symbol, e.withholdingTaxEur.toFixed(4)])).toEqual([
      ["AAPL", "1.3500"],
      ["MSFT", "0.9000"],
    ]);
  });

  it("a correction joins the dividend it is dated near, not a later one of the same ISIN", () => {
    const entries = calculateDividends(
      [
        div("d-mar"),
        wht("w-mar", "-1.50"),
        div("d-jun", { dateTime: "20250610" }),
        wht("w-jun", "-1.50", { dateTime: "20250610" }),
        wht("w-mar-refund", "0.50", { dateTime: "20250312" }),
      ],
      rates,
    );
    expect(entries.map((e) => [e.payDate, e.withholdingTaxEur.toFixed(4)])).toEqual([
      ["2025-03-10", "0.9000"],
      ["2025-06-10", "1.4250"],
    ]);
  });

  it("an extra withholding row of the same dividend is added, not dropped", () => {
    // Two withholding rows for one payment (e.g. split by the broker).
    const entries = calculateDividends([div("d"), wht("w1", "-1.00"), wht("w2", "-0.50")], rates);
    expect(entries[0]!.withholdingTaxEur.toFixed(4)).toBe("1.3500");
  });

  it("Trade Republic (#432): an EUR refund of an EUR withholding nets on the USD dividend at 1:1", () => {
    const tr = calculateDividends(
      [
        div("d", { isin: "US0000001001" }),
        wht("w", "-1.35", { isin: "US0000001001", currency: "EUR" }),
        wht("r", "0.35", { isin: "US0000001001", currency: "EUR", dateTime: "20250312" }),
      ],
      rates,
    );
    expect(tr[0]!.grossAmountEur.toFixed(4)).toBe("9.0000");
    expect(tr[0]!.withholdingTaxEur.toFixed(4)).toBe("1.0000");
  });

  it("a refund listed first never takes a withholding's place as a dividend's pair", () => {
    // Two payments of one ISIN a week apart, the refund of the second one
    // first in the file. Were the refund a pair, the first dividend would take
    // it (and lose its own −1.00 to the second one): 0.00 and 2.50, not 1.00 and 1.00.
    const r = makeRateMap({ "2025-03-03": { USD: "1" }, "2025-03-08": { USD: "1" }, "2025-03-10": { USD: "1" } });
    const entries = calculateDividends(
      [
        wht("refund-b", "0.50", { dateTime: "20250308" }),
        wht("w-a", "-1.00", { dateTime: "20250303" }),
        wht("w-b", "-1.50", { dateTime: "20250310" }),
        div("a", { dateTime: "20250303" }),
        div("b", { dateTime: "20250310" }),
      ],
      r,
    );
    expect(entries.map((e) => [e.payDate, e.withholdingTaxEur.toFixed(2)])).toEqual([
      ["2025-03-03", "1.00"],
      ["2025-03-10", "1.00"],
    ]);
  });

  it("a withholding outside every dividend's 7-day window stays unpaired", () => {
    const entries = calculateDividends([div("d"), wht("w", "-1.50"), wht("late", "0.50", { dateTime: "20250320" })], rates);
    expect(entries[0]!.withholdingTaxEur.toFixed(4)).toBe("1.3500");
  });
});

// Review of #438: a refund must never vanish into a dividend that withheld less
// than it, a reversed dividend must never take a withholding, and a correction
// IBKR posts next year must stay with a dividend of its own year.
describe("withholding corrections: where a refund goes (issue #438)", () => {
  const r1 = makeRateMap({
    "2025-03-03": { USD: "1" },
    "2025-03-07": { USD: "1" },
    "2025-03-10": { USD: "1" },
    "2025-03-12": { USD: "1" },
    "2025-03-14": { USD: "1" },
    "2025-03-16": { USD: "1" },
  });
  const div = (id: string, dateTime: string, amount = "10", extra: Partial<CashTransaction> = {}) =>
    makeCashTx({ transactionID: id, dateTime, amount, type: "Dividends", ...extra });
  const wht = (id: string, dateTime: string, amount: string, extra: Partial<CashTransaction> = {}) =>
    makeCashTx({ transactionID: id, dateTime, amount, type: "Withholding Tax", ...extra });
  const show = (entries: ReturnType<typeof calculateDividends>) =>
    entries.map((e) => `${e.grossAmountEur.toFixed(2)}/${e.withholdingTaxEur.toFixed(2)}`);

  it("a refund nearer to a dividend that withheld less is not lost: 1.50 + 0.20 − 0.50 = 1.20", () => {
    const entries = calculateDividends(
      [div("a", "20250303"), wht("wa", "20250303", "-1.50"), div("b", "20250310", "2"), wht("wb", "20250310", "-0.20"), wht("r", "20250307", "0.50")],
      r1,
    );
    expect(show(entries)).toEqual(["10.00/1.00", "2.00/0.20"]);
  });

  it("on a tie, the refund goes to the dividend that withheld at least the refund, not the first one", () => {
    const entries = calculateDividends(
      [
        makeCashTx({ transactionID: "pil", dateTime: "20250310", amount: "2", type: "Payment In Lieu Of Dividends" }),
        wht("wp", "20250310", "-0.30"),
        div("d", "20250310"),
        wht("wd", "20250310", "-1.50"),
        wht("r", "20250312", "0.50"),
      ],
      r1,
    );
    expect(show(entries)).toEqual(["2.00/0.30", "10.00/1.00"]);
  });

  it("a refund larger than any one withholding is split, never dropped while some dividend in reach withheld it", () => {
    const entries = calculateDividends(
      [div("a", "20250303"), wht("wa", "20250303", "-0.40"), div("b", "20250310"), wht("wb", "20250310", "-0.40"), wht("r", "20250307", "0.60")],
      r1,
    );
    const total = entries.reduce((s, e) => s.plus(e.withholdingTaxEur), new Decimal(0));
    expect(total.toFixed(2)).toBe("0.20");
  });

  it("a reversed dividend takes no withholding; the reversal goes back to the dividend it reverses", () => {
    // 03-10 paid 10.00 withheld 1.50; 03-14 reverses both; 03-16 rebooks 10.00 withheld 1.00.
    const entries = calculateDividends(
      [
        div("d1", "20250310"),
        wht("w1", "20250310", "-1.50"),
        div("rev", "20250314", "-10"),
        wht("w-rev", "20250314", "1.50"),
        div("d2", "20250316"),
        wht("w2", "20250316", "-1.00"),
      ],
      r1,
    );
    expect(show(entries)).toEqual(["10.00/0.00", "-10.00/0.00", "10.00/1.00"]);
  });

  it("a row IBKR posts in a later year joins only a dividend of its own year", () => {
    // Weekly payer: the 2024-12-27 correction (posted 2025-01-20) is exactly
    // 7 days from the 2025-01-03 dividend, which must keep its own 1.50.
    const r = makeRateMap({ "2024-12-27": { USD: "1" }, "2025-01-03": { USD: "1" } });
    const late = { reportDate: "2025-01-20" };
    const rows = [
      div("d25", "20250103"),
      wht("w-late-rev", "20241227", "1.50", late),
      wht("w-late-new", "20241227", "-1.00", late),
      wht("w25", "20250103", "-1.50"),
    ];
    expect(show(calculateDividends(rows, r))).toEqual(["10.00/1.50"]);
    // With 2024's dividend in the data, the correction nets there.
    const both = calculateDividends([div("d24", "20241227"), wht("w24", "20241227", "-1.50"), ...rows], r);
    expect(show(both)).toEqual(["10.00/1.00", "10.00/1.50"]);
  });

  it("a refund that could go elsewhere makes room for a later refund that has only one dividend in reach", () => {
    // a (03-03) and b (03-10) each withheld 1.00. Refund r1 (03-08) reaches
    // both and is nearer to b; refund r2 (03-16) reaches only b. Both refunds
    // fit: r1 on a, r2 on b. Neither may be dropped.
    const r = makeRateMap({ "2025-03-03": { USD: "1" }, "2025-03-10": { USD: "1" } });
    const entries = calculateDividends(
      [
        div("a", "20250303"),
        wht("wa", "20250303", "-1.00"),
        div("b", "20250310"),
        wht("wb", "20250310", "-1.00"),
        wht("r1", "20250308", "1.00"),
        wht("r2", "20250316", "1.00"),
      ],
      r,
    );
    expect(show(entries)).toEqual(["10.00/0.00", "10.00/0.00"]);
  });

  it("without the competing refund, the refund still goes to the nearest dividend", () => {
    const r = makeRateMap({ "2025-03-03": { USD: "1" }, "2025-03-10": { USD: "1" } });
    const entries = calculateDividends(
      [div("a", "20250303"), wht("wa", "20250303", "-1.00"), div("b", "20250310"), wht("wb", "20250310", "-1.00"), wht("r1", "20250308", "1.00")],
      r,
    );
    expect(show(entries)).toEqual(["10.00/1.00", "10.00/0.00"]);
  });
});

describe("withholdings of rows with no ISIN (issue #438 review)", () => {
  const r = makeRateMap({ "2025-03-10": { USD: "1" } });
  it("pass 1 pairs a dividend with no ISIN only with a withholding of its own symbol", () => {
    // Two symbol-only dividends on one day; the other symbol's withholding comes first in the file.
    const entries = calculateDividends(
      [
        makeCashTx({ transactionID: "da", isin: "", symbol: "AAA", dateTime: "20250310", amount: "10", type: "Dividends" }),
        makeCashTx({ transactionID: "db", isin: "", symbol: "BBB", dateTime: "20250310", amount: "20", type: "Dividends" }),
        makeCashTx({ transactionID: "wb", isin: "", symbol: "BBB", dateTime: "20250310", amount: "-3.00", type: "Withholding Tax" }),
        makeCashTx({ transactionID: "wa", isin: "", symbol: "AAA", dateTime: "20250310", amount: "-1.50", type: "Withholding Tax" }),
      ],
      r,
    );
    expect(entries.map((e) => `${e.symbol}:${e.withholdingTaxEur.toFixed(2)}`)).toEqual(["AAA:1.50", "BBB:3.00"]);
  });
});

describe("matchWithholdings: cancelled dividends (issue #438 review)", () => {
  it("a cancelled dividend stays in the match with no withholding, and its withholding goes to the next dividend", () => {
    const original = makeCashTx({ transactionID: "d1", dateTime: "20240303", amount: "10", type: "Dividends" });
    const rows = [
      original,
      makeCashTx({ transactionID: "d2", dateTime: "20240310", amount: "10", type: "Dividends" }),
      makeCashTx({ transactionID: "w1", dateTime: "20240303", amount: "-1.50", type: "Withholding Tax" }),
    ];
    expect(matchWithholdings(rows).pair).toEqual([0, -1]);
    const match = matchWithholdings(rows, new Set([original]));
    expect(match.dividends[0]).toBe(original);
    expect(match.pair).toEqual([-1, 0]);
    expect(match.parts[0]).toEqual([]);
  });
});

describe("withholding corrections stay at their own broker (issue #438 review)", () => {
  const r = makeRateMap({ "2024-12-31": { USD: "1" }, "2025-01-02": { USD: "1" }, "2025-01-03": { USD: "1" } });
  const isin = "IE00B4L5Y983";
  const row = (id: string, type: CashTransaction["type"], dateTime: string, amount: string, brokerSource?: string) =>
    makeCashTx({ transactionID: id, isin, currency: "EUR", dateTime, amount, type, ...(brokerSource ? { brokerSource } : {}) });
  const show = (entries: ReturnType<typeof calculateDividends>) =>
    entries.map((e) => `${e.payDate}:${e.withholdingTaxEur.toFixed(2)}`);

  it("a refund at broker A never goes to broker B's nearer dividend, across the year end", () => {
    const entries = calculateDividends(
      [
        row("da", "Dividends", "20241231", "100", "A"),
        row("wa", "Withholding Tax", "20241231", "-15", "A"),
        row("db", "Dividends", "20250102", "100", "B"),
        row("wb", "Withholding Tax", "20250102", "-15", "B"),
        row("ra", "Withholding Tax", "20250103", "15", "A"),
      ],
      r,
    );
    expect(show(entries)).toEqual(["2024-12-31:0.00", "2025-01-02:15.00"]);
  });

  it("an extra withholding row at broker A never joins broker B's nearer dividend", () => {
    // A reverses its 15 and withholds 10 again on 3 January.
    const entries = calculateDividends(
      [
        row("da", "Dividends", "20241231", "100", "A"),
        row("wa", "Withholding Tax", "20241231", "-15", "A"),
        row("db", "Dividends", "20250102", "100", "B"),
        row("wb", "Withholding Tax", "20250102", "-15", "B"),
        row("ra", "Withholding Tax", "20250103", "15", "A"),
        row("na", "Withholding Tax", "20250103", "-10", "A"),
      ],
      r,
    );
    expect(show(entries)).toEqual(["2024-12-31:10.00", "2025-01-02:15.00"]);
  });

  it("rows with no broker name keep matching any dividend, as in a single-broker file", () => {
    const entries = calculateDividends(
      [
        row("da", "Dividends", "20241231", "100", "A"),
        row("wa", "Withholding Tax", "20241231", "-15", "A"),
        row("db", "Dividends", "20250102", "100"),
        row("wb", "Withholding Tax", "20250102", "-15"),
        row("r", "Withholding Tax", "20250103", "15"),
      ],
      r,
    );
    expect(show(entries)).toEqual(["2024-12-31:15.00", "2025-01-02:0.00"]);
  });

  it("a refund still moves to make room within its own broker", () => {
    const rr = makeRateMap({ "2025-03-03": { USD: "1" }, "2025-03-10": { USD: "1" } });
    const entries = calculateDividends(
      [
        row("a", "Dividends", "20250303", "10", "A"),
        row("wa", "Withholding Tax", "20250303", "-1.00", "A"),
        row("b", "Dividends", "20250310", "10", "A"),
        row("wb", "Withholding Tax", "20250310", "-1.00", "A"),
        row("r1", "Withholding Tax", "20250308", "1.00", "A"),
        row("r2", "Withholding Tax", "20250316", "1.00", "A"),
      ],
      rr,
    );
    expect(show(entries)).toEqual(["2025-03-03:0.00", "2025-03-10:0.00"]);
  });
});
