/**
 * Trading 212 CSV parser.
 *
 * Parses Trading 212's "History → Transactions" CSV export into a normalized Statement.
 * Trading 212 is a Bulgarian neobroker (FSC Bulgaria license) that does NOT
 * report to AEAT — users must declare gains/dividends manually.
 *
 * CSV format (real export):
 * Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Notes,ID
 *
 * Action types:
 * - Market buy / Limit buy / Stop buy → BUY trade
 * - Market sell / Limit sell / Stop sell → SELL trade
 * - Dividend (Ordinary) / Dividend (Dividend) → cash transaction (dividend)
 * - Dividend (Dividend tax) → cash transaction (Withholding Tax)
 * - Interest on cash → cash transaction (interest)
 * - Deposit / Withdrawal / Currency conversion / Card debit / Spending cashback → skipped
 *
 * Limitations:
 * - No open positions in CSV — Modelo 720/D-6 cannot be generated from this alone.
 * - Exchange rate column is Trading 212's own rate, not ECB — the FIFO engine fetches ECB rates independently.
 * - Trading 212 is zero-commission (spread-based) — commission is always 0.
 */

import Decimal from "decimal.js";
import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import { parseCsvLine, parseNumber, findColumn, stripBom } from "./csv-utils.js";

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

/** Trading 212 CSV required headers */
const TRADING212_REQUIRED = ["action", "time", "isin", "ticker", "no. of shares", "price / share"];

function isTrading212Csv(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return TRADING212_REQUIRED.every((h) => lower.includes(h));
}

// ---------------------------------------------------------------------------
// Column resolution
// ---------------------------------------------------------------------------

interface Trading212Columns {
  action: number;
  time: number;
  isin: number;
  ticker: number;
  name: number;
  shares: number;
  pricePerShare: number;
  priceCurrency: number;
  exchangeRate: number;
  total: number;
  totalCurrency: number;
  id: number;
}

function resolveColumns(headers: string[]): Trading212Columns {
  return {
    action: findColumn(headers, ["action"]),
    time: findColumn(headers, ["time"]),
    isin: findColumn(headers, ["isin"]),
    ticker: findColumn(headers, ["ticker"]),
    name: findColumn(headers, ["name"]),
    shares: findColumn(headers, ["no. of shares"]),
    pricePerShare: findColumn(headers, ["price / share"]),
    priceCurrency: findColumn(headers, ["currency (price / share)"]),
    exchangeRate: findColumn(headers, ["exchange rate"]),
    total: findColumn(headers, ["total"]),
    totalCurrency: findColumn(headers, ["currency (total)"]),
    id: findColumn(headers, ["id"]),
  };
}

// ---------------------------------------------------------------------------
// Date conversion
// ---------------------------------------------------------------------------

/** Convert "YYYY-MM-DD HH:MM:SS" to YYYYMMDD */
function convertTrading212Date(dateStr: string): string {
  const trimmed = dateStr.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}${match[2]}${match[3]}`;
  throw new Error(`Trading 212 CSV: formato de fecha no reconocido: "${trimmed}"`);
}

// ---------------------------------------------------------------------------
// Action type classification
// ---------------------------------------------------------------------------

function isBuyAction(action: string): boolean {
  return /buy/i.test(action);
}

function isSellAction(action: string): boolean {
  return /sell/i.test(action);
}

function isDividendTaxAction(action: string): boolean {
  return /dividend.*tax/i.test(action);
}

function isDividendAction(action: string): boolean {
  return /dividend/i.test(action);
}

function isInterestAction(action: string): boolean {
  return /interest on cash/i.test(action);
}

function isSkippedAction(action: string): boolean {
  return /deposit|withdrawal|currency conversion|card debit|spending cashback/i.test(action);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseTrading212Csv(lines: string[]): Statement {
  const headers = parseCsvLine(lines[0]!, ",");
  const cols = resolveColumns(headers);

  if (cols.action < 0 || cols.time < 0) {
    throw new Error("Trading 212 CSV: faltan columnas obligatorias (Action, Time)");
  }

  const trades: Trade[] = [];
  const cashTransactions: CashTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, ",");

    const action = (fields[cols.action] ?? "").trim();
    const timeRaw = (fields[cols.time] ?? "").trim();
    const isin = (fields[cols.isin] ?? "").trim();
    const ticker = (fields[cols.ticker] ?? "").trim();
    const name = (fields[cols.name] ?? "").trim();
    const sharesStr = parseNumber(fields[cols.shares] ?? "0");
    const priceStr = parseNumber(fields[cols.pricePerShare] ?? "0");
    const currency = (fields[cols.priceCurrency] ?? "").trim() || "EUR";
    // Currency (Total) is authoritative for cash transaction amounts: in EUR-primary accounts
    // the Total column holds the credited EUR amount, not the instrument's native currency.
    const cashCurrency = (fields[cols.totalCurrency] ?? "").trim() || currency;
    const totalStr = parseNumber(fields[cols.total] ?? "0");
    const txId = (fields[cols.id] ?? "").trim();

    if (!timeRaw) continue;
    const tradeDate = convertTrading212Date(timeRaw);

    if (isSkippedAction(action)) continue;

    const uniqueId = txId || `${tradeDate}-${ticker || action}-${i}`;

    // Withholding tax on dividend — must be checked before the generic dividend branch
    if (isDividendTaxAction(action)) {
      if (!ticker) continue;
      const amountDec = new Decimal(totalStr).abs();
      if (amountDec.isZero()) continue;

      cashTransactions.push({
        transactionID: `trading212-tax-${uniqueId}`,
        accountId: "",
        symbol: ticker,
        description: `Withholding tax - ${ticker}`,
        isin,
        currency: cashCurrency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: amountDec.neg().toString(),
        fxRateToBase: "1",
        type: "Withholding Tax",
      });
      continue;
    }

    // Dividends
    if (isDividendAction(action)) {
      if (!ticker) continue;
      const amountDec = new Decimal(totalStr).abs();
      if (amountDec.isZero()) continue;

      cashTransactions.push({
        transactionID: `trading212-div-${uniqueId}`,
        accountId: "",
        symbol: ticker,
        description: `Dividend - ${ticker}`,
        isin,
        currency: cashCurrency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: amountDec.toString(),
        fxRateToBase: "1",
        type: "Dividends",
      });
      continue;
    }

    // Interest on cash
    if (isInterestAction(action)) {
      const amountDec = new Decimal(totalStr).abs();
      if (amountDec.isZero()) continue;

      cashTransactions.push({
        transactionID: `trading212-interest-${uniqueId}`,
        accountId: "",
        symbol: "CASH",
        description: "Interest on cash",
        isin: "",
        currency: cashCurrency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: amountDec.toString(),
        fxRateToBase: "1",
        type: "Broker Interest Received",
      });
      continue;
    }

    // Buy / Sell trades
    const buy = isBuyAction(action);
    const sell = isSellAction(action);
    if (!buy && !sell) continue;
    if (!ticker) continue;

    const qtyDec = new Decimal(sharesStr).abs();
    if (qtyDec.isZero()) continue;

    const priceDec = new Decimal(priceStr);
    const grossDec = priceDec.isZero()
      ? new Decimal(totalStr).abs()
      : qtyDec.times(priceDec);

    trades.push({
      tradeID: `trading212-${buy ? "buy" : "sell"}-${uniqueId}`,
      accountId: "",
      symbol: ticker,
      description: name || `${buy ? "Buy" : "Sell"} ${ticker}`,
      isin,
      assetCategory: "STK",
      currency,
      tradeDate,
      settlementDate: tradeDate,
      quantity: sell ? qtyDec.neg().toString() : qtyDec.toString(),
      tradePrice: priceDec.toString(),
      tradeMoney: sell ? grossDec.toString() : grossDec.neg().toString(),
      proceeds: sell ? grossDec.toString() : "0",
      cost: sell ? "0" : grossDec.neg().toString(),
      fifoPnlRealized: "0",
      fxRateToBase: "1",
      buySell: sell ? "SELL" : "BUY",
      openCloseIndicator: sell ? "C" : "O",
      exchange: "TRADING212",
      commissionCurrency: currency,
      commission: "0",
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

export const trading212Parser: BrokerParser = {
  name: "Trading 212",
  formats: ["CSV"],

  detect(input: string): boolean {
    const lines = stripBom(input).split(/\r?\n/);
    return lines.slice(0, 10).some((l) => isTrading212Csv(l));
  },

  parse(input: string): Statement {
    const cleaned = stripBom(input);
    const allLines = cleaned.split(/\r?\n/);
    const headerIdx = allLines.findIndex((l) => isTrading212Csv(l));
    if (headerIdx === -1) {
      const hasContent = allLines.some((l) => l.trim());
      throw new Error(hasContent ? "Trading 212 CSV: formato no reconocido" : "Trading 212 CSV: fichero vacío o sin datos");
    }
    const lines = allLines.slice(headerIdx).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error("Trading 212 CSV: fichero vacío o sin datos");
    }

    return parseTrading212Csv(lines);
  },
};
