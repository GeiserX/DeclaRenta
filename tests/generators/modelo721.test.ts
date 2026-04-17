import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateModelo721 } from "../../src/generators/modelo721.js";
import type { Modelo721Entry } from "../../src/generators/modelo721.js";

function makeEntry(overrides: Partial<Modelo721Entry> = {}): Modelo721Entry {
  return {
    assetId: "BTC",
    description: "Bitcoin",
    exchangeName: "Coinbase",
    countryCode: "US",
    quantity: new Decimal("1.5"),
    valuationEur: new Decimal("60000"),
    acquisitionCostEur: new Decimal("30000"),
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

describe("Modelo 721 Generator", () => {
  it("should return empty string when total value is below 50K EUR", () => {
    const entries = [makeEntry({ valuationEur: new Decimal("10000") })];
    expect(generateModelo721(entries, baseConfig)).toBe("");
  });

  it("should generate records when total value exceeds 50K EUR", () => {
    const entries = [makeEntry()]; // 60000 EUR
    const result = generateModelo721(entries, baseConfig);
    expect(result).not.toBe("");
    const lines = result.split("\n");
    expect(lines).toHaveLength(2); // 1 summary + 1 detail
    expect(lines[0]![0]).toBe("1"); // summary
    expect(lines[1]![0]).toBe("2"); // detail
  });

  it("should use model number 721", () => {
    const entries = [makeEntry()];
    const result = generateModelo721(entries, baseConfig);
    const lines = result.split("\n");
    expect(lines[0]!.slice(1, 4)).toBe("721");
    expect(lines[1]!.slice(1, 4)).toBe("721");
  });

  it("should include year in records", () => {
    const entries = [makeEntry()];
    const result = generateModelo721(entries, baseConfig);
    const summary = result.split("\n")[0]!;
    expect(summary.slice(4, 8)).toBe("2025");
  });

  it("should include NIF in records", () => {
    const entries = [makeEntry()];
    const result = generateModelo721(entries, baseConfig);
    const summary = result.split("\n")[0]!;
    expect(summary.slice(8, 17).trim()).toBe("12345678A");
  });

  it("should mark asset type as C for crypto", () => {
    const entries = [makeEntry()];
    const result = generateModelo721(entries, baseConfig);
    const detail = result.split("\n")[1]!;
    // Asset type at position 102 (0-indexed: 101)
    expect(detail[101]).toBe("C");
  });

  it("should include country code", () => {
    const entries = [makeEntry({ countryCode: "US" })];
    const result = generateModelo721(entries, baseConfig);
    const detail = result.split("\n")[1]!;
    expect(detail.slice(128, 130)).toBe("US");
  });

  it("should include asset ID", () => {
    const entries = [makeEntry({ assetId: "BTC" })];
    const result = generateModelo721(entries, baseConfig);
    const detail = result.split("\n")[1]!;
    expect(detail.slice(131, 143).trim()).toBe("BTC");
  });

  it("should include exchange name", () => {
    const entries = [makeEntry({ exchangeName: "Coinbase" })];
    const result = generateModelo721(entries, baseConfig);
    const detail = result.split("\n")[1]!;
    expect(detail.slice(189, 230).trim()).toBe("Coinbase");
  });

  it("should handle multiple entries", () => {
    const entries = [
      makeEntry({ assetId: "BTC", valuationEur: new Decimal("40000") }),
      makeEntry({ assetId: "ETH", valuationEur: new Decimal("20000"), description: "Ethereum" }),
    ];
    const result = generateModelo721(entries, baseConfig);
    const lines = result.split("\n");
    expect(lines).toHaveLength(3); // 1 summary + 2 detail
  });

  it("should set complementary flag", () => {
    const entries = [makeEntry()];
    const config = { ...baseConfig, isComplementary: true };
    const result = generateModelo721(entries, config);
    const summary = result.split("\n")[0]!;
    expect(summary[120]).toBe("C"); // position 121
  });

  it("should set replacement flag", () => {
    const entries = [makeEntry()];
    const config = { ...baseConfig, isReplacement: true };
    const result = generateModelo721(entries, config);
    const summary = result.split("\n")[0]!;
    expect(summary[121]).toBe("S"); // position 122
  });

  it("should include detail count in summary", () => {
    const entries = [makeEntry(), makeEntry({ assetId: "ETH" })];
    const result = generateModelo721(entries, baseConfig);
    const summary = result.split("\n")[0]!;
    const count = summary.slice(135, 144);
    expect(parseInt(count)).toBe(2);
  });

  describe("Negative value sign fields", () => {
    it("should set acquisition sign to N for negative acquisition cost", () => {
      const entries = [makeEntry({
        acquisitionCostEur: new Decimal("-30000"),
        valuationEur: new Decimal("60000"),
      })];
      const result = generateModelo721(entries, baseConfig);
      const detail = result.split("\n")[1]!;
      // Acquisition sign at position 432 (0-indexed: 431)
      expect(detail[431]).toBe("N");
    });

    it("should set valuation sign to N for negative valuation", () => {
      const entries = [
        makeEntry({
          assetId: "ETH",
          valuationEur: new Decimal("-60000"),
          acquisitionCostEur: new Decimal("30000"),
        }),
        makeEntry({
          assetId: "BTC",
          valuationEur: new Decimal("120000"),
          acquisitionCostEur: new Decimal("50000"),
        }),
      ];
      // Total valuation: -60000 + 120000 = 60000 > 50K threshold
      const result = generateModelo721(entries, baseConfig);
      expect(result).not.toBe("");
      // First detail record (ETH) has the negative valuation
      const detail = result.split("\n")[1]!;
      // Valuation sign at position 448 (0-indexed: 447)
      expect(detail[447]).toBe("N");
    });
  });
});
