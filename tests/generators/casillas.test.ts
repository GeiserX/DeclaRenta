import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeCasillaBlocks, isListedShare } from "../../src/generators/casillas.js";
import type { FifoDisposal } from "../../src/types/tax.js";

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

describe("isListedShare", () => {
  it("treats STK as a listed share", () => {
    expect(isListedShare({ assetCategory: "STK" })).toBe(true);
  });

  it("treats options, crypto, and funds as non-listed", () => {
    expect(isListedShare({ assetCategory: "OPT" })).toBe(false);
    expect(isListedShare({ assetCategory: "FOP" })).toBe(false);
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
});
