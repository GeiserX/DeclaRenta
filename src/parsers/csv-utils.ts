/**
 * Shared CSV parsing utilities.
 *
 * Used by Degiro, Scalable Capital, and other CSV-based broker parsers.
 * Handles EU/US number formats, quoted fields, and date conversion.
 */

import Decimal from "decimal.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
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
 * The real calendar day of a parsed date or date-time, as YYYYMMDD, in every
 * form the parsers write and the engine reads: YYYYMMDD or YYYY-MM-DD, alone
 * or followed by a time after ";", "T" or a space, or YYYYMMDDHHMMSS (an
 * IBKR Flex with no date/time separator). Undefined when there is none: "",
 * "20241345", "1/10/24", "<b>".
 */
export function readableDay(date: string): string | undefined {
  const m = /^(\d{4})(-?)(\d{2})\2(\d{2})(?:[;T ]|$|(?<=^\d{8})\d{6}$)/.exec(date.trim());
  if (!m) return undefined;
  const day = `${m[1]}${m[3]}${m[4]}`;
  return isReadableTradeDate(day) ? day : undefined;
}

/** Whether a parsed date or date-time is a real calendar day ({@link readableDay}). */
export function isReadableDay(date: string): boolean {
  return readableDay(date) !== undefined;
}

/**
 * The cell that makes a row unreadable, as the user sees it in the file:
 * `Type: "BUY - STOP"`, `date: null`, `ISIN: ""`. A missing cell reads `—`.
 */
export function unreadableCell(column: string, value: string | number | boolean | null | undefined): string {
  if (value === undefined) return `${column}: —`;
  const shown = JSON.stringify(typeof value === "string" ? value.trim() : value);
  return `${column}: ${shown.length > 42 ? `${shown.slice(0, 40)}…"` : shown}`;
}

/** How a kept row names its security: `XYZ (ISIN)`, the ISIN, the symbol or the name. */
function securityOf(row: Pick<Trade, "symbol" | "isin"> & Partial<Pick<Trade, "description">>): string {
  return row.isin ? (row.symbol ? `${row.symbol} (${row.isin})` : row.isin) : row.symbol || row.description || "—";
}

type KeptRow = Pick<Trade, "tradeID" | "symbol" | "isin" | "assetCategory" | "currency" | "tradeDate" | "exchange"> &
  Partial<Pick<Trade, "description" | "tradeTime" | "accountId" | "buySell">>;

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
 * A row whose date cannot be read keeps `tradeDate` "" ({@link markUndatedTrades}).
 */
export function unreadableTrade(row: KeptRow, cell: string): Trade {
  const dated = isReadableDay(row.tradeDate);
  return {
    ...quantityUnknownTrade({ ...row, tradeDate: dated ? row.tradeDate : "", buySell: row.buySell ?? "BUY" }),
    unreadableRow: `${securityOf(row)}${dated ? ` ${row.tradeDate}` : ""} [${cell}]`,
  };
}

/**
 * The trade a parser keeps for a row of a split, a consolidation, a merger, a
 * delivery or another corporate action it does not apply (#467): such a row
 * moves shares of its security, so dropping it would hide a holding at the
 * anti-churning window start and let the one-purchase exception (#453) be
 * applied with no proof. Kept as {@link quantityUnknownTrade}: it moves no
 * share and no money, and makes the evidence of its security "unverified".
 * It is no unreadable row: `parser.corporate_action_not_applied` names it by
 * security, date, `action` and the share count the file writes (`shares`).
 */
export function corporateActionTrade(row: KeptRow, action: string, shares: string): Trade {
  return {
    ...quantityUnknownTrade({ ...row, buySell: row.buySell ?? "BUY" }),
    corporateActionRow: `${securityOf(row)} ${row.tradeDate || "—"} [${action}: ${shares.trim() || "—"}]`,
  };
}

/**
 * A row type that names a split, a consolidation or another corporate action
 * ("Stock split", "Reverse split", "Corporate action", "Merger", "Spin-off"):
 * kept by {@link corporateActionTrade}, never called unreadable.
 */
export function isCorporateActionType(type: string): boolean {
  return /split|consolidat|corporate|merger|spin.?off|reorgani/i.test(type);
}

/**
 * Every trade whose date the parser could not read (not a real day:
 * "", "2024-13-45", "<style>", {@link readableDay}) becomes an unreadable row
 * named by `dateColumn` ({@link unreadableTrade}; a corporate-action row stays
 * one), with `tradeDate` "" and `undatedRow` (#467). A lot with no real date
 * could fall outside the anti-churning window it belongs to and prove the
 * one-purchase exception (#453). The parser invents no date and refuses no
 * file: `finalizeMergedStatement` gives each such row the earliest date of
 * the whole upload, which the engine needs.
 */
export function markUndatedTrades(trades: Trade[], dateColumn = "Date"): void {
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i]!;
    if (isReadableDay(t.tradeDate)) continue;
    const kept = t.unreadableRow !== undefined || t.corporateActionRow !== undefined ? t : unreadableTrade({
      tradeID: t.tradeID, accountId: t.accountId, symbol: t.symbol, description: t.description, isin: t.isin,
      assetCategory: t.assetCategory, currency: t.currency, tradeDate: t.tradeDate, exchange: t.exchange, buySell: t.buySell,
    }, unreadableCell(dateColumn, t.tradeDate));
    trades[i] = { ...kept, tradeDate: "", settlementDate: "", undatedRow: true };
  }
}

/**
 * Take out every cash row (a dividend, a withholding, an interest, a deposit)
 * whose date the parser could not read, and name each in
 * `parser.cash_row_undated` (#467). The date decides the tax year and the ECB
 * rate, and pairs a withholding with its dividend, so a guessed date would
 * move them with no word: the row is not booked, and the warning gives its
 * type, security, amount and date cell so the user can add it by hand.
 * `cash` is changed in place.
 */
export function dropUndatedCash(broker: string, cash: CashTransaction[], dateColumn = "Date"): TaxMessage[] {
  const undated = cash.filter((c) => !isReadableDay(c.dateTime));
  if (undated.length === 0) return [];
  const kept = cash.filter((c) => isReadableDay(c.dateTime));
  cash.splice(0, cash.length, ...kept);
  const count = String(undated.length);
  const list = undated.map((c) => {
    const security = c.isin && c.isin !== c.symbol ? `${c.symbol || c.description} (${c.isin})` : c.symbol || c.description || "—";
    return `${c.type} ${security} ${c.amount} ${c.currency} [${unreadableCell(dateColumn, c.dateTime)}]`;
  }).join("; ");
  return [{
    id: "parser.cash_row_undated",
    severity: "warning",
    message: `${broker}: ${count} movimiento(s) de dinero no tienen una fecha legible y no se calculan: ${list}.`,
    hint: "Entre corchetes va la celda de la fecha. Sin fecha, DeclaRenta no sabe a qué año pertenece el importe ni qué tipo de cambio del BCE le toca. Por eso no lo suma y no se inventa una fecha. Puede ser un dividendo, una retención, un interés u otro ingreso del año que declaras. Entonces corrige la fecha en el archivo del broker y vuelve a subirlo. También puedes añadir el importe a mano en Renta Web.",
    context: { broker, count, rows: list },
  }];
}

/**
 * The warning naming every dividend or withholding row the file gives with no
 * security (no ticker, no ISIN): `rows` are "type amount currency date" (#467).
 * The security decides the source country and pairs a withholding with its
 * dividend, so the row is not booked under a guessed one, and is never
 * dropped with no word: the user adds it by hand.
 */
export function cashRowsUnidentifiedMessages(broker: string, rows: readonly string[]): TaxMessage[] {
  if (rows.length === 0) return [];
  const count = String(rows.length);
  const list = rows.join("; ");
  return [{
    id: "parser.cash_row_unidentified",
    severity: "warning",
    message: `${broker}: ${count} dividendo(s) o retención(es) no dicen de qué valor son y no se calculan: ${list}.`,
    hint: "La fila no trae ni el ticker ni el ISIN. Sin el valor, DeclaRenta no sabe de qué país viene el dividendo ni con qué retención va. Por eso no lo suma y no se inventa el valor. Si es un ingreso del año que declaras, corrige la fila en el archivo del broker y vuelve a subirlo. También puedes añadir el importe a mano en Renta Web.",
    context: { broker, count, rows: list },
  }];
}

/**
 * The warning naming every crypto income row (staking, rewards, learning
 * rewards) whose coin the file does not give: `rows` are "type amount date
 * [cell]" (#467). The coin sets the income's value and the cost of the coins
 * received, so the row is not booked under a guessed coin, and is never
 * dropped with no word: the user adds it by hand.
 */
export function cryptoIncomeUnidentifiedMessages(broker: string, rows: readonly string[]): TaxMessage[] {
  if (rows.length === 0) return [];
  const count = String(rows.length);
  const list = rows.join("; ");
  return [{
    id: "parser.crypto_income_unidentified",
    severity: "warning",
    message: `${broker}: ${count} ingreso(s) en criptomonedas no dicen qué criptomoneda recibiste y no se calculan: ${list}.`,
    hint: "Entre corchetes va la celda de la criptomoneda. Sin ella, DeclaRenta no sabe qué recibiste. Tampoco sabe qué coste darle cuando la vendas. Por eso no suma ese ingreso y no se inventa la criptomoneda. Si es un ingreso del año que declaras, tienes que declararlo igualmente. Corrige la fila en el archivo del exchange y vuelve a subirlo. También puedes añadir el ingreso a mano en Renta Web.",
    context: { broker, count, rows: list },
  }];
}

/**
 * The warning naming every crypto income row (staking, rewards, learning
 * rewards) whose amount the file does not let the parser read: `rows` are
 * "type coin date [cells]" (#467). Booked, it would be income of 0 (Coinbase's
 * empty Total) or stop the whole report (a Total of "abc"), so it is not
 * booked, and never dropped with no word: the user adds it by hand.
 */
export function cryptoIncomeAmountUnreadableMessages(broker: string, rows: readonly string[]): TaxMessage[] {
  if (rows.length === 0) return [];
  const count = String(rows.length);
  const list = rows.join("; ");
  return [{
    id: "parser.crypto_income_amount_unreadable",
    severity: "warning",
    message: `${broker}: ${count} ingreso(s) en criptomonedas no tienen un importe legible y no se calculan: ${list}.`,
    hint: "Entre corchetes va el importe tal como está en el archivo. Sin un importe, DeclaRenta no sabe cuánto recibiste. Por eso no suma ese ingreso y no lo cuenta como cero. Si es un ingreso del año que declaras, tienes que declararlo igualmente. Corrige la fila en el archivo del exchange y vuelve a subirlo. También puedes añadir el ingreso a mano en Renta Web.",
    context: { broker, count, rows: list },
  }];
}

/**
 * The warnings naming every trade whose quantity or price the file does not
 * give: one for shares and other securities, one for crypto (whose rule is
 * art. 33.5.e, with no one-purchase exception), or none; one naming every
 * trade row the file does not let the parser read (`unreadableRow`); and one
 * naming every corporate-action row the parser does not apply
 * (`corporateActionRow`). Shared by every parser (`broker` is the name shown
 * to the user), one translation key each.
 */
export function tradeQuantityUnknownMessages(broker: string, trades: readonly Trade[]): TaxMessage[] {
  const unreadable = trades.filter((t) => t.quantityUnknown && t.unreadableRow === undefined && t.corporateActionRow === undefined);
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
      hint: "Entre corchetes va la celda que falla. Falta, está vacía, no se puede leer o trae un tipo de operación que DeclaRenta no reconoce. DeclaRenta no suma ni resta acciones, unidades ni dinero por esas filas. Por eso las ganancias y pérdidas de esos valores no son fiables. Tampoco aplica la excepción de compra única de la regla de los 2 meses a ningún valor al que pueda pertenecer una de esas filas. Una fila puede ser la recompra de una criptomoneda en el año siguiente a una venta con pérdidas. Entonces esa pérdida puede tener que quedar pendiente (art. 33.5.e LIRPF). DeclaRenta no la bloquea. Si una fila es una compra o una venta real, corrige esa celda en el archivo del broker y vuelve a subirlo.",
      context: { broker, count, rows: list },
    });
  }
  const actions = trades.flatMap((t) => (t.corporateActionRow === undefined ? [] : [t.corporateActionRow]));
  if (actions.length > 0) {
    const count = String(actions.length);
    const list = actions.join("; ");
    messages.push({
      id: "parser.corporate_action_not_applied",
      severity: "warning",
      message: `${broker}: DeclaRenta no ha aplicado ${count} fila(s) de desdoblamiento, agrupación u otra operación societaria: ${list}.`,
      hint: "DeclaRenta no cambia por ellas el número de acciones ni el coste de esos valores. Por eso las ganancias y pérdidas de sus ventas posteriores pueden no ser correctas. Compruébalas con el extracto del broker. Tampoco aplica a esos valores la excepción de compra única de la regla de los 2 meses. Si una de esas filas te pagó dinero, como un vencimiento o un reembolso, esa venta no está en el informe. Añádela a mano en Renta Web.",
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

/**
 * Make every date cell of an XLSX sheet read "YYYY-MM-DD" (or
 * "YYYY-MM-DD HH:MM:SS" when it has a time) in `sheet_to_json` with
 * `raw: false`. A date cell is a number with a date format, and its text
 * follows the workbook's format: "1/10/24" for the default m/d/yy, a 2-digit
 * year with the day and the month in an order no parser can know. The parsers
 * turned it into a false or unreadable date (Revolut gave "11024"). The day
 * comes from the cell's serial number, so no time zone moves it. The workbook
 * must be read with `cellNF: true`, which gives each cell its format.
 * `date1904` is the workbook's date system (`wb.Workbook.WBProps.date1904`,
 * set by Excel for Mac and Numbers): the same serial number is then a day 4
 * years and 1 day later, so a workbook read without it moves every date.
 */
export function isoDateCells(xlsx: typeof import("xlsx"), sheet: import("xlsx").WorkSheet, date1904: boolean): void {
  // xlsx types SSF as `any`; these are the two calls it documents.
  const ssf = xlsx.SSF as {
    is_date(format: string): boolean;
    parse_date_code(serial: number, opts: { date1904: boolean }): { y: number; m: number; d: number; H: number; M: number; S: number } | null;
  };
  const pad = (n: number): string => String(n).padStart(2, "0");
  for (const [address, value] of Object.entries(sheet)) {
    if (address.startsWith("!")) continue;
    const cell = value as import("xlsx").CellObject;
    if (cell.t !== "n" || typeof cell.v !== "number" || typeof cell.z !== "string" || !ssf.is_date(cell.z)) continue;
    // A serial out of Excel's range (negative, past 9999) has no day: the
    // cell keeps its text and the row is named as one with no readable date.
    const p = ssf.parse_date_code(cell.v, { date1904 });
    if (p === null) continue;
    const day = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
    cell.w = p.H || p.M || p.S ? `${day} ${pad(p.H)}:${pad(p.M)}:${pad(Math.floor(p.S))}` : day;
  }
}

const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/;

/**
 * The order of the day and the month in the slash dates of one file
 * ("1/10/2024", "15/03/24"). A broker writes every date of a file in one
 * order, so one date whose second part is over 12 ("3/15/2024") shows that
 * the file is month first, and one whose first part is over 12 that it is day
 * first. With neither, it is day first, the Spanish order and the one eToro
 * and Lightyear write. A file with both is day first: its month-first dates
 * are then no real day and are named, never read as another day.
 */
export function slashDateOrder(texts: Iterable<string>): "DMY" | "MDY" {
  let dayFirst = false;
  let monthFirst = false;
  for (const text of texts) {
    const m = SLASH_DATE.exec(text.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirst = true;
    if (Number(m[2]) > 12) monthFirst = true;
  }
  return monthFirst && !dayFirst ? "MDY" : "DMY";
}

/**
 * A slash date ("1/10/2024", "01/10/2024 09:30", "1/10/24") as YYYYMMDD in
 * the file's order ({@link slashDateOrder}), or undefined when the text is no
 * slash date. The same day reads the same with or without a leading zero. A
 * 2-digit year is 20YY. The result is not checked: "31/02/2024" gives
 * "20240231", which the parsers then name as no readable day.
 */
export function convertSlashDate(text: string, order: "DMY" | "MDY"): string | undefined {
  const m = SLASH_DATE.exec(text.trim());
  if (!m) return undefined;
  const [day, month] = order === "DMY" ? [m[1]!, m[2]!] : [m[2]!, m[1]!];
  const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
  return `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`;
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
