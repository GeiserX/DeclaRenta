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
  convertDateDMYDot,
  findColumn,
} from "./csv-utils.js";

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
const ORDER_KEY_RE = /(\d{6,})\s*$/;

/** Extract the trailing broker order id from an "Ausführung ORDER ..." line. */
function extractOrderKey(text: string): string {
  const m = text.match(ORDER_KEY_RE);
  return m ? m[1]! : "";
}

/** Buy/sell keywords in the Buchungsinformationen column. */
const BUY_RE = /\bkauf\b/i;
const SELL_RE = /\bverkauf\b/i;

/** Dividend cash patterns (Kontoumsätze). */
const DIVIDEND_PATTERNS = [/dividendenzahlung/i, /dividende/i];

/** ETF/fund income distribution patterns — also taxed as dividends in Spain. */
const DISTRIBUTION_PATTERNS = [/ertr.gnisaussch.ttung/i, /aussch.ttung/i];

/** Withholding tax patterns (Quellensteuer). */
const WITHHOLDING_PATTERNS = [/quellensteuer/i, /kapitalertragsteuer/i];

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
  const currencyCol = priceCol >= 0 ? priceCol + 1 : -1;

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

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || /^;+$/.test(line)) continue; // skip empty / separator-only rows

    const fields = parseCsvLine(line, delimiter);

    const isin = (fields[isinCol] ?? "").trim();
    const info = infoCol >= 0 ? (fields[infoCol] ?? "").trim() : "";
    const qtyRaw = parseNumber(fields[qtyCol] ?? "0");
    const price = parseNumber(fields[priceCol] ?? "0");

    const qtyNum = new Decimal(qtyRaw);
    if (!isin || qtyNum.isZero()) continue;

    // Skip custody transfers (Lagerstellenwechsel): net-zero, not a disposal.
    if (/lagerstellenwechsel/i.test(info)) {
      custodyNet.set(isin, (custodyNet.get(isin) ?? new Decimal(0)).plus(qtyNum));
      continue;
    }

    // Skip zero-price rows (non-tradeable conversions, rights).
    if (new Decimal(price).isZero()) continue;

    // Direction: negative Nominal = sell, positive = buy. Keyword confirms.
    const isSell = qtyNum.isNegative() || (SELL_RE.test(info) && !BUY_RE.test(info));
    const absQty = qtyNum.abs();
    const tradeMoney = absQty.mul(new Decimal(price)).toFixed();

    const tradeDate = convertDateDMYDot(fields[dateCol] ?? "");
    const name = nameCol >= 0 ? (fields[nameCol] ?? "").trim() : "";
    const currency = currencyCol >= 0 ? (fields[currencyCol] ?? "EUR").trim() : "EUR";
    const orderId = txnCol >= 0 ? (fields[txnCol] ?? "").trim() : "";
    // Broker order id embedded in the Buchungsinformationen text — used after
    // merge to recover the commission from the matching Kontoumsätze cash leg.
    const orderKey = extractOrderKey(info);

    trades.push({
      tradeID: orderId,
      accountId: "",
      symbol: name,
      description: name,
      isin,
      assetCategory: "STK",
      currency: currency || "EUR",
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
      commissionCurrency: currency || "EUR",
      commission: "0",
      taxes: "0",
      multiplier: "1",
      ...(orderKey ? { notes: `flatex-order:${orderKey}` } : {}),
    });
  }

  const parserMessages: TaxMessage[] = [];
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
  const currencyCol = amountCol >= 0 ? amountCol + 1 : -1;

  if (dateCol < 0 || infoCol < 0 || amountCol < 0) {
    throw new Error(
      "Flatex Kontoumsätze CSV: faltan columnas obligatorias (Buchtag, Buchungsinformationen, Betrag)",
    );
  }

  const cashTransactions: CashTransaction[] = [];
  const pendingOrderLegs: OrderLeg[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || /^;+$/.test(line)) continue;

    const fields = parseCsvLine(line, delimiter);

    const info = (fields[infoCol] ?? "").trim();
    if (!info) continue;

    const tradeDate = convertDateDMYDot(fields[dateCol] ?? "");
    const amount = parseNumber(fields[amountCol] ?? "0");
    const currency = currencyCol >= 0 ? (fields[currencyCol] ?? "EUR").trim() : "EUR";
    const isin = extractIsin(info);

    // Trade cash legs ("Ausführung ORDER Kauf/Verkauf <ISIN> <orderId>") are NOT
    // income — the trade itself lives in Depotumsätze. But the net cash here vs.
    // the gross trade value reveals the commission, so stash the leg for the
    // post-merge reconciliation pass instead of discarding it.
    if (ORDER_RE.test(info)) {
      const orderKey = extractOrderKey(info);
      if (orderKey) {
        pendingOrderLegs.push({ orderKey, netAmount: amount, isin, currency: currency || "EUR" });
      }
      continue;
    }

    let type: CashTransaction["type"] | null = null;
    if (matchesAny(info, WITHHOLDING_PATTERNS)) {
      type = "Withholding Tax";
    } else if (matchesAny(info, DIVIDEND_PATTERNS) || matchesAny(info, DISTRIBUTION_PATTERNS)) {
      type = "Dividends";
    }

    // Skip transfers ("ENTRE CUENTAS") and anything else that isn't
    // dividend/distribution/withholding.
    if (!type) continue;

    const orderId = txnCol >= 0 ? (fields[txnCol] ?? "").trim() : "";

    cashTransactions.push({
      transactionID: orderId || `flatex-${tradeDate}-${isin}-${i}`,
      accountId: "",
      symbol: isin,
      description: info,
      isin,
      currency: currency || "EUR",
      dateTime: tradeDate,
      settleDate: tradeDate,
      amount,
      fxRateToBase: "1",
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
    ...(pendingOrderLegs.length > 0 ? { pendingOrderLegs } : {}),
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
    const firstLine = input.split(/\r?\n/)[0] ?? "";
    return isFlatexDepot(firstLine) || isFlatexKonto(firstLine);
  },

  parse(input: string): Statement {
    const lines = input.split(/\r?\n/).filter((l) => l.trim());
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
