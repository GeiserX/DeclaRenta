/**
 * Lightyear CSV parser.
 *
 * Parses Lightyear's "Transaction report" CSV export into a normalized Statement.
 * Lightyear is an Estonian neobroker (FSA license #4.1-1/20) that does NOT
 * report to AEAT — users must declare gains/dividends manually.
 *
 * CSV format (real export):
 * Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.
 *
 * Transaction types:
 * - Buy / Sell: stock/ETF trades (including money market funds like BRICEKSP, ICSUSSDP)
 * - Dividend: dividend payments (Tax Amt. contains withholding tax)
 * - Distribution: ETF distributions (Fee deducted, Tax Amt. for withholding)
 * - Interest: interest income (no ticker/ISIN)
 * - Reward: cash rewards (no ticker/ISIN)
 * - Conversion: FX conversions (skipped — not taxable events)
 * - Deposit / Withdrawal: cash movements (skipped)
 *
 * Limitations:
 * - No open positions in CSV — Modelo 720/D-6 cannot be generated from this alone.
 * - FX Rate is Lightyear's own rate, not ECB — the FIFO engine fetches ECB rates independently.
 * - Distributions are treated as dividends (casilla 0029) with withholding (casilla 0588).
 */

import Decimal from "decimal.js";
import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import type { TaxMessage } from "../types/tax.js";
import {
  parseCsvLine,
  parseNumber,
  toFiniteDecimal,
  toFiniteDecimalString,
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
  isReadableDay,
  dropUndatedCash,
  cashRowsUnidentifiedMessages,
  cashIncomeRowText,
  cashIncomeAmountUnreadableMessages,
} from "./csv-utils.js";


// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

/** Lightyear CSV: "Date,Reference,Ticker,ISIN,Type,...,CCY,...,Net Amt." */
const LIGHTYEAR_REQUIRED = ["reference", "ticker", "isin", "type", "ccy", "net amt."];

function isLightyearCsv(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return LIGHTYEAR_REQUIRED.every((h) => lower.includes(h));
}

// ---------------------------------------------------------------------------
// Column resolution
// ---------------------------------------------------------------------------

interface LightyearColumns {
  date: number;
  reference: number;
  ticker: number;
  isin: number;
  type: number;
  quantity: number;
  ccy: number;
  pricePerShare: number;
  grossAmount: number;
  fxRate: number;
  fee: number;
  netAmount: number;
  taxAmount: number;
}

function resolveColumns(headers: string[]): LightyearColumns {
  return {
    date: findColumn(headers, ["date"]),
    reference: findColumn(headers, ["reference"]),
    ticker: findColumn(headers, ["ticker"]),
    isin: findColumn(headers, ["isin"]),
    type: findColumn(headers, ["type"]),
    quantity: findColumn(headers, ["quantity"]),
    ccy: findColumn(headers, ["ccy", "currency"]),
    pricePerShare: findColumn(headers, ["price/share", "price per share", "price"]),
    grossAmount: findColumn(headers, ["gross amount"]),
    fxRate: findColumn(headers, ["fx rate"]),
    fee: findColumn(headers, ["fee"]),
    netAmount: findColumn(headers, ["net amt.", "net amount", "net amt"]),
    taxAmount: findColumn(headers, ["tax amt.", "tax amount", "tax amt"]),
  };
}

// ---------------------------------------------------------------------------
// Date conversion
// ---------------------------------------------------------------------------

/**
 * Convert "DD/MM/YYYY HH:MM:SS" (day and month with one or two digits) or
 * "YYYY-MM-DD" to YYYYMMDD. Any other text is returned as it is: the row is
 * then kept and named as a row with no readable date, never read as another
 * day and never a reason to refuse the file (#467).
 */
function convertLightyearDate(dateStr: string): string {
  const trimmed = dateStr.trim();
  // DD/MM/YYYY (with optional time)
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) return `${match[3]}${match[2]!.padStart(2, "0")}${match[1]!.padStart(2, "0")}`;
  // Fallback: YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
  return trimmed;
}

// ---------------------------------------------------------------------------
// Transaction type classification
// ---------------------------------------------------------------------------

const SKIP_TYPES = new Set(["deposit", "withdrawal"]);
const DIVIDEND_TYPES = new Set(["dividend", "distribution"]);
const INCOME_TYPES = new Set(["interest", "reward"]);

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseLightyearCsv(lines: string[]): Statement {
  const headers = parseCsvLine(lines[0]!, ",");
  const cols = resolveColumns(headers);

  if (cols.date < 0 || cols.type < 0 || cols.ccy < 0) {
    throw new Error("Lightyear CSV: faltan columnas obligatorias (Date, Type, CCY)");
  }

  const trades: Trade[] = [];
  const cashTransactions: CashTransaction[] = [];

  // Pre-scan: Lightyear writes a conversion as a pair of rows with the same
  // timestamp, one leg per currency. The EUR leg's |Net Amt.| is the real
  // spread-laden EUR principal Lightyear moved (fee EXCLUDED: the engine
  // applies our -Fee commission on top), so the non-EUR trade can be valued at
  // the real applied rate instead of ECB (Art. 35.1 LIRPF; issue #253). The
  // fee can be on either leg (often the EUR leg, which is not booked). Gross is
  // fee-INCLUSIVE, so a Net that cannot be read gives no principal, never the
  // Gross. The timestamp is the only key, to the second: a pair is known only
  // when the second holds exactly two conversion rows, one in EUR and one in
  // another currency. Any other second (two conversions at once, an FCY↔FCY
  // one, a leg with no CCY) gets no EUR principal, so the engine uses the ECB
  // rate, and each leg keeps the fee its own row writes. Pairing by a guess
  // gave a conversion another one's EUR principal, or both the larger fee
  // (#467).
  const conversionLegs = new Map<string, string[][]>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const fields = parseCsvLine(line, ",");
    if ((fields[cols.type] ?? "").trim().toLowerCase() !== "conversion") continue;
    const dateRaw = (fields[cols.date] ?? "").trim();
    conversionLegs.set(dateRaw, [...(conversionLegs.get(dateRaw) ?? []), fields]);
  }
  const conversionPairs = new Map<string, { realEurAmount?: string; fee?: { fee: string; currency: string } }>();
  for (const [dateRaw, legs] of conversionLegs) {
    if (legs.length !== 2) continue;
    const ccys = legs.map((fields) => (fields[cols.ccy] ?? "").trim());
    const eur = ccys.indexOf("EUR");
    const other = ccys[1 - eur];
    if (eur < 0 || !other || other === "EUR") continue;
    const eurNet = toFiniteDecimal(legs[eur]![cols.netAmount] ?? "0");
    let fee: { fee: string; currency: string } | undefined;
    legs.forEach((fields, k) => {
      const feeDec = toFiniteDecimal(fields[cols.fee] ?? "0").abs();
      if (!feeDec.isZero() && (!fee || feeDec.greaterThan(fee.fee))) fee = { fee: feeDec.toString(), currency: ccys[k]! };
    });
    conversionPairs.set(dateRaw, {
      ...(eurNet.isZero() ? {} : { realEurAmount: eurNet.abs().toString() }),
      ...(fee ? { fee } : {}),
    });
  }

  // Rows of a type no branch handles (e.g. a split or transfer), per raw type.
  const unknownTypes = new Map<string, number>();
  // Dividend rows with no ticker and no ISIN (#467).
  const unidentifiedCash: string[] = [];
  // Dividend and income rows whose amount cannot be read (#467).
  const unreadableIncome: string[] = [];
  // Conversion legs with no readable amount or currency (#467). They are
  // named with the unreadable trade rows but not booked as trades: a currency
  // leg is no anti-churning evidence, and the FX engine books every CASH
  // trade it is given, in its currency.
  const unreadableConversions: Trade[] = [];
  // Income rows whose shares are booked as a purchase (#467).
  const incomeShareRows: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, ",");

    const dateRaw = (fields[cols.date] ?? "").trim();
    const reference = (fields[cols.reference] ?? "").trim();
    const ticker = (fields[cols.ticker] ?? "").trim();
    const isin = (fields[cols.isin] ?? "").trim();
    const txType = (fields[cols.type] ?? "").trim().toLowerCase();
    // Money/quantity that feeds tax totals is finiteness-guarded: a malformed
    // cell yields "0", never a non-finite Decimal that silently poisons totals.
    // The price is read where a buy or sale is booked, below.
    const quantityStr = toFiniteDecimalString(fields[cols.quantity] ?? "0");
    const currency = (fields[cols.ccy] ?? "EUR").trim();
    const grossAmount = toFiniteDecimalString(fields[cols.grossAmount] ?? "0");
    const fee = toFiniteDecimalString(fields[cols.fee] ?? "0");
    const netAmount = toFiniteDecimalString(fields[cols.netAmount] ?? "0");
    const taxAmount = toFiniteDecimalString(fields[cols.taxAmount] ?? "0");

    const tradeDate = dateRaw ? convertLightyearDate(dateRaw) : "";
    const tradeTime = dateRaw ? timeOfDay(dateRaw) : undefined;

    // A buy or sale row, or a row of a type no branch below handles (a
    // transfer in, a split) that names a ticker or an ISIN, is kept as a trade
    // that books nothing when it cannot be read: no date, no ticker, an
    // unknown type. Dropping it would hide a purchase or a sale (#467). A row
    // of an unknown type that writes a zero quantity, or none (a fee, a tax:
    // a cash row), moves no shares and stays skipped; one that names no
    // security is only listed by its type. A split or another corporate
    // action is kept even with no quantity.
    const tradeType = txType === "buy" || txType === "sell";
    const otherType = !tradeType && !SKIP_TYPES.has(txType) && !DIVIDEND_TYPES.has(txType) &&
      !INCOME_TYPES.has(txType) && txType !== "conversion";
    const namesSecurity = ticker !== "" || isin !== "";
    const movesNoShares = !quantityUnreadable(fields[cols.quantity]) && new Decimal(quantityStr).isZero();
    // A split or another corporate action of a security moves its shares: kept
    // as a row that books nothing (evidence of a holding, #453) and named as
    // not applied, not as an unreadable row.
    if (otherType && namesSecurity && !movesNoShares && isCorporateActionType(txType)) {
      trades.push(corporateActionTrade({
        tradeID: `lightyear-action-${reference || `${tradeDate}-${ticker || isin}-${i}`}`,
        symbol: ticker, isin, assetCategory: "STK", currency, tradeDate, tradeTime, exchange: "LIGHTYEAR",
      }, (fields[cols.type] ?? "").trim(), fields[cols.quantity] ?? ""));
      continue;
    }
    const quantityEmpty = (fields[cols.quantity] ?? "").trim() === "";
    if (tradeType || (otherType && namesSecurity && !movesNoShares && !quantityEmpty)) {
      // A buy or sale with no CCY (an empty cell, or a row cut short) is not
      // read as EUR: its amounts would be booked in the wrong currency (#467).
      const cell = !dateRaw ? unreadableCell(headers[cols.date] ?? "Date", dateRaw)
        : otherType ? unreadableCell(headers[cols.type] ?? "Type", fields[cols.type] ?? "")
        : !ticker ? unreadableCell(headers[cols.ticker] ?? "Ticker", ticker)
        : !(fields[cols.ccy] ?? "").trim() ? unreadableCell(headers[cols.ccy] ?? "CCY", fields[cols.ccy])
        : undefined;
      if (cell !== undefined) {
        trades.push(unreadableTrade({
          tradeID: `lightyear-row-${reference || `${tradeDate}-${ticker || isin}-${i}`}`,
          symbol: ticker, isin, assetCategory: "STK", currency, tradeDate, tradeTime,
          ...(tradeType ? { buySell: txType === "sell" ? "SELL" as const : "BUY" as const } : {}), exchange: "LIGHTYEAR",
        }, cell));
        continue;
      }
    }
    // A Dividend, Distribution, Interest or Reward row that names a security
    // and writes a share count gave shares too (a share reward, a dividend
    // paid in shares). Booked as income only, the shares had no lot: a loss
    // sale before them was not blocked, and their later sale had no cost.
    // The income stays booked as it is. The shares are a purchase of that
    // day at the value taxed as income (`value`, in CCY), named in
    // lightyear.income_shares_booked so the user checks them. A share count
    // or a value that cannot be read, a negative count, or no date, ticker
    // or CCY keeps the row as one that books nothing, named by its cell; a
    // zero value moves shares for no money, a corporate action not applied,
    // as for a Buy. A written zero count, or none, moves no shares (#467).
    const incomeShares = (value: Decimal | undefined, valueCell: string): void => {
      if (!namesSecurity || quantityEmpty || movesNoShares) return;
      const row = {
        tradeID: `lightyear-${txType}-shares-${reference || `${tradeDate}-${ticker || isin}-${i}`}`,
        symbol: ticker, isin, assetCategory: "STK" as const, currency, tradeDate, tradeTime, buySell: "BUY" as const, exchange: "LIGHTYEAR",
      };
      const qtyDec = new Decimal(quantityStr);
      const cell = !isReadableDay(tradeDate) ? unreadableCell(headers[cols.date] ?? "Date", dateRaw)
        : !ticker ? unreadableCell(headers[cols.ticker] ?? "Ticker", ticker)
        : !(fields[cols.ccy] ?? "").trim() ? unreadableCell(headers[cols.ccy] ?? "CCY", fields[cols.ccy])
        : quantityUnreadable(fields[cols.quantity]) || qtyDec.isNegative() ? unreadableCell(headers[cols.quantity] ?? "Quantity", fields[cols.quantity])
        : value === undefined ? valueCell
        : undefined;
      if (cell !== undefined) {
        trades.push(unreadableTrade(row, cell));
        return;
      }
      const typeText = (fields[cols.type] ?? "").trim();
      if (value!.isZero()) {
        trades.push(corporateActionTrade(row, typeText, fields[cols.quantity] ?? ""));
        return;
      }
      trades.push({
        ...row,
        accountId: "",
        description: `${typeText} ${ticker}`,
        settlementDate: tradeDate,
        quantity: qtyDec.toString(),
        tradePrice: value!.div(qtyDec).toString(),
        tradeMoney: value!.neg().toString(),
        proceeds: "0",
        cost: value!.neg().toString(),
        fifoPnlRealized: "0",
        fxRateToBase: "1",
        openCloseIndicator: "O",
        commissionCurrency: currency,
        commission: "0",
        taxes: "0",
        multiplier: "1",
      });
      incomeShareRows.push(`${isin ? `${ticker} (${isin})` : ticker} ${tradeDate} [${typeText}: ${(fields[cols.quantity] ?? "").trim()}]`);
    };

    // Any other row with no readable date goes on with that date: a dividend
    // or income row is taken out and named by dropUndatedCash, a conversion is
    // kept and named by markUndatedTrades (#467).

    // Skip non-taxable transactions
    if (SKIP_TYPES.has(txType)) continue;

    // Dividends and distributions → cash transactions
    if (DIVIDEND_TYPES.has(txType)) {
      // With no ticker the dividend goes by its ISIN; with neither it is
      // named, never dropped with no word (#467).
      const security = ticker || isin;
      // A Gross Amount that cannot be read is no zero: the dividend and its
      // withholding are not booked, and the row is named (#467).
      if (quantityUnreadable(fields[cols.grossAmount])) {
        const tax = new Decimal(taxAmount).isZero() ? "" : `${headers[cols.taxAmount] ?? "Tax Amt."} ${taxAmount}`;
        const grossCell = unreadableCell(headers[cols.grossAmount] ?? "Gross Amount", fields[cols.grossAmount]);
        unreadableIncome.push(cashIncomeRowText((fields[cols.type] ?? "").trim(), security || "—", currency, tradeDate, [grossCell], tax));
        incomeShares(undefined, grossCell);
        continue;
      }
      if (!security) {
        const tax = new Decimal(taxAmount).isZero() ? "" : ` (${headers[cols.taxAmount] ?? "Tax Amt."} ${taxAmount})`;
        if (!new Decimal(grossAmount).isZero()) unidentifiedCash.push(`${(fields[cols.type] ?? "").trim()} ${grossAmount} ${currency}${tax} ${tradeDate || "—"}`);
        continue;
      }

      const grossDec = new Decimal(grossAmount).abs();
      incomeShares(grossDec, "");
      // Gross dividend. A written zero Gross is no dividend: the row only
      // carries a tax (a late withholding, a refund). A 0 dividend took its
      // own tax as its pair, and that tax then counted against the treaty
      // cap of the country's other dividends, with no dividend of its
      // security in reach. Its tax alone is booked below, as IBKR writes it,
      // so the report joins it to a dividend of its ISIN within 7 days or
      // leaves it out (#467).
      if (!grossDec.isZero()) cashTransactions.push({
        transactionID: `lightyear-${txType}-${reference || `${tradeDate}-${security}-${i}`}`,
        accountId: "",
        symbol: security,
        description: `${txType === "distribution" ? "Distribution" : "Dividend"} - ${security}`,
        isin,
        currency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: grossDec.toString(),
        fxRateToBase: "1",
        type: "Dividends",
      });

      // Withholding tax (if present). Lightyear writes it positive, with
      // Net = Gross − Fee − Tax. A negative Tax Amt. gives withholding back (a
      // refund): it lowers the withholding, never raises it, or the
      // double-taxation deduction grows (#467). It is withholding only when
      // a readable Net shows the money went out (Net ≤ Gross − Fee: the tax
      // written with its sign). A Fee cell that is not blank but cannot be
      // read is no zero fee: the test cannot be made, so the row is a refund,
      // as with no readable Net (#467).
      const taxDec = new Decimal(taxAmount);
      const feeUnreadable = (fields[cols.fee] ?? "").trim() !== "" && quantityUnreadable(fields[cols.fee]);
      const withheld = !taxDec.isNegative() || (!quantityUnreadable(fields[cols.netAmount]) && !feeUnreadable &&
        new Decimal(netAmount).lessThanOrEqualTo(new Decimal(grossAmount).minus(new Decimal(fee).abs())));
      if (!taxDec.isZero()) {
        cashTransactions.push({
          transactionID: `lightyear-tax-${reference || `${tradeDate}-${security}-${i}`}`,
          accountId: "",
          symbol: security,
          description: `Withholding tax - ${security}`,
          isin,
          currency,
          dateTime: tradeDate,
          settleDate: tradeDate,
          amount: withheld ? taxDec.abs().neg().toString() : taxDec.abs().toString(),
          fxRateToBase: "1",
          type: "Withholding Tax",
        });
      }
      continue;

    }

    // Interest and Reward → cash transactions (income)
    if (INCOME_TYPES.has(txType)) {
      // Net Amt., else Gross Amount. With neither readable the row is not
      // booked as 0 or dropped with no word: it is named (#467).
      if (quantityUnreadable(fields[cols.netAmount]) && quantityUnreadable(fields[cols.grossAmount])) {
        const cells = [
          unreadableCell(headers[cols.netAmount] ?? "Net Amt.", fields[cols.netAmount]),
          unreadableCell(headers[cols.grossAmount] ?? "Gross Amount", fields[cols.grossAmount]),
        ];
        unreadableIncome.push(cashIncomeRowText((fields[cols.type] ?? "").trim(), ticker, currency, tradeDate, cells));
        incomeShares(undefined, cells.join(", "));
        continue;
      }
      const amountRaw = new Decimal(netAmount);
      const amountDec = amountRaw.isZero() ? new Decimal(grossAmount) : amountRaw;
      incomeShares(amountDec.abs(), "");

      if (amountDec.isZero()) continue;
      cashTransactions.push({
        transactionID: `lightyear-${txType}-${reference || `${tradeDate}-${i}`}`,
        accountId: "",
        symbol: ticker || txType.toUpperCase(),
        description: `${txType.charAt(0).toUpperCase() + txType.slice(1)}${ticker ? ` - ${ticker}` : ""}`,
        isin,
        currency,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: amountDec.toString(),
        fxRateToBase: "1",
        type: "Broker Interest Received",
      });
      continue;
    }

    // FX conversions → CASH trades for the FX FIFO engine (Art. 33.1 LIRPF)
    // Lightyear emits a pair: one leg per currency (e.g. USD +64.50, EUR -59.24).
    // Positive gross = acquiring that currency (BUY), negative = spending it (SELL).
    if (txType === "conversion") {
      // A leg with no CCY became a trade in currency "" (symbol ".EUR") and
      // stopped the report ("No ECB rate available for non-fiat currency .");
      // a non-EUR leg whose Net Amt. and Gross Amount both cannot be read was
      // dropped with no word, and its FX gain or cost with it. Both are named
      // (parser.trade_row_unreadable), not booked (#467). A written zero
      // amount stays skipped; an EUR leg is never booked.
      const leg = { tradeID: `lightyear-fx-${reference || `${tradeDate}-${currency}-${i}`}`, isin: "", assetCategory: "CASH" as const,
        tradeDate, tradeTime, exchange: "LIGHTYEAR" };
      if (!(fields[cols.ccy] ?? "").trim()) {
        unreadableConversions.push(unreadableTrade({ ...leg, symbol: ticker, currency: "" },
          unreadableCell(headers[cols.ccy] ?? "CCY", fields[cols.ccy])));
        continue;
      }
      if (currency === "EUR") continue;
      if (quantityUnreadable(fields[cols.netAmount]) && quantityUnreadable(fields[cols.grossAmount])) {
        unreadableConversions.push(unreadableTrade({ ...leg, symbol: `${currency}.EUR`, currency }, [
          unreadableCell(headers[cols.netAmount] ?? "Net Amt.", fields[cols.netAmount]),
          unreadableCell(headers[cols.grossAmount] ?? "Gross Amount", fields[cols.grossAmount]),
        ].join(", ")));
        continue;
      }
      const netRaw = new Decimal(netAmount);
      const netDec = netRaw.isZero() ? new Decimal(grossAmount) : netRaw;

      if (netDec.isZero()) continue;

      const absDec = netDec.abs();
      const isFxBuy = netDec.greaterThan(0);

      // The commission and the real EUR principal of a known pair (pre-scan
      // above): the fee may be on the EUR row, which is not booked. Any other
      // leg keeps its own fee, and the engine values it at the ECB rate.
      const pair = conversionPairs.get(dateRaw);
      const commissionVal = pair?.fee ? pair.fee.fee : new Decimal(fee).abs().toString();
      const commCurrency = pair?.fee ? pair.fee.currency : currency;
      const realEurAmount = pair?.realEurAmount;

      trades.push({
        tradeID: `lightyear-fx-${reference || `${tradeDate}-${currency}-${i}`}`,
        accountId: "",
        symbol: `${currency}.EUR`,
        description: `FX Conversion ${isFxBuy ? "EUR→" : "→EUR "}${currency}`,
        isin: "",
        assetCategory: "CASH",
        currency,
        tradeDate,
        tradeTime,
        settlementDate: tradeDate,
        quantity: isFxBuy ? absDec.toString() : absDec.neg().toString(),
        tradePrice: "1",
        tradeMoney: isFxBuy ? absDec.neg().toString() : absDec.toString(),
        proceeds: isFxBuy ? "0" : absDec.toString(),
        cost: isFxBuy ? absDec.neg().toString() : "0",
        fifoPnlRealized: "0",
        fxRateToBase: "1",
        buySell: isFxBuy ? "BUY" : "SELL",
        openCloseIndicator: isFxBuy ? "O" : "C",
        exchange: "LIGHTYEAR",
        commissionCurrency: commCurrency,
        commission: `-${commissionVal}`,
        ...(realEurAmount ? { realEurAmount } : {}),
        taxes: "0",
        multiplier: "1",
      });
      continue;
    }

    // Buy / Sell trades
    const isSell = txType === "sell";
    const isBuy = txType === "buy";
    if (!isSell && !isBuy) {
      // A row with an empty Type that carries anything (a date, an amount, a
      // security) is listed as `Type: ""`, never dropped with no word (#467).
      // An all-blank padding row stays skipped.
      const rawType = (fields[cols.type] ?? "").trim() ||
        (fields.some((f) => f.trim() !== "") ? unreadableCell(headers[cols.type] ?? "Type", "") : "");
      if (rawType) unknownTypes.set(rawType, (unknownTypes.get(rawType) ?? 0) + 1);
      continue;
    }

    const qtyDec = new Decimal(quantityStr).abs();
    if (qtyDec.isZero()) {
      // An empty or unreadable quantity is no "0": keep the row as a trade of
      // unknown quantity for the anti-churning evidence (#453).
      if (quantityUnreadable(fields[cols.quantity])) {
        trades.push(quantityUnknownTrade({
          tradeID: `lightyear-${txType}-${reference || `${tradeDate}-${ticker}-${i}`}`,
          symbol: ticker, description: `${isSell ? "Sell" : "Buy"} ${ticker}`, isin, assetCategory: "STK", currency, tradeDate, tradeTime,
          buySell: isSell ? "SELL" : "BUY", exchange: "LIGHTYEAR",
        }));
      }
      continue;
    }
    // Lightyear writes a buy or a sale with a positive Quantity. A Buy with a
    // negative Quantity, or a Sell whose Quantity and Gross or Net are
    // negative, says the shares moved the other way (a reversal). Read with
    // its signs dropped it was one more purchase or sale: a gain shrank or a
    // loss doubled with no word. The row books nothing and is named by its
    // Quantity cell (parser.trade_row_unreadable). A Sell with a negative
    // Quantity and a positive Gross and Net stays a sale (#467).
    if (new Decimal(quantityStr).isNegative() &&
      (isBuy || new Decimal(grossAmount).isNegative() || new Decimal(netAmount).isNegative())) {
      trades.push(unreadableTrade({
        tradeID: `lightyear-row-${reference || `${tradeDate}-${ticker}-${i}`}`,
        symbol: ticker, isin, assetCategory: "STK", currency, tradeDate, tradeTime,
        buySell: isSell ? "SELL" : "BUY", exchange: "LIGHTYEAR",
      }, unreadableCell(headers[cols.quantity] ?? "Quantity", fields[cols.quantity])));
      continue;
    }

    const feeDec = new Decimal(fee).abs();
    const grossDec = new Decimal(grossAmount).abs();
    const netDec = new Decimal(netAmount).abs();
    // FIFO values a share trade at quantity × tradePrice, never from Net Amt.
    // A Price/share it cannot read crashed the report ("n/a"), and an empty,
    // missing or written-zero one sold the shares at 0 €: a gain became a loss
    // with no word (#467). Lightyear writes Gross Amount = Quantity ×
    // Price/share in CCY, so with no price the price is |Gross| ÷ Quantity,
    // the file's own numbers. A readable price keeps the file's text. With no
    // Gross either, a written zero price moves shares for no money: a
    // corporate action not applied, as in Flatex, DEGIRO and Freedom24. A
    // price that cannot be read makes the row one that books nothing, named
    // by its Price/share cell (parser.trade_row_unreadable).
    const priceCell = fields[cols.pricePerShare];
    const priceReadable = !quantityUnreadable(priceCell) && !toFiniteDecimal(priceCell!).isNegative();
    if (!priceReadable || toFiniteDecimal(priceCell!).isZero()) {
      const row = {
        symbol: ticker, isin, assetCategory: "STK" as const, currency, tradeDate, tradeTime,
        buySell: isSell ? "SELL" as const : "BUY" as const, exchange: "LIGHTYEAR",
      };
      if (grossDec.isZero() && priceReadable) {
        trades.push(corporateActionTrade({ ...row, tradeID: `lightyear-action-${reference || `${tradeDate}-${ticker}-${i}`}` },
          `${headers[cols.pricePerShare] ?? "Price/share"} ${priceCell!.trim()}`, fields[cols.quantity] ?? ""));
        continue;
      }
      if (grossDec.isZero()) {
        trades.push(unreadableTrade({ ...row, tradeID: `lightyear-row-${reference || `${tradeDate}-${ticker}-${i}`}` },
          unreadableCell(headers[cols.pricePerShare] ?? "Price/share", priceCell)));
        continue;
      }
    }
    const price = priceReadable && !toFiniteDecimal(priceCell!).isZero() ? parseNumber(priceCell!) : grossDec.div(qtyDec).toString();

    trades.push({
      tradeID: `lightyear-${txType}-${reference || `${tradeDate}-${ticker}-${i}`}`,
      accountId: "",
      symbol: ticker,
      description: `${isSell ? "Sell" : "Buy"} ${ticker}`,
      isin,
      assetCategory: "STK",
      currency,
      tradeDate,
      tradeTime,
      settlementDate: tradeDate,
      quantity: isSell ? qtyDec.neg().toString() : qtyDec.toString(),
      tradePrice: price,
      tradeMoney: isSell ? netDec.toString() : netDec.neg().toString(),
      proceeds: isSell ? netDec.toString() : "0",
      cost: isSell ? "0" : netDec.neg().toString(),
      fifoPnlRealized: "0",
      fxRateToBase: "1",
      buySell: isSell ? "SELL" : "BUY",
      openCloseIndicator: isSell ? "C" : "O",
      exchange: "LIGHTYEAR",
      commissionCurrency: currency,
      commission: feeDec.isZero() ? "0" : feeDec.neg().toString(),
      taxes: "0",
      multiplier: "1",
    });
  }

  const parserMessages: TaxMessage[] = [];
  if (unknownTypes.size > 0) {
    const unknownCount = [...unknownTypes.values()].reduce((a, b) => a + b, 0);
    const types = [...unknownTypes].map(([type, n]) => `${type} (${n})`).join(", ");
    parserMessages.push({
      id: "lightyear.unknown_types",
      severity: "warning",
      message: `Se ha(n) omitido ${unknownCount} fila(s) del CSV de Lightyear con un tipo de movimiento no reconocido: ${types}.`,
      hint: "Estos movimientos no se han incluido en el cálculo. Si son desdoblamientos (splits), traspasos de acciones u otras operaciones societarias, revísalos a mano: pueden cambiar el número de acciones o el coste de adquisición de ventas posteriores.",
      context: { count: String(unknownCount), types },
    });
  }
  if (incomeShareRows.length > 0) {
    const count = String(incomeShareRows.length);
    const rows = incomeShareRows.join("; ");
    parserMessages.push({
      id: "lightyear.income_shares_booked",
      severity: "warning",
      message: `Lightyear: ${count} fila(s) de ingreso traen acciones. DeclaRenta las cuenta como compradas ese día: ${rows}.`,
      hint: "Son filas de dividendo, distribución, interés o recompensa que traen un número de acciones. DeclaRenta suma su importe como ingreso, igual que en las demás filas. Además, cuenta esas acciones como compradas ese día por ese mismo importe. Así su venta posterior tiene coste. Si vendiste ese valor con pérdidas 2 meses antes o después, esa compra puede bloquear la pérdida (regla de los 2 meses). Compruébalo con el extracto de Lightyear. Si la fila no te dio acciones nuevas, esa compra no existe. Entonces el coste de tus ventas y las pérdidas bloqueadas de ese valor pueden no ser correctos.",
      context: { count, rows },
    });
  }
  markUndatedTrades(trades, headers[cols.date] ?? "Date");
  parserMessages.push(
    ...tradeQuantityUnknownMessages("Lightyear", [...trades, ...unreadableConversions]),
    ...dropUndatedCash("Lightyear", cashTransactions, headers[cols.date] ?? "Date"),
    ...cashRowsUnidentifiedMessages("Lightyear", unidentifiedCash),
    ...cashIncomeAmountUnreadableMessages("Lightyear", unreadableIncome),
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

export const lightyearParser: BrokerParser = {
  name: "Lightyear",
  formats: ["CSV"],

  detect(input: string): boolean {
    const lines = stripBom(input).split(/\r?\n/);
    return lines.slice(0, 10).some((l) => isLightyearCsv(l));
  },

  parse(input: string): Statement {
    const cleaned = stripBom(input);
    const allLines = cleaned.split(/\r?\n/);
    const headerIdx = allLines.findIndex((l) => isLightyearCsv(l));
    if (headerIdx === -1) {
      const hasContent = allLines.some((l) => l.trim());
      throw new Error(hasContent ? "Lightyear CSV: formato no reconocido" : "Lightyear CSV: fichero vacío o sin datos");
    }
    const lines = allLines.slice(headerIdx).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error("Lightyear CSV: fichero vacío o sin datos");
    }

    return parseLightyearCsv(lines);
  },
};
