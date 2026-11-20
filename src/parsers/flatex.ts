/**
 * Flatex CSV parser.
 *
 * Flatex is a German broker (parent company of Degiro) but exports a
 * different CSV format. It provides two separate exports:
 * - Depotumsätze (securities): trades — ISIN, name, quantity, price
 * - Kontoumsätze (account): cash movements — dividends, distributions,
 *   the cash leg of trades, and transfers
 *
 * Files are semicolon-delimited, German-language, latin1/ISO-8859-1 encoded
 * (umlauts may arrive mangled, so detection relies on ASCII keywords only),
 * use EU number format (comma decimal) and DD.MM.YYYY dates.
 *
 * This parser reads the Depotumsätze export for trades and the Kontoumsätze
 * export for dividends/distributions. Each file is uploaded separately.
 */

import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, CashTransaction, OrderLeg } from "../types/ibkr.js";
import type { TaxMessage } from "../types/tax.js";
import Decimal from "decimal.js";
import {
  detectDelimiter,
  parseCsvLine,
  parseNumber,
  toFiniteDecimal,
  convertDateDMYDot,
  findColumn,
  stripBom,
  quantityUnknownTrade,
  quantityUnreadable,
  tradeQuantityUnknownMessages,
  unreadableTrade,
  unreadableCell,
  corporateActionTrade,
  markUndatedTrades,
  isReadableDay,
  dropUndatedCash,
  cashIncomeRowText,
  cashIncomeAmountUnreadableMessages,
} from "./csv-utils.js";
import { daysBetween } from "../engine/dates.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** ISIN pattern: 2 letters + 9 alphanumerics + 1 check digit */
const ISIN_RE = /\b([A-Z]{2}[A-Z0-9]{9}\d)\b/;

/** Extract an ISIN embedded in a free-text description (Kontoumsätze). */
function extractIsin(text: string): string {
  const m = text.match(ISIN_RE);
  return m ? m[1]! : "";
}

/**
 * Trade cash legs in the Kontoumsätze file read e.g.
 *   "Ausführung ORDER Kauf US94106L1098 329432092"
 * The trailing number is the broker order id, which ALSO appears in the
 * matching Depotumsätze row. We use it to join the two files and recover the
 * per-trade commission (gross vs. net cash discrepancy).
 */
const ORDER_RE = /\bausf.hrung\b.*\border\b/i;
// The order number is a word of its own: with no word boundary, the last
// digits of an ISIN (US0378331005) were read as one when the row had no
// order number, and two orders pooled their legs and fees (#467).
const ORDER_KEY_RE = /\b(\d{6,})\s*$/;

/** `Trade.notes` prefix that carries a Depot row's order number to the merge (`reconcileOrderLegs`). */
const FLATEX_ORDER_NOTE = "flatex-order:";

/** Extract the trailing broker order id from an "Ausführung ORDER ..." line. */
function extractOrderKey(text: string): string {
  const m = text.match(ORDER_KEY_RE);
  return m ? m[1]! : "";
}

/** Buy/sell keywords in the Buchungsinformationen column. */
const BUY_RE = /\bkauf\b/i;
const SELL_RE = /\bverkauf\b/i;
/** A reversal ("Storno Ausführung ORDER Verkauf ..."): no purchase or sale. */
const STORNO_RE = /\bstorno\b/i;

/** Dividend cash patterns (Kontoumsätze). */
const DIVIDEND_PATTERNS = [/dividendenzahlung/i, /dividende/i];

/** ETF/fund income distribution patterns — also taxed as dividends in Spain. */
const DISTRIBUTION_PATTERNS = [/ertr.gnisaussch.ttung/i, /aussch.ttung/i];

/** Withholding tax patterns (Quellensteuer). */
const WITHHOLDING_PATTERNS = [/quellensteuer/i, /kapitalertragsteuer/i];

/**
 * Interest and coupon patterns (Kontoumsätze): "Habenzinsen" on the cash
 * balance, "Zinsen", a bond's "Zinszahlung". A positive row is interest
 * received (casilla 0027); it was dropped with no word (#467). A negative one
 * (Sollzinsen on a debit balance) is left out, which can only raise the tax.
 * "Stückzinsen" (accrued interest paid or received with a bond trade) has no
 * word boundary before "zins" and is not matched.
 */
const INTEREST_PATTERNS = [/habenzins/i, /\bzins/i];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

// ---------------------------------------------------------------------------
// Depotumsätze (securities / trades) parser
// ---------------------------------------------------------------------------

function isFlatexDepot(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return (
    lower.includes("isin") &&
    lower.includes("bezeichnung") &&
    lower.includes("nominal") &&
    lower.includes("buchtag")
  );
}

function parseDepotumsaetze(lines: string[], delimiter: string): Statement {
  const headers = parseCsvLine(lines[0]!, delimiter);

  const isinCol = findColumn(headers, ["ISIN"]);
  const dateCol = findColumn(headers, ["Buchtag"]);
  const nameCol = findColumn(headers, ["Bezeichnung"]);
  const qtyCol = findColumn(headers, ["Nominal"]);
  const infoCol = findColumn(headers, ["Buchungsinformationen"]);
  const priceCol = findColumn(headers, ["Kurs"]);
  const txnCol = findColumn(headers, ["TA-Nr.", "TA-Nr"]);
  // Currency sits in the empty header immediately after Kurs.
  const currencyCol = priceCol + 1;
  const currencyName = (headers[currencyCol] ?? "").trim() || `${(headers[priceCol] ?? "Kurs").trim()}, divisa`;

  if (isinCol < 0 || dateCol < 0 || qtyCol < 0 || priceCol < 0) {
    throw new Error(
      "Flatex Depotumsätze CSV: faltan columnas obligatorias (ISIN, Buchtag, Nominal, Kurs)",
    );
  }

  const trades: Trade[] = [];
  // Track Lagerstellenwechsel (custody transfer) net quantity per ISIN. A
  // balanced in/out pair nets to zero and is harmless; an unmatched leg means
  // a position entered or left the depot without a cost basis — same phantom-lot
  // risk as missing prior-year lots — so we warn the user.
  const custodyNet = new Map<string, Decimal>();
  // The same legs per ISIN and day, each kept as a row that books nothing.
  const custodyLegs = new Map<string, { net: Decimal; unknown: boolean; rows: Trade[] }>();
  // Readable Stornos of an order, matched below with the fill they cancel.
  const stornos: { row: Trade; note: string; side: Trade["buySell"]; qty: Decimal; price: Decimal }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || /^;+$/.test(line)) continue; // skip empty / separator-only rows

    const fields = parseCsvLine(line, delimiter);

    const isin = (fields[isinCol] ?? "").trim();
    const info = infoCol >= 0 ? (fields[infoCol] ?? "").trim() : "";
    const price = parseNumber(fields[priceCol] ?? "0");
    const name = nameCol >= 0 ? (fields[nameCol] ?? "").trim() : "";
    // An empty or missing currency cell is no "EUR" (checked before booking).
    const currency = (fields[currencyCol] ?? "").trim();
    const tradeDate = convertDateDMYDot(fields[dateCol] ?? "");
    const orderId = txnCol >= 0 ? (fields[txnCol] ?? "").trim() : "";
    const qtyNum = toFiniteDecimal(fields[qtyCol] ?? "0");
    // An empty or unreadable Nominal is no "0" (see below).
    const qtyUnknown = quantityUnreadable(fields[qtyCol]);
    // The side comes from the booking text, Kauf or Verkauf (#468); only a
    // file with no Buchungsinformationen column leaves the Nominal's sign. A
    // Storno reverses a Kauf or Verkauf and is neither: its text has the word
    // and its Nominal the opposite sign, so a reversed sale was booked as a
    // second sale and its loss deducted twice. It cancels the fill it
    // reverses (after the loop), or is kept unreadable below.
    const storno = STORNO_RE.test(info);
    const buyText = infoCol >= 0 ? !storno && BUY_RE.test(info) : !qtyUnknown && qtyNum.isPositive();
    const sellText = infoCol >= 0 ? !storno && SELL_RE.test(info) && !buyText : !qtyUnknown && qtyNum.isNegative();
    // Broker order id embedded in the Buchungsinformationen text: used after
    // merge to recover the commission from the matching Kontoumsätze cash leg.
    // A kept row (below) carries it too, so the order of a fill that cannot be
    // read gets no fee from that fill's leg (#467).
    const orderKey = extractOrderKey(info);
    const orderNote = orderKey ? { notes: `${FLATEX_ORDER_NOTE}${orderKey}` } : {};
    // A row that cannot be read is kept as a trade that books nothing and
    // named, never dropped or booked by the sign alone (#467, #468).
    const keepUnreadable = (cell: string): void => {
      trades.push({
        ...unreadableTrade({
          tradeID: orderId, symbol: name, description: name, isin, assetCategory: "STK", currency: currency || "EUR",
          tradeDate, ...(buyText || sellText ? { buySell: sellText ? "SELL" as const : "BUY" as const } : {}), exchange: "",
        }, cell),
        ...orderNote,
      });
    };

    if (!isin) {
      // A Kauf or Verkauf with no ISIN is still a purchase or a sale, and so
      // may be a row of another text that names a security and moves shares
      // (a transfer in or out): kept unreadable. So is one whose Nominal
      // cannot be read but whose Kurs can: dropped, it let the one-purchase
      // exception (#453) be applied with no proof. A row with neither is no
      // trade (a separator, or a cash line with no Nominal and no Kurs).
      const kursReadable = !quantityUnreadable(fields[priceCol]) && !toFiniteDecimal(price).isZero();
      const movesNamedShares = name !== "" && (qtyUnknown ? kursReadable : !qtyNum.isZero());
      if (buyText || sellText || movesNamedShares) keepUnreadable(unreadableCell(headers[isinCol] ?? "ISIN", ""));
      continue;
    }
    if (qtyNum.isZero() && !qtyUnknown) continue;

    // A row the parser does not book that still moves shares of the ISIN (a
    // transfer in, a split, free shares, a conversion) is kept as a row that
    // books nothing and named (#467): dropped, it would hide a holding at the
    // anti-churning window start and let the one-purchase exception (#453) be
    // applied with no proof.
    const keepAction = (): Trade => ({
      ...corporateActionTrade({
        tradeID: orderId, symbol: name, description: name, isin, assetCategory: "STK", currency: currency || "EUR",
        tradeDate, exchange: "",
      }, info || `${headers[priceCol] ?? "Kurs"} ${(fields[priceCol] ?? "").trim()}`, fields[qtyCol] ?? ""),
      ...orderNote,
    });

    // Custody transfers (Lagerstellenwechsel) are no disposal. The legs of
    // one ISIN on one day that net to zero move nothing and are skipped; the
    // others are kept below, once every leg is read.
    if (/lagerstellenwechsel/i.test(info)) {
      custodyNet.set(isin, (custodyNet.get(isin) ?? new Decimal(0)).plus(qtyNum));
      const key = `${isin}|${tradeDate}`;
      const legs = custodyLegs.get(key) ?? { net: new Decimal(0), unknown: false, rows: [] };
      legs.net = legs.net.plus(qtyNum);
      legs.unknown ||= qtyUnknown;
      legs.rows.push(keepAction());
      custodyLegs.set(key, legs);
      continue;
    }

    // A row with a written zero Kurs (a non-tradeable conversion, rights,
    // free shares, a transfer in) has no price to book: kept as a row that
    // books nothing and named, never skipped with no word. A row whose Kurs is
    // empty or unreadable is a buy or a sale of unknown quantity (below).
    const priceDec = toFiniteDecimal(price);
    const priceUnknown = quantityUnreadable(fields[priceCol]);
    if (priceDec.isZero() && !priceUnknown) {
      trades.push(keepAction());
      continue;
    }
    // A negative Kurs is no price: booked, it made negative proceeds or a
    // negative cost with no word (#467). Kept as a row that books nothing.
    if (priceDec.isNegative()) {
      keepUnreadable(unreadableCell(headers[priceCol] ?? "Kurs", fields[priceCol]));
      continue;
    }

    // A row whose text is neither Kauf nor Verkauf (a transfer in or out, a
    // corporate action, a Storno) is no purchase or sale the parser can book:
    // the sign of its Nominal alone booked it as one (#468). A Kauf with a negative
    // Nominal contradicts itself (a Verkauf with a positive one is a sale:
    // the count may be unsigned).
    if (!buyText && !sellText) {
      keepUnreadable(unreadableCell(headers[infoCol] ?? "Buchungsinformationen", info));
      const side = SELL_RE.test(info) ? "SELL" : BUY_RE.test(info) ? "BUY" : undefined;
      if (storno && side && orderKey && !qtyUnknown && !priceUnknown && currency && isReadableDay(tradeDate)) {
        stornos.push({ row: trades[trades.length - 1]!, note: `${FLATEX_ORDER_NOTE}${orderKey}`, side, qty: qtyNum.abs(), price: priceDec });
      }
      continue;
    }
    if (buyText && qtyNum.isNegative()) {
      keepUnreadable(unreadableCell(headers[qtyCol] ?? "Nominal", fields[qtyCol] ?? ""));
      continue;
    }
    const isSell = sellText;

    // A buy or sale whose Nominal or Kurs is empty or unreadable: keep it as a
    // trade of unknown quantity for the anti-churning evidence (#453). With no
    // price FIFO cannot book its shares, so it books none, as with no Nominal.
    if (qtyUnknown || priceUnknown) {
      trades.push({
        ...quantityUnknownTrade({
          tradeID: orderId,
          symbol: name, description: name, isin, assetCategory: "STK", currency: currency || "EUR",
          tradeDate, buySell: isSell ? "SELL" : "BUY", exchange: "",
        }),
        ...orderNote,
      });
      continue;
    }

    // A trade with no currency is not in euros: a pound or dollar trade
    // booked as euros moved the gain with no word. Kept as a row that books
    // nothing and named by that cell (#467).
    if (!currency) {
      keepUnreadable(unreadableCell(currencyName, fields[currencyCol]));
      continue;
    }

    const absQty = qtyNum.abs();
    const tradeMoney = absQty.mul(priceDec).toFixed();

    trades.push({
      tradeID: orderId,
      accountId: "",
      symbol: name,
      description: name,
      isin,
      assetCategory: "STK",
      currency,
      tradeDate,
      settlementDate: tradeDate,
      quantity: isSell ? `-${absQty.toFixed()}` : absQty.toFixed(),
      tradePrice: price,
      tradeMoney,
      proceeds: isSell ? tradeMoney : "0",
      cost: isSell ? "0" : tradeMoney,
      fifoPnlRealized: "0",
      fxRateToBase: "1",
      buySell: isSell ? "SELL" : "BUY",
      openCloseIndicator: isSell ? "C" : "O",
      exchange: "",
      commissionCurrency: currency,
      commission: "0",
      taxes: "0",
      multiplier: "1",
      ...orderNote,
    });
  }

  // Flatex corrects a fill with a Storno of it, and often a new fill of the
  // same order. The Storno cancels the booked fill of its order with the
  // same ISIN, side, currency, |Nominal| and Kurs, on its day or before (the
  // earliest one): both leave the trades and the pair is named. Kept, the
  // fill was a second sale and its loss was deducted twice (#467). A Storno
  // that matches no fill stays a named row that books nothing.
  const cancelled: string[] = [];
  for (const s of stornos) {
    const fill = trades
      .filter((t) => t.notes === s.note && t.quantityUnknown !== true && t.isin === s.row.isin && t.buySell === s.side &&
        t.currency === s.row.currency && new Decimal(t.quantity).abs().eq(s.qty) && new Decimal(t.tradePrice).eq(s.price) &&
        isReadableDay(t.tradeDate) && t.tradeDate <= s.row.tradeDate)
      .reduce<Trade | undefined>((first, t) => (first && first.tradeDate <= t.tradeDate ? first : t), undefined);
    if (!fill) continue;
    trades.splice(trades.indexOf(fill), 1);
    trades.splice(trades.indexOf(s.row), 1);
    cancelled.push(`${s.note.slice(FLATEX_ORDER_NOTE.length)} ${fill.isin} ${fill.tradeDate} [${fill.quantity} × ${fill.tradePrice} ${fill.currency}] Storno ${s.row.tradeDate}`);
  }

  // An unmatched transfer leg moves shares in or out of the depot: kept.
  for (const legs of custodyLegs.values()) {
    if (legs.unknown || !legs.net.isZero()) trades.push(...legs.rows);
  }

  const parserMessages: TaxMessage[] = [];
  if (cancelled.length > 0) {
    const count = String(cancelled.length);
    const rows = cancelled.join("; ");
    parserMessages.push({
      id: "flatex.depot.storno_cancelled",
      severity: "info",
      message: `Flatex: ${count} ejecución(es) anulada(s) con un Storno no se calculan: ${rows}.`,
      hint: "Flatex corrige una ejecución con un Storno que la anula, y a veces con una ejecución nueva de la misma orden. DeclaRenta quita del cálculo cada ejecución anulada y su Storno, y calcula la ejecución nueva si está en el archivo. Cada fila trae el número de orden, el valor y la fecha de la ejecución anulada. Entre corchetes van sus títulos y su precio. Al final va la fecha del Storno.",
      context: { count, rows },
    });
  }
  for (const [isin, net] of custodyNet) {
    if (!net.isZero()) {
      parserMessages.push({
        id: "flatex.lagerstellenwechsel.unmatched",
        severity: "info",
        message: `Traspaso de custodia (Lagerstellenwechsel) sin contrapartida para ${isin}: ${net.toFixed()} títulos.`,
        hint: "Un traspaso sin pareja entró o salió del depósito sin precio de adquisición. Si más tarde vendes estos títulos, revisa que el valor de compra original esté incluido para no declarar una ganancia ficticia.",
        context: { isin, netQuantity: net.toFixed() },
      });
    }
  }
  // An undated trade becomes a new unreadable row in place: it keeps its
  // order number, so its order gets no fee from its leg (#467).
  const orderNotes = trades.map((t) => t.notes);
  markUndatedTrades(trades, "Buchtag");
  trades.forEach((t, i) => {
    const notes = orderNotes[i];
    if (notes !== undefined && t.notes === undefined) trades[i] = { ...t, notes };
  });
  parserMessages.push(...tradeQuantityUnknownMessages("Flatex", trades));

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
    ...(parserMessages.length > 0
      ? { parserMessages, parserWarnings: parserMessages.map((m) => m.message) }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Kontoumsätze (account / cash) parser
// ---------------------------------------------------------------------------

function isFlatexKonto(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return (
    lower.includes("buchtag") &&
    lower.includes("buchungsinformationen") &&
    lower.includes("betrag")
  );
}

function parseKontoumsaetze(lines: string[], delimiter: string): Statement {
  const headers = parseCsvLine(lines[0]!, delimiter);

  const dateCol = findColumn(headers, ["Buchtag"]);
  const infoCol = findColumn(headers, ["Buchungsinformationen"]);
  const amountCol = findColumn(headers, ["Betrag"]);
  const txnCol = findColumn(headers, ["TA-Nr.", "TA-Nr"]);
  // Currency sits in the empty header immediately after Betrag.
  const currencyCol = amountCol + 1;

  if (dateCol < 0 || infoCol < 0 || amountCol < 0) {
    throw new Error(
      "Flatex Kontoumsätze CSV: faltan columnas obligatorias (Buchtag, Buchungsinformationen, Betrag)",
    );
  }

  const amountName = (headers[amountCol] ?? "").trim() || "Betrag";
  const dateName = (headers[dateCol] ?? "").trim() || "Buchtag";
  const currencyName = (headers[currencyCol] ?? "").trim() || `${amountName}, divisa`;
  const cashTransactions: CashTransaction[] = [];
  const pendingOrderLegs: OrderLeg[] = [];
  // Dividend, withholding and interest rows whose amount or currency cannot
  // be read (#467). `key` pairs a dividend with its withholdings.
  const unreadableIncome: { key: string; dividend: boolean; type: string; currency: string; date: string; cells: string[] }[] = [];
  const incomeKey = (isin: string, date: string): string => `${isin}|${date}`;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || /^;+$/.test(line)) continue;

    const fields = parseCsvLine(line, delimiter);

    const info = (fields[infoCol] ?? "").trim();
    if (!info) continue;

    const tradeDate = convertDateDMYDot(fields[dateCol] ?? "");
    // An empty, currency-only or textual Betrag is no "0" and no number: it
    // is never booked as one (#467). A written 0 stays an explicit zero.
    const amountUnreadable = quantityUnreadable(fields[amountCol]);
    const amount = amountUnreadable ? "0" : parseNumber(fields[amountCol] ?? "0");
    const currency = (fields[currencyCol] ?? "").trim();
    const isin = extractIsin(info);

    // Trade cash legs ("Ausführung ORDER Kauf/Verkauf <ISIN> <orderId>") are NOT
    // income — the trade itself lives in Depotumsätze. But the net cash here vs.
    // the gross trade value reveals the commission, so stash the leg for the
    // post-merge reconciliation pass instead of discarding it.
    if (ORDER_RE.test(info)) {
      const orderKey = extractOrderKey(info);
      if (orderKey) {
        const bookingId = txnCol >= 0 ? (fields[txnCol] ?? "").trim() : "";
        // A leg whose Betrag cannot be read carries its cell: its order then
        // gets no fee, never the whole trade as a fee or a crash (#467). So
        // does a leg whose Buchtag cannot be read: the day pairs it with its
        // fill, and a guessed day paired it with another fill.
        const cells = [
          ...(amountUnreadable ? [unreadableCell(amountName, fields[amountCol])] : []),
          ...(isReadableDay(tradeDate) ? [] : [unreadableCell(dateName, fields[dateCol])]),
        ];
        pendingOrderLegs.push({
          orderKey,
          netAmount: amount,
          isin,
          currency: currency || "EUR",
          tradeDate,
          ...(bookingId ? { bookingId } : {}),
          ...(cells.length > 0 ? { unreadableCell: cells.join(", ") } : {}),
        });
      }
      continue;
    }

    let type: CashTransaction["type"] | null = null;
    if (matchesAny(info, WITHHOLDING_PATTERNS)) {
      type = "Withholding Tax";
    } else if (matchesAny(info, DIVIDEND_PATTERNS) || matchesAny(info, DISTRIBUTION_PATTERNS)) {
      type = "Dividends";
    } else if (matchesAny(info, INTEREST_PATTERNS) && (amountUnreadable || toFiniteDecimal(amount).isPositive())) {
      // A bond coupon names its ISIN; interest on the cash balance does not.
      type = isin ? "Bond Interest Received" : "Broker Interest Received";
    }

    // Skip transfers ("ENTRE CUENTAS") and anything else that isn't
    // dividend/distribution/withholding/interest.
    if (!type) continue;

    // An amount that cannot be read, or a row with no currency, is not
    // booked: as 0 it hid the income and kept its withholding, as text it
    // stopped the report, and with no currency a dollar amount was read as
    // euros. The row and the withholdings of its dividend are named (#467).
    if (amountUnreadable || !currency) {
      unreadableIncome.push({
        key: incomeKey(isin, tradeDate),
        dividend: type === "Dividends",
        type: info,
        currency,
        date: tradeDate,
        cells: [
          ...(amountUnreadable ? [unreadableCell(amountName, fields[amountCol])] : []),
          ...(currency ? [] : [unreadableCell(currencyName, fields[currencyCol])]),
        ],
      });
      continue;
    }

    const orderId = txnCol >= 0 ? (fields[txnCol] ?? "").trim() : "";

    cashTransactions.push({
      transactionID: orderId || `flatex-${tradeDate}-${isin}-${i}`,
      accountId: "",
      symbol: isin,
      description: info,
      isin,
      currency,
      dateTime: tradeDate,
      settleDate: tradeDate,
      amount,
      fxRateToBase: "1",
      type,
    });
  }

  // The withholdings of a dividend that is not booked (same ISIN, same day)
  // are not booked either: a deduction for income the report does not count.
  // They are named with it.
  const unreadableRows = unreadableIncome.map((row) => {
    if (!row.dividend) return cashIncomeRowText(row.type, "", row.currency, row.date, row.cells);
    const withheld = cashTransactions.filter((c) => c.type === "Withholding Tax" && incomeKey(c.isin, c.dateTime) === row.key);
    for (const w of withheld) cashTransactions.splice(cashTransactions.indexOf(w), 1);
    const tax = withheld.map((w) => `${w.description} ${w.amount} ${w.currency}`).join(", ");
    return cashIncomeRowText(row.type, "", row.currency, row.date, row.cells, tax);
  });

  // Flatex credits a dividend as ONE net booking (after the foreign or Spanish
  // withholding) and usually writes no Quellensteuer row. The engine reads a
  // "Dividends" amount as gross, so without a withholding row within the same
  // 7-day ISIN+currency window it would understate 0029 and find nothing for
  // 0588/0597. We cannot know the rate that was withheld (a missing W-8BEN means
  // 30% instead of 15%), so warn and point the user to the per-payment PDF.
  const withholdings = cashTransactions.filter((c) => c.type === "Withholding Tax");
  const hasNetDividends = cashTransactions.some(
    (c) =>
      c.type === "Dividends" &&
      !withholdings.some(
        (w) =>
          w.isin === c.isin &&
          w.currency === c.currency &&
          Math.abs(daysBetween(w.dateTime, c.dateTime)) <= 7,
      ),
  );
  const parserMessages: TaxMessage[] = dropUndatedCash("Flatex", cashTransactions, headers[dateCol] ?? "Buchtag");
  parserMessages.push(...cashIncomeAmountUnreadableMessages("Flatex", unreadableRows));
  if (hasNetDividends) {
    parserMessages.push({
      id: "flatex.dividends.net_amounts",
      severity: "warning",
      message:
        "Flatex anota los dividendos por el importe neto cobrado, ya descontada la retención, y el CSV de Kontoumsätze no incluye la retención.",
      hint: "Toma el importe íntegro y la retención de cada cobro del justificante en PDF que Flatex deja en tu buzón de documentos, y corrige a mano las casillas 0029 (importe íntegro), 0588 (retención extranjera) y 0597 (retención española).",
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
    ...(pendingOrderLegs.length > 0 ? { pendingOrderLegs } : {}),
    ...(parserMessages.length > 0
      ? { parserMessages, parserWarnings: parserMessages.map((m) => m.message) }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Public BrokerParser
// ---------------------------------------------------------------------------

/** Flatex CSV parser implementing BrokerParser interface */
export const flatexParser: BrokerParser = {
  name: "Flatex",
  formats: ["Depotumsätze CSV", "Kontoumsätze CSV"],

  detect(input: string): boolean {
    const firstLine = stripBom(input).split(/\r?\n/)[0] ?? "";
    return isFlatexDepot(firstLine) || isFlatexKonto(firstLine);
  },

  parse(input: string): Statement {
    const lines = stripBom(input).split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error("Flatex CSV: fichero vacío o sin datos");
    }

    const headerLine = lines[0]!;
    const delimiter = detectDelimiter(headerLine);

    // Depotumsätze must be checked first: it also contains "Buchtag", but the
    // ISIN+Bezeichnung+Nominal combination is unique to the securities export.
    if (isFlatexDepot(headerLine)) {
      return parseDepotumsaetze(lines, delimiter);
    }
    if (isFlatexKonto(headerLine)) {
      return parseKontoumsaetze(lines, delimiter);
    }

    throw new Error(
      "Flatex CSV: formato no reconocido. Se esperan las cabeceras del CSV de Depotumsätze o Kontoumsätze.",
    );
  },
};
