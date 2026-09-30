/**
 * localStorage round-trip for the year-comparison snapshots.
 *
 * saveReport reads every stored year back through loadAllReports (and so
 * through migrateReport) before writing the array again. A casillas field that
 * migrateReport forgets is therefore lost on load AND erased from every earlier
 * year the next time any year is saved.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { saveReport, loadAllReports, migrateReport, type StoredReport } from "../../src/web/storage.js";

const STORAGE_KEY = "declarenta_reports";

function stubLocalStorage(): Record<string, string> {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    removeItem: (key: string) => { delete store[key]; },
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    clear: () => { Object.keys(store).forEach((k) => { delete store[k]; }); },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
  return store;
}

function makeStored(year: number, casillas: Partial<StoredReport["casillas"]> = {}): StoredReport {
  return {
    year,
    processedAt: `${year + 1}-04-01T00:00:00.000Z`,
    brokers: ["IBKR"],
    tradesCount: 1,
    casillas: {
      transmissionValue: 1000,
      acquisitionValue: 800,
      netGainLoss: 200,
      blockedLosses: 0,
      fxNetGainLoss: 0,
      grossDividends: 0,
      interestEarned: 55.5,
      interestPaid: 0,
      doubleTaxation: 0,
      ...casillas,
    },
    stats: { disposalsCount: 1, fxDisposalsCount: 0, dividendsCount: 0, warningsCount: 0, currencies: ["EUR"] },
  };
}

let store: Record<string, string>;

beforeEach(() => {
  store = stubLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storage round-trip", () => {
  it("keeps a field migrateReport already knew (control)", () => {
    saveReport(makeStored(2024));
    expect(loadAllReports()[0]!.casillas.interestEarned).toBe(55.5);
  });

  it("keeps generalGains (casilla 0304) on load", () => {
    saveReport(makeStored(2024, { generalGains: 1234.5 }));
    expect(loadAllReports()[0]!.casillas.generalGains).toBe(1234.5);
  });

  it("keeps an earlier year's generalGains when a second year is saved", () => {
    saveReport(makeStored(2024, { generalGains: 1234.5 }));
    saveReport(makeStored(2025, { generalGains: 10 }));

    const raw = JSON.parse(store[STORAGE_KEY]!) as StoredReport[];
    expect(raw.find((r) => r.year === 2024)!.casillas.generalGains).toBe(1234.5);
    expect(raw.find((r) => r.year === 2025)!.casillas.generalGains).toBe(10);

    const loaded = loadAllReports();
    expect(loaded.find((r) => r.year === 2024)!.casillas.generalGains).toBe(1234.5);
  });

  it("still migrates a record saved before generalGains existed", () => {
    const legacy = makeStored(2023) as unknown as Record<string, unknown>;
    expect("generalGains" in (legacy.casillas as object)).toBe(false);
    const migrated = migrateReport(legacy);
    expect(migrated.casillas.generalGains ?? 0).toBe(0);
    expect(migrated.casillas.netGainLoss).toBe(200);
  });
});
