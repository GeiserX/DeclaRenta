import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateD6Report } from "../../src/generators/d6.js";
import type { OpenPosition } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

const rateMap: EcbRateMap = new Map([
  ["2025-12-31", new Map([["USD", new Decimal("0.92")], ["GBP", new Decimal("1.15")]])],
]);

function makePosition(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    accountId: "",
    symbol: "SPY",
    description: "SPDR S&P 500 ETF",
    isin: "US78462F1030",
    currency: "USD",
    assetCategory: "STK",
    quantity: "50",
    costBasisMoney: "20000",
    costBasisPrice: "400",
    markPrice: "500",
    positionValue: "25000",
    fifoPnlUnrealized: "5000",
    fxRateToBase: "0.92",
    ...overrides,
  };
}

describe("D-6 Guide Generator", () => {
  it("should generate a D-6 report with positions", () => {
    const positions = [
      makePosition(),
      makePosition({
        isin: "IE00BK5BQT80",
        symbol: "VWCE",
        description: "Vanguard FTSE All-World",
        currency: "EUR",
        positionValue: "15000",
      }),
    ];

    const report = generateD6Report(positions, rateMap, 2025, "García López, Juan", "12345678A");

    expect(report.year).toBe(2025);
    expect(report.totalPositions).toBe(2);
    expect(report.positions).toHaveLength(2);
  });

  it("should exclude Spanish ISINs", () => {
    const positions = [
      makePosition(),
      makePosition({ isin: "ES0124244E34", symbol: "MAPFRE", currency: "EUR", positionValue: "5000" }),
    ];

    const report = generateD6Report(positions, rateMap, 2025, "Test", "12345678A");

    expect(report.positions).toHaveLength(1);
    expect(report.positions[0]!.isin).toBe("US78462F1030");
  });

  it("should extract country code from ISIN", () => {
    const positions = [
      makePosition({ isin: "US78462F1030" }),
      makePosition({ isin: "IE00BK5BQT80", currency: "EUR", positionValue: "10000" }),
      makePosition({ isin: "GB00B03MLX29", currency: "GBP", positionValue: "8000" }),
    ];

    const report = generateD6Report(positions, rateMap, 2025, "Test", "12345678A");

    expect(report.positions[0]!.countryCode).toBe("US");
    expect(report.positions[1]!.countryCode).toBe("IE");
    expect(report.positions[2]!.countryCode).toBe("GB");
  });

  it("should calculate EUR values using ECB rates", () => {
    const positions = [makePosition({ positionValue: "10000", currency: "USD" })];

    const report = generateD6Report(positions, rateMap, 2025, "Test", "12345678A");

    // 10000 * 0.92 = 9200 EUR
    expect(report.positions[0]!.marketValueEur).toBe("9200.00");
  });

  it("should generate AFORIX guide text", () => {
    const positions = [makePosition()];
    const report = generateD6Report(positions, rateMap, 2025, "Test User", "12345678A");

    expect(report.guide.length).toBeGreaterThan(10);
    expect(report.guide.some((l) => l.includes("AFORIX"))).toBe(true);
    expect(report.guide.some((l) => l.includes("12345678A"))).toBe(true);
    expect(report.guide.some((l) => l.includes("Test User"))).toBe(true);
  });

  it("should map ISIN prefix to exchange code", () => {
    const positions = [
      makePosition({ isin: "US78462F1030" }),
      makePosition({ isin: "DE000A0F5UF5", currency: "EUR", positionValue: "5000" }),
    ];

    const report = generateD6Report(positions, rateMap, 2025, "Test", "12345678A");

    expect(report.positions[0]!.exchangeCode).toBe("XNYS");
    expect(report.positions[1]!.exchangeCode).toBe("XETR");
  });

  it("should state no minimum threshold in guide", () => {
    const positions = [makePosition({ positionValue: "100", currency: "USD" })];
    const report = generateD6Report(positions, rateMap, 2025, "Test", "12345678A");

    expect(report.guide.some((l) => l.includes("CUALQUIER importe"))).toBe(true);
  });
});
