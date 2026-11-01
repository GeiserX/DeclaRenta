// @vitest-environment jsdom
/**
 * The operations table on the results step names the purchase and the sale
 * broker of each sale when the sales cross brokers, like the annex and the
 * PDFs (showBrokerColumns). The two columns sort like the others and the
 * search box matches broker names. A one-broker report keeps its nine columns.
 *
 * This drives the real app: the real index.html markup, the real main.ts, and
 * the anonymised two-broker fixtures handed to #file-input. All amounts are in
 * EUR, so no ECB request is needed (fetch is stubbed to fail if one is made).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");
const fixture = (name: string) => readFileSync(resolve(__dirname, "../fixtures", name), "utf-8");

async function waitFor<T>(probe: () => T | null | undefined, label: string): Promise<T> {
  for (let i = 0; i < 300; i++) {
    const v = probe();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** In-memory localStorage (newer Node versions shadow jsdom's with their own). */
function memoryStorage(initial: Record<string, string>): Storage {
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

async function loadApp(): Promise<void> {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage({ locale: "es" }));
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__COMMIT_HASH__", "test");
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(INDEX_HTML, "text/html")
    .documentElement.innerHTML;
  Element.prototype.scrollIntoView = () => {}; // jsdom has no scrollIntoView; the wizard calls it
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
  await import("../../src/web/main.js");
}

async function toResults(files: { name: string; type: string }[]): Promise<HTMLElement> {
  const input = document.getElementById("file-input") as HTMLInputElement;
  const list = files.map((f) => new File([fixture(f.name)], f.name, { type: f.type }));
  Object.defineProperty(input, "files", { value: list, configurable: true });
  input.dispatchEvent(new Event("change"));
  await waitFor(() => !(document.getElementById("wizard-next") as HTMLButtonElement).disabled || null, "Next enabled");
  document.getElementById("wizard-next")!.click();
  await waitFor(() => document.querySelector("#review-content .review-grid"), "review grid");
  document.getElementById("wizard-next")!.click();
  return waitFor(() => document.querySelector<HTMLElement>("#operations-table table"), "operations table");
}

const IBKR = { name: "two-broker-ibkr.xml", type: "text/xml" };
const DEGIRO = { name: "two-broker-degiro.csv", type: "text/csv" };

const ops = () => document.getElementById("operations-table")!;
const headers = () => [...ops().querySelectorAll<HTMLElement>("thead th")].map((th) => th.textContent.trim());
/** Each row as [symbol, purchase broker, sale broker], read from the cells. */
function rows(): string[][] {
  return [...ops().querySelectorAll("tbody tr:not(.wash-sale-detail)")].map((tr) => {
    const cells = [...tr.querySelectorAll("td")].map((td) => td.textContent.trim());
    return [cells[1]!, cells[4]!, cells[5]!];
  });
}
function clickSort(col: string): void {
  ops().querySelector<HTMLButtonElement>(`th[data-col="${col}"] .sort-btn`)!.click();
}
async function search(value: string): Promise<void> {
  const before = ops().querySelector("table");
  const input = document.getElementById("ops-search") as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await waitFor(() => ops().querySelector("table") !== before || null, "the debounced search render");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("results operations table — purchase and sale broker", () => {
  it("adds sortable purchase and sale broker columns after the dates when the sales cross brokers", async () => {
    await loadApp();
    const table = await toResults([IBKR, DEGIRO]);
    expect(headers().slice(2, 6)).toEqual(["F. Compra", "F. Venta", "Broker compra", "Broker venta"]);
    expect(table.classList.contains("ops-table--brokers")).toBe(true);
    for (const col of ["buyBroker", "sellBroker"]) {
      expect(ops().querySelector(`th.sortable[data-col="${col}"] .sort-btn`)).not.toBeNull();
    }
    expect(rows()).toEqual([
      ["ACME WORLD ETF", "Interactive Brokers", "Degiro"],
      ["BETA", "Interactive Brokers", "Interactive Brokers"],
      ["TERCERA SA", "Degiro", "Degiro"],
    ]);
    // The symbol cell keeps the full name in its tooltip.
    const symbol = ops().querySelector<HTMLElement>("tbody .cell-symbol")!;
    expect(symbol.title).toBe("ACME WORLD ETF");
  });

  it("sorts by purchase broker and by sale broker", async () => {
    await loadApp();
    await toResults([IBKR, DEGIRO]);

    clickSort("buyBroker");
    expect(rows().map((r) => r[1])).toEqual(["Degiro", "Interactive Brokers", "Interactive Brokers"]);
    expect(ops().querySelector('th[data-col="buyBroker"]')!.getAttribute("aria-sort")).toBe("ascending");
    clickSort("buyBroker");
    expect(rows().map((r) => r[1])).toEqual(["Interactive Brokers", "Interactive Brokers", "Degiro"]);

    clickSort("sellBroker");
    expect(rows().map((r) => r[2])).toEqual(["Degiro", "Degiro", "Interactive Brokers"]);
    clickSort("sellBroker");
    expect(rows().map((r) => r[2])).toEqual(["Interactive Brokers", "Degiro", "Degiro"]);
  });

  it("matches broker names in the search box", async () => {
    await loadApp();
    await toResults([IBKR, DEGIRO]);

    await search("degiro");
    expect(rows().map((r) => r[0])).toEqual(["ACME WORLD ETF", "TERCERA SA"]);
    await search("INTERACTIVE");
    expect(rows().map((r) => r[0])).toEqual(["ACME WORLD ETF", "BETA"]);
    // ISIN and symbol still match.
    await search("xx0000000102");
    expect(rows().map((r) => r[0])).toEqual(["BETA"]);
  });

  it("keeps nine columns for a one-broker report, and the search does not match the hidden broker", async () => {
    await loadApp();
    const table = await toResults([IBKR]);
    expect(headers()).toHaveLength(9);
    expect(headers()).not.toContain("Broker compra");
    expect(table.classList.contains("ops-table--brokers")).toBe(false);
    expect(ops().querySelectorAll("tbody tr")).toHaveLength(1);

    await search("interactive");
    expect(ops().querySelectorAll("tbody tr")).toHaveLength(0);
  });
});
