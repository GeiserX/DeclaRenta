/**
 * Modelo 721 section — foreign crypto assets declaration.
 *
 * Displays threshold indicator, crypto position table, filing guide,
 * and generates the fixed-width stub file.
 * Real AEAT format is XML (Orden HFP/886/2023) — stub only for now.
 */

import { t } from "../i18n/index.js";
import { getProfile, isProfileComplete } from "./profile.js";
import type { Statement } from "../types/broker.js";
import type { EcbRateMap } from "../types/ecb.js";
import { getEcbRate } from "../engine/ecb.js";
import Decimal from "decimal.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Return year-end date or today if the year hasn't ended yet */
function effectiveYearEnd(year: number): string {
  const today = new Date().toISOString().slice(0, 10);
  const yearEnd = `${year}-12-31`;
  return yearEnd <= today ? yearEnd : today;
}

/** Crypto asset categories recognized by DeclaRenta parsers */
const CRYPTO_CATEGORIES = new Set(["CRYPTO"]);

let cachedStatement: Statement | null = null;
let cachedRateMap: EcbRateMap | null = null;

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

/** Render 721 section with processed data */
export function renderSection721(statement: Statement, rateMap: EcbRateMap): void {
  cachedStatement = statement;
  cachedRateMap = rateMap;

  const container = document.getElementById("m721-content");
  if (!container) return;

  const profile = getProfile();
  const year = profile.year;
  const yearEnd = effectiveYearEnd(year);

  // Filter crypto positions
  const positions = statement.openPositions.filter(
    (p) => CRYPTO_CATEGORIES.has(p.assetCategory) && new Decimal(p.positionValue).greaterThan(0),
  );

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

  // Threshold check (50,000 EUR)
  const totalValue = positions.reduce((sum, p) => {
    const rate = getEcbRate(rateMap, yearEnd, p.currency);
    return sum.plus(new Decimal(p.positionValue).mul(rate));
  }, new Decimal(0));

  const exceeds = totalValue.greaterThanOrEqualTo(50000);
  const pct = Math.min(totalValue.div(50000).mul(100).toNumber(), 100);

  html += `<div class="threshold-bar">
    <div class="threshold-track">
      <div class="threshold-fill ${exceeds ? "over" : "under"}" style="width: ${pct}%"></div>
    </div>
    <div class="threshold-labels">
      <span>${t("m721.total_value", { amount: totalValue.toFixed(2) })}</span>
      <span>50.000 €</span>
    </div>
  </div>
  <p class="${exceeds ? "warning" : "muted"}">
    ${exceeds
      ? t("m721.threshold_exceeded", { amount: totalValue.toFixed(2) })
      : t("m721.threshold_not_exceeded", { amount: totalValue.toFixed(2) })}
  </p>`;

  // Positions table
  html += `<h3>${t("m721.positions_title")}</h3>
  <div class="table-wrapper"><table>
    <thead><tr>
      <th>${t("table.symbol")}</th><th>${t("m721.exchange")}</th>
      <th>${t("table.units")}</th><th>${t("table.amount_eur")}</th>
    </tr></thead>
    <tbody>${positions.map((p) => {
      const rate = getEcbRate(rateMap, yearEnd, p.currency);
      const val = new Decimal(p.positionValue).mul(rate).toFixed(2);
      const exchange = p.isin && p.isin.length >= 2 ? p.isin.slice(0, 2) : "—";
      return `<tr>
        <td class="mono">${esc(p.description || p.isin || p.symbol)}</td>
        <td>${esc(exchange)}</td>
        <td>${new Decimal(p.quantity).toString()}</td>
        <td>${val}</td>
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;

  // Exchange rates display
  const uniqueCurrencies = [...new Set(positions.map((p) => p.currency))].filter((c) => c !== "EUR").sort();
  if (uniqueCurrencies.length > 0) {
    html += `<div class="rates-display">
      <h4>${t("m721.rates_title")}</h4>
      <div class="rates-grid">${uniqueCurrencies.map((cur) => {
        const rate = getEcbRate(rateMap, yearEnd, cur);
        return `<span class="rate-item">${esc(cur)}: ${rate.toFixed(4)} &euro;</span>`;
      }).join("")}</div>
    </div>`;
  }

  // Generate button
  if (exceeds) {
    html += `<button id="m721-generate-btn">${t("m721.generate_btn")}</button>`;
  }

  // XML format notice
  html += `<div class="banner banner-info">${t("m721.format_notice")}</div>`;

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

  // Bind generate button
  document.getElementById("m721-generate-btn")?.addEventListener("click", () => {
    void generate721File();
  });
}

async function generate721File(): Promise<void> {
  if (!cachedStatement || !cachedRateMap) return;
  if (!isProfileComplete()) {
    const container = document.getElementById("m721-content");
    if (container && !container.querySelector(".profile-required")) {
      const banner = document.createElement("div");
      banner.className = "banner banner-warning profile-required";
      banner.innerHTML = `<span>${t("m721.profile_required")}</span> <a href="#perfil">${t("profile.go_to_profile")}</a>`;
      container.prepend(banner);
    }
    return;
  }

  const { generateModelo721 } = await import("../generators/modelo721.js");
  const profile = getProfile();
  const fullName = `${profile.apellidos} ${profile.nombre}`.trim();
  const yearEnd = effectiveYearEnd(profile.year);

  const positions = cachedStatement.openPositions.filter(
    (p) => CRYPTO_CATEGORIES.has(p.assetCategory) && new Decimal(p.positionValue).greaterThan(0),
  );

  const entries = positions.map((p) => {
    const rate = getEcbRate(cachedRateMap!, yearEnd, p.currency);
    const isinPrefix = p.isin && p.isin.length >= 2 ? p.isin.slice(0, 2) : "";
    return {
      assetId: p.isin || p.description || p.symbol,
      description: p.description,
      exchangeName: isinPrefix || "CRYPTO",
      countryCode: isinPrefix.toUpperCase() || "XX",
      quantity: new Decimal(p.quantity),
      valuationEur: new Decimal(p.positionValue).mul(rate),
      acquisitionCostEur: new Decimal(p.costBasisMoney || 0).mul(rate),
    };
  });

  const config = {
    nif: profile.nif,
    surname: profile.apellidos,
    name: profile.nombre,
    year: profile.year,
    phone: profile.telefono,
    contactName: fullName || "CONTRIBUYENTE",
    declarationId: "",
    isComplementary: false,
    isReplacement: false,
  };

  const result = generateModelo721(entries, config);
  if (!result) return;

  const blob = new Blob([result], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `modelo721_${profile.year}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Re-render if data was previously cached (for locale changes) */
export function rerenderSection721(): void {
  if (cachedStatement && cachedRateMap) {
    renderSection721(cachedStatement, cachedRateMap);
  } else {
    initSection721();
  }
}
