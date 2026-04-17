/**
 * Modelo 720 section — foreign assets declaration.
 *
 * Displays threshold indicator, position table, filing guide,
 * and generates the fixed-width file for AEAT submission.
 */

import { t } from "../i18n/index.js";
import { getProfile, isProfileComplete } from "./profile.js";
import { getEcbRate, getQ4AverageRate } from "../engine/ecb.js";
import { checkModelo720Thresholds } from "../generators/modelo720.js";
import type { Statement } from "../types/broker.js";
import type { EcbRateMap } from "../types/ecb.js";
import Decimal from "decimal.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let cachedStatement: Statement | null = null;
let cachedRateMap: EcbRateMap | null = null;

/** Initialize 720 section with empty state */
export function initSection720(): void {
  const container = document.getElementById("m720-content");
  if (!container) return;
  container.innerHTML = `<p class="muted">${t("m720.no_positions")}</p>`;
}

/** Render 720 section with processed data */
export function renderSection720(statement: Statement, rateMap: EcbRateMap): void {
  cachedStatement = statement;
  cachedRateMap = rateMap;

  const container = document.getElementById("m720-content");
  if (!container) return;

  const profile = getProfile();
  const year = profile.year;

  if (statement.openPositions.length === 0) {
    container.innerHTML = `<p class="muted">${t("m720.no_positions")}</p>`;
    return;
  }

  let html = "";

  // Year + deadline header
  html += `<div class="section-header-bar">
    <span class="section-year">Ejercicio ${year}</span>
    <span class="section-deadline">${t("m720.deadline_short")}</span>
  </div>`;

  // Profile warning
  if (!isProfileComplete()) {
    html += `<div class="banner banner-warning">
      <span>${t("profile.incomplete_banner")}</span>
      <a href="#perfil">${t("profile.go_to_profile")}</a>
    </div>`;
  }

  // Threshold check
  const thresholds = checkModelo720Thresholds(statement.openPositions, rateMap, year);
  const totalValue = thresholds.values.total;
  const exceeds = thresholds.values.exceeds;
  const pct = Math.min(totalValue.div(50000).mul(100).toNumber(), 100);

  html += `<div class="threshold-bar">
    <div class="threshold-track">
      <div class="threshold-fill ${exceeds ? "over" : "under"}" style="width: ${pct}%"></div>
    </div>
    <div class="threshold-labels">
      <span>${t("m720.total_value", { amount: totalValue.toFixed(2) })}</span>
      <span>50.000 €</span>
    </div>
  </div>
  <p class="${exceeds ? "warning" : "muted"}">
    ${exceeds
      ? t("m720.threshold_exceeded", { amount: totalValue.toFixed(2) })
      : t("m720.threshold_not_exceeded", { amount: totalValue.toFixed(2) })}
  </p>`;

  // Positions table
  const positions = statement.openPositions.filter(
    (p) => p.assetCategory === "STK" || p.assetCategory === "FUND" || p.assetCategory === "BOND",
  );

  if (positions.length > 0) {
    html += `<h3>${t("m720.positions_title")}</h3>
    <div class="table-wrapper"><table>
      <thead><tr>
        <th>ISIN</th><th>${t("table.symbol")}</th><th>${t("table.country")}</th><th>${t("table.amount_eur")}</th>
      </tr></thead>
      <tbody>${positions.map((p) => {
        let rate: Decimal;
        try {
          rate = p.assetCategory === "STK"
            ? getQ4AverageRate(rateMap, year, p.currency)
            : getEcbRate(rateMap, `${year}-12-31`, p.currency);
        } catch {
          rate = getEcbRate(rateMap, `${year}-12-31`, p.currency);
        }
        const val = new Decimal(p.positionValue).mul(rate).toFixed(2);
        return `<tr><td class="mono">${esc(p.isin)}</td><td>${esc(p.description)}</td><td>${esc(p.isin.slice(0, 2))}</td><td>${val}</td></tr>`;
      }).join("")}</tbody>
    </table></div>`;

    // Exchange rates display
    const uniqueCurrencies = [...new Set(positions.map((p) => p.currency))].filter((c) => c !== "EUR").sort();
    if (uniqueCurrencies.length > 0) {
      html += `<div class="rates-display">
        <h4>${t("m720.rates_title")}</h4>
        <div class="rates-grid">${uniqueCurrencies.map((cur) => {
          const rate = getEcbRate(rateMap, `${year}-12-31`, cur);
          return `<span class="rate-item">${esc(cur)}: ${rate.toFixed(4)} &euro;</span>`;
        }).join("")}</div>
      </div>`;
    }
  }

  // Generate button
  if (exceeds || positions.length > 0) {
    html += `<button id="m720-generate-btn">${t("m720.generate_btn")}</button>`;
  }

  // Filing guide
  html += `<div class="filing-guide">
    <h3>${t("m720.filing_title")}</h3>
    <ol>
      <li>Accede a la <a href="https://sede.agenciatributaria.gob.es" target="_blank" rel="noopener"><strong>Sede Electrónica de la AEAT</strong></a></li>
      <li>Busca <strong>«Modelo 720»</strong></li>
      <li>Importa el fichero generado (<strong>TGVI Online</strong>)</li>
      <li>Revisa y firma con certificado digital o Cl@ve</li>
    </ol>
  </div>`;

  // Deadline
  html += `<div class="deadline-reminder">${t("m720.deadline")}</div>`;

  container.innerHTML = html;

  // Bind generate button
  document.getElementById("m720-generate-btn")?.addEventListener("click", () => {
    void generate720File();
  });
}

async function generate720File(): Promise<void> {
  if (!cachedStatement || !cachedRateMap) return;

  const { generateModelo720 } = await import("../generators/modelo720.js");
  const profile = getProfile();
  const fullName = `${profile.apellidos} ${profile.nombre}`.trim();

  const config = {
    nif: profile.nif || "00000000T",
    surname: profile.apellidos,
    name: profile.nombre || "CONTRIBUYENTE",
    year: profile.year,
    phone: profile.telefono,
    contactName: fullName || "CONTRIBUYENTE",
    declarationId: "",
    isComplementary: false,
    isReplacement: false,
  };

  const result = generateModelo720(cachedStatement.openPositions, cachedRateMap, config);
  if (!result) return; // Below threshold

  const blob = new Blob([result], { type: "text/plain;charset=iso-8859-15" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `modelo720_${profile.year}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
