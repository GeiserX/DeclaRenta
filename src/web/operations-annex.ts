/**
 * Operations annex: detailed individual operations grouped by asset type.
 * Mirrors the Anexo C1 of Modelo 100.
 */

import Decimal from "decimal.js";
import { t, type TranslationKey } from "../i18n/index.js";
import type { TaxSummary, FifoDisposal } from "../types/tax.js";
import { fmtEur, fmtQty, formatDate } from "./format.js";
import { assetLabel } from "./asset-labels.js";
import { esc } from "./esc.js";
import { washSaleRowAttr, renderWashSaleDetailRow } from "./wash-sale-row.js";
import { symbolCell } from "./symbol-cell.js";
import { showBrokerColumns } from "../generators/broker-columns.js";
import { finiteDisposalAmounts } from "../generators/casillas.js";

const OPTION_SCENARIO_LABELS: Record<string, TranslationKey> = {
  expiration: "option.expiration",
  close: "option.close",
  exercise: "option.exercise",
};

function optionScenarioLabel(scenario: string): string {
  const key = OPTION_SCENARIO_LABELS[scenario];
  return key ? t(key) : scenario;
}

/** An amount cell: «—» for a non-finite amount, which the boxes leave out (never "NaN"). */
function amountCell(amount: Decimal): string {
  return amount.isFinite() ? fmtEur(amount) : "—";
}

export function renderOperationsAnnex(report: TaxSummary): string {
  const disposals = report.capitalGains.disposals;
  if (disposals.length === 0) return "";

  // Purchase and sale broker, only when the sales name more than one broker.
  // Decided once for the whole annex so every group has the same columns.
  const brokers = showBrokerColumns(disposals);
  const columnCount = brokers ? 11 : 9;
  const brokerHead = brokers
    ? `
              <th>${esc(t("table.buy_broker"))}</th>
              <th>${esc(t("table.sell_broker"))}</th>`
    : "";

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
    // The boxes' rule: a non-finite amount of one sale is left out alone, so
    // the subtotal never reads NaN and matches the casillas (#469 review).
    const amounts = ops.map(finiteDisposalAmounts);
    const subtotalProceeds = amounts.reduce((s, a) => s.plus(a.proceeds), new Decimal(0));
    const subtotalCost = amounts.reduce((s, a) => s.plus(a.cost), new Decimal(0));
    // Rounded to the shown cents, so a subtotal of -0,004 € is not classed as a loss.
    const subtotalGL = amounts.reduce((s, a) => s.plus(a.gainLoss), new Decimal(0)).toDecimalPlaces(2);
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
        <table class="annex-table${brokers ? " annex-table--brokers" : ""}">
          <thead>
            <tr>
              <th>#</th>
              <th>ISIN</th>
              <th>${t("table.symbol")}</th>
              <th>${t("table.buy_date")}</th>
              <th>${t("table.sell_date")}</th>${brokerHead}
              <th>${t("table.units")}</th>
              <th>${t("table.cost_eur")}</th>
              <th>${t("table.proceeds_eur")}</th>
              <th>${t("table.gain_loss_eur")}</th>
            </tr>
          </thead>
          <tbody>`;

    ops.forEach((d, i) => {
      // Each cell shows what the subtotal adds (`finiteDisposalAmounts`), so
      // the column sums to it. A finite cost next to non-finite proceeds is
      // shown but not added (no phantom loss): it carries the mark. With only
      // the cost not finite, the result added is the proceeds: shown as such.
      const counted = amounts[i]!;
      const costCell = d.costBasisEur.isFinite() && !d.proceedsEur.isFinite()
        ? `${fmtEur(d.costBasisEur)} <span class="muted">(${esc(t("annex.not_counted"))})</span>`
        : amountCell(d.costBasisEur);
      const result = counted.excluded && d.proceedsEur.isFinite() ? counted.gainLoss : d.gainLossEur;
      const cls = result.greaterThanOrEqualTo(0) ? "gain" : "loss";
      const blocked = washSaleRowAttr(d);
      const optionInfo = d.optionScenario
        ? ` <span class="option-badge">${esc(optionScenarioLabel(d.optionScenario))}${d.putCall ? ` ${d.putCall === "C" ? "Call" : "Put"}` : ""}${d.strike ? ` @${esc(d.strike)}` : ""}</span>`
        : "";
      const brokerCells = brokers
        ? `
              <td class="annex-broker">${esc(d.acquireBrokerSource ?? "—")}</td>
              <td class="annex-broker">${esc(d.brokerSource ?? "—")}</td>`
        : "";
      html += `
            <tr${blocked}>
              <td>${i + 1}</td>
              <td class="mono">${esc(d.isin)}</td>
              <td>${symbolCell(d.symbol)}${optionInfo}</td>
              <td>${esc(formatDate(d.acquireDate))}</td>
              <td>${esc(formatDate(d.sellDate))}</td>${brokerCells}
              <td>${fmtQty(d.quantity)}</td>
              <td class="num">${costCell}</td>
              <td class="num">${amountCell(d.proceedsEur)}</td>
              <td class="num ${cls}">${result.isFinite() && result.greaterThanOrEqualTo(0) ? "+" : ""}${amountCell(result)}</td>
            </tr>${renderWashSaleDetailRow(d, columnCount)}`;
    });

    html += `
          </tbody>
          <tfoot>
            <tr class="annex-subtotal">
              <td colspan="${columnCount - 3}">${esc(label)}</td>
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
