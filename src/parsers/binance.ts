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
import { parseCsvLine, stripBom, toFiniteDecimal } from "./csv-utils.js";

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

const KNOWN_QUOTES = ["FDUSD", "USDT", "USDC", "BUSD", "EUR", "USD", "BTC", "ETH", "BNB", "GBP", "TRY", "BRL", "ARS"];

function parsePair(pair: string): { symbol: string; currency: string } {
  const upper = pair.trim().toUpperCase();

  // Try known quote currencies from longest to shortest for correct matching
  const sorted = [...KNOWN_QUOTES].sort((a, b) => b.length - a.length);
  for (const quote of sorted) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return {
        symbol: upper.slice(0, -quote.length),
        currency: quote,
      };
    }
  }

  throw new Error(`Binance CSV: par no soportado o ambiguo: ${pair}`);
}

// ---------------------------------------------------------------------------
// Fee parsing: "0.001BTC" -> { amount: "0.001", asset: "BTC" }
// ---------------------------------------------------------------------------

/** Extract numeric value from strings like "285.7CTK" or "0.001BTC" or plain "42000.00" */
function parseAmountWithSuffix(str: string): { amount: string; asset: string } {
  const trimmed = str.trim();
  if (!trimmed) return { amount: "0", asset: "" };

  const match = trimmed.match(/^([0-9.]+)([A-Za-z]+)$/);
  if (match) {
    return { amount: match[1]!, asset: match[2]!.toUpperCase() };
  }

  const numMatch = trimmed.match(/^[0-9.]+$/);
  if (numMatch) {
    return { amount: trimmed, asset: "" };
  }

  return { amount: "0", asset: "" };
}

function parseFee(feeStr: string): { amount: string; asset: string } {
  return parseAmountWithSuffix(feeStr);
}

// ---------------------------------------------------------------------------
// Date conversion: "2025-01-15 10:30:00" -> "20250115"
// ---------------------------------------------------------------------------

function convertBinanceDate(dateStr: string): string {
  const trimmed = dateStr.trim();
  // YYYY-MM-DD (4-digit year)
  const match4 = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match4) return `${match4[1]}${match4[2]}${match4[3]}`;
  // YY-MM-DD (2-digit year, Spanish exports)
  const match2 = trimmed.match(/^(\d{2})-(\d{2})-(\d{2})/);
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
  index: number;
  /** Set once a row has been consumed by a trade/income so it's never reused. */
  parsed: boolean;
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

/** Strategy-vocabulary ops (Transaction Sold/Revenue/Buy/Spend/Fee). */
const STRATEGY_OPS = ["transaction sold", "transaction revenue", "transaction buy", "transaction spend", "transaction fee"];

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
  /** Rows dropped because their UTC_Time was unparseable (counted, surfaced once). */
  let skippedNoTimestamp = 0;

  /** Record an EUR-per-unit valuation hint for a coin+date from its EUR value. */
  function addHint(coin: string, date: string, qty: Decimal, eur: Decimal | null): void {
    if (eur === null || qty.isZero() || isFiat(coin)) return;
    const perUnit = eur.abs().div(qty.abs());
    if (!perUnit.isFinite() || perUnit.lessThanOrEqualTo(0)) return;
    manualRateHints.push({ currency: coin, date, eurPerUnit: perUnit.toString() });
  }

  // 1. Collect rows, skipping non-taxable internal movements and zero changes.
  function collectRows(): void {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line) continue;

      const fields = parseCsvLine(line, ",");
      const utcTime = (fields[cols.utcTime] ?? "").trim();
      const operation = (fields[cols.operation] ?? "").trim().toLowerCase();
      const coin = (fields[cols.coin] ?? "").trim().toUpperCase();
      const changeStr = (fields[cols.change] ?? "").trim();
      const account = (fields[cols.account] ?? "").trim();
      const remark = cols.remark >= 0 ? (fields[cols.remark] ?? "").trim() : "";

      // Note: an empty/missing utcTime is NOT short-circuited here — it falls
      // through to the txEpoch NaN guard below so it's counted+surfaced like any
      // other unparseable timestamp (a single, uniform code path), never silently
      // dropped.
      if (!coin || !changeStr || TX_SKIP_OPS.has(operation)) continue;
      // A "--" change (Binance writes this for some zero-fee rows) is not numeric.
      if (changeStr === "--") continue;

      // A row whose UTC_Time can't be parsed has no real epoch. txEpoch returns
      // NaN (not 0) for it; dropping+counting it here is the safe fix — keeping
      // it would let the ±1s window phases falsely cluster every NaN-epoch row
      // together (all "within 1s") and degrade the forward-scan. Count it and
      // surface ONE info message rather than mis-group it. (Empty/missing
      // UTC_Time also fails the regex → NaN → handled by this same path.)
      const epoch = txEpoch(utcTime);
      if (Number.isNaN(epoch)) { skippedNoTimestamp++; continue; }

      let change: Decimal;
      try {
        change = new Decimal(changeStr);
      } catch {
        continue;
      }
      // new Decimal("Infinity"/"NaN") does NOT throw — reject non-finite values so
      // a malformed cell can't poison totals or stall big-decimal arithmetic.
      if (!change.isFinite() || change.isZero()) continue;

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
        parsed: false,
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
      // Only positive credits are income; a negative (clawback) is rare — skip.
      if (!r.change.isPositive()) { r.parsed = true; continue; }

      r.parsed = true;
      addHint(r.coin, r.tradeDate, r.change, r.eurValue);
      cashTransactions.push({
        transactionID: `binance-income-${r.tradeDate}-${r.coin}-${r.index}`,
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
  //    rows at one timestamp, paired via the Remark ("SCR to BNB"). Each dust
  //    coin → BNB is a permuta.
  function emitDust(): void {
    const dustByTime = new Map<string, TxRow[]>();
    for (const r of rows) {
      if (r.parsed || !TX_DUST_OPS.has(r.operation)) continue;
      if (!dustByTime.has(r.utcTime)) dustByTime.set(r.utcTime, []);
      dustByTime.get(r.utcTime)!.push(r);
    }
    for (const group of dustByTime.values()) {
      const bnbRows = group.filter((r) => r.coin === "BNB" && r.change.isPositive());
      for (const dust of group) {
        if (dust.coin === "BNB" || !dust.change.isNegative()) continue;
        // Match BNB output by remark (e.g. "SCR to BNB"); fall back to any unused.
        const bnb = bnbRows.find((b) => !b.parsed && b.remark === dust.remark)
          ?? bnbRows.find((b) => !b.parsed);
        dust.parsed = true;
        addHint(dust.coin, dust.tradeDate, dust.change, dust.eurValue);
        if (bnb) {
          bnb.parsed = true;
          addHint("BNB", bnb.tradeDate, bnb.change, bnb.eurValue);
          emitCryptoSwap(trades, { coin: dust.coin, qty: dust.change, eur: dust.eurValue, date: dust.tradeDate, index: dust.index },
            { coin: "BNB", qty: bnb.change, eur: bnb.eurValue, date: bnb.tradeDate, index: bnb.index }, "Dust");
        }
      }
      // Any leftover BNB rows (rounding remainders) are immaterial — drop.
      for (const b of bnbRows) b.parsed = true;
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
      const window = collectWindow(rows, i, (r) => r.operation === start.operation);
      window.forEach((r) => (r.parsed = true));
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
          pairAndEmit(trades, netLegs(group), addHint, "Buy");
        }
      } else {
        pairAndEmit(trades, netLegs(window), addHint, "Convert");
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

  // Surface dropped timestamp-less rows ONCE (info — they were excluded from
  // every phase, so they can't be silently mis-grouped). Actionable hint per the
  // three-tier message policy: the usual cause is a corrupted/edited export.
  const parserMessages: TaxMessage[] = skippedNoTimestamp > 0
    ? [{
        id: "binance.unparseable_timestamp",
        severity: "info",
        message: `Se ${skippedNoTimestamp === 1 ? "ha omitido 1 fila" : `han omitido ${skippedNoTimestamp} filas`} del CSV de Binance por tener una fecha/hora (UTC_Time) no reconocible.`,
        hint: "Suele deberse a un fichero modificado manualmente o exportado de forma incompleta. Vuelve a descargar el informe original desde Binance sin editarlo para que esas operaciones se incluyan.",
        context: { count: String(skippedNoTimestamp) },
      }]
    : [];

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

/** Sum signed quantity and EUR value per coin across a window of paired rows. */
function netLegs(window: TxRow[]): NetLeg[] {
  const byCoin = new Map<string, NetLeg>();
  for (const r of window) {
    const existing = byCoin.get(r.coin);
    if (existing) {
      existing.qty = existing.qty.plus(r.change);
      existing.eur = existing.eur === null || r.eurValue === null ? null : existing.eur.plus(r.eurValue);
    } else {
      byCoin.set(r.coin, { coin: r.coin, qty: r.change, eur: r.eurValue, date: r.tradeDate, index: r.index });
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
 * a single sell leg, leaving 1 sell vs N buys and dropping all but one buy. The
 * caller must therefore pre-split such windows (step 4 sub-groups fiat buys by
 * funding-wallet Remark) before calling here. When EUR values are absent (all
 * 0), the closest match is the next available buy in order — equivalent to
 * insertion-order pairing, the previous behavior.
 */
function pairAndEmit(trades: Trade[], legs: NetLeg[], addHint: AddHint, label: string): void {
  const sells = legs.filter((l) => l.qty.isNegative());
  const buys = legs.filter((l) => l.qty.isPositive());
  const usedBuys = new Set<number>();
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
    if (bestIdx < 0) break; // no buys left
    usedBuys.add(bestIdx);
    const buy = buys[bestIdx]!;
    addHint(sell.coin, sell.date, sell.qty, sell.eur);
    addHint(buy.coin, buy.date, buy.qty, buy.eur);
    emitCryptoSwap(trades, sell, buy, label);
  }
}

function absEur(l: NetLeg): number {
  return l.eur ? Math.abs(l.eur.toNumber()) : 0;
}

/**
 * Emit a crypto leg-pair. If one side is genuine FIAT (not a stablecoin), the
 * trade is a plain acquisition/disposal in that fiat currency (NOT a permuta) —
 * this prevents the FIFO engine from hunting for nonexistent "EUR lots". If both
 * sides are crypto (incl. stablecoins), emit the two-leg permuta. Both-fiat
 * conversions are skipped (handled by the FX engine, not capital gains).
 */
function emitCryptoSwap(trades: Trade[], sell: NetLeg, buy: NetLeg, label: string): void {
  const sellQty = sell.qty.abs();
  const buyQty = buy.qty.abs();
  if (sellQty.isZero() || buyQty.isZero()) return;
  const sellFiat = isFiat(sell.coin);
  const buyFiat = isFiat(buy.coin);

  if (sellFiat && buyFiat) return; // pure fiat conversion — not a capital-gains event

  if (sellFiat && !buyFiat) {
    // Spent fiat to acquire crypto → single BUY priced in fiat.
    trades.push({
      ...CRYPTO_TRADE_BASE,
      tradeID: `binance-tx-buy-${buy.date}-${buy.coin}-${buy.index}`,
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
      tradeID: `binance-tx-sell-${sell.date}-${sell.coin}-${sell.index}`,
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
    tradeID: `binance-tx-sell-${sell.date}-${sell.coin}-${sell.index}`,
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
    tradeID: `binance-tx-buy-${buy.date}-${buy.coin}-${buy.index}`,
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
 * and each Buy with a Spend (by order, all of them — not just the first). Fees in
 * the acquired/received coin reduce cost / proceeds.
 */
function emitStrategyTrades(trades: Trade[], window: TxRow[], addHint: AddHint): void {
  const sold = window.filter((r) => r.operation === "transaction sold");
  const revenue = window.filter((r) => r.operation === "transaction revenue");
  const bought = window.filter((r) => r.operation === "transaction buy");
  const spend = window.filter((r) => r.operation === "transaction spend");
  const fees = window.filter((r) => r.operation === "transaction fee");
  window.forEach((r) => (r.parsed = true));

  const nSell = Math.min(sold.length, revenue.length);
  for (let k = 0; k < nSell; k++) {
    const soldRow = sold[k]!;
    const revenueRow = revenue[k]!;
    const feeRow = fees.find((f) => f.coin === revenueRow.coin && !f.change.isZero());
    const feeAmount = feeRow ? feeRow.change.abs() : new Decimal(0);
    addHint(soldRow.coin, soldRow.tradeDate, soldRow.change, soldRow.eurValue);
    addHint(revenueRow.coin, revenueRow.tradeDate, revenueRow.change, revenueRow.eurValue);
    emitCryptoSwap(
      trades,
      { coin: soldRow.coin, qty: soldRow.change, eur: soldRow.eurValue, date: soldRow.tradeDate, index: soldRow.index },
      { coin: revenueRow.coin, qty: revenueRow.change, eur: revenueRow.eurValue, date: revenueRow.tradeDate, index: revenueRow.index },
      "Sell",
    );
    applyFee(trades, feeAmount, revenueRow.coin);
  }

  const nBuy = Math.min(bought.length, spend.length);
  for (let k = 0; k < nBuy; k++) {
    const buyRow = bought[k]!;
    const spendRow = spend[k]!;
    const feeRow = fees.find((f) => f.coin === buyRow.coin && !f.change.isZero());
    const feeAmount = feeRow ? feeRow.change.abs() : new Decimal(0);
    addHint(buyRow.coin, buyRow.tradeDate, buyRow.change, buyRow.eurValue);
    addHint(spendRow.coin, spendRow.tradeDate, spendRow.change, spendRow.eurValue);
    emitCryptoSwap(
      trades,
      { coin: spendRow.coin, qty: spendRow.change, eur: spendRow.eurValue, date: spendRow.tradeDate, index: spendRow.index },
      { coin: buyRow.coin, qty: buyRow.change, eur: buyRow.eurValue, date: buyRow.tradeDate, index: buyRow.index },
      "Buy",
    );
    applyFee(trades, feeAmount, buyRow.coin);
  }
}

/** Attach a fee to the most recently emitted trade (in the same coin). */
function applyFee(trades: Trade[], feeAmount: Decimal, feeCoin: string): void {
  if (feeAmount.isZero() || trades.length === 0) return;
  const last = trades[trades.length - 1]!;
  last.commission = feeAmount.neg().toString();
  last.commissionCurrency = feeCoin;
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
 * emitted trade; a fee in a coin with no ECB rate (e.g. BNB third-coin fee) is
 * dropped as immaterial dust, consistent with the `BNB Fee Deduction` policy.
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

  const before = trades.length;
  for (const group of byRemark.values()) {
    emitBareSpotGroup(trades, group, addHint);
  }

  // Attach each fee to the emitted trade whose coin matches the fee coin. The FIFO
  // engine homogenizes a commission to EUR via its ECB rate, so only a fee in a
  // genuinely ECB-resolvable coin (fiat or stablecoin) can be valued — attach those
  // (a fiat/stablecoin sell/buy fee correctly adjusts cost/proceeds, Art. 35.1.b/35.2,
  // DGT V1604-18). A fee in a non-resolvable coin (a BNB third-coin fee, or the bought
  // alt-coin itself) has no EUR rate and is sub-cent dust → drop it, consistent with the
  // `BNB Fee Deduction` policy; dropping a buy fee only understates cost → overstates
  // gain (conservative, never underpays). Fees ACCUMULATE (a trade can carry several
  // partial-fill fee rows). The `before` scope confines matching to THIS window's trades.
  for (const f of fees) {
    if (!isEcbResolvable(f.coin)) continue; // crypto/dust fee — immaterial, no rate
    const feeAmount = f.change.abs();
    const target = trades.slice(before).reverse().find(
      (t) => t.symbol === f.coin || t.currency === f.coin,
    );
    if (target) {
      const prior = new Decimal(target.commission || "0"); // emitCryptoSwap sets "0"
      target.commission = prior.minus(feeAmount).toString();
      target.commissionCurrency = f.coin;
    }
  }
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
 * order-to-order — acceptable, and vastly better than a cost-basis-0 phantom gain.
 */
function emitBareSpotGroup(trades: Trade[], rows: TxRow[], addHint: AddHint): void {
  const recv = netLegs(rows.filter((r) => r.change.isPositive())).sort((a, b) => a.index - b.index);
  const give = netLegs(rows.filter((r) => r.change.isNegative())).sort((a, b) => a.index - b.index);

  // One (or zero) received coin, or a multi-currency given-up side → the existing
  // closest-EUR pairing is correct (and merges same-coin multi-fills cleanly).
  const giveSingleFiat = give.length === 1 && isFiat(give[0]!.coin);
  if (recv.length <= 1 || !giveSingleFiat) {
    pairAndEmit(trades, [...give, ...recv], addHint, "Spot");
    return;
  }

  // Multiple distinct bought coins sharing ONE fiat leg. Split the fiat across them
  // so none is dropped: 1:1 by order when the export gives one fiat row per coin (the
  // common case), else an equal split of the netted fiat as a conservative fallback.
  const fiatRows = rows
    .filter((r) => r.change.isNegative() && isFiat(r.coin))
    .sort((a, b) => a.index - b.index);
  if (fiatRows.length === recv.length) {
    for (let k = 0; k < recv.length; k++) {
      const r = recv[k]!;
      const g = fiatRows[k]!;
      const sell: NetLeg = { coin: g.coin, qty: g.change, eur: g.eurValue, date: g.tradeDate, index: g.index };
      addHint(sell.coin, sell.date, sell.qty, sell.eur);
      addHint(r.coin, r.date, r.qty, r.eur);
      emitCryptoSwap(trades, sell, r, "Spot");
    }
    return;
  }
  // Count mismatch (rare): split the total fiat equally across the received coins.
  const totalFiat = give[0]!.qty; // negative
  const share = totalFiat.div(recv.length);
  for (const r of recv) {
    const sell: NetLeg = { coin: give[0]!.coin, qty: share, eur: null, date: give[0]!.date, index: give[0]!.index };
    addHint(r.coin, r.date, r.qty, r.eur);
    emitCryptoSwap(trades, sell, r, "Spot");
  }
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

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, ",");

    const dateStr = (fields[cols.date] ?? "").trim();
    const tradeDate = convertBinanceDate(dateStr);

    const pairStr = (fields[cols.pair] ?? "").trim();
    const { symbol, currency } = parsePair(pairStr);

    const sideLower = (fields[cols.side] ?? "").trim().toLowerCase();
    if (sideLower !== "buy" && sideLower !== "sell") continue;
    const isBuy = sideLower === "buy";

    // Guard against new Decimal("NaN"/"Infinity") — it does NOT throw and a
    // non-finite price/qty silently poisons every casilla total. parseEu=false
    // keeps the original raw-string parse (these cells are plain decimals; the
    // suffix-parsed ones are already normalized to [0-9.]+).
    const price = toFiniteDecimal((fields[cols.price] ?? "0").trim() || "0", "0", false);
    const executed = toFiniteDecimal(parseAmountWithSuffix((fields[cols.executed] ?? "0").trim()).amount || "0", "0", false);
    const amount = toFiniteDecimal(parseAmountWithSuffix((fields[cols.amount] ?? "0").trim()).amount || "0", "0", false);

    const fee = parseFee((fields[cols.fee] ?? "").trim());
    const feeAmount = toFiniteDecimal(fee.amount || "0", "0", false);

    trades.push({
      tradeID: `binance-${tradeDate}-${symbol}-${i}`,
      accountId: "",
      symbol,
      description: `${symbol}/${currency} ${sideLower.toUpperCase()}`,
      // Crypto has no ISIN. Leave empty so wash-sale keys on CRYPTO:${symbol}
      // and never collides with a real ISIN-keyed security.
      isin: "",
      assetCategory: "CRYPTO",
      currency,
      tradeDate,
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
      throw new Error(hasContent ? "Binance CSV: formato no reconocido" : "Binance CSV: fichero vacio o sin datos");
    }
    const lines = allLines.slice(headerIdx).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error("Binance CSV: fichero vacio o sin datos");
    }

    return txIdx >= 0 && tradeIdx < 0 ? parseBinanceTxCsv(lines) : parseBinanceCsv(lines);
  },
};
