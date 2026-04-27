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
    const parsed: unknown[] = JSON.parse(raw) as unknown[];
    return parsed.flatMap((item) => {
      try {
        return [migrateReport(item as Record<string, unknown>)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function migrateReport(r: Record<string, unknown>): StoredReport {
  const c = (r.casillas ?? {}) as Record<string, unknown>;
  const s = (r.stats ?? {}) as Record<string, unknown>;
  return {
    year: Number(r.year ?? 0),
    processedAt: typeof r.processedAt === "string" ? r.processedAt : "",
    brokers: Array.isArray(r.brokers) ? (r.brokers as string[]) : [],
    tradesCount: Number(r.tradesCount ?? 0),
    casillas: {
      transmissionValue: Number(c.transmissionValue ?? 0),
      acquisitionValue: Number(c.acquisitionValue ?? 0),
      netGainLoss: Number(c.netGainLoss ?? 0),
      blockedLosses: Number(c.blockedLosses ?? 0),
      fxNetGainLoss: Number(c.fxNetGainLoss ?? 0),
      grossDividends: Number(c.grossDividends ?? 0),
      interestEarned: Number(c.interestEarned ?? 0),
      interestPaid: Number(c.interestPaid ?? 0),
      doubleTaxation: Number(c.doubleTaxation ?? 0),
    },
    stats: {
      disposalsCount: Number(s.disposalsCount ?? 0),
      fxDisposalsCount: Number(s.fxDisposalsCount ?? 0),
      dividendsCount: Number(s.dividendsCount ?? 0),
      warningsCount: Number(s.warningsCount ?? 0),
      currencies: Array.isArray(s.currencies) ? (s.currencies as string[]) : [],
    },
  };
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
