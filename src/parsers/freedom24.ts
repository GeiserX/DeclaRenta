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

function parseDate(dateStr: string): string {
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

  // Parse trades
  const rawTrades = root.trades?.detailed ?? [];
  for (let i = 0; i < rawTrades.length; i++) {
    const t = rawTrades[i]!;
    const tradeDate = parseDate(t.date);
    const { symbol, exchange } = parseSymbol(t.ticker);
    const isin = t.isin ?? "";
    const quantity = str(t.q);
    const price = str(t.p);
    const currency = t.curr_c || "USD";
    const commission = str(t.commission);
    const amount = str(t.amount);
    const operation = t.operation.toLowerCase();
    const isSell = operation === "sell";

    const qtyNum = Math.abs(parseFloat(quantity));
    if (qtyNum === 0) continue;

    const commNum = parseFloat(commission);

    trades.push({
      tradeID: `freedom24-${tradeDate}-${i}`,
      accountId: "",
      symbol,
      description: t.ticker,
      isin,
      assetCategory: "STK",
      currency,
      tradeDate,
      settlementDate: tradeDate,
      quantity: isSell ? `-${qtyNum}` : `${qtyNum}`,
      tradePrice: price,
      tradeMoney: amount || "0",
      proceeds: isSell ? amount || "0" : "0",
      cost: isSell ? "0" : amount || "0",
      fifoPnlRealized: "0",
      fxRateToBase: currency === "EUR" ? "1" : "1",
      buySell: isSell ? "SELL" : "BUY",
      openCloseIndicator: isSell ? "C" : "O",
      exchange: t.exchange || exchange,
      commissionCurrency: currency,
      commission: commNum !== 0 ? `-${Math.abs(commNum)}` : "0",
      taxes: "0",
      multiplier: "1",
    });
  }

  // Parse corporate actions (dividends + withholding tax)
  const rawCA = root.corporate_actions?.detailed ?? [];
  for (let i = 0; i < rawCA.length; i++) {
    const ca = rawCA[i]!;
    const typeId = ca.type_id.toLowerCase();
    if (!typeId.includes("dividend") && !typeId.includes("coupon")) continue;

    const tradeDate = parseDate(ca.date);
    const { symbol } = parseSymbol(ca.ticker);
    const isin = ca.isin ?? "";
    const amount = str(ca.amount);
    const taxAmount = str(ca.tax_amount);
    const currency = ca.curr_c || "USD";

    // Dividend entry
    cashTransactions.push({
      transactionID: `freedom24-div-${tradeDate}-${isin}-${i}`,
      accountId: "",
      symbol,
      description: ca.description || `${typeId} - ${ca.ticker}`,
      isin,
      currency,
      dateTime: tradeDate,
      settleDate: tradeDate,
      amount,
      fxRateToBase: currency === "EUR" ? "1" : "1",
      type: "Dividends",
    });

    // Withholding tax (if present)
    const taxNum = parseFloat(taxAmount);
    if (taxNum !== 0) {
      cashTransactions.push({
        transactionID: `freedom24-wht-${tradeDate}-${isin}-${i}`,
        accountId: "",
        symbol,
        description: `Withholding tax - ${ca.ticker}`,
        isin,
        currency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: taxNum > 0 ? `-${taxNum}` : taxAmount,
        fxRateToBase: currency === "EUR" ? "1" : "1",
        type: "Withholding Tax",
      });
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
