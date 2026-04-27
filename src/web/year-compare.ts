/**
 * Year-over-year comparison view for DeclaRenta.
 *
 * Shows stored reports side-by-side with variation indicators.
 * Reports are persisted via the storage module.
 */

import type { TaxSummary } from "../types/tax.js";
import { t } from "../i18n/index.js";
import { saveReport, loadAllReports, clearAllReports, type StoredReport } from "./storage.js";

/** Escape HTML special characters to prevent XSS in rendered strings. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Convert a TaxSummary into a StoredReport and save to localStorage.
 */
export function persistReport(report: TaxSummary, brokers: string[]): void {
  // Don't persist empty reports (e.g. wrong year selected with no matching data)
  if (report.capitalGains.disposals.length === 0 && report.dividends.entries.length === 0) return;

  const currencies = new Set<string>();
  for (const d of report.capitalGains.disposals) currencies.add(d.currency);
  for (const d of report.dividends.entries) currencies.add(d.currency);

  const stored: StoredReport = {
    year: report.year,
    processedAt: new Date().toISOString(),
    brokers,
    tradesCount: report.capitalGains.disposals.length,
    casillas: {
      transmissionValue: report.capitalGains.transmissionValue.toNumber(),
      acquisitionValue: report.capitalGains.acquisitionValue.toNumber(),
      netGainLoss: report.capitalGains.netGainLoss.toNumber(),
      blockedLosses: report.capitalGains.blockedLosses.toNumber(),
      fxNetGainLoss: report.fxGains.netGainLoss.toNumber(),
      grossDividends: report.dividends.grossIncome.toNumber(),
      interestEarned: report.interest.earned.toNumber(),
      interestPaid: report.interest.paid.toNumber(),
      doubleTaxation: report.doubleTaxation.deduction.toNumber(),
    },
    stats: {
      disposalsCount: report.capitalGains.disposals.length,
      fxDisposalsCount: report.fxGains.disposals.length,
      dividendsCount: report.dividends.entries.length,
      warningsCount: report.warnings.length,
      currencies: [...currencies],
    },
  };
  saveReport(stored);
}

/**
 * Format a variation between two numbers as a percentage string.
 */
/** Format the percentage variation between two values (e.g. "+12.3%"). */
function formatVariation(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "—" : "+∞";
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/** Return CSS class ("gain" or "loss") based on value direction. */
function variationClass(current: number, previous: number): string {
  if (current > previous) return "gain";
  if (current < previous) return "loss";
  return "";
}

// ---------------------------------------------------------------------------
// Comparison table renderer
// ---------------------------------------------------------------------------

interface ComparisonRow {
  label: string;
  key: keyof StoredReport["casillas"];
}

const COMPARISON_ROWS: ComparisonRow[] = [
  { label: "casilla.transmission_value", key: "transmissionValue" },
  { label: "casilla.acquisition_value", key: "acquisitionValue" },
  { label: "casilla.net_gain_loss", key: "netGainLoss" },
  { label: "casilla.fx_net_gain_loss", key: "fxNetGainLoss" },
  { label: "casilla.gross_dividends", key: "grossDividends" },
  { label: "casilla.interest_earned", key: "interestEarned" },
  { label: "casilla.interest_paid", key: "interestPaid" },
  { label: "casilla.double_taxation", key: "doubleTaxation" },
];

/**
 * Render the year comparison view into a container.
 * Shows nothing if fewer than 2 reports are stored.
 */
export function renderYearComparison(container: HTMLElement): void {
  const reports = loadAllReports();

  if (reports.length < 2) {
    container.innerHTML = `<p class="muted">${t("compare.no_data")}</p>`;
    return;
  }

  // Sort by year descending (most recent first)
  const sorted = [...reports].sort((a, b) => b.year - a.year);

  // Header row
  const headerCells = sorted.map((r) => `<th>${r.year}</th>`).join("");
  const variationHeaders = sorted.length >= 2
    ? sorted.slice(0, -1).map((r, i) => `<th>${r.year} vs ${sorted[i + 1]!.year}</th>`).join("")
    : "";

  // Data rows
  const rows = COMPARISON_ROWS.map((row) => {
    const values = sorted.map((r) => r.casillas[row.key] ?? 0);
    const valueCells = values.map((v) => `<td>${v.toFixed(2)}</td>`).join("");

    const varCells = values.length >= 2
      ? values.slice(0, -1).map((v, i) => {
          const prev = values[i + 1]!;
          return `<td class="${variationClass(v, prev)}">${formatVariation(v, prev)}</td>`;
        }).join("")
      : "";

    return `<tr>
      <td class="row-label">${t(row.label as Parameters<typeof t>[0])}</td>
      ${valueCells}${varCells}
    </tr>`;
  }).join("");

  // Stats rows
  const statsRow = (label: string, getter: (r: StoredReport) => string) => {
    const cells = sorted.map((r) => `<td>${esc(getter(r))}</td>`).join("");
    const emptyVars = sorted.length >= 2
      ? sorted.slice(0, -1).map(() => "<td>—</td>").join("")
      : "";
    return `<tr><td class="row-label">${label}</td>${cells}${emptyVars}</tr>`;
  };

  const statsRows = [
    statsRow(t("review.trades_count"), (r) => String(r.stats.disposalsCount)),
    statsRow(t("review.dividends_count"), (r) => String(r.stats.dividendsCount)),
    statsRow(t("review.broker"), (r) => r.brokers.join(", ")),
  ].join("");

  container.innerHTML = `
    <div class="year-compare">
      <div class="compare-header">
        <h3>${t("compare.title")}</h3>
        <button id="clear-history-btn" class="btn-small btn-danger">${t("compare.clear_history")}</button>
      </div>
      <div class="table-wrapper">
        <table class="compare-table">
          <thead>
            <tr>
              <th></th>
              ${headerCells}
              ${variationHeaders}
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr class="stats-divider"><td colspan="${1 + sorted.length * 2}"></td></tr>
            ${statsRows}
          </tbody>
        </table>
      </div>
      <p class="compare-meta">${t("compare.saved_reports")}: ${sorted.map((r) => r.year).join(", ")}</p>
    </div>`;

  // Clear history button
  container.querySelector("#clear-history-btn")?.addEventListener("click", () => {
    if (confirm(t("compare.clear_confirm"))) {
      clearAllReports();
      renderYearComparison(container);
    }
  });
}
