/**
 * Shared CSV parsing utilities.
 *
 * Used by Degiro, Scalable Capital, and other CSV-based broker parsers.
 * Handles EU/US number formats, quoted fields, and date conversion.
 */

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
  const trimmed = val.trim().replace(/[€$£¥]/g, "").trim();
  if (!trimmed) return "0";

  // If it has both dot and comma, the last one is the decimal separator
  const lastDot = trimmed.lastIndexOf(".");
  const lastComma = trimmed.lastIndexOf(",");

  if (lastComma > lastDot) {
    // EU format: dots are thousands, comma is decimal
    return trimmed.replace(/\./g, "").replace(",", ".");
  }
  if (lastDot > lastComma && lastComma >= 0) {
    // US/UK format: commas are thousands, dot is decimal
    return trimmed.replace(/,/g, "");
  }
  // Only one separator or none — comma might be decimal (no thousands)
  if (lastComma >= 0 && lastDot < 0) {
    return trimmed.replace(",", ".");
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
