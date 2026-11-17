/**
 * The FX method choice (#434): the three radio cards on the review step, and
 * the method texts the results reuse.
 *
 * The method is a choice for several years, not a view setting: switching it
 * between years while currency from an earlier year is still held can count
 * part of the result twice or lose it. So it is chosen once, on the review
 * step, before any figure is shown, next to its risk note and the method of
 * the last saved year.
 */

import type { Statement } from "../types/broker.js";
import type { FxMethod } from "../types/tax.js";
import { isFiat } from "../engine/ecb.js";
import { t, type TranslationKey } from "../i18n/index.js";
import { esc } from "./esc.js";
import { FX_METHOD_NAME_KEY } from "../generators/report-settings.js";

/** The three methods, in the order the cards show them. The first is the default. */
export const FX_METHODS: readonly FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];

export const DEFAULT_FX_METHOD: FxMethod = "multidivisa";

export function isFxMethod(value: unknown): value is FxMethod {
  return typeof value === "string" && (FX_METHODS as readonly string[]).includes(value);
}

type MethodPart = "sub" | "text" | "basis";

function key(m: FxMethod, part: MethodPart | "risk"): TranslationKey {
  return `method.${m.replace("-", "_")}.${part}` as TranslationKey;
}

/** The method's name: the same key the engine messages and the exports use. */
export function methodName(m: FxMethod): string {
  return t(FX_METHOD_NAME_KEY[m]);
}

export function methodText(m: FxMethod, part: MethodPart): string {
  return t(key(m, part));
}

/** The risk note shown while a traditional method is selected; none for the default. */
export function methodRisk(m: FxMethod): string | null {
  return m === DEFAULT_FX_METHOD ? null : t(key(m, "risk"));
}

/**
 * The foreign fiat currencies in an upload, sorted. Trades and cash movements
 * (dividends, interest, conversions) both count: the method changes how either
 * is valued. Crypto quote currencies are not fiat, so a crypto-only file does
 * not ask for a method.
 */
export function foreignCurrencies(statement: Statement): string[] {
  const set = new Set<string>();
  const add = (c: string | undefined) => {
    const code = (c ?? "").trim().toUpperCase();
    if (code && code !== "EUR" && isFiat(code)) set.add(code);
  };
  for (const tr of statement.trades) add(tr.currency);
  for (const ct of statement.cashTransactions) add(ct.currency);
  return [...set].sort();
}

export interface LastYearMethod {
  year: number;
  method: FxMethod;
}

/**
 * The method block of the review step: a fieldset with one radio card per
 * method, the selected method's risk note, and the method of the last saved
 * year. A native radio group, so the arrow keys move the choice and the whole
 * card is the hit area.
 */
export function renderMethodPicker(
  selected: FxMethod,
  currencies: string[],
  lastYear: LastYearMethod | null,
): string {
  const cards = FX_METHODS.map((m) => {
    const id = `fx-method-${m}`;
    const isSel = m === selected;
    const badge = m === DEFAULT_FX_METHOD
      ? ` <span class="method-badge">${esc(t("review.method_recommended"))}</span>`
      : "";
    return `
      <label class="method-card${isSel ? " selected" : ""}" for="${id}">
        <input type="radio" name="fx-method" id="${id}" value="${m}"${isSel ? " checked" : ""} aria-describedby="${id}-desc" />
        <span class="method-card-body">
          <span class="method-card-name">${esc(methodName(m))}${badge}</span>
          <span class="method-card-sub">${esc(methodText(m, "sub"))}</span>
          <span id="${id}-desc" class="method-card-desc">
            <span class="method-card-text">${esc(methodText(m, "text"))}</span>
            <span class="method-card-basis">${esc(methodText(m, "basis"))}</span>
          </span>
        </span>
      </label>`;
  }).join("");

  return `
    <fieldset class="method-picker" id="method-picker">
      <legend class="method-picker-title">${esc(t("review.method_title"))}</legend>
      <p class="method-picker-lead">${esc(t("review.method_lead", { currencies: currencies.join(", ") }))}</p>
      <div class="method-cards">${cards}</div>
      <div class="method-notes">${renderMethodNotes(selected, lastYear)}</div>
    </fieldset>`;
}

/** The risk note of the selected method and the last-year note, under the cards. */
export function renderMethodNotes(selected: FxMethod, lastYear: LastYearMethod | null): string {
  const risk = methodRisk(selected);
  let html = risk ? `<p class="method-risk" role="note">${esc(risk)}</p>` : "";
  if (lastYear) {
    const params = { year: String(lastYear.year), method: methodName(lastYear.method) };
    html += lastYear.method === selected
      ? `<p class="method-last-year" role="note">${esc(t("review.method_last_year", params))}</p>`
      : `<p class="method-last-year method-last-year-switch" role="note">${esc(t("review.method_last_year_switch", params))}</p>`;
  }
  return html;
}

/** Wire the radio cards: mark the selected card, redraw the notes and report the choice. */
export function bindMethodPicker(
  root: HTMLElement,
  lastYear: LastYearMethod | null,
  onChange: (m: FxMethod) => void,
): void {
  const picker = root.querySelector<HTMLElement>("#method-picker");
  if (!picker) return;
  picker.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.name !== "fx-method" || !isFxMethod(input.value)) return;
    const m = input.value;
    picker.querySelectorAll(".method-card").forEach((card) => {
      card.classList.toggle("selected", card.querySelector("input")?.value === m);
    });
    const notes = picker.querySelector<HTMLElement>(".method-notes");
    if (notes) notes.innerHTML = renderMethodNotes(m, lastYear);
    onChange(m);
  });
}
