// @vitest-environment jsdom
/**
 * The Modelo 720 section offers the "Generar fichero" button only when a
 * category passes 50.000 €. Below both thresholds the generator writes no file,
 * so the section says there is no obligation in the button's place instead of
 * showing a button that does nothing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderSection720 } from "../../src/web/section-720.js";
import { createEmptyStatement } from "../../src/parsers/merge.js";
import { setLocale } from "../../src/i18n/index.js";
import type { CashBalance, OpenPosition } from "../../src/types/ibkr.js";
import type { Statement } from "../../src/types/broker.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

const YEAR = 2025;

function position(value: string): OpenPosition {
  return {
    accountId: "U0000001",
    symbol: "ACME",
    description: "ACME CORP",
    isin: "DE0000000001",
    currency: "EUR",
    assetCategory: "STK",
    quantity: "100",
    costBasisMoney: value,
    costBasisPrice: "1",
    markPrice: "1",
    positionValue: value,
    fifoPnlUnrealized: "0",
    fxRateToBase: "1",
  };
}

function cash(endingCash: string): CashBalance {
  return { accountId: "U0000001", currency: "EUR", endingCash, endingSettledCash: endingCash, averageQ4Cash: endingCash };
}

function statementWith(positions: OpenPosition[], cashBalances: CashBalance[] = []): Statement {
  const statement = createEmptyStatement();
  statement.toDate = `${YEAR}1231`;
  statement.openPositions = positions;
  statement.cashBalances = cashBalances;
  return statement;
}

const RATES: EcbRateMap = new Map();

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

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  localStorage.setItem("declarenta_profile", JSON.stringify({ year: YEAR }));
  setLocale("es");
  document.body.innerHTML = `<div id="m720-content"></div>`;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Modelo 720 generate button", () => {
  it("below the threshold shows the no-obligation text and no button", () => {
    renderSection720(statementWith([position("30000")]), RATES);

    expect(document.getElementById("m720-generate-btn")).toBeNull();
    const notice = document.getElementById("m720-no-obligation");
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toBe(
      "No superas el umbral de 50.000 € (total: 30.000,00 €). No estás obligado a presentar.",
    );
  });

  it("above the threshold shows the button and no no-obligation text", () => {
    renderSection720(statementWith([position("60000")]), RATES);

    expect(document.getElementById("m720-generate-btn")).not.toBeNull();
    expect(document.getElementById("m720-no-obligation")).toBeNull();
  });

  it("names the largest category, not the sum, when both are below 50.000 €", () => {
    // 40.000 € of securities + 30.000 € of cash: neither category must be filed,
    // and the message must not claim a 70.000 € total below 50.000 €.
    renderSection720(statementWith([position("40000")], [cash("30000")]), RATES);

    expect(document.getElementById("m720-generate-btn")).toBeNull();
    expect(document.getElementById("m720-no-obligation")!.textContent).toContain("40.000,00");
  });

  it("follows the active locale", () => {
    setLocale("en");
    renderSection720(statementWith([position("30000")]), RATES);

    expect(document.getElementById("m720-no-obligation")!.textContent).toContain("Filing is not required.");
  });
});
