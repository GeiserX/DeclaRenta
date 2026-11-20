/**
 * Trading 212 CSV parser.
 *
 * Parses Trading 212's "History → Transactions" CSV export into a normalized Statement.
 * Trading 212 is a Bulgarian neobroker (FSC Bulgaria license) that does NOT
 * report to AEAT — users must declare gains/dividends manually.
 *
 * CSV format (real export):
 * Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Notes,ID
 *
 * Action types:
 * - Market buy / Limit buy / Stop buy → BUY trade
 * - Market sell / Limit sell / Stop sell → SELL trade
 * - Dividend (Ordinary) / Dividend (Dividend) / Dividend (Tax exempted) → cash transaction (dividend)
 * - Dividend (Dividend tax) → cash transaction (Withholding Tax); a positive
 *   one in a file that writes withholdings negative is a refund
 * - Interest on cash / Lending interest → cash transaction (interest)
 * - Deposit / Withdrawal / Currency conversion / Card debit / Card credit /
 *   New card cost / Spending cashback → skipped
 * - Any other action that moves no shares ("Result adjustment") → not booked;
 *   a Total that is not a written zero is named in a warning
 *
 * Limitations:
 * - No open positions in CSV — Modelo 720/D-6 cannot be generated from this alone.
 * - Exchange rate column is Trading 212's own rate, not ECB — the FIFO engine fetches ECB rates independently.
 * - Trading 212 charges no dealing commission, but the optional fee columns
 *   (Currency conversion fee, Stamp duty reserve tax, French transaction tax,
 *   Finra fee) are read into the trade's taxes/commission (Art. 35.1.b / 35.2 LIRPF).
 */

import Decimal from "decimal.js";
import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import type { TaxMessage } from "../types/tax.js";
import {
  parseCsvLine,
  toFiniteDecimal,
  toFiniteDecimalString,
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
  cashRowsUnidentifiedMessages,
  cashIncomeRowText,
  cashIncomeAmountUnreadableMessages,
  cashRowsNotBookedMessages,
} from "./csv-utils.js";

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

/** Trading 212 CSV required headers */
const TRADING212_REQUIRED = ["action", "time", "isin", "ticker", "no. of shares", "price / share"];

function isTrading212Csv(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return TRADING212_REQUIRED.every((h) => lower.includes(h));
}

// ---------------------------------------------------------------------------
// Column resolution
// ---------------------------------------------------------------------------

interface Trading212Columns {
  action: number;
  time: number;
  isin: number;
  ticker: number;
  name: number;
  shares: number;
  pricePerShare: number;
  priceCurrency: number;
  exchangeRate: number;
  total: number;
  totalCurrency: number;
  id: number;
  /** Optional fee/tax columns, each with its own currency column. */
  fees: { amount: number; currency: number }[];
}

/** Trading 212 fee and transaction-tax columns (present only when the export has them). */
const FEE_COLUMNS = ["currency conversion fee", "stamp duty reserve tax", "french transaction tax", "finra fee"];

function resolveColumns(headers: string[]): Trading212Columns {
  return {
    action: findColumn(headers, ["action"]),
    time: findColumn(headers, ["time"]),
    isin: findColumn(headers, ["isin"]),
    ticker: findColumn(headers, ["ticker"]),
    name: findColumn(headers, ["name"]),
    shares: findColumn(headers, ["no. of shares"]),
    pricePerShare: findColumn(headers, ["price / share"]),
    priceCurrency: findColumn(headers, ["currency (price / share)"]),
    exchangeRate: findColumn(headers, ["exchange rate"]),
    total: findColumn(headers, ["total"]),
    totalCurrency: findColumn(headers, ["currency (total)"]),
    id: findColumn(headers, ["id"]),
    fees: FEE_COLUMNS.map((name) => ({
      amount: findColumn(headers, [name]),
      currency: findColumn(headers, [`currency (${name})`]),
    })),
  };
}

// ---------------------------------------------------------------------------
// Date conversion
// ---------------------------------------------------------------------------

/**
 * Convert "YYYY-MM-DD HH:MM:SS" to YYYYMMDD. Any other text is returned as it
 * is: the row is then kept and named as a row with no readable date, never
 * read as another day and never a reason to refuse the file (#467).
 */
function convertTrading212Date(dateStr: string): string {
  const trimmed = dateStr.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}${match[2]}${match[3]}`;
  return trimmed;
}

// ---------------------------------------------------------------------------
// Action type classification
// ---------------------------------------------------------------------------

function isBuyAction(action: string): boolean {
  return /buy/i.test(action);
}

function isSellAction(action: string): boolean {
  return /sell/i.test(action);
}

/**
 * A withholding row ("Dividend (Dividend tax)"). "Dividend (Tax exempted)" is
 * a dividend paid with no tax withheld, never a withholding (#467).
 */
function isDividendTaxAction(action: string): boolean {
  return /dividend.*tax/i.test(action) && !/exempt/i.test(action);
}

function isDividendAction(action: string): boolean {
  return /dividend/i.test(action) && !isDividendTaxAction(action);
}

/**
 * Interest on cash, and "Lending interest" (the pay for lending shares out,
 * interest income under art. 25.2 LIRPF): it was dropped with no word (#467).
 */
function isInterestAction(action: string): boolean {
  return /interest on cash|lending interest/i.test(action);
}

/**
 * One leg of a split or a consolidation: "Stock split close" takes the old
 * shares out, "Stock split open" puts the new ones in. Not applied: kept as a
 * row that books nothing, named by parser.corporate_action_not_applied.
 */
function isStockSplitAction(action: string): boolean {
  return /^stock split (open|close)$/i.test(action);
}

/**
 * Money that is no income and no cost of a trade: moves to and from the
 * account and card spending. "Card credit" (a card payment returned) and
 * "New card cost" are card rows too, never a money row to name (#467).
 */
function isSkippedAction(action: string): boolean {
  return /deposit|withdrawal|currency conversion|card debit|card credit|new card cost|spending cashback/i.test(action);
}

// Fractional currency normalization (GBX pence, ZAc cents, ILA agorot →
// ECB major unit ÷100) is shared with the Degiro parser: see
// normalizeFractionalCurrency in csv-utils.ts.

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseTrading212Csv(lines: string[]): Statement {
  const headers = parseCsvLine(lines[0]!, ",");
  const cols = resolveColumns(headers);

  if (cols.action < 0 || cols.time < 0) {
    throw new Error("Trading 212 CSV: faltan columnas obligatorias (Action, Time)");
  }

  const trades: Trade[] = [];
  const cashTransactions: CashTransaction[] = [];
  const parserMessages: TaxMessage[] = [];
  // Count buy/sell rows dropped because the price cell is empty/zero while the
  // Total is in a currency that differs from the instrument's — we can derive
  // neither a per-share price nor usable trade money, so the row is unresolvable.
  let unresolvedPriceSkipped = 0;
  // Dividend and withholding rows with no ticker and no ISIN (#467).
  const unidentifiedCash: string[] = [];
  // Dividend, interest and withholding rows whose Total or currency cannot
  // be read (#467). A dividend's `key` finds its withholdings below.
  const unreadableIncome: { key?: string; type: string; security: string; currency: string; date: string; cells: string[] }[] = [];
  // Money rows of an action no branch knows, which move no shares (#467).
  const notBookedCash: string[] = [];
  // The engine pairs a withholding with a dividend by ISIN alone, so the key
  // is the ISIN when there is one: a withholding that writes no Ticker is
  // still that dividend's.
  const incomeKey = (isin: string, security: string, date: string): string => isin ? `${isin}|${date}` : `|${security}|${date}`;
  const currencyCells = (fields: string[]): string[] => [
    unreadableCell(headers[cols.priceCurrency] ?? "Currency (Price / share)", fields[cols.priceCurrency]),
    unreadableCell(headers[cols.totalCurrency] ?? "Currency (Total)", fields[cols.totalCurrency]),
  ];
  // A file that writes any withholding as a negative Total writes a
  // withholding negative, so a positive one there is a refund or a reversal,
  // which the engine nets (#438). A file that writes every withholding
  // positive writes them as positive: each is a withholding (#467).
  const withholdingsSigned = lines.slice(1).some((l) => {
    const f = parseCsvLine(l.trim(), ",");
    return isDividendTaxAction((f[cols.action] ?? "").trim()) && new Decimal(toFiniteDecimalString(f[cols.total] ?? "0")).isNegative();
  });

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, ",");

    const action = (fields[cols.action] ?? "").trim();
    const timeRaw = (fields[cols.time] ?? "").trim();
    const isin = (fields[cols.isin] ?? "").trim();
    const ticker = (fields[cols.ticker] ?? "").trim();
    const name = (fields[cols.name] ?? "").trim();
    // Finiteness-guarded money/quantity: a malformed cell yields "0", never a
    // non-finite Decimal that would silently poison downstream tax totals.
    const sharesStr = toFiniteDecimalString(fields[cols.shares] ?? "0");
    const priceStr = toFiniteDecimalString(fields[cols.pricePerShare] ?? "0");
    // An empty currency cell is no EUR (#467): a buy or sale with no
    // Currency (Price / share), and a cash row with no Currency (Total), is
    // not booked and is named below. A row that books nothing keeps "EUR".
    const priceCurrencyCell = (fields[cols.priceCurrency] ?? "").trim();
    const rawCurrency = priceCurrencyCell || "EUR";
    const { currency: priceCurrency, divisor: priceDivisor } = normalizeFractionalCurrency(rawCurrency);
    const currency = priceCurrency;
    // Currency (Total) is the only currency of the Total: in an EUR account
    // the Total holds the credited EUR amount, not the instrument's currency,
    // so an empty Currency (Total) is never read as the price currency (#467).
    const cashCurrencyCell = (fields[cols.totalCurrency] ?? "").trim();
    const rawCashCurrency = cashCurrencyCell || rawCurrency;
    const { currency: cashCurrency, divisor: cashDivisor } = normalizeFractionalCurrency(rawCashCurrency);
    const totalStr = toFiniteDecimalString(fields[cols.total] ?? "0");
    const txId = (fields[cols.id] ?? "").trim();

    const tradeDate = timeRaw ? convertTrading212Date(timeRaw) : "";
    const tradeTime = timeRaw ? timeOfDay(timeRaw) : undefined;

    if (isSkippedAction(action)) continue;

    const uniqueId = txId || `${tradeDate}-${ticker || action}-${i}`;

    // A split leg moves shares of its security, so it is evidence of a
    // holding at the anti-churning window start (#453, #467): kept as a row
    // that books nothing, never dropped, and named as a split that is not
    // applied, not as an unreadable row.
    if (isStockSplitAction(action)) {
      trades.push(corporateActionTrade({
        tradeID: `trading212-split-${uniqueId}`,
        symbol: ticker, description: name, isin, assetCategory: "STK", currency, tradeDate, tradeTime,
        buySell: /close/i.test(action) ? "SELL" : "BUY", exchange: "TRADING212",
      }, action, fields[cols.shares] ?? ""));
      continue;
    }

    // A buy or sale row, or a row of an action no branch below handles (a
    // share transfer) that names a ticker or an ISIN, is kept as a trade that
    // books nothing when it cannot be read: no Time, no ticker, an unknown
    // action. Dropping it would hide a purchase or a sale (#467).
    // A row of an unknown action that writes a zero share count moves no
    // shares and stays skipped, as does one that names no security. One that
    // names its security only by Name is kept when it writes a share count.
    // One with an empty share cell is a cash row ("Result adjustment", a fee,
    // a tax): it moves no shares and is no trade.
    const buy = isBuyAction(action);
    const sell = isSellAction(action);
    const otherAction = !buy && !sell && !isDividendTaxAction(action) && !isDividendAction(action) && !isInterestAction(action);
    const sharesUnreadable = quantityUnreadable(fields[cols.shares]);
    const movesNoShares = !sharesUnreadable && new Decimal(sharesStr).isZero();
    const named = ticker || isin ? true : name !== "" && !sharesUnreadable;
    const sharesEmpty = (fields[cols.shares] ?? "").trim() === "";
    if (otherAction && (!named || movesNoShares || sharesEmpty)) {
      // Its money is not booked under a guessed meaning, but a "Result
      // adjustment" credit is gain the report would never see: a Total that
      // is not a written zero is named (#467). An empty Total writes no money.
      const totalCell = (fields[cols.total] ?? "").trim();
      if (totalCell !== "" && (quantityUnreadable(totalCell) || !new Decimal(totalStr).isZero())) {
        notBookedCash.push(cashIncomeRowText(action, ticker || isin || name, cashCurrencyCell, tradeDate,
          [unreadableCell(headers[cols.total] ?? "Total", totalCell)]));
      }
      continue;
    }
    const unreadableCellOf = (): string | undefined => {
      if (!timeRaw) return unreadableCell(headers[cols.time] ?? "Time", timeRaw);
      if (otherAction) return unreadableCell(headers[cols.action] ?? "Action", action);
      if ((buy || sell) && !ticker) return unreadableCell(headers[cols.ticker] ?? "Ticker", ticker);
      return undefined;
    };
    const cell = buy || sell || otherAction ? unreadableCellOf() : undefined;
    if (cell !== undefined) {
      trades.push(unreadableTrade({
        tradeID: `trading212-row-${uniqueId}`,
        symbol: ticker, description: name, isin, assetCategory: "STK", currency, tradeDate, tradeTime,
        ...(buy || sell ? { buySell: sell ? "SELL" as const : "BUY" as const } : {}), exchange: "TRADING212",
      }, cell));
      continue;
    }
    // A dividend, withholding or interest row with no readable Time is
    // booked with that Time and taken out, named, by dropUndatedCash below.

    // A dividend or withholding row with no ticker goes by its ISIN; with
    // neither it is named, never dropped with no word (#467).
    const security = ticker || isin;

    // Withholding tax on dividend — must be checked before the generic dividend branch
    if (isDividendTaxAction(action)) {
      // A Total that cannot be read is no zero: in a file that writes
      // withholdings negative the row can be a refund, and dropped the report
      // kept a deduction paid back. Not booked, named, with or without a
      // security (#467). A written zero stays skipped.
      if (quantityUnreadable(fields[cols.total])) {
        unreadableIncome.push({
          type: action, security: security || "—", currency: cashCurrencyCell ? cashCurrency : "", date: tradeDate,
          cells: [unreadableCell(headers[cols.total] ?? "Total", fields[cols.total]), ...(cashCurrencyCell ? [] : currencyCells(fields))],
        });
        continue;
      }
      const signedDec = new Decimal(totalStr).div(cashDivisor);
      const amountDec = withholdingsSigned ? signedDec : signedDec.abs().neg();
      if (amountDec.isZero()) continue;
      // With no Currency (Total) it is no EUR and not the price currency: not
      // booked, named (#467).
      if (!cashCurrencyCell) {
        unreadableIncome.push({ type: action, security: security || "—", currency: "", date: tradeDate, cells: currencyCells(fields) });
        continue;
      }
      if (!security) {
        unidentifiedCash.push(`${action} ${amountDec.toString()} ${cashCurrency} ${tradeDate || "—"}`);
        continue;
      }

      cashTransactions.push({
        transactionID: `trading212-tax-${uniqueId}`,
        accountId: "",
        symbol: security,
        description: `Withholding tax - ${security}`,
        isin,
        currency: cashCurrency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: amountDec.toString(),
        fxRateToBase: "1",
        type: "Withholding Tax",
      });
      continue;
    }

    // A dividend or interest row whose Total cannot be read is no zero, and
    // one with no currency is no EUR: it is not booked and is named, never
    // dropped with no word (#467). A written zero stays skipped. The
    // withholdings of such a dividend are taken out and named with it below.
    if (isDividendAction(action) || isInterestAction(action)) {
      const totalUnreadable = quantityUnreadable(fields[cols.total]);
      if (totalUnreadable || (!cashCurrencyCell && !new Decimal(totalStr).isZero())) {
        const dividend = isDividendAction(action);
        unreadableIncome.push({
          ...(dividend ? { key: incomeKey(isin, security, tradeDate) } : {}),
          type: action, security: dividend ? security || "—" : "", currency: cashCurrencyCell ? cashCurrency : "", date: tradeDate,
          cells: [
            ...(totalUnreadable ? [unreadableCell(headers[cols.total] ?? "Total", fields[cols.total])] : []),
            ...(cashCurrencyCell ? [] : currencyCells(fields)),
          ],
        });
        continue;
      }
    }

    // Dividends
    if (isDividendAction(action)) {
      const amountDec = new Decimal(totalStr).abs().div(cashDivisor);
      if (amountDec.isZero()) continue;
      if (!security) {
        unidentifiedCash.push(`${action} ${amountDec.toString()} ${cashCurrency} ${tradeDate || "—"}`);
        continue;
      }

      cashTransactions.push({
        transactionID: `trading212-div-${uniqueId}`,
        accountId: "",
        symbol: security,
        description: `Dividend - ${security}`,
        isin,
        currency: cashCurrency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: amountDec.toString(),
        fxRateToBase: "1",
        type: "Dividends",
      });
      continue;
    }

    // Interest on cash
    if (isInterestAction(action)) {
      const amountDec = new Decimal(totalStr).abs().div(cashDivisor);
      if (amountDec.isZero()) continue;

      cashTransactions.push({
        transactionID: `trading212-interest-${uniqueId}`,
        accountId: "",
        symbol: "CASH",
        description: action,
        isin: "",
        currency: cashCurrency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: amountDec.toString(),
        fxRateToBase: "1",
        type: "Broker Interest Received",
      });
      continue;
    }

    // Buy / Sell trades (an unreadable one was kept above)
    if (!buy && !sell) continue;

    const qtyDec = new Decimal(sharesStr).abs();
    if (qtyDec.isZero()) {
      // An empty or unreadable share count is no "0": keep the row as a
      // trade of unknown quantity for the anti-churning evidence (#453).
      if (quantityUnreadable(fields[cols.shares])) {
        trades.push(quantityUnknownTrade({
          tradeID: `trading212-${buy ? "buy" : "sell"}-${uniqueId}`,
          symbol: ticker, description: name, isin, assetCategory: "STK", currency, tradeDate, tradeTime,
          buySell: sell ? "SELL" : "BUY", exchange: "TRADING212",
        }));
      }
      continue;
    }

    // No price currency is no EUR (#467): a GBP sale was booked as euros.
    if (!priceCurrencyCell) {
      trades.push(unreadableTrade({
        tradeID: `trading212-row-${uniqueId}`,
        symbol: ticker, description: name, isin, assetCategory: "STK", currency, tradeDate, tradeTime,
        buySell: sell ? "SELL" : "BUY", exchange: "TRADING212",
      }, unreadableCell(headers[cols.priceCurrency] ?? "Currency (Price / share)", fields[cols.priceCurrency])));
      continue;
    }

    const priceDec = new Decimal(priceStr).div(priceDivisor);
    const totalDec = new Decimal(totalStr).abs().div(cashDivisor);
    // A row valued from its Total needs the Total's own currency: with an
    // empty Currency (Total) an EUR Total was read as USD (#467). It books
    // nothing and is named by both cells.
    if (priceDec.isZero() && !totalDec.isZero() && !cashCurrencyCell) {
      trades.push(unreadableTrade({
        tradeID: `trading212-row-${uniqueId}`,
        symbol: ticker, description: name, isin, assetCategory: "STK", currency, tradeDate, tradeTime,
        buySell: sell ? "SELL" : "BUY", exchange: "TRADING212",
      }, `${unreadableCell(headers[cols.pricePerShare] ?? "Price / share", fields[cols.pricePerShare])}, ${unreadableCell(headers[cols.totalCurrency] ?? "Currency (Total)", fields[cols.totalCurrency])}`));
      continue;
    }
    if (priceDec.isZero() && !totalDec.isZero() && cashCurrency !== currency) {
      unresolvedPriceSkipped++;
      // A blank or unreadable price is still a buy or sale for the
      // anti-churning evidence (#453): kept as a trade that books nothing, as
      // a row with no share count is. A written zero price stays skipped.
      if (quantityUnreadable(fields[cols.pricePerShare])) {
        trades.push(quantityUnknownTrade({
          tradeID: `trading212-${buy ? "buy" : "sell"}-${uniqueId}`,
          symbol: ticker, description: name, isin, assetCategory: "STK", currency, tradeDate, tradeTime,
          buySell: sell ? "SELL" : "BUY", exchange: "TRADING212",
        }));
      }
      continue;
    }
    // With neither a price nor a Total the row moves shares for no money it
    // can read. Booked, a sale was a disposal at 0, a full loss (#467). A
    // written zero in both cells is a corporate action not applied, as in
    // Lightyear, Scalable, Flatex and DEGIRO; any other is an unreadable row
    // named by both cells. Either books nothing and keeps the evidence.
    if (priceDec.isZero() && totalDec.isZero()) {
      const row = {
        symbol: ticker, description: name, isin, assetCategory: "STK" as const, currency, tradeDate, tradeTime,
        buySell: sell ? "SELL" as const : "BUY" as const, exchange: "TRADING212",
      };
      const priceCell = fields[cols.pricePerShare];
      const totalCell = fields[cols.total];
      const priceName = headers[cols.pricePerShare] ?? "Price / share";
      const totalName = headers[cols.total] ?? "Total";
      if (!quantityUnreadable(priceCell) && !quantityUnreadable(totalCell)) {
        trades.push(corporateActionTrade({ ...row, tradeID: `trading212-action-${uniqueId}` },
          `${priceName} ${priceCell!.trim()}, ${totalName} ${totalCell!.trim()}`, fields[cols.shares] ?? ""));
      } else {
        trades.push(unreadableTrade({ ...row, tradeID: `trading212-row-${uniqueId}` },
          `${unreadableCell(priceName, priceCell)}, ${unreadableCell(totalName, totalCell)}`));
      }
      continue;
    }
    const grossDec = priceDec.isZero()
      ? totalDec
      : qtyDec.times(priceDec);
    // FIFO values a trade at quantity × tradePrice and never reads the Total,
    // so a trade valued from its Total is priced Total ÷ shares, in the
    // instrument's major unit as the Total is (#467). A price of "0" sold the
    // shares at 0. A readable price keeps its value.
    const tradePriceDec = priceDec.isZero() ? grossDec.div(qtyDec) : priceDec;

    // Fees and transaction taxes are part of the acquisition cost on a buy and
    // reduce the transmission value on a sell (Art. 35.1.b / 35.2 LIRPF). A fee in
    // the instrument's currency goes to `taxes` (added as-is); a fee in another
    // currency (e.g. the EUR conversion fee on a USD trade) goes to `commission`,
    // which the FIFO engine converts at the trade-date cross-rate. When the price
    // is missing the trade is valued from Total, which already includes the fees,
    // so they are not added a second time.
    let taxesDec = new Decimal(0);
    let commissionDec = new Decimal(0);
    let commissionCurrency = currency;
    for (const fee of priceDec.isZero() ? [] : cols.fees) {
      if (fee.amount < 0) continue;
      const amountDec = toFiniteDecimal(fields[fee.amount] ?? "0").abs();
      if (amountDec.isZero()) continue;
      // A fee with no currency of its own is in Currency (Total), never in
      // the price currency; with neither it is not added, which can only
      // raise the tax (#467).
      const rawFeeCurrency = (fields[fee.currency] ?? "").trim() || cashCurrencyCell;
      if (!rawFeeCurrency) continue;
      const { currency: feeCurrency, divisor: feeDivisor } = normalizeFractionalCurrency(rawFeeCurrency);
      if (feeCurrency === currency) {
        taxesDec = taxesDec.plus(amountDec.div(feeDivisor));
      } else {
        commissionDec = commissionDec.plus(amountDec.div(feeDivisor));
        commissionCurrency = feeCurrency;
      }
    }

    trades.push({
      tradeID: `trading212-${buy ? "buy" : "sell"}-${uniqueId}`,
      accountId: "",
      symbol: ticker,
      description: name || `${buy ? "Buy" : "Sell"} ${ticker}`,
      isin,
      assetCategory: "STK",
      currency,
      tradeDate,
      tradeTime,
      settlementDate: tradeDate,
      quantity: sell ? qtyDec.neg().toString() : qtyDec.toString(),
      tradePrice: tradePriceDec.toString(),
      tradeMoney: sell ? grossDec.toString() : grossDec.neg().toString(),
      proceeds: sell ? grossDec.toString() : "0",
      cost: sell ? "0" : grossDec.neg().toString(),
      fifoPnlRealized: "0",
      fxRateToBase: "1",
      buySell: sell ? "SELL" : "BUY",
      openCloseIndicator: sell ? "C" : "O",
      exchange: "TRADING212",
      commissionCurrency,
      commission: commissionDec.isZero() ? "0" : commissionDec.neg().toString(),
      taxes: taxesDec.isZero() ? "0" : taxesDec.neg().toString(),
      multiplier: "1",
    });
  }

  if (unresolvedPriceSkipped > 0) {
    parserMessages.push({
      id: "parser.trading212.unresolved_price_skipped",
      severity: "warning",
      message: `Se omitieron ${unresolvedPriceSkipped} operaciones sin precio por acción y con importe en otra divisa.`,
      hint: "Estas filas no tenían precio por acción y su importe (Total) estaba en una divisa distinta a la del instrumento, por lo que no se pudo calcular el valor de la operación. Vuelve a exportar el histórico desde Trading 212 asegurándote de incluir la columna \"Price / share\".",
      context: { skipped: String(unresolvedPriceSkipped) },
    });
  }

  // The withholdings of a dividend that is not booked (same security, same
  // day) are not booked either: a deduction for income the report does not
  // count, which could pair with another dividend of the security. They are
  // named with it.
  const unreadableRows = unreadableIncome.map((row) => {
    if (row.key === undefined) return cashIncomeRowText(row.type, row.security, row.currency, row.date, row.cells);
    const withheld = cashTransactions.filter((c) => c.type === "Withholding Tax" && incomeKey(c.isin, c.symbol, c.dateTime) === row.key);
    for (const w of withheld) cashTransactions.splice(cashTransactions.indexOf(w), 1);
    const tax = withheld.map((w) => `${w.description} ${w.amount} ${w.currency}`).join(", ");
    return cashIncomeRowText(row.type, row.security, row.currency, row.date, row.cells, tax);
  });

  markUndatedTrades(trades, headers[cols.time] ?? "Time");
  parserMessages.push(
    ...tradeQuantityUnknownMessages("Trading 212", trades),
    ...dropUndatedCash("Trading 212", cashTransactions, headers[cols.time] ?? "Time"),
    ...cashRowsUnidentifiedMessages("Trading 212", unidentifiedCash),
    ...cashIncomeAmountUnreadableMessages("Trading 212", unreadableRows),
    ...cashRowsNotBookedMessages("Trading 212", notBookedCash),
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
    parserMessages: parserMessages.length > 0 ? parserMessages : undefined,
  };
}

// ---------------------------------------------------------------------------
// Public BrokerParser
// ---------------------------------------------------------------------------

export const trading212Parser: BrokerParser = {
  name: "Trading 212",
  formats: ["CSV"],

  detect(input: string): boolean {
    const lines = stripBom(input).split(/\r?\n/);
    return lines.slice(0, 10).some((l) => isTrading212Csv(l));
  },

  parse(input: string): Statement {
    const cleaned = stripBom(input);
    const allLines = cleaned.split(/\r?\n/);
    const headerIdx = allLines.findIndex((l) => isTrading212Csv(l));
    if (headerIdx === -1) {
      const hasContent = allLines.some((l) => l.trim());
      throw new Error(hasContent ? "Trading 212 CSV: formato no reconocido" : "Trading 212 CSV: fichero vacío o sin datos");
    }
    const lines = allLines.slice(headerIdx).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error("Trading 212 CSV: fichero vacío o sin datos");
    }

    return parseTrading212Csv(lines);
  },
};

