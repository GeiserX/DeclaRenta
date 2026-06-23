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
import type { ManualOpeningLot, TaxMessage, UnresolvedValuation } from "../types/tax.js";
import {
  buildManualRateMap,
  coerceManualQuotes,
  normalizeManualQuote,
  type ManualRateQuote,
} from "../engine/manual-rates.js";
import { coerceManualOpeningLots, manualOpeningLotKey } from "../engine/manual-opening-lots.js";
import { esc } from "./esc.js";

const STORAGE_KEY = "declarenta_manual_rates";
const OPENING_LOTS_STORAGE_KEY = "declarenta_manual_opening_lots";

/** Shape persisted on disk: a flat array of manual quotes. */
type StoredManualRate = ManualRateQuote;
type StoredManualOpeningLot = ManualOpeningLot;

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
    return coerceManualQuotes(JSON.parse(raw));
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

function readStoredOpeningLots(): StoredManualOpeningLot[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(OPENING_LOTS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    return coerceManualOpeningLots(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeStoredOpeningLots(entries: StoredManualOpeningLot[]): void {
  try {
    localStorage.setItem(OPENING_LOTS_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* storage unavailable/full — manual opening lots simply won't persist */
  }
}

/**
 * Build an EcbRateMap (date → currency → EUR-per-1-unit) from stored manual
 * quotes, delegating all validation/normalization to the shared engine helper
 * so the web and CLI paths can never diverge.
 */
export function getManualRates(): EcbRateMap {
  return buildManualRateMap(readStored());
}

export function getManualOpeningLots(): ManualOpeningLot[] {
  return readStoredOpeningLots();
}

export function clearManualOpeningLots(): void {
  try {
    localStorage.removeItem(OPENING_LOTS_STORAGE_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

/**
 * Persist a single manual EUR-per-unit quote for a currency+date pair.
 * Returns true if the quote was valid and stored, false if it was rejected
 * (e.g. non-numeric/non-positive rate) so callers can avoid showing a false
 * "saved" state or reprocessing the report for nothing.
 */
export function setManualRate(currency: string, date: string, eurPerUnit: string): boolean {
  // Normalize the key exactly as lookups do (upper-case + stablecoin→fiat +
  // date to YYYY-MM-DD) and canonicalize the rate to dot-decimal, so a
  // hand-typed "sol"/"USDT"/"142,50" matches and parses at lookup time and
  // re-saving the same row upserts instead of duplicating.
  const norm = normalizeManualQuote({ currency, date, eurPerUnit });
  if (norm === null) return false;
  const entries = readStored().filter((e) => !(e.currency === norm.currency && e.date === norm.date));
  entries.push({ currency: norm.currency, date: norm.date, eurPerUnit: norm.eurPerUnit });
  writeStored(entries);
  return true;
}

function openingLotIdentityKey(
  lot: Pick<
    ManualOpeningLot,
    "symbol" | "isin" | "assetCategory" | "currency" | "acquireDate" | "quantity" | "pricePerShare"
  >,
): string {
  return [
    lot.symbol.trim().toUpperCase(),
    lot.isin.trim().toUpperCase(),
    lot.assetCategory.trim().toUpperCase(),
    lot.currency.trim().toUpperCase(),
    lot.acquireDate.trim(),
    lot.quantity.trim(),
    lot.pricePerShare.trim(),
  ].join("|");
}

export function setManualOpeningLots(groupKey: string, lots: ManualOpeningLot[]): number {
  const existingAll = readStoredOpeningLots();
  const existing = existingAll.filter((lot) => manualOpeningLotKey(lot) !== groupKey);
  const hadGroupEntries = existing.length !== existingAll.length;
  const validLots = coerceManualOpeningLots(lots);
  if (validLots.length === 0) {
    if (hadGroupEntries) writeStoredOpeningLots(existing);
    return hadGroupEntries ? 1 : 0;
  }
  const deduped = new Map<string, ManualOpeningLot>();
  for (const lot of validLots) {
    deduped.set(openingLotIdentityKey(lot), lot);
  }
  writeStoredOpeningLots([...existing, ...deduped.values()]);
  return deduped.size;
}

function storedOpeningLotsFor(groupKey: string): ManualOpeningLot[] {
  return readStoredOpeningLots().filter((lot) => manualOpeningLotKey(lot) === groupKey);
}

type ManualOpeningLotIssue = {
  groupKey: string;
  symbol: string;
  description: string;
  isin: string;
  conid?: string;
  assetCategory: string;
  currency: string;
  sellDate?: string;
  missingQuantity?: string;
};

function manualOpeningIssueFromMessage(msg: TaxMessage): ManualOpeningLotIssue | null {
  const symbol = (msg.context?.symbol ?? "").trim();
  const description = (msg.context?.description ?? symbol).trim() || symbol;
  const isin = (msg.context?.isin ?? "").trim();
  const conid = (msg.context?.conid ?? "").trim() || undefined;
  const assetCategory = (msg.context?.assetCategory ?? "STK").trim().toUpperCase() || "STK";
  const currency = (msg.context?.currency ?? "USD").trim().toUpperCase() || "USD";
  const sellDate = (msg.context?.date ?? "").trim();
  const missingQuantity = (msg.context?.quantity ?? "").trim();
  if (!symbol && !isin) return null;
  if (!sellDate || !missingQuantity) return null;
  return {
    groupKey: manualOpeningLotKey({ symbol, isin, conid, assetCategory }),
    symbol,
    description,
    isin,
    ...(conid ? { conid } : {}),
    assetCategory,
    currency,
    sellDate,
    missingQuantity,
  };
}

function collectStoredOpeningLotIssues(): ManualOpeningLotIssue[] {
  const grouped = new Map<string, ManualOpeningLotIssue>();
  for (const lot of readStoredOpeningLots()) {
    const groupKey = manualOpeningLotKey(lot);
    if (grouped.has(groupKey)) continue;
    grouped.set(groupKey, {
      groupKey,
      symbol: lot.symbol,
      description: lot.description,
      isin: lot.isin,
      ...(lot.conid ? { conid: lot.conid } : {}),
      assetCategory: lot.assetCategory,
      currency: lot.currency,
    });
  }
  return [...grouped.values()];
}

/** Look up the currently-stored quote for a currency+date pair (for prefill). */
function storedRateFor(currency: string, date: string): string {
  const norm = normalizeManualQuote({ currency, date, eurPerUnit: "1" });
  const key = norm ?? { currency: currency.toUpperCase(), date };
  const hit = readStored().find((e) => e.currency === key.currency && e.date === key.date);
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

function renderOpeningLotRows(issue: ManualOpeningLotIssue): string {
  const maxDate = new Date().toISOString().slice(0, 10);
  const stored = storedOpeningLotsFor(issue.groupKey);
  const rows =
    stored.length > 0
      ? stored
      : [
          {
            symbol: issue.symbol,
            description: issue.description,
            isin: issue.isin,
            assetCategory: issue.assetCategory,
            currency: issue.currency,
            acquireDate: "",
            quantity: "",
            pricePerShare: "",
          } satisfies ManualOpeningLot,
        ];

  return rows
    .map(
      (lot, index) => `<tr class="manual-opening-lot-row" data-group-key="${esc(issue.groupKey)}">
      <td><input type="date" max="${esc(maxDate)}" class="manual-opening-lot-input" data-field="acquireDate" value="${esc(lot.acquireDate)}" /></td>
      <td><input type="text" inputmode="decimal" class="manual-opening-lot-input" data-field="quantity" placeholder="${esc(tr("opening_lots.placeholder_quantity"))}" value="${esc(lot.quantity)}" /></td>
      <td><input type="text" inputmode="decimal" class="manual-opening-lot-input" data-field="pricePerShare" placeholder="${esc(tr("opening_lots.placeholder_price"))}" value="${esc(lot.pricePerShare)}" /></td>
      <td class="manual-opening-lot-actions">
        <button type="button" class="btn-secondary btn-small manual-opening-lot-add" data-group-key="${esc(issue.groupKey)}">${esc(tr("opening_lots.add_row"))}</button>
        <button type="button" class="btn-secondary btn-small manual-opening-lot-remove" data-group-key="${esc(issue.groupKey)}" ${index === 0 && rows.length === 1 ? "disabled" : ""}>${esc(tr("opening_lots.remove_row"))}</button>
      </td>
    </tr>`,
    )
    .join("");
}

export function renderManualOpeningLotsPanel(messages: TaxMessage[]): string {
  const issuesFromMessages = messages
    .map((msg) => manualOpeningIssueFromMessage(msg))
    .filter((issue): issue is ManualOpeningLotIssue => issue !== null)
    .filter(
      (issue, index, arr) =>
        arr.findIndex((i) => i.groupKey === issue.groupKey && i.sellDate === issue.sellDate) === index,
    );

  const issues = issuesFromMessages.length > 0 ? issuesFromMessages : collectStoredOpeningLotIssues();
  const hasActiveIssues = issuesFromMessages.length > 0;

  if (issues.length === 0) return "";

  const groups = issues
    .map(
      (
        issue,
      ) => `<section class="manual-opening-lot-group" data-group-key="${esc(issue.groupKey)}" data-symbol="${esc(issue.symbol)}" data-description="${esc(issue.description)}" data-isin="${esc(issue.isin)}" data-conid="${esc(issue.conid ?? "")}" data-asset-category="${esc(issue.assetCategory)}" data-currency="${esc(issue.currency)}">
      <h4>${esc(issue.symbol)}${issue.isin ? ` <span class="mono">(${esc(issue.isin)})</span>` : ""}</h4>
      <p>${esc(
        issue.missingQuantity && issue.sellDate
          ? tr("opening_lots.group_intro", { quantity: issue.missingQuantity, date: issue.sellDate })
          : tr("opening_lots.group_intro_saved"),
      )}</p>
      <div class="table-wrapper"><table>
        <thead><tr>
          <th>${esc(tr("opening_lots.col_acquire_date"))}</th>
          <th>${esc(tr("opening_lots.col_quantity"))}</th>
          <th>${esc(tr("opening_lots.col_price"))}</th>
          <th>${esc(tr("opening_lots.col_actions"))}</th>
        </tr></thead>
        <tbody>${renderOpeningLotRows(issue)}</tbody>
      </table></div>
    </section>`,
    )
    .join("");

  return `<details class="manual-opening-lots-panel crypto-rates-panel"${hasActiveIssues ? " open" : ""}>
    <summary class="manual-opening-lots-summary">
      <span class="manual-opening-lots-summary-text">${esc(tr("opening_lots.title"))}</span>
      <span class="manual-opening-lots-summary-count">${issues.length}</span>
    </summary>
    <div class="manual-opening-lots-body">
      <p>${esc(tr("opening_lots.description"))}</p>
      <p class="muted">${esc(tr("opening_lots.help"))}</p>
      <p class="manual-opening-lots-effect">${esc(tr("opening_lots.effect_hint"))}</p>
      ${groups}
      <div class="manual-opening-lots-actions">
        <button type="button" id="manual-opening-lots-save-btn" class="btn-cta">${esc(tr("opening_lots.save_btn"))}</button>
        <button type="button" id="manual-opening-lots-clear-btn" class="btn-secondary">${esc(tr("opening_lots.clear_btn"))}</button>
      </div>
      <span class="crypto-rates-saved-msg manual-opening-lots-saved-msg" hidden>${esc(tr("opening_lots.saved"))}</span>
      <p class="muted crypto-rates-recalculate-hint">${esc(tr("opening_lots.recalculate_hint"))}</p>
    </div>
  </details>`;
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
      // Only count entries that actually persisted (valid, parseable rate), so
      // an invalid input doesn't fake a "saved" state or trigger a no-op rerun.
      if (setManualRate(currency, date, value)) savedCount++;
    }

    const msg = container.querySelector<HTMLElement>(".crypto-rates-saved-msg");
    if (msg) msg.hidden = savedCount === 0;

    if (savedCount > 0) onSave();
  });
}

function renderEmptyOpeningLotRow(groupEl: HTMLElement): string {
  const groupKey = groupEl.dataset.groupKey ?? "";
  const maxDate = new Date().toISOString().slice(0, 10);
  return `<tr class="manual-opening-lot-row" data-group-key="${esc(groupKey)}">
    <td><input type="date" max="${esc(maxDate)}" class="manual-opening-lot-input" data-field="acquireDate" value="" /></td>
    <td><input type="text" inputmode="decimal" class="manual-opening-lot-input" data-field="quantity" placeholder="${esc(tr("opening_lots.placeholder_quantity"))}" value="" /></td>
    <td><input type="text" inputmode="decimal" class="manual-opening-lot-input" data-field="pricePerShare" placeholder="${esc(tr("opening_lots.placeholder_price"))}" value="" /></td>
    <td class="manual-opening-lot-actions">
      <button type="button" class="btn-secondary btn-small manual-opening-lot-add" data-group-key="${esc(groupKey)}">${esc(tr("opening_lots.add_row"))}</button>
      <button type="button" class="btn-secondary btn-small manual-opening-lot-remove" data-group-key="${esc(groupKey)}">${esc(tr("opening_lots.remove_row"))}</button>
    </td>
  </tr>`;
}

export function bindManualOpeningLotsPanel(container: HTMLElement, onSave: () => void): void {
  container.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const addBtn = target.closest<HTMLButtonElement>(".manual-opening-lot-add");
    if (addBtn) {
      const group = addBtn.closest<HTMLElement>(".manual-opening-lot-group");
      const tbody = group?.querySelector<HTMLTableSectionElement>("tbody");
      if (group && tbody) tbody.insertAdjacentHTML("beforeend", renderEmptyOpeningLotRow(group));
      return;
    }

    const removeBtn = target.closest<HTMLButtonElement>(".manual-opening-lot-remove");
    if (removeBtn) {
      const row = removeBtn.closest<HTMLTableRowElement>(".manual-opening-lot-row");
      const tbody = row?.parentElement;
      if (!row || !tbody) return;
      if (tbody.querySelectorAll(".manual-opening-lot-row").length <= 1) {
        row.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
          input.value = "";
        });
        return;
      }
      row.remove();
    }
  });

  const clearBtn = container.querySelector<HTMLButtonElement>("#manual-opening-lots-clear-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      clearManualOpeningLots();
      onSave();
    });
  }

  const btn = container.querySelector<HTMLButtonElement>("#manual-opening-lots-save-btn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    let savedCount = 0;
    const groups = [...container.querySelectorAll<HTMLElement>(".manual-opening-lot-group")];
    for (const group of groups) {
      const rows = [...group.querySelectorAll<HTMLTableRowElement>(".manual-opening-lot-row")];
      const symbol = group.dataset.symbol ?? "";
      const description = group.dataset.description ?? symbol;
      const isin = group.dataset.isin ?? "";
      const conid = group.dataset.conid ?? "";
      const assetCategory = group.dataset.assetCategory ?? "STK";
      const currency = group.dataset.currency ?? "USD";
      const groupKey = group.dataset.groupKey ?? (isin || symbol);

      const lots: ManualOpeningLot[] = rows.map((row) => {
        const acquireDate = row.querySelector<HTMLInputElement>("[data-field='acquireDate']")?.value.trim() ?? "";
        const quantity = row.querySelector<HTMLInputElement>("[data-field='quantity']")?.value.trim() ?? "";
        const pricePerShare = row.querySelector<HTMLInputElement>("[data-field='pricePerShare']")?.value.trim() ?? "";
        return {
          symbol,
          description,
          isin,
          ...(conid ? { conid } : {}),
          assetCategory,
          currency,
          acquireDate,
          quantity,
          pricePerShare,
        };
      });

      savedCount += setManualOpeningLots(groupKey, lots);
    }

    const msg = container.querySelector<HTMLElement>(".manual-opening-lots-saved-msg");
    if (msg) msg.hidden = savedCount === 0;

    if (savedCount > 0) onSave();
  });
}
