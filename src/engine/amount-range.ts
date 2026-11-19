/**
 * The range of a number DeclaRenta reads from a trade and counts in a box.
 *
 * decimal.js reads "1e1000000000" as a finite number, and `toFixed` writes
 * one character per digit, so one such cell made the CLI, the web annex and
 * several parsers run out of memory; a cell of "1e2000" put a 2000-digit loss
 * in box 0331 with no warning (CodeRabbit on #470). Two rules close it:
 *
 * - **What is read** (`tradeOutOfRange`, `cashOutOfRange`): no broker writes a
 *   number with more than 20 integer digits, or a non-zero one smaller than
 *   10^-20 (the same bounds a holding's share count has, `hasPrintableDigits`).
 *   A trade, a cash row (dividend, interest, withholding, reward) or a
 *   corporate action with such a number is named and its amounts are not
 *   counted (report.ts).
 * - **What is counted** (`isCountableAmount`): an amount in euros counts in a
 *   box only when it fits 12 integer digits, 999,999,999,999.99 €. That is the
 *   widest amount field the AEAT gives the value of a holding (the Modelo
 *   720's valoración, `fitsModelo720Amount`; the Modelo 721 gives 13 to a
 *   whole year's acquisition cost). One trade worth more than a single holding
 *   can be declared at is not a real trade.
 */

import Decimal from "decimal.js";

/** Trade fields an engine reads as numbers (FIFO, the currency engine, crypto valuation). */
const TRADE_NUMBER_FIELDS = ["quantity", "tradePrice", "multiplier", "commission", "taxes", "tradeMoney"] as const;

type TradeNumbers = Record<(typeof TRADE_NUMBER_FIELDS)[number], string>;

const TRADE_NUMBER_MAX = new Decimal("1e20");
const TRADE_NUMBER_MIN = new Decimal("1e-20");

/** A finite number past the range a broker writes: more than 20 integer digits, or below 10^-20 and not 0. */
function outOfReadRange(value: Decimal): boolean {
  if (!value.isFinite() || value.isZero()) return false;
  const abs = value.abs();
  return abs.greaterThanOrEqualTo(TRADE_NUMBER_MAX) || abs.lessThan(TRADE_NUMBER_MIN);
}

function readNumber(text: string | undefined): Decimal | null {
  if (text === undefined || text.trim() === "") return null;
  try {
    return new Decimal(text.trim());
  } catch {
    return null;
  }
}

/**
 * Whether a trade has a number no broker writes: a quantity, price,
 * multiplier, commission, tax or amount past 20 integer digits or non-zero
 * below 10^-20, or a gross amount (quantity × price × multiplier) past 20
 * integer digits. Text that is no number is not this rule's concern (the
 * parsers mark it `quantityUnknown` or read it as 0).
 */
export function tradeOutOfRange(trade: TradeNumbers): boolean {
  if (TRADE_NUMBER_FIELDS.some((field) => {
    const value = readNumber(trade[field]);
    return value !== null && outOfReadRange(value);
  })) return true;
  const quantity = readNumber(trade.quantity);
  const price = readNumber(trade.tradePrice);
  const multiplier = readNumber(trade.multiplier);
  if (quantity === null || price === null || !quantity.isFinite() || !price.isFinite()) return false;
  const gross = quantity.mul(price).mul(multiplier !== null && multiplier.isFinite() ? multiplier : 1);
  return gross.abs().greaterThanOrEqualTo(TRADE_NUMBER_MAX);
}

/**
 * Whether a cash row (dividend, withholding, interest, reward) has an amount
 * or a reward quantity no broker writes, by the rule of `tradeOutOfRange`.
 */
export function cashOutOfRange(row: { amount: string; rewardQuantity?: string; rewardCostBasisEur?: string }): boolean {
  return anyOutOfReadRange([row.amount, row.rewardQuantity, row.rewardCostBasisEur]);
}

/**
 * Whether a corporate action (a split, a merger, a cash buyout) has a
 * quantity or an amount no broker writes, by the rule of `tradeOutOfRange`.
 * A cash buyout is booked as a sale of its quantity for its amount.
 */
export function corporateActionOutOfRange(action: { quantity: string; amount: string }): boolean {
  return anyOutOfReadRange([action.quantity, action.amount]);
}

function anyOutOfReadRange(texts: (string | undefined)[]): boolean {
  return texts.some((text) => {
    const value = readNumber(text);
    return value !== null && outOfReadRange(value);
  });
}

/**
 * Whether an option exercise, assignment or expiration (IBKR OptionEAE) has
 * a number FIFO reads that no broker writes, by the rule of
 * `tradeOutOfRange`: the contracts, the multiplier or the strike, the shares
 * delivered (contracts × multiplier) or their amount (× strike). FIFO books
 * nothing for such a row (`processOptionExercises`) and report.ts names it.
 * The row's `proceeds` and `marketPrice` are not read: FIFO never uses them.
 */
export function optionExerciseOutOfRange(ex: { quantity: string; multiplier: string; strike: string }): boolean {
  if (anyOutOfReadRange([ex.quantity, ex.multiplier, ex.strike])) return true;
  const quantity = readNumber(ex.quantity);
  if (quantity === null || !quantity.isFinite()) return false;
  // FIFO reads an empty multiplier as 100 contracts' worth of shares.
  const multiplier = readNumber(ex.multiplier) ?? new Decimal(100);
  const shares = quantity.mul(multiplier.isFinite() ? multiplier : 1).abs();
  if (shares.greaterThanOrEqualTo(TRADE_NUMBER_MAX)) return true;
  const strike = readNumber(ex.strike);
  return strike !== null && strike.isFinite() && shares.mul(strike).abs().greaterThanOrEqualTo(TRADE_NUMBER_MAX);
}

/**
 * Whether a corporate action's quantity alone is past the range a broker
 * writes. report.ts gives such an action the quantity "0", the parsers' "no
 * readable quantity", so it moves no share (a cash buyout sells nothing, a
 * scrip dividend books no lot); a split still takes its ratio from the
 * description.
 */
export function corporateActionQuantityOutOfRange(action: { quantity: string }): boolean {
  return anyOutOfReadRange([action.quantity]);
}

/** Whether a number written as text is past the range a broker writes (`tradeOutOfRange`). */
export function numberTextOutOfRange(text: string): boolean {
  return anyOutOfReadRange([text]);
}

/** Whether a trade's quantity alone is past the range a broker writes. */
export function tradeQuantityOutOfRange(trade: Pick<TradeNumbers, "quantity">): boolean {
  const quantity = readNumber(trade.quantity);
  return quantity !== null && outOfReadRange(quantity);
}

const AMOUNT_LIMIT = new Decimal("1e12");

/**
 * Whether an amount in euros counts in a box: finite, and at most 12 integer
 * digits once rounded to cents (the Modelo 720's valoración width).
 */
export function isCountableAmount(eur: Decimal): boolean {
  return eur.isFinite() && eur.abs().toDecimalPlaces(2, Decimal.ROUND_HALF_UP).lessThan(AMOUNT_LIMIT);
}

/**
 * The most digits a number may have when written in full. Real data never
 * comes near it: the engine computes at 20 significant digits, so a split,
 * a merger or a spin-off gives a count such as 0.041133333333333333333 (21
 * decimals). Only an absurd exponent passes it, and that is never expanded:
 * in full, "1e-1000000000" is a billion characters.
 */
const MAX_PRINTED_DIGITS = 60;

/**
 * Whether `d` written in full with `decimals` decimals (all of its own when
 * omitted) has at most 60 digits. A finite number that fails this is never
 * passed to `toFixed`.
 */
export function printsInFull(d: Decimal, decimals: number = d.decimalPlaces()): boolean {
  return d.isFinite() && Math.max(d.e + 1, 1) + decimals <= MAX_PRINTED_DIGITS;
}

/**
 * A number as plain text with `decimals` decimals (`toFixed`), or in exponent
 * form (`toString`) when the plain text would pass 60 digits. A parser writes
 * its amounts with it, so a cell such as "1e1000000000" reaches the engine as
 * text that `tradeOutOfRange` names, instead of exhausting the memory first.
 * Every number real data holds is written exactly as `toFixed` writes it.
 */
export function plainOrExponent(d: Decimal, decimals?: number): string {
  if (!d.isFinite()) return d.toString();
  if (decimals === undefined) return printsInFull(d) ? d.toFixed() : d.toString();
  return printsInFull(d, decimals) ? d.toFixed(decimals) : d.toString();
}
