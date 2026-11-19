/**
 * Freedom24 JSON parser.
 *
 * Parses Freedom24's JSON report export into a normalized Statement.
 * Freedom24 exports contain:
 * - report.trades.detailed[]: trade executions
 * - report.corporate_actions.detailed[]: dividends with tax
 * - report.cash_flows.detailed[]: deposits, withdrawals, fees
 *
 * Ticker format: SYMBOL.EXCHANGE (e.g., SPY.US)
 */

import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import type { TaxMessage } from "../types/tax.js";
import {
  toFiniteDecimal,
  quantityUnknownTrade,
  quantityUnreadable,
  tradeQuantityUnknownMessages,
  unreadableTrade,
  unreadableCell,
  isReadableTradeDate,
  markUndatedTrades,
  dropUndatedCash,
} from "./csv-utils.js";

// ---------------------------------------------------------------------------
// JSON structure types
// ---------------------------------------------------------------------------

interface Freedom24Trade {
  date: string;         // "YYYY-MM-DD HH:MM:SS"
  ticker: string;       // "SPY.US"
  isin?: string;
  operation: string;    // "buy" | "sell"
  p: string | number;   // price
  q: string | number;   // quantity
  curr_c: string;       // currency code
  commission?: string | number;
  amount?: string | number;
  exchange?: string;
}

interface Freedom24CorporateAction {
  date: string;
  ticker: string;
  isin?: string;
  type_id: string;      // "dividend", "coupon", etc.
  amount: string | number;
  tax_amount?: string | number;
  curr_c: string;
  description?: string;
}

interface Freedom24Report {
  report?: {
    trades?: { detailed?: Freedom24Trade[] };
    corporate_actions?: { detailed?: Freedom24CorporateAction[] };
    cash_flows?: { detailed?: unknown[] };
  };
  // Alternative flat structure
  trades?: { detailed?: Freedom24Trade[] };
  corporate_actions?: { detailed?: Freedom24CorporateAction[] };
  cash_flows?: { detailed?: unknown[] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function convertFreedom24Date(dateStr: string): string {
  // "YYYY-MM-DD HH:MM:SS" → "YYYYMMDD"
  return dateStr.trim().slice(0, 10).replace(/-/g, "");
}

function str(val: string | number | undefined): string {
  if (val === undefined) return "0";
  return String(val).trim();
}

function parseSymbol(ticker: string): { symbol: string; exchange: string } {
  const parts = ticker.split(".");
  if (parts.length >= 2) {
    const exchange = parts[parts.length - 1]!;
    const symbol = parts.slice(0, -1).join(".");
    return { symbol, exchange };
  }
  return { symbol: ticker, exchange: "" };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function isFreedom24Json(input: string): boolean {
  try {
    const parsed = JSON.parse(input) as Freedom24Report;
    const root = parsed.report ?? parsed;
    return !!(root.trades || root.corporate_actions || root.cash_flows);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseFreedom24(input: string): Statement {
  const parsed = JSON.parse(input) as Freedom24Report;
  const root = parsed.report ?? parsed;

  const trades: Trade[] = [];
  const cashTransactions: CashTransaction[] = [];
  // Corporate-action rows dropped because a structurally-valid JSON had a
  // malformed row shape (e.g. type_id/ticker/date not a string). We
  // skip-and-warn instead of letting a TypeError abort the whole parse.
  let skippedMalformed = 0;

  // Parse trades
  const rawTrades = root.trades?.detailed ?? [];
  for (let i = 0; i < rawTrades.length; i++) {
    const t = rawTrades[i]!;
    // The JSON is cast, not validated: a malformed row could carry non-string
    // operation/ticker/date and crash .toLowerCase()/.split()/.slice(). Guard
    // each. A row of trades.detailed is a trade even when one of them cannot
    // be read: it is kept as a trade that books nothing and named, never
    // dropped (#467).
    const operation = typeof t.operation === "string" ? t.operation.trim().toLowerCase() : "";
    const ticker = typeof t.ticker === "string" ? t.ticker.trim() : "";
    const dateRaw = typeof t.date === "string" ? t.date.trim() : "";
    const tradeDate = convertFreedom24Date(dateRaw);
    const { symbol, exchange } = parseSymbol(ticker);
    const isin = typeof t.isin === "string" ? t.isin.trim() : "";
    const quantity = str(t.q);
    const price = str(t.p);
    const currency = t.curr_c || "USD";
    const commission = str(t.commission);
    const amount = str(t.amount);
    const isSell = operation === "sell";

    const cell = !isReadableTradeDate(tradeDate) ? unreadableCell("date", t.date)
      : !ticker ? unreadableCell("ticker", t.ticker)
      : operation !== "buy" && operation !== "sell" ? unreadableCell("operation", t.operation)
      : undefined;
    // An operation that is neither a buy nor a sale with a written zero
    // quantity moves no shares: skipped.
    const otherOperation = operation !== "buy" && operation !== "sell";
    if (otherOperation && !quantityUnreadable(t.q) && toFiniteDecimal(quantity).isZero()) continue;
    if (cell !== undefined) {
      trades.push(unreadableTrade({
        tradeID: `freedom24-${tradeDate}-${i}`,
        symbol, description: ticker, isin, assetCategory: "STK", currency, tradeDate,
        ...(operation === "buy" || operation === "sell" ? { buySell: isSell ? "SELL" as const : "BUY" as const } : {}),
        exchange: t.exchange || exchange,
      }, cell));
      continue;
    }

    const qtyDec = toFiniteDecimal(quantity).abs();
    if (qtyDec.isZero()) {
      // An empty or unreadable quantity is no "0": keep the buy or sell row as
      // a trade of unknown quantity for the anti-churning evidence (#453).
      if (quantityUnreadable(t.q)) {
        trades.push(quantityUnknownTrade({
          tradeID: `freedom24-${tradeDate}-${i}`,
          symbol, description: ticker, isin, assetCategory: "STK", currency, tradeDate,
          buySell: isSell ? "SELL" : "BUY", exchange: t.exchange || exchange,
        }));
      }
      continue;
    }

    const commDec = toFiniteDecimal(commission);

    trades.push({
      tradeID: `freedom24-${tradeDate}-${i}`,
      accountId: "",
      symbol,
      description: ticker,
      isin,
      assetCategory: "STK",
      currency,
      tradeDate,
      settlementDate: tradeDate,
      quantity: isSell ? qtyDec.neg().toString() : qtyDec.toString(),
      tradePrice: price,
      tradeMoney: amount || "0",
      proceeds: isSell ? amount || "0" : "0",
      cost: isSell ? "0" : amount || "0",
      fifoPnlRealized: "0",
      fxRateToBase: "1",
      buySell: isSell ? "SELL" : "BUY",
      openCloseIndicator: isSell ? "C" : "O",
      exchange: t.exchange || exchange,
      commissionCurrency: currency,
      commission: commDec.isZero() ? "0" : commDec.abs().neg().toString(),
      taxes: "0",
      multiplier: "1",
    });
  }

  // Parse corporate actions (dividends + withholding tax)
  const rawCA = root.corporate_actions?.detailed ?? [];
  for (let i = 0; i < rawCA.length; i++) {
    const ca = rawCA[i]!;
    // Same defensive narrowing as the trades loop: the cast JSON could carry a
    // non-string type_id/date/ticker that would crash .toLowerCase()/.slice()/
    // .split(). A malformed type_id is unclassifiable → skip-and-warn.
    const typeId = typeof ca.type_id === "string" ? ca.type_id.toLowerCase() : "";
    if (!typeId) { skippedMalformed++; continue; }
    if (!typeId.includes("dividend") && !typeId.includes("coupon")) continue;

    const ticker = typeof ca.ticker === "string" ? ca.ticker : "";
    if (!ticker) { skippedMalformed++; continue; }
    // A dividend with no readable date is booked with that date and taken
    // out, named with its amount, by dropUndatedCash below (#467).
    const dateRaw = typeof ca.date === "string" ? ca.date.trim() : "";

    const tradeDate = convertFreedom24Date(dateRaw);
    const { symbol } = parseSymbol(ticker);
    const isin = ca.isin ?? "";
    const amount = str(ca.amount);
    const taxAmount = str(ca.tax_amount);
    const currency = ca.curr_c || "USD";
    // Include ISIN country code so dividend engine can extract withholding country
    const isinCountry = isin.length >= 2 ? isin.slice(0, 2).toUpperCase() : "";

    // Dividend entry
    cashTransactions.push({
      transactionID: `freedom24-div-${tradeDate}-${isin}-${i}`,
      accountId: "",
      symbol,
      description: ca.description || `${isinCountry} Dividend - ${ticker}`,
      isin,
      currency,
      dateTime: tradeDate,
      settleDate: tradeDate,
      amount,
      fxRateToBase: "1",
      type: "Dividends",
    });

    // Withholding tax (if present)
    const taxDec = toFiniteDecimal(taxAmount);
    if (!taxDec.isZero()) {
      cashTransactions.push({
        transactionID: `freedom24-wht-${tradeDate}-${isin}-${i}`,
        accountId: "",
        symbol,
        description: `${isinCountry} WHT - ${ticker}`,
        isin,
        currency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: taxDec.isPositive() ? taxDec.neg().toString() : taxDec.toString(),
        fxRateToBase: "1",
        type: "Withholding Tax",
      });
    }
  }

  const parserMessages: TaxMessage[] = [];
  if (skippedMalformed > 0) {
    parserMessages.push({
      id: "freedom24.row_skipped_malformed",
      severity: "warning" as const,
      message: `Se ha(n) omitido ${skippedMalformed} fila(s) de dividendos o cupones de Freedom24 con un formato no válido.`,
      hint: "Suele deberse a filas incompletas o corruptas en el JSON exportado (campos \"type_id\", \"date\" o \"ticker\" vacíos o de tipo incorrecto). Si faltan dividendos, vuelve a descargar el informe JSON completo desde Freedom24.",
      context: { count: String(skippedMalformed) },
    });
  }
  markUndatedTrades(trades, "date");
  parserMessages.push(
    ...tradeQuantityUnknownMessages("Freedom24", trades),
    ...dropUndatedCash("Freedom24", cashTransactions, "date"),
  );

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
    ...(parserMessages.length > 0 ? { parserMessages } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public BrokerParser
// ---------------------------------------------------------------------------

export const freedom24Parser: BrokerParser = {
  name: "Freedom24",
  formats: ["JSON"],

  detect(input: string): boolean {
    return isFreedom24Json(input);
  },

  parse(input: string): Statement {
    if (!input.trim()) {
      throw new Error("Freedom24 JSON: fichero vacío o sin datos");
    }

    if (!isFreedom24Json(input)) {
      throw new Error("Freedom24 JSON: formato no reconocido. Se esperan las claves trades/corporate_actions/cash_flows.");
    }

    return parseFreedom24(input);
  },
};
