import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeCasillaBlocks, computeCasillaBlocksWithFx, isListedShare } from "../../src/generators/casillas.js";
import type { FifoDisposal, FxDisposal, TaxSummary } from "../../src/types/tax.js";

function makeDisposal(overrides: Partial<FifoDisposal> = {}): FifoDisposal {
  return {
    isin: "US0378331005",
    symbol: "AAPL",
    description: "APPLE INC",
    sellDate: "20250920",
    acquireDate: "20250315",
    quantity: new Decimal(10),
    proceedsEur: new Decimal(1000),
    costBasisEur: new Decimal(800),
    gainLossEur: new Decimal(200),
    holdingPeriodDays: 189,
    currency: "USD",
    sellEcbRate: new Decimal("0.91"),
    acquireEcbRate: new Decimal("0.92"),
    assetCategory: "STK",
    washSaleBlocked: false,
    ...overrides,
  };
}

function makeFxDisposal(overrides: Partial<FxDisposal> = {}): FxDisposal {
  return {
    currency: "USD",
    disposeDate: "20250615",
    acquireDate: "20250110",
    quantity: new Decimal(5000),
    proceedsEur: new Decimal(5000),
    costBasisEur: new Decimal(4800),
    gainLossEur: new Decimal(200),
    trigger: "conversion",
    holdingPeriodDays: 156,
    lotId: "fx-1",
    ...overrides,
  };
}

function makeReport(overrides: Partial<TaxSummary> = {}): TaxSummary {
  return {
    year: 2025,
    warnings: [],
    messages: [],
    capitalGains: {
      transmissionValue: new Decimal(0),
      acquisitionValue: new Decimal(0),
      netGainLoss: new Decimal(0),
      blockedLosses: new Decimal(0),
      disposals: [],
    },
    dividends: { grossIncome: new Decimal(0), deductibleExpenses: new Decimal(0), entries: [] },
    interest: { earned: new Decimal(0), paid: new Decimal(0), entries: [] },
    generalGains: { total: new Decimal(0), entries: [] },
    doubleTaxation: { deduction: new Decimal(0), byCountry: {} },
    fxGains: {
      transmissionValue: new Decimal(0),
      acquisitionValue: new Decimal(0),
      netGainLoss: new Decimal(0),
      disposals: [],
    },
    ...overrides,
  };
}

describe("isListedShare", () => {
  it("treats STK as a listed share", () => {
    expect(isListedShare({ assetCategory: "STK" })).toBe(true);
  });

  it("treats options, crypto, and funds as non-listed", () => {
    expect(isListedShare({ assetCategory: "OPT" })).toBe(false);
    expect(isListedShare({ assetCategory: "FOP" })).toBe(false);
    expect(isListedShare({ assetCategory: "FSFOP" })).toBe(false);
    expect(isListedShare({ assetCategory: "CRYPTO" })).toBe(false);
    expect(isListedShare({ assetCategory: "FUND" })).toBe(false);
    expect(isListedShare({ assetCategory: "BOND" })).toBe(false);
  });
});

describe("computeCasillaBlocks", () => {
  it("routes STK disposals to the listed-shares block (0328/0331)", () => {
    const blocks = computeCasillaBlocks([makeDisposal({ assetCategory: "STK" })]);
    expect(blocks.listedShares.count).toBe(1);
    expect(blocks.listedShares.transmissionValue.toFixed(2)).toBe("1000.00");
    expect(blocks.listedShares.acquisitionValue.toFixed(2)).toBe("800.00");
    expect(blocks.listedShares.gains.toFixed(2)).toBe("200.00");
    expect(blocks.listedShares.losses.toFixed(2)).toBe("0.00");
    expect(blocks.otherElements.count).toBe(0);
  });

  it("routes OPT/CRYPTO/FUND disposals to the otros-elementos block (1633/1637)", () => {
    const blocks = computeCasillaBlocks([
      makeDisposal({ assetCategory: "OPT", proceedsEur: new Decimal(300), costBasisEur: new Decimal(100), gainLossEur: new Decimal(200) }),
      makeDisposal({ assetCategory: "CRYPTO", proceedsEur: new Decimal(500), costBasisEur: new Decimal(600), gainLossEur: new Decimal(-100) }),
    ]);
    expect(blocks.otherElements.count).toBe(2);
    expect(blocks.otherElements.transmissionValue.toFixed(2)).toBe("800.00");
    expect(blocks.otherElements.acquisitionValue.toFixed(2)).toBe("700.00");
    expect(blocks.otherElements.gains.toFixed(2)).toBe("200.00");
    expect(blocks.otherElements.losses.toFixed(2)).toBe("100.00");
    expect(blocks.otherElements.netGainLoss.toFixed(2)).toBe("100.00");
    expect(blocks.listedShares.count).toBe(0);
  });

  it("partitions a mixed set into both blocks independently", () => {
    const blocks = computeCasillaBlocks([
      makeDisposal({ assetCategory: "STK", proceedsEur: new Decimal(1000), costBasisEur: new Decimal(800), gainLossEur: new Decimal(200) }),
      makeDisposal({ assetCategory: "OPT", proceedsEur: new Decimal(300), costBasisEur: new Decimal(500), gainLossEur: new Decimal(-200) }),
    ]);
    expect(blocks.listedShares.count).toBe(1);
    expect(blocks.listedShares.transmissionValue.toFixed(2)).toBe("1000.00");
    expect(blocks.otherElements.count).toBe(1);
    expect(blocks.otherElements.transmissionValue.toFixed(2)).toBe("300.00");
    expect(blocks.otherElements.losses.toFixed(2)).toBe("200.00");
  });

  it("returns empty blocks for no disposals", () => {
    const blocks = computeCasillaBlocks([]);
    expect(blocks.listedShares.count).toBe(0);
    expect(blocks.otherElements.count).toBe(0);
    expect(blocks.listedShares.transmissionValue.toFixed(2)).toBe("0.00");
    expect(blocks.otherElements.transmissionValue.toFixed(2)).toBe("0.00");
  });

  it("routes FSFOP (MEFF futures options) to the otros-elementos block", () => {
    const blocks = computeCasillaBlocks([makeDisposal({ assetCategory: "FSFOP" })]);
    expect(blocks.otherElements.count).toBe(1);
    expect(blocks.listedShares.count).toBe(0);
  });

  it("puts a zero-gain disposal in the gains bucket, not losses", () => {
    const blocks = computeCasillaBlocks([
      makeDisposal({ proceedsEur: new Decimal(800), costBasisEur: new Decimal(800), gainLossEur: new Decimal(0) }),
    ]);
    expect(blocks.listedShares.gains.toFixed(2)).toBe("0.00");
    expect(blocks.listedShares.losses.toFixed(2)).toBe("0.00");
    expect(blocks.listedShares.count).toBe(1);
  });
});

describe("computeCasillaBlocksWithFx", () => {
  it("folds FX gains into the otherElements block", () => {
    const report = makeReport({
      capitalGains: {
        transmissionValue: new Decimal(300), acquisitionValue: new Decimal(100),
        netGainLoss: new Decimal(200), blockedLosses: new Decimal(0),
        disposals: [makeDisposal({ assetCategory: "OPT", proceedsEur: new Decimal(300), costBasisEur: new Decimal(100), gainLossEur: new Decimal(200) })],
      },
      fxGains: {
        transmissionValue: new Decimal(5000), acquisitionValue: new Decimal(4800),
        netGainLoss: new Decimal(200), disposals: [makeFxDisposal()],
      },
    });
    const blocks = computeCasillaBlocksWithFx(report);
    expect(blocks.otherElements.transmissionValue.toFixed(2)).toBe("5300.00");
    expect(blocks.otherElements.acquisitionValue.toFixed(2)).toBe("4900.00");
    expect(blocks.otherElements.netGainLoss.toFixed(2)).toBe("400.00");
    expect(blocks.otherElements.gains.toFixed(2)).toBe("400.00");
    expect(blocks.otherElements.count).toBe(2);
  });

  it("leaves listedShares untouched by the FX merge", () => {
    const report = makeReport({
      capitalGains: {
        transmissionValue: new Decimal(1000), acquisitionValue: new Decimal(800),
        netGainLoss: new Decimal(200), blockedLosses: new Decimal(0),
        disposals: [makeDisposal({ assetCategory: "STK" })],
      },
      fxGains: {
        transmissionValue: new Decimal(5000), acquisitionValue: new Decimal(4800),
        netGainLoss: new Decimal(200), disposals: [makeFxDisposal()],
      },
    });
    const blocks = computeCasillaBlocksWithFx(report);
    expect(blocks.listedShares.transmissionValue.toFixed(2)).toBe("1000.00");
    expect(blocks.listedShares.count).toBe(1);
    // STK + FX only — no non-listed disposals, so otherElements is FX alone.
    expect(blocks.otherElements.count).toBe(1);
    expect(blocks.otherElements.transmissionValue.toFixed(2)).toBe("5000.00");
  });

  it("routes a negative FX result into the losses bucket", () => {
    const report = makeReport({
      fxGains: {
        transmissionValue: new Decimal(4800), acquisitionValue: new Decimal(5000),
        netGainLoss: new Decimal(-200),
        disposals: [makeFxDisposal({ proceedsEur: new Decimal(4800), costBasisEur: new Decimal(5000), gainLossEur: new Decimal(-200) })],
      },
    });
    const blocks = computeCasillaBlocksWithFx(report);
    expect(blocks.otherElements.losses.toFixed(2)).toBe("200.00");
    expect(blocks.otherElements.gains.toFixed(2)).toBe("0.00");
    expect(blocks.otherElements.netGainLoss.toFixed(2)).toBe("-200.00");
  });

  it("combines STK + OPT + FX into the correct two blocks", () => {
    const report = makeReport({
      capitalGains: {
        transmissionValue: new Decimal(1300), acquisitionValue: new Decimal(900),
        netGainLoss: new Decimal(400), blockedLosses: new Decimal(0),
        disposals: [
          makeDisposal({ assetCategory: "STK", proceedsEur: new Decimal(1000), costBasisEur: new Decimal(800), gainLossEur: new Decimal(200) }),
          makeDisposal({ assetCategory: "OPT", proceedsEur: new Decimal(300), costBasisEur: new Decimal(100), gainLossEur: new Decimal(200) }),
        ],
      },
      fxGains: {
        transmissionValue: new Decimal(5000), acquisitionValue: new Decimal(4800),
        netGainLoss: new Decimal(200), disposals: [makeFxDisposal()],
      },
    });
    const blocks = computeCasillaBlocksWithFx(report);
    expect(blocks.listedShares.count).toBe(1);
    expect(blocks.listedShares.transmissionValue.toFixed(2)).toBe("1000.00");
    // OPT (300) + FX (5000) → 5300
    expect(blocks.otherElements.count).toBe(2);
    expect(blocks.otherElements.transmissionValue.toFixed(2)).toBe("5300.00");
    expect(blocks.otherElements.acquisitionValue.toFixed(2)).toBe("4900.00");
  });
});
