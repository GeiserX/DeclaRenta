/**
 * Loss carryforward engine (Art. 49 LIRPF).
 *
 * Spanish tax law allows capital losses to be carried forward for 4 years.
 * Cross-compensation rules apply:
 * - Net capital gains losses can offset up to 25% of positive capital income (dividends + interest)
 * - Net capital income losses can offset up to 25% of capital gains
 * - Uncompensated losses carry to next year (up to 4 years total)
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
  let adjustedGains = new Decimal(netGains);
  let adjustedIncome = new Decimal(netIncome);
  let totalCompensated = new Decimal(0);
  let expiredLosses = new Decimal(0);

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

  // Step 2: Cross-category compensation (25% limit)
  // Remaining gains losses can offset up to 25% of positive capital income
  if (adjustedIncome.greaterThan(0)) {
    const maxCross = adjustedIncome.mul(new Decimal("0.25"));
    let crossUsed = new Decimal(0);
    for (const loss of gainsLosses) {
      if (crossUsed.greaterThanOrEqualTo(maxCross)) break;
      const available = loss.remaining.abs();
      if (available.isZero()) continue;
      const compensate = Decimal.min(available, maxCross.minus(crossUsed));
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
    const maxCross = adjustedGains.mul(new Decimal("0.25"));
    let crossUsed = new Decimal(0);
    for (const loss of incomeLosses) {
      if (crossUsed.greaterThanOrEqualTo(maxCross)) break;
      const available = loss.remaining.abs();
      if (available.isZero()) continue;
      const compensate = Decimal.min(available, maxCross.minus(crossUsed));
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

  // Add current year losses
  if (netGains.lessThan(0)) {
    updatedCarryforward.push({
      year: currentYear,
      amount: netGains,
      remaining: netGains,
      category: "gains",
    });
    details.push(`📝 Nueva pérdida ganancias ${currentYear}: ${netGains.abs().toFixed(2)} EUR (se arrastra)`);
  }
  if (netIncome.lessThan(0)) {
    updatedCarryforward.push({
      year: currentYear,
      amount: netIncome,
      remaining: netIncome,
      category: "income",
    });
    details.push(`📝 Nueva pérdida rentas ${currentYear}: ${netIncome.abs().toFixed(2)} EUR (se arrastra)`);
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
