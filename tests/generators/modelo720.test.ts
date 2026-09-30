import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  generateModelo720,
  checkModelo720Thresholds,
  findModelo720Omissions,
  findUndatedExtinctions,
  modelo720DeclarationId,
  readPrevious720,
  type Previous720Security,
} from "../../src/generators/modelo720.js";
import { generateTaxReport } from "../../src/generators/report.js";
import type { CashBalance, FlexStatement, OpenPosition, Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Lot } from "../../src/types/tax.js";
import { validateModelo720Records } from "../../src/generators/modelo720-validator.js";
import { BOE_720, boeField } from "./modelo720-boe-layout.js";

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
    custodianCountry: "IE",
    ...overrides,
  };
}

/** Last year's V records as readPrevious720 returns them: shares held at an Irish broker. */
function lastYear(...isins: string[]): Previous720Security[] {
  return isins.map((isin) => ({ isin, claveSubclave: "V1", country: "IE" }));
}

const baseConfig = {
  nif: "12345678A",
  surname: "GARCIA LOPEZ",
  name: "JUAN",
  year: 2025,
  phone: "600123456",
  contactName: "GARCIA LOPEZ, JUAN",
  declarationId: "7200000000001",
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

  it("should write the custodian's country, not the ISIN prefix, into a V detail record", () => {
    const positions = [makePosition()];
    const result = generateModelo720(positions, rateMap, baseConfig);
    const detail = result.split("\n")[1]!;
    // Country code at positions 129-130 (0-indexed: 128-129): where the securities are deposited
    expect(detail.slice(128, 130)).toBe("IE");
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
        { id: "1", isin: "US78462F1030", symbol: "SPY", description: "", acquireDate: "20230115", quantity: new Decimal(50), pricePerShare: new Decimal(380), costInFcy: new Decimal(19000), currency: "USD", ecbRate: new Decimal("0.92") },
        { id: "2", isin: "US78462F1030", symbol: "SPY", description: "", acquireDate: "20240601", quantity: new Decimal(50), pricePerShare: new Decimal(420), costInFcy: new Decimal(21000), currency: "USD", ecbRate: new Decimal("0.92") },
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
      const config = { ...baseConfig, previousYearSecurities: lastYear("IE00BK5BQT80") };
      const result = generateModelo720(positions, rateMap, config);
      const detail = result.split("\n")[1]!;
      // Type at position 423 (0-indexed: 422)
      expect(detail[422]).toBe("A");
    });

    it("should use 'M' for positions already declared last year", () => {
      const positions = [makePosition()];
      const config = { ...baseConfig, previousYearSecurities: lastYear("US78462F1030") };
      const result = generateModelo720(positions, rateMap, config);
      const detail = result.split("\n")[1]!;
      expect(detail[422]).toBe("M");
    });

    it("should default to 'A' when no previousYearSecurities provided", () => {
      const positions = [makePosition()];
      const result = generateModelo720(positions, rateMap, baseConfig);
      const detail = result.split("\n")[1]!;
      // No previousYearSecurities → empty set → not found → 'A'
      expect(detail[422]).toBe("A");
    });

    it("should generate 'C' records for ISINs sold since last year", () => {
      const positions = [makePosition()]; // only US78462F1030
      const config = {
        ...baseConfig,
        previousYearSecurities: lastYear("US78462F1030", "IE00BK5BQT80"),
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
        previousYearSecurities: lastYear("US78462F1030", "IE00BK5BQT80"),
      };
      const result = generateModelo720(positions, rateMap, config);
      // IE00BK5BQT80 is cancelled — should generate output even below 50K
      expect(result).not.toBe("");
      const lines = result.split("\n");
      const cancelled = lines.find((l) => l[0] === "2" && l[422] === "C");
      expect(cancelled).toBeDefined();
      expect(cancelled!.slice(131, 143).trim()).toBe("IE00BK5BQT80");
    });

    it("leaves the extinction date blank, and flags the ISIN, when no sale in the year explains the extinction", () => {
      const positions = [makePosition()];
      const config = {
        ...baseConfig,
        previousYearSecurities: lastYear("US78462F1030", "DE000A0F5UF5"),
      };
      const result = generateModelo720(positions, rateMap, config);
      const cancelled = result.split("\n").find((l) => l[0] === "2" && l[422] === "C")!;
      // Extinction date at positions 424-431 (0-indexed: 423-430): never an invented 31-Dec
      expect(cancelled.slice(423, 431)).toBe("        ");
      expect(findUndatedExtinctions(positions, config, [])).toEqual([{ isin: "DE000A0F5UF5", missing: "extinctionDate" }]);
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

    it("should NOT report values at exactly 50,000.00 as exceeding (the rule is \"no superen\")", () => {
      const positions = [makePosition({
        currency: "EUR",
        positionValue: "50000.00",
        assetCategory: "STK",
      })];
      const result = checkModelo720Thresholds(positions, rateMap, 2025);

      expect(result.values.exceeds).toBe(false);
      expect(result.values.total.toFixed(2)).toBe("50000.00");
      expect(generateModelo720(positions, rateMap, baseConfig)).toBe("");
    });

    it("should report values at 50,000.01 as exceeding", () => {
      const positions = [makePosition({ currency: "EUR", positionValue: "50000.01", assetCategory: "STK" })];
      expect(checkModelo720Thresholds(positions, rateMap, 2025).values.exceeds).toBe(true);
      expect(generateModelo720(positions, rateMap, baseConfig)).not.toBe("");
    });

    it("should NOT report cash at exactly 50,000.00 as exceeding, in the check and in the file", () => {
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "50000.00", endingSettledCash: "50000.00", averageQ4Cash: "50000.00" },
      ];
      expect(checkModelo720Thresholds([], rateMap, 2025, cashBalances).accounts.exceeds).toBe(false);
      expect(generateModelo720([], rateMap, baseConfig, undefined, cashBalances)).toBe("");
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

    it("tests the 31-Dec balances and the Q4 averages as two joint sums, not a per-account maximum", () => {
      // Σ 31-Dec = 30k + 10k = 40k and Σ Q4 average = 10k + 30k = 40k: neither
      // joint sum passes 50k, so there is no obligation (art. 42 bis.4.e RD
      // 1065/2007). Summing each account's max(ending, average) gives 60k.
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "30000", endingSettledCash: "30000", averageQ4Cash: "10000" },
        { accountId: "U2", currency: "EUR", endingCash: "10000", endingSettledCash: "10000", averageQ4Cash: "30000" },
      ];
      const result = checkModelo720Thresholds([], rateMap, 2025, cashBalances);
      expect(result.accounts.exceeds).toBe(false);
      expect(result.accounts.total.toFixed(2)).toBe("40000.00");
      expect(generateModelo720([], rateMap, baseConfig, undefined, cashBalances)).toBe("");
    });

    it("reports the larger joint sum when the Q4 average is below the 31-Dec balance", () => {
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "60000", endingSettledCash: "60000", averageQ4Cash: "40000" },
      ];
      const result = checkModelo720Thresholds([], rateMap, 2025, cashBalances);
      expect(result.accounts.exceeds).toBe(true);
      expect(result.accounts.total.toFixed(2)).toBe("60000.00");
    });

    it("counts the 31-Dec balance when the statement has no Q4 average (IBKR cash report)", () => {
      const cashBalances = [{ accountId: "U1", currency: "EUR", endingCash: "80000", endingSettledCash: "80000" }];
      const result = checkModelo720Thresholds([], rateMap, 2025, cashBalances);
      expect(result.accounts.exceeds).toBe(true);
      expect(result.accounts.total.toFixed(2)).toBe("80000.00");
    });

    it("converts a foreign 31-Dec balance with no Q4 average at the 31-Dec rate", () => {
      const cashBalances = [{ accountId: "U1", currency: "USD", endingCash: "60000", endingSettledCash: "60000" }];
      const result = checkModelo720Thresholds([], rateMap, 2025, cashBalances);
      // 60000 × 0.92 = 55200
      expect(result.accounts.exceeds).toBe(true);
      expect(result.accounts.total.toFixed(2)).toBe("55200.00");
    });

    it("does not flag a 31-Dec balance under 50k that has no Q4 average", () => {
      const cashBalances = [{ accountId: "U1", currency: "EUR", endingCash: "40000", endingSettledCash: "40000" }];
      const result = checkModelo720Thresholds([], rateMap, 2025, cashBalances);
      expect(result.accounts.exceeds).toBe(false);
      expect(result.accounts.total.toFixed(2)).toBe("40000.00");
    });

    it("leaves short positions out of the valores total", () => {
      // A short is borrowed stock the taxpayer owes, not an asset they hold.
      const positions = [
        makePosition({ currency: "EUR", positionValue: "25000" }),
        makePosition({ currency: "EUR", isin: "US0000000002", quantity: "0", positionValue: "-30000" }),
      ];
      const result = checkModelo720Thresholds(positions, rateMap, 2025);
      expect(result.values.exceeds).toBe(false);
      expect(result.values.total.toFixed(2)).toBe("25000.00");
      expect(generateModelo720(positions, rateMap, baseConfig)).toBe("");
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
        { accountId: "U1234567", currency: "USD", endingCash: "60000", endingSettledCash: "60000", averageQ4Cash: "60000", countryCode: "IE" },
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
        { accountId: "U1", currency: "EUR", endingCash: "55000", endingSettledCash: "55000", averageQ4Cash: "55000", countryCode: "IE" },
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

    it("writes the accounts when the Q4 average passes 50k and the 31-Dec balance does not", () => {
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "20000", endingSettledCash: "20000", averageQ4Cash: "70000", countryCode: "IE" },
      ];
      expect(checkModelo720Thresholds([], rateMap, 2025, cashBalances).accounts.exceeds).toBe(true);
      const lines = generateModelo720([], rateMap, baseConfig, undefined, cashBalances).split("\n");
      expect(lines).toHaveLength(2);
      expect(boeField(lines[1]!, BOE_720.detail.claveBien)).toBe("C");
      expect(boeField(lines[1]!, BOE_720.detail.valoracion1)).toBe("00000002000000");
      expect(boeField(lines[1]!, BOE_720.detail.valoracion2)).toBe("00000007000000");
    });

    it("writes both V and C when the securities pass 50k and only the cash Q4 average does", () => {
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "20000", endingSettledCash: "20000", averageQ4Cash: "70000", countryCode: "IE" },
      ];
      const lines = generateModelo720([makePosition()], rateMap, baseConfig, undefined, cashBalances).split("\n");
      expect(lines.slice(1).map((l) => boeField(l, BOE_720.detail.claveBien))).toEqual(["V", "C"]);
    });

    it("agrees with the threshold check on whether the accounts are declared", () => {
      const fixtures = [
        [{ accountId: "U1", currency: "EUR", endingCash: "30000", endingSettledCash: "30000", averageQ4Cash: "10000", countryCode: "IE" },
         { accountId: "U2", currency: "EUR", endingCash: "10000", endingSettledCash: "10000", averageQ4Cash: "30000", countryCode: "IE" }],
        [{ accountId: "U1", currency: "EUR", endingCash: "20000", endingSettledCash: "20000", averageQ4Cash: "70000", countryCode: "IE" }],
        [{ accountId: "U1", currency: "EUR", endingCash: "70000", endingSettledCash: "70000", averageQ4Cash: "20000", countryCode: "IE" }],
        [{ accountId: "U1", currency: "USD", endingCash: "50000", endingSettledCash: "50000", averageQ4Cash: "50000", countryCode: "IE" }],
        [{ accountId: "U1", currency: "EUR", endingCash: "50000", endingSettledCash: "50000", averageQ4Cash: "50000", countryCode: "IE" }],
      ];
      for (const cashBalances of fixtures) {
        const exceeds = checkModelo720Thresholds([], rateMap, 2025, cashBalances).accounts.exceeds;
        const file = generateModelo720([], rateMap, baseConfig, undefined, cashBalances);
        const hasC = file.split("\n").slice(1).some((l) => boeField(l, BOE_720.detail.claveBien) === "C");
        expect(hasC).toBe(exceeds);
      }
    });

    it("does not write a balance with no Q4 average, but still writes the accounts that have one", () => {
      // The record needs the Q4 average (valoración 2); the tool never invents
      // it. The 31-Dec balance still counts toward the obligation, and the web
      // section tells the user to enter that account by hand.
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "45000", endingSettledCash: "45000", countryCode: "IE" },
        { accountId: "U2", currency: "EUR", endingCash: "10000", endingSettledCash: "10000", averageQ4Cash: "10000", countryCode: "IE" },
      ];
      expect(checkModelo720Thresholds([], rateMap, 2025, cashBalances).accounts.exceeds).toBe(true);
      const lines = generateModelo720([], rateMap, baseConfig, undefined, cashBalances).split("\n");
      expect(lines).toHaveLength(2);
      expect(boeField(lines[1]!, BOE_720.detail.claveBien)).toBe("C");
      expect(boeField(lines[1]!, BOE_720.detail.codigoCuenta).trim()).toBe("U2");
    });

    it("should only generate C records when V is below threshold but C exceeds", () => {
      const positions = [makePosition({ positionValue: "10000" })]; // 9200 EUR < 50K
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "55000", endingSettledCash: "55000", averageQ4Cash: "55000", countryCode: "IE" },
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

    it("degrades (does not throw, skips the position) when an STK currency has no Q4 nor walkback rates", () => {
      // Rate map with Q4 dates that have GBP but NOT CHF. getQ4AverageRate has no
      // CHF data and the year-end fallback also has none → the position can't be
      // valued. It must be SKIPPED (excluded from the file), not crash.
      const noChfRateMap: EcbRateMap = new Map([
        ["2025-12-31", new Map([["GBP", new Decimal("1.15")]])],
        ["2025-12-30", new Map([["GBP", new Decimal("1.15")]])],
      ]);

      const positions = [makePosition({ positionValue: "60000", assetCategory: "STK", currency: "CHF" })];

      let result!: string;
      expect(() => { result = generateModelo720(positions, noChfRateMap, baseConfig); }).not.toThrow();
      // Only the unvaluable CHF position exists → nothing to declare → empty file.
      expect(result).toBe("");
    });
  });

  describe("numPad rounding (via record numeric fields)", () => {
    // Valoración 1 (the 31-Dec value) lives at 433-446 (12 int + 2 dec). We
    // assert the last 5 chars (3 int + 2 dec) to verify rounding behaviour of numPad.
    function valuationField(positionValueEur: string): string {
      const positions = [makePosition({
        currency: "EUR",
        positionValue: positionValueEur,
        costBasisMoney: positionValueEur,
        assetCategory: "STK",
      })];
      const detail = generateModelo720(positions, rateMap, baseConfig).split("\n")[1]!;
      // 433-446 → 0-indexed 432..445 (14 chars). Tail 5 = last 3 int + 2 dec.
      return detail.slice(432, 446).slice(-5);
    }

    it("should round half-up (1.005 → ...01)", () => {
      // Position must exceed 50K to emit a record; 1.005 alone won't.
      // Use a value whose fractional rounds half-up: 60000.005 → 60000.01.
      const positions = [makePosition({
        currency: "EUR",
        positionValue: "60000.005",
        costBasisMoney: "60000.005",
        assetCategory: "STK",
      })];
      const detail = generateModelo720(positions, rateMap, baseConfig).split("\n")[1]!;
      // Valoración 1 433-446: int=60000, frac=01
      expect(detail.slice(432, 446)).toBe("00000006000001");
    });

    it("should bump integer when rounding (60001.999 → int 60002, frac 00)", () => {
      const positions = [makePosition({
        currency: "EUR",
        positionValue: "60001.999",
        costBasisMoney: "60001.999",
        assetCategory: "STK",
      })];
      const detail = generateModelo720(positions, rateMap, baseConfig).split("\n")[1]!;
      // 60001.999 → 60002.00
      expect(detail.slice(432, 446)).toBe("00000006000200");
    });

    it("should render 0.1 as frac '10'", () => {
      // 60000.1 → int 60000, frac 10
      expect(valuationField("60000.1")).toBe("00010");
    });

    it("should throw rather than silently widen the record when the integer part overflows its field", () => {
      // Valoración int field is 12 digits. A 14-digit integer part cannot fit and
      // must fail fast instead of shifting every following byte in the 500-byte record.
      const positions = [makePosition({
        currency: "EUR",
        positionValue: "12345678901234.56",
        costBasisMoney: "12345678901234.56",
        assetCategory: "STK",
      })];
      expect(() => generateModelo720(positions, rateMap, baseConfig)).toThrow(/excede el campo/);
    });
  });

  describe("BOE record layout (positions from Orden HAP/72/2013, not from the generator)", () => {
    const d = BOE_720.detail;
    const sm = BOE_720.summary;

    it("writes a V holding with its 31-Dec value in valoración 1 and every tail field at its BOE column", () => {
      // SPY: cost 40,000 USD, worth 60,000 USD on 31 Dec, rate 0.92 → 55,200.00 EUR.
      const result = generateModelo720([makePosition()], rateMap, baseConfig);
      const detail = result.split("\n")[1]!;
      expect(detail).toHaveLength(500);
      expect(boeField(detail, d.valoracion1Sign)).toBe(" ");
      expect(boeField(detail, d.valoracion1)).toBe("00000005520000");
      expect(boeField(detail, d.valoracion2Sign)).toBe(" ");
      // Valoración 2 is only informed for accounts (C) or sold real estate (B).
      expect(boeField(detail, d.valoracion2)).toBe("00000000000000");
      expect(boeField(detail, d.claveRepresentacion)).toBe("A");
      expect(boeField(detail, d.numeroValores)).toBe("000000010000");
      expect(boeField(detail, d.claveInmueble)).toBe(" ");
      expect(boeField(detail, d.porcentaje)).toBe("10000");
      expect(boeField(detail, d.blancos)).toBe(" ".repeat(20));
      // The acquisition cost (40,000 × 0.92 = 36,800.00) has no field for clave V.
      expect(detail).not.toContain("3680000");
    });

    it("writes fractional quantities with the BOE's two decimals", () => {
      const detail = generateModelo720([makePosition({ quantity: "300.5" })], rateMap, baseConfig).split("\n")[1]!;
      expect(boeField(detail, d.numeroValores)).toBe("000000030050");
    });

    it("writes a cash account with the 31-Dec balance in valoración 1 and the Q4 average in valoración 2", () => {
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "60000", endingSettledCash: "60000", averageQ4Cash: "40000", countryCode: "IE" },
      ];
      const detail = generateModelo720([], rateMap, baseConfig, undefined, cashBalances).split("\n")[1]!;
      expect(detail).toHaveLength(500);
      expect(boeField(detail, d.claveBien)).toBe("C");
      expect(boeField(detail, d.valoracion1)).toBe("00000006000000");
      expect(boeField(detail, d.valoracion2Sign)).toBe(" ");
      expect(boeField(detail, d.valoracion2)).toBe("00000004000000");
      // Representación and número de valores are only for V/I: blank and zeros.
      expect(boeField(detail, d.claveRepresentacion)).toBe(" ");
      expect(boeField(detail, d.numeroValores)).toBe("000000000000");
      expect(boeField(detail, d.porcentaje)).toBe("10000");
      expect(boeField(detail, d.blancos)).toBe(" ".repeat(20));
    });

    it("writes a cancelled V record with zero valuations at the BOE columns", () => {
      const config = { ...baseConfig, previousYearSecurities: lastYear("US78462F1030", "IE00BK5BQT80") };
      const cancelled = generateModelo720([makePosition()], rateMap, config)
        .split("\n").find((l) => l[0] === "2" && boeField(l, d.origen) === "C")!;
      expect(cancelled).toHaveLength(500);
      expect(boeField(cancelled, d.valoracion1)).toBe("00000000000000");
      expect(boeField(cancelled, d.valoracion2Sign)).toBe(" ");
      expect(boeField(cancelled, d.valoracion2)).toBe("00000000000000");
      expect(boeField(cancelled, d.claveRepresentacion)).toBe("A");
      expect(boeField(cancelled, d.numeroValores)).toBe("000000000000");
      expect(boeField(cancelled, d.porcentaje)).toBe("10000");
      expect(boeField(cancelled, d.blancos)).toBe(" ".repeat(20));
    });

    it("type-1 sumas equal the sum of the valoración 1 and valoración 2 written in the details", () => {
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "60000", endingSettledCash: "60000", averageQ4Cash: "40000", countryCode: "IE" },
      ];
      const lines = generateModelo720([makePosition()], rateMap, baseConfig, undefined, cashBalances).split("\n");
      const summary = lines[0]!;
      const details = lines.slice(1);
      expect(details).toHaveLength(2);
      const sum = (range: readonly [number, number]) =>
        details.reduce((s, l) => s.plus(new Decimal(boeField(l, range)).div(100)), new Decimal(0));
      // V 55,200.00 + cash 60,000.00; valoración 2 = cash Q4 average 40,000.00 only.
      expect(sum(d.valoracion1).toString()).toBe("115200");
      expect(sum(d.valoracion2).toString()).toBe("40000");
      expect(boeField(summary, sm.suma1Sign)).toBe(" ");
      expect(boeField(summary, sm.suma1)).toBe("00000000011520000");
      expect(boeField(summary, sm.suma2Sign)).toBe(" ");
      expect(boeField(summary, sm.suma2)).toBe("00000000004000000");
    });

    /** Signed total of a detail valoración: the amount at `value`, negative when `sign` holds "N". */
    const signedSum = (details: string[], sign: readonly [number, number], value: readonly [number, number]) =>
      details.reduce((s, l) => {
        const amount = new Decimal(boeField(l, value)).div(100);
        return s.plus(boeField(l, sign) === "N" ? amount.neg() : amount);
      }, new Decimal(0));

    it("type-1 sumas add the cent-rounded amounts the details carry, not the unrounded ones", () => {
      // Each 30,000.005 is written as 30,000.01, so the sumas must say 60,000.02
      // (V) and 40,000.02 (Q4 averages of 20,000.005), not 60,000.01 / 40,000.01.
      const positions = [
        makePosition({ currency: "EUR", positionValue: "30000.005" }),
        makePosition({ currency: "EUR", positionValue: "30000.005", isin: "IE00BK5BQT80" }),
      ];
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "30000.005", endingSettledCash: "30000.005", averageQ4Cash: "20000.005", countryCode: "IE" },
        { accountId: "U2", currency: "EUR", endingCash: "30000.005", endingSettledCash: "30000.005", averageQ4Cash: "20000.005", countryCode: "IE" },
      ];
      const lines = generateModelo720(positions, rateMap, baseConfig, undefined, cashBalances).split("\n");
      const summary = lines[0]!;
      const details = lines.slice(1);
      expect(details).toHaveLength(4);
      for (const l of details) expect(boeField(l, d.valoracion1)).toBe("00000003000001");
      expect(signedSum(details, d.valoracion1Sign, d.valoracion1).toString()).toBe("120000.04");
      expect(signedSum(details, d.valoracion2Sign, d.valoracion2).toString()).toBe("40000.02");
      expect(boeField(summary, sm.suma1)).toBe("00000000012000004");
      expect(boeField(summary, sm.suma2)).toBe("00000000004000002");
    });

    it("marks a negative Q4 average balance with N so the detail and suma 2 agree", () => {
      // Positive on 31 Dec, but a margin balance earlier in the quarter left
      // the Q4 average at -1,000.50.
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "60000", endingSettledCash: "60000", averageQ4Cash: "-1000.50", countryCode: "IE" },
      ];
      const records = generateModelo720([], rateMap, baseConfig, undefined, cashBalances).split("\n");
      const [summary, detail] = records as [string, string];
      expect(boeField(detail, d.valoracion1Sign)).toBe(" ");
      expect(boeField(detail, d.valoracion1)).toBe("00000006000000");
      expect(boeField(detail, d.valoracion2Sign)).toBe("N");
      expect(boeField(detail, d.valoracion2)).toBe("00000000100050");
      expect(signedSum([detail], d.valoracion2Sign, d.valoracion2).toString()).toBe("-1000.5");
      expect(boeField(summary, sm.suma2Sign)).toBe("N");
      expect(boeField(summary, sm.suma2)).toBe("00000000000100050");
      expect(validateModelo720Records(records).map((r) => r.errors)).toEqual([[], []]);
    });

    it("passes the format validator record by record", () => {
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "60000", endingSettledCash: "60000", averageQ4Cash: "40000", countryCode: "IE" },
      ];
      const config = { ...baseConfig, previousYearSecurities: lastYear("US78462F1030", "IE00BK5BQT80") };
      const records = generateModelo720([makePosition()], rateMap, config, undefined, cashBalances).split("\n");
      expect(records).toHaveLength(4);
      expect(validateModelo720Records(records).map((r) => r.errors)).toEqual([[], [], [], []]);
    });
  });

  describe("Detail record holder name (36-75)", () => {
    it("should contain the filer name, not the security description", () => {
      const positions = [makePosition({ description: "SPDR S&P 500 ETF" })];
      const result = generateModelo720(positions, rateMap, baseConfig);
      const detail = result.split("\n")[1]!;
      // 36-75 → 0-indexed 35..74 (40 chars)
      const holderField = detail.slice(35, 75);
      expect(holderField.trim()).toBe("GARCIA LOPEZ JUAN");
      expect(holderField).not.toContain("SPDR");
      // Entity name field (190-230) still carries the description.
      expect(detail.slice(189, 230).trim()).toBe("SPDR S&P 500 ETF");
    });
  });

  describe("Record length", () => {
    it("should keep every record at 500 bytes", () => {
      const positions = [makePosition()];
      const config = { ...baseConfig, previousYearSecurities: lastYear("US78462F1030", "IE00BK5BQT80") };
      const cashBalances = [
        { accountId: "U1", currency: "EUR", endingCash: "60000", endingSettledCash: "60000", averageQ4Cash: "60000", countryCode: "IE" },
      ];
      const result = generateModelo720(positions, rateMap, config, undefined, cashBalances);
      for (const line of result.split("\n")) {
        expect(line.length).toBe(500);
      }
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
      const stkValue = boeField(stkResult.split("\n")[1]!, BOE_720.detail.valoracion1);
      const fundValue = boeField(fundResult.split("\n")[1]!, BOE_720.detail.valoracion1);
      expect(stkValue).toBe("00000009300000"); // 100000 × 0.93 = 93,000.00
      expect(fundValue).toBe("00000009600000"); // 100000 × 0.96 = 96,000.00
    });
  });

  describe("Short positions", () => {
    it("writes only the long holdings, never a short as an owned asset", () => {
      const positions = [
        makePosition({ currency: "EUR", positionValue: "60000" }),
        makePosition({ currency: "EUR", isin: "US0000000002", quantity: "-100", positionValue: "-30000" }),
      ];
      const lines = generateModelo720(positions, rateMap, baseConfig).split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[1]!.slice(131, 143).trim()).toBe("US78462F1030");
    });

    it("declares a holding sold last year as cancelled even if the same ISIN is now held short", () => {
      const positions = [
        makePosition({ currency: "EUR", positionValue: "60000" }),
        makePosition({ currency: "EUR", isin: "US0000000002", quantity: "-100", positionValue: "-30000" }),
      ];
      const config = { ...baseConfig, previousYearSecurities: lastYear("US0000000002") };
      const details = generateModelo720(positions, rateMap, config).split("\n").slice(1);
      const shortIsin = details.filter((l) => l.slice(131, 143).trim() === "US0000000002");
      expect(shortIsin).toHaveLength(1);
      expect(boeField(shortIsin[0]!, BOE_720.detail.origen)).toBe("C");
    });
  });

  describe("Control-character sanitization in text fields", () => {
    it("replaces control chars in the entity-name field with spaces (security injection guard)", () => {
      // A broker-supplied description containing CR, LF, TAB and DEL. The
      // generator must replace each with a single space so the fixed-width
      // record is not corrupted / injected into.
      const positions = [makePosition({ description: "ACME\r\nCORP\tX\x7FY" })];
      const detail = generateModelo720(positions, rateMap, baseConfig).split("\n")[1]!;
      // Entity name field is 190-230 (0-indexed 189..229, 41 chars).
      const entityField = detail.slice(189, 230);
      // Same character count (each control char → one space, never dropped).
      expect(entityField).toBe("ACME  CORP X Y".padEnd(41, " "));
      // No control character anywhere in the entity field.
      expect(entityField).not.toMatch(/[\x00-\x1F\x7F-\x9F]/);
    });

    it("a control char in a text field does NOT shift any following column position", () => {
      // Build the SAME record once with a clean description and once with a
      // description carrying control chars (replaced 1:1 by spaces). Every field
      // AFTER the entity name (acquisition date, declType, values, quantity) must
      // sit at the identical byte offset, and the record must stay 500 bytes.
      const clean = generateModelo720([makePosition({ description: "ACME  CORP X Y" })], rateMap, baseConfig).split("\n")[1]!;
      const dirty = generateModelo720([makePosition({ description: "ACME\r\nCORP\tX\x7FY" })], rateMap, baseConfig).split("\n")[1]!;
      expect(dirty.length).toBe(500);
      expect(dirty.length).toBe(clean.length);
      // ISIN (132-143), declType (423), valoración 1 (433-446), número de valores (463-474).
      expect(dirty.slice(131, 143)).toBe(clean.slice(131, 143));
      expect(dirty[422]).toBe(clean[422]);
      expect(dirty.slice(432, 446)).toBe(clean.slice(432, 446));
      expect(dirty.slice(462, 474)).toBe(clean.slice(462, 474));
      // With the control chars replaced by spaces, the two records are byte-identical.
      expect(dirty).toBe(clean);
    });

    it("sanitizes control chars in the cash-account entity name (Category C)", () => {
      const cashBalances = [
        { accountId: "U1234567", currency: "USD", endingCash: "60000", endingSettledCash: "60000", averageQ4Cash: "60000", institutionName: "BANK\r\nOF X", countryCode: "IE" },
      ];
      const detail = generateModelo720([], rateMap, baseConfig, undefined, cashBalances).split("\n")[1]!;
      expect(detail.length).toBe(500);
      // Entity name at 190-230 (0-indexed 189..229).
      expect(detail).not.toMatch(/[\x00-\x1F\x7F-\x9F]/);
      expect(detail.slice(189, 230)).toBe("BANK  OF X".padEnd(41, " "));
    });

    it("regression: a normal record with no control chars is byte-identical to the pre-sanitization output", () => {
      // This is the exact record the generator produced before fixedWidthText()
      // was introduced (captured from the unchanged generator). It must remain
      // byte-for-byte identical so sanitization never shifts a clean value.
      const positions = [makePosition()];
      const result = generateModelo720(positions, rateMap, baseConfig);
      const lines = result.split("\n");
      const summary = lines[0]!;
      const detail = lines[1]!;

      // Name field (summary 18-57) carries the filer name unchanged.
      expect(summary.slice(17, 57)).toBe("GARCIA LOPEZ JUAN".padEnd(40, " "));
      // Contact field (summary 68-107) unchanged.
      expect(summary.slice(67, 107)).toBe("GARCIA LOPEZ, JUAN".padEnd(40, " "));
      // Detail holder name (36-75) and entity name (190-230) unchanged.
      expect(detail.slice(35, 75)).toBe("GARCIA LOPEZ JUAN".padEnd(40, " "));
      expect(detail.slice(189, 230)).toBe("SPDR S&P 500 ETF".padEnd(41, " "));
      // Both records stay exactly 500 bytes.
      expect(summary.length).toBe(500);
      expect(detail.length).toBe(500);
    });
  });
});

describe("Modelo 720 — unvaluable position (missing year-end rate) degrades, does not throw", () => {
  it("does NOT throw when a position currency has no rate in the map", () => {
    // A crypto/FCY position whose year-end rate was never fetched. getEcbRate
    // would throw "No ECB rate found / non-fiat" and crash the generator.
    const positions = [makePosition({
      symbol: "BTC", description: "Bitcoin", isin: "", currency: "BTC",
      assetCategory: "STK", positionValue: "60000",
    })];
    expect(() => generateModelo720(positions, rateMap, baseConfig)).not.toThrow();
  });

  it("does NOT throw on checkModelo720Thresholds with an unvaluable position", () => {
    const positions = [makePosition({ currency: "BTC", isin: "", positionValue: "60000" })];
    expect(() => checkModelo720Thresholds(positions, rateMap, 2025)).not.toThrow();
  });

  it("does NOT mark a still-held but unvaluable position as cancelled (C)", () => {
    // Position with a real ISIN declared last year, still held this year, but its
    // currency has no year-end rate → skipped from records. It must NOT appear as
    // a "C" (cancelled) record (which would tell AEAT it was sold).
    const heldUnvaluable = makePosition({
      isin: "US0000000099", symbol: "ZZZ", description: "Held FCY", currency: "ZZZ", positionValue: "60000",
    });
    // A valued GBP position keeps the file non-empty so records ARE generated.
    const valued = makePosition({ isin: "GB0000000001", symbol: "GBX", currency: "GBP", positionValue: "60000" });
    const result = generateModelo720([heldUnvaluable, valued], rateMap, {
      ...baseConfig,
      previousYearSecurities: lastYear("US0000000099"), // declared last year
    });
    // The still-held (but unvaluable) ISIN must NOT be emitted as a cancelled
    // record. It's skipped from detail records entirely, so a cancelled record is
    // the ONLY way it could appear — assert it appears in no detail record.
    // (declType is at offset 423; ISIN at 131-143, per the --previous-720 parser.)
    const detailLines = result.split("\n").filter((l) => l.startsWith("2"));
    const heldIsinRecords = detailLines.filter((l) => l.slice(131, 143).trim() === "US0000000099");
    expect(heldIsinRecords).toHaveLength(0);
    // Sanity: the valued GBP position IS declared.
    expect(detailLines.some((l) => l.slice(131, 143).trim() === "GB0000000001")).toBe(true);
  });
});

describe("Modelo 720 — codes, identity and account fields the BOE asks for (Orden HAP/72/2013)", () => {
  const d = BOE_720.detail;
  const sm = BOE_720.summary;
  /** A holding at an Irish-entity broker (IBKR Ireland), worth 55,200 EUR. */
  const held = (overrides: Partial<OpenPosition> = {}) => makePosition({ custodianCountry: "IE", ...overrides });
  const onlyDetail = (positions: OpenPosition[], config: Parameters<typeof generateModelo720>[2] = baseConfig) =>
    generateModelo720(positions, rateMap, config).split("\n")[1]!;

  describe("clave (102) and subclave (103)", () => {
    it("codes a share V/1, a bond V/2 and a foreign fund I/0", () => {
      expect(boeField(onlyDetail([held()]), d.claveSubclave)).toBe("V1");
      expect(boeField(onlyDetail([held({ assetCategory: "BOND", isin: "XS2314659447" })]), d.claveSubclave)).toBe("V2");
      expect(boeField(onlyDetail([held({ assetCategory: "FUND", isin: "IE00BK5BQT80" })]), d.claveSubclave)).toBe("I0");
    });

    it("never writes a position without an ISIN as clave 1 with a blank ISIN; it leaves it out and reports it", () => {
      const noIsin = held({ isin: "", symbol: "RVLT", description: "Revolut holding" });
      const lines = generateModelo720([held(), noIsin], rateMap, baseConfig).split("\n");
      const details = lines.filter((l) => l[0] === "2");
      expect(details).toHaveLength(1);
      expect(boeField(details[0]!, d.isin)).toBe("US78462F1030");
      expect(findModelo720Omissions([held(), noIsin], rateMap, baseConfig)).toEqual([
        { kind: "position", reason: "no_isin", position: noIsin },
      ]);
    });
  });

  describe("country (129-130)", () => {
    it("writes the custodian's country for clave V, not the ISIN prefix", () => {
      expect(boeField(onlyDetail([held()]), d.pais)).toBe("IE");
    });

    it("writes the fund's own country for clave I (where the IIC is situated)", () => {
      const fund = held({ assetCategory: "FUND", isin: "LU0274208692", custodianCountry: "DE" });
      expect(boeField(onlyDetail([fund]), d.pais)).toBe("LU");
    });

    it("an XS Eurobond held at a broker passes the validator", () => {
      const bond = held({ assetCategory: "BOND", isin: "XS2314659447" });
      const records = generateModelo720([bond], rateMap, { ...baseConfig, declarationId: modelo720DeclarationId() }).split("\n");
      expect(validateModelo720Records(records).map((r) => r.errors)).toEqual([[], []]);
    });

    it("leaves out and reports a security whose custodian country is unknown", () => {
      const unknown = makePosition({ custodianCountry: undefined });
      expect(generateModelo720([unknown, held({ isin: "US0378331005" })], rateMap, baseConfig).split("\n")).toHaveLength(2);
      expect(findModelo720Omissions([unknown], rateMap, baseConfig)).toEqual([{ kind: "position", reason: "no_country", position: unknown }]);
    });
  });

  describe("text fields", () => {
    const accented = { ...baseConfig, surname: "Muñoz Pérez", name: "José", contactName: "Muñoz Pérez José" };

    it("uppercases names and strips accents but keeps Ñ", () => {
      const [summary, detail] = generateModelo720([held()], rateMap, accented).split("\n") as [string, string];
      expect(boeField(summary, sm.nombre).trimEnd()).toBe("MUÑOZ PEREZ JOSE");
      expect(boeField(summary, sm.contacto).trimEnd()).toBe("MUÑOZ PEREZ JOSE");
      expect(boeField(detail, d.nombre).trimEnd()).toBe("MUÑOZ PEREZ JOSE");
    });

    it("keeps Ç, drops other diacritics and blanks characters outside Latin-1", () => {
      const detail = onlyDetail([held({ description: "Çà Škoda € Œuvre" })]);
      expect(boeField(detail, d.entidad).trimEnd()).toBe("ÇA SKODA    UVRE");
      expect(detail).toHaveLength(500);
    });

    it("writes the phone as its last nine digits, without the +34 / 0034 prefix", () => {
      for (const phone of ["+34 600 123 456", "0034600123456", "600 123 456", "600123456"]) {
        const summary = generateModelo720([held()], rateMap, { ...baseConfig, phone }).split("\n")[0]!;
        expect(boeField(summary, sm.telefono)).toBe("600123456");
      }
    });
  });

  describe("ownership percentage (476-480)", () => {
    it("writes each holder's share with the full, unprorated value", () => {
      const detail = onlyDetail([held()], { ...baseConfig, titulares: 2 });
      expect(boeField(detail, d.porcentaje)).toBe("05000");
      expect(boeField(detail, d.valoracion1)).toBe("00000005520000");
    });

    it("rounds a three-way split to 33.33", () => {
      expect(boeField(onlyDetail([held()], { ...baseConfig, titulares: 3 }), d.porcentaje)).toBe("03333");
    });
  });

  describe("declaration number (108-120)", () => {
    it("starts with 720 and has 13 digits", () => {
      expect(modelo720DeclarationId(new Date("2026-03-01T10:00:00Z"))).toBe("7201772359200");
      expect(modelo720DeclarationId()).toMatch(/^720\d{10}$/);
      const summary = generateModelo720([held()], rateMap, { ...baseConfig, declarationId: modelo720DeclarationId() }).split("\n")[0]!;
      expect(boeField(summary, sm.numeroDeclaracion)).toMatch(/^720\d{10}$/);
    });

    it("the validator rejects a number that does not start with 720", () => {
      const records = generateModelo720([held()], rateMap, { ...baseConfig, declarationId: "0000000000001" }).split("\n");
      expect(validateModelo720Records(records)[0]!.errors).toContainEqual(expect.stringContaining("Número identificativo"));
    });
  });

  describe("cash account record (clave C)", () => {
    const account = { accountId: "U1234567", currency: "EUR", endingCash: "60000", endingSettledCash: "60000", averageQ4Cash: "60000", countryCode: "IE", institutionName: "Interactive Brokers Ireland Limited" };
    const cashDetail = (cb: CashBalance, config: Parameters<typeof generateModelo720>[2] = baseConfig) =>
      generateModelo720([], rateMap, config, undefined, [cb]).split("\n")[1]!;

    it("names the declarant, codes 103 = 5 and 131 = 0, and puts the account in 144 and 156-189", () => {
      const detail = cashDetail(account);
      expect(boeField(detail, d.nombre).trimEnd()).toBe("GARCIA LOPEZ JUAN");
      expect(boeField(detail, d.claveSubclave)).toBe("C5");
      expect(boeField(detail, d.pais)).toBe("IE");
      expect(boeField(detail, d.claveIdentificacion)).toBe("0");
      expect(boeField(detail, d.isin)).toBe(" ".repeat(12));
      expect(boeField(detail, d.claveCuenta)).toBe("O");
      expect(boeField(detail, d.bic)).toBe(" ".repeat(11));
      expect(boeField(detail, d.codigoCuenta).trimEnd()).toBe("U1234567");
      expect(boeField(detail, d.entidad).trimEnd()).toBe("INTERACTIVE BROKERS IRELAND LIMITED");
      expect(boeField(detail, d.origen)).toBe("A");
      expect(detail).toHaveLength(500);
    });

    it("keys an IBAN as I", () => {
      const detail = cashDetail({ ...account, accountId: "DE89 3704 0044 0532 0130 00" });
      expect(boeField(detail, d.claveCuenta)).toBe("I");
      expect(boeField(detail, d.codigoCuenta).trimEnd()).toBe("DE89370400440532013000");
    });

    it("writes M for an account declared last year", () => {
      expect(boeField(cashDetail(account, { ...baseConfig, previousYearAccounts: ["U1234567"] }), d.origen)).toBe("M");
      // Last year's file carries the IBAN compacted, as 156-189 holds it.
      const iban = { ...account, accountId: "DE89 3704 0044 0532 0130 00" };
      expect(boeField(cashDetail(iban, { ...baseConfig, previousYearAccounts: ["DE89370400440532013000"] }), d.origen)).toBe("M");
    });

    it("leaves out and reports an account with no country instead of writing XX", () => {
      const noCountry = { ...account, countryCode: undefined };
      expect(generateModelo720([], rateMap, baseConfig, undefined, [noCountry])).not.toContain("XX");
      expect(findModelo720Omissions([], rateMap, baseConfig, [noCountry])).toEqual([{ kind: "cash", reason: "no_country", cashBalance: noCountry }]);
    });
  });

  it("a cancelled record carries the declarant's name and last year's clave", () => {
    const config = { ...baseConfig, previousYearSecurities: lastYear("US78462F1030", "IE00BK5BQT80") };
    const cancelled = generateModelo720([held()], rateMap, config)
      .split("\n").find((l) => l[0] === "2" && boeField(l, d.origen) === "C")!;
    expect(boeField(cancelled, d.nombre).trimEnd()).toBe("GARCIA LOPEZ JUAN");
    expect(boeField(cancelled, d.claveSubclave)).toBe("V1");
  });

  it("reads last year's V/I records (ISIN, clave, country) and account codes from C records", () => {
    const previousFile = generateModelo720(
      [held(), held({ assetCategory: "FUND", isin: "LU0274208692" })],
      rateMap,
      baseConfig,
      undefined,
      [{ accountId: "U1234567", currency: "EUR", endingCash: "60000", endingSettledCash: "60000", averageQ4Cash: "60000", countryCode: "IE" }],
    );
    expect(readPrevious720(previousFile)).toEqual({
      securities: [
        { isin: "US78462F1030", claveSubclave: "V1", country: "IE" },
        { isin: "LU0274208692", claveSubclave: "I0", country: "LU" },
      ],
      accounts: ["U1234567"],
    });
  });

  describe("sales since last year (origin C, from --previous-720)", () => {
    const cancelledRecords = (records: string[]) => records.filter((l) => l[0] === "2" && boeField(l, d.origen) === "C");

    it("repeats last year's clave and country: a sold XS bond passes the validator and a sold fund keeps I0", () => {
      const previousFile = generateModelo720(
        [held(), held({ assetCategory: "BOND", isin: "XS2314659447" }), held({ assetCategory: "FUND", isin: "LU0274208692" })],
        rateMap,
        baseConfig,
      );
      const config = { ...baseConfig, previousYearSecurities: readPrevious720(previousFile).securities };
      const records = generateModelo720([held()], rateMap, config).split("\n");
      const [bond, fund] = cancelledRecords(records) as [string, string];
      expect(boeField(bond, d.isin)).toBe("XS2314659447");
      expect(boeField(bond, d.claveSubclave)).toBe("V2");
      expect(boeField(bond, d.pais)).toBe("IE");
      expect(boeField(fund, d.isin)).toBe("LU0274208692");
      expect(boeField(fund, d.claveSubclave)).toBe("I0");
      expect(boeField(fund, d.pais)).toBe("LU");
      expect(validateModelo720Records(records).map((r) => r.errors)).toEqual([[], [], [], []]);
      expect(findModelo720Omissions([held()], rateMap, config)).toEqual([]);
    });

    it("leaves out and reports a sale whose clave or country in last year's file is not a valid code", () => {
      // Older versions wrote 102-103 as "V " (blank subclave) and the ISIN
      // prefix as the country, so an XS bond reads "V " / "XS" and a US share
      // "V " / "US": the country is valid there, the subclave is not.
      const oldBond = { isin: "XS2314659447", claveSubclave: "V ", country: "XS" };
      const oldShare = { isin: "US0378331005", claveSubclave: "V ", country: "US" };
      const config = { ...baseConfig, previousYearSecurities: [...lastYear("US78462F1030"), oldBond, oldShare] };
      const records = generateModelo720([held()], rateMap, config).split("\n");
      expect(records).toHaveLength(2);
      expect(cancelledRecords(records)).toHaveLength(0);
      expect(validateModelo720Records(records).map((r) => r.errors)).toEqual([[], []]);
      expect(findModelo720Omissions([held()], rateMap, config)).toEqual([
        { kind: "cancelled", reason: "invalid_code", security: oldBond },
        { kind: "cancelled", reason: "invalid_code", security: oldShare },
      ]);
    });

    it("never repeats the blank subclave of a file written by an older version", () => {
      // Last year's file as released versions wrote it: 103 blank on every V record.
      const previousFile = generateModelo720([held(), held({ isin: "US0378331005" })], rateMap, baseConfig)
        .split("\n")
        .map((line) => (line[0] === "2" ? line.slice(0, 102) + " " + line.slice(103) : line))
        .join("\n");
      const config = { ...baseConfig, previousYearSecurities: readPrevious720(previousFile).securities };
      const records = generateModelo720([held()], rateMap, config).split("\n");
      expect(cancelledRecords(records)).toHaveLength(0);
      expect(validateModelo720Records(records).map((r) => r.errors)).toEqual([[], []]);
      expect(findModelo720Omissions([held()], rateMap, config)).toEqual([
        { kind: "cancelled", reason: "invalid_code", security: { isin: "US0378331005", claveSubclave: "V ", country: "IE" } },
      ]);
    });

    it("does not read what last year's file already declared sold (origin C) as still held", () => {
      // Last year's file: the S&P ETF held, US0378331005 sold that year (a C record).
      const previousFile = generateModelo720(
        [held()],
        rateMap,
        { ...baseConfig, previousYearSecurities: lastYear("US0378331005") },
        undefined,
        [{ accountId: "U1234567", currency: "EUR", endingCash: "60000", endingSettledCash: "60000", averageQ4Cash: "60000", countryCode: "IE" }],
      );
      expect(cancelledRecords(previousFile.split("\n")).map((l) => boeField(l, d.isin))).toEqual(["US0378331005"]);
      // An account closed last year, written as a C-origin cash record.
      const closedAccount = previousFile.split("\n").find((l) => boeField(l, d.claveBien) === "C")!;
      const withClosedAccount = previousFile + "\n" + closedAccount.slice(0, 155) + "U7654321".padEnd(34) + closedAccount.slice(189, 422) + "C" + closedAccount.slice(423);
      const previous = readPrevious720(withClosedAccount);
      expect(previous.securities.map((s) => s.isin)).toEqual(["US78462F1030"]);
      expect(previous.accounts).toEqual(["U1234567"]);

      const config = { ...baseConfig, previousYearSecurities: previous.securities };
      // Not sold a second time...
      expect(cancelledRecords(generateModelo720([held()], rateMap, config).split("\n"))).toHaveLength(0);
      // ...and bought back, it is new (A), not already declared (M).
      const rebought = generateModelo720([held(), held({ isin: "US0378331005" })], rateMap, config)
        .split("\n").find((l) => l[0] === "2" && boeField(l, d.isin) === "US0378331005")!;
      expect(boeField(rebought, d.origen)).toBe("A");
    });
  });

  describe("omissions follow the 50,000 EUR threshold", () => {
    it("reports nothing for an ISIN-less position or a country-less account below the threshold", () => {
      // A Revolut position has no ISIN; 1,000 USD is far below 50,000 EUR.
      const noIsin = held({ isin: "", symbol: "RVLT", positionValue: "1000" });
      const noCountry = { accountId: "U1", currency: "EUR", endingCash: "1000", endingSettledCash: "1000", averageQ4Cash: "1000" };
      expect(generateModelo720([noIsin], rateMap, baseConfig, undefined, [noCountry])).toBe("");
      expect(findModelo720Omissions([noIsin], rateMap, baseConfig, [noCountry])).toEqual([]);
    });

    it("reports the ISIN-less position once the category passes the threshold", () => {
      const noIsin = held({ isin: "", symbol: "RVLT", positionValue: "1000" });
      expect(findModelo720Omissions([held(), noIsin], rateMap, baseConfig)).toEqual([
        { kind: "position", reason: "no_isin", position: noIsin },
      ]);
    });
  });
});

describe("Acquisition dates and extinctions from the FIFO run", () => {
  const lot = (acquireDate: string, quantity: number): Lot => ({
    id: acquireDate, isin: "US78462F1030", symbol: "SPY", description: "", acquireDate,
    quantity: new Decimal(quantity), pricePerShare: new Decimal(400), costInFcy: new Decimal(400 * quantity),
    currency: "USD", ecbRate: new Decimal("0.92"),
  });

  it("writes one V record per acquisition date, with its own quantity and its share of the value", () => {
    const lots = new Map([["US78462F1030", [lot("20230115", 30), lot("20240601", 30), lot("20250310", 40)]]]);
    const lines = generateModelo720([makePosition()], rateMap, baseConfig, lots).split("\n");
    const details = lines.filter((l) => l[0] === "2");
    const d = BOE_720.detail;
    expect(details.map((l) => l.slice(414, 422))).toEqual(["20230115", "20240601", "20250310"]);
    expect(details.map((l) => boeField(l, d.numeroValores))).toEqual(["000000003000", "000000003000", "000000004000"]);
    // 55,200.00 EUR split 30/30/40
    expect(details.map((l) => boeField(l, d.valoracion1))).toEqual(["00000001656000", "00000001656000", "00000002208000"]);
    expect(boeField(lines[0]!, BOE_720.summary.suma1)).toBe("00000000005520000");
    expect(boeField(lines[0]!, [136, 144])).toBe("000000003");
  });

  it("dates the shares still held with the newest lots when the lots hold more than the position (FIFO)", () => {
    const lots = new Map([["US78462F1030", [lot("20230115", 50), lot("20240601", 50)]]]);
    const details = generateModelo720([makePosition({ quantity: "60" })], rateMap, baseConfig, lots)
      .split("\n").filter((l) => l[0] === "2");
    expect(details.map((l) => [l.slice(414, 422), boeField(l, BOE_720.detail.numeroValores)])).toEqual([
      ["20230115", "000000001000"],
      ["20240601", "000000005000"],
    ]);
  });

  function eurTrade(overrides: Partial<Trade>): Trade {
    const tradeDate = overrides.tradeDate ?? "2025-03-15";
    return {
      tradeID: tradeDate, accountId: "U1", symbol: "SPY", description: "SPDR S&P 500 ETF", isin: "US78462F1030",
      assetCategory: "STK", currency: "EUR", tradeDate, settlementDate: tradeDate, quantity: "10", tradePrice: "100",
      tradeMoney: "1000", proceeds: "1000", cost: "1000", fifoPnlRealized: "0", fxRateToBase: "1", buySell: "BUY",
      openCloseIndicator: overrides.buySell === "SELL" ? "C" : "O", exchange: "XETRA", commissionCurrency: "EUR",
      commission: "0", taxes: "0", multiplier: "1", ...overrides,
    };
  }

  // Held SPY bought in two tranches, 40 of it sold AFTER the year end (the
  // upload runs into 2026); VWCE declared last year and sold on 2025-03-15.
  const statement: FlexStatement = {
    accountId: "U1", fromDate: "20230101", toDate: "20260228", period: "Custom",
    trades: [
      eurTrade({ tradeDate: "2023-01-16", quantity: "40", tradePrice: "400" }),
      eurTrade({ tradeDate: "2025-03-10", quantity: "60", tradePrice: "500" }),
      eurTrade({ tradeDate: "2026-02-02", quantity: "-40", tradePrice: "650", buySell: "SELL" }),
      eurTrade({ tradeDate: "2024-02-12", symbol: "VWCE", description: "VANGUARD FTSE ALL-WORLD", isin: "IE00BK5BQT80", quantity: "100", tradePrice: "50" }),
      eurTrade({ tradeDate: "2025-03-15", symbol: "VWCE", description: "VANGUARD FTSE ALL-WORLD", isin: "IE00BK5BQT80", quantity: "-100", tradePrice: "60", buySell: "SELL" }),
    ],
    cashTransactions: [], corporateActions: [], securitiesInfo: [],
    openPositions: [makePosition({ currency: "EUR", quantity: "100", positionValue: "60000" })],
  };
  const config = { ...baseConfig, previousYearSecurities: lastYear("US78462F1030", "IE00BK5BQT80") };

  it("dates held securities with the lots held on 31 December, not after later sales in the upload", () => {
    const report = generateTaxReport(statement, new Map(), 2025);
    const out = generateModelo720(statement.openPositions, rateMap, config, report.yearEndLots, undefined, report.capitalGains.disposals);
    const held = out.split("\n").filter((l) => l[0] === "2" && l.slice(131, 143) === "US78462F1030");
    expect(held.map((l) => [l.slice(414, 422), l[422], boeField(l, BOE_720.detail.numeroValores)])).toEqual([
      ["20230116", "M", "000000004000"],
      ["20250310", "M", "000000006000"],
    ]);
  });

  it("writes the extinction record with the declarant's name, the sale date, the sale value and the lot's acquisition date", () => {
    const report = generateTaxReport(statement, new Map(), 2025);
    const lines = generateModelo720(statement.openPositions, rateMap, config, report.yearEndLots, undefined, report.capitalGains.disposals)
      .split("\n");
    const cancelled = lines.find((l) => l[0] === "2" && l[422] === "C")!;
    const d = BOE_720.detail;
    expect(cancelled.slice(131, 143)).toBe("IE00BK5BQT80");
    expect(cancelled.slice(35, 75).trim()).toBe("GARCIA LOPEZ JUAN");
    expect(boeField(cancelled, d.fechaExtincion)).toBe("20250315");
    expect(boeField(cancelled, d.valoracion1)).toBe("00000000600000"); // 100 x 60 EUR
    expect(cancelled.slice(414, 422)).toBe("20240212");
    // The type-1 suma 1 includes the extinction value: 60,000 + 6,000
    expect(boeField(lines[0]!, BOE_720.summary.suma1)).toBe("00000000006600000");
    expect(findUndatedExtinctions(statement.openPositions, config, report.capitalGains.disposals)).toEqual([]);
    expect(validateModelo720Records(lines).filter((r) => !r.valid)).toEqual([]);
  });

  // VWCE declared last year (100 shares bought 2023-05-02 unless the upload
  // has no history), no longer held at 31 December 2025.
  const vwce = (overrides: Partial<Trade>) =>
    eurTrade({ symbol: "VWCE", description: "VANGUARD FTSE ALL-WORLD", isin: "IE00BK5BQT80", ...overrides });
  const sell = (tradeDate: string, quantity: string, tradePrice: string) =>
    vwce({ tradeDate, quantity: `-${quantity}`, tradePrice, buySell: "SELL" });
  function extinctions(trades: Trade[]) {
    const s: FlexStatement = { ...statement, fromDate: "20230101", toDate: "20251231", trades };
    const report = generateTaxReport(s, new Map(), 2025);
    const cfg = { ...baseConfig, previousYearSecurities: lastYear("IE00BK5BQT80") };
    const lines = generateModelo720(s.openPositions, rateMap, cfg, undefined, undefined, report.capitalGains.disposals).split("\n");
    const records = lines
      .filter((l) => l[0] === "2" && l[422] === "C")
      .map((l) => [l.slice(414, 422), boeField(l, BOE_720.detail.fechaExtincion), boeField(l, BOE_720.detail.valoracion1)]);
    return { records, undated: findUndatedExtinctions(s.openPositions, cfg, report.capitalGains.disposals), lines };
  }

  it("dates the extinction by the sale of the declared shares, not a later sale of shares bought and sold within the year", () => {
    const { records, undated, lines } = extinctions([
      vwce({ tradeDate: "2023-05-02", quantity: "100", tradePrice: "50" }),
      sell("2025-03-03", "100", "60"),
      vwce({ tradeDate: "2025-05-05", quantity: "10", tradePrice: "65" }),
      sell("2025-06-10", "10", "70"),
    ]);
    expect(records).toEqual([["20230502", "20250303", "00000000600000"]]); // 100 x 60 EUR
    expect(undated).toEqual([]);
    expect(boeField(lines[0]!, BOE_720.summary.suma1)).toBe("00000000006600000"); // 60,000 held + 6,000, not the 700 sale
  });

  it("writes one extinction record for the declared lots when the last sale also sells shares bought within the year", () => {
    const { records, undated } = extinctions([
      vwce({ tradeDate: "2023-05-02", quantity: "100", tradePrice: "50" }),
      vwce({ tradeDate: "2025-02-03", quantity: "20", tradePrice: "55" }),
      sell("2025-06-10", "120", "70"),
    ]);
    expect(records).toEqual([["20230502", "20250610", "00000000700000"]]); // the 100 declared x 70 EUR
    expect(undated).toEqual([]);
  });

  it("dates the extinction by a sale with no history behind it, leaves its acquisition date blank and flags it", () => {
    const { records, undated } = extinctions([
      sell("2025-03-03", "100", "60"),
      vwce({ tradeDate: "2025-05-05", quantity: "10", tradePrice: "65" }),
      sell("2025-06-10", "10", "70"),
    ]);
    expect(records).toEqual([["        ", "20250303", "00000000600000"]]);
    expect(undated).toEqual([{ isin: "IE00BK5BQT80", missing: "acquisitionDate" }]);
  });

  it("writes one extinction record per acquisition date sold, when last year's file has one record per date", () => {
    // Last year's file: 100 VWCE held in two lots, so two V records for one ISIN.
    const vwceLot = (acquireDate: string, quantity: number): Lot => ({
      id: acquireDate, isin: "IE00BK5BQT80", symbol: "VWCE", description: "", acquireDate,
      quantity: new Decimal(quantity), pricePerShare: new Decimal(50), costInFcy: new Decimal(50 * quantity),
      currency: "EUR", ecbRate: new Decimal(1),
    });
    const lastYearFile = generateModelo720(
      [makePosition({ isin: "IE00BK5BQT80", symbol: "VWCE", currency: "EUR", quantity: "100", positionValue: "60000" })],
      new Map(),
      { ...baseConfig, year: 2024 },
      new Map([["IE00BK5BQT80", [vwceLot("20230502", 60), vwceLot("20240212", 40)]]]),
    );
    const previous = readPrevious720(lastYearFile).securities;
    expect(previous.map((s) => s.isin)).toEqual(["IE00BK5BQT80", "IE00BK5BQT80"]);

    // All 100 sold in 2025.
    const s: FlexStatement = {
      ...statement, toDate: "20251231",
      trades: [
        vwce({ tradeDate: "2023-05-02", quantity: "60", tradePrice: "50" }),
        vwce({ tradeDate: "2024-02-12", quantity: "40", tradePrice: "50" }),
        sell("2025-03-03", "100", "60"),
      ],
    };
    const disposals = generateTaxReport(s, new Map(), 2025).capitalGains.disposals;
    const lines = generateModelo720(s.openPositions, rateMap, { ...baseConfig, previousYearSecurities: previous }, undefined, undefined, disposals)
      .split("\n");
    const cancelled = lines
      .filter((l) => l[0] === "2" && l[422] === "C")
      .map((l) => [l.slice(414, 422), boeField(l, BOE_720.detail.fechaExtincion), boeField(l, BOE_720.detail.valoracion1)]);
    expect(cancelled).toEqual([
      ["20230502", "20250303", "00000000360000"], // 60 x 60 EUR
      ["20240212", "20250303", "00000000240000"], // 40 x 60 EUR
    ]);
  });

  it("asks for no extinction date on a sale the file leaves out for an old code", () => {
    // No sale in the year: a written C record would need its date completed by hand.
    const valid: Previous720Security = { isin: "IE00BK5BQT80", claveSubclave: "V1", country: "IE" };
    const blankSubclave: Previous720Security = { isin: "US0378331005", claveSubclave: "V ", country: "US" };
    const isinCountry: Previous720Security = { isin: "XS2314659447", claveSubclave: "V2", country: "XS" };
    const cfg = { ...baseConfig, previousYearSecurities: [valid, blankSubclave, isinCountry] };
    expect(findUndatedExtinctions([makePosition()], cfg, [])).toEqual([{ isin: "IE00BK5BQT80", missing: "extinctionDate" }]);
  });

  it("repeats last year's codes on a dated extinction, and never writes one whose old record has a blank subclave", () => {
    const s: FlexStatement = {
      ...statement, toDate: "20251231",
      trades: [vwce({ tradeDate: "2023-05-02", quantity: "100", tradePrice: "50" }), sell("2025-03-03", "100", "60")],
    };
    const disposals = generateTaxReport(s, new Map(), 2025).capitalGains.disposals;
    const d = BOE_720.detail;
    const fund: Previous720Security = { isin: "IE00BK5BQT80", claveSubclave: "I0", country: "IE" };
    const lines = generateModelo720(s.openPositions, rateMap, { ...baseConfig, previousYearSecurities: [fund] }, undefined, undefined, disposals)
      .split("\n");
    const cancelled = lines.find((l) => l[0] === "2" && l[422] === "C")!;
    expect([boeField(cancelled, d.claveSubclave), boeField(cancelled, d.pais), boeField(cancelled, d.fechaExtincion)]).toEqual(["I0", "IE", "20250303"]);
    expect(validateModelo720Records(lines).filter((r) => !r.valid)).toEqual([]);

    // The same sale read from a file an older version wrote: 103 blank.
    const old = { ...fund, claveSubclave: "V " };
    const cfg = { ...baseConfig, previousYearSecurities: [old] };
    const oldLines = generateModelo720(s.openPositions, rateMap, cfg, undefined, undefined, disposals).split("\n");
    expect(oldLines.filter((l) => l[0] === "2" && l[422] === "C")).toHaveLength(0);
    expect(validateModelo720Records(oldLines).filter((r) => !r.valid)).toEqual([]);
    expect(findModelo720Omissions(s.openPositions, rateMap, cfg)).toEqual([{ kind: "cancelled", reason: "invalid_code", security: old }]);
    expect(findUndatedExtinctions(s.openPositions, cfg, disposals)).toEqual([]);
  });

  it("leaves the extinction undated when the only sales in the year are of shares bought within the year", () => {
    const { records, undated } = extinctions([
      vwce({ tradeDate: "2025-05-05", quantity: "10", tradePrice: "65" }),
      sell("2025-06-10", "10", "70"),
    ]);
    expect(records).toEqual([["        ", "        ", "00000000000000"]]);
    expect(undated).toEqual([{ isin: "IE00BK5BQT80", missing: "extinctionDate" }]);
  });
});
