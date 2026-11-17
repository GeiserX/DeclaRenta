/**
 * Issue #439: a dividend the broker reverses and credits again (+10 / −10 / +10
 * USD) must open ONE 10 USD lot in the FX engine, in every method that runs it.
 *
 * A trap: the FX path read the raw cash rows and took the absolute value of
 * every dividend row, so the reversal opened a lot too: three positive lots,
 * 20 USD that never existed, later consumed as real lots. The income path
 * (0029, 0588) was already right because it reads the rows after
 * `collapseCorrections`. The FX path now reads the same collapsed rows, and an
 * income row that stays negative (a reversal on another day, or of another
 * amount) takes currency out with its sign: it nets into the same day's income
 * of that broker and currency, and what is left leaves the pool like a fee.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { run, lifetime, economic, toStatement, TRAD, type Scenario } from "./fx-traditional-harness.js";
import { generateTaxReport } from "../../src/generators/report.js";
import type { ReportOptions } from "../../src/generators/report.js";
import { FxFifoEngine } from "../../src/engine/fx-fifo.js";
import type { CashTransaction } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

const f2 = (d: Decimal) => d.toFixed(2);
const METHODS: [string, ReportOptions][] = [
  ["default", {}],
  ["«Tradicional con divisa»", TRAD],
];

/** USD moved into the pool by `acquire` rows, and the pool left at the end. */
function poolFlow(per: ReturnType<typeof run>, year: number): { acquired: string; last: string } {
  const trace = per.get(year)!.report.fxTrace ?? [];
  const acquired = trace.filter((t) => t.kind === "acquire").reduce((s, t) => s.plus(t.quantityFcy), new Decimal(0));
  return { acquired: f2(acquired), last: f2(new Decimal(trace[trace.length - 1]?.poolBalanceFcy ?? "0")) };
}

describe.each(METHODS)("dividend reversed and credited again, %s (issue #439)", (_name, options) => {
  // Same-day +10 / −10 / +10, kept in USD, converted in June. Then 20 USD
  // bought and sold back at one rate: that pair is worth exactly 0.
  const sc: Scenario = {
    id: "DIV-REV",
    years: [2024],
    closed: true,
    ev: [
      { k: "div", d: "2024-03-01", usd: "10", r: "0.90" },
      { k: "div", d: "2024-03-01", usd: "-10", r: "0.90" },
      { k: "div", d: "2024-03-01", usd: "10", r: "0.90" },
      { k: "conv", d: "2024-06-03", usd: "10", r: "0.80" },
      { k: "fund", d: "2024-09-02", usd: "20", r: "0.70" },
      { k: "conv", d: "2024-10-01", usd: "20", r: "0.70" },
    ],
  };

  it("opens one 10 USD lot, and the later pair books 0", () => {
    const per = run(sc, { ...options, fxTrace: true });
    const flow = poolFlow(per, 2024);
    expect(flow).toEqual({ acquired: "30.00", last: "0.00" }); // 10 dividend + 20 funding
    const r = per.get(2024)!.report;
    expect(r.fxGains.disposals.map((d) => [d.disposeDate, f2(d.quantity), f2(d.gainLossEur)])).toEqual([
      ["2024-06-03", "10.00", "-1.00"],
      ["2024-10-01", "20.00", "0.00"],
    ]);
    expect(f2(r.dividends.grossIncome)).toBe("9.00");
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
  });
});

describe.each(METHODS)("the FX path reads the collapsed rows, %s (issue #439)", (_name, options) => {
  it("a fee charged and reversed on one day moves no currency and books nothing", () => {
    // Raw rows: the +5 reversal opened a lot at 0.85 and the −5 fee consumed
    // the oldest lot (0.90), booking −0.25 on a fee that was never charged.
    const sc: Scenario = {
      id: "FEE-REV",
      years: [2024],
      closed: false,
      ev: [
        { k: "fund", d: "2024-03-01", usd: "100", r: "0.90" },
        { k: "fee", d: "2024-03-05", usd: "5", r: "0.85" },
      ],
    };
    const { st, rates } = toStatement(sc);
    const fee = st.cashTransactions.find((c) => c.type === "Other Fees")!;
    st.cashTransactions.push({ ...fee, transactionID: "rev", amount: "5" });
    const r = generateTaxReport(st, rates, 2024, { ...options, fxTrace: true });
    expect(r.fxGains.disposals).toEqual([]);
    expect(r.fxTrace!.map((t) => [t.kind, t.quantityFcy])).toEqual([["acquire", "100"]]);
  });
});

describe.each(METHODS)("an income row that stays negative after collapsing, %s (issue #439)", (_name, options) => {
  it("a reversal on a later day nets into that day's new credit (10 + 0.50, not 10 + 10 + 10.50)", () => {
    const sc: Scenario = {
      id: "DIV-REV-LATER",
      years: [2024],
      closed: true,
      ev: [
        { k: "div", d: "2024-03-01", usd: "10", r: "0.90" },
        { k: "div", d: "2024-03-05", usd: "-10", r: "0.85" },
        { k: "div", d: "2024-03-05", usd: "10.50", r: "0.85" },
        { k: "conv", d: "2024-06-03", usd: "10.50", r: "0.80" },
      ],
    };
    const per = run(sc, { ...options, fxTrace: true });
    expect(poolFlow(per, 2024)).toEqual({ acquired: "10.50", last: "0.00" });
    expect(per.get(2024)!.report.messages.map((m) => m.id)).not.toContain("fx.missing_prior_lots");
  });

  it("a reversal with no new credit takes the dollars out of the pool", () => {
    const sc: Scenario = {
      id: "DIV-REV-ONLY",
      years: [2024],
      closed: true,
      ev: [
        { k: "div", d: "2024-03-01", usd: "10", r: "0.90" },
        { k: "div", d: "2024-03-05", usd: "-10", r: "0.85" },
      ],
    };
    const per = run(sc, { ...options, fxTrace: true });
    expect(poolFlow(per, 2024)).toEqual({ acquired: "10.00", last: "0.00" });
    const rows = per.get(2024)!.report.fxGains.disposals;
    expect(rows.map((d) => [d.trigger, d.disposeDate, f2(d.quantity), f2(d.gainLossEur)])).toEqual([
      ["dividend", "2024-03-05", "10.00", "-0.50"],
    ]);
    // 0029 nets the reversal too (it reads the rows with their sign).
    expect(f2(per.get(2024)!.report.dividends.grossIncome)).toBe("0.50");
    expect(f2(lifetime(per))).toBe(f2(economic(sc)));
  });
});

describe.each(METHODS)("a reversal larger than the day's other income that has withholding, %s (issue #439)", (_name, options) => {
  it("the withholding nets first, so no phantom currency stays in the pool", () => {
    // 1 Feb: AAA dividend +10. 1 Mar: AAA reversal −10, BBB dividend +5 with
    // −0.75 withheld. 4.25 USD are really held and converted in October; a
    // later fund-and-convert pair at one rate is worth exactly 0. A trap: the
    // reversal netted first, emptied BBB's +5, the withholding found nothing
    // and was dropped, and 0.75 USD that never existed stayed in the pool
    // (the later pair booked −0.15 on them).
    const sc: Scenario = {
      id: "DIV-REV-WHT",
      years: [2024],
      closed: false,
      ev: [
        { k: "fee", d: "2024-02-01", usd: "0", r: "0.90" },
        { k: "fee", d: "2024-03-01", usd: "0", r: "0.85" },
        { k: "conv", d: "2024-10-01", usd: "4.25", r: "1.00" },
        { k: "fund", d: "2024-11-01", usd: "100", r: "0.70" },
        { k: "conv", d: "2024-11-04", usd: "100", r: "0.70" },
      ],
    };
    const { st, rates } = toStatement(sc);
    const cash = (id: string, d: string, isin: string, amount: string, type: CashTransaction["type"]): CashTransaction => ({
      transactionID: id,
      accountId: "U1",
      symbol: isin.slice(-3),
      description: type,
      isin,
      currency: "USD",
      dateTime: d,
      settleDate: d,
      amount,
      fxRateToBase: "1",
      type,
    });
    st.cashTransactions.push(
      cash("a", "20240201", "US0000000AA1", "10", "Dividends"),
      cash("b", "20240301", "US0000000AA1", "-10", "Dividends"),
      cash("c", "20240301", "US0000000BB2", "5", "Dividends"),
      cash("d", "20240301", "US0000000BB2", "-0.75", "Withholding Tax"),
    );
    const r = generateTaxReport(st, rates, 2024, { ...options, fxTrace: true });
    const trace = r.fxTrace ?? [];
    expect(f2(new Decimal(trace[trace.length - 1]?.poolBalanceFcy ?? "0"))).toBe("0.00");
    expect(r.fxGains.disposals.map((d) => [d.trigger, d.disposeDate, f2(d.quantity), f2(d.gainLossEur)])).toEqual([
      ["dividend", "2024-03-01", "5.75", "-0.29"],
      ["conversion", "2024-10-01", "4.25", "0.43"],
      ["conversion", "2024-11-04", "100.00", "0.00"],
    ]);
    expect(r.messages.map((m) => m.id)).not.toContain("fx.missing_prior_lots");
  });
});

describe.each(METHODS)("a converted reversal at another broker, %s (PR #445 review)", (_name, options) => {
  it("does not cancel a genuine USD credit at another broker in the FX pool", () => {
    // Broker A credits 10 USD (kept in USD); broker B reverses a dividend it
    // had converted to EUR, same ISIN, date and amount. A's dollars are real
    // and stay in the pool; B's row never held dollars.
    const sc: Scenario = {
      id: "DIV-XBROKER",
      years: [2024],
      closed: false,
      ev: [{ k: "div", d: "2024-03-01", usd: "10", r: "0.90" }],
    };
    const { st, rates } = toStatement(sc);
    const a = st.cashTransactions[0]!;
    a.brokerSource = "ibkr";
    st.cashTransactions.push({ ...a, transactionID: "b", amount: "-10", brokerSource: "tr", brokerConvertedToBase: true });
    const r = generateTaxReport(st, rates, 2024, { ...options, fxTrace: true });
    expect(r.fxTrace!.map((t) => [t.kind, t.quantityFcy])).toEqual([["acquire", "10"]]);
  });
});

describe("income and interest rows keep their sign in the FX producer (issue #439)", () => {
  const rates: EcbRateMap = new Map([["2024-03-05", new Map([["USD", "0.85"]])]]);
  const row = (type: CashTransaction["type"], amount: string): CashTransaction => ({
    transactionID: type + amount,
    accountId: "U1",
    symbol: "AAA",
    description: "AAA",
    isin: "US0000000AA1",
    currency: "USD",
    dateTime: "20240305",
    settleDate: "20240305",
    amount,
    fxRateToBase: "1",
    type,
  });
  const ev = (rows: CashTransaction[]) =>
    FxFifoEngine.extractCashFxEvents(rows, rates).map((e) => [e.trigger, e.quantity.toString()]);

  it("an interest reversal nets into the same day's interest credit", () => {
    expect(ev([row("Broker Interest Received", "5"), row("Broker Interest Received", "-2")])).toEqual([["interest", "3"]]);
  });

  it("a reversal larger than the day's credit takes the rest out", () => {
    expect(ev([row("Dividends", "4"), row("Dividends", "-10")])).toEqual([["dividend", "-6"]]);
  });

  it("a reversal and a withholding both net into the dividend", () => {
    expect(ev([row("Dividends", "10"), row("Dividends", "-4"), row("Withholding Tax", "-1.50")])).toEqual([["dividend", "4.5"]]);
  });

  it("a reversal larger than the dividend leaves net of the withholding (withholding first)", () => {
    expect(ev([row("Dividends", "5"), row("Dividends", "-10"), row("Withholding Tax", "-0.75")])).toEqual([["dividend", "-5.75"]]);
  });

  it("a refund of interest paid brings currency in; interest paid takes it out", () => {
    expect(ev([row("Broker Interest Paid", "3")])).toEqual([["interest", "3"]]);
    expect(ev([row("Broker Interest Paid", "-3")])).toEqual([["interest", "-3"]]);
  });
});
