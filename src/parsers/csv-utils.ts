/**
 * Shared CSV parsing utilities.
 *
 * Used by Degiro, Scalable Capital, and other CSV-based broker parsers.
 * Handles EU/US number formats, quoted fields, and date conversion.
 */

import Decimal from "decimal.js";

// ---------------------------------------------------------------------------
// Finiteness-guarded money parsing
// ---------------------------------------------------------------------------

/**
 * Parse a (possibly EU-formatted) numeric string into a FINITE Decimal string,
 * never `NaN`/`Infinity`. `new Decimal("NaN"|"Infinity")` does NOT throw and a
 * non-finite value silently poisons every downstream total → a literal "NaN"/
 * "Infinity" (or a wildly inflated figure) in a tax casilla with no warning.
 * This is the single guard all parser money/quantity parsing must route through.
 *
 * Returns the normalized decimal STRING (so callers keep the lossless-string →
 * Decimal pattern); falls back to `fallback` (default "0") on any non-finite or
 * unparseable input. `parseEu` runs the EU/US `parseNumber` normalization first.
 *
 * WHICH VARIANT TO USE: call `toFiniteDecimalString` when the result is stored
 * verbatim into a `Trade`/`CashTransaction` STRING field; call `toFiniteDecimal`
 * when you immediately do Decimal arithmetic (`.plus`/`.mul`/`.abs`/…). Don't
 * wrap one in the other (`new Decimal(toFiniteDecimalString(x))` === `toFiniteDecimal(x)`).
 */
export function toFiniteDecimalString(val: string, fallback = "0", parseEu = true): string {
  const raw = parseEu ? parseNumber(val) : val.trim();
  if (!raw) return fallback;
  try {
    const d = new Decimal(raw);
    return d.isFinite() ? d.toString() : fallback;
  } catch {
    return fallback;
  }
}

/** Same as {@link toFiniteDecimalString} but returns a Decimal (guaranteed finite). */
export function toFiniteDecimal(val: string, fallback = "0", parseEu = true): Decimal {
  return new Decimal(toFiniteDecimalString(val, fallback, parseEu));
}

// ---------------------------------------------------------------------------
// Delimiter detection
// ---------------------------------------------------------------------------

/** Auto-detect delimiter by counting semicolons vs commas in the header line */
export function detectDelimiter(headerLine: string): string {
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

// ---------------------------------------------------------------------------
// CSV line parsing
// ---------------------------------------------------------------------------

/** Parse a single CSV line, handling quoted fields */
export function parseCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

// ---------------------------------------------------------------------------
// Number parsing
// ---------------------------------------------------------------------------

/**
 * Parse a number that may use EU format (dot thousands, comma decimal).
 * Handles: "1.234,56" -> "1234.56", "-175,50" -> "-175.50", "175.50" -> "175.50"
 */
export function parseNumber(val: string): string {
  // Strip currency symbols (€, $, £, etc.) from any position before parsing
  let trimmed = val.trim().replace(/[€$£¥]/g, "").trim();
  if (!trimmed) return "0";

  // Handle parenthesized negatives: (123.45) → -123.45
  const parenMatch = trimmed.match(/^\(([0-9.,\s-]+)\)$/);
  if (parenMatch) {
    trimmed = `-${parenMatch[1]!.trim()}`;
  }

  // If it has both dot and comma, the last one is the decimal separator
  const lastDot = trimmed.lastIndexOf(".");
  const lastComma = trimmed.lastIndexOf(",");

  if (lastComma >= 0 && lastDot < 0) {
    // Only commas, no dot. A lone comma is ambiguous: it can be a decimal
    // separator (EU "1,5" = 1.5, German "2,082" = 2.082) or a US thousands
    // separator ("1,500" = 1500). Most DeclaRenta brokers are European
    // (comma = decimal), and German brokers like Flatex legitimately emit
    // 3-decimal prices such as "2,082". Misreading those as thousands causes a
    // 1000x overstatement — a worse fiscal error than the reverse. We therefore
    // only treat the UNAMBIGUOUS multi-comma case as thousands and keep a lone
    // comma as a decimal separator.
    //  - Multiple commas → always thousands ("1,234,567" = 1234567)
    //  - A single comma → decimal ("1,5"→1.5, "1,50"→1.5, "2,082"→2.082)
    const commaCount = (trimmed.match(/,/g) ?? []).length;
    if (commaCount > 1) {
      // Multiple commas can only be thousands separators
      return trimmed.replace(/,/g, "");
    }
    return trimmed.replace(",", ".");
  }
  if (lastComma > lastDot) {
    // EU format: dots are thousands, comma is decimal ("1.234,56" → "1234.56")
    return trimmed.replace(/\./g, "").replace(",", ".");
  }
  if (lastDot > lastComma && lastComma >= 0) {
    // US/UK format: commas are thousands, dot is decimal
    return trimmed.replace(/,/g, "");
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Date conversion
// ---------------------------------------------------------------------------

/** Convert DD-MM-YYYY to YYYYMMDD */
export function convertDateDMY(date: string): string {
  const trimmed = date.trim();
  const match = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return trimmed;
  return `${match[3]}${match[2]}${match[1]}`;
}

/** Convert DD.MM.YYYY to YYYYMMDD (Flatex/German format) */
export function convertDateDMYDot(date: string): string {
  const trimmed = date.trim();
  const match = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return trimmed;
  return `${match[3]}${match[2]}${match[1]}`;
}

/** Convert DD/MM/YYYY to YYYYMMDD */
export function convertDateDMYSlash(date: string): string {
  const trimmed = date.trim();
  const match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return trimmed;
  return `${match[3]}${match[2]}${match[1]}`;
}

/** Convert YYYY-MM-DD to YYYYMMDD */
export function convertDateISO(date: string): string {
  return date.trim().replace(/-/g, "").slice(0, 8);
}

// ---------------------------------------------------------------------------
// Fractional (minor-unit) currency normalization
// Some venues quote in the minor unit: GBX (penny sterling, LSE), ZAc (South
// African cents), ILA (Israeli agorot). The ECB only publishes the major unit
// (GBP/ZAR/ILS), so parsers must normalize the code and divide the quoted
// price/amount by 100 before anything downstream sees the trade — otherwise
// the valuation pre-pass drops it as an unresolvable currency (issue #282).
// ---------------------------------------------------------------------------

const FRACTIONAL_CURRENCIES: Record<string, { base: string; divisor: Decimal }> = {
  GBX: { base: "GBP", divisor: new Decimal(100) },
  ZAC: { base: "ZAR", divisor: new Decimal(100) },
  ILA: { base: "ILS", divisor: new Decimal(100) },
};

/**
 * Map a minor-unit currency code to its ECB major unit and the divisor to
 * apply to amounts quoted in it. Unknown codes pass through with divisor 1.
 */
export function normalizeFractionalCurrency(code: string): { currency: string; divisor: Decimal } {
  const entry = FRACTIONAL_CURRENCIES[code.trim().toUpperCase()];
  if (entry) return { currency: entry.base, divisor: entry.divisor };
  return { currency: code, divisor: new Decimal(1) };
}

// ---------------------------------------------------------------------------
// Column finding
// ---------------------------------------------------------------------------

/** Find column index by checking header against a list of known names (case-insensitive) */
export function findColumn(headers: string[], names: string[]): number {
  const lowerNames = names.map((n) => n.toLowerCase());
  return headers.findIndex((h) => lowerNames.includes(h.toLowerCase().trim()));
}

/** Strip UTF-8 BOM from the beginning of a string */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
