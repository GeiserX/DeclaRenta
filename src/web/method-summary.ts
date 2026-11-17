/**
 * The FX method on the results page (#434):
 *
 * - the header chips: «Método: … · Cambiar», titulares, auto-conversions;
 * - the open «Cómo se ha calculado» box: the method text, its legal basis and
 *   the report's own notes about the method;
 * - the «Acciones / Divisa / Total» strip above the casillas;
 * - the closed «Comparar con los otros métodos» box. It is read-only and runs
 *   the engine for the other two methods only when the user opens it, so the
 *   normal path stays at one engine run.
 */

import Decimal from "decimal.js";
import type { FxMethod, TaxSummary } from "../types/tax.js";
import { calculateSavingsTax } from "../engine/tax-brackets.js";
import { computeTaxableBase } from "../engine/taxable-base.js";
import { combinedNetGainLoss, computeCasillaBlocks, computeCasillaBlocksWithFx } from "../generators/casillas.js";
import { t, localizeMessage, localizeHint } from "../i18n/index.js";
import { esc } from "./esc.js";
import { fmtEur } from "./format.js";
import { FX_METHODS, methodName, methodText } from "./fx-method.js";
import { isMethodNote } from "./casilla-detail.js";

/** The result split of one report, the figures the strip and the comparison show. */
export interface MethodTotals {
  /** Gain or loss of the securities: shares, plus options, crypto and funds when present. */
  securities: Decimal;
  /** Gain or loss of the currency (part of 1633/1637). */
  fx: Decimal;
  /** securities + fx: the net row under the casillas. */
  total: Decimal;
  /** Indicative savings tax of the whole savings base, after the 0588 deduction (as the tax card). */
  tax: Decimal;
  /** True when there are disposals besides listed shares, so the securities figure is not only 0328/0331. */
  hasOtherElements: boolean;
}

export function methodTotals(report: TaxSummary): MethodTotals {
  const total = combinedNetGainLoss(computeCasillaBlocksWithFx(report));
  const fx = report.fxGains.netGainLoss;
  // The exact Decimal base: a Number round trip moves the tax by a cent.
  const gross = calculateSavingsTax(computeTaxableBase(report), report.year);
  const tax = Decimal.max(0, gross.minus(report.doubleTaxation.deduction));
  const hasOtherElements = computeCasillaBlocks(report.capitalGains.disposals).otherElements.count > 0;
  return { securities: total.minus(fx), fx, total, tax, hasOtherElements };
}

/** "+425,00" / "−225,00" / "0,00": a sign on every non-zero figure, a real minus sign. */
function signed(d: Decimal): string {
  const rounded = d.toDecimalPlaces(2);
  if (rounded.isZero()) return fmtEur(0);
  return rounded.greaterThan(0) ? `+${fmtEur(rounded)}` : `−${fmtEur(rounded.abs())}`;
}

function signClass(d: Decimal): string {
  const rounded = d.toDecimalPlaces(2);
  if (rounded.isZero()) return "";
  return rounded.greaterThan(0) ? "gain" : "loss";
}

// ---------------------------------------------------------------------------
// Header chips
// ---------------------------------------------------------------------------

/**
 * The settings chips of the results header. The method chip holds a button
 * back to the review step; it is left out when the upload has no foreign
 * currency, where the method does not apply.
 */
export function renderSettingsChips(report: TaxSummary, method: FxMethod | null): string {
  const s = report.settings;
  if (!s) return "";
  const methodChip = method
    ? `<span class="header-chip method-chip" id="results-method-chip">${esc(t("results.method_chip", { method: methodName(method) }))}
        <button type="button" class="method-chip-change" id="results-method-change" aria-label="${esc(t("results.method_change_aria"))}">${esc(t("results.method_change"))}</button></span>`
    : "";
  const titulares = s.titulares === 1 ? t("results.titulares_one") : t("results.titulares_many", { count: String(s.titulares) });
  const autoconvert = method && method !== "monodivisa"
    ? `<span class="header-chip">${esc(t("results.autoconvert_chip", { value: t(s.trackAutoConvert ? "results.setting_yes" : "results.setting_no") }))}</span>`
    : "";
  return `<span class="section-settings" id="results-settings">${methodChip}<span class="header-chip">${esc(titulares)}</span>${autoconvert}</span>`;
}

// ---------------------------------------------------------------------------
// «Cómo se ha calculado»
// ---------------------------------------------------------------------------

/**
 * The open info box under the header: what the method does and its legal
 * basis, then the report's info notes about the method. Warnings (the risk of
 * the traditional method among them) stay in the amber list under the casillas.
 */
export function renderHowCalculated(report: TaxSummary, method: FxMethod | null): string {
  const all = report.messages.filter(isMethodNote);
  if (!method && all.length === 0) return "";
  // «Tradicional con divisa» has its own method note: it says what the card
  // text and basis say, at more length. It takes their place instead of
  // following them, so the box says the method once.
  const own = method === "tradicional-divisa" ? all.find((m) => m.id === "report.fx_traditional_method") : undefined;
  const notes = own ? all.filter((m) => m !== own) : all;
  const intro = own ? localizeMessage(own) : method ? methodText(method, "text") : "";
  const basis = own ? (localizeHint(own) ?? methodText("tradicional-divisa", "basis")) : method ? methodText(method, "basis") : "";
  const notesHtml = notes.length > 0
    ? `<ul class="how-notes">${notes.map((m) => {
        const hint = localizeHint(m);
        return `<li>${esc(localizeMessage(m))}${hint ? `<span class="msg-hint">${esc(hint)}</span>` : ""}</li>`;
      }).join("")}</ul>`
    : "";
  return `
    <section class="how-calculated" aria-labelledby="how-calculated-title">
      <p><strong id="how-calculated-title">${esc(t("results.how_title"))}.</strong>${intro ? `
        ${esc(intro)}
        <span class="how-basis">${esc(basis)}</span>` : ""}</p>
      ${notesHtml}
    </section>`;
}

// ---------------------------------------------------------------------------
// «Acciones / Divisa / Total» strip
// ---------------------------------------------------------------------------

/**
 * `method` is null when the upload has no foreign currency: no method applies
 * and there are no 1633/1637 rows, so the strip leaves the «Divisa» cell out.
 */
export function renderResultsSplit(report: TaxSummary, method: FxMethod | null): string {
  const totals = methodTotals(report);
  const securitiesLabel = totals.hasOtherElements ? t("results.split_securities") : t("results.split_shares");
  const securitiesSub = totals.hasOtherElements ? t("results.split_securities_sub") : t("results.split_shares_sub");
  const fxSub = method === "monodivisa" ? t("results.split_fx_off") : t("results.split_fx_sub");
  const cell = (label: string, value: Decimal, sub: string) => `
    <div class="split-cell">
      <dt class="split-label">${esc(label)}</dt>
      <dd class="split-value ${signClass(value)}">${signed(value)} €</dd>
      <dd class="split-sub">${esc(sub)}</dd>
    </div>`;
  return `<dl class="results-split${method ? "" : " results-split-two"}" id="results-split">
    ${cell(securitiesLabel, totals.securities, securitiesSub)}
    ${method ? cell(t("results.split_fx"), totals.fx, fxSub) : ""}
    ${cell(t("results.split_total"), totals.total, t("results.split_total_sub", { tax: fmtEur(totals.tax) }))}
  </dl>`;
}

// ---------------------------------------------------------------------------
// Comparison with the other methods
// ---------------------------------------------------------------------------

/** The closed comparison box. Its table is built when it is first opened. */
export function renderMethodCompare(): string {
  return `
    <details class="method-compare" id="method-compare">
      <summary>${esc(t("results.compare_title"))}</summary>
      <div class="method-compare-body" aria-live="polite"></div>
    </details>`;
}

function renderCompareTable(totals: Record<FxMethod, MethodTotals>, current: FxMethod): string {
  const cur = (m: FxMethod) => (m === current ? ' class="cur"' : "");
  const hasOther = FX_METHODS.some((m) => totals[m].hasOtherElements);
  // On a phone the parenthesis of a name ("(multidivisa)") is hidden in the
  // table head so the four columns fit; the cards and the chip keep it.
  const headName = (m: FxMethod) => {
    const name = methodName(m);
    const i = name.indexOf(" (");
    return i < 0 ? esc(name) : `${esc(name.slice(0, i))}<span class="method-paren"> ${esc(name.slice(i + 1))}</span>`;
  };
  const head = FX_METHODS.map((m) => `<th scope="col"${cur(m)}>${headName(m)}${m === current ? ` <span class="method-badge method-badge-use">${esc(t("results.compare_in_use"))}</span>` : ""}</th>`).join("");
  const row = (label: string, pick: (x: MethodTotals) => string, extraClass = "") =>
    `<tr${extraClass ? ` class="${extraClass}"` : ""}><th scope="row">${esc(label)}</th>${FX_METHODS.map((m) => `<td${cur(m)}>${pick(totals[m])}</td>`).join("")}</tr>`;
  return `
    <div class="table-wrapper method-compare-wrap">
      <table class="method-compare-table">
        <thead><tr><td></td>${head}</tr></thead>
        <tbody>
          ${row(hasOther ? t("results.split_securities") : t("results.split_shares"), (x) => signed(x.securities))}
          ${row(t("results.split_fx"), (x) => signed(x.fx))}
          ${row(t("results.split_total"), (x) => signed(x.total), "total")}
          ${row(t("results.compare_tax"), (x) => fmtEur(x.tax))}
        </tbody>
      </table>
    </div>
    <p class="method-compare-note">${esc(t("results.compare_note"))}</p>`;
}

/**
 * Fill the comparison table the first time the box is opened. `current` is
 * the report on screen; `runMethod` computes the same upload with another
 * method (two engine runs, never more, and none until the box is opened).
 */
export function bindMethodCompare(
  root: HTMLElement,
  current: { method: FxMethod; report: TaxSummary },
  runMethod: (m: FxMethod) => TaxSummary,
): void {
  const details = root.querySelector<HTMLDetailsElement>("#method-compare");
  const body = details?.querySelector<HTMLElement>(".method-compare-body");
  if (!details || !body) return;
  let built = false;
  details.addEventListener("toggle", () => {
    if (!details.open || built) return;
    built = true;
    body.innerHTML = `<p class="muted">${esc(t("results.compare_loading"))}</p>`;
    // Let the browser paint the loading line before the synchronous engine runs.
    setTimeout(() => {
      try {
        const totals = {} as Record<FxMethod, MethodTotals>;
        for (const m of FX_METHODS) {
          totals[m] = methodTotals(m === current.method ? current.report : runMethod(m));
        }
        body.innerHTML = renderCompareTable(totals, current.method);
      } catch (err) {
        built = false;
        console.error("[DeclaRenta] method comparison failed:", err instanceof Error ? err.message : String(err));
        body.innerHTML = `<p class="warning">${esc(t("results.compare_error"))}</p>`;
      }
    }, 0);
  });
}
