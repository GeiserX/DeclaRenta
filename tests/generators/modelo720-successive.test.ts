import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  checkModelo720SuccessiveYear,
  generateModelo720,
  readPrevious720,
  readPrevious720Totals,
} from "../../src/generators/modelo720.js";
import type { CashBalance, OpenPosition } from "../../src/types/ibkr.js";

// Last year's 720 gives the per-category totals the 20,000 € rule compares
// against (arts. 42 bis.5 and 42 ter.5 RD 1065/2007). Round-trip the
// generator's own output: EUR positions and balances need no ECB rate.

function position(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    accountId: "U7654321", symbol: "IWDA", description: "ISHARES CORE MSCI WORLD", isin: "IE00B4L5Y983",
    currency: "EUR", assetCategory: "STK", quantity: "600", costBasisMoney: "40000", costBasisPrice: "66",
    markPrice: "92", positionValue: "55200", fifoPnlUnrealized: "15200", fxRateToBase: "1", custodianCountry: "IE", ...overrides,
  };
}

function cash(endingCash: string, averageQ4Cash = endingCash): CashBalance {
  return { accountId: "U7654321", currency: "EUR", endingCash, endingSettledCash: endingCash, averageQ4Cash, countryCode: "IE" };
}

const config = (year: number) => ({
  nif: "12345678A", surname: "GARCIA LOPEZ", name: "JUAN", year, phone: "600123456",
  contactName: "GARCIA LOPEZ, JUAN", declarationId: "0000000000001", isComplementary: false, isReplacement: false,
});

const vwce = position({ symbol: "VWCE", isin: "IE00BK5BQT80", positionValue: "10000.55" });
const lastYear = generateModelo720([position(), vwce], new Map(), config(2024), undefined, [cash("60000", "55000.25")]);

function check(positions: OpenPosition[], balances: CashBalance[], file = lastYear) {
  return checkModelo720SuccessiveYear(positions, new Map(), 2025, balances, readPrevious720(file), readPrevious720Totals(file));
}

describe("readPrevious720Totals", () => {
  it("sums valoración 1 of the securities and both valoraciones of the accounts, with the file's year", () => {
    const totals = readPrevious720Totals(lastYear);
    expect(totals.year).toBe(2024);
    expect(totals.values.toString()).toBe("65200.55");
    expect(totals.accountsEnding.toString()).toBe("60000");
    expect(totals.accountsAverage.toString()).toBe("55000.25");
  });

  it("leaves out the records with origin C: what was sold is no longer held", () => {
    const withSale = generateModelo720(
      [position()], new Map(), { ...config(2025), previousYearSecurities: readPrevious720(lastYear).securities },
    );
    expect(withSale.split("\n").some((l) => l[0] === "2" && l[422] === "C")).toBe(true);
    expect(readPrevious720Totals(withSale).values.toString()).toBe("55200");
  });

  it("reads a file with no summary record and ignores fields that are not amounts", () => {
    const detail = lastYear.split("\n").find((l) => l[0] === "2")!;
    const broken = detail.slice(0, 431) + " 00000ABC00000" + detail.slice(446);
    expect(readPrevious720Totals(detail)).toMatchObject({ year: null });
    expect(readPrevious720Totals(broken).values.isZero()).toBe(true);
  });
});

describe("checkModelo720SuccessiveYear", () => {
  it("makes the values category mandatory when it grew more than 20,000 €", () => {
    const result = check([position({ positionValue: "75200.01" }), vwce], [cash("60000", "55000.25")]);
    expect(result.values).toMatchObject({ declaredBefore: true, increaseExceeded: true, mandatory: true });
    expect(result.values.increase.toString()).toBe("20000.01");
    expect(result.values.previousTotal.toString()).toBe("65200.55");
  });

  it("leaves it optional at exactly 20,000 € more, with nothing sold", () => {
    const result = check([position({ positionValue: "75200" }), vwce], [cash("60000", "55000.25")]);
    expect(result.values.increase.toString()).toBe("20000");
    expect(result.values).toMatchObject({ increaseExceeded: false, mandatory: false, sold: [] });
    expect(result.accounts).toMatchObject({ declaredBefore: true, increaseExceeded: false, mandatory: false });
  });

  it("makes the values category mandatory when a declared security was sold, even with the value down", () => {
    const result = check([position()], []);
    expect(result.values.sold.map((s) => s.isin)).toEqual(["IE00BK5BQT80"]);
    expect(result.values.increase.toString()).toBe("-10000.55");
    expect(result.values.mandatory).toBe(true);
  });

  it("counts either account sum: the Q4 average alone growing more than 20,000 € makes accounts mandatory", () => {
    const result = check([position(), vwce], [cash("60000", "75000.26")]);
    expect(result.accounts.increase.toString()).toBe("20000.01");
    expect(result.accounts).toMatchObject({ increaseExceeded: true, mandatory: true });
  });

  it("never makes a category mandatory below 50,000 €, whatever the increase", () => {
    // Filed voluntarily at 20,000 €, now 49,000 €: up 29,000 € but still below the threshold.
    const previous = { securities: [{ isin: "IE00B4L5Y983", claveSubclave: "V1", country: "IE" }], accounts: [] };
    const zero = new Decimal(0);
    const totals = { year: 2024, values: new Decimal(20000), accountsEnding: zero, accountsAverage: zero };
    const result = checkModelo720SuccessiveYear([position({ positionValue: "49000" })], new Map(), 2025, [], previous, totals);
    expect(result.values).toMatchObject({ declaredBefore: true, increaseExceeded: true, mandatory: false });
    // A category last year's file did not declare follows the 50,000 € threshold alone.
    expect(result.accounts.declaredBefore).toBe(false);
    expect(result.accounts.previousTotal.equals(new Decimal(0))).toBe(true);
  });
});
