// @vitest-environment jsdom
/**
 * Modelo 721 / 720 / D-6 sections after a transaction-only export.
 *
 * Binance (and most other brokers) export trades, not the holdings at 31
 * December. The sections used to answer with "upload a report with positions"
 * right after the user uploaded one. They now name the broker and point to its
 * year-end statement to check the 50.000 € threshold.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { binanceParser } from "../../src/parsers/binance.js";
import { degiroParser } from "../../src/parsers/degiro.js";
import { findMissingHoldings } from "../../src/web/missing-holdings.js";
import { renderSection721, rerenderSection721 } from "../../src/web/section-721.js";
import { renderSection720 } from "../../src/web/section-720.js";
import { renderSectionD6 } from "../../src/web/section-d6.js";
import { setLocale, t } from "../../src/i18n/index.js";
import type { OpenPosition } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

const fixture = (name: string) => readFileSync(resolve(__dirname, "../fixtures", name), "utf-8");
const noRates: EcbRateMap = new Map();

function content(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function btcPosition(): OpenPosition {
  return {
    accountId: "A1",
    symbol: "BTC",
    description: "Bitcoin",
    isin: "",
    currency: "EUR",
    assetCategory: "CRYPTO",
    quantity: "1",
    costBasisMoney: "0",
    costBasisPrice: "0",
    markPrice: "60000",
    positionValue: "60000",
    fifoPnlUnrealized: "0",
    fxRateToBase: "1",
  };
}

beforeEach(() => {
  setLocale("es");
  document.body.innerHTML = `<div id="m720-content"></div><div id="m721-content"></div><div id="d6-content"></div>`;
});

afterEach(() => {
  setLocale("es");
  vi.restoreAllMocks();
});

describe("Modelo 721 with a Binance export", () => {
  const statement = binanceParser.parse(fixture("binance-tx-sample.csv"));
  const missing = findMissingHoldings([{ broker: "Binance", statement }]);

  it("names Binance and the 50.000 € check instead of asking for an upload", () => {
    renderSection721(statement, noRates, missing.m721);
    const text = content("m721-content").textContent;
    expect(text).not.toContain(t("m721.no_positions"));
    expect(text).toContain("Binance");
    expect(text).toContain("50.000 €");
    expect(content("m721-content").querySelector(".m721-no-holdings")).not.toBeNull();
  });

  it("keeps the upload prompt when no broker had crypto", () => {
    renderSection721(statement, noRates, []);
    expect(content("m721-content").textContent).toContain(t("m721.no_positions"));
  });

  it("re-renders the notice in the new language", () => {
    renderSection721(statement, noRates, missing.m721);
    setLocale("en");
    rerenderSection721();
    const text = content("m721-content").textContent;
    expect(text).toContain(t("m721.brokers_without_holdings", { brokers: "Binance" }));
    expect(text).toContain("€50,000");
  });

  it("adds the notice under the total when another broker does report holdings", () => {
    const withPosition = { ...statement, openPositions: [btcPosition()] };
    renderSection721(withPosition, noRates, ["Binance"]);
    const el = content("m721-content");
    expect(el.querySelector(".threshold-bar")).not.toBeNull();
    expect(el.querySelector(".m721-no-holdings")?.textContent).toContain("Binance");
  });
});

describe("Modelo 720 and D-6 with transaction-only exports", () => {
  it("720 names Binance instead of asking for an upload", () => {
    const statement = binanceParser.parse(fixture("binance-tx-sample.csv"));
    const missing = findMissingHoldings([{ broker: "Binance", statement }]);
    renderSection720(statement, noRates, undefined, missing.m720);
    const text = content("m720-content").textContent;
    expect(text).not.toContain(t("m720.no_positions"));
    expect(text).toContain(t("m720.brokers_without_holdings", { brokers: "Binance" }));
  });

  it("D-6 names Degiro instead of asking for an upload", () => {
    const statement = degiroParser.parse(fixture("degiro-transactions-sample.csv"));
    const missing = findMissingHoldings([{ broker: "Degiro", statement }]);
    renderSectionD6(statement, noRates, missing.d6);
    const text = content("d6-content").textContent;
    expect(text).not.toContain(t("d6.no_positions"));
    expect(text).toContain(t("d6.brokers_without_holdings", { brokers: "Degiro" }));
  });
});
