/**
 * Binance CSV parser.
 *
 * Parses Binance's trade history CSV export into a normalized Statement.
 *
 * CSV format:
 * Date(UTC),Pair,Side,Price,Executed,Amount,Fee
 *
 * Pair format: "BTCEUR" -- base asset concatenated with quote currency.
 * Fee format: "0.001BTC" -- numeric value followed by asset code.
 */

import Decimal from "decimal.js";
import type { BrokerParser, Statement } from "../types/broker.js";
import type { CashTransaction, Trade } from "../types/ibkr.js";
import type { ManualRateQuote, TaxMessage } from "../types/tax.js";
import { isFiat, isEcbResolvable } from "../engine/ecb.js";
import { parseCsvLine, stripBom, timeOfDay, toFiniteDecimal, markUndatedTrades, dropUndatedCash, tradeQuantityUnknownMessages, unreadableCell, unreadableTrade, toFiniteDecimalString } from "./csv-utils.js";
import { KNOWN_CRYPTO_SYMBOLS } from "./crypto-symbols.js";

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

/** Trade History format: Date(UTC),Pair,Side,Price,Executed,Amount,Fee */
const BINANCE_TRADE_HEADERS_EN = ["date(utc)", "pair", "side", "price"];
/** Spanish variant: Tiempo,Par,Lado,Precio,Ejecutado,Cantidad,Tarifa */
const BINANCE_TRADE_HEADERS_ES = ["tiempo", "par", "lado", "precio"];
/** Transaction History format: User_ID,UTC_Time,Account,Operation,Coin,Change,Remark */
const BINANCE_TX_HEADERS_EN = ["utc_time", "operation", "coin", "change"];
/** Spanish variant: ID de usuario,Tiempo,Cuenta,Operación,Moneda,Cambio,Observación */
const BINANCE_TX_HEADERS_ES = ["tiempo", "moneda", "cambio"];

function isBinanceTradeCsv(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return BINANCE_TRADE_HEADERS_EN.every((h) => lower.includes(h))
    || BINANCE_TRADE_HEADERS_ES.every((h) => lower.includes(h));
}

function isBinanceTxCsv(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  if (BINANCE_TX_HEADERS_EN.every((h) => lower.includes(h))) return true;
  if (BINANCE_TX_HEADERS_ES.every((h) => lower.includes(h)) && lower.includes("operaci")) return true;
  return false;
}

function isBinanceCsv(headerLine: string): boolean {
  return isBinanceTradeCsv(headerLine) || isBinanceTxCsv(headerLine);
}

// ---------------------------------------------------------------------------
// Column resolution
// ---------------------------------------------------------------------------

interface BinanceColumns {
  date: number;
  pair: number;
  side: number;
  price: number;
  executed: number;
  amount: number;
  fee: number;
}

function findCol(lower: string[], ...names: string[]): number {
  for (const n of names) {
    const idx = lower.indexOf(n);
    if (idx >= 0) return idx;
  }
  return -1;
}

function resolveColumns(headers: string[]): BinanceColumns {
  const lower = headers.map((h) => h.toLowerCase().trim());
  return {
    date: findCol(lower, "date(utc)", "tiempo"),
    pair: findCol(lower, "pair", "par"),
    side: findCol(lower, "side", "lado"),
    price: findCol(lower, "price", "precio"),
    executed: findCol(lower, "executed", "ejecutado"),
    amount: findCol(lower, "amount", "cantidad"),
    fee: findCol(lower, "fee", "tarifa"),
  };
}

// ---------------------------------------------------------------------------
// Pair parsing: "BTCEUR" -> { symbol: "BTC", currency: "EUR" }
// ---------------------------------------------------------------------------

const KNOWN_QUOTES = [
  "FDUSD", "USDT", "USDC", "BUSD", "TUSD", "USDP", "PYUSD", "USD1", "DAI", "AEUR", "EURI",
  "EUR", "USD", "GBP", "TRY", "BRL", "ARS", "AUD", "JPY", "MXN", "PLN", "RON", "ZAR", "RUB",
  "BTC", "ETH", "BNB", "XRP", "TRX", "DOGE", "RLUSD",
];
const QUOTES_LONGEST_FIRST = [...KNOWN_QUOTES].sort((a, b) => b.length - a.length);

/**
 * Bases of the real Binance pairs whose right split is NOT the longest quote
 * (ADAEUR is ADA/EUR, not AD/AEUR; BNBUSD is BNB/USD, not BN/BUSD), plus those
 * whose base is missing from KNOWN_CRYPTO_SYMBOLS while the wrong split's base
 * is in it (ARBUSD is AR/BUSD, not ARB/USD; USTBUSD is UST/BUSD, not USTB/USD).
 * Pinned here so a regeneration of the CoinGecko list cannot flip them.
 */
const AMBIGUOUS_PAIR_BASES = new Set(["ADA", "LUNA", "THETA", "GALA", "ENA", "USDT", "BNB", "AR", "UST"]);

const isKnownBase = (symbol: string): boolean => AMBIGUOUS_PAIR_BASES.has(symbol) || KNOWN_CRYPTO_SYMBOLS.has(symbol);

/**
 * Split a pair on its quote asset. Some quotes end in another quote (TUSD/USD,
 * AEUR/EUR, BUSD/USD), so a pair can match twice: BTCTUSD is BTC/TUSD but DOTUSD
 * is DOT/USD, ETHAEUR is ETH/AEUR but ADAEUR is ADA/EUR. When it does, the split
 * with the longest quote whose base is a known coin wins; with no known base the
 * longest quote does. Returns null when no quote matches.
 */
function parsePair(pair: string): { symbol: string; currency: string } | null {
  const upper = pair.trim().toUpperCase();
  const candidates = QUOTES_LONGEST_FIRST
    .filter((quote) => upper.endsWith(quote) && upper.length > quote.length)
    .map((quote) => ({ symbol: upper.slice(0, -quote.length), currency: quote }));
  return candidates.find((c) => isKnownBase(c.symbol)) ?? candidates[0] ?? null;
}

// ---------------------------------------------------------------------------
// Amount parsing: "0.001BTC" -> { amount: "0.001", asset: "BTC" }
// ---------------------------------------------------------------------------

/**
 * Read an Executed, Amount, Price or Fee cell against the coins it can be
 * written in: a plain finite number ("42000.00"), or one followed by one of
 * `coins` ("285.7CTK", "0.001BTC"). The coin is matched as a whole, the
 * longest first, so a coin that starts with a digit keeps its digits:
 * "1001INCH" is 100 1INCH. A letters-only match glued them onto the number
 * and read 1001 with no word (#467). Returns null for any other cell (empty,
 * text, "1,000.5BTC", or a number in another coin, which may be any amount).
 */
function readCoinAmount(cell: string | undefined, coins: readonly string[]): { amount: string; asset: string } | null {
  const upper = (cell ?? "").trim().toUpperCase();
  for (const coin of [...coins.filter((c) => c), ""].sort((a, b) => b.length - a.length)) {
    if (!upper.endsWith(coin)) continue;
    const num = upper.slice(0, upper.length - coin.length);
    if (/^[0-9.]+$/.test(num) && toFiniteDecimalString(num, "", false) !== "") return { amount: num, asset: coin };
  }
  return null;
}

/**
 * The Fee cell: in the coin received or BNB, read whole (readCoinAmount).
 * A fee in any other coin keeps the old letters-only read. An empty or
 * unreadable fee is no fee, which can only raise the tax.
 */
function parseFee(feeStr: string, coins: readonly string[]): { amount: string; asset: string } {
  const known = readCoinAmount(feeStr, coins);
  if (known) return known;
  const match = feeStr.trim().match(/^([0-9.]+)([A-Za-z]+)$/);
  return match ? { amount: match[1]!, asset: match[2]!.toUpperCase() } : { amount: "0", asset: "" };
}

// ---------------------------------------------------------------------------
// Date conversion: "2025-01-15 10:30:00" -> "20250115"
// ---------------------------------------------------------------------------

function convertBinanceDate(dateStr: string): string {
  const trimmed = dateStr.trim();
  // YYYY-MM-DD (4-digit year)
  const match4 = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match4) return `${match4[1]}${match4[2]}${match4[3]}`;
  // YY-MM-DD (2-digit year, Spanish exports). The lookahead stops it from
  // reading the head of a day-first date: "01-06-2025" re-saved by a
  // spreadsheet is no "01-06-20" (20/06/2001). It falls to the last line,
  // gives no real day, and markUndatedTrades names the row (#467).
  const match2 = trimmed.match(/^(\d{2})-(\d{2})-(\d{2})(?!\d)/);
  if (match2) return `20${match2[1]}${match2[2]}${match2[3]}`;
  return trimmed.replace(/-/g, "").slice(0, 8);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Transaction History parser (User_ID,UTC_Time,Account,Operation,Coin,Change)
// ---------------------------------------------------------------------------

interface BinanceTxColumns {
  utcTime: number;
  account: number;
  operation: number;
  coin: number;
  change: number;
  remark: number;
  /** Optional EUR value column (e.g. user-added `EUR_Value`); -1 when absent. */
  eurValue: number;
}

function resolveTxColumns(headers: string[]): BinanceTxColumns {
  const lower = headers.map((h) => h.toLowerCase().trim());
  return {
    utcTime: findCol(lower, "utc_time", "tiempo"),
    account: findCol(lower, "account", "cuenta"),
    operation: findCol(lower, "operation", "operación", "operacion"),
    coin: findCol(lower, "coin", "moneda"),
    change: findCol(lower, "change", "cambio"),
    remark: findCol(lower, "remark", "observación", "observacion"),
    eurValue: findCol(lower, "eur_value", "valor_eur", "valor en eur", "valor eur"),
  };
}

/**
 * Skip these operations — internal transfers / non-taxable movements.
 * Simple Earn / Staking subscription & redemption move the SAME principal coin
 * into/out of the product; they are not disposals (only the INTEREST is income).
 * Deposits/withdrawals and inter-account transfers are mere custody changes.
 */
const TX_SKIP_OPS = new Set([
  "deposit", "withdraw", "fiat deposit", "fiat withdraw", "fiat withdrawal",
  "transfer between main and funding wallet",
  "transfer between spot and strategy account",
  "transfer between main and trading account",
  "transfer between main account/futures and margin account",
  "transfer between spot and um futures account",
  "transfer between spot and cm futures account",
  "simple earn flexible subscription",
  "simple earn flexible redemption",
  "simple earn locked subscription",
  "simple earn locked redemption",
  "staking purchase",
  "staking redemption",
  "pos savings purchase",
  "pos savings redemption",
  // Margin loan/repayment are not income; any disposal of borrowed coins shows
  // up as a separate Transaction Sold/Buy. Skip the loan bookkeeping itself.
  "isolated margin loan",
  "isolated margin repayment",
  "cross margin loan",
  "cross margin repayment",
  "main and funding transfer",
  "transfer between main and funding account",
  "asset recovery",
  // Copy Trading: Create/Close move the SAME principal between the Spot and
  // "Spot Copy" sub-accounts (each coin nets to zero across the two legs) — a
  // custody change, not a disposal. The lead trader's mirrored trades, when
  // present, arrive as their own Transaction Buy/Spend/Sold/Revenue rows.
  "copy portfolio (spot) - create",
  "copy portfolio (spot) - close",
  // BNB Fee Deduction: a micro fee settled in BNB (sub-cent dust). Immaterial;
  // explicit trading fees already reduce cost/proceeds via "Transaction Fee".
  "bnb fee deduction",
]);

/**
 * Income operations whose tax bucket is "ahorro" (rendimiento del capital
 * mobiliario, savings base — Casilla 0027). Staking / Simple Earn interest.
 * (DGT V1766-22, Art. 25.2/43.1 LIRPF.)
 */
const TX_INCOME_AHORRO_OPS = new Set([
  "simple earn flexible interest",
  "simple earn locked rewards",
  "staking rewards",
  "eth 2.0 staking rewards",
  "pos savings interest",
  "savings interest",
  "launchpool interest",
  "bnb vault rewards",
  "savings distribution",
]);

/**
 * Income operations whose tax bucket is "general" (ganancia patrimonial NO
 * derivada de transmisión, base general — Art. 33.1 LIRPF; DGT V1948-21).
 * Airdrops, referral commissions, fee rebates, free distributions.
 */
const TX_INCOME_GENERAL_OPS = new Set([
  "referral commission",
  "referral kickback",
  "commission rebate",
  "commission history",
  "commission fee shared with you",
  "strategy trading fee rebate",
  "hodler airdrops distribution",
  "launchpool airdrop - system distribution",
  "launchpool airdrop - user claim distribution",
  "airdrop assets",
  "token swap - distribution",
  "distribution",
  "cash voucher distribution",
  "crypto box",
]);

/** Dust conversion to BNB — taxable permutas (each dust coin → BNB). */
const TX_DUST_OPS = new Set([
  "small assets exchange bnb",
]);

/**
 * Paired-leg swaps: a positive (received) leg + a negative (given-up) leg within
 * a ±1s window. `Binance Convert` is crypto↔crypto (or crypto↔fiat); `Buy Crypto
 * With Fiat` (the "Comprar con tarjeta/saldo" flow) spends EUR/USD to acquire a
 * coin. Both route through the same netLegs → pairAndEmit → emitCryptoSwap path,
 * which already emits a single fiat-priced BUY when one leg is genuine fiat — so
 * the acquired coin gets its FIFO lot (otherwise later disposals fabricate a
 * phantom "Venta sin lotes" with cost basis 0).
 */
const TX_CONVERT_OPS = new Set([
  "binance convert",
  "buy crypto with fiat",
]);

/**
 * Plain SPOT-market trade legs (the older / "Generate all statements" vocabulary,
 * distinct from the `Transaction *` Strategy vocabulary). A spot trade is a group
 * of same-timestamp rows: `Buy <received +>` + `Sell <given-up −>` + optional
 * `Fee` + (the income `Referral Commission` may share the timestamp but is already
 * consumed by the income phase). `Sell Crypto to Fiat` is the cash-out flow
 * (`<crypto −>` + `<EUR +>`). All are paired by SIGN (not op name — `Sell` is the
 * given-up leg of BOTH a buy and a sell), netted per coin, and routed through the
 * same emitCryptoSwap path as Convert: a fiat leg → a single fiat-priced trade; a
 * crypto-only pair → a permuta. Without this, a user's spot buys create no FIFO
 * lot and later sells fabricate phantom "Venta sin lotes" (cost basis 0).
 */
const SPOT_TRADE_OPS = new Set([
  "buy",
  "sell",
  "sell crypto to fiat",
]);
/** The spot trading-commission leg (kept separate: attached as commission, not paired). */
const SPOT_FEE_OP = "fee";

interface TxRow {
  utcTime: string;
  /** Seconds since epoch, for ±1s window grouping. */
  epoch: number;
  tradeDate: string;
  operation: string;
  account: string;
  coin: string;
  change: Decimal;
  /** EUR value of this row from an optional broker/user EUR column (null if absent). */
  eurValue: Decimal | null;
  remark: string;
  /** Line number in the file: only a tiebreak for sorting, never part of an ID. */
  index: number;
  /** Position-independent row key (see occurrenceKey), used in the emitted IDs. */
  key: string;
  /** Set once a row has been consumed by a trade/income so it's never reused. */
  parsed: boolean;
  /** The Operation and Change cells as written, to name the row in a warning. */
  operationText: string;
  changeText: string;
  /** A spot trade leg its window could not pair: it books nothing and is named (#467). */
  unpaired?: boolean;
  /**
   * A leg of a spot window where several coins share fiat payments the export
   * does not tie to each coin: the payment is shared by a guess, so the row
   * is named (#467).
   */
  costSplitGuessed?: boolean;
  /**
   * A fee row of a window where two or more orders take its coin and the file
   * does not write it beside one of them: it is deducted from no order and
   * named (#467).
   */
  feeUnassigned?: boolean;
  /** A negative income row (a reward taken back): it books nothing and is named (#467). */
  negativeIncome?: boolean;
  /** A leg of a swap of one fiat currency for another: no engine books it, so it is named (#467). */
  fiatConversion?: boolean;
  /** The row a trade phase paired this leg with, when each leg is one row. */
  partner?: TxRow;
  /**
   * Pairings that are proven only if this leftover leg is paired by a later
   * window next to its counterpart (proveOrder, resolveLeftovers, #467).
   */
  waitingPairings?: PendingPairing[];
}

/** A window's pairs, its leftover legs and all its rows, kept until every window has run. */
interface PendingPairing {
  pairs: (readonly [TxRow, TxRow])[];
  leftovers: TxRow[];
  rows: TxRow[];
}

/**
 * Parse "YYYY-MM-DD HH:MM:SS" / "YY-MM-DD HH:MM:SS" to epoch seconds (UTC).
 *
 * Hard Trace (regex-miss degeneration): returns `NaN` — NOT `0` — when the
 * timestamp can't be parsed. The ±1s window phases (collectWindow) compare
 * epochs; a row that fell back to `0` would falsely sit within 1s of every
 * other unparseable row AND drive the forward-scan toward O(n²)/mis-grouping.
 * `NaN` is an explicit out-of-band sentinel: it never compares within a window
 * (every `>` / `<=` against NaN is false — see collectWindow's `> 1` test),
 * and collectRows both sorts it deterministically and drops+counts it, so a
 * timestamp-less row can never be silently clustered with real rows.
 */
function txEpoch(utcTime: string): number {
  const m = utcTime.trim().match(/^(\d{2,4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return NaN;
  let year = Number(m[1]);
  if (year < 100) year += 2000;
  return Math.floor(
    Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) / 1000,
  );
}

const CRYPTO_TRADE_BASE = {
  accountId: "",
  isin: "",
  assetCategory: "CRYPTO" as const,
  fifoPnlRealized: "0",
  fxRateToBase: "1",
  exchange: "BINANCE",
  taxes: "0",
  multiplier: "1",
  brokerSource: "Binance",
};

/** A coin's net position within a paired group (after netting intra-account splits). */
interface NetLeg {
  coin: string;
  qty: Decimal; // signed
  eur: Decimal | null; // summed EUR value (signed), null if any leg lacked it
  date: string;
  index: number;
  key: string;
  /** The rows this leg stands for, so a phase can name them (fiatConversion) or tie a fee to them. */
  rows?: TxRow[];
}

/**
 * Position-independent key for a CSV row: its own cells plus how many identical
 * rows came before it in the same file. The same row in two overlapping exports
 * gets the same key, so the duplicate-trades check sees it; two identical fills
 * in one file still get distinct keys. A line number would differ between files.
 */
function occurrenceKey(seen: Map<string, number>, content: string): string {
  const n = (seen.get(content) ?? 0) + 1;
  seen.set(content, n);
  return `${content}#${n}`;
}

/**
 * The triplicated ±1s forward-scan, extracted verbatim (phases 4/5/6 each ran an
 * identical copy). From `startIdx`, walk forward while the row stays within the
 * 1-second window (`epoch − start.epoch ≤ 1`); collect every still-unparsed row
 * that satisfies `predicate`. `rows` MUST already be sorted by (epoch, index) so
 * the window is contiguous and the `> 1` break is correct. The single-consume
 * `parsed` flag is honoured here (parsed rows are never re-collected); marking the
 * window parsed is left to each caller, matching the original per-phase behavior
 * (phase 4 marked the window itself; phases 5/6 marked it inside their emitter).
 */
function collectWindow(rows: TxRow[], startIdx: number, predicate: (r: TxRow) => boolean): TxRow[] {
  const start = rows[startIdx]!;
  const window: TxRow[] = [];
  for (let j = startIdx; j < rows.length; j++) {
    const r = rows[j]!;
    // A NaN epoch (unparseable timestamp) is OUT of every window: `diff > 1` is
    // false for NaN (it would NOT break — driving an O(n²) full-scan), so test
    // for it explicitly. collectRows already drops NaN-epoch rows, so this is a
    // defensive backstop that keeps the window contiguous even if one slips in.
    const diff = r.epoch - start.epoch;
    if (Number.isNaN(diff) || diff > 1) break;
    if (!r.parsed && predicate(r)) window.push(r);
  }
  return window;
}

/** Unparsed rows at exactly `epoch` that satisfy `predicate`, scanning forward from `from` (rows are sorted by epoch). */
function unparsedAt(rows: TxRow[], from: number, epoch: number, predicate: (r: TxRow) => boolean): TxRow[] {
  const out: TxRow[] = [];
  for (let j = from; j < rows.length; j++) {
    const r = rows[j]!;
    if (r.epoch > epoch) break;
    if (r.epoch === epoch && !r.parsed && predicate(r)) out.push(r);
  }
  return out;
}

/** Whether any net leg has the given sign (+1 received, -1 given up). */
function hasSign(legs: NetLeg[], sign: 1 | -1): boolean {
  return legs.some((l) => (sign > 0 ? l.qty.isPositive() : l.qty.isNegative()));
}

/**
 * Straddle guard for the netted Convert path. collectWindow measures ±1s from
 * the window's first second (t), so when the next conversion starts in this
 * window's last second (t+1), one of its legs is netted into THIS conversion
 * and its counterpart at t+2 is left alone (wrong cost here, no lot there).
 * Binance lists the two legs in either order (given-up first or received
 * first), so the guard reasons by sign, not by row order. It hands the coins
 * at t+1 to the next window only when all of these hold:
 * - the unparsed rows at t+2 are one-sided (only received legs, or only
 *   given-up legs), so they cannot be a conversion on their own;
 * - nothing at t+3 has the sign they lack, so their counterpart is not there
 *   (a next conversion whose other leg sits at t+3 keeps its own legs);
 * - those coins at t+1 net to the sign the t+2 rows lack;
 * - what stays in this window is still a complete conversion.
 * Otherwise the window is returned unchanged, so a single conversion whose
 * given-up coin is split across two rows one second apart still nets as one.
 */
function trimStraddle(rows: TxRow[], startIdx: number, window: TxRow[], predicate: (r: TxRow) => boolean): TxRow[] {
  const t = rows[startIdx]!.epoch;
  const edge = window.filter((r) => r.epoch === t + 1);
  if (edge.length === 0) return window;
  const next = netLegs(unparsedAt(rows, startIdx, t + 2, predicate));
  const lacks: 1 | -1 | 0 = hasSign(next, 1) && !hasSign(next, -1) ? -1 : hasSign(next, -1) && !hasSign(next, 1) ? 1 : 0;
  if (lacks === 0) return window;
  if (hasSign(netLegs(unparsedAt(rows, startIdx, t + 3, predicate)), lacks)) return window;
  const moving = new Set(netLegs(edge).filter((l) => hasSign([l], lacks)).map((l) => l.coin));
  if (moving.size === 0) return window;
  const head = window.filter((r) => !(r.epoch === t + 1 && moving.has(r.coin)));
  const headLegs = netLegs(head);
  if (!hasSign(headLegs, 1) || !hasSign(headLegs, -1)) return window;
  return head;
}

/** Strategy-vocabulary ops (Transaction Sold/Revenue/Buy/Spend/Fee). */
const STRATEGY_OPS = ["transaction sold", "transaction revenue", "transaction buy", "transaction spend", "transaction fee"];
/** Every operation whose rows are legs a trade phase pairs with another leg. */
const PAIRED_TX_OPS = new Set([...TX_CONVERT_OPS, ...STRATEGY_OPS, ...SPOT_TRADE_OPS]);

function parseBinanceTxCsv(lines: string[]): Statement {
  const headers = parseCsvLine(lines[0]!, ",");
  const cols = resolveTxColumns(headers);

  if (cols.utcTime < 0 || cols.operation < 0 || cols.coin < 0 || cols.change < 0) {
    throw new Error("Binance Transaction History CSV: faltan columnas obligatorias (UTC_Time, Operation, Coin, Change)");
  }

  const trades: Trade[] = [];
  const cashTransactions: CashTransaction[] = [];
  const manualRateHints: ManualRateQuote[] = [];
  /** Shared accumulator: all taxable rows, sorted by (epoch, index) in collectRows. */
  const rows: TxRow[] = [];
  /**
   * Rows left out because their UTC_Time cannot be read, each named as
   * "coin operation change [UTC_Time: cell]" (#467).
   */
  const skippedNoTimestamp: string[] = [];
  /** Rows left out because their Change cannot be read, each named as "coin operation date [Change: cell]". */
  const skippedBadAmount: string[] = [];
  /** Rows left out because they move an amount of no named coin, each named as "operation change date [Coin: cell]". */
  const skippedNoCoin: string[] = [];

  /** Record an EUR-per-unit valuation hint for a coin+date from its EUR value. */
  function addHint(coin: string, date: string, qty: Decimal, eur: Decimal | null): void {
    if (eur === null || qty.isZero() || isFiat(coin)) return;
    const perUnit = eur.abs().div(qty.abs());
    if (!perUnit.isFinite() || perUnit.lessThanOrEqualTo(0)) return;
    manualRateHints.push({ currency: coin, date, eurPerUnit: perUnit.toString() });
  }

  // The columns the header names: a trailing empty header cell names none.
  const headerWidth = headers.reduce((width, h, idx) => (h.trim() !== "" ? idx + 1 : width), 0);

  // 1. Collect rows, skipping non-taxable internal movements and zero changes.
  function collectRows(): void {
    const seenKeys = new Map<string, number>();
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line) continue;

      const fields = parseCsvLine(line, ",");
      const utcTime = (fields[cols.utcTime] ?? "").trim();
      const operationText = (fields[cols.operation] ?? "").trim();
      const operation = operationText.toLowerCase();
      const coin = (fields[cols.coin] ?? "").trim().toUpperCase();
      const changeStr = (fields[cols.change] ?? "").trim();
      const account = (fields[cols.account] ?? "").trim();
      const remark = cols.remark >= 0 ? (fields[cols.remark] ?? "").trim() : "";

      // An internal movement is no taxable row, and a "--" change (Binance
      // writes this for some zero-fee rows) moves nothing.
      if (TX_SKIP_OPS.has(operation) || changeStr === "--") continue;
      // new Decimal("Infinity"/"NaN") does NOT throw: a non-finite value is as
      // unreadable as an empty or textual cell, so it cannot poison totals or
      // stall big-decimal arithmetic. null = the Change cannot be read.
      let change: Decimal | null = null;
      try {
        const parsed = new Decimal(changeStr);
        change = parsed.isFinite() ? parsed : null;
      } catch {
        change = null;
      }
      // A row with more cells than the header had a comma inside an unquoted
      // cell. Remark is free text, so a comma there is no harm: such a row
      // keeps its booking. But when the split may come from Change ("1,5"
      // read as Change "1" and Remark "5", or "1,250.5"), the row was booked
      // as its first part with no word (1 BTC instead of 1.5, #467). That is
      // so when the cell after Change is not a value of its column (no
      // number under EUR_Value), or when Change and that cell read as one
      // number with a comma. The file does not say which number it is, so
      // the Change is not read and the row is named by its cells as written.
      const nextCell = (fields[cols.change + 1] ?? "").trim();
      const nextInvalid = cols.change + 1 === cols.eurValue && nextCell !== "" && toFiniteDecimalString(nextCell, "", false) === "";
      const splitChange = fields.length > headerWidth && (nextInvalid || (/^[+-]?\d+$/.test(changeStr) && /^\d+(\.\d+)?$/.test(nextCell)));
      if (splitChange) change = null;
      const changeCell = splitChange
        ? unreadableCell(headers.slice(cols.change, headerWidth).map((h) => h.trim()).join(","), fields.slice(cols.change).join(",").replace(/,+$/, ""))
        : unreadableCell(headers[cols.change] ?? "Change", changeStr);
      const timeCell = unreadableCell(headers[cols.utcTime] ?? "UTC_Time", utcTime);
      // A row whose UTC_Time can't be parsed has no real epoch. txEpoch returns
      // NaN (not 0) for it; dropping it here is the safe fix: keeping it would
      // let the ±1s window phases falsely cluster every NaN-epoch row together
      // (all "within 1s") and degrade the forward-scan. An empty or missing
      // UTC_Time fails the regex too.
      const epoch = txEpoch(utcTime);
      const dated = !Number.isNaN(epoch);
      // A row with no Coin but a movement cannot be booked against any coin.
      // A row with neither a Coin nor a non-zero Change moves nothing.
      if (!coin) {
        if (change === null ? changeStr === "" : change.isZero()) continue;
        skippedNoCoin.push(`${operationText} ${changeStr} ${dated ? convertBinanceDate(utcTime) : `[${timeCell}]`} [${unreadableCell(headers[cols.coin] ?? "Coin", "")}]`);
        continue;
      }
      // Each row left out is named by coin, operation, change or date and the
      // failing cell, so a missing purchase or sale of a coin is never only a
      // count, and never dropped with no word (#467).
      if (!dated) {
        skippedNoTimestamp.push(`${coin} ${operationText} ${change === null ? `[${changeCell}]` : changeStr} [${timeCell}]`);
        continue;
      }
      if (change === null) {
        skippedBadAmount.push(`${coin} ${operationText} ${convertBinanceDate(utcTime)} [${changeCell}]`);
        continue;
      }
      if (change.isZero()) continue;

      let eurValue: Decimal | null = null;
      if (cols.eurValue >= 0) {
        const raw = (fields[cols.eurValue] ?? "").trim();
        if (raw) {
          try {
            const parsed = new Decimal(raw);
            eurValue = parsed.isFinite() ? parsed : null;
          } catch {
            eurValue = null;
          }
        }
      }

      rows.push({
        utcTime,
        epoch,
        tradeDate: convertBinanceDate(utcTime),
        operation,
        account,
        coin,
        change,
        eurValue,
        remark,
        index: i,
        key: occurrenceKey(seenKeys, [utcTime, account, operation, coin, changeStr, remark].join("|")),
        parsed: false,
        operationText,
        changeText: changeStr,
      });
    }

    // Stable order by time then file order, so ±1s windows are deterministic.
    // NaN epochs are dropped above, so (a.epoch - b.epoch) is always a real
    // number here — a NaN difference would make the comparator non-deterministic
    // (undefined sort order), defeating the contiguous-window invariant.
    rows.sort((a, b) => (a.epoch - b.epoch) || (a.index - b.index));
  }

  // 2. Income rows are single-row events — emit them first (and mark parsed) so
  //    they never get swept into a trade window.
  function emitIncome(): void {
    for (const r of rows) {
      if (r.parsed) continue;
      const isAhorro = TX_INCOME_AHORRO_OPS.has(r.operation);
      const isGeneral = TX_INCOME_GENERAL_OPS.has(r.operation);
      if (!isAhorro && !isGeneral) continue;
      // Only positive credits are income. A negative row takes a reward back:
      // the reward's lot stays in FIFO and its income stays counted, so the
      // row is named, never dropped with no word, and no disposal is made up
      // for it (#467).
      if (!r.change.isPositive()) { r.parsed = true; r.negativeIncome = true; continue; }

      r.parsed = true;
      addHint(r.coin, r.tradeDate, r.change, r.eurValue);
      cashTransactions.push({
        transactionID: `binance-income-${r.tradeDate}-${r.coin}-${r.key}`,
        accountId: "",
        symbol: r.coin,
        description: `${r.operation} - ${r.coin}`,
        isin: "",
        currency: r.coin,
        dateTime: r.tradeDate,
        settleDate: r.tradeDate,
        amount: r.change.toString(),
        fxRateToBase: "1",
        type: "Crypto Reward Income",
        taxBucket: isAhorro ? "ahorro" : "general",
        rewardQuantity: r.change.abs().toString(),
        ...(r.eurValue !== null ? { rewardCostBasisEur: r.eurValue.abs().toString() } : {}),
      });
    }
  }

  // 3. Dust (Small Assets Exchange BNB): negative dust-coin rows + positive BNB
  //    rows within ±1 s, paired via the Remark ("SCR to BNB"). Each dust coin →
  //    BNB is a permuta. A dust row with no BNB row books nothing and is named
  //    (binance.unpaired_leg); when the BNB rows are fewer than the dust coins,
  //    or several coins fall back from the Remark to file order, which BNB
  //    each coin got is a guess and every row is named
  //    (binance.spot_cost_split, #467).
  function emitDust(): void {
    const isDustLeg = (r: TxRow): boolean => TX_DUST_OPS.has(r.operation) &&
      (r.coin === "BNB" ? r.change.isPositive() : r.change.isNegative());
    for (let i = 0; i < rows.length; i++) {
      const start = rows[i]!;
      if (start.parsed || !isDustLeg(start)) continue;
      const group = collectWindow(rows, i, isDustLeg);
      const bnbRows = group.filter((r) => r.coin === "BNB");
      const dustRows = group.filter((r) => r.coin !== "BNB");
      let guessed = dustRows.length > 1 && bnbRows.length < dustRows.length;
      for (const dust of dustRows) {
        // Match BNB output by remark (e.g. "SCR to BNB"); fall back to any unused.
        const byRemark = bnbRows.find((b) => !b.parsed && b.remark === dust.remark);
        const bnb = byRemark ?? bnbRows.find((b) => !b.parsed);
        if (dustRows.length > 1 && bnb && (byRemark === undefined || dust.remark === "")) guessed = true;
        dust.parsed = true;
        addHint(dust.coin, dust.tradeDate, dust.change, dust.eurValue);
        if (bnb) {
          bnb.parsed = true;
          addHint("BNB", bnb.tradeDate, bnb.change, bnb.eurValue);
          emitCryptoSwap(trades, { coin: dust.coin, qty: dust.change, eur: dust.eurValue, date: dust.tradeDate, index: dust.index, key: dust.key, rows: [dust] },
            { coin: "BNB", qty: bnb.change, eur: bnb.eurValue, date: bnb.tradeDate, index: bnb.index, key: bnb.key, rows: [bnb] }, "Dust");
        } else {
          dust.unpaired = true;
        }
      }
      // Any leftover BNB rows (rounding remainders) are immaterial — drop.
      for (const b of bnbRows) b.parsed = true;
      if (guessed) for (const r of group) r.costSplitGuessed = true;
    }
  }

  // 4. Convert-style swaps (Binance Convert, Buy Crypto With Fiat): pair legs
  //    within a ±1s window (legs are frequently 1 second apart). Net per-coin to
  //    cancel intra-account split rows, then pair the net negative (sold/spent)
  //    with the net positive (bought). Windows are grouped by the SAME operation
  //    so a Convert and a fiat purchase in the same second never cross-mix.
  function emitConverts(): void {
    for (let i = 0; i < rows.length; i++) {
      const start = rows[i]!;
      if (start.parsed || !TX_CONVERT_OPS.has(start.operation)) continue;
      // Window keys on the SAME operation so a Convert and a fiat-buy in one
      // second never cross-mix.
      const sameOp = (r: TxRow): boolean => r.operation === start.operation;
      const window = trimStraddle(rows, i, collectWindow(rows, i, sameOp), sameOp);
      window.forEach((r) => (r.parsed = true));
      // A net leg left without a counterpart is handed back (parsed = false),
      // as Strategy does: a later window can still pair it, and a leg no window
      // pairs is reported as an unhandled movement instead of dropped silently.
      const handBack = (group: TxRow[], unpaired: NetLeg[]): void => {
        for (const l of unpaired) for (const r of l.rows ?? []) r.parsed = false;
        markRoundTrips(group);
      };
      if (start.operation === "buy crypto with fiat") {
        // Sub-group by funding-wallet Remark before netting. Fiat-buys are ALL
        // funded in the same coin (EUR/USD), so two independent buys in one second
        // would otherwise net into a single fiat leg → `pairAndEmit` sees 1 sell
        // vs N buys and DROPS all but one coin's lot (re-creating the phantom
        // "Venta sin lotes" this op was added to fix). Each purchase carries a
        // unique Remark (e.g. "Via CashBalance - Wallet/N…") shared by both legs,
        // so per-Remark grouping keeps them separate. Convert (empty remark) is
        // deliberately left on the whole-window path below — provably unchanged.
        const byRemark = new Map<string, TxRow[]>();
        for (const r of window) {
          if (!byRemark.has(r.remark)) byRemark.set(r.remark, []);
          byRemark.get(r.remark)!.push(r);
        }
        for (const group of byRemark.values()) {
          handBack(group, pairAndEmit(trades, netLegs(group), group, addHint, "Buy"));
        }
      } else {
        handBack(window, pairAndEmit(trades, netLegs(window), window, addHint, "Convert"));
      }
    }
  }

  // 5. Strategy trades: Transaction Sold↔Revenue and Buy↔Spend within ±1s.
  //    Pair ALL legs (not just the first) so high-frequency same-second groups
  //    aren't truncated.
  function emitStrategy(): void {
    for (let i = 0; i < rows.length; i++) {
      const start = rows[i]!;
      if (start.parsed) continue;
      if (!STRATEGY_OPS.includes(start.operation)) continue;
      const window = collectWindow(rows, i, (r) => STRATEGY_OPS.includes(r.operation));
      emitStrategyTrades(trades, window, addHint);
    }
  }

  // 6. Plain SPOT trades (Buy/Sell/Fee, Sell Crypto to Fiat) within ±1s. Runs
  //    AFTER income (phase 2), so a same-timestamp Referral Commission is already
  //    consumed and never swept into the trade window. Legs are paired by SIGN
  //    (netLegs/pairAndEmit), not op name, because `Sell` is the given-up leg of
  //    both a buy and a sale. Fees are pulled aside and attached, not paired.
  function emitSpot(): void {
    for (let i = 0; i < rows.length; i++) {
      const start = rows[i]!;
      if (start.parsed) continue;
      if (!SPOT_TRADE_OPS.has(start.operation) && start.operation !== SPOT_FEE_OP) continue;
      const window = collectWindow(rows, i, (r) => SPOT_TRADE_OPS.has(r.operation) || r.operation === SPOT_FEE_OP);
      emitSpotTrades(trades, window, addHint);
    }
  }

  // Phase order is LOAD-BEARING (4 documented phantom-lot fixes depend on it):
  // collect → income → dust → convert → strategy → spot. Income runs before the
  // trade phases so a same-second Referral Commission is consumed (never swept
  // into a trade window); the single-consume `parsed` flag enforces the rest.
  collectRows();
  emitIncome();
  emitDust();
  emitConverts();
  emitStrategy();
  emitSpot();
  resolveLeftovers(rows);

  // Name every row left out for a date or an amount it cannot read: they are
  // excluded from every phase, so they can't be silently mis-grouped, and the
  // user sees each coin whose results they make unreliable (#467).
  const parserMessages: TaxMessage[] = [];
  if (skippedNoTimestamp.length > 0) {
    const count = String(skippedNoTimestamp.length);
    const rows = skippedNoTimestamp.join("; ");
    parserMessages.push({
      id: "binance.unparseable_timestamp",
      severity: "warning",
      message: `Binance: ${count} fila(s) no tienen una fecha y hora (UTC_Time) legible y no se calculan: ${rows}.`,
      hint: "Entre corchetes va la celda de la fecha. Sin ella, DeclaRenta no sabe con qué otra fila va cada movimiento. Por eso no suma ni resta unidades ni dinero por esas filas. Las ganancias, las pérdidas y los ingresos de esas criptomonedas no son fiables. Si una fila es una recompra en el año siguiente a una venta con pérdidas, esa pérdida puede tener que quedar pendiente (art. 33.5.e LIRPF). DeclaRenta no la bloquea. Vuelve a descargar el informe original de Binance y súbelo sin editarlo. Si la fila sigue mal en el original, copia el dato que falta de tu historial de Binance y vuelve a subirlo.",
      context: { count, rows },
    });
  }
  if (skippedBadAmount.length > 0) {
    const count = String(skippedBadAmount.length);
    const rows = skippedBadAmount.join("; ");
    parserMessages.push({
      id: "binance.unparseable_amount",
      severity: "warning",
      message: `Binance: ${count} fila(s) no tienen un importe (Change) legible y no se calculan: ${rows}.`,
      hint: "Entre corchetes va la celda del importe. DeclaRenta no suma ni resta unidades ni dinero por esas filas. Por eso las ganancias, las pérdidas y los ingresos de esas criptomonedas no son fiables. Si una fila es una recompra en el año siguiente a una venta con pérdidas, esa pérdida puede tener que quedar pendiente (art. 33.5.e LIRPF). DeclaRenta no la bloquea. Vuelve a descargar el informe original de Binance y súbelo sin editarlo. Si la fila sigue mal en el original, copia el dato que falta de tu historial de Binance y vuelve a subirlo.",
      context: { count, rows },
    });
  }
  if (skippedNoCoin.length > 0) {
    const count = String(skippedNoCoin.length);
    const rows = skippedNoCoin.join("; ");
    parserMessages.push({
      id: "binance.unparseable_coin",
      severity: "warning",
      message: `Binance: ${count} fila(s) no dicen de qué moneda son (Coin) y no se calculan: ${rows}.`,
      hint: "Entre corchetes va la celda de la moneda. Sin ella, DeclaRenta no sabe qué criptomoneda entra o sale. Por eso no suma ni resta unidades ni dinero por esas filas. Las ganancias, las pérdidas y los ingresos de tus criptomonedas no son fiables. Si una fila es una recompra en el año siguiente a una venta con pérdidas, esa pérdida puede tener que quedar pendiente (art. 33.5.e LIRPF). DeclaRenta no la bloquea. Vuelve a descargar el informe original de Binance y súbelo sin editarlo. Si la fila sigue mal en el original, copia el dato que falta de tu historial de Binance y vuelve a subirlo.",
      context: { count, rows },
    });
  }
  // A trade leg (Convert, fiat purchase, Strategy or plain spot) that no
  // other leg paired within its ±1 s window books nothing. A missing purchase
  // or sale of a coin hides a gain, a loss or an art. 33.5.e repurchase, so
  // each leg is named by coin, operation, change and time, never dropped
  // with no word or only counted (#467).
  const unpairedLegs = rows.filter((r) => r.unpaired || (!r.parsed && PAIRED_TX_OPS.has(r.operation)));
  if (unpairedLegs.length > 0) {
    const count = String(unpairedLegs.length);
    const rows = unpairedLegs.map((r) => `${r.coin} ${r.operationText} ${r.changeText} ${r.utcTime}`).join("; ");
    parserMessages.push({
      id: "binance.unpaired_leg",
      severity: "warning",
      message: `Binance: ${count} movimiento(s) de compra, venta o conversión no tienen la otra parte de la operación y no se calculan: ${rows}.`,
      hint: "Cada compra o venta de Binance son dos filas con la misma hora: la moneda que entra y la que sale. DeclaRenta no ha encontrado la otra fila de estos movimientos. Por eso no suma ni resta unidades ni dinero por ellos. Las ganancias y las pérdidas de esas criptomonedas no son fiables. Si una fila es una recompra en el año siguiente a una venta con pérdidas, esa pérdida puede tener que quedar pendiente (art. 33.5.e LIRPF). DeclaRenta no la bloquea. Compara esas filas con tu historial de Binance y añade a mano en Renta Web las operaciones que falten.",
      context: { count, rows },
    });
  }
  // A window whose payments or proceeds the export does not tie to each
  // coin: they were shared by a guess (emitBareSpotGroup, pairAndEmit,
  // emitStrategyTrades), so each coin's cost or sale value, its gains and
  // losses and its art. 33.5.e check are not reliable. Every leg of the
  // window is named (#467).
  const guessedLegs = rows.filter((r) => r.costSplitGuessed);
  if (guessedLegs.length > 0) {
    const count = String(guessedLegs.length);
    const rows = guessedLegs.map((r) => `${r.coin} ${r.operationText} ${r.changeText} ${r.utcTime}`).join("; ");
    parserMessages.push({
      id: "binance.spot_cost_split",
      severity: "warning",
      message: `Binance: ${count} fila(s) de operaciones con varias criptomonedas en el mismo segundo no dicen qué pago o cobro va con cada criptomoneda. DeclaRenta ha repartido los importes entre ellas: ${rows}.`,
      hint: "Binance anota varias operaciones en el mismo segundo. No pone cada pago o cobro junto a su compra o venta. Por eso DeclaRenta no sabe qué importe va con cada criptomoneda. Ha repartido los importes entre ellas por orden o a partes iguales. El total es correcto, pero el coste o el importe de venta de cada criptomoneda no es fiable. Sus ganancias y sus pérdidas tampoco lo son. Si una de ellas es una recompra en el año siguiente a una venta con pérdidas, la comprobación del art. 33.5.e LIRPF tampoco es fiable. Busca esas órdenes en tu historial de Binance y corrige a mano en Renta Web el coste o el importe de venta de cada criptomoneda.",
      context: { count, rows },
    });
  }
  // A fee row two or more orders of its second could take, written beside
  // neither alone (tieFees): it is deducted from no order, so the user pays
  // no less, and each row is named (#467).
  const unassignedFees = rows.filter((r) => r.feeUnassigned);
  if (unassignedFees.length > 0) {
    const count = String(unassignedFees.length);
    const rows = unassignedFees.map((r) => `${r.coin} ${r.operationText} ${r.changeText} ${r.utcTime}`).join("; ");
    parserMessages.push({
      id: "binance.fee_unassigned",
      severity: "warning",
      message: `Binance: ${count} comisión(es) no dicen de qué operación del mismo segundo son, y DeclaRenta no las resta: ${rows}.`,
      hint: "Binance anota varias operaciones en el mismo segundo. Estas comisiones están entre dos operaciones de la misma moneda. Por eso DeclaRenta no sabe de cuál son. No las suma al coste ni las resta del importe de venta, y así no pagas de menos. Si sabes de qué compra o venta es cada comisión, corrige a mano en Renta Web su coste o su importe de venta.",
      context: { count, rows },
    });
  }
  // A negative income row takes a reward back. DeclaRenta does not know
  // which reward it cancels, so it changes no number, and each row is named
  // (#467): before, it was dropped with no word, and a later sale used the
  // reward's lot as if the coins were still held.
  const negativeIncome = rows.filter((r) => r.negativeIncome);
  if (negativeIncome.length > 0) {
    const count = String(negativeIncome.length);
    const rows = negativeIncome.map((r) => `${r.coin} ${r.operationText} ${r.changeText} ${r.utcTime}`).join("; ");
    parserMessages.push({
      id: "binance.income_negative",
      severity: "warning",
      message: `Binance: ${count} fila(s) de ingresos son negativas y no se calculan: ${rows}.`,
      hint: "Una fila de ingresos negativa suele ser una recompensa que Binance te ha retirado. DeclaRenta no sabe qué recompensa anula, así que no cambia ningún importe. Sigue contando esa recompensa como ingreso y sus monedas como compradas a su valor de ese día. Si anula un ingreso del año que declaras, quítalo a mano en Renta Web. Si después vendiste esa criptomoneda, el coste de la venta puede ser demasiado alto. Revisa en Renta Web el coste de esas ventas.",
      context: { count, rows },
    });
  }
  // A swap of one fiat currency for another (EUR to USD) is no crypto event,
  // and the FX engine reads only cash trades, so nothing books it. Each row
  // is named (#467), never dropped with no word.
  const fiatConversions = rows.filter((r) => r.fiatConversion);
  if (fiatConversions.length > 0) {
    const count = String(fiatConversions.length);
    const rows = fiatConversions.map((r) => `${r.coin} ${r.operationText} ${r.changeText} ${r.utcTime}`).join("; ");
    parserMessages.push({
      id: "binance.fiat_conversion_not_booked",
      severity: "warning",
      message: `Binance: ${count} fila(s) cambian una moneda oficial por otra (por ejemplo, euros por dólares) y no se calculan: ${rows}.`,
      hint: "DeclaRenta no calcula la ganancia o la pérdida por tipo de cambio de estos cambios de Binance. Cambiar una divisa por euros o por otra divisa puede dar una ganancia o una pérdida. Es la diferencia entre su valor en euros al cambiarla y lo que te costó en euros. Calcúlala y añádela a mano en Renta Web.",
      context: { count, rows },
    });
  }
  // A row still unparsed after every phase has an Operation no phase handles
  // (futures PnL, card spending, Auto-Invest, cashback...). It is left out of
  // the report, so name each operation with its row count instead of dropping
  // it silently.
  const unhandledOps = new Map<string, number>();
  for (const r of rows) {
    if (!r.parsed && !PAIRED_TX_OPS.has(r.operation)) unhandledOps.set(r.operation, (unhandledOps.get(r.operation) ?? 0) + 1);
  }
  if (unhandledOps.size > 0) {
    const unhandledCount = [...unhandledOps.values()].reduce((a, b) => a + b, 0);
    const operations = [...unhandledOps].map(([op, n]) => `${op} (${n})`).join(", ");
    parserMessages.push({
      id: "binance.unhandled_operation",
      severity: "warning",
      message: `Se ${unhandledCount === 1 ? "ha omitido 1 movimiento" : `han omitido ${unhandledCount} movimientos`} del CSV de Binance con operaciones no reconocidas: ${operations}.`,
      hint: "Estos movimientos no se han incluido en el cálculo. Si son compras, ventas o ingresos (p. ej. futuros, pagos con Binance Card, Auto-Invest o cashback), añádelos a mano en tu declaración y comunica el nombre de la operación para que se pueda incorporar.",
      context: { count: String(unhandledCount), operations },
    });
  }
  // A garbage UTC_Time that still has the date shape ("25-13-45 10:00:00")
  // gives no real day: such a trade is kept as a row that books nothing and
  // such an income row is taken out, each named (#467).
  markUndatedTrades(trades, "UTC_Time");
  parserMessages.push(...tradeQuantityUnknownMessages("Binance", trades), ...dropUndatedCash("Binance", cashTransactions, "UTC_Time"));

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
    ...(manualRateHints.length > 0 ? { manualRateHints } : {}),
    ...(parserMessages.length > 0 ? { parserMessages } : {}),
  };
}

/**
 * Name the rows of a coin that goes out and comes back in one Convert window
 * (#467). `netLegs` drops a coin whose rows net to zero, so two orders in one
 * ±1 s window, BTC → ETH and ETH → BTC, left nothing to pair: both disposals
 * vanished with no word, and the BTC lot kept its old cost. Which row belongs
 * to which order is a guess, so nothing is booked for that coin and each of
 * its rows is named (`binance.unpaired_leg`) for the user to add by hand.
 * Rows of one sign never sum to zero, so a coin with rows of one sign only
 * is never named here.
 */
function markRoundTrips(group: TxRow[]): void {
  const byCoin = new Map<string, TxRow[]>();
  for (const r of group) byCoin.set(r.coin, [...(byCoin.get(r.coin) ?? []), r]);
  for (const coinRows of byCoin.values()) {
    if (!coinRows.some((r) => r.change.isPositive()) || !coinRows.some((r) => r.change.isNegative())) continue;
    if (!coinRows.reduce((sum, r) => sum.plus(r.change), new Decimal(0)).isZero()) continue;
    for (const r of coinRows) r.unpaired = true;
  }
}

/** Sum signed quantity and EUR value per coin across a window of paired rows. */
function netLegs(window: TxRow[]): NetLeg[] {
  const byCoin = new Map<string, NetLeg>();
  for (const r of window) {
    const existing = byCoin.get(r.coin);
    if (existing) {
      existing.qty = existing.qty.plus(r.change);
      existing.eur = existing.eur === null || r.eurValue === null ? null : existing.eur.plus(r.eurValue);
      existing.rows!.push(r);
    } else {
      byCoin.set(r.coin, { coin: r.coin, qty: r.change, eur: r.eurValue, date: r.tradeDate, index: r.index, key: r.key, rows: [r] });
    }
  }
  // Drop coins whose net is zero (intra-account split rows that cancel out).
  return [...byCoin.values()].filter((l) => !l.qty.isZero());
}

type AddHint = (coin: string, date: string, qty: Decimal, eur: Decimal | null) => void;

/**
 * Pair net negative (sold) legs with net positive (bought) legs and emit.
 *
 * The two legs of one conversion have (near-)equal EUR value, so each sell is
 * matched to its CLOSEST-EUR remaining buy. This disambiguates two independent
 * conversions in the same ±1s window ONLY when their given-up (sell-side) coins
 * differ, so `netLegs` keeps them as separate sells (e.g. two Converts spending
 * different coins). When several disposals share one given-up coin — notably
 * `Buy Crypto With Fiat`, always funded in EUR/USD — `netLegs` merges them into
 * a single sell leg, leaving 1 sell vs N buys and all but one buy unpaired. The
 * caller should therefore pre-split such windows (step 4 sub-groups fiat buys by
 * funding-wallet Remark) before calling here; a merged leg that still meets a
 * leg left over is paired again row by row (#467). When EUR values are absent (all
 * 0), the closest match is the next available buy in order — equivalent to
 * insertion-order pairing, the previous behavior. That order is a guess when
 * a side has two or more legs to choose from: "Buy ETH, Buy BTC, Sell EUR
 * -11000, Sell USD -110" gave ETH the 11000 € with no word, and "Buy BTC, Buy
 * SOL, Sell USD -110" gave BTC the 110 USD although SOL sits next to it. So
 * when a pair is made from such a side and the EUR values do not decide it,
 * every row of the group (`rows`) is named (`binance.spot_cost_split`) unless
 * the file writes every leg in a pair of two adjacent rows (proveOrder,
 * #467). Returns the legs left without a counterpart, so the Convert path can
 * hand them back instead of losing them.
 */
function pairAndEmit(trades: Trade[], legs: NetLeg[], rows: TxRow[], addHint: AddHint, label: string, units?: FeeUnit[]): NetLeg[] {
  const sells = legs.filter((l) => l.qty.isNegative());
  const buys = legs.filter((l) => l.qty.isPositive());
  const usedBuys = new Set<number>();
  const unpaired: NetLeg[] = [];
  const pairs: [NetLeg, NetLeg][] = [];
  for (const sell of sells) {
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let j = 0; j < buys.length; j++) {
      if (usedBuys.has(j)) continue;
      const delta = Math.abs(absEur(sell) - absEur(buys[j]!));
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = j;
      }
    }
    if (bestIdx < 0) {
      unpaired.push(sell); // no buys left
      continue;
    }
    usedBuys.add(bestIdx);
    pairs.push([sell, buys[bestIdx]!]);
  }
  const left = [...unpaired, ...buys.filter((_, j) => !usedBuys.has(j))];
  // A paired leg netted from two or more rows of one sign, facing a leg left
  // over on the other side, may hold that leftover's counterpart: "Sell BTC,
  // Buy EUR" and "Sell BTC, Buy USDT" in one window net to one BTC leg, which
  // took the EUR alone, so the whole 0.2 BTC was sold for 3000 € (#467). Then
  // each row is its own leg and is paired with its own counterpart. That is
  // what the file says when it writes every pair as two adjacent rows
  // (proveOrder); otherwise the rows are named as a guess. A leg whose rows
  // cancel each other (an intra-account split) keeps the netted pairing.
  const leftSign = left[0]?.qty.isNegative();
  const oneSign = legs.every((l) => l.rows !== undefined && l.rows.every((r) => r.change.isNegative() === l.qty.isNegative()));
  const merged = left.length > 0 && oneSign && pairs.some((pair) => pair.some((l) => l.qty.isNegative() !== leftSign && l.rows!.length >= 2));
  if (merged) {
    const legRows = legs.flatMap((l) => l.rows ?? []).sort((a, b) => a.index - b.index);
    const rowLegs = legRows.map((r): NetLeg => ({ coin: r.coin, qty: r.change, eur: r.eurValue, date: r.tradeDate, index: r.index, key: r.key, rows: [r] }));
    return pairAndEmit(trades, rowLegs, legRows, addHint, label, units);
  }
  for (const [sell, buy] of pairs) {
    addHint(sell.coin, sell.date, sell.qty, sell.eur);
    addHint(buy.coin, buy.date, buy.qty, buy.eur);
    emitUnit(trades, sell, buy, label, units);
  }
  // Each leg one row of the group (no netting): the pairs are rows, and a
  // later window can prove a pairing that waits on one of them.
  const oneRowEach = rows.length === legs.length;
  const byKey = new Map(rows.map((r) => [r.key, r] as const));
  const rowPairs = oneRowEach ? pairs.map(([sell, buy]) => [byKey.get(sell.key)!, byKey.get(buy.key)!] as const) : [];
  for (const [a, b] of rowPairs) {
    a.partner = b;
    b.partner = a;
  }
  // Every leg with a nonzero EUR value: the closest-EUR match decides (the
  // documented disambiguation). Otherwise the order is a guess unless the
  // file writes every leg in a pair of two adjacent rows.
  const choice = pairs.length >= 1 && (sells.length >= 2 || buys.length >= 2);
  if (choice && !legs.every((l) => l.eur !== null && !l.eur.isZero())) {
    if (oneRowEach) proveOrder(rowPairs, left.map((l) => byKey.get(l.key)!), rows);
    else for (const r of rows) r.costSplitGuessed = true;
  }
  return left;
}

/**
 * Name every row of a window whose pairs are a guess (#467). With no leg left
 * over, the pairs are proven when the file writes them as adjacent rows
 * (writtenAsPairs). A leg left over can sit between a coin and the payment
 * paired with it ("Buy BTC, Buy SOL, Sell USD" does not say whether the USD
 * paid BTC or SOL), so the window waits: it is proven only if a later window
 * pairs every leftover and all those pairs together are adjacent rows. That
 * is a trade that starts in this window's last second and ends in the next
 * one ("Sold XRP, Revenue, Sold ADA" then "Revenue"). resolveLeftovers decides
 * once every window has run.
 */
function proveOrder(pairs: (readonly [TxRow, TxRow])[], leftovers: TxRow[], rows: TxRow[]): void {
  if (leftovers.length === 0) {
    if (!writtenAsPairs(pairs)) for (const r of rows) r.costSplitGuessed = true;
    return;
  }
  const pending: PendingPairing = { pairs, leftovers, rows };
  for (const l of leftovers) l.waitingPairings = [...(l.waitingPairings ?? []), pending];
}

/** Decide every window proveOrder left waiting on a leftover leg (#467). */
function resolveLeftovers(rows: TxRow[]): void {
  const pending = new Set(rows.flatMap((r) => r.waitingPairings ?? []));
  for (const p of pending) {
    const proven = p.leftovers.every((l) => l.partner !== undefined) &&
      writtenAsPairs([...p.pairs, ...p.leftovers.map((l) => [l, l.partner!] as const)]);
    if (!proven) for (const r of p.rows) r.costSplitGuessed = true;
  }
}

/**
 * Whether the file writes each pair as two adjacent rows: in file order, the
 * rows of all the pairs split into consecutive twos, each one of the pairs.
 * Rows outside the pairs (a fee, a leg of the other side) do not break a pair,
 * so the callers pass pairs that hold every leg row: a leg left over is a
 * guess before this is asked (#467).
 */
function writtenAsPairs(pairs: readonly (readonly [TxRow, TxRow])[]): boolean {
  const partner = new Map<TxRow, TxRow>();
  for (const [a, b] of pairs) {
    if (partner.has(a) || partner.has(b)) return false;
    partner.set(a, b);
    partner.set(b, a);
  }
  const ordered = [...partner.keys()].sort((x, y) => x.index - y.index);
  for (let k = 0; k < ordered.length; k += 2) {
    if (partner.get(ordered[k]!) !== ordered[k + 1]) return false;
  }
  return true;
}

function absEur(l: NetLeg): number {
  return l.eur ? Math.abs(l.eur.toNumber()) : 0;
}

/**
 * emitCryptoSwap, recording the order it booked (its leg rows and trades) in
 * `units` when given, so a spot fee can be tied to its own order (tieFees). A
 * spot order takes a fee in a coin one of its trades is in.
 */
function emitUnit(trades: Trade[], sell: NetLeg, buy: NetLeg, label: string, units: FeeUnit[] | undefined): void {
  const before = trades.length;
  emitCryptoSwap(trades, sell, buy, label);
  if (!units) return;
  const emitted = trades.slice(before);
  units.push({
    rows: [...(sell.rows ?? []), ...(buy.rows ?? [])],
    trades: emitted,
    takes: (coin) => emitted.some((t) => t.symbol === coin || t.currency === coin),
  });
}

/**
 * Emit a crypto leg-pair. If one side is genuine FIAT (not a stablecoin), the
 * trade is a plain acquisition/disposal in that fiat currency (NOT a permuta) —
 * this prevents the FIFO engine from hunting for nonexistent "EUR lots". If both
 * sides are crypto (incl. stablecoins), emit the two-leg permuta. A both-fiat
 * conversion books nothing: its rows are flagged `fiatConversion` and named.
 */
function emitCryptoSwap(trades: Trade[], sell: NetLeg, buy: NetLeg, label: string): void {
  const sellQty = sell.qty.abs();
  const buyQty = buy.qty.abs();
  if (sellQty.isZero() || buyQty.isZero()) return;
  const sellFiat = isFiat(sell.coin);
  const buyFiat = isFiat(buy.coin);

  // A swap of one fiat currency for another is no crypto event, and the FX
  // engine reads only cash trades, so nothing books it. Its rows are named
  // (binance.fiat_conversion_not_booked), never dropped with no word (#467).
  if (sellFiat && buyFiat) {
    for (const r of [...(sell.rows ?? []), ...(buy.rows ?? [])]) r.fiatConversion = true;
    return;
  }

  if (sellFiat && !buyFiat) {
    // Spent fiat to acquire crypto → single BUY priced in fiat.
    trades.push({
      ...CRYPTO_TRADE_BASE,
      tradeID: `binance-tx-buy-${buy.date}-${buy.coin}-${buy.key}`,
      symbol: buy.coin,
      description: `${label} ${sell.coin} to ${buy.coin}`,
      currency: sell.coin,
      tradeDate: buy.date,
      settlementDate: buy.date,
      quantity: buyQty.toString(),
      tradePrice: sellQty.div(buyQty).toString(),
      tradeMoney: sellQty.toString(),
      proceeds: "0",
      cost: sellQty.toString(),
      buySell: "BUY",
      openCloseIndicator: "O",
      commissionCurrency: sell.coin,
      commission: "0",
    });
    return;
  }

  if (!sellFiat && buyFiat) {
    // Sold crypto for fiat → single SELL priced in fiat.
    trades.push({
      ...CRYPTO_TRADE_BASE,
      tradeID: `binance-tx-sell-${sell.date}-${sell.coin}-${sell.key}`,
      symbol: sell.coin,
      description: `${label} ${sell.coin} to ${buy.coin}`,
      currency: buy.coin,
      tradeDate: sell.date,
      settlementDate: sell.date,
      quantity: sell.qty.toString(),
      tradePrice: buyQty.div(sellQty).toString(),
      tradeMoney: buyQty.toString(),
      proceeds: buyQty.toString(),
      cost: "0",
      buySell: "SELL",
      openCloseIndicator: "C",
      commissionCurrency: buy.coin,
      commission: "0",
    });
    return;
  }

  // Both crypto → permuta: SELL the given-up coin, BUY the received coin.
  trades.push({
    ...CRYPTO_TRADE_BASE,
    tradeID: `binance-tx-sell-${sell.date}-${sell.coin}-${sell.key}`,
    symbol: sell.coin,
    description: `${label} ${sell.coin} to ${buy.coin}`,
    currency: buy.coin,
    tradeDate: sell.date,
    settlementDate: sell.date,
    quantity: sell.qty.toString(),
    tradePrice: buyQty.div(sellQty).toString(),
    tradeMoney: buyQty.toString(),
    proceeds: buyQty.toString(),
    cost: "0",
    buySell: "SELL",
    openCloseIndicator: "C",
    commissionCurrency: buy.coin,
    commission: "0",
  });
  trades.push({
    ...CRYPTO_TRADE_BASE,
    tradeID: `binance-tx-buy-${buy.date}-${buy.coin}-${buy.key}`,
    symbol: buy.coin,
    description: `${label} ${sell.coin} to ${buy.coin}`,
    currency: sell.coin,
    tradeDate: buy.date,
    settlementDate: buy.date,
    quantity: buyQty.toString(),
    tradePrice: sellQty.div(buyQty).toString(),
    tradeMoney: sellQty.toString(),
    proceeds: "0",
    cost: sellQty.toString(),
    buySell: "BUY",
    openCloseIndicator: "O",
    commissionCurrency: sell.coin,
    commission: "0",
  });
}

/**
 * Emit Strategy trades from a window: pair each Transaction Sold with a Revenue,
 * and each Buy with a Spend (by order, all of them — not just the first). The
 * k-th with the k-th is a guess when a side has two or more rows to choose
 * from: "Buy ETH, Buy BTC, Spend -11000, Spend -110" gave ETH the 11000 € with
 * no word. Then the rows are named (`binance.spot_cost_split`) unless the
 * choice cannot change a lot or the file writes each pair as two adjacent
 * rows (pairByOrder, #467). Fees in
 * the acquired/received coin reduce cost / proceeds; each fee row goes to the
 * order the file writes it beside, once (tieFees). A Sold/Revenue/Buy/Spend
 * leg left without a counterpart is handed back (parsed = false): when the next
 * trade starts in this window's last second, its first leg lands here but its
 * counterpart sits one second later, so a later window must be able to take it.
 * A leg no window pairs stays unparsed and is reported as an unhandled movement.
 */
function emitStrategyTrades(trades: Trade[], window: TxRow[], addHint: AddHint): void {
  const sold = window.filter((r) => r.operation === "transaction sold");
  const revenue = window.filter((r) => r.operation === "transaction revenue");
  const bought = window.filter((r) => r.operation === "transaction buy");
  const spend = window.filter((r) => r.operation === "transaction spend");
  const fees = window.filter((r) => r.operation === "transaction fee");
  window.forEach((r) => (r.parsed = true));

  const nSell = Math.min(sold.length, revenue.length);
  const nBuy = Math.min(bought.length, spend.length);
  pairByOrder(sold, revenue);
  pairByOrder(bought, spend);
  const units: FeeUnit[] = [];
  // A sale's fee is in the coin received, a purchase's in the coin bought.
  const emit = (given: TxRow, received: TxRow, feeCoin: string, label: string): void => {
    addHint(given.coin, given.tradeDate, given.change, given.eurValue);
    addHint(received.coin, received.tradeDate, received.change, received.eurValue);
    const before = trades.length;
    emitCryptoSwap(
      trades,
      { coin: given.coin, qty: given.change, eur: given.eurValue, date: given.tradeDate, index: given.index, key: given.key, rows: [given] },
      { coin: received.coin, qty: received.change, eur: received.eurValue, date: received.tradeDate, index: received.index, key: received.key, rows: [received] },
      label,
    );
    units.push({ rows: [given, received], trades: trades.slice(before), takes: (coin) => coin === feeCoin });
  };
  for (let k = 0; k < nSell; k++) emit(sold[k]!, revenue[k]!, revenue[k]!.coin, "Sell");
  for (let k = 0; k < nBuy; k++) emit(spend[k]!, bought[k]!, bought[k]!.coin, "Buy");

  // The fee goes on the last trade its own order emitted, never on a trade
  // of another order (#467).
  for (const [unit, feeRows] of tieFees(window.filter((r) => r.operation !== "transaction fee"), units, fees)) {
    const last = unit.trades[unit.trades.length - 1]!;
    for (const f of feeRows) {
      last.commission = new Decimal(last.commission || "0").minus(f.change.abs()).toString();
      last.commissionCurrency = f.coin;
    }
  }

  for (const r of [...sold.slice(nSell), ...revenue.slice(nSell), ...bought.slice(nBuy), ...spend.slice(nBuy)]) {
    r.parsed = false;
  }
}

/** One order a trade phase booked: its leg rows, the trades it emitted, and the fee coins it takes. */
interface FeeUnit {
  rows: TxRow[];
  trades: Trade[];
  takes: (coin: string) => boolean;
}

/**
 * Tie each fee row of a window to the order it belongs to (#467). Binance
 * writes an order's rows together, the fee first, between or last, so a fee
 * belongs to an order whose rows sit next to it. A fee in a coin that only
 * one order of the window takes goes to that order. When several orders take
 * it, it goes to the one the file writes it beside: of the nearest leg rows
 * before and after it (`legs`, fees left out), each belongs to one order and
 * exactly one of those orders takes the coin. Otherwise ("Buy BTC, Sell EUR,
 * Fee EUR, Buy ETH, Sell EUR, Fee EUR": the first fee sits between both
 * orders) the file does not say whose fee it is. It is deducted from no
 * order, which can only raise a gain or lower a loss, and flagged
 * `feeUnassigned`, so binance.fee_unassigned names it. Before, every pair
 * took the first fee row of its coin, or the last trade took them all, with
 * no word. A fee in a coin no order takes stays dropped, as before.
 */
function tieFees(legs: TxRow[], units: FeeUnit[], fees: TxRow[]): Map<FeeUnit, TxRow[]> {
  // null: a row two orders share (an equal split), so it ties no fee.
  const owner = new Map<TxRow, FeeUnit | null>();
  for (const u of units) for (const r of u.rows) owner.set(r, owner.has(r) && owner.get(r) !== u ? null : u);
  const ordered = [...legs].sort((x, y) => x.index - y.index);
  const tied = new Map<FeeUnit, TxRow[]>();
  for (const f of fees) {
    const takers = units.filter((u) => u.trades.length > 0 && u.takes(f.coin));
    if (takers.length === 0) continue;
    let unit = takers.length === 1 ? takers[0] : undefined;
    if (!unit) {
      const beside = [ordered.filter((r) => r.index < f.index).at(-1), ordered.find((r) => r.index > f.index)]
        .filter((r) => r !== undefined)
        .map((r) => owner.get(r));
      const fit = new Set(beside.filter((u) => u && takers.includes(u)));
      if (fit.size === 1 && beside.every((u) => u)) unit = [...fit][0]!;
    }
    if (!unit) {
      f.feeUnassigned = true;
      continue;
    }
    tied.set(unit, [...(tied.get(unit) ?? []), f]);
  }
  return tied;
}

/**
 * Strategy pairs the k-th row of `a` with the k-th of `b` (all the rows of
 * each side, the leftovers too). This records the pairs (partner). When a
 * side has two or more rows to choose from, which row goes with which is a
 * guess, and every row of both sides is named (#467), unless one of two
 * things holds:
 * - the choice cannot change a lot: one coin on each side, every row of `b`
 *   the same amount, and, when `a` keeps a leftover, every row of `a` too.
 *   FIFO keeps one lot per Buy row, so "Buy ETH 1, Buy ETH 2, Spend -100,
 *   Spend -200" is a guess: a later sale of 1 ETH costs 100 € or 200 €.
 * - the file writes each pair as two adjacent rows, with any leftover paired
 *   next to its own counterpart by a later window (proveOrder).
 */
function pairByOrder(a: TxRow[], b: TxRow[]): void {
  const n = Math.min(a.length, b.length);
  const pairs = a.slice(0, n).map((r, k) => [r, b[k]!] as const);
  for (const [x, y] of pairs) {
    x.partner = y;
    y.partner = x;
  }
  if (n === 0 || (a.length < 2 && b.length < 2)) return;
  const same = (side: TxRow[], amountToo: boolean): boolean =>
    side.every((r) => r.coin === side[0]!.coin && (!amountToo || r.change.equals(side[0]!.change)));
  if (same(b, true) && same(a, a.length > b.length)) return;
  proveOrder(pairs, [...a.slice(n), ...b.slice(n)], [...a, ...b]);
}

/**
 * Emit plain SPOT trades from a ±1s window of `Buy`/`Sell`/`Sell Crypto to Fiat`
 * (+ `Fee`) rows. Pairs by SIGN via netLegs/pairAndEmit (the same path as Convert),
 * so a fiat leg yields a single fiat-priced trade and a crypto-only pair yields a
 * permuta. `Sell Crypto to Fiat` carries a unique funding-wallet Remark per cash-out,
 * so those rows are sub-grouped by Remark first (two same-second cash-outs of
 * different coins each get their own EUR leg, never merged). Bare `Buy`/`Sell` have
 * an empty Remark; their same-second multi-fills are of the SAME bought coin paying
 * the SAME fiat, so per-coin netting is correct. Fees are attached to the matching
 * trade of their own order (tieFees); a fee in a coin with no ECB rate (e.g. BNB
 * third-coin fee) is dropped as immaterial dust, consistent with the `BNB Fee
 * Deduction` policy.
 */
function emitSpotTrades(trades: Trade[], window: TxRow[], addHint: AddHint): void {
  window.forEach((r) => (r.parsed = true));
  const fees = window.filter((r) => r.operation === SPOT_FEE_OP && !r.change.isZero());
  const tradeRows = window.filter((r) => r.operation !== SPOT_FEE_OP);

  // Sub-group so unrelated legs never net together. `Sell Crypto to Fiat` carries a
  // unique funding-wallet Remark per cash-out → key by it (namespaced so an EMPTY
  // remark can't collide with bare Buy/Sell). Bare `Buy`/`Sell` share one bucket.
  const byRemark = new Map<string, TxRow[]>();
  for (const r of tradeRows) {
    const key = r.operation === "sell crypto to fiat" ? `scf:${r.remark}` : "spot:";
    if (!byRemark.has(key)) byRemark.set(key, []);
    byRemark.get(key)!.push(r);
  }

  const units: FeeUnit[] = [];
  for (const group of byRemark.values()) {
    // A leg its window could not pair stays consumed (no later window pairs
    // it across seconds) but is flagged, so it is named (#467).
    for (const leg of emitBareSpotGroup(trades, group, addHint, units)) {
      for (const r of leg.rows ?? []) r.unpaired = true;
    }
  }

  // Attach each fee to the trade of its own order whose coin matches the fee coin.
  // The FIFO engine homogenizes a commission to EUR via its ECB rate, so only a fee
  // in a genuinely ECB-resolvable coin (fiat or stablecoin) can be valued — attach those
  // (a fiat/stablecoin sell/buy fee correctly adjusts cost/proceeds, Art. 35.1.b/35.2,
  // DGT V1604-18). A fee in a non-resolvable coin (a BNB third-coin fee, or the bought
  // alt-coin itself) has no EUR rate and is sub-cent dust → drop it, consistent with the
  // `BNB Fee Deduction` policy; dropping a buy fee only understates cost → overstates
  // gain (conservative, never underpays). Fees ACCUMULATE (a trade can carry several
  // partial-fill fee rows). With two or more orders in the fee coin, the fee goes to
  // the order the file writes it beside, else to none and it is named (tieFees, #467):
  // before, the last trade of the window took every fee ("Buy BTC, Sell EUR, Fee -5,
  // Buy ETH, Sell EUR, Fee -1" gave ETH both fees with no word).
  const valued = fees.filter((f) => isEcbResolvable(f.coin)); // crypto/dust fee — immaterial, no rate
  for (const [unit, feeRows] of tieFees(tradeRows, units, valued)) {
    for (const f of feeRows) {
      const target = [...unit.trades].reverse().find((t) => t.symbol === f.coin || t.currency === f.coin)!;
      const prior = new Decimal(target.commission || "0"); // emitCryptoSwap sets "0"
      target.commission = prior.minus(f.change.abs()).toString();
      target.commissionCurrency = f.coin;
    }
  }
}

/**
 * Whether the file writes each payment next to its fill: in file order, the
 * rows split into consecutive pairs of one received row and one payment row.
 * Then the k-th received row and the k-th payment are one order, so pairing
 * them by order is what the file says, not a guess (#467).
 */
function paymentsBesideFills(legRows: TxRow[]): boolean {
  const ordered = [...legRows].sort((a, b) => a.index - b.index);
  if (ordered.length % 2 !== 0) return false;
  for (let k = 0; k < ordered.length; k += 2) {
    if (ordered[k]!.change.isPositive() === ordered[k + 1]!.change.isPositive()) return false;
  }
  return true;
}

/**
 * Emit the trades for one spot sub-group, pairing received (positive) legs with
 * given-up (negative) legs. Same-coin multi-fills are netted per coin first.
 *
 * The hazard this guards against (the documented lot-drop bug): when TWO different
 * coins are bought in the same second BOTH paying the same fiat (e.g. `Buy BTC` +
 * `Buy ADA` + two `Sell EUR`), a single `netLegs`+`pairAndEmit` would merge the two
 * EUR sells into one leg → 1 sell vs 2 buys → `pairAndEmit` drops a coin's lot (the
 * very phantom "Venta sin lotes" this parser exists to prevent). So when >1 distinct
 * coin is received against a single given-up fiat, we pair each received coin with an
 * individual given-up leg BY ORDER (the real export lists N buys against N sells), and
 * never drop: every bought coin keeps a real, non-zero cost basis. The aggregate fiat
 * spent is exact; only the per-coin split is approximate when the export doesn't link
 * order-to-order (each payment written next to its fill, see paymentsBesideFills),
 * and then every leg of the group is named (`binance.spot_cost_split`) rather than
 * a cost-basis-0 phantom gain.
 * Returns the legs left without a counterpart, so the caller can name them.
 */
function emitBareSpotGroup(trades: Trade[], rows: TxRow[], addHint: AddHint, units: FeeUnit[]): NetLeg[] {
  const recv = netLegs(rows.filter((r) => r.change.isPositive())).sort((a, b) => a.index - b.index);
  const give = netLegs(rows.filter((r) => r.change.isNegative())).sort((a, b) => a.index - b.index);

  // One (or zero) received coin, or a multi-currency given-up side → the existing
  // closest-EUR pairing is correct (and merges same-coin multi-fills cleanly).
  const giveSingleFiat = give.length === 1 && isFiat(give[0]!.coin);
  if (recv.length <= 1 || !giveSingleFiat) {
    return pairAndEmit(trades, [...give, ...recv], rows, addHint, "Spot", units);
  }

  // Multiple distinct bought coins sharing ONE fiat leg. Split the fiat across them
  // so none is dropped. When the export gives one fiat row per received row (one
  // payment per fill, the common case), pair them 1:1 by order and give each coin
  // the sum of its fills' payments. That pairing is exact only when the file
  // writes each payment next to its fill (the real export lists each order's rows
  // together, in either order); equal counts alone prove nothing ("Buy ETH, Buy
  // BTC, Sell 100, Sell 10000" gave ETH the 10000). Otherwise the export does not
  // say which payment goes with which coin: pair by order when the counts match,
  // else by coin when that count matches, else split the netted fiat equally. The
  // total paid stays exact, but each coin's cost is a guess, so every leg of the
  // group is named (#467): a guess that gave one order's cost to another coin
  // overstated its loss with no word.
  const fiatRows = rows
    .filter((r) => r.change.isNegative() && isFiat(r.coin))
    .sort((a, b) => a.index - b.index);
  const recvRows = rows.filter((r) => r.change.isPositive()).sort((a, b) => a.index - b.index);
  if (fiatRows.length === recvRows.length) {
    if (!paymentsBesideFills([...recvRows, ...fiatRows])) for (const r of rows) r.costSplitGuessed = true;
    const paid = new Map<string, TxRow[]>();
    recvRows.forEach((r, k) => paid.set(r.coin, [...(paid.get(r.coin) ?? []), fiatRows[k]!]));
    for (const r of recv) {
      const legs = paid.get(r.coin)!;
      const g = legs[0]!;
      const qty = legs.reduce((sum, l) => sum.plus(l.change), new Decimal(0));
      const eur = legs.some((l) => l.eurValue === null) ? null : legs.reduce((sum, l) => sum.plus(l.eurValue!), new Decimal(0));
      const sell: NetLeg = { coin: g.coin, qty, eur, date: g.tradeDate, index: g.index, key: g.key, rows: legs };
      addHint(sell.coin, sell.date, sell.qty, sell.eur);
      addHint(r.coin, r.date, r.qty, r.eur);
      emitUnit(trades, sell, r, "Spot", units);
    }
    return [];
  }
  for (const r of rows) r.costSplitGuessed = true;
  if (fiatRows.length === recv.length) {
    for (let k = 0; k < recv.length; k++) {
      const r = recv[k]!;
      const g = fiatRows[k]!;
      const sell: NetLeg = { coin: g.coin, qty: g.change, eur: g.eurValue, date: g.tradeDate, index: g.index, key: g.key, rows: [g] };
      addHint(sell.coin, sell.date, sell.qty, sell.eur);
      addHint(r.coin, r.date, r.qty, r.eur);
      emitUnit(trades, sell, r, "Spot", units);
    }
    return [];
  }
  // Neither count matches (rare): split the total fiat equally across the received coins.
  const totalFiat = give[0]!.qty; // negative
  const share = totalFiat.div(recv.length);
  for (const r of recv) {
    const sell: NetLeg = { coin: give[0]!.coin, qty: share, eur: null, date: give[0]!.date, index: give[0]!.index, key: give[0]!.key, rows: give[0]!.rows };
    addHint(r.coin, r.date, r.qty, r.eur);
    emitUnit(trades, sell, r, "Spot", units);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Trade History parser (Date(UTC),Pair,Side,Price,Executed,Amount,Fee)
// ---------------------------------------------------------------------------

function parseBinanceCsv(lines: string[]): Statement {
  const headers = parseCsvLine(lines[0]!, ",");
  const cols = resolveColumns(headers);

  if (cols.date < 0 || cols.pair < 0 || cols.side < 0 || cols.price < 0 || cols.executed < 0 || cols.amount < 0) {
    throw new Error("Binance CSV: faltan columnas obligatorias (Date(UTC), Pair, Side, Price, Executed, Amount)");
  }

  const trades: Trade[] = [];
  const unsupportedPairs = new Map<string, number>();
  /** Each row left out for its pair, named as "date side executed [Pair: cell]" (#467). */
  const unsupportedRows: string[] = [];
  const seenKeys = new Map<string, number>();
  // The columns the header names: a trailing empty header cell names none.
  const headerWidth = headers.reduce((width, h, idx) => (h.trim() !== "" ? idx + 1 : width), 0);

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, ",");

    const dateStr = (fields[cols.date] ?? "").trim();
    const tradeDate = convertBinanceDate(dateStr);
    const tradeTime = timeOfDay(dateStr);

    const pairStr = (fields[cols.pair] ?? "").trim();
    const pair = parsePair(pairStr);
    if (!pair) {
      // One pair we cannot split must not abort the whole export: skip the row
      // and name it in a warning so the user can add it by hand. Each row is
      // named by date, side and amount: an empty Pair alone named nothing.
      unsupportedPairs.set(pairStr, (unsupportedPairs.get(pairStr) ?? 0) + 1);
      unsupportedRows.push(`${tradeDate} ${(fields[cols.side] ?? "").trim()} ${(fields[cols.executed] ?? "").trim()} [${unreadableCell((headers[cols.pair] ?? "").trim(), pairStr)}]`);
      continue;
    }
    const { symbol, currency } = pair;

    const sideLower = (fields[cols.side] ?? "").trim().toLowerCase();
    // A row whose Side is neither BUY nor SELL, whose Executed cannot be read,
    // (for a crypto-quoted pair) whose Amount cannot be read, or (for a
    // fiat-quoted pair) whose Price and Amount both cannot be read, may hide a
    // gain, a loss or an art. 33.5.e repurchase: it is kept as a trade that
    // books nothing for each coin it names, and named by its cell, never
    // skipped with no word or booked as zero units (#467).
    // Executed is in the coin bought or sold, Amount and Price in the quote
    // (readCoinAmount).
    // A row with more cells than the header, past it not empty, had a comma
    // inside an unquoted cell ("1,5BTC"): every cell after it moved one
    // column on, so Executed "1" and a Fee of the Amount were booked with no
    // word (1 BTC instead of 1.5, #467). Whether "1,5" is 1.5 or 15 the file
    // does not say, so the row is named by its numeric cells as written. A
    // trailing empty cell (a trailing comma) moves nothing.
    // With an empty Fee the split leaves only an empty cell past the header,
    // as a trailing comma does. Every row Binance writes squares: Price ×
    // Executed gives Amount. So a row with a cell past the header is shifted
    // too when it does not square ("1.234,5XRP" read as Executed "1.234" and
    // Amount "5XRP"), or when it squares once two numeric cells are read as
    // one number with a comma ("5.00,1,5,7.50": 5.00 × 1 = 5 by chance, but
    // 5.00 × 1,5 = 7.50). Before, both were booked with the Amount as the Fee
    // (verify of 8ba74cd, #467).
    const numericFrom = Math.min(...[cols.price, cols.executed, cols.amount, cols.fee].filter((c) => c >= 0));
    const executedCell = readCoinAmount(fields[cols.executed], [symbol]);
    const amountCell = readCoinAmount(fields[cols.amount], [currency]);
    const priceCell = readCoinAmount(fields[cols.price], [currency]);
    const squaresAt = (p: string | undefined, e: string | undefined, a: string | undefined): boolean => {
      if (p === undefined || e === undefined || a === undefined) return false;
      const written = new Decimal(a);
      return new Decimal(p).mul(e).minus(written).abs().lessThanOrEqualTo(written.abs().mul("0.01"));
    };
    /** A comma number written as two cells: "1,5", "1.234,5" (comma decimal) or "1,234.5" (thousands). */
    const commaNumber = (first: string, second: string): string | undefined => {
      const text = `${first},${second.replace(/[A-Za-z]+$/, "")}`;
      const plain = /^\d{1,3}(\.\d{3})*,\d+$/.test(text) || /^\d+,\d+$/.test(text) ? text.replace(/\./g, "").replace(",", ".")
        : /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text) ? text.replace(/,/g, "") : undefined;
      // A second part that adds nothing ("5,0") reads as the first cell alone.
      return plain !== undefined && !new Decimal(plain).equals(first) ? plain : undefined;
    };
    const joinedSquares = (): boolean => [cols.price, cols.executed, cols.amount].some((c) => {
      if (c < 0) return false;
      const first = (fields[c] ?? "").trim();
      const second = (fields[c + 1] ?? "").trim();
      if (!/^\d+(\.\d+)?$/.test(first) || second === "") return false;
      // Amount and a Fee in a coin ("40000" and "1EUR", then a trailing
      // comma) read the same as an Amount of "40000,1EUR" split before an
      // empty Fee: the file cannot tell them apart, and the row Binance
      // writes is the first, so it keeps its booking. A bare second part
      // ("2000" and "99") is no Fee Binance writes, so it is joined.
      if (c === cols.amount && !/^\d+$/.test(second)) return false;
      const joined = commaNumber(first, second);
      if (joined === undefined) return false;
      const cells = [...fields.slice(0, c), joined, ...fields.slice(c + 2)];
      const read = (col: number, coin: string): string | undefined => col === c ? joined : readCoinAmount(cells[col], [coin])?.amount;
      return squaresAt(read(cols.price, currency), read(cols.executed, symbol), read(cols.amount, currency));
    });
    const shifted = fields.slice(headerWidth).some((f) => f.trim() !== "") ||
      (fields.length > headerWidth && (!squaresAt(priceCell?.amount, executedCell?.amount, amountCell?.amount) || joinedSquares()));
    const badCell = shifted ? numericFrom
      : sideLower !== "buy" && sideLower !== "sell" ? cols.side
      : !executedCell ? cols.executed
      : !isFiat(currency) && !amountCell ? cols.amount
      : isFiat(currency) && !priceCell && !amountCell ? cols.price
      : -1;
    if (badCell >= 0) {
      const cell = shifted
        ? unreadableCell(headers.slice(numericFrom).map((h) => h.trim()).filter((h) => h).join(","), fields.slice(numericFrom).join(","))
        : unreadableCell((headers[badCell] ?? "").trim(), fields[badCell]);
      // The side when the row gives one: the coin bought, and on a
      // crypto-quoted pair the quote coin given up for it (or the reverse).
      const side = sideLower === "buy" || sideLower === "sell" ? sideLower : undefined;
      const legs: { symbol: string; currency: string; buySell?: "BUY" | "SELL" }[] = [
        { symbol, currency, ...(side ? { buySell: side === "buy" ? "BUY" as const : "SELL" as const } : {}) },
      ];
      if (!isFiat(currency)) legs.push({ symbol: currency, currency: symbol, ...(side ? { buySell: side === "buy" ? "SELL" as const : "BUY" as const } : {}) });
      const key = occurrenceKey(seenKeys, [dateStr, pairStr, ...[cols.side, cols.price, cols.executed, cols.amount, cols.fee].map((c) => (fields[c] ?? "").trim())].join("|"));
      for (const leg of legs) {
        trades.push(unreadableTrade({
          tradeID: `binance-${tradeDate}-${leg.symbol}-${key}`, symbol: leg.symbol, description: `${symbol}/${currency}`, isin: "",
          assetCategory: "CRYPTO", currency: leg.currency, tradeDate, tradeTime, exchange: "BINANCE",
          ...(leg.buySell ? { buySell: leg.buySell } : {}),
        }, cell));
      }
      continue;
    }
    const isBuy = sideLower === "buy";

    // Guard against new Decimal("NaN"/"Infinity") — it does NOT throw and a
    // non-finite price/qty silently poisons every casilla total. parseEu=false
    // keeps the original raw-string parse (these cells are plain decimals; the
    // suffix-parsed ones are already normalized to [0-9.]+).
    const executed = toFiniteDecimal(executedCell!.amount, "0", false);
    const amount = toFiniteDecimal(amountCell?.amount ?? "0", "0", false);
    // FIFO values a fiat-quoted trade at Price × Executed. A Price it cannot
    // read ("", "abc", "30,000.00") was read as 0, so a sale booked no
    // proceeds and a full loss with no word. Then the price is Amount ÷
    // Executed, the file's own numbers (#467). A written zero stays the
    // file's word, and a row of zero units moves nothing whatever its price.
    const price = priceCell
      ? toFiniteDecimal(priceCell.amount, "0", false)
      : executed.isZero() ? new Decimal(0) : amount.div(executed);

    const fee = parseFee(fields[cols.fee] ?? "", [symbol, currency, "BNB"]);
    const feeAmount = toFiniteDecimal(fee.amount || "0", "0", false);

    const key = occurrenceKey(seenKeys, [dateStr, pairStr, sideLower, ...[cols.price, cols.executed, cols.amount, cols.fee].map((c) => (fields[c] ?? "").trim())].join("|"));

    // A crypto-quoted pair (ETHBTC, CTKBTC, SOLUSDT) is a permuta (Art. 37.1.h
    // LIRPF): the coin given up is disposed of and the coin received gets a lot.
    // Route it through the same two-leg emitter as the Transaction History path;
    // the row's fee stays on the base-coin trade. Fiat-quoted rows are unchanged.
    if (!isFiat(currency)) {
      const baseLeg: NetLeg = { coin: symbol, qty: isBuy ? executed : executed.neg(), eur: null, date: tradeDate, index: i, key };
      const quoteLeg: NetLeg = { coin: currency, qty: isBuy ? amount.neg() : amount, eur: null, date: tradeDate, index: i, key };
      const before = trades.length;
      if (isBuy) emitCryptoSwap(trades, quoteLeg, baseLeg, "Spot");
      else emitCryptoSwap(trades, baseLeg, quoteLeg, "Spot");
      const emitted = trades.slice(before);
      for (const t of emitted) t.tradeTime = tradeTime;
      const target = emitted.find((t) => t.symbol === symbol) ?? emitted[0];
      if (target) {
        target.commissionCurrency = fee.asset || currency;
        target.commission = feeAmount.isZero() ? "0" : feeAmount.neg().toString();
      }
      continue;
    }

    trades.push({
      tradeID: `binance-${tradeDate}-${symbol}-${key}`,
      accountId: "",
      symbol,
      description: `${symbol}/${currency} ${sideLower.toUpperCase()}`,
      // Crypto has no ISIN. Leave empty so wash-sale keys on CRYPTO:${symbol}
      // and never collides with a real ISIN-keyed security.
      isin: "",
      assetCategory: "CRYPTO",
      currency,
      tradeDate,
      tradeTime,
      settlementDate: tradeDate,
      quantity: isBuy ? executed.toString() : executed.neg().toString(),
      tradePrice: price.toString(),
      tradeMoney: isBuy ? amount.neg().toString() : amount.toString(),
      proceeds: isBuy ? "0" : amount.toString(),
      cost: isBuy ? amount.toString() : "0",
      fifoPnlRealized: "0",
      fxRateToBase: currency === "EUR" ? "1" : "1",
      buySell: isBuy ? "BUY" : "SELL",
      openCloseIndicator: isBuy ? "O" : "C",
      exchange: "BINANCE",
      commissionCurrency: fee.asset || currency,
      commission: feeAmount.isZero() ? "0" : feeAmount.neg().toString(),
      taxes: "0",
      multiplier: "1",
      brokerSource: "Binance",
    });
  }

  const parserMessages: TaxMessage[] = [];
  if (unsupportedPairs.size > 0) {
    const count = [...unsupportedPairs.values()].reduce((a, b) => a + b, 0);
    const pairs = [...unsupportedPairs.keys()].join(", ");
    const rows = unsupportedRows.join("; ");
    parserMessages.push({
      id: "binance.unsupported_pair",
      severity: "warning",
      message: `DeclaRenta ha omitido ${count === 1 ? "1 operación" : `${count} operaciones`} del CSV de Binance con un par no reconocido: ${rows}.`,
      hint: "Entre corchetes va la celda del par. DeclaRenta no ha incluido estas operaciones en el cálculo. Añádelas a mano en tu declaración y comunica el par para que DeclaRenta lo incorpore.",
      context: { count: String(count), pairs, rows },
    });
  }
  markUndatedTrades(trades, "Date(UTC)");
  parserMessages.push(...tradeQuantityUnknownMessages("Binance", trades));

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
// Public BrokerParser
// ---------------------------------------------------------------------------

export const binanceParser: BrokerParser = {
  name: "Binance",
  formats: ["CSV"],

  detect(input: string): boolean {
    const lines = stripBom(input).split(/\r?\n/);
    return lines.slice(0, 10).some((l) => isBinanceCsv(l));
  },

  parse(input: string): Statement {
    const cleaned = stripBom(input);
    const allLines = cleaned.split(/\r?\n/);
    // Find header line (may be preceded by metadata preamble)
    const tradeIdx = allLines.findIndex((l) => isBinanceTradeCsv(l));
    const txIdx = allLines.findIndex((l) => isBinanceTxCsv(l));
    const headerIdx = tradeIdx >= 0 ? tradeIdx : txIdx;
    if (headerIdx === -1) {
      const hasContent = allLines.some((l) => l.trim());
      throw new Error(hasContent ? "Binance CSV: formato no reconocido" : "Binance CSV: fichero vacío o sin datos");
    }
    const lines = allLines.slice(headerIdx).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error("Binance CSV: fichero vacío o sin datos");
    }

    return txIdx >= 0 && tradeIdx < 0 ? parseBinanceTxCsv(lines) : parseBinanceCsv(lines);
  },
};
