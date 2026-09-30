/**
 * localStorage round-trip for the year-comparison snapshots.
 *
 * saveReport reads every stored year back through loadAllReports (and so
 * through migrateReport) before writing the array again. A casillas field that
 * migrateReport forgets is therefore lost on load AND erased from every earlier
 * year the next time any year is saved.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  saveReport, loadAllReports, migrateReport, clearAllReports, clearLocalData, LOCAL_DATA_KEYS, type StoredReport,
} from "../../src/web/storage.js";
import { saveProfile, getProfile } from "../../src/web/profile.js";

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

/**
 * The profile form auto-saves NIF, name and phone on every keystroke, so the
 * app must offer a way to delete everything it stored in this browser. The
 * year-comparison button clears the saved reports only.
 */
describe("clearLocalData", () => {
  function seedEverything(): void {
    saveProfile({ ...getProfile(), nif: "00000000T", apellidos: "Prueba", nombre: "Ana", telefono: "600000000" });
    saveReport(makeStored(2024));
    store.declarenta_manual_rates = JSON.stringify([{ currency: "SOL", date: "2024-04-01", eurPerUnit: "100" }]);
    store.declarenta_manual_opening_lots = JSON.stringify([{ symbol: "ACME", quantity: "10", priceEur: "100" }]);
    store.theme = "dark";
    store.locale = "en";
  }

  it("clearAllReports leaves the profile and the manual entries behind (control)", () => {
    seedEverything();
    clearAllReports();
    expect(store[STORAGE_KEY]).toBeUndefined();
    expect(getProfile().nif).toBe("00000000T");
    expect(store.declarenta_manual_rates).toBeDefined();
    expect(store.declarenta_manual_opening_lots).toBeDefined();
  });

  it("removes the profile, the reports, the manual rates and the opening lots", () => {
    seedEverything();
    clearLocalData();
    expect(localStorage.getItem("declarenta_profile")).toBeNull();
    expect(localStorage.getItem("declarenta_reports")).toBeNull();
    expect(localStorage.getItem("declarenta_manual_rates")).toBeNull();
    expect(localStorage.getItem("declarenta_manual_opening_lots")).toBeNull();
    expect(getProfile().nif).toBe("");
    expect(getProfile().telefono).toBe("");
    // Display preferences are not user data and survive.
    expect(store.theme).toBe("dark");
    expect(store.locale).toBe("en");
  });

  it("covers every declarenta_* storage key the web app uses", () => {
    // A new localStorage key must be added to LOCAL_DATA_KEYS, or the delete
    // button would leave it behind. declarenta_debug is a developer switch.
    const dir = resolve(__dirname, "../../src/web");
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      for (const m of readFileSync(resolve(dir, f), "utf-8").matchAll(/"(declarenta_[a-z_]+)"/g)) used.add(m[1]!);
    }
    used.delete("declarenta_debug");
    expect(used.size).toBeGreaterThanOrEqual(4);
    expect([...used].sort()).toEqual([...LOCAL_DATA_KEYS].sort());
  });
});
