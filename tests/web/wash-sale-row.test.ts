/**
 * Tests for the anti-churning row marker shared by the operations annex and the
 * results operations table (src/web/wash-sale-row.ts). Both tables render rows
 * through these two helpers, so what is pinned here is what both show.
 */

import { describe, it, expect, afterEach } from "vitest";
import Decimal from "decimal.js";
import { washSaleRowAttr, renderWashSaleDetailRow } from "../../src/web/wash-sale-row.js";
import { setLocale } from "../../src/i18n/index.js";
import type { FifoDisposal } from "../../src/types/tax.js";

function makeDisposal(overrides: Partial<FifoDisposal> = {}): FifoDisposal {
  return {
    isin: "US0378331005",
    symbol: "AAPL",
    description: "APPLE INC",
    sellDate: "2025-06-15",
    acquireDate: "2025-01-10",
    quantity: new Decimal(10),
    gainLossFcy: new Decimal(-400),
    proceedsFcy: new Decimal(600),
    costBasisFcy: new Decimal(1000),
    proceedsEur: new Decimal(600),
    costBasisEur: new Decimal(1000),
    gainLossEur: new Decimal(-400),
    holdingPeriodDays: 156,
    currency: "EUR",
    sellEcbRate: new Decimal(1),
    acquireEcbRate: new Decimal(1),
    assetCategory: "STK",
    washSaleBlocked: false,
    blockedLossEur: new Decimal(0),
    reintegratedLossEur: new Decimal(0),
    ...overrides,
  };
}

const blocked = (dates?: string[]) =>
  makeDisposal({ washSaleBlocked: true, blockedLossEur: new Decimal(400), washSaleRepurchaseDates: dates });

afterEach(() => setLocale("es"));

describe("washSaleRowAttr", () => {
  it("highlights a blocked disposal's row", () => {
    expect(washSaleRowAttr(blocked(["2025-07-01"]))).toBe(' class="wash-sale-blocked"');
  });

  it("leaves a normal row untouched", () => {
    expect(washSaleRowAttr(makeDisposal())).toBe("");
  });
});

describe("renderWashSaleDetailRow", () => {
  it("renders nothing for a disposal with no blocked loss", () => {
    expect(renderWashSaleDetailRow(makeDisposal(), 9)).toBe("");
  });

  it("renders an expandable full-width line with the blocked amount", () => {
    const html = renderWashSaleDetailRow(blocked(["2025-07-01"]), 9);
    expect(html).toContain('<tr class="wash-sale-detail"><td colspan="9"><details><summary>');
    expect(html).toContain("Pérdida bloqueada por recompra: 400,00 EUR (art. 33.5 LIRPF)");
    expect(html).toContain("«Pérdidas patrimoniales no imputables»");
  });

  it("lists the repurchase dates that caused the block, as DD/MM/YYYY", () => {
    const html = renderWashSaleDetailRow(blocked(["2025-05-20", "2025-07-01"]), 9);
    expect(html).toContain("Compras del mismo valor que la bloquean: 20/05/2025, 01/07/2025");
  });

  it("shows the partial blocked amount, not the whole loss", () => {
    const html = renderWashSaleDetailRow(
      makeDisposal({ washSaleBlocked: true, blockedLossEur: new Decimal(120), washSaleRepurchaseDates: ["2025-07-01"] }),
      9,
    );
    expect(html).toContain("120,00 EUR");
    expect(html).not.toContain("400,00 EUR");
  });

  it("omits the dates line when the engine gave no dates", () => {
    const html = renderWashSaleDetailRow(blocked(undefined), 9);
    expect(html).toContain("Pérdida bloqueada por recompra");
    expect(html).not.toContain("Compras del mismo valor");
  });

  it("follows the active locale", () => {
    setLocale("en");
    const html = renderWashSaleDetailRow(blocked(["2025-07-01"]), 9);
    expect(html).toContain("Loss blocked by repurchase");
    expect(html).toContain("Purchases of the same security that block it: 01/07/2025");
    expect(html).not.toContain("Pérdida bloqueada");
  });
});
