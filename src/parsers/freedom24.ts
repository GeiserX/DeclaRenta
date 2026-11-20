/**
 * Freedom24 JSON parser.
 *
 * Parses Freedom24's JSON report export into a normalized Statement.
 * Freedom24 exports contain:
 * - report.trades.detailed[]: trade executions
 * - report.corporate_actions.detailed[]: dividends with tax
 * - report.cash_flows.detailed[]: deposits, withdrawals, fees (not booked:
 *   every row that is not a deposit or a withdrawal is named, #467)
 *
 * Ticker format: SYMBOL.EXCHANGE (e.g., SPY.US)
 */

import Decimal from "decimal.js";
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
  cashIncomeRowText,
  cashIncomeAmountUnreadableMessages,
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

/** A cash_flows row as far as the parser reads it: only to name it (#467). */
interface Freedom24CashFlow {
  date?: unknown;
  type_id?: unknown;
  type?: unknown;
  amount?: unknown;
  curr_c?: unknown;
}

interface Freedom24Report {
  report?: {
    trades?: { detailed?: Freedom24Trade[] };
    corporate_actions?: { detailed?: Freedom24CorporateAction[] };
    cash_flows?: { detailed?: unknown };
  };
  // Alternative flat structure
  trades?: { detailed?: Freedom24Trade[] };
  corporate_actions?: { detailed?: Freedom24CorporateAction[] };
  cash_flows?: { detailed?: unknown };
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

/** A JSON cell as text: a string trimmed, a number written out, else "". */
function text(val: unknown): string {
  return typeof val === "string" ? val.trim() : typeof val === "number" ? String(val) : "";
}

/**
 * The currency code a curr_c cell gives: three letters, trimmed and in upper
 * case (" usd" is USD). A missing, empty or other cell gives "": it is never
 * guessed as USD, which converted a euro stock or dividend at the dollar
 * rate (#467).
 */
function currencyOf(val: unknown): string {
  const code = typeof val === "string" ? val.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(code) ? code : "";
}

/**
 * Words a cash_flows type of a deposit or a withdrawal is made of
 * ("deposit", "card_deposit", "Bank withdrawal").
 */
const TRANSFER_WORDS = new Set([
  "deposit", "deposits", "withdraw", "withdrawal", "withdrawals",
  "card", "bank", "wire", "sepa", "swift", "transfer", "transfers", "incoming", "outgoing",
  "in", "out", "to", "from", "by", "via", "of",
]);

/**
 * Whether a cash_flows type (its type_id and type) is a deposit or a
 * withdrawal and nothing else: it names one of them and has no other word.
 * "deposit_interest", "Interest on deposit" or "withdrawal_commission" carry
 * another word, so they are named, never dropped with no word (#467).
 */
function isTransfer(type: string): boolean {
  const words = type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.some((w) => /^(deposits?|withdraw(al|als)?)$/.test(w)) && words.every((w) => TRANSFER_WORDS.has(w));
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
  // Corporate-action rows whose type_id is empty or not text, so the parser
  // cannot tell a dividend from anything else. Each is kept as a corporate
  // action that books nothing (#467) and counted, instead of letting a
  // TypeError abort the whole parse.
  let skippedMalformed = 0;
  // Dividend and coupon rows with no ticker and no ISIN (#467).
  const unidentifiedCash: string[] = [];
  // Dividend and coupon rows whose amount cannot be read (#467).
  const unreadableAmountCash: string[] = [];
  // Dividend and coupon rows booked with no withholding because their
  // tax_amount cell cannot be read (#467).
  const unreadableTaxCash: string[] = [];
  // Dividend and coupon rows whose curr_c cannot be read (#467).
  const unreadableCurrencyCash: string[] = [];

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
    // The price is read, never passed on raw: a missing one became "0" (a
    // sale at 0, a full loss), and "" or "abc" stopped the report (#467).
    const priceText = typeof t.p === "string" || typeof t.p === "number" ? String(t.p).trim() : "";
    const priceValue = toFiniteDecimalString(priceText, "", false);
    const currency = currencyOf(t.curr_c);
    const commission = str(t.commission);
    const amount = str(t.amount);
    const isSell = operation === "sell";

    const cell = !isReadableTradeDate(tradeDate) ? unreadableCell("date", t.date)
      : !ticker ? unreadableCell("ticker", t.ticker)
      : operation !== "buy" && operation !== "sell" ? unreadableCell("operation", t.operation)
      : !currency ? unreadableCell("curr_c", t.curr_c)
      : undefined;
    // An operation that is neither a buy nor a sale with a written zero
    // quantity moves no shares: skipped.
    // q is read as written, like p: a comma is no decimal point, so "1,000"
    // is no 1 share and "1,5" no 1.5 shares; such a row is a trade of unknown
    // quantity (#467).
    const otherOperation = operation !== "buy" && operation !== "sell";
    if (otherOperation && !quantityUnreadable(t.q, false) && toFiniteDecimal(quantity, "0", false).isZero()) continue;
    if (cell !== undefined) {
      trades.push(unreadableTrade({
        tradeID: `freedom24-${tradeDate}-${i}`,
        symbol, description: ticker, isin, assetCategory: "STK", currency: currency || "EUR", tradeDate,
        ...(operation === "buy" || operation === "sell" ? { buySell: isSell ? "SELL" as const : "BUY" as const } : {}),
        exchange: t.exchange || exchange,
      }, cell));
      continue;
    }

    const qtyDec = toFiniteDecimal(quantity, "0", false).abs();
    if (qtyDec.isZero()) {
      // An empty or unreadable quantity is no "0": keep the buy or sell row as
      // a trade of unknown quantity for the anti-churning evidence (#453).
      if (quantityUnreadable(t.q, false)) {
        trades.push(quantityUnknownTrade({
          tradeID: `freedom24-${tradeDate}-${i}`,
          symbol, description: ticker, isin, assetCategory: "STK", currency, tradeDate,
          buySell: isSell ? "SELL" : "BUY", exchange: t.exchange || exchange,
        }));
      }
      continue;
    }

    // A written zero price moves shares for no money (bonus shares, a
    // delivery): kept as a corporate action not applied, as Flatex and
    // DEGIRO do, never a sale for 0. A price that is missing, empty, no
    // number or below zero makes the row unreadable, named by p (#467).
    if (priceValue !== "" && toFiniteDecimal(priceValue, "0", false).isZero()) {
      trades.push(corporateActionTrade({
        tradeID: `freedom24-${tradeDate}-${i}`,
        symbol, description: ticker, isin, assetCategory: "STK", currency, tradeDate,
        buySell: isSell ? "SELL" : "BUY", exchange: t.exchange || exchange,
      }, `p ${priceText}`, String(t.q).trim()));
      continue;
    }
    if (priceValue === "" || toFiniteDecimal(priceValue, "0", false).isNegative()) {
      trades.push(unreadableTrade({
        tradeID: `freedom24-${tradeDate}-${i}`,
        symbol, description: ticker, isin, assetCategory: "STK", currency, tradeDate,
        buySell: isSell ? "SELL" : "BUY", exchange: t.exchange || exchange,
      }, unreadableCell("p", t.p)));
      continue;
    }

    const commDec = toFiniteDecimal(commission);

    // The row's own amount is the money the trade moved: p × q plus the
    // commission on a buy, minus it on a sale, or p × q alone. FIFO books
    // p × q and the commission, never the amount. When the amount is
    // readable and contradicts them (an option whose amount is 100 × p × q,
    // a bond priced in % of its face, a price or a commission of 1e400),
    // the row is unreadable, named by its q, p, commission and amount
    // cells, never booked at p × q (#467). The tolerance (1 % and a cent)
    // covers a price written rounded. A missing or unreadable amount is no
    // evidence, so the row is booked as before.
    const amountValue = toFiniteDecimalString(text(t.amount), "", false);
    if (amountValue !== "") {
      const money = new Decimal(amountValue).abs();
      const value = qtyDec.times(priceValue);
      const fee = commDec.abs();
      const tolerance = value.times("0.01").plus("0.01");
      const near = (expected: Decimal): boolean => money.minus(expected).abs().lessThanOrEqualTo(tolerance);
      const withFee = near(isSell ? value.minus(fee) : value.plus(fee));
      const withoutFee = near(value) && fee.lessThan(value);
      if (!withFee && !withoutFee) {
        trades.push(unreadableTrade({
          tradeID: `freedom24-${tradeDate}-${i}`,
          symbol, description: ticker, isin, assetCategory: "STK", currency, tradeDate,
          buySell: isSell ? "SELL" : "BUY", exchange: t.exchange || exchange,
        }, [unreadableCell("q", t.q), unreadableCell("p", t.p), unreadableCell("commission", t.commission), unreadableCell("amount", t.amount)].join(", ")));
        continue;
      }
    }

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
      tradePrice: priceText,
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
    // .split().
    const typeIdText = typeof ca.type_id === "string" ? ca.type_id.trim() : "";
    const typeId = typeIdText.toLowerCase();

    const ticker = typeof ca.ticker === "string" ? ca.ticker.trim() : "";
    const isin = typeof ca.isin === "string" ? ca.isin.trim() : "";
    // A dividend with no readable date is booked with that date and taken
    // out, named with its amount, by dropUndatedCash below (#467).
    const dateRaw = typeof ca.date === "string" ? ca.date.trim() : "";
    const tradeDate = convertFreedom24Date(dateRaw);
    const currency = currencyOf(ca.curr_c);
    const currencyCell = unreadableCell("curr_c", ca.curr_c);
    const { symbol: tickerSymbol, exchange } = parseSymbol(ticker);

    // Every corporate action that is not a dividend or a coupon (a split, a
    // consolidation, a merger, a conversion, bonus shares, a maturity, a
    // redemption...) moves shares of its security, or takes them away with
    // money. So it is evidence of a holding at the anti-churning window start
    // (#453, #467): kept as a row that books nothing, named as not applied,
    // never dropped. The JSON gives no share count for it. With no ticker and
    // no ISIN it makes the evidence of every security "unverified".
    // A row whose type_id is empty or not text cannot be classified: it may
    // be a split as well as a dividend, so it is kept the same way, named by
    // its type_id cell, and counted by freedom24.row_skipped_malformed (#467).
    const dividend = typeId.includes("dividend") || typeId.includes("coupon");
    if (!dividend) {
      if (!typeId) skippedMalformed++;
      trades.push(corporateActionTrade({
        tradeID: `freedom24-ca-${tradeDate}-${i}`,
        symbol: tickerSymbol, description: ticker, isin, assetCategory: "STK", currency: currency || "EUR", tradeDate, exchange,
      }, typeId ? typeIdText : "type_id", typeId ? "" : unreadableCell("type_id", ca.type_id).slice("type_id: ".length)));
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
    // A tax_amount cell that is written but is no finite number is read as
    // no withholding (the user can only lose a deduction, never underpay),
    // and the cell is named (#467). A missing, null or empty one is none.
    // The cast JSON may carry null, an object or a boolean there.
    // A readable tax_amount larger than the dividend cannot be its withholding
    // ("1e400", or "1.234,56" on a 500 dividend): booked, it went to box 0597
    // with no cap for a Spanish security, so it is treated the same way (#467).
    const taxCell: unknown = ca.tax_amount;
    const taxUnreadable = taxCell !== undefined && taxCell !== null && taxCell !== "" &&
      (!(typeof taxCell === "string" || typeof taxCell === "number") || quantityUnreadable(taxCell) ||
        (amountReadable && toFiniteDecimal(taxAmount).abs().greaterThan(toFiniteDecimal(amount, "0", false).abs())));
    const tax = taxUnreadable
      ? ` [${unreadableCell("tax_amount", ca.tax_amount)}]`
      : toFiniteDecimal(taxAmount).isZero() ? "" : ` (tax_amount ${taxAmount})`;
    // A dividend with no ticker goes by its ISIN; with neither it is named,
    // never dropped with no word (#467).
    if (!ticker && !isin) {
      if (!amountReadable || !toFiniteDecimal(amount).isZero() || tax) unidentifiedCash.push(`${typeIdText} ${amountText} ${currency || `[${currencyCell}]`}${tax} ${tradeDate || "—"}`);
      continue;
    }
    const security = ticker || isin;
    const symbol = ticker ? tickerSymbol : isin;
    // A dividend with no readable curr_c is not booked: read as USD, a euro
    // dividend lost 8 % of its income and of its withholding. It is named
    // by its amount and curr_c cells, as they are in the file (#467).
    if (!currency) {
      const taxShown = taxUnreadable ? unreadableCell("tax_amount", ca.tax_amount) : tax ? `tax_amount ${taxAmount}` : "";
      unreadableCurrencyCash.push(cashIncomeRowText(typeIdText, isin ? (ticker ? `${tickerSymbol} (${isin})` : isin) : tickerSymbol, "",
        tradeDate, [unreadableCell("amount", ca.amount), currencyCell], taxShown));
      continue;
    }
    if (!amountReadable) {
      unreadableAmountCash.push(`${typeIdText} ${isin ? (ticker ? `${tickerSymbol} (${isin})` : isin) : tickerSymbol} ${currency} ${tradeDate || "—"}${tax} ${amountText}`);
      continue;
    }
    if (taxUnreadable) {
      unreadableTaxCash.push(`${typeIdText} ${isin ? (ticker ? `${tickerSymbol} (${isin})` : isin) : tickerSymbol} ${amount} ${currency} ${tradeDate || "—"}${tax}`);
    }
    // Include ISIN country code so dividend engine can extract withholding country
    const isinCountry = isin.length >= 2 ? isin.slice(0, 2).toUpperCase() : "";

    // Dividend entry
    cashTransactions.push({
      transactionID: `freedom24-div-${tradeDate}-${isin}-${i}`,
      accountId: "",
      symbol,
      // The cast JSON may carry a number or an object: the engine reads the
      // description as text, so anything else stopped the report (#467).
      description: typeof ca.description === "string" && ca.description.trim() ? ca.description.trim() : `${isinCountry} Dividend - ${security}`,
      isin,
      currency,
      dateTime: tradeDate,
      settleDate: tradeDate,
      amount,
      fxRateToBase: "1",
      type: "Dividends",
    });

    // Withholding tax (if present and usable)
    const taxDec = toFiniteDecimal(taxAmount);
    if (!taxUnreadable && !taxDec.isZero()) {
      cashTransactions.push({
        transactionID: `freedom24-wht-${tradeDate}-${isin}-${i}`,
        accountId: "",
        symbol,
        description: `${isinCountry} WHT - ${security}`,
        isin,
        currency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        // A reversed dividend (a negative amount) refunds its withholding,
        // whatever sign the file gives its tax_amount: booked as withheld, a
        // fully reversed Spanish dividend kept 38 € in box 0597 on 0 € of
        // income (#467). Any other dividend books it as withheld.
        amount: (new Decimal(amount).isNegative() ? taxDec.abs() : taxDec.abs().neg()).toString(),
        fxRateToBase: "1",
        type: "Withholding Tax",
      });
    }
  }

  // Cash flows are not booked. A deposit or a withdrawal is no income. Any
  // other row (an interest, a dividend, a coupon, a tax, a fee, an unknown
  // type) is named with its type, amount, currency and date, never dropped
  // with no word (#467). A written zero amount stays skipped.
  const flowsNotRead: string[] = [];
  const rawFlows: unknown = root.cash_flows?.detailed;
  if (Array.isArray(rawFlows)) {
    for (const row of rawFlows as unknown[]) {
      const flow: Freedom24CashFlow = typeof row === "object" && row !== null ? row : {};
      const typeId = text(flow.type_id);
      const typeName = text(flow.type);
      if (isTransfer(`${typeId} ${typeName}`)) continue;
      const type = typeId && typeName && typeId !== typeName ? `${typeId} (${typeName})` : typeId || typeName;
      const amount = text(flow.amount);
      const amountValue = toFiniteDecimalString(amount, "", false);
      if (amountValue !== "" && toFiniteDecimal(amountValue, "0", false).isZero()) continue;
      flowsNotRead.push(`${type || "—"} ${amount || "—"} ${text(flow.curr_c).toUpperCase() || "—"} ${convertFreedom24Date(text(flow.date)) || "—"}`);
    }
  }

  const parserMessages: TaxMessage[] = [];
  if (skippedMalformed > 0) {
    parserMessages.push({
      id: "freedom24.row_skipped_malformed",
      severity: "warning" as const,
      message: `Freedom24: ${skippedMalformed} fila(s) de acciones corporativas no tienen un tipo legible (type_id) y no se calculan.`,
      hint: "El campo \"type_id\" de esas filas está vacío o no es texto. Por eso DeclaRenta no sabe si son un dividendo, un cupón u otra operación. No suma ningún importe por ellas. Pueden mover acciones. Por eso el aviso de operaciones societarias no aplicadas también las nombra. La comprobación de compra única de la regla de los 2 meses puede verse afectada. DeclaRenta no aplica esa excepción a su valor. Si la fila no nombra ningún valor, no la aplica a ninguno. Si te falta un dividendo o un cupón, vuelve a descargar el informe JSON completo de Freedom24 y súbelo de nuevo.",
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
  if (unreadableTaxCash.length > 0) {
    const count = String(unreadableTaxCash.length);
    const rows = unreadableTaxCash.join("; ");
    parserMessages.push({
      id: "freedom24.tax_amount_unreadable",
      severity: "warning" as const,
      message: `Freedom24: ${count} dividendo(s) o cupón(es) no tienen una retención (tax_amount) que se pueda usar y se calculan sin retención: ${rows}.`,
      hint: "Entre corchetes va la celda de la retención (tax_amount). No es un número, o es mayor que el importe (amount) del dividendo. DeclaRenta suma el ingreso completo, pero no sabe cuánto te retuvieron. Así no pagas de menos, pero pierdes la deducción por esa retención (casilla 0588, o 0597 si el valor es español). Toma la retención del informe fiscal de Freedom24 y añádela a mano en Renta Web.",
      context: { count, rows },
    });
  }
  if (flowsNotRead.length > 0) {
    const count = String(flowsNotRead.length);
    const rows = flowsNotRead.join("; ");
    parserMessages.push({
      id: "freedom24.cash_flow_not_read",
      severity: "warning" as const,
      message: `Freedom24: ${count} movimiento(s) de dinero de cash_flows no se calculan: ${rows}.`,
      hint: "DeclaRenta solo calcula las operaciones (trades) y los dividendos y cupones (corporate_actions) del informe. No calcula las filas de cash_flows. No te avisa de los ingresos y las retiradas de dinero de tu cuenta, porque no tributan. Cada fila de este aviso puede ser un interés, un dividendo, un cupón, una retención o una comisión. Un interés o un dividendo que no está en corporate_actions es un ingreso que tienes que declarar. Añádelo a mano en Renta Web. Si la fila repite un dividendo de corporate_actions, ya está calculado. Una comisión que falta solo puede hacerte pagar más.",
      context: { count, rows },
    });
  }
  markUndatedTrades(trades, "date");
  parserMessages.push(
    ...tradeQuantityUnknownMessages("Freedom24", trades),
    ...dropUndatedCash("Freedom24", cashTransactions, "date"),
    ...cashRowsUnidentifiedMessages("Freedom24", unidentifiedCash),
    ...cashIncomeAmountUnreadableMessages("Freedom24", unreadableCurrencyCash),
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
