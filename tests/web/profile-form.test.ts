// @vitest-environment jsdom
/**
 * The fiscal profile form and the 720 / D-6 files it feeds.
 *
 * The year dropdown only lists three default years. A year set from the data
 * (or the results year selector) can fall outside them; the form must still
 * show it, or the next keystroke in any field saves the first option instead.
 *
 * The 720 and D-6 files must carry the year their section was rendered with,
 * the one on screen, not whatever the profile says at click time.
 *
 * A NIF with a wrong control letter must be flagged in the form and must not
 * count as a complete profile, so it never reaches a 720 or D-6 file.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Statement } from "../../src/types/broker.js";
import type { OpenPosition } from "../../src/types/ibkr.js";
import type { FiscalProfile } from "../../src/web/profile.js";

const CURRENT_YEAR = new Date().getFullYear();
// Outside the dropdown's default years (current - 1, current, current - 2).
const OLD_YEAR = CURRENT_YEAR - 4;

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

function profile(overrides: Partial<FiscalProfile> = {}): FiscalProfile {
  return {
    nif: "12345678Z",
    apellidos: "Garcia",
    nombre: "Juan",
    ccaa: "Madrid",
    telefono: "",
    year: OLD_YEAR,
    monodivisa: false,
    trackAutoConvert: true,
    titulares: 1,
    ...overrides,
  };
}

function typeInto(id: string, value: string): void {
  const input = document.getElementById(id) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function waitFor<T>(probe: () => T | null | undefined, label: string): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const v = probe();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__COMMIT_HASH__", "test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("profile form year", () => {
  it("shows a saved year outside the default options and keeps it when another field is edited", async () => {
    const { initProfile, saveProfile, getProfile } = await import("../../src/web/profile.js");
    document.body.innerHTML = `<div id="profile-form-container"></div>`;
    saveProfile(profile());

    initProfile();
    expect((document.getElementById("profile-year") as HTMLSelectElement).value).toBe(String(OLD_YEAR));

    typeInto("profile-name", "Juana");
    expect(getProfile().nombre).toBe("Juana");
    expect(getProfile().year).toBe(OLD_YEAR);
  });

  it("the form follows the year taken from an uploaded file", async () => {
    const indexHtml = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");
    document.documentElement.innerHTML = new DOMParser().parseFromString(indexHtml, "text/html").documentElement.innerHTML;
    Element.prototype.scrollIntoView = () => {};
    vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
    await import("../../src/web/main.js");
    const { getProfile } = await import("../../src/web/profile.js");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U0000001" fromDate="${OLD_YEAR}0101" toDate="${OLD_YEAR}1231" period="LastYear">
      <Trades>
        <Trade tradeID="1" accountId="U0000001" symbol="ACME" description="ACME CORP"
          isin="XX0000000001" assetCategory="STK" currency="EUR"
          tradeDate="${OLD_YEAR}0310" settlementDate="" quantity="10" tradePrice="120"
          tradeMoney="1200.00" proceeds="-1200.00" cost="0" fifoPnlRealized="0" fxRateToBase="1"
          buySell="BUY" openCloseIndicator="O" exchange="BME"
          ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />
      </Trades>
      <CashTransactions />
      <CorporateActions />
      <OpenPositions />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;
    const input = document.getElementById("file-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([xml], "statement.xml", { type: "text/xml" })], configurable: true });
    input.dispatchEvent(new Event("change"));
    await waitFor(() => !(document.getElementById("wizard-next") as HTMLButtonElement).disabled || null, "Next enabled");
    document.getElementById("wizard-next")!.click();
    await waitFor(() => document.querySelector("#review-content .review-grid"), "review grid");

    expect(getProfile().year).toBe(OLD_YEAR);
    expect((document.getElementById("profile-year") as HTMLSelectElement).value).toBe(String(OLD_YEAR));
    typeInto("profile-name", "Juana");
    expect(getProfile().year).toBe(OLD_YEAR);
  });
});

describe("profile form NIF", () => {
  it("flags a NIF with the wrong control letter and clears the flag once it is fixed", async () => {
    const { initProfile, saveProfile, isProfileComplete } = await import("../../src/web/profile.js");
    document.body.innerHTML = `<div id="profile-form-container"></div>`;
    saveProfile(profile({ nif: "12345678A" }));

    initProfile();
    const nif = document.getElementById("profile-nif") as HTMLInputElement;
    const error = document.getElementById("profile-nif-error") as HTMLElement;
    expect(error).not.toBeNull();
    expect(error.hidden).toBe(false);
    expect(nif.getAttribute("aria-invalid")).toBe("true");
    expect(isProfileComplete()).toBe(false);

    typeInto("profile-nif", "12345678Z");
    expect(error.hidden).toBe(true);
    expect(nif.hasAttribute("aria-invalid")).toBe(false);
    expect(isProfileComplete()).toBe(true);
  });
});

describe("720 and D-6 files use the year on screen", () => {
  const position: OpenPosition = {
    accountId: "U0000001",
    symbol: "IWDA",
    description: "ISHARES CORE MSCI WORLD",
    isin: "IE00B4L5Y983",
    currency: "EUR",
    assetCategory: "STK",
    quantity: "600",
    costBasisMoney: "40000",
    costBasisPrice: "66.67",
    markPrice: "100",
    positionValue: "60000",
    fifoPnlUnrealized: "20000",
    fxRateToBase: "1",
    custodianCountry: "IE",
  };
  const statement: Statement = {
    accountId: "U0000001",
    fromDate: "",
    toDate: "",
    period: "",
    trades: [],
    cashTransactions: [],
    corporateActions: [],
    openPositions: [position],
    securitiesInfo: [],
  };

  /** Click a generate button and return the name of the file it downloads. */
  async function download(buttonId: string): Promise<string> {
    URL.createObjectURL = () => "blob:test";
    URL.revokeObjectURL = () => {};
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    document.getElementById(buttonId)!.click();
    return waitFor(() => names[0], `download from ${buttonId}`);
  }

  it("Modelo 720", async () => {
    const { saveProfile } = await import("../../src/web/profile.js");
    const { renderSection720 } = await import("../../src/web/section-720.js");
    document.body.innerHTML = `<div id="m720-content"></div>`;
    saveProfile(profile());
    renderSection720(statement, new Map());
    expect(document.querySelector(".section-year")!.textContent).toContain(String(OLD_YEAR));

    // The profile year changes after the section was drawn.
    saveProfile(profile({ year: CURRENT_YEAR - 1 }));
    expect(await download("m720-generate-btn")).toBe(`modelo720_${OLD_YEAR}.txt`);
  });

  it("Modelo D-6", async () => {
    const { saveProfile } = await import("../../src/web/profile.js");
    const { renderSectionD6 } = await import("../../src/web/section-d6.js");
    document.body.innerHTML = `<div id="d6-content"></div>`;
    saveProfile(profile());
    renderSectionD6(statement, new Map());
    expect(document.querySelector(".section-year")!.textContent).toContain(String(OLD_YEAR));

    saveProfile(profile({ year: CURRENT_YEAR - 1 }));
    expect(await download("d6-generate-btn")).toBe(`d6_guia_${OLD_YEAR}.json`);
  });
});
