import type Decimal from "decimal.js";

/**
 * Format a Decimal or number as Spanish locale: dot for thousands, comma for decimals.
 * Example: 3301.71 → "3.301,71"
 */
export function fmtEur(d: Decimal | number, decimals = 2): string {
  const str = typeof d === "number" ? d.toFixed(decimals) : d.toFixed(decimals);
  const [intPart, decPart] = str.split(".");
  const withThousands = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decPart !== undefined ? `${withThousands},${decPart}` : withThousands;
}
