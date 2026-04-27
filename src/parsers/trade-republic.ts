/**
 * Trade Republic CSV parser.
 *
 * Parses Trade Republic's "Exportación de transacciones" CSV export.
 * Comma-delimited, quoted fields, all amounts in EUR.
 *
 * CSV columns (23):
 * datetime,date,account_type,category,type,asset_class,name,symbol,shares,
 * price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,
 * description,transaction_id,counterparty_name,counterparty_iban,
 * payment_reference,mcc_code
 */

import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import { parseCsvLine, stripBom } from "./csv-utils.js";
import { normalizeDate } from "../engine/dates.js";

const TR_HEADERS = ["transaction_id", "asset_class", "counterparty_name"];

function isTrCsv(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return TR_HEADERS.every((h) => lower.includes(h));
}

interface TrColumns {
  datetime: number;
  date: number;
  category: number;
  type: number;
  assetClass: number;
  name: number;
  symbol: number;
  shares: number;
  price: number;
  amount: number;
  fee: number;
  tax: number;
  currency: number;
  originalAmount: number;
  originalCurrency: number;
  fxRate: number;
  description: number;
  transactionId: number;
}

function resolveColumns(headers: string[]): TrColumns {
  const idx = (names: string[]) => headers.findIndex((h) => names.includes(h.toLowerCase().trim()));
  return {
    datetime: idx(["datetime"]),
    date: idx(["date"]),
    category: idx(["category"]),
    type: idx(["type"]),
    assetClass: idx(["asset_class"]),
    name: idx(["name"]),
    symbol: idx(["symbol"]),
    shares: idx(["shares"]),
    price: idx(["price"]),
    amount: idx(["amount"]),
    fee: idx(["fee"]),
    tax: idx(["tax"]),
    currency: idx(["currency"]),
    originalAmount: idx(["original_amount"]),
    originalCurrency: idx(["original_currency"]),
    fxRate: idx(["fx_rate"]),
    description: idx(["description"]),
    transactionId: idx(["transaction_id"]),
  };
}

function field(fields: string[], col: number): string {
  return (fields[col] ?? "").trim();
}

function num(fields: string[], col: number): number {
  const v = field(fields, col);
  if (!v) return 0;
  return parseFloat(v) || 0;
}

function dateToCompact(dateStr: string): string {
  // normalizeDate returns YYYY-MM-DD; we need YYYYMMDD for internal format
  return normalizeDate(dateStr).replace(/-/g, "");
}

function mapAssetCategory(assetClass: string): string {
  switch (assetClass.toUpperCase()) {
    case "STOCK": return "STK";
    case "FUND": return "FUND";
    case "CRYPTO": return "CRYPTO";
    case "BOND": return "BOND";
    default: return "STK";
  }
}

function parseTrCsv(lines: string[]): Statement {
  const headers = parseCsvLine(lines[0]!, ",");
  const cols = resolveColumns(headers);

  const required: Array<[keyof TrColumns, string]> = [
    ["date", "date"], ["category", "category"], ["type", "type"],
    ["symbol", "symbol"], ["amount", "amount"], ["transactionId", "transaction_id"],
  ];
  for (const [key, label] of required) {
    if (cols[key] === -1) {
      throw new Error(`Trade Republic CSV: columna requerida "${label}" no encontrada`);
    }
  }

  const trades: Trade[] = [];
  const cashTransactions: CashTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, ",");
    const category = field(fields, cols.category).toUpperCase();
    const type = field(fields, cols.type).toUpperCase();
    const assetClass = field(fields, cols.assetClass);
    const name = field(fields, cols.name);
    const symbol = field(fields, cols.symbol); // ISIN
    const dateStr = field(fields, cols.date);
    const tradeDate = dateToCompact(dateStr);
    const txId = field(fields, cols.transactionId);
    const currency = field(fields, cols.currency) || "EUR";
    const amount = num(fields, cols.amount);
    const shares = num(fields, cols.shares);
    const price = num(fields, cols.price);
    const fee = num(fields, cols.fee);
    const tax = num(fields, cols.tax);
    const fxRate = field(fields, cols.fxRate);
    const originalAmount = field(fields, cols.originalAmount);
    const originalCurrency = field(fields, cols.originalCurrency);

    // --- TRADING: BUY / SELL ---
    if (category === "TRADING" && (type === "BUY" || type === "SELL")) {
      if (shares === 0) continue;

      const isSell = type === "SELL";
      const absShares = Math.abs(shares);
      const absFee = Math.abs(fee);
      const absTax = Math.abs(tax);

      trades.push({
        tradeID: txId || `tr-${tradeDate}-${symbol}-${i}`,
        accountId: "",
        symbol: name,
        description: name,
        isin: symbol,
        assetCategory: mapAssetCategory(assetClass),
        currency,
        tradeDate,
        settlementDate: tradeDate,
        quantity: isSell ? `-${absShares}` : `${absShares}`,
        tradePrice: `${price}`,
        tradeMoney: `${amount}`,
        proceeds: isSell ? `${Math.abs(amount)}` : "0",
        cost: isSell ? "0" : `${Math.abs(amount)}`,
        fifoPnlRealized: "0",
        fxRateToBase: "1",
        buySell: isSell ? "SELL" : "BUY",
        openCloseIndicator: isSell ? "C" : "O",
        exchange: "TRADE_REPUBLIC",
        commissionCurrency: currency,
        commission: absFee !== 0 ? `-${absFee}` : "0",
        taxes: absTax !== 0 ? `-${absTax}` : "0",
        multiplier: "1",
      });
      continue;
    }

    // --- CASH: DIVIDEND ---
    if (category === "CASH" && type === "DIVIDEND") {
      const isinCountry = symbol.length >= 2 ? symbol.slice(0, 2).toUpperCase() : "";
      const divAmount = originalAmount && originalCurrency
        ? originalAmount
        : `${amount}`;
      const divCurrency = originalCurrency || currency;
      const fxToBase = fxRate || "1";

      cashTransactions.push({
        transactionID: txId || `tr-div-${tradeDate}-${symbol}-${i}`,
        accountId: "",
        symbol: name,
        description: `${isinCountry} Dividend - ${name}`,
        isin: symbol,
        currency: divCurrency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: divAmount,
        fxRateToBase: fxToBase,
        type: "Dividends",
      });

      // Withholding tax (if present)
      if (tax !== 0) {
        cashTransactions.push({
          transactionID: txId ? `${txId}-wht` : `tr-div-wht-${tradeDate}-${symbol}-${i}`,
          accountId: "",
          symbol: name,
          description: `${isinCountry} WHT - ${name}`,
          isin: symbol,
          currency,
          dateTime: tradeDate,
          settleDate: tradeDate,
          amount: tax > 0 ? `-${Math.abs(tax)}` : `${tax}`,
          fxRateToBase: "1",
          type: "Withholding Tax",
        });
      }
      continue;
    }

    // --- CASH: INTEREST_PAYMENT ---
    if (category === "CASH" && type === "INTEREST_PAYMENT") {
      cashTransactions.push({
        transactionID: txId || `tr-int-${tradeDate}-${i}`,
        accountId: "",
        symbol: "CASH",
        description: "Interest payment - Trade Republic",
        isin: "",
        currency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: `${amount}`,
        fxRateToBase: "1",
        type: "Broker Interest Received",
      });
      continue;
    }

    // --- CASH: TAX_OPTIMIZATION (refund) ---
    if (category === "CASH" && type === "TAX_OPTIMIZATION") {
      if (amount > 0) {
        cashTransactions.push({
          transactionID: txId || `tr-taxopt-${tradeDate}-${i}`,
          accountId: "",
          symbol: name || "CASH",
          description: `Tax optimization - ${name || "Trade Republic"}`,
          isin: symbol,
          currency,
          dateTime: tradeDate,
          settleDate: tradeDate,
          amount: `${amount}`,
          fxRateToBase: "1",
          type: "Broker Interest Received",
        });
      }
      continue;
    }

    // Skip: CUSTOMER_INBOUND, CUSTOMER_OUTBOUND, TRANSFER_*, CORPORATE_ACTION, DELIVERY
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

export const tradeRepublicParser: BrokerParser = {
  name: "Trade Republic",
  formats: ["CSV"],

  detect(input: string): boolean {
    const firstLine = stripBom(input).split(/\r?\n/)[0] ?? "";
    return isTrCsv(firstLine);
  },

  parse(input: string): Statement {
    const cleaned = stripBom(input);
    const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error("Trade Republic CSV: fichero vacío o sin datos");
    }
    if (!isTrCsv(lines[0]!)) {
      throw new Error("Trade Republic CSV: formato no reconocido");
    }
    return parseTrCsv(lines);
  },
};
