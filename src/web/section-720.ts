/**
 * Modelo 720 section — foreign assets declaration.
 *
 * Displays threshold indicator, position table, filing guide,
 * and generates the fixed-width file for AEAT submission.
 */

import { t } from "../i18n/index.js";
import { getProfile, isProfileComplete } from "./profile.js";
import { getQ4AverageRate, hasNoMarketValue, lookupPositionRate } from "../engine/ecb.js";
import {
  checkModelo720SuccessiveYear,
  checkModelo720Thresholds,
  findModelo720Omissions,
  findUndatedExtinctions,
  generateModelo720,
  modelo720DeclarationId,
  modelo720PositionCountry,
  readPrevious720,
  readPrevious720Totals,
  type Modelo720SuccessiveCategory,
  type Previous720Totals,
} from "../generators/modelo720.js";
import { validateModelo720TextFields } from "../generators/modelo720-validator.js";
import type { Statement } from "../types/broker.js";
import type { EcbRateMap } from "../types/ecb.js";
import type { FifoDisposal, Lot } from "../types/tax.js";
import Decimal from "decimal.js";
import { fmtEur } from "./format.js";
import { esc } from "./esc.js";
import { renderPositionsDateBanner } from "./positions-date.js";

/** Return year-end date or today if the year hasn't ended yet */
function effectiveYearEnd(year: number): string {
  const today = new Date().toISOString().slice(0, 10);
  const yearEnd = `${year}-12-31`;
  return yearEnd <= today ? yearEnd : today;
}

let cachedStatement: Statement | null = null;
let cachedRateMap: EcbRateMap | null = null;
let cachedYearEndLots: Map<string, Lot[]> | undefined;
let cachedDisposals: FifoDisposal[] | undefined;

/**
 * Last filed 720, uploaded in this section. It decides the A/M/C origin of
 * each record and the 20,000 € rule. Kept in memory only, never stored.
 */
interface Previous720Upload {
  name: string;
  previous: ReturnType<typeof readPrevious720>;
  totals: Previous720Totals;
}
let previous720: Previous720Upload | null = null;
let previous720Error: { key: "m720.previous_invalid" } | { key: "m720.previous_same_year"; fileYear: number } | null = null;

/** The generator config fields that come from the uploaded 720. */
function previousConfig(): { previousYearSecurities?: Previous720Upload["previous"]["securities"]; previousYearAccounts?: string[] } {
  return previous720
    ? { previousYearSecurities: previous720.previous.securities, previousYearAccounts: previous720.previous.accounts }
    : {};
}

/** Read an uploaded 720 file (ISO-8859-15, like the one this tool generates) and re-render. */
async function loadPrevious720(file: File): Promise<void> {
  const content = new TextDecoder("iso-8859-15").decode(await file.arrayBuffer());
  const totals = readPrevious720Totals(content);
  const year = getProfile().year;
  if (!content.split(/\r?\n/).some((line) => line.startsWith("2720"))) {
    previous720 = null;
    previous720Error = { key: "m720.previous_invalid" };
  } else if (totals.year !== null && totals.year >= year) {
    previous720 = null;
    previous720Error = { key: "m720.previous_same_year", fileYear: totals.year };
  } else {
    previous720 = { name: file.name, previous: readPrevious720(content), totals };
    previous720Error = null;
  }
  rerenderSection720();
}

function previous720CardHtml(year: number): string {
  let status = "";
  if (previous720) {
    const { previous, totals, name } = previous720;
    status = `<p>${esc(t("m720.previous_loaded", {
      name,
      year: totals.year === null ? "—" : String(totals.year),
      securities: String(new Set(previous.securities.map((s) => s.isin)).size),
      accounts: String(new Set(previous.accounts).size),
    }))} <button type="button" id="m720-previous-clear" class="btn-secondary btn-small">${esc(t("m720.previous_clear"))}</button></p>`;
  } else if (previous720Error) {
    const message = previous720Error.key === "m720.previous_same_year"
      ? t(previous720Error.key, { fileYear: String(previous720Error.fileYear), year: String(year) })
      : t(previous720Error.key);
    status = `<div class="banner banner-warning">${esc(message)}</div>`;
  }
  return `<div class="m720-previous">
    <h3>${esc(t("m720.previous_title"))}</h3>
    <p class="muted">${esc(t("m720.previous_help"))}</p>
    ${previous720 ? "" : `<input type="file" id="m720-previous-input" accept=".txt,text/plain">`}
    ${status}
  </div>`;
}

function bindPrevious720Card(): void {
  document.getElementById("m720-previous-input")?.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void loadPrevious720(file);
  });
  document.getElementById("m720-previous-clear")?.addEventListener("click", () => {
    previous720 = null;
    previous720Error = null;
    rerenderSection720();
  });
}

/** "+1.234,00" for an increase, "-1.234,00" for a decrease. */
function fmtChange(d: Decimal): string {
  return d.greaterThan(0) ? `+${fmtEur(d)}` : fmtEur(d);
}

/** Initialize 720 section with empty state */
export function initSection720(): void {
  const container = document.getElementById("m720-content");
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      </div>
      <h3>${t("m720.empty_title")}</h3>
      <p>${t("m720.empty_description")}</p>
      <a href="#renta" class="btn-cta">${t("m720.empty_cta")}</a>
    </div>`;
}

/** Render 720 section with processed data */
export function renderSection720(
  statement: Statement,
  rateMap: EcbRateMap,
  yearEndLots?: Map<string, Lot[]>,
  disposals?: FifoDisposal[],
): void {
  cachedStatement = statement;
  cachedRateMap = rateMap;
  cachedYearEndLots = yearEndLots;
  cachedDisposals = disposals;

  const container = document.getElementById("m720-content");
  if (!container) return;

  const profile = getProfile();
  const year = profile.year;

  const hasCashBalances = (statement.cashBalances ?? []).some((cb) => new Decimal(cb.endingCash).greaterThan(0));
  // With nothing held, last year's file still matters: what it declared was sold (C).
  if (statement.openPositions.length === 0 && !hasCashBalances && !previous720) {
    container.innerHTML = `<p class="muted">${t("m720.no_positions")}</p>${previous720CardHtml(year)}`;
    bindPrevious720Card();
    return;
  }

  const dateForRates = effectiveYearEnd(year);
  let html = "";

  // Year + deadline header
  html += `<div class="section-header-bar">
    <span class="section-year">${t("section.year_label")} ${year}</span>
    <span class="section-deadline">${t("m720.deadline_short")}</span>
  </div>`;

  // Profile data source
  const profileParts = [
    profile.nif ? `NIF: ${esc(profile.nif)}` : null,
    profile.apellidos || profile.nombre ? `${esc(profile.apellidos)} ${esc(profile.nombre)}`.trim() : null,
    profile.telefono ? `Tel: ${esc(profile.telefono)}` : null,
  ].filter(Boolean);
  html += `<div class="banner banner-info banner-profile-source">
    ${t("section.profile_source")} — ${profileParts.length > 0 ? profileParts.join(" · ") : t("profile.go_to_profile")}
  </div>`;

  // Profile warning
  if (!isProfileComplete()) {
    html += `<div class="banner banner-warning">
      <span>${t("profile.incomplete_banner")}</span>
      <a href="#perfil">${t("profile.go_to_profile")}</a>
    </div>`;
  }

  // Positions must be the holdings at 31 December of the selected year
  const positionsDate = renderPositionsDateBanner(statement, year);
  html += positionsDate.html;

  html += previous720CardHtml(year);

  // Per-category threshold checks (720 has independent 50K thresholds)
  const thresholds = checkModelo720Thresholds(statement.openPositions, rateMap, year, statement.cashBalances);
  const exceeds = thresholds.values.exceeds || thresholds.accounts.exceeds;

  // With last year's file, a category it declared follows the 20,000 € rule instead
  const successive = previous720
    ? checkModelo720SuccessiveYear(statement.openPositions, rateMap, year, statement.cashBalances, previous720.previous, previous720.totals)
    : null;
  const sold = successive?.values.sold ?? [];

  // `unvalued`: holdings left out of the total. Until the user values them the
  // category cannot be called below the threshold.
  const categories: Modelo720CategoryView[] = [];
  if (thresholds.values.total.greaterThan(0) || thresholds.values.unvalued > 0 || successive?.values.declaredBefore) {
    categories.push({
      label: t("m720.category_v"),
      total: thresholds.values.total,
      exceeds: thresholds.values.exceeds,
      unvalued: thresholds.values.unvalued,
      successive: successive?.values,
      sold: sold.length,
    });
  }
  if (thresholds.accounts.total.greaterThan(0) || successive?.accounts.declaredBefore) {
    categories.push({
      label: t("m720.category_c"),
      total: thresholds.accounts.total,
      exceeds: thresholds.accounts.exceeds,
      unvalued: 0,
      successive: successive?.accounts,
      sold: 0,
    });
  }
  const mustFile = categories.some((cat) => (cat.successive?.declaredBefore ? cat.successive.mandatory : cat.exceeds));

  for (const cat of categories) {
    const pct = Math.min(cat.total.div(50000).mul(100).toNumber(), 100);
    html += `<div class="threshold-bar">
      <div class="threshold-label-row"><strong>${esc(cat.label)}</strong></div>
      <div class="threshold-track">
        <div class="threshold-fill ${cat.exceeds ? "over" : "under"}" style="width: ${pct}%"></div>
      </div>
      <div class="threshold-labels">
        <span>${t("m720.total_value", { amount: fmtEur(cat.total) })}</span>
        <span>50.000 €</span>
      </div>
      ${categoryStatusHtml(cat)}
    </div>`;
  }

  if (mustFile) {
    const totalValue = thresholds.values.total.plus(thresholds.accounts.total);
    html += `<p class="warning">${t("m720.threshold_exceeded", { amount: fmtEur(totalValue) })}</p>`;
  }
  if (!previous720 && exceeds) {
    html += `<div class="banner banner-info">${t("m720.successive_years_note")}</div>`;
  } else if (previous720 && !mustFile && categories.every((cat) => cat.unvalued === 0)) {
    html += `<div class="banner banner-info">${esc(t("m720.successive_not_required"))}</div>`;
  }

  // Positions table (long holdings only: a short is owed, not owned, and the
  // threshold above leaves it out too)
  const positions = statement.openPositions.filter(
    (p) => (p.assetCategory === "STK" || p.assetCategory === "FUND" || p.assetCategory === "BOND")
      && !new Decimal(p.positionValue).isNegative(),
  );

  const declaredIsins = previous720 ? new Set(previous720.previous.securities.map((s) => s.isin)) : null;
  if (positions.length > 0) {
    let unvaluedCount = 0;
    html += `<h3>${t("m720.positions_title")}</h3>
    <div class="table-wrapper"><table>
      <thead><tr>
        <th>ISIN</th><th>${t("table.symbol")}</th><th>${t("table.country")}</th><th>${t("table.amount_eur")}</th>${declaredIsins ? `<th>${esc(t("m720.origin"))}</th>` : ""}
      </tr></thead>
      <tbody>${positions.map((p) => {
        let rate: Decimal | null = null;
        if (p.assetCategory === "STK") {
          try {
            rate = getQ4AverageRate(rateMap, year, p.currency);
          } catch {
            rate = lookupPositionRate(rateMap, dateForRates, p.currency);
          }
        } else {
          rate = lookupPositionRate(rateMap, dateForRates, p.currency);
        }
        // No rate, or no market value in the export: unknown, never 0 €.
        if (hasNoMarketValue(p)) rate = null;
        if (rate === null) unvaluedCount++;
        const val = rate === null ? "—" : fmtEur(new Decimal(p.positionValue).mul(rate));
        const origin = declaredIsins ? `<td>${esc(t(declaredIsins.has(p.isin) ? "m720.origin_m" : "m720.origin_a"))}</td>` : "";
        return `<tr><td class="mono">${esc(p.isin)}</td><td>${esc(p.description)}</td><td>${esc(modelo720PositionCountry(p) ?? "—")}</td><td>${val}</td>${origin}</tr>`;
      }).join("")}</tbody>
    </table></div>`;
    if (unvaluedCount > 0) {
      html += `<div class="banner banner-warning">${esc(t("m720.positions_unvalued", { count: String(unvaluedCount) }))}</div>`;
    }

    // Exchange rates display
    const uniqueCurrencies = [...new Set(positions.map((p) => p.currency))].filter((c) => c !== "EUR").sort();
    if (uniqueCurrencies.length > 0) {
      html += `<div class="rates-display">
        <h4>${t("m720.rates_title")}</h4>
        <div class="rates-grid">${uniqueCurrencies.map((cur) => {
          const rate = lookupPositionRate(rateMap, `${year}-12-31`, cur);
          return `<span class="rate-item">${esc(cur)}: ${rate === null ? "—" : `${rate.toFixed(4)} €`}</span>`;
        }).join("")}</div>
      </div>`;
    }
  }

  // Cash balances table (Category C — Cuentas)
  const cashBalances = (statement.cashBalances ?? []).filter((cb) => new Decimal(cb.endingCash).greaterThan(0));
  if (cashBalances.length > 0) {
    const missingAverage = cashBalances.some((cb) => !cb.averageQ4Cash);
    html += `<h3>${t("m720.cash_title")}</h3>
    ${missingAverage ? `<div class="banner banner-warning">${t("m720.cash_missing_average")}</div>` : ""}
    <div class="table-wrapper"><table>
      <thead><tr>
        <th>${t("table.currency")}</th><th>${t("table.amount_eur")}</th><th>${t("m720.q4_average")}</th>
      </tr></thead>
      <tbody>${cashBalances.map((cb) => {
        const ecbRate = lookupPositionRate(rateMap, dateForRates, cb.currency);
        const val = ecbRate === null ? "—" : fmtEur(new Decimal(cb.endingCash).mul(ecbRate));
        const avg = ecbRate !== null && cb.averageQ4Cash ? fmtEur(new Decimal(cb.averageQ4Cash).mul(ecbRate)) : "—";
        return `<tr><td>${esc(cb.currency)}</td><td>${val}</td><td>${avg}</td></tr>`;
      }).join("")}</tbody>
    </table></div>`;
  }

  // Securities last year's file declared that are no longer held: C records
  if (sold.length > 0) {
    const undated = new Map(
      findUndatedExtinctions(statement.openPositions, { year, ...previousConfig() }, disposals).map((u) => [u.isin, u.missing]),
    );
    html += `<h3>${esc(t("m720.sold_title"))}</h3>
    <p class="muted">${esc(t("m720.sold_help"))}</p>
    <ul class="m720-sold">${sold.map((s) => {
      const missing = undated.get(s.isin);
      const note = missing === "extinctionDate"
        ? `: ${esc(t("m720.sold_no_date", { year: String(year) }))}`
        : missing === "acquisitionDate" ? `: ${esc(t("m720.sold_no_acquisition"))}` : "";
      return `<li><span class="mono">${esc(s.isin)}</span>${note}</li>`;
    }).join("")}</ul>`;
  }

  // Assets the file leaves out: the user declares them by hand.
  const omissions = findModelo720Omissions(statement.openPositions, rateMap, { year, ...previousConfig() }, statement.cashBalances);
  if (omissions.length > 0) {
    html += `<div class="banner banner-warning">${esc(t("m720.omitted_title"))}<ul>${omissions.map((o) => {
      const label = o.kind === "position"
        ? o.position.symbol || o.position.description || o.position.isin
        : o.kind === "cash"
          ? `${o.cashBalance.accountId} (${o.cashBalance.currency})`
          : o.security.isin;
      return `<li>${esc(label)}: ${esc(t(`m720.omitted_${o.reason}`))}</li>`;
    }).join("")}</ul></div>`;
  }

  // Generate button
  if (exceeds || positions.length > 0 || sold.length > 0) {
    html += `<button id="m720-generate-btn"${positionsDate.blocked ? " disabled" : ""}>${t("m720.generate_btn")}</button>`;
  }

  // Filing guide
  html += `<div class="filing-guide">
    <h3>${t("m720.filing_title")}</h3>
    <ol>
      <li><a href="https://sede.agenciatributaria.gob.es" target="_blank" rel="noopener">${esc(t("m720.filing_step1"))}</a></li>
      <li>${esc(t("m720.filing_step2"))}</li>
      <li>${esc(t("m720.filing_step3"))}</li>
      <li>${esc(t("m720.filing_step4"))}</li>
    </ol>
  </div>`;

  // Deadline
  html += `<div class="deadline-reminder">${t("m720.deadline")}</div>`;

  container.innerHTML = html;
  bindPrevious720Card();

  // Bind generate button
  document.getElementById("m720-generate-btn")?.addEventListener("click", () => {
    generate720File();
  });
}

/** A category bar of the section: its total, what could not be valued, and last year's comparison. */
interface Modelo720CategoryView {
  label: string;
  total: Decimal;
  exceeds: boolean;
  unvalued: number;
  successive?: Modelo720SuccessiveCategory;
  sold: number;
}

/**
 * The obligation line under a category bar: the 50,000 € threshold, or, for a
 * category last year's file declared, the 20,000 € rule and any sale of it.
 */
function categoryStatusHtml(cat: Modelo720CategoryView): string {
  // Holdings left out of the total: the category cannot be called below 50,000 € or not up 20,000 €.
  const undetermined = esc(t("m720.category_undetermined", { count: String(cat.unvalued) }));
  const s = cat.successive;
  if (!s?.declaredBefore) {
    return cat.exceeds
      ? `<p class="warning">${t("m720.category_exceeded")}</p>`
      : cat.unvalued > 0 ? `<p class="warning">${undetermined}</p>` : `<p class="muted">${t("m720.category_not_exceeded")}</p>`;
  }
  const last = `<p class="muted">${esc(t("m720.successive_last", { previous: fmtEur(s.previousTotal), change: fmtChange(s.increase) }))}</p>`;
  if (cat.exceeds && s.increaseExceeded) return `${last}<p class="warning">${esc(t("m720.successive_increase"))}</p>`;
  if (cat.sold > 0) return `${last}<p class="warning">${esc(t("m720.successive_sold"))}</p>`;
  if (cat.unvalued > 0) return `${last}<p class="warning">${undetermined}</p>`;
  return `${last}<p class="muted">${esc(t(cat.exceeds ? "m720.successive_optional" : "m720.category_not_exceeded"))}</p>`;
}

function encodeISO885915(str: string): Uint8Array {
  const ISO_MAP: Record<number, number> = {
    0x20AC: 0xA4, // €
    0x0160: 0xA6, // Š
    0x0161: 0xA8, // š
    0x017D: 0xB4, // Ž
    0x017E: 0xB8, // ž
    0x0152: 0xBC, // Œ
    0x0153: 0xBD, // œ
    0x0178: 0xBE, // Ÿ
  };
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const cp = str.charCodeAt(i);
    bytes[i] = ISO_MAP[cp] ?? (cp <= 0xFF ? cp : 0x3F); // '?' for unmappable
  }
  return bytes;
}

function generate720File(): void {
  if (!cachedStatement || !cachedRateMap) return;
  if (!isProfileComplete()) {
    const container = document.getElementById("m720-content");
    if (container && !container.querySelector(".profile-required")) {
      const banner = document.createElement("div");
      banner.className = "banner banner-warning profile-required";
      banner.innerHTML = `<span>${t("m720.profile_required")}</span> <a href="#perfil">${t("profile.go_to_profile")}</a>`;
      container.prepend(banner);
    }
    return;
  }

  const profile = getProfile();
  const fullName = `${profile.apellidos} ${profile.nombre}`.trim();

  const config = {
    nif: profile.nif,
    surname: profile.apellidos,
    name: profile.nombre,
    year: profile.year,
    phone: profile.telefono,
    contactName: fullName || "CONTRIBUYENTE",
    declarationId: modelo720DeclarationId(),
    isComplementary: false,
    isReplacement: false,
    titulares: profile.titulares,
    ...previousConfig(),
  };

  // Validate the free-text inputs (taxpayer name, contact, broker-supplied
  // entity names / descriptions) for control characters. The generator
  // sanitizes them silently into spaces, so we surface a warning here — same as
  // other 720 messages — but do NOT block generation on it.
  const textFields = [
    { label: "nombre y apellidos", value: `${profile.apellidos} ${profile.nombre}`.trim() },
    { label: "persona de contacto", value: config.contactName },
    ...cachedStatement.openPositions
      .filter((p) => p.assetCategory === "STK" || p.assetCategory === "FUND" || p.assetCategory === "BOND")
      .map((p) => ({ label: `descripción de ${p.symbol || p.isin}`, value: p.description })),
    ...(cachedStatement.cashBalances ?? [])
      .filter((cb) => cb.institutionName)
      .map((cb) => ({ label: `entidad de la cuenta ${cb.accountId}`, value: cb.institutionName ?? "" })),
  ];
  const textIssues = validateModelo720TextFields(textFields);
  if (textIssues.length > 0) {
    const container = document.getElementById("m720-content");
    if (container) {
      const existing = container.querySelector(".m720-control-char-warning");
      if (existing) existing.remove();
      const banner = document.createElement("div");
      banner.className = "banner banner-warning m720-control-char-warning";
      banner.innerHTML = textIssues.map((m) => `<span>${esc(m)}</span>`).join("<br>");
      container.prepend(banner);
    }
  }

  const result = generateModelo720(
    cachedStatement.openPositions, cachedRateMap, config, cachedYearEndLots, cachedStatement.cashBalances, cachedDisposals,
  );
  if (!result) return; // Below threshold

  const blob = new Blob([encodeISO885915(result) as BlobPart], { type: "text/plain;charset=iso-8859-15" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `modelo720_${profile.year}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Re-render if data was previously cached (for locale changes) */
export function rerenderSection720(): void {
  if (cachedStatement && cachedRateMap) {
    renderSection720(cachedStatement, cachedRateMap, cachedYearEndLots, cachedDisposals);
  }
}
