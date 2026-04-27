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

/** Load all stored reports */
export function loadAllReports(): StoredReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredReport[];
  } catch {
    return [];
  }
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
