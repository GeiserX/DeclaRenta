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
  quantityUnknownTrade,
  quantityUnreadable,
  tradeQuantityUnknownMessages,
  unreadableTrade,
  unreadableCell,
  isReadableTradeDate,
  markUndatedTrades,
  dropUndatedCash,
  cashRowsUnidentifiedMessages,
  corporateActionTrade,
  isoDateCells,
  slashDateOrder,
  convertSlashDate,
} from "./csv-utils.js";
import { KNOWN_CRYPTO_SYMBOLS } from "./crypto-symbols.js";

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
  const dateAcqCol = findColumn(headers, DATE_ACQUIRED_HEADERS);
  const dateSoldCol = findColumn(headers, DATE_SOLD_HEADERS);
  const symbolCol = findColumn(headers, SYMBOL_HEADERS);
  const quantityCol = findColumn(headers, QUANTITY_HEADERS);
  const costBasisCol = findColumn(headers, COST_BASIS_HEADERS);
  const grossProceedsCol = findColumn(headers, GROSS_PROCEEDS_HEADERS);
  const grossPnlCol = findColumn(headers, GROSS_PNL_HEADERS);
  const feesCol = findColumn(headers, FEES_HEADERS);
  const currencyCol = findColumn(headers, CURRENCY_HEADERS);

  if (
    dateAcqCol < 0 || dateSoldCol < 0 || symbolCol < 0 || quantityCol < 0 ||
    costBasisCol < 0 || grossProceedsCol < 0 || currencyCol < 0
  ) return { trades: [], parserMessages: [] };

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
      // no readable date either is no position (a totals line).
      if (!isReadableTradeDate(dateAcquired) && !isReadableTradeDate(dateSold)) continue;
      const leg = { symbol: "", isin: "", assetCategory: "STK", currency: (row[currencyCol] ?? "").trim(), exchange: "REVOLUT" } as const;
      const cell = unreadableCell(headers[symbolCol] ?? "Symbol", "");
      trades.push(
        unreadableTrade({ ...leg, tradeID: `revolut-open-${dateAcquired}--${i}`, tradeDate: dateAcquired, buySell: "BUY" }, cell),
        unreadableTrade({ ...leg, tradeID: `revolut-close-${dateSold}--${i}`, tradeDate: dateSold, buySell: "SELL" }, cell),
      );
      continue;
    }

    const quantity = (row[quantityCol] ?? "0").trim();
    const costBasis = costBasisCol >= 0 ? (row[costBasisCol] ?? "0").trim() : "0";
    const grossProceeds = grossProceedsCol >= 0 ? (row[grossProceedsCol] ?? "0").trim() : "0";
    const grossPnl = grossPnlCol >= 0 ? (row[grossPnlCol] ?? "0").trim() : "0";
    const fees = feesCol >= 0 ? (row[feesCol] ?? "0").trim() : "0";
    const currency = currencyCol >= 0 ? (row[currencyCol] ?? "USD").trim() : "USD";

    // All money/quantity parsing routes through toFiniteDecimal so a garbled
    // cell can never yield NaN/Infinity (which would poison cost basis). The
    // emitted strings are decimal.js .toString()/.toFixed(), losslessly parsed.
    const absQty = toFiniteDecimal(quantity).abs();
    if (absQty.isZero()) {
      // An empty or unreadable quantity is no "0": keep both legs as trades of
      // unknown quantity for the anti-churning evidence (#453), as eToro does.
      // They move no share and no money. A written 0 is still skipped.
      if (quantityUnreadable(row[quantityCol])) {
        const leg = { symbol, isin: "", assetCategory: detectAssetCategory(symbol), currency, exchange: "REVOLUT" } as const;
        trades.push(
          quantityUnknownTrade({ ...leg, tradeID: `revolut-open-${dateAcquired}-${symbol}-${i}`, tradeDate: dateAcquired, buySell: "BUY" }),
          quantityUnknownTrade({ ...leg, tradeID: `revolut-close-${dateSold}-${symbol}-${i}`, tradeDate: dateSold, buySell: "SELL" }),
        );
      }
      continue;
    }

    const assetCategory = detectAssetCategory(symbol);
    // Use absolute values to avoid double-negative if input is already negative
    const absCost = toFiniteDecimal(costBasis).abs();
    const absProceeds = toFiniteDecimal(grossProceeds).abs();
    const pnl = toFiniteDecimal(grossPnl);
    const absFees = toFiniteDecimal(fees).abs();

    // Revolut reports per-trade cost/proceeds, compute price per unit
    const buyPrice = absQty.greaterThan(0) ? absCost.div(absQty).toFixed(8) : "0";
    const sellPrice = absQty.greaterThan(0) ? absProceeds.div(absQty).toFixed(8) : "0";

    // Assign full fee to SELL leg (consistent with eToro and IBKR patterns)
    const feeStr = absFees.toFixed(2);

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

  // Every money/quantity cell is finiteness-guarded via toFiniteDecimal; the
  // only messages name the trades of unknown quantity and the unreadable rows.
  markUndatedTrades(trades, "Date acquired / Date sold");
  return { trades, parserMessages: tradeQuantityUnknownMessages("Revolut", trades) };
}

// ---------------------------------------------------------------------------
// Transaction-log amount parser
// ---------------------------------------------------------------------------

/**
 * Parse Revolut "CCY amount" strings like "EUR 15.61" or "USD -217.14".
 * Returns { currency, amount } where amount is the raw numeric string.
 */
function parseCcyAmount(raw: string): { currency: string; amount: string } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^([A-Z]{3})\s+(-?[\d.,]+)$/);
  if (match) return { currency: match[1]!, amount: parseNumber(match[2]!) };
  return { currency: "", amount: parseNumber(trimmed) };
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
}

function findTxnLogColumns(headers: string[]): TxnLogColumns | null {
  const date = findColumn(headers, TXN_DATE_HEADERS);
  const ticker = findColumn(headers, TXN_TICKER_HEADERS);
  const type = findColumn(headers, TXN_TYPE_HEADERS);
  const quantity = findColumn(headers, TXN_QUANTITY_HEADERS);
  const price = findColumn(headers, TXN_PRICE_HEADERS);
  const total = findColumn(headers, TXN_TOTAL_HEADERS);
  const currency = findColumn(headers, TXN_CURRENCY_HEADERS);
  const fxRate = findColumn(headers, TXN_FX_RATE_HEADERS);

  if (date < 0 || type < 0 || total < 0 || currency < 0) return null;
  return { date, ticker, type, quantity, price, total, currency, fxRate };
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
  if (!cols) return empty;

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
  // STOCK SPLIT rows with no usable Quantity (shares added).
  let unresolvedSplits = 0;
  // DIVIDEND TAX (CORRECTION) rows, not booked: ticker, date and amount.
  const dividendTaxRows: string[] = [];
  // DIVIDEND rows with no ticker: type, amount and date (#467).
  const unidentifiedCash: string[] = [];

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
    const currencyRaw = (row[cols.currency] ?? "").trim();

    const totalRaw = (row[cols.total] ?? "").trim();
    const { amount: totalAmountStr } = parseCcyAmount(totalRaw);
    // Route money through toFiniteDecimal so a garbled cell can never yield
    // NaN/Infinity (which would poison cost basis), mirroring the parseTrades path.
    const totalAmountDec = toFiniteDecimal(totalAmountStr, "0", false);

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
        currency: currencyRaw,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: totalAmountDec.toString(),
        fxRateToBase: currencyRaw === "EUR" ? "1" : new Decimal(1).div(fxRate).toString(),
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
        tradeID: `revolut-row-${tradeDate}--${i}`, symbol: "", isin: "", assetCategory: "STK", currency: currencyRaw,
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
    // A dividend with no ticker names no security: named, never dropped with
    // no word (#467).
    if (!ticker && TXN_TYPE_DIVIDEND.test(type)) {
      if (!totalAmountDec.isZero()) unidentifiedCash.push(`${type} ${totalRaw} ${isReadableTradeDate(tradeDate) ? tradeDate : dateStr || "—"}`);
      continue;
    }
    // Skip other rows without a ticker (e.g. REWARD, CUSTODY FEE): no trade.
    if (!ticker) continue;

    const quantityStr = (row[cols.quantity] ?? "0").trim();
    const priceStr = (row[cols.price] ?? "0").trim();

    const { amount: qtyAmountStr } = parseCcyAmount(quantityStr);
    const signedQtyDec = toFiniteDecimal(qtyAmountStr, "0", false);
    const qtyDec = signedQtyDec.abs();

    // A ticker row that is a buy, a sale or of a type no branch handles (a
    // spin-off, a stock merger, a stop order) but cannot be read is kept as a
    // trade that books nothing, never dropped or booked as a buy (#467,
    // #468). A row of an unknown type that writes a zero quantity moves no
    // shares and stays skipped when it moves no money either, or is a fee
    // ("CUSTODY FEE"). One with an amount (a cash merger, cash in lieu) may
    // be a taxable sale, so it is kept and named like the others.
    const buy = TXN_TYPE_BUY.test(type);
    const sell = TXN_TYPE_SELL.test(type);
    const otherType = !buy && !sell && !TXN_TYPE_DIVIDEND.test(type) && !TXN_TYPE_SPLIT.test(type) &&
      !TXN_TYPE_ENTITY_TRANSFER.test(type);
    // Read the Quantity cell as parseCcyAmount does (an optional "CCY " prefix,
    // then parseNumber), so a blank or currency-only cell is unreadable too.
    const quantityCell = (row[cols.quantity] ?? "").trim().replace(/^[A-Z]{3}\s+/, "");
    const keepUnreadable = (cell: string): void => {
      trades.push(unreadableTrade({
        tradeID: `revolut-row-${tradeDate}-${ticker}-${i}`,
        symbol: ticker, isin: "", assetCategory: detectAssetCategory(ticker), currency: currencyRaw, tradeDate,
        exchange: "REVOLUT", ...(buy || sell ? { buySell: sell ? "SELL" as const : "BUY" as const } : {}),
      }, cell));
      markUnknownSize(ticker, currencyRaw, buy);
    };
    if (otherType && !quantityUnreadable(quantityCell) && qtyDec.isZero() &&
      (totalAmountDec.isZero() || /\bFEES?$/i.test(type))) continue;
    if ((buy || sell || otherType) && !isReadableTradeDate(tradeDate)) {
      keepUnreadable(unreadableCell(headers[cols.date] ?? "Date", dateStr));
      continue;
    }
    if (otherType) {
      keepUnreadable(unreadableCell(headers[cols.type] ?? "Type", type));
      continue;
    }
    // A split row with no readable date cannot be applied at its day: it is
    // kept as a row that books nothing, named as not applied, and its holding
    // is of unknown size (#467), never applied on a false day or dropped. A
    // dividend with no readable date is booked with that date and taken out,
    // named with its amount, by dropUndatedCash below (#467).
    if (TXN_TYPE_SPLIT.test(type) && !isReadableTradeDate(tradeDate)) {
      trades.push(corporateActionTrade({
        tradeID: `revolut-split-${tradeDate}-${ticker}-${i}`, symbol: ticker, isin: "",
        assetCategory: detectAssetCategory(ticker), currency: currencyRaw, tradeDate: dateStr, exchange: "REVOLUT",
      }, type, quantityCell));
      markUnknownSize(ticker, currencyRaw, false);
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
          currency: currencyRaw,
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
    // reverse split) and the amount is zero. The ratio depends on the whole
    // holding, which can span several yearly files, so the parser does not size
    // it: the FIFO engine does, from the lots it holds at the split date, and
    // rescales them keeping their cost (Art. 37.1.a LIRPF: not a disposal).
    if (TXN_TYPE_SPLIT.test(type)) {
      if (signedQtyDec.isZero()) {
        unresolvedSplits++;
        continue;
      }
      corporateActions.push({
        transactionID: `revolut-split-${tradeDate}-${ticker}-${i}`,
        accountId: "",
        symbol: ticker,
        description: `${ticker} STOCK SPLIT ${signedQtyDec.toString()} SHARES`,
        isin: "",
        currency: currencyRaw,
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
      if (quantityUnreadable(quantityCell)) {
        trades.push(quantityUnknownTrade({
          tradeID: `revolut-${buy ? "buy" : "sell"}-${tradeDate}-${ticker}-${i}`,
          symbol: ticker, isin: "", assetCategory: detectAssetCategory(ticker), currency: currencyRaw, tradeDate,
          buySell: buy ? "BUY" : "SELL", exchange: "REVOLUT",
        }));
        markUnknownSize(ticker, currencyRaw, buy);
      }
      continue;
    }

    const { amount: priceAmountStr } = parseCcyAmount(priceStr);
    const pricePerShareDec = toFiniteDecimal(priceAmountStr, "0", false);

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
        currency: currencyRaw,
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
        commissionCurrency: currencyRaw,
        commission: "0",
        taxes: "0",
        multiplier: "1",
      });

      const pos = positions.get(ticker) ?? {
        symbol: ticker, currency: currencyRaw, assetCategory,
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
        currency: currencyRaw,
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
        commissionCurrency: currencyRaw,
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
        costBasisMoney: unknown ? "0" : pos.totalCost.toFixed(2),
        costBasisPrice: unknown ? "0" : costPerUnit.toFixed(8),
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
      message: `Se ha(n) omitido ${count} ingreso(s) o retirada(s) de efectivo del extracto de Revolut por tener un tipo de cambio (FX Rate) no válido: ${rows}.`,
      hint: "Solo los ingresos y las retiradas de efectivo usan esa columna; las compras, las ventas y los dividendos se calculan con el tipo del BCE y no se omiten. Suele deberse a una celda de tipo de cambio no numérica, negativa o igual a cero en la exportación. Vuelve a descargar el Trading Account Statement completo desde la app de Revolut para que esos movimientos se incluyan.",
      context: { count, rows },
    });
  }
  if (unresolvedSplits > 0) {
    parserMessages.push({
      id: "revolut.split_unresolved",
      severity: "warning" as const,
      message: `Se ${unresolvedSplits === 1 ? "ha omitido 1 desdoblamiento (STOCK SPLIT)" : `han omitido ${unresolvedSplits} desdoblamientos (STOCK SPLIT)`} del extracto de Revolut porque la fila no indica cuántas acciones se añadieron.`,
      hint: "Vuelve a descargar el Trading Account Statement desde la app de Revolut. Si la fila sigue sin cantidad, el número de acciones y el coste de las ventas posteriores de ese valor no serán correctos.",
      context: { count: String(unresolvedSplits) },
    });
  }
  if (dividendTaxRows.length > 0) {
    const count = String(dividendTaxRows.length);
    const rows = dividendTaxRows.join("; ");
    parserMessages.push({
      id: "revolut.dividend_tax_correction",
      severity: "info" as const,
      message: `El extracto de Revolut trae ${count} corrección(es) de la retención de un dividendo (DIVIDEND TAX (CORRECTION)) que DeclaRenta no suma: ${rows}.`,
      hint: "Con estas filas Revolut corrige la retención de un dividendo ya cobrado. DeclaRenta importa los dividendos de Revolut por su importe neto y no lee la retención de este extracto, así que tampoco su corrección. Toma el dividendo bruto y la retención final, ya corregida, del informe fiscal anual de Revolut.",
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
  );
  return { trades, cashTransactions, corporateActions, openPositions, parserMessages };
}

// ---------------------------------------------------------------------------
// Transaction-log detection
// ---------------------------------------------------------------------------

function hasTxnLogHeaders(headers: string[]): boolean {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const hasDate = lower.some(h => TXN_DATE_HEADERS.includes(h));
  const hasTicker = lower.some(h => TXN_TICKER_HEADERS.includes(h));
  const hasType = lower.some(h => TXN_TYPE_HEADERS.includes(h));
  const hasTotal = lower.some(h => TXN_TOTAL_HEADERS.some(p => h.includes(p)));
  const hasPrice = lower.some(h => TXN_PRICE_HEADERS.some(p => h.includes(p)));
  return hasDate && hasTicker && hasType && hasTotal && hasPrice;
}

function hasClosedPositionHeaders(headers: string[]): boolean {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const hasDateAcq = lower.some(h => DATE_ACQUIRED_HEADERS.some(p => h.includes(p)));
  const hasCostOrProceeds = lower.some(h =>
    [...COST_BASIS_HEADERS, ...GROSS_PROCEEDS_HEADERS].some(p => h.includes(p)),
  );
  return hasDateAcq && hasCostOrProceeds;
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
