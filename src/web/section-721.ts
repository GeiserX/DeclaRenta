/**
 * Modelo 721 section — foreign crypto assets declaration.
 *
 * Displays threshold indicator, crypto position table, filing guide,
 * and explains that official XML generation is not implemented yet.
 */

import { t } from "../i18n/index.js";
import { getProfile, isProfileComplete } from "./profile.js";
import type { Statement } from "../types/broker.js";
import type { EcbRateMap } from "../types/ecb.js";
import { lookupPositionRate } from "../engine/ecb.js";
import { buildModelo721Entries } from "../generators/modelo721.js";
import Decimal from "decimal.js";
import { fmtEur, fmtQty } from "./format.js";
import { esc } from "./esc.js";
import { renderPositionsDateBanner } from "./positions-date.js";

/** Return year-end date or today if the year hasn't ended yet */
function effectiveYearEnd(year: number): string {
  const today = new Date().toISOString().slice(0, 10);
  const yearEnd = `${year}-12-31`;
  return yearEnd <= today ? yearEnd : today;
}

let cachedStatement: Statement | null = null;
let cachedRateMap: EcbRateMap | null = null;

/** Initialize 721 section with empty state */
export function initSection721(): void {
  // Also forget the data behind the last render: after the upload list
  // changes, a locale switch or the generate button must not bring it back.
  cachedStatement = null;
  cachedRateMap = null;
  const container = document.getElementById("m721-content");
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </div>
      <h3>${t("m721.empty_title")}</h3>
      <p>${t("m721.empty_description")}</p>
      <a href="#renta" class="btn-cta">${t("m721.empty_cta")}</a>
    </div>`;
}

/** Render 721 section with processed data */
export function renderSection721(statement: Statement, rateMap: EcbRateMap): void {
  cachedStatement = statement;
  cachedRateMap = rateMap;

  const container = document.getElementById("m721-content");
  if (!container) return;

  const profile = getProfile();
  const year = profile.year;
  const yearEnd = effectiveYearEnd(year);

  // Build valued crypto positions via the single 721 valuation source of truth.
  const valuation = buildModelo721Entries(statement.openPositions, rateMap, yearEnd);
  const positions = valuation.positions;

  if (positions.length === 0) {
    container.innerHTML = `<p class="muted">${t("m721.no_positions")}</p>`;
    return;
  }

  let html = "";

  // Year + deadline header
  html += `<div class="section-header-bar">
    <span class="section-year">${t("section.year_label")} ${year}</span>
    <span class="section-deadline">${t("m721.deadline_short")}</span>
  </div>`;

  // Profile data source
  const profileParts = [
    profile.nif ? `NIF: ${esc(profile.nif)}` : null,
    profile.apellidos || profile.nombre ? `${esc(profile.apellidos)} ${esc(profile.nombre)}`.trim() : null,
    profile.telefono ? `Tel: ${esc(profile.telefono)}` : null,
  ].filter(Boolean);
  html += `<div class="banner banner-info banner-profile-source">
    ${t("section.profile_source")} — ${profileParts.length > 0 ? profileParts.join(" · ") : t("profile.go_to_profile")}
  </div>`;

  // Profile warning
  if (!isProfileComplete()) {
    html += `<div class="banner banner-warning">
      <span>${t("m721.profile_required")}</span>
      <a href="#perfil">${t("profile.go_to_profile")}</a>
    </div>`;
  }

  // Positions must be the holdings at 31 December of the selected year
  html += renderPositionsDateBanner(statement, year).html;

  // Threshold check (50,000 EUR). Positions whose currency (often the crypto
  // coin itself) has no resolvable year-end rate, or with no market value, are
  // excluded from the EUR total and surfaced for manual valuation, instead of
  // crashing the section. The warning goes before the verdict, and while any
  // are unvalued the verdict cannot be "not obliged".
  const unvaluedCount = valuation.unvaluedCount;
  const totalValue = valuation.totalValueEur;

  const exceeds = totalValue.greaterThanOrEqualTo(50000);
  const undetermined = !exceeds && unvaluedCount > 0;
  const pct = Math.min(totalValue.div(50000).mul(100).toNumber(), 100);

  if (unvaluedCount > 0) {
    html += `<div class="banner banner-warning">${esc(t("m721.positions_unvalued", { count: String(unvaluedCount) }))}</div>`;
  }

  html += `<div class="threshold-bar">
    <div class="threshold-track">
      <div class="threshold-fill ${exceeds ? "over" : "under"}" style="width: ${pct}%"></div>
    </div>
    <div class="threshold-labels">
      <span>${t("m721.total_value", { amount: fmtEur(totalValue) })}</span>
      <span>50.000 €</span>
    </div>
  </div>
  <p class="${exceeds || undetermined ? "warning" : "muted"}">
    ${exceeds
      ? t("m721.threshold_exceeded", { amount: fmtEur(totalValue) })
      : undetermined
        ? esc(t("m721.threshold_undetermined", { amount: fmtEur(totalValue), count: String(unvaluedCount) }))
        : t("m721.threshold_not_exceeded", { amount: fmtEur(totalValue) })}
  </p>`;

  // Positions table
  html += `<h3>${t("m721.positions_title")}</h3>
  <div class="table-wrapper"><table>
    <thead><tr>
      <th>${t("table.symbol")}</th><th>${t("m721.exchange")}</th>
      <th>${t("table.units")}</th><th>${t("table.amount_eur")}</th>
    </tr></thead>
    <tbody>${positions.map((p) => {
      const val = p.valuationEur === null ? "—" : fmtEur(p.valuationEur);
      // Exchange/country are not derived from the ISIN prefix (forbidden for
      // crypto); open positions carry no reliable exchange, so render blank.
      const exchange = p.entry.exchangeName || "—";
      return `<tr>
        <td class="mono">${esc(p.entry.description)}</td>
        <td>${esc(exchange)}</td>
        <td>${fmtQty(p.entry.quantity)}</td>
        <td>${val}</td>
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;

  // Exchange rates display. Currencies come from the raw crypto positions
  // (valuation entries don't carry currency); same crypto filter the generator uses.
  const uniqueCurrencies = [...new Set(
    statement.openPositions
      .filter((p) => p.assetCategory === "CRYPTO" && new Decimal(p.positionValue).greaterThan(0))
      .map((p) => p.currency),
  )].filter((c) => c !== "EUR").sort();
  if (uniqueCurrencies.length > 0) {
    html += `<div class="rates-display">
      <h4>${t("m721.rates_title")}</h4>
      <div class="rates-grid">${uniqueCurrencies.map((cur) => {
        const rate = lookupPositionRate(rateMap, yearEnd, cur);
        return `<span class="rate-item">${esc(cur)}: ${rate === null ? "—" : `${fmtEur(rate, 4)} €`}</span>`;
      }).join("")}</div>
    </div>`;
  }

  html += `<div class="banner banner-warning">${t("m721.format_notice")}</div>`;

  // Filing guide
  html += `<div class="filing-guide">
    <h3>${t("m721.filing_title")}</h3>
    <ol>
      <li><a href="https://sede.agenciatributaria.gob.es" target="_blank" rel="noopener">${esc(t("m721.filing_step1"))}</a></li>
      <li>${esc(t("m721.filing_step2"))}</li>
      <li>${esc(t("m721.filing_step3"))}</li>
      <li>${esc(t("m721.filing_step4"))}</li>
    </ol>
  </div>`;

  // Deadline
  html += `<div class="deadline-reminder">${t("m721.deadline")}</div>`;

  container.innerHTML = html;

}

/** Re-render if data was previously cached (for locale changes) */
export function rerenderSection721(): void {
  if (cachedStatement && cachedRateMap) {
    renderSection721(cachedStatement, cachedRateMap);
  } else {
    initSection721();
  }
}
