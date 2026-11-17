// @vitest-environment jsdom
/**
 * The FX method applies to stablecoin quotes too (#434, review r5939472090).
 *
 * The engine values a USDT quote at the USD rate, so the method changes the
 * result of a crypto trade quoted in USDT: a BTC bought for 1000 USDT at 0.8
 * and sold for 1100 USDT at 0.9 gains 90 € with the default and 190 € with a
 * traditional method. A crypto-only USDT upload must therefore show the method
 * picker and run with the saved method, as main did with the saved
 * monodivisa. A trap: counting only fiat currencies forced the default there.
 *
 * Driven through the real app (index.html, main.ts, a File handed to
 * #file-input). ECB rates come from a stub: 0.8 EUR per USD in January,
 * 0.9 after.
 */

import { describe, it, expect, beforeAll, afterAll, vi, type Mock } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TaxSummary } from "../../src/types/tax.js";

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
        const day = d.toISOString().slice(0, 10);
        map.set(day, new Map([["USD", day < "2025-02-01" ? "0.8" : "0.9"]]));
      }
      return Promise.resolve(map);
    },
  };
});

const INDEX_HTML = readFileSync(resolve(import.meta.dirname, "../../src/web/index.html"), "utf-8");

const BINANCE_USDT = `Date(UTC),Pair,Side,Price,Executed,Amount,Fee
2025-01-10 10:00:00,BTCUSDT,BUY,50000.00,0.02,1000.00,0USDT
2025-03-10 10:00:00,BTCUSDT,SELL,55000.00,0.02,1100.00,0USDT
`;

type Options = { skipFx?: boolean; traditionalFx?: boolean };
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
  storage.setItem("declarenta_profile", JSON.stringify({ fxMethod: "monodivisa", monodivisa: true }));
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

describe("a crypto-only upload quoted in USDT with monodivisa saved", () => {
  it("asks for the method, with the saved monodivisa selected", async () => {
    const input = byId("file-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([BINANCE_USDT], "binance.csv", { type: "text/csv" })], configurable: true });
    input.dispatchEvent(new Event("change"));
    await waitFor(() => !(byId("wizard-next") as HTMLButtonElement).disabled || null, "Next enabled");
    byId("wizard-next").click();
    await waitFor(() => document.querySelector("#review-content .review-grid"), "review step");
    expect(document.getElementById("method-picker")).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('#method-picker input[name="fx-method"]:checked')?.value).toBe("monodivisa");
    expect(byId("wizard-next").textContent).toBe("Calcular con «Tradicional sin divisa (monodivisa)»");
  });

  it("computes with the saved monodivisa: the BTC gain is 190 €, not the default's 90 €", async () => {
    const before = generateTaxReport.mock.calls.length;
    byId("wizard-next").click();
    await waitFor(() => (generateTaxReport.mock.calls.length > before && !byId("wizard-step-3").hidden) || null, "results");
    const call = generateTaxReport.mock.calls.at(-1)!;
    expect(call[3] as Options).toMatchObject({ skipFx: true, traditionalFx: false });
    const report = generateTaxReport.mock.results.at(-1)!.value as TaxSummary;
    const btc = report.capitalGains.disposals.find((d) => d.symbol === "BTC")!;
    expect(btc.gainLossEur.toFixed(2)).toBe("190.00");
    expect(byId("results-method-chip").textContent).toContain("Tradicional sin divisa (monodivisa)");
  });
});
