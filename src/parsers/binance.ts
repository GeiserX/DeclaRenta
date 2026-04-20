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

/** Trade History format: Date(UTC),Pair,Side,Price,Executed,Amount,Fee */
const BINANCE_TRADE_HEADERS = ["date(utc)", "pair", "side", "price"];
/** Transaction History format: User_ID,UTC_Time,Account,Operation,Coin,Change,Remark */
const BINANCE_TX_HEADERS = ["utc_time", "operation", "coin", "change"];

function isBinanceTradeCsv(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return BINANCE_TRADE_HEADERS.every((h) => lower.includes(h));
}

function isBinanceTxCsv(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return BINANCE_TX_HEADERS.every((h) => lower.includes(h));
}

function isBinanceCsv(headerLine: string): boolean {
  return isBinanceTradeCsv(headerLine) || isBinanceTxCsv(headerLine);
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

const KNOWN_QUOTES = ["FDUSD", "USDT", "USDC", "BUSD", "EUR", "USD", "BTC", "ETH", "BNB", "GBP", "TRY", "BRL", "ARS"];

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

  throw new Error(`Binance CSV: par no soportado o ambiguo: ${pair}`);
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

// ---------------------------------------------------------------------------
// Transaction History parser (User_ID,UTC_Time,Account,Operation,Coin,Change)
// ---------------------------------------------------------------------------

interface BinanceTxColumns {
  utcTime: number;
  account: number;
  operation: number;
  coin: number;
  change: number;
  remark: number;
}

function resolveTxColumns(headers: string[]): BinanceTxColumns {
  const lower = headers.map((h) => h.toLowerCase().trim());
  return {
    utcTime: lower.indexOf("utc_time"),
    account: lower.indexOf("account"),
    operation: lower.indexOf("operation"),
    coin: lower.indexOf("coin"),
    change: lower.indexOf("change"),
    remark: lower.indexOf("remark"),
  };
}

/** Skip these operations — internal transfers, not taxable events */
const TX_SKIP_OPS = new Set([
  "deposit", "withdraw",
  "transfer between main and funding wallet",
  "transfer between spot and strategy account",
  "transfer between main and trading account",
]);

interface TxRow {
  utcTime: string;
  tradeDate: string;
  operation: string;
  coin: string;
  change: Decimal;
  index: number;
}

function parseBinanceTxCsv(lines: string[]): Statement {
  const headers = parseCsvLine(lines[0]!, ",");
  const cols = resolveTxColumns(headers);

  if (cols.utcTime < 0 || cols.operation < 0 || cols.coin < 0 || cols.change < 0) {
    throw new Error("Binance Transaction History CSV: faltan columnas obligatorias (UTC_Time, Operation, Coin, Change)");
  }

  const trades: Trade[] = [];

  // Collect all meaningful rows first
  const rows: TxRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, ",");
    const utcTime = (fields[cols.utcTime] ?? "").trim();
    const operation = (fields[cols.operation] ?? "").trim().toLowerCase();
    const coin = (fields[cols.coin] ?? "").trim().toUpperCase();
    const changeStr = (fields[cols.change] ?? "").trim();

    if (!utcTime || !coin || !changeStr || TX_SKIP_OPS.has(operation)) continue;

    const tradeDate = convertBinanceDate(utcTime);
    const change = new Decimal(changeStr);
    if (change.isZero()) continue;

    rows.push({ utcTime, tradeDate, operation, coin, change, index: i });
  }

  // Group rows by timestamp to pair operations
  const groups = new Map<string, TxRow[]>();
  for (const row of rows) {
    const key = row.utcTime;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  for (const [, group] of groups) {
    // --- Binance Convert: two rows at same timestamp, one positive, one negative ---
    if (group.length === 2 && group.every((r) => r.operation === "binance convert")) {
      const sell = group.find((r) => r.change.isNegative());
      const buy = group.find((r) => r.change.isPositive());
      if (sell && buy) {
        const sellQty = sell.change.abs();
        const buyQty = buy.change.abs();
        // Price of sold asset in terms of bought asset
        const implicitPrice = buyQty.div(sellQty);

        trades.push({
          tradeID: `binance-tx-sell-${sell.tradeDate}-${sell.coin}-${sell.index}`,
          accountId: "",
          symbol: sell.coin,
          description: `Convert ${sell.coin} to ${buy.coin}`,
          isin: "",
          assetCategory: "CRYPTO",
          currency: buy.coin,
          tradeDate: sell.tradeDate,
          settlementDate: sell.tradeDate,
          quantity: sell.change.toString(),
          tradePrice: implicitPrice.toString(),
          tradeMoney: buyQty.toString(),
          proceeds: buyQty.toString(),
          cost: "0",
          fifoPnlRealized: "0",
          fxRateToBase: "1",
          buySell: "SELL",
          openCloseIndicator: "C",
          exchange: "BINANCE",
          commissionCurrency: buy.coin,
          commission: "0",
          taxes: "0",
          multiplier: "1",
          brokerSource: "Binance",
        });
        trades.push({
          tradeID: `binance-tx-buy-${buy.tradeDate}-${buy.coin}-${buy.index}`,
          accountId: "",
          symbol: buy.coin,
          description: `Convert ${sell.coin} to ${buy.coin}`,
          isin: "",
          assetCategory: "CRYPTO",
          currency: sell.coin,
          tradeDate: buy.tradeDate,
          settlementDate: buy.tradeDate,
          quantity: buyQty.toString(),
          tradePrice: sellQty.div(buyQty).toString(),
          tradeMoney: sellQty.toString(),
          proceeds: "0",
          cost: sellQty.toString(),
          fifoPnlRealized: "0",
          fxRateToBase: "1",
          buySell: "BUY",
          openCloseIndicator: "O",
          exchange: "BINANCE",
          commissionCurrency: sell.coin,
          commission: "0",
          taxes: "0",
          multiplier: "1",
          brokerSource: "Binance",
        });
        continue;
      }
    }

    // --- Strategy trades: Transaction Sold/Revenue/Buy/Spend/Fee ---
    const sold = group.filter((r) => r.operation === "transaction sold");
    const revenue = group.filter((r) => r.operation === "transaction revenue");
    const bought = group.filter((r) => r.operation === "transaction buy");
    const spend = group.filter((r) => r.operation === "transaction spend");
    const fees = group.filter((r) => r.operation === "transaction fee");

    // Pair Sold + Revenue → SELL trade
    if (sold.length > 0 && revenue.length > 0) {
      const soldRow = sold[0]!;
      const revenueRow = revenue[0]!;
      const feeRow = fees.find((f) => f.coin === revenueRow.coin);
      const feeAmount = feeRow ? feeRow.change.abs() : new Decimal(0);
      const soldQty = soldRow.change.abs();
      const revenueQty = revenueRow.change.abs();

      trades.push({
        tradeID: `binance-tx-sell-${soldRow.tradeDate}-${soldRow.coin}-${soldRow.index}`,
        accountId: "",
        symbol: soldRow.coin,
        description: `Sell ${soldRow.coin} for ${revenueRow.coin}`,
        isin: "",
        assetCategory: "CRYPTO",
        currency: revenueRow.coin,
        tradeDate: soldRow.tradeDate,
        settlementDate: soldRow.tradeDate,
        quantity: soldRow.change.toString(),
        tradePrice: revenueQty.div(soldQty).toString(),
        tradeMoney: revenueQty.toString(),
        proceeds: revenueQty.toString(),
        cost: "0",
        fifoPnlRealized: "0",
        fxRateToBase: "1",
        buySell: "SELL",
        openCloseIndicator: "C",
        exchange: "BINANCE",
        commissionCurrency: revenueRow.coin,
        commission: feeAmount.isZero() ? "0" : feeAmount.neg().toString(),
        taxes: "0",
        multiplier: "1",
        brokerSource: "Binance",
      });
    }

    // Pair Buy + Spend → BUY trade
    if (bought.length > 0 && spend.length > 0) {
      const buyRow = bought[0]!;
      const spendRow = spend[0]!;
      const feeRow = fees.find((f) => f.coin === buyRow.coin);
      const feeAmount = feeRow ? feeRow.change.abs() : new Decimal(0);
      const buyQty = buyRow.change.abs();
      const spendQty = spendRow.change.abs();

      trades.push({
        tradeID: `binance-tx-buy-${buyRow.tradeDate}-${buyRow.coin}-${buyRow.index}`,
        accountId: "",
        symbol: buyRow.coin,
        description: `Buy ${buyRow.coin} with ${spendRow.coin}`,
        isin: "",
        assetCategory: "CRYPTO",
        currency: spendRow.coin,
        tradeDate: buyRow.tradeDate,
        settlementDate: buyRow.tradeDate,
        quantity: buyQty.toString(),
        tradePrice: spendQty.div(buyQty).toString(),
        tradeMoney: spendQty.toString(),
        proceeds: "0",
        cost: spendQty.toString(),
        fifoPnlRealized: "0",
        fxRateToBase: "1",
        buySell: "BUY",
        openCloseIndicator: "O",
        exchange: "BINANCE",
        commissionCurrency: spendRow.coin,
        commission: feeAmount.isZero() ? "0" : feeAmount.neg().toString(),
        taxes: "0",
        multiplier: "1",
        brokerSource: "Binance",
      });
    }
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
// Trade History parser (Date(UTC),Pair,Side,Price,Executed,Amount,Fee)
// ---------------------------------------------------------------------------

function parseBinanceCsv(lines: string[]): Statement {
  const headers = parseCsvLine(lines[0]!, ",");
  const cols = resolveColumns(headers);

  if (cols.date < 0 || cols.pair < 0 || cols.side < 0 || cols.price < 0 || cols.executed < 0 || cols.amount < 0) {
    throw new Error("Binance CSV: faltan columnas obligatorias (Date(UTC), Pair, Side, Price, Executed, Amount)");
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
    const lines = stripBom(input).split(/\r?\n/);
    return lines.slice(0, 10).some((l) => isBinanceCsv(l));
  },

  parse(input: string): Statement {
    const cleaned = stripBom(input);
    const allLines = cleaned.split(/\r?\n/);
    // Find header line (may be preceded by metadata preamble)
    const tradeIdx = allLines.findIndex((l) => isBinanceTradeCsv(l));
    const txIdx = allLines.findIndex((l) => isBinanceTxCsv(l));
    const headerIdx = tradeIdx >= 0 ? tradeIdx : txIdx;
    if (headerIdx === -1) {
      const hasContent = allLines.some((l) => l.trim());
      throw new Error(hasContent ? "Binance CSV: formato no reconocido" : "Binance CSV: fichero vacio o sin datos");
    }
    const lines = allLines.slice(headerIdx).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error("Binance CSV: fichero vacio o sin datos");
    }

    return txIdx >= 0 && tradeIdx < 0 ? parseBinanceTxCsv(lines) : parseBinanceCsv(lines);
  },
};
