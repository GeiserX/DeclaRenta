/**
 * Manual crypto valuation rates.
 *
 * For crypto↔crypto swaps (e.g. Binance Convert SOL→BTC) that have no ECB
 * rate, the report generator surfaces `unresolvedCryptoValuations`. This module
 * lets the user supply manual EUR-per-unit quotes for those currency+date
 * pairs, persisting them in localStorage so re-processing can value the trades.
 *
 * Privacy: only stores currency code, date and the EUR-per-unit quote the user
 * types — never NIF, totals or any broker-derived financial amounts.
 */

import { t, type TranslationKey } from "../i18n/index.js";
import type { EcbRateMap } from "../types/ecb.js";
import type { UnresolvedValuation } from "../types/tax.js";
import { esc } from "./esc.js";
import Decimal from "decimal.js";

const STORAGE_KEY = "declarenta_manual_rates";

/** Shape persisted on disk: a flat array of manual quotes. */
interface StoredManualRate {
  currency: string;
  date: string;
  eurPerUnit: string;
}

/**
 * Reference the new `crypto_rates.*` i18n keys without a compile-time
 * dependency on the locale files (added by a separate agent). `t()` already
 * falls back to the raw key string if a translation is missing.
 */
function tr(key: string, params?: Record<string, string>): string {
  return t(key as TranslationKey, params);
}

/** Read and parse the raw stored array, tolerating corrupt/missing data. */
function readStored(): StoredManualRate[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is StoredManualRate => {
      if (e == null || typeof e !== "object") return false;
      const rec = e as Record<string, unknown>;
      return (
        typeof rec.currency === "string" &&
        typeof rec.date === "string" &&
        typeof rec.eurPerUnit === "string"
      );
    });
  } catch {
    return [];
  }
}

/** Persist the array back to localStorage. */
function writeStored(entries: StoredManualRate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* storage unavailable/full — manual rates simply won't persist */
  }
}

/**
 * Build an EcbRateMap (date → currency → EUR-per-1-unit) from stored manual
 * quotes. Each rate is validated with Decimal; invalid or non-positive entries
 * are skipped. Returns an empty map if nothing valid is stored.
 */
export function getManualRates(): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const entry of readStored()) {
    let rate: Decimal;
    try {
      rate = new Decimal(entry.eurPerUnit);
    } catch {
      continue;
    }
    if (!rate.isFinite() || rate.lessThanOrEqualTo(0)) continue;

    if (!map.has(entry.date)) {
      map.set(entry.date, new Map());
    }
    map.get(entry.date)!.set(entry.currency, entry.eurPerUnit);
  }
  return map;
}

/** Persist a single manual EUR-per-unit quote for a currency+date pair. */
export function setManualRate(currency: string, date: string, eurPerUnit: string): void {
  // Upper-case to match how trade currencies are stored (and the CLI path),
  // so a hand-typed "sol" still matches symbol "SOL" in cross-leg inference.
  const cur = currency.toUpperCase();
  const entries = readStored().filter((e) => !(e.currency === cur && e.date === date));
  entries.push({ currency: cur, date, eurPerUnit });
  writeStored(entries);
}

/** Remove all stored manual rates. */
export function clearManualRates(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

/** Look up the currently-stored quote for a currency+date pair (for prefill). */
function storedRateFor(currency: string, date: string): string {
  const hit = readStored().find((e) => e.currency === currency && e.date === date);
  return hit?.eurPerUnit ?? "";
}

/**
 * Render the manual-rates panel as an HTML string (so main.ts can inject it
 * alongside the rest of the results). Every broker/user-derived value is
 * escaped. Each row carries data-attributes so `bindManualRatesPanel` can read
 * the inputs back without re-deriving them.
 */
export function renderManualRatesPanel(unresolved: UnresolvedValuation[]): string {
  const rows = unresolved
    .map((u, i) => {
      const prefill = storedRateFor(u.currency, u.date);
      return `<tr>
        <td>
          <div class="crypto-rate-asset"><strong>${esc(u.symbol)}</strong></div>
          <div class="crypto-rate-desc muted">${esc(u.description)}</div>
        </td>
        <td>${esc(u.date)}</td>
        <td class="mono">${esc(u.quantity)}</td>
        <td class="mono">${esc(u.currency)}</td>
        <td>
          <input type="text" inputmode="decimal"
            class="crypto-rate-input"
            data-row="${i}"
            data-currency="${esc(u.currency)}"
            data-date="${esc(u.date)}"
            placeholder="${esc(tr("crypto_rates.placeholder"))}"
            value="${esc(prefill)}" />
        </td>
      </tr>`;
    })
    .join("");

  return `<div class="crypto-rates-panel">
    <h3>${esc(tr("crypto_rates.title"))}</h3>
    <p>${esc(tr("crypto_rates.description"))}</p>
    <p class="muted">${esc(tr("crypto_rates.help"))}</p>
    <div class="table-wrapper"><table>
      <thead><tr>
        <th>${esc(tr("crypto_rates.col_asset"))}</th>
        <th>${esc(tr("crypto_rates.col_date"))}</th>
        <th>${esc(tr("crypto_rates.col_quantity"))}</th>
        <th>${esc(tr("crypto_rates.col_currency"))}</th>
        <th>${esc(tr("crypto_rates.col_eur_per_unit"))}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <button type="button" id="crypto-rates-save-btn" class="btn-cta">${esc(tr("crypto_rates.save_btn"))}</button>
    <span class="crypto-rates-saved-msg" hidden>${esc(tr("crypto_rates.saved"))}</span>
    <p class="muted crypto-rates-recalculate-hint">${esc(tr("crypto_rates.recalculate_hint"))}</p>
  </div>`;
}

/**
 * Wire the save button after the panel HTML has been injected into `container`.
 * On save: reads each non-empty input, persists it via setManualRate, then
 * invokes `onSave` (which re-runs the report so the new rates take effect).
 */
export function bindManualRatesPanel(container: HTMLElement, onSave: () => void): void {
  const btn = container.querySelector<HTMLButtonElement>("#crypto-rates-save-btn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const inputs = [...container.querySelectorAll<HTMLInputElement>(".crypto-rate-input")];
    let savedCount = 0;
    for (const input of inputs) {
      const value = input.value.trim();
      if (!value) continue;
      const currency = input.dataset.currency ?? "";
      const date = input.dataset.date ?? "";
      if (!currency || !date) continue;
      setManualRate(currency, date, value);
      savedCount++;
    }

    const msg = container.querySelector<HTMLElement>(".crypto-rates-saved-msg");
    if (msg) msg.hidden = false;

    if (savedCount > 0) onSave();
  });
}
