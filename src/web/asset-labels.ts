/**
 * Canonical asset-category → display-label map.
 *
 * Single source of truth for turning an IBKR-style `assetCategory` code
 * (STK, FUND, OPT, FOP, FSFOP, CRYPTO, BOND) into a user-facing Spanish
 * label. Previously `charts.ts` and `operations-annex.ts` each defined their
 * own map and they had drifted apart (e.g. "Crypto" vs "Criptomonedas",
 * "Fondos/ETF" vs "Fondos / ETFs"), producing inconsistent labels for the
 * same category across the two views. Both modules now import from here.
 *
 * The values are the fuller, user-facing-correct Spanish forms that match the
 * rest of the UI (e.g. Modelo 721 calls crypto "Criptomonedas"). FOP/FSFOP are
 * IBKR's futures-options categories (see CLAUDE.md "FOP/FSFOP Asset Category");
 * keep them in sync with `KNOWN_CATEGORIES` (fifo.ts) and `WASH_SALE_EXEMPT`
 * (wash-sale.ts) when adding new categories.
 *
 * TODO(i18n): these labels are Spanish-only — no per-category translation key
 * exists yet. When the i18n wave adds keys (e.g. "asset.stk", "asset.crypto")
 * to all 5 locale files, route `assetLabel()` through `t()`. Until then a
 * single shared constant keeps the labels consistent across views.
 */

/** Canonical asset-category → Spanish label map. */
export const ASSET_LABELS: Record<string, string> = {
  STK: "Acciones",
  FUND: "Fondos / ETFs",
  OPT: "Opciones",
  FOP: "Opciones sobre futuros",
  FSFOP: "Opciones sobre futuros",
  CRYPTO: "Criptomonedas",
  BOND: "Bonos",
};

/**
 * Resolve an asset-category code to its display label, falling back to the raw
 * code for unknown categories (matches the previous `?? cat` behaviour).
 */
export function assetLabel(category: string): string {
  return ASSET_LABELS[category] ?? category;
}
