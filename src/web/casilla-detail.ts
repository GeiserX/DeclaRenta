/**
 * Expandable casilla cards for DeclaRenta results.
 *
 * Each casilla row can be clicked to expand and show the contributing
 * operations (disposals, dividends, interest entries) that compose it.
 */

import Decimal from "decimal.js";
import type { TaxSummary, FifoDisposal, FxDisposal, DividendEntry, InterestEntry, GeneralGainEntry } from "../types/tax.js";
import { t, localizeMessage, localizeHint } from "../i18n/index.js";
import { fmtEur } from "./format.js";
import { esc } from "./esc.js";
import { copyToClipboard } from "./clipboard.js";
import { combinedNetGainLoss, computeCasillaBlocksWithFx, groupDividendsByIssuer, isListedShare, type CasillaBlocks } from "../generators/casillas.js";

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
  getValue: (r: TaxSummary, blocks: CasillaBlocks) => string;
  getClass: (r: TaxSummary, blocks: CasillaBlocks) => string;
  getDetail: (r: TaxSummary) => string;
  /** Optional: hide this card when it returns false (e.g. block has no operations). */
  visible?: (r: TaxSummary, blocks: CasillaBlocks) => boolean;
}

/** Disposals belonging to the "otros elementos" block (everything not a listed share). */
function otherElementDisposals(r: TaxSummary): FifoDisposal[] {
  return r.capitalGains.disposals.filter((d) => !isListedShare(d));
}

/** Disposals belonging to the "acciones negociadas" block (listed shares). */
function listedShareDisposals(r: TaxSummary): FifoDisposal[] {
  return r.capitalGains.disposals.filter((d) => isListedShare(d));
}

/**
 * Render a detail table of FIFO disposals for a casilla drill-down.
 * `mode` selects which date/amount the table reflects so acquisition cards
 * (0331/1637) show acquireDate + costBasisEur, not the transmission figures.
 */
function renderDisposalsDetail(
  disposals: FifoDisposal[],
  label: string,
  mode: "transmission" | "acquisition" = "transmission",
): string {
  if (disposals.length === 0) return `<p class="muted">${t("casilla.no_operations")}</p>`;
  const dateHeader = mode === "acquisition" ? t("table.buy_date") : t("table.sell_date");
  // The acquisition value (0331/1637) is shown at the SALE-date ECB rate so that
  // transmisión − adquisición equals the gain exactly (DGT V2422-20). For a
  // foreign-currency holding this differs from the historical buy-date EUR cost,
  // and from acquisition figures saved in earlier app versions / prior snapshots.
  const note = mode === "acquisition"
    ? `<p class="detail-note">${esc(t("casilla.acquisition_sale_rate_note"))}</p>`
    : "";
  return `
    <p class="detail-label">${esc(label)} (${disposals.length})</p>
    <table class="detail-table">
      <thead><tr>
        <th>ISIN</th><th>${t("table.symbol")}</th><th>${dateHeader}</th>
        <th>${t("table.units")}</th><th>EUR</th>
      </tr></thead>
      <tbody>${disposals.map((d) => `
        <tr>
          <td class="mono">${esc(d.isin)}</td>
          <td>${esc(d.symbol)}</td>
          <td>${formatDate(mode === "acquisition" ? d.acquireDate : d.sellDate)}</td>
          <td>${d.quantity.toString()}</td>
          <td>${fmtEur(mode === "acquisition" ? d.costBasisEur : d.proceedsEur)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    ${note}`;
}

/**
 * Render dividends grouped per issuer (one row per company + source country,
 * matching the AEAT "Alta Capital mobiliario" form and brokers' fiscal
 * certificates), with the individual payments preserved in a collapsible
 * drill-down. Presentation-only: totals reconcile exactly with grossIncome.
 */
export function renderDividendsDetail(entries: DividendEntry[]): string {
  if (entries.length === 0) return `<p class="muted">${t("casilla.no_operations")}</p>`;
  const groups = groupDividendsByIssuer(entries);
  // Foreign withholding is intentionally NOT shown here: this card feeds the
  // Renta Web "Alta Capital mobiliario" form, whose "Retenciones" field is for
  // Spanish IRPF retentions only (Casillas 0030/0031). Foreign withholding is
  // recovered solely via Casilla 0588 (Art. 80 LIRPF) and is shown there. A user
  // pasting it into "Retenciones" would double-count it against 0588. The note
  // below redirects them; it only renders when there is foreign withholding.
  const totalWithholding = groups.reduce((sum, g) => sum.plus(g.withholdingTotalEur), new Decimal(0));
  const note = totalWithholding.greaterThan(0)
    ? `<p class="detail-note">${esc(t("casilla.dividends_withholding_note"))}</p>`
    : "";
  return `
    <p class="detail-label">${t("casilla.dividends_by_issuer")} (${groups.length})</p>
    <table class="detail-table">
      <thead><tr>
        <th>ISIN</th><th>${t("table.symbol")}</th><th>${t("table.country")}</th>
        <th>${t("table.payments")}</th><th>${t("table.gross_eur")}</th>
      </tr></thead>
      <tbody>${groups.map((g) => `
        <tr>
          <td class="mono">${esc(g.isin)}</td>
          <td>${esc(g.symbol)}</td>
          <td>${esc(g.withholdingCountry)}</td>
          <td>${g.paymentCount}</td>
          <td>${fmtEur(g.grossTotalEur)}</td>
        </tr>
        <tr class="detail-subrow">
          <td colspan="5">
            <details>
              <summary>${t("casilla.dividends_per_payment")} (${g.paymentCount})</summary>
              <table class="detail-table">
                <thead><tr>
                  <th>${t("table.date")}</th><th>${t("table.gross_eur")}</th>
                </tr></thead>
                <tbody>${g.payments.map((d) => `
                  <tr>
                    <td>${formatDate(d.payDate)}</td>
                    <td>${fmtEur(d.grossAmountEur)}</td>
                  </tr>`).join("")}
                </tbody>
              </table>
            </details>
          </td>
        </tr>`).join("")}
      </tbody>
    </table>
    ${note}`;
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

/** Render a detail table of base-general crypto reward gains (airdrops/referral). */
function renderGeneralGainsDetail(entries: GeneralGainEntry[]): string {
  if (entries.length === 0) return `<p class="muted">${t("casilla.no_operations")}</p>`;
  return `
    <p class="detail-label">${t("casilla.general_gains")} (${entries.length})</p>
    <table class="detail-table">
      <thead><tr>
        <th>${t("table.date")}</th><th>${t("table.concept")}</th><th>EUR</th>
      </tr></thead>
      <tbody>${entries.map((e) => `
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

/**
 * Render a detail table of FX disposals for casilla 1633/1637 drill-down.
 * `mode` selects the EUR amount: transmission (1633) shows proceedsEur,
 * acquisition (1637) shows costBasisEur — matching the parent casilla.
 */
function renderFxDisposalsDetail(
  disposals: FxDisposal[],
  label: string,
  mode: "transmission" | "acquisition" = "transmission",
): string {
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
          <td>${fmtEur(mode === "acquisition" ? d.costBasisEur : d.proceedsEur)}</td>
          <td>${esc(d.trigger)}</td>
          <td>${esc(d.lotId)}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

const CASILLAS: CasillaConfig[] = [
  // Acciones negociadas en mercados regulados (Art. 37.1.a) → 0328/0331.
  {
    code: "0328",
    i18nKey: "casilla.listed_transmission_value",
    getValue: (_r, blocks) => fmtEur(blocks.listedShares.transmissionValue),
    getClass: () => "",
    getDetail: (r) => renderDisposalsDetail(listedShareDisposals(r), t("casilla.listed_transmission_value")),
    visible: (_r, blocks) => blocks.listedShares.count > 0,
  },
  {
    code: "0331",
    i18nKey: "casilla.listed_acquisition_value",
    getValue: (_r, blocks) => fmtEur(blocks.listedShares.acquisitionValue),
    getClass: () => "",
    getDetail: (r) => renderDisposalsDetail(listedShareDisposals(r), t("casilla.listed_acquisition_value"), "acquisition"),
    visible: (_r, blocks) => blocks.listedShares.count > 0,
  },
  // Otros elementos patrimoniales: opciones/cripto/fondos (Art. 37.1.m) + divisa
  // (Art. 33.1) → 1633/1637. The FX merge is owned by computeCasillaBlocksWithFx().
  {
    code: "1633",
    i18nKey: "casilla.other_transmission_value",
    getValue: (_r, blocks) => fmtEur(blocks.otherElements.transmissionValue),
    getClass: () => "",
    getDetail: (r) =>
      renderDisposalsDetail(otherElementDisposals(r), t("casilla.other_transmission_value")) +
      renderFxDisposalsDetail(r.fxGains.disposals, t("casilla.fx_transmission_value")),
    visible: (_r, blocks) => blocks.otherElements.count > 0,
  },
  {
    code: "1637",
    i18nKey: "casilla.other_acquisition_value",
    getValue: (_r, blocks) => fmtEur(blocks.otherElements.acquisitionValue),
    getClass: () => "",
    getDetail: (r) =>
      renderDisposalsDetail(otherElementDisposals(r), t("casilla.other_acquisition_value"), "acquisition") +
      renderFxDisposalsDetail(r.fxGains.disposals, t("casilla.fx_acquisition_value"), "acquisition"),
    visible: (_r, blocks) => blocks.otherElements.count > 0,
  },
  {
    code: "",
    i18nKey: "casilla.net_gain_loss",
    getValue: (_r, blocks) => fmtEur(combinedNetGainLoss(blocks)),
    getClass: (_r, blocks) => combinedNetGainLoss(blocks).greaterThanOrEqualTo(0) ? "gain" : "loss",
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
    code: "0304",
    i18nKey: "casilla.general_gains",
    getValue: (r) => fmtEur(r.generalGains.total),
    getClass: () => "",
    getDetail: (r) => renderGeneralGainsDetail(r.generalGains.entries),
    // Base-general crypto rewards are uncommon — only show the card when present.
    visible: (r) => r.generalGains.total.greaterThan(0),
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
  const blocks = computeCasillaBlocksWithFx(report);
  const cards = CASILLAS.filter((c) => c.visible === undefined || c.visible(report, blocks)).map((c, idx) => {
    const value = c.getValue(report, blocks);
    const cls = c.getClass(report, blocks);
    const hasDetail = c.code !== "";
    const isNetRow = c.code === "";

    const copyLabel = esc(t("casilla.copy"));
    const concept = isNetRow ? `<strong>${t(c.i18nKey as Parameters<typeof t>[0])}</strong>` : t(c.i18nKey as Parameters<typeof t>[0]);
    const inner = `
      ${c.code ? `<span class="casilla-code">${c.code}</span>` : ""}
      <span class="casilla-concept">${concept}</span>
      <span class="casilla-value ${cls}">${isNetRow ? `<strong>${value}</strong>` : value} EUR</span>
      ${hasDetail ? `<span class="casilla-toggle" aria-hidden="true">&#9656;</span>` : ""}`;
    const copyBtn = `
      <button type="button" class="casilla-copy" data-copy="${esc(value)}" title="${copyLabel}" aria-label="${copyLabel}">
        <svg class="icon-copy" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <svg class="icon-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
      </button>`;
    return `
      <div class="casilla-card ${cls} ${hasDetail ? "expandable" : ""} ${isNetRow ? "casilla-net" : ""}" data-casilla-idx="${idx}">
        <div class="casilla-header">
          ${hasDetail
            ? `<button type="button" class="casilla-trigger" aria-expanded="false">${inner}</button>`
            : `<div class="casilla-trigger casilla-trigger-static">${inner}</div>`}
          ${copyBtn}
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
      <ul>${errors.map((e) => { const h = localizeHint(e); return `<li>${esc(localizeMessage(e))}${h ? `<span class="msg-hint">${esc(h)}</span>` : ""}</li>`; }).join("")}</ul>
    </div>`;
  }

  if (warns.length > 0) {
    messagesHtml += `<details class="msg-section msg-warning" open>
      <summary><span class="msg-icon">⚠️</span> ${t("messages.warnings_title", { count: String(warns.length) })}</summary>
      <ul>${warns.map((w) => { const h = localizeHint(w); return `<li>${esc(localizeMessage(w))}${h ? `<span class="msg-hint">${esc(h)}</span>` : ""}</li>`; }).join("")}</ul>
    </details>`;
  }

  if (infos.length > 0) {
    messagesHtml += `<details class="msg-section msg-info">
      <summary><span class="msg-icon">ℹ️</span> ${t("messages.info_title", { count: String(infos.length) })}</summary>
      <ul>${infos.map((i) => { const h = localizeHint(i); return `<li>${esc(localizeMessage(i))}${h ? `<span class="msg-hint">${esc(h)}</span>` : ""}</li>`; }).join("")}</ul>
    </details>`;
  }

  container.innerHTML = `<div class="casilla-cards">${cards}</div><div class="sr-only" role="status" aria-live="polite"></div>${blockedWarning}${messagesHtml}`;

  const liveRegion = container.querySelector<HTMLElement>('[role="status"]');

  // Toggle expansion. The trigger is a real <button>, so it already handles
  // Enter/Space and exposes a focusable role — no manual keydown wiring needed.
  container.querySelectorAll<HTMLButtonElement>(".casilla-card.expandable .casilla-trigger").forEach((trigger) => {
    const card = trigger.closest<HTMLElement>(".casilla-card");
    trigger.addEventListener("click", () => {
      if (!card) return;
      const detail = card.querySelector<HTMLElement>(".casilla-detail");
      const arrow = card.querySelector<HTMLElement>(".casilla-toggle");
      if (detail) {
        const isOpen = !detail.hidden;
        detail.hidden = isOpen;
        card.classList.toggle("expanded", !isOpen);
        trigger.setAttribute("aria-expanded", String(!isOpen));
        if (arrow) arrow.innerHTML = isOpen ? "&#9656;" : "&#9662;";
      }
    });
  });

  // Copy-amount buttons: copy only the Spanish-formatted number (comma decimal,
  // no "EUR" suffix) so it pastes cleanly into Renta Web fields. The copy button
  // is a sibling of the trigger, so a click never toggles the card's detail view.
  container.querySelectorAll<HTMLButtonElement>(".casilla-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      const amount = btn.dataset.copy ?? "";
      void copyToClipboard(amount).then((ok) => {
        if (!ok) return;
        btn.classList.add("copied");
        btn.setAttribute("aria-label", t("casilla.copied"));
        btn.title = t("casilla.copied");
        if (liveRegion) liveRegion.textContent = t("casilla.copied");
        window.setTimeout(() => {
          btn.classList.remove("copied");
          btn.setAttribute("aria-label", t("casilla.copy"));
          btn.title = t("casilla.copy");
        }, 1500);
      });
    });
  });
}
