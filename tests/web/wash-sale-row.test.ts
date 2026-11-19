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

const released = (from?: string[]) =>
  makeDisposal({ gainLossEur: new Decimal(50), reintegratedLossEur: new Decimal(25), washSaleReleasedFromDates: from });

afterEach(async () => {
  await setLocale("es");
});

describe("washSaleRowAttr", () => {
  it("highlights a blocked disposal's row", () => {
    expect(washSaleRowAttr(blocked(["2025-07-01"]))).toBe(' class="wash-sale-blocked"');
  });

  it("leaves a normal row untouched", () => {
    expect(washSaleRowAttr(makeDisposal())).toBe("");
  });

  it("marks a row that only releases pending losses", () => {
    expect(washSaleRowAttr(released(["2025-03-01"]))).toBe(' class="wash-sale-released"');
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

  it("follows the active locale", async () => {
    await setLocale("en");
    const html = renderWashSaleDetailRow(blocked(["2025-07-01"]), 9);
    expect(html).toContain("Loss blocked by repurchase");
    expect(html).toContain("Purchases of the same security that block it: 01/07/2025");
    expect(html).not.toContain("Pérdida bloqueada");
  });

  it("says which earlier loss sales a definitive sale releases", () => {
    const html = renderWashSaleDetailRow(released(["2025-10-01", "2025-10-10"]), 9);
    expect(html).toContain('<tr class="wash-sale-detail wash-sale-detail-released">');
    expect(html).toContain("Libera 25,00 EUR de pérdidas diferidas de este valor (transmisión definitiva, art. 33.5 LIRPF)");
    expect(html).toContain("Pérdidas pendientes de las ventas del: 01/10/2025, 10/10/2025");
    expect(html).not.toContain("Pérdida bloqueada");
  });

  it("shows both lines on a sale that blocks its own loss and releases older ones (V0913-08)", () => {
    const html = renderWashSaleDetailRow(
      makeDisposal({
        washSaleBlocked: true, blockedLossEur: new Decimal(400), washSaleRepurchaseDates: ["2007-04-16"],
        reintegratedLossEur: new Decimal(138000), washSaleReleasedFromDates: ["2007-02-15"],
      }),
      9,
    );
    expect(html).toContain('<tr class="wash-sale-detail">');
    expect(html).toContain("<summary>Pérdida bloqueada por recompra: 400,00 EUR");
    expect(html).toContain("Libera 138.000,00 EUR");
    expect(html).toContain("15/02/2007");
    // The sale is partly rebought (10 shares), so the release hint speaks of the
    // shares no rebuy covers, never of a sale with no rebuy.
    expect(html).not.toContain("no tiene recompra");
    expect(html).toContain("que ninguna recompra en su plazo cubre son una transmisión definitiva");
  });

  it("no longer says the loss is applied when you sell what you bought back", () => {
    const html = renderWashSaleDetailRow(blocked(["2025-07-01"]), 9);
    expect(html).not.toContain("cuando vendas lo que recompraste");
    expect(html).toContain("primero las pérdidas más antiguas");
  });
});

describe("renderWashSaleDetailRow for crypto (art. 33.5.e)", () => {
  it("explains a crypto release by the sale of the rebought coins, not by the definitive test", () => {
    const html = renderWashSaleDetailRow(
      makeDisposal({ assetCategory: "CRYPTO", isin: "", symbol: "BTC", gainLossEur: new Decimal(5), reintegratedLossEur: new Decimal(10) }),
      9,
    );
    expect(html).toContain("Libera 10,00 EUR de pérdidas diferidas de esta criptomoneda (venta de las unidades recompradas, art. 33.5.e LIRPF)");
    expect(html).toContain("Vender otras unidades no la integra.");
    expect(html).not.toContain("transmisión definitiva");
  });

  it("keeps the securities text on a share release", () => {
    const html = renderWashSaleDetailRow(released(["2025-03-01"]), 9);
    expect(html).toContain("transmisión definitiva");
    expect(html).not.toContain("criptomoneda");
  });
});
