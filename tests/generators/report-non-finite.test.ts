import { describe, it, expect, vi, afterEach } from "vitest";
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

// Since #470 no cash row with a value in euros that is no number reaches a
// total (report.cash_amount_too_large drops it first), so the end-to-end test
// of the guard below poisons the dividend engine's output instead: a switch,
// off by default, makes calculateDividends return a gross amount of Infinity.
const poison = vi.hoisted(() => ({ dividends: false }));
vi.mock("../../src/engine/dividends.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/engine/dividends.js")>();
  return {
    ...original,
    calculateDividends: (...args: Parameters<typeof original.calculateDividends>) => {
      const entries = original.calculateDividends(...args);
      return poison.dividends ? entries.map((e) => ({ ...e, grossAmountEur: new Decimal(Infinity) })) : entries;
    },
  };
});

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

  it("a cash row whose value in euros is no number is left out alone and named; the other rows still count (#470)", () => {
    // The same poisoned rate as below, next to a sound row on another day.
    // Since #470 a cash row whose value fails the counted bound is dropped
    // before any total (report.cash_amount_too_large), so the box keeps the
    // sound row's 50 dollars × 0.9 and only the poisoned row is named. Before,
    // the guard zeroed the whole box and named only the field.
    const rates: EcbRateMap = new Map([
      ["2025-06-01", new Map([["USD", "Infinity"]])],
      ["2025-07-01", new Map([["USD", "0.9"]])],
    ]);
    const statement = makeStatement({
      cashTransactions: [
        makeCashTx({ transactionID: "int-1", currency: "USD", dateTime: "20250601", amount: "100", type: "Broker Interest Received" }),
        makeCashTx({ transactionID: "int-2", currency: "USD", dateTime: "20250701", amount: "50", type: "Broker Interest Received" }),
      ],
    });
    const report = generateTaxReport(statement, rates, 2025);
    expect(report.interest.earned.toFixed(2)).toBe("45.00");
    expect(report.messages.filter((m) => m.id === "report.non_finite_total")).toEqual([]);
    const named = report.messages.filter((m) => m.id === "report.cash_amount_too_large");
    expect(named).toHaveLength(1);
    expect(named[0]!.severity).toBe("error");
    expect(named[0]!.context).toMatchObject({ count: "1" });
    expect(named[0]!.context?.rows).toContain("(01/06/2025)");
  });

  afterEach(() => {
    poison.dividends = false;
  });

  it("emits the error AND zeroes the casilla when a non-finite total reaches assembly", () => {
    // The dividend engine's output is poisoned (see the mock at the top): a
    // gross amount of Infinity is exactly the kind of value the boundary guard
    // exists to stop, whatever produced it.
    poison.dividends = true;
    const rates: EcbRateMap = new Map([["2025-06-01", new Map([["USD", "0.9"]])]]);
    const statement = makeStatement({
      cashTransactions: [
        makeCashTx({
          transactionID: "div-1",
          symbol: "AAPL",
          isin: "US0378331005",
          description: "AAPL(US0378331005) Cash Dividend USD 0.25 per Share",
          currency: "USD",
          dateTime: "20250601",
          amount: "100",
          type: "Dividends",
        }),
      ],
    });

    const report = generateTaxReport(statement, rates, 2025);

    // The guard fires exactly ONE error naming the offending field.
    const errs = report.messages.filter((m) => m.id === "report.non_finite_total");
    expect(errs).toHaveLength(1);
    const err = errs[0]!;
    expect(err.severity).toBe("error");
    expect(err.message).toContain("no finito");
    expect(err.message).toContain("Infinito");
    expect(err.message).toContain("detectó");
    expect(err.hint).toContain("formato numérico");
    expect(err.context?.field).toBe("grossDividends");

    // The poisoned casilla renders 0, never "Infinity" — the whole point.
    expect(report.dividends.grossIncome.isFinite()).toBe(true);
    expect(report.dividends.grossIncome.toFixed(2)).toBe("0.00");
  });
});
