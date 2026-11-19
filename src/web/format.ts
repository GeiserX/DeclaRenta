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
 * The most digits a number may have when written in full. Real data never
 * comes near it: the engine computes at 20 significant digits, so a split,
 * a merger or a spin-off gives a count such as 0.041133333333333333333 (21
 * decimals). Only an absurd exponent passes it, and that is never expanded:
 * in full, "1e-1000000000" is a billion characters and the page runs out of
 * memory (CodeRabbit on #470).
 */
const MAX_PRINTED_DIGITS = 60;

/** Whether `d` written with `decimals` decimals has at most {@link MAX_PRINTED_DIGITS} digits. */
function printsInFull(d: Decimal, decimals: number): boolean {
  return Math.max(d.e + 1, 1) + decimals <= MAX_PRINTED_DIGITS;
}

/**
 * Format a quantity of units in full, in Spanish format, with no trailing zeros
 * and never in exponent notation: 5e-8 → "0,00000005", 1234.5 → "1.234,5".
 * A count whose full text has more than 60 digits (an absurd exponent, never
 * a count from real data or from the engine) is «—».
 */
export function fmtQty(q: Decimal.Value): string {
  const quantity = new Decimal(q);
  if (quantity.isFinite() && !printsInFull(quantity, quantity.decimalPlaces())) return "—";
  return spanishNumber(quantity.toFixed());
}

/** "20250315", "2025-03-15" or "20250315;103000" → "15/03/2025". Anything else is returned unchanged. */
export function formatDate(d: string): string {
  const iso = normalizeDate(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : d;
}
