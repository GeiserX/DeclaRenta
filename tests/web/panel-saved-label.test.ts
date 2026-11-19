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
import type { AntichurningSecurity, TaxMessage, UnresolvedValuation } from "../../src/types/tax.js";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");
const YEAR = new Date().getFullYear() - 1; // the profile's default declaration year
const LSE_ISIN = "GB0007980591";

const lseRow = (id: string, date: string, qty: number, price: number) => {
  const side = qty > 0 ? "BUY" : "SELL";
  const money = (Math.abs(qty) * price).toFixed(2);
  return `<Trade tradeID="${id}" accountId="U0000001" symbol="LSEONLY" description="LONDON ONLY PLC"
    isin="${LSE_ISIN}" assetCategory="STK" currency="EUR" tradeDate="${YEAR}${date}" settlementDate=""
    quantity="${qty}" tradePrice="${price}" tradeMoney="${side === "BUY" ? money : `-${money}`}" proceeds="${side === "BUY" ? `-${money}` : money}"
    cost="0" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}"
    exchange="LSE" listingExchange="LSE" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />`;
};

/**
 * One statement that opens all three panels: a London-only share bought, sold at
 * a loss and bought back (anti-churning window panel), a EUR sale with no
 * earlier purchase (opening lots) and a BTC buy priced in SOL (crypto price).
 * A buy the year before gives the results year select a second year.
 * Nothing needs an ECB rate, so fetch is stubbed to fail.
 */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U0000001" fromDate="${YEAR - 1}0101" toDate="${YEAR}1231" period="Custom">
      <Trades>${lseRow("1", "0201", 1, 100)}${lseRow("2", "0301", -1, 80)}${lseRow("3", "0801", 1, 85)}
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
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => {
      if (refuseWrites) throw new Error("QuotaExceededError");
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

const step3 = () => document.getElementById("wizard-step-3")!;
const windowPanel = () => step3().querySelector<HTMLElement>(".antichurning-window-panel");
const lotsPanel = () => step3().querySelector<HTMLElement>(".manual-opening-lots-panel");
/** The crypto panel: the one asking for prices, or the saved-prices list it turns into. */
const cryptoPanel = () =>
  step3().querySelector<HTMLElement>(".crypto-rates-panel:not(.manual-opening-lots-panel):not(.antichurning-window-panel)");
const label = (panel: HTMLElement | null, selector: string) => panel!.querySelector<HTMLElement>(selector)!;
const windowLabel = () => label(windowPanel(), ".antichurning-window-saved");
const lotsLabel = () => label(lotsPanel(), ".manual-opening-lots-saved-msg");
const cryptoLabel = () => label(cryptoPanel(), ".crypto-rates-saved-msg");

/** A redraw that happens without a Save: the results re-render on a locale change. */
function redrawOnLocaleChange(): void {
  document.dispatchEvent(new Event("localechange"));
}

/** Wait until `panel()` is a new element (the rerun redrew it). */
const redrawn = (panel: () => HTMLElement | null, old: HTMLElement, what: string) =>
  waitFor(() => (panel() && panel() !== old ? panel() : null), what);

describe("«Guardado» after a Save in the real app (#472)", () => {
  beforeEach(async () => {
    refuseWrites = false;
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
    expect(windowLabel().hidden).toBe(false);
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
    expect(windowLabel().hidden).toBe(false);
    second.querySelector<HTMLButtonElement>(".antichurning-window-clear")!.click();
    await redrawn(windowPanel, second, "rerun after Clear");
    expect(windowLabel().hidden).toBe(true);
  });

  it("anti-churning window: a refused save after a good one hides «Guardado» and shows the error", async () => {
    const first = await waitFor(windowPanel, "window panel");
    first.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!.value = "2";
    first.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    const second = await redrawn(windowPanel, first, "rerun after Save");
    expect(windowLabel().hidden).toBe(false);
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
    expect(cryptoLabel().hidden).toBe(false);
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
    expect(cryptoLabel().hidden).toBe(false);
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
    expect(lotsLabel().hidden).toBe(false);
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

  it("a year change after a Save redraws the panels without «Guardado»", async () => {
    const before = await waitFor(windowPanel, "window panel");
    before.querySelector<HTMLSelectElement>(`.antichurning-window-select[data-isin='${LSE_ISIN}']`)!.value = "2";
    before.querySelector<HTMLButtonElement>(".antichurning-window-save")!.click();
    const second = await redrawn(windowPanel, before, "rerun after Save");
    expect(windowLabel().hidden).toBe(false);
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

  it("crypto prices", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const unresolved = [{ symbol: "BTC", description: "BTC", date: "2025-04-01", quantity: "1", currency: "SOL" }] as UnresolvedValuation[];
    expect(parse(renderManualRatesPanel(unresolved)).querySelector<HTMLElement>(".crypto-rates-saved-msg")!.hidden).toBe(true);
    expect(parse(renderManualRatesPanel(unresolved, { saved: true })).querySelector<HTMLElement>(".crypto-rates-saved-msg")!.hidden).toBe(false);
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
    vi.unstubAllGlobals();
  });
});
