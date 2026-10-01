/**
 * findMissingHoldings: which brokers' exports carry no year-end holdings, per
 * model (720, 721, D-6). Transaction-only exports (Binance, Degiro, ...) must be
 * named so the sections can send the user to the broker's year-end statement
 * instead of asking them to upload a file they already uploaded.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { binanceParser } from "../../src/parsers/binance.js";
import { degiroParser } from "../../src/parsers/degiro.js";
import { createEmptyStatement } from "../../src/parsers/merge.js";
import { findMissingHoldings, formatBrokerList } from "../../src/web/missing-holdings.js";
import type { OpenPosition } from "../../src/types/ibkr.js";

const fixture = (name: string) => readFileSync(resolve(__dirname, "../fixtures", name), "utf-8");

function position(overrides: Partial<OpenPosition>): OpenPosition {
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
    ...overrides,
  };
}

describe("findMissingHoldings", () => {
  it("names Binance for 720 and 721 but not for D-6 (no securities)", () => {
    const statement = binanceParser.parse(fixture("binance-tx-sample.csv"));
    expect(statement.openPositions).toHaveLength(0);
    expect(findMissingHoldings([{ broker: "Binance", statement }])).toEqual({
      m720: ["Binance"],
      m721: ["Binance"],
      d6: [],
    });
  });

  it("names Degiro for 720 and D-6 but not for 721 (no crypto)", () => {
    const statement = degiroParser.parse(fixture("degiro-transactions-sample.csv"));
    expect(findMissingHoldings([{ broker: "Degiro", statement }])).toEqual({
      m720: ["Degiro"],
      m721: [],
      d6: ["Degiro"],
    });
  });

  it("does not name a broker whose export has a valued crypto position", () => {
    const statement = binanceParser.parse(fixture("binance-tx-sample.csv"));
    statement.openPositions.push(position({}));
    expect(findMissingHoldings([{ broker: "Binance", statement }]).m721).toEqual([]);
  });

  it("names a broker whose only crypto position has no value (the 721 total skips it)", () => {
    const statement = createEmptyStatement();
    statement.openPositions.push(position({ positionValue: "0" }));
    const missing = findMissingHoldings([{ broker: "Revolut", statement }]);
    expect(missing.m721).toEqual(["Revolut"]);
    // It still has a position, so 720 has something to show for it.
    expect(missing.m720).toEqual([]);
  });

  it("counts a positive cash balance as a 720 holding", () => {
    const statement = createEmptyStatement();
    statement.cashBalances = [{ accountId: "A1", currency: "EUR", endingCash: "100", endingSettledCash: "100" }];
    expect(findMissingHoldings([{ broker: "Flatex", statement }]).m720).toEqual([]);
  });

  it("groups files by broker: holdings in any file of the broker count", () => {
    const withTrades = binanceParser.parse(fixture("binance-tx-sample.csv"));
    const withPosition = createEmptyStatement();
    withPosition.openPositions.push(position({}));
    const missing = findMissingHoldings([
      { broker: "Binance", statement: withTrades },
      { broker: "Binance", statement: withPosition },
    ]);
    expect(missing.m720).toEqual([]);
    expect(missing.m721).toEqual([]);
  });

  it("lists each broker once, in upload order", () => {
    const binance = binanceParser.parse(fixture("binance-tx-sample.csv"));
    const degiro = degiroParser.parse(fixture("degiro-transactions-sample.csv"));
    const missing = findMissingHoldings([
      { broker: "Degiro", statement: degiro },
      { broker: "Binance", statement: binance },
      { broker: "Degiro", statement: degiro },
    ]);
    expect(missing.m720).toEqual(["Degiro", "Binance"]);
  });

  it("names nobody when nothing was uploaded", () => {
    expect(findMissingHoldings([])).toEqual({ m720: [], m721: [], d6: [] });
  });
});

describe("formatBrokerList", () => {
  it("joins names with the locale's conjunction", () => {
    expect(formatBrokerList(["Binance"], "es")).toBe("Binance");
    expect(formatBrokerList(["Binance", "Coinbase"], "es")).toBe("Binance y Coinbase");
    expect(formatBrokerList(["Binance", "Coinbase", "Kraken"], "es")).toBe("Binance, Coinbase y Kraken");
    expect(formatBrokerList(["Binance", "Coinbase"], "en")).toBe("Binance and Coinbase");
  });
});
