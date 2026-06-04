/**
 * Tax report generator.
 *
 * Generates a structured report mapping IBKR transactions to
 * Modelo 100 casilla numbers. Since Renta Web does NOT support
 * file import, this produces a human-readable report for manual entry.
 */

import Decimal from "decimal.js";
import type { FlexStatement } from "../types/ibkr.js";
import type { TaxSummary, TaxMessage, FifoDisposal, FxDisposal, DividendEntry } from "../types/tax.js";
import type { EcbRateMap } from "../types/ecb.js";
import { FifoEngine } from "../engine/fifo.js";
import { FxFifoEngine } from "../engine/fx-fifo.js";
import { detectWashSales } from "../engine/wash-sale.js";
import { calculateDividends } from "../engine/dividends.js";
import { calculateDoubleTaxation } from "../engine/double-taxation.js";
import { getEcbRate, isEcbResolvable } from "../engine/ecb.js";
import { resolveCryptoTradeValues } from "../engine/crypto-valuation.js";
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

/**
 * Divide a disposal's monetary fields (and quantity) by the number of titulares.
 * Rates, dates, and classification metadata are per-unit and stay unchanged.
 */
function splitDisposal(d: FifoDisposal, n: number): FifoDisposal {
  if (n <= 1) return d;
  return {
    ...d,
    quantity: d.quantity.div(n),
    proceedsEur: d.proceedsEur.div(n),
    costBasisEur: d.costBasisEur.div(n),
    gainLossEur: d.gainLossEur.div(n),
  };
}

function splitFxDisposal(d: FxDisposal, n: number): FxDisposal {
  if (n <= 1) return d;
  return {
    ...d,
    quantity: d.quantity.div(n),
    proceedsEur: d.proceedsEur.div(n),
    costBasisEur: d.costBasisEur.div(n),
    gainLossEur: d.gainLossEur.div(n),
  };
}

function splitDividend(d: DividendEntry, n: number): DividendEntry {
  if (n <= 1) return d;
  return {
    ...d,
    grossAmountEur: d.grossAmountEur.div(n),
    withholdingTaxEur: d.withholdingTaxEur.div(n),
  };
}

/** Divide an interest amount (already abs-valued EUR) by the number of titulares. */
function splitInterestAmount(amountEur: Decimal, n: number): Decimal {
  return n <= 1 ? amountEur : amountEur.div(n);
}

export interface ReportOptions {
  skipFx?: boolean;
  /**
   * Number of account holders (titulares). Default 1.
   * When > 1, every reported amount is divided equally per contribuyente
   * (Art. 11.3 LIRPF: rentas atribuidas según titularidad; gananciales = 50/50).
   * The declaration is understood to be filed individually by each titular for
   * their proportional share.
   */
  titulares?: number;
  /**
   * User-supplied EUR-per-unit quotes (date → currency → rate) for crypto
   * currencies that have no ECB rate (crypto↔crypto permutas). Consulted as a
   * fallback by the crypto valuation pre-pass, never overriding ECB rates.
   */
  manualRates?: EcbRateMap;
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
  // 0. Crypto valuation pre-pass (A/D/B). Resolves crypto↔crypto permutas to
  //    EUR via cross-leg inference or user manual quotes, injecting synthetic
  //    rates into a cloned map. Unresolvable trades are dropped (and surfaced)
  //    so the FIFO engine never throws on a non-fiat currency.
  const valuation = resolveCryptoTradeValues(statement.trades, rateMap, options?.manualRates);
  const resolvedRateMap = valuation.rateMap;
  const resolvedTrades = valuation.trades;

  // 1. FIFO capital gains (process ALL years, filter to target year)
  const fifoEngine = new FifoEngine();
  fifoEngine.processTrades(
    resolvedTrades,
    resolvedRateMap,
    statement.corporateActions,
    statement.optionExercises,
  );

  // Number of account holders. >1 splits every reported amount equally per
  // contribuyente (Art. 11.3 LIRPF). Sanitized to an integer >= 1.
  // Math.max(1, NaN) is NaN, so guard finiteness explicitly (CLI --titulares abc → NaN).
  const titularesRaw = Math.floor(options?.titulares ?? 1);
  const titulares = Number.isFinite(titularesRaw) && titularesRaw >= 1 ? titularesRaw : 1;

  const yearStr = year.toString();
  let disposals = fifoEngine.getDisposals().filter((d) => d.sellDate.startsWith(yearStr));
  disposals = detectWashSales(disposals, statement.trades);
  if (titulares > 1) disposals = disposals.map((d) => splitDisposal(d, titulares));

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
  let dividendEntries = calculateDividends(yearCashTransactions, rateMap);
  if (titulares > 1) dividendEntries = dividendEntries.map((d) => splitDividend(d, titulares));
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
      const amountEur = splitInterestAmount(new Decimal(t.amount).mul(ecbRate).abs(), titulares);
      const isEarned = t.type.includes("Received");

      if (isEarned) {
        interestEarned = interestEarned.plus(amountEur);
      } else {
        interestPaid = interestPaid.plus(amountEur);
      }

      return {
        type: isEarned ? "earned" as const : "paid" as const,
        description: t.description,
        date: normalizeDate(t.dateTime),
        amountEur,
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
    if (titulares > 1) fxDisposals = fxDisposals.map((d) => splitFxDisposal(d, titulares));

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

  // Crypto valuation pre-pass messages (filtered to the target year by date).
  const cryptoValuationMessages = filterByYear(valuation.messages, yearStr, (m) => m.message, (m) => m.context);
  const yearUnresolvedCrypto = valuation.unresolved.filter((u) => u.date.startsWith(yearStr));

  // Prepend parser warnings (unparsed sections, etc.)
  const allWarnings = [
    ...(statement.parserWarnings ?? []),
    ...yearWarnings,
    ...fxWarningsList,
    ...cryptoValuationMessages.map((m) => m.message),
  ];

  // Aggregate structured messages from all sources
  const allMessages: TaxMessage[] = [...(statement.parserMessages ?? []), ...yearMessages, ...fxMessagesList, ...cryptoValuationMessages];

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

  // Shared-titularity notice: amounts have been split equally per contribuyente.
  if (titulares > 1) {
    allMessages.push({
      id: "report.titularidad_compartida",
      severity: "info",
      message: `Los importes mostrados están divididos entre ${titulares} titulares (la parte que corresponde a cada contribuyente). Este informe refleja la declaración de UN solo titular: cada uno de los ${titulares} titulares debe presentar su propia declaración con esta misma parte. No declares el total en una sola declaración ni sumes las partes de varios titulares en la tuya.`,
      hint: `El reparto a partes iguales (${titulares} × ${(100 / titulares).toFixed(titulares === 3 ? 2 : 0)} %) presupone titularidad por igual. Si los porcentajes de titularidad son distintos (p. ej. 70/30), ajusta los importes manualmente. En cuentas de gananciales la atribución es 50/50 (Art. 11.3 LIRPF). Puedes cambiar el número de titulares en tu perfil fiscal.`,
      context: { titulares: String(titulares) },
    });
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
    unresolvedCryptoValuations: yearUnresolvedCrypto.length > 0 ? yearUnresolvedCrypto : undefined,
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
