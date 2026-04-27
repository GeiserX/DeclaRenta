/**
 * Expandable casilla cards for DeclaRenta results.
 *
 * Each casilla row can be clicked to expand and show the contributing
 * operations (disposals, dividends, interest entries) that compose it.
 */

import type { TaxSummary, FifoDisposal, FxDisposal, DividendEntry, InterestEntry } from "../types/tax.js";
import { t } from "../i18n/index.js";

/** Escape HTML special characters to prevent XSS in rendered strings. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Format a date string (YYYYMMDD or YYYY-MM-DD) to DD/MM/YYYY display format. */
function formatDate(d: string): string {
  if (d.length === 8) return `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}`;
  if (d.length >= 10) return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  return d;
}

// ---------------------------------------------------------------------------
// Casilla → operation mapping
// ---------------------------------------------------------------------------

interface CasillaConfig {
  code: string;
  i18nKey: string;
  getValue: (r: TaxSummary) => string;
  getClass: (r: TaxSummary) => string;
  getDetail: (r: TaxSummary) => string;
}

/** Render a detail table of FIFO disposals for a casilla drill-down. */
function renderDisposalsDetail(disposals: FifoDisposal[], label: string): string {
  if (disposals.length === 0) return `<p class="muted">${t("casilla.no_operations")}</p>`;
  return `
    <p class="detail-label">${esc(label)} (${disposals.length})</p>
    <table class="detail-table">
      <thead><tr>
        <th>ISIN</th><th>${t("table.symbol")}</th><th>${t("table.sell_date")}</th>
        <th>${t("table.units")}</th><th>EUR</th>
      </tr></thead>
      <tbody>${disposals.map((d) => `
        <tr>
          <td class="mono">${esc(d.isin)}</td>
          <td>${esc(d.symbol)}</td>
          <td>${formatDate(d.sellDate)}</td>
          <td>${d.quantity.toString()}</td>
          <td class="${d.gainLossEur.greaterThanOrEqualTo(0) ? "gain" : "loss"}">${d.proceedsEur.toFixed(2)}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

/** Render a detail table of dividend entries for a casilla drill-down. */
function renderDividendsDetail(entries: DividendEntry[]): string {
  if (entries.length === 0) return `<p class="muted">${t("casilla.no_operations")}</p>`;
  return `
    <p class="detail-label">${t("results.dividends")} (${entries.length})</p>
    <table class="detail-table">
      <thead><tr>
        <th>ISIN</th><th>${t("table.symbol")}</th><th>${t("table.date")}</th>
        <th>${t("table.gross_eur")}</th><th>${t("table.country")}</th>
      </tr></thead>
      <tbody>${entries.map((d) => `
        <tr>
          <td class="mono">${esc(d.isin)}</td>
          <td>${esc(d.symbol)}</td>
          <td>${formatDate(d.payDate)}</td>
          <td>${d.grossAmountEur.toFixed(2)}</td>
          <td>${esc(d.withholdingCountry)}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

/** Render a detail table of interest entries (earned or paid) for a casilla drill-down. */
function renderInterestDetail(entries: InterestEntry[], filterType: "earned" | "paid"): string {
  const filtered = entries.filter((e) => e.type === filterType);
  if (filtered.length === 0) return `<p class="muted">${t("casilla.no_operations")}</p>`;
  return `
    <p class="detail-label">${filterType === "earned" ? t("casilla.interest_earned") : t("casilla.interest_paid")} (${filtered.length})</p>
    <table class="detail-table">
      <thead><tr>
        <th>${t("table.date")}</th><th>${t("table.concept")}</th><th>EUR</th>
      </tr></thead>
      <tbody>${filtered.map((e) => `
        <tr>
          <td>${formatDate(e.date)}</td>
          <td>${esc(e.description)}</td>
          <td>${e.amountEur.toFixed(2)}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

/** Render a detail table of double taxation deductions by country. */
function renderDoubleTaxDetail(report: TaxSummary): string {
  const countries = Object.entries(report.doubleTaxation.byCountry);
  if (countries.length === 0) return `<p class="muted">${t("casilla.no_operations")}</p>`;
  return `
    <p class="detail-label">${t("casilla.double_taxation")} (${countries.length} ${t("table.country").toLowerCase()})</p>
    <table class="detail-table">
      <thead><tr><th>${t("table.country")}</th><th>${t("table.withholding_eur")}</th><th>${t("casilla.double_taxation")}</th></tr></thead>
      <tbody>${countries.map(([country, data]) => `
        <tr>
          <td>${esc(country)}</td>
          <td>${data.taxPaid.toFixed(2)}</td>
          <td>${data.deductionAllowed.toFixed(2)}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

/** Render a detail table of FX disposals for casilla 1626/1631 drill-down. */
function renderFxDisposalsDetail(disposals: FxDisposal[], label: string): string {
  if (disposals.length === 0) return `<p class="muted">${t("casilla.no_operations")}</p>`;
  return `
    <p class="detail-label">${esc(label)} (${disposals.length})</p>
    <table class="detail-table">
      <thead><tr>
        <th>${t("table.currency")}</th><th>${t("table.sell_date")}</th><th>${t("table.buy_date")}</th>
        <th>${t("table.units")}</th><th>EUR</th><th>Origen</th><th>Lote FIFO</th>
      </tr></thead>
      <tbody>${disposals.map((d) => `
        <tr>
          <td>${esc(d.currency)}</td>
          <td>${formatDate(d.disposeDate)}</td>
          <td>${formatDate(d.acquireDate)}</td>
          <td>${d.quantity.toFixed(2)}</td>
          <td class="${d.gainLossEur.greaterThanOrEqualTo(0) ? "gain" : "loss"}">${d.gainLossEur.toFixed(2)}</td>
          <td>${esc(d.trigger)}</td>
          <td>${esc(d.lotId)}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

const CASILLAS: CasillaConfig[] = [
  {
    code: "0327",
    i18nKey: "casilla.transmission_value",
    getValue: (r) => r.capitalGains.transmissionValue.toFixed(2),
    getClass: () => "",
    getDetail: (r) => renderDisposalsDetail(r.capitalGains.disposals, t("casilla.transmission_value")),
  },
  {
    code: "0328",
    i18nKey: "casilla.acquisition_value",
    getValue: (r) => r.capitalGains.acquisitionValue.toFixed(2),
    getClass: () => "",
    getDetail: (r) => renderDisposalsDetail(r.capitalGains.disposals, t("casilla.acquisition_value")),
  },
  {
    code: "1626",
    i18nKey: "casilla.fx_transmission_value",
    getValue: (r) => r.fxGains.transmissionValue.toFixed(2),
    getClass: () => "",
    getDetail: (r) => renderFxDisposalsDetail(r.fxGains.disposals, t("casilla.fx_transmission_value" as Parameters<typeof t>[0])),
  },
  {
    code: "1631",
    i18nKey: "casilla.fx_acquisition_value",
    getValue: (r) => r.fxGains.acquisitionValue.toFixed(2),
    getClass: () => "",
    getDetail: (r) => renderFxDisposalsDetail(r.fxGains.disposals, t("casilla.fx_acquisition_value" as Parameters<typeof t>[0])),
  },
  {
    code: "",
    i18nKey: "casilla.net_gain_loss",
    getValue: (r) => r.capitalGains.netGainLoss.plus(r.fxGains.netGainLoss).toFixed(2),
    getClass: (r) => r.capitalGains.netGainLoss.plus(r.fxGains.netGainLoss).greaterThanOrEqualTo(0) ? "gain" : "loss",
    getDetail: () => "",
  },
  {
    code: "0029",
    i18nKey: "casilla.gross_dividends",
    getValue: (r) => r.dividends.grossIncome.toFixed(2),
    getClass: () => "",
    getDetail: (r) => renderDividendsDetail(r.dividends.entries),
  },
  {
    code: "0033",
    i18nKey: "casilla.interest_earned",
    getValue: (r) => r.interest.earned.toFixed(2),
    getClass: () => "",
    getDetail: (r) => renderInterestDetail(r.interest.entries, "earned"),
  },
  {
    code: "",
    i18nKey: "casilla.interest_paid",
    getValue: (r) => r.interest.paid.toFixed(2),
    getClass: () => "",
    getDetail: (r) => renderInterestDetail(r.interest.entries, "paid"),
  },
  {
    code: "0588",
    i18nKey: "casilla.double_taxation",
    getValue: (r) => r.doubleTaxation.deduction.toFixed(2),
    getClass: () => "",
    getDetail: (r) => renderDoubleTaxDetail(r),
  },
];

// ---------------------------------------------------------------------------
// Public render function
// ---------------------------------------------------------------------------

/**
 * Render expandable casilla cards into a container element.
 * Each card shows the casilla code, concept, and EUR amount.
 * Clicking a card toggles the detail view with contributing operations.
 */
export function renderCasillaCards(container: HTMLElement, report: TaxSummary): void {
  const cards = CASILLAS.map((c, idx) => {
    const value = c.getValue(report);
    const cls = c.getClass(report);
    const hasDetail = c.code !== "";
    const isNetRow = c.code === "";

    return `
      <div class="casilla-card ${cls} ${hasDetail ? "expandable" : ""} ${isNetRow ? "casilla-net" : ""}" data-casilla-idx="${idx}">
        <div class="casilla-header">
          ${c.code ? `<span class="casilla-code">${c.code}</span>` : ""}
          <span class="casilla-concept">${isNetRow ? `<strong>${t(c.i18nKey as Parameters<typeof t>[0])}</strong>` : t(c.i18nKey as Parameters<typeof t>[0])}</span>
          <span class="casilla-value ${cls}">${isNetRow ? `<strong>${value}</strong>` : value} EUR</span>
          ${hasDetail ? `<span class="casilla-toggle" aria-hidden="true">&#9656;</span>` : ""}
        </div>
        ${hasDetail ? `<div class="casilla-detail" hidden>${c.getDetail(report)}</div>` : ""}
      </div>`;
  }).join("");

  const warnings = [
    report.capitalGains.blockedLosses.greaterThan(0)
      ? `<p class="warning">${t("casilla.blocked_losses", { amount: report.capitalGains.blockedLosses.toFixed(2) })}</p>`
      : "",
    report.warnings.length > 0
      ? `<details><summary>${t("casilla.warnings_count", { count: String(report.warnings.length) })}</summary><ul>${report.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details>`
      : "",
  ].filter(Boolean).join("");

  container.innerHTML = `<div class="casilla-cards">${cards}</div>${warnings}`;

  // Toggle expansion on click
  container.querySelectorAll<HTMLElement>(".casilla-card.expandable").forEach((card) => {
    card.addEventListener("click", () => {
      const detail = card.querySelector<HTMLElement>(".casilla-detail");
      const toggle = card.querySelector<HTMLElement>(".casilla-toggle");
      if (detail) {
        const isOpen = !detail.hidden;
        detail.hidden = isOpen;
        card.classList.toggle("expanded", !isOpen);
        if (toggle) toggle.innerHTML = isOpen ? "&#9656;" : "&#9662;";
      }
    });
  });
}
