// @vitest-environment jsdom
/**
 * The results page must not do work the user has not asked for yet:
 *
 * - The operations search rebuilds the whole table, so typing waits for a
 *   pause (150 ms) and renders once, not once per keystroke.
 * - Each casilla card's drill-down lists every contributing operation, so it
 *   is built on the first expand, not for every card up front.
 * - The service worker is registered under the build's commit hash, so each
 *   deploy installs a new worker and its activate step clears the old caches.
 * - A saved non-Spanish locale is loaded before the first render.
 *
 * This drives the real app: the real index.html markup, the real main.ts, a
 * File handed to #file-input, and the wizard's Next button. All amounts are in
 * EUR so no ECB request is needed (fetch is stubbed to fail if one is made).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");

function flexXml(trades: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U0000001" fromDate="20250101" toDate="20251231" period="LastYear">
      <Trades>${trades}</Trades>
      <CashTransactions />
      <CorporateActions />
      <OpenPositions />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;
}

function trade(id: string, side: "BUY" | "SELL", tradeDate: string): string {
  const qty = side === "BUY" ? "10" : "-10";
  const money = side === "BUY" ? "1000.00" : "-1200.00";
  return `<Trade tradeID="${id}" accountId="U0000001" symbol="ACME" description="ACME CORP"
    isin="XX0000000001" assetCategory="STK" currency="EUR"
    tradeDate="${tradeDate}" settlementDate=""
    quantity="${qty}" tradePrice="${side === "BUY" ? "100" : "120"}" tradeMoney="${money}"
    proceeds="${money}" cost="0" fifoPnlRealized="0" fxRateToBase="1"
    buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}"
    exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />`;
}

async function waitFor<T>(probe: () => T | null | undefined, label: string): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const v = probe();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function toResults(): Promise<void> {
  const xml = flexXml(trade("1", "BUY", "20250110") + trade("2", "SELL", "20250310"));
  const file = new File([xml], "statement.xml", { type: "text/xml" });
  const input = document.getElementById("file-input") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
  await waitFor(() => !(document.getElementById("wizard-next") as HTMLButtonElement).disabled || null, "Next enabled");
  document.getElementById("wizard-next")!.click();
  await waitFor(() => document.querySelector("#review-content .review-grid"), "review grid");
  document.getElementById("wizard-next")!.click();
  await waitFor(() => document.querySelector("#operations-table table"), "operations table");
}

/** In-memory localStorage (newer Node versions shadow jsdom's with their own). */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => { store.set(key, val); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
}

const register = vi.fn(() => Promise.resolve());

async function loadApp(storage: Record<string, string> = {}): Promise<void> {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage(storage));
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__COMMIT_HASH__", "test");
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(INDEX_HTML, "text/html")
    .documentElement.innerHTML;
  Element.prototype.scrollIntoView = () => {}; // jsdom has no scrollIntoView; the wizard calls it
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
  Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });
  await import("../../src/web/main.js");
}

beforeEach(() => {
  register.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

describe("operations search", () => {
  it("rapid typing renders the table once, after the pause", async () => {
    await loadApp();
    await toResults();
    const opsTable = document.getElementById("operations-table")!;
    expect(opsTable.textContent).toContain("ACME");

    const renders: MutationRecord[] = [];
    const observer = new MutationObserver((records) => { renders.push(...records); });
    observer.observe(opsTable, { childList: true });

    const search = document.getElementById("ops-search") as HTMLInputElement;
    for (const value of ["z", "zz", "zzz"]) {
      search.value = value;
      search.dispatchEvent(new Event("input"));
    }
    await Promise.resolve(); // flush any MutationObserver records from the keystrokes
    expect(renders).toHaveLength(0);
    expect(opsTable.textContent).toContain("ACME");

    await waitFor(() => renders.length > 0 || null, "the debounced render");
    await new Promise((r) => setTimeout(r, 200)); // no second render trails in
    observer.disconnect();
    expect(renders).toHaveLength(1);
    expect(opsTable.textContent).not.toContain("ACME");
  });
});

describe("casilla drill-downs", () => {
  it("stay empty until expanded, then list the disposals", async () => {
    await loadApp();
    await toResults();
    const casillas = document.getElementById("casillas")!;
    const details = [...casillas.querySelectorAll<HTMLElement>(".casilla-detail")];
    expect(details.length).toBeGreaterThan(0);
    for (const d of details) expect(d.innerHTML).toBe("");

    const card = [...casillas.querySelectorAll<HTMLElement>(".casilla-card")]
      .find((c) => c.querySelector(".casilla-code")?.textContent === "0328")!;
    const detail = card.querySelector<HTMLElement>(".casilla-detail")!;
    card.querySelector<HTMLButtonElement>(".casilla-trigger")!.click();
    expect(detail.hidden).toBe(false);
    expect(detail.querySelector(".detail-table tbody tr")?.textContent).toContain("ACME");

    // Collapsing and reopening keeps the same content and does not rebuild it.
    const table = detail.querySelector(".detail-table");
    card.querySelector<HTMLButtonElement>(".casilla-trigger")!.click();
    card.querySelector<HTMLButtonElement>(".casilla-trigger")!.click();
    expect(detail.hidden).toBe(false);
    expect(detail.querySelector(".detail-table")).toBe(table);
  });
});

describe("service worker", () => {
  it("is registered under the build's commit hash", async () => {
    await loadApp();
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith("./sw.js?v=test");
  });
});

describe("saved locale", () => {
  it("is in place before the first render", async () => {
    await loadApp({ locale: "eu" });
    expect(document.documentElement.lang).toBe("eu");
    expect((document.getElementById("lang-select") as HTMLSelectElement).value).toBe("eu");
    expect(document.querySelector('[data-i18n="app.subtitle"]')?.textContent)
      .toBe("Atzerriko brokerra → Espainiako errenta");
  });
});
