// @vitest-environment jsdom
/**
 * The FX method flow (#434), driven through the real app (index.html, main.ts,
 * a File handed to #file-input and the wizard buttons):
 *
 * - A USD upload asks for the method on the review step: three radio cards,
 *   the default preselected, and the main button names the method.
 * - The results header shows the method chip, titulares and auto-conversions.
 * - The comparison with the other methods runs the engine only when it is
 *   opened, twice (the method on screen is reused), and once only.
 * - «Cambiar» goes back to the review step with focus on the chosen card; a
 *   new choice is saved to the profile and the next run uses it.
 * - Titulares and auto-conversions, now on the review step, reach the engine.
 * - The year comparison records the method of each saved year.
 * - An all-EUR upload never asks, and computes with the default.
 *
 * Loaded once (the app listens on `document`, which outlives a module reset),
 * so the tests run in order and count the engine runs each one causes. ECB
 * rates come from a stub: a flat 0.9 EUR per USD for every day.
 */

import { describe, it, expect, beforeAll, afterAll, vi, type Mock } from "vitest";
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
      for (let d = new Date(Date.UTC(2024, 11, 1)); d <= new Date(Date.UTC(2025, 11, 31)); d.setUTCDate(d.getUTCDate() + 1)) {
        map.set(d.toISOString().slice(0, 10), new Map([["USD", "0.9"]]));
      }
      return Promise.resolve(map);
    },
  };
});

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");

function flexXml(currency: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U0000001" fromDate="20250101" toDate="20251231" period="LastYear">
      <Trades>
        <Trade tradeID="1" accountId="U0000001" symbol="ACME" description="ACME CORP"
          isin="US0000000001" assetCategory="STK" currency="${currency}"
          tradeDate="20250110" settlementDate="" quantity="10" tradePrice="100"
          tradeMoney="1000.00" proceeds="-1000.00" cost="1000" fifoPnlRealized="0" fxRateToBase="1"
          buySell="BUY" openCloseIndicator="O" exchange="NYSE"
          ibCommissionCurrency="${currency}" ibCommission="0" taxes="0" />
        <Trade tradeID="2" accountId="U0000001" symbol="ACME" description="ACME CORP"
          isin="US0000000001" assetCategory="STK" currency="${currency}"
          tradeDate="20250310" settlementDate="" quantity="-10" tradePrice="120"
          tradeMoney="-1200.00" proceeds="1200.00" cost="-1000" fifoPnlRealized="200" fxRateToBase="1"
          buySell="SELL" openCloseIndicator="C" exchange="NYSE"
          ibCommissionCurrency="${currency}" ibCommission="0" taxes="0" />
      </Trades>
      <CashTransactions />
      <CorporateActions />
      <OpenPositions />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;
}

type Options = { skipFx?: boolean; traditionalFx?: boolean; trackAutoConvert?: boolean; titulares?: number };
let generateTaxReport: Mock;

async function waitFor<T>(probe: () => T | null | undefined, label: string): Promise<T> {
  for (let i = 0; i < 300; i++) {
    const v = probe();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const byId = (id: string): HTMLElement => document.getElementById(id)!;
const inputById = (id: string) => byId(id) as HTMLInputElement;
const calls = () => generateTaxReport.mock.calls.length;
const lastOptions = () => generateTaxReport.mock.calls.at(-1)![3] as Options;
const storedProfile = () => JSON.parse(localStorage.getItem("declarenta_profile")!) as Record<string, unknown>;

/** Upload one file (replacing any earlier one) and open the review step. */
async function toReview(currency: string): Promise<void> {
  // Files are added on step 1, as a user does after «Atrás» or the step indicator.
  document.querySelector<HTMLButtonElement>('.wizard-indicator[data-step="1"]')?.click();
  expect(byId("wizard-step-1").hidden).toBe(false);
  byId("review-content").innerHTML = "";
  byId("file-list").querySelectorAll<HTMLButtonElement>(".remove-file").forEach((b) => { b.click(); });
  const input = inputById("file-input");
  Object.defineProperty(input, "files", { value: [new File([flexXml(currency)], `${currency}.xml`, { type: "text/xml" })], configurable: true });
  input.dispatchEvent(new Event("change"));
  await waitFor(() => !(byId("wizard-next") as HTMLButtonElement).disabled || null, "Next enabled");
  byId("wizard-next").click();
  await waitFor(() => document.querySelector("#review-content .review-grid"), "review step");
}

/** Click the main button on the review step and wait for the run it starts. */
async function calculate(): Promise<void> {
  const before = calls();
  byId("wizard-next").click();
  await waitFor(() => (calls() > before && !byId("wizard-step-3").hidden) || null, "results");
  await new Promise((r) => setTimeout(r, 0));
}

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
}

beforeAll(async () => {
  const storage = memoryStorage();
  storage.setItem("locale", "es");
  // A 2024 report saved with «Tradicional con divisa», for the last-year note.
  storage.setItem("declarenta_reports", JSON.stringify([{
    year: 2024, processedAt: "", brokers: ["Interactive Brokers"], tradesCount: 1, fxMethod: "tradicional-divisa",
    casillas: { transmissionValue: 1, acquisitionValue: 1, netGainLoss: 0, blockedLosses: 0, fxNetGainLoss: 0, grossDividends: 0, interestEarned: 0, interestPaid: 0, doubleTaxation: 0 },
    stats: { disposalsCount: 1, fxDisposalsCount: 0, dividendsCount: 0, warningsCount: 0, currencies: ["USD"] },
  }]));
  vi.stubGlobal("localStorage", storage);
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

describe("the FX method on the review step and the results", () => {
  it("a USD upload asks for the method, with the default preselected", async () => {
    await toReview("USD");
    const radios = [...document.querySelectorAll<HTMLInputElement>('#method-picker input[name="fx-method"]')];
    expect(radios.map((r) => r.value)).toEqual(["multidivisa", "tradicional-divisa", "monodivisa"]);
    expect(radios.find((r) => r.checked)?.value).toBe("multidivisa");
    expect(document.querySelector(".method-card.selected .method-badge")?.textContent).toBe("Recomendado");
    expect(byId("wizard-next").textContent).toBe("Calcular con «Criterio DGT (multidivisa)»");
    // The 2024 report used another method: the note warns before any figure.
    expect(document.querySelector(".method-last-year-switch")?.textContent).toContain("En 2024 calculaste con «Tradicional con divisa»");
    expect(calls()).toBe(0);
  });

  it("selecting a traditional method shows its risk note and renames the button", () => {
    const radio = inputById("fx-method-tradicional-divisa");
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector(".method-risk")?.textContent).toContain("V1615-25");
    expect(document.querySelector(".method-card.selected input")?.getAttribute("value")).toBe("tradicional-divisa");
    expect(byId("wizard-next").textContent).toBe("Calcular con «Tradicional con divisa»");
    expect(storedProfile().fxMethod).toBe("tradicional-divisa");
    // Same method as 2024: an info note, not the warning.
    expect(document.querySelector(".method-last-year-switch")).toBeNull();
    expect(document.querySelector(".method-last-year")?.textContent).toBe("En 2024 calculaste con «Tradicional con divisa».");

    const back = inputById("fx-method-multidivisa");
    back.checked = true;
    back.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector(".method-risk")).toBeNull();
  });

  it("computes once with the chosen method and shows it in the results header", async () => {
    await calculate();
    expect(calls()).toBe(1);
    expect(lastOptions()).toMatchObject({ skipFx: false, traditionalFx: false, trackAutoConvert: true, titulares: 1 });
    expect(byId("results-method-chip").textContent).toContain("Método: Criterio DGT (multidivisa)");
    expect(byId("results-settings").textContent).toContain("1 titular");
    expect(byId("results-settings").textContent).toContain("Autoconversiones: sí");
    expect(document.querySelector(".how-calculated")?.textContent).toContain("Cómo se ha calculado.");
    expect(byId("results-split").textContent).toContain("+180,00 €");
  });

  it("runs the other two methods only when the comparison is opened, and only once", async () => {
    await new Promise((r) => setTimeout(r, 50));
    expect(calls()).toBe(1);
    const details = byId("method-compare") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("table")).toBeNull();

    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await waitFor(() => details.querySelector(".method-compare-table"), "comparison table");
    expect(calls()).toBe(3);
    const runs = generateTaxReport.mock.calls.slice(1).map((c) => c[3] as Options);
    expect(runs.map((o) => [o.skipFx, o.traditionalFx])).toEqual([[false, true], [true, false]]);
    expect(details.querySelectorAll("thead th")).toHaveLength(3);
    expect(details.querySelector("thead th.cur")?.textContent).toContain("En uso");

    details.open = false;
    details.dispatchEvent(new Event("toggle"));
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await new Promise((r) => setTimeout(r, 50));
    expect(calls()).toBe(3);
  });

  it("records the method of the saved year for the year comparison", () => {
    const saved = (JSON.parse(localStorage.getItem("declarenta_reports")!) as { year: number; fxMethod?: string }[]);
    expect(saved.find((r) => r.year === 2025)?.fxMethod).toBe("multidivisa");
    const compare = byId("year-compare");
    expect(compare.querySelector(".method-row")?.textContent).toContain("Criterio DGT (multidivisa)");
    expect(compare.querySelector(".method-row")?.textContent).toContain("Tradicional con divisa");
    expect(compare.querySelector(".method-mismatch")).not.toBeNull();
  });

  it("«Cambiar» goes back to the review step with focus on the chosen card", () => {
    byId("results-method-change").click();
    expect(byId("wizard-step-2").hidden).toBe(false);
    expect(document.activeElement?.id).toBe("fx-method-multidivisa");
  });

  it("a new method and titulares chosen on the review step reach the engine", async () => {
    const mono = inputById("fx-method-monodivisa");
    mono.checked = true;
    mono.dispatchEvent(new Event("change", { bubbles: true }));
    // Auto-conversions do not apply without the FX engine.
    expect(inputById("review-track-autoconvert").disabled).toBe(true);
    expect(storedProfile()).toMatchObject({ fxMethod: "monodivisa", monodivisa: true });

    const titulares = byId("review-titulares") as HTMLSelectElement;
    titulares.value = "2";
    titulares.dispatchEvent(new Event("change", { bubbles: true }));
    expect(storedProfile().titulares).toBe(2);

    await calculate();
    expect(lastOptions()).toMatchObject({ skipFx: true, traditionalFx: false, titulares: 2 });
    expect(byId("results-method-chip").textContent).toContain("Tradicional sin divisa (monodivisa)");
    expect(byId("results-settings").textContent).toContain("2 titulares");
    expect(byId("results-settings").textContent).not.toContain("Autoconversiones");
    expect(byId("results-split").textContent).toContain("no se calcula en este método");
  });

  it("a change on the review step followed by the step indicator recomputes the results", async () => {
    byId("results-method-change").click();
    const trad = inputById("fx-method-tradicional-divisa");
    trad.checked = true;
    trad.dispatchEvent(new Event("change", { bubbles: true }));
    const before = calls();
    document.querySelector<HTMLButtonElement>('.wizard-indicator[data-step="3"]')!.click();
    await waitFor(() => calls() > before || null, "rerun");
    expect(lastOptions()).toMatchObject({ skipFx: false, traditionalFx: true });
    await waitFor(() => byId("results-method-chip").textContent.includes("Tradicional con divisa") || null, "chip");
  });

  it("an all-EUR upload never asks and computes with the default, whatever the saved method", async () => {
    expect(storedProfile().fxMethod).toBe("tradicional-divisa");
    await toReview("EUR");
    expect(document.getElementById("method-picker")).toBeNull();
    expect(document.getElementById("review-track-autoconvert")).toBeNull();
    expect(byId("wizard-next").textContent).toBe("Calcular");
    await calculate();
    expect(lastOptions()).toMatchObject({ skipFx: false, traditionalFx: false });
    expect(document.getElementById("results-method-chip")).toBeNull();
    expect(document.getElementById("method-compare")).toBeNull();
    // The method does not apply, so the saved year has none.
    const saved = (JSON.parse(localStorage.getItem("declarenta_reports")!) as { year: number; fxMethod?: string }[]);
    expect(saved.find((r) => r.year === 2025)?.fxMethod).toBeUndefined();
    // The saved choice is kept for the next foreign-currency upload.
    expect(storedProfile().fxMethod).toBe("tradicional-divisa");
  });
});
