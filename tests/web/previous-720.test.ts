/**
 * The memory of the 720 files generated in this browser: what each declared,
 * per category, so next year's file writes M for what is still held and C for
 * what was sold, and the 20,000 € rule has a base to compare against.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Decimal from "decimal.js";
import { forget720History, recall720, remember720 } from "../../src/web/previous-720.js";

const KEY = "declarenta_720_history";

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => {
      store.set(key, val);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
}

/** A type-2 record with the fields readPrevious720 and remember720 look at. */
function detail(opts: { clave: string; origin: string; isin?: string; country?: string; account?: string }): string {
  const r = Array.from({ length: 500 }, () => " ");
  const put = (start: number, text: string) => {
    for (let i = 0; i < text.length; i++) r[start - 1 + i] = text.charAt(i);
  };
  put(1, "2720");
  put(102, opts.clave);
  put(129, opts.country ?? "  ");
  if (opts.isin) put(132, opts.isin);
  if (opts.account) put(156, opts.account);
  put(423, opts.origin);
  return r.join("");
}

const SUMMARY = "1720" + " ".repeat(496);
const totals = (values: string, accounts = "0") => ({ values: new Decimal(values), accounts: new Decimal(accounts) });

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("remember720 / recall720", () => {
  it("returns nothing before any file was generated", () => {
    expect(recall720(2025)).toEqual({ values: null, accounts: null });
  });

  it("recalls what the previous year's file declared, without its own cancellations", () => {
    const file = [
      SUMMARY,
      detail({ clave: "V1", origin: "A", isin: "US0378331005", country: "US" }),
      detail({ clave: "I ", origin: "M", isin: "IE00B4L5Y983", country: "IE" }),
      detail({ clave: "V1", origin: "C", isin: "DE0007164600", country: "DE" }),
      detail({ clave: "C ", origin: "A", country: "IE", account: "U1234567" }),
    ].join("\n");
    remember720(2024, file, totals("70000.5", "60000"));

    const r = recall720(2025);
    expect(r.values?.year).toBe(2024);
    expect(r.values?.securities).toEqual([
      { isin: "US0378331005", claveSubclave: "V1", country: "US" },
      { isin: "IE00B4L5Y983", claveSubclave: "I ", country: "IE" },
    ]);
    expect(r.values?.total.toString()).toBe("70000.5");
    expect(r.accounts).toEqual({ year: 2024, codes: ["U1234567"], total: new Decimal(60000) });
  });

  it("never feeds a year with its own file or a later one", () => {
    remember720(2025, [SUMMARY, detail({ clave: "V1", origin: "A", isin: "US0378331005", country: "US" })].join("\n"), totals("60000"));
    expect(recall720(2025).values).toBeNull();
    expect(recall720(2024).values).toBeNull();
    expect(recall720(2026).values?.year).toBe(2025);
  });

  it("takes each category from the latest earlier year that declared it", () => {
    remember720(2023, [SUMMARY, detail({ clave: "V1", origin: "A", isin: "US0378331005", country: "US" })].join("\n"), totals("80000"));
    // 2024 declared only accounts: the securities declared in 2023 still count
    remember720(2024, [SUMMARY, detail({ clave: "C ", origin: "A", country: "IE", account: "U1234567" })].join("\n"), totals("30000", "55000"));

    const r = recall720(2025);
    expect(r.values?.year).toBe(2023);
    expect(r.values?.securities.map((s) => s.isin)).toEqual(["US0378331005"]);
    expect(r.accounts?.year).toBe(2024);
  });

  it("keeps a year whose file only cancels securities: nothing is held any more", () => {
    remember720(2023, [SUMMARY, detail({ clave: "V1", origin: "A", isin: "US0378331005", country: "US" })].join("\n"), totals("80000"));
    remember720(2024, [SUMMARY, detail({ clave: "V1", origin: "C", isin: "US0378331005", country: "US" })].join("\n"), totals("0"));
    expect(recall720(2025).values).toMatchObject({ year: 2024, securities: [] });
  });

  it("generating the same year again replaces it", () => {
    remember720(2024, [SUMMARY, detail({ clave: "V1", origin: "A", isin: "US0378331005", country: "US" })].join("\n"), totals("60000"));
    remember720(2024, [SUMMARY, detail({ clave: "V1", origin: "A", isin: "IE00B4L5Y983", country: "IE" })].join("\n"), totals("61000"));
    expect(recall720(2025).values?.securities.map((s) => s.isin)).toEqual(["IE00B4L5Y983"]);
  });

  it("stores nothing for an empty file", () => {
    remember720(2024, "", totals("0"));
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("ignores corrupted storage instead of throwing", () => {
    localStorage.setItem(KEY, "not-json{{{");
    expect(recall720(2025)).toEqual({ values: null, accounts: null });
    localStorage.setItem(KEY, JSON.stringify({ 2024: { values: { securities: [{ isin: 1 }, null], total: "abc" } } }));
    expect(recall720(2025).values).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ 2024: { values: { securities: [{ isin: 1 }, { isin: "US0378331005", claveSubclave: "V1", country: "US" }], total: "5" } } }));
    expect(recall720(2025).values?.securities.map((s) => s.isin)).toEqual(["US0378331005"]);
  });

  it("forget720History clears everything", () => {
    remember720(2024, [SUMMARY, detail({ clave: "V1", origin: "A", isin: "US0378331005", country: "US" })].join("\n"), totals("60000"));
    forget720History();
    expect(recall720(2025)).toEqual({ values: null, accounts: null });
  });
});
