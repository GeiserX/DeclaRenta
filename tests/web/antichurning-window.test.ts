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
import { bindAntichurningWindowPanel, renderAntichurningWindowPanel } from "../../src/web/antichurning-window.js";
import type { AntichurningSecurity } from "../../src/types/tax.js";

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
const blockedRow = () => document.querySelector("#operations-table tr.wash-sale-blocked");

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

  it("marking 2 months saves the ISIN and reruns: the loss is no longer blocked and the row shows the user's value", async () => {
    const before = await waitFor(panel, "window panel");
    expect(blockedRow()).not.toBeNull(); // 1 year from IBKR: the 01/08 rebuy blocks the loss
    select()!.value = "2";
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toEqual({ [ISIN]: 2 });
    // Wait for the rerun: a new panel, and a calculation without the block.
    await waitFor(() => (panel() && panel() !== before && !blockedRow() ? panel() : null), "rerun with 2 months");
    expect(select()!.value).toBe("2");
    // The automatic option still says what IBKR would give.
    expect(select()!.querySelector("option[value='auto']")!.textContent).toMatch(/1 (año|year)/);
  });

  it("clear removes every saved window and reruns: the automatic 1 year blocks the loss again", async () => {
    const first = await waitFor(panel, "window panel");
    select()!.value = "2";
    first.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    const second = await waitFor(() => (panel() && panel() !== first && !blockedRow() ? panel() : null), "rerun with 2 months");
    second.querySelector<HTMLButtonElement>(".antichurning-window-clear")!.click();
    expect(localStorage.getItem(KEY)).toBeNull();
    await waitFor(() => (panel() && panel() !== second && blockedRow() ? panel() : null), "rerun with the automatic year");
    expect(select()!.value).toBe("auto");
  });

  it("a refused write shows an error, keeps the old setting and does not rerun", async () => {
    const before = await waitFor(panel, "window panel");
    const storage = localStorage;
    const setItem = vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    select()!.value = "2";
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    const error = before.querySelector<HTMLElement>(".antichurning-window-error")!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toMatch(/navegador|browser/);
    expect(before.querySelector<HTMLElement>(".antichurning-window-saved")!.hidden).toBe(true);
    expect(storage.getItem(KEY)).toBeNull();
    await new Promise((r) => setTimeout(r, 100));
    expect(panel()).toBe(before); // no rerun
    expect(blockedRow()).not.toBeNull();
    setItem.mockRestore();
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

  it("names the codes of an open reading from another sale day before its note", () => {
    const html = renderAntichurningWindowPanel([
      { isin: ISIN, symbol: "MOVER", description: "MOVER", months: 12, source: "ibkr", autoMonths: 12, listingExchanges: ["PINK"], openDecision: "2016/2273", openListingExchanges: ["PINK", "TSE"] },
    ]);
    expect(html).toMatch(/PINK<br><span class="muted">PINK, TSE: [^<]*2016\/2273/);
  });
});

describe("bindAntichurningWindowPanel: one write per Save, and failures shown", () => {
  const OTHER = "US0378331005";
  const rows: AntichurningSecurity[] = [
    { isin: ISIN, symbol: "BP", description: "BP", months: 12, source: "ibkr", autoMonths: 12, listingExchanges: ["LSE"] },
    { isin: OTHER, symbol: "AAPL", description: "APPLE", months: 2, source: "default", autoMonths: 2, listingExchanges: [] },
  ];
  let storage: Storage;
  let container: HTMLElement;
  let reruns: number;

  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    container = document.createElement("div");
    container.innerHTML = renderAntichurningWindowPanel(rows);
    document.body.replaceChildren(container);
    reruns = 0;
    bindAntichurningWindowPanel(container, () => {
      reruns++;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const pick = (isin: string, value: string) => {
    container.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${isin}']`)!.value = value;
  };
  const click = (cls: string): void => {
    container.querySelector<HTMLButtonElement>(cls)!.click();
  };
  const error = () => container.querySelector<HTMLElement>(".antichurning-window-error")!;
  const saved = () => container.querySelector<HTMLElement>(".antichurning-window-saved")!;

  it("saves every row's choice in a single write and keeps windows of other ISINs", () => {
    storage.setItem(KEY, JSON.stringify({ ES0113900J37: 12 }));
    const setItem = vi.spyOn(storage, "setItem");
    pick(ISIN, "2");
    pick(OTHER, "12");
    click(".antichurning-window-save");
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual({ ES0113900J37: 12, [ISIN]: 2, [OTHER]: 12 });
    expect(reruns).toBe(1);
    expect(saved().hidden).toBe(false);
    expect(error().hidden).toBe(true);
  });

  it("a refused Save leaves every old value in place (no partial write), shows the error and does not rerun", () => {
    storage.setItem(KEY, JSON.stringify({ [ISIN]: 12 }));
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    pick(ISIN, "2");
    pick(OTHER, "12");
    click(".antichurning-window-save");
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual({ [ISIN]: 12 });
    expect(reruns).toBe(0);
    expect(error().hidden).toBe(false);
    expect(error().getAttribute("role")).toBe("alert");
    expect(saved().hidden).toBe(true);
  });

  it("a refused Clear shows its own error and does not rerun", () => {
    storage.setItem(KEY, JSON.stringify({ [ISIN]: 12 }));
    vi.spyOn(storage, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    click(".antichurning-window-clear");
    expect(reruns).toBe(0);
    expect(error().hidden).toBe(false);
    expect(error().textContent).not.toBe("");
    expect(storage.getItem(KEY)).not.toBeNull();
  });

  it("an unreadable storage at Save shows the error instead of «Guardado», and does not rerun", () => {
    // The panel rendered with a saved 1 year; the storage then turns unreadable.
    // Setting the row back to automatic gives an empty mapping, which must not
    // pass for "nothing changed" just because the read fell back to {}.
    storage.setItem(KEY, JSON.stringify({ [ISIN]: 12 }));
    const getItem = vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    pick(ISIN, "auto");
    click(".antichurning-window-save");
    expect(reruns).toBe(0);
    expect(error().hidden).toBe(false);
    expect(saved().hidden).toBe(true);
    getItem.mockRestore();
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual({ [ISIN]: 12 });
  });

  it("a later good Save hides the earlier error", () => {
    const setItem = vi.spyOn(storage, "setItem").mockImplementationOnce(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    pick(ISIN, "2");
    click(".antichurning-window-save");
    expect(error().hidden).toBe(false);
    click(".antichurning-window-save");
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(error().hidden).toBe(true);
    expect(saved().hidden).toBe(false);
    expect(reruns).toBe(1);
  });
});

describe("1-year option label: letter g is «not admitted on an EEA regulated or equivalent market», not «only outside the EEA»", () => {
  it("all 5 locales name the regulated market and none says the security only trades outside the EEA", async () => {
    const es = (await import("../../src/i18n/locales/es.js")).default;
    const en = (await import("../../src/i18n/locales/en.js")).default;
    const ca = (await import("../../src/i18n/locales/ca.js")).default;
    const eu = (await import("../../src/i18n/locales/eu.js")).default;
    const gl = (await import("../../src/i18n/locales/gl.js")).default;
    const regulated = { es: /regulado del EEE/, en: /EEA regulated market/, ca: /regulat de l'EEE/, eu: /EEEko merkatu arautu/, gl: /regulado do EEE/ };
    const outsideOnly = /fuera del EEE|outside the EEA|fora de l'EEE|EEEtik kanpo|fóra do EEE/;
    for (const [name, locale] of Object.entries({ es, en, ca, eu, gl })) {
      const label = locale["antichurning_window.opt_1y"];
      expect(label, name).toMatch(regulated[name as keyof typeof regulated]);
      expect(label, name).not.toMatch(outsideOnly);
      expect(label, name).toMatch(/BME Growth/);
      expect(locale["antichurning_window.save_error"], name).toBeTruthy();
      expect(locale["antichurning_window.clear_error"], name).toBeTruthy();
    }
  });
});
