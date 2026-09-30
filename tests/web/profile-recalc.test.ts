// @vitest-environment jsdom
/**
 * Changing monodivisa, titulares or auto-convert in the fiscal profile must
 * recalculate a report that is already on screen, and say so on Results.
 * Editing a field that does not feed the engine (NIF) must not re-run it.
 *
 * Drives the real app: index.html markup, main.ts, a File handed to
 * #file-input, the wizard's Next button, and the rendered profile form.
 * All amounts are in EUR so no ECB request is needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reportSettingsChanged, reportSettingsOf, getProfile } from "../../src/web/profile.js";

vi.mock("../../src/generators/report.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/generators/report.js")>();
  return { ...actual, generateTaxReport: vi.fn(actual.generateTaxReport) };
});

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U0000001" fromDate="20250101" toDate="20251231" period="LastYear">
      <Trades>
        <Trade tradeID="1" accountId="U0000001" symbol="ACME" description="ACME CORP"
          isin="XX0000000001" assetCategory="STK" currency="EUR" tradeDate="20250110" settlementDate=""
          quantity="10" tradePrice="100" tradeMoney="1000.00" proceeds="-1000.00" cost="0"
          fifoPnlRealized="0" fxRateToBase="1" buySell="BUY" openCloseIndicator="O"
          exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />
        <Trade tradeID="2" accountId="U0000001" symbol="ACME" description="ACME CORP"
          isin="XX0000000001" assetCategory="STK" currency="EUR" tradeDate="20250310" settlementDate=""
          quantity="-10" tradePrice="120" tradeMoney="-1200.00" proceeds="1200.00" cost="0"
          fifoPnlRealized="0" fxRateToBase="1" buySell="SELL" openCloseIndicator="C"
          exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />
      </Trades>
      <CashTransactions />
      <CorporateActions />
      <OpenPositions />
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

let spy: Mock;
let i18n: typeof import("../../src/i18n/index.js");

async function showResults(): Promise<void> {
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

/** Change a profile control the way a user does: set it, then fire `input` on it. */
function edit(id: string, apply: (el: HTMLInputElement & HTMLSelectElement) => void): void {
  const el = document.getElementById(id) as HTMLInputElement & HTMLSelectElement;
  apply(el);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const notice = () => document.querySelector("#results-year-header .results-recalc-notice");
const lastOptions = () => spy.mock.calls.at(-1)![3] as Record<string, unknown>;
const lastNetGain = () =>
  (spy.mock.results.at(-1)!.value as { capitalGains: { netGainLoss: { toString(): string } } }).capitalGains.netGainLoss.toString();

// Each test imports a fresh main.ts, which adds its listeners to the shared
// `document`. Remove them after the test, or the previous test's app instance
// (still holding its report) would react to this test's profile edits.
const docListeners: [string, EventListenerOrEventListenerObject][] = [];
const realAddListener = document.addEventListener.bind(document);

beforeEach(async () => {
  document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
    docListeners.push([type, listener]);
    realAddListener(type, listener, opts);
  }) as typeof document.addEventListener;
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__COMMIT_HASH__", "test");
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(INDEX_HTML, "text/html")
    .documentElement.innerHTML;
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
  await import("../../src/web/main.js");
  spy = (await import("../../src/generators/report.js")).generateTaxReport as unknown as Mock;
  spy.mockClear(); // the mocked module survives resetModules, so calls would pile up across tests
  i18n = await import("../../src/i18n/index.js");
});

afterEach(() => {
  for (const [type, listener] of docListeners.splice(0)) document.removeEventListener(type, listener);
  document.addEventListener = realAddListener;
  vi.unstubAllGlobals();
});

describe("reportSettingsChanged", () => {
  const base = { monodivisa: false, trackAutoConvert: true, titulares: 1 };

  it("is false for identical settings", () => {
    expect(reportSettingsChanged(base, { ...base })).toBe(false);
  });

  it("is true when any one of the three settings differs", () => {
    expect(reportSettingsChanged(base, { ...base, monodivisa: true })).toBe(true);
    expect(reportSettingsChanged(base, { ...base, trackAutoConvert: false })).toBe(true);
    expect(reportSettingsChanged(base, { ...base, titulares: 2 })).toBe(true);
  });

  it("reportSettingsOf ignores fields that do not feed the engine", () => {
    const a = reportSettingsOf({ ...getProfile(), nif: "12345678Z", year: 2024 });
    const b = reportSettingsOf({ ...getProfile(), nif: "", year: 2025 });
    expect(reportSettingsChanged(a, b)).toBe(false);
  });
});

describe("profile change with a report on screen", () => {
  it("recalculates on titulares, monodivisa and auto-convert, and shows the notice", async () => {
    await showResults();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(lastNetGain()).toBe("200");
    expect(notice()).toBeNull();

    edit("profile-titulares", (el) => { el.value = "2"; });
    await waitFor(() => spy.mock.calls.length === 2 && notice(), "recalc after titulares");
    expect(lastOptions().titulares).toBe(2);
    expect(lastNetGain()).toBe("100");
    expect(notice()!.textContent).toBe(i18n.t("results.recalculated"));

    edit("profile-monodivisa", (el) => { el.checked = true; });
    await waitFor(() => spy.mock.calls.length === 3 || null, "recalc after monodivisa");
    expect(lastOptions().skipFx).toBe(true);

    edit("profile-track-autoconvert", (el) => { el.checked = false; });
    await waitFor(() => spy.mock.calls.length === 4 || null, "recalc after auto-convert");
    expect(lastOptions().trackAutoConvert).toBe(false);
  });

  it("does not re-run the engine when only the NIF changes", async () => {
    await showResults();
    expect(spy).toHaveBeenCalledTimes(1);

    edit("profile-nif", (el) => { el.value = "12345678Z"; });
    await new Promise((r) => setTimeout(r, 100));
    expect(getProfile().nif).toBe("12345678Z");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(notice()).toBeNull();
  });

  it("does nothing before a report exists", async () => {
    edit("profile-titulares", (el) => { el.value = "2"; });
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });

  it("re-renders the notice in the new language", async () => {
    await showResults();
    edit("profile-titulares", (el) => { el.value = "3"; });
    await waitFor(() => notice(), "notice");

    i18n.setLocale("gl");
    expect(notice()!.textContent).toBe("Resultados recalculados cos cambios do teu perfil fiscal.");
    i18n.setLocale("en");
    expect(notice()!.textContent).toBe("Results recalculated with your tax profile changes.");
  });
});
