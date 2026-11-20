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
import type { TaxMessage } from "../types/tax.js";
import Decimal from "decimal.js";
import {
  detectDelimiter,
  parseCsvLine,
  parseNumber,
  toFiniteDecimalString,
  convertDateISO,
  convertDateDMYDot,
  findColumn,
  stripBom,
  timeOfDay,
  quantityUnknownTrade,
  quantityUnreadable,
  tradeQuantityUnknownMessages,
  unreadableTrade,
  unreadableCell,
  corporateActionTrade,
  isCorporateActionType,
  markUndatedTrades,
  dropUndatedCash,
  cashRowsUnidentifiedMessages,
  cashIncomeRowText,
  cashIncomeAmountUnreadableMessages,
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
// Cash/savings-account interest (KKT-Abschluss). "interes" matches both EN
// "interest" and ES "intereses"; "zins" matches DE "zinsen". None of the
// dividend/buy/sell type tokens contain these substrings, so there is no clash.
const INTEREST_TYPES = ["interes", "zins"];

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
  let interestWithholdingRows = 0;
  // Distribution rows with no ISIN (#467).
  const unidentifiedCash: string[] = [];
  // Interest and distribution rows whose amount cannot be read (#467).
  const unreadableIncome: string[] = [];
  // Reversed distributions whose tax cannot be read (#467).
  const incomeNotRead: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, delimiter);

    // Only process executed transactions
    const status = (fields[cols.status] ?? "").trim().toLowerCase();
    if (status && status !== "executed" && status !== "ejecutada" && status !== "ausgeführt") continue;

    const dateStr = (fields[cols.date] ?? "").trim();
    // YYYY-MM-DD → YYYYMMDD; a German export may write DD.MM.YYYY. Any other
    // text stays as it is: the row is kept and named as undated (#467).
    const tradeDate = /^\d{2}\.\d{2}\.\d{4}/.test(dateStr) ? convertDateDMYDot(dateStr.slice(0, 10)) : convertDateISO(dateStr);
    const tradeTime = cols.time >= 0 ? timeOfDay(fields[cols.time] ?? "") : undefined;
    const type = (fields[cols.type] ?? "").trim().toLowerCase();
    const assetType = cols.assetType >= 0 ? (fields[cols.assetType] ?? "").trim().toLowerCase() : "";
    const isin = (fields[cols.isin] ?? "").trim();
    const description = (fields[cols.description] ?? "").trim();
    const shares = parseNumber(fields[cols.shares] ?? "0");
    const price = parseNumber(fields[cols.price] ?? "0");
    const amount = toFiniteDecimalString(fields[cols.amount] ?? "0");
    const fee = toFiniteDecimalString(fields[cols.fee] ?? "0");
    const tax = toFiniteDecimalString(fields[cols.tax] ?? "0");
    const currency = (fields[cols.currency] ?? "EUR").trim();
    const reference = (fields[cols.reference] ?? "").trim();

    // Cash/savings-account interest (KKT-Abschluss). Match ONLY the `type`
    // column (already lowercased above) with a tight keyword set — matching the
    // description risks sweeping a security named "…Interest…ETF". This branch
    // MUST stay ABOVE the `if (!isin) continue` guard below: interest rows carry
    // no ISIN, so the guard would silently drop them before classification.
    // An interest or distribution row whose amount cannot be read is no
    // zero: neither it nor its tax is booked, and it is named (#467).
    const isIncome = INTEREST_TYPES.some((k) => type.includes(k)) || DIVIDEND_TYPES.some((d) => type.includes(d));
    if (isIncome && quantityUnreadable(fields[cols.amount])) {
      const taxShown = new Decimal(tax).isZero() ? "" : `${headers[cols.tax] ?? "tax"} ${tax}`;
      const security = isin ? `${description || "—"} (${isin})` : description;
      unreadableIncome.push(cashIncomeRowText((fields[cols.type] ?? "").trim(), security, currency || "EUR", tradeDate,
        [unreadableCell(headers[cols.amount] ?? "amount", fields[cols.amount])], taxShown));
      continue;
    }
    if (INTEREST_TYPES.some((k) => type.includes(k))) {
      // Sign decides the IRPF treatment (split downstream by type, abs()'d):
      //   positive → interest credited → Casilla 0027 (Art. 25.2 LIRPF)
      //   negative → cash-account charge → "intereses pagados al broker"
      //              (Art. 26.1.a, informational only, not deductible)
      //   zero     → no economic event → skip
      const signed = new Decimal(amount);
      if (signed.isZero()) continue;
      // Withholding on interest (Casilla 0588) is not yet wired. Scalable cash
      // interest to non-residents is normally paid gross (no retención), so the
      // `amount` is the gross/íntegro figure that belongs in 0027. If a real
      // file ever carries a non-zero `tax` on an interest row we surface an info
      // message rather than silently ignoring it (the gross/net and 0588-credit
      // handling would then be a follow-up — see the parserMessages below).
      if (parseFloat(parseNumber(tax)) !== 0) interestWithholdingRows++;
      cashTransactions.push({
        transactionID: reference || `scalable-int-${tradeDate}-${i}`,
        accountId: "",
        symbol: "CASH",
        description: description || "Interest - Scalable Capital",
        isin: "",
        currency: currency || "EUR",
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount,
        fxRateToBase: "1",
        type: signed.isPositive() ? "Broker Interest Received" : "Broker Interest Paid",
      });
      continue;
    }

    // A buy or sale row with no ISIN, or a row of a type no branch below
    // handles (a security transfer, a corporate action) of an ISIN, is kept
    // as a trade that books nothing and named: dropping it would hide a
    // purchase or a sale (#467). A row of an unknown type that writes a zero
    // share count moves no shares and stays skipped, unless it is a corporate
    // action that moves money (below). With no ISIN, a row of an
    // unknown type is kept only when it writes a share count (a cash row,
    // such as a deposit or a fee, writes none).
    const sellType = SELL_TYPES.some((t) => type.includes(t));
    const buyType = BUY_TYPES.some((t) => type.includes(t));
    const otherType = !sellType && !buyType && !DIVIDEND_TYPES.some((d) => type.includes(d));
    const sharesUnreadable = quantityUnreadable(fields[cols.shares]);
    const movesNoShares = !sharesUnreadable && parseFloat(parseNumber(shares)) === 0;
    // An unknown type with an empty share cell is a cash row (a fee, a tax).
    const sharesEmpty = (fields[cols.shares] ?? "").trim() === "";
    // A corporate action of an ISIN that writes 0 shares but moves money (a
    // cash merger, a redemption) may be a taxable sale: kept and named, never
    // dropped with no word (#467). A blank or written zero amount stays skipped.
    const amountCell = (fields[cols.amount] ?? "").trim();
    const paidAction = isin !== "" && movesNoShares && isCorporateActionType(type) && amountCell !== "" &&
      (quantityUnreadable(amountCell) || !new Decimal(amount).isZero());
    const keptOther = otherType && (isin ? !movesNoShares || paidAction : !sharesUnreadable && !movesNoShares);
    // A split or another corporate action moves shares of its security: kept
    // as a row that books nothing (evidence of a holding, #453) and named as
    // not applied, not as an unreadable row.
    if (keptOther && isCorporateActionType(type)) {
      trades.push(corporateActionTrade({
        tradeID: reference || `scalable-action-${tradeDate}-${isin}-${i}`,
        symbol: description, description, isin, assetCategory: /etf|fund/.test(assetType) ? "FUND" : "STK",
        currency: currency || "EUR", tradeDate, tradeTime, exchange: "XETR",
      }, (fields[cols.type] ?? "").trim(), fields[cols.shares] ?? ""));
      continue;
    }
    const cell = (sellType || buyType) && !isin ? unreadableCell(headers[cols.isin] ?? "isin", isin)
      : keptOther && !sharesEmpty ? unreadableCell(headers[cols.type] ?? "type", fields[cols.type] ?? "")
      : undefined;
    if (cell !== undefined) {
      trades.push(unreadableTrade({
        tradeID: reference || `scalable-row-${tradeDate}-${isin}-${i}`,
        symbol: description, description, isin, assetCategory: /etf|fund/.test(assetType) ? "FUND" : "STK",
        currency: currency || "EUR", tradeDate, tradeTime,
        ...(sellType || buyType ? { buySell: sellType ? "SELL" as const : "BUY" as const } : {}), exchange: "XETR",
      }, cell));
      continue;
    }

    // A distribution with no ISIN names no security (the description is only
    // a name): it is named, never dropped with no word (#467).
    if (!isin && DIVIDEND_TYPES.some((d) => type.includes(d))) {
      if (!new Decimal(amount).isZero()) {
        const taxShown = new Decimal(tax).isZero() ? "" : ` (${headers[cols.tax] ?? "tax"} ${tax})`;
        unidentifiedCash.push(`${(fields[cols.type] ?? "").trim()} ${description || "—"} ${amount} ${currency || "EUR"}${taxShown} ${tradeDate || "—"}`);
      }
      continue;
    }
    if (!isin) continue;

    // Distributions → cash transactions (dividends)
    if (DIVIDEND_TYPES.some((d) => type.includes(d))) {
      // Include ISIN country code so dividend engine can extract withholding country
      const isinCountry = isin.length >= 2 ? isin.slice(0, 2).toUpperCase() : "";
      // A negative distribution reverses one. Its tax is a refund of the
      // reversed withholding, whatever its sign: read as a new withholding, a
      // reversed Spanish dividend gave its 0597 credit twice (#467). A tax
      // cell that cannot be read is no withholding: a dividend is booked in
      // full with none, which can only raise the tax; a reversal is not booked
      // at all, so the dividend it reverses keeps its income, and is named.
      const reversal = new Decimal(amount).isNegative();
      const taxCell = cols.tax >= 0 ? fields[cols.tax] : undefined;
      if (reversal && taxCell !== undefined && taxCell.trim() !== "" && quantityUnreadable(taxCell)) {
        incomeNotRead.push(cashIncomeRowText((fields[cols.type] ?? "").trim(), `${description || "—"} (${isin}) ${amount}`,
          currency || "EUR", tradeDate, [unreadableCell(headers[cols.tax] ?? "tax", taxCell)]));
        continue;
      }
      cashTransactions.push({
        transactionID: `scalable-${tradeDate}-${isin}-${i}`,
        accountId: "",
        symbol: description,
        description: `${isinCountry} ${type} - ${description}`,
        isin,
        currency: currency || "EUR",
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount,
        fxRateToBase: "1",
        type: "Dividends",
      });

      // If there's a tax amount, add withholding
      const taxNum = parseFloat(parseNumber(tax));
      if (taxNum !== 0) {
        cashTransactions.push({
          transactionID: `scalable-tax-${tradeDate}-${isin}-${i}`,
          accountId: "",
          symbol: description,
          description: `${isinCountry} WHT - ${description}`,
          isin,
          currency: currency || "EUR",
          dateTime: tradeDate,
          settleDate: tradeDate,
          amount: reversal ? new Decimal(tax).abs().toString() : new Decimal(tax).abs().neg().toString(),
          fxRateToBase: "1",
          type: "Withholding Tax",
        });
      }
      continue;
    }

    // Trades
    const sharesNum = parseFloat(parseNumber(shares));
    const isSell = SELL_TYPES.some((s) => type.includes(s));
    const isBuy = BUY_TYPES.some((b) => type.includes(b));
    // An empty or unreadable share count is no "0": keep a buy or sale row as
    // a trade of unknown quantity for the anti-churning evidence (#453).
    if ((isSell || isBuy) && quantityUnreadable(fields[cols.shares])) {
      trades.push(quantityUnknownTrade({
        tradeID: reference || `scalable-${tradeDate}-${isin}-${i}`,
        symbol: description, description, isin, assetCategory: /etf|fund/.test(assetType) ? "FUND" : "STK",
        currency: currency || "EUR", tradeDate, tradeTime, buySell: isSell ? "SELL" : "BUY", exchange: "XETR",
      }));
      continue;
    }
    if (sharesNum === 0) continue;
    if (!isSell && !isBuy) continue;

    const absShares = Math.abs(sharesNum);
    const feeNum = parseFloat(parseNumber(fee));
    // Scalable's assetType column flags ETFs/funds explicitly ("ETF").
    // Map those to FUND; "Security" and others remain STK.
    const assetCategory: Trade["assetCategory"] = /etf|fund/.test(assetType) ? "FUND" : "STK";

    // FIFO values a trade at quantity × tradePrice, never from the amount. A
    // price it cannot read ("abc", "-") stopped the report, and an empty,
    // missing or written-zero one sold the shares at 0: a gain became a loss
    // with no word (#467). Scalable writes amount = shares × price, so with no
    // price the price is |amount| ÷ shares, the file's own numbers. A readable
    // price keeps the file's text. With no amount either, a written zero price
    // moves shares for no money: a corporate action not applied, as in
    // Lightyear, Flatex, DEGIRO and Freedom24. A price that cannot be read
    // makes the row one that books nothing, named by its price cell.
    const priceCell = cols.price >= 0 ? fields[cols.price] : undefined;
    const priceReadable = !quantityUnreadable(priceCell) && !new Decimal(price).isNegative();
    const amountAbs = new Decimal(amount).abs();
    if (!priceReadable || new Decimal(price).isZero()) {
      const row = {
        symbol: description, description, isin, assetCategory, currency: currency || "EUR", tradeDate, tradeTime,
        buySell: isSell ? "SELL" as const : "BUY" as const, exchange: "XETR",
      };
      if (amountAbs.isZero() && priceReadable) {
        trades.push(corporateActionTrade({ ...row, tradeID: reference || `scalable-action-${tradeDate}-${isin}-${i}` },
          `${headers[cols.price] ?? "price"} ${priceCell!.trim()}`, fields[cols.shares] ?? ""));
        continue;
      }
      if (amountAbs.isZero()) {
        trades.push(unreadableTrade({ ...row, tradeID: reference || `scalable-row-${tradeDate}-${isin}-${i}` },
          unreadableCell(headers[cols.price] ?? "price", priceCell)));
        continue;
      }
    }
    const tradePrice = priceReadable && !new Decimal(price).isZero() ? price : amountAbs.div(new Decimal(parseNumber(shares)).abs()).toString();

    trades.push({
      tradeID: reference || `scalable-${tradeDate}-${isin}-${i}`,
      accountId: "",
      symbol: description,
      description,
      isin,
      assetCategory,
      currency: currency || "EUR",
      tradeDate,
      tradeTime,
      settlementDate: tradeDate,
      quantity: isSell ? `-${absShares}` : `${absShares}`,
      tradePrice,
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

  const parserMessages: TaxMessage[] = [];
  if (interestWithholdingRows > 0) {
    parserMessages.push({
      id: "scalable.interest_withholding_detected",
      severity: "info" as const,
      message: `Se detectó una retención en ${interestWithholdingRows} fila(s) de intereses de Scalable Capital. El interés se ha declarado íntegro en la casilla 0027.`,
      hint: "La deducción por doble imposición (casilla 0588) sobre intereses aún no se calcula automáticamente. Revisa la retención en tu certificado fiscal y, si procede, decláralo manualmente. Los intereses de cuenta a no residentes suelen pagarse sin retención.",
      context: { count: String(interestWithholdingRows) },
    });
  }
  if (incomeNotRead.length > 0) {
    const rows = incomeNotRead.join("; ");
    parserMessages.push({
      id: "scalable.income_row_not_read",
      severity: "warning",
      message: `Scalable Capital: ${incomeNotRead.length} dividendo(s) no se pueden leer y no se calculan: ${rows}.`,
      hint: "Entre corchetes va la celda que falla. Puede ser la retención (tax) de una fila que anula un dividendo. Entonces DeclaRenta no resta esa fila, y el dividendo anulado sigue sumado con su retención. Compara cada fila con el extracto de Scalable Capital. Si anula un dividendo, quita en Renta Web ese dividendo y su retención.",
      context: { count: String(incomeNotRead.length), rows },
    });
  }
  markUndatedTrades(trades, headers[cols.date] ?? "date");
  parserMessages.push(
    ...tradeQuantityUnknownMessages("Scalable Capital", trades),
    ...dropUndatedCash("Scalable Capital", cashTransactions, headers[cols.date] ?? "date"),
    ...cashRowsUnidentifiedMessages("Scalable Capital", unidentifiedCash),
    ...cashIncomeAmountUnreadableMessages("Scalable Capital", unreadableIncome),
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
    const delimiter = detectDelimiter(headerLine);

    if (!isScalableCsv(headerLine)) {
      throw new Error("Scalable Capital CSV: formato no reconocido");
    }

    return parseScalableCsv(lines, delimiter);
  },
};
