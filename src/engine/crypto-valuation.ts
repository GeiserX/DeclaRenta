/**
 * Crypto trade valuation pre-pass.
 *
 * Crypto↔crypto swaps (e.g. Binance Convert SOL→BTC) are taxable permutas
 * (Art. 37.1.h LIRPF, DGT V0999-18) but carry no fiat leg, so the FIFO engine
 * cannot price them via ECB rates and would throw
 * "No ECB rate available for non-fiat currency".
 *
 * This module runs BEFORE the FIFO engine and resolves each trade's value to
 * EUR using a single precedence chain, expressed as synthetic entries injected
 * into a CLONED rate map. Because getEcbRate returns ANY rate present in the
 * map, the FIFO engine then needs zero changes and never throws on a kept trade.
 *
 * Precedence per currency that needs valuing:
 *   1. ECB (fiat / stablecoin) — authoritative, never overridden.
 *   2. Manual (B) — user-supplied EUR-per-unit quote (crypto only).
 *   3. Cross-leg (D) — if the other side of the swap is resolvable, infer
 *      eurRate(currency) = eurRate(symbol) / tradePrice.
 *      Units: (EUR/symbol) ÷ (currency/symbol) = EUR/currency.
 *   4. Skip + warn (A) — drop the trade and surface it for manual entry.
 *
 * We deliberately do NOT consult any live external price API/oracle (see
 * CLAUDE.md): the set of {coins, dates, amounts} is a portfolio fingerprint and
 * must never leave the user's machine.
 *
 * KNOWN LIMITATION (cross-date phantom gain): dropping an unresolvable BUY leg
 * means no FIFO lot is created for the acquired coin. If a LATER, resolvable
 * SELL of that same coin then runs, the FIFO engine finds no prior lot and
 * taxes the full proceeds as gain (costBasis = 0). This is conservative — it
 * never understates tax — and the dropped leg is always surfaced as an
 * UnresolvedValuation so the user can supply a manual rate (B) and value the
 * acquisition correctly. It is intentionally NOT worked around here.
 */

import Decimal from "decimal.js";
import type { Trade } from "../types/ibkr.js";
import type { EcbRateMap } from "../types/ecb.js";
import type { TaxMessage, UnresolvedValuation } from "../types/tax.js";
import { lookupRateInMap, normalizeCurrency, isEcbResolvable } from "./ecb.js";
import { normalizeDate } from "./dates.js";

export interface CryptoValuationResult {
  /** Trades to feed the FIFO engine (unresolvable ones dropped, commissions neutralized). */
  trades: Trade[];
  /** Augmented clone of the input rate map with synthetic crypto rates injected. */
  rateMap: EcbRateMap;
  /** Structured messages (warnings/info) about skipped trades and neutralized commissions. */
  messages: TaxMessage[];
  /** Trades dropped for lack of a resolvable value — drive the manual-entry UI. */
  unresolved: UnresolvedValuation[];
}

/**
 * Per-source memoization of the read-only base clone.
 *
 * `resolveCryptoTradeValues` deep-copies the entire ECB map every call only to
 * then inject a few synthetic crypto rates into it (cross-leg D / commission).
 * Rebuilding the whole structure on every re-run (e.g. the web pipeline re-runs
 * when the user adds a manual rate) is wasteful on large multi-year maps.
 *
 * We cache, keyed by SOURCE-MAP IDENTITY (WeakMap → GC-safe, auto-invalidates
 * when a different map reference is passed), a canonical base whose inner
 * per-date Maps the working clone shares BY REFERENCE. The clone then uses
 * copy-on-write: `setRate` copies the one date bucket it is about to mutate
 * before touching it, so the cached base (and the caller's source map) are
 * NEVER mutated and stay reusable across calls.
 *
 * Why the cached base must be treated as strictly read-only: `tryResolve`
 * consults the map BEFORE the user's manual rates. If a call-specific synthetic
 * (D) rate ever leaked into the cached base, a later call would find that stale
 * guess and silently outrank a user's authoritative manual (B) quote — the very
 * thing a re-run is meant to let the user fix. Copy-on-write in `setRate` is the
 * load-bearing guarantee that this never happens.
 *
 * `Object.freeze` does NOT protect Map mutation (Maps use internal slots), so
 * read-only-ness is enforced structurally by copy-on-write, not by freezing.
 */
const baseCloneCache = new WeakMap<EcbRateMap, EcbRateMap>();

/** A working clone plus the set of date buckets it has already copied-on-write. */
interface WorkingClone {
  map: EcbRateMap;
  /** Date keys whose inner Map is a fresh, clone-owned copy (safe to mutate). */
  owned: Set<string>;
}

/**
 * Build a working clone of `source` that shares the cached base's inner Maps by
 * reference. The outer Map is always freshly allocated (cheap — one slot per
 * date), so adding brand-new date buckets never touches the base; existing
 * buckets are copy-on-written lazily by `setRate`.
 */
function makeWorkingClone(source: EcbRateMap): WorkingClone {
  let base = baseCloneCache.get(source);
  if (base === undefined) {
    base = new Map();
    for (const [date, currencies] of source) {
      base.set(date, new Map(currencies));
    }
    baseCloneCache.set(source, base);
  }
  // Fresh outer Map sharing the base's inner Maps by reference (no per-bucket copy).
  return { map: new Map(base), owned: new Set() };
}

/**
 * Inject a synthetic rate (EUR per 1 unit of currency) at an exact date.
 * Copy-on-write: clones the target date bucket before mutating it the first
 * time, so the shared/cached base bucket is never modified.
 */
function setRate(clone: WorkingClone, date: string, currency: string, rate: Decimal): void {
  const key = normalizeDate(date);
  const resolved = normalizeCurrency(currency);
  const existing = clone.map.get(key);
  if (existing === undefined) {
    // Brand-new bucket — clone-owned by construction, never shared with the base.
    clone.map.set(key, new Map([[resolved, rate.toFixed(10)]]));
    clone.owned.add(key);
    return;
  }
  if (!clone.owned.has(key)) {
    // First mutation of a base-shared bucket: copy-on-write so the base stays read-only.
    const copy = new Map(existing);
    clone.map.set(key, copy);
    clone.owned.add(key);
    copy.set(resolved, rate.toFixed(10));
    return;
  }
  existing.set(resolved, rate.toFixed(10));
}

/** Try ECB/synthetic map first (authoritative), then the user's manual quotes. */
function tryResolve(map: EcbRateMap, manual: EcbRateMap | undefined, date: string, currency: string): Decimal | null {
  const fromMap = lookupRateInMap(map, date, currency);
  if (fromMap !== null) return fromMap;
  if (manual) {
    const fromManual = lookupRateInMap(manual, date, currency);
    if (fromManual !== null) return fromManual;
  }
  return null;
}

/**
 * Resolve every trade to an EUR-valuable state. Only CRYPTO trades can be
 * unresolvable; fiat/stock trades pass through untouched (their currency is
 * already in the ECB map).
 */
export function resolveCryptoTradeValues(
  trades: Trade[],
  rateMap: EcbRateMap,
  manualRates?: EcbRateMap,
): CryptoValuationResult {
  const cloned = makeWorkingClone(rateMap);
  const outTrades: Trade[] = [];
  const unresolved: UnresolvedValuation[] = [];
  const seenUnresolved = new Set<string>();
  let neutralizedCommissions = 0;

  for (const trade of trades) {
    const date = trade.tradeDate;

    // 1. Resolve the trade's quote currency.
    let currencyRate = tryResolve(cloned.map, manualRates, date, trade.currency);
    let crossLegTried = false;

    if (currencyRate === null && !isEcbResolvable(trade.currency)) {
      // 2. Cross-leg inference (D): price the unresolvable quote currency from
      //    the symbol's rate, if the symbol side is resolvable.
      crossLegTried = true;
      const tradePrice = (() => {
        try {
          return new Decimal(trade.tradePrice || "0");
        } catch {
          return new Decimal(0);
        }
      })();
      const symbolRate = tryResolve(cloned.map, manualRates, date, trade.symbol);
      if (symbolRate !== null && tradePrice.greaterThan(0)) {
        currencyRate = symbolRate.div(tradePrice);
      }
    }

    if (currencyRate === null) {
      // 3. Skip + warn (A). Record once per currency+date for manual entry.
      const key = `${normalizeCurrency(trade.currency)}|${normalizeDate(date)}`;
      if (!seenUnresolved.has(key)) {
        seenUnresolved.add(key);
        unresolved.push({
          currency: trade.currency,
          date: normalizeDate(date),
          symbol: trade.symbol,
          description: trade.description,
          quantity: trade.quantity,
          reason: crossLegTried ? "no-cross-leg" : "no-ecb",
        });
      }
      continue; // drop the trade
    }

    // Inject the resolved rate so the FIFO engine finds it via getEcbRate.
    if (lookupRateInMap(cloned.map, date, trade.currency) === null) {
      setRate(cloned, date, trade.currency, currencyRate);
    }

    // 4. Commission currency. If it differs and is unresolvable, neutralize the
    //    commission rather than dropping the whole (otherwise valid) trade.
    let commission: Decimal;
    try {
      commission = new Decimal(trade.commission || "0");
    } catch {
      commission = new Decimal(0);
    }
    const commCur = trade.commissionCurrency;
    if (!commission.isZero() && commCur && commCur !== trade.currency) {
      const commRate = tryResolve(cloned.map, manualRates, date, commCur);
      if (commRate === null) {
        neutralizedCommissions++;
        outTrades.push({ ...trade, commission: "0", commissionCurrency: trade.currency });
        continue;
      }
      if (lookupRateInMap(cloned.map, date, commCur) === null) {
        setRate(cloned, date, commCur, commRate);
      }
    }

    outTrades.push(trade);
  }

  const messages: TaxMessage[] = [];

  if (unresolved.length > 0) {
    messages.push({
      id: "report.crypto_valuation_unresolved",
      severity: "warning",
      message: `Hay ${unresolved.length} operación(es) en criptomoneda cuyo valor en euros no se ha podido determinar automáticamente y se han excluido de los cálculos.`,
      hint: "Sucede en permutas cripto-cripto (p. ej. Binance Convert) cuando ninguna de las dos monedas tiene tipo de cambio oficial del BCE. Introduce manualmente el valor en euros por unidad de cada moneda en la fecha indicada para incluir estas operaciones.",
      context: { count: String(unresolved.length) },
    });
  }

  if (neutralizedCommissions > 0) {
    messages.push({
      id: "report.crypto_commission_neutralized",
      severity: "info",
      message: `Se ha ignorado la comisión de ${neutralizedCommissions} operación(es) por estar denominada en una criptomoneda sin tipo de cambio disponible.`,
      hint: "El valor principal de la operación sí se ha calculado; solo se omite la pequeña comisión, cuyo impacto fiscal es mínimo.",
      context: { count: String(neutralizedCommissions) },
    });
  }

  return { trades: outTrades, rateMap: cloned.map, messages, unresolved };
}
