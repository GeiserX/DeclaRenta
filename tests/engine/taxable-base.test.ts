import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  computeTaxableBaseBreakdown,
  type TaxableBaseReport,
} from "../../src/engine/taxable-base.js";

// Build a structural report slice from plain numbers (no real amounts/NIF).
function makeReport(v: {
  capitalGains: number;
  fxGains: number;
  dividends: number;
  interest: number;
  blockedLosses: number;
  reintegratedLosses?: number;
}): TaxableBaseReport {
  return {
    capitalGains: {
      netGainLoss: new Decimal(v.capitalGains),
      blockedLosses: new Decimal(v.blockedLosses),
      reintegratedLosses: new Decimal(v.reintegratedLosses ?? 0),
    },
    fxGains: { netGainLoss: new Decimal(v.fxGains) },
    dividends: { grossIncome: new Decimal(v.dividends) },
    interest: { earned: new Decimal(v.interest) },
  };
}

/**
 * Reference oracle for the chart math: per-component `.toNumber()` then
 * `Math.max(0, sum)`, applying the anti-churning adjustment (blocked loss added
 * back, reintegrated prior loss subtracted). The `breakdown` mirrors the helper's
 * output shape (which does NOT carry reintegratedLosses as a breakdown field).
 */
function oldInlineMath(v: {
  capitalGains: number;
  fxGains: number;
  dividends: number;
  interest: number;
  blockedLosses: number;
  reintegratedLosses?: number;
}): {
  breakdown: { capitalGains: number; fxGains: number; dividends: number; interest: number; blockedLosses: number };
  taxableBase: number;
} {
  const breakdown = {
    capitalGains: v.capitalGains,
    fxGains: v.fxGains,
    dividends: v.dividends,
    interest: v.interest,
    blockedLosses: v.blockedLosses,
  };
  const taxableBase = Math.max(
    0,
    breakdown.capitalGains +
      breakdown.blockedLosses -
      (v.reintegratedLosses ?? 0) +
      breakdown.fxGains +
      breakdown.dividends +
      breakdown.interest,
  );
  return { breakdown, taxableBase };
}

describe("computeTaxableBaseBreakdown", () => {
  const cases: Array<{
    name: string;
    input: Parameters<typeof makeReport>[0];
  }> = [
    {
      name: "all positive",
      input: { capitalGains: 1200.5, fxGains: 300.25, dividends: 450.1, interest: 75.4, blockedLosses: 0 },
    },
    {
      name: "all negative → clamped to 0",
      input: { capitalGains: -500, fxGains: -200, dividends: 0, interest: 0, blockedLosses: 0 },
    },
    {
      name: "mixed (net positive, with blocked losses added back)",
      input: { capitalGains: -100.75, fxGains: 50.5, dividends: 800, interest: 12.3, blockedLosses: 60.25 },
    },
    {
      name: "mixed (net negative → clamped, despite a positive bucket)",
      input: { capitalGains: -9000, fxGains: 100, dividends: 200, interest: 50, blockedLosses: 0 },
    },
    {
      name: "exactly zero sum → 0",
      input: { capitalGains: -300, fxGains: 100, dividends: 150, interest: 50, blockedLosses: 0 },
    },
    {
      name: "reintegrated prior deferred loss is subtracted (now deductible)",
      input: { capitalGains: 1000, fxGains: 0, dividends: 0, interest: 0, blockedLosses: 0, reintegratedLosses: 250 },
    },
    {
      name: "blocked added back AND reintegrated subtracted in one year",
      input: { capitalGains: -100, fxGains: 0, dividends: 500, interest: 0, blockedLosses: 80, reintegratedLosses: 30 },
    },
  ];

  for (const c of cases) {
    it(`matches the old inline JS-Number math: ${c.name}`, () => {
      const result = computeTaxableBaseBreakdown(makeReport(c.input));
      const oracle = oldInlineMath(c.input);

      expect(result.breakdown).toEqual(oracle.breakdown);
      expect(result.taxableBase).toBe(oracle.taxableBase);
    });
  }

  it("clamps a negative total to exactly 0 (not -0)", () => {
    const result = computeTaxableBaseBreakdown(
      makeReport({ capitalGains: -1, fxGains: 0, dividends: 0, interest: 0, blockedLosses: 0 }),
    );
    expect(result.taxableBase).toBe(0);
    expect(Object.is(result.taxableBase, -0)).toBe(false);
  });

  it("preserves each component in the breakdown unchanged (no clamping of components)", () => {
    const result = computeTaxableBaseBreakdown(
      makeReport({ capitalGains: -100, fxGains: -50, dividends: 0, interest: 0, blockedLosses: 0 }),
    );
    // Components are NOT clamped — only the total is.
    expect(result.breakdown.capitalGains).toBe(-100);
    expect(result.breakdown.fxGains).toBe(-50);
    expect(result.taxableBase).toBe(0);
  });
});
