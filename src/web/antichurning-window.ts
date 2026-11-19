/**
 * Per-ISIN anti-churning window (#452): the user marks a security as 2 months
 * (LIRPF 33.5.f) or 1 year (33.5.g), or leaves the automatic reading.
 *
 * The values live in localStorage as `{ ISIN: 2 | 12 }` and reach the engine
 * as `ReportOptions.windowMonthsByIsin`. The panel lists the report's
 * `capitalGains.antichurningSecurities`, makes no network call, and escapes
 * every broker value.
 *
 * Privacy: stores only ISINs and a window length, never amounts or names.
 */

import { t, type TranslationKey } from "../i18n/index.js";
import { coerceWindowOverrides, ISIN_SHAPE, type WindowMonths } from "../engine/antichurning-window.js";
import type { AntichurningSecurity } from "../types/tax.js";
import { esc } from "./esc.js";

export const WINDOW_STORAGE_KEY = "declarenta_antichurning_windows";

function tr(key: string, params?: Record<string, string>): string {
  return t(key as TranslationKey, params);
}

/** The saved per-ISIN windows, with anything malformed dropped. */
export function getWindowOverrides(): Record<string, WindowMonths> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(WINDOW_STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    return Object.fromEntries(coerceWindowOverrides(JSON.parse(raw)));
  } catch {
    return {};
  }
}

/**
 * Replace every saved window with `windows` in ONE write (the key is removed
 * when it is empty), so a refused write leaves the old settings whole. Keys
 * that are not ISIN-shaped and values other than 2 or 12 are dropped. Returns
 * false when the browser refuses the write (storage full or blocked).
 */
export function saveWindowOverrides(windows: Readonly<Record<string, WindowMonths>>): boolean {
  const next = coerceWindowOverrides(windows);
  try {
    if (next.size === 0) localStorage.removeItem(WINDOW_STORAGE_KEY);
    else localStorage.setItem(WINDOW_STORAGE_KEY, JSON.stringify(Object.fromEntries(next)));
  } catch {
    return false;
  }
  return true;
}

/** Remove every saved window. Returns false when the browser refuses (storage blocked). */
export function clearWindowOverrides(): boolean {
  try {
    localStorage.removeItem(WINDOW_STORAGE_KEY);
  } catch {
    return false;
  }
  return true;
}

const monthsLabel = (m: WindowMonths): string => tr(m === 12 ? "antichurning_window.months_12" : "antichurning_window.months_2");

function row(s: AntichurningSecurity): string {
  const value = s.source === "user" ? String(s.months) : "auto";
  const option = (v: string, label: string): string =>
    `<option value="${v}"${v === value ? " selected" : ""}>${esc(label)}</option>`;
  const listing = s.listingExchanges.length > 0 ? s.listingExchanges.join(", ") : tr("antichurning_window.no_listing");
  const openCodes = s.openListingExchanges ? `${s.openListingExchanges.join(", ")}: ` : "";
  const open = s.openDecision ? `<br><span class="muted">${esc(openCodes + tr("antichurning_window.open_note", { decision: s.openDecision }))}</span>` : "";
  return `<tr>
    <td><strong>${esc(s.symbol || s.isin)}</strong><br><span class="mono muted">${esc(s.isin)}</span></td>
    <td class="mono">${esc(listing)}${open}</td>
    <td>
      <select class="antichurning-window-select" data-isin="${esc(s.isin)}" aria-label="${esc(tr("antichurning_window.col_window"))} ${esc(s.isin)}">
        ${option("auto", tr("antichurning_window.opt_auto", { window: monthsLabel(s.autoMonths) }))}
        ${option("2", tr("antichurning_window.opt_2m"))}
        ${option("12", tr("antichurning_window.opt_1y"))}
      </select>
    </td>
  </tr>`;
}

/**
 * The collapsed panel, or "" when the report lists no security. It opens by
 * itself when IBKR gave a security 1 year, when a 2-month reading rests on an
 * open decision, or when the user set a window.
 */
export function renderAntichurningWindowPanel(securities: readonly AntichurningSecurity[] | undefined): string {
  if (!securities || securities.length === 0) return "";
  const open = securities.some((s) => (s.source === "ibkr" && s.months === 12) || (s.source !== "user" && s.openDecision) || s.source === "user");
  return `<details class="antichurning-window-panel crypto-rates-panel"${open ? " open" : ""}>
    <summary class="crypto-rates-stored-summary">
      <span class="crypto-rates-stored-summary-text">${esc(tr("antichurning_window.title"))}</span>
      <span class="crypto-rates-stored-summary-count">${securities.length}</span>
    </summary>
    <div class="crypto-rates-stored-body">
      <p>${esc(tr("antichurning_window.description"))}</p>
      <div class="table-wrapper"><table>
        <thead><tr>
          <th>${esc(tr("antichurning_window.col_security"))}</th>
          <th>${esc(tr("antichurning_window.col_listing"))}</th>
          <th>${esc(tr("antichurning_window.col_window"))}</th>
        </tr></thead>
        <tbody>${securities.map(row).join("")}</tbody>
      </table></div>
      <div class="crypto-rates-actions">
        <button type="button" class="btn-cta antichurning-window-save">${esc(tr("antichurning_window.save_btn"))}</button>
        <button type="button" class="btn-secondary antichurning-window-clear">${esc(tr("antichurning_window.clear_btn"))}</button>
      </div>
      <span class="crypto-rates-saved-msg antichurning-window-saved" hidden>${esc(tr("antichurning_window.saved"))}</span>
      <span class="antichurning-window-error" role="alert" hidden></span>
      <p class="muted crypto-rates-recalculate-hint">${esc(tr("antichurning_window.recalculate_hint"))}</p>
    </div>
  </details>`;
}

/**
 * Save writes every row's choice in one write and reruns the report; Clear
 * removes every saved window and reruns. When the browser refuses the write,
 * the panel says so, keeps the old settings and does not rerun.
 */
export function bindAntichurningWindowPanel(container: HTMLElement, onSave: () => void): void {
  const saved = container.querySelector<HTMLElement>(".antichurning-window-saved");
  const error = container.querySelector<HTMLElement>(".antichurning-window-error");
  const show = (failure: "antichurning_window.save_error" | "antichurning_window.clear_error" | null): void => {
    if (saved) saved.hidden = failure !== null;
    if (error) {
      error.hidden = failure === null;
      error.textContent = failure === null ? "" : tr(failure);
    }
  };
  container.querySelector<HTMLButtonElement>(".antichurning-window-clear")?.addEventListener("click", () => {
    if (!clearWindowOverrides()) {
      show("antichurning_window.clear_error");
      return;
    }
    onSave();
  });
  container.querySelector<HTMLButtonElement>(".antichurning-window-save")?.addEventListener("click", () => {
    const before = getWindowOverrides();
    const next = new Map(Object.entries(before));
    for (const select of container.querySelectorAll<HTMLSelectElement>(".antichurning-window-select")) {
      const isin = (select.dataset.isin ?? "").trim().toUpperCase();
      if (!ISIN_SHAPE.test(isin)) continue;
      if (select.value === "12" || select.value === "2") next.set(isin, select.value === "12" ? 12 : 2);
      else next.delete(isin);
    }
    const mapping = Object.fromEntries(next);
    if (JSON.stringify(mapping) === JSON.stringify(before)) {
      show(null);
      return;
    }
    if (!saveWindowOverrides(mapping)) {
      show("antichurning_window.save_error");
      return;
    }
    show(null);
    onSave();
  });
}
