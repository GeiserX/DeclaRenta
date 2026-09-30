/**
 * Year-end holdings the user types by hand for Modelo 720 and 721.
 *
 * Only IBKR and Revolut exports carry positions at 31 December. For every other
 * broker the 720/721 sections have nothing to count, so the user copies each
 * asset from the broker's year-end statement into a small table: asset,
 * quantity and its value in euros at 31 December. The values are added to the
 * section's 50.000 € threshold. They are never written into the Modelo 720
 * file; the user declares them by hand in the AEAT form.
 *
 * Stored in localStorage per model and declaration year, because the value at
 * 31 December belongs to one year only.
 */

import Decimal from "decimal.js";
import { t } from "../i18n/index.js";
import { normalizeDecimalString } from "../engine/manual-rates.js";
import { esc } from "./esc.js";
import { fmtEur } from "./format.js";

export type ManualHoldingsModel = "720" | "721";

/** One hand-typed holding. Quantity and value are dot-decimal strings. */
export interface ManualHolding {
  asset: string;
  quantity: string;
  valueEur: string;
}

const STORAGE_PREFIX = "declarenta_manual_holdings";
const MAX_ASSET_LENGTH = 80;

export function manualHoldingsStorageKey(model: ManualHoldingsModel, year: number): string {
  return `${STORAGE_PREFIX}_${model}_${year}`;
}

function parseDecimal(raw: string): Decimal | null {
  const s = normalizeDecimalString(raw);
  if (s === "") return null;
  try {
    const d = new Decimal(s);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * A euro value written "60.000" (no comma) is sixty thousand, the way Spanish
 * statements print it. The shared decimal parser would read it as 60, which
 * would hide a holding from the 50.000 € threshold.
 */
const DOT_THOUSANDS = /^\d{1,3}(\.\d{3})+$/;

function parseEurValue(raw: string): Decimal | null {
  const compact = raw.replace(/\s/g, "");
  return parseDecimal(DOT_THOUSANDS.test(compact) ? compact.replace(/\./g, "") : raw);
}

/**
 * Validate one typed row. Returns null when the asset is empty, the quantity is
 * not above zero or the value is negative or unreadable. Accepts "1.234,56"
 * and, for the value, "60.000".
 */
export function normalizeManualHolding(row: ManualHolding): ManualHolding | null {
  const asset = row.asset.trim().slice(0, MAX_ASSET_LENGTH);
  if (asset === "") return null;
  const quantity = parseDecimal(row.quantity);
  if (quantity === null || quantity.lessThanOrEqualTo(0)) return null;
  const value = parseEurValue(row.valueEur);
  if (value === null || value.isNegative()) return null;
  return { asset, quantity: quantity.toString(), valueEur: value.toString() };
}

/** Narrow parsed JSON to valid holdings, dropping anything malformed. */
export function coerceManualHoldings(parsed: unknown): ManualHolding[] {
  if (!Array.isArray(parsed)) return [];
  const out: ManualHolding[] = [];
  for (const raw of parsed as unknown[]) {
    if (raw == null || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.asset !== "string" || typeof rec.quantity !== "string" || typeof rec.valueEur !== "string") continue;
    const norm = normalizeManualHolding({ asset: rec.asset, quantity: rec.quantity, valueEur: rec.valueEur });
    if (norm) out.push(norm);
  }
  return out;
}

export function loadManualHoldings(model: ManualHoldingsModel, year: number): ManualHolding[] {
  try {
    const raw = localStorage.getItem(manualHoldingsStorageKey(model, year));
    return raw ? coerceManualHoldings(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveManualHoldings(model: ManualHoldingsModel, year: number, entries: ManualHolding[]): void {
  try {
    const key = manualHoldingsStorageKey(model, year);
    if (entries.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    /* storage unavailable or full: the rows simply won't persist */
  }
}

/** Sum of the typed 31 December values, in euros. */
export function manualHoldingsTotal(entries: ManualHolding[]): Decimal {
  return entries.reduce((sum, e) => sum.plus(new Decimal(e.valueEur)), new Decimal(0));
}

/**
 * Banner shown after processing when the uploaded exports carry no year-end
 * holdings. Returns "" when no broker is known, so callers keep the "upload a
 * report" text for the case where nothing was processed.
 */
export function renderExportNoHoldings(
  key: "m720.export_no_holdings" | "m721.export_no_holdings" | "d6.export_no_holdings",
  brokers: string[],
): string {
  if (brokers.length === 0) return "";
  return `<div class="banner banner-info export-no-holdings">${esc(t(key, { brokers: brokers.join(", ") }))}</div>`;
}

/** The manual-entry table: saved rows, one row to add, and the running total. */
export function renderManualHoldingsPanel(model: ManualHoldingsModel, year: number): string {
  const entries = loadManualHoldings(model, year);
  const id = `manual-holdings-${model}`;
  const colAsset = t("manual_holdings.col_asset");
  const colQuantity = t("manual_holdings.col_quantity");
  const colValue = t("manual_holdings.col_value");
  const rows = entries.map((e, i) => `<tr>
      <td class="mono">${esc(e.asset)}</td>
      <td>${esc(e.quantity)}</td>
      <td>${fmtEur(new Decimal(e.valueEur))}</td>
      <td><button type="button" class="manual-holdings-remove" data-index="${i}">${esc(t("manual_holdings.remove_btn"))}</button></td>
    </tr>`).join("");
  const total = entries.length > 0
    ? `<p class="manual-holdings-total"><strong>${esc(t("manual_holdings.total", { amount: fmtEur(manualHoldingsTotal(entries)) }))}</strong></p>`
    : "";
  const fileNote = model === "720" ? `<p class="muted">${esc(t("manual_holdings.not_in_file_720"))}</p>` : "";
  return `<div class="manual-holdings-panel" id="${id}">
    <h3>${esc(t(model === "721" ? "manual_holdings.title_721" : "manual_holdings.title_720"))}</h3>
    <p class="muted">${esc(t("manual_holdings.help"))}</p>
    ${fileNote}
    <div class="table-wrapper"><table>
      <thead><tr><th>${esc(colAsset)}</th><th>${esc(colQuantity)}</th><th>${esc(colValue)}</th><th></th></tr></thead>
      <tbody>${rows}
        <tr class="manual-holdings-new">
          <td><input type="text" class="manual-holdings-input" name="asset" maxlength="${MAX_ASSET_LENGTH}" aria-label="${esc(colAsset)}"></td>
          <td><input type="text" class="manual-holdings-input" name="quantity" inputmode="decimal" aria-label="${esc(colQuantity)}"></td>
          <td><input type="text" class="manual-holdings-input" name="valueEur" inputmode="decimal" aria-label="${esc(colValue)}"></td>
          <td><button type="button" class="manual-holdings-add">${esc(t("manual_holdings.add_btn"))}</button></td>
        </tr>
      </tbody>
    </table></div>
    <span class="manual-holdings-error" role="alert" hidden>${esc(t("manual_holdings.invalid"))}</span>
    ${total}
  </div>`;
}

/**
 * Wire the add and remove buttons. Every change is saved, then `rerender`
 * redraws the section so the threshold picks up the new total.
 */
export function bindManualHoldingsPanel(
  container: HTMLElement,
  model: ManualHoldingsModel,
  year: number,
  rerender: () => void,
): void {
  const panel = container.querySelector<HTMLElement>(`#manual-holdings-${model}`);
  if (!panel) return;
  const input = (name: string) => panel.querySelector<HTMLInputElement>(`.manual-holdings-new input[name="${name}"]`);

  const add = (): void => {
    const asset = input("asset");
    const quantity = input("quantity");
    const value = input("valueEur");
    if (!asset || !quantity || !value) return;
    const row = normalizeManualHolding({ asset: asset.value, quantity: quantity.value, valueEur: value.value });
    const error = panel.querySelector<HTMLElement>(".manual-holdings-error");
    if (!row) {
      if (error) error.hidden = false;
      for (const el of [asset, quantity, value]) el.setAttribute("aria-invalid", "true");
      return;
    }
    saveManualHoldings(model, year, [...loadManualHoldings(model, year), row]);
    rerender();
    container.querySelector<HTMLInputElement>(`#manual-holdings-${model} .manual-holdings-new input[name="asset"]`)?.focus();
  };

  panel.querySelector(".manual-holdings-add")?.addEventListener("click", add);
  panel.querySelectorAll<HTMLInputElement>(".manual-holdings-new input").forEach((el) => {
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        add();
      }
    });
  });
  panel.querySelectorAll<HTMLButtonElement>(".manual-holdings-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.index);
      const entries = loadManualHoldings(model, year);
      if (!Number.isInteger(index) || index < 0 || index >= entries.length) return;
      entries.splice(index, 1);
      saveManualHoldings(model, year, entries);
      rerender();
    });
  });
}
