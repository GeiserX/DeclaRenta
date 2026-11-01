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
import { parseCsvLine, parseNumber, toFiniteDecimal, toFiniteDecimalString, stripBom, findColumn } from "./csv-utils.js";
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
  let skippedNoAmount = 0;
  // Rows that move securities without a trade (mergers, free shares, transfers
  // in). They are not imported, so the user is told which ISINs to review.
  const corporateActionIsins = new Set<string>();
  let corporateActionRows = 0;
  const deliveryIsins = new Set<string>();
  let deliveryRows = 0;

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
    const feeStr = numStr(fields, cols.fee);
    const taxStr = numStr(fields, cols.tax);
    // Numeric values used only for sign/zero comparisons (never as money).
    const amount = num(fields, cols.amount);
    const shares = num(fields, cols.shares);
    const tax = num(fields, cols.tax);
    const fxRate = field(fields, cols.fxRate);
    const originalAmount = field(fields, cols.originalAmount);
    const originalCurrency = field(fields, cols.originalCurrency);

    // --- TRADING: BUY / SELL ---
    if (category === "TRADING" && (type === "BUY" || type === "SELL")) {
      if (shares === 0) continue;

      const isSell = type === "SELL";
      const absAmountDec = toFiniteDecimal(amountStr).abs();
      // A real BUY/SELL with no usable amount (missing/garbage) would produce a
      // 0-cost / 0-proceeds trade (phantom gain). Skip it and count it instead of
      // aborting the whole file, mirroring the Degiro skip-and-warn pattern.
      if (absAmountDec.isZero()) {
        skippedNoAmount++;
        continue;
      }
      const absSharesDec = toFiniteDecimal(sharesStr).abs();
      const absShares = absSharesDec.toString();
      const absAmount = absAmountDec.toString();
      const absFee = toFiniteDecimal(feeStr).abs();
      const absTax = toFiniteDecimal(taxStr).abs();
      // FIFO values the lot from tradePrice, not amount. When the price column
      // is empty, take it from amount / shares (amount excludes the fee).
      const priceDec = toFiniteDecimal(priceStr);
      const tradePrice = priceDec.isZero() && !absSharesDec.isZero()
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
        commission: absFee.isZero() ? "0" : absFee.neg().toString(),
        taxes: absTax.isZero() ? "0" : absTax.neg().toString(),
        multiplier: "1",
      });
      continue;
    }

    // --- CASH: DIVIDEND ---
    if (category === "CASH" && type === "DIVIDEND") {
      const isinCountry = symbol.length >= 2 ? symbol.slice(0, 2).toUpperCase() : "";
      // `originalAmount` is a RAW trimmed field (never normalized) and `amountStr`
      // is parseNumber-only (no finiteness check), so route the emitted amount
      // through toFiniteDecimalString — a literal "NaN"/"Infinity" or unparseable
      // value would otherwise reach `new Decimal(div.amount)` in dividends.ts and
      // poison Casilla 0029. Mirrors the TRADING branch's toFiniteDecimal usage.
      const divAmount = toFiniteDecimalString(
        originalAmount && originalCurrency ? originalAmount : amountStr,
      );
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
          amount: tax > 0 ? toFiniteDecimal(taxStr).abs().neg().toString() : taxStr,
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
    // Not imported: count them and warn below.
    if (category === "CORPORATE_ACTION") {
      corporateActionRows++;
      if (symbol) corporateActionIsins.add(symbol);
      continue;
    }
    if (category === "DELIVERY") {
      deliveryRows++;
      if (symbol) deliveryIsins.add(symbol);
      continue;
    }

    // Skip: CUSTOMER_INBOUND, CUSTOMER_OUTBOUND, TRANSFER_*
  }

  const parserMessages: TaxMessage[] = [];
  if (skippedNoAmount > 0) {
    parserMessages.push({
      id: "trade_republic.trade_skipped_no_amount",
      severity: "warning",
      message: `Se ha(n) omitido ${skippedNoAmount} operación(es) de compraventa de Trade Republic sin importe utilizable.`,
      hint: "Suele deberse a filas incompletas en la exportación (columna \"amount\" vacía o no numérica). Si faltan operaciones, vuelve a descargar el CSV de transacciones completo desde Trade Republic.",
      context: { count: String(skippedNoAmount) },
    });
  }
  if (corporateActionRows > 0) {
    const isins = [...corporateActionIsins].join(", ");
    parserMessages.push({
      id: "trade_republic.corporate_action_not_applied",
      severity: "warning",
      message: `Trade Republic: no se han aplicado ${corporateActionRows} movimiento(s) de acción corporativa (fusión, canje, split) de ${isins}.`,
      hint: "El coste de los títulos antiguos no pasa a los nuevos, así que una venta posterior del nuevo valor puede salir sin lotes y con coste 0. Si fue una fusión o un canje, añade el coste de adquisición original en «Lotes manuales para posiciones transferidas».",
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
