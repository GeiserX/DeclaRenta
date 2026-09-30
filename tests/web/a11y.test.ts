// @vitest-environment jsdom
/**
 * Every control a user reaches on the Renta flow must have an accessible name,
 * and the sortable result tables must work from the keyboard and announce their
 * sort state.
 *
 * This drives the real app: the real index.html markup, the real main.ts, a
 * File handed to #file-input, and the wizard's Next button. All amounts are in
 * EUR so no ECB request is needed (fetch is stubbed to fail if one is made).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");

function flexXml(trades: string, cash = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U0000001" fromDate="20250101" toDate="20251231" period="LastYear">
      <Trades>${trades}</Trades>
      <CashTransactions>${cash}</CashTransactions>
      <CorporateActions />
      <OpenPositions />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;
}

function trade(id: string, symbol: string, isin: string, tradeDate: string, side: "BUY" | "SELL", price: string): string {
  const qty = side === "BUY" ? "10" : "-10";
  const money = side === "BUY" ? `${Number(price) * 10}.00` : `-${Number(price) * 10}.00`;
  return `<Trade tradeID="${id}" accountId="U0000001" symbol="${symbol}" description="${symbol} CORP"
    isin="${isin}" assetCategory="STK" currency="EUR"
    tradeDate="${tradeDate}" settlementDate=""
    quantity="${qty}" tradePrice="${price}" tradeMoney="${money}"
    proceeds="${money}" cost="0" fifoPnlRealized="0" fxRateToBase="1"
    buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}"
    exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />`;
}

function dividend(): string {
  return `<CashTransaction transactionID="900" accountId="U0000001" symbol="ACME"
    description="ACME(XX0000000001) Cash Dividend" isin="XX0000000001" currency="EUR"
    dateTime="20250315" settleDate="" amount="5.00" fxRateToBase="1" type="Dividends" />`;
}

const STATEMENT = flexXml(
  trade("1", "ACME", "XX0000000001", "20250110", "BUY", "100") +
    trade("2", "ACME", "XX0000000001", "20250310", "SELL", "120") +
    trade("3", "BETA", "XX0000000002", "20250110", "BUY", "50") +
    trade("4", "BETA", "XX0000000002", "20250410", "SELL", "40"),
  dividend(),
);

async function waitFor<T>(probe: () => T | null | undefined, label: string): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const v = probe();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function upload(xml: string, name = "statement.xml"): Promise<void> {
  const file = new File([xml], name, { type: "text/xml" });
  const input = document.getElementById("file-input") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
  await waitFor(() => !(document.getElementById("wizard-next") as HTMLButtonElement).disabled || null, "Next enabled");
}

async function uploadAndShowResults(xml: string): Promise<void> {
  await upload(xml);
  document.getElementById("wizard-next")!.click();
  await waitFor(() => document.querySelector("#review-content .review-grid"), "review grid");
  document.getElementById("wizard-next")!.click();
  await waitFor(() => document.querySelector("#operations-table table"), "operations table");
}

/**
 * The accessible name a screen reader announces, per the parts of the
 * accessible-name algorithm these controls can use. A placeholder is left out
 * on purpose: it vanishes once the user types and is not a label.
 */
function accessibleName(el: Element): string {
  const ariaLabel = el.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length > 0) {
    return [...labels].map((l) => l.textContent).join(" ").trim();
  }
  if (el.tagName === "BUTTON") return el.textContent.trim();
  return (el.getAttribute("title") ?? "").trim();
}

function describeControl(el: Element): string {
  return el.outerHTML.slice(0, 120);
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

/** The controls written into index.html itself, captured before main.ts runs. */
let staticControls: Element[] = [];

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__COMMIT_HASH__", "test");
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(INDEX_HTML, "text/html")
    .documentElement.innerHTML;
  staticControls = [...document.querySelectorAll("select, input, button")];
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
  await import("../../src/web/main.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("every control has an accessible name", () => {
  it("control: the name helper returns empty for a bare select and a placeholder-only input", () => {
    const probe = document.createElement("div");
    probe.innerHTML = `<select><option>Todas</option></select><input type="text" placeholder="Buscar">`;
    document.body.appendChild(probe);
    expect(accessibleName(probe.querySelector("select")!)).toBe("");
    expect(accessibleName(probe.querySelector("input")!)).toBe("");
    probe.remove();
  });

  it("every select, input and button in index.html has a name", () => {
    const controls = staticControls.filter(
      (el) => !(el as HTMLElement).hidden && el.getAttribute("type") !== "hidden",
    );
    expect(controls.length).toBeGreaterThan(10);
    const unnamed = controls.filter((el) => accessibleName(el) === "").map(describeControl);
    expect(unnamed).toEqual([]);
  });

  it("the operations search and filter follow the active locale", async () => {
    const { setLocale } = await import("../../src/i18n/index.js");
    const search = document.getElementById("ops-search")!;
    const filter = document.getElementById("ops-filter")!;
    await setLocale("es");
    expect(accessibleName(search)).toBe("Buscar operaciones por ISIN o símbolo");
    expect(accessibleName(filter)).toBe("Filtrar operaciones por resultado");
    await setLocale("en");
    expect(accessibleName(search)).toBe("Search operations by ISIN or symbol");
    expect(accessibleName(filter)).toBe("Filter operations by result");
  });

  it("the results header year select has a name", async () => {
    await uploadAndShowResults(STATEMENT);
    const controls = [...document.querySelectorAll("#results-year-header select, #results-year-header input, #results-year-header button")];
    expect(controls.length).toBeGreaterThan(0);
    const unnamed = controls.filter((el) => accessibleName(el) === "").map(describeControl);
    expect(unnamed).toEqual([]);
  });

  it("the remove button of an uploaded file says which file it removes", async () => {
    await upload(STATEMENT, "mi-extracto-2025.xml");
    const remove = () => document.querySelector("#file-list .remove-file")!;
    expect(accessibleName(remove())).toContain("mi-extracto-2025.xml");

    // The name is rebuilt in the new language when the user switches locale.
    const { setLocale } = await import("../../src/i18n/index.js");
    await setLocale("es");
    expect(accessibleName(remove())).toBe("Quitar mi-extracto-2025.xml");
    await setLocale("en");
    expect(accessibleName(remove())).toBe("Remove mi-extracto-2025.xml");
  });
});

describe("sortable table headers", () => {
  it("each sortable header holds a focusable button", async () => {
    await uploadAndShowResults(STATEMENT);
    for (const id of ["operations-table", "dividends-table"]) {
      const headers = [...document.querySelectorAll(`#${id} th.sortable`)];
      expect(headers.length).toBeGreaterThan(0);
      for (const th of headers) {
        const btn = th.querySelector("button");
        expect(btn, describeControl(th)).not.toBeNull();
        expect(btn!.getAttribute("type")).toBe("button");
        expect(accessibleName(btn!)).not.toBe("");
      }
    }
  });

  it("a sorted header announces its direction, and focus stays on its button", async () => {
    await uploadAndShowResults(STATEMENT);
    const ops = document.getElementById("operations-table")!;
    expect(ops.querySelector("th[aria-sort]")).toBeNull();

    const button = () => ops.querySelector<HTMLButtonElement>('th[data-col="gl"] button')!;
    button().focus();
    button().click();
    expect(ops.querySelector('th[data-col="gl"]')!.getAttribute("aria-sort")).toBe("ascending");
    expect(ops.querySelectorAll("th[aria-sort]").length).toBe(1);
    expect(document.activeElement).toBe(button());

    button().click();
    expect(ops.querySelector('th[data-col="gl"]')!.getAttribute("aria-sort")).toBe("descending");
    expect(document.activeElement).toBe(button());

    button().click();
    expect(ops.querySelector("th[aria-sort]")).toBeNull();
  });

  it("the dividends table announces its sort too", async () => {
    await uploadAndShowResults(STATEMENT);
    const divs = document.getElementById("dividends-table")!;
    divs.querySelector<HTMLButtonElement>('th[data-col="gross"] button')!.click();
    expect(divs.querySelector('th[data-col="gross"]')!.getAttribute("aria-sort")).toBe("ascending");
  });
});
