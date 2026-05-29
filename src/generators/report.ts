/**
 * Tax report generator.
 *
 * Generates a structured report mapping IBKR transactions to
 * Modelo 100 casilla numbers. Since Renta Web does NOT support
 * file import, this produces a human-readable report for manual entry.
 */

import Decimal from "decimal.js";
import type { FlexStatement } from "../types/ibkr.js";
import type { TaxSummary, TaxMessage } from "../types/tax.js";
import type { EcbRateMap } from "../types/ecb.js";
import { FifoEngine } from "../engine/fifo.js";
import { FxFifoEngine } from "../engine/fx-fifo.js";
import { detectWashSales } from "../engine/wash-sale.js";
import { calculateDividends } from "../engine/dividends.js";
import { calculateDoubleTaxation } from "../engine/double-taxation.js";
import { getEcbRate, isEcbResolvable } from "../engine/ecb.js";
import { normalizeDate } from "../engine/dates.js";

const DATE_RE = /\b(\d{4})-\d{2}-\d{2}\b/;

function filterByYear<T>(items: T[], yearStr: string, getText: (item: T) => string, getContext?: (item: T) => Record<string, string> | undefined): T[] {
  return items.filter((item) => {
    const ctx = getContext?.(item);
    if (ctx?.date) return ctx.date.startsWith(yearStr);
    const dateMatch = getText(item).match(DATE_RE);
    if (!dateMatch) return true;
    return dateMatch[1] === yearStr;
  });
}

export interface ReportOptions {
  skipFx?: boolean;
}

/**
 * Generate a complete tax report from an IBKR Flex Statement.
 *
 * @param statement - Parsed IBKR Flex Query
 * @param rateMap - Pre-fetched ECB exchange rates
 * @param year - Tax year
 * @param options - Optional config (skipFx disables FX FIFO engine)
 * @returns TaxSummary with all casilla values calculated
 */
export function generateTaxReport(
  statement: FlexStatement,
  rateMap: EcbRateMap,
  year: number,
  options?: ReportOptions,
): TaxSummary {
  // 1. FIFO capital gains (process ALL years, filter to target year)
  const fifoEngine = new FifoEngine();
  fifoEngine.processTrades(
    statement.trades,
    rateMap,
    statement.corporateActions,
    statement.optionExercises,
  );

  const yearStr = year.toString();
  let disposals = fifoEngine.getDisposals().filter((d) => d.sellDate.startsWith(yearStr));
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
  let unresolvableInterest = 0;
  const interestEntries = interestTransactions
    .filter((t) => {
      // Crypto-denominated income (e.g. Kraken staking, paid in the staked coin)
      // has no ECB rate and can't be valued automatically. Skip it and warn so the
      // user enters its EUR value manually, instead of crashing the whole report.
      if (!isEcbResolvable(t.currency)) {
        unresolvableInterest++;
        return false;
      }
      return true;
    })
    .map((t) => {
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
  // FXCONV/AFx trades filtered per-trade by isFxconv(); securities trades don't generate FX events
  // skipFx: monodivisa mode — treat all as EUR, no separate FX saldo (like Autodeclaro/Taxdown)
  let fxDisposals: ReturnType<FxFifoEngine["processEvents"]> = [];
  let fxTransmissionValue = new Decimal(0);
  let fxAcquisitionValue = new Decimal(0);
  let fxWarningsList: string[] = [];
  let fxMessagesList: TaxMessage[] = [];

  if (!options?.skipFx) {
    const fxEngine = new FxFifoEngine();
    const tradeFxEvents = FxFifoEngine.extractFxEvents(statement.trades, rateMap);
    const cashFxEvents = FxFifoEngine.extractCashFxEvents(statement.cashTransactions, rateMap);
    const allFxDisposals = fxEngine.processEvents([...tradeFxEvents, ...cashFxEvents]);
    fxDisposals = allFxDisposals.filter((d) => d.disposeDate.startsWith(yearStr));

    fxTransmissionValue = fxDisposals.reduce((sum, d) => sum.plus(d.proceedsEur), new Decimal(0));
    fxAcquisitionValue = fxDisposals.reduce((sum, d) => sum.plus(d.costBasisEur), new Decimal(0));

    // Only show FX warnings when there are FX disposals in the target year.
    // Undated warnings (missing lots summaries) refer to events across all years —
    // showing them when the target year has zero FX activity is misleading noise.
    if (fxDisposals.length > 0) {
      fxWarningsList = filterByYear(fxEngine.warnings, yearStr, (w) => w);
      fxMessagesList = filterByYear(fxEngine.messages, yearStr, (m) => m.message, (m) => m.context);
    }
  }

  // 5. Double taxation. Art. 80 caps the deduction by the effective average
  // Spanish rate on the relevant savings-tax base, not by standalone country
  // brackets computed in isolation.
  const totalSavingsBase = Decimal.max(transmissionValue.minus(acquisitionValue), 0)
    .plus(Decimal.max(fxTransmissionValue.minus(fxAcquisitionValue), 0))
    .plus(grossDividends)
    .plus(interestEarned);
  const doubleTaxation = calculateDoubleTaxation(dividendEntries, year, totalSavingsBase);

  // Filter warnings to those relevant to the selected year
  const yearWarnings = filterByYear(fifoEngine.warnings, yearStr, (w) => w);
  const yearMessages = filterByYear(fifoEngine.messages, yearStr, (m) => m.message, (m) => m.context);

  // Prepend parser warnings (unparsed sections, etc.)
  const allWarnings = [...(statement.parserWarnings ?? []), ...yearWarnings, ...fxWarningsList];

  // Aggregate structured messages from all sources
  const allMessages: TaxMessage[] = [...(statement.parserMessages ?? []), ...yearMessages, ...fxMessagesList];

  // Crypto-denominated income (staking rewards paid in the coin) can't be valued
  // via ECB rates. We skip it rather than crash; the user must value it manually.
  if (unresolvableInterest > 0) {
    const cryptoMsg = `Hay ${unresolvableInterest} ingreso(s) en criptomoneda (p. ej. recompensas de staking) que no se han podido valorar automáticamente y no están incluidos en los importes calculados.`;
    allMessages.push({
      id: "report.crypto_income_unvalued",
      severity: "warning",
      message: cryptoMsg,
      hint: "Estos ingresos se pagan en la propia cripto y no tienen tipo de cambio oficial del BCE. Calcula su valor en euros a la fecha de cobro y decláralos manualmente como rendimientos del capital mobiliario (Casilla 0027).",
    });
    allWarnings.push(cryptoMsg);
  }

  // Reconciliation hint: explain why other tools may show different amounts (only when FX gains exist)
  if (!options?.skipFx && fxDisposals.length > 0) {
    allMessages.push({
      id: "report.competitor_reconciliation",
      severity: "info",
      message: "Si otra herramienta muestra un importe distinto, puede deberse a que no calcula las ganancias por tipo de cambio (Art. 37.1.l LIRPF).",
      hint: "Puedes activar el modo monodivisa en tu perfil fiscal para comparar con herramientas como Autodeclaro o Taxdown.",
    });
  }

  return {
    year,
    warnings: allWarnings,
    messages: allMessages,
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
