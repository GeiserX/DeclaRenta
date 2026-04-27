/**
 * Tax report generator.
 *
 * Generates a structured report mapping IBKR transactions to
 * Modelo 100 casilla numbers. Since Renta Web does NOT support
 * file import, this produces a human-readable report for manual entry.
 */

import Decimal from "decimal.js";
import type { FlexStatement } from "../types/ibkr.js";
import type { TaxSummary } from "../types/tax.js";
import type { EcbRateMap } from "../types/ecb.js";
import { FifoEngine } from "../engine/fifo.js";
import { FxFifoEngine } from "../engine/fx-fifo.js";
import { detectWashSales } from "../engine/wash-sale.js";
import { calculateDividends } from "../engine/dividends.js";
import { calculateDoubleTaxation } from "../engine/double-taxation.js";
import { getEcbRate } from "../engine/ecb.js";
import { normalizeDate } from "../engine/dates.js";

/**
 * Generate a complete tax report from an IBKR Flex Statement.
 *
 * @param statement - Parsed IBKR Flex Query
 * @param rateMap - Pre-fetched ECB exchange rates
 * @param year - Tax year
 * @returns TaxSummary with all casilla values calculated
 */
export function generateTaxReport(
  statement: FlexStatement,
  rateMap: EcbRateMap,
  year: number,
): TaxSummary {
  // 1. FIFO capital gains (process ALL years, filter to target year)
  const fifoEngine = new FifoEngine();
  const allDisposals = fifoEngine.processTrades(statement.trades, rateMap, statement.corporateActions);
  const yearStr = year.toString();
  let disposals = allDisposals.filter((d) => d.sellDate.startsWith(yearStr));
  disposals = detectWashSales(disposals, statement.trades);

  const transmissionValue = disposals.reduce(
    (sum, d) => sum.plus(d.proceedsEur),
    new Decimal(0),
  );
  const acquisitionValue = disposals.reduce(
    (sum, d) => sum.plus(d.costBasisEur),
    new Decimal(0),
  );
  const blockedLosses = disposals
    .filter((d) => d.washSaleBlocked)
    .reduce((sum, d) => sum.plus(d.gainLossEur.abs()), new Decimal(0));

  // 2. Dividends (filter to target year)
  const yearCashTransactions = statement.cashTransactions.filter((t) => t.dateTime.startsWith(yearStr));
  const dividendEntries = calculateDividends(yearCashTransactions, rateMap);
  const grossDividends = dividendEntries.reduce(
    (sum, d) => sum.plus(d.grossAmountEur),
    new Decimal(0),
  );

  // 3. Interest (already filtered to target year)
  const interestTransactions = yearCashTransactions.filter(
    (t) =>
      t.type === "Broker Interest Received" ||
      t.type === "Broker Interest Paid" ||
      t.type === "Bond Interest Received" ||
      t.type === "Bond Interest Paid",
  );

  let interestEarned = new Decimal(0);
  let interestPaid = new Decimal(0);
  const interestEntries = interestTransactions.map((t) => {
    const ecbRate = getEcbRate(rateMap, normalizeDate(t.dateTime), t.currency);
    const amountEur = new Decimal(t.amount).mul(ecbRate);
    const isEarned = t.type.includes("Received");

    if (isEarned) {
      interestEarned = interestEarned.plus(amountEur.abs());
    } else {
      interestPaid = interestPaid.plus(amountEur.abs());
    }

    return {
      type: isEarned ? "earned" as const : "paid" as const,
      description: t.description,
      date: normalizeDate(t.dateTime),
      amountEur: amountEur.abs(),
      currency: t.currency,
      ecbRate,
    };
  });

  // 4. FX gains (Art. 37.1.l LIRPF — currency conversions as taxable events)
  // Auto-convert accounts (FXCONV present) don't hold FCY — no implicit FX events from trades
  const fxEngine = new FxFifoEngine();
  const autoConvert = FxFifoEngine.detectAutoConvert(statement.trades);
  const tradeFxEvents = FxFifoEngine.extractFxEvents(statement.trades, rateMap);
  const cashFxEvents = FxFifoEngine.extractCashFxEvents(statement.cashTransactions, rateMap, autoConvert);
  const allFxDisposals = fxEngine.processEvents([...tradeFxEvents, ...cashFxEvents]);
  const fxDisposals = allFxDisposals.filter((d) => d.disposeDate.startsWith(yearStr));

  const fxTransmissionValue = fxDisposals.reduce((sum, d) => sum.plus(d.proceedsEur), new Decimal(0));
  const fxAcquisitionValue = fxDisposals.reduce((sum, d) => sum.plus(d.costBasisEur), new Decimal(0));

  // 5. Double taxation
  const doubleTaxation = calculateDoubleTaxation(dividendEntries);

  // Filter warnings to those relevant to the selected year
  const yearWarnings = fifoEngine.warnings.filter((w) => {
    const dateMatch = w.match(/\b(\d{4})-\d{2}-\d{2}\b/);
    if (!dateMatch) return true; // No date in warning → always show
    return dateMatch[1] === yearStr;
  });

  const fxWarnings = fxEngine.warnings.filter((w) => {
    const dateMatch = w.match(/\b(\d{4})-\d{2}-\d{2}\b/);
    if (!dateMatch) return true;
    return dateMatch[1] === yearStr;
  });

  // Prepend parser warnings (unparsed sections, etc.)
  const allWarnings = [...(statement.parserWarnings ?? []), ...yearWarnings, ...fxWarnings];

  return {
    year,
    warnings: allWarnings,
    capitalGains: {
      transmissionValue,
      acquisitionValue,
      netGainLoss: transmissionValue.minus(acquisitionValue),
      blockedLosses,
      disposals,
    },
    dividends: {
      grossIncome: grossDividends,
      deductibleExpenses: new Decimal(0),
      entries: dividendEntries,
    },
    interest: {
      earned: interestEarned,
      paid: interestPaid,
      entries: interestEntries,
    },
    doubleTaxation: {
      deduction: doubleTaxation.total,
      byCountry: doubleTaxation.byCountry,
    },
    fxGains: {
      transmissionValue: fxTransmissionValue,
      acquisitionValue: fxAcquisitionValue,
      netGainLoss: fxTransmissionValue.minus(fxAcquisitionValue),
      disposals: fxDisposals,
    },
  };
}
