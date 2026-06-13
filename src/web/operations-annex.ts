/**
 * Operations annex: detailed individual operations grouped by asset type.
 * Mirrors the Anexo C1 of Modelo 100.
 */

import Decimal from "decimal.js";
import { t } from "../i18n/index.js";
import type { TaxSummary, FifoDisposal } from "../types/tax.js";
import { fmtEur } from "./format.js";
import { assetLabel } from "./asset-labels.js";
import { esc } from "./esc.js";

// TODO(i18n): needs keys "option.expiration" / "option.close" / "option.exercise"
// in all 5 locales — kept as Spanish literals for now so the 4 non-Spanish
// locales don't crash on a missing key.
const OPTION_SCENARIO_LABELS: Record<string, string> = {
  expiration: "Expiración",
  close: "Cierre anticipado",
  exercise: "Ejercicio/Asignación",
};

function fmtDate(d: string): string {
  // YYYYMMDD or YYYY-MM-DD -> DD/MM/YYYY
  const clean = d.replace(/-/g, "").slice(0, 8);
  if (clean.length !== 8) return d;
  return `${clean.slice(6, 8)}/${clean.slice(4, 6)}/${clean.slice(0, 4)}`;
}


export function renderOperationsAnnex(report: TaxSummary): string {
  const disposals = report.capitalGains.disposals;
  if (disposals.length === 0) return "";

  // Group by asset category
  const groups = new Map<string, FifoDisposal[]>();
  for (const d of disposals) {
    const cat = d.assetCategory || "OTHER";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(d);
  }

  let html = `<div class="annex-container">
    <h3 class="annex-title">${esc(t("annex.title"))}</h3>
    <p class="annex-subtitle">${esc(t("annex.subtitle"))}</p>`;

  for (const [cat, ops] of groups) {
    const label = assetLabel(cat);
    const subtotalProceeds = ops.reduce((s, d) => s.plus(d.proceedsEur), new Decimal(0));
    const subtotalCost = ops.reduce((s, d) => s.plus(d.costBasisEur), new Decimal(0));
    const subtotalGL = ops.reduce((s, d) => s.plus(d.gainLossEur), new Decimal(0));
    const glClass = subtotalGL.greaterThanOrEqualTo(0) ? "gain" : "loss";

    // Collapsed by default: the per-operation tables can be hundreds of rows
    // long, which drowns the Modelo 100 results. The summary (asset type, count,
    // subtotal) stays visible; the user expands a group to see its operations.
    html += `
    <details class="annex-group">
      <summary class="annex-group-header">
        <span class="annex-group-name">${esc(label)}</span>
        <span class="annex-group-count">${ops.length} ${t("annex.operations")}</span>
        <span class="annex-group-total ${glClass}">${subtotalGL.greaterThanOrEqualTo(0) ? "+" : ""}${fmtEur(subtotalGL)} EUR</span>
      </summary>
      <div class="annex-table-wrap">
        <table class="annex-table">
          <thead>
            <tr>
              <th>#</th>
              <th>ISIN</th>
              <th>${t("table.symbol")}</th>
              <th>${t("table.buy_date")}</th>
              <th>${t("table.sell_date")}</th>
              <th>${t("table.units")}</th>
              <th>${t("table.cost_eur")}</th>
              <th>${t("table.proceeds_eur")}</th>
              <th>${t("table.gain_loss_eur")}</th>
            </tr>
          </thead>
          <tbody>`;

    ops.forEach((d, i) => {
      const cls = d.gainLossEur.greaterThanOrEqualTo(0) ? "gain" : "loss";
      const blocked = d.washSaleBlocked ? ' class="wash-sale-blocked"' : "";
      const optionInfo = d.optionScenario
        ? ` <span class="option-badge">${esc(OPTION_SCENARIO_LABELS[d.optionScenario] ?? d.optionScenario)}${d.putCall ? ` ${d.putCall === "C" ? "Call" : "Put"}` : ""}${d.strike ? ` @${esc(d.strike)}` : ""}</span>`
        : "";
      html += `
            <tr${blocked}>
              <td>${i + 1}</td>
              <td class="mono">${esc(d.isin)}</td>
              <td>${esc(d.symbol)}${optionInfo}</td>
              <td>${fmtDate(d.acquireDate)}</td>
              <td>${fmtDate(d.sellDate)}</td>
              <td>${d.quantity.toFixed(d.quantity.mod(1).isZero() ? 0 : 4)}</td>
              <td class="num">${fmtEur(d.costBasisEur)}</td>
              <td class="num">${fmtEur(d.proceedsEur)}</td>
              <td class="num ${cls}">${d.gainLossEur.greaterThanOrEqualTo(0) ? "+" : ""}${fmtEur(d.gainLossEur)}</td>
            </tr>`;
    });

    html += `
          </tbody>
          <tfoot>
            <tr class="annex-subtotal">
              <td colspan="6">${esc(label)}</td>
              <td class="num">${fmtEur(subtotalCost)}</td>
              <td class="num">${fmtEur(subtotalProceeds)}</td>
              <td class="num ${glClass}">${subtotalGL.greaterThanOrEqualTo(0) ? "+" : ""}${fmtEur(subtotalGL)} EUR</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </details>`;
  }

  html += `</div>`;
  return html;
}
