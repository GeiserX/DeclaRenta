/**
 * Guía de cumplimentación — step-by-step Renta Web filing guide.
 *
 * Static informational section that explains how to fill each casilla
 * in Renta Web. Does not depend on report data (always visible).
 */

import { t } from "../i18n/index.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function initSectionGuide(): void {
  renderGuideContent();
}

export function rerenderSectionGuide(): void {
  renderGuideContent();
}

function renderGuideContent(): void {
  const container = document.getElementById("guide-content");
  if (!container) return;

  let html = "";

  // Intro
  html += `<div class="guide-intro">
    <p>${t("guide_rw.intro")}</p>
  </div>`;

  // Capital gains section (0327/0328)
  html += renderGuideSection(
    t("guide_rw.capital_gains_title"),
    "0327 / 0328",
    [
      { label: t("guide_rw.entidad_emisora_label"), value: t("guide_rw.entidad_emisora_value") },
      { label: t("guide_rw.tipo_elemento_label"), value: t("guide_rw.tipo_elemento_value_capital") },
      { label: t("guide_rw.gastos_transmision_label"), value: t("guide_rw.gastos_zero") },
      { label: t("guide_rw.gastos_adquisicion_label"), value: t("guide_rw.gastos_zero") },
      { label: t("guide_rw.valor_transmision_label"), value: t("guide_rw.valor_transmision_hint") },
      { label: t("guide_rw.valor_adquisicion_label"), value: t("guide_rw.valor_adquisicion_hint") },
      { label: t("guide_rw.fecha_transmision_label"), value: t("guide_rw.fecha_hint_individual") },
      { label: t("guide_rw.fecha_adquisicion_label"), value: t("guide_rw.fecha_hint_individual") },
    ],
    t("guide_rw.capital_gains_note"),
  );

  // FX section (1633/1637)
  html += renderGuideSection(
    t("guide_rw.fx_title"),
    "1633 / 1637",
    [
      { label: t("guide_rw.tipo_elemento_label"), value: t("guide_rw.tipo_elemento_value_fx") },
      { label: t("guide_rw.entidad_emisora_label"), value: t("guide_rw.entidad_emisora_value") },
      { label: t("guide_rw.gastos_transmision_label"), value: t("guide_rw.gastos_zero") },
      { label: t("guide_rw.gastos_adquisicion_label"), value: t("guide_rw.gastos_zero") },
      { label: t("guide_rw.valor_transmision_label"), value: t("guide_rw.fx_valor_transmision_hint") },
      { label: t("guide_rw.valor_adquisicion_label"), value: t("guide_rw.fx_valor_adquisicion_hint") },
      { label: t("guide_rw.fecha_transmision_label"), value: t("guide_rw.fx_fecha_hint") },
      { label: t("guide_rw.fecha_adquisicion_label"), value: t("guide_rw.fx_fecha_hint") },
    ],
    t("guide_rw.fx_note"),
  );

  // Dividends section (0029)
  html += renderGuideSection(
    t("guide_rw.dividends_title"),
    "0029",
    [
      { label: t("guide_rw.retenciones_label"), value: t("guide_rw.retenciones_zero") },
      { label: t("guide_rw.gastos_label"), value: t("guide_rw.gastos_zero") },
      { label: t("guide_rw.importe_label"), value: t("guide_rw.dividends_importe_hint") },
    ],
    t("guide_rw.dividends_note"),
  );

  // Interest section (0033)
  html += renderGuideSection(
    t("guide_rw.interest_title"),
    "0033",
    [
      { label: t("guide_rw.retenciones_label"), value: t("guide_rw.retenciones_zero") },
      { label: t("guide_rw.gastos_label"), value: t("guide_rw.gastos_zero") },
      { label: t("guide_rw.importe_label"), value: t("guide_rw.interest_importe_hint") },
    ],
    t("guide_rw.interest_note"),
  );

  // Double taxation (0588)
  html += renderGuideSection(
    t("guide_rw.double_taxation_title"),
    "0588",
    [
      { label: t("guide_rw.dt_pais_label"), value: t("guide_rw.dt_pais_hint") },
      { label: t("guide_rw.dt_importe_label"), value: t("guide_rw.dt_importe_hint") },
    ],
    t("guide_rw.double_taxation_note"),
  );

  // Anti-churning losses reminder
  html += `<div class="guide-section guide-section-warning">
    <h4>${esc(t("guide_rw.blocked_losses_title"))}</h4>
    <p>${t("guide_rw.blocked_losses_hint")}</p>
  </div>`;

  // Closing tip
  html += `<div class="guide-tip">
    <p>${t("guide_rw.closing_tip")}</p>
  </div>`;

  container.innerHTML = html;
}

interface GuideField {
  label: string;
  value: string;
}

function renderGuideSection(title: string, casillas: string, fields: GuideField[], note: string): string {
  let html = `<div class="guide-section">
    <h4><span class="guide-casilla-badge">${esc(casillas)}</span> ${esc(title)}</h4>
    <div class="guide-fields">`;

  for (const field of fields) {
    html += `<div class="guide-field">
      <span class="guide-field-label">${esc(field.label)}</span>
      <span class="guide-field-value">${field.value}</span>
    </div>`;
  }

  html += `</div>`;
  if (note) {
    html += `<p class="guide-note">${note}</p>`;
  }
  html += `</div>`;
  return html;
}
