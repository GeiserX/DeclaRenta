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
import type { TaxMessage } from "../types/tax.js";
import { isEcbResolvable, isFiat } from "../engine/ecb.js";
import { KNOWN_CRYPTO_SYMBOLS } from "./crypto-symbols.js";
import {
  parseCsvLine,
  parseNumber,
  toFiniteDecimal,
  convertDateISO,
  detectDelimiter,
  findColumn,
  stripBom,
  timeOfDay,
  tradeQuantityUnknownMessages,
  cryptoIncomeUnidentifiedMessages,
  cryptoIncomeAmountUnreadableMessages,
  isReadableTradeDate,
  unreadableTrade,
  unreadableCell,
  quantityUnreadable,
  markUndatedTrades,
  dropUndatedCash,
} from "./csv-utils.js";

// ---------------------------------------------------------------------------
// Kraken symbol mapping
// ---------------------------------------------------------------------------

/**
 * Kraken's legacy asset codes, the only ones with an X/Z prefix, and their
 * short names. Every other code is the coin's own ticker (DOT, ADA, and also
 * ZETA, ZORA, XAUT, XTZ, whose X or Z is part of the name).
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
  XICN: "ICN",
  XNMC: "NMC",
  XXVN: "XVN",
  XXDG: "DOGE",
  XDG: "DOGE",
  ETH2: "ETH",
  ZEUR: "EUR",
  ZUSD: "USD",
  ZGBP: "GBP",
  ZJPY: "JPY",
  ZCAD: "CAD",
  ZAUD: "AUD",
  ZKRW: "KRW",
};

/** Kraken's legacy code as its short name; any other code as written. */
function cleanSymbol(raw: string): string {
  // Staked/earning balances carry a suffix (DOT.S, XBT.M, SOL.F, ...), and
  // bonded staking puts the unbonding days before it (DOT28.S, ATOM21.S). Drop
  // both first so the reward lands on the real coin and XTZ.S keeps its X.
  // Digits go only when a suffix is present, so API3 or C98 stay intact.
  const trimmed = raw.trim().toUpperCase().replace(/\d*\.(S|M|F|B|P)$/, "");
  // Only a legacy code loses its prefix. A real coin that starts with X or Z
  // (ZETA, ZORA, XAUT, XUSD) lost its first letter: it could not match the
  // same coin at another broker, so an art. 33.5.e rebuy was missed, and
  // XUSD was booked as dollars (#467).
  return KRAKEN_ASSET_MAP[trimmed] ?? trimmed;
}

// Well-known quote suffixes, longer first to avoid partial matches
// (XBTPYUSD must match PYUSD before USD; XBTUSDT has no Z/X prefix at all).
const QUOTE_SUFFIXES = [
  "PYUSD", "USDT", "USDC", "EURT",
  "ZEUR", "ZUSD", "ZGBP", "ZJPY", "ZCAD", "ZAUD",
  "XETH", "XXBT", "XLTC", "XXRP",
  "EUR", "USD", "GBP", "JPY", "CAD", "AUD",
  "ETH", "XBT", "BTC",
];

/**
 * Split a Kraken pair into base and quote symbols.
 * Kraken pairs can be: XBTEUR, XXBTXETH, ETHEUR, DOTUSD, BTC/EUR, etc.
 *
 * `assumedQuote` is true when the pair matched no known quote suffix and the
 * quote is a guess: either the last 3 chars (6+ char pairs) are not a currency
 * the ECB publishes, or the pair is too short and the quote defaulted to EUR,
 * or a slash pair is not two sides or its quote is no known currency or coin.
 * The caller warns in that case because the trade may be split or valued wrong.
 */
function splitPair(pair: string): { base: string; quote: string; assumedQuote: boolean } {
  const p = pair.trim().toUpperCase();

  // A pair written with a slash (BTC/EUR) names both sides. It was booked as
  // the coin "BTC/", which matched no BTC lot, reward or rebuy (#467). A
  // quote that is no known currency or coin, or a pair that is not two
  // sides, is a guess, and the caller names it.
  if (p.includes("/")) {
    const sides = p.split("/").map((x) => x.trim());
    const base = cleanSymbol(sides[0] ?? "") || p;
    const quote = cleanSymbol(sides[1] ?? "") || "EUR";
    const known = isEcbResolvable(quote) || KNOWN_CRYPTO_SYMBOLS.has(quote) || QUOTE_SUFFIXES.some((q) => cleanSymbol(q) === quote);
    return { base, quote, assumedQuote: sides.length !== 2 || !sides[0] || !sides[1] || !known };
  }

  for (const suffix of QUOTE_SUFFIXES) {
    if (p.endsWith(suffix) && p.length > suffix.length) {
      const baseRaw = p.slice(0, p.length - suffix.length);
      // A legacy quote (ZEUR, XXBT) follows only a legacy base (XXBTZEUR,
      // XETHXXBT). Tezos is XTZEUR: read as XT/ZEUR it lost its Z (#467).
      if (/^[XZ]...$/.test(suffix) && !(baseRaw in KRAKEN_ASSET_MAP)) continue;
      return { base: cleanSymbol(baseRaw), quote: cleanSymbol(suffix), assumedQuote: false };
    }
  }

  // Fallback: assume last 3 chars are quote (ETHDAI, XBTCHF). Only trust the
  // guess when that quote is a currency the ECB resolves; otherwise warn.
  if (p.length >= 6) {
    const quote = cleanSymbol(p.slice(-3));
    return { base: cleanSymbol(p.slice(0, p.length - 3)), quote, assumedQuote: !isEcbResolvable(quote) };
  }

  return { base: cleanSymbol(p), quote: "EUR", assumedQuote: true };
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
  subtype: number;
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
    subtype: findColumn(headers, ["subtype"]),
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
  // Pairs whose quote we could not recognize, mapped to the base/quote split we
  // guessed (may be mis-split or mis-valued).
  const unrecognizedPairs = new Map<string, string>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, delimiter);

    const txid = (fields[cols.txid] ?? "").trim();
    const pair = (fields[cols.pair] ?? "").trim();
    const timeStr = (fields[cols.time] ?? "").trim();
    const type = (fields[cols.type] ?? "").trim().toLowerCase();
    // Money/quantity that feeds tax totals is finiteness-guarded: a malformed
    // cell yields "0", never a non-finite Decimal that silently poisons totals
    // (see toFiniteDecimal in csv-utils). The display price is stored verbatim
    // as the lossless parseNumber string (trailing zeros preserved; never summed).
    const volDec = toFiniteDecimal(fields[cols.vol] ?? "0").abs();
    const costDec = toFiniteDecimal(fields[cols.cost] ?? "0").abs();
    const feeDec = toFiniteDecimal(fields[cols.fee] ?? "0");
    // A missing column, a cell with no finite number ("", "€", "abc", "-"),
    // or a negative price, which Kraken never writes, cannot be read.
    const priceReadable = !quantityUnreadable(fields[cols.price]) && !toFiniteDecimal(fields[cols.price]!).isNegative();

    const tradeDate = krakenDate(timeStr);
    const tradeTime = timeOfDay(timeStr);
    // A row with no txid is still a trade: the id only names it (#467).
    const rowId = txid || `kraken-row-${i}`;
    if (!pair) {
      // A row with no pair names no coin. A blank line is skipped; a trade
      // row (a txid, a type or a volume) is kept as a trade that books
      // nothing, and named.
      if (txid || type || !volDec.isZero()) {
        trades.push(unreadableTrade({
          tradeID: rowId, symbol: "", isin: "", assetCategory: "CRYPTO", currency: "EUR", tradeDate, tradeTime,
          exchange: "KRAKEN", ...(type === "sell" ? { buySell: "SELL" as const } : {}),
        }, unreadableCell(headers[cols.pair] ?? "pair", "")));
      }
      continue;
    }

    const { base, quote, assumedQuote } = splitPair(pair);
    if (assumedQuote) unrecognizedPairs.set(pair, `${base}/${quote}`);
    // A type that is neither buy nor sell (empty, "settle", a margin
    // settlement) is no purchase: it was booked as one (#468). The row is
    // kept as a trade that books nothing, for each coin it names, and named.
    if (type !== "buy" && type !== "sell") {
      const cell = unreadableCell(headers[cols.type] ?? "type", fields[cols.type] ?? "");
      const legs = [{ id: rowId, symbol: base, currency: quote }];
      if (!isFiat(quote)) legs.push({ id: `${rowId}-${quote}`, symbol: quote, currency: base });
      for (const leg of legs) {
        trades.push(unreadableTrade({
          tradeID: leg.id, symbol: leg.symbol, description: `${base}/${quote}`, isin: "", assetCategory: "CRYPTO",
          currency: leg.currency, tradeDate, tradeTime, exchange: "KRAKEN",
        }, cell));
      }
      continue;
    }

    // A buy or sale whose vol (or, for a crypto-quoted pair, cost) cannot be
    // read was booked as zero units, so FIFO dropped it with no word: it may
    // hide a gain, a loss or an art. 33.5.e repurchase. So may a row whose
    // price and cost both cannot be read: FIFO values a trade at price × vol.
    // It is kept as a trade that books nothing for each coin it names, and
    // named (#467).
    const badCol = quantityUnreadable(fields[cols.vol]) ? "vol"
      : !isFiat(quote) && quantityUnreadable(fields[cols.cost]) ? "cost"
      : !priceReadable && !volDec.isZero() && quantityUnreadable(fields[cols.cost]) ? "price"
      : "";
    if (badCol) {
      const idx = badCol === "vol" ? cols.vol : badCol === "cost" ? cols.cost : cols.price;
      const cell = unreadableCell(idx >= 0 ? headers[idx]!.trim() : badCol, fields[idx]);
      const legs = [{ id: rowId, symbol: base, currency: quote, buySell: type === "sell" ? "SELL" as const : "BUY" as const }];
      if (!isFiat(quote)) legs.push({ id: `${rowId}-${quote}`, symbol: quote, currency: base, buySell: type === "sell" ? "BUY" : "SELL" });
      for (const leg of legs) {
        trades.push(unreadableTrade({
          tradeID: leg.id, symbol: leg.symbol, description: `${base}/${quote}`, isin: "", assetCategory: "CRYPTO",
          currency: leg.currency, tradeDate, tradeTime, exchange: "KRAKEN", buySell: leg.buySell,
        }, cell));
      }
      continue;
    }

    const isSell = type === "sell";
    // FIFO values a trade at price × vol, never from cost. A price it cannot
    // read crashed the report ("abc") or sold for 0 € ("", "€"): a gain
    // became a loss with no word. Kraken writes cost = price × vol, so the
    // price is then cost ÷ vol, the file's own numbers (#467). A readable
    // price keeps the file's text; a written zero stays the file's word.
    const price = priceReadable ? parseNumber(fields[cols.price]!)
      : volDec.isZero() ? "0" : costDec.div(volDec).toString();

    trades.push({
      tradeID: rowId,
      accountId: "",
      symbol: base,
      description: `${base}/${quote}`,
      isin: "",
      assetCategory: "CRYPTO",
      currency: quote,
      tradeDate,
      tradeTime,
      settlementDate: tradeDate,
      quantity: isSell ? volDec.neg().toString() : volDec.toString(),
      tradePrice: price,
      tradeMoney: costDec.toString(),
      proceeds: isSell ? costDec.toString() : "0",
      cost: isSell ? "0" : costDec.toString(),
      fifoPnlRealized: "0",
      fxRateToBase: quote === "EUR" ? "1" : "1",
      buySell: isSell ? "SELL" : "BUY",
      openCloseIndicator: isSell ? "C" : "O",
      exchange: "KRAKEN",
      commissionCurrency: quote,
      commission: feeDec.isZero() ? "0" : feeDec.abs().neg().toString(),
      taxes: "0",
      multiplier: "1",
    });

    // A crypto-quoted pair (XETHXXBT) is a permuta (Art. 37.1.h LIRPF): the
    // quote coin is given up on a buy and received on a sell, so it needs its
    // own leg (a disposal, or the lot a later sale consumes), priced in the
    // base coin exactly like the Binance two-leg permuta. Fiat quotes have none.
    if (!isFiat(quote) && !volDec.isZero() && !costDec.isZero()) {
      trades.push({
        tradeID: `${rowId}-${quote}`,
        accountId: "",
        symbol: quote,
        description: `${base}/${quote}`,
        isin: "",
        assetCategory: "CRYPTO",
        currency: base,
        tradeDate,
        tradeTime,
        settlementDate: tradeDate,
        quantity: isSell ? costDec.toString() : costDec.neg().toString(),
        tradePrice: volDec.div(costDec).toString(),
        tradeMoney: volDec.toString(),
        proceeds: isSell ? "0" : volDec.toString(),
        cost: isSell ? volDec.toString() : "0",
        fifoPnlRealized: "0",
        fxRateToBase: "1",
        buySell: isSell ? "BUY" : "SELL",
        openCloseIndicator: isSell ? "O" : "C",
        exchange: "KRAKEN",
        commissionCurrency: base,
        commission: "0",
        taxes: "0",
        multiplier: "1",
      });
    }
  }

  markUndatedTrades(trades, "time");

  // A pair we couldn't split with certainty (no known quote suffix) was split by
  // a guess — warn so the user knows that trade may be mis-valued and can verify
  // it (skip-and-warn, three-tier message policy).
  const parserMessages: TaxMessage[] = [...(unrecognizedPairs.size > 0
    ? [{
        id: "kraken.unrecognized_pair",
        severity: "warning" as const,
        message: `No se ha reconocido la divisa de cotización ${unrecognizedPairs.size === 1 ? "del par" : "de los pares"} ${[...unrecognizedPairs].map(([pair, split]) => `${pair} (interpretado como ${split})`).join(", ")} de Kraken, por lo que esa(s) operación(es) podría(n) estar mal valorada(s).`,
        hint: "Suele deberse a un par poco habitual no incluido en la lista de divisas conocidas. Revisa esas operaciones y, si la moneda o la divisa de cotización no son las indicadas, corrige su valor manualmente.",
        context: { count: String(unrecognizedPairs.size) },
      }]
    : []), ...tradeQuantityUnknownMessages("Kraken", trades)];

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
    ...(parserMessages.length > 0 ? { parserMessages } : {}),
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
  // Rows of a type this parser does not read, by type. Trades come from the
  // Trades CSV (and are named at merge time when none books them); deposits,
  // withdrawals, transfers and Earn allocations only move the user's own
  // coins, so none of those is counted.
  const ignoredTypes = new Map<string, number>();
  // Staking rewards whose asset cell names no coin, named (#467).
  const unidentifiedIncome: string[] = [];
  // Staking rewards whose amount cell cannot be read, named (#467).
  const unreadableIncome: string[] = [];
  // Trade rows by refid: the date and each leg, "XXBT -0.1" (#467).
  const ledgerTrades = new Map<string, { date: string; legs: string[] }>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, delimiter);

    const txid = (fields[cols.txid] ?? "").trim();
    const timeStr = (fields[cols.time] ?? "").trim();
    const type = (fields[cols.type] ?? "").trim().toLowerCase();
    const subtype = cols.subtype >= 0 ? (fields[cols.subtype] ?? "").trim().toLowerCase() : "";
    const asset = (fields[cols.asset] ?? "").trim();
    const amountDec = toFiniteDecimal(fields[cols.amount] ?? "0");
    const feeLedgerDec = toFiniteDecimal(fields[cols.fee] ?? "0").abs();

    if (!txid) continue;

    // Staking rewards: the older ledger books them as type "staking", the newer
    // Kraken Earn ledger as type "earn" with subtype "reward".
    const isEarnReward = type === "earn" && subtype === "reward";
    if (type === "staking" || isEarnReward) {
      const symbol = cleanSymbol(asset);
      const tradeDate = krakenDate(timeStr);
      const netAmount = amountDec.minus(feeLedgerDec);
      // A reward with no asset says no coin: it is not booked under an empty
      // one (which no rate can value), but named by type, amount, date and
      // cell (#467).
      if (!symbol) {
        const rawType = [(fields[cols.type] ?? "").trim(), cols.subtype >= 0 ? (fields[cols.subtype] ?? "").trim() : ""].filter(Boolean).join(" ");
        const shownDate = isReadableTradeDate(tradeDate) ? tradeDate : timeStr || "—";
        unidentifiedIncome.push(`${rawType} ${(fields[cols.amount] ?? "").trim() || "—"} ${shownDate} [${unreadableCell(headers[cols.asset] ?? "asset", asset)}]`);
        continue;
      }
      // A reward whose amount cannot be read was booked as 0 units, so the
      // income went undeclared with no word. It is not booked, but named by
      // type, coin, date and cell (#467).
      const rawAmount = cols.amount >= 0 ? fields[cols.amount] : undefined;
      if (quantityUnreadable(rawAmount)) {
        const rawType = [(fields[cols.type] ?? "").trim(), cols.subtype >= 0 ? (fields[cols.subtype] ?? "").trim() : ""].filter(Boolean).join(" ");
        const shownDate = isReadableTradeDate(tradeDate) ? tradeDate : timeStr || "—";
        unreadableIncome.push(`${rawType} ${symbol} ${shownDate} [${unreadableCell(headers[cols.amount] ?? "amount", rawAmount)}]`);
        continue;
      }

      // Staking rewards are NOT foreign dividends (no issuer/withholding country,
      // not in the Art. 80 double-taxation pool). They are rendimiento del capital
      // mobiliario (savings base, Casilla 0027 — DGT V1766-22). Routed via
      // "Crypto Reward Income" (taxBucket "ahorro") so they never enter
      // calculateDividends(). Paid in the staked coin with no fiat value here, so
      // rewardCostBasisEur is omitted — the report values it via ECB/manual rate
      // (and creates the cost-basis lot) or surfaces it for manual entry.
      cashTransactions.push({
        transactionID: `kraken-${isEarnReward ? "earn" : "staking"}-${txid}`,
        accountId: "",
        symbol,
        description: `Staking reward - ${symbol}`,
        isin: "",
        currency: symbol,
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: netAmount.toString(),
        fxRateToBase: "1",
        type: "Crypto Reward Income",
        taxBucket: "ahorro",
        rewardQuantity: netAmount.abs().toString(),
      });
    } else if (type === "trade") {
      // Trades are read from the Trades CSV, whose txid is this refid.
      // `finalizeMergedStatement` names each one no Kraken trade books (#467).
      const refid = (fields[cols.refid] ?? "").trim() || txid;
      const tradeDate = krakenDate(timeStr);
      const entry = ledgerTrades.get(refid) ?? { date: "", legs: [] };
      if (!entry.date && isReadableTradeDate(tradeDate)) entry.date = tradeDate;
      entry.legs.push(`${asset || "—"} ${(fields[cols.amount] ?? "").trim() || "—"}`);
      ledgerTrades.set(refid, entry);
    } else if (!["deposit", "withdrawal", "transfer", "earn"].includes(type)) {
      const key = type || "(vacío)";
      ignoredTypes.set(key, (ignoredTypes.get(key) ?? 0) + 1);
    }
  }

  const ignoredCount = [...ignoredTypes.values()].reduce((a, b) => a + b, 0);
  const parserMessages: TaxMessage[] = [...dropUndatedCash("Kraken", cashTransactions, "time"), ...cryptoIncomeUnidentifiedMessages("Kraken", unidentifiedIncome), ...cryptoIncomeAmountUnreadableMessages("Kraken", unreadableIncome), ...(ignoredCount > 0
    ? [{
        id: "kraken.ledger_rows_ignored",
        severity: "info" as const,
        message: `Se han ignorado ${ignoredCount} movimiento(s) del libro mayor de Kraken de tipos que no se procesan: ${[...ignoredTypes].map(([t, n]) => `${t} (${n})`).join(", ")}.`,
        hint: "Del libro mayor solo se leen las recompensas de staking y Earn; las compraventas se leen del CSV de operaciones (Trades). Las compras instantáneas (tipos spend y receive) pueden no aparecer en ese CSV: si es tu caso, añádelas para que la moneda comprada tenga coste de adquisición.",
        context: { count: String(ignoredCount) },
      }]
    : [])];

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
    ...(parserMessages.length > 0 ? { parserMessages } : {}),
    ...(ledgerTrades.size > 0
      ? { krakenLedgerTrades: [...ledgerTrades].map(([refid, t]) => ({ refid, row: `${refid} ${t.date || "—"} [${t.legs.join(", ")}]` })) }
      : {}),
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
    const delimiter = detectDelimiter(headerLine);

    if (isTradesCsv(headerLine)) {
      return parseTradesCsv(lines, delimiter);
    }
    if (isLedgersCsv(headerLine)) {
      return parseLedgersCsv(lines, delimiter);
    }

    throw new Error("Kraken CSV: formato no reconocido");
  },
};
