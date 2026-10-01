// @vitest-environment jsdom
/**
 * The 721 verdict must not say "you are not obliged" while some positions are
 * left out of the total because they could not be valued: with them the
 * holdings may well pass 50,000 €.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Decimal from "decimal.js";
import { renderSection721 } from "../../src/web/section-721.js";
import type { Statement } from "../../src/types/broker.js";
import type { OpenPosition } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

function crypto(overrides: Partial<OpenPosition>): OpenPosition {
  return {
    accountId: "",
    symbol: "ADA",
    description: "Cardano",
    isin: "",
    currency: "USD",
    assetCategory: "CRYPTO",
    quantity: "1000",
    costBasisMoney: "800",
    costBasisPrice: "0.8",
    markPrice: "1",
    positionValue: "1000",
    fifoPnlUnrealized: "200",
    fxRateToBase: "1",
    ...overrides,
  };
}

function statement(openPositions: OpenPosition[]): Statement {
  return {
    accountId: "",
    fromDate: "20250101",
    toDate: "20251231",
    period: "",
    trades: [],
    cashTransactions: [],
    corporateActions: [],
    openPositions,
    securitiesInfo: [],
  };
}

const rateMap: EcbRateMap = new Map([["2025-12-31", new Map([["USD", new Decimal("0.9")]])]]);

describe("Modelo 721 section — unvalued positions", () => {
  beforeEach(() => {
    // The profile (tax year 2025) is read from localStorage.
    const profile = JSON.stringify({ year: 2025 });
    vi.stubGlobal("localStorage", { getItem: (key: string) => (key === "declarenta_profile" ? profile : null) });
    document.body.innerHTML = `<div id="m721-content"></div>`;
  });

  it("does not say 'No estás obligado' when a position could not be valued", () => {
    // ADA: 1000 USD * 0.9 = 900 EUR. BTC: no year-end rate for the coin itself.
    const btc = crypto({ symbol: "BTC", description: "Bitcoin", currency: "BTC", quantity: "2", positionValue: "2" });
    renderSection721(statement([crypto({}), btc]), rateMap);

    const content = document.getElementById("m721-content")!;
    expect(content.textContent).not.toContain("No estás obligado");
    expect(content.textContent).toContain("No se puede determinar");

    // The warning about the excluded positions comes before the threshold bar.
    const html = content.innerHTML;
    expect(html.indexOf("no se han podido valorar")).toBeGreaterThan(-1);
    expect(html.indexOf("no se han podido valorar")).toBeLessThan(html.indexOf("threshold-bar"));
  });

  it("still says 'No estás obligado' when every position is valued and under 50,000 €", () => {
    renderSection721(statement([crypto({})]), rateMap);
    expect(document.getElementById("m721-content")!.textContent).toContain("No estás obligado");
  });
});
