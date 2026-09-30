import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  computeTaxableBaseBreakdown,
  savingsBalances,
  type TaxableBaseReport,
} from "../../src/engine/taxable-base.js";
import { applyLossCarryforward } from "../../src/engine/loss-carryforward.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { renderTaxBracketCard } from "../../src/web/charts.js";
import type { FlexStatement, Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

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
 * Reference oracle for the estimate base, in plain JS numbers: two Art. 49 LIRPF
 * buckets. Gains = capital gains + blocked − reintegrated + FX; income =
 * dividends + interest. A negative bucket offsets at most 25% of the other
 * bucket's positive balance, then each bucket is clamped at 0 and summed.
 */
function art49Math(v: {
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
  let gains = v.capitalGains + v.blockedLosses - (v.reintegratedLosses ?? 0) + v.fxGains;
  let income = v.dividends + v.interest;
  if (gains < 0 && income > 0) {
    const cross = Math.min(-gains, income * 0.25);
    gains += cross;
    income -= cross;
  } else if (income < 0 && gains > 0) {
    const cross = Math.min(-income, gains * 0.25);
    income += cross;
    gains -= cross;
  }
  return { breakdown, taxableBase: Math.max(0, gains) + Math.max(0, income) };
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
      name: "gains loss offsets only 25% of the income bucket",
      input: { capitalGains: -9000, fxGains: 100, dividends: 200, interest: 50, blockedLosses: 0 },
    },
    {
      name: "gains loss equal to income still offsets only 25%",
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
    it(`matches the Art. 49 reference math: ${c.name}`, () => {
      const result = computeTaxableBaseBreakdown(makeReport(c.input));
      const oracle = art49Math(c.input);

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

  it("keeps 75% of the dividends in the base when a large stock loss would otherwise wipe them out", () => {
    // Art. 49.1.b LIRPF: -10000 of losses offset at most 25% of 5000 dividends.
    const result = computeTaxableBaseBreakdown(
      makeReport({ capitalGains: -10000, fxGains: 0, dividends: 5000, interest: 0, blockedLosses: 0 }),
    );
    expect(result.taxableBase).toBe(3750);
    // The estimate card renders instead of disappearing behind a zero base.
    expect(renderTaxBracketCard("Estimación", 2025, result.taxableBase, 0, result.breakdown)).not.toBe("");
  });

  it("offsets a small stock loss only up to 25% of the dividends", () => {
    const result = computeTaxableBaseBreakdown(
      makeReport({ capitalGains: -2000, fxGains: 0, dividends: 5000, interest: 0, blockedLosses: 0 }),
    );
    expect(result.taxableBase).toBe(3750);
  });

  it("offsets an FX loss against stock gains in full (same Art. 49.1.b bucket)", () => {
    const result = computeTaxableBaseBreakdown(
      makeReport({ capitalGains: 1000, fxGains: -400, dividends: 0, interest: 0, blockedLosses: 0 }),
    );
    expect(result.taxableBase).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// The CLI --prior-losses feed: the balances handed to applyLossCarryforward must
// be the fiscal ones (blocked losses added back, reintegrated ones subtracted,
// FX included), built through the real pipeline.
// ---------------------------------------------------------------------------

function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

function makeTrade(overrides: Partial<Trade>): Trade {
  const tradeDate = overrides.tradeDate ?? "2024-01-10";
  return {
    tradeID: "1",
    accountId: "U1",
    symbol: "XXX",
    description: "STOCK X",
    isin: "US0000000001",
    assetCategory: "STK",
    currency: "USD",
    tradeDate,
    settlementDate: overrides.settlementDate ?? tradeDate,
    quantity: "10",
    tradePrice: "100",
    tradeMoney: "1000",
    proceeds: "1000",
    cost: "1000",
    fifoPnlRealized: "0",
    fxRateToBase: "1",
    buySell: "BUY",
    openCloseIndicator: overrides.buySell === "SELL" ? "C" : "O",
    exchange: "NASDAQ",
    commissionCurrency: "USD",
    commission: "0",
    taxes: "0",
    multiplier: "1",
    ...overrides,
  };
}

function makeStatement(trades: Trade[]): FlexStatement {
  return {
    accountId: "U1",
    fromDate: "20240101",
    toDate: "20241231",
    period: "Annual",
    trades,
    cashTransactions: [],
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
  };
}

describe("savingsBalances (CLI --prior-losses feed)", () => {
  const rates = makeRateMap({
    "2024-01-10": { USD: "1.00" },
    "2024-03-01": { USD: "1.00" },
    "2024-03-18": { USD: "1.00" },
  });
  // Stock X: -500 loss, fully blocked by the 2024-03-18 repurchase (Art. 33.5.f).
  const blockedLossX: Trade[] = [
    makeTrade({ tradeID: "x-buy", tradeDate: "2024-01-10", buySell: "BUY", tradePrice: "100" }),
    makeTrade({ tradeID: "x-sell", tradeDate: "2024-03-01", buySell: "SELL", tradePrice: "50" }),
    makeTrade({ tradeID: "x-rebuy", tradeDate: "2024-03-18", buySell: "BUY", tradePrice: "50" }),
  ];
  // Stock Y: +500 gain.
  const gainY: Trade[] = [
    makeTrade({ tradeID: "y-buy", isin: "US0000000002", symbol: "YYY", description: "STOCK Y", tradeDate: "2024-01-10", buySell: "BUY", tradePrice: "100" }),
    makeTrade({ tradeID: "y-sell", isin: "US0000000002", symbol: "YYY", description: "STOCK Y", tradeDate: "2024-03-01", buySell: "SELL", tradePrice: "150" }),
  ];

  it("compensates a prior-year loss against the gain a blocked loss must not cancel", () => {
    const report = generateTaxReport(makeStatement([...blockedLossX, ...gainY]), rates, 2024, { skipFx: true });
    expect(report.capitalGains.blockedLosses.toFixed(2)).toBe("500.00");

    const { gains, income } = savingsBalances(report);
    expect(gains.toFixed(2)).toBe("500.00");

    const result = applyLossCarryforward(2024, gains, income, [
      { year: 2023, amount: new Decimal("-400"), remaining: new Decimal("-400"), category: "gains" },
    ]);
    expect(result.totalCompensated.toFixed(2)).toBe("400.00");
  });

  it("does not record a fully blocked (deferred) loss as a new carryforward", () => {
    const report = generateTaxReport(makeStatement(blockedLossX), rates, 2024, { skipFx: true });
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("-500.00");

    const { gains, income } = savingsBalances(report);
    expect(gains.toFixed(2)).toBe("0.00");

    const result = applyLossCarryforward(2024, gains, income, []);
    expect(result.updatedCarryforward).toHaveLength(0);
  });

  it("includes FX gains and losses in the gains bucket", () => {
    const { gains, income } = savingsBalances(
      makeReport({ capitalGains: 1000, fxGains: -300, dividends: 200, interest: 50, blockedLosses: 0 }),
    );
    expect(gains.toFixed(2)).toBe("700.00");
    expect(income.toFixed(2)).toBe("250.00");
  });
});
