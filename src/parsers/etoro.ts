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

import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import { findColumn, parseNumber, toFiniteDecimal } from "./csv-utils.js";

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
const OPEN_DATE_HEADERS = ["open date", "fecha de apertura"];
const CLOSE_DATE_HEADERS = ["close date", "fecha de cierre"];
const TYPE_HEADERS = ["type", "tipo"];
const LEVERAGE_HEADERS = ["leverage", "apalancamiento"];
const ISIN_HEADERS = ["isin"];
const DIRECTION_HEADERS = ["long / short", "long/short"];

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

function getSheet(wb: WorkBook, names: string[]): WorkSheet | undefined {
  for (const name of names) {
    const lower = name.toLowerCase();
    const found = wb.SheetNames.find((s) => s.toLowerCase().includes(lower));
    if (found) return wb.Sheets[found];
  }
  return undefined;
}

function sheetToRows(xlsx: typeof import("xlsx"), sheet: WorkSheet): string[][] {
  return xlsx.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
}

function parseEtoroDate(dateStr: string): string {
  const trimmed = dateStr.trim();
  // DD/MM/YYYY HH:MM:SS or DD/MM/YYYY
  const slashMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (slashMatch) {
    return `${slashMatch[3]}${slashMatch[2]}${slashMatch[1]}`;
  }
  // YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
  }
  // MM/DD/YYYY (US format sometimes used)
  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    return `${usMatch[3]}${usMatch[1]!.padStart(2, "0")}${usMatch[2]!.padStart(2, "0")}`;
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

function parseClosedPositions(xlsx: typeof import("xlsx"), sheet: WorkSheet): Trade[] {
  const rows = sheetToRows(xlsx, sheet);
  if (rows.length < 2) return [];

  const headers = rows[0]!;
  const actionCol = findColumn(headers, ACTION_HEADERS);
  const amountCol = findColumn(headers, AMOUNT_HEADERS);
  const unitsCol = findColumn(headers, UNITS_HEADERS);
  const openRateCol = findColumn(headers, OPEN_RATE_HEADERS);
  const closeRateCol = findColumn(headers, CLOSE_RATE_HEADERS);
  const profitCol = findColumn(headers, PROFIT_HEADERS);
  const profitEurCol = findColumn(headers, PROFIT_EUR_HEADERS);
  const openDateCol = findColumn(headers, OPEN_DATE_HEADERS);
  const closeDateCol = findColumn(headers, CLOSE_DATE_HEADERS);
  const typeCol = findColumn(headers, TYPE_HEADERS);
  const leverageCol = findColumn(headers, LEVERAGE_HEADERS);
  const isinCol = findColumn(headers, ISIN_HEADERS);
  const directionCol = findColumn(headers, DIRECTION_HEADERS);

  if (actionCol < 0 || unitsCol < 0) return [];

  const trades: Trade[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (!row.length) continue;

    // Determine asset category from type and leverage
    const leverage = leverageCol >= 0 ? (row[leverageCol] ?? "").trim() : "1";
    const rowType = typeCol >= 0 ? (row[typeCol] ?? "").toLowerCase().trim() : "";

    // Skip unknown/unsupported types (e.g. crypto on eToro — use dedicated crypto parsers)
    if (rowType && !rowType.includes("stock") && !rowType.includes("etf") &&
        !rowType.includes("accion") && !rowType.includes("cfd") &&
        !rowType.includes("index") && !rowType.includes("indice") &&
        !rowType.includes("commodit")) continue;

    // CFD: leverage > 1 OR type explicitly says "cfd" OR commodity (always derivative on eToro)
    // Strip non-numeric prefixes (e.g. "x5", "X10") before parsing
    const leverageNum = parseFloat(leverage.replace(/^[xX]/, ""));
    const isCfd = (!isNaN(leverageNum) && leverageNum > 1) || rowType.includes("cfd") || rowType.includes("commodit");
    const assetCat = isCfd ? "CFD" as const : "STK" as const;

    // Two eToro formats:
    // English: "Action" = "Buy AAPL" (direction + symbol combined)
    // Spanish: "Acción" = instrument name, "Long / Short" = direction
    const actionStr = row[actionCol] ?? "";
    let symbol: string;
    let direction: "BUY" | "SELL";

    if (directionCol >= 0) {
      // Spanish format: Acción = name, Long/Short = direction
      symbol = actionStr.trim();
      const dirStr = (row[directionCol] ?? "").toLowerCase().trim();
      direction = dirStr === "short" ? "SELL" : "BUY";
    } else {
      const parsed = parseAction(actionStr);
      if (!parsed) continue;
      symbol = parsed.symbol;
      direction = parsed.direction;
    }

    if (!symbol) continue;

    const isin = isinCol >= 0 ? (row[isinCol] ?? "").trim() : "";
    const units = (row[unitsCol] ?? "0").trim();
    const openRate = openRateCol >= 0 ? (row[openRateCol] ?? "0").trim() : "0";
    const closeRate = closeRateCol >= 0 ? (row[closeRateCol] ?? "0").trim() : "0";
    const amount = amountCol >= 0 ? (row[amountCol] ?? "0").trim() : "0";
    // Prefer EUR profit if available (Spanish export has both USD and EUR)
    const profitRaw = profitEurCol >= 0
      ? (row[profitEurCol] ?? "0").trim()
      : profitCol >= 0 ? (row[profitCol] ?? "0").trim() : "0";
    const profit = parseNumber(profitRaw);
    const currency = profitEurCol >= 0 && (row[profitEurCol] ?? "").trim() ? "EUR" : "USD";
    const openDate = openDateCol >= 0 ? parseEtoroDate(row[openDateCol] ?? "") : "";
    const closeDate = closeDateCol >= 0 ? parseEtoroDate(row[closeDateCol] ?? "") : "";

    const unitsNum = parseFloat(parseNumber(units));
    if (unitsNum === 0 || isNaN(unitsNum)) continue;

    // eToro closed positions represent a round-trip: buy then sell
    // We create both the opening buy and the closing sell
    const absUnits = Math.abs(unitsNum);

    // Normalize the invested amount the SAME way on both legs (the SELL leg
    // parses it via Decimal too), so an EU-formatted amount can't yield a
    // different cost on the BUY leg than proceeds on the SELL leg.
    const buyMoney = toFiniteDecimal(amount).neg().toString();

    // Buy leg (opening)
    trades.push({
      tradeID: `etoro-open-${openDate}-${symbol}-${i}`,
      accountId: "",
      symbol,
      description: symbol,
      isin,
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
      description: symbol,
      isin,
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

  return trades;
}

// ---------------------------------------------------------------------------
// Dividends parser
// ---------------------------------------------------------------------------

function parseDividends(xlsx: typeof import("xlsx"), sheet: WorkSheet): CashTransaction[] {
  const rows = sheetToRows(xlsx, sheet);
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

  if (dateCol < 0 || (netCol < 0 && netEurCol < 0)) return [];

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
    if (!dateStr) continue;

    const tradeDate = parseEtoroDate(dateStr);
    const instrument = instrumentCol >= 0 ? (row[instrumentCol] ?? "").trim() : "";
    const netAmount = (row[effectiveNetCol] ?? "0").trim();
    const isin = isinCol >= 0 ? (row[isinCol] ?? "").trim() : "";

    const netNum = parseFloat(parseNumber(netAmount));
    if (isNaN(netNum) || netNum === 0) continue;

    // Compute gross dividend and withholding tax
    let grossAmount: string;
    let taxAmount = "0";

    if (effectiveWhtCol >= 0) {
      // Absolute WHT amount column available
      const whtRaw = (row[effectiveWhtCol] ?? "0").trim();
      const whtNum = parseFloat(parseNumber(whtRaw));

      if (!isNaN(whtNum) && whtNum !== 0) {
        const absWht = Math.abs(whtNum);
        grossAmount = (netNum + absWht).toFixed(4);
        taxAmount = whtNum > 0 ? `-${whtNum}` : `${whtNum}`;
      } else {
        grossAmount = netAmount;
      }
    } else if (whtRateCol >= 0) {
      // Fall back to percentage rate column
      const pctRaw = (row[whtRateCol] ?? "0").replace(/%/g, "").trim();
      const pctNum = parseFloat(parseNumber(pctRaw));
      if (!isNaN(pctNum) && pctNum > 0) {
        const grossNum = netNum / (1 - pctNum / 100);
        grossAmount = grossNum.toFixed(4);
        taxAmount = `-${(grossNum * (pctNum / 100)).toFixed(4)}`;
      } else {
        grossAmount = netAmount;
      }
    } else {
      grossAmount = netAmount;
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

function parseAccountActivity(xlsx: typeof import("xlsx"), sheet: WorkSheet): CashTransaction[] {
  const rows = sheetToRows(xlsx, sheet);
  if (rows.length < 2) return [];

  const headers = rows[0]!;
  const dateCol = findColumn(headers, ACTIVITY_DATE_HEADERS);
  const typeCol = findColumn(headers, ACTIVITY_TYPE_HEADERS);
  const amountCol = findColumn(headers, ACTIVITY_AMOUNT_HEADERS);

  if (dateCol < 0 || typeCol < 0 || amountCol < 0) return [];

  const cashTransactions: CashTransaction[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (!row.length) continue;

    const typeStr = (row[typeCol] ?? "").toLowerCase().trim();
    // Only capture interest payments
    if (!typeStr.includes("interest") && !typeStr.includes("intereses")) continue;

    const dateStr = (row[dateCol] ?? "").trim();
    if (!dateStr) continue;

    const tradeDate = parseEtoroDate(dateStr);
    const amountStr = (row[amountCol] ?? "0").trim();
    const amountNum = parseFloat(parseNumber(amountStr));
    if (isNaN(amountNum) || amountNum === 0) continue;

    cashTransactions.push({
      transactionID: `etoro-interest-${tradeDate}-${i}`,
      accountId: "",
      symbol: "CASH",
      description: "Interest Payment",
      isin: "",
      currency: "USD", // eToro pays interest in USD regardless of interface language
      dateTime: tradeDate,
      settleDate: tradeDate,
      amount: `${amountNum}`,
      fxRateToBase: "1",
      type: "Broker Interest Received",
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
  const wb = xlsx.read(data, { type: "buffer" });

  const closedSheet = getSheet(wb, ["closed positions", "posiciones cerradas"]);
  const dividendSheet = getSheet(wb, ["dividends", "dividendos"]);
  const activitySheet = getSheet(wb, ["account activity", "actividad de la cuenta"]);

  const trades = closedSheet ? parseClosedPositions(xlsx, closedSheet) : [];
  const dividends = dividendSheet ? parseDividends(xlsx, dividendSheet) : [];
  const interest = activitySheet ? parseAccountActivity(xlsx, activitySheet) : [];

  return {
    accountId: "",
    fromDate: "",
    toDate: "",
    period: "",
    trades,
    cashTransactions: [...dividends, ...interest],
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
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

    // Text mode: parse as tab-separated or comma-separated sections
    // This is a fallback — primary path is parseEtoroXlsx for binary XLSX
    const lines = input.split(/\r?\n/);

    // Try to find section markers
    const trades: Trade[] = [];
    const cashTransactions: CashTransaction[] = [];

    let currentSection = "";
    let sectionHeaders: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Detect section headers
      const lower = trimmed.toLowerCase();
      if (lower.includes("closed position") || lower.includes("posiciones cerradas")) {
        currentSection = "trades";
        continue;
      }
      if (lower.includes("dividend")) {
        currentSection = "dividends";
        continue;
      }

      // Detect column headers
      if (currentSection && !sectionHeaders.length) {
        const delimiter = trimmed.includes("\t") ? "\t" : ",";
        sectionHeaders = trimmed.split(delimiter).map((h) => h.trim());
        continue;
      }
    }

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
    };
  },
};
