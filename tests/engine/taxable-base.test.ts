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
}): TaxableBaseReport {
  return {
    capitalGains: {
      netGainLoss: new Decimal(v.capitalGains),
      blockedLosses: new Decimal(v.blockedLosses),
    },
    fxGains: { netGainLoss: new Decimal(v.fxGains) },
    dividends: { grossIncome: new Decimal(v.dividends) },
    interest: { earned: new Decimal(v.interest) },
  };
}

/**
 * The OLD inline web math (main.ts, pre-refactor) — the oracle the helper must
 * reproduce byte-for-byte: per-component `.toNumber()` then `Math.max(0, sum)`.
 */
function oldInlineMath(v: {
  capitalGains: number;
  fxGains: number;
  dividends: number;
  interest: number;
  blockedLosses: number;
}): { breakdown: typeof v; taxableBase: number } {
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
      breakdown.blockedLosses +
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
