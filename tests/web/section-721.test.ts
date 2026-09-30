// @vitest-environment jsdom
/**
 * 720, 721 and D-6 after processing an export that carries no year-end
 * holdings (every broker except IBKR and Revolut). The sections must not tell
 * the user to upload a report they just uploaded: they name the broker, and
 * 720/721 offer a table to type the holdings from the year-end statement,
 * which counts toward the 50.000 € threshold.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { binanceParser } from "../../src/parsers/binance.js";
import { degiroParser } from "../../src/parsers/degiro.js";
import { ibkrParser } from "../../src/parsers/ibkr.js";
import { renderSection721, rerenderSection721 } from "../../src/web/section-721.js";
import { renderSection720 } from "../../src/web/section-720.js";
import { renderSectionD6 } from "../../src/web/section-d6.js";
import { getProfile } from "../../src/web/profile.js";
import { manualHoldingsStorageKey } from "../../src/web/manual-holdings.js";
import { t } from "../../src/i18n/index.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Statement } from "../../src/types/broker.js";

const fixture = (name: string): string => readFileSync(resolve(__dirname, "../fixtures", name), "utf-8");
const binance: Statement = binanceParser.parse(fixture("binance-tx-sample.csv"));
const degiro: Statement = degiroParser.parse(fixture("degiro-transactions-sample.csv"));
const ibkr: Statement = ibkrParser.parse(fixture("ibkr-sample.xml"));
const rates: EcbRateMap = new Map();

function addRow(root: HTMLElement, model: "720" | "721", asset: string, quantity: string, value: string): void {
  const panel = root.querySelector<HTMLElement>(`#manual-holdings-${model}`)!;
  panel.querySelector<HTMLInputElement>('input[name="asset"]')!.value = asset;
  panel.querySelector<HTMLInputElement>('input[name="quantity"]')!.value = quantity;
  panel.querySelector<HTMLInputElement>('input[name="valueEur"]')!.value = value;
  panel.querySelector<HTMLButtonElement>(".manual-holdings-add")!.click();
}

/** In-memory Storage: Node's own localStorage global can shadow jsdom's. */
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

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  document.body.innerHTML = `<div id="m720-content"></div><div id="m721-content"></div><div id="d6-content"></div>`;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Modelo 721 with an export that has no year-end holdings", () => {
  const root = () => document.getElementById("m721-content")!;

  it("the Binance fixture really has no open positions", () => {
    expect(binance.openPositions).toEqual([]);
  });

  it("names the broker instead of asking for an upload, and offers the manual table", () => {
    renderSection721(binance, rates, ["Binance"]);
    const text = root().textContent;
    expect(text).not.toContain(t("m721.no_positions"));
    expect(root().querySelector(".export-no-holdings")?.textContent).toContain("Binance");
    expect(root().querySelector("#manual-holdings-721")).not.toBeNull();
  });

  it("keeps the upload message when no broker was processed", () => {
    renderSection721(binance, rates, []);
    expect(root().textContent).toContain(t("m721.no_positions"));
    expect(root().querySelector("#manual-holdings-721")).toBeNull();
  });

  it("does not blame an export that has positions but no crypto", () => {
    const stocksOnly: Statement = { ...binance, openPositions: ibkr.openPositions };
    expect(stocksOnly.openPositions.length).toBeGreaterThan(0);
    expect(stocksOnly.openPositions.some((p) => p.assetCategory === "CRYPTO")).toBe(false);
    renderSection721(stocksOnly, rates, ["IBKR"]);
    expect(root().querySelector(".export-no-holdings")).toBeNull();
    expect(root().textContent).toContain(t("m721.no_positions"));
    // A second exchange's crypto can still be typed in.
    expect(root().querySelector("#manual-holdings-721")).not.toBeNull();
  });

  it("persists a typed row and counts it toward the threshold", () => {
    renderSection721(binance, rates, ["Binance"]);
    addRow(root(), "721", "BTC", "0,6", "60.000,00");

    const stored: unknown = JSON.parse(localStorage.getItem(manualHoldingsStorageKey("721", getProfile().year))!);
    expect(stored).toEqual([{ asset: "BTC", quantity: "0.6", valueEur: "60000" }]);

    const text = root().textContent;
    expect(text).toContain(t("m721.threshold_exceeded", { amount: "60.000,00" }));
    expect(root().querySelector(".threshold-fill.over")).not.toBeNull();
    expect(root().querySelector(".export-no-holdings")).not.toBeNull();
    expect(root().querySelector("#manual-holdings-721 tbody td.mono")?.textContent).toBe("BTC");

    // A locale re-render keeps the broker name and the typed row.
    rerenderSection721();
    expect(root().querySelector(".export-no-holdings")?.textContent).toContain("Binance");
    expect(root().textContent).toContain(t("m721.threshold_exceeded", { amount: "60.000,00" }));
  });

  it("stays under the threshold for a small holding", () => {
    renderSection721(binance, rates, ["Binance"]);
    addRow(root(), "721", "ETH", "1", "3000");
    expect(root().textContent).toContain(t("m721.threshold_not_exceeded", { amount: "3.000,00" }));
  });

  it("flags an invalid row without saving it", () => {
    renderSection721(binance, rates, ["Binance"]);
    addRow(root(), "721", "BTC", "0", "100");
    expect(root().querySelector<HTMLElement>(".manual-holdings-error")!.hidden).toBe(false);
    expect(localStorage.getItem(manualHoldingsStorageKey("721", getProfile().year))).toBeNull();
  });

  it("removing the last row returns to the named-broker message", () => {
    renderSection721(binance, rates, ["Binance"]);
    addRow(root(), "721", "BTC", "1", "90000");
    root().querySelector<HTMLButtonElement>(".manual-holdings-remove")!.click();
    expect(root().querySelector(".threshold-bar")).toBeNull();
    expect(root().querySelector(".export-no-holdings")).not.toBeNull();
    expect(localStorage.getItem(manualHoldingsStorageKey("721", getProfile().year))).toBeNull();
  });
});

describe("Modelo 720 with an export that has no year-end holdings", () => {
  const root = () => document.getElementById("m720-content")!;

  it("names the broker and counts typed securities toward category V, without offering a file", () => {
    expect(degiro.openPositions).toEqual([]);
    renderSection720(degiro, rates, undefined, ["Degiro"]);
    expect(root().textContent).not.toContain(t("m720.no_positions"));
    expect(root().querySelector(".export-no-holdings")?.textContent).toContain("Degiro");

    addRow(root(), "720", "IE00B4L5Y983", "500", "30000");
    expect(root().textContent).toContain(t("m720.total_value", { amount: "30.000,00" }));
    expect(root().textContent).toContain(t("m720.category_not_exceeded"));

    addRow(root(), "720", "US0378331005", "100", "25000");
    expect(root().textContent).toContain(t("m720.category_exceeded"));
    expect(root().textContent).toContain(t("manual_holdings.not_in_file_720"));
    // The file is built from the export only, so no button for typed rows.
    expect(root().querySelector("#m720-generate-btn")).toBeNull();
  });
});

describe("D-6 with an export that has no year-end holdings", () => {
  it("names the broker instead of asking for an upload", () => {
    renderSectionD6(degiro, rates, ["Degiro"]);
    const root = document.getElementById("d6-content")!;
    expect(root.textContent).not.toContain(t("d6.no_positions"));
    expect(root.querySelector(".export-no-holdings")?.textContent).toContain("Degiro");
  });
});
