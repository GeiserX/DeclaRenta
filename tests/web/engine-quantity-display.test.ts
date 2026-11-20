// @vitest-environment jsdom
/**
 * A quantity the FIFO engine computes is shown in full. Splits, mergers and
 * spin-offs divide a lot's quantity at precision 20, so ordinary data gives a
 * count with more than 20 decimals: 0.1234 shares through a 1-for-3 merger
 * are 0.041133333333333333333 shares (21 decimals). `fmtQty` once showed «—»
 * for any count past 20 decimals, so the sale of those shares read «—» units
 * in the annex, the operations table and the casilla drill-down. Only a count
 * whose full text is absurdly long (an exponent no engine produces, such as
 * 1e-1000000000) is «—».
 *
 * The data goes through the real path: an IBKR Flex Query with the buy, the
 * merger and the sale, parsed by the IBKR parser and run through
 * generateTaxReport, then rendered by the annex, the casilla drill-down and
 * the real app's operations table. All amounts are in EUR, so no ECB request
 * is needed.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { renderOperationsAnnex } from "../../src/web/operations-annex.js";
import { renderCasillaCards } from "../../src/web/casilla-detail.js";
import { t } from "../../src/i18n/index.js";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");

/** What the sale's units cell must read: the engine's 21-decimal count in full. */
const MERGED_QTY = "0,041133333333333333333";

function trade(id: string, symbol: string, isin: string, side: "BUY" | "SELL", date: string, qty: string, price: string): string {
  return `<Trade tradeID="${id}" accountId="U0000001" symbol="${symbol}" description="${symbol} CORP"
    isin="${isin}" assetCategory="STK" currency="EUR" tradeDate="${date}" settlementDate="${date}"
    quantity="${qty}" tradePrice="${price}" tradeMoney="0" proceeds="0" cost="0" fifoPnlRealized="0"
    fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}"
    exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />`;
}

/** 0.1234 OLD bought, OLD merged 1 for 3 into NEW, every NEW share sold. */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U0000001" fromDate="20250101" toDate="20251231" period="LastYear">
      <Trades>
        ${trade("1", "OLD", "XX1111111111", "BUY", "20250115", "0.1234", "50")}
        ${trade("2", "NEW", "XX2222222222", "SELL", "20250901", "-0.041133333333333333333", "160")}
      </Trades>
      <CashTransactions />
      <CorporateActions>
        <CorporateAction transactionID="CA1" accountId="U0000001" symbol="NEW" isin="XX1111111111" currency="EUR"
          description="OLD(XX1111111111) MERGED(Acquisition) 1 FOR 3 NEW(XX2222222222)"
          reportDate="20250601" dateTime="20250601" quantity="0.0411" amount="0" type="TC" actionDescription="Merger 1:3" />
      </CorporateActions>
      <OpenPositions />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

function report() {
  return generateTaxReport(parseIbkrFlexXml(XML), new Map(), 2025);
}

describe("a quantity the FIFO engine computes past 20 decimals is shown in full", () => {
  it("the merger leaves a 21-decimal count, and the sale books it", () => {
    const disposals = report().capitalGains.disposals;
    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.quantity.toFixed()).toBe("0.041133333333333333333");
    expect(disposals[0]!.quantity.decimalPlaces()).toBe(21);
  });

  it("the annex shows it", () => {
    const html = renderOperationsAnnex(report());
    const body = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
    expect(body).toContain(`<td>${MERGED_QTY}</td>`);
  });

  it("the casilla drill-down shows it", () => {
    const container = document.createElement("div");
    renderCasillaCards(container, report());
    const card = [...container.querySelectorAll<HTMLElement>(".casilla-card")]
      .find((c) => c.querySelector(".casilla-concept")?.textContent === t("casilla.listed_transmission_value"))!;
    card.querySelector<HTMLButtonElement>(".casilla-trigger")!.click();
    const cells = [...card.querySelectorAll(".detail-table tbody td")].map((td) => td.textContent.trim());
    expect(cells).toContain(MERGED_QTY);
  });

  describe("the results operations table", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("shows it", async () => {
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
      Object.defineProperty(input, "files", { value: [new File([XML], "statement.xml", { type: "text/xml" })], configurable: true });
      input.dispatchEvent(new Event("change"));
      await waitFor(() => !(document.getElementById("wizard-next") as HTMLButtonElement).disabled || null, "Next enabled");
      document.getElementById("wizard-next")!.click();
      await waitFor(() => document.querySelector("#review-content .review-grid"), "review grid");
      document.getElementById("wizard-next")!.click();
      const table = await waitFor(() => document.querySelector<HTMLElement>("#operations-table table"), "operations table");
      const cells = [...table.querySelectorAll("tbody tr:not(.wash-sale-detail) td")].map((td) => td.textContent.trim());
      expect(cells).toContain(MERGED_QTY);
    });
  });
});
