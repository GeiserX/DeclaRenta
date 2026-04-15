/**
 * Degiro CSV parser.
 *
 * Parses Degiro's Transactions CSV export into a normalized Statement.
 * Supports multiple languages (ES, EN, NL, DE) and both comma/semicolon delimiters.
 *
 * Degiro provides two main CSV exports:
 * - Transactions CSV: structured trade data (quantity, price, costs)
 * - Account CSV: all movements incl. dividends (description-based)
 *
 * This parser handles the Transactions CSV for trades. Account CSV
 * support for dividends is planned for a future version.
 */

import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";

// ---------------------------------------------------------------------------
// Header detection patterns (multi-language)
// ---------------------------------------------------------------------------

/** Known header keywords for the Transactions CSV quantity column */
const QUANTITY_HEADERS = ["cantidad", "número", "number", "quantity", "anzahl", "aantal"];

/** Known header keywords for price column */
const PRICE_HEADERS = ["precio", "price", "kurs", "koers"];

/** Known header keywords for the Account CSV description column */
const DESCRIPTION_HEADERS = ["descripción", "description", "omschrijving", "beschreibung"];

/** Known header keywords for the Account CSV value-date column */
const VALUE_DATE_HEADERS = ["fecha valor", "value date", "valutadatum", "wertdatum"];

/** Dividend description patterns (Account CSV) */
const DIVIDEND_PATTERNS = [/dividendo/i, /dividend/i];

/** Withholding tax description patterns (Account CSV) */
const WITHHOLDING_PATTERNS = [
  /retención del dividendo/i,
  /impuesto sobre dividendo/i,
  /withholding tax/i,
  /dividend.?tax/i,
  /dividendbelasting/i,
  /quellensteuer/i,
];

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

/** Auto-detect delimiter by checking the header line */
function detectDelimiter(headerLine: string): string {
  // If header has semicolons, it's likely EU-formatted with semicolons
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

/** Parse a single CSV line, handling quoted fields */
function parseCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parse a number that may use EU format (dot thousands, comma decimal).
 * Handles: "1.234,56" → "1234.56", "-175,50" → "-175.50", "175.50" → "175.50"
 */
function parseNumber(val: string): string {
  const trimmed = val.trim();
  if (!trimmed) return "0";

  // If it has both dot and comma, the last one is the decimal separator
  const lastDot = trimmed.lastIndexOf(".");
  const lastComma = trimmed.lastIndexOf(",");

  if (lastComma > lastDot) {
    // EU format: dots are thousands, comma is decimal
    return trimmed.replace(/\./g, "").replace(",", ".");
  }
  if (lastDot > lastComma && lastComma >= 0) {
    // US/UK format: commas are thousands, dot is decimal
    return trimmed.replace(/,/g, "");
  }
  // Only one separator or none — comma might be decimal (no thousands)
  if (lastComma >= 0 && lastDot < 0) {
    return trimmed.replace(",", ".");
  }
  return trimmed;
}

/** Convert DD-MM-YYYY to YYYYMMDD */
function convertDate(date: string): string {
  const trimmed = date.trim();
  const match = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return trimmed;
  return `${match[3]}${match[2]}${match[1]}`;
}

/** Find column index by checking header against a list of known names */
function findColumn(headers: string[], names: string[]): number {
  const lowerNames = names.map((n) => n.toLowerCase());
  return headers.findIndex((h) => lowerNames.includes(h.toLowerCase().trim()));
}

// ---------------------------------------------------------------------------
// Transactions CSV parser
// ---------------------------------------------------------------------------

interface TransactionColumns {
  date: number;
  time: number;
  product: number;
  isin: number;
  execVenue: number;
  quantity: number;
  price: number;
  priceCurrency: number;
  localValue: number;
  localValueCurrency: number;
  eurValue: number;
  eurValueCurrency: number;
  fxRate: number;
  costs: number;
  costsCurrency: number;
  total: number;
  totalCurrency: number;
  orderId: number;
}

/**
 * Resolve column indices from the Transactions CSV header.
 *
 * Degiro has two known Transactions CSV layouts:
 * - 19-col (real export): Fecha,Hora,Producto,ISIN,Bolsa de,Centro de ejecución,
 *   Número,Precio,[cur],Valor local,[cur],Valor,[cur],Tipo de cambio,
 *   Costes de transacción,[cur],Total,[cur],ID Orden
 * - 16-col (older/simplified): Fecha,Hora,Producto,ISIN,Centro de referencia,
 *   Centro de ejecución,Cantidad,Precio,[cur],Valor,[cur],Costes,[cur],Total,[cur],ID Orden
 *
 * The parser handles both by searching for column names dynamically.
 */
function resolveTransactionColumns(headers: string[]): TransactionColumns {
  const date = findColumn(headers, ["Fecha", "Date", "Datum"]);
  const time = findColumn(headers, ["Hora", "Time", "Tijd", "Zeit"]);
  const product = findColumn(headers, ["Producto", "Product", "Produkt"]);
  const isin = findColumn(headers, ["ISIN"]);
  const execVenue = findColumn(headers, [
    "Centro de ejecución",
    "Execution Venue",
    "Ausführungsort",
    "Uitvoeringsplaats",
  ]);
  const quantity = findColumn(headers, QUANTITY_HEADERS);
  const price = findColumn(headers, PRICE_HEADERS);

  // Currency columns follow their value columns (empty header)
  const priceCurrency = price >= 0 ? price + 1 : -1;

  // 19-col format has "Valor local" (original currency) + "Valor" (EUR)
  // 16-col format has only "Valor"
  const localValue = findColumn(headers, ["Valor local", "Local value", "Lokaler Wert", "Lokale waarde"]);
  const localValueCurrency = localValue >= 0 ? localValue + 1 : -1;

  // "Valor" / "Value" — in 19-col format this is the EUR value; in 16-col it's the only value
  // Use findColumn but skip the "Valor local" match by searching after localValue
  let eurValue: number;
  if (localValue >= 0) {
    // 19-col: find "Valor"/"Value" that comes AFTER "Valor local"
    eurValue = headers.findIndex(
      (h, idx) =>
        idx > localValue &&
        ["valor", "value", "wert", "waarde"].includes(h.toLowerCase().trim()),
    );
  } else {
    eurValue = findColumn(headers, ["Valor", "Value", "Wert", "Waarde"]);
  }
  const eurValueCurrency = eurValue >= 0 ? eurValue + 1 : -1;

  // FX rate column (only in 19-col format)
  const fxRate = findColumn(headers, [
    "Tipo de cambio",
    "Exchange rate",
    "Wechselkurs",
    "Wisselkoers",
  ]);

  const costs = findColumn(headers, [
    "Costes de transacción y/o terceros",
    "Costes de transacción",
    "Transaction and/or third",
    "Transaktionskosten",
    "Transactiekosten en/of",
  ]);
  const costsCurrency = costs >= 0 ? costs + 1 : -1;

  const total = findColumn(headers, ["Total"]);
  const totalCurrency = total >= 0 ? total + 1 : -1;

  const orderId = findColumn(headers, ["ID Orden", "Order ID", "Auftrags-ID"]);

  return {
    date,
    time,
    product,
    isin,
    execVenue,
    quantity,
    price,
    priceCurrency,
    localValue,
    localValueCurrency,
    eurValue,
    eurValueCurrency,
    fxRate,
    costs,
    costsCurrency,
    total,
    totalCurrency,
    orderId,
  };
}

function parseTransactionsCsv(lines: string[], delimiter: string): Statement {
  const headers = parseCsvLine(lines[0]!, delimiter);
  const cols = resolveTransactionColumns(headers);

  if (cols.date < 0 || cols.quantity < 0 || cols.price < 0) {
    throw new Error("Degiro Transactions CSV: faltan columnas obligatorias (Fecha, Cantidad/Número, Precio)");
  }

  const trades: Trade[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, delimiter);

    const dateStr = fields[cols.date] ?? "";
    const tradeDate = convertDate(dateStr);
    const quantity = parseNumber(fields[cols.quantity] ?? "0");
    const price = parseNumber(fields[cols.price] ?? "0");
    const currency = cols.priceCurrency >= 0 ? (fields[cols.priceCurrency] ?? "").trim() : "";
    const isin = (fields[cols.isin] ?? "").trim();
    const product = (fields[cols.product] ?? "").trim();
    const exchange = cols.execVenue >= 0 ? (fields[cols.execVenue] ?? "").trim() : "";
    const orderId = cols.orderId >= 0 ? (fields[cols.orderId] ?? "").trim() : "";
    const commission = parseNumber(fields[cols.costs] ?? "0");
    const commCurrency = cols.costsCurrency >= 0 ? (fields[cols.costsCurrency] ?? "").trim() : currency;

    // Use local value (original currency) if available, otherwise EUR value
    const localValue = cols.localValue >= 0 ? parseNumber(fields[cols.localValue] ?? "0") : "";
    const eurValue = cols.eurValue >= 0 ? parseNumber(fields[cols.eurValue] ?? "0") : "";
    const value = localValue || eurValue || "0";

    // FX rate from the CSV (19-col format), defaults to "1" for same-currency trades
    const rawFx = cols.fxRate >= 0 ? (fields[cols.fxRate] ?? "").trim() : "";
    const fxRate = rawFx ? parseNumber(rawFx) : "1";

    if (!isin || quantity === "0") continue;

    // Skip zero-price rows (rights assignments, non-tradeable conversions)
    if (price === "0" || price === "0.0000") continue;

    // Determine buy/sell: negative local value = you paid = buy; or negative quantity = sell
    const valueNum = parseFloat(value);
    const qtyNum = parseFloat(quantity);
    const isSell = valueNum > 0 || qtyNum < 0;

    trades.push({
      tradeID: orderId,
      accountId: "",
      symbol: product,
      description: product,
      isin,
      assetCategory: "STK",
      currency: currency || "EUR",
      tradeDate,
      settlementDate: tradeDate, // T+2 estimated, but we use tradeDate for FIFO
      quantity: isSell ? `-${Math.abs(qtyNum)}` : `${Math.abs(qtyNum)}`,
      tradePrice: price,
      tradeMoney: value,
      proceeds: isSell ? value : "0",
      cost: isSell ? "0" : value,
      fifoPnlRealized: "0",
      fxRateToBase: fxRate === "0" ? "1" : fxRate || "1",
      buySell: isSell ? "SELL" : "BUY",
      openCloseIndicator: isSell ? "C" : "O",
      exchange,
      commissionCurrency: commCurrency || currency || "EUR",
      commission,
      taxes: "0",
      multiplier: "1",
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
// Account CSV parser (dividends + withholdings)
// ---------------------------------------------------------------------------

interface AccountColumns {
  date: number;
  product: number;
  isin: number;
  description: number;
  fx: number;
  currency: number;
  amount: number;
  orderId: number;
}

function resolveAccountColumns(headers: string[]): AccountColumns {
  const date = findColumn(headers, ["Fecha", "Date", "Datum"]);
  const product = findColumn(headers, ["Producto", "Product", "Produkt"]);
  const isin = findColumn(headers, ["ISIN"]);
  const description = findColumn(headers, DESCRIPTION_HEADERS);
  const fx = findColumn(headers, ["Tipo de cambio", "Tipo", "FX", "Wisselkoers", "Wechselkurs"]);

  // Degiro Account CSV has two known layouts:
  // Old: ..., Tipo de cambio, [empty], Importe, [empty], Saldo, ...
  //   → "Importe" = amount col, currency at fx+1
  // New (real export): ..., Tipo, Variación, [empty], Saldo, ...
  //   → "Variación" col holds CURRENCY in data, amount is at Variación+1

  let currency: number;
  let amount = findColumn(headers, ["Importe", "Amount", "Change", "Mutatie", "Änderung"]);

  if (amount >= 0) {
    // Old format: amount found directly, currency is before it
    currency = findColumn(headers, ["Divisa tipo de cambio", "Currency", "Währung", "Valuta"]);
    if (currency < 0 && fx >= 0) currency = fx + 1;
  } else {
    // New format: "Variación" header = currency position, amount = next column
    const varCol = findColumn(headers, ["Variación", "Variation"]);
    if (varCol >= 0) {
      currency = varCol;
      amount = varCol + 1;
    } else {
      currency = fx >= 0 ? fx + 1 : -1;
    }
  }

  const orderId = findColumn(headers, ["ID Orden", "Order ID", "Auftrags-ID"]);

  return { date, product, isin, description, fx, currency, amount, orderId };
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function parseAccountCsv(lines: string[], delimiter: string): Statement {
  const headers = parseCsvLine(lines[0]!, delimiter);
  const cols = resolveAccountColumns(headers);

  if (cols.date < 0 || cols.description < 0 || cols.amount < 0) {
    throw new Error("Degiro Account CSV: faltan columnas obligatorias (Fecha, Descripción, Importe)");
  }

  const cashTransactions: CashTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, delimiter);

    const dateStr = fields[cols.date] ?? "";
    const tradeDate = convertDate(dateStr);
    const description = (fields[cols.description] ?? "").trim();
    const isin = (fields[cols.isin] ?? "").trim();
    const product = (fields[cols.product] ?? "").trim();
    const amount = parseNumber(fields[cols.amount] ?? "0");
    const currency = cols.currency >= 0 ? (fields[cols.currency] ?? "EUR").trim() : "EUR";
    const fx = cols.fx >= 0 ? parseNumber(fields[cols.fx] ?? "1") : "1";

    if (!description) continue;

    // Determine transaction type from description
    let type: CashTransaction["type"] | null = null;

    if (matchesAny(description, WITHHOLDING_PATTERNS)) {
      type = "Withholding Tax";
    } else if (matchesAny(description, DIVIDEND_PATTERNS)) {
      type = "Dividends";
    }

    if (!type) continue; // Skip non-dividend/withholding rows

    cashTransactions.push({
      transactionID: `degiro-${tradeDate}-${isin}-${i}`,
      accountId: "",
      symbol: product,
      description,
      isin,
      currency: currency || "EUR",
      dateTime: tradeDate,
      settleDate: tradeDate,
      amount,
      fxRateToBase: fx,
      type,
    });
  }

  return {
    accountId: "",
    fromDate: "",
    toDate: "",
    period: "",
    trades: [],
    cashTransactions,
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
  };
}

// ---------------------------------------------------------------------------
// Public BrokerParser
// ---------------------------------------------------------------------------

function isDegiroTransactions(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return (
    lower.includes("isin") &&
    QUANTITY_HEADERS.some((h) => lower.includes(h)) &&
    PRICE_HEADERS.some((h) => lower.includes(h))
  );
}

function isDegiroAccount(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return (
    lower.includes("isin") &&
    DESCRIPTION_HEADERS.some((h) => lower.includes(h)) &&
    VALUE_DATE_HEADERS.some((h) => lower.includes(h))
  );
}

/** Degiro CSV parser implementing BrokerParser interface */
export const degiroParser: BrokerParser = {
  name: "Degiro",
  formats: ["Transactions CSV", "Account CSV"],

  detect(input: string): boolean {
    const firstLine = input.split(/\r?\n/)[0] ?? "";
    return isDegiroTransactions(firstLine) || isDegiroAccount(firstLine);
  },

  parse(input: string): Statement {
    const lines = input.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error("Degiro CSV: fichero vacío o sin datos");
    }

    const headerLine = lines[0]!;
    const delimiter = detectDelimiter(headerLine);

    if (isDegiroTransactions(headerLine)) {
      return parseTransactionsCsv(lines, delimiter);
    }
    if (isDegiroAccount(headerLine)) {
      return parseAccountCsv(lines, delimiter);
    }

    throw new Error("Degiro CSV: formato no reconocido. Se esperan las cabeceras del CSV de Transacciones o Cuenta.");
  },
};
