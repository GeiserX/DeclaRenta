/**
 * The loan gate's cash-row check (issue #449, PR #460 review): every cash row
 * of the currency reaches the FX events. The extractor reports the rows it
 * drops, and on top the rows of each day add up to the events of that day,
 * so two rows the engine never saw cannot cancel inside a period.
 * The end-to-end cases (real parser, generateTaxReport) are in
 * tests/integration/fx-overdraft-loan-followup.test.ts.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { loanCurrencies } from "../../src/engine/fx-loan-gate.js";
import { FxFifoEngine, type FxEvent } from "../../src/engine/fx-fifo.js";
import type { CashBalance, CashTransaction, CashTransactionType } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

const row = (id: string, date: string, amount: string, type: CashTransactionType): CashTransaction => ({
  transactionID: id,
  accountId: "U1",
  symbol: "AAA",
  description: type,
  isin: "US0000000AA1",
  currency: "USD",
  dateTime: date.replace(/-/g, ""),
  settleDate: date.replace(/-/g, ""),
  amount,
  fxRateToBase: "1",
  type,
});
const ev = (date: string, q: string, trigger: FxEvent["trigger"]): FxEvent => ({
  date,
  currency: "USD",
  quantity: new Decimal(q),
  ecbRate: new Decimal("0.9"),
  trigger,
});
const PERIOD: CashBalance = {
  accountId: "U1",
  currency: "USD",
  startingCash: "0",
  endingCash: "0",
  endingSettledCash: "0",
  fromDate: "20250101",
  toDate: "20251231",
};

// A dividend of 100 and a fee of 100: both seen, the period ends at 0.
const SEEN = [row("1", "2025-03-03", "100", "Dividends"), row("2", "2025-03-10", "-100", "Other Fees")];
const SEEN_EVENTS = [ev("2025-03-03", "100", "dividend"), ev("2025-03-10", "-100", "commission")];
// A credit of 50 and a withholding of 50 on two other days that no event shows.
const UNSEEN = [row("3", "2025-04-01", "50", "Commission Adjustments"), row("4", "2025-05-02", "-50", "Withholding Tax")];

const gate = (cash: CashTransaction[], events: FxEvent[], omittedCash: CashTransaction[] = []) =>
  loanCurrencies({
    events,
    cashBalances: [PERIOD],
    trades: [],
    cashTransactions: cash,
    omittedCash,
    corporateActions: [],
    trackAutoConvert: true,
  });

describe("the loan gate's cash rows", () => {
  it("control: every row seen passes", () => {
    expect([...gate(SEEN, SEEN_EVENTS).keys()]).toEqual(["USD"]);
  });

  it("two unseen rows on two days that cancel in the period are rejected", () => {
    expect([...gate([...SEEN, ...UNSEEN], SEEN_EVENTS).keys()]).toEqual([]);
  });

  it("a row the extractor reports as omitted is rejected", () => {
    expect([...gate(SEEN, SEEN_EVENTS, [row("5", "2025-06-02", "-15", "Withholding Tax")]).keys()]).toEqual([]);
  });

  it("a row omitted in another currency does not reject this one", () => {
    expect([...gate(SEEN, SEEN_EVENTS, [{ ...row("5", "2025-06-02", "-1", "Withholding Tax"), currency: "GBP" }]).keys()]).toEqual(["USD"]);
  });
});

describe("extractCashFxEvents reports the rows it leaves out", () => {
  const rates: EcbRateMap = new Map([
    ["2025-03-03", new Map([["USD", "0.9"]])],
    ["2025-05-02", new Map([["USD", "0.9"]])],
  ]);
  const run = (rows: CashTransaction[]) => {
    const omitted: CashTransaction[] = [];
    const events = FxFifoEngine.extractCashFxEvents(rows, rates, omitted);
    return { events, omitted: omitted.map((r) => r.transactionID) };
  };

  it("a withholding netted into its dividend that day is not left out", () => {
    const { events, omitted } = run([row("d", "2025-03-03", "100", "Dividends"), row("w", "2025-03-03", "-15", "Withholding Tax")]);
    expect(events.map((e) => e.quantity.toString())).toEqual(["85"]);
    expect(omitted).toEqual([]);
  });

  it("an orphan withholding is left out", () => {
    expect(run([row("w", "2025-05-02", "-15", "Withholding Tax")]).omitted).toEqual(["w"]);
  });

  it("the part of a withholding larger than its dividend is left out", () => {
    const { events, omitted } = run([row("d", "2025-03-03", "10", "Dividends"), row("w", "2025-03-03", "-15", "Withholding Tax")]);
    expect(events).toEqual([]);
    expect(omitted).toEqual(["w"]);
  });

  it("a row with no ECB rate in its window is left out", () => {
    expect(run([row("c", "2025-01-15", "50", "Commission Adjustments")]).omitted).toEqual(["c"]);
  });

  it("a net refund with no ECB rate is left out", () => {
    expect(run([row("r", "2025-01-15", "15", "Withholding Tax")]).omitted).toContain("r");
  });

  it("the events do not change when nothing collects the omissions", () => {
    const rows = [row("d", "2025-03-03", "10", "Dividends"), row("w", "2025-05-02", "-15", "Withholding Tax"), row("c", "2025-01-15", "5", "Other Fees")];
    expect(FxFifoEngine.extractCashFxEvents(rows, rates)).toEqual(run(rows).events);
  });
});
