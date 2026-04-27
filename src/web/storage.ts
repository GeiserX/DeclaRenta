/**
 * localStorage persistence for DeclaRenta reports.
 *
 * Stores processed tax reports keyed by year so users can
 * compare results across multiple tax years.
 */

const STORAGE_KEY = "declarenta_reports";

/** Serializable version of a report for localStorage */
export interface StoredReport {
  year: number;
  processedAt: string;
  brokers: string[];
  tradesCount: number;
  /** Casilla values as plain numbers (Decimal → number for serialization) */
  casillas: {
    transmissionValue: number;
    acquisitionValue: number;
    netGainLoss: number;
    blockedLosses: number;
    fxNetGainLoss: number;
    grossDividends: number;
    interestEarned: number;
    interestPaid: number;
    doubleTaxation: number;
  };
  /** Summary stats */
  stats: {
    disposalsCount: number;
    fxDisposalsCount: number;
    dividendsCount: number;
    warningsCount: number;
    currencies: string[];
  };
}

/** Save a report to localStorage */
export function saveReport(report: StoredReport): void {
  const existing = loadAllReports();
  // Replace if same year exists
  const idx = existing.findIndex((r) => r.year === report.year);
  if (idx >= 0) {
    existing[idx] = report;
  } else {
    existing.push(report);
  }
  existing.sort((a, b) => b.year - a.year);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // localStorage full or unavailable — fail silently
  }
}

/** Load all stored reports, migrating older schemas to current */
export function loadAllReports(): StoredReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const reports = JSON.parse(raw) as StoredReport[];
    return reports.map(migrateReport);
  } catch {
    return [];
  }
}

function migrateReport(r: StoredReport): StoredReport {
  const c = r.casillas;
  c.fxNetGainLoss ??= 0;
  c.blockedLosses ??= 0;
  c.interestEarned ??= 0;
  c.interestPaid ??= 0;
  c.doubleTaxation ??= 0;
  const s = r.stats;
  s.fxDisposalsCount ??= 0;
  s.warningsCount ??= 0;
  s.currencies ??= [];
  return r;
}

/** Load a single report by year */
export function loadReport(year: number): StoredReport | undefined {
  return loadAllReports().find((r) => r.year === year);
}

/** Clear all stored reports */
export function clearAllReports(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Get years that have stored reports */
export function getStoredYears(): number[] {
  return loadAllReports().map((r) => r.year);
}
