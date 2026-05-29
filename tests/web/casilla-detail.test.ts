/**
 * Tests for the casilla-detail rendering logic.
 *
 * DOM limitation: renderCasillaCards() requires an HTMLElement and vitest has no
 * jsdom environment configured (vitest.config.ts has no `environment: "jsdom"`).
 * We therefore test the underlying pure functions that casilla-detail.ts imports
 * and re-exports indirectly:
 *   - isListedShare()         — determines which block a disposal routes to
 *   - computeCasillaBlocksWithFx() — builds the CasillaBlocks that drive visible()
 *   - combinedNetGainLoss()   — the value shown on the net gain/loss card
 *
 * These are the exact values CASILLAS entries read in getValue/visible.
 * Any change to their behavior would break the rendered cards in the browser.
 */

import { describe, it, expect } from "vitest";
import {
  isListedShare,
  computeCasillaBlocksWithFx,
  combinedNetGainLoss,
} from "../../src/generators/casillas.js";
import Decimal from "decimal.js";
import type { TaxSummary, FifoDisposal } from "../../src/types/tax.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDisposal(overrides: Partial<FifoDisposal>): FifoDisposal {
  return {
    isin: "US0378331005",
    symbol: "AAPL",
    description: "APPLE INC",
    sellDate: "2025-09-20",
    acquireDate: "2025-03-15",
    quantity: new Decimal(10),
    proceedsEur: new Decimal(1092),
    costBasisEur: new Decimal(920),
    gainLossEur: new Decimal(172),
    holdingPeriodDays: 189,
    currency: "USD",
    sellEcbRate: new Decimal(0.91),
    acquireEcbRate: new Decimal(0.92),
    assetCategory: "STK",
    washSaleBlocked: false,
    ...overrides,
  };
}

function emptyFxGains(): TaxSummary["fxGains"] {
  return {
    transmissionValue: new Decimal(0),
    acquisitionValue: new Decimal(0),
    netGainLoss: new Decimal(0),
    disposals: [],
  };
}

function makeSummaryWithDisposals(
  disposals: FifoDisposal[],
  fxGains?: TaxSummary["fxGains"],
): TaxSummary {
  const transmissionValue = disposals.reduce((s, d) => s.plus(d.proceedsEur), new Decimal(0));
  const acquisitionValue = disposals.reduce((s, d) => s.plus(d.costBasisEur), new Decimal(0));
  return {
    year: 2025,
    warnings: [],
    messages: [],
    capitalGains: {
      transmissionValue,
      acquisitionValue,
      netGainLoss: transmissionValue.minus(acquisitionValue),
      blockedLosses: new Decimal(0),
      disposals,
    },
    dividends: {
      grossIncome: new Decimal(0),
      deductibleExpenses: new Decimal(0),
      entries: [],
    },
    interest: {
      earned: new Decimal(0),
      paid: new Decimal(0),
      entries: [],
    },
    doubleTaxation: {
      deduction: new Decimal(0),
      byCountry: {},
    },
    fxGains: fxGains ?? emptyFxGains(),
  };
}

// ---------------------------------------------------------------------------
// isListedShare — the partition logic that drives 0328/0331 vs 1633/1637
// ---------------------------------------------------------------------------

describe("isListedShare", () => {
  it("returns true for STK (listed shares → 0328/0331 block)", () => {
    expect(isListedShare({ assetCategory: "STK" })).toBe(true);
  });

  it("returns false for OPT (options → 1633/1637 block)", () => {
    expect(isListedShare({ assetCategory: "OPT" })).toBe(false);
  });

  it("returns false for FUND (funds → 1633/1637 block)", () => {
    expect(isListedShare({ assetCategory: "FUND" })).toBe(false);
  });

  it("returns false for CRYPTO (crypto → 1633/1637 block)", () => {
    expect(isListedShare({ assetCategory: "CRYPTO" })).toBe(false);
  });

  it("returns false for CASH (FX → 1633/1637 block via fxGains)", () => {
    expect(isListedShare({ assetCategory: "CASH" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// STK-only report → 0328/0331 cards visible, 1633/1637 cards hidden
// The visible() predicate in CASILLAS checks block.count > 0.
// ---------------------------------------------------------------------------

describe("computeCasillaBlocksWithFx — STK-only report", () => {
  it("populates listedShares block and leaves otherElements empty", () => {
    const report = makeSummaryWithDisposals([
      makeDisposal({ assetCategory: "STK" }),
    ]);
    const blocks = computeCasillaBlocksWithFx(report);

    // 0328/0331 cards: count > 0 → visible
    expect(blocks.listedShares.count).toBe(1);
    expect(blocks.listedShares.transmissionValue.toFixed(2)).toBe("1092.00");
    expect(blocks.listedShares.acquisitionValue.toFixed(2)).toBe("920.00");

    // 1633/1637 cards: count === 0 → hidden
    expect(blocks.otherElements.count).toBe(0);
    expect(blocks.otherElements.transmissionValue.toFixed(2)).toBe("0.00");
  });
});

// ---------------------------------------------------------------------------
// OPT/FX-only report → 1633/1637 cards visible, 0328/0331 cards hidden
// ---------------------------------------------------------------------------

describe("computeCasillaBlocksWithFx — OPT-only report (otros elementos)", () => {
  it("populates otherElements block and leaves listedShares empty", () => {
    const report = makeSummaryWithDisposals([
      makeDisposal({ assetCategory: "OPT", proceedsEur: new Decimal(500), costBasisEur: new Decimal(300), gainLossEur: new Decimal(200) }),
    ]);
    const blocks = computeCasillaBlocksWithFx(report);

    // 0328/0331 cards: count === 0 → hidden
    expect(blocks.listedShares.count).toBe(0);

    // 1633/1637 cards: count > 0 → visible
    expect(blocks.otherElements.count).toBe(1);
    expect(blocks.otherElements.transmissionValue.toFixed(2)).toBe("500.00");
  });
});

describe("computeCasillaBlocksWithFx — FX-only report (no FIFO disposals)", () => {
  it("populates otherElements via fxGains merge when only FX disposals exist", () => {
    // No FIFO stock disposals — only an FX gain from a currency conversion
    const fxGains: TaxSummary["fxGains"] = {
      transmissionValue: new Decimal(800),
      acquisitionValue: new Decimal(750),
      netGainLoss: new Decimal(50),
      disposals: [
        {
          currency: "USD",
          disposeDate: "2025-06-15",
          acquireDate: "2025-01-10",
          quantity: new Decimal(5000),
          proceedsEur: new Decimal(800),
          costBasisEur: new Decimal(750),
          gainLossEur: new Decimal(50),
          trigger: "conversion",
          holdingPeriodDays: 156,
          lotId: "lot-001",
        },
      ],
    };
    const report = makeSummaryWithDisposals([], fxGains);
    const blocks = computeCasillaBlocksWithFx(report);

    // 0328/0331: no STK disposals → hidden
    expect(blocks.listedShares.count).toBe(0);

    // 1633/1637: FX disposal merged in → visible
    expect(blocks.otherElements.count).toBe(1);
    expect(blocks.otherElements.transmissionValue.toFixed(2)).toBe("800.00");
    expect(blocks.otherElements.acquisitionValue.toFixed(2)).toBe("750.00");
  });
});

// ---------------------------------------------------------------------------
// Mixed report → both 0328/0331 AND 1633/1637 visible
// ---------------------------------------------------------------------------

describe("computeCasillaBlocksWithFx — mixed STK + OPT report", () => {
  it("populates both blocks when report has both STK and OPT disposals", () => {
    const report = makeSummaryWithDisposals([
      makeDisposal({ assetCategory: "STK" }),
      makeDisposal({ assetCategory: "OPT", proceedsEur: new Decimal(500), costBasisEur: new Decimal(300), gainLossEur: new Decimal(200) }),
    ]);
    const blocks = computeCasillaBlocksWithFx(report);

    expect(blocks.listedShares.count).toBe(1);
    expect(blocks.otherElements.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Net gain/loss card uses combined figure (listedShares + otherElements + FX)
// ---------------------------------------------------------------------------

describe("combinedNetGainLoss — net gain/loss card value", () => {
  it("sums listed shares and other elements net gains", () => {
    const report = makeSummaryWithDisposals([
      makeDisposal({ assetCategory: "STK" }),                                                  // +172
      makeDisposal({ assetCategory: "OPT", proceedsEur: new Decimal(500), costBasisEur: new Decimal(300), gainLossEur: new Decimal(200) }), // +200
    ]);
    const blocks = computeCasillaBlocksWithFx(report);
    const net = combinedNetGainLoss(blocks);

    expect(net.toFixed(2)).toBe("372.00");
  });

  it("includes FX net gain in combined total", () => {
    const fxGains: TaxSummary["fxGains"] = {
      transmissionValue: new Decimal(800),
      acquisitionValue: new Decimal(750),
      netGainLoss: new Decimal(50),
      disposals: [
        {
          currency: "USD",
          disposeDate: "2025-06-15",
          acquireDate: "2025-01-10",
          quantity: new Decimal(5000),
          proceedsEur: new Decimal(800),
          costBasisEur: new Decimal(750),
          gainLossEur: new Decimal(50),
          trigger: "conversion",
          holdingPeriodDays: 156,
          lotId: "lot-002",
        },
      ],
    };
    // STK disposal: +172; FX: +50 → combined = 222
    const report = makeSummaryWithDisposals([makeDisposal({ assetCategory: "STK" })], fxGains);
    const blocks = computeCasillaBlocksWithFx(report);
    const net = combinedNetGainLoss(blocks);

    expect(net.toFixed(2)).toBe("222.00");
  });

  it("returns negative combined total when losses exceed gains", () => {
    const report = makeSummaryWithDisposals([
      makeDisposal({
        assetCategory: "STK",
        proceedsEur: new Decimal(800),
        costBasisEur: new Decimal(1000),
        gainLossEur: new Decimal(-200),
      }),
    ]);
    const blocks = computeCasillaBlocksWithFx(report);
    const net = combinedNetGainLoss(blocks);

    expect(net.toFixed(2)).toBe("-200.00");
    // The net gain/loss card CSS class logic: loss → "loss" class
    expect(net.greaterThanOrEqualTo(0)).toBe(false);
  });
});
