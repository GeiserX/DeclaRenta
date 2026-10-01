/**
 * Year-over-year comparison view for DeclaRenta.
 *
 * Shows stored reports side-by-side with variation indicators.
 * Reports are persisted via the storage module.
 */

import type { TaxSummary } from "../types/tax.js";
import { t } from "../i18n/index.js";
import { saveReport, loadAllReports, clearAllReports, type StoredReport } from "./storage.js";
import { fmtEur } from "./format.js";
import { esc } from "./esc.js";

/**
 * Convert a TaxSummary into a StoredReport and save to localStorage.
 */
export function persistReport(report: TaxSummary, brokers: string[]): void {
  // Don't persist empty reports (e.g. wrong year selected with no matching data).
  // A year with only interest, FX or base-general rewards is not empty, and must
  // replace any earlier snapshot of that year.
  const isEmpty =
    report.capitalGains.disposals.length === 0 &&
    report.dividends.entries.length === 0 &&
    report.interest.earned.isZero() &&
    report.interest.paid.isZero() &&
    report.fxGains.disposals.length === 0 &&
    report.generalGains.entries.length === 0;
  if (isEmpty) return;

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
      generalGains: report.generalGains.total.toNumber(),
      doubleTaxation: report.doubleTaxation.deduction.toNumber(),
    },
    stats: {
      disposalsCount: report.capitalGains.disposals.length,
      fxDisposalsCount: report.fxGains.disposals.length,
      dividendsCount: report.dividends.entries.length,
      warningsCount: report.messages.filter((m) => m.severity !== "info").length,
      currencies: [...currencies],
    },
  };
  saveReport(stored);
}

/**
 * Format a variation between two numbers as a percentage string.
 */
/** Format the percentage variation between two values (e.g. "+12,3%"). */
function formatVariation(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "—" : "+∞";
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${fmtEur(pct, 1)}%`;
}

/**
 * Return CSS class ("gain" or "loss") for a change, from the row's point of view:
 * a rise is a "loss" where more is worse, and no class where neither is better.
 */
function variationClass(current: number, previous: number, higherIsBetter: boolean | null): string {
  if (higherIsBetter === null || current === previous) return "";
  return (current > previous) === higherIsBetter ? "gain" : "loss";
}

// ---------------------------------------------------------------------------
// Comparison table renderer
// ---------------------------------------------------------------------------

interface ComparisonRow {
  label: string;
  key: keyof StoredReport["casillas"];
  /** Colour a rise green (true), red (false), or not at all (null). */
  higherIsBetter: boolean | null;
}

// The first three rows are capitalGains totals, which exclude FX (shown in its
// own row); their compare.* labels say so, unlike the results page's net figure.
const COMPARISON_ROWS: ComparisonRow[] = [
  { label: "compare.transmission_value", key: "transmissionValue", higherIsBetter: null },
  { label: "compare.acquisition_value", key: "acquisitionValue", higherIsBetter: null },
  { label: "compare.net_gain_loss", key: "netGainLoss", higherIsBetter: true },
  { label: "casilla.fx_net_gain_loss", key: "fxNetGainLoss", higherIsBetter: true },
  { label: "casilla.gross_dividends", key: "grossDividends", higherIsBetter: true },
  { label: "casilla.interest_earned", key: "interestEarned", higherIsBetter: true },
  { label: "casilla.interest_paid", key: "interestPaid", higherIsBetter: false },
  { label: "casilla.general_gains", key: "generalGains", higherIsBetter: true },
  { label: "casilla.double_taxation", key: "doubleTaxation", higherIsBetter: true },
];

/**
 * Render the year comparison view into a container.
 * Shows a clear-local-data control even when only one report is stored.
 */
export function renderYearComparison(container: HTMLElement): void {
  const reports = loadAllReports();

  if (reports.length < 2) {
    container.innerHTML = reports.length === 0
      ? `<p class="muted">${t("compare.no_data")}</p>`
      : `<div class="year-compare"><div class="compare-header"><h3>${t("compare.title")}</h3><button id="clear-history-btn" class="btn-small btn-danger">${t("compare.clear_history")}</button></div><p class="muted">${t("compare.no_data")}</p></div>`;
    bindClearHistory(container);
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
    // Coerce undefined (optional/older-snapshot fields like generalGains) to 0.
    const values = sorted.map((r) => r.casillas[row.key] ?? 0);
    const valueCells = values.map((v) => `<td>${fmtEur(v)}</td>`).join("");

    const varCells = values.length >= 2
      ? values.slice(0, -1).map((v, i) => {
          const prev = values[i + 1]!;
          return `<td class="${variationClass(v, prev, row.higherIsBetter)}">${formatVariation(v, prev)}</td>`;
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
            <tr class="stats-divider"><td colspan="${sorted.length * 2}"></td></tr>
            ${statsRows}
          </tbody>
        </table>
      </div>
      <p class="compare-meta">${t("compare.saved_reports")}: ${sorted.map((r) => r.year).join(", ")}</p>
    </div>`;

  bindClearHistory(container);
}

function bindClearHistory(container: HTMLElement): void {
  container.querySelector("#clear-history-btn")?.addEventListener("click", () => {
    if (confirm(t("compare.clear_confirm"))) {
      clearAllReports();
      renderYearComparison(container);
    }
  });
}
