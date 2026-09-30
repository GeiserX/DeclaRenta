// @vitest-environment jsdom
/**
 * Modelo 721 section for exchange exports that carry no year-end balances.
 *
 * Binance, Coinbase and Kraken parsers return no open positions, so the section
 * used to tell a user who had just uploaded their file to "upload a report".
 * The section now derives the year-end quantities from the FIFO lots still held
 * at 31 December and offers an input for each coin's year-end price, which it
 * stores as a manual quote (no price API).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { binanceParser } from "../../src/parsers/binance.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { renderSection721 } from "../../src/web/section-721.js";
import { setLocale, t } from "../../src/i18n/index.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Statement } from "../../src/types/broker.js";

const YEAR = 2025;
const CSV = readFileSync(resolve(__dirname, "../fixtures/binance-tx-sample.csv"), "utf-8");

/** 1 USD = 0.9 EUR on every day of the fixture's year (USDT normalizes to USD). */
function usdRates(): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (let d = new Date(Date.UTC(YEAR, 0, 1)); d.getUTCFullYear() === YEAR; d.setUTCDate(d.getUTCDate() + 1)) {
    map.set(d.toISOString().slice(0, 10), new Map([["USD", "0.9"]]));
  }
  return map;
}

function container(): HTMLElement {
  return document.getElementById("m721-content")!;
}

function renderBinance(onSaved?: () => void): { statement: Statement; rates: EcbRateMap } {
  const statement = binanceParser.parse(CSV);
  const rates = usdRates();
  const report = generateTaxReport(statement, rates, YEAR);
  renderSection721(statement, rates, report.yearEndLots, onSaved);
  return { statement, rates };
}

describe("Modelo 721 section with an exchange export (no open positions)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("declarenta_profile", JSON.stringify({ year: YEAR }));
    setLocale("es");
    document.body.innerHTML = `<div id="m721-content"></div>`;
  });

  it("shows the coins still held at 31 December instead of asking for an upload", () => {
    renderBinance();
    const html = container().innerHTML;
    expect(html).not.toContain(t("m721.no_positions"));
    expect(html).toContain(t("m721.derived_notice", { date: `31/12/${YEAR}` }));

    // Convert 200 USDT → 10 SOL leaves a SOL lot of 10 at year end.
    const solInput = container().querySelector<HTMLInputElement>('.m721-rate-input[data-coin="SOL"]');
    expect(solInput).not.toBeNull();
    const solRow = solInput!.closest("tr")!;
    expect(solRow.textContent).toContain("SOL");
    expect(solRow.textContent).toContain("10");
    expect(solRow.textContent).toContain(t("m721.derived_tag"));
    // Unvalued until the user types the year-end price.
    expect(html).toContain(t("m721.positions_unvalued", { count: "1" }));
    // Derived rows are a 31 December snapshot: no "broker gives no date" banner.
    expect(html).not.toContain(t("section.positions_date_unknown", { year: String(YEAR) }));
  });

  it("stores a typed year-end price as a manual quote and values the coin with it", () => {
    let saved = 0;
    const { statement, rates } = renderBinance(() => {
      saved++;
    });
    const input = container().querySelector<HTMLInputElement>('.m721-rate-input[data-coin="SOL"]')!;
    input.value = "180,50";
    container().querySelector<HTMLButtonElement>(".m721-rates-save")!.click();

    expect(saved).toBe(1);
    const stored = JSON.parse(localStorage.getItem("declarenta_manual_rates")!) as unknown[];
    expect(stored).toContainEqual({ currency: "SOL", date: `${YEAR}-12-31`, eurPerUnit: "180.50" });

    // Re-render as main.ts does after recalculating.
    const report = generateTaxReport(statement, rates, YEAR);
    renderSection721(statement, rates, report.yearEndLots);
    const html = container().innerHTML;
    expect(html).not.toContain(t("m721.positions_unvalued", { count: "1" }));
    // 10 SOL × 180.50 = 1805 €
    expect(container().querySelector('.m721-rate-input[data-coin="SOL"]')!.closest("tr")!.textContent).toMatch(/1\.?805/);
    expect((container().querySelector<HTMLInputElement>('.m721-rate-input[data-coin="SOL"]'))!.value).toBe("180.5");
  });

  it("flags an unreadable price and saves nothing", () => {
    let saved = 0;
    renderBinance(() => {
      saved++;
    });
    const input = container().querySelector<HTMLInputElement>('.m721-rate-input[data-coin="SOL"]')!;
    input.value = "abc";
    container().querySelector<HTMLButtonElement>(".m721-rates-save")!.click();

    expect(saved).toBe(0);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(container().querySelector<HTMLElement>(".m721-rates-error")!.hidden).toBe(false);
    expect(localStorage.getItem("declarenta_manual_rates")).toBeNull();
  });

  it("says nothing was held at year end when the crypto transactions leave no lots", () => {
    const statement = binanceParser.parse(CSV);
    const rates = usdRates();
    renderSection721(statement, rates, new Map());
    const html = container().innerHTML;
    expect(html).not.toContain(t("m721.no_positions"));
    expect(html).toContain(t("m721.no_holdings_at_year_end", { date: `31/12/${YEAR}` }));
  });

  it("keeps asking for an upload when the file has no crypto at all", () => {
    const statement = binanceParser.parse(CSV);
    statement.trades = [];
    renderSection721(statement, usdRates(), new Map());
    expect(container().innerHTML).toContain(t("m721.no_positions"));
  });
});
