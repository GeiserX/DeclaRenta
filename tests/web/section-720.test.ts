// @vitest-environment jsdom
/**
 * A security the broker export gives no market value for (Revolut's
 * transaction log) is unvalued, not worth 0 €: the 720 section must say so and
 * must not call the securities category "below the threshold".
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Decimal from "decimal.js";
import { renderSection720 } from "../../src/web/section-720.js";
import type { Statement } from "../../src/types/broker.js";
import type { OpenPosition } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

function stock(overrides: Partial<OpenPosition>): OpenPosition {
  return {
    accountId: "",
    symbol: "SPY",
    description: "SPDR S&P 500 ETF",
    isin: "US78462F1030",
    currency: "USD",
    assetCategory: "STK",
    quantity: "10",
    costBasisMoney: "4000",
    costBasisPrice: "400",
    markPrice: "600",
    positionValue: "6000",
    fifoPnlUnrealized: "2000",
    fxRateToBase: "1",
    custodianCountry: "IE",
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

describe("Modelo 720 section — a holding with no market value", () => {
  beforeEach(() => {
    // The profile (tax year 2025) is read from localStorage.
    const profile = JSON.stringify({ year: 2025 });
    vi.stubGlobal("localStorage", { getItem: (key: string) => (key === "declarenta_profile" ? profile : null) });
    document.body.innerHTML = `<div id="m720-content"></div>`;
  });

  it("flags it as unvalued and does not call the category below the threshold", () => {
    // Revolut: 400 AAPL bought for $80,000, no year-end price in the export.
    const revolut = stock({ symbol: "AAPL", description: "AAPL", isin: "", quantity: "400", markPrice: "0", positionValue: "0" });
    renderSection720(statement([stock({}), revolut]), rateMap);

    const text = document.getElementById("m720-content")!.textContent;
    expect(text).toContain("no se han podido valorar");
    expect(text).toContain("No se puede determinar");
    expect(text).not.toContain("Por debajo del umbral");
    const aaplRow = [...document.querySelectorAll("#m720-content tbody tr")].find((tr) => tr.textContent.includes("AAPL"));
    expect(aaplRow?.lastElementChild?.textContent).toBe("—");
  });

  it("shows the securities category even when every holding is unvalued", () => {
    const revolut = stock({ symbol: "AAPL", description: "AAPL", isin: "", quantity: "400", markPrice: "0", positionValue: "0" });
    renderSection720(statement([revolut]), rateMap);

    expect(document.getElementById("m720-content")!.textContent).toContain("No se puede determinar");
  });
});
