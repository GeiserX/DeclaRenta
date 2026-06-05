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
import type { ManualRateQuote } from "../types/tax.js";
import { isFiat } from "../engine/ecb.js";
import { parseCsvLine, stripBom } from "./csv-utils.js";

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

/** Parse "YYYY-MM-DD HH:MM:SS" / "YY-MM-DD HH:MM:SS" to epoch seconds (UTC). */
function txEpoch(utcTime: string): number {
  const m = utcTime.trim().match(/^(\d{2,4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
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

function parseBinanceTxCsv(lines: string[]): Statement {
  const headers = parseCsvLine(lines[0]!, ",");
  const cols = resolveTxColumns(headers);

  if (cols.utcTime < 0 || cols.operation < 0 || cols.coin < 0 || cols.change < 0) {
    throw new Error("Binance Transaction History CSV: faltan columnas obligatorias (UTC_Time, Operation, Coin, Change)");
  }

  const trades: Trade[] = [];
  const cashTransactions: CashTransaction[] = [];
  const manualRateHints: ManualRateQuote[] = [];

  /** Record an EUR-per-unit valuation hint for a coin+date from its EUR value. */
  function addHint(coin: string, date: string, qty: Decimal, eur: Decimal | null): void {
    if (eur === null || qty.isZero() || isFiat(coin)) return;
    const perUnit = eur.abs().div(qty.abs());
    if (!perUnit.isFinite() || perUnit.lessThanOrEqualTo(0)) return;
    manualRateHints.push({ currency: coin, date, eurPerUnit: perUnit.toString() });
  }

  // 1. Collect rows, skipping non-taxable internal movements and zero changes.
  const rows: TxRow[] = [];
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

    if (!utcTime || !coin || !changeStr || TX_SKIP_OPS.has(operation)) continue;
    // A "--" change (Binance writes this for some zero-fee rows) is not numeric.
    if (changeStr === "--") continue;

    let change: Decimal;
    try {
      change = new Decimal(changeStr);
    } catch {
      continue;
    }
    if (change.isZero()) continue;

    let eurValue: Decimal | null = null;
    if (cols.eurValue >= 0) {
      const raw = (fields[cols.eurValue] ?? "").trim();
      if (raw) {
        try {
          eurValue = new Decimal(raw);
        } catch {
          eurValue = null;
        }
      }
    }

    rows.push({
      utcTime,
      epoch: txEpoch(utcTime),
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
  rows.sort((a, b) => (a.epoch - b.epoch) || (a.index - b.index));

  // 2. Income rows are single-row events — emit them first (and mark parsed) so
  //    they never get swept into a trade window.
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

  // 3. Dust (Small Assets Exchange BNB): negative dust-coin rows + positive BNB
  //    rows at one timestamp, paired via the Remark ("SCR to BNB"). Each dust
  //    coin → BNB is a permuta.
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

  // 4. Binance Convert: pair legs within a ±1s window (legs are frequently 1
  //    second apart). Net per-coin to cancel intra-account split rows, then pair
  //    the net negative (sold) with the net positive (bought).
  for (let i = 0; i < rows.length; i++) {
    const start = rows[i]!;
    if (start.parsed || start.operation !== "binance convert") continue;
    const window: TxRow[] = [];
    for (let j = i; j < rows.length; j++) {
      const r = rows[j]!;
      if (r.epoch - start.epoch > 1) break;
      if (!r.parsed && r.operation === "binance convert") window.push(r);
    }
    const legs = netLegs(window);
    window.forEach((r) => (r.parsed = true));
    pairAndEmit(trades, legs, addHint, "Convert");
  }

  // 5. Strategy trades: Transaction Sold↔Revenue and Buy↔Spend within ±1s.
  //    Pair ALL legs (not just the first) so high-frequency same-second groups
  //    aren't truncated.
  for (let i = 0; i < rows.length; i++) {
    const start = rows[i]!;
    if (start.parsed) continue;
    if (!["transaction sold", "transaction revenue", "transaction buy", "transaction spend", "transaction fee"].includes(start.operation)) continue;
    const window: TxRow[] = [];
    for (let j = i; j < rows.length; j++) {
      const r = rows[j]!;
      if (r.epoch - start.epoch > 1) break;
      if (r.parsed) continue;
      if (["transaction sold", "transaction revenue", "transaction buy", "transaction spend", "transaction fee"].includes(r.operation)) window.push(r);
    }
    emitStrategyTrades(trades, window, addHint);
  }

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

/** Pair net negative (sold) legs with net positive (bought) legs and emit. */
function pairAndEmit(trades: Trade[], legs: NetLeg[], addHint: AddHint, label: string): void {
  const sells = legs.filter((l) => l.qty.isNegative()).sort((a, b) => absEur(b) - absEur(a));
  const buys = legs.filter((l) => l.qty.isPositive()).sort((a, b) => absEur(b) - absEur(a));
  const n = Math.min(sells.length, buys.length);
  for (let k = 0; k < n; k++) {
    const sell = sells[k]!;
    const buy = buys[k]!;
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

    const price = new Decimal((fields[cols.price] ?? "0").trim() || "0");
    const executed = new Decimal(parseAmountWithSuffix((fields[cols.executed] ?? "0").trim()).amount || "0");
    const amount = new Decimal(parseAmountWithSuffix((fields[cols.amount] ?? "0").trim()).amount || "0");

    const fee = parseFee((fields[cols.fee] ?? "").trim());
    const feeAmount = new Decimal(fee.amount || "0");

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
