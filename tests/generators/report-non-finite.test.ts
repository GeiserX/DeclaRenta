import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport, guardNonFiniteTotals } from "../../src/generators/report.js";
import type { FlexStatement, Trade, CashTransaction } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// Defense-in-depth boundary guard (audit [HIGH/ERR]). Wave 1 already guards every
// parser against NaN/Infinity at the source, so a non-finite total can no longer
// be produced through the public parse path. These tests therefore exercise the
// guard at the two seams that matter:
//   1. The exported `guardNonFiniteTotals` helper directly — proving that ANY
//      non-finite Decimal that reaches report assembly is coerced to 0 and
//      reported, so a casilla can never render a literal "NaN"/"Infinito".
//   2. `generateTaxReport` end-to-end on a finite report — proving the guard is a
//      strict no-op (no `report.non_finite_total` message, every casilla finite)
//      for the normal case.

function makeRateMap(rates: Record<string, string>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, rate] of Object.entries(rates)) {
    map.set(date, new Map([["USD", rate]]));
  }
  return map;
}

function makeTrade(overrides: Partial<Trade>): Trade {
  const tradeDate = overrides.tradeDate ?? "2025-03-15";
  return {
    tradeID: "1",
    accountId: "U1",
    symbol: "AAPL",
    description: "APPLE INC",
    isin: "US0378331005",
    assetCategory: "STK",
    currency: "USD",
    tradeDate,
    settlementDate: tradeDate,
    quantity: "10",
    tradePrice: "100",
    tradeMoney: "1000",
    proceeds: "1000",
    cost: "1000",
    fifoPnlRealized: "0",
    fxRateToBase: "0.92",
    buySell: "BUY",
    openCloseIndicator: overrides.buySell === "SELL" ? "C" : "O",
    exchange: "NASDAQ",
    commissionCurrency: "USD",
    commission: "0",
    taxes: "0",
    multiplier: "1",
    ...overrides,
  };
}

function makeCashTx(overrides: Partial<CashTransaction>): CashTransaction {
  const dateTime = overrides.dateTime ?? "20250601";
  return {
    transactionID: "1",
    accountId: "U1",
    symbol: "CASH",
    description: "Interest",
    isin: "",
    currency: "USD",
    dateTime,
    settleDate: dateTime,
    amount: "100",
    fxRateToBase: "0.92",
    type: "Broker Interest Received",
    ...overrides,
  };
}

function makeStatement(overrides?: Partial<FlexStatement>): FlexStatement {
  return {
    accountId: "U1",
    fromDate: "20250101",
    toDate: "20251231",
    period: "Annual",
    trades: [],
    cashTransactions: [],
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
    ...overrides,
  };
}

describe("guardNonFiniteTotals (report boundary guard)", () => {
  it("coerces a non-finite total to 0 and reports its field name", () => {
    // new Decimal(Infinity)/new Decimal(NaN) do NOT throw — they yield non-finite
    // Decimals whose .toFixed() renders "Infinity"/"NaN". The guard must catch them.
    const { sanitized, offendingFields } = guardNonFiniteTotals({
      transmissionValue: new Decimal(1000),
      acquisitionValue: new Decimal(Infinity),
      grossDividends: new Decimal(NaN),
    });

    // Both non-finite totals are zeroed → casilla renders 0, never "NaN"/"Infinity".
    expect(sanitized.acquisitionValue.isFinite()).toBe(true);
    expect(sanitized.acquisitionValue.toFixed(2)).toBe("0.00");
    expect(sanitized.grossDividends.isFinite()).toBe(true);
    expect(sanitized.grossDividends.toFixed(2)).toBe("0.00");
    // The finite total is preserved byte-identically.
    expect(sanitized.transmissionValue.toFixed(2)).toBe("1000.00");
    // Every non-finite field is reported (so the caller emits ONE loud error).
    expect(offendingFields).toEqual(["acquisitionValue", "grossDividends"]);
  });

  it("is a no-op when every total is finite (no offending fields)", () => {
    const totals = {
      transmissionValue: new Decimal(500),
      acquisitionValue: new Decimal(300),
      grossDividends: new Decimal(0),
    };
    const { sanitized, offendingFields } = guardNonFiniteTotals(totals);

    expect(offendingFields).toEqual([]);
    expect(sanitized.transmissionValue.toFixed(2)).toBe("500.00");
    expect(sanitized.acquisitionValue.toFixed(2)).toBe("300.00");
    expect(sanitized.grossDividends.toFixed(2)).toBe("0.00");
  });
});

describe("generateTaxReport · report.non_finite_total boundary guard", () => {
  it("a finite report emits NO report.non_finite_total message and all casillas are finite", () => {
    const rates = makeRateMap({ "2025-03-15": "0.9200", "2025-09-20": "0.9100" });
    const statement = makeStatement({
      trades: [
        makeTrade({ tradeID: "1", tradeDate: "2025-03-15", quantity: "10", tradePrice: "100", buySell: "BUY" }),
        makeTrade({ tradeID: "2", tradeDate: "2025-09-20", quantity: "-10", tradePrice: "120", buySell: "SELL" }),
      ],
    });

    const report = generateTaxReport(statement, rates, 2025);

    // The guard is a strict no-op for finite totals: no error surfaced.
    expect(report.messages.some((m) => m.id === "report.non_finite_total")).toBe(false);

    // Every top-level monetary total that becomes a casilla is finite.
    expect(report.capitalGains.transmissionValue.isFinite()).toBe(true);
    expect(report.capitalGains.acquisitionValue.isFinite()).toBe(true);
    expect(report.capitalGains.netGainLoss.isFinite()).toBe(true);
    expect(report.capitalGains.blockedLosses.isFinite()).toBe(true);
    expect(report.dividends.grossIncome.isFinite()).toBe(true);
    expect(report.interest.earned.isFinite()).toBe(true);
    expect(report.interest.paid.isFinite()).toBe(true);
    expect(report.generalGains.total.isFinite()).toBe(true);
    expect(report.doubleTaxation.deduction.isFinite()).toBe(true);
    expect(report.fxGains.transmissionValue.isFinite()).toBe(true);
    expect(report.fxGains.acquisitionValue.isFinite()).toBe(true);
    expect(report.fxGains.netGainLoss.isFinite()).toBe(true);
  });

  it("emits the error AND zeroes the casilla when a non-finite total reaches assembly", () => {
    // Real end-to-end injection through the PUBLIC generateTaxReport, with no edit
    // to any other file. The caller-supplied rateMap is the lowest-friction seam:
    // lookupRateInMap (engine/ecb.ts) returns `new Decimal(rate)` for ANY string in
    // the map WITHOUT a finiteness check, and report.ts's own valueIncomeEur then
    // does `amount.mul(rate)`. A rate of "Infinity" therefore makes interestEarned
    // non-finite — exactly the kind of poison the boundary guard exists to stop.
    const poisonedRates: EcbRateMap = new Map([
      ["2025-06-01", new Map([["USD", "Infinity"]])],
    ]);
    const statement = makeStatement({
      cashTransactions: [
        makeCashTx({
          transactionID: "int-1",
          currency: "USD",
          dateTime: "20250601",
          amount: "100",
          type: "Broker Interest Received",
        }),
      ],
    });

    const report = generateTaxReport(statement, poisonedRates, 2025);

    // The guard fires exactly ONE error naming the offending field.
    const errs = report.messages.filter((m) => m.id === "report.non_finite_total");
    expect(errs).toHaveLength(1);
    const err = errs[0]!;
    expect(err.severity).toBe("error");
    expect(err.message).toContain("no finito");
    expect(err.message).toContain("Infinito");
    expect(err.message).toContain("detectó");
    expect(err.hint).toContain("formato numérico");
    expect(err.context?.field).toBe("interestEarned");

    // The poisoned casilla renders 0, never "Infinity" — the whole point.
    expect(report.interest.earned.isFinite()).toBe(true);
    expect(report.interest.earned.toFixed(2)).toBe("0.00");
  });
});
