/**
 * Shared CSV parsing utilities.
 *
 * Used by Degiro, Scalable Capital, and other CSV-based broker parsers.
 * Handles EU/US number formats, quoted fields, and date conversion.
 */

import Decimal from "decimal.js";
import type { Trade } from "../types/ibkr.js";
import type { TaxMessage } from "../types/tax.js";

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
// Trade quantities: missing is not zero (#453)
// ---------------------------------------------------------------------------

/**
 * Whether a trade row's quantity cell is missing, blank, only a currency
 * symbol or no finite number, read through the same guard as the parser's own
 * quantity ({@link toFiniteDecimalString}, `parseEu` as the parser passes it).
 * Such a row is no explicit zero: it may be a purchase or a sale of any size.
 */
export function quantityUnreadable(cell: string | number | null | undefined, parseEu = true): boolean {
  if (cell === undefined || cell === null) return true;
  // parseNumber strips currency symbols and reads what is left blank as "0":
  // test for a blank or currency-only cell ("€", "$") first.
  const raw = String(cell).trim();
  const text = parseEu ? raw.replace(/[€$£¥]/g, "").trim() : raw;
  return text === "" || toFiniteDecimalString(text, "", parseEu) === "";
}

/**
 * The trade a parser keeps for a buy or sale row whose quantity cell is
 * missing or unreadable ({@link quantityUnreadable}), where it would skip a
 * written "0", or whose price cell is, where it would skip a written zero
 * price (Flatex, DEGIRO, Trading 212). It carries the row's identity
 * (security, day, direction) and nothing else: quantity "0" with
 * `quantityUnknown`, every amount "0". So it
 * moves no number (FIFO skips it, the FX engines see no money) and only tells
 * the anti-churning one-purchase exception that the upload cannot prove it
 * for that security (#453).
 */
export function quantityUnknownTrade(
  row: Pick<Trade, "tradeID" | "symbol" | "isin" | "assetCategory" | "currency" | "tradeDate" | "buySell" | "exchange"> &
    Partial<Pick<Trade, "description" | "tradeTime" | "accountId">>,
): Trade {
  const { description, tradeTime, accountId, ...rest } = row;
  return {
    ...rest,
    accountId: accountId ?? "",
    description: description || row.symbol,
    ...(tradeTime ? { tradeTime } : {}),
    settlementDate: row.tradeDate,
    quantity: "0",
    quantityUnknown: true,
    tradePrice: "0",
    tradeMoney: "0",
    proceeds: "0",
    cost: "0",
    fifoPnlRealized: "0",
    fxRateToBase: "1",
    openCloseIndicator: row.buySell === "SELL" ? "C" : "O",
    commissionCurrency: row.currency,
    commission: "0",
    taxes: "0",
    multiplier: "1",
  };
}

// ---------------------------------------------------------------------------
// Unreadable trade rows: kept, never dropped (#467, #468)
// ---------------------------------------------------------------------------

/** Whether a parsed trade date is a real calendar day written YYYYMMDD. */
export function isReadableTradeDate(date: string): boolean {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  return day.getUTCFullYear() === y && day.getUTCMonth() === mo - 1 && day.getUTCDate() === d;
}

/**
 * The cell that makes a row unreadable, as the user sees it in the file:
 * `Type: "BUY - STOP"`, `date: null`, `ISIN: ""`. A missing cell reads `—`.
 */
export function unreadableCell(column: string, value: unknown): string {
  if (value === undefined) return `${column}: —`;
  const text = typeof value === "string" ? value.trim() : value;
  const shown = JSON.stringify(text) ?? String(text);
  return `${column}: ${shown.length > 42 ? `${shown.slice(0, 40)}…"` : shown}`;
}

/**
 * The trade a parser keeps for a row that looks like a trade but cannot be
 * read (#467, #468): a bad or empty date, no ticker or ISIN, an operation type
 * that is neither a buy nor a sale (never booked as a buy), no amount. A
 * dropped row would hide a purchase or a sale: the anti-churning one-purchase
 * exception (#453) would then be applied with no proof, and a sale would
 * vanish. So the row is kept as {@link quantityUnknownTrade}: it moves no
 * share and no money, counts as no repurchase, and makes the one-purchase
 * evidence of its security (or of every security, with no ISIN) "unverified".
 * `cell` names what could not be read ({@link unreadableCell}).
 * `parser.trade_row_unreadable` lists every such row. `buySell` is the side
 * when the row gives one, else a placeholder: nothing reads it.
 *
 * A row whose date cannot be read keeps `tradeDate` "" until
 * {@link dateUndatedTrades} gives it a date the engine can process.
 */
export function unreadableTrade(
  row: Pick<Trade, "tradeID" | "symbol" | "isin" | "assetCategory" | "currency" | "tradeDate" | "exchange"> &
    Partial<Pick<Trade, "description" | "tradeTime" | "accountId" | "buySell">>,
  cell: string,
): Trade {
  const dated = isReadableTradeDate(row.tradeDate);
  const security = row.isin ? (row.symbol ? `${row.symbol} (${row.isin})` : row.isin) : row.symbol || "—";
  return {
    ...quantityUnknownTrade({ ...row, tradeDate: dated ? row.tradeDate : "", buySell: row.buySell ?? "BUY" }),
    unreadableRow: `${security}${dated ? ` ${row.tradeDate}` : ""} [${cell}]`,
  };
}

/**
 * First, turn every trade whose date the parser could not read (not a real
 * YYYYMMDD day: "2024-13-45", "<style>") into an unreadable row named by
 * `dateColumn` ({@link unreadableTrade}): a lot with no real date could fall
 * outside the anti-churning window it belongs to and prove the one-purchase
 * exception (#453, #467).
 *
 * Then give each kept row whose date the file does not give the earliest
 * readable date of the same file (its trades, and `otherDates`, such as its
 * cash rows'). The engine needs a real date for every trade; the earliest one
 * puts the row before every window the file reaches, where the one-purchase
 * evidence reads it as a trade that may be any shares held at the window
 * start (and with an ISIN, the date does not matter: the security is
 * "unverified" anyway). The row still books nothing, and its warning shows no
 * date. A file with no readable date at all is refused.
 */
export function dateUndatedTrades(
  broker: string,
  trades: Trade[],
  otherDates: readonly string[] = [],
  dateColumn = "Date",
): void {
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i]!;
    if (t.unreadableRow !== undefined || isReadableTradeDate(t.tradeDate)) continue;
    trades[i] = unreadableTrade({
      tradeID: t.tradeID, accountId: t.accountId, symbol: t.symbol, description: t.description, isin: t.isin,
      assetCategory: t.assetCategory, currency: t.currency, tradeDate: "", exchange: t.exchange, buySell: t.buySell,
    }, unreadableCell(dateColumn, t.tradeDate));
  }
  const undated = trades.filter((t) => t.unreadableRow !== undefined && t.tradeDate === "");
  if (undated.length === 0) return;
  const dates = [...trades.map((t) => t.tradeDate), ...otherDates].filter(isReadableTradeDate).sort();
  const earliest = dates[0];
  if (earliest === undefined) {
    throw new Error(`${broker}: ninguna operación del archivo tiene una fecha legible. Vuelve a exportarlo.`);
  }
  for (const t of undated) {
    t.tradeDate = earliest;
    t.settlementDate = earliest;
  }
}

/**
 * The warnings naming every trade whose quantity or price the file does not
 * give: one for shares and other securities, one for crypto (whose rule is
 * art. 33.5.e, with no one-purchase exception), or none; and one naming every
 * trade row the file does not let the parser read (`unreadableRow`). Shared by
 * every parser (`broker` is the name shown to the user), one translation key
 * each.
 */
export function tradeQuantityUnknownMessages(broker: string, trades: readonly Trade[]): TaxMessage[] {
  const unreadable = trades.filter((t) => t.quantityUnknown && t.unreadableRow === undefined);
  const messages: TaxMessage[] = [];
  for (const crypto of [false, true]) {
    const group = unreadable.filter((t) => (t.assetCategory === "CRYPTO") === crypto);
    if (group.length === 0) continue;
    const count = String(group.length);
    const list = group.map((t) => `${t.isin ? `${t.symbol} (${t.isin})` : t.symbol} ${t.tradeDate}`).join(", ");
    messages.push(crypto
      ? {
          id: "parser.crypto_quantity_unknown",
          severity: "warning",
          message: `${broker} no da un número de unidades o un precio legible para ${count} operación(es) con criptomonedas: ${list}.`,
          hint: "DeclaRenta no suma ni resta unidades por ellas, así que las ganancias y pérdidas de esa criptomoneda no son fiables. Si una de ellas es una recompra en el año siguiente a una venta con pérdidas, esa pérdida puede tener que quedar pendiente (art. 33.5.e LIRPF), y DeclaRenta no la bloquea porque no sabe cuántas unidades recompraste. Comprueba que el archivo exportado trae la cantidad y el precio de cada operación y vuelve a exportarlo.",
          context: { broker, count, trades: list },
        }
      : {
          id: "parser.trade_quantity_unknown",
          severity: "warning",
          message: `${broker} no da un número de acciones o un precio legible para ${count} operación(es): ${list}.`,
          hint: "DeclaRenta no suma ni resta acciones por ellas, así que las ganancias y pérdidas de ese valor no son fiables y no se aplica la excepción de compra única de la regla de los 2 meses. Comprueba que el archivo exportado trae la cantidad y el precio de cada operación y vuelve a exportarlo.",
          context: { broker, count, trades: list },
        });
  }
  const rows = trades.flatMap((t) => (t.unreadableRow === undefined ? [] : [t.unreadableRow]));
  if (rows.length > 0) {
    const count = String(rows.length);
    const list = rows.join("; ");
    messages.push({
      id: "parser.trade_row_unreadable",
      severity: "warning",
      message: `${broker}: ${count} fila(s) de operación no se pueden leer y no se calculan: ${list}.`,
      hint: "Entre corchetes va la celda que falta, está vacía, no se puede leer o trae un tipo de operación que DeclaRenta no reconoce. DeclaRenta no suma ni resta acciones, unidades ni dinero por esas filas, así que las ganancias y pérdidas de esos valores no son fiables, y no aplica la excepción de compra única de la regla de los 2 meses a un valor que pueda ser el de una de ellas. Si una fila es una compra o una venta real, corrige esa celda en el archivo del broker y vuelve a subirlo.",
      context: { broker, count, rows: list },
    });
  }
  return messages;
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

/** Time of day in a timestamp or time cell ("2025-01-10 09:05:07",
 *  "2025-01-10T09:05:07Z", "9:05") as "HH:MM:SS"; undefined when there is none. */
export function timeOfDay(text: string): string | undefined {
  const match = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return undefined;
  return `${match[1]!.padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
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
