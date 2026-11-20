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
 * This parser handles the Transactions CSV for trades and the Account CSV
 * for dividends and withholding taxes.
 */

import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import type { TaxMessage } from "../types/tax.js";
import Decimal from "decimal.js";
import {
  detectDelimiter,
  parseCsvLine,
  parseNumber,
  toFiniteDecimal,
  convertDateDMY,
  findColumn,
  normalizeFractionalCurrency,
  stripBom,
  timeOfDay,
  quantityUnknownTrade,
  quantityUnreadable,
  tradeQuantityUnknownMessages,
  unreadableTrade,
  unreadableCell,
  corporateActionTrade,
  markUndatedTrades,
  dropUndatedCash,
  cashIncomeRowText,
  cashIncomeAmountUnreadableMessages,
  cashRowsUnidentifiedMessages,
  cashRowsNotBookedMessages,
} from "./csv-utils.js";
import { formatDateDmy } from "../engine/dates.js";
import { plainOrExponent } from "../engine/amount-range.js";

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

/**
 * Dividend description patterns (Account CSV). "Fondsausschüttung" is how the
 * German export names a fund (ETF) distribution: dividend income (casilla
 * 0029), dropped with no word before (#467).
 */
const DIVIDEND_PATTERNS = [/dividendo/i, /dividend/i, /fondsaussch[üu]ttung/i];

/**
 * Capital return description patterns (Account CSV), EN, FR, DE, NL and ES.
 * It lowers the cost of the shares, and any part above that cost is income
 * (art. 25.1.e LIRPF): DeclaRenta cannot book either, so the row is named,
 * never dropped with no word (#467). Anchored, so a trade leg whose product
 * name holds the words is not caught.
 */
const CAPITAL_RETURN_PATTERN = /^(?:capital return|return of capital|remboursement de capital|kapitalr[üu]ckzahlung|kapitaalsuitkering|devoluci[oó]n de capital)/i;

/** Withholding tax description patterns (Account CSV) */
const WITHHOLDING_PATTERNS = [
  /retención del dividendo/i,
  /impuesto sobre dividendo/i,
  /withholding tax/i,
  /dividend.?tax/i,
  /dividendbelasting/i,
  /dividendensteuer/i,
  /quellensteuer/i,
  /imp[oô]ts? sur (les )?dividendes?/i,
  /ritenuta sul dividendo/i,
  /imposto sobre dividendo/i,
];

/**
 * Interest description patterns (Account CSV): flatex pays interest on the
 * cash balance ("flatex Interest", "Interés", "Zinsen", "Rente"). A positive
 * row is interest received (casilla 0027); a negative one (interest charged on
 * a negative balance) is left out, which can only raise the tax.
 */
const INTEREST_PATTERNS = [/interest/i, /inter[eé]s/i, /zinsen/i, /\brente\b/i, /int[eé]r[eê]ts?/i];

/**
 * Financial-transaction-tax description patterns (Account CSV): Spanish ITF,
 * French TTF, Italian FTT. Degiro lists them only in the Account CSV, never in
 * the Transactions CSV, so they cannot reach the buy's acquisition cost.
 */
const TRANSACTION_TAX_PATTERNS = [
  /transaction tax/i,
  /impuesto sobre (las )?transacciones financieras/i,
  /taxe sur les transactions financi[eè]res/i,
];

/**
 * Relative gap allowed between the two legs of a corporate-action pair. Degiro
 * books both legs at the same value; the margin only absorbs price rounding.
 */
const PAIR_VALUE_TOLERANCE = new Decimal("0.01");

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
  autoFxCosts: number;
  total: number;
  totalCurrency: number;
  orderId: number;
}

/**
 * The asset category of a DEGIRO product name with the shape of an option
 * ("AAPL C200.00 20DEC24", "ASML P600 17JAN25") or a future ("FDAX MAR25",
 * "FESX DEC24"), or undefined. Used only for a row with no ISIN.
 */
function derivativeCategory(product: string): "OPT" | "FUT" | undefined {
  const month = "(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)";
  if (new RegExp(`\\s[CP]\\d+(?:[.,]\\d+)?\\s+\\d{1,2}${month}\\d{2,4}$`, "i").test(product.trim())) return "OPT";
  if (new RegExp(`^[A-Z0-9]{2,6}\\s+${month}\\d{2}$`).test(product.trim())) return "FUT";
  return undefined;
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

  // "Valor" / "Value" / "Valor EUR" — in 19-col format this is the EUR value; in 16-col it's the only value
  // Use findColumn but skip the "Valor local" match by searching after localValue
  let eurValue: number;
  if (localValue >= 0) {
    // 19-col: find "Valor"/"Value"/"Valor EUR" that comes AFTER "Valor local"
    eurValue = headers.findIndex(
      (h, idx) =>
        idx > localValue &&
        ["valor", "valor eur", "value", "value eur", "wert", "waarde"].some((v) => h.toLowerCase().trim().startsWith(v)),
    );
  } else {
    eurValue = findColumn(headers, ["Valor", "Valor EUR", "Value", "Value EUR", "Wert", "Waarde"]);
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
    "Costes de transacción y/o externos EUR",
    "Costes de transacción y/o externos",
    "Costes de transacción",
    "Transaction and/or third",
    "Transaction costs",
    "Transaktionskosten",
    "Transactiekosten en/of",
  ]);
  // If the header already contains "EUR", there's no separate currency column after it
  const costsHeader = costs >= 0 ? (headers[costs] ?? "").trim() : "";
  const costsCurrency = costs >= 0 && !costsHeader.toUpperCase().includes("EUR") ? costs + 1 : -1;

  // AutoFX commission (newer Degiro format has this as a separate column)
  const autoFxCosts = findColumn(headers, ["Comisión AutoFX", "AutoFX Commission", "AutoFX Kosten"]);

  const total = findColumn(headers, ["Total", "Total EUR"]);
  const totalHeader = total >= 0 ? (headers[total] ?? "").trim() : "";
  const totalCurrency = total >= 0 && !totalHeader.toUpperCase().includes("EUR") ? total + 1 : -1;

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
    autoFxCosts,
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
  // Count NON-EMPTY rows that look like real trades (carry a quantity or price)
  // but get dropped because they have no ISIN or no usable amount. A column-
  // mapping drift would silently discard many such rows; we surface ONE info
  // message so the user notices instead of getting a too-low report. Genuine
  // non-trade lines (deposits, cash sweeps: no qty, no price) are NOT counted,
  // nor are documented zero-price rights assignments.
  let tradeLikeRowsSkipped = 0;
  // Rows with no order ID and no costs. Degiro books an ISIN change, a split
  // or a share exchange as such a same-day sale of the old ISIN plus a buy of
  // the new one at the same value. They stay trades (a canje can be taxable
  // under art. 37.1.e LIRPF) but the user is warned, since a neutral one keeps
  // the old cost and acquisition date instead.
  const orderlessRows: { trade: Trade; value: Decimal }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, delimiter);

    const dateStr = fields[cols.date] ?? "";
    const tradeDate = convertDateDMY(dateStr);
    const tradeTime = cols.time >= 0 ? timeOfDay(fields[cols.time] ?? "") : undefined;
    const quantity = parseNumber(fields[cols.quantity] ?? "0");
    const price = parseNumber(fields[cols.price] ?? "0");
    const currency = cols.priceCurrency >= 0 ? (fields[cols.priceCurrency] ?? "").trim() : "";
    const isin = (fields[cols.isin] ?? "").trim();
    const product = (fields[cols.product] ?? "").trim();
    const exchange = cols.execVenue >= 0 ? (fields[cols.execVenue] ?? "").trim() : "";
    // Degiro inconsistently adds an extra empty column before orderId in some rows
    let orderId = cols.orderId >= 0 ? (fields[cols.orderId] ?? "").trim() : "";
    if (!orderId && cols.orderId >= 0) {
      const next = (fields[cols.orderId + 1] ?? "").trim();
      if (next && /^[0-9a-f]{8}-/.test(next)) orderId = next;
    }
    // Commission via decimal.js (no float round-trip). toFiniteDecimal guards
    // against a garbled cell emitting the literal "NaN"/"Infinity" into the
    // commission field, which would poison every downstream cost-basis total.
    const txCosts = toFiniteDecimal(fields[cols.costs] ?? "0");
    const autoFx = cols.autoFxCosts >= 0 ? toFiniteDecimal(fields[cols.autoFxCosts] ?? "0") : toFiniteDecimal("0");
    const commDec = txCosts.plus(autoFx);
    const commission = commDec.isZero() ? "0" : plainOrExponent(commDec, 2);
    // When header already embeds "EUR" (costsCurrency = -1), default to EUR.
    // DEGIRO charges its costs in EUR, so an empty costs-currency cell is EUR
    // too, never the price currency: 2 EUR booked as 2 GBP lowered the gain (#467).
    const commCurrency = cols.costsCurrency >= 0 ? (fields[cols.costsCurrency] ?? "").trim() || "EUR" : "EUR";

    // Use local value (original currency) if available, otherwise EUR value
    const localValue = cols.localValue >= 0 ? parseNumber(fields[cols.localValue] ?? "0") : "";
    const eurValue = cols.eurValue >= 0 ? parseNumber(fields[cols.eurValue] ?? "0") : "";
    const value = localValue || eurValue || "0";

    // FX rate from the CSV (19-col format), defaults to "1" for same-currency trades
    const rawFx = cols.fxRate >= 0 ? (fields[cols.fxRate] ?? "").trim() : "";
    const fxRate = rawFx ? parseNumber(rawFx) : "1";

    // A trade-like row with no ISIN is still a purchase or a sale: kept as a
    // trade that books nothing and named, never dropped (#467). Trade-like is
    // a readable quantity or price, or an order id (a cash line, such as a
    // deposit, has a value but none of them). Its side comes from the value or
    // the quantity sign.
    const noIsinTradeLike = !toFiniteDecimal(quantity, "0", false).isZero() ||
      !toFiniteDecimal(price, "0", false).isZero() || orderId !== "";
    if (!isin && noIsinTradeLike) {
      const sell = toFiniteDecimal(value, "0", false).greaterThan(0) || toFiniteDecimal(quantity, "0", false).lessThan(0);
      // An option or a future ("AAPL C200.00 20DEC24", "FDAX MAR25") is no
      // share: kept as a derivative, so it does not stand for every share in
      // the one-purchase evidence (#453), which derivatives never enter.
      trades.push(unreadableTrade({
        tradeID: orderId, symbol: product, description: product, isin: "", assetCategory: derivativeCategory(product) ?? "STK",
        currency: normalizeFractionalCurrency(currency || "EUR").currency, tradeDate, tradeTime,
        buySell: sell ? "SELL" : "BUY", exchange,
      }, unreadableCell(headers[cols.isin] ?? "ISIN", isin)));
      continue;
    }

    // An empty or unreadable quantity is no "0": a buy or sale row of an ISIN
    // is kept as a trade of unknown quantity (below, #453).
    const quantityUnknown = isin !== "" && quantityUnreadable(fields[cols.quantity]);
    // Numeric: "0.0" or "0,00" with a readable price is a 0-share row too (#469).
    if (!isin || (toFiniteDecimal(quantity).isZero() && !quantityUnknown)) {
      // Trade-like row (carries a real quantity or price) dropped for lack of
      // ISIN / amount → suspicious (likely column drift). Plain non-trade lines
      // (deposits/sweeps with no qty and no price) are expected → not counted.
      const hasQty = quantity !== "0";
      const hasPrice = price !== "0" && price !== "0.0000";
      if (hasQty || hasPrice) tradeLikeRowsSkipped++;
      continue;
    }

    // A row whose price is empty or unreadable is still a buy or sale when it
    // has a readable quantity, an order id or a value (#453, #467). A written
    // zero quantity with no readable price is skipped ("0,00" reads "0.00",
    // past the check above), and so is a row with neither a readable quantity
    // nor a readable price, unless it has an order id or a value.
    const tradeEvidence = orderId !== "" || !toFiniteDecimal(value).isZero();
    const priceUnreadable = quantityUnreadable(fields[cols.price]);
    if (!quantityUnknown && toFiniteDecimal(quantity).isZero() && priceUnreadable) continue;
    const priceUnknown = priceUnreadable && (tradeEvidence || !quantityUnknown);
    // A zero-price row (a rights assignment, a non-tradeable conversion, a
    // transfer), whatever the spelling of the zero ("0", "0.00", "0,0000"),
    // has no price to book but moves shares of its ISIN: kept as a row that
    // books nothing and named, never skipped with no word (#467). Dropped, it
    // would hide a holding at the anti-churning window start (#453). A row
    // with neither a readable quantity nor a readable price, and no order id
    // or value, is no trade.
    if (toFiniteDecimal(price, "0", false).isZero() && !priceUnknown) {
      if (!priceUnreadable && (quantityUnknown || !toFiniteDecimal(quantity, "0", false).isZero())) {
        trades.push(corporateActionTrade({
          tradeID: orderId, symbol: product, description: product, isin, assetCategory: "STK",
          currency: normalizeFractionalCurrency(currency || "EUR").currency, tradeDate, tradeTime, exchange,
        }, `${headers[cols.price] ?? "Price"} ${(fields[cols.price] ?? "").trim() || "—"}`, fields[cols.quantity] ?? ""));
      }
      continue;
    }

    // Determine buy/sell: negative local value = you paid = buy; or negative
    // quantity = sell. toFiniteDecimal keeps the comparison finite-safe so a
    // garbled value/quantity cell can't misclassify the leg via NaN.
    const valueDec = toFiniteDecimal(value);
    const qtyDec = toFiniteDecimal(quantity);
    const isSell = valueDec.greaterThan(0) || qtyDec.lessThan(0);
    const absQtyStr = qtyDec.abs().toString();

    // Degiro quotes LSE instruments in GBX (pence). ECB only publishes GBP,
    // so normalize the code and divide the per-share price, the local value
    // and the FX rate by 100 (issue #282). The "Valor local" column is by
    // definition in the instrument's quote currency, so it divides with it;
    // a 16-col fallback value (already the EUR column) is left untouched.
    let tradeCurrency = currency;
    let tradePrice = price;
    let tradeValue = value;
    let tradeFxRate = fxRate;
    const fractional = normalizeFractionalCurrency(currency || "EUR");
    if (quantityUnknown || priceUnknown) {
      // With no quantity or no price FIFO cannot book its shares: it moves no
      // share or money. Its direction comes from the value or the quantity sign.
      trades.push(quantityUnknownTrade({
        tradeID: orderId,
        symbol: product, description: product, isin, assetCategory: "STK", currency: fractional.currency,
        tradeDate, tradeTime, buySell: isSell ? "SELL" : "BUY", exchange,
      }));
      continue;
    }
    // A trade with no price currency is not in euros: a yen buy booked as
    // euros made a loss of thousands with no word. It is kept as a row that
    // books nothing and named by that cell (#467).
    if (!currency) {
      trades.push(unreadableTrade({
        tradeID: orderId, symbol: product, description: product, isin, assetCategory: "STK", currency: "EUR",
        tradeDate, tradeTime, buySell: isSell ? "SELL" : "BUY", exchange,
      }, unreadableCell((headers[cols.priceCurrency] ?? "").trim() || `${(headers[cols.price] ?? "Precio").trim()}, divisa`, fields[cols.priceCurrency])));
      continue;
    }
    // A negative price ("-120.00", "(120,00)") is no price: booked, a sale
    // had negative proceeds (a loss of 2,028 € on a gain of 180 €) and a buy a
    // negative cost, with no word. Kept as a row that books nothing and named
    // by that cell, as in Flatex (#467).
    if (toFiniteDecimal(price, "0", false).isNegative()) {
      trades.push(unreadableTrade({
        tradeID: orderId, symbol: product, description: product, isin, assetCategory: "STK", currency: fractional.currency,
        tradeDate, tradeTime, buySell: isSell ? "SELL" : "BUY", exchange,
      }, unreadableCell((headers[cols.price] ?? "").trim() || "Precio", fields[cols.price])));
      continue;
    }
    if (!fractional.divisor.equals(1)) {
      // A Valor local or a Tipo de cambio that cannot be read is no number to
      // divide: it reads "0" (FIFO values the trade at price × quantity), so
      // the file is never refused with a raw DecimalError (#467).
      tradeCurrency = fractional.currency;
      tradePrice = toFiniteDecimal(price, "0", false).div(fractional.divisor).toString();
      if (localValue) tradeValue = toFiniteDecimal(localValue, "0", false).div(fractional.divisor).toString();
      if (tradeFxRate !== "0" && tradeFxRate !== "1") {
        tradeFxRate = toFiniteDecimal(tradeFxRate, "0", false).div(fractional.divisor).toString();
      }
    }

    // Commission currency may itself be a minor unit in older layouts with a
    // per-costs currency column — normalize it the same way.
    let commissionValue = commission;
    let commissionCcy = commCurrency;
    const commFractional = normalizeFractionalCurrency(commissionCcy);
    if (!commFractional.divisor.equals(1)) {
      commissionCcy = commFractional.currency;
      if (commissionValue !== "0") {
        commissionValue = new Decimal(commissionValue).div(commFractional.divisor).toString();
      }
    }

    const trade: Trade = {
      tradeID: orderId,
      accountId: "",
      symbol: product,
      description: product,
      isin,
      assetCategory: "STK",
      currency: tradeCurrency,
      tradeDate,
      tradeTime,
      settlementDate: tradeDate, // T+2 estimated, but we use tradeDate for FIFO
      quantity: isSell ? `-${absQtyStr}` : absQtyStr,
      tradePrice,
      tradeMoney: tradeValue,
      proceeds: isSell ? tradeValue : "0",
      cost: isSell ? "0" : tradeValue,
      fifoPnlRealized: "0",
      fxRateToBase: tradeFxRate === "0" ? "1" : tradeFxRate || "1",
      buySell: isSell ? "SELL" : "BUY",
      openCloseIndicator: isSell ? "C" : "O",
      exchange,
      commissionCurrency: commissionCcy,
      commission: commissionValue,
      taxes: "0",
      multiplier: "1",
    };
    trades.push(trade);

    if (!orderId && commDec.isZero()) {
      // Compare legs by EUR value (the two ISINs may quote in different units);
      // fall back to the local value when the EUR column is missing or empty.
      const eurDec = toFiniteDecimal(eurValue || "0").abs();
      const pairValue = eurDec.isZero() ? valueDec.abs() : eurDec;
      if (!pairValue.isZero()) orderlessRows.push({ trade, value: pairValue });
    }
  }

  const parserMessages: TaxMessage[] = [];
  if (tradeLikeRowsSkipped > 0) {
    parserMessages.push({
      id: "degiro.rows_skipped",
      severity: "warning",
      message: `Se omitieron ${tradeLikeRowsSkipped} filas sin ISIN/sin importe.`,
      hint: "Estas filas tenían cantidad o precio pero les faltaba el ISIN o el importe, por lo que no se pudieron incluir como operaciones. Suele indicar que las columnas del CSV no se han reconocido bien: vuelve a exportar el CSV de Transacciones de Degiro sin modificar las cabeceras.",
      context: { count: String(tradeLikeRowsSkipped) },
    });
  }

  const pairedBuys = new Set<Trade>();
  for (const out of orderlessRows) {
    if (out.trade.buySell !== "SELL") continue;
    const inc = orderlessRows.find(
      (c) =>
        c.trade.buySell === "BUY" &&
        !pairedBuys.has(c.trade) &&
        c.trade.tradeDate === out.trade.tradeDate &&
        c.trade.isin !== out.trade.isin &&
        c.value.minus(out.value).abs().lessThanOrEqualTo(out.value.times(PAIR_VALUE_TOLERANCE)),
    );
    if (!inc) continue;
    pairedBuys.add(inc.trade);
    const date = formatDateDmy(out.trade.tradeDate);
    const oldProduct = out.trade.description;
    const oldIsin = out.trade.isin;
    const newProduct = inc.trade.description;
    const newIsin = inc.trade.isin;
    parserMessages.push({
      id: "degiro.corporate_action_pair",
      severity: "warning",
      message: `Posible operación societaria el ${date}: ${oldProduct} (${oldIsin}) → ${newProduct} (${newIsin}). Degiro la anota como una venta y una compra.`,
      hint: "Degiro anota los cambios de ISIN, los splits y los canjes de acciones como una venta del valor antiguo y una compra del nuevo, sin número de orden ni costes. DeclaRenta los calcula así: declara una ganancia o pérdida ese día, y las acciones nuevas toman ese precio y esa fecha como coste. Revisa la comunicación de Degiro o del emisor. Si fue un simple cambio de ISIN, un split o un canje fiscalmente neutro (régimen especial de la Ley del Impuesto sobre Sociedades), no hubo venta: las acciones nuevas conservan el coste y la fecha de compra de las antiguas, así que corrige esa operación en tu declaración. Si fue un canje que tributa (art. 37.1.e LIRPF), el cálculo es correcto.",
      context: { date, oldProduct, oldIsin, newProduct, newIsin },
    });
  }
  markUndatedTrades(trades, headers[cols.date] ?? "Date");
  parserMessages.push(...tradeQuantityUnknownMessages("DEGIRO", trades));

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
    parserMessages: parserMessages.length > 0 ? parserMessages : undefined,
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
  // Real export, every language: ..., Tipo/FX, Variación/Change/Mutatie/Änderung, [empty], Saldo, ...
  //   → the labelled col holds the CURRENCY in data, the amount is in the unnamed col after it

  let currency: number;
  let amount = findColumn(headers, [
    "Importe",
    "Amount",
    "Variación",
    "Variation",
    "Change",
    "Mutatie",
    "Änderung",
  ]);
  const isUnnamed = (idx: number): boolean => (headers[idx] ?? "").trim() === "";

  if (amount >= 0 && !isUnnamed(amount - 1) && amount + 1 < headers.length && isUnnamed(amount + 1)) {
    // Real layout: labelled col = currency position, amount = next (unnamed) column
    currency = amount;
    amount = amount + 1;
  } else if (amount >= 0) {
    // Old format: amount found directly, currency is before it
    currency = findColumn(headers, ["Divisa tipo de cambio", "Currency", "Währung", "Valuta"]);
    if (currency < 0 && fx >= 0) currency = fx + 1;
  } else {
    currency = fx >= 0 ? fx + 1 : -1;
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
  // Financial transaction tax paid, summed per ISIN + currency (Art. 35.1.b LIRPF:
  // a tax inherent to the purchase, part of its acquisition cost).
  const transactionTax = new Map<string, { product: string; isin: string; currency: string; total: Decimal }>();
  // Dividend, withholding and interest rows whose amount or currency cannot
  // be read (#467). `key` pairs a dividend with its withholdings.
  const unreadableIncome: { key: string; dividend: boolean; type: string; security: string; currency: string; date: string; cells: string[] }[] = [];
  // In the real layout the amount column has no header: it sits under the
  // labelled currency column ("Variación", "Change").
  const amountName = (headers[cols.amount] ?? "").trim() || (headers[cols.currency] ?? "").trim() || "Importe";
  const currencyName = `${amountName}, divisa`;
  const incomeKey = (isin: string, product: string, date: string): string => `${isin}|${product}|${date}`;
  // Dividend and withholding rows with no ISIN (#467): `key` pairs a
  // withholding with its dividend by product and date.
  const unidentified: { key: string; dividend: boolean; type: string; product: string; amount: string; date: string; withheld: string[] }[] = [];
  // Rows with no Descripción that name a security and move money (#467).
  const undescribed: string[] = [];
  // Capital returns that name a security and move money (#467).
  const notBooked: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, delimiter);

    const dateStr = fields[cols.date] ?? "";
    const tradeDate = convertDateDMY(dateStr);
    const description = (fields[cols.description] ?? "").trim();
    const isin = (fields[cols.isin] ?? "").trim();
    const product = (fields[cols.product] ?? "").trim();
    let amount = parseNumber(fields[cols.amount] ?? "0");
    const currencyCell = cols.currency >= 0 ? (fields[cols.currency] ?? "").trim() : "EUR";
    let currency = currencyCell;
    const fx = cols.fx >= 0 ? parseNumber(fields[cols.fx] ?? "1") : "1";

    // Minor-unit amounts (GBX pence, etc.) → ECB major unit, same as trades.
    // An amount that cannot be read stays as it is: it is named below, never
    // divided (a raw DecimalError refused the whole file, #467).
    const fractional = normalizeFractionalCurrency(currency || "EUR");
    if (!fractional.divisor.equals(1)) {
      currency = fractional.currency;
      if (amount !== "0" && !quantityUnreadable(fields[cols.amount])) {
        amount = toFiniteDecimal(amount, "0", false).div(fractional.divisor).toString();
      }
    }

    // A row with no Descripción cannot be typed. One that names a security
    // and moves money may be a dividend: it is named, never dropped with no
    // word (#467). A written zero, an empty amount or no security stays skipped.
    if (!description) {
      const security = isin ? (product ? `${product} (${isin})` : isin) : product;
      const amountCell = (fields[cols.amount] ?? "").trim();
      const amountUnreadable = quantityUnreadable(amountCell);
      if (security && amountCell && (amountUnreadable || !toFiniteDecimal(amount, "0", false).isZero())) {
        const cells = [
          unreadableCell((headers[cols.description] ?? "").trim() || "Descripción", fields[cols.description]),
          ...(amountUnreadable ? [unreadableCell(amountName, fields[cols.amount])] : []),
        ];
        const head = [security, amountUnreadable ? "" : amount, currency, tradeDate || "—"].filter((part) => part !== "").join(" ");
        undescribed.push(`${head} [${cells.join(", ")}]`);
      }
      continue;
    }

    // Determine transaction type from description
    let type: CashTransaction["type"] | null = null;

    if (matchesAny(description, WITHHOLDING_PATTERNS)) {
      type = "Withholding Tax";
    } else if (matchesAny(description, DIVIDEND_PATTERNS)) {
      type = "Dividends";
    } else if (matchesAny(description, TRANSACTION_TAX_PATTERNS)) {
      const ccy = currency || "EUR";
      const key = `${isin || product}|${ccy}`;
      const entry = transactionTax.get(key) ?? { product, isin, currency: ccy, total: new Decimal(0) };
      entry.total = entry.total.plus(toFiniteDecimal(amount));
      transactionTax.set(key, entry);
      continue;
    } else if (matchesAny(description, INTEREST_PATTERNS)) {
      // Interest received is booked; interest charged is left out (#467).
      if (quantityUnreadable(fields[cols.amount]) || toFiniteDecimal(amount, "0", false).isPositive()) {
        type = "Broker Interest Received";
      }
    }

    if (!type) {
      // A capital return is named, not booked: DeclaRenta does not lower the
      // cost of the shares, and the part above the cost is income (#467). A
      // written zero or no security stays skipped.
      const security = isin ? (product ? `${product} (${isin})` : isin) : product;
      const amountCell = (fields[cols.amount] ?? "").trim();
      if (CAPITAL_RETURN_PATTERN.test(description) && security
        && (quantityUnreadable(amountCell) || !toFiniteDecimal(amount, "0", false).isZero())) {
        notBooked.push(cashIncomeRowText(description, security, currencyCell, tradeDate, [unreadableCell(amountName, fields[cols.amount])]));
      }
      continue; // Skip deposits, cash sweeps, fees and other rows
    }

    // An amount that cannot be read ("", "€", "abc") is no zero, and a row
    // with no currency is not in euros: the row and the withholdings of its
    // dividend are not booked, and the row is named (#467). A written 0 stays
    // an explicit zero.
    const amountUnreadable = quantityUnreadable(fields[cols.amount]);
    if (amountUnreadable || !currencyCell) {
      const security = isin ? (product ? `${product} (${isin})` : isin) : product;
      unreadableIncome.push({
        key: incomeKey(isin, product, tradeDate),
        dividend: type === "Dividends",
        type: description,
        security: security || (type === "Broker Interest Received" ? "" : "—"),
        currency: currencyCell,
        date: tradeDate,
        cells: [
          ...(amountUnreadable ? [unreadableCell(amountName, fields[cols.amount])] : []),
          ...(currencyCell ? [] : [unreadableCell(currencyName, fields[cols.currency])]),
        ],
      });
      continue;
    }

    // A dividend or withholding with no ISIN names no security: its country,
    // and so whether its withholding is Spanish or foreign, would be a guess
    // (a Spanish 19 € read as a foreign 15 € deduction). It is named, not
    // booked, as in Scalable (#467). A written zero stays an explicit zero.
    if (!isin && type !== "Broker Interest Received" && !toFiniteDecimal(amount, "0", false).isZero()) {
      unidentified.push({
        key: incomeKey("", product, tradeDate),
        dividend: type === "Dividends",
        type: description, product, amount: `${amount} ${currency}`, date: tradeDate,
        withheld: [],
      });
      continue;
    }

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

  // The withholdings of a dividend that is not booked are not booked either:
  // a deduction for income the report does not count. They are named with it.
  const unreadableRows = unreadableIncome.map((row) => {
    if (!row.dividend) return cashIncomeRowText(row.type, row.security, row.currency, row.date, row.cells);
    const withheld = cashTransactions.filter((c) => c.type === "Withholding Tax" && incomeKey(c.isin, c.symbol, c.dateTime) === row.key);
    for (const w of withheld) cashTransactions.splice(cashTransactions.indexOf(w), 1);
    const tax = withheld.map((w) => `${w.description} ${w.amount} ${w.currency}`).join(", ");
    return cashIncomeRowText(row.type, row.security, row.currency, row.date, row.cells, tax);
  });

  // A withholding with no ISIN is shown with the dividend of its product and
  // date, when that dividend has no ISIN either.
  const unidentifiedRows = unidentified.filter((row) => {
    if (row.dividend) return true;
    const dividend = unidentified.find((d) => d.dividend && d.key === row.key);
    dividend?.withheld.push(`${row.type} ${row.amount}`);
    return !dividend;
  }).map((row) => `${row.type} ${row.product || "—"} ${row.amount}${row.withheld.length > 0 ? ` (${row.withheld.join(", ")})` : ""} ${row.date || "—"}`);

  const parserMessages: TaxMessage[] = dropUndatedCash("DEGIRO", cashTransactions, headers[cols.date] ?? "Fecha");
  parserMessages.push(...cashIncomeAmountUnreadableMessages("DEGIRO", unreadableRows));
  parserMessages.push(...cashRowsUnidentifiedMessages("DEGIRO", unidentifiedRows));
  parserMessages.push(...cashRowsNotBookedMessages("DEGIRO", notBooked));
  if (undescribed.length > 0) {
    const count = String(undescribed.length);
    const rows = undescribed.join("; ");
    parserMessages.push({
      id: "degiro.cash_row_undescribed",
      severity: "warning",
      message: `DEGIRO: ${count} fila(s) del CSV de Cuenta no dicen qué movimiento son y no se calculan: ${rows}.`,
      hint: "Entre corchetes va la celda de la descripción, tal como está en el archivo. Sin ella, DeclaRenta no sabe si la fila es un dividendo, una retención, un interés u otro movimiento. Por eso no la suma y no se inventa el tipo. Si es un ingreso del año que declaras, tienes que declararlo igualmente. Vuelve a descargar el CSV de Cuenta original de DEGIRO y súbelo sin editarlo. Si la fila sigue sin descripción, copia el dato del extracto de DEGIRO y vuelve a subirlo. También puedes añadir el importe a mano en Renta Web.",
      context: { count, rows },
    });
  }
  for (const { product, isin, currency, total } of transactionTax.values()) {
    const paid = total.negated();
    if (!paid.greaterThan(0)) continue;
    const amount = plainOrExponent(paid, 2);
    const name = product || isin;
    parserMessages.push({
      id: "degiro.transaction_tax",
      severity: "info",
      message: `Impuesto sobre transacciones financieras pagado en ${name} (${isin}): ${amount} ${currency}.`,
      hint: "Degiro cobra este impuesto al comprar acciones españolas, francesas o italianas y solo lo muestra en el CSV de Cuenta. Forma parte del valor de adquisición (art. 35.1.b LIRPF): súmalo al coste de las compras de ese valor, porque DeclaRenta no lo añade automáticamente.",
      context: { product: name, isin, amount, currency },
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
    parserMessages: parserMessages.length > 0 ? parserMessages : undefined,
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
    const firstLine = stripBom(input).split(/\r?\n/)[0] ?? "";
    return isDegiroTransactions(firstLine) || isDegiroAccount(firstLine);
  },

  parse(input: string): Statement {
    const lines = stripBom(input).split(/\r?\n/).filter((l) => l.trim());
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
