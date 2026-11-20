// @vitest-environment jsdom
/**
 * The casilla drill-down and the results operations table show a sale as the
 * boxes count it, like the annex (#469, #470). They printed every amount with
 * fmtEur directly, so a cost or proceeds that is no number read «NaN», and a
 * cost the boxes leave out (next to proceeds that are no number) was listed
 * with no mark, so the drill-down of box 0331 did not add up to the box.
 *
 * The data goes through the real path: an IBKR Flex Query with a buy or a sale
 * at a price of 1e2000 (no broker writes it: the report names the row and
 * counts none of its amounts), parsed and run through generateTaxReport, then
 * rendered by the casilla cards and by the real app's operations table. All
 * amounts are in EUR, so no ECB request is needed.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { renderCasillaCards } from "../../src/web/casilla-detail.js";
import { t } from "../../src/i18n/index.js";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");

function trade(id: string, side: "BUY" | "SELL", date: string, qty: string, price: string): string {
  return `<Trade tradeID="${id}" accountId="U0000001" symbol="ACME" description="ACME CORP"
    isin="XX0000000001" assetCategory="STK" currency="EUR" tradeDate="${date}" settlementDate="${date}"
    quantity="${qty}" tradePrice="${price}" tradeMoney="0" proceeds="0" cost="0" fifoPnlRealized="0"
    fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}"
    exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />`;
}

function xml(rows: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF"><FlexStatements count="1">
  <FlexStatement accountId="U0000001" fromDate="20250101" toDate="20251231" period="LastYear">
    <Trades>${rows.join("")}</Trades><CashTransactions /><CorporateActions /><OpenPositions />
  </FlexStatement></FlexStatements></FlexQueryResponse>`;
}

/** The buy has a price no broker writes: the sale adds its 120 € of proceeds and no cost. */
const BAD_BUY = xml([trade("1", "BUY", "20250115", "10", "1e2000"), trade("2", "SELL", "20250601", "-10", "12")]);
/** The sale has a price no broker writes: its 100 € cost is shown but not added. */
const BAD_SALE = xml([trade("1", "BUY", "20250115", "10", "10"), trade("2", "SELL", "20250601", "-10", "1e2000")]);

const NOT_COUNTED = `100,00 (${t("annex.not_counted")})`;

/** The amount cells of the casilla card whose concept is `key`, after opening it. */
function drillDown(file: string, key: Parameters<typeof t>[0]): string[] {
  const container = document.createElement("div");
  renderCasillaCards(container, generateTaxReport(parseIbkrFlexXml(file), new Map(), 2025));
  const card = [...container.querySelectorAll<HTMLElement>(".casilla-card")]
    .find((c) => c.querySelector(".casilla-concept")?.textContent === t(key))!;
  card.querySelector<HTMLButtonElement>(".casilla-trigger")!.click();
  return [...card.querySelectorAll(".detail-table tbody tr")].map((tr) => tr.querySelectorAll("td")[4]!.textContent.replace(/\s+/g, " ").trim());
}

describe("the casilla drill-down shows a sale as the boxes count it", () => {
  it("a cost that is no number reads «—», never «NaN» (box 0331), and the proceeds stay (0328)", () => {
    expect(drillDown(BAD_BUY, "casilla.listed_acquisition_value")).toEqual(["—"]);
    expect(drillDown(BAD_BUY, "casilla.listed_transmission_value")).toEqual(["120,00"]);
  });

  it("a cost next to proceeds that are no number carries «(no se suma)» (0331), and the proceeds read «—» (0328)", () => {
    expect(drillDown(BAD_SALE, "casilla.listed_acquisition_value")).toEqual([NOT_COUNTED]);
    expect(drillDown(BAD_SALE, "casilla.listed_transmission_value")).toEqual(["—"]);
  });
});

describe("the results operations table shows a sale as the boxes count it", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function opsRow(file: string): Promise<{ cells: string[]; glClass: string }> {
    vi.resetModules();
    const store = new Map<string, string>([["locale", "es"]]);
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
    const waitFor = async <T,>(probe: () => T | null | undefined, label: string): Promise<T> => {
      for (let i = 0; i < 300; i++) {
        const v = probe();
        if (v) return v;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`timed out waiting for ${label}`);
    };
    const input = document.getElementById("file-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([file], "statement.xml", { type: "text/xml" })], configurable: true });
    input.dispatchEvent(new Event("change"));
    await waitFor(() => !(document.getElementById("wizard-next") as HTMLButtonElement).disabled || null, "Next enabled");
    document.getElementById("wizard-next")!.click();
    await waitFor(() => document.querySelector("#review-content .review-grid"), "review grid");
    document.getElementById("wizard-next")!.click();
    const table = await waitFor(() => document.querySelector<HTMLElement>("#operations-table table"), "operations table");
    const tds = [...table.querySelectorAll("tbody tr:not(.wash-sale-detail)")[0]!.querySelectorAll("td")];
    // ISIN, symbol, buy date, sale date, units, cost, proceeds, result, days.
    return { cells: tds.slice(5, 8).map((td) => td.textContent.replace(/\s+/g, " ").trim()), glClass: tds[7]!.className };
  }

  it("a cost that is no number reads «—», and the result is the proceeds the boxes add", async () => {
    const { cells, glClass } = await opsRow(BAD_BUY);
    expect(cells).toEqual(["—", "120,00", "120,00"]);
    expect(glClass).toBe("gain");
  });

  it("a cost next to proceeds that are no number carries «(no se suma)», and nothing reads «NaN»", async () => {
    const { cells } = await opsRow(BAD_SALE);
    expect(cells).toEqual([NOT_COUNTED, "—", "—"]);
  });
});
