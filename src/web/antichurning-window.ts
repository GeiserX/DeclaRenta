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
import { canonicalIsin, coerceWindowOverrides, ISIN_SHAPE, type WindowMonths } from "../engine/antichurning-window.js";
import type { AntichurningSecurity } from "../types/tax.js";
import { esc } from "./esc.js";

export const WINDOW_STORAGE_KEY = "declarenta_antichurning_windows";

function tr(key: string, params?: Record<string, string>): string {
  return t(key as TranslationKey, params);
}

/** The saved per-ISIN windows, with anything malformed dropped. */
export function getWindowOverrides(): Record<string, WindowMonths> {
  return readWindowOverrides() ?? {};
}

/**
 * The saved per-ISIN windows, or null when the browser refuses the read
 * (storage blocked). Malformed content reads as no saved window.
 */
function readWindowOverrides(): Record<string, WindowMonths> | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(WINDOW_STORAGE_KEY);
  } catch {
    return null;
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

function row(s: AntichurningSecurity, stored: Readonly<Record<string, WindowMonths>>): string {
  // The select shows what is stored, not the report's reading: a locale
  // redraw in the middle of a Save or Clear rerun draws from the report before
  // it, and a run keeps that panel once the user edits it (#472).
  const months = stored[canonicalIsin(s.isin)];
  const value = months === undefined ? "auto" : String(months);
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
 * What the rows of a panel drawn from `securities` show besides their selects,
 * in order. A run keeps a panel the user is editing only while this is the
 * same for its report (#472 review of 99f969f): an opening lot or a crypto
 * price saved in another panel can turn a sale into a loss or a gain, which
 * adds or drops a row or its open-point note. List every field `row()` shows,
 * except the select, which reads storage.
 */
export function antichurningRowsKey(securities: readonly AntichurningSecurity[] | undefined): string {
  return JSON.stringify(
    (securities ?? []).map((s) => [s.isin, s.symbol, s.listingExchanges, s.openListingExchanges ?? null, s.openDecision ?? null, s.autoMonths]),
  );
}

/**
 * What a panel holds that nobody saved: each select's choice by canonical ISIN
 * and the error on screen, plus whether the user left it open and the ISIN of
 * the select they are on, so a redraw does not take the focus away.
 */
export interface AntichurningDraft {
  windows: Map<string, string>;
  error: string | null;
  open: boolean;
  focus: string | null;
}

/** Read the choices and the visible error of a drawn panel. */
export function readAntichurningDraft(panel: HTMLElement): AntichurningDraft {
  const windows = new Map<string, string>();
  for (const select of panel.querySelectorAll<HTMLSelectElement>(".antichurning-window-select")) {
    windows.set(canonicalIsin(select.dataset.isin), select.value);
  }
  const error = panel.querySelector<HTMLElement>(".antichurning-window-error");
  const active = panel.ownerDocument.activeElement;
  const focus =
    active instanceof HTMLSelectElement && active.matches(".antichurning-window-select") && panel.contains(active)
      ? canonicalIsin(active.dataset.isin)
      : null;
  return { windows, error: error && !error.hidden ? error.textContent : null, open: panel instanceof HTMLDetailsElement && panel.open, focus };
}

/**
 * Put a draft back into a panel drawn from a newer report: each row whose ISIN
 * the draft holds gets the user's choice, a new row keeps what is stored, and
 * the error stays on screen, and the panel stays open or closed as the user
 * left it. The select the user was on keeps the focus, if its row is still
 * there. «Guardado» stays hidden: the panel shows values nobody saved.
 */
export function applyAntichurningDraft(panel: HTMLElement, draft: AntichurningDraft): void {
  if (panel instanceof HTMLDetailsElement) panel.open = draft.open;
  let focus: HTMLSelectElement | null = null;
  for (const select of panel.querySelectorAll<HTMLSelectElement>(".antichurning-window-select")) {
    const isin = canonicalIsin(select.dataset.isin);
    const value = draft.windows.get(isin);
    if (value !== undefined) select.value = value;
    if (isin === draft.focus) focus = select;
  }
  focus?.focus();
  const saved = panel.querySelector<HTMLElement>(".antichurning-window-saved");
  if (saved) saved.hidden = true;
  const error = panel.querySelector<HTMLElement>(".antichurning-window-error");
  if (error && draft.error !== null) {
    error.hidden = false;
    error.textContent = draft.error;
  }
}

/**
 * The collapsed panel, or "" when the report lists no security. It opens by
 * itself when IBKR gave a security 1 year, when a 2-month reading rests on an
 * open decision, or when the user set a window.
 *
 * `saved` shows the «Guardado» label: a Save reruns the report, which redraws
 * this panel, so the new panel has to carry the confirmation (#472). A Save
 * can leave no row (a window saved for a security with no sale this year, set
 * back to «auto»): the panel then shows only its title and the label, with no
 * table and no buttons (#472 review).
 */
export function renderAntichurningWindowPanel(
  securities: readonly AntichurningSecurity[] | undefined,
  { saved = false }: { saved?: boolean } = {},
): string {
  if (!securities || securities.length === 0) {
    if (!saved) return "";
    return `<details class="antichurning-window-panel crypto-rates-panel" open>
    <summary class="crypto-rates-stored-summary">
      <span class="crypto-rates-stored-summary-text">${esc(tr("antichurning_window.title"))}</span>
    </summary>
    <div class="crypto-rates-stored-body">
      <span class="crypto-rates-saved-msg antichurning-window-saved">${esc(tr("antichurning_window.saved"))}</span>
    </div>
  </details>`;
  }
  const stored = getWindowOverrides();
  const open = securities.some((s) => (s.source === "ibkr" && s.months === 12) || (s.source !== "user" && s.openDecision) || stored[canonicalIsin(s.isin)] !== undefined);
  // A Save back to «auto» can leave no reason to open: open it anyway so
  // «Guardado» is on screen (#472).
  return `<details class="antichurning-window-panel crypto-rates-panel"${open || saved ? " open" : ""}>
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
        <tbody>${securities.map((s) => row(s, stored)).join("")}</tbody>
      </table></div>
      <div class="crypto-rates-actions">
        <button type="button" class="btn-cta antichurning-window-save">${esc(tr("antichurning_window.save_btn"))}</button>
        <button type="button" class="btn-secondary antichurning-window-clear">${esc(tr("antichurning_window.clear_btn"))}</button>
      </div>
      <span class="crypto-rates-saved-msg antichurning-window-saved"${saved ? "" : " hidden"}>${esc(tr("antichurning_window.saved"))}</span>
      <span class="antichurning-window-error" role="alert" hidden></span>
      <p class="muted crypto-rates-recalculate-hint">${esc(tr("antichurning_window.recalculate_hint"))}</p>
    </div>
  </details>`;
}

/**
 * Save writes every row's choice in one write and reruns the report; Clear
 * removes every saved window, sets every select back to automatic and reruns.
 * When the browser refuses the read or the write, the panel says so, keeps the
 * old settings and the selects as they were, and does not rerun. `onSave` gets
 * "save" or "clear", so the caller shows «Guardado» in the redrawn panel only
 * after a Save (#472). The selects go back to automatic because a panel the
 * user edits while the Clear rerun waits stays on screen, and its next Save
 * must not write the cleared windows back (#472 review).
 */
export function bindAntichurningWindowPanel(container: HTMLElement, onSave: (action: "save" | "clear") => void): void {
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
    for (const select of container.querySelectorAll<HTMLSelectElement>(".antichurning-window-select")) select.value = "auto";
    if (saved) saved.hidden = true;
    if (error) error.hidden = true;
    onSave("clear");
  });
  container.querySelector<HTMLButtonElement>(".antichurning-window-save")?.addEventListener("click", () => {
    // An unreadable storage cannot say what is saved, and a write would drop
    // the windows of ISINs outside this panel: report the failure instead.
    const before = readWindowOverrides();
    if (before === null) {
      show("antichurning_window.save_error");
      return;
    }
    const next = new Map(Object.entries(before));
    for (const select of container.querySelectorAll<HTMLSelectElement>(".antichurning-window-select")) {
      const isin = canonicalIsin(select.dataset.isin);
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
    onSave("save");
  });
}
