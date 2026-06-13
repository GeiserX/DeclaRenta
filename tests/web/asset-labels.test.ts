/**
 * Tests for the canonical asset-category label map.
 *
 * This map is the single source of truth shared by charts.ts and
 * operations-annex.ts (it replaced two diverging local copies). The tests
 * pin the canonical Spanish values and the unknown-category fallback so a
 * future edit can't silently re-introduce the "Crypto" vs "Criptomonedas"
 * style drift.
 */

import { describe, it, expect } from "vitest";
import { ASSET_LABELS, assetLabel } from "../../src/web/asset-labels.js";

describe("ASSET_LABELS canonical map", () => {
  it("exposes the canonical Spanish label for every known category", () => {
    expect(ASSET_LABELS).toEqual({
      STK: "Acciones",
      FUND: "Fondos / ETFs",
      OPT: "Opciones",
      FOP: "Opciones sobre futuros",
      FSFOP: "Opciones sobre futuros",
      CRYPTO: "Criptomonedas",
      BOND: "Bonos",
    });
  });

  it("uses the fuller 'Criptomonedas' form (not the old chart 'Crypto')", () => {
    expect(ASSET_LABELS.CRYPTO).toBe("Criptomonedas");
  });

  it("maps FOP and FSFOP to the same futures-options label", () => {
    expect(ASSET_LABELS.FOP).toBe(ASSET_LABELS.FSFOP);
    expect(ASSET_LABELS.FOP).toBe("Opciones sobre futuros");
  });
});

describe("assetLabel()", () => {
  it("resolves a known category to its label", () => {
    expect(assetLabel("STK")).toBe("Acciones");
    expect(assetLabel("CRYPTO")).toBe("Criptomonedas");
  });

  it("falls back to the raw code for an unknown category", () => {
    expect(assetLabel("OTHER")).toBe("OTHER");
    expect(assetLabel("")).toBe("");
  });
});
