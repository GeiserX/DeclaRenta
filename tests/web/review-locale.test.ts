// @vitest-environment jsdom
/**
 * Switching language on the review step (wizard step 2) re-renders the review
 * cards in the new language. Drives the real index.html and main.ts, like
 * review-escape.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U0000001" fromDate="20250101" toDate="20251231" period="LastYear">
      <Trades><Trade tradeID="1" accountId="U0000001" symbol="ACME" description="ACME CORP"
        isin="XX0000000001" assetCategory="STK" currency="EUR"
        tradeDate="20250110" settlementDate=""
        quantity="10" tradePrice="100" tradeMoney="1000.00"
        proceeds="1000.00" cost="0" fifoPnlRealized="0" fxRateToBase="1"
        buySell="BUY" openCloseIndicator="O"
        exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" /></Trades>
      <CashTransactions />
      <CorporateActions />
      <OpenPositions />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

async function waitFor<T>(probe: () => T | null | undefined, label: string): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const v = probe();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => { store.set(key, val); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__COMMIT_HASH__", "test");
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(INDEX_HTML, "text/html")
    .documentElement.innerHTML;
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
  await import("../../src/web/main.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("review step follows a language change", () => {
  it("re-renders the review cards in English after switching from Spanish", async () => {
    const { setLocale } = await import("../../src/i18n/index.js");
    await setLocale("es");
    const file = new File([XML], "statement.xml", { type: "text/xml" });
    const input = document.getElementById("file-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
    await waitFor(() => !(document.getElementById("wizard-next") as HTMLButtonElement).disabled || null, "Next enabled");
    document.getElementById("wizard-next")!.click();
    await waitFor(() => document.querySelector("#review-content .review-grid"), "review grid");

    const labels = () =>
      [...document.querySelectorAll("#review-content .review-label")].map((el) => el.textContent);
    expect(labels()).toContain("Operaciones");

    await setLocale("en");
    expect(labels()).toContain("Trades");
    expect(labels()).toContain("Date range");
    expect(labels()).not.toContain("Operaciones");
  });
});
