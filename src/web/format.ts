import type Decimal from "decimal.js";

/**
 * Format any numeric value using Spanish locale conventions:
 * dot as thousands separator, comma as decimal separator.
 * Used for EUR amounts, foreign currency quantities, and any user-facing number.
 * Example: 3301.71 → "3.301,71"
 */
export function fmtEur(d: Decimal | number, decimals = 2): string {
  // Both branches call .toFixed() but resolve to different implementations:
  // Number.prototype.toFixed vs Decimal.prototype.toFixed (arbitrary precision)
  const str = typeof d === "number" ? d.toFixed(decimals) : d.toFixed(decimals);
  const [intPart, decPart] = str.split(".");
  const withThousands = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decPart !== undefined ? `${withThousands},${decPart}` : withThousands;
}
