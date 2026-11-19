// @vitest-environment jsdom
/**
 * The «Plazo anti-churning por valor» panel (#452), driven through the real app.
 *
 * The statement is the issue example on the London Stock Exchange: buy, sell at
 * a loss, rebuy 5 months later. IBKR's listing exchange gives it 1 year, so the
 * panel opens by itself; marking 2 months saves to localStorage and reruns the
 * report. The symbol carries markup to prove every broker value is escaped.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderAntichurningWindowPanel } from "../../src/web/antichurning-window.js";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");
const YEAR = new Date().getFullYear() - 1; // the profile's default declaration year
const ISIN = "GB0007980591";
const KEY = "declarenta_antichurning_windows";

const row = (id: string, date: string, qty: number, price: number) => {
  const side = qty > 0 ? "BUY" : "SELL";
  const money = (Math.abs(qty) * price).toFixed(2);
  return `<Trade tradeID="${id}" accountId="U0000001" symbol="LSE&lt;img src=x onerror=alert(1)&gt;" description="LONDON ONLY PLC"
    isin="${ISIN}" assetCategory="STK" currency="EUR" tradeDate="${YEAR}${date}" settlementDate=""
    quantity="${qty}" tradePrice="${price}" tradeMoney="${side === "BUY" ? money : `-${money}`}" proceeds="${side === "BUY" ? `-${money}` : money}"
    cost="0" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}"
    exchange="LSE" listingExchange="LSE" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />`;
};

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U0000001" fromDate="${YEAR}0101" toDate="${YEAR}1231" period="LastYear">
      <Trades>${row("1", "0201", 1, 100)}${row("2", "0301", -1, 80)}${row("3", "0801", 1, 85)}</Trades>
      <CashTransactions />
      <CorporateActions />
      <OpenPositions />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

async function waitFor<T>(probe: () => T | null | undefined, label: string): Promise<T> {
  for (let i = 0; i < 300; i++) {
    const v = probe();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function openResults(): Promise<void> {
  const file = new File([XML], "statement.xml", { type: "text/xml" });
  const input = document.getElementById("file-input") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
  await waitFor(() => !(document.getElementById("wizard-next") as HTMLButtonElement).disabled || null, "Next enabled");
  document.getElementById("wizard-next")!.click();
  await waitFor(() => document.querySelector("#review-content .review-grid"), "review grid");
  document.getElementById("wizard-next")!.click();
  await waitFor(() => document.querySelector("#operations-table table"), "operations table");
}

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

const panel = () => document.querySelector<HTMLDetailsElement>("#wizard-step-3 .antichurning-window-panel");
const select = () => panel()?.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${ISIN}']`);

describe("anti-churning window panel in the app", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("__APP_VERSION__", "test");
    vi.stubGlobal("__COMMIT_HASH__", "test");
    document.documentElement.innerHTML = new DOMParser().parseFromString(INDEX_HTML, "text/html").documentElement.innerHTML;
    Element.prototype.scrollIntoView = () => {};
    vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
    await import("../../src/web/main.js");
    await openResults();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens by itself with the IBKR 1-year reading, and escapes the broker's symbol", async () => {
    const p = await waitFor(panel, "window panel");
    expect(p.open).toBe(true);
    expect(select()!.value).toBe("auto");
    expect(select()!.selectedOptions[0]!.textContent).toMatch(/1 (año|year)/);
    expect(p.textContent).toContain("LSE");
    expect(p.querySelector("img")).toBeNull();
    expect(p.innerHTML).toContain("&lt;img");
  });

  it("marking 2 months saves the ISIN and reruns: the row then shows the user's value", async () => {
    await waitFor(panel, "window panel");
    select()!.value = "2";
    panel()!.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toEqual({ [ISIN]: 2 });
    await waitFor(() => (select()?.value === "2" ? select() : null), "rerun with the user's value");
    // The automatic option still says what IBKR would give.
    expect(select()!.querySelector("option[value='auto']")!.textContent).toMatch(/1 (año|year)/);
  });

  it("clear removes every saved window and reruns", async () => {
    await waitFor(panel, "window panel");
    select()!.value = "12";
    panel()!.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    await waitFor(() => (select()?.value === "12" ? select() : null), "rerun with 12");
    panel()!.querySelector<HTMLButtonElement>(".antichurning-window-clear")!.click();
    expect(localStorage.getItem(KEY)).toBeNull();
    await waitFor(() => (select()?.value === "auto" ? select() : null), "rerun with auto");
  });

  it("ignores garbage someone left in the storage key", async () => {
    localStorage.setItem(KEY, JSON.stringify({ __proto__: 12, XX1: 12, [ISIN]: "12" }));
    const { getWindowOverrides } = await import("../../src/web/antichurning-window.js");
    expect(getWindowOverrides()).toEqual({});
    localStorage.setItem(KEY, "{not json");
    expect(getWindowOverrides()).toEqual({});
  });
});

describe("renderAntichurningWindowPanel", () => {
  it("renders nothing with no security", () => {
    expect(renderAntichurningWindowPanel([])).toBe("");
    expect(renderAntichurningWindowPanel(undefined)).toBe("");
  });

  it("stays closed when every row is the plain default, and flags an open decision", () => {
    const base = { isin: ISIN, symbol: "BP", description: "BP", months: 2 as const, source: "default" as const, autoMonths: 2 as const, listingExchanges: [] };
    expect(renderAntichurningWindowPanel([base])).not.toContain(" open>");
    const open = renderAntichurningWindowPanel([{ ...base, listingExchanges: ["TSE"], source: "ibkr", openDecision: "2016/2273" }]);
    expect(open).toContain(" open>");
    expect(open).toContain("2016/2273");
  });
});
