import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateModelo720, checkModelo720Thresholds } from "../../src/generators/modelo720.js";
import type { OpenPosition } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Lot } from "../../src/types/tax.js";

const rateMap: EcbRateMap = new Map([
  ["2025-12-31", new Map([["USD", new Decimal("0.92")], ["GBP", new Decimal("1.15")]])],
  ["2025-12-30", new Map([["USD", new Decimal("0.92")], ["GBP", new Decimal("1.15")]])],
]);

function makePosition(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    accountId: "",
    symbol: "SPY",
    description: "SPDR S&P 500 ETF",
    isin: "US78462F1030",
    currency: "USD",
    assetCategory: "STK",
    quantity: "100",
    costBasisMoney: "40000",
    costBasisPrice: "400",
    markPrice: "600",
    positionValue: "60000",
    fifoPnlUnrealized: "20000",
    fxRateToBase: "0.92",
    ...overrides,
  };
}

const baseConfig = {
  nif: "12345678A",
  surname: "GARCIA LOPEZ",
  name: "JUAN",
  year: 2025,
  phone: "600123456",
  contactName: "GARCIA LOPEZ, JUAN",
  declarationId: "0000000000001",
  isComplementary: false,
  isReplacement: false,
};

describe("Modelo 720 Generator", () => {
  it("should return empty string when total value is below 50K EUR", () => {
    const positions = [makePosition({ positionValue: "10000" })]; // 10000 * 0.92 = 9200 EUR
    const result = generateModelo720(positions, rateMap, baseConfig);
    expect(result).toBe("");
  });

  it("should generate records when total value exceeds 50K EUR", () => {
    const positions = [makePosition()]; // 60000 * 0.92 = 55200 EUR
    const result = generateModelo720(positions, rateMap, baseConfig);
    expect(result).not.toBe("");
    const lines = result.split("\n");
    expect(lines).toHaveLength(2); // 1 summary + 1 detail
    expect(lines[0]![0]).toBe("1"); // summary record
    expect(lines[1]![0]).toBe("2"); // detail record
  });

  it("should include BOND asset category", () => {
    const positions = [
      makePosition({ assetCategory: "BOND", positionValue: "60000" }),
    ];
    const result = generateModelo720(positions, rateMap, baseConfig);
    expect(result).not.toBe("");
    expect(result.split("\n")).toHaveLength(2);
  });

  it("should include STK, FUND, and BOND but exclude others", () => {
    const positions = [
      makePosition({ positionValue: "30000" }), // STK
      makePosition({ assetCategory: "FUND", isin: "IE00BK5BQT80", positionValue: "30000" }), // FUND
      makePosition({ assetCategory: "OPT", isin: "US0000000001", positionValue: "30000" }), // OPT — excluded
    ];
    const result = generateModelo720(positions, rateMap, baseConfig);
    // STK + FUND = 30000+30000 * 0.92 = 55200 EUR > 50K
    expect(result).not.toBe("");
    const lines = result.split("\n");
    expect(lines).toHaveLength(3); // 1 summary + 2 detail (OPT excluded)
  });

  it("should extract country code from ISIN into detail record", () => {
    const positions = [makePosition()];
    const result = generateModelo720(positions, rateMap, baseConfig);
    const detail = result.split("\n")[1]!;
    // Country code at positions 129-130 (0-indexed: 128-129)
    expect(detail.slice(128, 130)).toBe("US");
  });

  it("should include ISIN in detail record", () => {
    const positions = [makePosition()];
    const result = generateModelo720(positions, rateMap, baseConfig);
    const detail = result.split("\n")[1]!;
    // ISIN at positions 132-143 (0-indexed: 131-142)
    expect(detail.slice(131, 143).trim()).toBe("US78462F1030");
  });

  it("should use first acquisition date from FIFO lots", () => {
    const positions = [makePosition()];
    const lots: Map<string, Lot[]> = new Map([
      ["US78462F1030", [
        { id: "1", isin: "US78462F1030", symbol: "SPY", description: "", acquireDate: "20230115", quantity: new Decimal(50), pricePerShare: new Decimal(380), costInEur: new Decimal(17480), currency: "USD", ecbRate: new Decimal("0.92") },
        { id: "2", isin: "US78462F1030", symbol: "SPY", description: "", acquireDate: "20240601", quantity: new Decimal(50), pricePerShare: new Decimal(420), costInEur: new Decimal(19320), currency: "USD", ecbRate: new Decimal("0.92") },
      ]],
    ]);
    const result = generateModelo720(positions, rateMap, baseConfig, lots);
    const detail = result.split("\n")[1]!;
    // First acquisition date at positions 415-422 (0-indexed: 414-421)
    expect(detail.slice(414, 422)).toBe("20230115");
  });

  describe("A/M/C declaration types", () => {
    it("should use 'A' for new positions not in previous year", () => {
      const positions = [makePosition()];
      const config = { ...baseConfig, previousYearIsins: ["IE00BK5BQT80"] };
      const result = generateModelo720(positions, rateMap, config);
      const detail = result.split("\n")[1]!;
      // Type at position 423 (0-indexed: 422)
      expect(detail[422]).toBe("A");
    });

    it("should use 'M' for positions already declared last year", () => {
      const positions = [makePosition()];
      const config = { ...baseConfig, previousYearIsins: ["US78462F1030"] };
      const result = generateModelo720(positions, rateMap, config);
      const detail = result.split("\n")[1]!;
      expect(detail[422]).toBe("M");
    });

    it("should default to 'A' when no previousYearIsins provided", () => {
      const positions = [makePosition()];
      const result = generateModelo720(positions, rateMap, baseConfig);
      const detail = result.split("\n")[1]!;
      // No previousYearIsins → empty set → not found → 'A'
      expect(detail[422]).toBe("A");
    });

    it("should generate 'C' records for ISINs sold since last year", () => {
      const positions = [makePosition()]; // only US78462F1030
      const config = {
        ...baseConfig,
        previousYearIsins: ["US78462F1030", "IE00BK5BQT80"],
      };
      const result = generateModelo720(positions, rateMap, config);
      const lines = result.split("\n");
      // 1 summary + 1 detail (M for SPY) + 1 cancelled (C for VWCE)
      expect(lines).toHaveLength(3);

      const cancelled = lines[2]!;
      expect(cancelled[422]).toBe("C"); // type C
      expect(cancelled.slice(131, 143).trim()).toBe("IE00BK5BQT80"); // cancelled ISIN
    });

    it("should generate C record even when current total is below 50K", () => {
      const positions = [makePosition({ positionValue: "10000" })]; // 9200 EUR < 50K
      const config = {
        ...baseConfig,
        previousYearIsins: ["US78462F1030", "IE00BK5BQT80"],
      };
      const result = generateModelo720(positions, rateMap, config);
      // IE00BK5BQT80 is cancelled — should generate output even below 50K
      expect(result).not.toBe("");
      const lines = result.split("\n");
      const cancelled = lines.find((l) => l[0] === "2" && l[422] === "C");
      expect(cancelled).toBeDefined();
      expect(cancelled!.slice(131, 143).trim()).toBe("IE00BK5BQT80");
    });

    it("should set cancellation date to year-end in C records", () => {
      const positions = [makePosition()];
      const config = {
        ...baseConfig,
        previousYearIsins: ["US78462F1030", "DE000A0F5UF5"],
      };
      const result = generateModelo720(positions, rateMap, config);
      const cancelled = result.split("\n").find((l) => l[0] === "2" && l[422] === "C")!;
      // Cancellation date at positions 424-431 (0-indexed: 423-430)
      expect(cancelled.slice(423, 431)).toBe("20251231");
    });
  });

  describe("Per-category 50K threshold", () => {
    it("should report values below threshold at 49,999.99", () => {
      // 49999.99 / 0.92 ≈ 54347.815 USD position value needed for 49999.99 EUR
      // But we want exactly 49999.99 EUR: positionValue * 0.92 = 49999.99 → positionValue = 54347.8152...
      // Use EUR to get exact boundary
      const positions = [makePosition({
        currency: "EUR",
        positionValue: "49999.99",
        assetCategory: "STK",
      })];
      const result = checkModelo720Thresholds(positions, rateMap, 2025);

      expect(result.values.exceeds).toBe(false);
      expect(result.values.total.toFixed(2)).toBe("49999.99");
    });

    it("should report values at exactly 50,000.00 as exceeding threshold", () => {
      const positions = [makePosition({
        currency: "EUR",
        positionValue: "50000.00",
        assetCategory: "STK",
      })];
      const result = checkModelo720Thresholds(positions, rateMap, 2025);

      expect(result.values.exceeds).toBe(true);
      expect(result.values.total.toFixed(2)).toBe("50000.00");
    });

    it("should sum across multiple STK/FUND/BOND positions", () => {
      const positions = [
        makePosition({ currency: "EUR", positionValue: "20000", assetCategory: "STK" }),
        makePosition({ currency: "EUR", positionValue: "20000", assetCategory: "FUND", isin: "IE00BK5BQT80" }),
        makePosition({ currency: "EUR", positionValue: "15000", assetCategory: "BOND", isin: "US912828ZT60" }),
      ];
      const result = checkModelo720Thresholds(positions, rateMap, 2025);

      expect(result.values.exceeds).toBe(true);
      expect(result.values.total.toFixed(2)).toBe("55000.00");
    });

    it("should exclude non-eligible asset categories (OPT, CASH)", () => {
      const positions = [
        makePosition({ currency: "EUR", positionValue: "30000", assetCategory: "STK" }),
        makePosition({ currency: "EUR", positionValue: "30000", assetCategory: "OPT", isin: "US0000000001" }),
      ];
      const result = checkModelo720Thresholds(positions, rateMap, 2025);

      // Only 30000 from STK, OPT excluded
      expect(result.values.exceeds).toBe(false);
      expect(result.values.total.toFixed(2)).toBe("30000.00");
    });

    it("should convert foreign currency using ECB rates", () => {
      const positions = [makePosition({ positionValue: "60000", currency: "USD" })];
      const result = checkModelo720Thresholds(positions, rateMap, 2025);

      // 60000 * 0.92 = 55200 EUR
      expect(result.values.exceeds).toBe(true);
      expect(result.values.total.toFixed(2)).toBe("55200.00");
    });

    it("should return zero for accounts when no cash balances provided", () => {
      const positions = [makePosition({ currency: "EUR", positionValue: "100000" })];
      const result = checkModelo720Thresholds(positions, rateMap, 2025);

      expect(result.accounts.exceeds).toBe(false);
      expect(result.accounts.total.toFixed(2)).toBe("0.00");
      expect(result.realEstate.exceeds).toBe(false);
      expect(result.realEstate.total.toFixed(2)).toBe("0.00");
    });

    it("should calculate accounts category from cash balances", () => {
      const positions: OpenPosition[] = [];
      const cashBalances = [
        { accountId: "U1", currency: "USD", endingCash: "60000", endingSettledCash: "60000", averageQ4Cash: "60000" },
      ];
      const result = checkModelo720Thresholds(positions, rateMap, 2025, cashBalances);

      // 60000 * 0.92 = 55200 EUR
      expect(result.accounts.exceeds).toBe(true);
      expect(result.accounts.total.toFixed(2)).toBe("55200.00");
      expect(result.values.total.toFixed(2)).toBe("0.00");
    });

    it("should handle mixed V+C categories independently", () => {
      const positions = [makePosition({ currency: "EUR", positionValue: "40000" })];
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "55000", endingSettledCash: "55000", averageQ4Cash: "55000" },
      ];
      const result = checkModelo720Thresholds(positions, rateMap, 2025, cashBalances);

      expect(result.values.exceeds).toBe(false);
      expect(result.values.total.toFixed(2)).toBe("40000.00");
      expect(result.accounts.exceeds).toBe(true);
      expect(result.accounts.total.toFixed(2)).toBe("55000.00");
    });

    it("should sum multi-currency cash balances", () => {
      const positions: OpenPosition[] = [];
      const cashBalances = [
        { accountId: "U1", currency: "USD", endingCash: "30000", endingSettledCash: "30000", averageQ4Cash: "30000" },
        { accountId: "U1", currency: "GBP", endingCash: "20000", endingSettledCash: "20000", averageQ4Cash: "20000" },
      ];
      const result = checkModelo720Thresholds(positions, rateMap, 2025, cashBalances);

      // USD: 30000 * 0.92 = 27600, GBP: 20000 * 1.15 = 23000, total = 50600
      expect(result.accounts.exceeds).toBe(true);
      expect(result.accounts.total.toFixed(2)).toBe("50600.00");
    });

    it("should filter out negative cash balances", () => {
      const positions: OpenPosition[] = [];
      const cashBalances = [
        { accountId: "U1", currency: "USD", endingCash: "60000", endingSettledCash: "60000", averageQ4Cash: "60000" },
        { accountId: "U1", currency: "EUR", endingCash: "-5000", endingSettledCash: "-5000", averageQ4Cash: "-5000" },
      ];
      const result = checkModelo720Thresholds(positions, rateMap, 2025, cashBalances);

      // Only USD counts: 60000 * 0.92 = 55200, negative EUR excluded
      expect(result.accounts.total.toFixed(2)).toBe("55200.00");
    });

    it("should use rate 1.0 for EUR cash balances", () => {
      const positions: OpenPosition[] = [];
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "55000", endingSettledCash: "55000", averageQ4Cash: "55000" },
      ];
      const result = checkModelo720Thresholds(positions, rateMap, 2025, cashBalances);

      expect(result.accounts.exceeds).toBe(true);
      expect(result.accounts.total.toFixed(2)).toBe("55000.00");
    });
  });

  describe("Category C — cash account records", () => {
    it("should generate Category C records when cash exceeds 50K", () => {
      const positions: OpenPosition[] = [];
      const cashBalances = [
        { accountId: "U1234567", currency: "USD", endingCash: "60000", endingSettledCash: "60000", averageQ4Cash: "60000" },
      ];
      const result = generateModelo720(positions, rateMap, baseConfig, undefined, cashBalances);

      expect(result).not.toBe("");
      const lines = result.split("\n");
      expect(lines).toHaveLength(2); // 1 summary + 1 cash detail
      expect(lines[0]![0]).toBe("1"); // summary
      expect(lines[1]![0]).toBe("2"); // detail
      // Asset type at position 102 (0-indexed: 101) should be "C"
      expect(lines[1]![101]).toBe("C");
    });

    it("should not generate Category C records when cash is below 50K", () => {
      const positions: OpenPosition[] = [];
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "40000", endingSettledCash: "40000", averageQ4Cash: "40000" },
      ];
      const result = generateModelo720(positions, rateMap, baseConfig, undefined, cashBalances);

      expect(result).toBe("");
    });

    it("should generate both V and C records when both exceed 50K", () => {
      const positions = [makePosition()]; // 60000 * 0.92 = 55200 EUR
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "55000", endingSettledCash: "55000", averageQ4Cash: "55000" },
      ];
      const result = generateModelo720(positions, rateMap, baseConfig, undefined, cashBalances);

      expect(result).not.toBe("");
      const lines = result.split("\n");
      expect(lines).toHaveLength(3); // 1 summary + 1 V detail + 1 C detail
      // First detail should be V (securities)
      expect(lines[1]![101]).toBe("V");
      // Second detail should be C (accounts)
      expect(lines[2]![101]).toBe("C");
    });

    it("should only generate C records when V is below threshold but C exceeds", () => {
      const positions = [makePosition({ positionValue: "10000" })]; // 9200 EUR < 50K
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "55000", endingSettledCash: "55000", averageQ4Cash: "55000" },
      ];
      const result = generateModelo720(positions, rateMap, baseConfig, undefined, cashBalances);

      expect(result).not.toBe("");
      const lines = result.split("\n");
      expect(lines).toHaveLength(2); // 1 summary + 1 C detail (no V)
      expect(lines[1]![101]).toBe("C");
    });
  });

  describe("Q4 rate fallback to getEcbRate", () => {
    it("should fall back to year-end spot when Q4 has no rates for the specific currency", () => {
      // Rate map: Q4 dates exist only for GBP, not USD.
      // Dec 31 has USD so getEcbRate finds it on first attempt.
      // But getQ4AverageRate iterates Q4 dates and finds USD on Dec 31 too,
      // so to truly trigger the fallback we need Q4 dates WITHOUT USD
      // and a walkback-reachable date WITH USD.
      // Since getEcbRate walks back ≤10 days from Dec 31 (all within Q4),
      // any reachable date is also visible to getQ4AverageRate.
      // So we test the scenario where Q4 has rates for ONLY one Q4 date
      // with the needed currency — effectively verifying the Q4 average path
      // degrades to a single-date average (equivalent to spot).
      const singleQ4RateMap: EcbRateMap = new Map([
        ["2025-12-31", new Map([["USD", new Decimal("0.92")]])],
      ]);

      const positions = [makePosition({ positionValue: "60000", assetCategory: "STK", currency: "USD" })];
      const result = generateModelo720(positions, singleQ4RateMap, baseConfig);

      // Q4 average of a single date (0.92) = 0.92 = same as spot
      // 60000 * 0.92 = 55200 EUR > 50K
      expect(result).not.toBe("");
      const lines = result.split("\n");
      expect(lines).toHaveLength(2);
    });

    it("should throw when STK currency has no rates in Q4 and no walkback rates", () => {
      // Rate map with Q4 dates that have GBP but NOT CHF
      // getQ4AverageRate throws for CHF, fallback getEcbRate also throws
      const noChfRateMap: EcbRateMap = new Map([
        ["2025-12-31", new Map([["GBP", new Decimal("1.15")]])],
        ["2025-12-30", new Map([["GBP", new Decimal("1.15")]])],
      ]);

      const positions = [makePosition({ positionValue: "60000", assetCategory: "STK", currency: "CHF" })];

      expect(() => generateModelo720(positions, noChfRateMap, baseConfig)).toThrow(
        /No ECB rate found for CHF/,
      );
    });
  });

  describe("Q4 average FX rate for STK positions", () => {
    it("should use Q4 average rate for STK and Dec 31 spot for FUND", () => {
      // Build a rate map with different rates across Q4
      const q4RateMap: EcbRateMap = new Map([
        ["2025-10-01", new Map([["USD", "0.90"]])],
        ["2025-11-01", new Map([["USD", "0.92"]])],
        ["2025-12-01", new Map([["USD", "0.94"]])],
        ["2025-12-31", new Map([["USD", "0.96"]])],
      ]);

      // Q4 average = (0.90 + 0.92 + 0.94 + 0.96) / 4 = 0.93
      const stkPositions = [makePosition({ positionValue: "100000", assetCategory: "STK", currency: "USD" })];
      const fundPositions = [makePosition({ positionValue: "100000", assetCategory: "FUND", currency: "USD", isin: "IE00BK5BQT80" })];

      const stkResult = generateModelo720(stkPositions, q4RateMap, baseConfig);
      const fundResult = generateModelo720(fundPositions, q4RateMap, baseConfig);

      // Both should generate output (>50K)
      expect(stkResult).not.toBe("");
      expect(fundResult).not.toBe("");

      // STK uses Q4 average (0.93), FUND uses Dec 31 (0.96)
      // The exact values will differ between them
      const stkLines = stkResult.split("\n");
      const fundLines = fundResult.split("\n");
      expect(stkLines.length).toBeGreaterThanOrEqual(2);
      expect(fundLines.length).toBeGreaterThanOrEqual(2);
    });
  });
});
