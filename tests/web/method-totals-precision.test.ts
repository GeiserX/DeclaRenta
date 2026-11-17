/**
 * The method strip's indicative tax (#434) must use the exact Decimal base.
 * A base of 10000.4999999999999 € taxes 1980.10 € (6000 × 19 % + 4000.4999… ×
 * 21 %); a Number round trip turns it into 10000.5 and shows 1980.11.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { methodTotals } from "../../src/web/method-summary.js";
import { computeTaxableBase, computeTaxableBaseBreakdown } from "../../src/engine/taxable-base.js";
import type { FlexStatement } from "../../src/types/ibkr.js";

const BASE = "10000.4999999999999";

function report() {
  const st = {
    accountId: "U1",
    fromDate: "20250101",
    toDate: "20251231",
    period: "Annual",
    trades: [],
    cashTransactions: [
      {
        transactionID: "1",
        accountId: "U1",
        symbol: "",
        description: "EUR CREDIT INT",
        isin: "",
        currency: "EUR",
        dateTime: "20250131",
        settleDate: "20250131",
        amount: BASE,
        fxRateToBase: "1",
        type: "Broker Interest Received",
      },
    ],
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
  } as unknown as FlexStatement;
  return generateTaxReport(st, new Map(), 2025);
}

describe("indicative tax on a base Number cannot hold", () => {
  it("the report carries the exact base", () => {
    expect(report().interest.earned.toString()).toBe(BASE);
  });

  it("computeTaxableBase returns the exact Decimal", () => {
    const b = computeTaxableBase(report());
    expect(b).toBeInstanceOf(Decimal);
    expect(b.toString()).toBe(BASE);
    expect(computeTaxableBaseBreakdown(report()).taxableBase).toBe(new Decimal(BASE).toNumber());
  });

  it("methodTotals taxes 1980.10, not 1980.11", () => {
    expect(methodTotals(report()).tax.toFixed(2)).toBe("1980.10");
  });
});
