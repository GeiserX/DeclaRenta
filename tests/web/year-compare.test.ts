// @vitest-environment jsdom
/**
 * Year comparison: what gets stored, and how the table shows it.
 *
 * - A year whose only income is interest, FX or base-general crypto rewards is
 *   still a year worth comparing, and re-processing a year must replace the
 *   earlier snapshot for it.
 * - The divider row spans exactly the table's columns.
 * - A rise is green only where more is better: more margin interest paid is a
 *   cost, and the transmission/acquisition totals have no good direction.
 * - The comparison's net row excludes FX, so it must not share the label of the
 *   results-page net figure, which includes FX.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Decimal from "decimal.js";
import { persistReport, renderYearComparison } from "../../src/web/year-compare.js";
import { saveReport, loadAllReports, type StoredReport } from "../../src/web/storage.js";
import { t } from "../../src/i18n/index.js";
import type { TaxSummary, FifoDisposal } from "../../src/types/tax.js";

const D = (v: number | string) => new Decimal(v);

function stubLocalStorage(): void {
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
}

function emptySummary(year: number): TaxSummary {
  return {
    year,
    warnings: [],
    messages: [],
    capitalGains: {
      transmissionValue: D(0),
      acquisitionValue: D(0),
      netGainLoss: D(0),
      blockedLosses: D(0),
      reintegratedLosses: D(0),
      disposals: [],
    },
    dividends: { grossIncome: D(0), deductibleExpenses: D(0), spanishWithholding: D(0), entries: [] },
    interest: { earned: D(0), paid: D(0), entries: [] },
    generalGains: { total: D(0), entries: [] },
    doubleTaxation: { deduction: D(0), byCountry: {} },
    fxGains: { transmissionValue: D(0), acquisitionValue: D(0), netGainLoss: D(0), disposals: [] },
  };
}

function interestOnly(year: number, earned: number): TaxSummary {
  const s = emptySummary(year);
  s.interest = {
    earned: D(earned),
    paid: D(0),
    entries: [{ type: "earned", description: "Interest", date: `${year}-06-30`, amountEur: D(earned), currency: "EUR", ecbRate: D(1) }],
  };
  return s;
}

function dividendOnly(year: number, gross: number): TaxSummary {
  const s = emptySummary(year);
  s.dividends = {
    grossIncome: D(gross),
    deductibleExpenses: D(0),
    spanishWithholding: D(0),
    entries: [{
      isin: "US0378331005", symbol: "AAPL", description: "APPLE INC dividend", payDate: `${year}0213`,
      grossAmountEur: D(gross), withholdingTaxEur: D(0), withholdingCountry: "US", currency: "USD", ecbRate: D(0.92),
    }],
  };
  return s;
}

function generalGainsOnly(year: number, total: number): TaxSummary {
  const s = emptySummary(year);
  s.generalGains = {
    total: D(total),
    entries: [{ description: "Airdrop", date: `${year}-03-01`, amountEur: D(total), symbol: "XYZ", currency: "XYZ", ecbRate: D(1) }],
  };
  return s;
}

function fxOnly(year: number, gain: number): TaxSummary {
  const s = emptySummary(year);
  s.fxGains = {
    transmissionValue: D(1000 + gain),
    acquisitionValue: D(1000),
    netGainLoss: D(gain),
    disposals: [{
      currency: "USD", disposeDate: `${year}-05-01`, acquireDate: `${year}-01-02`, quantity: D(1100),
      proceedsEur: D(1000 + gain), costBasisEur: D(1000), gainLossEur: D(gain), trigger: "conversion",
      holdingPeriodDays: 119, lotId: "L1",
    }],
  };
  return s;
}

function stored(year: number, casillas: Partial<StoredReport["casillas"]>): StoredReport {
  return {
    year,
    processedAt: `${year + 1}-04-01T00:00:00.000Z`,
    brokers: ["IBKR"],
    tradesCount: 1,
    casillas: {
      transmissionValue: 0, acquisitionValue: 0, netGainLoss: 0, blockedLosses: 0, fxNetGainLoss: 0,
      grossDividends: 0, interestEarned: 0, interestPaid: 0, doubleTaxation: 0,
      ...casillas,
    },
    stats: { disposalsCount: 1, fxDisposalsCount: 0, dividendsCount: 0, warningsCount: 0, currencies: ["EUR"] },
  };
}

beforeEach(() => {
  stubLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("persistReport", () => {
  it("does not store a report with nothing in it (control)", () => {
    persistReport(emptySummary(2024), ["IBKR"]);
    expect(loadAllReports()).toEqual([]);
  });

  it("stores a year whose only income is interest", () => {
    persistReport(interestOnly(2024, 40), ["IBKR"]);
    const reports = loadAllReports();
    expect(reports.map((r) => r.year)).toEqual([2024]);
    expect(reports[0]!.casillas.interestEarned).toBe(40);
  });

  it("stores a year whose only income is an FX gain", () => {
    persistReport(fxOnly(2024, 100), ["IBKR"]);
    expect(loadAllReports()[0]?.casillas.fxNetGainLoss).toBe(100);
  });

  it("stores a year whose only income is a base-general crypto reward", () => {
    persistReport(generalGainsOnly(2024, 1234.5), ["Binance"]);
    expect(loadAllReports()[0]?.casillas.generalGains).toBe(1234.5);
  });

  it("replaces an earlier snapshot when the year is re-run with interest only", () => {
    persistReport(dividendOnly(2024, 100), ["Broker A"]);
    persistReport(interestOnly(2024, 40), ["Broker B"]);
    const reports = loadAllReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]!.brokers).toEqual(["Broker B"]);
    expect(reports[0]!.casillas.grossDividends).toBe(0);
    expect(reports[0]!.casillas.interestEarned).toBe(40);
  });

  it("keeps an earlier year's generalGains after a later year is processed", () => {
    persistReport(generalGainsOnly(2024, 1234.5), ["Binance"]);
    persistReport(dividendOnly(2025, 100), ["IBKR"]);
    expect(loadAllReports().find((r) => r.year === 2024)?.casillas.generalGains).toBe(1234.5);
  });

  it("still stores an ordinary disposal year (control)", () => {
    const s = emptySummary(2024);
    const disposal = { currency: "EUR" } as FifoDisposal;
    s.capitalGains = { ...s.capitalGains, transmissionValue: D(1000), acquisitionValue: D(800), netGainLoss: D(200), disposals: [disposal] };
    persistReport(s, ["IBKR"]);
    expect(loadAllReports()[0]?.casillas.netGainLoss).toBe(200);
  });
});

describe("renderYearComparison", () => {
  function renderThree(): HTMLElement {
    saveReport(stored(2023, { interestPaid: 50, acquisitionValue: 1000, transmissionValue: 1000, interestEarned: 10 }));
    saveReport(stored(2024, { interestPaid: 100, acquisitionValue: 2000, transmissionValue: 2000, interestEarned: 20 }));
    saveReport(stored(2025, { interestPaid: 200, acquisitionValue: 4000, transmissionValue: 4000, interestEarned: 40 }));
    const container = document.createElement("div");
    renderYearComparison(container);
    return container;
  }

  function rowByLabel(container: HTMLElement, label: string): HTMLTableRowElement {
    const rows = [...container.querySelectorAll<HTMLTableRowElement>("tbody tr")];
    const row = rows.find((r) => r.querySelector(".row-label")?.textContent === label);
    expect(row, `row "${label}"`).toBeDefined();
    return row!;
  }

  function variationCells(row: HTMLTableRowElement, years: number): HTMLTableCellElement[] {
    return [...row.querySelectorAll("td")].slice(1 + years);
  }

  it("the divider row spans exactly the header's columns", () => {
    const container = renderThree();
    const thCount = container.querySelectorAll("thead th").length;
    const divider = container.querySelector<HTMLTableCellElement>(".stats-divider td")!;
    expect(thCount).toBe(6);
    expect(divider.colSpan).toBe(thCount);
  });

  it("colours a rise in interest earned as a gain (control)", () => {
    const cells = variationCells(rowByLabel(renderThree(), t("casilla.interest_earned")), 3);
    expect(cells.map((c) => c.className)).toEqual(["gain", "gain"]);
  });

  it("does not colour a rise in margin interest paid as a gain", () => {
    const cells = variationCells(rowByLabel(renderThree(), t("casilla.interest_paid")), 3);
    expect(cells).toHaveLength(2);
    for (const c of cells) expect(c.classList.contains("gain")).toBe(false);
  });

  it("gives no direction colour to the transmission and acquisition totals", () => {
    const container = renderThree();
    for (const key of ["compare.transmission_value", "compare.acquisition_value"] as const) {
      const cells = variationCells(rowByLabel(container, t(key)), 3);
      expect(cells).toHaveLength(2);
      for (const c of cells) expect(c.className).toBe("");
    }
  });

  it("labels the net row with its scope, not the results-page label that includes FX", () => {
    const container = renderThree();
    const labels = [...container.querySelectorAll(".row-label")].map((el) => el.textContent);
    expect(labels).not.toContain(t("casilla.net_gain_loss"));
    expect(labels).toContain(t("compare.net_gain_loss"));
    expect(t("compare.net_gain_loss")).not.toBe("compare.net_gain_loss");
  });
});
