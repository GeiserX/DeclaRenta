// @vitest-environment jsdom
/**
 * The wizard keeps the newest year in the data as the default, so the chosen
 * year must be visible before processing (Review step) and an unfinished year
 * must be flagged on Results, 720 and D-6.
 *
 * Drives the real app like review-escape.test.ts: the real index.html, the real
 * main.ts, a File handed to #file-input and the wizard's Next button. All
 * amounts are in EUR so no ECB request is needed. Only Date is faked (to May
 * 2026), so 2026 is the year in progress and 2025 is the last closed one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");

function trade(id: string, tradeDate: string, side: "BUY" | "SELL"): string {
  const qty = side === "BUY" ? "10" : "-10";
  const money = side === "BUY" ? "1000.00" : "-1200.00";
  return `<Trade tradeID="${id}" accountId="U0000001" symbol="ACME" description="ACME CORP"
    isin="IE0000000001" assetCategory="STK" currency="EUR"
    tradeDate="${tradeDate}" settlementDate=""
    quantity="${qty}" tradePrice="${side === "BUY" ? "100" : "120"}" tradeMoney="${money}"
    proceeds="${money}" cost="0" fifoPnlRealized="0" fxRateToBase="1"
    buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}"
    exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />`;
}

/** Trades in 2025 and 2026 plus one EUR position, so 720 and D-6 render their header. */
const TWO_YEAR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U0000001" fromDate="20250101" toDate="20260430" period="Custom">
      <Trades>${trade("1", "20250110", "BUY")}${trade("2", "20250310", "SELL")}${trade("3", "20260210", "BUY")}</Trades>
      <CashTransactions />
      <CorporateActions />
      <OpenPositions>
        <OpenPosition accountId="U0000001" symbol="ACME" description="ACME CORP"
          isin="IE0000000001" currency="EUR" assetCategory="STK"
          quantity="10" costBasisMoney="1000" costBasisPrice="100"
          markPrice="100" positionValue="1000" fifoPnlUnrealized="0" fxRateToBase="1" />
      </OpenPositions>
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

async function uploadAndReview(xml: string): Promise<HTMLElement> {
  const file = new File([xml], "statement.xml", { type: "text/xml" });
  const input = document.getElementById("file-input") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
  await waitFor(() => !(document.getElementById("wizard-next") as HTMLButtonElement).disabled || null, "Next enabled");
  document.getElementById("wizard-next")!.click();
  return waitFor(() => document.querySelector<HTMLElement>("#review-content .review-year"), "review year card");
}

async function continueToResults(): Promise<void> {
  document.getElementById("wizard-next")!.click();
  await waitFor(() => document.querySelector("#results-year-select"), "results year selector");
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

const savedYear = () => (JSON.parse(localStorage.getItem("declarenta_profile") ?? "{}") as { year?: number }).year;
const reviewSelect = () => document.getElementById("review-year-select") as HTMLSelectElement;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 4, 15));
  vi.stubGlobal("localStorage", memoryStorage());
  localStorage.setItem("locale", "es"); // the assertions below read Spanish text
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Review step shows the chosen year before processing", () => {
  it("keeps the newest year as the default and tags it as in progress", async () => {
    const card = await uploadAndReview(TWO_YEAR_XML);
    expect(reviewSelect().value).toBe("2026");
    expect([...reviewSelect().options].map((o) => o.value)).toEqual(["2026", "2025"]);
    expect(card.querySelector(".review-year-tag")?.textContent).toBe("en curso");
    expect(savedYear()).toBe(2026);
  });

  it("switching to a closed year there drops the tag, saves the profile year and processes that year", async () => {
    await uploadAndReview(TWO_YEAR_XML);
    reviewSelect().value = "2025";
    reviewSelect().dispatchEvent(new Event("change"));

    const card = document.querySelector("#review-content .review-year")!;
    expect(reviewSelect().value).toBe("2025");
    expect(card.querySelector(".review-year-tag")).toBeNull();
    expect(savedYear()).toBe(2025);

    await continueToResults();
    expect((document.getElementById("results-year-select") as HTMLSelectElement).value).toBe("2025");
    expect(document.querySelector("#results-year-header .open-year-banner")).toBeNull();
    expect(document.querySelector("#m720-content .open-year-banner")).toBeNull();
    expect(document.querySelector("#d6-content .open-year-banner")).toBeNull();
  });

  it("re-renders the year card on a language change", async () => {
    await uploadAndReview(TWO_YEAR_XML);
    const { setLocale } = await import("../../src/i18n/index.js");
    setLocale("en");
    const card = document.querySelector("#review-content .review-year")!;
    expect(card.querySelector(".review-label")?.textContent).toBe("Tax year to calculate");
    expect(card.querySelector(".review-year-tag")?.textContent).toBe("in progress");
    setLocale("es");
  });
});

describe("an unfinished year is flagged after processing", () => {
  it("shows the 'ejercicio en curso' banner on Results, 720 and D-6", async () => {
    await uploadAndReview(TWO_YEAR_XML);
    await continueToResults();

    const results = document.querySelector("#results-year-header .open-year-banner");
    expect(results?.textContent).toContain("Ejercicio en curso: 2026 aún no ha terminado");
    expect(results?.querySelector("a")).toBeNull();
    for (const id of ["m720-content", "d6-content"]) {
      const banner = document.querySelector(`#${id} .open-year-banner`);
      expect(banner, id).not.toBeNull();
      expect(banner!.querySelector('a[href="#renta"]')).not.toBeNull();
    }
  });
});
