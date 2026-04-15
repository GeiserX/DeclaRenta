/**
 * Binance CSV parser.
 *
 * Parses Binance's trade history CSV export into a normalized Statement.
 *
 * CSV format:
 * Date(UTC),Pair,Side,Price,Executed,Amount,Fee
 *
 * Pair format: "BTCEUR" -- base asset concatenated with quote currency.
 * Fee format: "0.001BTC" -- numeric value followed by asset code.
 */

import Decimal from "decimal.js";
import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade } from "../types/ibkr.js";
import { parseCsvLine, stripBom } from "./csv-utils.js";

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

const BINANCE_HEADERS = ["date(utc)", "pair", "side", "price"];

function isBinanceCsv(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return BINANCE_HEADERS.every((h) => lower.includes(h));
}

// ---------------------------------------------------------------------------
// Column resolution
// ---------------------------------------------------------------------------

interface BinanceColumns {
  date: number;
  pair: number;
  side: number;
  price: number;
  executed: number;
  amount: number;
  fee: number;
}

function resolveColumns(headers: string[]): BinanceColumns {
  const lower = headers.map((h) => h.toLowerCase().trim());
  return {
    date: lower.indexOf("date(utc)"),
    pair: lower.indexOf("pair"),
    side: lower.indexOf("side"),
    price: lower.indexOf("price"),
    executed: lower.indexOf("executed"),
    amount: lower.indexOf("amount"),
    fee: lower.indexOf("fee"),
  };
}

// ---------------------------------------------------------------------------
// Pair parsing: "BTCEUR" -> { symbol: "BTC", currency: "EUR" }
// ---------------------------------------------------------------------------

const KNOWN_QUOTES = ["EUR", "USD", "USDT", "USDC", "BUSD", "BTC", "ETH", "BNB", "GBP"];

function parsePair(pair: string): { symbol: string; currency: string } {
  const upper = pair.trim().toUpperCase();

  // Try known quote currencies from longest to shortest for correct matching
  const sorted = [...KNOWN_QUOTES].sort((a, b) => b.length - a.length);
  for (const quote of sorted) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return {
        symbol: upper.slice(0, -quote.length),
        currency: quote,
      };
    }
  }

  // Fallback: assume last 3 chars are currency
  if (upper.length > 3) {
    return {
      symbol: upper.slice(0, -3),
      currency: upper.slice(-3),
    };
  }

  return { symbol: upper, currency: "EUR" };
}

// ---------------------------------------------------------------------------
// Fee parsing: "0.001BTC" -> { amount: "0.001", asset: "BTC" }
// ---------------------------------------------------------------------------

function parseFee(feeStr: string): { amount: string; asset: string } {
  const trimmed = feeStr.trim();
  if (!trimmed) return { amount: "0", asset: "" };

  const match = trimmed.match(/^([0-9.]+)([A-Za-z]+)$/);
  if (match) {
    return { amount: match[1]!, asset: match[2]!.toUpperCase() };
  }

  // Try pure numeric
  const numMatch = trimmed.match(/^[0-9.]+$/);
  if (numMatch) {
    return { amount: trimmed, asset: "" };
  }

  return { amount: "0", asset: "" };
}

// ---------------------------------------------------------------------------
// Date conversion: "2025-01-15 10:30:00" -> "20250115"
// ---------------------------------------------------------------------------

function convertBinanceDate(dateStr: string): string {
  const trimmed = dateStr.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}${match[2]}${match[3]}`;
  }
  return trimmed.replace(/-/g, "").slice(0, 8);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseBinanceCsv(lines: string[]): Statement {
  const headers = parseCsvLine(lines[0]!, ",");
  const cols = resolveColumns(headers);

  if (cols.date < 0 || cols.pair < 0 || cols.side < 0 || cols.price < 0) {
    throw new Error("Binance CSV: faltan columnas obligatorias (Date(UTC), Pair, Side, Price)");
  }

  const trades: Trade[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, ",");

    const dateStr = (fields[cols.date] ?? "").trim();
    const tradeDate = convertBinanceDate(dateStr);

    const pairStr = (fields[cols.pair] ?? "").trim();
    const { symbol, currency } = parsePair(pairStr);

    const sideLower = (fields[cols.side] ?? "").trim().toLowerCase();
    if (sideLower !== "buy" && sideLower !== "sell") continue;
    const isBuy = sideLower === "buy";

    const price = new Decimal((fields[cols.price] ?? "0").trim() || "0");
    const executed = new Decimal((fields[cols.executed] ?? "0").trim() || "0");
    const amount = new Decimal((fields[cols.amount] ?? "0").trim() || "0");

    const fee = parseFee((fields[cols.fee] ?? "").trim());
    const feeAmount = new Decimal(fee.amount || "0");

    trades.push({
      tradeID: `binance-${tradeDate}-${symbol}-${i}`,
      accountId: "",
      symbol,
      description: `${symbol}/${currency} ${sideLower.toUpperCase()}`,
      isin: symbol,
      assetCategory: "CRYPTO",
      currency,
      tradeDate,
      settlementDate: tradeDate,
      quantity: isBuy ? executed.toString() : executed.neg().toString(),
      tradePrice: price.toString(),
      tradeMoney: isBuy ? amount.neg().toString() : amount.toString(),
      proceeds: isBuy ? "0" : amount.toString(),
      cost: isBuy ? amount.toString() : "0",
      fifoPnlRealized: "0",
      fxRateToBase: currency === "EUR" ? "1" : "1",
      buySell: isBuy ? "BUY" : "SELL",
      openCloseIndicator: isBuy ? "O" : "C",
      exchange: "BINANCE",
      commissionCurrency: fee.asset || currency,
      commission: feeAmount.isZero() ? "0" : feeAmount.neg().toString(),
      taxes: "0",
      multiplier: "1",
      brokerSource: "Binance",
    });
  }

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

// ---------------------------------------------------------------------------
// Public BrokerParser
// ---------------------------------------------------------------------------

export const binanceParser: BrokerParser = {
  name: "Binance",
  formats: ["CSV"],

  detect(input: string): boolean {
    const firstLine = stripBom(input).split(/\r?\n/)[0] ?? "";
    return isBinanceCsv(firstLine);
  },

  parse(input: string): Statement {
    const cleaned = stripBom(input);
    const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error("Binance CSV: fichero vacio o sin datos");
    }

    const headerLine = lines[0]!;
    if (!isBinanceCsv(headerLine)) {
      throw new Error("Binance CSV: formato no reconocido");
    }

    return parseBinanceCsv(lines);
  },
};
