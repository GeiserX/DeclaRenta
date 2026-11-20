// @vitest-environment jsdom
/**
 * Issues #469 and #470: the charts and the results operations table show
 * each sale as the boxes count it (`finiteDisposalAmounts`).
 *
 * A sale whose lot was bought at 1e2000 has a NaN result: the boxes add its
 * proceeds and no cost. A sale with proceeds of 1e13 € is left out of the
 * boxes. Before, the NaN result made the monthly chart draw no bar at all,
 * the 1e13 € sale was drawn as a gain of about 10 trillion euros, the NaN sale
 * showed under neither «Ganancias» nor «Pérdidas», and sorting by result put
 * the other sales out of order.
 *
 * The data goes through the real path: an IBKR Flex Query parsed by the IBKR
 * parser and run through generateTaxReport. Every amount is in EUR, so no ECB
 * request is made.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { extractChartData, renderMonthlyGainLossChart } from "../../src/web/charts.js";
import { assetLabel } from "../../src/web/asset-labels.js";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");

function trade(id: string, symbol: string, isin: string, side: "BUY" | "SELL", date: string, qty: string, price: string): string {
  return `<Trade tradeID="${id}" accountId="U1" symbol="${symbol}" description="${symbol} SA" conid="${id}9" isin="${isin}"
    assetCategory="STK" currency="EUR" tradeDate="${date}" settlementDate="${date}" quantity="${qty}" tradePrice="${price}"
    tradeMoney="0" proceeds="0" cost="0" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}"
    openCloseIndicator="${side === "BUY" ? "O" : "C"}" exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" multiplier="1" />`;
}

function xml(trades: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20250101" toDate="20251231" period="Custom"><Trades>${trades.join("")}</Trades><CashTransactions /><OpenPositions /></FlexStatement></FlexStatements></FlexQueryResponse>`;
}

/** Ordinary sales: AAA +300 in February, CCC +100 in June, DDD −50 in July. */
const ORDINARY = [
  trade("1", "AAA", "ES0000000001", "BUY", "20250110", "10", "10"),
  trade("2", "AAA", "ES0000000001", "SELL", "20250210", "-10", "40"),
  trade("5", "CCC", "ES0000000003", "BUY", "20250110", "10", "10"),
  trade("6", "CCC", "ES0000000003", "SELL", "20250610", "-10", "20"),
  trade("7", "DDD", "ES0000000004", "BUY", "20250110", "10", "10"),
  trade("8", "DDD", "ES0000000004", "SELL", "20250710", "-10", "5"),
];

/** BBB: a lot bought at 1e2000, sold in March for 120 €; the boxes add 120 and no cost. */
const NAN_RESULT = [
  trade("3", "BBB", "ES0000000002", "BUY", "20250110", "10", "1e2000"),
  trade("4", "BBB", "ES0000000002", "SELL", "20250310", "-10", "12"),
];

/** EEE: sold in April for 1e13 €; the boxes leave the whole sale out. */
const HUGE_PROCEEDS = [
  trade("9", "EEE", "ES0000000005", "BUY", "20250110", "1000000", "10"),
  trade("10", "EEE", "ES0000000005", "SELL", "20250410", "-1000000", "10000000"),
];

const report = (trades: string[]) => generateTaxReport(parseIbkrFlexXml(xml(trades)), new Map(), 2025);

/** Gain and loss per month, January first. */
const months = (trades: string[]) => extractChartData(report(trades)).monthlyGainLoss.map((m) => [m.gain, m.loss]);

describe("the charts read each sale as the boxes count it (#469, #470)", () => {
  it("ordinary sales chart their own amounts (control)", () => {
    const data = extractChartData(report(ORDINARY));
    expect(data.monthlyGainLoss[1]!.gain).toBe(300);
    expect(data.monthlyGainLoss[5]!.gain).toBe(100);
    expect(data.monthlyGainLoss[6]!.loss).toBe(-50);
    expect(data.assetDistribution.map((a) => a.label)).toEqual([assetLabel("STK")]);
    expect(data.assetDistribution[0]!.value.toNumber()).toBe(400 + 200 + 50);
  });

  it("a sale with a NaN result is charted with the result the boxes add, and every other bar stays", () => {
    const rep = report([...ORDINARY, ...NAN_RESULT]);
    expect(rep.capitalGains.disposals.find((d) => d.symbol === "BBB")!.gainLossEur.isNaN()).toBe(true);
    const bars = months([...ORDINARY, ...NAN_RESULT]);
    expect(bars[1]).toEqual([300, 0]);
    expect(bars[2]).toEqual([120, 0]);
    expect(bars[5]).toEqual([100, 0]);
    expect(bars[6]).toEqual([0, -50]);
    const svg = renderMonthlyGainLossChart("m", extractChartData(rep).monthlyGainLoss);
    expect(svg).not.toContain("NaN");
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThan(0);
  });

  it("a sale whose proceeds the boxes leave out is in no chart", () => {
    const data = extractChartData(report([...ORDINARY, ...HUGE_PROCEEDS]));
    expect(data.monthlyGainLoss[3]).toMatchObject({ gain: 0, loss: 0 });
    expect(Math.max(...data.monthlyGainLoss.map((m) => m.gain))).toBe(300);
    expect(data.assetDistribution[0]!.value.toNumber()).toBe(650);
    expect(data.currencyComposition).toHaveLength(1);
    expect(data.currencyComposition[0]!.value.toNumber()).toBe(650);
  });
});

describe("the results operations table filters and sorts by the counted result (#469, #470)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the NaN-result sale is a gain, and sorting by result keeps every row in order", async () => {
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
    // AAA first, then BBB, then CCC: the order a NaN comparison cannot sort.
    const file = xml([...ORDINARY.slice(0, 2), ...NAN_RESULT, ...ORDINARY.slice(2)]);
    const input = document.getElementById("file-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([file], "statement.xml", { type: "text/xml" })], configurable: true });
    input.dispatchEvent(new Event("change"));
    await waitFor(() => !(document.getElementById("wizard-next") as HTMLButtonElement).disabled || null, "Next enabled");
    document.getElementById("wizard-next")!.click();
    await waitFor(() => document.querySelector("#review-content .review-grid"), "review grid");
    document.getElementById("wizard-next")!.click();
    const opsTable = document.getElementById("operations-table")!;
    await waitFor(() => opsTable.querySelector("table"), "operations table");

    const symbols = () =>
      [...opsTable.querySelectorAll("tbody tr:not(.wash-sale-detail)")].map((tr) => tr.querySelectorAll("td")[1]!.textContent.trim());
    expect(symbols().sort()).toEqual(["AAA", "BBB", "CCC", "DDD"]);

    const filter = document.getElementById("ops-filter") as HTMLSelectElement;
    filter.value = "gain";
    filter.dispatchEvent(new Event("change"));
    expect(symbols().sort()).toEqual(["AAA", "BBB", "CCC"]);
    filter.value = "loss";
    filter.dispatchEvent(new Event("change"));
    expect(symbols()).toEqual(["DDD"]);
    filter.value = "all";
    filter.dispatchEvent(new Event("change"));

    opsTable.querySelector<HTMLElement>('th[data-col="gl"] .sort-btn')!.click();
    expect(symbols()).toEqual(["DDD", "CCC", "BBB", "AAA"]);
  });
});
