import Decimal from "decimal.js";
import { normalizeDate } from "../engine/dates.js";

/** "-1234.5" → "-1.234,5"; a negative zero ("-0", "-0.00") loses its sign. */
function spanishNumber(str: string): string {
  const unsigned = /^-0(\.0+)?$/.test(str) ? str.slice(1) : str;
  const [intPart, decPart] = unsigned.split(".");
  const withThousands = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decPart !== undefined ? `${withThousands},${decPart}` : withThousands;
}

/**
 * Format any numeric value using Spanish locale conventions:
 * dot as thousands separator, comma as decimal separator.
 * Used for EUR amounts, foreign currency quantities, and any user-facing number.
 * Example: 3301.71 → "3.301,71"
 */
export function fmtEur(d: Decimal | number, decimals = 2): string {
  // A Number goes through its shortest decimal string, so 1.005 rounds to 1,01
  // like the Decimal 1.005 does, not to 1,00 like the binary float 1.00499…
  const dec = typeof d === "number" ? new Decimal(String(d)) : d;
  return spanishNumber(dec.toFixed(decimals));
}

/**
 * Format a quantity of units in full, in Spanish format, with no trailing zeros
 * and never in exponent notation: 5e-8 → "0,00000005", 1234.5 → "1.234,5".
 */
export function fmtQty(q: Decimal.Value): string {
  return spanishNumber(new Decimal(q).toFixed());
}

/** "20250315", "2025-03-15" or "20250315;103000" → "15/03/2025". Anything else is returned unchanged. */
export function formatDate(d: string): string {
  const iso = normalizeDate(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : d;
}
