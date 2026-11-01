/**
 * The JSON of `declarenta convert` names the broker on both sides of each
 * currency disposal (operaciones_fx), like it does for securities
 * (operaciones). A USD conversion needs ECB rates, so the report is built here
 * with an in-memory rate map and passed to the same formatReport the CLI uses:
 * no network.
 */

import { describe, expect, it } from "vitest";
import { formatReport } from "../../src/cli/format-report.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { Statement } from "../../src/types/broker.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Trade } from "../../src/types/ibkr.js";

/** A CASH EUR.USD trade: SELL acquires `usd` dollars, BUY converts them back to EUR. */
function cashTrade(id: string, date: string, usd: string, side: "BUY" | "SELL"): Trade {
  return {
    tradeID: id,
    accountId: "U1",
    symbol: "EUR.USD",
    description: "EUR.USD",
    isin: "",
    assetCategory: "CASH",
    currency: "USD",
    tradeDate: date,
    settlementDate: date,
    quantity: usd,
    tradePrice: "1",
    tradeMoney: usd,
    proceeds: side === "SELL" ? usd : `-${usd}`,
    cost: usd,
    fifoPnlRealized: "0",
    fxRateToBase: "1",
    buySell: side,
    openCloseIndicator: "",
    exchange: "IDEALFX",
    commissionCurrency: "USD",
    commission: "0",
    taxes: "0",
    multiplier: "1",
  };
}

function statementOf(trades: Trade[]): Statement {
  const s = createEmptyStatement();
  s.trades.push(...trades);
  return s;
}

const RATES: EcbRateMap = new Map([
  ["2025-02-03", new Map([["USD", "0.90"]])],
  ["2025-06-02", new Map([["USD", "0.95"]])],
]);

describe("formatReport: broker of each currency disposal", () => {
  it("names the broker that converted the dollars and the one they came from", () => {
    const merged = createEmptyStatement();
    mergeStatement(merged, statementOf([cashTrade("1", "2025-02-03", "1000", "SELL")]), "Interactive Brokers");
    mergeStatement(merged, statementOf([cashTrade("2", "2025-06-02", "1000", "BUY")]), "Lightyear");
    const report = generateTaxReport(finalizeMergedStatement(merged), RATES, 2025);

    const json = formatReport(report);
    expect(json.operaciones_fx).toHaveLength(1);
    expect(json.operaciones_fx[0]).toMatchObject({
      divisa: "USD",
      ganancia_eur: "50.00",
      broker_venta: "Lightyear",
      broker_compra: "Interactive Brokers",
    });
  });

  it("leaves broker_compra out when the dollars had no lot", () => {
    const merged = createEmptyStatement();
    mergeStatement(merged, statementOf([cashTrade("2", "2025-06-02", "1000", "BUY")]), "Lightyear");
    const report = generateTaxReport(finalizeMergedStatement(merged), RATES, 2025);

    const [op] = formatReport(report).operaciones_fx;
    expect(op?.broker_venta).toBe("Lightyear");
    expect(op?.broker_compra).toBeUndefined();
  });
});
