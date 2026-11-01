// @vitest-environment jsdom
/**
 * The real app names an uploaded Revolut XLSX export "Revolut", in the
 * detection preview and on every row it merges, so the operations annex shows
 * it as the broker of its sale next to an IBKR sale. Both files are in EUR, so
 * no ECB request is needed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");
const YEAR = new Date().getFullYear() - 1; // the profile's default declaration year

const IBKR = `<?xml version="1.0" encoding="UTF-8"?>
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

/** Revolut realized-gains export (binary XLSX), one EUR sale. */
function revolutXlsx(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Date acquired", "Date sold", "Symbol", "Quantity", "Cost basis", "Gross proceeds", "Gross PnL", "Fees", "Net PnL", "Currency"],
    [`${YEAR - 1}-03-15`, `${YEAR}-03-17`, "TSTR", 5, 50, 60, 10, 0, 10, "EUR"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function waitFor<T>(probe: () => T | null | undefined, label: string): Promise<T> {
  for (let i = 0; i < 300; i++) {
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

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__COMMIT_HASH__", "test");
  document.documentElement.innerHTML = new DOMParser().parseFromString(INDEX_HTML, "text/html").documentElement.innerHTML;
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
  await import("../../src/web/main.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a Revolut XLSX upload in the web app", () => {
  it("is detected and merged as Revolut, the name the annex shows for its sale", async () => {
    const files = [
      new File([IBKR], "ibkr.xml", { type: "text/xml" }),
      new File([revolutXlsx()], "revolut.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    ];
    const input = document.getElementById("file-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new Event("change"));

    const status = await waitFor(
      () => (document.querySelectorAll("#detection-status .detection-ok").length === 2 ? document.getElementById("detection-status") : null),
      "both files detected",
    );
    expect([...status.querySelectorAll("strong")].map((s) => s.textContent)).toEqual(["Interactive Brokers", "Revolut"]);

    await waitFor(() => !(document.getElementById("wizard-next") as HTMLButtonElement).disabled || null, "Next enabled");
    document.getElementById("wizard-next")!.click();
    await waitFor(() => document.querySelector("#review-content .review-grid"), "review grid");
    document.getElementById("wizard-next")!.click();

    await waitFor(() => (document.querySelectorAll(".annex-broker").length === 4 ? true : null), "annex broker cells");
    const rows = [...document.querySelectorAll(".annex-table tbody tr")].map((tr) =>
      [...tr.querySelectorAll(".annex-broker")].map((td) => td.textContent),
    );
    expect(rows).toContainEqual(["Revolut", "Revolut"]);
    expect(rows).toContainEqual(["Interactive Brokers", "Interactive Brokers"]);
  });
});
