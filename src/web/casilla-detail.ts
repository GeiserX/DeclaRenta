/**
 * Expandable casilla cards for DeclaRenta results.
 *
 * Each casilla row can be clicked to expand and show the contributing
 * operations (disposals, dividends, interest entries) that compose it.
 */

import type { TaxSummary, FifoDisposal, FxDisposal, DividendEntry, InterestEntry } from "../types/tax.js";
import { t } from "../i18n/index.js";
import { fmtEur } from "./format.js";

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
          <td class="${d.gainLossEur.greaterThanOrEqualTo(0) ? "gain" : "loss"}">${fmtEur(d.proceedsEur)}</td>
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
          <td>${fmtEur(d.grossAmountEur)}</td>
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
          <td>${fmtEur(e.amountEur)}</td>
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
          <td>${fmtEur(data.taxPaid)}</td>
          <td>${fmtEur(data.deductionAllowed)}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

/** Render a detail table of FX disposals for casilla 1633/1637 drill-down. */
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
          <td>${fmtEur(d.quantity)}</td>
          <td class="${d.gainLossEur.greaterThanOrEqualTo(0) ? "gain" : "loss"}">${fmtEur(d.gainLossEur)}</td>
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
    getValue: (r) => fmtEur(r.capitalGains.transmissionValue),
    getClass: () => "",
    getDetail: (r) => renderDisposalsDetail(r.capitalGains.disposals, t("casilla.transmission_value")),
  },
  {
    code: "0328",
    i18nKey: "casilla.acquisition_value",
    getValue: (r) => fmtEur(r.capitalGains.acquisitionValue),
    getClass: () => "",
    getDetail: (r) => renderDisposalsDetail(r.capitalGains.disposals, t("casilla.acquisition_value")),
  },
  {
    code: "1633",
    i18nKey: "casilla.fx_transmission_value",
    getValue: (r) => fmtEur(r.fxGains.transmissionValue),
    getClass: () => "",
    getDetail: (r) => renderFxDisposalsDetail(r.fxGains.disposals, t("casilla.fx_transmission_value")),
  },
  {
    code: "1637",
    i18nKey: "casilla.fx_acquisition_value",
    getValue: (r) => fmtEur(r.fxGains.acquisitionValue),
    getClass: () => "",
    getDetail: (r) => renderFxDisposalsDetail(r.fxGains.disposals, t("casilla.fx_acquisition_value")),
  },
  {
    code: "",
    i18nKey: "casilla.net_gain_loss",
    getValue: (r) => fmtEur(r.capitalGains.netGainLoss.plus(r.fxGains.netGainLoss)),
    getClass: (r) => r.capitalGains.netGainLoss.plus(r.fxGains.netGainLoss).greaterThanOrEqualTo(0) ? "gain" : "loss",
    getDetail: () => "",
  },
  {
    code: "0029",
    i18nKey: "casilla.gross_dividends",
    getValue: (r) => fmtEur(r.dividends.grossIncome),
    getClass: () => "",
    getDetail: (r) => renderDividendsDetail(r.dividends.entries),
  },
  {
    code: "0027",
    i18nKey: "casilla.interest_earned",
    getValue: (r) => fmtEur(r.interest.earned),
    getClass: () => "",
    getDetail: (r) => renderInterestDetail(r.interest.entries, "earned"),
  },
  {
    code: "",
    i18nKey: "casilla.interest_paid",
    getValue: (r) => fmtEur(r.interest.paid),
    getClass: () => "",
    getDetail: (r) => renderInterestDetail(r.interest.entries, "paid"),
  },
  {
    code: "0588",
    i18nKey: "casilla.double_taxation",
    getValue: (r) => fmtEur(r.doubleTaxation.deduction),
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
      <div class="casilla-card ${cls} ${hasDetail ? "expandable" : ""} ${isNetRow ? "casilla-net" : ""}" data-casilla-idx="${idx}"${hasDetail ? ` tabindex="0" role="button" aria-expanded="false"` : ""}>
        <div class="casilla-header">
          ${c.code ? `<span class="casilla-code">${c.code}</span>` : ""}
          <span class="casilla-concept">${isNetRow ? `<strong>${t(c.i18nKey as Parameters<typeof t>[0])}</strong>` : t(c.i18nKey as Parameters<typeof t>[0])}</span>
          <span class="casilla-value ${cls}">${isNetRow ? `<strong>${value}</strong>` : value} EUR</span>
          ${hasDetail ? `<span class="casilla-toggle" aria-hidden="true">&#9656;</span>` : ""}
        </div>
        ${hasDetail ? `<div class="casilla-detail" hidden>${c.getDetail(report)}</div>` : ""}
      </div>`;
  }).join("");

  const blockedWarning = report.capitalGains.blockedLosses.greaterThan(0)
    ? `<p class="warning">${t("casilla.blocked_losses", { amount: fmtEur(report.capitalGains.blockedLosses) })}</p>`
    : "";

  const msgs = report.messages;
  const errors = msgs.filter((m) => m.severity === "error");
  const warns = msgs.filter((m) => m.severity === "warning");
  const infos = msgs.filter((m) => m.severity === "info");

  let messagesHtml = "";

  if (errors.length > 0) {
    messagesHtml += `<div class="msg-section msg-error" role="alert">
      <div class="msg-header"><span class="msg-icon" role="img" aria-label="${esc(t("messages.errors_title", { count: String(errors.length) }))}">⛔</span> ${t("messages.errors_title", { count: String(errors.length) })}</div>
      <ul>${errors.map((e) => `<li>${esc(e.message)}${e.hint ? `<span class="msg-hint">${esc(e.hint)}</span>` : ""}</li>`).join("")}</ul>
    </div>`;
  }

  if (warns.length > 0) {
    messagesHtml += `<details class="msg-section msg-warning" open>
      <summary><span class="msg-icon">⚠️</span> ${t("messages.warnings_title", { count: String(warns.length) })}</summary>
      <ul>${warns.map((w) => `<li>${esc(w.message)}${w.hint ? `<span class="msg-hint">${esc(w.hint)}</span>` : ""}</li>`).join("")}</ul>
    </details>`;
  }

  if (infos.length > 0) {
    messagesHtml += `<details class="msg-section msg-info">
      <summary><span class="msg-icon">ℹ️</span> ${t("messages.info_title", { count: String(infos.length) })}</summary>
      <ul>${infos.map((i) => `<li>${esc(i.message)}${i.hint ? `<span class="msg-hint">${esc(i.hint)}</span>` : ""}</li>`).join("")}</ul>
    </details>`;
  }

  container.innerHTML = `<div class="casilla-cards">${cards}</div>${blockedWarning}${messagesHtml}`;

  // Toggle expansion on click/keyboard
  container.querySelectorAll<HTMLElement>(".casilla-card.expandable").forEach((card) => {
    const toggle = () => {
      const detail = card.querySelector<HTMLElement>(".casilla-detail");
      const arrow = card.querySelector<HTMLElement>(".casilla-toggle");
      if (detail) {
        const isOpen = !detail.hidden;
        detail.hidden = isOpen;
        card.classList.toggle("expanded", !isOpen);
        card.setAttribute("aria-expanded", String(!isOpen));
        if (arrow) arrow.innerHTML = isOpen ? "&#9656;" : "&#9662;";
      }
    };
    card.addEventListener("click", toggle);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  });
}
