/**
 * Coinbase CSV parser.
 *
 * Parses Coinbase's "Transaction History" CSV export into a normalized Statement.
 * Supports comma-delimited format with US number formatting.
 *
 * CSV format: 10 columns
 * Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes
 */

import type { BrokerParser, Statement } from "../types/broker.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import type { TaxMessage } from "../types/tax.js";
import {
  parseCsvLine,
  parseNumber,
  toFiniteDecimal,
  findColumn,
  stripBom,
  timeOfDay,
} from "./csv-utils.js";

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

/** Old format: "Spot Price Currency", "Spot Price at Transaction" */
const COINBASE_HEADERS_V1 = ["transaction type", "spot price", "quantity transacted"];
/** New format: "Price Currency", "Price at Transaction" (no "Spot" prefix), plus "ID" column */
const COINBASE_HEADERS_V2 = ["transaction type", "price at transaction", "quantity transacted"];

function isCoinbaseCsv(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return COINBASE_HEADERS_V1.every((h) => lower.includes(h)) ||
         COINBASE_HEADERS_V2.every((h) => lower.includes(h));
}

// ---------------------------------------------------------------------------
// Column resolution
// ---------------------------------------------------------------------------

interface CoinbaseColumns {
  timestamp: number;
  transactionType: number;
  asset: number;
  quantity: number;
  spotCurrency: number;
  spotPrice: number;
  subtotal: number;
  total: number;
  fees: number;
  notes: number;
}

function resolveColumns(headers: string[]): CoinbaseColumns {
  return {
    timestamp: findColumn(headers, ["timestamp"]),
    transactionType: findColumn(headers, ["transaction type"]),
    asset: findColumn(headers, ["asset"]),
    quantity: findColumn(headers, ["quantity transacted"]),
    spotCurrency: findColumn(headers, ["spot price currency", "price currency"]),
    spotPrice: findColumn(headers, ["spot price at transaction", "price at transaction"]),
    subtotal: findColumn(headers, ["subtotal"]),
    total: findColumn(headers, ["total (inclusive of fees and/or spread)", "total"]),
    fees: findColumn(headers, ["fees and/or spread", "fees"]),
    notes: findColumn(headers, ["notes"]),
  };
}

// ---------------------------------------------------------------------------
// Date conversion
// ---------------------------------------------------------------------------

/** Convert ISO-8601 timestamp (e.g. "2024-03-15T10:30:00Z") to YYYYMMDD */
function convertTimestamp(ts: string): string {
  const trimmed = ts.trim();
  // Match YYYY-MM-DD at the start (works for both "2024-03-15" and "2024-03-15T10:30:00Z")
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return trimmed;
  return `${match[1]}${match[2]}${match[3]}`;
}

// ---------------------------------------------------------------------------
// Transaction type classification
// ---------------------------------------------------------------------------

/**
 * Non-taxable movements: crypto sent/received, fiat deposits/withdrawals, moves
 * to/from Coinbase Pro/Exchange/Prime and the Vault, savings and staking
 * transfers. None of them is a disposal or income, so they are skipped quietly.
 * Any OTHER unrecognised type is skipped too, but counted and reported.
 */
const SKIP_TYPES = [
  "send",
  "receive",
  "deposit",
  "withdrawal",
  "exchange deposit",
  "exchange withdrawal",
  "pro deposit",
  "pro withdrawal",
  "prime deposit",
  "transfer",
  "retail staking transfer",
  "retail unstaking transfer",
  "vault withdrawal",
  "cash to savings",
  "savings to cash",
];
/**
 * Coinbase Advanced Trade fills. "Advance Trade" (sic) appears in some exports.
 * Exact labels only, never includes(): other types also contain "buy"/"sell".
 */
const BUY_TYPES = ["buy", "advanced trade buy", "advance trade buy"];
const SELL_TYPES = ["sell", "advanced trade sell", "advance trade sell"];
/**
 * Crypto income types and their Spanish tax bucket:
 *  - "ahorro": rendimiento del capital mobiliario (savings base, Casilla 0027) —
 *    staking / holding rewards (DGT V1766-22).
 *  - "general": ganancia patrimonial no derivada de transmisión (base general,
 *    Casilla 0304) — Coinbase Earn "learning rewards" are free crypto received
 *    for completing lessons, with no capital transmitted (Art. 33.1, like an
 *    airdrop).
 *
 * CAVEAT: "rewards income" is a generic Coinbase label. For holding/staking-style
 * yield (the common case) ahorro is correct. But Coinbase also uses it for card
 * cashback / promotional bonuses, which the DGT treats as ganancia patrimonial no
 * derivada de transmisión (base general). We default the whole label to ahorro:
 * it covers the majority case and the savings rate (19–28%) is generally ≤ the
 * general scale, so the bias is conservative-to-neutral. Users with large
 * promotional "rewards income" should verify its nature (see info message below).
 */
const INCOME_BUCKETS: Record<string, "ahorro" | "general"> = {
  "staking income": "ahorro",
  "rewards income": "ahorro",
  // Staking-style yield on inflationary coins (ATOM, XTZ...): same as staking.
  "inflation reward": "ahorro",
  "learning reward": "general",
  // Older label for the same learn-and-earn rewards.
  "coinbase earn": "general",
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseCoinbaseCsv(lines: string[]): Statement {
  const headers = parseCsvLine(lines[0]!, ",");
  const cols = resolveColumns(headers);

  if (cols.timestamp < 0 || cols.transactionType < 0 || cols.asset < 0) {
    throw new Error("Coinbase CSV: faltan columnas obligatorias (Timestamp, Transaction Type, Asset)");
  }

  const trades: Trade[] = [];
  const cashTransactions: CashTransaction[] = [];
  let rewardsIncomeCount = 0;
  // Conversions whose Notes we couldn't parse: the SELL leg is emitted but the
  // received coin gets NO BUY leg → no FIFO lot → phantom gain on a later sale.
  let convertNoDestCount = 0;
  // Unrecognised transaction types (raw label → row count), reported once.
  const unknownTypes = new Map<string, number>();
  // Advanced Trade fills quoted in a currency other than the row's Price
  // Currency (e.g. ETH-BTC): only the base coin's leg is emitted.
  let cryptoQuoteCount = 0;
  const cryptoQuotePairs = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line, ",");

    const timestamp = (fields[cols.timestamp] ?? "").trim();
    const txType = (fields[cols.transactionType] ?? "").trim().toLowerCase();
    const asset = (fields[cols.asset] ?? "").trim();
    const quantity = parseNumber(fields[cols.quantity] ?? "0");
    const spotCurrency = (fields[cols.spotCurrency] ?? "EUR").trim();
    const spotPrice = parseNumber(fields[cols.spotPrice] ?? "0");
    const subtotal = parseNumber(fields[cols.subtotal] ?? "0");
    const total = parseNumber(fields[cols.total] ?? "0");
    const fees = parseNumber(fields[cols.fees] ?? "0");
    const notes = cols.notes >= 0 ? (fields[cols.notes] ?? "").trim() : "";

    if (!asset || !timestamp) continue;

    const tradeDate = convertTimestamp(timestamp);
    const tradeTime = timeOfDay(timestamp);

    // Skip non-taxable transfers
    if (SKIP_TYPES.includes(txType)) continue;

    // Crypto reward income (staking/rewards → ahorro; learning → base general).
    // These are NOT foreign dividends — no issuer/withholding country and not in
    // the Art. 80 double-taxation pool. Coinbase reports a fiat spot value
    // (total/subtotal in spotCurrency), which becomes the EUR cost basis of the
    // received coins so a later sale isn't double-taxed (Art. 35.1). Routed via
    // "Crypto Reward Income" + taxBucket so airdrop-like income is never
    // mis-bucketed into the savings base.
    const incomeBucket = INCOME_BUCKETS[txType];
    if (incomeBucket) {
      if (txType === "rewards income") rewardsIncomeCount++;
      const eurAmount = total || subtotal;
      cashTransactions.push({
        transactionID: `coinbase-${txType.replace(/\s+/g, "-")}-${tradeDate}-${asset}-${i}`,
        accountId: "",
        symbol: asset,
        description: `${txType} - ${asset}${notes ? ` (${notes})` : ""}`,
        isin: "",
        currency: spotCurrency || "EUR",
        dateTime: tradeDate,
        settleDate: tradeDate,
        amount: eurAmount,
        fxRateToBase: "1",
        type: "Crypto Reward Income",
        taxBucket: incomeBucket,
        rewardQuantity: toFiniteDecimal(quantity).abs().toString(),
        rewardCostBasisEur: toFiniteDecimal(eurAmount).abs().toString(),
      });
      continue;
    }

    // Convert → two trades: sell old asset, buy new asset
    if (txType === "convert") {
      // The Notes field typically contains "Converted X ASSET1 to Y ASSET2"
      const convertMatch = notes.match(/Converted\s+[\d.,]+\s+\w+\s+to\s+([\d.,]+)\s+(\w+)/i);

      const quantityDec = toFiniteDecimal(quantity).abs();
      const feeDec = toFiniteDecimal(fees);

      // Close (sell) the source asset
      trades.push({
        tradeID: `coinbase-convert-sell-${tradeDate}-${asset}-${i}`,
        accountId: "",
        symbol: asset,
        description: `Convert ${asset}${convertMatch ? ` to ${convertMatch[2]}` : ""}`,
        isin: "",
        assetCategory: "CRYPTO",
        currency: spotCurrency || "EUR",
        tradeDate,
        tradeTime,
        settlementDate: tradeDate,
        quantity: quantityDec.neg().toString(),
        tradePrice: spotPrice,
        tradeMoney: subtotal,
        proceeds: subtotal,
        cost: "0",
        fifoPnlRealized: "0",
        fxRateToBase: "1",
        buySell: "SELL",
        openCloseIndicator: "C",
        exchange: "COINBASE",
        commissionCurrency: spotCurrency || "EUR",
        commission: feeDec.isZero() ? "0" : feeDec.abs().neg().toString(),
        taxes: "0",
        multiplier: "1",
      });

      // Open (buy) the destination asset
      if (convertMatch) {
        const destAsset = convertMatch[2]!;
        // Notes are US-formatted: a comma is a thousands separator ("2,000").
        const destQuantityDec = toFiniteDecimal(convertMatch[1]!.replace(/,/g, "")).abs();
        const subtotalDec = toFiniteDecimal(subtotal).abs();
        const destPrice = destQuantityDec.isZero() ? "0" : subtotalDec.div(destQuantityDec).toString();

        trades.push({
          tradeID: `coinbase-convert-buy-${tradeDate}-${destAsset}-${i}`,
          accountId: "",
          symbol: destAsset,
          description: `Convert ${asset} to ${destAsset}`,
          isin: "",
          assetCategory: "CRYPTO",
          currency: spotCurrency || "EUR",
          tradeDate,
          tradeTime,
          settlementDate: tradeDate,
          quantity: destQuantityDec.toString(),
          tradePrice: destPrice,
          tradeMoney: subtotal,
          proceeds: "0",
          cost: subtotal,
          fifoPnlRealized: "0",
          fxRateToBase: "1",
          buySell: "BUY",
          openCloseIndicator: "O",
          exchange: "COINBASE",
          commissionCurrency: spotCurrency || "EUR",
          commission: "0",
          taxes: "0",
          multiplier: "1",
        });
      } else {
        // No parseable destination in Notes: the acquired coin gets no BUY lot.
        convertNoDestCount++;
      }
      continue;
    }

    // Buy / Sell trades
    const isSell = SELL_TYPES.includes(txType);
    const isBuy = BUY_TYPES.includes(txType);
    if (!isSell && !isBuy) {
      const rawType = (fields[cols.transactionType] ?? "").trim();
      unknownTypes.set(rawType, (unknownTypes.get(rawType) ?? 0) + 1);
      continue;
    }

    const qtyDec = toFiniteDecimal(quantity).abs();
    if (qtyDec.isZero()) continue;

    // Advanced Trade Notes name the market ("... on ETH-BTC at ..."). When the
    // quote coin is not the Price Currency, the coin paid or received is
    // another crypto and that permuta leg is not emitted: warn about it.
    if (txType !== "buy" && txType !== "sell") {
      const market = notes.match(/\bon\s+([A-Za-z0-9]+)-([A-Za-z0-9]+)\b/);
      if (market && market[2]!.toUpperCase() !== (spotCurrency || "EUR").toUpperCase()) {
        cryptoQuoteCount++;
        cryptoQuotePairs.add(`${market[1]!.toUpperCase()}-${market[2]!.toUpperCase()}`);
      }
    }

    const feeDec2 = toFiniteDecimal(fees);

    trades.push({
      tradeID: `coinbase-${txType.replace(/\s+/g, "-")}-${tradeDate}-${asset}-${i}`,
      accountId: "",
      symbol: asset,
      description: `${txType.charAt(0).toUpperCase() + txType.slice(1)} ${asset}`,
      isin: "",
      assetCategory: "CRYPTO",
      currency: spotCurrency || "EUR",
      tradeDate,
      tradeTime,
      settlementDate: tradeDate,
      quantity: isSell ? qtyDec.neg().toString() : qtyDec.toString(),
      tradePrice: spotPrice,
      tradeMoney: total,
      proceeds: isSell ? subtotal : "0",
      cost: isSell ? "0" : subtotal,
      fifoPnlRealized: "0",
      fxRateToBase: "1",
      buySell: isSell ? "SELL" : "BUY",
      openCloseIndicator: isSell ? "C" : "O",
      exchange: "COINBASE",
      commissionCurrency: spotCurrency || "EUR",
      commission: feeDec2.isZero() ? "0" : feeDec2.abs().neg().toString(),
      taxes: "0",
      multiplier: "1",
    });
  }

  const parserMessages: TaxMessage[] = [];
  // "rewards income" is treated as savings-base income by default, but it can
  // also cover promotional cashback that is legally base-general. Nudge the user
  // to verify if any is present (info — no action needed for the common case).
  if (rewardsIncomeCount > 0) {
    parserMessages.push({
      id: "coinbase.rewards_income_classification",
      severity: "info" as const,
      message: `Se han clasificado ${rewardsIncomeCount} ingreso(s) de tipo "Rewards Income" de Coinbase como rendimientos del capital mobiliario (base del ahorro).`,
      hint: "Si parte de esos importes son recompensas promocionales o cashback de tarjeta (no rendimientos por mantener o ceder cripto), su tratamiento correcto sería ganancia patrimonial no derivada de transmisión (base general). Revisa su naturaleza si la cantidad es significativa.",
      context: { count: String(rewardsIncomeCount) },
    });
  }
  // A Convert whose destination coin couldn't be parsed got a SELL leg but no
  // BUY leg, so the acquired coin has no acquisition cost — a later sale taxaría
  // su importe íntegro como ganancia (Art. 35.1). Warn so the user can corregirlo.
  if (convertNoDestCount > 0) {
    parserMessages.push({
      id: "coinbase.convert_dest_unparsed",
      severity: "warning" as const,
      message: `No se pudo interpretar el destino de ${convertNoDestCount === 1 ? "una conversión" : `${convertNoDestCount} conversiones`} Coinbase; la moneda adquirida no tendrá coste de adquisición.`,
      hint: "Suele deberse a que la columna \"Notes\" no incluye el texto \"Converted ... to ...\" esperado. Vuelve a descargar el informe original desde Coinbase sin editarlo, o añade manualmente la compra de la moneda recibida para que tenga coste de adquisición.",
      context: { count: String(convertNoDestCount) },
    });
  }

  // Rows whose type we don't recognise were not counted at all: name them so
  // the user can check whether any was a taxable sale, purchase or reward.
  if (unknownTypes.size > 0) {
    const skipped = [...unknownTypes.values()].reduce((a, b) => a + b, 0);
    const types = [...unknownTypes].map(([type, n]) => `${type} (${n})`).join(", ");
    parserMessages.push({
      id: "coinbase.unknown_types_skipped",
      severity: "warning" as const,
      message: `Se han omitido ${skipped} fila(s) de Coinbase con un tipo de operación no reconocido: ${types}.`,
      hint: "Estas filas no se han tenido en cuenta en el cálculo. Si alguna es una venta, una compra, un pago con cripto o una recompensa, añádela manualmente para que su ganancia, su coste de adquisición o su rendimiento cuenten.",
      context: { count: String(skipped), types },
    });
  }
  // An Advanced Trade fill quoted in another coin (e.g. ETH-BTC) also disposes
  // of or acquires that coin: this leg is missing (a permuta, Art. 37.1.h LIRPF).
  if (cryptoQuoteCount > 0) {
    const pairs = [...cryptoQuotePairs].join(", ");
    parserMessages.push({
      id: "coinbase.advanced_trade_quote_leg_missing",
      severity: "warning" as const,
      message: `${cryptoQuoteCount} operación(es) de Advanced Trade de Coinbase se pagaron o cobraron en una moneda distinta de la de valoración (${pairs}); solo se ha registrado la criptomoneda comprada o vendida, no la moneda de contrapartida.`,
      hint: "En estos pares también transmites (al comprar) o adquieres (al vender) la moneda de cotización, sea otra criptomoneda o una divisa, y esa operación también tributa. Añade manualmente la venta o la compra de esa moneda por el mismo valor en euros de la operación para que su ganancia y su coste de adquisición cuadren.",
      context: { count: String(cryptoQuoteCount), pairs },
    });
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
    ...(parserMessages.length > 0 ? { parserMessages } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public BrokerParser
// ---------------------------------------------------------------------------

export const coinbaseParser: BrokerParser = {
  name: "Coinbase",
  formats: ["CSV"],

  detect(input: string): boolean {
    const lines = stripBom(input).split(/\r?\n/);
    return lines.slice(0, 10).some((l) => isCoinbaseCsv(l));
  },

  parse(input: string): Statement {
    const cleaned = stripBom(input);
    const allLines = cleaned.split(/\r?\n/);
    // Find header line (may be preceded by metadata preamble)
    const headerIdx = allLines.findIndex((l) => isCoinbaseCsv(l));
    if (headerIdx === -1) {
      const hasContent = allLines.some((l) => l.trim());
      throw new Error(hasContent ? "Coinbase CSV: formato no reconocido" : "Coinbase CSV: fichero vacío o sin datos");
    }
    const lines = allLines.slice(headerIdx).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error("Coinbase CSV: fichero vacío o sin datos");
    }

    return parseCoinbaseCsv(lines);
  },
};
