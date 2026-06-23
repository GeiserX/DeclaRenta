import Decimal from "decimal.js";
import { normalizeDate } from "./dates.js";
import type { Trade } from "../types/ibkr.js";
import type { ManualOpeningLot } from "../types/tax.js";

export type { ManualOpeningLot };

type ManualOpeningLotIdentity = Pick<ManualOpeningLot, "symbol" | "isin" | "assetCategory" | "conid">;

/** Match the FIFO engine's grouping key so stored manual lots target the same queue. */
export function manualOpeningLotKey(lot: ManualOpeningLotIdentity): string {
  const assetCategory = lot.assetCategory.trim().toUpperCase();
  const symbol = lot.symbol.trim().toUpperCase();
  const isin = lot.isin.trim().toUpperCase();
  const conid = (lot.conid ?? "").trim();
  if (assetCategory === "CRYPTO") return `CRYPTO:${symbol}`;
  if (isin) return isin;
  if (conid) return `${assetCategory}:conid:${conid}`;
  return `${assetCategory}:${symbol}`;
}

/**
 * Normalize and validate one manual opening lot entered by the user.
 *
 * Tolerates raw UI/localStorage data (`unknown` strings, comma decimals,
 * YYYYMMDD dates) and returns a canonical shape or null when the entry is not
 * usable for FIFO.
 */
export function normalizeManualOpeningLot(lot: ManualOpeningLot): ManualOpeningLot | null {
  const asString = (value: unknown): string => (typeof value === "string" ? value : "");

  const symbol = asString(lot.symbol).trim();
  const description = asString(lot.description).trim();
  const isin = asString(lot.isin).trim().toUpperCase();
  const conid = asString(lot.conid).trim() || undefined;
  const assetCategory = asString(lot.assetCategory).trim().toUpperCase();
  const currency = asString(lot.currency).trim().toUpperCase();
  const acquireDate = normalizeDate(asString(lot.acquireDate).trim());
  const quantityRaw = asString(lot.quantity).trim().replace(/,/g, ".");
  const priceRaw = asString(lot.pricePerShare).trim().replace(/,/g, ".");

  if (!assetCategory || !currency || !acquireDate) return null;
  if (!symbol && !isin && !conid) return null;

  let quantity: Decimal;
  let pricePerShare: Decimal;
  try {
    quantity = new Decimal(quantityRaw);
    pricePerShare = new Decimal(priceRaw);
  } catch {
    return null;
  }

  if (!quantity.isFinite() || !pricePerShare.isFinite()) return null;
  if (!quantity.greaterThan(0) || !pricePerShare.greaterThan(0)) return null;

  return {
    symbol,
    description,
    isin,
    ...(conid ? { conid } : {}),
    assetCategory,
    currency,
    acquireDate,
    quantity: quantity.toString(),
    pricePerShare: pricePerShare.toString(),
  };
}

/** Narrow arbitrary parsed JSON to validated manual opening lots. */
export function coerceManualOpeningLots(parsed: unknown): ManualOpeningLot[] {
  if (!Array.isArray(parsed)) return [];
  const lots: ManualOpeningLot[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const normalized = normalizeManualOpeningLot(item as ManualOpeningLot);
    if (normalized) lots.push(normalized);
  }
  return lots;
}

/**
 * Convert validated opening lots into synthetic BUY trades for the FIFO engine.
 *
 * These trades exist only inside report generation; they are never written back
 * to the parsed broker statement.
 */
export function buildManualOpeningLotTrades(lots: ManualOpeningLot[]): Trade[] {
  return lots.map((lot, index) => {
    const quantity = new Decimal(lot.quantity);
    const pricePerShare = new Decimal(lot.pricePerShare);
    const total = quantity.mul(pricePerShare);
    return {
      tradeID: `MANUAL-LOT-${index + 1}`,
      accountId: "MANUAL",
      ...(lot.conid ? { conid: lot.conid } : {}),
      symbol: lot.symbol,
      description: lot.description,
      isin: lot.isin,
      assetCategory: lot.assetCategory as Trade["assetCategory"],
      currency: lot.currency,
      tradeDate: lot.acquireDate,
      settlementDate: lot.acquireDate,
      quantity: quantity.toString(),
      tradePrice: pricePerShare.toString(),
      tradeMoney: total.toString(),
      proceeds: total.toString(),
      cost: total.toString(),
      fifoPnlRealized: "0",
      fxRateToBase: "0",
      buySell: "BUY",
      openCloseIndicator: "O",
      exchange: "MANUAL",
      commissionCurrency: lot.currency,
      commission: "0",
      taxes: "0",
      multiplier: "1",
      notes: "manual-opening-lot",
    };
  });
}
