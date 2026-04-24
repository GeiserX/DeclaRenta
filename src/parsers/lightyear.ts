/**
 * Lightyear CSV parser.
 *
 * Parses Lightyear's "Transaction report" CSV export into a normalized Statement.
 * Lightyear is an Estonian neobroker (FSA license #4.1-1/20) that does NOT
 * report to AEAT — users must declare gains/dividends manually.
 *
 * CSV format (real export):
 * Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.
 *
 * Transaction types:
 * - Buy / Sell: stock/ETF trades (including money market funds like BRICEKSP, ICSUSSDP)
 * - Dividend: dividend payments (Tax Amt. contains withholding tax)
 * - Distribution: ETF distributions (Fee deducted, Tax Amt. for withholding)
 * - Interest: interest income (no ticker/ISIN)
 * - Reward: cash rewards (no ticker/ISIN)
 * - Conversion: FX conversions (skipped — not taxable events)
 * - Deposit / Withdrawal: cash movements (skipped)
 *
 * Limitations:
 * - No open positions in CSV — Modelo 720/D-6 cannot be generated from this alone.
 * - FX Rate is Lightyear's own rate, not ECB — the FIFO engine fetches ECB rates independently.
 * - Distributions are treated as dividends (casilla 0029) with withholding (casilla 0588).
 */

import Decimal from "decimal.js";
import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import {
  parseCsvLine,
  parseNumber,
  findColumn,
  stripBom,
} from "./csv-utils.js";

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

/** Lightyear CSV: "Date,Reference,Ticker,ISIN,Type,...,CCY,...,Net Amt." */
const LIGHTYEAR_REQUIRED = ["reference", "ticker", "isin", "type", "ccy", "net amt."];

function isLightyearCsv(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return LIGHTYEAR_REQUIRED.every((h) => lower.includes(h));
}

// ---------------------------------------------------------------------------
// Column resolution
// ---------------------------------------------------------------------------

interface LightyearColumns {
  date: number;
  reference: number;
  ticker: number;
  isin: number;
  type: number;
  quantity: number;
  ccy: number;
  pricePerShare: number;
  grossAmount: number;
  fxRate: number;
  fee: number;
  netAmount: number;
  taxAmount: number;
}

function resolveColumns(headers: string[]): LightyearColumns {
  return {
    date: findColumn(headers, ["date"]),
    reference: findColumn(headers, ["reference"]),
    ticker: findColumn(headers, ["ticker"]),
    isin: findColumn(headers, ["isin"]),
    type: findColumn(headers, ["type"]),
    quantity: findColumn(headers, ["quantity"]),
    ccy: findColumn(headers, ["ccy", "currency"]),
    pricePerShare: findColumn(headers, ["price/share", "price per share", "price"]),
    grossAmount: findColumn(headers, ["gross amount"]),
    fxRate: findColumn(headers, ["fx rate"]),
    fee: findColumn(headers, ["fee"]),
    netAmount: findColumn(headers, ["net amt.", "net amount", "net amt"]),
    taxAmount: findColumn(headers, ["tax amt.", "tax amount", "tax amt"]),
  };
}

// ---------------------------------------------------------------------------
// Date conversion
// ---------------------------------------------------------------------------

/** Convert "DD/MM/YYYY HH:MM:SS" to YYYYMMDD */
function convertLightyearDate(dateStr: string): string {
  const trimmed = dateStr.trim();
  // DD/MM/YYYY (with optional time)
  const match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) return `${match[3]}${match[2]}${match[1]}`;
  // Fallback: YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
  return trimmed.replace(/[-/]/g, "").slice(0, 8);
}

// ---------------------------------------------------------------------------
// Transaction type classification
// ---------------------------------------------------------------------------

const SKIP_TYPES = new Set(["deposit", "withdrawal", "conversion"]);
const DIVIDEND_TYPES = new Set(["dividend", "distribution"]);
const INCOME_TYPES = new Set(["interest", "reward"]);

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseLightyearCsv(lines: string[]): Statement {
  const headers = parseCsvLine(lines[0]!, ",");
  const cols = resolveColumns(headers);

  if (cols.date < 0 || cols.type < 0 || cols.ccy < 0) {
    throw new Error("Lightyear CSV: faltan columnas obligatorias (Date, Type, CCY)");
  }

  const trades: Trade[] = [];
  const cashTransactions: CashTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, ",");

    const dateRaw = (fields[cols.date] ?? "").trim();
    const reference = (fields[cols.reference] ?? "").trim();
    const ticker = (fields[cols.ticker] ?? "").trim();
    const isin = (fields[cols.isin] ?? "").trim();
    const txType = (fields[cols.type] ?? "").trim().toLowerCase();
    const quantityStr = parseNumber(fields[cols.quantity] ?? "0");
    const currency = (fields[cols.ccy] ?? "EUR").trim();
    const pricePerShare = parseNumber(fields[cols.pricePerShare] ?? "0");
    const grossAmount = parseNumber(fields[cols.grossAmount] ?? "0");
    const fee = parseNumber(fields[cols.fee] ?? "0");
    const netAmount = parseNumber(fields[cols.netAmount] ?? "0");
    const taxAmount = parseNumber(fields[cols.taxAmount] ?? "0");

    if (!dateRaw) continue;
    const tradeDate = convertLightyearDate(dateRaw);

    // Skip non-taxable transactions
    if (SKIP_TYPES.has(txType)) continue;

    // Dividends and distributions → cash transactions
    if (DIVIDEND_TYPES.has(txType)) {
      if (!ticker) continue;

      const grossDec = new Decimal(grossAmount).abs();
      // Gross dividend
      cashTransactions.push({
        transactionID: `lightyear-${txType}-${reference || `${tradeDate}-${ticker}-${i}`}`,
        accountId: "",
        symbol: ticker,
        description: `${txType === "distribution" ? "Distribution" : "Dividend"} - ${ticker}`,
        isin,
        currency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: grossDec.toString(),
        fxRateToBase: "1",
        type: "Dividends",
      });

      // Withholding tax (if present)
      const taxDec = new Decimal(taxAmount);
      if (!taxDec.isZero()) {
        cashTransactions.push({
          transactionID: `lightyear-tax-${reference || `${tradeDate}-${ticker}-${i}`}`,
          accountId: "",
          symbol: ticker,
          description: `Withholding tax - ${ticker}`,
          isin,
          currency,
          dateTime: tradeDate,
          settleDate: tradeDate,
          amount: taxDec.neg().abs().neg().toString(),
          fxRateToBase: "1",
          type: "Withholding Tax",
        });
      }
      continue;
    }

    // Interest and Reward → cash transactions (income)
    if (INCOME_TYPES.has(txType)) {
      const amountDec = new Decimal(netAmount || grossAmount).abs();
      if (amountDec.isZero()) continue;
      cashTransactions.push({
        transactionID: `lightyear-${txType}-${reference || `${tradeDate}-${i}`}`,
        accountId: "",
        symbol: ticker || txType.toUpperCase(),
        description: `${txType.charAt(0).toUpperCase() + txType.slice(1)}${ticker ? ` - ${ticker}` : ""}`,
        isin,
        currency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: amountDec.toString(),
        fxRateToBase: "1",
        type: "Broker Interest Received",
      });
      continue;
    }

    // Buy / Sell trades
    const isSell = txType === "sell";
    const isBuy = txType === "buy";
    if (!isSell && !isBuy) continue;
    if (!ticker) continue;

    const qtyDec = new Decimal(quantityStr).abs();
    if (qtyDec.isZero()) continue;

    const feeDec = new Decimal(fee);
    const grossDec = new Decimal(grossAmount).abs();
    const price = pricePerShare || (qtyDec.isZero() ? "0" : grossDec.div(qtyDec).toString());

    trades.push({
      tradeID: `lightyear-${txType}-${reference || `${tradeDate}-${ticker}-${i}`}`,
      accountId: "",
      symbol: ticker,
      description: `${isSell ? "Sell" : "Buy"} ${ticker}`,
      isin,
      assetCategory: "STK",
      currency,
      tradeDate,
      settlementDate: tradeDate,
      quantity: isSell ? qtyDec.neg().toString() : qtyDec.toString(),
      tradePrice: price,
      tradeMoney: isSell ? grossDec.toString() : grossDec.neg().toString(),
      proceeds: isSell ? grossDec.toString() : "0",
      cost: isSell ? "0" : grossDec.neg().toString(),
      fifoPnlRealized: "0",
      fxRateToBase: "1",
      buySell: isSell ? "SELL" : "BUY",
      openCloseIndicator: isSell ? "C" : "O",
      exchange: "LIGHTYEAR",
      commissionCurrency: currency,
      commission: feeDec.isZero() ? "0" : feeDec.abs().neg().toString(),
      taxes: "0",
      multiplier: "1",
    });
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
}

// ---------------------------------------------------------------------------
// Public BrokerParser
// ---------------------------------------------------------------------------

export const lightyearParser: BrokerParser = {
  name: "Lightyear",
  formats: ["CSV"],

  detect(input: string): boolean {
    const lines = stripBom(input).split(/\r?\n/);
    return lines.slice(0, 10).some((l) => isLightyearCsv(l));
  },

  parse(input: string): Statement {
    const cleaned = stripBom(input);
    const allLines = cleaned.split(/\r?\n/);
    const headerIdx = allLines.findIndex((l) => isLightyearCsv(l));
    if (headerIdx === -1) {
      const hasContent = allLines.some((l) => l.trim());
      throw new Error(hasContent ? "Lightyear CSV: formato no reconocido" : "Lightyear CSV: fichero vacío o sin datos");
    }
    const lines = allLines.slice(headerIdx).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error("Lightyear CSV: fichero vacío o sin datos");
    }

    return parseLightyearCsv(lines);
  },
};
