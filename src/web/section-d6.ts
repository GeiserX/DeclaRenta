/**
 * Modelo D-6 section — foreign investments declaration.
 *
 * Displays position table, AFORIX interactive guide with
 * copy-to-clipboard, and generates the D-6 report file.
 */

import { t } from "../i18n/index.js";
import { getProfile, isProfileComplete } from "./profile.js";
import { getEcbRate } from "../engine/ecb.js";
import type { Statement } from "../types/broker.js";
import type { OpenPosition } from "../types/ibkr.js";
import type { EcbRateMap } from "../types/ecb.js";
import Decimal from "decimal.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let cachedStatement: Statement | null = null;
let cachedRateMap: EcbRateMap | null = null;

/** Initialize D-6 section with empty state */
export function initSectionD6(): void {
  const container = document.getElementById("d6-content");
  if (!container) return;
  container.innerHTML = `<p class="muted">${t("d6.no_positions")}</p>`;
}

/** Render D-6 section with processed data */
export function renderSectionD6(statement: Statement, rateMap: EcbRateMap): void {
  cachedStatement = statement;
  cachedRateMap = rateMap;

  const container = document.getElementById("d6-content");
  if (!container) return;

  const profile = getProfile();
  const year = profile.year;
  const yearEnd = `${year}-12-31`;

  const positions = statement.openPositions.filter(
    (p) =>
      (p.assetCategory === "STK" || p.assetCategory === "FUND" || p.assetCategory === "BOND") &&
      p.isin.length >= 2 &&
      p.isin.slice(0, 2).toUpperCase() !== "ES" &&
      new Decimal(p.quantity).greaterThan(0),
  );

  if (positions.length === 0) {
    container.innerHTML = `<p class="muted">${t("d6.no_positions")}</p>`;
    return;
  }

  let html = "";

  // Year + deadline header
  html += `<div class="section-header-bar">
    <span class="section-year">${t("section.year_label")} ${year}</span>
    <span class="section-deadline">${t("d6.deadline_short")}</span>
  </div>`;

  // Profile warning
  if (!isProfileComplete()) {
    html += `<div class="banner banner-warning">
      <span>${t("profile.incomplete_banner")}</span>
      <a href="#perfil">${t("profile.go_to_profile")}</a>
    </div>`;
  }

  // No minimum threshold reminder
  html += `<div class="banner banner-info">${t("d6.no_minimum")}</div>`;

  // Total value
  const totalValue = positions.reduce((sum, p) => {
    const rate = getEcbRate(rateMap, yearEnd, p.currency);
    return sum.plus(new Decimal(p.positionValue).mul(rate));
  }, new Decimal(0));
  html += `<p><strong>${t("d6.total_value", { amount: totalValue.toFixed(2) })}</strong></p>`;

  // Positions table
  html += `<h3>${t("d6.positions_title")}</h3>
  <div class="table-wrapper"><table>
    <thead><tr>
      <th>ISIN</th><th>${t("table.symbol")}</th><th>${t("table.country")}</th>
      <th>${t("table.units")}</th><th>${t("table.amount_eur")}</th>
    </tr></thead>
    <tbody>${positions
      .map((p) => {
        const rate = getEcbRate(rateMap, yearEnd, p.currency);
        const val = new Decimal(p.positionValue).mul(rate).toFixed(2);
        return `<tr>
        <td class="mono">${esc(p.isin)}</td><td>${esc(p.description)}</td>
        <td>${esc(p.isin.slice(0, 2))}</td><td>${new Decimal(p.quantity).toString()}</td><td>${val}</td>
      </tr>`;
      })
      .join("")}</tbody>
  </table></div>`;

  // Exchange rates display
  const uniqueCurrencies = [...new Set(positions.map((p) => p.currency))].filter((c) => c !== "EUR").sort();
  if (uniqueCurrencies.length > 0) {
    html += `<div class="rates-display">
      <h4>${t("d6.rates_title")}</h4>
      <div class="rates-grid">${uniqueCurrencies.map((cur) => {
        const rate = getEcbRate(rateMap, yearEnd, cur);
        return `<span class="rate-item">${esc(cur)}: ${rate.toFixed(4)} &euro;</span>`;
      }).join("")}</div>
    </div>`;
  }

  // Generate button
  html += `<button id="d6-generate-btn">${t("d6.generate_btn")}</button>`;

  // AFORIX guide
  html += renderAforixGuide(positions, rateMap, year, profile);

  // Deadline
  html += `<div class="deadline-reminder">${t("d6.deadline")}</div>`;

  container.innerHTML = html;

  // Bind generate
  document.getElementById("d6-generate-btn")?.addEventListener("click", () => {
    void generateD6File();
  });

  // Bind copy buttons
  container.querySelectorAll<HTMLButtonElement>(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.value ?? "";
      void navigator.clipboard.writeText(value).then(() => {
        btn.textContent = t("d6.copied");
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = t("d6.copy_btn");
          btn.classList.remove("copied");
        }, 1500);
      }).catch(() => {
        btn.textContent = t("d6.copy_failed");
        btn.classList.add("error");
        setTimeout(() => {
          btn.textContent = t("d6.copy_btn");
          btn.classList.remove("error");
        }, 1500);
      });
    });
  });
}

function renderAforixGuide(
  positions: OpenPosition[],
  rateMap: EcbRateMap,
  year: number,
  profile: { nif: string; nombre: string; apellidos: string },
): string {
  const yearEnd = `${year}-12-31`;
  let html = `<div class="filing-guide"><h3>${t("d6.aforix_title")}</h3>`;

  // Declarant info
  html += `<div style="margin-bottom:1rem">`;
  html += aforixField("NIF", profile.nif || "—");
  html += aforixField("Nombre", `${profile.apellidos} ${profile.nombre}`.trim() || "—");
  html += aforixField("Ejercicio", String(year));
  html += `</div>`;

  // Position fields
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!;
    const rate = getEcbRate(rateMap, yearEnd, p.currency);
    const val = new Decimal(p.positionValue).mul(rate).toFixed(2);
    html += `<p style="margin-top:1rem;font-weight:600">${t("d6.aforix_position_of", { index: String(i + 1), total: String(positions.length) })}</p>`;
    html += aforixField("ISIN", p.isin);
    html += aforixField("Denominación", p.description);
    html += aforixField("País emisor", p.isin.slice(0, 2).toUpperCase());
    html += aforixField("Nº títulos", new Decimal(p.quantity).toString());
    html += aforixField("Valor EUR", val);
    html += aforixField("Divisa", p.currency);
  }

  html += `</div>`;
  return html;
}

function aforixField(label: string, value: string): string {
  return `<div class="aforix-field">
    <span class="aforix-field-label">${label}</span>
    <span class="aforix-field-value">${esc(value)}</span>
    <button class="copy-btn" data-value="${esc(value)}">${t("d6.copy_btn")}</button>
  </div>`;
}

async function generateD6File(): Promise<void> {
  if (!cachedStatement || !cachedRateMap) return;
  if (!isProfileComplete()) return;

  const { generateD6Report } = await import("../generators/d6.js");
  const profile = getProfile();
  const fullName = `${profile.apellidos} ${profile.nombre}`.trim();

  const report = generateD6Report(
    cachedStatement.openPositions,
    cachedRateMap,
    profile.year,
    fullName || "CONTRIBUYENTE",
    profile.nif || "00000000T",
  );

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `d6_guia_${profile.year}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
