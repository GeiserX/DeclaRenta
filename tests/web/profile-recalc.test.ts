// @vitest-environment jsdom
/**
 * Editing a profile setting that changes the figures (monodivisa, titulares,
 * auto-conversions) while results are on screen recalculates them, and the
 * Results header shows the settings the figures were computed with. Editing
 * a field that does not change the figures (the NIF) runs nothing.
 *
 * Driven through the real app, loaded once: the app listens on `document`,
 * which outlives a module reset, so a fresh import per test would leave the
 * earlier instances reacting too. Each test counts the engine runs it causes.
 * The statement is a EUR buy and sell, so no ECB request is needed and fetch
 * is stubbed to fail.
 */

import { describe, it, expect, beforeAll, afterAll, vi, type Mock } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../../src/generators/report.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/generators/report.js")>();
  return { ...mod, generateTaxReport: vi.fn(mod.generateTaxReport) };
});

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");
const YEAR = new Date().getFullYear() - 1;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U0000001" fromDate="${YEAR}0101" toDate="${YEAR}1231" period="LastYear">
      <Trades>
        <Trade tradeID="1" accountId="U0000001" symbol="ACME" description="ACME CORP"
          isin="XX0000000001" assetCategory="STK" currency="EUR"
          tradeDate="${YEAR}0110" settlementDate="" quantity="10" tradePrice="100"
          tradeMoney="1000.00" proceeds="-1000.00" cost="1000" fifoPnlRealized="0" fxRateToBase="1"
          buySell="BUY" openCloseIndicator="O" exchange="BME"
          ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />
        <Trade tradeID="2" accountId="U0000001" symbol="ACME" description="ACME CORP"
          isin="XX0000000001" assetCategory="STK" currency="EUR"
          tradeDate="${YEAR}0310" settlementDate="" quantity="-10" tradePrice="120"
          tradeMoney="-1200.00" proceeds="1200.00" cost="-1000" fifoPnlRealized="200" fxRateToBase="1"
          buySell="SELL" openCloseIndicator="C" exchange="BME"
          ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />
      </Trades>
      <CashTransactions />
      <CorporateActions />
      <OpenPositions />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

type ReportOptions = { skipFx?: boolean; trackAutoConvert?: boolean; titulares?: number };
let generateTaxReport: Mock;

async function waitFor<T>(probe: () => T | null | undefined, label: string): Promise<T> {
  for (let i = 0; i < 200; i++) {
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

/** Change a profile field the way a user does: the form saves on `input`. */
function edit(id: string, apply: (el: HTMLInputElement & HTMLSelectElement) => void): void {
  const el = document.getElementById(id) as HTMLInputElement & HTMLSelectElement;
  expect(el).not.toBeNull();
  apply(el);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function lastOptions(): ReportOptions {
  return generateTaxReport.mock.calls.at(-1)![3] as ReportOptions;
}

function settingsText(): string {
  return document.getElementById("results-settings")?.textContent ?? "";
}

/** Wait until the engine has run once more than `before` times. */
async function waitForRecalc(before: number): Promise<void> {
  await waitFor(() => generateTaxReport.mock.calls.length > before || null, "another engine run");
  // The header is rendered right after the engine returns.
  await new Promise((r) => setTimeout(r, 0));
}

beforeAll(async () => {
  const storage = memoryStorage();
  storage.setItem("locale", "es");
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__COMMIT_HASH__", "test");
  document.documentElement.innerHTML = new DOMParser().parseFromString(
    INDEX_HTML,
    "text/html",
  ).documentElement.innerHTML;
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
  await import("../../src/web/main.js");
  generateTaxReport = (await import("../../src/generators/report.js")).generateTaxReport as unknown as Mock;
  await openResults();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("results follow the profile settings", () => {
  it("shows the settings used in the Results header", () => {
    expect(generateTaxReport).toHaveBeenCalledTimes(1);
    expect(settingsText()).toBe("Ajustes del cálculo: monodivisa no, titulares 1, autoconversiones sí");
  });

  it("does not recalculate when only the NIF is edited", async () => {
    const before = generateTaxReport.mock.calls.length;
    edit("profile-nif", (el) => { el.value = "12345678Z"; });
    await new Promise((r) => setTimeout(r, 100));
    expect(generateTaxReport).toHaveBeenCalledTimes(before);
  });

  it("recalculates when monodivisa is ticked", async () => {
    const before = generateTaxReport.mock.calls.length;
    edit("profile-monodivisa", (el) => { el.checked = true; });
    // The old figures are covered while the new run is in progress.
    expect(document.querySelector("#wizard-step-3 .processing-overlay")).not.toBeNull();
    await waitForRecalc(before);
    await waitFor(() => document.querySelector("#wizard-step-3 .processing-overlay") === null || null, "overlay removed");
    expect(lastOptions().skipFx).toBe(true);
    expect(settingsText()).toContain("monodivisa sí");
  });

  it("recalculates when the number of titulares changes", async () => {
    const before = generateTaxReport.mock.calls.length;
    edit("profile-titulares", (el) => { el.value = "2"; });
    await waitForRecalc(before);
    expect(lastOptions().titulares).toBe(2);
    expect(settingsText()).toContain("titulares 2");
  });

  it("recalculates when auto-conversions are switched off", async () => {
    const before = generateTaxReport.mock.calls.length;
    edit("profile-track-autoconvert", (el) => { el.checked = false; });
    await waitForRecalc(before);
    expect(lastOptions().trackAutoConvert).toBe(false);
    expect(settingsText()).toContain("autoconversiones no");
  });

  it("runs the engine once per settings change", async () => {
    const before = generateTaxReport.mock.calls.length;
    edit("profile-monodivisa", (el) => { el.checked = false; });
    await waitForRecalc(before);
    await new Promise((r) => setTimeout(r, 100));
    expect(generateTaxReport).toHaveBeenCalledTimes(before + 1);
    expect(settingsText()).toBe("Ajustes del cálculo: monodivisa no, titulares 2, autoconversiones no");
  });
});
