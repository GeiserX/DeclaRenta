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
 *   Each row = one event (BUY, SELL, CASH TOP-UP, CASH WITHDRAWAL, REWARD).
 *   Parser creates individual trades, extracts cash transactions, and infers
 *   open positions from unmatched buys.
 *
 * Revolut only offers XLSX or PDF exports (no CSV).
 *
 * Limitations:
 * - No ISIN codes in either format — cross-broker FIFO matching uses symbol fallback.
 * - No dividends/withholdings in either format. Users need a separate Account Statement.
 * - FX rates in format B are EUR/FCY. The parser stores fxRateToBase="1" and lets
 *   the FIFO engine fetch official ECB rates independently.
 */

import Decimal from "decimal.js";
import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, CashTransaction, OpenPosition, AssetCategory } from "../types/ibkr.js";
import { findColumn, parseNumber } from "./csv-utils.js";

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

const TXN_TYPE_BUY = /^BUY\s*-\s*(MARKET|LIMIT)$/i;
const TXN_TYPE_SELL = /^SELL\s*-\s*(MARKET|LIMIT)$/i;
const TXN_TYPE_CASH_IN = /^CASH\s*TOP[- ]?UP$/i;
const TXN_TYPE_CASH_OUT = /^CASH\s*WITHDRAWAL$/i;

// ---------------------------------------------------------------------------
// Crypto detection — Revolut mixes stocks and crypto in the same sheet.
// Uses a known-crypto set plus a heuristic for unlisted tokens: symbols
// that are all-uppercase without dots and 1-5 chars that aren't in the
// known-stock set are flagged as crypto. This isn't perfect but covers
// the vast majority of Revolut's tradeable assets.
// ---------------------------------------------------------------------------

const KNOWN_CRYPTO = new Set([
  // Top coins
  "BTC", "ETH", "XRP", "SOL", "ADA", "DOGE", "DOT", "AVAX", "LINK", "LTC",
  "BCH", "XLM", "ATOM", "UNI", "SHIB", "FIL", "APT", "ARB", "NEAR", "OP",
  "ICP", "ALGO", "SAND", "MANA", "AXS", "ENJ", "COMP", "AAVE", "CRV", "GRT",
  "SNX", "MKR", "LDO", "PEPE", "FLOKI", "BONK", "WIF", "JUP", "SUI", "SEI",
  "TIA", "WLD", "RENDER", "FET", "TAO", "PENDLE", "TON", "TRX", "HBAR", "VET",
  "EOS", "XTZ", "THETA", "ZIL", "IOTA", "EGLD", "FLOW", "ROSE", "INJ", "QNT",
  // DeFi & infrastructure
  "1INCH", "ACH", "AMP", "ANKR", "BAL", "BAND", "BAT", "BICO", "BLZ", "BNT",
  "BOND", "CELO", "CHZ", "CLV", "COTI", "CRO", "CTSI", "ENS", "ETC", "FIDA",
  "FORTH", "FTM", "GALA", "GMT", "GODS", "GST", "IDEX", "IMX", "JASMY", "KNC",
  "LPT", "LRC", "MASK", "MINA", "MLN", "NKN", "NMR", "OGN", "OMG", "OXT",
  "PERP", "RAD", "REN", "REQ", "RLC", "SKL", "SPELL", "STORJ", "SUPER", "SUSHI",
  "TRB", "UMA", "UNFI", "YFI", "ZRX",
  // Stablecoins (appear in Revolut crypto statements)
  "USDC", "USDT",
  // Rebrands — keep old + new for backward compat with older exports
  "MATIC", "POL", "RNDR",
  // Possibly delisted but needed for historical data
  "DASH", "KEEP", "MIR", "NU", "APE",
]);

/** Common short stock tickers that could be confused with crypto */
const KNOWN_SHORT_STOCKS = new Set([
  "A", "B", "C", "D", "F", "G", "K", "T", "V", "X",
  "AA", "AI", "BA", "BP", "BT", "DB", "GE", "GM", "HP",
  "AB", "AG", "AL", "AM", "AN", "AR", "AS", "AT", "AU", "AV",
]);

function detectAssetCategory(symbol: string): AssetCategory {
  const upper = symbol.toUpperCase();
  if (KNOWN_CRYPTO.has(upper)) return "CRYPTO";
  if (KNOWN_SHORT_STOCKS.has(upper)) return "STK";
  return "STK";
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function parseRevolutDate(dateStr: string): string {
  const trimmed = dateStr.trim();
  // ISO 8601 timestamp: 2025-10-20T06:00:02.425Z or 2025-10-19T00:02:32.169239Z
  const isoTsMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoTsMatch) return `${isoTsMatch[1]}${isoTsMatch[2]}${isoTsMatch[3]}`;
  // YYYY-MM-DD (primary Revolut closed-positions format)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
  // DD/MM/YYYY (EU format fallback)
  const euMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (euMatch) return `${euMatch[3]}${euMatch[2]}${euMatch[1]}`;
  // MM/DD/YYYY (US format fallback)
  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) return `${usMatch[3]}${usMatch[1]!.padStart(2, "0")}${usMatch[2]!.padStart(2, "0")}`;
  return trimmed.replace(/[-/]/g, "").slice(0, 8);
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

function parseTrades(xlsx: typeof import("xlsx"), sheet: WorkSheet): Trade[] {
  const rows = sheetToRows(xlsx, sheet);
  if (rows.length < 2) return [];

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
  ) return [];

  const trades: Trade[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (!row.length || row.every((c) => !c.trim())) continue;

    const symbol = (row[symbolCol] ?? "").trim();
    if (!symbol) continue;

    const dateAcquired = parseRevolutDate(row[dateAcqCol] ?? "");
    const dateSold = parseRevolutDate(row[dateSoldCol] ?? "");
    const quantity = (row[quantityCol] ?? "0").trim();
    const costBasis = costBasisCol >= 0 ? (row[costBasisCol] ?? "0").trim() : "0";
    const grossProceeds = grossProceedsCol >= 0 ? (row[grossProceedsCol] ?? "0").trim() : "0";
    const grossPnl = grossPnlCol >= 0 ? (row[grossPnlCol] ?? "0").trim() : "0";
    const fees = feesCol >= 0 ? (row[feesCol] ?? "0").trim() : "0";
    const currency = currencyCol >= 0 ? (row[currencyCol] ?? "USD").trim() : "USD";

    const qty = parseFloat(parseNumber(quantity));
    if (qty === 0 || isNaN(qty)) continue;

    const absQty = Math.abs(qty);
    const assetCategory = detectAssetCategory(symbol);
    const costNum = parseFloat(parseNumber(costBasis));
    const proceedsNum = parseFloat(parseNumber(grossProceeds));
    const pnlNum = parseFloat(parseNumber(grossPnl));
    const feesNum = parseFloat(parseNumber(fees));

    // Use absolute values to avoid double-negative if input is already negative
    const absCost = isNaN(costNum) ? 0 : Math.abs(costNum);
    const absProceeds = isNaN(proceedsNum) ? 0 : Math.abs(proceedsNum);
    const absFees = isNaN(feesNum) ? 0 : Math.abs(feesNum);

    // Revolut reports per-trade cost/proceeds, compute price per unit
    const buyPrice = absQty > 0 ? (absCost / absQty).toFixed(8) : "0";
    const sellPrice = absQty > 0 ? (absProceeds / absQty).toFixed(8) : "0";

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
      quantity: `${absQty}`,
      tradePrice: buyPrice,
      tradeMoney: `-${absCost}`,
      proceeds: "0",
      cost: `-${absCost}`,
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
      quantity: `-${absQty}`,
      tradePrice: sellPrice,
      tradeMoney: `${absProceeds}`,
      proceeds: `${absProceeds}`,
      cost: "0",
      fifoPnlRealized: isNaN(pnlNum) ? "0" : `${pnlNum}`,
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

  return trades;
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
): { trades: Trade[]; cashTransactions: CashTransaction[]; openPositions: OpenPosition[] } {
  const rows = sheetToRows(xlsx, sheet);
  if (rows.length < 2) return { trades: [], cashTransactions: [], openPositions: [] };

  const headers = rows[0]!;
  const cols = findTxnLogColumns(headers);
  if (!cols) return { trades: [], cashTransactions: [], openPositions: [] };

  const trades: Trade[] = [];
  const cashTransactions: CashTransaction[] = [];

  // Track net positions per symbol for open-position inference
  const positions = new Map<string, {
    symbol: string; currency: string; assetCategory: AssetCategory;
    netQty: Decimal; totalCost: Decimal;
  }>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (!row.length || row.every((c) => !c.trim())) continue;

    const dateStr = (row[cols.date] ?? "").trim();
    if (!dateStr) continue;
    const tradeDate = parseRevolutDate(dateStr);

    const type = (row[cols.type] ?? "").trim();
    const ticker = (row[cols.ticker] ?? "").trim();
    const currencyRaw = (row[cols.currency] ?? "").trim();
    const fxRateStr = (row[cols.fxRate] ?? "1").trim();
    const fxRate = parseFloat(parseNumber(fxRateStr)) || 1;

    const totalRaw = (row[cols.total] ?? "").trim();
    const { amount: totalAmountStr } = parseCcyAmount(totalRaw);
    const totalAmount = parseFloat(totalAmountStr) || 0;

    // Cash flows: CASH TOP-UP, CASH WITHDRAWAL, REWARD
    if (TXN_TYPE_CASH_IN.test(type) || TXN_TYPE_CASH_OUT.test(type)) {
      cashTransactions.push({
        transactionID: `revolut-cash-${tradeDate}-${i}`,
        accountId: "",
        symbol: "",
        description: type,
        isin: "",
        currency: currencyRaw,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: `${totalAmount}`,
        fxRateToBase: currencyRaw === "EUR" ? "1" : `${1 / fxRate}`,
        type: "Deposits/Withdrawals",
      });
      continue;
    }

    // Skip non-trade rows without a ticker (e.g. REWARD)
    if (!ticker) continue;

    const quantityStr = (row[cols.quantity] ?? "0").trim();
    const priceStr = (row[cols.price] ?? "0").trim();

    const { amount: qtyAmountStr } = parseCcyAmount(quantityStr);
    const qty = Math.abs(parseFloat(qtyAmountStr) || 0);
    if (qty === 0 || !isFinite(qty)) continue;

    const { amount: priceAmountStr } = parseCcyAmount(priceStr);
    const pricePerShare = parseFloat(priceAmountStr) || 0;

    const assetCategory = detectAssetCategory(ticker);
    const absTotalAmount = Math.abs(totalAmount);

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
        quantity: `${qty}`,
        tradePrice: `${pricePerShare}`,
        tradeMoney: `-${absTotalAmount}`,
        proceeds: "0",
        cost: `-${absTotalAmount}`,
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
      pos.netQty = pos.netQty.plus(qty);
      pos.totalCost = pos.totalCost.plus(absTotalAmount);
      positions.set(ticker, pos);
    } else if (TXN_TYPE_SELL.test(type)) {
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
        quantity: `-${qty}`,
        tradePrice: `${pricePerShare}`,
        tradeMoney: `${absTotalAmount}`,
        proceeds: `${absTotalAmount}`,
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
        const sellQty = Decimal.min(qty, pos.netQty);
        const costPerUnit = pos.totalCost.div(pos.netQty);
        pos.totalCost = pos.totalCost.minus(costPerUnit.times(sellQty));
        pos.netQty = pos.netQty.minus(sellQty);
      }
    }
  }

  // Build open positions from symbols with remaining shares
  const openPositions: OpenPosition[] = [];
  for (const pos of Array.from(positions.values())) {
    if (pos.netQty.greaterThan(0.00000001)) {
      const costPerUnit = pos.netQty.greaterThan(0) ? pos.totalCost.div(pos.netQty) : new Decimal(0);
      openPositions.push({
        accountId: "",
        symbol: pos.symbol,
        description: pos.symbol,
        isin: "",
        currency: pos.currency,
        assetCategory: pos.assetCategory,
        quantity: pos.netQty.toString(),
        costBasisMoney: pos.totalCost.toFixed(2),
        costBasisPrice: costPerUnit.toFixed(8),
        markPrice: "0",
        positionValue: "0",
        fifoPnlUnrealized: "0",
        fxRateToBase: "1",
      });
    }
  }

  return { trades, cashTransactions, openPositions };
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
  const wb = xlsx.read(data, { type: "buffer" });

  const sheet = wb.Sheets[wb.SheetNames[0]!];
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
    const { trades, cashTransactions, openPositions } = parseTransactionLog(xlsx, sheet);
    return {
      accountId: "", fromDate: "", toDate: "", period: "",
      trades, cashTransactions, corporateActions: [],
      openPositions, securitiesInfo: [],
    };
  }

  // Fall back to closed-positions format
  const trades = parseTrades(xlsx, sheet);
  return {
    accountId: "", fromDate: "", toDate: "", period: "",
    trades, cashTransactions: [], corporateActions: [],
    openPositions: [], securitiesInfo: [],
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
