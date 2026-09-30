// @vitest-environment jsdom
/**
 * The Modelo 720 generate button below the 50,000 € threshold.
 *
 * Below the threshold in every category there is no file to generate. The
 * button stays on the page but disabled, and its tooltip and accessible
 * description say how many euros are missing to pass 50,000 €. Clicking it
 * used to do nothing at all, which looked like a broken tool.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderSection720, rerenderSection720 } from "../../src/web/section-720.js";
import { getProfile } from "../../src/web/profile.js";
import { setLocale } from "../../src/i18n/index.js";
import { createEmptyStatement } from "../../src/parsers/merge.js";
import type { Statement } from "../../src/types/broker.js";
import type { CashBalance, OpenPosition } from "../../src/types/ibkr.js";

function eurPosition(value: string): OpenPosition {
  return {
    accountId: "U0000001",
    symbol: "ACME",
    description: "ACME CORP",
    isin: "IE0000000001",
    currency: "EUR",
    assetCategory: "STK",
    quantity: "100",
    costBasisMoney: value,
    costBasisPrice: "1",
    markPrice: "1",
    positionValue: value,
    fifoPnlUnrealized: "0",
    fxRateToBase: "1",
    custodianCountry: "IE",
  };
}

function eurCash(amount: string): CashBalance {
  return { accountId: "U0000001", currency: "EUR", endingCash: amount, endingSettledCash: amount, averageQ4Cash: amount };
}

/** A statement ending on 31 December of the profile year, so the positions are the year-end holdings. */
function statement(positions: OpenPosition[], cash: CashBalance[] = []): Statement {
  const s = createEmptyStatement();
  s.toDate = `${getProfile().year}1231`;
  s.openPositions = positions;
  s.cashBalances = cash;
  return s;
}

function button(): HTMLButtonElement | null {
  return document.getElementById("m720-generate-btn") as HTMLButtonElement | null;
}

/** An in-memory localStorage: this Node's jsdom environment does not provide one. */
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

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  setLocale("es");
  document.body.innerHTML = `<div id="m720-content"></div>`;
});

afterEach(() => {
  setLocale("es");
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Modelo 720 generate button below the threshold", () => {
  it("is disabled and names the euros missing to pass 50,000 €", () => {
    renderSection720(statement([eurPosition("30000")]), new Map());
    const btn = button()!;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain("Te faltan 20.000,00 €");
    const describedBy = btn.getAttribute("aria-describedby");
    expect(describedBy).toBe("m720-generate-reason");
    expect(document.getElementById(describedBy!)!.textContent).toBe(btn.title);
  });

  it("measures the shortfall against the largest category, not the sum", () => {
    // 30,000 € of securities plus 45,000 € of cash: neither category passes
    // 50,000 €, so there is still nothing to file. Cash is 5,000 € short.
    renderSection720(statement([eurPosition("30000")], [eurCash("45000")]), new Map());
    expect(button()!.disabled).toBe(true);
    expect(button()!.title).toContain("5.000,00 €");
  });

  it("shows the disabled button for a cash-only statement too", () => {
    renderSection720(statement([], [eurCash("10000")]), new Map());
    expect(button()!.disabled).toBe(true);
    expect(button()!.title).toContain("40.000,00 €");
  });

  it("is 0,01 € short at exactly 50,000 €, because the rule is more than 50,000 €", () => {
    renderSection720(statement([eurPosition("50000")]), new Map());
    expect(button()!.disabled).toBe(true);
    expect(button()!.title).toContain("0,01 €");
  });

  it("is enabled, with no reason attached, once a category passes 50,000 €", () => {
    renderSection720(statement([eurPosition("60000")]), new Map());
    const btn = button()!;
    expect(btn.disabled).toBe(false);
    expect(btn.hasAttribute("title")).toBe(false);
    expect(btn.hasAttribute("aria-describedby")).toBe(false);
    expect(document.getElementById("m720-generate-reason")).toBeNull();
  });

  it("re-renders the reason in the new language on a locale change", () => {
    renderSection720(statement([eurPosition("30000")]), new Map());
    setLocale("en");
    rerenderSection720();
    expect(button()!.title).toContain("You are 20.000,00 EUR short");
    expect(document.getElementById("m720-generate-reason")!.textContent).toBe(button()!.title);
  });
});
