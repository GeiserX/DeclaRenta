/**
 * Modelo 721 section — foreign crypto assets declaration.
 *
 * Displays threshold indicator, crypto position table, filing guide,
 * and explains that official XML generation is not implemented yet.
 *
 * Exchange exports (Binance, Coinbase, Kraken...) carry no year-end balances,
 * so the coins no broker position covers are derived from the FIFO lots still
 * held at 31 December. Coins without an ECB rate get an input for the user's
 * own year-end price (never a price API: see CLAUDE.md "Crypto Permuta Valuation").
 */

import { t } from "../i18n/index.js";
import { getProfile, isProfileComplete } from "./profile.js";
import type { Statement } from "../types/broker.js";
import type { EcbRateMap } from "../types/ecb.js";
import type { Lot } from "../types/tax.js";
import { lookupPositionRate } from "../engine/ecb.js";
import { formatDateDmy } from "../engine/dates.js";
import { normalizeManualQuote } from "../engine/manual-rates.js";
import { buildModelo721Entries } from "../generators/modelo721.js";
import { getManualRates, setManualRate } from "./manual-rates.js";
import Decimal from "decimal.js";
import { fmtEur } from "./format.js";
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
let cachedYearEndLots: Map<string, Lot[]> | undefined;
let cachedOnRatesSaved: (() => void) | undefined;

/** Initialize 721 section with empty state */
export function initSection721(): void {
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

/**
 * Render 721 section with processed data.
 *
 * @param yearEndLots - Lots still held at 31 December (TaxSummary.yearEndLots),
 *   used for the coins no broker position covers.
 * @param onRatesSaved - Called after the user saves year-end prices (main.ts
 *   re-runs the report). Without it the section re-renders itself.
 */
export function renderSection721(
  statement: Statement,
  rateMap: EcbRateMap,
  yearEndLots?: Map<string, Lot[]>,
  onRatesSaved?: () => void,
): void {
  cachedStatement = statement;
  cachedRateMap = rateMap;
  cachedYearEndLots = yearEndLots;
  cachedOnRatesSaved = onRatesSaved;

  const container = document.getElementById("m721-content");
  if (!container) return;

  const profile = getProfile();
  const year = profile.year;
  const yearEnd = effectiveYearEnd(year);

  // Build valued crypto positions via the single 721 valuation source of truth.
  const valuation = buildModelo721Entries(statement.openPositions, rateMap, yearEnd, {
    yearEndLots,
    manualRates: getManualRates(),
  });
  const positions = valuation.positions;
  const yearEndDmy = formatDateDmy(yearEnd);

  if (positions.length === 0) {
    // Processed crypto transactions that leave nothing at year end are an answer,
    // not a missing upload.
    const hadCrypto = statement.trades.some((tr) => tr.assetCategory === "CRYPTO");
    container.innerHTML = hadCrypto
      ? `<p class="muted">${esc(t("m721.no_holdings_at_year_end", { date: yearEndDmy }))}</p>`
      : `<p class="muted">${t("m721.no_positions")}</p>`;
    return;
  }

  const anyDerived = positions.some((p) => p.derived);
  const anyManualPriced = positions.some((p) => p.manualPriced);

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

  // Broker positions must be the holdings at 31 December of the selected year.
  // Derived rows are a 31 December snapshot by construction.
  if (positions.some((p) => !p.derived)) {
    html += renderPositionsDateBanner(statement, year).html;
  }
  if (anyDerived) {
    html += `<div class="banner banner-info">${esc(t("m721.derived_notice", { date: yearEndDmy }))}</div>`;
  }

  // Threshold check (50,000 EUR). Positions whose currency (often the crypto
  // coin itself) has no resolvable year-end rate are excluded from the EUR total
  // and surfaced below for manual valuation, instead of crashing the section.
  const unvaluedCount = valuation.unvaluedCount;
  const totalValue = valuation.totalValueEur;

  const exceeds = totalValue.greaterThanOrEqualTo(50000);
  const pct = Math.min(totalValue.div(50000).mul(100).toNumber(), 100);

  html += `<div class="threshold-bar">
    <div class="threshold-track">
      <div class="threshold-fill ${exceeds ? "over" : "under"}" style="width: ${pct}%"></div>
    </div>
    <div class="threshold-labels">
      <span>${t("m721.total_value", { amount: fmtEur(totalValue) })}</span>
      <span>50.000 €</span>
    </div>
  </div>
  <p class="${exceeds ? "warning" : "muted"}">
    ${exceeds
      ? t("m721.threshold_exceeded", { amount: fmtEur(totalValue) })
      : t("m721.threshold_not_exceeded", { amount: fmtEur(totalValue) })}
  </p>`;

  // Positions table
  html += `<h3>${t("m721.positions_title")}</h3>
  <div class="table-wrapper"><table>
    <thead><tr>
      <th>${t("table.symbol")}</th><th>${t("m721.exchange")}</th>
      <th>${t("table.units")}</th>${anyDerived ? `<th>${esc(t("m721.col_eur_per_unit", { date: yearEndDmy }))}</th>` : ""}<th>${t("table.amount_eur")}</th>
    </tr></thead>
    <tbody>${positions.map((p) => {
      const val = p.valuationEur === null ? "—" : fmtEur(p.valuationEur);
      // Exchange/country are not derived from the ISIN prefix (forbidden for
      // crypto); open positions carry no reliable exchange, so render blank.
      const exchange = p.entry.exchangeName || "—";
      const tag = p.derived ? ` <span class="muted m721-derived-tag">${esc(t("m721.derived_tag"))}</span>` : "";
      let rateCell = "";
      if (anyDerived) {
        if (p.manualPriced) {
          rateCell = `<td><input type="text" inputmode="decimal" class="crypto-rate-input m721-rate-input"
            data-coin="${esc(p.entry.assetId)}" aria-label="${esc(t("m721.col_eur_per_unit", { date: yearEndDmy }))} ${esc(p.entry.assetId)}"
            placeholder="${esc(t("crypto_rates.placeholder"))}" value="${p.eurPerUnit === null ? "" : esc(p.eurPerUnit.toString())}" /></td>`;
        } else {
          rateCell = `<td>${p.eurPerUnit === null ? "" : `${p.eurPerUnit.toFixed(4)} €`}</td>`;
        }
      }
      return `<tr>
        <td class="mono">${esc(p.entry.description)}${tag}</td>
        <td>${esc(exchange)}</td>
        <td>${p.entry.quantity.toString()}</td>
        ${rateCell}
        <td>${val}</td>
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;

  if (anyManualPriced) {
    html += `<div class="m721-rates-entry">
      <p class="muted">${esc(t("m721.rates_help", { date: yearEndDmy }))}</p>
      <button type="button" class="btn-cta m721-rates-save">${esc(t("m721.rates_save_btn"))}</button>
      <span class="manual-opening-lots-error-msg m721-rates-error" role="alert" hidden>${esc(t("m721.rates_invalid"))}</span>
    </div>`;
  }

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
        return `<span class="rate-item">${esc(cur)}: ${rate === null ? "—" : `${rate.toFixed(4)} €`}</span>`;
      }).join("")}</div>
    </div>`;
  }

  if (unvaluedCount > 0) {
    html += `<div class="banner banner-warning">${esc(t("m721.positions_unvalued", { count: String(unvaluedCount) }))}</div>`;
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
  bindYearEndRates(container, yearEnd);
}

/**
 * Save the typed year-end prices as manual quotes for (coin, year end), then
 * recalculate. Nothing is saved while any typed value is unreadable, so the
 * re-render cannot wipe the field the user still has to fix.
 */
function bindYearEndRates(container: HTMLElement, yearEnd: string): void {
  const btn = container.querySelector<HTMLButtonElement>(".m721-rates-save");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const inputs = [...container.querySelectorAll<HTMLInputElement>(".m721-rate-input")];
    const toSave: { coin: string; value: string }[] = [];
    let invalid = 0;
    for (const input of inputs) {
      const value = input.value.trim();
      const coin = input.dataset.coin ?? "";
      const ok = value === "" || normalizeManualQuote({ currency: coin, date: yearEnd, eurPerUnit: value }) !== null;
      if (ok) input.removeAttribute("aria-invalid");
      else input.setAttribute("aria-invalid", "true");
      if (!ok) invalid++;
      else if (value !== "") toSave.push({ coin, value });
    }
    const errorEl = container.querySelector<HTMLElement>(".m721-rates-error");
    if (errorEl) errorEl.hidden = invalid === 0;
    if (invalid > 0 || toSave.length === 0) return;
    for (const { coin, value } of toSave) setManualRate(coin, yearEnd, value);
    (cachedOnRatesSaved ?? rerenderSection721)();
  });
}

/** Re-render if data was previously cached (for locale changes) */
export function rerenderSection721(): void {
  if (cachedStatement && cachedRateMap) {
    renderSection721(cachedStatement, cachedRateMap, cachedYearEndLots, cachedOnRatesSaved);
  } else {
    initSection721();
  }
}
