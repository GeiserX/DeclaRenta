import { describe, it, expect } from "vitest";
import { generateModelo720, parsePrevious720Isins } from "../../src/generators/modelo720.js";
import type { CashBalance, OpenPosition } from "../../src/types/ibkr.js";

// `modelo720 --previous-720` reads last year's file to decide A/M/C. Round-trip
// the generator's own output: year N's file must give back only the securities
// still held at the end of year N.

function position(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    accountId: "U7654321", symbol: "IWDA", description: "ISHARES CORE MSCI WORLD", isin: "IE00B4L5Y983",
    currency: "EUR", assetCategory: "STK", quantity: "600", costBasisMoney: "40000", costBasisPrice: "66",
    markPrice: "92", positionValue: "55200", fifoPnlUnrealized: "15200", fxRateToBase: "1", ...overrides,
  };
}

function cash(endingCash: string): CashBalance {
  return { accountId: "U7654321", currency: "EUR", endingCash, endingSettledCash: endingCash, averageQ4Cash: endingCash };
}

function config(year: number, previousYearIsins?: string[]) {
  return {
    nif: "12345678A", surname: "GARCIA LOPEZ", name: "JUAN", year, phone: "600123456",
    contactName: "GARCIA LOPEZ, JUAN", declarationId: "0000000000001", isComplementary: false,
    isReplacement: false, previousYearIsins,
  };
}

describe("--previous-720 round trip", () => {
  // Year N: IWDA held, Apple declared the year before and gone (C record), and a
  // cash account over 50k (a Category C record with the account id at 132-143).
  const yearN = generateModelo720([position()], new Map(), config(2024, ["US0378331005"]), undefined, [cash("55200")]);

  it("reads back only the securities held at the end of year N", () => {
    expect(yearN.split("\n").filter((l) => l[0] === "2")).toHaveLength(3);
    expect(parsePrevious720Isins(yearN)).toEqual(["IE00B4L5Y983"]);
  });

  it("does not force a year N+1 filing below the threshold", () => {
    const previous = parsePrevious720Isins(yearN);
    const yearN1 = generateModelo720(
      [position({ positionValue: "9200" })], new Map(), config(2025, previous), undefined, [cash("920")],
    );
    expect(yearN1).toBe("");
  });

  it("does not cancel last year's extinctions or the cash account again in year N+1", () => {
    const yearN1 = generateModelo720([position()], new Map(), config(2025, parsePrevious720Isins(yearN)));
    const details = yearN1.split("\n").filter((l) => l[0] === "2");
    expect(details.map((l) => `${l[101]}/${l[422]}/${l.slice(131, 143).trim()}`)).toEqual(["V/M/IE00B4L5Y983"]);
  });
});
