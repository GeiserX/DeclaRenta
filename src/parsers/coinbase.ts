/**
 * Coinbase CSV parser.
 *
 * Parses Coinbase's "Transaction History" CSV export into a normalized Statement.
 * Supports comma-delimited format with US number formatting.
 *
 * CSV format: 10 columns
 * Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes
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

const COINBASE_HEADERS = ["transaction type", "spot price", "quantity transacted"];

function isCoinbaseCsv(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return COINBASE_HEADERS.every((h) => lower.includes(h));
}

// ---------------------------------------------------------------------------
// Column resolution
// ---------------------------------------------------------------------------

interface CoinbaseColumns {
  timestamp: number;
  transactionType: number;
  asset: number;
  quantity: number;
  spotCurrency: number;
  spotPrice: number;
  subtotal: number;
  total: number;
  fees: number;
  notes: number;
}

function resolveColumns(headers: string[]): CoinbaseColumns {
  return {
    timestamp: findColumn(headers, ["timestamp"]),
    transactionType: findColumn(headers, ["transaction type"]),
    asset: findColumn(headers, ["asset"]),
    quantity: findColumn(headers, ["quantity transacted"]),
    spotCurrency: findColumn(headers, ["spot price currency"]),
    spotPrice: findColumn(headers, ["spot price at transaction"]),
    subtotal: findColumn(headers, ["subtotal"]),
    total: findColumn(headers, ["total (inclusive of fees and/or spread)", "total"]),
    fees: findColumn(headers, ["fees and/or spread", "fees"]),
    notes: findColumn(headers, ["notes"]),
  };
}

// ---------------------------------------------------------------------------
// Date conversion
// ---------------------------------------------------------------------------

/** Convert ISO-8601 timestamp (e.g. "2024-03-15T10:30:00Z") to YYYYMMDD */
function convertTimestamp(ts: string): string {
  const trimmed = ts.trim();
  // Match YYYY-MM-DD at the start (works for both "2024-03-15" and "2024-03-15T10:30:00Z")
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return trimmed;
  return `${match[1]}${match[2]}${match[3]}`;
}

// ---------------------------------------------------------------------------
// Transaction type classification
// ---------------------------------------------------------------------------

const SKIP_TYPES = ["send", "receive"];
const INCOME_TYPES = ["staking income", "rewards income", "learning reward"];

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseCoinbaseCsv(lines: string[]): Statement {
  const headers = parseCsvLine(lines[0]!, ",");
  const cols = resolveColumns(headers);

  if (cols.timestamp < 0 || cols.transactionType < 0 || cols.asset < 0) {
    throw new Error("Coinbase CSV: faltan columnas obligatorias (Timestamp, Transaction Type, Asset)");
  }

  const trades: Trade[] = [];
  const cashTransactions: CashTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, ",");

    const timestamp = (fields[cols.timestamp] ?? "").trim();
    const txType = (fields[cols.transactionType] ?? "").trim().toLowerCase();
    const asset = (fields[cols.asset] ?? "").trim();
    const quantity = parseNumber(fields[cols.quantity] ?? "0");
    const spotCurrency = (fields[cols.spotCurrency] ?? "EUR").trim();
    const spotPrice = parseNumber(fields[cols.spotPrice] ?? "0");
    const subtotal = parseNumber(fields[cols.subtotal] ?? "0");
    const total = parseNumber(fields[cols.total] ?? "0");
    const fees = parseNumber(fields[cols.fees] ?? "0");
    const notes = cols.notes >= 0 ? (fields[cols.notes] ?? "").trim() : "";

    if (!asset || !timestamp) continue;

    const tradeDate = convertTimestamp(timestamp);

    // Skip non-taxable transfers
    if (SKIP_TYPES.includes(txType)) continue;

    // Income transactions → cash transactions (dividends)
    if (INCOME_TYPES.includes(txType)) {
      cashTransactions.push({
        transactionID: `coinbase-${txType.replace(/\s+/g, "-")}-${tradeDate}-${asset}-${i}`,
        accountId: "",
        symbol: asset,
        description: `${txType} - ${asset}${notes ? ` (${notes})` : ""}`,
        isin: "",
        currency: spotCurrency || "EUR",
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: total || subtotal,
        fxRateToBase: "1",
        type: "Dividends",
      });
      continue;
    }

    // Convert → two trades: sell old asset, buy new asset
    if (txType === "convert") {
      // The Notes field typically contains "Converted X ASSET1 to Y ASSET2"
      const convertMatch = notes.match(/Converted\s+[\d.,]+\s+\w+\s+to\s+([\d.,]+)\s+(\w+)/i);

      const quantityDec = new Decimal(quantity || "0").abs();
      const feeDec = new Decimal(fees || "0");

      // Close (sell) the source asset
      trades.push({
        tradeID: `coinbase-convert-sell-${tradeDate}-${asset}-${i}`,
        accountId: "",
        symbol: asset,
        description: `Convert ${asset}${convertMatch ? ` to ${convertMatch[2]}` : ""}`,
        isin: "",
        assetCategory: "CRYPTO",
        currency: spotCurrency || "EUR",
        tradeDate,
        settlementDate: tradeDate,
        quantity: quantityDec.neg().toString(),
        tradePrice: spotPrice,
        tradeMoney: subtotal,
        proceeds: subtotal,
        cost: "0",
        fifoPnlRealized: "0",
        fxRateToBase: "1",
        buySell: "SELL",
        openCloseIndicator: "C",
        exchange: "COINBASE",
        commissionCurrency: spotCurrency || "EUR",
        commission: feeDec.isZero() ? "0" : feeDec.abs().neg().toString(),
        taxes: "0",
        multiplier: "1",
      });

      // Open (buy) the destination asset
      if (convertMatch) {
        const destAsset = convertMatch[2]!;
        const destQuantityDec = new Decimal(parseNumber(convertMatch[1]!)).abs();
        const subtotalDec = new Decimal(subtotal || "0").abs();
        const destPrice = destQuantityDec.isZero() ? "0" : subtotalDec.div(destQuantityDec).toString();

        trades.push({
          tradeID: `coinbase-convert-buy-${tradeDate}-${destAsset}-${i}`,
          accountId: "",
          symbol: destAsset,
          description: `Convert ${asset} to ${destAsset}`,
          isin: "",
          assetCategory: "CRYPTO",
          currency: spotCurrency || "EUR",
          tradeDate,
          settlementDate: tradeDate,
          quantity: destQuantityDec.toString(),
          tradePrice: destPrice,
          tradeMoney: subtotal,
          proceeds: "0",
          cost: subtotal,
          fifoPnlRealized: "0",
          fxRateToBase: "1",
          buySell: "BUY",
          openCloseIndicator: "O",
          exchange: "COINBASE",
          commissionCurrency: spotCurrency || "EUR",
          commission: "0",
          taxes: "0",
          multiplier: "1",
        });
      }
      continue;
    }

    // Buy / Sell trades
    const isSell = txType === "sell";
    const isBuy = txType === "buy";
    if (!isSell && !isBuy) continue;

    const qtyDec = new Decimal(quantity || "0").abs();
    if (qtyDec.isZero()) continue;

    const feeDec2 = new Decimal(fees || "0");

    trades.push({
      tradeID: `coinbase-${txType}-${tradeDate}-${asset}-${i}`,
      accountId: "",
      symbol: asset,
      description: `${txType.charAt(0).toUpperCase() + txType.slice(1)} ${asset}`,
      isin: "",
      assetCategory: "CRYPTO",
      currency: spotCurrency || "EUR",
      tradeDate,
      settlementDate: tradeDate,
      quantity: isSell ? qtyDec.neg().toString() : qtyDec.toString(),
      tradePrice: spotPrice,
      tradeMoney: total,
      proceeds: isSell ? subtotal : "0",
      cost: isSell ? "0" : subtotal,
      fifoPnlRealized: "0",
      fxRateToBase: "1",
      buySell: isSell ? "SELL" : "BUY",
      openCloseIndicator: isSell ? "C" : "O",
      exchange: "COINBASE",
      commissionCurrency: spotCurrency || "EUR",
      commission: feeDec2.isZero() ? "0" : feeDec2.abs().neg().toString(),
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

export const coinbaseParser: BrokerParser = {
  name: "Coinbase",
  formats: ["CSV"],

  detect(input: string): boolean {
    const firstLine = stripBom(input).split(/\r?\n/)[0] ?? "";
    return isCoinbaseCsv(firstLine);
  },

  parse(input: string): Statement {
    const cleaned = stripBom(input);
    const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error("Coinbase CSV: fichero vacio o sin datos");
    }

    if (!isCoinbaseCsv(lines[0]!)) {
      throw new Error("Coinbase CSV: formato no reconocido");
    }

    return parseCoinbaseCsv(lines);
  },
};
