// @vitest-environment jsdom
/**
 * The two manual-entry panels on the results step, driven through the real app.
 *
 * The manual opening-lots panel reuses the `crypto-rates-panel` class for its
 * styling and is inserted before the crypto-rates panel. Binding the crypto
 * panel by that class alone picks the opening-lots panel instead, so the crypto
 * Save button gets no listener and does nothing.
 *
 * The opening-lot quantity and price are typed by hand, so they must accept the
 * same number formats as the crypto rates ("1.234,56") and flag a row they
 * cannot read instead of dropping it without a word.
 *
 * The statement holds a EUR stock sale with no earlier purchase (opens the
 * opening-lots panel) and a BTC buy priced in SOL (no ECB rate, opens the
 * crypto-rates panel). Neither needs an ECB request, so fetch is stubbed to fail.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");
const YEAR = new Date().getFullYear() - 1; // the profile's default declaration year

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U0000001" fromDate="${YEAR}0101" toDate="${YEAR}1231" period="LastYear">
      <Trades>
        <Trade tradeID="1" accountId="U0000001" symbol="ACME" description="ACME CORP"
          isin="XX0000000001" assetCategory="STK" currency="EUR"
          tradeDate="${YEAR}0310" settlementDate="" quantity="-10" tradePrice="120"
          tradeMoney="-1200.00" proceeds="1200.00" cost="0" fifoPnlRealized="0" fxRateToBase="1"
          buySell="SELL" openCloseIndicator="C" exchange="BME"
          ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />
        <Trade tradeID="2" accountId="U0000001" symbol="BTC" description="BTC paid in SOL"
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

const RATES_KEY = "declarenta_manual_rates";
const LOTS_KEY = "declarenta_manual_opening_lots";

async function waitFor<T>(probe: () => T | null | undefined, label: string): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const v = probe();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Upload the statement and walk the wizard to the results step. */
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

function type(input: HTMLInputElement | null, value: string): void {
  expect(input).not.toBeNull();
  input!.value = value;
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

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__COMMIT_HASH__", "test");
  document.documentElement.innerHTML = new DOMParser().parseFromString(
    INDEX_HTML,
    "text/html",
  ).documentElement.innerHTML;
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
  await import("../../src/web/main.js");
  await openResults();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("crypto-rates Save next to the opening-lots panel", () => {
  it("both panels are shown, opening lots first", () => {
    const panels = [...document.querySelectorAll("#wizard-step-3 .crypto-rates-panel")];
    expect(panels.map((el) => el.tagName)).toEqual(["DETAILS", "DIV"]);
    expect(panels[0]!.classList.contains("manual-opening-lots-panel")).toBe(true);
  });

  it("saves the typed rate and recalculates", async () => {
    type(document.querySelector<HTMLInputElement>(".crypto-rate-input"), "30000");
    document.getElementById("crypto-rates-save-btn")!.click();

    const stored = JSON.parse(localStorage.getItem(RATES_KEY) ?? "[]") as { currency: string; eurPerUnit: string }[];
    expect(stored).toEqual([{ currency: "SOL", date: `${YEAR}-04-01`, eurPerUnit: "30000" }]);
    // The rerun values the swap, so the panel asking for the rate goes away.
    await waitFor(() => document.querySelector(".crypto-rates-stored-panel"), "saved prices panel");
    expect(document.querySelector("#wizard-step-3 div.crypto-rates-panel")).toBeNull();
  });
});

describe("saved crypto prices once every swap is valued", () => {
  async function saveMistypedPrice(): Promise<HTMLDetailsElement> {
    type(document.querySelector<HTMLInputElement>(".crypto-rate-input"), "30000");
    document.getElementById("crypto-rates-save-btn")!.click();
    return waitFor(
      () => document.querySelector<HTMLDetailsElement>(".crypto-rates-stored-panel"),
      "saved prices panel",
    );
  }

  it("lists the saved price collapsed, with its value", async () => {
    const panel = await saveMistypedPrice();
    expect(panel.open).toBe(false);
    const input = panel.querySelector<HTMLInputElement>(".crypto-rate-input")!;
    expect(input.dataset.currency).toBe("SOL");
    expect(input.dataset.date).toBe(`${YEAR}-04-01`);
    expect(input.value).toBe("30000");
  });

  it("corrects a saved price in place", async () => {
    const panel = await saveMistypedPrice();
    type(panel.querySelector<HTMLInputElement>(".crypto-rate-input"), "3,5");
    panel.querySelector<HTMLButtonElement>("#crypto-rates-save-btn")!.click();

    const stored = JSON.parse(localStorage.getItem(RATES_KEY) ?? "[]") as { eurPerUnit: string }[];
    expect(stored.map((e) => e.eurPerUnit)).toEqual(["3.5"]);
    await waitFor(
      () =>
        document.querySelector<HTMLInputElement>(".crypto-rates-stored-panel .crypto-rate-input")?.value === "3.5" ||
        null,
      "corrected price shown",
    );
  });

  it("clears every saved price and asks for the rate again", async () => {
    const panel = await saveMistypedPrice();
    panel.querySelector<HTMLButtonElement>("#crypto-rates-clear-btn")!.click();

    expect(localStorage.getItem(RATES_KEY)).toBeNull();
    const asking = await waitFor(
      () => document.querySelector<HTMLElement>("#wizard-step-3 div.crypto-rates-panel"),
      "crypto panel back",
    );
    expect(asking.querySelector<HTMLInputElement>(".crypto-rate-input")!.value).toBe("");
    expect(document.querySelector(".crypto-rates-stored-panel")).toBeNull();
    expect(asking.querySelector("#crypto-rates-clear-btn")).toBeNull();
  });
});

describe("opening-lot inputs", () => {
  function row(): HTMLTableRowElement {
    return document.querySelector<HTMLTableRowElement>(".manual-opening-lot-row")!;
  }
  function field(r: HTMLElement, name: string): HTMLInputElement {
    return r.querySelector<HTMLInputElement>(`[data-field='${name}']`)!;
  }

  it("accepts Spanish thousands separators in quantity and price", () => {
    const r = row();
    type(field(r, "acquireDate"), `${YEAR - 1}-01-10`);
    type(field(r, "quantity"), "1 000,5");
    type(field(r, "pricePerShare"), "1.234,56");
    document.getElementById("manual-opening-lots-save-btn")!.click();

    const stored = JSON.parse(localStorage.getItem(LOTS_KEY) ?? "[]") as { quantity: string; pricePerShare: string }[];
    expect(stored.map((l) => [l.quantity, l.pricePerShare])).toEqual([["1000.5", "1234.56"]]);
  });

  it("flags a row it cannot read and saves nothing until it is fixed", () => {
    const first = row();
    type(field(first, "acquireDate"), `${YEAR - 1}-01-10`);
    type(field(first, "quantity"), "4");
    type(field(first, "pricePerShare"), "100,00");
    first.querySelector<HTMLButtonElement>(".manual-opening-lot-add")!.click();
    const rows = document.querySelectorAll<HTMLTableRowElement>(".manual-opening-lot-row");
    expect(rows).toHaveLength(2);
    const second = rows[1]!;
    type(field(second, "acquireDate"), `${YEAR - 1}-02-10`);
    type(field(second, "quantity"), "6");
    type(field(second, "pricePerShare"), "cien");

    document.getElementById("manual-opening-lots-save-btn")!.click();

    expect(localStorage.getItem(LOTS_KEY)).toBeNull();
    expect(field(second, "pricePerShare").getAttribute("aria-invalid")).toBe("true");
    expect(field(first, "pricePerShare").hasAttribute("aria-invalid")).toBe(false);
    const error = document.querySelector<HTMLElement>(".manual-opening-lots-error-msg");
    expect(error).not.toBeNull();
    expect(error!.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>(".manual-opening-lots-saved-msg")!.hidden).toBe(true);

    // Fixing the row clears the flag and saves both lots.
    type(field(second, "pricePerShare"), "110");
    document.getElementById("manual-opening-lots-save-btn")!.click();
    const stored = JSON.parse(localStorage.getItem(LOTS_KEY) ?? "[]") as { quantity: string }[];
    expect(stored.map((l) => l.quantity).sort()).toEqual(["4", "6"]);
  });

  it("ignores a row left completely empty", () => {
    const first = row();
    type(field(first, "acquireDate"), `${YEAR - 1}-01-10`);
    type(field(first, "quantity"), "10");
    type(field(first, "pricePerShare"), "100");
    first.querySelector<HTMLButtonElement>(".manual-opening-lot-add")!.click();

    document.getElementById("manual-opening-lots-save-btn")!.click();

    const stored = JSON.parse(localStorage.getItem(LOTS_KEY) ?? "[]") as { quantity: string }[];
    expect(stored.map((l) => l.quantity)).toEqual(["10"]);
    expect(document.querySelector("[aria-invalid='true']")).toBeNull();
  });
});
