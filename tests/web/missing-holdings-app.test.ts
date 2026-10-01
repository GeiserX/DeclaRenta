// @vitest-environment jsdom
/**
 * The real app passes the brokers without year-end holdings to the 721 section.
 *
 * A Binance export funded in EUR needs no ECB request, so fetch is stubbed to
 * fail. After processing, #m721-content must name Binance instead of asking the
 * user to upload a report with crypto positions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");
const YEAR = new Date().getFullYear() - 1; // the profile's default declaration year

const CSV = `User_ID,UTC_Time,Account,Operation,Coin,Change,Remark
1,${YEAR}-03-01 10:00:00,Spot,Buy Crypto With Fiat,EUR,-1000.00000000,Via CashBalance - Wallet/1
1,${YEAR}-03-01 10:00:00,Spot,Buy Crypto With Fiat,BTC,0.02000000,Via CashBalance - Wallet/1
`;

async function waitFor<T>(probe: () => T | null | undefined, label: string): Promise<T> {
  for (let i = 0; i < 200; i++) {
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

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__COMMIT_HASH__", "test");
  document.documentElement.innerHTML = new DOMParser().parseFromString(
    INDEX_HTML,
    "text/html",
  ).documentElement.innerHTML;
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
  await import("../../src/web/main.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Modelo 721 after processing a Binance export", () => {
  it("names Binance instead of asking for a report with positions", async () => {
    const file = new File([CSV], "binance.csv", { type: "text/csv" });
    const input = document.getElementById("file-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
    await waitFor(() => !(document.getElementById("wizard-next") as HTMLButtonElement).disabled || null, "Next enabled");
    document.getElementById("wizard-next")!.click();
    await waitFor(() => document.querySelector("#review-content .review-grid"), "review grid");
    document.getElementById("wizard-next")!.click();

    const notice = await waitFor(() => document.querySelector("#m721-content .m721-no-holdings"), "721 notice");
    expect(notice.textContent).toContain("Binance");
    // jsdom reports an English navigator, so the app renders in English.
    expect(notice.textContent).toContain("50,000");
    // 720 names it too: the export carries no balances either.
    expect(document.querySelector("#m720-content .m720-no-holdings")?.textContent).toContain("Binance");
  });
});
