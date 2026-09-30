/**
 * Loss carryforward engine (Art. 49 LIRPF).
 *
 * Spanish tax law allows capital losses to be carried forward for 4 years.
 * Cross-compensation rules apply:
 * - Net capital gains losses can offset up to 25% of positive capital income (dividends + interest)
 * - Net capital income losses can offset up to 25% of capital gains
 * - Uncompensated losses carry to next year (up to 4 years total)
 *
 * Order (Art. 49.1-2 LIRPF, AEAT Manual práctico IRPF, cap. 12):
 * 1. The current year's negative balance offsets the other bucket's positive
 *    balance, up to 25% of it. Only the remainder carries forward.
 * 2. Prior-year losses offset their own bucket, oldest first.
 * 3. Prior-year losses offset the other bucket, oldest first. The 25% cap is
 *    one cap per direction, computed on the year's positive balance before any
 *    compensation and shared with step 1.
 */

import Decimal from "decimal.js";
import type { LossCarryforward } from "../types/tax.js";

/** Result of applying loss carryforward to a tax year */
export interface LossCarryforwardResult {
  /** Adjusted capital gains after compensation */
  adjustedGains: Decimal;
  /** Adjusted capital income after compensation */
  adjustedIncome: Decimal;
  /** Total losses compensated this year */
  totalCompensated: Decimal;
  /** Losses that expired this year (older than 4 years) */
  expiredLosses: Decimal;
  /** Updated carryforward entries for next year */
  updatedCarryforward: LossCarryforward[];
  /** Human-readable breakdown */
  details: string[];
}

/** Result of {@link offsetCurrentYearLosses}. */
export interface CurrentYearOffset {
  /** Gains balance after the same-year offset (negative = loss still pending). */
  gains: Decimal;
  /** Income balance after the same-year offset (negative = loss still pending). */
  income: Decimal;
  /** Gains loss offset against this year's income. */
  gainsLossOffset: Decimal;
  /** Income loss offset against this year's gains. */
  incomeLossOffset: Decimal;
}

/**
 * Same-year cross-compensation (Art. 49.1.a/b LIRPF): a negative balance in one
 * savings bucket offsets the other bucket's positive balance of the SAME year,
 * up to 25% of that positive balance. Only one bucket can be negative while the
 * other is positive, so at most one direction applies.
 *
 * @param netGains - Gains/losses balance (capital gains + FX)
 * @param netIncome - Capital income balance (dividends + interest)
 */
export function offsetCurrentYearLosses(netGains: Decimal, netIncome: Decimal): CurrentYearOffset {
  let gains = new Decimal(netGains);
  let income = new Decimal(netIncome);
  let gainsLossOffset = new Decimal(0);
  let incomeLossOffset = new Decimal(0);
  if (gains.lessThan(0) && income.greaterThan(0)) {
    gainsLossOffset = Decimal.min(gains.abs(), income.mul(new Decimal("0.25")));
    gains = gains.plus(gainsLossOffset);
    income = income.minus(gainsLossOffset);
  } else if (income.lessThan(0) && gains.greaterThan(0)) {
    incomeLossOffset = Decimal.min(income.abs(), gains.mul(new Decimal("0.25")));
    income = income.plus(incomeLossOffset);
    gains = gains.minus(incomeLossOffset);
  }
  return { gains, income, gainsLossOffset, incomeLossOffset };
}

/**
 * Apply loss carryforward from prior years to the current year's tax results.
 *
 * @param currentYear - Current tax year
 * @param netGains - Net capital gains (positive = gains, negative = losses)
 * @param netIncome - Net capital income (dividends + interest - expenses)
 * @param priorLosses - Losses carried forward from previous years
 * @returns Result with adjusted amounts and updated carryforward
 */
export function applyLossCarryforward(
  currentYear: number,
  netGains: Decimal,
  netIncome: Decimal,
  priorLosses: LossCarryforward[],
): LossCarryforwardResult {
  const details: string[] = [];
  let totalCompensated = new Decimal(0);
  let expiredLosses = new Decimal(0);

  // One 25% cap per direction, on the year's positive balance before any
  // compensation (AEAT Manual práctico IRPF, cap. 12, caso práctico).
  const quarter = new Decimal("0.25");
  const maxCrossToIncome = Decimal.max(netIncome, 0).mul(quarter);
  const maxCrossToGains = Decimal.max(netGains, 0).mul(quarter);

  // Step 0: the current year's negative balance offsets the other bucket first.
  const current = offsetCurrentYearLosses(netGains, netIncome);
  let adjustedGains = current.gains;
  let adjustedIncome = current.income;
  if (current.gainsLossOffset.greaterThan(0)) {
    totalCompensated = totalCompensated.plus(current.gainsLossOffset);
    details.push(`🔄 Compensación cruzada ${currentYear} (pérdidas ganancias → rentas): ${current.gainsLossOffset.toFixed(2)} EUR (máx. 25%)`);
  }
  if (current.incomeLossOffset.greaterThan(0)) {
    totalCompensated = totalCompensated.plus(current.incomeLossOffset);
    details.push(`🔄 Compensación cruzada ${currentYear} (pérdidas rentas → ganancias): ${current.incomeLossOffset.toFixed(2)} EUR (máx. 25%)`);
  }

  // Filter out expired losses (older than 4 years) and separate by category
  const validLosses: LossCarryforward[] = [];
  for (const loss of priorLosses) {
    if (currentYear - loss.year > 4) {
      expiredLosses = expiredLosses.plus(loss.remaining.abs());
      details.push(`⏰ Pérdida de ${loss.year} expirada: ${loss.remaining.abs().toFixed(2)} EUR (${loss.category})`);
    } else if (loss.remaining.abs().greaterThan(0)) {
      validLosses.push({ ...loss, remaining: new Decimal(loss.remaining) });
    }
  }

  // Sort by year (oldest first — FIFO for loss usage)
  validLosses.sort((a, b) => a.year - b.year);

  const gainsLosses = validLosses.filter((l) => l.category === "gains");
  const incomeLosses = validLosses.filter((l) => l.category === "income");

  // Step 1: Same-category compensation
  // Capital gains losses offset current capital gains
  if (adjustedGains.greaterThan(0)) {
    for (const loss of gainsLosses) {
      if (adjustedGains.lessThanOrEqualTo(0)) break;
      const available = loss.remaining.abs();
      const compensate = Decimal.min(available, adjustedGains);
      adjustedGains = adjustedGains.minus(compensate);
      loss.remaining = loss.remaining.plus(compensate); // Move towards zero
      totalCompensated = totalCompensated.plus(compensate);
      details.push(`✅ Compensación ganancias con pérdida ${loss.year}: ${compensate.toFixed(2)} EUR`);
    }
  }

  // Capital income losses offset current capital income
  if (adjustedIncome.greaterThan(0)) {
    for (const loss of incomeLosses) {
      if (adjustedIncome.lessThanOrEqualTo(0)) break;
      const available = loss.remaining.abs();
      const compensate = Decimal.min(available, adjustedIncome);
      adjustedIncome = adjustedIncome.minus(compensate);
      loss.remaining = loss.remaining.plus(compensate);
      totalCompensated = totalCompensated.plus(compensate);
      details.push(`✅ Compensación rentas con pérdida ${loss.year}: ${compensate.toFixed(2)} EUR`);
    }
  }

  // Step 2: Cross-category compensation (25% limit, shared with Step 0)
  // Remaining gains losses can offset up to 25% of positive capital income
  if (adjustedIncome.greaterThan(0)) {
    const maxCross = Decimal.max(0, maxCrossToIncome.minus(current.gainsLossOffset));
    let crossUsed = new Decimal(0);
    for (const loss of gainsLosses) {
      if (crossUsed.greaterThanOrEqualTo(maxCross) || adjustedIncome.lessThanOrEqualTo(0)) break;
      const available = loss.remaining.abs();
      if (available.isZero()) continue;
      const compensate = Decimal.min(available, maxCross.minus(crossUsed), adjustedIncome);
      adjustedIncome = adjustedIncome.minus(compensate);
      loss.remaining = loss.remaining.plus(compensate);
      crossUsed = crossUsed.plus(compensate);
      totalCompensated = totalCompensated.plus(compensate);
    }
    if (crossUsed.greaterThan(0)) {
      details.push(`🔄 Compensación cruzada (pérdidas ganancias → rentas): ${crossUsed.toFixed(2)} EUR (máx. 25%)`);
    }
  }

  // Remaining income losses can offset up to 25% of positive capital gains
  if (adjustedGains.greaterThan(0)) {
    const maxCross = Decimal.max(0, maxCrossToGains.minus(current.incomeLossOffset));
    let crossUsed = new Decimal(0);
    for (const loss of incomeLosses) {
      if (crossUsed.greaterThanOrEqualTo(maxCross) || adjustedGains.lessThanOrEqualTo(0)) break;
      const available = loss.remaining.abs();
      if (available.isZero()) continue;
      const compensate = Decimal.min(available, maxCross.minus(crossUsed), adjustedGains);
      adjustedGains = adjustedGains.minus(compensate);
      loss.remaining = loss.remaining.plus(compensate);
      crossUsed = crossUsed.plus(compensate);
      totalCompensated = totalCompensated.plus(compensate);
    }
    if (crossUsed.greaterThan(0)) {
      details.push(`🔄 Compensación cruzada (pérdidas rentas → ganancias): ${crossUsed.toFixed(2)} EUR (máx. 25%)`);
    }
  }

  // Step 3: Add current year's losses to carryforward if negative
  const updatedCarryforward: LossCarryforward[] = [];

  // Keep remaining prior losses
  for (const loss of validLosses) {
    if (loss.remaining.abs().greaterThan(new Decimal("0.01"))) {
      updatedCarryforward.push(loss);
    }
  }

  // Add what is left of the current year's losses after the Step 0 offset
  if (current.gains.lessThan(0)) {
    updatedCarryforward.push({
      year: currentYear,
      amount: current.gains,
      remaining: current.gains,
      category: "gains",
    });
    details.push(`📝 Nueva pérdida ganancias ${currentYear}: ${current.gains.abs().toFixed(2)} EUR (se arrastra)`);
  }
  if (current.income.lessThan(0)) {
    updatedCarryforward.push({
      year: currentYear,
      amount: current.income,
      remaining: current.income,
      category: "income",
    });
    details.push(`📝 Nueva pérdida rentas ${currentYear}: ${current.income.abs().toFixed(2)} EUR (se arrastra)`);
  }

  return {
    adjustedGains,
    adjustedIncome,
    totalCompensated,
    expiredLosses,
    updatedCarryforward,
    details,
  };
}
