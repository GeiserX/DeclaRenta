// @vitest-environment jsdom
/**
 * Since #434 the profile page holds personal data only: the year comes from the
 * data and the results year select. An upload with holdings and no trades or
 * cash movements (an IBKR statement ending on 31 December with only open
 * positions) must still give that year: the Modelo 720, 721 and D-6 sections
 * read it from `getProfile().year`. Before the fix the year select offered only
 * the last closed year and the 720 for the holdings' year could not be made.
 * All amounts are in EUR so no ECB request is needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");
const LAST_CLOSED = new Date().getFullYear() - 1;
const HELD = LAST_CLOSED - 1; // the year of the holdings file, older than the default year

function flexXml(account: string, from: string, to: string, trades: string, positions: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="${account}" fromDate="${from}" toDate="${to}" period="LastYear">
      <Trades>${trades}</Trades>
      <CashTransactions />
      <CorporateActions />
      <OpenPositions>${positions}</OpenPositions>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;
}

const POSITION = `<OpenPosition accountId="U0000001" symbol="GLOBEX" description="GLOBEX FUND"
    isin="IE00B4L5Y983" currency="EUR" assetCategory="STK"
    quantity="1000" costBasisMoney="60000" costBasisPrice="60"
    markPrice="60" positionValue="60000" fifoPnlUnrealized="0" fxRateToBase="1" />`;

const BUY = `<Trade tradeID="1" accountId="U0000002" symbol="ACME" description="ACME CORP"
    isin="XX0000000001" assetCategory="STK" currency="EUR"
    tradeDate="${LAST_CLOSED}0310" settlementDate=""
    quantity="10" tradePrice="100" tradeMoney="1000.00"
    proceeds="-1000.00" cost="0" fifoPnlRealized="0" fxRateToBase="1"
    buySell="BUY" openCloseIndicator="O"
    exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />`;

/** Holdings only: open positions at 31 December of HELD, no trades, no cash rows. */
const HOLDINGS_ONLY = flexXml("U0000001", `${HELD}0101`, `${HELD}1231`, "", POSITION);
/** Another account with a trade in the last closed year and no holdings. */
const TRADES_LAST_CLOSED = flexXml("U0000002", `${LAST_CLOSED}0101`, `${LAST_CLOSED}1231`, BUY, "");

async function waitFor<T>(probe: () => T | null | undefined, label: string): Promise<T> {
  for (let i = 0; i < 300; i++) {
    const v = probe();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const byId = (id: string) => document.getElementById(id)!;
const nextBtn = () => byId("wizard-next") as HTMLButtonElement;
const xmlFile = (name: string, xml: string) => new File([xml], name, { type: "text/xml" });

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

let downloads: string[];

beforeEach(() => {
  vi.resetModules();
  const storage = memoryStorage();
  storage.setItem("locale", "es");
  // A complete profile from an earlier session, with a year that must not decide.
  storage.setItem(
    "declarenta_profile",
    JSON.stringify({ nif: "12345678Z", apellidos: "GARCIA LOPEZ", nombre: "ANA", telefono: "600000000", ccaa: "Madrid", year: HELD - 2 }),
  );
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__COMMIT_HASH__", "test");
  document.documentElement.innerHTML = new DOMParser().parseFromString(INDEX_HTML, "text/html").documentElement.innerHTML;
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
  downloads = [];
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function upload(files: File[]): Promise<HTMLSelectElement> {
  await import("../../src/web/main.js");
  const input = byId("file-input") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new Event("change"));
  await waitFor(() => !nextBtn().disabled || null, "Next enabled");
  nextBtn().click();
  await waitFor(() => byId("review-content").querySelector(".review-grid"), "review grid");
  nextBtn().click();
  return waitFor(
    () => (!byId("wizard-step-3").hidden ? document.querySelector<HTMLSelectElement>("#results-year-select") : null),
    "results year select",
  );
}

const options = (s: HTMLSelectElement) => [...s.options].map((o) => o.value);
const storedYear = (): number => (JSON.parse(localStorage.getItem("declarenta_profile")!) as { year: number }).year;

async function generate720(year: number): Promise<void> {
  const btn = await waitFor(
    () => (byId("m720-content").textContent.includes(String(year)) ? document.querySelector<HTMLButtonElement>("#m720-generate-btn") : null),
    `720 for ${year}`,
  );
  expect(btn.disabled).toBe(false);
  btn.click();
  expect(downloads).toContain(`modelo720_${year}.txt`);
}

describe("a holdings-only upload gives its year", () => {
  it("opens on the holdings' year and makes its 720", async () => {
    const select = await upload([xmlFile("h.xml", HOLDINGS_ONLY)]);
    expect(options(select)).toEqual([String(HELD)]);
    expect(select.value).toBe(String(HELD));
    expect(storedYear()).toBe(HELD);
    await generate720(HELD);
  });

  it("with another year's trades, the select offers the holdings' year and the 720 follows it", async () => {
    const select = await upload([xmlFile("t.xml", TRADES_LAST_CLOSED), xmlFile("h.xml", HOLDINGS_ONLY)]);
    expect(options(select)).toEqual([String(HELD), String(LAST_CLOSED)]);
    expect(select.value).toBe(String(LAST_CLOSED));

    select.value = String(HELD);
    select.dispatchEvent(new Event("change"));
    await waitFor(() => (document.querySelector<HTMLSelectElement>("#results-year-select")?.value === String(HELD) ? true : null), "re-run");
    expect(storedYear()).toBe(HELD);
    await generate720(HELD);
  });
});
