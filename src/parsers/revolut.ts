/**
 * Revolut XLSX parser.
 *
 * Parses Revolut's Trading Account Statement XLSX export into a normalized Statement.
 * The workbook contains a single sheet with completed (round-trip) trades:
 *   Date acquired | Date sold | Symbol | Quantity | Cost basis | Gross proceeds |
 *   Gross PnL | Fees | Net PnL | Currency
 *
 * Each row represents a closed position: the parser creates both a BUY (opening)
 * and a SELL (closing) trade for the FIFO engine.
 *
 * Revolut only offers XLSX or PDF exports (no CSV).
 *
 * Limitations:
 * - No ISIN codes in Revolut exports — cross-broker FIFO matching uses symbol fallback.
 * - No dividends/withholdings — Revolut's Trading Statement only has closed positions.
 *   Users need a separate Account Statement export for dividends (not yet supported).
 * - No open positions — Modelo 720/D-6 cannot be generated from this data alone.
 */

import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, AssetCategory } from "../types/ibkr.js";
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
// Crypto detection — Revolut mixes stocks and crypto in the same sheet.
// Uses a known-crypto set plus a heuristic for unlisted tokens: symbols
// that are all-uppercase without dots and 1-5 chars that aren't in the
// known-stock set are flagged as crypto. This isn't perfect but covers
// the vast majority of Revolut's tradeable assets.
// ---------------------------------------------------------------------------

const KNOWN_CRYPTO = new Set([
  "BTC", "ETH", "XRP", "SOL", "ADA", "DOGE", "DOT", "AVAX", "MATIC", "LINK",
  "LTC", "BCH", "XLM", "ATOM", "UNI", "SHIB", "FIL", "APT", "ARB", "NEAR",
  "OP", "ICP", "ALGO", "SAND", "MANA", "AXS", "ENJ", "1INCH", "COMP", "AAVE",
  "CRV", "GRT", "SNX", "MKR", "LDO", "PEPE", "FLOKI", "BONK", "WIF", "JUP",
  "SUI", "SEI", "TIA", "WLD", "RENDER", "FET", "TAO", "PENDLE", "TON", "TRX",
  "HBAR", "VET", "EOS", "XTZ", "THETA", "ZIL", "IOTA", "EGLD", "FLOW", "ROSE",
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
  // Heuristic: stock tickers on Revolut typically have dots (BRK.B) or are
  // well-known 1-5 letter tickers. Crypto symbols on Revolut never have dots.
  // Symbols starting with digits (like 1INCH) are always crypto.
  if (/^\d/.test(upper)) return "CRYPTO";
  return "STK";
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function parseRevolutDate(dateStr: string): string {
  const trimmed = dateStr.trim();
  // YYYY-MM-DD (primary Revolut format)
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
// XLSX detection and parsing
// ---------------------------------------------------------------------------

/**
 * Parse Revolut XLSX workbook using the xlsx library.
 */
export async function parseRevolutXlsx(data: Buffer | Uint8Array): Promise<Statement> {
  const xlsx = await import("xlsx");
  const wb = xlsx.read(data, { type: "buffer" });

  // Revolut uses a single sheet (typically "Sheet1")
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  const trades = sheet ? parseTrades(xlsx, sheet) : [];

  return {
    accountId: "",
    fromDate: "",
    toDate: "",
    period: "",
    trades,
    cashTransactions: [],
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
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
    const headers = rows[0]!.map((h) => h.toLowerCase().trim());
    const hasDateAcq = headers.some(h => DATE_ACQUIRED_HEADERS.some(p => h.includes(p)));
    const hasCostOrProceeds = headers.some(h =>
      [...COST_BASIS_HEADERS, ...GROSS_PROCEEDS_HEADERS].some(p => h.includes(p)),
    );
    return hasDateAcq && hasCostOrProceeds;
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
    return (lower.includes("date acquired") || lower.includes("fecha de adquisición")) &&
           (lower.includes("cost basis") || lower.includes("gross proceeds") || lower.includes("base de coste") || lower.includes("ingresos brutos")) &&
           !lower.includes("closed position") && !lower.includes("posiciones cerradas");
  },

  parse(input: string): Statement {
    if (!input.trim()) {
      throw new Error("Revolut: fichero vacío o sin datos");
    }
    throw new Error("Revolut: solo se aceptan ficheros XLSX. Exporta el Trading Account Statement en formato Excel desde la app de Revolut.");
  },
};
