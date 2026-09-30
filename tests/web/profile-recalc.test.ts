// @vitest-environment jsdom
/**
 * Changing a profile setting that affects the report (monodivisa, auto-convert,
 * titulares) while results are on screen shows a "profile changed" banner on
 * Results. Nothing is recalculated until its button is clicked. Personal fields
 * such as the NIF are not report settings and never show the banner.
 *
 * Driven through the real app. generateTaxReport is wrapped so the test can
 * count engine runs and read the options each run used. The statement is
 * EUR-only, so no ECB request is made and fetch is stubbed to fail.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reportSettingsChanged, type ReportSettings } from "../../src/web/profile.js";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");
const YEAR = new Date().getFullYear() - 1;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U0000001" fromDate="${YEAR}0101" toDate="${YEAR}1231" period="LastYear">
      <Trades>
        <Trade tradeID="1" accountId="U0000001" symbol="ACME" description="ACME CORP"
          isin="XX0000000001" assetCategory="STK" currency="EUR"
          tradeDate="${YEAR}0210" settlementDate="" quantity="10" tradePrice="100"
          tradeMoney="1000.00" proceeds="-1000.00" cost="0" fifoPnlRealized="0" fxRateToBase="1"
          buySell="BUY" openCloseIndicator="O" exchange="BME"
          ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />
        <Trade tradeID="2" accountId="U0000001" symbol="ACME" description="ACME CORP"
          isin="XX0000000001" assetCategory="STK" currency="EUR"
          tradeDate="${YEAR}0610" settlementDate="" quantity="-10" tradePrice="120"
          tradeMoney="-1200.00" proceeds="1200.00" cost="0" fifoPnlRealized="0" fxRateToBase="1"
          buySell="SELL" openCloseIndicator="C" exchange="BME"
          ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />
      </Trades>
      <CashTransactions />
      <CorporateActions />
      <OpenPositions />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

interface RunOptions {
  skipFx?: boolean;
  trackAutoConvert?: boolean;
  titulares?: number;
}
let runs: RunOptions[] = [];

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

/** Change a profile form control the way a user does: set it, then fire `input`. */
function editProfile(id: string, value: string | boolean): void {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
  expect(el).not.toBeNull();
  if (typeof value === "boolean") (el as HTMLInputElement).checked = value;
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function banner(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#results-year-header .profile-recalc-banner");
}

beforeEach(async () => {
  vi.resetModules();
  runs = [];
  vi.doMock("../../src/generators/report.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/generators/report.js")>();
    return {
      ...actual,
      generateTaxReport: (...args: Parameters<typeof actual.generateTaxReport>) => {
        runs.push({ ...(args[3] as RunOptions) });
        return actual.generateTaxReport(...args);
      },
    };
  });
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
  vi.doUnmock("../../src/generators/report.js");
  vi.unstubAllGlobals();
});

describe("profile change with results on screen", () => {
  it("starts with no banner after the first run", () => {
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ skipFx: false, trackAutoConvert: true, titulares: 1 });
    expect(banner()).toBeNull();
  });

  it("editing the NIF alone shows no banner and runs nothing", async () => {
    editProfile("profile-nif", "12345678Z");
    await new Promise((r) => setTimeout(r, 20));
    expect(banner()).toBeNull();
    expect(runs).toHaveLength(1);
  });

  it.each([
    ["monodivisa", "profile-monodivisa", true, { skipFx: true }],
    ["auto-convert", "profile-track-autoconvert", false, { trackAutoConvert: false }],
    ["titulares", "profile-titulares", "2", { titulares: 2 }],
  ] as const)("%s: shows the banner, runs nothing until clicked, then recalculates", async (_n, id, value, expected) => {
    editProfile(id, value);
    await new Promise((r) => setTimeout(r, 20));
    const shown = banner();
    expect(shown).not.toBeNull();
    expect(shown!.textContent).toContain("Profile changed");
    expect(runs).toHaveLength(1);

    shown!.querySelector<HTMLButtonElement>(".profile-recalc-btn")!.click();
    await waitFor(() => runs.length === 2 || null, "second engine run");
    expect(runs[1]).toMatchObject(expected);
    await waitFor(() => banner() === null || null, "banner gone after recalculation");
  });

  it("changing a setting back to the value the report used hides the banner", () => {
    editProfile("profile-monodivisa", true);
    expect(banner()).not.toBeNull();
    editProfile("profile-monodivisa", false);
    expect(banner()).toBeNull();
    expect(runs).toHaveLength(1);
  });

  it("the banner survives a language switch, translated", async () => {
    editProfile("profile-titulares", "2");
    const { setLocale } = await import("../../src/i18n/index.js");
    setLocale("es");
    const shown = banner();
    expect(shown).not.toBeNull();
    expect(shown!.textContent).toContain("Perfil cambiado");
    expect(shown!.querySelector(".profile-recalc-btn")!.textContent).toBe("Recalcular");
    expect(runs).toHaveLength(1);
  });
});

describe("reportSettingsChanged", () => {
  const base: ReportSettings = { monodivisa: false, trackAutoConvert: true, titulares: 1 };

  it("is false for identical settings", () => {
    expect(reportSettingsChanged(base, { ...base })).toBe(false);
  });

  it("is true when any one setting differs", () => {
    expect(reportSettingsChanged(base, { ...base, monodivisa: true })).toBe(true);
    expect(reportSettingsChanged(base, { ...base, trackAutoConvert: false })).toBe(true);
    expect(reportSettingsChanged(base, { ...base, titulares: 3 })).toBe(true);
  });
});
