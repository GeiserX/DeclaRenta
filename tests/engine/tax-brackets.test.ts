import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { calculateSavingsTax, getSavingsBands } from "../../src/engine/tax-brackets.js";

describe("getSavingsBands — top-band rate by year", () => {
  it("uses a 30% top band for 2025 (Ley 7/2024)", () => {
    const bands = getSavingsBands(2025);
    const top = bands[bands.length - 1]!;
    expect(top.from).toBe(300000);
    expect(top.to).toBe(Infinity);
    expect(top.rate.toNumber()).toBe(0.30);
  });

  it("uses a 28% top band for 2024 (transitional RDL 13/2022 scale)", () => {
    const bands = getSavingsBands(2024);
    const top = bands[bands.length - 1]!;
    expect(top.from).toBe(300000);
    expect(top.to).toBe(Infinity);
    expect(top.rate.toNumber()).toBe(0.28);
  });

  it("uses the 26% top band for years before 2023", () => {
    const bands = getSavingsBands(2022);
    const top = bands[bands.length - 1]!;
    expect(top.from).toBe(200000);
    expect(top.rate.toNumber()).toBe(0.26);
  });
});

describe("calculateSavingsTax — 2024 vs 2025 divergence above 300k", () => {
  it("yields a higher total in 2025 than 2024 for a >300k income", () => {
    const income = new Decimal(400000);
    const tax2024 = calculateSavingsTax(income, 2024);
    const tax2025 = calculateSavingsTax(income, 2025);

    // 2024 top band 28%, 2025 top band 30% → the 100k above 300k is taxed
    // 2 points higher in 2025 (100000 × 0.02 = 2000 more).
    expect(tax2024.toFixed(2)).toBe("99880.00");
    expect(tax2025.toFixed(2)).toBe("101880.00");
    expect(tax2025.minus(tax2024).toFixed(2)).toBe("2000.00");
    expect(tax2025.greaterThan(tax2024)).toBe(true);
  });

  it("matches 2024 below 300k where the two scales are identical", () => {
    // At exactly 300k both scales agree (only the >300k band differs).
    const income = new Decimal(300000);
    expect(calculateSavingsTax(income, 2024).toFixed(2)).toBe("71880.00");
    expect(calculateSavingsTax(income, 2025).toFixed(2)).toBe("71880.00");
  });
});

describe("calculateSavingsTax — cumulative tax at band boundaries (2025)", () => {
  // Each boundary marks the exact point where a band fills. The cumulative tax
  // there fixes both the band WIDTHS and the marginal RATES; a wrong width or
  // rate would shift these numbers.
  const cases: Array<[number, string]> = [
    [6000, "1140.00"], // 6000 × 19%
    [50000, "10380.00"], // + 44000 × 21% = 9240
    [200000, "44880.00"], // + 150000 × 23% = 34500
    [300000, "71880.00"], // + 100000 × 27% = 27000
  ];

  for (const [income, expected] of cases) {
    it(`taxes ${income} EUR at ${expected} EUR`, () => {
      expect(calculateSavingsTax(new Decimal(income), 2025).toFixed(2)).toBe(expected);
    });
  }

  it("returns 0 for non-positive income", () => {
    expect(calculateSavingsTax(new Decimal(0), 2025).toFixed(2)).toBe("0.00");
    expect(calculateSavingsTax(new Decimal(-100), 2025).toFixed(2)).toBe("0.00");
  });
});
