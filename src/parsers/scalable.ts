/**
 * Scalable Capital CSV parser.
 *
 * Parses Scalable Capital's transaction CSV export into a normalized Statement.
 * Supports semicolon-delimited format with EU number formatting.
 *
 * CSV format: 14 columns
 * date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency
 */

import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import {
  parseCsvLine,
  parseNumber,
  convertDateISO,
  findColumn,
  stripBom,
} from "./csv-utils.js";

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

const SCALABLE_HEADERS = ["status", "reference", "assettype", "shares"];

function isScalableCsv(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return SCALABLE_HEADERS.every((h) => lower.includes(h));
}

// ---------------------------------------------------------------------------
// Column resolution
// ---------------------------------------------------------------------------

interface ScalableColumns {
  date: number;
  time: number;
  status: number;
  reference: number;
  description: number;
  assetType: number;
  type: number;
  isin: number;
  shares: number;
  price: number;
  amount: number;
  fee: number;
  tax: number;
  currency: number;
}

function resolveColumns(headers: string[]): ScalableColumns {
  return {
    date: findColumn(headers, ["date", "fecha", "datum"]),
    time: findColumn(headers, ["time", "hora", "zeit"]),
    status: findColumn(headers, ["status", "estado"]),
    reference: findColumn(headers, ["reference", "referencia", "referenz"]),
    description: findColumn(headers, ["description", "descripción", "beschreibung"]),
    assetType: findColumn(headers, ["assettype", "asset type", "tipo de activo"]),
    type: findColumn(headers, ["type", "tipo", "typ"]),
    isin: findColumn(headers, ["isin"]),
    shares: findColumn(headers, ["shares", "acciones", "anteile"]),
    price: findColumn(headers, ["price", "precio", "kurs"]),
    amount: findColumn(headers, ["amount", "importe", "betrag"]),
    fee: findColumn(headers, ["fee", "comisión", "gebühr"]),
    tax: findColumn(headers, ["tax", "impuesto", "steuer"]),
    currency: findColumn(headers, ["currency", "divisa", "währung"]),
  };
}

// ---------------------------------------------------------------------------
// Distribution (dividend) patterns
// ---------------------------------------------------------------------------

const DIVIDEND_TYPES = ["distribution", "dividend", "dividendo", "ausschüttung"];
const SELL_TYPES = ["sell", "venta", "verkauf"];
const BUY_TYPES = ["buy", "savings plan", "compra", "sparplan", "kauf"];

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseScalableCsv(lines: string[], delimiter: string): Statement {
  const headers = parseCsvLine(lines[0]!, delimiter);
  const cols = resolveColumns(headers);

  if (cols.date < 0 || cols.isin < 0 || cols.type < 0) {
    throw new Error("Scalable Capital CSV: faltan columnas obligatorias (date, isin, type)");
  }

  const trades: Trade[] = [];
  const cashTransactions: CashTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, delimiter);

    // Only process executed transactions
    const status = (fields[cols.status] ?? "").trim().toLowerCase();
    if (status && status !== "executed" && status !== "ejecutada" && status !== "ausgeführt") continue;

    const dateStr = (fields[cols.date] ?? "").trim();
    const tradeDate = convertDateISO(dateStr); // YYYY-MM-DD → YYYYMMDD
    const type = (fields[cols.type] ?? "").trim().toLowerCase();
    const isin = (fields[cols.isin] ?? "").trim();
    const description = (fields[cols.description] ?? "").trim();
    const shares = parseNumber(fields[cols.shares] ?? "0");
    const price = parseNumber(fields[cols.price] ?? "0");
    const amount = parseNumber(fields[cols.amount] ?? "0");
    const fee = parseNumber(fields[cols.fee] ?? "0");
    const tax = parseNumber(fields[cols.tax] ?? "0");
    const currency = (fields[cols.currency] ?? "EUR").trim();
    const reference = (fields[cols.reference] ?? "").trim();

    if (!isin) continue;

    // Distributions → cash transactions (dividends)
    if (DIVIDEND_TYPES.some((d) => type.includes(d))) {
      cashTransactions.push({
        transactionID: `scalable-${tradeDate}-${isin}-${i}`,
        accountId: "",
        symbol: description,
        description: `${type} - ${description}`,
        isin,
        currency: currency || "EUR",
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount,
        fxRateToBase: currency === "EUR" ? "1" : "1",
        type: "Dividends",
      });

      // If there's a tax amount, add withholding
      const taxNum = parseFloat(tax);
      if (taxNum !== 0) {
        cashTransactions.push({
          transactionID: `scalable-tax-${tradeDate}-${isin}-${i}`,
          accountId: "",
          symbol: description,
          description: `Withholding tax - ${description}`,
          isin,
          currency: currency || "EUR",
          dateTime: tradeDate,
          settleDate: tradeDate,
          amount: taxNum > 0 ? `-${Math.abs(taxNum)}` : tax,
          fxRateToBase: "1",
          type: "Withholding Tax",
        });
      }
      continue;
    }

    // Trades
    const sharesNum = parseFloat(shares);
    if (sharesNum === 0) continue;

    const isSell = SELL_TYPES.some((s) => type.includes(s));
    const isBuy = BUY_TYPES.some((b) => type.includes(b));
    if (!isSell && !isBuy) continue;

    const absShares = Math.abs(sharesNum);
    const feeNum = parseFloat(fee);

    trades.push({
      tradeID: reference || `scalable-${tradeDate}-${isin}-${i}`,
      accountId: "",
      symbol: description,
      description,
      isin,
      assetCategory: "STK",
      currency: currency || "EUR",
      tradeDate,
      settlementDate: tradeDate,
      quantity: isSell ? `-${absShares}` : `${absShares}`,
      tradePrice: price,
      tradeMoney: amount,
      proceeds: isSell ? amount : "0",
      cost: isSell ? "0" : amount,
      fifoPnlRealized: "0",
      fxRateToBase: "1",
      buySell: isSell ? "SELL" : "BUY",
      openCloseIndicator: isSell ? "C" : "O",
      exchange: "XETR",
      commissionCurrency: currency || "EUR",
      commission: feeNum !== 0 ? `-${Math.abs(feeNum)}` : "0",
      taxes: tax,
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

export const scalableParser: BrokerParser = {
  name: "Scalable Capital",
  formats: ["CSV"],

  detect(input: string): boolean {
    const firstLine = stripBom(input).split(/\r?\n/)[0] ?? "";
    return isScalableCsv(firstLine);
  },

  parse(input: string): Statement {
    const cleaned = stripBom(input);
    const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error("Scalable Capital CSV: fichero vacío o sin datos");
    }

    const headerLine = lines[0]!;
    // Scalable always uses semicolons
    const delimiter = headerLine.includes(";") ? ";" : ",";

    if (!isScalableCsv(headerLine)) {
      throw new Error("Scalable Capital CSV: formato no reconocido");
    }

    return parseScalableCsv(lines, delimiter);
  },
};
