/**
 * DeclaRenta web UI entry point.
 *
 * Sidebar-based layout with sections: Perfil, Renta, 720, D-6.
 * All processing happens in the browser. No data is uploaded anywhere.
 */

import { detectBroker, getBroker, brokerParsers } from "../parsers/index.js";
import { parseEtoroXlsx, detectEtoroXlsx } from "../parsers/etoro.js";
import type { Statement } from "../types/broker.js";
import type { TaxSummary } from "../types/tax.js";
import type { EcbRateMap } from "../types/ecb.js";
import { fetchEcbRates } from "../engine/ecb.js";
import { generateTaxReport } from "../generators/report.js";
import { formatCsv } from "../generators/csv.js";
import { normalizeDate } from "../engine/dates.js";
import { openDisclaimer } from "./disclaimer.js";
import { extractChartData, renderDonutChart, renderMonthlyGainLossChart, renderHorizontalBarChart, renderTaxBracketCard } from "./charts.js";
import { renderCasillaCards } from "./casilla-detail.js";
import { persistReport, renderYearComparison } from "./year-compare.js";
import { initWizard, goToStep, onStepChange, unlockStep, type WizardStep } from "./wizard.js";
import { initSidebar, updateBadge } from "./sidebar.js";
import { initProfile, getProfile, saveProfile } from "./profile.js";
import { initBrokerGuides } from "./broker-guides.js";
import { initSection720, renderSection720, rerenderSection720 } from "./section-720.js";
import { initSection721, renderSection721, rerenderSection721 } from "./section-721.js";
import { initSectionD6, renderSectionD6, rerenderSectionD6 } from "./section-d6.js";
import { t, initLocale, setLocale, getCurrentLocale, getLocaleNames, type Locale } from "../i18n/index.js";
import { validateStatement, renderValidationIssues } from "./validation.js";
import { renderOperationsAnnex } from "./operations-annex.js";
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
  rerenderSection720();
  rerenderSection721();
  rerenderSectionD6();
  initProfile();
});

updateStaticText();

// ---------------------------------------------------------------------------
// Splash screen
// ---------------------------------------------------------------------------

const splash = document.getElementById("splash");
const splashCta = document.getElementById("splash-cta");

function dismissSplash() {
  if (!splash) return;
  splash.classList.add("splash-exit");
  splash.addEventListener("animationend", () => {
    splash.style.display = "none";
    document.body.classList.remove("splash-visible");
  }, { once: true });
}

function showSplash() {
  if (!splash) return;
  splash.style.display = "";
  splash.classList.remove("splash-exit");
  document.body.classList.add("splash-visible");
}

if (splash) {
  splashCta?.addEventListener("click", dismissSplash);
  document.body.classList.add("splash-visible");
}

// Logo/brand click → show splash (but not hamburger)
document.querySelector(".top-bar-brand")?.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("#sidebar-toggle")) return;
  e.preventDefault();
  showSplash();
});

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

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const dropZone = document.getElementById("drop-zone")!;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const casillasDiv = document.getElementById("casillas")!;
const opsTable = document.getElementById("operations-table")!;
const divsTable = document.getElementById("dividends-table")!;
const exportJsonBtn = document.getElementById("export-json-btn")!;
const exportCsvBtn = document.getElementById("export-csv-btn")!;
const brokerSelect = document.getElementById("broker-select") as HTMLSelectElement;
const fileListDiv = document.getElementById("file-list")!;
const opsSearch = document.getElementById("ops-search") as HTMLInputElement;
const opsFilter = document.getElementById("ops-filter") as HTMLSelectElement;
const reviewContent = document.getElementById("review-content")!;
const yearCompareDiv = document.getElementById("year-compare")!;

let currentReport: TaxSummary | null = null;
let currentBrokers: string[] = [];
const pendingFiles: File[] = [];

/** Parsed statement data (available after step 2) */
let mergedStatement: Statement | null = null;
let detectedBrokers: string[] = [];
/** Years detected from uploaded data (sorted descending, latest first) */
let detectedYears: number[] = [];
/** The active year for processing (auto-detected from data, changeable via dropdown) */
let activeYear: number | null = null;

// ---------------------------------------------------------------------------
// Wizard initialization
// ---------------------------------------------------------------------------

initWizard();
initSidebar();
initProfile();
initBrokerGuides();
initSection720();
initSection721();
initSectionD6();

/** Control wizard "Next" behavior per step */
onStepChange((_from: WizardStep, to: WizardStep) => {
  if (to === 2 && !mergedStatement) {
    // Parse files when entering step 2
    void parseFiles();
  }
  if (to === 3 && !currentReport) {
    // Process when entering step 3
    void processFiles();
  }
});

// Override next button to trigger processing on step 2
const wizardNext = document.getElementById("wizard-next")!;
wizardNext.addEventListener("click", (e) => {
  const step = getCurrentWizardStep();
  if (step === 1 && pendingFiles.length === 0) {
    e.stopImmediatePropagation();
    return;
  }
  if (step === 2) {
    e.stopImmediatePropagation();
    void processFiles().then(() => {
      if (currentReport) goToStep(3);
    });
    return;
  }
}, true); // Capture phase to run before wizard's own handler

function getCurrentWizardStep(): WizardStep {
  for (let i = 1; i <= 3; i++) {
    const panel = document.getElementById(`wizard-step-${i}`);
    if (panel && !panel.hidden) return i as WizardStep;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Step 1: File upload handlers
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
  // Reset downstream state when files change
  mergedStatement = null;
  currentReport = null;
  activeYear = null;
  detectedYears = [];
  (document.getElementById("wizard-next") as HTMLButtonElement).disabled = pendingFiles.length === 0;
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
      mergedStatement = null;
      currentReport = null;
    });
  });
  (document.getElementById("wizard-next") as HTMLButtonElement).disabled = pendingFiles.length === 0;
}

// ---------------------------------------------------------------------------
// Step 2: Parse and review
// ---------------------------------------------------------------------------

async function parseFiles(): Promise<void> {
  if (pendingFiles.length === 0) return;

  const merged: Statement = {
    accountId: "", fromDate: "", toDate: "", period: "",
    trades: [], cashTransactions: [], corporateActions: [],
    openPositions: [], securitiesInfo: [],
  };
  const brokerNames: string[] = [];

  try {
    for (const file of pendingFiles) {
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

    mergedStatement = merged;
    detectedBrokers = [...new Set(brokerNames)];

    // Detect years from trades + cash transactions
    const yearSet = new Set<number>();
    for (const tr of merged.trades) yearSet.add(parseInt(tr.tradeDate.slice(0, 4)));
    for (const ct of merged.cashTransactions) yearSet.add(parseInt(ct.dateTime.slice(0, 4)));
    detectedYears = [...yearSet].sort((a, b) => b - a); // descending
    if (detectedYears.length > 0 && !activeYear) {
      activeYear = detectedYears[0]!;
      // Sync profile so 720/721/D-6 use the same year
      const profile = getProfile();
      profile.year = activeYear;
      saveProfile(profile);
    }

    renderReview(merged, detectedBrokers, brokerNames);
    unlockStep(3);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    reviewContent.innerHTML = `<p class="warning">${t("error.prefix")}${esc(msg)}</p>`;
  }
}

function renderReview(merged: Statement, brokers: string[], perFileBrokers: string[]): void {
  const tradeCount = merged.trades.length;
  const divCount = merged.cashTransactions.filter((c) =>
    c.type === "Dividends" || c.type === "Payment In Lieu Of Dividends",
  ).length;

  const currencies = new Set<string>();
  for (const tr of merged.trades) currencies.add(tr.currency);
  currencies.delete("EUR");

  const dates = merged.trades.map((tr) => normalizeDate(tr.tradeDate)).sort();
  const dateRange = dates.length > 0
    ? `${formatDate(dates[0]!)} — ${formatDate(dates[dates.length - 1]!)}`
    : "—";

  reviewContent.innerHTML = `
    <div class="review-grid">
      <div class="review-card">
        <div class="review-label">${t("review.broker")}</div>
        <div class="review-value accent">${esc(brokers.join(", "))}</div>
      </div>
      <div class="review-card">
        <div class="review-label">${t("review.trades_count")}</div>
        <div class="review-value">${tradeCount}</div>
      </div>
      <div class="review-card">
        <div class="review-label">${t("review.dividends_count")}</div>
        <div class="review-value">${divCount}</div>
      </div>
      <div class="review-card">
        <div class="review-label">${t("review.date_range")}</div>
        <div class="review-value" style="font-size:1rem">${dateRange}</div>
      </div>
      <div class="review-card">
        <div class="review-label">${t("review.currencies")}</div>
        <div class="review-value" style="font-size:1rem">${currencies.size > 0 ? [...currencies].join(", ") : "EUR"}</div>
      </div>
    </div>
    <div class="review-files">
      <table>
        <thead><tr><th>${t("review.file")}</th><th>${t("review.broker")}</th></tr></thead>
        <tbody>${pendingFiles.map((f, i) => `
          <tr><td>${esc(f.name)}</td><td>${esc(perFileBrokers[i] ?? "—")}</td></tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;

  if (tradeCount === 0 && divCount === 0) {
    reviewContent.innerHTML += `<p class="warning">${t("review.no_data")}</p>`;
  }

  // Validation warnings
  const validationIssues = validateStatement(merged, activeYear);
  if (validationIssues.length > 0) {
    reviewContent.insertAdjacentHTML("beforeend", renderValidationIssues(validationIssues));
  }
}

// ---------------------------------------------------------------------------
// Step 3: Process
// ---------------------------------------------------------------------------

async function processFiles(): Promise<void> {
  if (!mergedStatement) {
    await parseFiles();
  }
  if (!mergedStatement) return;

  try {
    const merged = mergedStatement;
    const year = activeYear ?? getProfile().year;
    const currencies = new Set<string>();
    for (const tr of merged.trades) currencies.add(tr.currency);
    for (const c of merged.cashTransactions) currencies.add(c.currency);
    currencies.delete("EUR");

    const years = new Set(merged.trades.map((tr) => parseInt(tr.tradeDate.slice(0, 4))));
    years.add(year);
    const allRates: EcbRateMap = new Map();
    for (const yr of years) {
      const rates = await fetchEcbRates(yr, [...currencies]);
      for (const [date, ratesByDate] of rates) {
        allRates.set(date, ratesByDate);
      }
    }

    const report = generateTaxReport(merged, allRates, year);
    currentReport = report;
    currentBrokers = detectedBrokers;

    // Persist for year comparison
    persistReport(report, currentBrokers);

    unlockStep(3);
    renderResults(report);

    // Render 720 and D-6 sections with processed data (non-blocking)
    try { renderSection720(merged, allRates); } catch { /* 720 render failed — section stays in empty state */ }
    try { renderSection721(merged, allRates); } catch { /* 721 render failed — section stays in empty state */ }
    try { renderSectionD6(merged, allRates); } catch { /* D-6 render failed — section stays in empty state */ }
    updateBadge("renta", t("badge.complete"), "success");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    reviewContent.innerHTML = `<p class="warning">${t("error.prefix")}${esc(msg)}</p>`;
    currentReport = null;
  }
}

// ---------------------------------------------------------------------------
// Export & generate buttons
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
// Render results (Step 3)
// ---------------------------------------------------------------------------

function formatDate(d: string): string {
  if (d.length === 8) return `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}`;
  return d;
}

function renderResults(report: TaxSummary) {
  // Year header bar with selector + mismatch warning
  const yearHeader = document.getElementById("results-year-header");
  if (yearHeader) {
    const year = report.year;
    const hasData = report.capitalGains.disposals.length > 0 || report.dividends.entries.length > 0;

    const yearOptions = (detectedYears.length > 0 ? detectedYears : [year])
      .slice().sort((a, b) => a - b)
      .map((y) => `<option value="${y}"${y === year ? " selected" : ""}>${y}</option>`)
      .join("");

    let hdrHtml = `<div class="section-header-bar">
      <span class="section-year">${t("section.year_label")}
        <select id="results-year-select" class="year-select">${yearOptions}</select>
      </span>
    </div>`;

    if (!hasData && detectedYears.length > 0) {
      hdrHtml += `<div class="banner banner-warning">
        <span>${t("results.year_mismatch", { year: String(year), available: detectedYears.join(", ") })}</span>
      </div>`;
    }
    yearHeader.innerHTML = hdrHtml;

    // Bind year selector — change active year and re-process
    document.getElementById("results-year-select")?.addEventListener("change", (e) => {
      const newYear = parseInt((e.target as HTMLSelectElement).value);
      if (!isNaN(newYear)) {
        activeYear = newYear;
        // Sync profile so 720/721/D-6 use the same year
        const profile = getProfile();
        profile.year = newYear;
        saveProfile(profile);
        initProfile();
        void processFiles();
      }
    });
  }

  // Expandable casilla cards (replaces old table)
  renderCasillaCards(casillasDiv, report);

  // Charts
  const chartData = extractChartData(report);
  const taxableBase = Math.max(0,
    report.capitalGains.netGainLoss.toNumber()
    + report.dividends.grossIncome.toNumber()
    + report.interest.earned.toNumber()
    - report.capitalGains.blockedLosses.toNumber()
  );
  const dtDeduction = report.doubleTaxation.deduction.toNumber();
  const chartsHtml = [
    renderDonutChart(t("chart.asset_distribution"), chartData.assetDistribution),
    renderMonthlyGainLossChart(t("chart.monthly_gl"), chartData.monthlyGainLoss),
    renderDonutChart(t("chart.currency_composition"), chartData.currencyComposition),
    renderHorizontalBarChart(t("chart.withholdings_country"), chartData.withholdingsByCountry),
    renderTaxBracketCard(t("chart.tax_estimate" as Parameters<typeof t>[0]), taxableBase, dtDeduction),
  ].filter(Boolean).join("");

  const resultsSection = document.getElementById("wizard-step-3")!;
  resultsSection.querySelectorAll(".charts-grid").forEach((el) => el.remove());
  if (chartsHtml) {
    casillasDiv.insertAdjacentHTML("afterend", `<div class="charts-grid">${chartsHtml}</div>`);
  }

  // Operations annex (Anexo C1)
  resultsSection.querySelectorAll(".annex-container").forEach((el) => el.remove());
  const annexHtml = renderOperationsAnnex(report);
  if (annexHtml) {
    const chartsGrid = resultsSection.querySelector(".charts-grid");
    if (chartsGrid) {
      chartsGrid.insertAdjacentHTML("afterend", annexHtml);
    } else {
      casillasDiv.insertAdjacentHTML("afterend", annexHtml);
    }
  }

  renderOperationsTable();
  renderDividendsTable(report);

  // Year comparison
  renderYearComparison(yearCompareDiv);
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

function renderDividendsTable(report: TaxSummary) {
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

document.getElementById("open-disclaimer")?.addEventListener("click", () => {
  openDisclaimer();
});

// ---------------------------------------------------------------------------
// Version display
// ---------------------------------------------------------------------------

const versionEl = document.getElementById("footer-version");
if (versionEl) {
  const v = __APP_VERSION__;
  const h = __COMMIT_HASH__;
  versionEl.textContent = v && h ? `v${v} (${h})` : v ? `v${v}` : "";
}

// ---------------------------------------------------------------------------
// Service Worker registration
// ---------------------------------------------------------------------------

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {
    // SW registration is optional — fail silently
  });
}
