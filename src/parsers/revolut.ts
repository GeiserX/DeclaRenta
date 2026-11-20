/**
 * Revolut XLSX parser.
 *
 * Supports two Revolut Trading Account Statement formats:
 *
 * Format A — Closed-positions summary:
 *   Date acquired | Date sold | Symbol | Quantity | Cost basis | Gross proceeds |
 *   Gross PnL | Fees | Net PnL | Currency
 *   Each row = one round-trip → parser creates BUY + SELL legs.
 *
 * Format B — Transaction log (what users actually get from the Revolut app):
 *   Date | Ticker | Type | Quantity | Price per share | Total Amount | Currency | FX Rate
 *   Each row = one event (BUY, SELL, CASH TOP-UP, CASH WITHDRAWAL, REWARD,
 *   DIVIDEND, STOCK SPLIT). Parser creates individual trades, extracts cash
 *   transactions and dividends, turns splits into FS/RS corporate actions, and
 *   infers open positions from unmatched buys.
 *
 * Revolut only offers XLSX or PDF exports (no CSV).
 *
 * Limitations:
 * - No ISIN codes in either format — cross-broker FIFO matching uses symbol fallback.
 * - Format B dividends are net of withholding, with no separate withholding row:
 *   the gross amount and the tax withheld come from Revolut's annual tax report.
 *   Format A has no dividends at all.
 * - FX rates in format B are EUR/FCY. The parser stores fxRateToBase="1" and lets
 *   the FIFO engine fetch official ECB rates independently.
 */

import Decimal from "decimal.js";
import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, CashTransaction, CorporateAction, OpenPosition, AssetCategory } from "../types/ibkr.js";
import type { TaxMessage } from "../types/tax.js";
import {
  findColumn,
  parseNumber,
  toFiniteDecimal,
  toFiniteDecimalString,
  quantityUnknownTrade,
  tradeQuantityUnknownMessages,
  unreadableTrade,
  unreadableCell,
  isReadableTradeDate,
  markUndatedTrades,
  dropUndatedCash,
  cashRowsUnidentifiedMessages,
  cashIncomeRowText,
  cashIncomeAmountUnreadableMessages,
  corporateActionTrade,
  isCorporateActionType,
  isoDateCells,
  slashDateOrder,
  convertSlashDate,
} from "./csv-utils.js";
import { KNOWN_CRYPTO_SYMBOLS } from "./crypto-symbols.js";
import { plainOrExponent } from "../engine/amount-range.js";

type WorkSheet = import("xlsx").WorkSheet;

// ---------------------------------------------------------------------------
// Column header patterns (English; Revolut exports English headers regardless
// of locale — the "es-es" filename suffix is just the UI language)
// ---------------------------------------------------------------------------

const DATE_ACQUIRED_HEADERS = ["date acquired", "fecha de adquisición", "fecha adquisición"];
const DATE_SOLD_HEADERS = ["date sold", "fecha de venta", "fecha venta"];
const SYMBOL_HEADERS = ["symbol", "símbolo", "ticker"];
const QUANTITY_HEADERS = ["quantity", "cantidad"];
const COST_BASIS_HEADERS = ["cost basis", "base de coste", "coste"];
const GROSS_PROCEEDS_HEADERS = ["gross proceeds", "ingresos brutos"];
const GROSS_PNL_HEADERS = ["gross pnl", "pnl bruto"];
const FEES_HEADERS = ["fees", "comisiones", "tasas"];
const CURRENCY_HEADERS = ["currency", "divisa", "moneda"];

// ---------------------------------------------------------------------------
// Transaction-log format column headers (the format users actually get from
// the Revolut app's Trading Account Statement export)
// ---------------------------------------------------------------------------

const TXN_DATE_HEADERS = ["date", "fecha"];
const TXN_TICKER_HEADERS = ["ticker"];
const TXN_TYPE_HEADERS = ["type", "tipo"];
const TXN_QUANTITY_HEADERS = ["quantity", "cantidad"];
const TXN_PRICE_HEADERS = ["price per share", "precio por acción", "precio por accion"];
const TXN_TOTAL_HEADERS = ["total amount", "importe total", "cantidad total"];
const TXN_CURRENCY_HEADERS = ["currency", "divisa", "moneda"];
const TXN_FX_RATE_HEADERS = ["fx rate", "tipo de cambio", "tasa de cambio"];

// A buy or a sale of any order kind Revolut writes: market, limit, stop and
// stop limit. The order kind changes how it was placed, not what was traded.
const TXN_TYPE_BUY = /^BUY\s*-\s*(MARKET|LIMIT|STOP(\s*-?\s*LIMIT)?)$/i;
const TXN_TYPE_SELL = /^SELL\s*-\s*(MARKET|LIMIT|STOP(\s*-?\s*LIMIT)?)$/i;
const TXN_TYPE_CASH_IN = /^CASH\s*TOP[- ]?UP$/i;
const TXN_TYPE_CASH_OUT = /^CASH\s*WITHDRAWAL$/i;
const TXN_TYPE_DIVIDEND = /^DIVIDEND$/i;
// A withholding correction on a dividend ("DIVIDEND TAX (CORRECTION)"), with a
// ticker, no quantity and a signed amount, often in +/- pairs. No trade: the
// withholding comes from Revolut's annual tax report (revolut.dividends_net).
const TXN_TYPE_DIVIDEND_TAX = /^DIVIDEND\s+TAX\b/i;
// A buy or sale of any order kind, also one not listed above ("BUY - TRAILING
// STOP"), for a row with no ticker.
const TXN_TYPE_ANY_TRADE = /^(BUY|SELL)\b/i;
const TXN_TYPE_SPLIT = /^STOCK\s*SPLIT$/i;
// One row per ticker when Revolut moved accounts between its own entities
// (e.g. to Revolut Securities Europe UAB): same holding, nothing to apply.
const TXN_TYPE_ENTITY_TRANSFER = /^TRANSFER\s+FROM\s+REVOLUT\b.*\bTO\s+REVOLUT\b/i;

// ---------------------------------------------------------------------------
// Crypto detection — Revolut mixes stocks and crypto in the same sheet.
// Uses KNOWN_CRYPTO_SYMBOLS (auto-generated from CoinGecko top 500 by market
// cap, refreshed via `npx tsx scripts/update-crypto-symbols.ts`).
// Stock ticker conflicts (A, B, T, etc.) are excluded at generation time.
// ---------------------------------------------------------------------------

function detectAssetCategory(symbol: string): AssetCategory {
  const upper = symbol.toUpperCase();
  if (KNOWN_CRYPTO_SYMBOLS.has(upper)) return "CRYPTO";
  return "STK";
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * A Revolut date as YYYYMMDD. Revolut writes ISO dates; a slash date comes
 * from a file re-saved as text ("15/01/2020", "1/5/2020"), read in the
 * file's order (`order`, {@link slashDateOrder}: day first unless the file
 * shows month first), the same way with or without a leading zero.
 */
export function parseRevolutDate(dateStr: string, order: "DMY" | "MDY" = "DMY"): string {
  const trimmed = dateStr.trim();
  // ISO 8601 timestamp: 2025-10-20T06:00:02.425Z or 2025-10-19T00:02:32.169239Z
  const isoTsMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoTsMatch) return `${isoTsMatch[1]}${isoTsMatch[2]}${isoTsMatch[3]}`;
  // YYYY-MM-DD (primary Revolut closed-positions format)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
  const slash = convertSlashDate(trimmed, order);
  if (slash !== undefined) return slash;
  return trimmed.replace(/[-/]/g, "").slice(0, 8);
}

/** The order of the slash dates in the given columns of a sheet's rows. */
function dateOrderOf(rows: string[][], columns: number[]): "DMY" | "MDY" {
  return slashDateOrder(rows.slice(1).flatMap((row) => columns.map((c) => row[c] ?? "")));
}

// ---------------------------------------------------------------------------
// Sheet utilities
// ---------------------------------------------------------------------------

function sheetToRows(xlsx: typeof import("xlsx"), sheet: WorkSheet): string[][] {
  return xlsx.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
}

/**
 * A column of a Revolut sheet, found the same way for the detection and the
 * lookup: by an exact name, else, for a `loose` column, by a header that
 * contains a name ("Price per share (USD)", "Gross proceeds (USD)"). The
 * detection accepted such a header and the lookup did not, so every trade was
 * priced 0, or the file gave an empty statement with no word (#467).
 */
function revolutColumn(headers: string[], names: string[], loose = false): number {
  const exact = findColumn(headers, names);
  if (exact >= 0 || !loose) return exact;
  return looseColumns(headers, names)[0] ?? -1;
}

/** Every header that contains one of the names. */
function looseColumns(headers: string[], names: string[]): number[] {
  return headers.flatMap((h, i) => (names.some((n) => h.toLowerCase().trim().includes(n)) ? [i] : []));
}

/**
 * A money column found by {@link revolutColumn}, and the currency its header
 * names ("Gross proceeds (EUR)"), "" when it names none. The loose lookup read
 * such a column in the row's Currency, so EUR figures were booked as USD, and
 * with two such columns it took the first, with no word (#467). The header's
 * currency is checked against the Currency cell like the one written in front
 * of an amount, and two columns that both match are refused, naming them: the
 * parser cannot tell which one to read.
 */
function moneyColumn(headers: string[], names: string[]): { col: number; currency: string } {
  const exact = findColumn(headers, names);
  if (exact >= 0) return { col: exact, currency: "" };
  const loose = looseColumns(headers, names);
  if (loose.length > 1) {
    throw new Error(`Revolut XLSX: varias columnas para un mismo dato (${loose.map((c) => headers[c]!.trim()).join(", ")})`);
  }
  const col = loose[0] ?? -1;
  return { col, currency: (headers[col] ?? "").match(/\(\s*([A-Za-z]{3})\s*\)/)?.[1]?.toUpperCase() ?? "" };
}

/**
 * Refuse a sheet the detection took for Revolut that lacks a column the
 * parser needs, naming it, as the other parsers do: an empty statement would
 * drop the whole file with no word next to another broker's file.
 */
function requireColumns(columns: Record<string, number>): void {
  const missing = Object.entries(columns).filter(([, c]) => c < 0).map(([name]) => name);
  if (missing.length > 0) throw new Error(`Revolut XLSX: faltan columnas obligatorias (${missing.join(", ")})`);
}

// ---------------------------------------------------------------------------
// Trade parser
// ---------------------------------------------------------------------------

function parseTrades(
  xlsx: typeof import("xlsx"),
  sheet: WorkSheet,
): { trades: Trade[]; parserMessages: TaxMessage[] } {
  const rows = sheetToRows(xlsx, sheet);
  if (rows.length < 2) return { trades: [], parserMessages: [] };

  const headers = rows[0]!;
  const dateAcqCol = revolutColumn(headers, DATE_ACQUIRED_HEADERS, true);
  const dateSoldCol = findColumn(headers, DATE_SOLD_HEADERS);
  const symbolCol = findColumn(headers, SYMBOL_HEADERS);
  const quantityCol = findColumn(headers, QUANTITY_HEADERS);
  const costBasisColumn = moneyColumn(headers, COST_BASIS_HEADERS);
  const grossProceedsColumn = moneyColumn(headers, GROSS_PROCEEDS_HEADERS);
  const costBasisCol = costBasisColumn.col;
  const grossProceedsCol = grossProceedsColumn.col;
  const grossPnlCol = findColumn(headers, GROSS_PNL_HEADERS);
  const feesCol = findColumn(headers, FEES_HEADERS);
  const currencyCol = findColumn(headers, CURRENCY_HEADERS);

  requireColumns({
    "Date acquired": dateAcqCol, "Date sold": dateSoldCol, Symbol: symbolCol, Quantity: quantityCol,
    "Cost basis": costBasisCol, "Gross proceeds": grossProceedsCol, Currency: currencyCol,
  });

  const order = dateOrderOf(rows, [dateAcqCol, dateSoldCol]);
  const trades: Trade[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (!row.length || row.every((c) => !c.trim())) continue;

    const symbol = (row[symbolCol] ?? "").trim();
    const dateAcquired = parseRevolutDate(row[dateAcqCol] ?? "", order);
    const dateSold = parseRevolutDate(row[dateSoldCol] ?? "", order);
    if (!symbol) {
      // A closed position with no symbol is still a purchase and a sale of
      // some shares: keep both legs, which book nothing, so the one-purchase
      // evidence (#453) cannot be proven with them missing (#467). A row with
      // no readable date either is a totals line only when a cell says
      // "Total" or it has no quantity; one with a quantity is kept, its
      // dates named too (it was dropped with no word).
      const undated = !isReadableTradeDate(dateAcquired) && !isReadableTradeDate(dateSold);
      if (undated && (row.some((c) => /^total(es)?:?$/i.test(c.trim())) || !(row[quantityCol] ?? "").trim())) continue;
      const leg = { symbol: "", isin: "", assetCategory: "STK", currency: (row[currencyCol] ?? "").trim(), exchange: "REVOLUT" } as const;
      const cell = unreadableCell(headers[symbolCol] ?? "Symbol", "");
      const withDate = (col: number, date: string): string =>
        isReadableTradeDate(date) ? cell : `${cell}, ${unreadableCell(headers[col] ?? "Date", row[col] ?? "")}`;
      trades.push(
        unreadableTrade({ ...leg, tradeID: `revolut-open-${dateAcquired}--${i}`, tradeDate: dateAcquired, buySell: "BUY" }, withDate(dateAcqCol, dateAcquired)),
        unreadableTrade({ ...leg, tradeID: `revolut-close-${dateSold}--${i}`, tradeDate: dateSold, buySell: "SELL" }, withDate(dateSoldCol, dateSold)),
      );
      continue;
    }

    const quantity = (row[quantityCol] ?? "0").trim();
    const costBasis = costBasisCol >= 0 ? (row[costBasisCol] ?? "0").trim() : "0";
    const grossProceeds = grossProceedsCol >= 0 ? (row[grossProceedsCol] ?? "0").trim() : "0";
    const grossPnl = grossPnlCol >= 0 ? (row[grossPnlCol] ?? "0").trim() : "0";
    const fees = feesCol >= 0 ? (row[feesCol] ?? "0").trim() : "0";
    // The currency written in front of Cost basis, Gross proceeds or Fees
    // ("USD 1000", "$1000"), or named by its header ("Cost basis (USD)"),
    // fills an empty Currency cell, as in the transaction log.
    const prefixed = ([[costBasisCol, "Cost basis", costBasisColumn.currency], [grossProceedsCol, "Gross proceeds", grossProceedsColumn.currency],
      [feesCol, "Fees", ""]] as const)
      .filter(([col]) => col >= 0)
      .flatMap(([col, name, header]) => [readRevolutNumber(row[col]).currency, header].map((prefix) => ({ col, name, prefix })));
    const currencyCell = (row[currencyCol] ?? "USD").trim();
    const currency = currencyCell || (prefixed.find((p) => p.prefix !== "")?.prefix ?? "");

    // All money/quantity parsing routes through readRevolutNumber, so a
    // garbled cell can never yield NaN/Infinity (which would poison cost
    // basis) and "1,500" is 1500. The emitted strings are decimal.js
    // .toString()/.toFixed(), losslessly parsed.
    const qtyRead = readRevolutNumber(quantity).amount;
    const absQty = (qtyRead ?? new Decimal(0)).abs();
    if (absQty.isZero()) {
      // An empty or unreadable quantity is no "0": keep both legs as trades of
      // unknown quantity for the anti-churning evidence (#453), as eToro does.
      // They move no share and no money. A written 0 is still skipped.
      if (qtyRead === undefined) {
        const leg = { symbol, isin: "", assetCategory: detectAssetCategory(symbol), currency, exchange: "REVOLUT" } as const;
        trades.push(
          quantityUnknownTrade({ ...leg, tradeID: `revolut-open-${dateAcquired}-${symbol}-${i}`, tradeDate: dateAcquired, buySell: "BUY" }),
          quantityUnknownTrade({ ...leg, tradeID: `revolut-close-${dateSold}-${symbol}-${i}`, tradeDate: dateSold, buySell: "SELL" }),
        );
      }
      continue;
    }

    const assetCategory = detectAssetCategory(symbol);
    // Gross proceeds with no number (blank, "$", text) were read as 0, so the
    // sale became a full loss with no word (#467). Both legs are kept as
    // unreadable rows named by that cell: they book nothing, and the
    // purchase is no lot left open. A written 0 stays the file's word.
    const keepUnreadable = (cell: string): void => {
      const leg = { symbol, isin: "", assetCategory, currency, exchange: "REVOLUT" } as const;
      trades.push(
        unreadableTrade({ ...leg, tradeID: `revolut-open-${dateAcquired}-${symbol}-${i}`, tradeDate: dateAcquired, buySell: "BUY" }, cell),
        unreadableTrade({ ...leg, tradeID: `revolut-close-${dateSold}-${symbol}-${i}`, tradeDate: dateSold, buySell: "SELL" }, cell),
      );
    };
    const proceedsCell = row[grossProceedsCol];
    if (readRevolutNumber(proceedsCell).amount === undefined) {
      keepUnreadable(unreadableCell(headers[grossProceedsCol] ?? "Gross proceeds", proceedsCell));
      continue;
    }
    // An amount written in another currency than the Currency cell was read
    // in the Currency cell's currency: proceeds of "EUR 900" against a cost
    // of "USD 1000" with Currency USD were booked as 900 USD, so a loss of
    // about 11 € became one of 112 € with no word (#467). Both legs are kept
    // as unreadable rows named by the Currency cell and each cell that
    // disagrees, as the transaction log does: they book nothing.
    const mismatch = [...new Set(prefixed.filter((p) => p.prefix !== "" && p.prefix !== currency).map((p) => p.col))]
      .map((col) => unreadableCell(headers[col] ?? prefixed.find((p) => p.col === col)!.name, row[col]));
    if (mismatch.length > 0) {
      keepUnreadable([unreadableCell(headers[currencyCol] ?? "Currency", currencyCell), ...mismatch].join(", "));
      continue;
    }
    // Use absolute values to avoid double-negative if input is already negative
    const absCost = (readRevolutNumber(costBasis).amount ?? new Decimal(0)).abs();
    const absProceeds = (readRevolutNumber(grossProceeds).amount ?? new Decimal(0)).abs();
    const pnl = readRevolutNumber(grossPnl).amount ?? new Decimal(0);
    const absFees = (readRevolutNumber(fees).amount ?? new Decimal(0)).abs();

    // Revolut reports per-trade cost/proceeds, compute price per unit
    const buyPrice = absQty.greaterThan(0) ? plainOrExponent(absCost.div(absQty), 8) : "0";
    const sellPrice = absQty.greaterThan(0) ? plainOrExponent(absProceeds.div(absQty), 8) : "0";

    // Assign full fee to SELL leg (consistent with eToro and IBKR patterns)
    const feeStr = plainOrExponent(absFees, 2);

    // BUY leg (opening)
    trades.push({
      tradeID: `revolut-open-${dateAcquired}-${symbol}-${i}`,
      accountId: "",
      symbol,
      description: symbol,
      isin: "",
      assetCategory,
      currency,
      tradeDate: dateAcquired,
      settlementDate: dateAcquired,
      quantity: absQty.toString(),
      tradePrice: buyPrice,
      tradeMoney: `-${absCost.toString()}`,
      proceeds: "0",
      cost: `-${absCost.toString()}`,
      fifoPnlRealized: "0",
      fxRateToBase: "1",
      buySell: "BUY",
      openCloseIndicator: "O",
      exchange: "REVOLUT",
      commissionCurrency: currency,
      commission: "0",
      taxes: "0",
      multiplier: "1",
    });

    // SELL leg (closing)
    trades.push({
      tradeID: `revolut-close-${dateSold}-${symbol}-${i}`,
      accountId: "",
      symbol,
      description: symbol,
      isin: "",
      assetCategory,
      currency,
      tradeDate: dateSold,
      settlementDate: dateSold,
      quantity: `-${absQty.toString()}`,
      tradePrice: sellPrice,
      tradeMoney: absProceeds.toString(),
      proceeds: absProceeds.toString(),
      cost: "0",
      fifoPnlRealized: pnl.toString(),
      fxRateToBase: "1",
      buySell: "SELL",
      openCloseIndicator: "C",
      exchange: "REVOLUT",
      commissionCurrency: currency,
      commission: `-${feeStr}`,
      taxes: "0",
      multiplier: "1",
    });
  }

  // Every money/quantity cell is finiteness-guarded via readRevolutNumber; the
  // only messages name the trades of unknown quantity and the unreadable rows.
  markUndatedTrades(trades, "Date acquired / Date sold");
  return { trades, parserMessages: tradeQuantityUnknownMessages("Revolut", trades) };
}

// ---------------------------------------------------------------------------
// Transaction-log amount parser
// ---------------------------------------------------------------------------

// The currency a symbol written in a Revolut amount names.
const CURRENCY_SYMBOLS: Record<string, string> = { "€": "EUR", "$": "USD", "£": "GBP", "¥": "JPY" };

// A number with commas between groups of three digits: "1,500", "1,234,567.5".
const US_THOUSANDS = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;

/**
 * A Revolut number cell: an amount with its currency in front ("EUR 15.61",
 * "USD -217.14"), a quantity or a closed-positions amount ("10", "1,500").
 * Revolut writes English US numbers and drops trailing zeros, so a comma
 * between groups of three digits is a thousands separator: "USD 1,500" is
 * 1500, never 1.5 (#467). Any other comma is read by {@link parseNumber}
 * ("EUR 15,61" is 15.61). `amount` is undefined when the cell has no number:
 * blank, only a currency ("USD", "$"), text or not finite. A written zero is
 * a number.
 */
function readRevolutNumber(raw: string | undefined): { currency: string; amount: Decimal | undefined } {
  const trimmed = (raw ?? "").trim();
  const match = trimmed.match(/^([A-Z]{3})(?:\s+(.*))?$/);
  const rest = match ? match[2] ?? "" : trimmed;
  // A currency symbol ("€110", "1500 €") names the currency when no code is
  // written: it was stripped and the amount booked in the Currency cell's
  // currency, so "€110" with Currency GBP was a 93.50 € dividend (#467). Two
  // different symbols name no currency, so the cell has no number.
  const symbols = [...new Set(rest.match(/[€$£¥]/g) ?? [])];
  if (symbols.length > 1) return { currency: "", amount: undefined };
  const currency = match ? match[1]! : symbols[0] === undefined ? "" : CURRENCY_SYMBOLS[symbols[0]]!;
  const text = rest.replace(/[€$£¥]/g, "").trim();
  if (!text) return { currency, amount: undefined };
  const value = toFiniteDecimalString(US_THOUSANDS.test(text) ? text.replace(/,/g, "") : parseNumber(text), "", false);
  return { currency, amount: value === "" ? undefined : new Decimal(value) };
}

// ---------------------------------------------------------------------------
// Transaction-log parser (the format users actually get from the Revolut app)
// ---------------------------------------------------------------------------

interface TxnLogColumns {
  date: number;
  ticker: number;
  type: number;
  quantity: number;
  price: number;
  total: number;
  currency: number;
  fxRate: number;
  /** The currency the Price per share and Total Amount headers name, or "" ({@link moneyColumn}). */
  priceCurrency: string;
  totalCurrency: string;
}

function findTxnLogColumns(headers: string[]): TxnLogColumns {
  const date = findColumn(headers, TXN_DATE_HEADERS);
  const ticker = findColumn(headers, TXN_TICKER_HEADERS);
  const type = findColumn(headers, TXN_TYPE_HEADERS);
  const quantity = findColumn(headers, TXN_QUANTITY_HEADERS);
  const { col: price, currency: priceCurrency } = moneyColumn(headers, TXN_PRICE_HEADERS);
  const { col: total, currency: totalCurrency } = moneyColumn(headers, TXN_TOTAL_HEADERS);
  const currency = findColumn(headers, TXN_CURRENCY_HEADERS);
  const fxRate = findColumn(headers, TXN_FX_RATE_HEADERS);

  // A missing Price per share is priced from Total Amount ÷ Quantity, and a
  // missing Quantity makes rows of unknown size: both are named row by row.
  requireColumns({ Date: date, Type: type, "Total Amount": total, Currency: currency });
  return { date, ticker, type, quantity, price, total, currency, fxRate, priceCurrency, totalCurrency };
}

function parseTransactionLog(
  xlsx: typeof import("xlsx"),
  sheet: WorkSheet,
): {
  trades: Trade[]; cashTransactions: CashTransaction[]; corporateActions: CorporateAction[];
  openPositions: OpenPosition[]; parserMessages: TaxMessage[];
} {
  const empty = { trades: [], cashTransactions: [], corporateActions: [], openPositions: [], parserMessages: [] };
  const rows = sheetToRows(xlsx, sheet);
  if (rows.length < 2) return empty;

  const headers = rows[0]!;
  const cols = findTxnLogColumns(headers);

  const order = dateOrderOf(rows, [cols.date]);
  const trades: Trade[] = [];
  const cashTransactions: CashTransaction[] = [];
  const corporateActions: CorporateAction[] = [];
  // Cash rows whose FX rate cell was present but not a finite positive number,
  // by date and amount: the conversion would be wrong, so they are skipped and
  // named (never default to 1). Only cash rows read the cell (#466).
  const badFxRateRows: string[] = [];
  // DIVIDEND rows imported at the net amount Revolut reports.
  let netDividends = 0;
  // DIVIDEND TAX (CORRECTION) rows, not booked: ticker, date and amount.
  const dividendTaxRows: string[] = [];
  // DIVIDEND rows with no ticker: type, amount and date (#467).
  const unidentifiedCash: string[] = [];
  // DIVIDEND rows whose Total Amount has no number (#467).
  const amountUnreadable: string[] = [];

  // Track net positions per symbol for open-position inference
  const positions = new Map<string, {
    symbol: string; currency: string; assetCategory: AssetCategory;
    netQty: Decimal; totalCost: Decimal;
  }>();
  // Tickers with a row the file does not let the parser size (an unreadable
  // quantity, date or type): their holding is of unknown size. The first such
  // row of each ticker, and whether one of them is a buy (then the ticker is
  // held even with nothing readable left).
  const unknownSize = new Map<string, { currency: string; assetCategory: AssetCategory; buy: boolean }>();
  const markUnknownSize = (symbol: string, currency: string, buy: boolean): void => {
    const known = unknownSize.get(symbol);
    if (known) known.buy ||= buy;
    else unknownSize.set(symbol, { currency, assetCategory: detectAssetCategory(symbol), buy });
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (!row.length || row.every((c) => !c.trim())) continue;

    const dateStr = (row[cols.date] ?? "").trim();
    const tradeDate = parseRevolutDate(dateStr, order);

    const type = (row[cols.type] ?? "").trim();
    const ticker = (row[cols.ticker] ?? "").trim();
    const currencyCell = (row[cols.currency] ?? "").trim();

    const totalRaw = (row[cols.total] ?? "").trim();
    // Money goes through readRevolutNumber, so a garbled cell can never yield
    // NaN/Infinity (which would poison cost basis), mirroring the parseTrades
    // path. totalRead is undefined when the cell has no number.
    const { currency: totalCurrency, amount: totalRead } = readRevolutNumber(totalRaw);
    const totalAmountDec = totalRead ?? new Decimal(0);
    // The currency written in front of the Total Amount or the Price per
    // share fills an empty Currency cell. One that disagrees with the
    // Currency cell was ignored, so "EUR 1500" with Currency USD was booked
    // as 1500 USD with no word (#467): a buy, a sale or a dividend with such
    // a cell is not booked and is named with the cells below.
    // So does the currency a header names ("Total Amount (EUR)").
    const priceCurrency = readRevolutNumber(row[cols.price]).currency;
    const currency = currencyCell || totalCurrency || priceCurrency || cols.totalCurrency || cols.priceCurrency;
    const currencyMismatch = ([[cols.price, [priceCurrency, cols.priceCurrency], "Price per share"],
      [cols.total, [totalCurrency, cols.totalCurrency], "Total Amount"]] as const)
      .filter(([, prefixes]) => prefixes.some((prefix) => prefix !== "" && prefix !== currency))
      .map(([col, , name]) => unreadableCell(headers[col] ?? name, row[col]));
    if (currencyMismatch.length > 0) currencyMismatch.unshift(unreadableCell(headers[cols.currency] ?? "Currency", currencyCell));

    // Cash flows: CASH TOP-UP, CASH WITHDRAWAL
    if (TXN_TYPE_CASH_IN.test(type) || TXN_TYPE_CASH_OUT.test(type)) {
      // A cash row with no readable date is booked with that date and taken
      // out, named with its amount, by dropUndatedCash below (#467).
      // FX rate validation, for the only rows that read the cell: it defaults
      // to "1" only when ABSENT (missing column or empty cell), a legitimate
      // case (EUR rows, no FX column). A cell that IS present and parses to a
      // non-finite or non-positive value would silently corrupt the
      // conversion (and divide by zero), so the row is skipped and named. A
      // trade, dividend or split row never reads it: it stores fxRateToBase
      // "1" and the engine takes the ECB rate, so a bad cell there must not
      // drop it (#466: the sale or the dividend vanished).
      const fxRateRaw = cols.fxRate >= 0 ? (row[cols.fxRate] ?? "").trim() : "";
      let fxRate = 1;
      if (fxRateRaw) {
        const fxRateDec = toFiniteDecimal(fxRateRaw);
        if (!fxRateDec.isFinite() || fxRateDec.lessThanOrEqualTo(0)) {
          badFxRateRows.push(`${tradeDate} ${totalRaw} [${unreadableCell(headers[cols.fxRate] ?? "FX Rate", fxRateRaw)}]`);
          continue;
        }
        fxRate = fxRateDec.toNumber();
      }
      cashTransactions.push({
        transactionID: `revolut-cash-${tradeDate}-${i}`,
        accountId: "",
        symbol: "",
        description: type,
        isin: "",
        currency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: totalAmountDec.toString(),
        fxRateToBase: currency === "EUR" ? "1" : new Decimal(1).div(fxRate).toString(),
        type: "Deposits/Withdrawals",
      });
      continue;
    }

    // A buy or a sale with no ticker is still a trade of some security: kept
    // as a trade that books nothing and names no security, so the
    // one-purchase evidence (#453) cannot be proven with it missing (#467),
    // as the closed-positions format keeps a row with no symbol.
    if (!ticker && TXN_TYPE_ANY_TRADE.test(type)) {
      trades.push(unreadableTrade({
        tradeID: `revolut-row-${tradeDate}--${i}`, symbol: "", isin: "", assetCategory: "STK", currency,
        tradeDate, exchange: "REVOLUT", buySell: /^SELL/i.test(type) ? "SELL" : "BUY",
      }, unreadableCell(headers[cols.ticker] ?? "Ticker", "")));
      continue;
    }
    // A withholding correction is no trade and is not booked (the dividends
    // are net, the withholding comes from the annual tax report), but it is
    // named, so the user knows where it went.
    if (TXN_TYPE_DIVIDEND_TAX.test(type)) {
      dividendTaxRows.push(`${ticker || "—"} ${isReadableTradeDate(tradeDate) ? tradeDate : dateStr || "—"} ${totalRaw || "—"}`);
      continue;
    }
    // A dividend whose Total Amount has no number (blank, currency only,
    // text) is no 0: it is not booked and is named, so the user adds it by
    // hand (#467). Booked, it was income of 0; it was dropped with no word.
    // So is one written in another currency than its Currency cell. A
    // written zero stays the file's word and is skipped.
    if (TXN_TYPE_DIVIDEND.test(type) && (totalRead === undefined || currencyMismatch.length > 0)) {
      const cells = currencyMismatch.length > 0 ? currencyMismatch : [unreadableCell(headers[cols.total] ?? "Total Amount", totalRaw)];
      if (!ticker) cells.unshift(unreadableCell(headers[cols.ticker] ?? "Ticker", ""));
      amountUnreadable.push(cashIncomeRowText(type, ticker, currency, isReadableTradeDate(tradeDate) ? tradeDate : dateStr, cells));
      continue;
    }
    // A dividend with no ticker names no security: named, never dropped with
    // no word (#467).
    if (!ticker && TXN_TYPE_DIVIDEND.test(type)) {
      if (!totalAmountDec.isZero()) unidentifiedCash.push(`${type} ${totalRaw} ${isReadableTradeDate(tradeDate) ? tradeDate : dateStr || "—"}`);
      continue;
    }
    // A split, merger, spin-off or other corporate action with no ticker
    // still moves shares of some security, and a cash merger pays for them:
    // it was dropped with no word, so a split's sale kept its pre-split cost
    // (a 275 € gain became a 275 € loss) and a cash merger's money was lost
    // (#467). It names no security, so it is kept as a corporate action not
    // applied, as Freedom24 does, and makes no holding of unknown size. One
    // that moves no shares and no money stays skipped, as with a ticker.
    if (!ticker && (TXN_TYPE_SPLIT.test(type) || isCorporateActionType(type))) {
      const qtyRead = readRevolutNumber(row[cols.quantity]).amount;
      const noMoney = totalRaw === "" || totalRead?.isZero() === true;
      if (!TXN_TYPE_SPLIT.test(type) && qtyRead?.isZero() === true && noMoney) continue;
      trades.push(corporateActionTrade({
        tradeID: `revolut-action-${tradeDate}--${i}`, symbol: "", isin: "", assetCategory: "STK", currency,
        tradeDate: isReadableTradeDate(tradeDate) ? tradeDate : dateStr, exchange: "REVOLUT",
      }, type, (row[cols.quantity] ?? "").trim().replace(/^[A-Z]{3}\s+/, "")));
      continue;
    }
    // Skip other rows without a ticker (e.g. REWARD, CUSTODY FEE): no trade.
    if (!ticker) continue;

    const quantityStr = (row[cols.quantity] ?? "0").trim();
    const priceStr = (row[cols.price] ?? "").trim();

    const qtyRead = readRevolutNumber(quantityStr).amount;
    const signedQtyDec = qtyRead ?? new Decimal(0);
    const qtyDec = signedQtyDec.abs();

    // A ticker row that is a buy, a sale or of a type no branch handles (a
    // spin-off, a stock merger, a stop order) but cannot be read is kept as a
    // trade that books nothing, never dropped or booked as a buy (#467,
    // #468). A row of an unknown type that writes a zero quantity moves no
    // shares and stays skipped when it moves no money either (a blank or
    // written-zero Total Amount), or is a fee ("CUSTODY FEE"). One with an
    // amount (a cash merger, cash in lieu) may be a taxable sale, so it is
    // kept and named like the others, also when that amount cannot be read
    // ("USD abc", "USD"): it was read as 0 and dropped with no word.
    const buy = TXN_TYPE_BUY.test(type);
    const sell = TXN_TYPE_SELL.test(type);
    const otherType = !buy && !sell && !TXN_TYPE_DIVIDEND.test(type) && !TXN_TYPE_SPLIT.test(type) &&
      !TXN_TYPE_ENTITY_TRANSFER.test(type);
    // The Quantity cell as the file writes it, with no "CCY " prefix, and
    // whether it has no number (blank, currency-only, text): unreadable.
    const quantityCell = (row[cols.quantity] ?? "").trim().replace(/^[A-Z]{3}\s+/, "");
    const quantityMissing = readRevolutNumber(row[cols.quantity]).amount === undefined;
    const keepUnreadable = (cell: string): void => {
      trades.push(unreadableTrade({
        tradeID: `revolut-row-${tradeDate}-${ticker}-${i}`,
        symbol: ticker, isin: "", assetCategory: detectAssetCategory(ticker), currency, tradeDate,
        exchange: "REVOLUT", ...(buy || sell ? { buySell: sell ? "SELL" as const : "BUY" as const } : {}),
      }, cell));
      markUnknownSize(ticker, currency, buy);
    };
    const movesNoMoney = totalRaw === "" || totalRead?.isZero() === true;
    if (otherType && !quantityMissing && qtyDec.isZero() &&
      (movesNoMoney || /\bFEES?$/i.test(type))) continue;
    if ((buy || sell || otherType) && !isReadableTradeDate(tradeDate)) {
      keepUnreadable(unreadableCell(headers[cols.date] ?? "Date", dateStr));
      continue;
    }
    if (otherType) {
      keepUnreadable(unreadableCell(headers[cols.type] ?? "Type", type));
      continue;
    }
    // A split row with no readable date cannot be applied at its day, and
    // one whose Quantity is 0, empty or not a number does not say how many
    // shares it added: either is kept as a row that books nothing, named as
    // not applied, and its holding is of unknown size (#467), never applied
    // on a false day or with a false size, and never only counted. So is a
    // split whose Total Amount is neither blank nor a written zero: it paid
    // cash (for a fractional share), and applied with that cash dropped, a
    // 550 € gain became a 275 € loss with no word (#467). The hint of
    // `parser.corporate_action_not_applied` asks for that payout by hand. A
    // dividend with no readable date is booked with that date and taken out,
    // named with its amount, by dropUndatedCash below (#467).
    if (TXN_TYPE_SPLIT.test(type) && (!isReadableTradeDate(tradeDate) || signedQtyDec.isZero() || !movesNoMoney)) {
      trades.push(corporateActionTrade({
        tradeID: `revolut-split-${tradeDate}-${ticker}-${i}`, symbol: ticker, isin: "",
        assetCategory: detectAssetCategory(ticker), currency,
        tradeDate: isReadableTradeDate(tradeDate) ? tradeDate : dateStr, exchange: "REVOLUT",
      }, type, quantityCell));
      markUnknownSize(ticker, currency, false);
      continue;
    }
    if (!dateStr && !TXN_TYPE_DIVIDEND.test(type)) continue;

    // DIVIDEND: Quantity is empty and the amount is net of withholding.
    if (TXN_TYPE_DIVIDEND.test(type)) {
      if (!totalAmountDec.isZero()) {
        cashTransactions.push({
          transactionID: `revolut-div-${tradeDate}-${ticker}-${i}`,
          accountId: "",
          symbol: ticker,
          description: `Dividend - ${ticker}`,
          isin: "",
          currency,
          dateTime: tradeDate,
          settleDate: tradeDate,
          amount: totalAmountDec.toString(),
          fxRateToBase: "1",
          type: "Dividends",
        });
        netDividends++;
      }
      continue;
    }

    // STOCK SPLIT: Quantity is the number of shares added (negative for a
    // reverse split) and the amount is zero (blank or a written zero). The ratio depends on the whole
    // holding, which can span several yearly files, so the parser does not size
    // it: the FIFO engine does, from the lots it holds at the split date, and
    // rescales them keeping their cost (Art. 37.1.a LIRPF: not a disposal).
    if (TXN_TYPE_SPLIT.test(type)) {
      corporateActions.push({
        transactionID: `revolut-split-${tradeDate}-${ticker}-${i}`,
        accountId: "",
        symbol: ticker,
        description: `${ticker} STOCK SPLIT ${signedQtyDec.toString()} SHARES`,
        isin: "",
        currency,
        reportDate: tradeDate,
        dateTime: tradeDate,
        quantity: signedQtyDec.toString(),
        amount: "0",
        type: signedQtyDec.greaterThan(0) ? "FS" : "RS",
        actionDescription: type,
      });
      const pos = positions.get(ticker);
      if (pos) pos.netQty = Decimal.max(0, pos.netQty.plus(signedQtyDec));
      continue;
    }

    if (TXN_TYPE_ENTITY_TRANSFER.test(type)) continue;

    if (qtyDec.isZero()) {
      // An empty or unreadable quantity is no "0": keep the row as a trade of
      // unknown quantity for the anti-churning evidence (#453). It moves no
      // share and no money, and no holding is built from it (the ticker's
      // inferred holding is then of unknown size, below).
      if (quantityMissing) {
        trades.push(quantityUnknownTrade({
          tradeID: `revolut-${buy ? "buy" : "sell"}-${tradeDate}-${ticker}-${i}`,
          symbol: ticker, isin: "", assetCategory: detectAssetCategory(ticker), currency, tradeDate,
          buySell: buy ? "BUY" : "SELL", exchange: "REVOLUT",
        }));
        markUnknownSize(ticker, currency, buy);
      }
      continue;
    }

    // FIFO values a buy or sale at quantity × tradePrice, never from Total
    // Amount. A Price per share with no number ("USD abc", "", "USD",
    // "-USD 150", "USD 1 500.00"), or one that is zero or negative, sold the
    // shares at 0: a gain became a full loss with no word (#467). Revolut
    // writes Total Amount = quantity × price in the row's currency, so with
    // no price the price is |Total Amount| ÷ quantity, the file's own
    // numbers. With no readable non-zero Total either, a written zero price
    // moves shares for no money: a corporate action not applied, as in
    // Lightyear, Flatex, DEGIRO and Freedom24. Any other price makes the row
    // one that books nothing, named by its Price per share cell. Either way
    // the ticker's holding is of unknown size.
    if (currencyMismatch.length > 0) {
      keepUnreadable(currencyMismatch.join(", "));
      continue;
    }
    const priceRead = readRevolutNumber(row[cols.price]).amount;
    let pricePerShareDec = priceRead ?? new Decimal(0);
    if (!pricePerShareDec.greaterThan(0)) {
      if (totalRead !== undefined && !totalRead.isZero()) {
        pricePerShareDec = totalRead.abs().div(qtyDec);
      } else if (priceRead?.isZero() === true) {
        trades.push(corporateActionTrade({
          tradeID: `revolut-action-${tradeDate}-${ticker}-${i}`, symbol: ticker, isin: "",
          assetCategory: detectAssetCategory(ticker), currency, tradeDate, exchange: "REVOLUT",
          buySell: buy ? "BUY" : "SELL",
        }, `${headers[cols.price] ?? "Price per share"} ${priceStr}`, quantityCell));
        markUnknownSize(ticker, currency, buy);
        continue;
      } else {
        keepUnreadable(unreadableCell(headers[cols.price] ?? "Price per share", row[cols.price]));
        continue;
      }
    }

    const assetCategory = detectAssetCategory(ticker);
    const absTotalAmount = totalAmountDec.abs();
    const qtyStr = qtyDec.toString();
    const pricePerShareStr = pricePerShareDec.toString();
    const absTotalAmountStr = absTotalAmount.toString();

    if (TXN_TYPE_BUY.test(type)) {
      trades.push({
        tradeID: `revolut-buy-${tradeDate}-${ticker}-${i}`,
        accountId: "",
        symbol: ticker,
        description: ticker,
        isin: "",
        assetCategory,
        currency,
        tradeDate,
        settlementDate: tradeDate,
        quantity: qtyStr,
        tradePrice: pricePerShareStr,
        tradeMoney: `-${absTotalAmountStr}`,
        proceeds: "0",
        cost: `-${absTotalAmountStr}`,
        fifoPnlRealized: "0",
        fxRateToBase: "1",
        buySell: "BUY",
        openCloseIndicator: "O",
        exchange: "REVOLUT",
        commissionCurrency: currency,
        commission: "0",
        taxes: "0",
        multiplier: "1",
      });

      const pos = positions.get(ticker) ?? {
        symbol: ticker, currency, assetCategory,
        netQty: new Decimal(0), totalCost: new Decimal(0),
      };
      pos.netQty = pos.netQty.plus(qtyDec);
      pos.totalCost = pos.totalCost.plus(absTotalAmount);
      positions.set(ticker, pos);
    } else {
      trades.push({
        tradeID: `revolut-sell-${tradeDate}-${ticker}-${i}`,
        accountId: "",
        symbol: ticker,
        description: ticker,
        isin: "",
        assetCategory,
        currency,
        tradeDate,
        settlementDate: tradeDate,
        quantity: `-${qtyStr}`,
        tradePrice: pricePerShareStr,
        tradeMoney: absTotalAmountStr,
        proceeds: absTotalAmountStr,
        cost: "0",
        fifoPnlRealized: "0",
        fxRateToBase: "1",
        buySell: "SELL",
        openCloseIndicator: "C",
        exchange: "REVOLUT",
        commissionCurrency: currency,
        commission: "0",
        taxes: "0",
        multiplier: "1",
      });

      const pos = positions.get(ticker);
      if (pos && pos.netQty.greaterThan(0)) {
        const sellQty = Decimal.min(qtyDec, pos.netQty);
        const costPerUnit = pos.totalCost.div(pos.netQty);
        pos.totalCost = pos.totalCost.minus(costPerUnit.times(sellQty));
        pos.netQty = pos.netQty.minus(sellQty);
      }
    }
  }

  // A ticker with a row whose size the file does not give has a holding of
  // unknown size: the trades cannot say it. Its inferred row keeps the
  // readable trades' part as its quantity, so the Modelo 720/721 still count
  // it as a holding with no value to fill in by hand, and is flagged
  // `quantityUnknown` (never complete evidence); a purchase of unknown size
  // with nothing readable left still makes one, of quantity "0".
  // revolut.holding_size_unknown names every such ticker.
  // Build open positions from symbols with remaining shares
  const openPositions: OpenPosition[] = [];
  for (const pos of Array.from(positions.values())) {
    if (pos.netQty.greaterThan(0.00000001)) {
      const costPerUnit = pos.netQty.greaterThan(0) ? pos.totalCost.div(pos.netQty) : new Decimal(0);
      const unknown = unknownSize.has(pos.symbol);
      openPositions.push({
        accountId: "",
        symbol: pos.symbol,
        description: pos.symbol,
        isin: "",
        currency: pos.currency,
        assetCategory: pos.assetCategory,
        quantity: pos.netQty.toString(),
        costBasisMoney: unknown ? "0" : plainOrExponent(pos.totalCost, 2),
        costBasisPrice: unknown ? "0" : plainOrExponent(costPerUnit, 8),
        markPrice: "0",
        positionValue: "0",
        fifoPnlUnrealized: "0",
        fromTrades: true,
        fxRateToBase: "1",
        ...(unknown ? { quantityUnknown: true } : {}),
      });
    }
  }
  for (const [symbol, t] of unknownSize) {
    if (!t.buy || openPositions.some((p) => p.symbol === symbol)) continue;
    openPositions.push({
      accountId: "",
      symbol,
      description: symbol,
      isin: "",
      currency: t.currency,
      assetCategory: t.assetCategory,
      quantity: "0",
      costBasisMoney: "0",
      costBasisPrice: "0",
      markPrice: "0",
      positionValue: "0",
      fifoPnlUnrealized: "0",
      fromTrades: true,
      fxRateToBase: "1",
      quantityUnknown: true,
    });
  }

  const parserMessages: TaxMessage[] = [];
  const unknownHoldings = openPositions.filter((p) => p.quantityUnknown === true).map((p) => p.symbol);
  if (unknownHoldings.length > 0) {
    const count = String(unknownHoldings.length);
    const tickers = unknownHoldings.join(", ");
    parserMessages.push({
      id: "revolut.holding_size_unknown",
      severity: "warning" as const,
      message: `El extracto de Revolut no permite saber cuántas acciones o unidades tienes al final de ${count} valor(es): ${tickers}.`,
      hint: "Una fila de cada uno no se puede leer o no dice cuántas acciones o unidades mueve (otro aviso la nombra). DeclaRenta muestra solo la parte que sí se puede leer, que puede ser 0. Para los modelos 720 y 721, toma el número y el valor de esas posiciones del extracto de Revolut y añádelos a mano.",
      context: { count, tickers },
    });
  }
  if (badFxRateRows.length > 0) {
    const count = String(badFxRateRows.length);
    const rows = badFxRateRows.join("; ");
    parserMessages.push({
      id: "revolut.bad_fx_rate",
      severity: "warning" as const,
      message: `DeclaRenta ha omitido ${count} ingreso(s) o retirada(s) de efectivo del extracto de Revolut porque su tipo de cambio (FX Rate) no es válido: ${rows}.`,
      hint: "Solo los ingresos y las retiradas de efectivo usan esa columna. DeclaRenta calcula las compras, las ventas y los dividendos con el tipo del BCE y no los omite. La causa suele ser una celda de tipo de cambio que no es un número, es negativa o vale cero. Vuelve a descargar el Trading Account Statement completo desde la app de Revolut y súbelo de nuevo.",
      context: { count, rows },
    });
  }
  if (dividendTaxRows.length > 0) {
    const count = String(dividendTaxRows.length);
    const rows = dividendTaxRows.join("; ");
    parserMessages.push({
      id: "revolut.dividend_tax_correction",
      severity: "info" as const,
      message: `El extracto de Revolut trae ${count} corrección(es) de la retención de un dividendo (DIVIDEND TAX (CORRECTION)) que DeclaRenta no suma: ${rows}.`,
      hint: "Con estas filas Revolut corrige la retención de un dividendo ya cobrado. DeclaRenta importa los dividendos de Revolut por su importe neto. No lee la retención de este extracto, y tampoco su corrección. Toma el dividendo bruto y la retención final, ya corregida, del informe fiscal anual de Revolut.",
      context: { count, rows },
    });
  }
  if (netDividends > 0) {
    parserMessages.push({
      id: "revolut.dividends_net",
      severity: "info" as const,
      message: `Se ${netDividends === 1 ? "ha importado 1 dividendo" : `han importado ${netDividends} dividendos`} de Revolut por su importe neto, con la retención en origen ya descontada.`,
      hint: "El extracto de operaciones de Revolut no separa la retención. Para declarar el dividendo bruto (casilla 0029) y deducir la doble imposición internacional (casilla 0588), toma el importe bruto y la retención del informe fiscal anual de Revolut.",
      context: { count: String(netDividends) },
    });
  }

  markUndatedTrades(trades, headers[cols.date] ?? "Date");
  parserMessages.push(
    ...tradeQuantityUnknownMessages("Revolut", trades),
    ...dropUndatedCash("Revolut", cashTransactions, headers[cols.date] ?? "Date"),
    ...cashRowsUnidentifiedMessages("Revolut", unidentifiedCash),
    ...cashIncomeAmountUnreadableMessages("Revolut", amountUnreadable),
  );
  return { trades, cashTransactions, corporateActions, openPositions, parserMessages };
}

// ---------------------------------------------------------------------------
// Transaction-log detection
// ---------------------------------------------------------------------------

// The detection matches each column as the lookup does (revolutColumn).
function hasTxnLogHeaders(headers: string[]): boolean {
  return revolutColumn(headers, TXN_DATE_HEADERS) >= 0 && revolutColumn(headers, TXN_TICKER_HEADERS) >= 0 &&
    revolutColumn(headers, TXN_TYPE_HEADERS) >= 0 && revolutColumn(headers, TXN_TOTAL_HEADERS, true) >= 0 &&
    revolutColumn(headers, TXN_PRICE_HEADERS, true) >= 0;
}

function hasClosedPositionHeaders(headers: string[]): boolean {
  return revolutColumn(headers, DATE_ACQUIRED_HEADERS, true) >= 0 &&
    revolutColumn(headers, [...COST_BASIS_HEADERS, ...GROSS_PROCEEDS_HEADERS], true) >= 0;
}

// ---------------------------------------------------------------------------
// XLSX detection and parsing
// ---------------------------------------------------------------------------

/**
 * Parse Revolut XLSX workbook using the xlsx library.
 * Supports two formats:
 *   1. Closed-positions summary (Date acquired | Date sold | Symbol | ...)
 *   2. Transaction log (Date | Ticker | Type | Quantity | Price per share | ...)
 */
export async function parseRevolutXlsx(data: Buffer | Uint8Array): Promise<Statement> {
  const xlsx = await import("xlsx");
  const wb = xlsx.read(data, { type: "buffer", cellNF: true });

  const sheet = wb.Sheets[wb.SheetNames[0]!];
  if (sheet) isoDateCells(xlsx, sheet, wb.Workbook?.WBProps?.date1904 === true);
  if (!sheet) {
    return {
      accountId: "", fromDate: "", toDate: "", period: "",
      trades: [], cashTransactions: [], corporateActions: [],
      openPositions: [], securitiesInfo: [],
    };
  }

  // Detect format from first row
  const headerRows = sheetToRows(xlsx, sheet);
  const headers = headerRows[0] ?? [];

  if (hasTxnLogHeaders(headers)) {
    const { trades, cashTransactions, corporateActions, openPositions, parserMessages } = parseTransactionLog(xlsx, sheet);
    return {
      accountId: "", fromDate: "", toDate: "", period: "",
      trades, cashTransactions, corporateActions,
      openPositions, securitiesInfo: [],
      ...(parserMessages.length > 0 ? { parserMessages } : {}),
    };
  }

  // Fall back to closed-positions format
  const { trades, parserMessages } = parseTrades(xlsx, sheet);
  return {
    accountId: "", fromDate: "", toDate: "", period: "",
    trades, cashTransactions: [], corporateActions: [],
    openPositions: [], securitiesInfo: [],
    ...(parserMessages.length > 0 ? { parserMessages } : {}),
  };
}

/**
 * Check if a Buffer/Uint8Array is likely a Revolut XLSX file.
 * Parses only the first row (sheetRows: 1) to check for Revolut-specific
 * headers. Raw byte scanning doesn't work because XLSX uses DEFLATE compression.
 */
export async function detectRevolutXlsx(data: Buffer | Uint8Array): Promise<boolean> {
  // Check ZIP magic bytes (PK\x03\x04)
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4B) return false;

  try {
    const xlsx = await import("xlsx");
    const wb = xlsx.read(data, { type: "buffer", sheetRows: 1 });
    const sheet = wb.Sheets[wb.SheetNames[0]!];
    if (!sheet) return false;
    const rows = xlsx.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
    if (!rows.length) return false;
    const headers = rows[0]!;
    return hasClosedPositionHeaders(headers) || hasTxnLogHeaders(headers);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Text-based BrokerParser (for pre-converted CSV or future CSV support)
// ---------------------------------------------------------------------------

export const revolutParser: BrokerParser = {
  name: "Revolut",
  formats: ["XLSX"],

  detect(input: string): boolean {
    const lower = input.toLowerCase();
    // Closed-positions format
    const closedPos = (lower.includes("date acquired") || lower.includes("fecha de adquisición")) &&
           (lower.includes("cost basis") || lower.includes("gross proceeds") || lower.includes("base de coste") || lower.includes("ingresos brutos")) &&
           !lower.includes("closed position") && !lower.includes("posiciones cerradas");
    if (closedPos) return true;
    // Transaction-log format: "Date" + "Ticker" + "Type" + "Total Amount"
    // (must NOT match Trading 212 which also has "Type" but uses "No. of shares")
    return lower.includes("ticker") && lower.includes("total amount") &&
           lower.includes("price per share") && !lower.includes("no. of shares");
  },

  parse(input: string): Statement {
    if (!input.trim()) {
      throw new Error("Revolut: fichero vacío o sin datos");
    }
    throw new Error("Revolut: solo se aceptan ficheros XLSX. Exporta el Trading Account Statement en formato Excel desde la app de Revolut.");
  },
};
