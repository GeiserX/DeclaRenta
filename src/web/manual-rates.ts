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
import {
  coerceManualOpeningLots,
  manualOpeningLotKey,
  normalizeManualOpeningLot,
} from "../engine/manual-opening-lots.js";
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

/**
 * Persist the array back to localStorage in one write. Returns false when the
 * browser refuses it (storage full or blocked), so the panel does not claim a
 * save that did not happen (#472).
 */
function writeStored(entries: StoredManualRate[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    return false;
  }
  return true;
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

/** One write; false when the browser refuses it (storage full or blocked, #472). */
function writeStoredOpeningLots(entries: StoredManualOpeningLot[]): boolean {
  try {
    localStorage.setItem(OPENING_LOTS_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    return false;
  }
  return true;
}

/**
 * Build an EcbRateMap (date → currency → EUR-per-1-unit) from stored manual
 * quotes, delegating all validation/normalization to the shared engine helper
 * so the web and CLI paths can never diverge.
 */
export function getManualRates(): EcbRateMap {
  return buildManualRateMap(readStored());
}

/**
 * Remove every saved manual crypto price, so the next run values nothing by
 * hand. Returns false when the browser refuses (storage blocked): the prices
 * are still saved and still value the swaps (#472 review).
 */
export function clearManualRates(): boolean {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    return false;
  }
  return true;
}

export function getManualOpeningLots(): ManualOpeningLot[] {
  return readStoredOpeningLots();
}

/** Remove every saved opening lot. Returns false when the browser refuses (storage blocked, #472 review). */
export function clearManualOpeningLots(): boolean {
  try {
    localStorage.removeItem(OPENING_LOTS_STORAGE_KEY);
  } catch {
    return false;
  }
  return true;
}

/**
 * Persist several manual EUR-per-unit quotes in ONE write, so a refused write
 * leaves the old prices whole. `saved` counts the valid quotes (an invalid
 * one, e.g. non-numeric or non-positive, is skipped); `written` is false when
 * the browser refused the write, and then nothing was saved (#472).
 */
export function saveManualRates(quotes: readonly ManualRateQuote[]): { saved: number; written: boolean } {
  // Normalize the key exactly as lookups do (upper-case + stablecoin→fiat +
  // date to YYYY-MM-DD) and canonicalize the rate to dot-decimal, so a
  // hand-typed "sol"/"USDT"/"142,50" matches and parses at lookup time and
  // re-saving the same row upserts instead of duplicating.
  let entries = readStored();
  let saved = 0;
  for (const quote of quotes) {
    const norm = normalizeManualQuote(quote);
    if (norm === null) continue;
    entries = entries.filter((e) => !(e.currency === norm.currency && e.date === norm.date));
    entries.push({ currency: norm.currency, date: norm.date, eurPerUnit: norm.eurPerUnit });
    saved++;
  }
  if (saved === 0) return { saved: 0, written: true };
  return writeStored(entries) ? { saved, written: true } : { saved: 0, written: false };
}

/**
 * Persist a single manual EUR-per-unit quote for a currency+date pair.
 * Returns true if the quote was valid and stored, false if it was rejected
 * (e.g. non-numeric/non-positive rate) or the browser refused the write, so
 * callers can avoid showing a false "saved" state or reprocessing the report
 * for nothing.
 */
export function setManualRate(currency: string, date: string, eurPerUnit: string): boolean {
  return saveManualRates([{ currency, date, eurPerUnit }]).saved === 1;
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

/**
 * Replace the saved lots of each group in ONE write, so a refused write leaves
 * the old lots whole. `saved` counts the stored lots (a group emptied of its
 * saved lots counts 1, as a change); `written` is false when the browser
 * refused the write, and then nothing was saved (#472).
 */
export function saveManualOpeningLotGroups(
  groups: readonly { groupKey: string; lots: ManualOpeningLot[] }[],
): { saved: number; written: boolean } {
  let entries = readStoredOpeningLots();
  let saved = 0;
  for (const { groupKey, lots } of groups) {
    const existing = entries.filter((lot) => manualOpeningLotKey(lot) !== groupKey);
    const hadGroupEntries = existing.length !== entries.length;
    const validLots = coerceManualOpeningLots(lots);
    if (validLots.length === 0) {
      if (hadGroupEntries) {
        entries = existing;
        saved += 1;
      }
      continue;
    }
    const deduped = new Map<string, ManualOpeningLot>();
    for (const lot of validLots) {
      deduped.set(openingLotIdentityKey(lot), lot);
    }
    entries = [...existing, ...deduped.values()];
    saved += deduped.size;
  }
  if (saved === 0) return { saved: 0, written: true };
  return writeStoredOpeningLots(entries) ? { saved, written: true } : { saved: 0, written: false };
}

/** Replace one group's saved lots; returns the lots stored, 0 when invalid or the write is refused. */
export function setManualOpeningLots(groupKey: string, lots: ManualOpeningLot[]): number {
  return saveManualOpeningLotGroups([{ groupKey, lots }]).saved;
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

function renderClearRatesButton(): string {
  return `<button type="button" id="crypto-rates-clear-btn" class="btn-secondary">${esc(tr("crypto_rates.clear_btn"))}</button>`;
}

/**
 * Collapsed list of the saved prices, shown once every swap is valued. A saved
 * price makes its row leave the "please value this" table, so without this
 * list a mistyped price would keep driving the gain with no way to see it.
 */
/** One editable row per saved price, oldest date first. */
function storedRateRows(stored: StoredManualRate[]): string {
  return [...stored]
    .sort((a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency))
    .map(
      (e) => `<tr>
        <td class="mono">${esc(e.currency)}</td>
        <td>${esc(e.date)}</td>
        <td>
          <input type="text" inputmode="decimal"
            class="crypto-rate-input"
            data-currency="${esc(e.currency)}"
            data-date="${esc(e.date)}"
            placeholder="${esc(tr("crypto_rates.placeholder"))}"
            value="${esc(e.eurPerUnit)}" />
        </td>
      </tr>`,
    )
    .join("");
}

/** Collapsed list of the saved prices, inside a panel that already has the Save button. */
function storedRatesList(stored: StoredManualRate[]): string {
  return `<details class="crypto-rates-stored-inline">
    <summary class="crypto-rates-stored-summary">
      <span class="crypto-rates-stored-summary-text">${esc(tr("crypto_rates.stored_title"))}</span>
      <span class="crypto-rates-stored-summary-count">${stored.length}</span>
    </summary>
    <div class="table-wrapper"><table>
      <thead><tr>
        <th>${esc(tr("crypto_rates.col_currency"))}</th>
        <th>${esc(tr("crypto_rates.col_date"))}</th>
        <th>${esc(tr("crypto_rates.col_eur_per_unit"))}</th>
      </tr></thead>
      <tbody>${storedRateRows(stored)}</tbody>
    </table></div>
  </details>`;
}

function renderStoredRatesPanel(stored: StoredManualRate[], saved: boolean): string {
  const rows = storedRateRows(stored);

  // A Save that values the last swap redraws this collapsed list: open it so
  // «Guardado» is on screen (#472).
  return `<details class="crypto-rates-panel crypto-rates-stored-panel"${saved ? " open" : ""}>
    <summary class="crypto-rates-stored-summary">
      <span class="crypto-rates-stored-summary-text">${esc(tr("crypto_rates.stored_title"))}</span>
      <span class="crypto-rates-stored-summary-count">${stored.length}</span>
    </summary>
    <div class="crypto-rates-stored-body">
      <p>${esc(tr("crypto_rates.stored_description"))}</p>
      <div class="table-wrapper"><table>
        <thead><tr>
          <th>${esc(tr("crypto_rates.col_currency"))}</th>
          <th>${esc(tr("crypto_rates.col_date"))}</th>
          <th>${esc(tr("crypto_rates.col_eur_per_unit"))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="crypto-rates-actions">
        <button type="button" id="crypto-rates-save-btn" class="btn-cta">${esc(tr("crypto_rates.save_btn"))}</button>
        ${renderClearRatesButton()}
      </div>
      <span class="crypto-rates-saved-msg"${saved ? "" : " hidden"}>${esc(tr("crypto_rates.saved"))}</span>
      <span class="crypto-rates-error-msg" role="alert" hidden>${esc(tr("crypto_rates.save_error"))}</span>
      <p class="muted crypto-rates-recalculate-hint">${esc(tr("crypto_rates.recalculate_hint"))}</p>
    </div>
  </details>`;
}

/**
 * Render the manual-rates panel as an HTML string (so main.ts can inject it
 * alongside the rest of the results). Every broker/user-derived value is
 * escaped. Each row carries data-attributes so `bindManualRatesPanel` can read
 * the inputs back without re-deriving them.
 *
 * With nothing left to value it falls back to the collapsed list of saved
 * prices, or returns "" when none are saved.
 *
 * `saved` shows the «Guardado» label: a Save reruns the report, which redraws
 * the panel, so the new panel has to carry the confirmation (#472).
 */
export function renderManualRatesPanel(unresolved: UnresolvedValuation[], { saved = false }: { saved?: boolean } = {}): string {
  const stored = readStored();
  if (unresolved.length === 0) return stored.length > 0 ? renderStoredRatesPanel(stored, saved) : "";
  // Prices already saved for swaps that no longer need one stay editable here
  // too; otherwise a mistyped one could only be removed with "clear all".
  const savedElsewhere = stored.filter((e) => !unresolved.some((u) => u.currency === e.currency && u.date === e.date));

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
    ${savedElsewhere.length > 0 ? storedRatesList(savedElsewhere) : ""}
    <div class="crypto-rates-actions">
      <button type="button" id="crypto-rates-save-btn" class="btn-cta">${esc(tr("crypto_rates.save_btn"))}</button>
      ${stored.length > 0 ? renderClearRatesButton() : ""}
    </div>
    <span class="crypto-rates-saved-msg"${saved ? "" : " hidden"}>${esc(tr("crypto_rates.saved"))}</span>
    <span class="crypto-rates-error-msg" role="alert" hidden>${esc(tr("crypto_rates.save_error"))}</span>
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

/**
 * The groups the opening-lots panel shows for `messages`: one per missing lot
 * the report names, or the saved groups when it names none.
 */
function openingLotIssues(messages: TaxMessage[]): { issues: ManualOpeningLotIssue[]; hasActiveIssues: boolean } {
  const issuesFromMessages = messages
    .map((msg) => manualOpeningIssueFromMessage(msg))
    .filter((issue): issue is ManualOpeningLotIssue => issue !== null)
    .filter(
      (issue, index, arr) =>
        arr.findIndex((i) => i.groupKey === issue.groupKey && i.sellDate === issue.sellDate) === index,
    );
  const hasActiveIssues = issuesFromMessages.length > 0;
  return { issues: hasActiveIssues ? issuesFromMessages : collectStoredOpeningLotIssues(), hasActiveIssues };
}

/**
 * The panel's groups: one per asset, with every sale of it that misses a lot.
 * The saved lots of an asset are one pool that FIFO spends on all its sales
 * (report.ts 0d), and the Save replaces them by group key. Two groups with the
 * same key would each replace the pool, so the last one won and an empty
 * second group wiped the lot typed in the first (#472 review of 15c1b45).
 */
function openingLotGroups(issues: ManualOpeningLotIssue[]): ManualOpeningLotIssue[][] {
  const byKey = new Map<string, ManualOpeningLotIssue[]>();
  for (const issue of issues) byKey.set(issue.groupKey, [...(byKey.get(issue.groupKey) ?? []), issue]);
  return [...byKey.values()];
}

/**
 * What the groups of a panel drawn from `messages` show besides their inputs,
 * in order. A run keeps a panel the user is editing only while this is the
 * same for its report (#472 review of e4e439e): a crypto price saved or
 * cleared in another panel puts a swap into the calculations or leaves it out,
 * which can drop a sale's missing lot or add one. List every field a group
 * shows, except the inputs, which read storage.
 */
export function openingLotsRowsKey(messages: TaxMessage[]): string {
  const { issues, hasActiveIssues } = openingLotIssues(messages);
  return JSON.stringify([
    hasActiveIssues,
    issues.map((i) => [i.groupKey, i.symbol, i.description, i.isin, i.conid ?? null, i.assetCategory, i.currency, i.sellDate ?? null, i.missingQuantity ?? null]),
  ]);
}

const OPENING_LOT_FIELDS = ["acquireDate", "quantity", "pricePerShare"] as const;

/** One typed row of a group: its three inputs and whether a refused Save flagged it. */
type OpeningLotDraftRow = { values: string[]; invalid: boolean };

/** The input the user is typing in: its group key, row and field, and the caret. */
type OpeningLotFocus = { key: string; row: number; field: string; start: number | null; end: number | null };

/**
 * What a panel holds that nobody saved: the typed rows of each group by group
 * key (one group per key, see openingLotGroups), the error on screen, whether
 * the user left the panel open, and the input they are typing in, so a redraw
 * does not take their keystrokes away.
 */
export interface OpeningLotsDraft {
  groups: Map<string, OpeningLotDraftRow[]>;
  error: string | null;
  open: boolean;
  focus: OpeningLotFocus | null;
}

/** The groups of a panel with their key. */
function keyedGroups(panel: HTMLElement): { group: HTMLElement; key: string }[] {
  return [...panel.querySelectorAll<HTMLElement>(".manual-opening-lot-group")].map((group) => ({
    group,
    key: group.dataset.groupKey ?? "",
  }));
}

function lotRows(group: HTMLElement): HTMLTableRowElement[] {
  return [...group.querySelectorAll<HTMLTableRowElement>(".manual-opening-lot-row")];
}

function readOpeningLotFocus(panel: HTMLElement, groups: ReturnType<typeof keyedGroups>): OpeningLotFocus | null {
  const active = panel.ownerDocument.activeElement;
  if (!(active instanceof HTMLInputElement) || !active.matches(".manual-opening-lot-input") || !panel.contains(active)) return null;
  const at = groups.find(({ group }) => group.contains(active));
  const row = active.closest<HTMLTableRowElement>(".manual-opening-lot-row");
  if (!at || !row) return null;
  const text = active.type === "text";
  return {
    key: at.key,
    row: lotRows(at.group).indexOf(row),
    field: active.dataset.field ?? "",
    start: text ? active.selectionStart : null,
    end: text ? active.selectionEnd : null,
  };
}

/** Read the typed rows and the visible error of a drawn panel. */
export function readOpeningLotsDraft(panel: HTMLElement): OpeningLotsDraft {
  const groups = new Map<string, OpeningLotDraftRow[]>();
  const keyed = keyedGroups(panel);
  for (const { group, key } of keyed) {
    groups.set(
      key,
      lotRows(group).map((row) => ({
        values: OPENING_LOT_FIELDS.map((f) => row.querySelector<HTMLInputElement>(`[data-field='${f}']`)?.value ?? ""),
        invalid: row.querySelector(".manual-opening-lot-input[aria-invalid='true']") !== null,
      })),
    );
  }
  const error = panel.querySelector<HTMLElement>(".manual-opening-lots-error-msg");
  return {
    groups,
    error: error && !error.hidden ? error.textContent : null,
    open: panel instanceof HTMLDetailsElement && panel.open,
    focus: readOpeningLotFocus(panel, keyed),
  };
}

/**
 * Put a draft back into a panel drawn from a newer report: each group the draft
 * holds gets the user's rows, with their flags, a new group keeps what is
 * stored, a group the report no longer names is gone, the error stays on
 * screen, and the panel stays open or closed as the user left it. The input
 * the user was typing in keeps the focus and the caret, if its group is still
 * there. «Guardado» stays hidden: the panel shows values nobody saved.
 */
export function applyOpeningLotsDraft(panel: HTMLElement, draft: OpeningLotsDraft): void {
  if (panel instanceof HTMLDetailsElement) panel.open = draft.open;
  const keyed = keyedGroups(panel);
  for (const { group, key } of keyed) {
    const rows = draft.groups.get(key);
    const tbody = group.querySelector<HTMLTableSectionElement>("tbody");
    if (!rows || rows.length === 0 || !tbody) continue;
    let drawn = lotRows(group);
    drawn.slice(rows.length).forEach((row) => row.remove());
    for (let i = drawn.length; i < rows.length; i++) tbody.insertAdjacentHTML("beforeend", renderEmptyOpeningLotRow(group));
    drawn = lotRows(group);
    rows.forEach((row, i) => {
      OPENING_LOT_FIELDS.forEach((f, j) => {
        const input = drawn[i]!.querySelector<HTMLInputElement>(`[data-field='${f}']`);
        if (!input) return;
        input.value = row.values[j] ?? "";
        if (row.invalid) input.setAttribute("aria-invalid", "true");
        else input.removeAttribute("aria-invalid");
      });
    });
  }
  const saved = panel.querySelector<HTMLElement>(".manual-opening-lots-saved-msg");
  if (saved) saved.hidden = true;
  const error = panel.querySelector<HTMLElement>(".manual-opening-lots-error-msg");
  if (error && draft.error !== null) {
    error.hidden = false;
    error.textContent = draft.error;
  }
  const focus = draft.focus;
  const at = focus && keyed.find(({ key }) => key === focus.key);
  const input = at ? lotRows(at.group)[focus.row]?.querySelector<HTMLInputElement>(`[data-field='${focus.field}']`) : null;
  if (!focus || !input) return;
  input.focus();
  if (focus.start !== null && focus.end !== null) input.setSelectionRange(focus.start, focus.end);
}

/**
 * `saved` shows the «Guardado» label in the panel a Save redraws (#472). A
 * Save that emptied the last saved group with no missing lot left draws only
 * the title and the label, with no rows and no buttons (#472 review).
 */
export function renderManualOpeningLotsPanel(messages: TaxMessage[], { saved = false }: { saved?: boolean } = {}): string {
  const { issues, hasActiveIssues } = openingLotIssues(messages);

  if (issues.length === 0) {
    if (!saved) return "";
    return `<details class="manual-opening-lots-panel crypto-rates-panel" open>
    <summary class="manual-opening-lots-summary">
      <span class="manual-opening-lots-summary-text">${esc(tr("opening_lots.title"))}</span>
    </summary>
    <div class="manual-opening-lots-body">
      <span class="crypto-rates-saved-msg manual-opening-lots-saved-msg">${esc(tr("opening_lots.saved"))}</span>
    </div>
  </details>`;
  }

  const grouped = openingLotGroups(issues);
  const groups = grouped
    .map((sales) => {
      const issue = sales[0]!;
      const intros = sales
        .filter((sale) => sale.missingQuantity && sale.sellDate)
        .map((sale) => tr("opening_lots.group_intro", { quantity: sale.missingQuantity!, date: sale.sellDate! }));
      return `<section class="manual-opening-lot-group" data-group-key="${esc(issue.groupKey)}" data-symbol="${esc(issue.symbol)}" data-description="${esc(issue.description)}" data-isin="${esc(issue.isin)}" data-conid="${esc(issue.conid ?? "")}" data-asset-category="${esc(issue.assetCategory)}" data-currency="${esc(issue.currency)}">
      <h4>${esc(issue.symbol)}${issue.isin ? ` <span class="mono">(${esc(issue.isin)})</span>` : ""}</h4>
      ${(intros.length > 0 ? intros : [tr("opening_lots.group_intro_saved")]).map((intro) => `<p>${esc(intro)}</p>`).join("")}
      <div class="table-wrapper"><table>
        <thead><tr>
          <th>${esc(tr("opening_lots.col_acquire_date"))}</th>
          <th>${esc(tr("opening_lots.col_quantity"))}</th>
          <th>${esc(tr("opening_lots.col_price"))}</th>
          <th>${esc(tr("opening_lots.col_actions"))}</th>
        </tr></thead>
        <tbody>${renderOpeningLotRows(issue)}</tbody>
      </table></div>
    </section>`;
    })
    .join("");

  // A Save that covers the last missing lot redraws the panel from the stored
  // lots, which stays closed: open it so «Guardado» is on screen (#472).
  return `<details class="manual-opening-lots-panel crypto-rates-panel"${hasActiveIssues || saved ? " open" : ""}>
    <summary class="manual-opening-lots-summary">
      <span class="manual-opening-lots-summary-text">${esc(tr("opening_lots.title"))}</span>
      <span class="manual-opening-lots-summary-count">${grouped.length}</span>
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
      <span class="crypto-rates-saved-msg manual-opening-lots-saved-msg"${saved ? "" : " hidden"}>${esc(tr("opening_lots.saved"))}</span>
      <span class="manual-opening-lots-error-msg" role="alert" hidden>${esc(tr("opening_lots.row_invalid"))}</span>
      <p class="muted crypto-rates-recalculate-hint">${esc(tr("opening_lots.recalculate_hint"))}</p>
    </div>
  </details>`;
}

/**
 * Wire the save and clear buttons after the panel HTML has been injected into
 * `container`. On save: reads each non-empty input, persists them in one
 * write, then invokes `onSave("save")` (which re-runs the report so the new
 * rates take effect). A price it cannot read, or a saved price left empty,
 * flags its row and saves nothing (#472 review). On clear: drops every saved price and calls
 * `onSave("clear")`, so the redrawn panel shows no «Guardado» (#472). A Clear
 * the browser refuses says so and does not rerun; a good one empties every
 * price on screen, because a panel the user edits while the rerun waits stays
 * on screen and its next Save must not write the cleared prices back (#472 review).
 */
export function bindManualRatesPanel(container: HTMLElement, onSave: (action: "save" | "clear") => void): void {
  container.querySelector<HTMLButtonElement>("#crypto-rates-clear-btn")?.addEventListener("click", () => {
    const msg = container.querySelector<HTMLElement>(".crypto-rates-saved-msg");
    const errorMsg = container.querySelector<HTMLElement>(".crypto-rates-error-msg");
    if (msg) msg.hidden = true;
    if (!clearManualRates()) {
      if (errorMsg) {
        errorMsg.hidden = false;
        errorMsg.textContent = tr("crypto_rates.clear_error");
      }
      return;
    }
    if (errorMsg) errorMsg.hidden = true;
    container.querySelectorAll<HTMLInputElement>(".crypto-rate-input").forEach((input) => {
      input.value = "";
      input.removeAttribute("aria-invalid");
    });
    onSave("clear");
  });

  const btn = container.querySelector<HTMLButtonElement>("#crypto-rates-save-btn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const inputs = [...container.querySelectorAll<HTMLInputElement>(".crypto-rate-input")];
    const quotes: ManualRateQuote[] = [];
    let invalidRows = 0;
    for (const input of inputs) {
      const value = input.value.trim();
      const currency = input.dataset.currency ?? "";
      const date = input.dataset.date ?? "";
      if (!currency || !date) continue;
      // Flag a price it cannot read, and a saved price left empty, instead of
      // skipping them: the old price would stay stored and keep valuing the
      // swap while the panel says «Guardado» (#472 review). An empty row with
      // no saved price is simply ignored; «Borrar precios guardados» removes them.
      const invalid = value
        ? normalizeManualQuote({ currency, date, eurPerUnit: value }) === null
        : storedRateFor(currency, date) !== "";
      if (invalid) {
        input.setAttribute("aria-invalid", "true");
        revealFlagged(input);
        invalidRows++;
      } else {
        input.removeAttribute("aria-invalid");
      }
      if (value) quotes.push({ currency, date, eurPerUnit: value });
    }

    const msg = container.querySelector<HTMLElement>(".crypto-rates-saved-msg");
    const errorMsg = container.querySelector<HTMLElement>(".crypto-rates-error-msg");
    const showError = (key: "crypto_rates.row_invalid" | "crypto_rates.save_error" | null): void => {
      if (!errorMsg) return;
      errorMsg.hidden = key === null;
      if (key !== null) errorMsg.textContent = tr(key);
    };
    // Save nothing while a row is flagged, as the opening-lots panel does.
    if (invalidRows > 0) {
      showError("crypto_rates.row_invalid");
      if (msg) msg.hidden = true;
      return;
    }

    // Only count entries that actually persisted (a write the browser
    // accepted), so a refused write doesn't fake a "saved" state or trigger a
    // no-op rerun.
    const { saved: savedCount, written } = saveManualRates(quotes);

    if (msg) msg.hidden = savedCount === 0;
    showError(written ? null : "crypto_rates.save_error");

    if (savedCount > 0) onSave("save");
  });
}

/**
 * Open every closed <details> around a flagged input, so the error that asks
 * the user to review the marked rows points at something on screen (#472
 * review): a saved price sits in the collapsed «saved elsewhere» list.
 */
function revealFlagged(input: HTMLElement): void {
  for (let d = input.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
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

export function bindManualOpeningLotsPanel(container: HTMLElement, onSave: (action: "save" | "clear") => void): void {
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

  // A Clear the browser refuses says so and does not rerun. A good one empties
  // every row on screen: a panel the user edits while the rerun waits stays on
  // screen, and its next Save must not write the cleared lots back (#472 review).
  const clearBtn = container.querySelector<HTMLButtonElement>("#manual-opening-lots-clear-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const msg = container.querySelector<HTMLElement>(".manual-opening-lots-saved-msg");
      const errorMsg = container.querySelector<HTMLElement>(".manual-opening-lots-error-msg");
      if (msg) msg.hidden = true;
      if (!clearManualOpeningLots()) {
        if (errorMsg) {
          errorMsg.hidden = false;
          errorMsg.textContent = tr("opening_lots.clear_error");
        }
        return;
      }
      if (errorMsg) errorMsg.hidden = true;
      container.querySelectorAll<HTMLInputElement>(".manual-opening-lot-input").forEach((input) => {
        input.value = "";
        input.removeAttribute("aria-invalid");
      });
      onSave("clear");
    });
  }

  const btn = container.querySelector<HTMLButtonElement>("#manual-opening-lots-save-btn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const groups = [...container.querySelectorAll<HTMLElement>(".manual-opening-lot-group")];
    const toSave: { groupKey: string; lots: ManualOpeningLot[] }[] = [];
    let invalidRows = 0;
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
        const lot = {
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
        // Flag a partly filled or unreadable row instead of dropping it
        // silently; a row left completely empty is simply ignored.
        const invalid =
          (acquireDate !== "" || quantity !== "" || pricePerShare !== "") && normalizeManualOpeningLot(lot) === null;
        row.querySelectorAll<HTMLInputElement>(".manual-opening-lot-input").forEach((input) => {
          if (invalid) {
            input.setAttribute("aria-invalid", "true");
            revealFlagged(input);
          } else input.removeAttribute("aria-invalid");
        });
        if (invalid) invalidRows++;
        return lot;
      });

      toSave.push({ groupKey, lots });
    }

    const msg = container.querySelector<HTMLElement>(".manual-opening-lots-saved-msg");
    const errorMsg = container.querySelector<HTMLElement>(".manual-opening-lots-error-msg");
    const showError = (key: "opening_lots.row_invalid" | "opening_lots.save_error" | null): void => {
      if (!errorMsg) return;
      errorMsg.hidden = key === null;
      if (key !== null) errorMsg.textContent = tr(key);
    };
    showError(invalidRows > 0 ? "opening_lots.row_invalid" : null);
    // Save nothing while a row is flagged: saving recalculates and re-renders
    // the panel, which would wipe the row the user still has to fix.
    if (invalidRows > 0) {
      if (msg) msg.hidden = true;
      return;
    }

    // One write for every group: a refused write saves nothing, says so and
    // does not rerun, so the rows the user typed stay on screen (#472).
    const { saved: savedCount, written } = saveManualOpeningLotGroups(toSave);
    if (!written) showError("opening_lots.save_error");

    if (msg) msg.hidden = savedCount === 0;

    if (savedCount > 0) onSave("save");
  });
}
