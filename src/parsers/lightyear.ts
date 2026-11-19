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

  // Pre-scan: collect FX conversion fees AND the real EUR principal by timestamp.
  // Lightyear emits conversion pairs (one leg per currency). The fee can appear
  // on either leg (often on the EUR leg, which we skip). Group by timestamp
  // and extract the fee so it can be applied to the non-EUR trade.
  const conversionFees = new Map<string, { fee: string; currency: string }>();
  // The EUR leg's |Net Amt.| is the real spread-laden EUR principal Lightyear
  // actually moved (fee EXCLUDED — the engine applies our -Fee commission on
  // top). Stored per timestamp so the non-EUR trade can be valued at the real
  // applied rate instead of ECB (Art. 35.1 LIRPF; issue #253). FCY↔FCY
  // conversions have no EUR leg → left unset → engine falls back to ECB.
  const conversionEurAmounts = new Map<string, string>();
  // Timestamps with MORE THAN ONE EUR conversion leg (two different conversions
  // in the same second). The pairing key is only second-resolution, so we cannot
  // tell which non-EUR leg owns which EUR principal — attaching the wrong one
  // would mis-value an entire conversion into casillas 1633/1637. Such timestamps
  // are excluded so the engine uses the ECB rate (a correct mid-rate beats a
  // wrong real principal).
  const ambiguousEurTimestamps = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const fields = parseCsvLine(line, ",");
    const txType = (fields[cols.type] ?? "").trim().toLowerCase();
    if (txType !== "conversion") continue;
    const dateRaw = (fields[cols.date] ?? "").trim();
    const ccy = (fields[cols.ccy] ?? "EUR").trim();

    // Harvest the EUR leg's real Net Amt. (the fee-excluded principal). No fee
    // gate — a fee-free conversion still carries a real EUR principal.
    if (ccy === "EUR") {
      if (conversionEurAmounts.has(dateRaw)) {
        // A second EUR leg at this timestamp → ambiguous pairing; drop to ECB.
        ambiguousEurTimestamps.add(dateRaw);
      } else {
        // Use the EUR leg's Net Amt. ONLY — it is the real principal with the fee
        // EXCLUDED (the engine applies our -Fee commission on top). Gross is
        // fee-INCLUSIVE, so falling back to it would double-count the fee; if Net
        // is empty we omit the field and let the engine use ECB instead.
        const eurNet = toFiniteDecimal(fields[cols.netAmount] ?? "0");
        if (!eurNet.isZero()) conversionEurAmounts.set(dateRaw, eurNet.abs().toString());
      }
    }

    const feeDec = toFiniteDecimal(fields[cols.fee] ?? "0");
    if (feeDec.isZero()) continue;
    const existing = conversionFees.get(dateRaw);
    if (!existing || feeDec.abs().greaterThan(new Decimal(existing.fee).abs())) {
      conversionFees.set(dateRaw, { fee: feeDec.abs().toString(), currency: ccy });
    }
  }

  // Rows of a type no branch handles (e.g. a split or transfer), per raw type.
  const unknownTypes = new Map<string, number>();
  // Dividend rows with no ticker and no ISIN (#467).
  const unidentifiedCash: string[] = [];
  // Dividend and income rows whose amount cannot be read (#467).
  const unreadableIncome: string[] = [];

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
    // The display price is stored verbatim as the lossless parseNumber string
    // (trailing zeros preserved; never summed).
    const quantityStr = toFiniteDecimalString(fields[cols.quantity] ?? "0");
    const currency = (fields[cols.ccy] ?? "EUR").trim();
    const pricePerShare = parseNumber(fields[cols.pricePerShare] ?? "0");
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
      const cell = !dateRaw ? unreadableCell(headers[cols.date] ?? "Date", dateRaw)
        : otherType ? unreadableCell(headers[cols.type] ?? "Type", fields[cols.type] ?? "")
        : !ticker ? unreadableCell(headers[cols.ticker] ?? "Ticker", ticker)
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
        unreadableIncome.push(cashIncomeRowText((fields[cols.type] ?? "").trim(), security || "—", currency, tradeDate,
          [unreadableCell(headers[cols.grossAmount] ?? "Gross Amount", fields[cols.grossAmount])], tax));
        continue;
      }
      if (!security) {
        const tax = new Decimal(taxAmount).isZero() ? "" : ` (${headers[cols.taxAmount] ?? "Tax Amt."} ${taxAmount})`;
        if (!new Decimal(grossAmount).isZero()) unidentifiedCash.push(`${(fields[cols.type] ?? "").trim()} ${grossAmount} ${currency}${tax} ${tradeDate || "—"}`);
        continue;
      }

      const grossDec = new Decimal(grossAmount).abs();
      // Gross dividend
      cashTransactions.push({
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

      // Withholding tax (if present)
      const taxDec = new Decimal(taxAmount);
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
          amount: taxDec.neg().abs().neg().toString(),
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
        unreadableIncome.push(cashIncomeRowText((fields[cols.type] ?? "").trim(), ticker, currency, tradeDate, [
          unreadableCell(headers[cols.netAmount] ?? "Net Amt.", fields[cols.netAmount]),
          unreadableCell(headers[cols.grossAmount] ?? "Gross Amount", fields[cols.grossAmount]),
        ]));
        continue;
      }
      const amountRaw = new Decimal(netAmount);
      const amountDec = amountRaw.isZero() ? new Decimal(grossAmount) : amountRaw;

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
      const netRaw = new Decimal(netAmount);
      const netDec = netRaw.isZero() ? new Decimal(grossAmount) : netRaw;

      if (netDec.isZero() || currency === "EUR") continue;

      const absDec = netDec.abs();
      const isFxBuy = netDec.greaterThan(0);

      // Look up commission from paired leg (fee may be on the EUR row we skip)
      const pairedFee = conversionFees.get(dateRaw);
      const commissionVal = pairedFee ? pairedFee.fee : new Decimal(fee).abs().toString();
      const commCurrency = pairedFee ? pairedFee.currency : currency;

      // Real EUR principal from the paired EUR leg (|Net Amt.|, spread embedded,
      // fee excluded). Absent for FCY↔FCY conversions, or dropped when >1 EUR leg
      // shares this timestamp (ambiguous pairing) → omit so the engine uses ECB.
      const realEurAmount = ambiguousEurTimestamps.has(dateRaw)
        ? undefined
        : conversionEurAmounts.get(dateRaw);

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
      const rawType = (fields[cols.type] ?? "").trim();
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

    const feeDec = new Decimal(fee).abs();
    const grossDec = new Decimal(grossAmount).abs();
    const netDec = new Decimal(netAmount).abs();
    const price = pricePerShare || (qtyDec.isZero() ? "0" : grossDec.div(qtyDec).toString());

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
  markUndatedTrades(trades, headers[cols.date] ?? "Date");
  parserMessages.push(
    ...tradeQuantityUnknownMessages("Lightyear", trades),
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
