// @vitest-environment jsdom
/**
 * Broker-supplied strings must reach the page as text, never as markup.
 *
 * A broker file is user-uploaded and can be crafted. The IBKR parser decodes
 * XML entities in attributes, so `currency="USD&lt;form&gt;"` arrives as the
 * string `USD<form>`. The review step (currencies, date range) and the results
 * tables (buy/sell dates, dividend pay date) interpolate these values into
 * innerHTML, and so do the casilla detail cards (#casillas) and the operations
 * annex (.annex-container), each with its own date formatter. Every one of these
 * values must go through esc().
 *
 * This drives the real app: the real index.html markup, the real main.ts, a
 * File handed to #file-input, and the wizard's Next button. All amounts are in
 * EUR so no ECB request is needed (fetch is stubbed to fail if one is made).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");

/** One IBKR Flex statement with the given trades and cash transactions. */
function flexXml(trades: string, cash = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U0000001" fromDate="20250101" toDate="20251231" period="LastYear">
      <Trades>${trades}</Trades>
      <CashTransactions>${cash}</CashTransactions>
      <CorporateActions />
      <OpenPositions />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;
}

function trade(id: string, attrs: { currency: string; tradeDate: string; side: "BUY" | "SELL" }): string {
  const qty = attrs.side === "BUY" ? "10" : "-10";
  const money = attrs.side === "BUY" ? "1000.00" : "-1200.00";
  return `<Trade tradeID="${id}" accountId="U0000001" symbol="ACME" description="ACME CORP"
    isin="XX0000000001" assetCategory="STK" currency="${attrs.currency}"
    tradeDate="${attrs.tradeDate}" settlementDate=""
    quantity="${qty}" tradePrice="${attrs.side === "BUY" ? "100" : "120"}" tradeMoney="${money}"
    proceeds="${money}" cost="0" fifoPnlRealized="0" fxRateToBase="1"
    buySell="${attrs.side}" openCloseIndicator="${attrs.side === "BUY" ? "O" : "C"}"
    exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />`;
}

function dividend(dateTime: string): string {
  return `<CashTransaction transactionID="900" accountId="U0000001" symbol="ACME"
    description="ACME(XX0000000001) Cash Dividend" isin="XX0000000001" currency="EUR"
    dateTime="${dateTime}" settleDate="" amount="5.00" fxRateToBase="1" type="Dividends" />`;
}

/** XML-attribute-encoded markup: the parser decodes it back to live tags. */
const TAG = (id: string) => `&lt;b id=&quot;${id}&quot;&gt;x&lt;/b&gt;`;
const INJECTED = "form, a, style, b";

async function waitFor<T>(probe: () => T | null | undefined, label: string): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const v = probe();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Upload `xml` through #file-input and click Next into the review step. */
async function uploadAndReview(xml: string): Promise<HTMLElement> {
  const file = new File([xml], "statement.xml", { type: "text/xml" });
  const input = document.getElementById("file-input") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
  await waitFor(() => !(document.getElementById("wizard-next") as HTMLButtonElement).disabled || null, "Next enabled");
  document.getElementById("wizard-next")!.click();
  return waitFor(() => document.querySelector<HTMLElement>("#review-content .review-grid"), "review grid");
}

async function continueToResults(): Promise<void> {
  document.getElementById("wizard-next")!.click();
  await waitFor(() => document.querySelector("#operations-table table"), "operations table");
}

/** In-memory localStorage (newer Node versions shadow jsdom's with their own). */
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
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(INDEX_HTML, "text/html")
    .documentElement.innerHTML;
  Element.prototype.scrollIntoView = () => {}; // jsdom has no scrollIntoView; the wizard calls it
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
  await import("../../src/web/main.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("review step escapes broker-supplied currency and trade dates", () => {
  it("control: a clean USD file renders its currency and dates as plain values", async () => {
    const review = await uploadAndReview(
      flexXml(trade("1", { currency: "USD", tradeDate: "20250110", side: "BUY" })),
    );
    const values = [...review.querySelectorAll(".review-value")].map((el) => el.textContent);
    expect(values).toContain("USD");
    expect(values).toContain("10/01/2025 — 10/01/2025");
    expect(review.querySelector(INJECTED)).toBeNull();
  });

  it("markup in currency or tradeDate is shown as text, never as elements", async () => {
    const review = await uploadAndReview(
      flexXml(
        trade("1", {
          currency: `USD&lt;form id=&quot;f&quot;&gt;&lt;input&gt;&lt;/form&gt;`,
          tradeDate: `20250110${TAG("date")}`,
          side: "BUY",
        }),
      ),
    );
    expect(review.querySelector(INJECTED)).toBeNull();
    expect(review.querySelector("input")).toBeNull();
    expect(review.textContent).toContain('USD<form id="f"');
    expect(review.textContent).toContain('20250110<b id="date">x</b>');
  });
});

/** Assert that no results-step container holds an injected element. */
function expectNoInjectedResults(): { casillas: HTMLElement; annex: HTMLElement } {
  const casillas = document.getElementById("casillas")!;
  const annex = document.querySelector<HTMLElement>(".annex-container")!;
  expect(casillas.querySelector(".casilla-detail")).not.toBeNull();
  // Drill-downs are built on first expand; open them all so their dates are checked.
  casillas.querySelectorAll<HTMLButtonElement>(".casilla-card.expandable .casilla-trigger").forEach((b) => { b.click(); });
  expect(casillas.querySelector(".casilla-detail .detail-table")).not.toBeNull();
  expect(annex).not.toBeNull();
  for (const id of ["operations-table", "dividends-table"]) {
    expect(document.getElementById(id)!.querySelector(INJECTED)).toBeNull();
  }
  expect(casillas.querySelector(INJECTED)).toBeNull();
  expect(annex.querySelector(INJECTED)).toBeNull();
  return { casillas, annex };
}

describe("results tables escape broker-supplied dates", () => {
  it("markup in buy/sell dates and dividend pay date is shown as text", async () => {
    await uploadAndReview(
      flexXml(
        trade("1", { currency: "EUR", tradeDate: `20250110${TAG("buy")}`, side: "BUY" }) +
          trade("2", { currency: "EUR", tradeDate: `20250310${TAG("sell")}`, side: "SELL" }),
        dividend(`20250315${TAG("pay")}`),
      ),
    );
    await continueToResults();

    const ops = document.getElementById("operations-table")!;
    const divs = document.getElementById("dividends-table")!;
    expect(ops.querySelector("tbody tr")).not.toBeNull();
    expect(divs.querySelector("tbody tr")).not.toBeNull();
    expect(ops.querySelector(INJECTED)).toBeNull();
    expect(divs.querySelector(INJECTED)).toBeNull();
    expect(ops.textContent).toContain('20250110<b id="buy">x</b>');
    expect(ops.textContent).toContain('20250310<b id="sell">x</b>');
    expect(divs.textContent).toContain('20250315<b id="pay">x</b>');
    expectNoInjectedResults();
  });

  it("a short markup date, which the date formatters return unchanged, is shown as text", async () => {
    // Fewer than 8 characters: the casilla and annex formatters skip their
    // slicing and hand the raw string back, so only esc() stands in the way.
    // The IBKR parser now refuses a date that is not yyyyMMdd, so the raw
    // string comes in through Freedom24, whose parser passes it along.
    const freedom24Trade = (operation: string, date: string, p: number) => ({
      operation, ticker: "ACME.EU", isin: "XX0000000001", date, q: 10, p, curr_c: "EUR",
      amount: String(10 * p), commission: "0",
    });
    await uploadAndReview(
      JSON.stringify({
        trades: {
          detailed: [freedom24Trade("buy", "<style>", 100), freedom24Trade("sell", "2025-03-10 10:00:00", 120)],
        },
      }),
    );
    await continueToResults();

    const { casillas, annex } = expectNoInjectedResults();
    expect(document.querySelector("#wizard-step-3 style")).toBeNull();
    expect(casillas.textContent).toContain("<style>");
    expect(annex.textContent).toContain("<style>");
  });
});
