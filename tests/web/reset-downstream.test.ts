// @vitest-environment jsdom
/**
 * The upload list is the source of every later section. When it changes, the
 * results built from the old list must go, and errors raised on the Results
 * step must be shown on the Results step.
 *
 * - Removing a file used to leave the Modelo 720 / D-6 sections, their cached
 *   data (a locale switch re-rendered it) and the "Completo" badge in place, and
 *   kept the old active year for the next run.
 * - An empty file got the generic "broker not detected" error plus a dump of
 *   every parser name.
 * - #file-input kept its selection, so picking the same file again after
 *   removing it fired no change event.
 * - A failed re-run or PDF export from the Results step wrote its error into
 *   the hidden Review panel, so nothing appeared.
 *
 * This drives the real app: the real index.html markup and the real main.ts.
 * All amounts are in EUR so no ECB request is needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");

/** One IBKR Flex statement for `account`, with the given trades and open positions. */
function flexXml(account: string, trades: string, positions = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="${account}" fromDate="20240101" toDate="20251231" period="LastYear">
      <Trades>${trades}</Trades>
      <CashTransactions />
      <CorporateActions />
      <OpenPositions>${positions}</OpenPositions>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;
}

function buy(account: string, id: string, symbol: string, tradeDate: string): string {
  return `<Trade tradeID="${id}" accountId="${account}" symbol="${symbol}" description="${symbol} CORP"
    isin="XX000000000${id}" assetCategory="STK" currency="EUR"
    tradeDate="${tradeDate}" settlementDate=""
    quantity="10" tradePrice="100" tradeMoney="1000.00"
    proceeds="-1000.00" cost="0" fifoPnlRealized="0" fxRateToBase="1"
    buySell="BUY" openCloseIndicator="O"
    exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />`;
}

function position(account: string, symbol: string): string {
  return `<OpenPosition accountId="${account}" symbol="${symbol}" description="${symbol} CORP"
    isin="XX0000000009" currency="EUR" assetCategory="STK"
    quantity="1000" costBasisMoney="60000" costBasisPrice="60"
    markPrice="60" positionValue="60000" fifoPnlUnrealized="0" fxRateToBase="1" />`;
}

/** 2025 file holding GLOBEX at year end (60.000 €, above the 720 threshold). */
const FILE_2025 = flexXml("U0000001", buy("U0000001", "1", "ACME", "20250110"), position("U0000001", "GLOBEX"));
/** 2024 file, other account, no open positions. */
const FILE_2024 = flexXml("U0000002", buy("U0000002", "2", "INITECH", "20240110"));
/** One file with activity in both 2024 and 2025. */
const FILE_TWO_YEARS = flexXml(
  "U0000001",
  buy("U0000001", "1", "ACME", "20240110") + buy("U0000001", "2", "ACME", "20250110"),
);

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

/** Hand `files` to #file-input and fire its change event. */
function pick(files: File[]): HTMLInputElement {
  const input = byId("file-input") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new Event("change"));
  return input;
}

async function toReview(): Promise<void> {
  await waitFor(() => !nextBtn().disabled || null, "Next enabled");
  nextBtn().click();
  await waitFor(() => !byId("wizard-step-2").hidden || null, "review step");
}

async function toResults(): Promise<void> {
  await waitFor(() => byId("review-content").querySelector(".review-grid"), "review grid");
  nextBtn().click();
  await waitFor(() => (!byId("wizard-step-3").hidden && byId("operations-table").querySelector("table")) || null, "results");
}

const xmlFile = (name: string, xml: string) => new File([xml], name, { type: "text/xml" });

/** In-memory localStorage (newer Node versions shadow jsdom's with their own). */
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

type T = (key: string, params?: Record<string, string>) => string;
let t: T;

/** Load main.ts (after any vi.doMock) and the i18n instance it uses. */
async function boot(): Promise<void> {
  await import("../../src/web/main.js");
  t = (await import("../../src/i18n/index.js")).t as T;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__COMMIT_HASH__", "test");
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(INDEX_HTML, "text/html")
    .documentElement.innerHTML;
  Element.prototype.scrollIntoView = () => {}; // jsdom has no scrollIntoView; the wizard calls it
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
});

afterEach(() => {
  vi.doUnmock("../../src/engine/ecb-orchestrator.js");
  vi.doUnmock("../../src/generators/pdf-web.js");
  vi.unstubAllGlobals();
});

describe("removing an uploaded file resets everything built from it", () => {
  it("clears the 720 and D-6 sections, their cached data and the Renta badge", async () => {
    await boot();
    pick([xmlFile("a.xml", FILE_2025)]);
    await toReview();
    await toResults();

    // Control: the results are really there before the removal.
    expect(byId("m720-content").textContent).toContain("GLOBEX");
    expect(byId("d6-content").textContent).toContain("GLOBEX");
    expect(byId("badge-renta").textContent).toBe(t("badge.complete"));

    byId("file-list").querySelector<HTMLButtonElement>(".remove-file")!.click();

    for (const id of ["m720-content", "m721-content", "d6-content"]) {
      expect(byId(id).textContent).not.toContain("GLOBEX");
      expect(byId(id).querySelector(".empty-state")).not.toBeNull();
    }
    expect(byId("badge-renta").textContent).toBe("");
    expect(byId("badge-renta").classList.contains("badge-success")).toBe(false);

    // A locale switch re-renders from the section caches: the removed data must
    // not come back, and the Modelo 720 generate button must not exist.
    document.dispatchEvent(new Event("localechange"));
    expect(byId("m720-content").textContent).not.toContain("GLOBEX");
    expect(byId("d6-content").textContent).not.toContain("GLOBEX");
    expect(document.getElementById("m720-generate-btn")).toBeNull();
  });

  it("drops the removed file's year, so the next run picks the remaining file's year", async () => {
    await boot();
    pick([xmlFile("a.xml", FILE_2025), xmlFile("b.xml", FILE_2024)]);
    await toReview();
    await toResults();
    expect((byId("results-year-select") as HTMLSelectElement).value).toBe("2025");

    // Remove the 2025 file, go back to Review and run again.
    byId("file-list").querySelector<HTMLButtonElement>(".remove-file[data-idx='0']")!.click();
    byId("wizard-back").click();
    await toResults();

    // The year feeds the profile, which 720/721/D-6 read.
    expect((JSON.parse(localStorage.getItem("declarenta_profile")!) as { year: number }).year).toBe(2024);
    expect(byId("results-year-header").querySelector(".banner-warning")).toBeNull();
  });
});

describe("the file picker can re-add the same file", () => {
  it("clears #file-input after reading it, so picking the same file fires change again", async () => {
    await boot();
    const input = byId("file-input") as HTMLInputElement;
    // jsdom does not track a selection behind our stubbed `files`, so model the
    // browser's value: it holds the picked path until the page clears it.
    let value = "C:\\fakepath\\a.xml";
    Object.defineProperty(input, "value", {
      get: () => value,
      set: (v: string) => { value = v; },
      configurable: true,
    });
    pick([xmlFile("a.xml", FILE_2025)]);
    expect(byId("file-list").textContent).toContain("a.xml");
    expect(value).toBe("");
  });
});

describe("files that no parser accepts", () => {
  it("an empty file gets its own message, not the broker-detection one", async () => {
    await boot();
    pick([new File([""], "vacio.csv", { type: "text/csv" })]);
    await toReview();
    const review = await waitFor(() => byId("review-content").querySelector(".warning"), "error");

    expect(review.textContent).toContain(t("error.empty_file", { filename: "vacio.csv" }));
    expect(review.textContent).not.toContain(t("error.no_broker_detected", { filename: "vacio.csv" }));
  });

  it("an unknown file says to remove it and does not list every parser", async () => {
    await boot();
    pick([new File(["notas personales\nnada que ver\n"], "notes.csv", { type: "text/csv" })]);
    await toReview();
    const review = await waitFor(() => byId("review-content").querySelector(".warning"), "error");

    expect(review.textContent).toContain(t("error.no_broker_detected", { filename: "notes.csv" }));
    expect(review.textContent).not.toContain("Degiro");
    expect(review.textContent).not.toContain("Kraken");
  });
});

describe("errors raised on the Results step are shown on the Results step", () => {
  it("a failed re-run after a year change shows the error and puts the year select back", async () => {
    let calls = 0;
    vi.doMock("../../src/engine/ecb-orchestrator.js", async (importOriginal) => {
      const real = await importOriginal<typeof import("../../src/engine/ecb-orchestrator.js")>();
      return {
        ...real,
        buildEcbRateMap: (...args: Parameters<typeof real.buildEcbRateMap>) =>
          ++calls === 1 ? real.buildEcbRateMap(...args) : Promise.reject(new Error("BCE no disponible")),
      };
    });
    await boot();
    pick([xmlFile("a.xml", FILE_TWO_YEARS)]);
    await toReview();
    await toResults();

    const select = byId("results-year-select") as HTMLSelectElement;
    expect(select.value).toBe("2025");
    select.value = "2024";
    select.dispatchEvent(new Event("change"));

    const step3 = byId("wizard-step-3");
    const error = await waitFor(() => step3.querySelector<HTMLElement>(".wizard-error"), "error on step 3");
    expect(step3.hidden).toBe(false);
    expect(error.textContent).toContain("BCE no disponible");
    // The results on screen are still the 2025 ones, so the select must say so.
    expect((byId("results-year-select") as HTMLSelectElement).value).toBe("2025");
  });

  it("a failed PDF export shows the error on the Results step", async () => {
    vi.doMock("../../src/generators/pdf-web.js", () => ({
      generatePdfWebReport: () => Promise.reject(new Error("PDF roto")),
    }));
    await boot();
    pick([xmlFile("a.xml", FILE_2025)]);
    await toReview();
    await toResults();

    byId("export-pdf-btn").click();

    const step3 = byId("wizard-step-3");
    const error = await waitFor(() => step3.querySelector<HTMLElement>(".wizard-error"), "error on step 3");
    expect(error.textContent).toContain("PDF roto");
  });
});
