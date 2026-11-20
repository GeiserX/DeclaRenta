/**
 * eToro XLSX parser.
 *
 * Parses eToro's account statement XLSX export into a normalized Statement.
 * The workbook contains multiple sheets:
 * - "Closed Positions": completed trades with P&L
 * - "Dividends": dividend payments with withholding tax
 * - "Account Activity": deposits, withdrawals, fees
 * - "Account Summary": overview
 * - "Financial Summary": annual summary
 *
 * eToro has evolved its column headers across 6+ versions since 2024.
 * The parser uses flexible column detection to handle all known layouts.
 *
 * Note: eToro input is text (CSV-like from xlsx) — the CLI reads the XLSX
 * binary and converts sheets to CSV before passing here. For direct XLSX
 * parsing, use the parseEtoroXlsx() function with the xlsx library.
 */

import Decimal from "decimal.js";
import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import type { TaxMessage } from "../types/tax.js";
import { plainOrExponent } from "../engine/amount-range.js";
import {
  findColumn,
  parseNumber,
  toFiniteDecimal,
  toFiniteDecimalString,
  quantityUnknownTrade,
  quantityUnreadable,
  tradeQuantityUnknownMessages,
  unreadableTrade,
  unreadableCell,
  markUndatedTrades,
  dropUndatedCash,
  cashIncomeRowText,
  cashIncomeAmountUnreadableMessages,
  isoDateCells,
  slashDateOrder,
  convertSlashDate,
} from "./csv-utils.js";

// We use dynamic import for xlsx to keep it optional
type WorkBook = import("xlsx").WorkBook;
type WorkSheet = import("xlsx").WorkSheet;

// ---------------------------------------------------------------------------
// Column detection patterns (handles 6+ eToro header versions)
// ---------------------------------------------------------------------------

const ACTION_HEADERS = ["action", "acción"];
const AMOUNT_HEADERS = ["amount", "importe", "invested"];
const UNITS_HEADERS = ["units", "units / contracts", "unidades"];
const OPEN_RATE_HEADERS = ["open rate", "tipo de apertura", "open price", "tasa de apertura"];
const CLOSE_RATE_HEADERS = ["close rate", "tipo de cierre", "close price", "tasa de cierre"];
const PROFIT_HEADERS = ["profit", "profit(usd)", "ganancia", "ganancias (usd)", "p/l"];
const PROFIT_EUR_HEADERS = ["profit(eur)", "ganancias (eur)"];
// Instrument currency → USD rate at open and at close (1 for USD-quoted instruments)
const FX_OPEN_HEADERS = ["fx rate at open (usd)", "tipo de cambio de apertura (usd)"];
const FX_CLOSE_HEADERS = ["fx rate at close (usd)", "tipo de cambio al cierre (usd)"];
const OPEN_DATE_HEADERS = ["open date", "fecha de apertura"];
const CLOSE_DATE_HEADERS = ["close date", "fecha de cierre"];
const TYPE_HEADERS = ["type", "tipo"];
const LEVERAGE_HEADERS = ["leverage", "apalancamiento"];
const ISIN_HEADERS = ["isin"];
const DIRECTION_HEADERS = ["long / short", "long/short"];
const POSITION_ID_HEADERS = ["position id", "id de posición"];

// Dividend sheet columns
const DIV_DATE_HEADERS = ["date of payment", "fecha de pago", "date"];
const DIV_INSTRUMENT_HEADERS = ["instrument name", "nombre del instrumento", "instrument"];
const DIV_NET_HEADERS = ["net dividend received (usd)", "dividendo neto recibido (usd)", "net dividend", "amount"];
const DIV_NET_EUR_HEADERS = ["net dividend received (eur)", "dividendo neto recibido (eur)"];
const DIV_WHT_AMOUNT_HEADERS = ["withholding tax amount (usd)", "importe de la retención tributaria (usd)"];
const DIV_WHT_RATE_HEADERS = ["withholding tax rate (%)", "tasa de retención fiscal (%)"];
const DIV_WHT_EUR_HEADERS = ["withholding tax amount (eur)", "importe de la retención tributaria (eur)"];
const DIV_ISIN_HEADERS = ["isin"];

// ---------------------------------------------------------------------------
// Sheet parsing utilities
// ---------------------------------------------------------------------------

/** The first sheet whose name contains one of `names`, with its name as the file writes it. */
function getSheet(wb: WorkBook, names: string[]): { name: string; sheet: WorkSheet } | undefined {
  for (const name of names) {
    const lower = name.toLowerCase();
    const found = wb.SheetNames.find((s) => s.toLowerCase().includes(lower));
    const sheet = found === undefined ? undefined : wb.Sheets[found];
    if (found !== undefined && sheet) return { name: found, sheet };
  }
  return undefined;
}

function sheetToRows(xlsx: typeof import("xlsx"), sheet: WorkSheet): string[][] {
  return xlsx.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
}

/**
 * Make every number cell whose shown text has a comma read as its value. The
 * rows are read as the text each cell shows (`raw: false`, so date cells read
 * as days), and a number formatted "#,##0" shows "3,000", which
 * {@link parseNumber} reads as 3: its lone comma is a decimal one in a European
 * file. A price, a unit count or a dividend of 1000 or more was booked 1000
 * times too small (#467). The cell holds the number itself (`v`), so its text
 * becomes that number. A cell whose text has no comma, a date and a percentage
 * keep their text.
 */
function plainNumberCells(xlsx: typeof import("xlsx"), sheet: WorkSheet): void {
  // xlsx types SSF as `any`; this is the call it documents.
  const ssf = xlsx.SSF as { is_date(format: string): boolean };
  for (const [address, value] of Object.entries(sheet)) {
    if (address.startsWith("!")) continue;
    const cell = value as import("xlsx").CellObject;
    if (cell.t !== "n" || typeof cell.v !== "number" || !Number.isFinite(cell.v)) continue;
    if (typeof cell.w !== "string" || !cell.w.includes(",") || cell.w.includes("%")) continue;
    if (typeof cell.z === "string" && ssf.is_date(cell.z)) continue;
    cell.w = new Decimal(cell.v).toFixed();
  }
}

/**
 * Whether a column the sheet needs is missing (`columns`: index and the name
 * shown to the user). eToro renames its columns between export versions; a
 * sheet whose rows hold data but whose needed columns are not found is named
 * by `etoro.columns_not_detected` (an error), never dropped with no word.
 */
function columnsNotDetected(parserMessages: TaxMessage[], sheet: string, rows: string[][], columns: [number, string][]): boolean {
  const missing = columns.filter(([col]) => col < 0).map(([, name]) => name);
  if (missing.length === 0) return false;
  if (rows.slice(1).some((row) => row.some((cell) => cell.trim() !== ""))) {
    const list = missing.join(", ");
    parserMessages.push({
      id: "etoro.columns_not_detected",
      severity: "error",
      message: `eToro: DeclaRenta no reconoce las columnas ${list} de la hoja «${sheet}». No ha importado ninguna fila de esa hoja.`,
      hint: "eToro cambia a veces los nombres de las columnas. Si DeclaRenta no las reconoce, no puede leer las filas de esa hoja y no suma ninguna. Vuelve a descargar el informe XLSX completo de la cuenta y súbelo otra vez. Si el aviso sigue, añade a mano en Renta Web las operaciones, los dividendos o los intereses de esa hoja.",
      context: { sheet, columns: list },
    });
  }
  return true;
}

/**
 * An eToro date as YYYYMMDD. eToro writes "DD/MM/YYYY HH:MM:SS"; a slash date
 * is read in the file's order (`order`, {@link slashDateOrder}: day first
 * unless the file shows month first), the same way with or without a leading
 * zero.
 */
function parseEtoroDate(dateStr: string, order: "DMY" | "MDY"): string {
  const trimmed = dateStr.trim();
  const slash = convertSlashDate(trimmed, order);
  if (slash !== undefined) return slash;
  // YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
  }
  return trimmed.replace(/[-/]/g, "").slice(0, 8);
}

function parseAction(action: string): { direction: "BUY" | "SELL"; symbol: string } | null {
  const trimmed = action.trim();
  // "Buy AAPL" or "Sell TSLA"
  const match = trimmed.match(/^(Buy|Sell|Comprar|Vender)\s+(.+)$/i);
  if (match) {
    const dir = match[1]!.toLowerCase().startsWith("buy") || match[1]!.toLowerCase().startsWith("comprar") ? "BUY" : "SELL";
    return { direction: dir, symbol: match[2]!.trim() };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Closed Positions parser
// ---------------------------------------------------------------------------

function parseClosedPositions(
  xlsx: typeof import("xlsx"),
  sheetName: string,
  sheet: WorkSheet,
  parserMessages: TaxMessage[],
): Trade[] {
  const rows = sheetToRows(xlsx, sheet);
  // Every date of a sheet is in one order; no other cell has a slash date.
  const order = slashDateOrder(rows.slice(1).flat());
  if (rows.length < 2) return [];

  const headers = rows[0]!;
  const actionCol = findColumn(headers, ACTION_HEADERS);
  const amountCol = findColumn(headers, AMOUNT_HEADERS);
  const unitsCol = findColumn(headers, UNITS_HEADERS);
  const openRateCol = findColumn(headers, OPEN_RATE_HEADERS);
  const closeRateCol = findColumn(headers, CLOSE_RATE_HEADERS);
  const profitCol = findColumn(headers, PROFIT_HEADERS);
  const profitEurCol = findColumn(headers, PROFIT_EUR_HEADERS);
  const fxOpenCol = findColumn(headers, FX_OPEN_HEADERS);
  const fxCloseCol = findColumn(headers, FX_CLOSE_HEADERS);
  const openDateCol = findColumn(headers, OPEN_DATE_HEADERS);
  const closeDateCol = findColumn(headers, CLOSE_DATE_HEADERS);
  const typeCol = findColumn(headers, TYPE_HEADERS);
  const leverageCol = findColumn(headers, LEVERAGE_HEADERS);
  const isinCol = findColumn(headers, ISIN_HEADERS);
  const directionCol = findColumn(headers, DIRECTION_HEADERS);
  const positionIdCol = findColumn(headers, POSITION_ID_HEADERS);

  // Column detection failed but the sheet HAS data rows → emit an error rather
  // than silently dropping every trade (eToro renamed/removed the columns).
  if (columnsNotDetected(parserMessages, sheetName, rows, [[actionCol, "Action"], [unitsCol, "Units"]])) return [];

  const trades: Trade[] = [];

  // Count DATA-BEARING rows that were dropped (units of a written zero) —
  // genuinely-empty rows are NOT counted.
  let skippedDataRows = 0;
  // Rows skipped because their Type is unsupported (e.g. crypto), per raw type.
  const skippedTypes = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (!row.length) continue;

    // Determine asset category from type and leverage
    const leverage = leverageCol >= 0 ? (row[leverageCol] ?? "").trim() : "1";
    // Accents stripped so the Spanish export's "Índices" matches like "Indices".
    const rowType = typeCol >= 0
      ? (row[typeCol] ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
      : "";

    // Crypto is checked first: labels like "Cryptocurrencies" or "Criptodivisas"
    // contain "currenc"/"divisa" and would otherwise be taken as currency CFDs.
    const isCryptoType = rowType.includes("crypt") || rowType.includes("cripto");

    // Commodities and currencies are always derivatives (CFD) on eToro.
    const isCfdType = !isCryptoType && (rowType.includes("cfd") || rowType.includes("commodit") ||
      rowType.includes("materia") || rowType.includes("currenc") || rowType.includes("divisa"));

    // Skip unknown/unsupported types (e.g. crypto on eToro is not supported),
    // counted per type so the user is told what was left out.
    if (rowType && !isCfdType && !rowType.includes("stock") && !rowType.includes("etf") &&
        !rowType.includes("accion") && !rowType.includes("index") && !rowType.includes("indice")) {
      const rawType = (row[typeCol] ?? "").trim();
      skippedTypes.set(rawType, (skippedTypes.get(rawType) ?? 0) + 1);
      continue;
    }

    // CFD: leverage > 1 OR a CFD type (explicit CFD, commodity, currency)
    // Strip non-numeric prefixes (e.g. "x5", "X10") before parsing
    const leverageNum = parseFloat(leverage.replace(/^[xX]/, ""));
    const isCfd = (!isNaN(leverageNum) && leverageNum > 1) || isCfdType;
    const assetCat = isCfd ? "CFD" as const : "STK" as const;

    // Two eToro formats:
    // English: "Action" = "Buy AAPL" (direction + symbol combined)
    // Spanish: "Acción" = instrument name, "Long / Short" = direction
    const actionStr = row[actionCol] ?? "";
    // An empty Action names no position only when the row has nothing else
    // either (no ISIN, units or dates): a totals or blank line, skipped. With
    // any of them it is a position whose name is missing, kept unreadable.
    const blankPosition = !actionStr.trim() &&
      [isinCol, unitsCol, openDateCol, closeDateCol].every((c) => c < 0 || !(row[c] ?? "").trim());
    if (blankPosition) continue;
    let symbol: string;
    let direction: "BUY" | "SELL" | undefined;
    // The cell that makes a closed position unreadable (#467, #468): kept as
    // its two legs, which book nothing, never dropped or read as a long one.
    let cell: string | undefined;

    if (directionCol >= 0) {
      // Spanish format: Acción = name, Long/Short = direction
      symbol = actionStr.trim();
      const dirStr = (row[directionCol] ?? "").toLowerCase().trim();
      // Recognized values: short → SELL; long/buy/real → BUY ("Real" is
      // eToro's unleveraged position, which is always long). Any other value,
      // an empty cell included, is unreadable: a short read as a long flips
      // its result's sign.
      if (dirStr === "short") direction = "SELL";
      else if (dirStr === "long" || dirStr === "buy" || dirStr === "real") direction = "BUY";
      else cell = unreadableCell(headers[directionCol] ?? "Long / Short", row[directionCol] ?? "");
      if (!symbol) cell = unreadableCell(headers[actionCol] ?? "Action", actionStr);
    } else {
      const parsed = parseAction(actionStr);
      if (parsed) {
        symbol = parsed.symbol;
        direction = parsed.direction;
      } else {
        symbol = actionStr.trim();
        cell = unreadableCell(headers[actionCol] ?? "Action", actionStr);
      }
    }
    const isin = isinCol >= 0 ? (row[isinCol] ?? "").trim() : "";
    const units = (row[unitsCol] ?? "0").trim();
    const amount = amountCol >= 0 ? (row[amountCol] ?? "0").trim() : "0";
    // Open/close rates are quoted in the instrument's currency: dollars,
    // euros, pence, Hong Kong dollars... eToro's FX rate columns (instrument →
    // USD) are 1 for a USD-quoted instrument. Any other rate says only that the
    // quote is not in dollars, never which currency it is in, so every leg is
    // booked in USD, the account's currency: rate × FX rate at open, and rate ×
    // FX rate at close (#467). Labelled EUR, a pence quote booked an 85-times
    // larger loss. A row is in dollars only when both FX rates are 1: a franc
    // or a euro at dollar parity on the open day has a rate of 1 at open, and
    // its close leg still needs the rate at close. Without an FX rate at close
    // column, a rate of 1 at open is a dollar row. Without any FX column the
    // legs are booked at their rates only when the row's Profit confirms that
    // they are dollars (below). An FX rate that cannot be read (blank, text,
    // zero or negative), and a non-USD row with no FX rate at close column,
    // makes the row unreadable below.
    const fxRate = (col: number): Decimal | undefined => {
      if (col < 0 || quantityUnreadable(row[col])) return undefined;
      const rate = toFiniteDecimal(row[col] ?? "");
      return rate.greaterThan(0) ? rate : undefined;
    };
    const fxOpen = fxOpenCol >= 0 ? fxRate(fxOpenCol) : new Decimal(1);
    const fxClose = fxOpenCol >= 0 && fxCloseCol >= 0 ? fxRate(fxCloseCol) : fxOpen?.eq(1) ? fxOpen : undefined;
    const currency = "USD";
    // The profit in dollars, the legs' currency.
    const profitRaw = profitCol >= 0 ? (row[profitCol] ?? "0").trim()
      : profitEurCol >= 0 ? (row[profitEurCol] ?? "0").trim() : "0";
    const profit = parseNumber(profitRaw);
    const openDate = openDateCol >= 0 ? parseEtoroDate(row[openDateCol] ?? "", order) : "";
    const closeDate = closeDateCol >= 0 ? parseEtoroDate(row[closeDateCol] ?? "", order) : "";

    const unitsNum = parseFloat(parseNumber(units));
    if (cell !== undefined || direction === undefined) {
      const leg = { symbol, isin, assetCategory: assetCat, currency, exchange: "ETORO" } as const;
      const legCell = cell ?? unreadableCell(headers[actionCol] ?? "Action", actionStr);
      trades.push(
        unreadableTrade({ ...leg, tradeID: `etoro-open-${openDate}-${symbol}-${i}`, tradeDate: openDate, ...(direction ? { buySell: direction } : {}) }, legCell),
        unreadableTrade({ ...leg, tradeID: `etoro-close-${closeDate}-${symbol}-${i}`, tradeDate: closeDate, ...(direction ? { buySell: direction === "SELL" ? "BUY" as const : "SELL" as const } : {}) }, legCell),
      );
      continue;
    }
    // Empty or unreadable units are no "0": keep both legs as trades of
    // unknown quantity for the anti-churning evidence (#453).
    if (quantityUnreadable(row[unitsCol])) {
      const leg = { symbol, isin, assetCategory: assetCat, currency, exchange: "ETORO" } as const;
      trades.push(
        quantityUnknownTrade({ ...leg, tradeID: `etoro-open-${openDate}-${symbol}-${i}`, tradeDate: openDate, buySell: direction === "SELL" ? "SELL" : "BUY" }),
        quantityUnknownTrade({ ...leg, tradeID: `etoro-close-${closeDate}-${symbol}-${i}`, tradeDate: closeDate, buySell: direction === "SELL" ? "BUY" : "SELL" }),
      );
      continue;
    }
    if (unitsNum === 0 || isNaN(unitsNum)) {
      // Symbol resolved (data-bearing row) but units are a written zero.
      skippedDataRows++;
      continue;
    }
    // FIFO values each leg at units × rate. A rate that cannot be read
    // (blank, only a currency sign, text, or no such column) is no price: as
    // "0" a sale became a full loss, as raw text it stopped the report. Both
    // legs are kept as unreadable rows, as is a row whose FX rate at open,
    // or at close for a non-USD instrument, cannot be read (#467).
    const unreadableRate = ([[openRateCol, "Open Rate"], [closeRateCol, "Close Rate"]] as const)
      .find(([col]) => quantityUnreadable(row[col]));
    // With no FX rate column the file does not say the rates are in dollars:
    // the older export writes a pence or Hong Kong dollar quote the same way
    // (#467). Barclays, 100 units from 180 to 170 pence, became a 1000 USD
    // loss for eToro's 12.70. The row's own Profit (USD) is in dollars: the
    // rates are dollars when units × (close − open), the other way round for
    // a short, matches it within 1 USD or 2%, which rounding never passes. A
    // row they do not match, or with no readable Profit, is kept unreadable.
    const profitCell = profitCol >= 0 ? row[profitCol] : undefined;
    const quoteConfirmed = (): boolean => {
      if (quantityUnreadable(profitCell)) return false;
      const move = toFiniteDecimal(row[closeRateCol] ?? "").minus(toFiniteDecimal(row[openRateCol] ?? ""));
      const expected = toFiniteDecimal(units).abs().mul(direction === "SELL" ? move.neg() : move);
      const stated = toFiniteDecimal(profitCell ?? "");
      const gap = expected.minus(stated).abs();
      return gap.lessThanOrEqualTo(1) || gap.lessThanOrEqualTo(Decimal.max(expected.abs(), stated.abs()).mul("0.02"));
    };
    const quoteUnconfirmed = unreadableRate === undefined && fxOpenCol < 0 && !quoteConfirmed();
    if (unreadableRate !== undefined || fxOpen === undefined || fxClose === undefined || quoteUnconfirmed) {
      let rateCell: string;
      if (quoteUnconfirmed) {
        rateCell = [unreadableCell(headers[openRateCol] ?? "Open Rate", row[openRateCol]), unreadableCell(headers[closeRateCol] ?? "Close Rate", row[closeRateCol]),
          unreadableCell(headers[profitCol] ?? "Profit(USD)", profitCell)].join(", ");
      } else {
        const [col, name] = unreadableRate ?? (fxOpen === undefined ? [fxOpenCol, "FX rate at open (USD)"] : [fxCloseCol, "FX rate at close (USD)"]);
        rateCell = unreadableCell(headers[col] ?? name, row[col]);
      }
      const leg = { symbol, isin, assetCategory: assetCat, currency, exchange: "ETORO" } as const;
      trades.push(
        unreadableTrade({ ...leg, tradeID: `etoro-open-${openDate}-${symbol}-${i}`, tradeDate: openDate, buySell: direction }, rateCell),
        unreadableTrade({ ...leg, tradeID: `etoro-close-${closeDate}-${symbol}-${i}`, tradeDate: closeDate, buySell: direction === "SELL" ? "BUY" : "SELL" }, rateCell),
      );
      continue;
    }
    // Readable rates, normalized ("1,234.56" and "1.234,56" are 1234.56), in
    // dollars at eToro's FX rates when the quote is not in dollars.
    const dollars = fxOpen.eq(1) && fxClose.eq(1);
    const openRate = dollars ? parseNumber(row[openRateCol] ?? "") : toFiniteDecimal(row[openRateCol] ?? "").mul(fxOpen).toString();
    const closeRate = dollars ? parseNumber(row[closeRateCol] ?? "") : toFiniteDecimal(row[closeRateCol] ?? "").mul(fxClose).toString();

    // eToro closed positions represent a round-trip: buy then sell
    // We create both the opening buy and the closing sell
    const absUnits = Math.abs(unitsNum);

    // Normalize the invested amount the SAME way on both legs (the SELL leg
    // parses it via Decimal too), so an EU-formatted amount can't yield a
    // different cost on the BUY leg than proceeds on the SELL leg.
    const buyMoney = toFiniteDecimal(amount).neg().toString();

    // A CFD is a contract of its own, never homogeneous with the shares of
    // its ISIN nor with another CFD (art. 37.2 LIRPF pools only homogeneous
    // shares). Under the share's ISIN, FIFO closed a 2025 share sale against a
    // CFD bought earlier and moved the gain into another year (#467). Its two
    // legs share a lot of their own, keyed by the Position ID (else by the
    // row), and its description keeps the ISIN for the user.
    const positionId = positionIdCol >= 0 ? (row[positionIdCol] ?? "").trim() : "";
    const lot = assetCat === "CFD"
      ? { description: isin ? `${symbol} (${isin})` : symbol, isin: "", conid: `etoro-${/^\d+$/.test(positionId) ? positionId : `${isin || symbol}-${openDate}-${i}`}` }
      : { description: symbol, isin };

    // Buy leg (opening)
    trades.push({
      tradeID: `etoro-open-${openDate}-${symbol}-${i}`,
      accountId: "",
      symbol,
      ...lot,
      assetCategory: assetCat,
      currency,
      tradeDate: openDate,
      settlementDate: openDate,
      quantity: `${absUnits}`,
      tradePrice: openRate,
      tradeMoney: buyMoney,
      proceeds: "0",
      cost: buyMoney,
      fifoPnlRealized: "0",
      fxRateToBase: "1",
      buySell: direction === "SELL" ? "SELL" : "BUY",
      openCloseIndicator: "O",
      exchange: "ETORO",
      commissionCurrency: currency,
      commission: "0",
      taxes: "0",
      multiplier: "1",
    });

    // Sell leg (closing)
    const amountDec = toFiniteDecimal(amount);
    const profitDec = toFiniteDecimal(profit);
    const proceeds = amountDec.plus(profitDec).toString();

    trades.push({
      tradeID: `etoro-close-${closeDate}-${symbol}-${i}`,
      accountId: "",
      symbol,
      ...lot,
      assetCategory: assetCat,
      currency,
      tradeDate: closeDate,
      settlementDate: closeDate,
      quantity: `-${absUnits}`,
      tradePrice: closeRate,
      tradeMoney: proceeds,
      proceeds,
      cost: "0",
      fifoPnlRealized: profit,
      fxRateToBase: "1",
      buySell: direction === "SELL" ? "BUY" : "SELL",
      openCloseIndicator: "C",
      exchange: "ETORO",
      commissionCurrency: currency,
      commission: "0",
      taxes: "0",
      multiplier: "1",
    });
  }

  if (skippedDataRows > 0) {
    parserMessages.push({
      id: "etoro.closed_rows_skipped",
      severity: "warning",
      message: `DeclaRenta ha omitido ${skippedDataRows} fila(s) de "Posiciones cerradas" de eToro con 0 unidades.`,
      hint: "Una posición de 0 unidades no compra ni vende nada. Si no es así, revisa la columna de unidades. Después vuelve a descargar el informe XLSX completo de la cuenta.",
      context: { count: String(skippedDataRows) },
    });
  }

  if (skippedTypes.size > 0) {
    const skippedTypeCount = [...skippedTypes.values()].reduce((a, b) => a + b, 0);
    const types = [...skippedTypes].map(([type, n]) => `${type} (${n})`).join(", ");
    parserMessages.push({
      id: "etoro.closed_types_skipped",
      severity: "warning",
      message: `Se ha(n) omitido ${skippedTypeCount} posición(es) cerrada(s) de eToro de un tipo no soportado: ${types}.`,
      hint: "DeclaRenta todavía no importa estos tipos de posición de eToro (p. ej. criptomonedas). Su ganancia o pérdida no está incluida en el cálculo: añádela a mano en tu declaración con el importe invertido y el beneficio que muestra eToro.",
      context: { count: String(skippedTypeCount), types },
    });
  }

  markUndatedTrades(trades, "Open Date / Close Date");
  parserMessages.push(...tradeQuantityUnknownMessages("eToro", trades));

  return trades;
}

// ---------------------------------------------------------------------------
// Dividends parser
// ---------------------------------------------------------------------------

function parseDividends(
  xlsx: typeof import("xlsx"),
  sheetName: string,
  sheet: WorkSheet,
  parserMessages: TaxMessage[],
  unreadableIncome: string[],
): CashTransaction[] {
  const rows = sheetToRows(xlsx, sheet);
  // Every date of a sheet is in one order; no other cell has a slash date.
  const order = slashDateOrder(rows.slice(1).flat());
  if (rows.length < 2) return [];

  const headers = rows[0]!;
  const dateCol = findColumn(headers, DIV_DATE_HEADERS);
  const instrumentCol = findColumn(headers, DIV_INSTRUMENT_HEADERS);
  const netCol = findColumn(headers, DIV_NET_HEADERS);
  const netEurCol = findColumn(headers, DIV_NET_EUR_HEADERS);
  const whtAmountCol = findColumn(headers, DIV_WHT_AMOUNT_HEADERS);
  const whtRateCol = findColumn(headers, DIV_WHT_RATE_HEADERS);
  const whtEurCol = findColumn(headers, DIV_WHT_EUR_HEADERS);
  const isinCol = findColumn(headers, DIV_ISIN_HEADERS);

  if (columnsNotDetected(parserMessages, sheetName, rows, [[dateCol, "Date of Payment"], [Math.max(netCol, netEurCol), "Net Dividend Received"]])) return [];

  // Prefer EUR columns if available (Spanish export provides both USD and EUR)
  const useEur = netEurCol >= 0;
  const effectiveNetCol = useEur ? netEurCol : netCol;
  // WHT: prefer absolute EUR amount → absolute USD amount → percentage rate
  const effectiveWhtCol = useEur ? whtEurCol : whtAmountCol;
  const currency = useEur ? "EUR" : "USD";

  const cashTransactions: CashTransaction[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (!row.length) continue;

    const dateStr = (row[dateCol] ?? "").trim();
    const instrument = instrumentCol >= 0 ? (row[instrumentCol] ?? "").trim() : "";
    const netAmount = (row[effectiveNetCol] ?? "0").trim();
    const isin = isinCol >= 0 ? (row[isinCol] ?? "").trim() : "";
    // A dividend with no readable date is booked with that date and taken out,
    // named with its amount, by dropUndatedCash (#467). A row with no date
    // that names no security, or only a totals label and no ISIN, is a totals
    // line and stays skipped. TotalEnergies is no totals line.
    if (!dateStr && (!(instrument || isin) || (!isin && /^total(es)?:?$/i.test(instrument)))) continue;
    const tradeDate = parseEtoroDate(dateStr, order);

    // A net amount that cannot be read (blank, only a currency sign, text) is
    // no zero: neither the dividend nor its withholding is booked, and the row
    // is named (#467). A written zero stays skipped.
    if (quantityUnreadable(row[effectiveNetCol])) {
      const whtCol = effectiveWhtCol >= 0 ? effectiveWhtCol : whtRateCol;
      const whtCell = whtCol >= 0 ? (row[whtCol] ?? "").trim() : "";
      const withheld = whtCell !== "" && !quantityUnreadable(whtCell.replace(/%/g, "")) && !toFiniteDecimal(whtCell.replace(/%/g, "")).isZero();
      const security = isin ? (instrument ? `${instrument} (${isin})` : isin) : instrument || "—";
      unreadableIncome.push(cashIncomeRowText("Dividends", security, currency, tradeDate,
        [unreadableCell(headers[effectiveNetCol] ?? "Net Dividend Received", row[effectiveNetCol])],
        withheld ? `${headers[whtCol] ?? "Withholding Tax"} ${whtCell}` : ""));
      continue;
    }
    const netNum = parseFloat(parseNumber(netAmount));
    if (isNaN(netNum) || netNum === 0) continue;
    // All money arithmetic below uses Decimal (never JS Number).
    const net = toFiniteDecimal(netAmount);

    // Compute gross dividend and withholding tax. With no withholding the
    // gross is the net, normalized ("1,234.56" is 1234.56): raw, a formatted
    // amount stopped the whole report.
    let grossAmount: string;
    let taxAmount = "0";

    if (effectiveWhtCol >= 0) {
      // Absolute WHT amount column available
      const whtRaw = (row[effectiveWhtCol] ?? "0").trim();
      const whtNum = parseFloat(parseNumber(whtRaw));

      if (!isNaN(whtNum) && whtNum !== 0) {
        const wht = toFiniteDecimal(whtRaw);
        grossAmount = plainOrExponent(net.plus(wht.abs()), 4);
        // A positive WHT column is tax withheld → emit as negative; a negative
        // value (refund/credit) is passed through unchanged. Decimal, never Number.
        taxAmount = whtNum > 0 ? wht.neg().toString() : wht.toString();
      } else {
        grossAmount = parseNumber(netAmount);
      }
    } else if (whtRateCol >= 0) {
      // Fall back to percentage rate column
      const pctRaw = (row[whtRateCol] ?? "0").replace(/%/g, "").trim();
      const pctNum = parseFloat(parseNumber(pctRaw));
      // Only a rate strictly between 0 and 100 grosses the net up. At 100 or
      // more, net ÷ (1 − rate) is infinite or negative (it crashed the
      // report), so the row is booked like an unreadable rate: at its net,
      // with no withholding, which can only raise the tax. The withholding is
      // the gross's rate, negated as a Decimal: a reversal's negative gross
      // gives a refund, never the text "--7.5000" that stopped the report.
      if (!isNaN(pctNum) && pctNum > 0 && pctNum < 100) {
        const pct = toFiniteDecimal(pctRaw);
        const gross = net.div(new Decimal(1).minus(pct.div(100)));
        grossAmount = plainOrExponent(gross, 4);
        taxAmount = plainOrExponent(gross.mul(pct.div(100)).neg(), 4);
      } else {
        grossAmount = parseNumber(netAmount);
      }
    } else {
      grossAmount = parseNumber(netAmount);
    }

    // Dividend (gross amount — downstream engine expects gross)
    const isinCountry = isin.length >= 2 ? isin.slice(0, 2).toUpperCase() : "";
    cashTransactions.push({
      transactionID: `etoro-div-${tradeDate}-${instrument}-${i}`,
      accountId: "",
      symbol: instrument,
      description: `${isinCountry} Dividend - ${instrument}`,
      isin,
      currency,
      dateTime: tradeDate,
      settleDate: tradeDate,
      amount: grossAmount,
      fxRateToBase: "1",
      type: "Dividends",
    });

    // Withholding tax
    if (taxAmount !== "0") {
      cashTransactions.push({
        transactionID: `etoro-wht-${tradeDate}-${instrument}-${i}`,
        accountId: "",
        symbol: instrument,
        description: `${isinCountry} WHT - ${instrument}`,
        isin,
        currency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: taxAmount,
        fxRateToBase: "1",
        type: "Withholding Tax",
      });
    }
  }

  return cashTransactions;
}

// ---------------------------------------------------------------------------
// Account Activity parser (interest income)
// ---------------------------------------------------------------------------

const ACTIVITY_DATE_HEADERS = ["date", "fecha"];
const ACTIVITY_TYPE_HEADERS = ["type", "tipo"];
const ACTIVITY_AMOUNT_HEADERS = ["amount", "importe"];
const ACTIVITY_DETAILS_HEADERS = ["details", "detalles"];

function parseAccountActivity(
  xlsx: typeof import("xlsx"),
  sheetName: string,
  sheet: WorkSheet,
  parserMessages: TaxMessage[],
  unreadableIncome: string[],
): CashTransaction[] {
  const rows = sheetToRows(xlsx, sheet);
  // Every date of a sheet is in one order; no other cell has a slash date.
  const order = slashDateOrder(rows.slice(1).flat());
  if (rows.length < 2) return [];

  const headers = rows[0]!;
  const dateCol = findColumn(headers, ACTIVITY_DATE_HEADERS);
  const typeCol = findColumn(headers, ACTIVITY_TYPE_HEADERS);
  const amountCol = findColumn(headers, ACTIVITY_AMOUNT_HEADERS);
  const detailsCol = findColumn(headers, ACTIVITY_DETAILS_HEADERS);

  if (columnsNotDetected(parserMessages, sheetName, rows, [[dateCol, "Date"], [typeCol, "Type"], [amountCol, "Amount"]])) return [];

  const cashTransactions: CashTransaction[] = [];
  // Staking rewards, "type details amount date" (#467).
  const staking: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (!row.length) continue;

    const typeStr = (row[typeCol] ?? "").toLowerCase().trim();
    // A staking reward is crypto income DeclaRenta does not import from eToro
    // (closed crypto positions are skipped too). It is named for the user to
    // add by hand, never dropped with no word, and its value is not guessed.
    if (typeStr.includes("staking")) {
      const cell = (c: number): string => (c >= 0 ? (row[c] ?? "").trim() : "");
      staking.push([(row[typeCol] ?? "").trim(), cell(detailsCol), cell(amountCol) || "—",
        parseEtoroDate(cell(dateCol), order) || "—"].filter((part) => part !== "").join(" "));
      continue;
    }
    // Otherwise only interest payments are read.
    if (!typeStr.includes("interest") && !typeStr.includes("intereses")) continue;

    // An interest row with no readable date is booked with that date and
    // taken out, named with its amount, by dropUndatedCash (#467).
    const dateStr = (row[dateCol] ?? "").trim();
    const tradeDate = parseEtoroDate(dateStr, order);
    const amountStr = (row[amountCol] ?? "0").trim();
    // An Amount that cannot be read is no zero: the row is named, not
    // dropped (#467). A written zero stays skipped.
    if (quantityUnreadable(row[amountCol])) {
      unreadableIncome.push(cashIncomeRowText((row[typeCol] ?? "").trim(), "", "USD", tradeDate,
        [unreadableCell(headers[amountCol] ?? "Amount", row[amountCol])]));
      continue;
    }
    const amountNum = parseFloat(parseNumber(amountStr));
    if (isNaN(amountNum) || amountNum === 0) continue;
    // Emit a finiteness-guarded decimal string (never a raw JS Number).
    const amount = toFiniteDecimalString(amountStr);

    cashTransactions.push({
      transactionID: `etoro-interest-${tradeDate}-${i}`,
      accountId: "",
      symbol: "CASH",
      description: "Interest Payment",
      isin: "",
      currency: "USD", // eToro pays interest in USD regardless of interface language
      dateTime: tradeDate,
      settleDate: tradeDate,
      amount,
      fxRateToBase: "1",
      type: "Broker Interest Received",
    });
  }

  if (staking.length > 0) {
    const count = String(staking.length);
    const list = staking.join("; ");
    parserMessages.push({
      id: "etoro.staking_not_imported",
      severity: "warning",
      message: `eToro: ${count} recompensa(s) de staking no se calculan: ${list}.`,
      hint: "DeclaRenta todavía no importa las criptomonedas de eToro. Por eso no suma estas recompensas. Si son ingresos del año que declaras, tienes que declararlos igualmente. Añade a mano en Renta Web su valor en euros del día en que las recibiste. Ese valor es también su coste cuando las vendas.",
      context: { count, rows: list },
    });
  }

  return cashTransactions;
}

// ---------------------------------------------------------------------------
// XLSX detection and parsing
// ---------------------------------------------------------------------------

/**
 * Parse eToro XLSX workbook using the xlsx library.
 * This is the main entry point for XLSX binary data.
 */
export async function parseEtoroXlsx(data: Buffer | Uint8Array): Promise<Statement> {
  const xlsx = await import("xlsx");
  const wb = xlsx.read(data, { type: "buffer", cellNF: true });
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    isoDateCells(xlsx, sheet, wb.Workbook?.WBProps?.date1904 === true);
    plainNumberCells(xlsx, sheet);
  }

  const closedSheet = getSheet(wb, ["closed positions", "posiciones cerradas"]);
  const dividendSheet = getSheet(wb, ["dividends", "dividendos"]);
  const activitySheet = getSheet(wb, ["account activity", "actividad de la cuenta"]);

  const parserMessages: TaxMessage[] = [];
  // Dividend and interest rows whose amount cannot be read (#467).
  const unreadableIncome: string[] = [];
  const trades = closedSheet ? parseClosedPositions(xlsx, closedSheet.name, closedSheet.sheet, parserMessages) : [];
  const dividends = dividendSheet ? parseDividends(xlsx, dividendSheet.name, dividendSheet.sheet, parserMessages, unreadableIncome) : [];
  const interest = activitySheet ? parseAccountActivity(xlsx, activitySheet.name, activitySheet.sheet, parserMessages, unreadableIncome) : [];
  const cashTransactions = [...dividends, ...interest];
  parserMessages.push(...dropUndatedCash("eToro", cashTransactions));
  parserMessages.push(...cashIncomeAmountUnreadableMessages("eToro", unreadableIncome));

  return {
    accountId: "",
    fromDate: "",
    toDate: "",
    period: "",
    trades,
    cashTransactions,
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
    ...(parserMessages.length > 0 ? { parserMessages } : {}),
  };
}

/**
 * Check if a Buffer/Uint8Array is likely an eToro XLSX file.
 * Reads only sheet names via xlsx (async — works in both Node and browser).
 */
export async function detectEtoroXlsx(data: Buffer | Uint8Array): Promise<boolean> {
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4B) return false;

  try {
    const xlsx = await import("xlsx");
    const wb = xlsx.read(data, { type: "buffer", bookSheets: true });
    const names = wb.SheetNames.map((s) => s.toLowerCase());
    return names.some((n) => n.includes("closed position") || n.includes("posiciones cerradas"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Text-based BrokerParser (for CSV export or pre-converted data)
// ---------------------------------------------------------------------------

/**
 * eToro CSV-text parser.
 * For direct XLSX parsing, use parseEtoroXlsx() with binary data.
 * This text parser handles pre-converted CSV data or the rare CSV export.
 */
export const etoroParser: BrokerParser = {
  name: "eToro",
  formats: ["XLSX", "CSV"],

  detect(input: string): boolean {
    const lower = input.toLowerCase();
    // Check for eToro-specific patterns in text representation
    return (
      (lower.includes("closed position") || lower.includes("posiciones cerradas")) &&
      (lower.includes("open rate") || lower.includes("tipo de apertura") || lower.includes("action"))
    );
  },

  parse(input: string): Statement {
    if (!input.trim()) {
      throw new Error("eToro: fichero vacío o sin datos");
    }

    // The text/CSV path never extracted any trades or cash transactions — it only
    // detected section/column markers and returned an empty Statement, so a CSV
    // upload "succeeded" with total data loss. eToro's real export is an XLSX
    // workbook parsed by parseEtoroXlsx(); refuse text/CSV explicitly rather than
    // silently dropping every row.
    throw new Error("eToro: usa el export XLSX, no CSV/texto");
  },
};
