/**
 * Kraken CSV parser.
 *
 * Parses Kraken's two CSV export formats into a normalized Statement:
 * - Trades CSV: txid, ordertxid, pair, time, type, ordertype, price, cost, fee, vol, ...
 * - Ledgers CSV: txid, refid, time, type, subtype, aclass, asset, amount, fee, balance
 *
 * Handles Kraken's X/Z prefix convention for asset symbols:
 *   X prefix = crypto (XXBT = BTC, XETH = ETH)
 *   Z prefix = fiat   (ZEUR = EUR, ZUSD = USD)
 */

import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import {
  parseCsvLine,
  parseNumber,
  convertDateISO,
  findColumn,
  stripBom,
} from "./csv-utils.js";

// ---------------------------------------------------------------------------
// Kraken symbol mapping
// ---------------------------------------------------------------------------

/**
 * Well-known Kraken asset codes that use the X/Z prefix convention.
 * Not all Kraken assets follow this pattern (e.g. DOT, ADA use plain names).
 */
const KRAKEN_ASSET_MAP: Record<string, string> = {
  XXBT: "BTC",
  XBT: "BTC",
  XETH: "ETH",
  XXRP: "XRP",
  XLTC: "LTC",
  XXLM: "XLM",
  XXMR: "XMR",
  XZEC: "ZEC",
  XETC: "ETC",
  XREP: "REP",
  XDAO: "DAO",
  XMLN: "MLN",
  ZEUR: "EUR",
  ZUSD: "USD",
  ZGBP: "GBP",
  ZJPY: "JPY",
  ZCAD: "CAD",
  ZAUD: "AUD",
};

/** Strip Kraken's X/Z prefix and return a clean symbol */
function cleanSymbol(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  if (KRAKEN_ASSET_MAP[trimmed]) return KRAKEN_ASSET_MAP[trimmed];

  // For 4+ char symbols starting with X or Z that aren't in the map,
  // strip the prefix only if the remainder is 3+ chars (avoids stripping XRP → RP)
  if (trimmed.length >= 4 && (trimmed[0] === "X" || trimmed[0] === "Z")) {
    return trimmed.slice(1);
  }
  return trimmed;
}

/**
 * Split a Kraken pair into base and quote symbols.
 * Kraken pairs can be: XBTEUR, XXBTXETH, ETHEUR, DOTUSD, etc.
 */
function splitPair(pair: string): { base: string; quote: string } {
  const p = pair.trim().toUpperCase();

  // Try well-known quote suffixes — fiat first, then crypto (longer first to avoid partial matches)
  const quoteSuffixes = [
    "ZEUR", "ZUSD", "ZGBP", "ZJPY", "ZCAD", "ZAUD",
    "XETH", "XXBT", "XLTC", "XXRP",
    "EUR", "USD", "GBP", "JPY", "CAD", "AUD",
    "ETH", "XBT", "BTC",
  ];
  for (const suffix of quoteSuffixes) {
    if (p.endsWith(suffix) && p.length > suffix.length) {
      const baseRaw = p.slice(0, p.length - suffix.length);
      return { base: cleanSymbol(baseRaw), quote: cleanSymbol(suffix) };
    }
  }

  // Fallback: assume last 3 chars are quote
  if (p.length >= 6) {
    return { base: cleanSymbol(p.slice(0, p.length - 3)), quote: cleanSymbol(p.slice(-3)) };
  }

  return { base: cleanSymbol(p), quote: "EUR" };
}

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

const TRADES_HEADERS = ["txid", "ordertxid", "pair"];
const LEDGERS_HEADERS = ["txid", "refid", "aclass"];

function isTradesCsv(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return TRADES_HEADERS.every((h) => lower.includes(h));
}

function isLedgersCsv(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return LEDGERS_HEADERS.every((h) => lower.includes(h));
}

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

/** Convert Kraken "YYYY-MM-DD HH:MM:SS" to YYYYMMDD */
function krakenDate(timeStr: string): string {
  const datePart = timeStr.trim().split(" ")[0] ?? "";
  return convertDateISO(datePart);
}

// ---------------------------------------------------------------------------
// Trades CSV column resolution
// ---------------------------------------------------------------------------

interface TradesColumns {
  txid: number;
  pair: number;
  time: number;
  type: number;
  price: number;
  cost: number;
  fee: number;
  vol: number;
}

function resolveTradesColumns(headers: string[]): TradesColumns {
  return {
    txid: findColumn(headers, ["txid"]),
    pair: findColumn(headers, ["pair"]),
    time: findColumn(headers, ["time"]),
    type: findColumn(headers, ["type"]),
    price: findColumn(headers, ["price"]),
    cost: findColumn(headers, ["cost"]),
    fee: findColumn(headers, ["fee"]),
    vol: findColumn(headers, ["vol"]),
  };
}

// ---------------------------------------------------------------------------
// Ledgers CSV column resolution
// ---------------------------------------------------------------------------

interface LedgersColumns {
  txid: number;
  refid: number;
  time: number;
  type: number;
  asset: number;
  amount: number;
  fee: number;
}

function resolveLedgersColumns(headers: string[]): LedgersColumns {
  return {
    txid: findColumn(headers, ["txid"]),
    refid: findColumn(headers, ["refid"]),
    time: findColumn(headers, ["time"]),
    type: findColumn(headers, ["type"]),
    asset: findColumn(headers, ["asset"]),
    amount: findColumn(headers, ["amount"]),
    fee: findColumn(headers, ["fee"]),
  };
}

// ---------------------------------------------------------------------------
// Trades CSV parser
// ---------------------------------------------------------------------------

function parseTradesCsv(lines: string[], delimiter: string): Statement {
  const headers = parseCsvLine(lines[0]!, delimiter);
  const cols = resolveTradesColumns(headers);

  if (cols.txid < 0 || cols.pair < 0 || cols.time < 0 || cols.type < 0) {
    throw new Error("Kraken Trades CSV: faltan columnas obligatorias (txid, pair, time, type)");
  }

  const trades: Trade[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, delimiter);

    const txid = (fields[cols.txid] ?? "").trim();
    const pair = (fields[cols.pair] ?? "").trim();
    const timeStr = (fields[cols.time] ?? "").trim();
    const type = (fields[cols.type] ?? "").trim().toLowerCase();
    const price = parseNumber(fields[cols.price] ?? "0");
    const cost = parseNumber(fields[cols.cost] ?? "0");
    const fee = parseNumber(fields[cols.fee] ?? "0");
    const vol = parseNumber(fields[cols.vol] ?? "0");

    if (!txid || !pair) continue;

    const { base, quote } = splitPair(pair);
    const tradeDate = krakenDate(timeStr);
    const isSell = type === "sell";
    const volNum = Math.abs(parseFloat(vol));
    const costNum = Math.abs(parseFloat(cost));
    const feeNum = parseFloat(fee);

    trades.push({
      tradeID: txid,
      accountId: "",
      symbol: base,
      description: `${base}/${quote}`,
      isin: "",
      assetCategory: "CRYPTO",
      currency: quote,
      tradeDate,
      settlementDate: tradeDate,
      quantity: isSell ? `-${volNum}` : `${volNum}`,
      tradePrice: price,
      tradeMoney: `${costNum}`,
      proceeds: isSell ? `${costNum}` : "0",
      cost: isSell ? "0" : `${costNum}`,
      fifoPnlRealized: "0",
      fxRateToBase: quote === "EUR" ? "1" : "1",
      buySell: isSell ? "SELL" : "BUY",
      openCloseIndicator: isSell ? "C" : "O",
      exchange: "KRAKEN",
      commissionCurrency: quote,
      commission: feeNum !== 0 ? `-${Math.abs(feeNum)}` : "0",
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
// Ledgers CSV parser
// ---------------------------------------------------------------------------

function parseLedgersCsv(lines: string[], delimiter: string): Statement {
  const headers = parseCsvLine(lines[0]!, delimiter);
  const cols = resolveLedgersColumns(headers);

  if (cols.txid < 0 || cols.type < 0 || cols.asset < 0) {
    throw new Error("Kraken Ledgers CSV: faltan columnas obligatorias (txid, type, asset)");
  }

  const cashTransactions: CashTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, delimiter);

    const txid = (fields[cols.txid] ?? "").trim();
    const timeStr = (fields[cols.time] ?? "").trim();
    const type = (fields[cols.type] ?? "").trim().toLowerCase();
    const asset = (fields[cols.asset] ?? "").trim();
    const amount = parseNumber(fields[cols.amount] ?? "0");
    const fee = parseNumber(fields[cols.fee] ?? "0");

    if (!txid) continue;

    // Only process staking rewards as cash transactions (income)
    if (type === "staking") {
      const symbol = cleanSymbol(asset);
      const tradeDate = krakenDate(timeStr);
      const feeNum = parseFloat(fee);
      const netAmount = parseFloat(amount) - Math.abs(feeNum);

      cashTransactions.push({
        transactionID: `kraken-staking-${txid}`,
        accountId: "",
        symbol,
        description: `Staking reward - ${symbol}`,
        isin: "",
        currency: symbol,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: `${netAmount}`,
        fxRateToBase: "1",
        type: "Dividends",
      });
    }
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

export const krakenParser: BrokerParser = {
  name: "Kraken",
  formats: ["CSV"],

  detect(input: string): boolean {
    const firstLine = stripBom(input).split(/\r?\n/)[0] ?? "";
    return isTradesCsv(firstLine) || isLedgersCsv(firstLine);
  },

  parse(input: string): Statement {
    const cleaned = stripBom(input);
    const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error("Kraken CSV: fichero vacío o sin datos");
    }

    const headerLine = lines[0]!;
    const delimiter = headerLine.includes(";") ? ";" : ",";

    if (isTradesCsv(headerLine)) {
      return parseTradesCsv(lines, delimiter);
    }
    if (isLedgersCsv(headerLine)) {
      return parseLedgersCsv(lines, delimiter);
    }

    throw new Error("Kraken CSV: formato no reconocido");
  },
};
