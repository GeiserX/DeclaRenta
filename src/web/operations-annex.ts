/**
 * Operations annex: detailed individual operations grouped by asset type.
 * Mirrors the Anexo C1 of Modelo 100.
 */

import Decimal from "decimal.js";
import { t } from "../i18n/index.js";
import type { TaxSummary, FifoDisposal } from "../types/tax.js";

const ASSET_LABELS: Record<string, string> = {
  STK: "Acciones cotizadas",
  FUND: "Fondos / ETFs",
  OPT: "Opciones",
  CRYPTO: "Criptomonedas",
  BOND: "Bonos",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(d: string): string {
  // YYYYMMDD or YYYY-MM-DD -> DD/MM/YYYY
  const clean = d.replace(/-/g, "").slice(0, 8);
  if (clean.length !== 8) return d;
  return `${clean.slice(6, 8)}/${clean.slice(4, 6)}/${clean.slice(0, 4)}`;
}

function fmtNum(d: Decimal): string {
  return d.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
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
    <h3 class="annex-title">${t("annex.title")}</h3>
    <p class="annex-subtitle">${t("annex.subtitle")}</p>`;

  for (const [cat, ops] of groups) {
    const label = ASSET_LABELS[cat] ?? cat;
    const subtotalProceeds = ops.reduce((s, d) => s.plus(d.proceedsEur), new Decimal(0));
    const subtotalCost = ops.reduce((s, d) => s.plus(d.costBasisEur), new Decimal(0));
    const subtotalGL = ops.reduce((s, d) => s.plus(d.gainLossEur), new Decimal(0));
    const glClass = subtotalGL.greaterThanOrEqualTo(0) ? "gain" : "loss";

    html += `
    <details class="annex-group" open>
      <summary class="annex-group-header">
        <span class="annex-group-name">${esc(label)}</span>
        <span class="annex-group-count">${ops.length} ${t("annex.operations")}</span>
        <span class="annex-group-total ${glClass}">${subtotalGL.greaterThanOrEqualTo(0) ? "+" : ""}${fmtNum(subtotalGL)} EUR</span>
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
      html += `
            <tr${blocked}>
              <td>${i + 1}</td>
              <td class="mono">${esc(d.isin)}</td>
              <td>${esc(d.symbol)}</td>
              <td>${fmtDate(d.acquireDate)}</td>
              <td>${fmtDate(d.sellDate)}</td>
              <td>${d.quantity.toFixed(d.quantity.mod(1).isZero() ? 0 : 4)}</td>
              <td class="num">${fmtNum(d.costBasisEur)}</td>
              <td class="num">${fmtNum(d.proceedsEur)}</td>
              <td class="num ${cls}">${d.gainLossEur.greaterThanOrEqualTo(0) ? "+" : ""}${fmtNum(d.gainLossEur)}</td>
            </tr>`;
    });

    html += `
          </tbody>
          <tfoot>
            <tr class="annex-subtotal">
              <td colspan="6">${esc(label)}</td>
              <td class="num">${fmtNum(subtotalCost)}</td>
              <td class="num">${fmtNum(subtotalProceeds)}</td>
              <td class="num ${glClass}">${subtotalGL.greaterThanOrEqualTo(0) ? "+" : ""}${fmtNum(subtotalGL)} EUR</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </details>`;
  }

  html += `</div>`;
  return html;
}
