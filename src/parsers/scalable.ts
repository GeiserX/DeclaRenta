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

// Statuses booked as executed. A status that says the order or payment never
// happened stays skipped; any other is not read as executed, and the row is
// named, never dropped with no word (#467).
const EXECUTED_STATUSES = new Set(["executed", "ejecutada", "ejecutado", "ausgeführt"]);
const NOT_EXECUTED_STATUS =
  /cancel|reject|pend|expir|fail|storn|abgelehnt|abgebrochen|abgelaufen|fehlgeschlagen|ausstehend|anulad|rechaz|caducad|fallid/;
// A status that also names an execution or a part ("Partially cancelled",
// "Executed, remainder cancelled", "Teilweise ausgeführt, Rest storniert")
// may have moved shares or money: it is a status not known, never skipped.
const EXECUTED_IN_PART_STATUS = /execut|ausgef|ejecut|fill|partial|teilweise|parcial/;

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
  // Interest and distribution rows of a status not known, and reversed
  // distributions whose tax cannot be read (#467).
  const incomeNotRead: string[] = [];
  // Distribution rows of a written zero whose tax is a refund, booked alone (#467).
  const zeroDividendRefund: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, delimiter);

    // Only executed rows are booked; an empty status is read as executed.
    const statusText = (fields[cols.status] ?? "").trim();
    const status = statusText.toLowerCase();
    if (NOT_EXECUTED_STATUS.test(status) && !EXECUTED_IN_PART_STATUS.test(status)) continue;
    const statusCell = status && !EXECUTED_STATUSES.has(status)
      ? unreadableCell(headers[cols.status] ?? "status", statusText) : undefined;

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
    // An interest or distribution row of a status not known may never have
    // been paid: neither it nor its tax is booked, and it is named (#467). A
    // written zero amount with no tax books nothing anyway and stays skipped.
    if (isIncome && statusCell !== undefined) {
      if (quantityUnreadable(fields[cols.amount]) || !new Decimal(amount).isZero() || !new Decimal(tax).isZero()) {
        const taxShown = new Decimal(tax).isZero() ? "" : `${headers[cols.tax] ?? "tax"} ${tax}`;
        incomeNotRead.push(cashIncomeRowText((fields[cols.type] ?? "").trim(), isin ? `${description || "—"} (${isin})` : description,
          currency || "EUR", tradeDate, [statusCell], taxShown));
      }
      continue;
    }
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
    // A row of a status not known that would be booked or kept is kept as a
    // row that books nothing, named by its status: it may be a purchase or a
    // sale (#467). A cash row (a deposit, a fee) stays skipped.
    if (statusCell !== undefined) {
      const kept = sellType || buyType ? !(isin && movesNoShares) : keptOther && (isCorporateActionType(type) || !sharesEmpty);
      if (kept) {
        trades.push(unreadableTrade({
          tradeID: reference || `scalable-row-${tradeDate}-${isin}-${i}`,
          symbol: description, description, isin, assetCategory: /etf|fund/.test(assetType) ? "FUND" : "STK",
          currency: currency || "EUR", tradeDate, tradeTime,
          ...(sellType || buyType ? { buySell: sellType ? "SELL" as const : "BUY" as const } : {}), exchange: "XETR",
        }, statusCell));
      }
      continue;
    }
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
      // An empty, blank or missing tax cell (a short row) on a reversal is no
      // written zero either: booked with no refund, the reversed dividend kept
      // its whole withholding on 0 € of income. A written "0" is the file's
      // word, and a file with no tax column books no withholding to refund.
      const reversal = new Decimal(amount).isNegative();
      const taxCell = cols.tax >= 0 ? fields[cols.tax] : undefined;
      if (reversal && cols.tax >= 0 && quantityUnreadable(taxCell)) {
        incomeNotRead.push(cashIncomeRowText((fields[cols.type] ?? "").trim(), `${description || "—"} (${isin}) ${amount}`,
          currency || "EUR", tradeDate, [unreadableCell(headers[cols.tax] ?? "tax", taxCell)]));
        continue;
      }
      // A written zero amount whose tax cell is written but cannot be read
      // ("abc", "+5,00 EUR") is no written zero either: read as 0, it was
      // dropped with no word, and it may be a refund of the dividend next to
      // it. Neither is booked, so the report keeps the dividend's own
      // withholding, and the row is named with both cells (#467). An empty
      // tax cell stays the file's written zero.
      const zeroAmount = new Decimal(amount).isZero();
      if (zeroAmount && (taxCell ?? "").trim() !== "" && quantityUnreadable(taxCell)) {
        unreadableIncome.push(cashIncomeRowText((fields[cols.type] ?? "").trim(), `${description || "—"} (${isin})`, currency || "EUR", tradeDate,
          [unreadableCell(headers[cols.amount] ?? "amount", fields[cols.amount]), unreadableCell(headers[cols.tax] ?? "tax", taxCell)]));
        continue;
      }
      // A written zero amount with a tax is no dividend: the row only carries
      // a tax. A 0 dividend took its own tax as its pair, and that tax then
      // counted against the treaty cap of the country's other dividends with
      // no income behind it. A written zero with no tax stays booked as the
      // file writes it.
      // Scalable writes a withholding negative ("-2,33"). Booked alone as a
      // late withholding, a negative tax on a written zero ("-5,00",
      // "(5,00)") gave a credit with no income behind it, with no word: 100
      // with -19 and then 0 with -5 gave a 0597 of 24, and a tax-only row of
      // another US security raised the 0588. It is not booked, as in Trade
      // Republic, and the row is named: the user adds a real late
      // withholding by hand (#467).
      if (zeroAmount && new Decimal(tax).lessThan(0)) {
        unreadableIncome.push(cashIncomeRowText((fields[cols.type] ?? "").trim(), `${description || "—"} (${isin})`, currency || "EUR", tradeDate,
          [unreadableCell(headers[cols.amount] ?? "amount", fields[cols.amount])], `${headers[cols.tax] ?? "tax"} ${tax}`));
        continue;
      }
      // A positive tax on a written zero is money paid back, a refund. Read
      // as a new withholding, 100 with -19 and then 0 with +5 gave a 0597 of
      // 24 instead of 14. It is booked alone, as a refund, which the report
      // takes from a dividend of its ISIN (dividends.ts matchWithholdings),
      // never below 0, and it is named: with no dividend in reach the report
      // leaves it out. In a file that writes withholdings positive the row
      // may be a late withholding: booked as a refund it can only raise the
      // tax (#467). A tax of 0 is no refund: decimal.js counts 0 as
      // positive, so the test is greaterThan(0). A zero or empty tax on a
      // zero row is the file's written zero and stays booked with no word.
      const taxNum = parseFloat(parseNumber(tax));
      const zeroRefund = zeroAmount && new Decimal(tax).greaterThan(0);
      if (zeroRefund) {
        zeroDividendRefund.push(cashIncomeRowText((fields[cols.type] ?? "").trim(), `${description || "—"} (${isin})`, currency || "EUR", tradeDate,
          [unreadableCell(headers[cols.amount] ?? "amount", fields[cols.amount]), unreadableCell(headers[cols.tax] ?? "tax", fields[cols.tax])]));
      }
      if (!(zeroAmount && taxNum !== 0)) cashTransactions.push({
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
          amount: reversal || zeroRefund ? new Decimal(tax).abs().toString() : new Decimal(tax).abs().neg().toString(),
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

    // Scalable's assetType column flags ETFs/funds explicitly ("ETF").
    // Map those to FUND; "Security" and others remain STK.
    const assetCategory: Trade["assetCategory"] = /etf|fund/.test(assetType) ? "FUND" : "STK";

    // A Buy with a negative share count says the shares moved back (a
    // reversed purchase). Read with its sign dropped it was one more purchase,
    // so the reversed lot stayed in FIFO and a gain could become a loss with
    // no word. It books nothing and is named by its shares cell, as in Flatex
    // and Lightyear. A Sell with a positive count stays a sale: a sale count
    // may be written unsigned (#467).
    if (isBuy && !isSell && sharesNum < 0) {
      trades.push(unreadableTrade({
        tradeID: reference || `scalable-row-${tradeDate}-${isin}-${i}`,
        symbol: description, description, isin, assetCategory, currency: currency || "EUR", tradeDate, tradeTime,
        buySell: "BUY", exchange: "XETR",
      }, unreadableCell(headers[cols.shares] ?? "shares", fields[cols.shares])));
      continue;
    }
    const absShares = Math.abs(sharesNum);

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
    } else if (!amountAbs.isZero()) {
      // The amount is the money the trade moved: shares × price, with or
      // without the fee and the tax. When it contradicts shares × price (a
      // bond quoted in % of its face: 1000 at 99,00 for 990,00), FIFO would
      // book a value 100 times too large: the row books nothing and is named
      // by its shares, price and amount cells, as in Freedom24 (#467). The
      // tolerance (1 % and a cent) covers a price written rounded. A zero or
      // unreadable amount is no evidence, so the row is booked as before.
      const value = new Decimal(parseNumber(shares)).abs().times(price);
      const slack = value.times("0.01").plus("0.01").plus(new Decimal(fee).abs()).plus(new Decimal(tax).abs());
      if (amountAbs.minus(value).abs().greaterThan(slack)) {
        trades.push(unreadableTrade({
          tradeID: reference || `scalable-row-${tradeDate}-${isin}-${i}`,
          symbol: description, description, isin, assetCategory, currency: currency || "EUR", tradeDate, tradeTime,
          buySell: isSell ? "SELL" : "BUY", exchange: "XETR",
        }, [unreadableCell(headers[cols.shares] ?? "shares", fields[cols.shares]), unreadableCell(headers[cols.price] ?? "price", priceCell),
          unreadableCell(headers[cols.amount] ?? "amount", fields[cols.amount])].join(", ")));
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
      // The fee keeps the sign Scalable writes: a paid fee is negative
      // ("-0,99"), a positive one is money paid back, a rebate, as
      // commissionCost reads it. Booked by its absolute value, a rebate of 5
      // lowered the gain by 5 instead of raising it (#467). A charge written
      // positive can only raise the tax.
      commission: new Decimal(fee).isZero() ? "0" : new Decimal(fee).toString(),
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
      message: `Scalable Capital: ${incomeNotRead.length} dividendo(s) o interés(es) no se pueden leer y no se calculan: ${rows}.`,
      hint: "Entre corchetes va la celda que falla. Puede ser un estado que DeclaRenta no reconoce. DeclaRenta solo calcula las filas ejecutadas y no cuenta las canceladas, rechazadas o pendientes. Con otro estado no sabe si el cobro se hizo. También puede ser la retención (tax) de una fila que anula un dividendo. Entonces DeclaRenta no resta esa fila, y el dividendo anulado sigue sumado con su retención. Compara cada fila con el extracto de Scalable Capital. Si es un cobro real del año que declaras, añade el importe y la retención a mano en Renta Web. Si anula un dividendo, quita en Renta Web ese dividendo y su retención.",
      context: { count: String(incomeNotRead.length), rows },
    });
  }
  if (zeroDividendRefund.length > 0) {
    const rows = zeroDividendRefund.join("; ");
    parserMessages.push({
      id: "scalable.dividend_tax_refund",
      severity: "warning",
      message: `Scalable Capital: ${zeroDividendRefund.length} fila(s) de dividendo traen importe 0 y una devolución de retención (tax positivo): ${rows}.`,
      hint: "Una fila con importe 0 no es un dividendo. Scalable Capital escribe la retención (tax) en negativo, así que una positiva es una devolución. DeclaRenta la resta de la retención de un dividendo del mismo valor de 7 días antes o después o, si no hay ninguno, de uno anterior del mismo año. Si no hay ninguno, no la resta, y la retención de ese dividendo cuenta entera: así pagarías de menos. Toma la retención final del informe fiscal de Scalable Capital y corrige a mano en Renta Web la casilla 0588, o la 0597 si el valor es español. Si la fila es una retención cobrada más tarde, DeclaRenta no la cuenta: añádela a mano.",
      context: { count: String(zeroDividendRefund.length), rows },
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
