// @vitest-environment jsdom
/**
 * The «Guardado» label of the three Save-and-recalculate panels on the results
 * step, driven through the real app (index.html, main.ts, the wizard), issue
 * #472.
 *
 * A Save writes the value and reruns the report. The rerun redraws every panel,
 * so a label unhidden on the old panel disappeared with it. The redrawn panel
 * must carry the label after a Save, and never after a Clear, a refused save or
 * a later redraw (a locale change, a year change).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  renderManualOpeningLotsPanel,
  renderManualRatesPanel,
} from "../../src/web/manual-rates.js";
import { renderAntichurningWindowPanel } from "../../src/web/antichurning-window.js";
import { buildManualRateMap, coerceManualQuotes } from "../../src/engine/manual-rates.js";
import type { AntichurningSecurity, TaxMessage, UnresolvedValuation } from "../../src/types/tax.js";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");
const YEAR = new Date().getFullYear() - 1; // the profile's default declaration year
const LSE_ISIN = "GB0007980591";
const LSE2_ISIN = "GB0002374006";

const lseRow = (id: string, date: string, qty: number, price: number, isin = LSE_ISIN, symbol = "LSEONLY") => {
  const side = qty > 0 ? "BUY" : "SELL";
  const money = (Math.abs(qty) * price).toFixed(2);
  return `<Trade tradeID="${id}" accountId="U0000001" symbol="${symbol}" description="LONDON ONLY PLC ${symbol}"
    isin="${isin}" assetCategory="STK" currency="EUR" tradeDate="${YEAR}${date}" settlementDate=""
    quantity="${qty}" tradePrice="${price}" tradeMoney="${side === "BUY" ? money : `-${money}`}" proceeds="${side === "BUY" ? `-${money}` : money}"
    cost="0" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}"
    exchange="LSE" listingExchange="LSE" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />`;
};

/**
 * One statement that opens all three panels: two London-only shares, each bought,
 * sold at a loss and bought back (anti-churning window panel, two rows), a EUR sale with no
 * earlier purchase (opening lots) and a BTC buy priced in SOL (crypto price).
 * A buy the year before gives the results year select a second year.
 * Nothing needs an ECB rate, so fetch is stubbed to fail.
 */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U0000001" fromDate="${YEAR - 1}0101" toDate="${YEAR}1231" period="Custom">
      <Trades>${lseRow("1", "0201", 1, 100)}${lseRow("2", "0301", -1, 80)}${lseRow("3", "0801", 1, 85)}
        ${lseRow("11", "0202", 1, 100, LSE2_ISIN, "LSETWO")}${lseRow("12", "0302", -1, 80, LSE2_ISIN, "LSETWO")}${lseRow("13", "0802", 1, 85, LSE2_ISIN, "LSETWO")}
        <Trade tradeID="6" accountId="U0000001" symbol="OTHER" description="OTHER SA"
          isin="XX0000000002" assetCategory="STK" currency="EUR"
          tradeDate="${YEAR - 1}0601" settlementDate="" quantity="1" tradePrice="10"
          tradeMoney="10.00" proceeds="-10.00" cost="10" fifoPnlRealized="0" fxRateToBase="1"
          buySell="BUY" openCloseIndicator="O" exchange="BME"
          ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />
        <Trade tradeID="4" accountId="U0000001" symbol="ACME" description="ACME CORP"
          isin="XX0000000001" assetCategory="STK" currency="EUR"
          tradeDate="${YEAR}0310" settlementDate="" quantity="-10" tradePrice="120"
          tradeMoney="-1200.00" proceeds="1200.00" cost="0" fifoPnlRealized="0" fxRateToBase="1"
          buySell="SELL" openCloseIndicator="C" exchange="BME"
          ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />
        <Trade tradeID="5" accountId="U0000001" symbol="BTC" description="BTC paid in SOL"
          isin="" assetCategory="CRYPTO" currency="SOL"
          tradeDate="${YEAR}0401" settlementDate="" quantity="0.01" tradePrice="400"
          tradeMoney="4" proceeds="-4" cost="0" fifoPnlRealized="0" fxRateToBase="1"
          buySell="BUY" openCloseIndicator="O" exchange="BINANCE"
          ibCommissionCurrency="SOL" ibCommission="0" taxes="0" />
      </Trades>
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

let refuseWrites = false;
let refuseRemoves = false;
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => {
      if (refuseWrites) throw new Error("QuotaExceededError");
      store.set(key, val);
    },
    removeItem: (key: string) => {
      if (refuseRemoves) throw new Error("SecurityError");
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

const step3 = () => document.getElementById("wizard-step-3")!;
const windowPanel = () => step3().querySelector<HTMLElement>(".antichurning-window-panel");
const lotsPanel = () => step3().querySelector<HTMLElement>(".manual-opening-lots-panel");
/** The crypto panel: the one asking for prices, or the saved-prices list it turns into. */
const cryptoPanel = () =>
  step3().querySelector<HTMLElement>(".crypto-rates-panel:not(.manual-opening-lots-panel):not(.antichurning-window-panel)");
const label = (panel: HTMLElement | null, selector: string) => panel!.querySelector<HTMLElement>(selector)!;
/**
 * On screen: not `hidden` and not inside a closed <details>. A label without
 * `hidden` inside a collapsed panel is still invisible (the redrawn panel is
 * often the collapsed stored-prices or stored-lots one).
 */
function shown(el: HTMLElement): boolean {
  if (el.hidden) return false;
  for (let d = el.parentElement?.closest("details"); d; d = d.parentElement?.closest("details")) {
    if (!d.open) return false;
  }
  return true;
}
const windowLabel = () => label(windowPanel(), ".antichurning-window-saved");
const lotsLabel = () => label(lotsPanel(), ".manual-opening-lots-saved-msg");
const cryptoLabel = () => label(cryptoPanel(), ".crypto-rates-saved-msg");
const windowSelect = (p: HTMLElement) => p.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!;

/** A redraw that happens without a Save: the results re-render on a locale change. */
function redrawOnLocaleChange(): void {
  document.dispatchEvent(new Event("localechange"));
}

/** Wait until `panel()` is a new element (the rerun redrew it). */
const redrawn = (panel: () => HTMLElement | null, old: HTMLElement, what: string) =>
  waitFor(() => (panel() && panel() !== old ? panel() : null), what);

/** Load the real app on the results step; `seed` writes to storage first. */
async function startApp(seed: () => void = () => {}): Promise<void> {
  refuseWrites = false;
  refuseRemoves = false;
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  seed();
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__COMMIT_HASH__", "test");
  document.documentElement.innerHTML = new DOMParser().parseFromString(INDEX_HTML, "text/html").documentElement.innerHTML;
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
  await import("../../src/web/main.js");
  await openResults();
}

describe("«Guardado» after a Save in the real app (#472)", () => {
  beforeEach(async () => {
    await startApp();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("all three panels start with the label hidden", async () => {
    await waitFor(windowPanel, "window panel");
    expect(windowLabel().hidden).toBe(true);
    expect(lotsLabel().hidden).toBe(true);
    expect(cryptoLabel().hidden).toBe(true);
  });

  it("anti-churning window: the redrawn panel shows «Guardado» after Save, and a locale redraw hides it", async () => {
    const before = await waitFor(windowPanel, "window panel");
    before.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!.value = "2";
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    await redrawn(windowPanel, before, "rerun after Save");
    expect(shown(windowLabel())).toBe(true);
    // Only the panel that was saved says so.
    expect(lotsLabel().hidden).toBe(true);
    expect(cryptoLabel().hidden).toBe(true);

    const afterSave = windowPanel()!;
    redrawOnLocaleChange();
    expect(windowPanel()).not.toBe(afterSave);
    expect(windowLabel().hidden).toBe(true);
  });

  it("anti-churning window: Clear redraws the panel without «Guardado»", async () => {
    const first = await waitFor(windowPanel, "window panel");
    first.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!.value = "2";
    first.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    const second = await redrawn(windowPanel, first, "rerun after Save");
    expect(shown(windowLabel())).toBe(true);
    second.querySelector<HTMLButtonElement>(".antichurning-window-clear")!.click();
    await redrawn(windowPanel, second, "rerun after Clear");
    expect(windowLabel().hidden).toBe(true);
  });

  it("anti-churning window: a refused save after a good one hides «Guardado» and shows the error", async () => {
    const first = await waitFor(windowPanel, "window panel");
    first.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!.value = "2";
    first.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    const second = await redrawn(windowPanel, first, "rerun after Save");
    expect(shown(windowLabel())).toBe(true);
    refuseWrites = true;
    second.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!.value = "12";
    second.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(windowPanel()).toBe(second); // no rerun
    expect(windowLabel().hidden).toBe(true);
    expect(second.querySelector<HTMLElement>(".antichurning-window-error")!.hidden).toBe(false);
  });

  it("crypto prices: the saved-prices panel the rerun draws shows «Guardado»; a locale redraw hides it", async () => {
    const before = await waitFor(cryptoPanel, "crypto panel");
    before.querySelector<HTMLInputElement>(".crypto-rate-input")!.value = "30000";
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    await waitFor(() => step3().querySelector(".crypto-rates-stored-panel"), "saved prices panel");
    expect(shown(cryptoLabel())).toBe(true);
    expect(windowLabel().hidden).toBe(true);
    expect(lotsLabel().hidden).toBe(true);

    redrawOnLocaleChange();
    expect(cryptoLabel().hidden).toBe(true);
  });

  it("crypto prices: Clear redraws the panel without «Guardado»; an empty Save does not rerun", async () => {
    const before = await waitFor(cryptoPanel, "crypto panel");
    // Nothing typed: nothing saved, no rerun, no label.
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(cryptoPanel()).toBe(before);
    expect(cryptoLabel().hidden).toBe(true);

    before.querySelector<HTMLInputElement>(".crypto-rate-input")!.value = "30000";
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    const stored = await waitFor(() => step3().querySelector<HTMLElement>(".crypto-rates-stored-panel"), "saved prices panel");
    expect(shown(cryptoLabel())).toBe(true);
    stored.querySelector<HTMLButtonElement>("#crypto-rates-clear-btn")!.click();
    await redrawn(cryptoPanel, stored, "rerun after Clear");
    expect(step3().querySelector(".crypto-rates-stored-panel")).toBeNull();
    expect(cryptoLabel().hidden).toBe(true);
  });

  it("opening lots: the redrawn panel shows «Guardado» after Save; Clear and a locale redraw hide it", async () => {
    const before = await waitFor(lotsPanel, "opening lots panel");
    const field = (p: HTMLElement, f: string) => p.querySelector<HTMLInputElement>(`[data-field='${f}']`)!;
    field(before, "acquireDate").value = `${YEAR}-01-15`;
    field(before, "quantity").value = "10";
    field(before, "pricePerShare").value = "100";
    before.querySelector<HTMLButtonElement>("#manual-opening-lots-save-btn")!.click();
    const second = await redrawn(lotsPanel, before, "rerun after Save");
    expect(shown(lotsLabel())).toBe(true);
    expect(windowLabel().hidden).toBe(true);
    expect(cryptoLabel().hidden).toBe(true);

    redrawOnLocaleChange();
    expect(lotsPanel()).not.toBe(second);
    expect(lotsLabel().hidden).toBe(true);

    const third = lotsPanel()!;
    third.querySelector<HTMLButtonElement>("#manual-opening-lots-clear-btn")!.click();
    await redrawn(lotsPanel, third, "rerun after Clear");
    expect(lotsLabel().hidden).toBe(true);
  });

  it("opening lots: an invalid row saves nothing and shows no «Guardado»", async () => {
    const before = await waitFor(lotsPanel, "opening lots panel");
    before.querySelector<HTMLInputElement>("[data-field='quantity']")!.value = "diez";
    before.querySelector<HTMLButtonElement>("#manual-opening-lots-save-btn")!.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(lotsPanel()).toBe(before);
    expect(lotsLabel().hidden).toBe(true);
    expect(before.querySelector<HTMLElement>(".manual-opening-lots-error-msg")!.hidden).toBe(false);
  });

  it("crypto prices: a write the browser refuses saves nothing, shows the error, no «Guardado» and no rerun", async () => {
    const before = await waitFor(cryptoPanel, "crypto panel");
    refuseWrites = true;
    before.querySelector<HTMLInputElement>(".crypto-rate-input")!.value = "30000";
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(cryptoPanel()).toBe(before); // no rerun
    expect(cryptoLabel().hidden).toBe(true);
    const error = before.querySelector<HTMLElement>(".crypto-rates-error-msg")!;
    expect(error.hidden).toBe(false);
    expect(error.getAttribute("role")).toBe("alert");
    expect(localStorage.getItem("declarenta_manual_rates")).toBeNull();
    // The browser accepts the next write: saved, error gone, «Guardado» on the redrawn panel.
    refuseWrites = false;
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    await waitFor(() => step3().querySelector(".crypto-rates-stored-panel"), "saved prices panel");
    expect(shown(cryptoLabel())).toBe(true);
    expect(cryptoPanel()!.querySelector<HTMLElement>(".crypto-rates-error-msg")!.hidden).toBe(true);
  });

  it("opening lots: a write the browser refuses saves nothing, shows the error, no «Guardado» and no rerun", async () => {
    const before = await waitFor(lotsPanel, "opening lots panel");
    const field = (p: HTMLElement, f: string) => p.querySelector<HTMLInputElement>(`[data-field='${f}']`)!;
    field(before, "acquireDate").value = `${YEAR}-01-15`;
    field(before, "quantity").value = "10";
    field(before, "pricePerShare").value = "100";
    refuseWrites = true;
    before.querySelector<HTMLButtonElement>("#manual-opening-lots-save-btn")!.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(lotsPanel()).toBe(before); // no rerun: the typed row stays
    expect(field(before, "quantity").value).toBe("10");
    expect(lotsLabel().hidden).toBe(true);
    const error = before.querySelector<HTMLElement>(".manual-opening-lots-error-msg")!;
    expect(error.hidden).toBe(false);
    // The app runs in its own module copy and locale; the storage error replaces the invalid-row text.
    expect(error.textContent).toMatch(/storage|almacenamiento/);
    expect(localStorage.getItem("declarenta_manual_opening_lots")).toBeNull();
  });

  it("a locale redraw while a Save rerun waits cancels that run's «Guardado»; the run still finishes", async () => {
    const before = await waitFor(windowPanel, "window panel");
    const strip = document.getElementById("results-split");
    before.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!.value = "2";
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    // The rerun is waiting (ECB rates, paint yield); the locale redraw lands first.
    redrawOnLocaleChange();
    const localeDrawn = windowPanel()!;
    expect(localeDrawn).not.toBe(before);
    expect(windowLabel().hidden).toBe(true);
    // The rerun finishes: it redraws the panel with the saved window, without «Guardado».
    const fromRun = await redrawn(windowPanel, localeDrawn, "rerun after Save");
    expect(fromRun.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!.value).toBe("2");
    expect(document.getElementById("results-split")).not.toBe(strip);
    expect(windowLabel().hidden).toBe(true);
  });

  it("a refused Save while an earlier good Save reruns keeps the entered value and the error; the run still updates the results", async () => {
    const before = await waitFor(windowPanel, "window panel");
    const strip = document.getElementById("results-split");
    const select = () => before.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!;
    select().value = "2";
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    // While that rerun waits, a second Save the browser refuses.
    refuseWrites = true;
    select().value = "12";
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    const error = before.querySelector<HTMLElement>(".antichurning-window-error")!;
    expect(error.hidden).toBe(false);
    // The first rerun finishes and redraws the results, but not this panel.
    await waitFor(() => (document.getElementById("results-split") !== strip ? true : null), "rerun after the good Save");
    await new Promise((r) => setTimeout(r, 50));
    expect(windowPanel()).toBe(before);
    expect(select().value).toBe("12");
    expect(error.hidden).toBe(false);
    expect(windowLabel().hidden).toBe(true);
    // The good Save is stored and in the report.
    expect(JSON.parse(localStorage.getItem("declarenta_antichurning_windows")!)).toEqual({ [LSE_ISIN]: 2 });
  });

  it("with no edit after a Save, the rerun still redraws the panel with «Guardado» (control)", async () => {
    const before = await waitFor(lotsPanel, "opening lots panel");
    const field = (p: HTMLElement, f: string) => p.querySelector<HTMLInputElement>(`[data-field='${f}']`)!;
    field(before, "acquireDate").value = `${YEAR}-01-15`;
    field(before, "quantity").value = "10";
    field(before, "pricePerShare").value = "100";
    before.querySelector<HTMLButtonElement>("#manual-opening-lots-save-btn")!.click();
    // Folding the panel by its <summary> is no edit: the rerun still redraws it.
    before.querySelector<HTMLElement>("summary.manual-opening-lots-summary")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await redrawn(lotsPanel, before, "rerun after Save");
    expect(shown(lotsLabel())).toBe(true);
  });

  it("a refused crypto Save while an earlier good one reruns keeps the typed price and the error", async () => {
    const before = await waitFor(cryptoPanel, "crypto panel");
    const strip = document.getElementById("results-split");
    const input = before.querySelector<HTMLInputElement>(".crypto-rate-input")!;
    input.value = "30000";
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    refuseWrites = true;
    input.value = "31000";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    await waitFor(() => (document.getElementById("results-split") !== strip ? true : null), "rerun after the good Save");
    await new Promise((r) => setTimeout(r, 50));
    expect(cryptoPanel()).toBe(before);
    expect(input.value).toBe("31000");
    expect(before.querySelector<HTMLElement>(".crypto-rates-error-msg")!.hidden).toBe(false);
    expect(cryptoLabel().hidden).toBe(true);
    // The panels keep their order: opening lots, crypto, anti-churning window, then the casillas.
    const order = [...step3().querySelectorAll(".manual-opening-lots-panel, .crypto-rates-panel, .antichurning-window-panel")].filter((el, i, all) => all.indexOf(el) === i);
    expect(order).toEqual([lotsPanel(), cryptoPanel(), windowPanel()]);
  });

  // A locale redraw while a Save rerun waits draws the panels from the report
  // before that Save. An edit made before the redraw went with the old panel, so
  // the run replaces the locale-drawn panel with the stored value; only an edit
  // in the locale-drawn panel keeps it (#472 review).
  // A locale redraw replaces the results strip too: take `strip` after it, or
  // runLands returns before the rerun lands (#472 review).
  const runLands = (strip: Element | null) =>
    waitFor(() => (document.getElementById("results-split") !== strip ? true : null), "rerun after the good Save").then(
      () => new Promise((r) => setTimeout(r, 50)),
    );

  it("an edit, then a locale redraw while a Save reruns: the run shows the stored window, not the stale locale-drawn panel", async () => {
    const before = await waitFor(windowPanel, "window panel");
    windowSelect(before).value = "2";
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    windowSelect(before).value = "12";
    windowSelect(before).dispatchEvent(new Event("change", { bubbles: true }));
    redrawOnLocaleChange();
    const localeDrawn = windowPanel()!;
    const strip = document.getElementById("results-split");
    await runLands(strip);
    expect(JSON.parse(localStorage.getItem("declarenta_antichurning_windows")!)).toEqual({ [LSE_ISIN]: 2 });
    expect(windowPanel()).not.toBe(localeDrawn);
    expect(windowSelect(windowPanel()!).value).toBe("2");
    expect(windowLabel().hidden).toBe(true);
  });

  it("a refused Save, then a locale redraw while a good Save reruns: the run shows the stored window", async () => {
    const before = await waitFor(windowPanel, "window panel");
    windowSelect(before).value = "2";
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    refuseWrites = true;
    windowSelect(before).value = "12";
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    redrawOnLocaleChange();
    const strip = document.getElementById("results-split");
    await runLands(strip);
    expect(windowSelect(windowPanel()!).value).toBe("2");
    expect(windowPanel()!.querySelector<HTMLElement>(".antichurning-window-error")!.hidden).toBe(true);
    expect(windowLabel().hidden).toBe(true);
  });

  it("a typed price, then a locale redraw while a crypto Save reruns: the run shows the saved-prices panel", async () => {
    const before = await waitFor(cryptoPanel, "crypto panel");
    const input = before.querySelector<HTMLInputElement>(".crypto-rate-input")!;
    input.value = "30000";
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    input.value = "31000";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    redrawOnLocaleChange();
    const strip = document.getElementById("results-split");
    await runLands(strip);
    expect(step3().querySelector(".crypto-rates-stored-panel")).not.toBeNull();
    expect(cryptoLabel().hidden).toBe(true);
  });

  it("an edit in the locale-drawn panel while a Save reruns is kept as typed (control)", async () => {
    const before = await waitFor(windowPanel, "window panel");
    windowSelect(before).value = "2";
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    redrawOnLocaleChange();
    const strip = document.getElementById("results-split");
    const localeDrawn = windowPanel()!;
    windowSelect(localeDrawn).value = "12";
    windowSelect(localeDrawn).dispatchEvent(new Event("change", { bubbles: true }));
    await runLands(strip);
    expect(windowPanel()).toBe(localeDrawn);
    expect(windowSelect(localeDrawn).value).toBe("12");
    expect(windowLabel().hidden).toBe(true);
    const order = [...step3().querySelectorAll(".manual-opening-lots-panel, .crypto-rates-panel, .antichurning-window-panel")].filter((el, i, all) => all.indexOf(el) === i);
    expect(order).toEqual([lotsPanel(), cryptoPanel(), windowPanel()]);
  });

  // A kept locale-drawn panel must show the stored window on every row it was
  // not edited in, or its next Save writes back the windows from before the
  // Save or Clear (#472 review of 7f727ca).
  const secondSelect = (p: HTMLElement) => p.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE2_ISIN}']`)!;
  const storedWindows = () => JSON.parse(localStorage.getItem("declarenta_antichurning_windows") ?? "{}") as Record<string, number>;

  it("a Save, a locale redraw and an edit of another row: the kept panel shows the saved window and its Save keeps it", async () => {
    const before = await waitFor(windowPanel, "window panel");
    windowSelect(before).value = "2";
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    redrawOnLocaleChange();
    let strip = document.getElementById("results-split");
    const localeDrawn = windowPanel()!;
    expect(windowSelect(localeDrawn).value).toBe("2");
    secondSelect(localeDrawn).value = "12";
    secondSelect(localeDrawn).dispatchEvent(new Event("change", { bubbles: true }));
    await runLands(strip);
    expect(windowPanel()).toBe(localeDrawn);
    expect(windowSelect(localeDrawn).value).toBe("2");
    expect(secondSelect(localeDrawn).value).toBe("12");
    strip = document.getElementById("results-split");
    localeDrawn.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    await runLands(strip);
    expect(storedWindows()).toEqual({ [LSE_ISIN]: 2, [LSE2_ISIN]: 12 });
  });

  it("a Clear, a locale redraw and an edit of another row: the kept panel shows no window and its Save does not restore one", async () => {
    const first = await waitFor(windowPanel, "window panel");
    windowSelect(first).value = "2";
    first.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    const second = await redrawn(windowPanel, first, "rerun after Save");
    second.querySelector<HTMLButtonElement>(".antichurning-window-clear")!.click();
    expect(localStorage.getItem("declarenta_antichurning_windows")).toBeNull();
    redrawOnLocaleChange();
    let strip = document.getElementById("results-split");
    const localeDrawn = windowPanel()!;
    secondSelect(localeDrawn).value = "12";
    secondSelect(localeDrawn).dispatchEvent(new Event("change", { bubbles: true }));
    await runLands(strip);
    expect(windowPanel()).toBe(localeDrawn);
    expect(windowSelect(localeDrawn).value).toBe("auto");
    strip = document.getElementById("results-split");
    localeDrawn.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    await runLands(strip);
    expect(storedWindows()).toEqual({ [LSE2_ISIN]: 12 });
  });

  it("a panel touched while a year change reruns is still replaced: it belongs to the year on screen", async () => {
    const before = await waitFor(windowPanel, "window panel");
    const yearSelect = document.getElementById("results-year-select") as HTMLSelectElement;
    const other = [...yearSelect.options].map((o) => o.value).find((v) => v !== String(YEAR));
    if (!other) throw new Error("the year select offers no other year");
    const header = document.getElementById("results-year-header")!.innerHTML;
    yearSelect.value = other;
    yearSelect.dispatchEvent(new Event("change"));
    // An edit in the old year's panel while the other year computes.
    before.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => (document.getElementById("results-year-header")!.innerHTML !== header ? true : null), `results for ${other}`);
    expect(before.isConnected).toBe(false);
  });

  it("a year change after a Save redraws the panels without «Guardado»", async () => {
    const before = await waitFor(windowPanel, "window panel");
    before.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!.value = "2";
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    const second = await redrawn(windowPanel, before, "rerun after Save");
    expect(shown(windowLabel())).toBe(true);
    // Another year and back through the results year select: plain reruns, no Save.
    const pick = async (year: string) => {
      const yearSelect = document.getElementById("results-year-select") as HTMLSelectElement;
      expect([...yearSelect.options].map((o) => o.value)).toContain(year);
      const shown = document.getElementById("results-year-header")!.innerHTML;
      yearSelect.value = year;
      yearSelect.dispatchEvent(new Event("change"));
      await waitFor(() => (document.getElementById("results-year-header")!.innerHTML !== shown ? true : null), `results for ${year}`);
    };
    const yearSelect = document.getElementById("results-year-select") as HTMLSelectElement;
    const other = [...yearSelect.options].map((o) => o.value).find((v) => v !== String(YEAR));
    if (!other) throw new Error("the year select offers no other year");
    await pick(other);
    await pick(String(YEAR));
    const back = await waitFor(windowPanel, "window panel again");
    expect(back).not.toBe(second);
    expect(windowLabel().hidden).toBe(true);
  });

  // An edit after a good Save puts unsaved values on screen: «Guardado» goes
  // at the first edit, both while the Save rerun waits (the run then keeps the
  // edited panel) and after it has redrawn the panel (#472 review).
  it("anti-churning window: an edit while the Save rerun waits hides «Guardado», and the kept panel stays without it", async () => {
    const before = await waitFor(windowPanel, "window panel");
    const strip = document.getElementById("results-split");
    windowSelect(before).value = "2";
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    expect(windowLabel().hidden).toBe(false);
    windowSelect(before).value = "12";
    windowSelect(before).dispatchEvent(new Event("change", { bubbles: true }));
    expect(windowLabel().hidden).toBe(true);
    await runLands(strip);
    expect(windowPanel()).toBe(before);
    expect(windowSelect(before).value).toBe("12");
    expect(windowLabel().hidden).toBe(true);
    expect(JSON.parse(localStorage.getItem("declarenta_antichurning_windows")!)).toEqual({ [LSE_ISIN]: 2 });
  });

  it("anti-churning window: an edit in the redrawn panel hides «Guardado»; a Save brings it back", async () => {
    const before = await waitFor(windowPanel, "window panel");
    windowSelect(before).value = "2";
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    const second = await redrawn(windowPanel, before, "rerun after Save");
    expect(shown(windowLabel())).toBe(true);
    windowSelect(second).value = "12";
    windowSelect(second).dispatchEvent(new Event("change", { bubbles: true }));
    expect(windowLabel().hidden).toBe(true);
    second.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    await redrawn(windowPanel, second, "rerun after the second Save");
    expect(shown(windowLabel())).toBe(true);
  });

  it("crypto prices: an edit while the Save rerun waits hides «Guardado», and the kept panel stays without it", async () => {
    const before = await waitFor(cryptoPanel, "crypto panel");
    const strip = document.getElementById("results-split");
    const input = before.querySelector<HTMLInputElement>(".crypto-rate-input")!;
    input.value = "30000";
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    expect(cryptoLabel().hidden).toBe(false);
    input.value = "31000";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(cryptoLabel().hidden).toBe(true);
    await runLands(strip);
    expect(cryptoPanel()).toBe(before);
    expect(input.value).toBe("31000");
    expect(cryptoLabel().hidden).toBe(true);
  });

  it("crypto prices: an edit in the saved-prices form the rerun draws hides «Guardado»", async () => {
    const before = await waitFor(cryptoPanel, "crypto panel");
    before.querySelector<HTMLInputElement>(".crypto-rate-input")!.value = "30000";
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    const stored = await waitFor(() => step3().querySelector<HTMLElement>(".crypto-rates-stored-panel"), "saved prices panel");
    expect(shown(cryptoLabel())).toBe(true);
    const input = stored.querySelector<HTMLInputElement>(".crypto-rate-input")!;
    input.value = "31000";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(cryptoLabel().hidden).toBe(true);
  });

  it("opening lots: an edit while the Save rerun waits hides «Guardado», and the kept panel stays without it", async () => {
    const before = await waitFor(lotsPanel, "opening lots panel");
    const strip = document.getElementById("results-split");
    const field = (f: string) => before.querySelector<HTMLInputElement>(`[data-field='${f}']`)!;
    field("acquireDate").value = `${YEAR}-01-15`;
    field("quantity").value = "10";
    field("pricePerShare").value = "100";
    before.querySelector<HTMLButtonElement>("#manual-opening-lots-save-btn")!.click();
    expect(lotsLabel().hidden).toBe(false);
    field("quantity").value = "11";
    field("quantity").dispatchEvent(new Event("input", { bubbles: true }));
    expect(lotsLabel().hidden).toBe(true);
    await runLands(strip);
    expect(lotsPanel()).toBe(before);
    expect(field("quantity").value).toBe("11");
    expect(lotsLabel().hidden).toBe(true);
  });

  it("opening lots: a typed value or an added row in the redrawn panel hides «Guardado»", async () => {
    const before = await waitFor(lotsPanel, "opening lots panel");
    const field = (p: HTMLElement, f: string) => p.querySelector<HTMLInputElement>(`[data-field='${f}']`)!;
    field(before, "acquireDate").value = `${YEAR}-01-15`;
    field(before, "quantity").value = "10";
    field(before, "pricePerShare").value = "100";
    before.querySelector<HTMLButtonElement>("#manual-opening-lots-save-btn")!.click();
    const second = await redrawn(lotsPanel, before, "rerun after Save");
    expect(shown(lotsLabel())).toBe(true);
    field(second, "quantity").value = "11";
    field(second, "quantity").dispatchEvent(new Event("input", { bubbles: true }));
    expect(lotsLabel().hidden).toBe(true);

    // The same after the next Save, with a row added instead of a typed value.
    second.querySelector<HTMLButtonElement>("#manual-opening-lots-save-btn")!.click();
    const third = await redrawn(lotsPanel, second, "rerun after the second Save");
    expect(shown(lotsLabel())).toBe(true);
    third.querySelector<HTMLButtonElement>(".manual-opening-lot-add")!.click();
    expect(third.querySelectorAll(".manual-opening-lot-row")).toHaveLength(2);
    expect(lotsLabel().hidden).toBe(true);
  });
});

describe("Saves in two panels before the first rerun lands (#472 review)", () => {
  beforeEach(async () => {
    await startApp();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const solInput = (p: HTMLElement) => p.querySelector<HTMLInputElement>(".crypto-rate-input")!;

  // The second Save starts a newer run and the first run is dropped. The newer
  // run redraws both panels, and both were saved and left as saved.
  it("a crypto Save, then an anti-churning Save in the same tick: both redrawn panels show «Guardado»", async () => {
    const crypto = await waitFor(cryptoPanel, "crypto panel");
    const win = await waitFor(windowPanel, "window panel");
    solInput(crypto).value = "30000";
    crypto.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    expect(shown(cryptoLabel())).toBe(true);
    win.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!.value = "2";
    win.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    await redrawn(windowPanel, win, "rerun");
    await new Promise((r) => setTimeout(r, 100));
    expect(cryptoPanel()).not.toBe(crypto);
    expect(shown(windowLabel())).toBe(true);
    expect(shown(cryptoLabel())).toBe(true);
    expect(JSON.parse(localStorage.getItem("declarenta_manual_rates")!)).toHaveLength(1);
  });

  it("an edit after the first Save takes that panel out: the second Save's run keeps it without «Guardado»", async () => {
    const crypto = await waitFor(cryptoPanel, "crypto panel");
    const win = await waitFor(windowPanel, "window panel");
    solInput(crypto).value = "30000";
    crypto.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    solInput(crypto).value = "31000";
    solInput(crypto).dispatchEvent(new Event("input", { bubbles: true }));
    win.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!.value = "2";
    win.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    await redrawn(windowPanel, win, "rerun");
    await new Promise((r) => setTimeout(r, 100));
    expect(shown(windowLabel())).toBe(true);
    expect(cryptoPanel()).toBe(crypto);
    expect(cryptoLabel().hidden).toBe(true);
  });

  it("a Clear after the first Save takes that panel out: the second Save's run draws it without «Guardado»", async () => {
    const crypto = await waitFor(cryptoPanel, "crypto panel");
    const win = await waitFor(windowPanel, "window panel");
    win.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!.value = "2";
    win.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    win.querySelector<HTMLButtonElement>(".antichurning-window-clear")!.click();
    solInput(crypto).value = "30000";
    crypto.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    await redrawn(windowPanel, win, "rerun");
    await new Promise((r) => setTimeout(r, 100));
    expect(shown(cryptoLabel())).toBe(true);
    expect(windowLabel().hidden).toBe(true);
  });

  it("a crypto Save, then a Clear in the anti-churning panel before the run lands: the crypto panel keeps «Guardado»", async () => {
    const crypto = await waitFor(cryptoPanel, "crypto panel");
    const win = await waitFor(windowPanel, "window panel");
    solInput(crypto).value = "30000";
    crypto.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    win.querySelector<HTMLButtonElement>(".antichurning-window-clear")!.click();
    await redrawn(windowPanel, win, "rerun");
    await new Promise((r) => setTimeout(r, 100));
    expect(cryptoPanel()).not.toBe(crypto);
    expect(shown(cryptoLabel())).toBe(true);
    expect(windowLabel().hidden).toBe(true);
  });

  // The second Save's run starts after the crypto edit, so the edit is older
  // than that run: the panel still holds a price nobody saved, and the run
  // must leave it on screen (#472 review of 6fb63b2).
  it("a crypto Save, an edit, then an anti-churning Save: the run keeps the typed crypto price; the crypto panel's own Save redraws it", async () => {
    const crypto = await waitFor(cryptoPanel, "crypto panel");
    const win = await waitFor(windowPanel, "window panel");
    solInput(crypto).value = "30000";
    crypto.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    solInput(crypto).value = "31000";
    solInput(crypto).dispatchEvent(new Event("input", { bubbles: true }));
    windowSelect(win).value = "2";
    win.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    await redrawn(windowPanel, win, "rerun after the anti-churning Save");
    await new Promise((r) => setTimeout(r, 100));
    expect(cryptoPanel()).toBe(crypto);
    expect(solInput(crypto).value).toBe("31000");
    expect(cryptoLabel().hidden).toBe(true);
    expect(shown(windowLabel())).toBe(true);
    // A later run from another panel keeps it too.
    const win2 = windowPanel()!;
    windowSelect(win2).value = "12";
    win2.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    await redrawn(windowPanel, win2, "rerun after the second anti-churning Save");
    await new Promise((r) => setTimeout(r, 100));
    expect(cryptoPanel()).toBe(crypto);
    expect(solInput(crypto).value).toBe("31000");
    // The crypto panel's own Save stores the price and lets its run redraw it.
    crypto.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    await redrawn(cryptoPanel, crypto, "rerun after the crypto Save");
    expect(shown(cryptoLabel())).toBe(true);
    expect(JSON.parse(localStorage.getItem("declarenta_manual_rates")!)[0].eurPerUnit).toBe("31000");
  });

  it("a crypto Save, a refused crypto Save, then an anti-churning Save: the run keeps the flagged price and the error", async () => {
    const crypto = await waitFor(cryptoPanel, "crypto panel");
    const win = await waitFor(windowPanel, "window panel");
    solInput(crypto).value = "30000";
    crypto.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    // No input event: only the refused Save says the panel holds something unsaved.
    solInput(crypto).value = "abc";
    crypto.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    const error = crypto.querySelector<HTMLElement>(".crypto-rates-error-msg")!;
    expect(error.hidden).toBe(false);
    windowSelect(win).value = "2";
    win.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    await redrawn(windowPanel, win, "rerun after the anti-churning Save");
    await new Promise((r) => setTimeout(r, 100));
    expect(cryptoPanel()).toBe(crypto);
    expect(solInput(crypto).value).toBe("abc");
    expect(solInput(crypto).getAttribute("aria-invalid")).toBe("true");
    expect(error.hidden).toBe(false);
  });

  it("an empty Save that changes nothing does not hold the panel: the next run from another panel redraws it (control)", async () => {
    const win = await waitFor(windowPanel, "window panel");
    // Nothing chosen: the anti-churning Save stores nothing and starts no run.
    win.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(windowPanel()).toBe(win);
    const crypto = cryptoPanel()!;
    solInput(crypto).value = "30000";
    crypto.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    await redrawn(cryptoPanel, crypto, "rerun after the crypto Save");
    await new Promise((r) => setTimeout(r, 50));
    expect(windowPanel()).not.toBe(win);
  });

  it("a crypto Save, then a new upload before the run lands: the next results show no «Guardado»", async () => {
    const crypto = await waitFor(cryptoPanel, "crypto panel");
    solInput(crypto).value = "30000";
    crypto.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    // Back to the upload step, pick the file again (it forgets the report), and calculate.
    document.getElementById("wizard-back")!.click();
    document.getElementById("wizard-back")!.click();
    await openResults();
    await redrawn(cryptoPanel, crypto, "crypto panel after the new upload");
    await new Promise((r) => setTimeout(r, 100));
    expect(cryptoLabel().hidden).toBe(true);
  });

  it("a Save in another panel after the first run has landed: that run's «Guardado» is not drawn again", async () => {
    const crypto = await waitFor(cryptoPanel, "crypto panel");
    solInput(crypto).value = "30000";
    crypto.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    await redrawn(cryptoPanel, crypto, "rerun after the crypto Save");
    expect(shown(cryptoLabel())).toBe(true);
    const win = windowPanel()!;
    win.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!.value = "2";
    win.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    await redrawn(windowPanel, win, "rerun after the anti-churning Save");
    expect(shown(windowLabel())).toBe(true);
    expect(cryptoLabel().hidden).toBe(true);
  });

  // A year change shows the panels of another year: a Save made before it does
  // not label them, even when a Save in the old year's panel lands the run.
  it("a year change between the two Saves: the first panel's «Guardado» does not come back", async () => {
    const crypto = await waitFor(cryptoPanel, "crypto panel");
    const win = await waitFor(windowPanel, "window panel");
    solInput(crypto).value = "30000";
    crypto.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    const yearSelect = document.getElementById("results-year-select") as HTMLSelectElement;
    const other = [...yearSelect.options].map((o) => o.value).find((v) => v !== String(YEAR));
    if (!other) throw new Error("the year select offers no other year");
    const header = document.getElementById("results-year-header")!.innerHTML;
    yearSelect.value = other;
    yearSelect.dispatchEvent(new Event("change"));
    win.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!.value = "2";
    win.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    await waitFor(() => (document.getElementById("results-year-header")!.innerHTML !== header ? true : null), `results for ${other}`);
    await new Promise((r) => setTimeout(r, 100));
    expect(cryptoPanel()).not.toBe(crypto);
    expect(cryptoLabel().hidden).toBe(true);
  });
});

describe("a Save that leaves the panel with no rows (#472 review)", () => {
  // A window saved for a security with no sale this year still lists it. Set
  // back to «auto», the next report lists nothing: «Guardado» must still show.
  const APPLE = "US0378331005";
  // A lot saved for a security this upload never sells.
  const ORPHAN_LOT = { symbol: "ZZZ", description: "ZZZ PLC", isin: "XX0000000009", assetCategory: "STK", currency: "EUR", acquireDate: `${YEAR - 1}-01-15`, quantity: "1", pricePerShare: "10" };
  beforeEach(async () => {
    await startApp(() => {
      localStorage.setItem("declarenta_antichurning_windows", JSON.stringify({ [APPLE]: 12 }));
      localStorage.setItem("declarenta_manual_opening_lots", JSON.stringify([ORPHAN_LOT]));
    });
  });

  async function showOtherYear(): Promise<void> {
    const yearSelect = document.getElementById("results-year-select") as HTMLSelectElement;
    const other = [...yearSelect.options].map((o) => o.value).find((v) => v !== String(YEAR));
    if (!other) throw new Error("the year select offers no other year");
    const header = document.getElementById("results-year-header")!.innerHTML;
    yearSelect.value = other;
    yearSelect.dispatchEvent(new Event("change"));
    await waitFor(() => (document.getElementById("results-year-header")!.innerHTML !== header ? true : null), `results for ${other}`);
  }

  it("opening lots: the only saved lot emptied and saved shows «Guardado» without rows", async () => {
    await showOtherYear();
    const before = await waitFor(lotsPanel, "opening lots panel");
    expect([...before.querySelectorAll<HTMLElement>(".manual-opening-lot-group")].map((g) => g.dataset.symbol)).toEqual(["ZZZ"]);
    before.querySelectorAll<HTMLInputElement>(".manual-opening-lot-input").forEach((input) => {
      input.value = "";
    });
    const strip = document.getElementById("results-split");
    before.querySelector<HTMLButtonElement>("#manual-opening-lots-save-btn")!.click();
    await waitFor(() => (document.getElementById("results-split") !== strip ? true : null), "rerun after Save");
    expect(JSON.parse(localStorage.getItem("declarenta_manual_opening_lots")!)).toEqual([]);
    const after = lotsPanel();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(after!.querySelector(".manual-opening-lot-row")).toBeNull();
    expect(shown(lotsLabel())).toBe(true);
    redrawOnLocaleChange();
    expect(lotsPanel()).toBeNull();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("anti-churning window: the only row saved back to «auto» shows «Guardado» without a table", async () => {
    await showOtherYear();
    const before = await waitFor(windowPanel, "window panel");
    const selects = before.querySelectorAll<HTMLSelectElement>(".antichurning-window-select");
    expect([...selects].map((sel) => sel.dataset.isin)).toEqual([APPLE]);
    selects[0]!.value = "auto";
    const strip = document.getElementById("results-split");
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    await waitFor(() => (document.getElementById("results-split") !== strip ? true : null), "rerun after Save");
    expect(localStorage.getItem("declarenta_antichurning_windows")).toBeNull();
    const after = windowPanel();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(after!.querySelector("table")).toBeNull();
    expect(shown(windowLabel())).toBe(true);
    // The next redraw has nothing to confirm: no panel at all.
    redrawOnLocaleChange();
    expect(windowPanel()).toBeNull();
  });
});

describe("Clear in each panel (#472 review)", () => {
  const ETH = { currency: "ETH", date: "2020-01-02", eurPerUnit: "5" };
  const LOT = { symbol: "ACME", description: "ACME CORP", isin: "XX0000000001", assetCategory: "STK", currency: "EUR", acquireDate: `${YEAR}-01-15`, quantity: "10", pricePerShare: "100" };
  beforeEach(async () => {
    await startApp(() => {
      localStorage.setItem("declarenta_manual_rates", JSON.stringify([ETH]));
      localStorage.setItem("declarenta_manual_opening_lots", JSON.stringify([LOT]));
      localStorage.setItem("declarenta_antichurning_windows", JSON.stringify({ [LSE_ISIN]: 2 }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ethInput = (p: HTMLElement) => [...p.querySelectorAll<HTMLInputElement>(".crypto-rate-input")].find((i) => i.dataset.currency === "ETH")!;
  const solInput = (p: HTMLElement) => [...p.querySelectorAll<HTMLInputElement>(".crypto-rate-input")].find((i) => i.dataset.currency !== "ETH")!;
  const runLands = async (strip: Element | null) => {
    await waitFor(() => (document.getElementById("results-split") !== strip ? true : null), "rerun after Clear");
    await new Promise((r) => setTimeout(r, 50));
  };

  // A Clear the browser refuses: the saved values stay in use, so the panel
  // says so and nothing reruns.
  it("crypto prices: a refused Clear shows the error and does not rerun", async () => {
    const before = await waitFor(cryptoPanel, "crypto panel");
    refuseRemoves = true;
    before.querySelector<HTMLButtonElement>("#crypto-rates-clear-btn")!.click();
    await new Promise((r) => setTimeout(r, 100));
    expect(cryptoPanel()).toBe(before);
    const error = before.querySelector<HTMLElement>(".crypto-rates-error-msg")!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toMatch(/borrar los precios|clear the saved prices/);
    expect(cryptoLabel().hidden).toBe(true);
    expect(JSON.parse(localStorage.getItem("declarenta_manual_rates")!)).toEqual([ETH]);
    // The browser lets the retry through: the error goes and the run redraws the panel.
    refuseRemoves = false;
    before.querySelector<HTMLButtonElement>("#crypto-rates-clear-btn")!.click();
    expect(error.hidden).toBe(true);
    await redrawn(cryptoPanel, before, "rerun after Clear");
    expect(localStorage.getItem("declarenta_manual_rates")).toBeNull();
  });

  it("opening lots: a refused Clear shows the error and does not rerun", async () => {
    const before = await waitFor(lotsPanel, "opening lots panel");
    refuseRemoves = true;
    before.querySelector<HTMLButtonElement>("#manual-opening-lots-clear-btn")!.click();
    await new Promise((r) => setTimeout(r, 100));
    expect(lotsPanel()).toBe(before);
    const error = before.querySelector<HTMLElement>(".manual-opening-lots-error-msg")!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toMatch(/borrar los lotes|clear the saved lots/);
    expect(lotsLabel().hidden).toBe(true);
    expect(JSON.parse(localStorage.getItem("declarenta_manual_opening_lots")!)).toEqual([LOT]);
    refuseRemoves = false;
    before.querySelector<HTMLButtonElement>("#manual-opening-lots-clear-btn")!.click();
    expect(error.hidden).toBe(true);
    await redrawn(lotsPanel, before, "rerun after Clear");
    expect(localStorage.getItem("declarenta_manual_opening_lots")).toBeNull();
  });

  it("opening lots: a flagged row in a closed panel opens the panel (mirror of the crypto list)", async () => {
    const panel = (await waitFor(lotsPanel, "opening lots panel")) as HTMLDetailsElement;
    panel.open = false;
    panel.querySelector<HTMLInputElement>("[data-field='quantity']")!.value = "diez";
    panel.querySelector<HTMLButtonElement>("#manual-opening-lots-save-btn")!.click();
    expect(panel.querySelector("[data-field='quantity']")!.getAttribute("aria-invalid")).toBe("true");
    expect(panel.open).toBe(true);
  });

  // A Clear, then an edit in the same panel while its rerun waits: the run
  // keeps the edited panel, so the panel must show what is stored now, or its
  // next Save writes the cleared values back.
  it("anti-churning window: Clear, then an edit of another row while the rerun waits: the next Save does not restore the cleared window", async () => {
    const before = await waitFor(windowPanel, "window panel");
    expect(windowSelect(before).value).toBe("2");
    const strip = document.getElementById("results-split");
    before.querySelector<HTMLButtonElement>(".antichurning-window-clear")!.click();
    expect(windowSelect(before).value).toBe("auto");
    const second = before.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE2_ISIN}']`)!;
    second.value = "12";
    second.dispatchEvent(new Event("change", { bubbles: true }));
    await runLands(strip);
    expect(windowPanel()).toBe(before);
    expect(windowSelect(before).value).toBe("auto");
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    expect(JSON.parse(localStorage.getItem("declarenta_antichurning_windows")!)).toEqual({ [LSE2_ISIN]: 12 });
  });

  it("anti-churning window: a refused Clear leaves the selects as they were", async () => {
    const before = await waitFor(windowPanel, "window panel");
    refuseRemoves = true;
    before.querySelector<HTMLButtonElement>(".antichurning-window-clear")!.click();
    expect(windowSelect(before).value).toBe("2");
    expect(before.querySelector<HTMLElement>(".antichurning-window-error")!.hidden).toBe(false);
  });

  it("crypto prices: Clear, then a typed price while the rerun waits: the next Save does not restore the cleared price", async () => {
    const before = await waitFor(cryptoPanel, "crypto panel");
    expect(ethInput(before).value).toBe("5");
    const strip = document.getElementById("results-split");
    before.querySelector<HTMLButtonElement>("#crypto-rates-clear-btn")!.click();
    expect(ethInput(before).value).toBe("");
    solInput(before).value = "30000";
    solInput(before).dispatchEvent(new Event("input", { bubbles: true }));
    await runLands(strip);
    expect(cryptoPanel()).toBe(before);
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    expect((JSON.parse(localStorage.getItem("declarenta_manual_rates")!) as { currency: string }[]).map((e) => e.currency)).toEqual(["SOL"]);
  });

  it("opening lots: Clear, then an added row while the rerun waits: the next Save does not restore the cleared lot", async () => {
    const before = await waitFor(lotsPanel, "opening lots panel");
    expect(before.querySelector<HTMLInputElement>("[data-field='quantity']")!.value).toBe("10");
    const strip = document.getElementById("results-split");
    before.querySelector<HTMLButtonElement>("#manual-opening-lots-clear-btn")!.click();
    before.querySelector<HTMLButtonElement>(".manual-opening-lot-add")!.click();
    await runLands(strip);
    expect(lotsPanel()).toBe(before);
    before.querySelector<HTMLButtonElement>("#manual-opening-lots-save-btn")!.click();
    expect(localStorage.getItem("declarenta_manual_opening_lots")).toBeNull();
  });
});

describe("a Save rerun that fails (#472 review)", () => {
  // The report generator throws on demand, so a rerun fails the way a broken
  // statement or engine error makes it fail.
  let failRun = false;
  beforeEach(async () => {
    failRun = false;
    vi.resetModules();
    vi.doMock("../../src/generators/report.js", async (importOriginal) => {
      const real = await importOriginal<typeof import("../../src/generators/report.js")>();
      return {
        ...real,
        generateTaxReport: (...args: Parameters<typeof real.generateTaxReport>) => {
          if (failRun) throw new Error("rerun failed on purpose");
          return real.generateTaxReport(...args);
        },
      };
    });
    await startApp();
  });

  afterEach(() => {
    vi.doUnmock("../../src/generators/report.js");
    vi.unstubAllGlobals();
  });

  it("a locale change after a crypto Save whose rerun failed: a later Save elsewhere does not bring back the crypto «Guardado»", async () => {
    const crypto = await waitFor(cryptoPanel, "crypto panel");
    const win = await waitFor(windowPanel, "window panel");
    crypto.querySelector<HTMLInputElement>(".crypto-rate-input")!.value = "30000";
    failRun = true;
    crypto.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    await waitFor(() => step3().querySelector(".wizard-error"), "the error of the failed rerun");
    expect(JSON.parse(localStorage.getItem("declarenta_manual_rates")!)).toHaveLength(1);
    failRun = false;
    redrawOnLocaleChange();
    windowSelect(win).value = "2";
    win.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    await redrawn(windowPanel, win, "rerun after the anti-churning Save");
    expect(shown(windowLabel())).toBe(true);
    expect(cryptoPanel()).not.toBe(crypto);
    expect(cryptoLabel().hidden).toBe(true);
  });
});

describe("crypto prices a Save cannot store (#472 review)", () => {
  // A price saved earlier for another swap: it shows in the "saved elsewhere" list.
  beforeEach(async () => {
    await startApp(() => {
      localStorage.setItem("declarenta_manual_rates", JSON.stringify([{ currency: "ETH", date: "2020-01-02", eurPerUnit: "5" }]));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const inputs = (p: HTMLElement) => {
    const all = [...p.querySelectorAll<HTMLInputElement>(".crypto-rate-input")];
    return { eth: all.find((i) => i.dataset.currency === "ETH")!, sol: all.find((i) => i.dataset.currency !== "ETH")! };
  };
  const stored = () => JSON.parse(localStorage.getItem("declarenta_manual_rates")!) as { currency: string; eurPerUnit: string }[];

  /** Refused: the row is flagged, the error says why, nothing is stored, no «Guardado», no rerun. */
  async function expectRefused(panel: HTMLElement, flagged: HTMLInputElement, ok: HTMLInputElement): Promise<void> {
    await new Promise((r) => setTimeout(r, 100));
    expect(cryptoPanel()).toBe(panel);
    expect(cryptoLabel().hidden).toBe(true);
    const error = panel.querySelector<HTMLElement>(".crypto-rates-error-msg")!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toMatch(/marcados|highlighted/);
    expect(flagged.getAttribute("aria-invalid")).toBe("true");
    expect(ok.hasAttribute("aria-invalid")).toBe(false);
    expect(stored()).toEqual([{ currency: "ETH", date: "2020-01-02", eurPerUnit: "5" }]);
  }

  it("a saved price emptied next to a new one: the Save is refused, the saved price is not kept silently", async () => {
    const before = await waitFor(cryptoPanel, "crypto panel");
    const { eth, sol } = inputs(before);
    expect(eth.value).toBe("5");
    sol.value = "30000";
    eth.value = "";
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    await expectRefused(before, eth, sol);
  });

  it("a flagged price inside the closed saved-prices list: the Save opens the list so the user sees it", async () => {
    const before = await waitFor(cryptoPanel, "crypto panel");
    const { eth, sol } = inputs(before);
    const list = eth.closest("details")!;
    expect(list.open).toBe(false);
    eth.value = "";
    sol.value = "30000";
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    await expectRefused(before, eth, sol);
    expect(list.open).toBe(true);
    expect(shown(eth)).toBe(true);
  });

  it("a flagged price outside the saved-prices list leaves the list closed (control)", async () => {
    const before = await waitFor(cryptoPanel, "crypto panel");
    const { eth, sol } = inputs(before);
    const list = eth.closest("details")!;
    sol.value = "abc";
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    await expectRefused(before, sol, eth);
    expect(list.open).toBe(false);
  });

  it("an unreadable price next to a good one: the Save is refused, not half done", async () => {
    const before = await waitFor(cryptoPanel, "crypto panel");
    const { eth, sol } = inputs(before);
    eth.value = "abc";
    sol.value = "30000";
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    await expectRefused(before, eth, sol);

    // Corrected: the Save goes through, the flag and the error go, «Guardado» on the redrawn panel.
    eth.value = "6";
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    expect(eth.hasAttribute("aria-invalid")).toBe(false);
    expect(before.querySelector<HTMLElement>(".crypto-rates-error-msg")!.hidden).toBe(true);
    await redrawn(cryptoPanel, before, "rerun after the corrected Save");
    expect(shown(cryptoLabel())).toBe(true);
    expect(stored().map((e) => `${e.currency}=${e.eurPerUnit}`).sort()).toEqual(["ETH=6", "SOL=30000"]);
  });

  it("an empty row that has no saved price is still just skipped (control)", async () => {
    const before = await waitFor(cryptoPanel, "crypto panel");
    const { sol } = inputs(before);
    sol.value = "";
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    // ETH 5 is still on screen and valid: it is saved again, and the run redraws the panel.
    await redrawn(cryptoPanel, before, "rerun");
    expect(shown(cryptoLabel())).toBe(true);
    expect(stored()).toEqual([{ currency: "ETH", date: "2020-01-02", eurPerUnit: "5" }]);
  });
});

describe("a saved crypto price with no number (#472 review)", () => {
  // Storage can hold an entry whose price is "" (written by hand or by an old
  // version). It values nothing: buildManualRateMap skips it, so its swap, if
  // any, stays in the list of swaps to value. A Save of another price must not
  // be refused for it, and must keep it as it is.
  const BLANK = { currency: "ETH", date: "2020-01-02", eurPerUnit: "" };
  beforeEach(async () => {
    await startApp(() => {
      localStorage.setItem("declarenta_manual_rates", JSON.stringify([BLANK]));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the blank entry values nothing", () => {
    expect(buildManualRateMap(coerceManualQuotes([BLANK])).size).toBe(0);
  });

  it("a blank entry for the swap on screen leaves that swap in the list to value", async () => {
    await startApp(() => {
      localStorage.setItem("declarenta_manual_rates", JSON.stringify([{ currency: "SOL", date: `${YEAR}-04-01`, eurPerUnit: "" }]));
    });
    const panel = await waitFor(cryptoPanel, "crypto panel");
    expect(panel.classList.contains("crypto-rates-stored-panel")).toBe(false);
    const sol = panel.querySelector<HTMLInputElement>(".crypto-rate-input[data-currency='SOL']")!;
    expect(sol.dataset.row).toBe("0");
    expect(sol.value).toBe("");
  });

  it("a Save of another price goes through and leaves the blank entry as it was", async () => {
    const before = await waitFor(cryptoPanel, "crypto panel");
    const all = [...before.querySelectorAll<HTMLInputElement>(".crypto-rate-input")];
    const eth = all.find((i) => i.dataset.currency === "ETH")!;
    const sol = all.find((i) => i.dataset.currency !== "ETH")!;
    expect(eth.value).toBe("");
    sol.value = "30000";
    before.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();
    expect(eth.hasAttribute("aria-invalid")).toBe(false);
    await redrawn(cryptoPanel, before, "rerun after Save");
    expect(shown(cryptoLabel())).toBe(true);
    const stored = JSON.parse(localStorage.getItem("declarenta_manual_rates")!) as { currency: string; eurPerUnit: string }[];
    expect(stored.map((e) => `${e.currency}=${e.eurPerUnit}`).sort()).toEqual(["ETH=", "SOL=30000"]);
  });
});

describe("the panel renderers carry «Guardado» only when asked (#472)", () => {
  const security: AntichurningSecurity = {
    isin: LSE_ISIN,
    symbol: "LSEONLY",
    months: 12,
    autoMonths: 12,
    source: "ibkr",
    listingExchanges: ["LSE"],
  } as AntichurningSecurity;
  const parse = (html: string) => {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div;
  };

  it("anti-churning window", () => {
    expect(parse(renderAntichurningWindowPanel([security])).querySelector<HTMLElement>(".antichurning-window-saved")!.hidden).toBe(true);
    expect(parse(renderAntichurningWindowPanel([security], { saved: true })).querySelector<HTMLElement>(".antichurning-window-saved")!.hidden).toBe(false);
  });

  it("anti-churning window saved back to «auto»: the panel that would stay closed opens to show «Guardado»", () => {
    const twoMonths = { ...security, months: 2, autoMonths: 2, listingExchanges: ["BME"] } as AntichurningSecurity;
    const closed = parse(renderAntichurningWindowPanel([twoMonths])).querySelector<HTMLDetailsElement>("details")!;
    expect(closed.open).toBe(false);
    const saved = parse(renderAntichurningWindowPanel([twoMonths], { saved: true }));
    expect(saved.querySelector<HTMLDetailsElement>("details")!.open).toBe(true);
    expect(shown(saved.querySelector<HTMLElement>(".antichurning-window-saved")!)).toBe(true);
  });

  it("anti-churning window: a row with the ISIN in lower case shows the window stored for it (#472 review)", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    localStorage.setItem("declarenta_antichurning_windows", JSON.stringify({ [LSE_ISIN]: 2 }));
    const html = renderAntichurningWindowPanel([{ ...security, isin: LSE_ISIN.toLowerCase(), months: 2, autoMonths: 2, source: "user", listingExchanges: ["BME"] }]);
    expect(parse(html).querySelector<HTMLSelectElement>(".antichurning-window-select")!.value).toBe("2");
    expect(parse(html).querySelector<HTMLDetailsElement>("details")!.open).toBe(true);
    vi.unstubAllGlobals();
  });

  it("anti-churning window with no row: nothing, unless a Save asks for «Guardado»", () => {
    expect(renderAntichurningWindowPanel([])).toBe("");
    expect(renderAntichurningWindowPanel(undefined)).toBe("");
    const saved = parse(renderAntichurningWindowPanel([], { saved: true }));
    expect(saved.querySelector("table")).toBeNull();
    expect(saved.querySelector(".antichurning-window-select")).toBeNull();
    expect(shown(saved.querySelector<HTMLElement>(".antichurning-window-saved")!)).toBe(true);
  });

  it("anti-churning window: each select shows the stored window, not the report's reading", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const select = (html: string) => parse(html).querySelector<HTMLSelectElement>(".antichurning-window-select")!;
    // The report says the user set 2 months, but storage was cleared since.
    expect(select(renderAntichurningWindowPanel([{ ...security, months: 2, source: "user" }])).value).toBe("auto");
    // The report reads 1 year from IBKR, but the user saved 2 months since.
    localStorage.setItem("declarenta_antichurning_windows", JSON.stringify({ [LSE_ISIN]: 2 }));
    expect(select(renderAntichurningWindowPanel([security])).value).toBe("2");
    vi.unstubAllGlobals();
  });

  it("crypto prices", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const unresolved = [{ symbol: "BTC", description: "BTC", date: "2025-04-01", quantity: "1", currency: "SOL" }] as UnresolvedValuation[];
    expect(parse(renderManualRatesPanel(unresolved)).querySelector<HTMLElement>(".crypto-rates-saved-msg")!.hidden).toBe(true);
    expect(parse(renderManualRatesPanel(unresolved, { saved: true })).querySelector<HTMLElement>(".crypto-rates-saved-msg")!.hidden).toBe(false);
    // Nothing left to value: the collapsed saved-prices list opens only after a Save.
    localStorage.setItem("declarenta_manual_rates", JSON.stringify([{ currency: "SOL", date: "2025-04-01", eurPerUnit: "100" }]));
    expect(parse(renderManualRatesPanel([])).querySelector<HTMLDetailsElement>(".crypto-rates-stored-panel")!.open).toBe(false);
    const stored = parse(renderManualRatesPanel([], { saved: true }));
    expect(stored.querySelector<HTMLDetailsElement>(".crypto-rates-stored-panel")!.open).toBe(true);
    expect(shown(stored.querySelector<HTMLElement>(".crypto-rates-saved-msg")!)).toBe(true);
    vi.unstubAllGlobals();
  });

  it("opening lots", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const msg = {
      id: "fifo.no_buy_lots",
      severity: "warning",
      message: "",
      context: { symbol: "ACME", isin: "XX0000000001", quantity: "10", date: "2025-03-10", currency: "EUR", assetCategory: "STK" },
    } as unknown as TaxMessage;
    const plain = parse(renderManualOpeningLotsPanel([msg]));
    if (!plain.querySelector(".manual-opening-lots-panel")) {
      vi.unstubAllGlobals();
      throw new Error("the message did not open the opening-lots panel; update the fixture message id");
    }
    expect(plain.querySelector<HTMLElement>(".manual-opening-lots-saved-msg")!.hidden).toBe(true);
    expect(parse(renderManualOpeningLotsPanel([msg], { saved: true })).querySelector<HTMLElement>(".manual-opening-lots-saved-msg")!.hidden).toBe(false);
    // The issue resolved: the panel is drawn from the stored lots and stays closed, except after a Save.
    localStorage.setItem(
      "declarenta_manual_opening_lots",
      JSON.stringify([{ symbol: "ACME", description: "ACME", isin: "XX0000000001", assetCategory: "STK", currency: "EUR", acquireDate: "2025-01-15", quantity: "10", pricePerShare: "100" }]),
    );
    expect(parse(renderManualOpeningLotsPanel([])).querySelector<HTMLDetailsElement>(".manual-opening-lots-panel")!.open).toBe(false);
    const stored = parse(renderManualOpeningLotsPanel([], { saved: true }));
    expect(stored.querySelector<HTMLDetailsElement>(".manual-opening-lots-panel")!.open).toBe(true);
    expect(shown(stored.querySelector<HTMLElement>(".manual-opening-lots-saved-msg")!)).toBe(true);
    // A Save that emptied the last stored group with no issue left: no rows, but «Guardado».
    localStorage.removeItem("declarenta_manual_opening_lots");
    expect(renderManualOpeningLotsPanel([])).toBe("");
    const emptied = parse(renderManualOpeningLotsPanel([], { saved: true }));
    expect(emptied.querySelector(".manual-opening-lot-row")).toBeNull();
    expect(shown(emptied.querySelector<HTMLElement>(".manual-opening-lots-saved-msg")!)).toBe(true);
    vi.unstubAllGlobals();
  });
});
