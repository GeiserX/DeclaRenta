/**
 * DeclaRenta web UI entry point.
 *
 * All processing happens in the browser. No data is uploaded anywhere.
 */

import { parseIbkrFlexXml } from "../parsers/ibkr.js";
import { fetchEcbRates } from "../engine/ecb.js";
import { generateTaxReport } from "../generators/report.js";
import Decimal from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const dropZone = document.getElementById("drop-zone")!;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const configSection = document.getElementById("config")!;
const resultsSection = document.getElementById("results")!;
const casillasDiv = document.getElementById("casillas")!;
const exportBtn = document.getElementById("export-btn")!;
const yearSelect = document.getElementById("year-select") as HTMLSelectElement;

let currentReport: ReturnType<typeof generateTaxReport> | null = null;

// File upload handlers
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer?.files[0];
  if (file) processFile(file);
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) processFile(file);
});

exportBtn.addEventListener("click", () => {
  if (!currentReport) return;
  const blob = new Blob([JSON.stringify(currentReport, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `declarenta_${currentReport.year}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

async function processFile(file: File) {
  try {
    dropZone.innerHTML = "<p>Procesando...</p>";

    const xml = await file.text();
    const statement = parseIbkrFlexXml(xml);
    const year = parseInt(yearSelect.value);

    // Detect currencies
    const currencies = new Set<string>();
    for (const t of statement.trades) currencies.add(t.currency);
    for (const c of statement.cashTransactions) currencies.add(c.currency);
    currencies.delete("EUR");

    dropZone.innerHTML = `<p>Obteniendo tipos ECB para ${[...currencies].join(", ")}...</p>`;

    const rateMap = await fetchEcbRates(year, [...currencies]);
    const report = generateTaxReport(statement, rateMap, year);
    currentReport = report;

    configSection.hidden = false;
    resultsSection.hidden = false;
    dropZone.innerHTML = `<p>✓ ${file.name} procesado (${statement.trades.length} operaciones)</p>`;

    renderResults(report);
  } catch (err) {
    dropZone.innerHTML = `<p style="color: var(--danger)">Error: ${err instanceof Error ? err.message : err}</p>`;
  }
}

function renderResults(report: ReturnType<typeof generateTaxReport>) {
  casillasDiv.innerHTML = `
    <table>
      <thead><tr><th>Casilla</th><th>Concepto</th><th>Importe (EUR)</th></tr></thead>
      <tbody>
        <tr><td>0327</td><td>Valor de transmisión</td><td>${report.capitalGains.transmissionValue.toFixed(2)}</td></tr>
        <tr><td>0328</td><td>Valor de adquisición</td><td>${report.capitalGains.acquisitionValue.toFixed(2)}</td></tr>
        <tr><td>0029</td><td>Dividendos brutos</td><td>${report.dividends.grossIncome.toFixed(2)}</td></tr>
        <tr><td>0033</td><td>Intereses ganados</td><td>${report.interest.earned.toFixed(2)}</td></tr>
        <tr><td>0032</td><td>Intereses pagados (margen)</td><td>${report.interest.paid.toFixed(2)}</td></tr>
        <tr><td>0588</td><td>Deducción doble imposición</td><td>${report.doubleTaxation.deduction.toFixed(2)}</td></tr>
      </tbody>
    </table>
    ${report.capitalGains.blockedLosses.greaterThan(0) ? `<p class="warning">⚠ Pérdidas bloqueadas por regla anti-churning (2 meses): ${report.capitalGains.blockedLosses.toFixed(2)} EUR</p>` : ""}
  `;
}
