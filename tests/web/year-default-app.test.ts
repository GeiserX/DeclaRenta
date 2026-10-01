// @vitest-environment jsdom
/**
 * The year the app opens on, driven through the real app (index.html and
 * main.ts). With activity in the last closed year and in the current one, the
 * Results step must open on the last closed year, whatever year the saved
 * profile holds, and say that the data also covers the current year.
 * All amounts are in EUR so no ECB request is needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");
const NOW = new Date().getFullYear();
const LAST_CLOSED = NOW - 1;

function buy(id: string, tradeDate: string): string {
  return `<Trade tradeID="${id}" accountId="U0000001" symbol="ACME" description="ACME CORP"
    isin="XX0000000001" assetCategory="STK" currency="EUR"
    tradeDate="${tradeDate}" settlementDate=""
    quantity="10" tradePrice="100" tradeMoney="1000.00"
    proceeds="-1000.00" cost="0" fifoPnlRealized="0" fxRateToBase="1"
    buySell="BUY" openCloseIndicator="O"
    exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />`;
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U0000001" fromDate="${LAST_CLOSED}0101" toDate="${NOW}0102" period="YearToDate">
      <Trades>${buy("1", `${LAST_CLOSED}0310`)}${buy("2", `${NOW}0102`)}</Trades>
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

const byId = (id: string) => document.getElementById(id)!;
const nextBtn = () => byId("wizard-next") as HTMLButtonElement;

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

beforeEach(() => {
  vi.resetModules();
  const storage = memoryStorage();
  storage.setItem("locale", "es");
  // A year left over from an earlier session: it must not decide the default.
  storage.setItem("declarenta_profile", JSON.stringify({ year: NOW - 3 }));
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__COMMIT_HASH__", "test");
  document.documentElement.innerHTML = new DOMParser().parseFromString(INDEX_HTML, "text/html").documentElement.innerHTML;
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("default year after an upload", () => {
  it("opens Results on the last closed year and names the newer one", async () => {
    await import("../../src/web/main.js");
    const input = byId("file-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([XML], "ibkr.xml", { type: "text/xml" })], configurable: true });
    input.dispatchEvent(new Event("change"));
    await waitFor(() => !nextBtn().disabled || null, "Next enabled");
    nextBtn().click();
    await waitFor(() => byId("review-content").querySelector(".review-grid"), "review grid");
    nextBtn().click();
    const select = await waitFor(
      () => (!byId("wizard-step-3").hidden ? document.querySelector<HTMLSelectElement>("#results-year-select") : null),
      "results year select",
    );

    expect(select.value).toBe(String(LAST_CLOSED));
    expect(document.querySelector(".year-newer-notice")?.textContent).toContain(String(NOW));
  });
});
