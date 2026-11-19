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
  toFiniteDecimalString,
  tradeQuantityUnknownMessages,
  unreadableTrade,
  unreadableCell,
  isReadableTradeDate,
  markUndatedTrades,
  dropUndatedCash,
  corporateActionTrade,
  cashRowsUnidentifiedMessages,
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
  // Corporate-action rows dropped because their type_id is empty or not
  // text, so the parser cannot tell a dividend from anything else. We
  // skip-and-warn instead of letting a TypeError abort the whole parse.
  let skippedMalformed = 0;
  // Dividend and coupon rows with no ticker and no ISIN (#467).
  const unidentifiedCash: string[] = [];
  // Dividend and coupon rows whose amount cannot be read (#467).
  const unreadableAmountCash: string[] = [];

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
    const typeIdText = typeof ca.type_id === "string" ? ca.type_id.trim() : "";
    const typeId = typeIdText.toLowerCase();
    if (!typeId) { skippedMalformed++; continue; }

    const ticker = typeof ca.ticker === "string" ? ca.ticker.trim() : "";
    const isin = typeof ca.isin === "string" ? ca.isin.trim() : "";
    // A dividend with no readable date is booked with that date and taken
    // out, named with its amount, by dropUndatedCash below (#467).
    const dateRaw = typeof ca.date === "string" ? ca.date.trim() : "";
    const tradeDate = convertFreedom24Date(dateRaw);
    const currency = ca.curr_c || "USD";
    const { symbol: tickerSymbol, exchange } = parseSymbol(ticker);

    // Every corporate action that is not a dividend or a coupon (a split, a
    // consolidation, a merger, a conversion, bonus shares, a maturity, a
    // redemption...) moves shares of its security, or takes them away with
    // money. So it is evidence of a holding at the anti-churning window start
    // (#453, #467): kept as a row that books nothing, named as not applied,
    // never dropped. The JSON gives no share count for it. With no ticker and
    // no ISIN it makes the evidence of every security "unverified".
    const dividend = typeId.includes("dividend") || typeId.includes("coupon");
    if (!dividend) {
      trades.push(corporateActionTrade({
        tradeID: `freedom24-ca-${tradeDate}-${i}`,
        symbol: tickerSymbol, description: ticker, isin, assetCategory: "STK", currency, tradeDate, exchange,
      }, typeIdText, ""));
      continue;
    }

    // The engine reads the amount as written: an empty, textual or
    // non-finite amount is unreadable, and a missing one is no zero. Such a
    // dividend is named, never booked (a non-numeric amount would abort the
    // whole report) and never read as zero (#467).
    const amount = typeof ca.amount === "string" || typeof ca.amount === "number" ? String(ca.amount).trim() : "";
    const amountReadable = toFiniteDecimalString(amount, "", false) !== "";
    const amountText = amountReadable ? amount : `[${unreadableCell("amount", ca.amount)}]`;
    const taxAmount = str(ca.tax_amount);
    const tax = toFiniteDecimal(taxAmount).isZero() ? "" : ` (tax_amount ${taxAmount})`;
    // A dividend with no ticker goes by its ISIN; with neither it is named,
    // never dropped with no word (#467).
    if (!ticker && !isin) {
      if (!amountReadable || !toFiniteDecimal(amount).isZero() || tax) unidentifiedCash.push(`${typeIdText} ${amountText} ${currency}${tax} ${tradeDate || "—"}`);
      continue;
    }
    const security = ticker || isin;
    const symbol = ticker ? tickerSymbol : isin;
    if (!amountReadable) {
      unreadableAmountCash.push(`${typeIdText} ${isin ? (ticker ? `${tickerSymbol} (${isin})` : isin) : tickerSymbol} ${currency} ${tradeDate || "—"}${tax} ${amountText}`);
      continue;
    }
    // Include ISIN country code so dividend engine can extract withholding country
    const isinCountry = isin.length >= 2 ? isin.slice(0, 2).toUpperCase() : "";

    // Dividend entry
    cashTransactions.push({
      transactionID: `freedom24-div-${tradeDate}-${isin}-${i}`,
      accountId: "",
      symbol,
      description: ca.description || `${isinCountry} Dividend - ${security}`,
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
        description: `${isinCountry} WHT - ${security}`,
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
      message: `Freedom24: se ha(n) omitido ${skippedMalformed} fila(s) de acciones corporativas sin un tipo legible (type_id).`,
      hint: "El campo \"type_id\" de esas filas está vacío o no es texto. Por eso DeclaRenta no sabe si son un dividendo, un cupón u otra operación, y no las calcula. Si te falta un dividendo o un cupón, vuelve a descargar el informe JSON completo de Freedom24 y súbelo de nuevo.",
      context: { count: String(skippedMalformed) },
    });
  }
  if (unreadableAmountCash.length > 0) {
    const count = String(unreadableAmountCash.length);
    const rows = unreadableAmountCash.join("; ");
    parserMessages.push({
      id: "freedom24.dividend_amount_unreadable",
      severity: "warning" as const,
      message: `Freedom24: ${count} dividendo(s) o cupón(es) no tienen un importe (amount) legible y no se calculan: ${rows}.`,
      hint: "Entre corchetes va la celda del importe (amount). Sin ella, DeclaRenta no sabe cuánto cobraste. Por eso no suma ese ingreso ni su retención y no se inventa un importe. Si es un ingreso del año que declaras, vuelve a descargar el informe JSON completo de Freedom24 y súbelo de nuevo. También puedes añadir el importe y la retención a mano en Renta Web.",
      context: { count, rows },
    });
  }
  markUndatedTrades(trades, "date");
  parserMessages.push(
    ...tradeQuantityUnknownMessages("Freedom24", trades),
    ...dropUndatedCash("Freedom24", cashTransactions, "date"),
    ...cashRowsUnidentifiedMessages("Freedom24", unidentifiedCash),
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
