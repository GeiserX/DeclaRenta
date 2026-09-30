/**
 * Canonical asset-category → display-label map.
 *
 * Single source of truth for turning an IBKR-style `assetCategory` code
 * (STK, FUND, OPT, FOP, FSFOP, CRYPTO, BOND) into a user-facing label.
 * Previously `charts.ts` and `operations-annex.ts` each defined their own map
 * and they had drifted apart (e.g. "Crypto" vs "Criptomonedas", "Fondos/ETF" vs
 * "Fondos / ETFs"), producing inconsistent labels for the same category across
 * the two views. Both modules now import from here.
 *
 * Each category maps to an `asset.*` translation key present in all 5 locales,
 * so the label follows the active language. FOP/FSFOP are IBKR's
 * futures-options categories (see CLAUDE.md "FOP/FSFOP Asset Category"); keep
 * them in sync with `KNOWN_CATEGORIES` (fifo.ts) and `WASH_SALE_EXEMPT`
 * (wash-sale.ts) when adding new categories.
 */

import { t, type TranslationKey } from "../i18n/index.js";

/** Canonical asset-category → translation key map. */
export const ASSET_LABELS: Record<string, TranslationKey> = {
  STK: "asset.stk",
  FUND: "asset.fund",
  OPT: "asset.opt",
  FOP: "asset.fop",
  FSFOP: "asset.fop",
  CRYPTO: "asset.crypto",
  BOND: "asset.bond",
};

/**
 * Resolve an asset-category code to its label in the active locale, falling
 * back to the raw code for unknown categories (matches the previous `?? cat`
 * behaviour).
 */
export function assetLabel(category: string): string {
  const key = ASSET_LABELS[category];
  return key ? t(key) : category;
}
