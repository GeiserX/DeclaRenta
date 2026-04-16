/**
 * DeclaRenta web UI entry point.
 *
 * All processing happens in the browser. No data is uploaded anywhere.
 * Supports: IBKR (XML), Degiro (CSV), Scalable Capital (CSV), eToro (XLSX), Freedom24 (JSON).
 */

import { detectBroker, getBroker, brokerParsers } from "../parsers/index.js";
import { parseEtoroXlsx, detectEtoroXlsx } from "../parsers/etoro.js";
import type { Statement } from "../types/broker.js";
import { fetchEcbRates } from "../engine/ecb.js";
import { generateTaxReport } from "../generators/report.js";
import { formatCsv } from "../generators/csv.js";
import { normalizeDate } from "../engine/dates.js";
import { openDisclaimer } from "./disclaimer.js";
import { extractChartData, renderDonutChart, renderMonthlyGainLossChart, renderHorizontalBarChart } from "./charts.js";
import { t, initLocale, setLocale, getCurrentLocale, getLocaleNames, type Locale } from "../i18n/index.js";
import Decimal from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// ---------------------------------------------------------------------------
// i18n initialization
// ---------------------------------------------------------------------------

initLocale();

/** Update all static elements with data-i18n attributes */
function updateStaticText() {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n!;
    el.textContent = t(key as Parameters<typeof t>[0]);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((el) => {
    const key = el.dataset.i18nPlaceholder!;
    (el as HTMLInputElement).placeholder = t(key as Parameters<typeof t>[0]);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => {
    const key = el.dataset.i18nAria!;
    el.setAttribute("aria-label", t(key as Parameters<typeof t>[0]));
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    const key = el.dataset.i18nTitle!;
    el.title = t(key as Parameters<typeof t>[0]);
  });
  document.documentElement.lang = getCurrentLocale();
}

// Populate language selector
const langSelect = document.getElementById("lang-select") as HTMLSelectElement;
const localeNames = getLocaleNames();
for (const [code, name] of Object.entries(localeNames)) {
  const opt = document.createElement("option");
  opt.value = code;
  opt.textContent = name;
  if (code === getCurrentLocale()) opt.selected = true;
  langSelect.appendChild(opt);
}

langSelect.addEventListener("change", () => {
  setLocale(langSelect.value as Locale);
});

document.addEventListener("localechange", () => {
  updateStaticText();
  if (currentReport) renderResults(currentReport);
});

updateStaticText();

// ---------------------------------------------------------------------------
// Theme toggle (auto / light / dark)
// ---------------------------------------------------------------------------

type ThemeMode = "auto" | "light" | "dark";

const THEME_ICONS: Record<ThemeMode, string> = { auto: "\u25D1", light: "\u2600", dark: "\u263E" };
const THEME_CYCLE: ThemeMode[] = ["auto", "light", "dark"];

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "auto") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", mode);
  }
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = THEME_ICONS[mode];
}

const savedTheme = (localStorage.getItem("theme") as ThemeMode | null) ?? "auto";
applyTheme(savedTheme);

document.getElementById("theme-toggle")?.addEventListener("click", () => {
  const current = (localStorage.getItem("theme") as ThemeMode | null) ?? "auto";
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length]!;
  localStorage.setItem("theme", next);
  applyTheme(next);
});

/** Escape HTML to prevent XSS from user-derived content */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const dropZone = document.getElementById("drop-zone")!;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const configSection = document.getElementById("config")!;
const resultsSection = document.getElementById("results")!;
const casillasDiv = document.getElementById("casillas")!;
const opsTable = document.getElementById("operations-table")!;
const divsTable = document.getElementById("dividends-table")!;
const exportJsonBtn = document.getElementById("export-json-btn")!;
const exportCsvBtn = document.getElementById("export-csv-btn")!;
const yearSelect = document.getElementById("year-select") as HTMLSelectElement;
const brokerSelect = document.getElementById("broker-select") as HTMLSelectElement;
const processBtn = document.getElementById("process-btn")!;
const fileListDiv = document.getElementById("file-list")!;
const opsSearch = document.getElementById("ops-search") as HTMLInputElement;
const opsFilter = document.getElementById("ops-filter") as HTMLSelectElement;

let currentReport: ReturnType<typeof generateTaxReport> | null = null;
const pendingFiles: File[] = [];

// ---------------------------------------------------------------------------
// File upload handlers
// ---------------------------------------------------------------------------

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer?.files) {
    addFiles(Array.from(e.dataTransfer.files));
  }
});
fileInput.addEventListener("change", () => {
  if (fileInput.files) {
    addFiles(Array.from(fileInput.files));
  }
});

function addFiles(files: File[]) {
  // Duplicate guard: skip files already in the list by name + size
  const existing = new Set(pendingFiles.map((f) => `${f.name}:${f.size}`));
  for (const f of files) {
    if (!existing.has(`${f.name}:${f.size}`)) {
      pendingFiles.push(f);
    }
  }
  renderFileList();
  configSection.hidden = pendingFiles.length === 0;
}

function renderFileList() {
  fileListDiv.innerHTML = pendingFiles
    .map((f, i) => `<span class="file-tag">${esc(f.name)} <button data-idx="${i}" class="remove-file">&times;</button></span>`)
    .join(" ");

  fileListDiv.querySelectorAll(".remove-file").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt((e.target as HTMLElement).dataset.idx!);
      pendingFiles.splice(idx, 1);
      renderFileList();
      if (pendingFiles.length === 0) configSection.hidden = true;
    });
  });
}

// ---------------------------------------------------------------------------
// Process button
// ---------------------------------------------------------------------------

processBtn.addEventListener("click", () => void processFiles());

async function processFiles() {
  if (pendingFiles.length === 0) return;

  try {
    processBtn.textContent = t("config.processing");
    processBtn.setAttribute("disabled", "true");

    const merged: Statement = {
      accountId: "", fromDate: "", toDate: "", period: "",
      trades: [], cashTransactions: [], corporateActions: [],
      openPositions: [], securitiesInfo: [],
    };
    const brokerNames: string[] = [];

    for (const file of pendingFiles) {
      // Check for XLSX binary (eToro) first
      const arrayBuf = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuf);
      if (detectEtoroXlsx(uint8)) {
        const statement = await parseEtoroXlsx(uint8);
        merged.accountId = merged.accountId || statement.accountId;
        merged.trades.push(...statement.trades);
        merged.cashTransactions.push(...statement.cashTransactions);
        merged.corporateActions.push(...statement.corporateActions);
        merged.openPositions = statement.openPositions;
        merged.securitiesInfo.push(...statement.securitiesInfo);
        brokerNames.push("eToro");
        continue;
      }

      const content = new TextDecoder("utf-8").decode(uint8);
      const selectedBroker = brokerSelect.value;
      const parser = selectedBroker !== "auto"
        ? getBroker(selectedBroker)
        : detectBroker(content);

      if (!parser) {
        throw new Error(
          t("error.no_broker_detected", { filename: file.name }) + ` ${brokerParsers.map((p) => p.name).join(", ")}`,
        );
      }

      const statement = parser.parse(content);
      merged.accountId = merged.accountId || statement.accountId;
      merged.trades.push(...statement.trades);
      merged.cashTransactions.push(...statement.cashTransactions);
      merged.corporateActions.push(...statement.corporateActions);
      merged.openPositions = statement.openPositions;
      merged.securitiesInfo.push(...statement.securitiesInfo);
      brokerNames.push(parser.name);
    }

    // Sort trades chronologically for cross-broker FIFO
    merged.trades.sort((a, b) =>
      normalizeDate(a.tradeDate).localeCompare(normalizeDate(b.tradeDate)),
    );

    const year = parseInt(yearSelect.value);
    const currencies = new Set<string>();
    for (const t of merged.trades) currencies.add(t.currency);
    for (const c of merged.cashTransactions) currencies.add(c.currency);
    currencies.delete("EUR");

    dropZone.textContent = t("status.fetching_rates", { currencies: [...currencies].join(", ") || "EUR" });

    const years = new Set(merged.trades.map((t) => parseInt(t.tradeDate.slice(0, 4))));
    years.add(year);
    const allRates = new Map() as ReturnType<typeof fetchEcbRates> extends Promise<infer R> ? R : never;
    for (const yr of years) {
      const rates = await fetchEcbRates(yr, [...currencies]);
      for (const [date, ratesByDate] of rates) {
        allRates.set(date, ratesByDate);
      }
    }

    const report = generateTaxReport(merged, allRates, year);
    currentReport = report;

    const uniqueBrokers = [...new Set(brokerNames)];
    dropZone.textContent = `✓ ${t("status.files_processed", { count: String(pendingFiles.length), brokers: uniqueBrokers.join(", "), trades: String(merged.trades.length) })}`;

    resultsSection.hidden = false;
    renderResults(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dropZone.textContent = `${t("error.prefix")}${msg}`;
    dropZone.style.color = "var(--danger)";
    // Clear stale results
    currentReport = null;
    resultsSection.hidden = true;
  } finally {
    processBtn.textContent = t("config.process_btn");
    processBtn.removeAttribute("disabled");
  }
}

// ---------------------------------------------------------------------------
// Export buttons
// ---------------------------------------------------------------------------

exportJsonBtn.addEventListener("click", () => {
  if (!currentReport) return;
  const blob = new Blob([JSON.stringify(currentReport, null, 2)], { type: "application/json" });
  downloadBlob(blob, `declarenta_${currentReport.year}.json`);
});

exportCsvBtn.addEventListener("click", () => {
  if (!currentReport) return;
  const csv = formatCsv(currentReport);
  const blob = new Blob([csv], { type: "text/csv" });
  downloadBlob(blob, `declarenta_${currentReport.year}.csv`);
});

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Sort state
// ---------------------------------------------------------------------------

type SortDir = "asc" | "desc" | null;
interface SortState { col: string; dir: SortDir }

let opsSort: SortState = { col: "", dir: null };
let divSort: SortState = { col: "", dir: null };

function nextDir(current: SortDir): SortDir {
  if (current === null) return "asc";
  if (current === "asc") return "desc";
  return null;
}

// Event delegation: attach once on stable parent, works across re-renders
opsTable.addEventListener("click", (e) => {
  const th = (e.target as HTMLElement).closest<HTMLElement>("th.sortable");
  if (!th) return;
  const col = th.dataset.col!;
  const dir = opsSort.col === col ? nextDir(opsSort.dir) : "asc";
  opsSort = { col: dir ? col : "", dir };
  renderOperationsTable();
});

divsTable.addEventListener("click", (e) => {
  const th = (e.target as HTMLElement).closest<HTMLElement>("th.sortable");
  if (!th) return;
  const col = th.dataset.col!;
  const dir = divSort.col === col ? nextDir(divSort.dir) : "asc";
  divSort = { col: dir ? col : "", dir };
  if (currentReport) renderDividendsTable(currentReport);
});

// ---------------------------------------------------------------------------
// Search and filter
// ---------------------------------------------------------------------------

opsSearch.addEventListener("input", () => renderOperationsTable());
opsFilter.addEventListener("change", () => renderOperationsTable());

// ---------------------------------------------------------------------------
// Render results
// ---------------------------------------------------------------------------

function formatDate(d: string): string {
  if (d.length === 8) return `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}`;
  return d;
}

function renderResults(report: ReturnType<typeof generateTaxReport>) {
  // Casillas summary
  casillasDiv.innerHTML = `
    <table>
      <thead><tr><th>${t("table.casilla")}</th><th>${t("table.concept")}</th><th>${t("table.amount_eur")}</th></tr></thead>
      <tbody>
        <tr><td>0327</td><td>${t("casilla.transmission_value")}</td><td>${report.capitalGains.transmissionValue.toFixed(2)}</td></tr>
        <tr><td>0328</td><td>${t("casilla.acquisition_value")}</td><td>${report.capitalGains.acquisitionValue.toFixed(2)}</td></tr>
        <tr class="${report.capitalGains.netGainLoss.greaterThanOrEqualTo(0) ? 'gain' : 'loss'}">
          <td></td><td><strong>${t("casilla.net_gain_loss")}</strong></td><td><strong>${report.capitalGains.netGainLoss.toFixed(2)}</strong></td>
        </tr>
        <tr><td>0029</td><td>${t("casilla.gross_dividends")}</td><td>${report.dividends.grossIncome.toFixed(2)}</td></tr>
        <tr><td>0033</td><td>${t("casilla.interest_earned")}</td><td>${report.interest.earned.toFixed(2)}</td></tr>
        <tr><td>0032</td><td>${t("casilla.interest_paid")}</td><td>${report.interest.paid.toFixed(2)}</td></tr>
        <tr><td>0588</td><td>${t("casilla.double_taxation")}</td><td>${report.doubleTaxation.deduction.toFixed(2)}</td></tr>
      </tbody>
    </table>
    ${report.capitalGains.blockedLosses.greaterThan(0) ? `<p class="warning">⚠ ${t("casilla.blocked_losses", { amount: report.capitalGains.blockedLosses.toFixed(2) })}</p>` : ""}
    ${report.warnings.length > 0 ? `<details><summary>${t("casilla.warnings_count", { count: String(report.warnings.length) })}</summary><ul>${report.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details>` : ""}
  `;

  // Charts
  const chartData = extractChartData(report);
  const chartsHtml = [
    renderDonutChart(t("chart.asset_distribution"), chartData.assetDistribution),
    renderMonthlyGainLossChart(t("chart.monthly_gl"), chartData.monthlyGainLoss),
    renderDonutChart(t("chart.currency_composition"), chartData.currencyComposition),
    renderHorizontalBarChart(t("chart.withholdings_country"), chartData.withholdingsByCountry),
  ].filter(Boolean).join("");

  resultsSection.querySelectorAll(".charts-grid").forEach((el) => el.remove());
  if (chartsHtml) {
    casillasDiv.insertAdjacentHTML("afterend", `<div class="charts-grid">${chartsHtml}</div>`);
  }

  renderOperationsTable();
  renderDividendsTable(report);
}

function sortIndicator(col: string, state: SortState): string {
  return state.col === col ? ` ${state.dir}` : "";
}

function renderOperationsTable() {
  if (!currentReport) return;
  const search = opsSearch.value.toLowerCase();
  const filter = opsFilter.value;

  let disposals = [...currentReport.capitalGains.disposals];

  if (search) {
    disposals = disposals.filter(
      (d) => d.isin.toLowerCase().includes(search) || d.symbol.toLowerCase().includes(search),
    );
  }
  if (filter === "gain") {
    disposals = disposals.filter((d) => d.gainLossEur.greaterThanOrEqualTo(0));
  } else if (filter === "loss") {
    disposals = disposals.filter((d) => d.gainLossEur.lessThan(0));
  }

  // Apply sort
  if (opsSort.dir && opsSort.col) {
    const dir = opsSort.dir === "asc" ? 1 : -1;
    const col = opsSort.col;
    disposals.sort((a, b) => {
      let cmp = 0;
      if (col === "isin") cmp = a.isin.localeCompare(b.isin);
      else if (col === "symbol") cmp = a.symbol.localeCompare(b.symbol);
      else if (col === "buyDate") cmp = a.acquireDate.localeCompare(b.acquireDate);
      else if (col === "sellDate") cmp = a.sellDate.localeCompare(b.sellDate);
      else if (col === "qty") cmp = a.quantity.minus(b.quantity).toNumber();
      else if (col === "cost") cmp = a.costBasisEur.minus(b.costBasisEur).toNumber();
      else if (col === "proceeds") cmp = a.proceedsEur.minus(b.proceedsEur).toNumber();
      else if (col === "gl") cmp = a.gainLossEur.minus(b.gainLossEur).toNumber();
      else if (col === "days") cmp = a.holdingPeriodDays - b.holdingPeriodDays;
      return cmp * dir;
    });
  }

  const th = (label: string, col: string) =>
    `<th class="sortable${sortIndicator(col, opsSort)}" data-col="${col}">${label}</th>`;

  opsTable.innerHTML = `
    <table>
      <thead>
        <tr>
          ${th(t("table.isin"), "isin")}
          ${th(t("table.symbol"), "symbol")}
          ${th(t("table.buy_date"), "buyDate")}
          ${th(t("table.sell_date"), "sellDate")}
          ${th(t("table.units"), "qty")}
          ${th(t("table.cost_eur"), "cost")}
          ${th(t("table.proceeds_eur"), "proceeds")}
          ${th(t("table.gain_loss_eur"), "gl")}
          ${th(t("table.days"), "days")}
        </tr>
      </thead>
      <tbody>
        ${disposals.map((d) => `
          <tr>
            <td class="mono">${esc(d.isin)}</td>
            <td>${esc(d.symbol)}</td>
            <td>${formatDate(d.acquireDate)}</td>
            <td>${formatDate(d.sellDate)}</td>
            <td>${d.quantity.toString()}</td>
            <td>${d.costBasisEur.toFixed(2)}</td>
            <td>${d.proceedsEur.toFixed(2)}</td>
            <td class="${d.gainLossEur.greaterThanOrEqualTo(0) ? 'gain' : 'loss'}">${d.gainLossEur.toFixed(2)}</td>
            <td>${d.holdingPeriodDays}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <p class="table-count">${t("results.operations_count", { count: String(disposals.length) })}</p>
  `;

}

function renderDividendsTable(report: ReturnType<typeof generateTaxReport>) {
  if (report.dividends.entries.length === 0) {
    divsTable.innerHTML = `<p class='muted'>${t("results.no_dividends")}</p>`;
    return;
  }

  const entries = [...report.dividends.entries];

  if (divSort.dir && divSort.col) {
    const dir = divSort.dir === "asc" ? 1 : -1;
    const col = divSort.col;
    entries.sort((a, b) => {
      let cmp = 0;
      if (col === "isin") cmp = a.isin.localeCompare(b.isin);
      else if (col === "symbol") cmp = a.symbol.localeCompare(b.symbol);
      else if (col === "date") cmp = a.payDate.localeCompare(b.payDate);
      else if (col === "gross") cmp = a.grossAmountEur.minus(b.grossAmountEur).toNumber();
      else if (col === "wht") cmp = a.withholdingTaxEur.minus(b.withholdingTaxEur).toNumber();
      else if (col === "country") cmp = a.withholdingCountry.localeCompare(b.withholdingCountry);
      return cmp * dir;
    });
  }

  const th = (label: string, col: string) =>
    `<th class="sortable${sortIndicator(col, divSort)}" data-col="${col}">${label}</th>`;

  divsTable.innerHTML = `
    <table>
      <thead>
        <tr>
          ${th(t("table.isin"), "isin")}
          ${th(t("table.symbol"), "symbol")}
          ${th(t("table.date"), "date")}
          ${th(t("table.gross_eur"), "gross")}
          ${th(t("table.withholding_eur"), "wht")}
          ${th(t("table.country"), "country")}
        </tr>
      </thead>
      <tbody>
        ${entries.map((d) => `
          <tr>
            <td class="mono">${esc(d.isin)}</td>
            <td>${esc(d.symbol)}</td>
            <td>${formatDate(d.payDate)}</td>
            <td>${d.grossAmountEur.toFixed(2)}</td>
            <td>${d.withholdingTaxEur.toFixed(2)}</td>
            <td>${esc(d.withholdingCountry)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <p class="table-count">${t("results.dividends_count", { count: String(entries.length) })}</p>
  `;

}

// ---------------------------------------------------------------------------
// Disclaimer modal
// ---------------------------------------------------------------------------

document.getElementById("open-disclaimer")?.addEventListener("click", (e) => {
  e.preventDefault();
  openDisclaimer();
});

// ---------------------------------------------------------------------------
// Service Worker registration
// ---------------------------------------------------------------------------

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // SW registration is optional — fail silently
  });
}
