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
import type { Trade, CashTransaction, AssetCategory } from "../types/ibkr.js";
import type { TaxMessage } from "../types/tax.js";
import { parseCsvLine, parseNumber, toFiniteDecimal, toFiniteDecimalString, stripBom, findColumn, quantityUnknownTrade, quantityUnreadable, tradeQuantityUnknownMessages, unreadableTrade, unreadableCell, corporateActionTrade, markUndatedTrades, dropUndatedCash, cashIncomeRowText, cashIncomeAmountUnreadableMessages } from "./csv-utils.js";
import Decimal from "decimal.js";
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
  const idx = (names: string[]) => findColumn(headers, names);
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

/**
 * Normalized money string for a column. Trade/CashTransaction money fields are
 * strings consumed downstream by Decimal, so we keep full precision here instead
 * of round-tripping through parseFloat (which loses precision).
 */
function numStr(fields: string[], col: number): string {
  const v = field(fields, col);
  if (!v) return "0";
  return parseNumber(v);
}

/** Numeric value of a column, for sign/zero comparisons only (never money). */
function num(fields: string[], col: number): number {
  const v = field(fields, col);
  if (!v) return 0;
  return parseFloat(parseNumber(v)) || 0;
}

/** How a dividend row names its security: `name (ISIN)`, the ISIN or the name. */
function dividendSecurity(name: string, symbol: string): string {
  return symbol ? (name ? `${name} (${symbol})` : symbol) : name || "—";
}

function dateToCompact(dateStr: string): string {
  // normalizeDate returns YYYY-MM-DD; we need YYYYMMDD for internal format
  return normalizeDate(dateStr).replace(/-/g, "");
}

function mapAssetCategory(assetClass: string): AssetCategory {
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
  // Rows that move securities without a trade (mergers, free shares, transfers
  // in). They are not imported, so the user is told which ISINs to review.
  const corporateActionIsins = new Set<string>();
  let corporateActionRows = 0;
  const deliveryIsins = new Set<string>();
  let deliveryRows = 0;
  // Dividend, interest and tax-optimisation rows whose amount cannot be read (#467).
  const unreadableIncome: string[] = [];
  // Dividends whose tax cell cannot be read (#467).
  const unreadableTax: string[] = [];
  // CASH rows of a type the parser does not know that name a security (#467).
  // Buys and sales with a positive tax, which is not booked (#467).
  const positiveTradeTax: string[] = [];
  const unknownCash: string[] = [];

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
    // Money fields kept as normalized strings for full Decimal precision.
    const amountStr = numStr(fields, cols.amount);
    const sharesStr = numStr(fields, cols.shares);
    const priceStr = numStr(fields, cols.price);
    const taxStr = numStr(fields, cols.tax);
    // Numeric values used only for sign/zero comparisons (never as money).
    const amount = num(fields, cols.amount);
    const shares = num(fields, cols.shares);
    // A tax cell that is written but cannot be read ("-15.00 EUR", "-15abc",
    // "-Infinity") is no number: it is never booked as a withholding (#467).
    const taxUnreadable = field(fields, cols.tax) !== "" && quantityUnreadable(fields[cols.tax]);
    const taxDec = taxUnreadable ? toFiniteDecimal("0") : toFiniteDecimal(taxStr);
    const fxRate = field(fields, cols.fxRate);
    const originalAmount = field(fields, cols.originalAmount);
    const originalCurrency = field(fields, cols.originalCurrency);
    // A dividend reads original_amount, in original_currency, only when it
    // has both; else the amount column, in the account currency (#467).
    const fromOriginal = type === "DIVIDEND" && originalAmount !== "" && originalCurrency !== "";
    // A row moves shares when it does not write a zero share count and names
    // an ISIN or writes a share count. With neither, it moves nothing (#467).
    const sharesUnreadable = quantityUnreadable(fields[cols.shares]);
    const movesShares = !(!sharesUnreadable && shares === 0) && (symbol !== "" || !sharesUnreadable);

    // --- TRADING of another type (#467): a row of the trading category that
    // names a security but is neither a buy nor a sale is kept as a trade that
    // books nothing and named, never dropped. One that writes a zero share
    // count moves no shares and stays skipped. With no ISIN (symbol), one that
    // writes a share count is kept, with or without a name: as a BUY with no
    // security is, it is evidence of an unidentified trade.
    if (category === "TRADING" && type !== "BUY" && type !== "SELL") {
      if (movesShares) {
        const isCrypto = mapAssetCategory(assetClass) === "CRYPTO";
        trades.push(unreadableTrade({
          tradeID: txId || `tr-${tradeDate}-${symbol}-${i}`,
          symbol: isCrypto ? symbol : name, description: name, isin: isCrypto ? "" : symbol,
          assetCategory: mapAssetCategory(assetClass), currency, tradeDate, exchange: "TRADE_REPUBLIC",
        }, unreadableCell(headers[cols.type] ?? "type", field(fields, cols.type))));
      }
      continue;
    }

    // --- TRADING: BUY / SELL ---
    if (category === "TRADING" && (type === "BUY" || type === "SELL")) {
      // An empty or unreadable share count is no "0": keep the row as a trade
      // of unknown quantity for the anti-churning evidence (#453).
      if (quantityUnreadable(fields[cols.shares])) {
        const isCrypto = mapAssetCategory(assetClass) === "CRYPTO";
        trades.push(quantityUnknownTrade({
          tradeID: txId || `tr-${tradeDate}-${symbol}-${i}`,
          symbol: isCrypto ? symbol : name, description: name, isin: isCrypto ? "" : symbol,
          assetCategory: mapAssetCategory(assetClass), currency, tradeDate,
          buySell: type === "SELL" ? "SELL" : "BUY", exchange: "TRADE_REPUBLIC",
        }));
        continue;
      }
      if (shares === 0) continue;

      const isSell = type === "SELL";
      // A buy or sale must name its security: crypto by its ticker (symbol),
      // anything else by its ISIN or its name. Booked under an empty symbol,
      // unrelated securities shared one FIFO pool and one took another's
      // cost (#467). It is kept as a row that books nothing, and named.
      if (mapAssetCategory(assetClass) === "CRYPTO" ? symbol === "" : symbol === "" && name === "") {
        trades.push(unreadableTrade({
          tradeID: txId || `tr-${tradeDate}-${symbol}-${i}`,
          symbol, description: name, isin: "",
          assetCategory: mapAssetCategory(assetClass), currency, tradeDate, buySell: isSell ? "SELL" : "BUY",
          exchange: "TRADE_REPUBLIC",
        }, unreadableCell(headers[cols.symbol] ?? "symbol", field(fields, cols.symbol))));
        continue;
      }
      // Price, amount and fee are read once, from the cell. Read again from
      // numStr, a cell such as "1.2,3,4" (first read "12.3,4", no number)
      // became 123.4, and its raw text stopped the report (#467).
      const absAmountDec = toFiniteDecimal(field(fields, cols.amount)).abs();
      // A real BUY/SELL with no usable amount (missing/garbage) would produce a
      // 0-cost / 0-proceeds trade (phantom gain). It is kept as a trade that
      // books nothing and named: dropped, it hid a purchase or a sale (#467).
      if (absAmountDec.isZero()) {
        trades.push(unreadableTrade({
          tradeID: txId || `tr-${tradeDate}-${symbol}-${i}`,
          symbol: mapAssetCategory(assetClass) === "CRYPTO" ? symbol : name, description: name,
          isin: mapAssetCategory(assetClass) === "CRYPTO" ? "" : symbol,
          assetCategory: mapAssetCategory(assetClass), currency, tradeDate, buySell: isSell ? "SELL" : "BUY",
          exchange: "TRADE_REPUBLIC",
        }, unreadableCell(headers[cols.amount] ?? "amount", field(fields, cols.amount))));
        continue;
      }
      const absSharesDec = toFiniteDecimal(sharesStr).abs();
      const absShares = absSharesDec.toString();
      const absAmount = absAmountDec.toString();
      // The fee keeps the sign TR writes: a paid fee is negative ("-1.00"),
      // a positive one is money paid back, a rebate, as commissionCost reads
      // it. Booked by its absolute value, a rebate lowered the gain by twice
      // its amount (#467). A charge written positive can only raise the tax.
      const fee = toFiniteDecimal(field(fields, cols.fee));
      // TR writes a paid tax as a negative number. A positive one is money
      // paid back, no cost: booked by its absolute value, it lowered the gain
      // by twice the refund. It is not booked, and the row is named (#467).
      // An unreadable tax cell is no tax (taxDec is 0), as before.
      if (taxDec.isPositive() && !taxDec.isZero()) {
        positiveTradeTax.push(`${field(fields, cols.type)} ${dividendSecurity(name, symbol)} ${tradeDate || "—"} [${unreadableCell(headers[cols.tax] ?? "tax", fields[cols.tax])}]`);
      }
      // FIFO values the lot from tradePrice, not amount. When the price column
      // is empty, unreadable or negative, take it from amount / shares (amount
      // excludes the fee): a negative price sold the shares at a loss (#467).
      // A positive priceDec was read from priceStr itself, so priceStr is a
      // number; so is amountStr, booked as tradeMoney, once absAmountDec is not 0.
      const priceDec = toFiniteDecimal(field(fields, cols.price));
      const tradePrice = (priceDec.isZero() || priceDec.isNegative()) && !absSharesDec.isZero()
        ? absAmountDec.div(absSharesDec).toString()
        : priceStr;
      const assetCategory = mapAssetCategory(assetClass);
      // For crypto the symbol column holds the ticker (BTC), not an ISIN. FIFO
      // pools crypto by ticker across brokers, so the ticker is the symbol.
      const isCrypto = assetCategory === "CRYPTO";

      trades.push({
        tradeID: txId || `tr-${tradeDate}-${symbol}-${i}`,
        accountId: "",
        symbol: isCrypto ? symbol : name,
        description: name,
        isin: isCrypto ? "" : symbol,
        assetCategory,
        currency,
        tradeDate,
        settlementDate: tradeDate,
        quantity: isSell ? `-${absShares}` : absShares,
        tradePrice,
        tradeMoney: amountStr,
        proceeds: isSell ? absAmount : "0",
        cost: isSell ? "0" : absAmount,
        fifoPnlRealized: "0",
        fxRateToBase: "1",
        buySell: isSell ? "SELL" : "BUY",
        openCloseIndicator: isSell ? "C" : "O",
        exchange: "TRADE_REPUBLIC",
        commissionCurrency: currency,
        commission: fee.isZero() ? "0" : fee.toString(),
        taxes: taxDec.isNegative() ? taxDec.toString() : "0",
        multiplier: "1",
      });
      continue;
    }

    // A dividend, interest or tax-optimisation row whose amount cannot be
    // read is no zero: neither it nor its withholding is booked, and it is
    // named (#467). A dividend reads original_amount when it has one.
    if (category === "CASH" && (type === "DIVIDEND" || type === "INTEREST_PAYMENT" || type === "TAX_OPTIMIZATION")) {
      const amountCol = fromOriginal ? cols.originalAmount : cols.amount;
      if (quantityUnreadable(fields[amountCol])) {
        const security = type === "DIVIDEND" ? dividendSecurity(name, symbol) : "";
        const taxShown = type !== "DIVIDEND" ? ""
          : taxUnreadable ? unreadableCell(headers[cols.tax] ?? "tax", fields[cols.tax])
          : !taxDec.isZero() ? `${headers[cols.tax] ?? "tax"} ${taxStr}` : "";
        unreadableIncome.push(cashIncomeRowText(field(fields, cols.type), security, fromOriginal ? originalCurrency : currency, tradeDate,
          [unreadableCell(headers[amountCol] ?? "amount", fields[amountCol])], taxShown));
        continue;
      }
    }

    // --- CASH: DIVIDEND ---
    if (category === "CASH" && type === "DIVIDEND") {
      const isinCountry = symbol.length >= 2 ? symbol.slice(0, 2).toUpperCase() : "";
      // `originalAmount` is a RAW trimmed field (never normalized) and `amountStr`
      // is parseNumber-only (no finiteness check), so route the emitted amount
      // through toFiniteDecimalString — a literal "NaN"/"Infinity" or unparseable
      // value would otherwise reach `new Decimal(div.amount)` in dividends.ts and
      // poison Casilla 0029. Mirrors the TRADING branch's toFiniteDecimal usage.
      const divAmount = toFiniteDecimalString(fromOriginal ? originalAmount : amountStr);
      // The currency of the amount that was read: with no original_amount the
      // amount is the account currency's, even when original_currency is
      // written. Booked in USD, 100 EUR were valued at 90.90 € (#467).
      const divCurrency = fromOriginal ? originalCurrency : currency;
      const fxToBase = fxRate || "1";
      // TR converts a foreign dividend and credits the account currency: the
      // taxpayer never holds the USD, so it must not open an FX lot (#96).
      const brokerConverted = divCurrency !== currency;
      // A negative dividend reverses one (a storno). Its tax is a refund of
      // the reversed withholding, whatever its sign: read as a new
      // withholding, a reversed dividend gave its credit twice (#467).
      const reversal = new Decimal(divAmount).isNegative();
      const taxRow = (): string => cashIncomeRowText(field(fields, cols.type), `${dividendSecurity(name, symbol)} ${divAmount}`, divCurrency, tradeDate,
        [unreadableCell(headers[cols.tax] ?? "tax", fields[cols.tax])]);
      // A tax cell that cannot be read is no withholding. A dividend is then
      // booked in full with none, which can only raise the tax; a reversal is
      // not booked at all, so the dividend it reverses keeps its income. Both
      // are named (#467).
      if (taxUnreadable && reversal) {
        unreadableTax.push(taxRow());
        continue;
      }

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
        ...(brokerConverted ? { brokerConvertedToBase: true } : {}),
      });

      if (taxUnreadable) unreadableTax.push(taxRow());
      // Withholding tax (if present). A positive dividend's tax is withheld
      // whatever its sign (TR writes "-0.07"); a reversal's is refunded.
      if (!taxDec.isZero()) {
        cashTransactions.push({
          transactionID: txId ? `${txId}-wht` : `tr-div-wht-${tradeDate}-${symbol}-${i}`,
          accountId: "",
          symbol: name,
          description: `${isinCountry} WHT - ${name}`,
          isin: symbol,
          currency,
          dateTime: tradeDate,
          settleDate: tradeDate,
          amount: reversal ? taxDec.abs().toString() : taxDec.isNegative() ? taxStr : taxDec.neg().toString(),
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
        // numStr is parseNumber-only (no finiteness check); guard the emitted
        // amount so a non-finite value can't reach new Decimal() in the
        // interest engine and poison Casilla 0027 (mirrors the TRADING branch).
        amount: toFiniteDecimalString(amountStr),
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
          amount: amountStr,
          fxRateToBase: "1",
          type: "Broker Interest Received",
        });
      }
      continue;
    }

    // --- CORPORATE_ACTION (mergers, ...) / DELIVERY (free shares, ...) ---
    // Not applied: counted and named below. A row that names an ISIN or
    // writes a share count, and does not write a zero share count, moves
    // shares, so it is also kept as a row that books nothing: evidence of a
    // holding at the anti-churning window start (#453, #467). With no ISIN it
    // is evidence of an unidentified trade.
    // Even with a readable signed share count the parser books no lot: a
    // delivery in is a lot at the market value of that day (free shares) or at
    // the original cost (a transfer), and a merger carries the old cost to the
    // new shares, and the row gives neither value. The user adds a manual lot.
    if (category === "CORPORATE_ACTION" || category === "DELIVERY") {
      if (category === "CORPORATE_ACTION") {
        corporateActionRows++;
        if (symbol) corporateActionIsins.add(symbol);
      } else {
        deliveryRows++;
        if (symbol) deliveryIsins.add(symbol);
      }
      if (movesShares) {
        const isCrypto = mapAssetCategory(assetClass) === "CRYPTO";
        trades.push(corporateActionTrade({
          tradeID: txId || `tr-${category.toLowerCase()}-${tradeDate}-${symbol}-${i}`,
          symbol: isCrypto ? symbol : name, description: name, isin: isCrypto ? "" : symbol,
          assetCategory: mapAssetCategory(assetClass), currency, tradeDate,
          buySell: shares < 0 ? "SELL" : "BUY", exchange: "TRADE_REPUBLIC",
        }, `${category} ${field(fields, cols.type)}`.trim(), field(fields, cols.shares)));
      }
      continue;
    }

    // --- A category or CASH type the parser does not know (#467) ---
    // A CASH row that writes no share count, or a zero one, and a row of
    // another category that moves no shares, that names a security (an
    // ISIN) and does not write a zero amount, may be income (a coupon, a
    // capital return): it is not booked, since its meaning is unknown, and
    // it is named, with its category when it is not CASH. An empty amount
    // cell is no zero: it is named as an unreadable one. A row that moves
    // shares (a saveback, a stock perk) is kept as a row that books
    // nothing: evidence of a holding for the anti-churning exception
    // (#453). Rows with no security (deposits, card payments, transfers)
    // stay skipped.
    if (category === "CASH" ? sharesUnreadable || shares === 0 : !movesShares) {
      const amountCell = field(fields, cols.amount);
      if (symbol !== "" && !(!quantityUnreadable(amountCell) && amount === 0)) {
        const kind = category === "CASH" ? field(fields, cols.type) : `${field(fields, cols.category)} ${field(fields, cols.type)}`.trim();
        unknownCash.push(`${kind} ${dividendSecurity(name, symbol)} ${quantityUnreadable(amountCell) ? `[${unreadableCell(headers[cols.amount] ?? "amount", fields[cols.amount])}]` : amountStr} ${currency} ${tradeDate || "—"}`);
      }
      continue;
    }
    if (movesShares) {
      const isCrypto = mapAssetCategory(assetClass) === "CRYPTO";
      trades.push(unreadableTrade({
        tradeID: txId || `tr-${tradeDate}-${symbol}-${i}`,
        symbol: isCrypto ? symbol : name, description: name, isin: isCrypto ? "" : symbol,
        assetCategory: mapAssetCategory(assetClass), currency, tradeDate, exchange: "TRADE_REPUBLIC",
      }, category === "CASH"
        ? unreadableCell(headers[cols.type] ?? "type", field(fields, cols.type))
        : unreadableCell(headers[cols.category] ?? "category", field(fields, cols.category))));
    }
  }

  const parserMessages: TaxMessage[] = [];
  if (corporateActionRows > 0) {
    const isins = [...corporateActionIsins].join(", ");
    parserMessages.push({
      id: "trade_republic.corporate_action_not_applied",
      severity: "warning",
      message: `Trade Republic: DeclaRenta no ha aplicado ${corporateActionRows} movimiento(s) de acción corporativa (fusión, canje, split) de ${isins}.`,
      hint: "DeclaRenta no pasa el coste de los títulos antiguos a los nuevos. Por eso una venta posterior del nuevo valor puede salir sin lotes y con coste 0. Si fue una fusión o un canje, añade el coste de adquisición original en «Lotes manuales para posiciones transferidas».",
      context: { count: String(corporateActionRows), isins },
    });
  }
  if (deliveryRows > 0) {
    const isins = [...deliveryIsins].join(", ");
    parserMessages.push({
      id: "trade_republic.delivery_not_applied",
      severity: "warning",
      message: `Trade Republic: no se han importado ${deliveryRows} entrega(s) de títulos sin compraventa (acciones gratuitas, traspasos) de ${isins}.`,
      hint: "Las acciones gratuitas de una promoción son una ganancia patrimonial de la base general por su valor de mercado el día de la entrega: decláralas aparte y añade ese valor como coste en «Lotes manuales para posiciones transferidas». Si es un traspaso desde otro bróker, añade allí el coste de compra original.",
      context: { count: String(deliveryRows), isins },
    });
  }
  if (unreadableTax.length > 0) {
    const rows = unreadableTax.join("; ");
    parserMessages.push({
      id: "trade_republic.tax_unreadable",
      severity: "warning",
      message: `Trade Republic: ${unreadableTax.length} dividendo(s) no tienen una retención (tax) legible y se calculan sin retención: ${rows}.`,
      hint: "Entre corchetes va la celda de la retención (tax). No es un número. DeclaRenta suma el dividendo completo, pero no sabe cuánto te retuvieron. Así no pagas de menos, pero pierdes la deducción por esa retención (casilla 0588, o 0597 si el valor es español). Si la fila anula un dividendo (un importe negativo), DeclaRenta no la resta y el dividendo anulado sigue sumado. Toma la retención del informe fiscal de Trade Republic y añádela a mano en Renta Web.",
      context: { count: String(unreadableTax.length), rows },
    });
  }
  if (unknownCash.length > 0) {
    const rows = unknownCash.join("; ");
    parserMessages.push({
      id: "trade_republic.cash_type_not_read",
      severity: "warning",
      message: `Trade Republic: ${unknownCash.length} movimiento(s) de dinero de un tipo que DeclaRenta no reconoce no se calculan: ${rows}.`,
      hint: "Cada fila nombra un valor y trae un importe, pero DeclaRenta no sabe qué es. Puede ser un cupón, un dividendo, una devolución de capital, un interés o una comisión. Por eso no lo suma. Un ingreso del año que declaras tienes que declararlo igualmente. Añádelo a mano en Renta Web. Una comisión que falta solo puede hacerte pagar más.",
      context: { count: String(unknownCash.length), rows },
    });
  }
  if (positiveTradeTax.length > 0) {
    const rows = positiveTradeTax.join("; ");
    parserMessages.push({
      id: "trade_republic.trade_tax_positive",
      severity: "warning",
      message: `Trade Republic: ${positiveTradeTax.length} compra(s) o venta(s) traen un impuesto (tax) positivo, y DeclaRenta no lo cuenta: ${rows}.`,
      hint: "Trade Republic escribe en negativo el impuesto que pagas en una compra o una venta. Un impuesto positivo es dinero que te devuelven, así que no es un gasto de la operación. DeclaRenta no lo suma al coste ni lo resta de la venta. Así no pagas de menos. Si es la devolución de un impuesto que DeclaRenta restó en otra operación, esa operación tiene un gasto de más: corrígela a mano en Renta Web.",
      context: { count: String(positiveTradeTax.length), rows },
    });
  }
  markUndatedTrades(trades, headers[cols.date] ?? "date");
  // The corporate-action and delivery rows are named by the two warnings above.
  parserMessages.push(
    ...tradeQuantityUnknownMessages("Trade Republic", trades.filter((t) => t.corporateActionRow === undefined)),
    ...dropUndatedCash("Trade Republic", cashTransactions, headers[cols.date] ?? "date"),
    ...cashIncomeAmountUnreadableMessages("Trade Republic", unreadableIncome),
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
