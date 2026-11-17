// @vitest-environment jsdom
/**
 * The previous-year method note on the review step follows the results year.
 * The review is drawn for 2025 (the note names 2024). The user then switches the
 * results to 2024 and presses «Cambiar»: the note must name 2023, the saved year
 * before 2024, and not the 2024 note drawn for 2025.
 *
 * Driven through the real app (index.html, main.ts, the wizard buttons). ECB
 * rates come from a stub: a flat 0.9 EUR per USD for every day.
 */

import { it, expect, beforeAll, afterAll, vi, type Mock } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../../src/generators/report.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/generators/report.js")>();
  return { ...mod, generateTaxReport: vi.fn(mod.generateTaxReport) };
});

vi.mock("../../src/engine/ecb-orchestrator.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/engine/ecb-orchestrator.js")>();
  return {
    ...mod,
    buildEcbRateMap: () => {
      const map = new Map<string, Map<string, string>>();
      for (let d = new Date(Date.UTC(2023, 11, 1)); d <= new Date(Date.UTC(2025, 11, 31)); d.setUTCDate(d.getUTCDate() + 1)) {
        map.set(d.toISOString().slice(0, 10), new Map([["USD", "0.9"]]));
      }
      return Promise.resolve(map);
    },
  };
});

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");

function trade(id: number, date: string, qty: number): string {
  const side = qty > 0 ? "BUY" : "SELL";
  const price = qty > 0 ? 100 : 120;
  return `<Trade tradeID="${id}" accountId="U0000001" symbol="ACME" description="ACME CORP"
    isin="US0000000001" assetCategory="STK" currency="USD" tradeDate="${date}" settlementDate=""
    quantity="${qty}" tradePrice="${price}" tradeMoney="${(qty * price).toFixed(2)}" proceeds="${(-qty * price).toFixed(2)}"
    cost="1000" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${qty > 0 ? "O" : "C"}"
    exchange="NYSE" ibCommissionCurrency="USD" ibCommission="0" taxes="0" />`;
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF"><FlexStatements count="1">
  <FlexStatement accountId="U0000001" fromDate="20240101" toDate="20251231" period="Custom">
    <Trades>${trade(1, "20240110", 10)}${trade(2, "20240310", -10)}${trade(3, "20250110", 10)}${trade(4, "20250310", -10)}</Trades>
    <CashTransactions /><CorporateActions /><OpenPositions />
  </FlexStatement>
</FlexStatements></FlexQueryResponse>`;

const saved = (year: number, fxMethod: string) => ({
  year, processedAt: "", brokers: ["Interactive Brokers"], tradesCount: 2, fxMethod,
  casillas: { transmissionValue: 1, acquisitionValue: 1, netGainLoss: 0, blockedLosses: 0, fxNetGainLoss: 0, grossDividends: 0, interestEarned: 0, interestPaid: 0, doubleTaxation: 0 },
  stats: { disposalsCount: 1, fxDisposalsCount: 0, dividendsCount: 0, warningsCount: 0, currencies: ["USD"] },
});

async function waitFor<T>(probe: () => T | null | undefined, label: string): Promise<T> {
  for (let i = 0; i < 300; i++) {
    const v = probe();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const byId = (id: string): HTMLElement => document.getElementById(id)!;
const note = () => document.querySelector("#method-picker .method-last-year")?.textContent ?? "";
let generateTaxReport: Mock;

beforeAll(async () => {
  const store = new Map<string, string>([
    ["locale", "es"],
    ["declarenta_reports", JSON.stringify([saved(2023, "tradicional-divisa"), saved(2024, "monodivisa")])],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  });
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__COMMIT_HASH__", "test");
  document.documentElement.innerHTML = new DOMParser().parseFromString(INDEX_HTML, "text/html").documentElement.innerHTML;
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
  await import("../../src/web/main.js");
  generateTaxReport = (await import("../../src/generators/report.js")).generateTaxReport as unknown as Mock;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

it("names the saved year before the results year, after the year changes", async () => {
  const input = byId("file-input") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [new File([XML], "two-years.xml", { type: "text/xml" })], configurable: true });
  input.dispatchEvent(new Event("change"));
  await waitFor(() => !(byId("wizard-next") as HTMLButtonElement).disabled || null, "Next enabled");
  byId("wizard-next").click();
  await waitFor(() => document.querySelector("#method-picker"), "review step");
  expect(note()).toContain("En 2024 calculaste con «Tradicional sin divisa (monodivisa)»");

  byId("wizard-next").click();
  await waitFor(() => (generateTaxReport.mock.calls.length > 0 && !byId("wizard-step-3").hidden) || null, "results 2025");

  const select = await waitFor(() => document.getElementById("results-year-select") as HTMLSelectElement | null, "year select");
  select.value = "2024";
  select.dispatchEvent(new Event("change"));
  await waitFor(() => generateTaxReport.mock.calls.some((c) => c[2] === 2024) || null, "results 2024");
  await waitFor(() => document.getElementById("results-method-change"), "«Cambiar»");

  byId("results-method-change").click();
  expect(byId("wizard-step-2").hidden).toBe(false);
  expect(note()).toContain("En 2023 calculaste con «Tradicional con divisa»");
  expect(note()).not.toContain("2024");
  // «Cambiar» still puts the focus on the chosen card of the redrawn picker.
  expect(document.activeElement?.id).toBe("fx-method-multidivisa");
});
