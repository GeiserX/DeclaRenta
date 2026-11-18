/**
 * Follow-up of the broker-loan model (issue #449, PR #456 review): the gate
 * fails closed on what it cannot prove, the ledger spends and repays in the
 * right order, and the report gives the right adjustment.
 *
 * Every scenario is an IBKR Flex XML built from the harness, parsed and
 * merged as the web does (fx-overdraft-loan-xml.ts), so the gate sees what
 * an upload gives it.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { lifetime, economic, toStatement, TRAD, MONO } from "./fx-traditional-harness.js";
import { harnessScenario, runLoan, runUpload, toUpload, toXml, type LoanEv, type LoanScenario } from "./fx-overdraft-loan-xml.js";
import { gen, WORTHLESS_COMMISSION } from "./fx-overdraft-loan-gen.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { Statement } from "../../src/types/broker.js";
import type { YearFigures } from "./fx-traditional-harness.js";

const f2 = (d: Decimal) => d.toFixed(2);
const METHODS = [
  ["«Tradicional con divisa»", TRAD],
  ["the default", {}],
] as const;
type Per = Map<number, YearFigures>;
const ids = (per: Per) => [...per.values()].flatMap((v) => v.report.messages.map((m) => m.id));
const years = (per: Per) => [...per].map(([y, v]) => [y, f2(v.stock), f2(v.fx)]);
const poolEnd = (per: Per) => [...per.values()].at(-1)!.report.fxTrace!.at(-1)!.poolBalanceFcy;
const loanRows = (per: Per) =>
  [...per.values()].flatMap((v) =>
    v.report.fxGains.disposals
      .filter((d) => d.trigger === "loan_repayment")
      .map((d) => [d.disposeDate, d.quantity.toString(), f2(d.gainLossEur), f2(d.loanDebtPartEur!)]),
  );
const withReport = (id: string, ev: LoanEv[], extra: Partial<LoanScenario> = {}): LoanScenario => ({ id, ev, opening: "0", ...extra });

// The issue's repro (see fx-overdraft-loan.test.ts): its USD ends at 0.
const REPRO: LoanEv[] = [
  { k: "fund", d: "2025-03-03", usd: "500", r: "0.90" },
  { k: "buy", d: "2025-03-04", sym: "CCC", qty: "5", px: "100", r: "0.90" },
  { k: "buy", d: "2025-04-01", sym: "BBB", qty: "10", px: "100", r: "0.95" },
  { k: "sell", d: "2025-04-01", sym: "BBB", qty: "10", px: "80", r: "0.95" },
  { k: "sell", d: "2025-04-02", sym: "CCC", qty: "5", px: "100", r: "0.94" },
  { k: "fund", d: "2025-05-01", usd: "1000", r: "0.80" },
  { k: "conv", d: "2025-06-03", usd: "1300", r: "0.85" },
];

/** Run a patched Flex XML of REPRO, with and without its CashReport. */
function patchedRuns(patch: (xml: string) => string, opts: object): { gated: Per; bare: Per } {
  const { xml, rates } = toXml(withReport("REPRO", REPRO));
  const bareXml = toXml({ id: "REPRO", ev: REPRO }).xml;
  const p = patch(xml);
  expect(p).not.toBe(xml);
  return {
    gated: runUpload(toUpload(p), rates, [2025], opts),
    bare: runUpload(toUpload(patch(bareXml)), rates, [2025], opts),
  };
}

describe("the gate fails closed on what it cannot prove", () => {
  it("control: REPRO's CashReport passes the gate", () => {
    for (const [, opts] of METHODS) expect(loanRows(runLoan(withReport("REPRO", REPRO), opts)).length).toBeGreaterThan(0);
  });

  // normalizeDate() reshapes "20250001" to "2025-00-01" without checking it,
  // and "2025-00-01" .. "2025-99-31" holds every real date of 2025.
  it("a CashReport row with dates that are not calendar dates", () => {
    const patch = (xml: string) =>
      xml.replace(/(<CashReportCurrency [^>]*?)fromDate="20250101" toDate="20251231"/, '$1fromDate="20250001" toDate="20259931"');
    for (const [, opts] of METHODS) {
      const { gated, bare } = patchedRuns(patch, opts);
      expect(loanRows(gated)).toEqual([]);
      expect(years(gated)).toEqual(years(bare));
    }
  });

  it("a CashReport row whose period ends before it starts", () => {
    const patch = (xml: string) =>
      xml.replace(/(<CashReportCurrency [^>]*?)fromDate="20250101" toDate="20251231"/, '$1fromDate="20251231" toDate="20250101"');
    for (const [, opts] of METHODS) expect(loanRows(patchedRuns(patch, opts).gated)).toEqual([]);
  });

  it("ISO dates on the CashReport row still pass", () => {
    const patch = (xml: string) =>
      xml.replace(/(<CashReportCurrency [^>]*?)fromDate="20250101" toDate="20251231"/, '$1fromDate="2025-01-01" toDate="2025-12-31"');
    for (const [, opts] of METHODS) expect(loanRows(patchedRuns(patch, opts).gated).length).toBeGreaterThan(0);
  });

  // An opening short sale brings 100 USD in and an orphan withholding (no
  // dividend that day) takes 100 out. The FX engine sees neither, they cancel
  // in the period, and the CashReport reconciles: the gate turned the loan
  // model on with movements it never saw.
  it("an opening short sale and an orphan withholding that cancel out", () => {
    const short = `<Trade tradeID="s1" accountId="U1" symbol="ZZZ" description="ZZZ INC" isin="US0000000ZZ9" assetCategory="STK" currency="USD" tradeDate="20250701" settlementDate="20250701" quantity="-1" tradePrice="100" tradeMoney="100" proceeds="100" cost="100" fifoPnlRealized="0" fxRateToBase="1" buySell="SELL" openCloseIndicator="O" exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="0" taxes="0" />`;
    const wht = `<CashTransaction transactionID="w1" accountId="U1" symbol="AAA" description="AAA US TAX" isin="US0000000AA1" currency="USD" dateTime="20250702" settleDate="20250702" amount="-100" fxRateToBase="1" type="Withholding Tax" />`;
    const patch = (xml: string) => xml.replace("<Trades>", `<Trades>${short}`).replace("<CashTransactions>", `<CashTransactions>${wht}`);
    for (const [, opts] of METHODS) {
      const { gated, bare } = patchedRuns(patch, opts);
      expect(loanRows(gated)).toEqual([]);
      expect(years(gated)).toEqual(years(bare));
    }
  });

  // The same CashReport row stamped by two brokers is evidence from two
  // brokers, not one row uploaded twice.
  it("the same CashReport row from two brokers", () => {
    const { xml, rates } = toXml(withReport("REPRO", REPRO));
    const st = toUpload(xml);
    const copy = st.holdingsBySource!.map((h) => ({ ...h, cashBalances: h.cashBalances.map((c) => ({ ...c, brokerSource: "Degiro" })) }));
    st.holdingsBySource = [...st.holdingsBySource!, ...copy];
    for (const [, opts] of METHODS) expect(loanRows(runUpload(st, rates, [2025], opts))).toEqual([]);
  });

  it("the same CashReport row twice from one broker still counts once", () => {
    const { xml, rates } = toXml(withReport("REPRO", REPRO));
    const st = toUpload(xml);
    st.holdingsBySource = [...st.holdingsBySource!, ...st.holdingsBySource!];
    for (const [, opts] of METHODS) expect(loanRows(runUpload(st, rates, [2025], opts)).length).toBeGreaterThan(0);
  });

  // No account id anywhere: every row is "", which matched every other "".
  it("rows with no account id", () => {
    const sc = withReport("REPRO", REPRO, { account: "" });
    expect(toXml(sc).xml).not.toMatch(/accountId="[^"]/);
    for (const [, opts] of METHODS) {
      const per = runLoan(sc, opts);
      expect(loanRows(per)).toEqual([]);
      expect(years(per)).toEqual(years(runLoan({ id: "REPRO", ev: REPRO, account: "" }, opts)));
    }
  });

  // REPRO's dollars end at 0, so a row with no endingCash, which the parser
  // reads as "0" for Modelo 720, reconciled.
  it("a CashReport row with no endingCash", () => {
    const patch = (xml: string) => xml.replace(/(<CashReportCurrency [^>]*?) endingCash="0"/, "$1");
    for (const [, opts] of METHODS) {
      const { gated, bare } = patchedRuns(patch, opts);
      expect(loanRows(gated)).toEqual([]);
      expect(years(gated)).toEqual(years(bare));
    }
  });

  it("the parser still gives a missing endingCash as 0 to its other readers", () => {
    const { xml } = toXml(withReport("REPRO", REPRO));
    const rows = parseIbkrFlexXml(xml.replace(/(<CashReportCurrency [^>]*?) endingCash="0"/, "$1")).cashBalances!;
    expect(rows.map((r) => r.endingCash)).toEqual(["0"]);
    // An explicit 0 still passes the gate (the control above).
    expect(parseIbkrFlexXml(xml).cashBalances!.map((r) => r.endingCash)).toEqual(["0"]);
  });
});

describe("the opening balance is the oldest currency of the account", () => {
  // 1000 USD of opening balance, then 1000 funded at 0.80. The 2025
  // conversion spends the opening balance (gain 0, no EUR origin); the 2026
  // one spends the 0.80 lot. A trap: spending the newer tracked lot first
  // booked 100 in 2025 and left the older opening balance for 2026.
  const CONV: LoanEv[] = [
    { k: "fund", d: "2025-03-03", usd: "1000", r: "0.80" },
    { k: "conv", d: "2025-04-01", usd: "1000", r: "0.90" },
    { k: "conv", d: "2026-03-02", usd: "1000", r: "0.85" },
  ];
  for (const [name, opts] of METHODS) {
    it(`${name}: a conversion spends the opening balance before a later lot`, () => {
      const per = runLoan(withReport("OPEN-CONV", CONV, { opening: "1000" }), { ...opts, fxTrace: true });
      expect(years(per)).toEqual([
        [2025, "0.00", "0.00"],
        [2026, "0.00", "50.00"],
      ]);
      expect(poolEnd(per)).toBe("0");
    });
  }

  // The same for a stock buy: it parks the opening balance (no EUR origin)
  // and leaves the 0.80 lot in the pool for the conversion.
  const BUY: LoanEv[] = [
    { k: "fund", d: "2025-03-03", usd: "1000", r: "0.80" },
    { k: "buy", d: "2025-04-01", sym: "AAA", qty: "10", px: "100", r: "0.90" },
    { k: "conv", d: "2025-05-02", usd: "1000", r: "0.85" },
    { k: "sell", d: "2026-02-02", sym: "AAA", qty: "10", px: "100", r: "0.88" },
    { k: "conv", d: "2026-03-02", usd: "1000", r: "0.86" },
  ];
  for (const [name, opts] of METHODS) {
    it(`${name}: a stock buy parks the opening balance before a later lot`, () => {
      const per = runLoan(withReport("OPEN-BUY", BUY, { opening: "1000" }), { ...opts, fxTrace: true });
      const parks = per.get(2025)!.report.fxTrace!.filter((t) => t.kind === "park");
      expect(parks.map((t) => [t.date, t.quantityFcy, t.rate])).toEqual([["2025-04-01", "1000", null]]);
      // 2025: the 0.80 lot converted at 0.85 = 50.
      expect(f2(per.get(2025)!.fx)).toBe("50.00");
      expect(poolEnd(per)).toBe("0");
    });
  }

  it("with no opening balance nothing changes: the pool lot pays the buy", () => {
    const per = runLoan(withReport("OPEN-BUY-0", BUY.slice(0, 2), { opening: "0" }), { fxTrace: true });
    const parks = per.get(2025)!.report.fxTrace!.filter((t) => t.kind === "park");
    expect(parks.map((t) => [t.quantityFcy, t.rate])).toEqual([["1000", "0.8"]]);
  });
});

describe("a same-day sale repays the loan before it gives the opening balance back", () => {
  // 500 USD of opening balance; AAA is bought for 1000 at 0.95, so 500 come
  // from the opening balance and 500 are borrowed. 4 shares are sold the same
  // day for 400: the account goes from −500 to −100. 500 funded at 0.80 on
  // 04-10 repay those 100 and leave 400 in the pool. A trap: the sale gave
  // the 400 back to the opening balance and left the whole 500 owed, so the
  // funding repaid 500.
  const SD: LoanEv[] = [
    { k: "buy", d: "2025-04-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
    { k: "sell", d: "2025-04-01", sym: "AAA", qty: "4", px: "100", r: "0.95" },
    { k: "fund", d: "2025-04-10", usd: "500", r: "0.80" },
    { k: "sell", d: "2025-06-02", sym: "AAA", qty: "6", px: "110", r: "0.90" },
    { k: "conv", d: "2025-06-10", usd: "1060", r: "0.88" },
  ];
  for (const [name, opts] of METHODS) {
    it(`${name}: the funding repays 100, not 500`, () => {
      const per = runLoan(withReport("SD-OPEN", SD, { opening: "500" }), { ...opts, fxTrace: true });
      expect(loanRows(per).map((r) => [r[0], r[1]])).toEqual([["2025-04-10", "100"]]);
      expect(poolEnd(per)).toBe("0");
      expect(ids(per)).not.toContain("fx.conservation_mismatch");
    });
  }

  it("with no loan open, a same-day sale still gives the opening balance back", () => {
    // 1000 of opening balance covers the whole buy; the 400 back are opening
    // balance again, spent by the next buy before any loan opens.
    const ev: LoanEv[] = [
      { k: "buy", d: "2025-04-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
      { k: "sell", d: "2025-04-01", sym: "AAA", qty: "4", px: "100", r: "0.95" },
      { k: "buy", d: "2025-04-02", sym: "BBB", qty: "4", px: "100", r: "0.94" },
      { k: "sell", d: "2025-06-02", sym: "AAA", qty: "6", px: "110", r: "0.90" },
      { k: "sell", d: "2025-06-03", sym: "BBB", qty: "4", px: "100", r: "0.90" },
      { k: "conv", d: "2025-06-10", usd: "1060", r: "0.88" },
    ];
    for (const [, opts] of METHODS) {
      const per = runLoan(withReport("SD-NOLOAN", ev, { opening: "1000" }), { ...opts, fxTrace: true });
      expect(loanRows(per)).toEqual([]);
      expect(poolEnd(per)).toBe("0");
    }
  });
});

describe("opening balance lost in a same-day loss sale is not a debt", () => {
  // 500 USD of opening balance. On 04-01 at 0.95 AAA is bought for 500 and
  // sold for 300 (200 of the opening balance lost), then CCC is bought for
  // 100 and sold for 400. The account ends the day with 600 USD, converted
  // at 0.80 on 06-02. Truth: stock 95; FX −45 (300 of opening balance at
  // gain 0, plus the 300 profit lot from 0.95 to 0.80); total 50, no loan.
  // A trap: the 200 lost were pushed as a #447 same-day debt, as if the
  // account were still below zero; CCC's profit paid it, 200 real dollars
  // left the pool, and the conversion opened a loan nothing repaid (80).
  const D2: LoanEv[] = [
    { k: "buy", d: "2025-04-01", sym: "AAA", qty: "5", px: "100", r: "0.95", time: "10:00:00" },
    { k: "sell", d: "2025-04-01", sym: "AAA", qty: "5", px: "60", r: "0.95", time: "10:10:00" },
    { k: "buy", d: "2025-04-01", sym: "CCC", qty: "1", px: "100", r: "0.95", time: "11:00:00" },
    { k: "sell", d: "2025-04-01", sym: "CCC", qty: "1", px: "400", r: "0.95", time: "11:10:00" },
    { k: "conv", d: "2025-06-02", usd: "600", r: "0.80" },
  ];
  // The same day with AAA sold for 0: 100 of opening balance lost, 700
  // converted. Truth: stock 190, FX −45, total 145.
  const Z1: LoanEv[] = [
    { k: "buy", d: "2025-04-01", sym: "AAA", qty: "1", px: "100", r: "0.95", time: "10:00:00" },
    { k: "sell", d: "2025-04-01", sym: "AAA", qty: "1", px: "0", r: "0.95", time: "10:10:00" },
    { k: "buy", d: "2025-04-01", sym: "CCC", qty: "1", px: "100", r: "0.95", time: "11:00:00" },
    { k: "sell", d: "2025-04-01", sym: "CCC", qty: "1", px: "400", r: "0.95", time: "11:10:00" },
    { k: "conv", d: "2025-06-02", usd: "700", r: "0.80" },
  ];
  const loanTrace = (per: Per) =>
    [...per.values()].flatMap((v) => v.report.fxTrace!.filter((t) => t.lotId === "LOAN").map((t) => [t.date, t.quantityFcy]));
  for (const [name, opts] of METHODS) {
    for (const [id, ev, total] of [["D2", D2, "50.00"], ["Z1", Z1, "145.00"]] as const) {
      it(`${name}: ${id} gives ${total}, no loan, the pool ends empty`, () => {
        const per = runLoan(withReport(id, ev, { opening: "500" }), { ...opts, fxTrace: true });
        expect(loanTrace(per)).toEqual([]);
        expect(loanRows(per)).toEqual([]);
        expect(f2(lifetime(per))).toBe(total);
        expect(poolEnd(per)).toBe("0");
        expect(ids(per)).not.toContain("fx.conservation_mismatch");
      });
    }
  }
});

describe("a loan already repaid that day is not repaid again", () => {
  // 500 USD at 0.90; AAA bought for 1000 at 0.95 (500 borrowed); half sold
  // for 510 and the other half for 550, both that day; 560 converted. The
  // first sale's 500 tracked dollars repay the loan. A trap: in «Tradicional
  // con divisa» the borrowed slice kept its loan mark, the second sale paid
  // 500 more on a loan already settled, and the pool ended at 60, not 560.
  const TWICE: LoanEv[] = [
    { k: "fund", d: "2025-03-03", usd: "500", r: "0.90" },
    { k: "buy", d: "2025-04-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
    { k: "sell", d: "2025-04-01", sym: "AAA", qty: "5", px: "102", r: "0.95" },
    { k: "sell", d: "2025-04-01", sym: "AAA", qty: "5", px: "110", r: "0.95" },
    { k: "conv", d: "2025-07-01", usd: "560", r: "0.80" },
  ];
  const sc = withReport("TWICE", TWICE);
  for (const [name, opts] of METHODS) {
    it(`${name}: EUR out − EUR in, the pool ends empty`, () => {
      expect(f2(economic(harnessScenario(sc)))).toBe("-2.00");
      const per = runLoan(sc, { ...opts, fxTrace: true });
      expect(f2(lifetime(per))).toBe("-2.00");
      expect(poolEnd(per)).toBe("0");
      expect(ids(per)).not.toContain("fx.conservation_mismatch");
    });
  }

  it("the trace: the second sale's principal goes back to the pool, nothing is lost", () => {
    for (const [, opts] of METHODS) {
      const trace = runLoan(sc, { ...opts, fxTrace: true }).get(2025)!.report.fxTrace!;
      const day = trace.filter((t) => t.date === "2025-04-01");
      // The first sale's tracked dollars repay the loan: one repayment row.
      expect(day.filter((t) => t.trigger === "loan_repayment").map((t) => t.quantityFcy)).toEqual(["500"]);
      // The second sale returns its 500 of principal and 50 of profit.
      expect(day.filter((t) => t.kind === "discard")).toEqual([]);
      expect(day.filter((t) => t.kind === "unpark").map((t) => t.quantityFcy)).toEqual(["500", "500"]);
      expect(day.filter((t) => t.kind === "profit").map((t) => t.quantityFcy)).toEqual(["10", "50"]);
    }
  });

  it("a partial repayment: only the unpaid part is repaid directly", () => {
    // 300 at 0.90: the first sale's 300 tracked dollars repay 300 of the 700
    // borrowed; the second sale repays the 400 still owed directly and
    // re-adds the rest.
    const ev: LoanEv[] = [
      { k: "fund", d: "2025-03-03", usd: "300", r: "0.90" },
      { k: "buy", d: "2025-04-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
      { k: "sell", d: "2025-04-01", sym: "AAA", qty: "3", px: "100", r: "0.95" },
      { k: "sell", d: "2025-04-01", sym: "AAA", qty: "7", px: "110", r: "0.95" },
      { k: "conv", d: "2025-07-01", usd: "370", r: "0.80" },
    ];
    const p = withReport("PART", ev);
    expect(f2(economic(harnessScenario(p)))).toBe("26.00");
    for (const [, opts] of METHODS) {
      const per = runLoan(p, { ...opts, fxTrace: true });
      expect(f2(lifetime(per))).toBe(f2(economic(harnessScenario(p))));
      expect(poolEnd(per)).toBe("0");
    }
  });
});

describe("the default sees the cash of a sale with proceeds of 0 or less", () => {
  // 1000 USD funded; AAA bought for 100; sold for 0 with a 5 USD commission
  // (proceeds −5); 895 converted. The gate counts the −5 (it reads the sales
  // as «Tradicional con divisa» does), and the CashReport ends at 0. A trap:
  // the default's own producer drops the sale, so its engine never took the
  // 5 USD out and left them in the pool.
  const ev: LoanEv[] = [
    { k: "fund", d: "2025-03-03", usd: "1000", r: "0.90" },
    { k: "buy", d: "2025-03-04", sym: "AAA", qty: "1", px: "100", r: "0.90" },
    { k: "sell", d: "2025-05-02", sym: "AAA", qty: "1", px: "0", r: "0.85" },
    { k: "conv", d: "2025-06-02", usd: "895", r: "0.85" },
  ];
  const commission = (xml: string) => xml.replace(/(<Trade [^>]*symbol="AAA"[^>]*buySell="SELL"[^>]*?)ibCommission="0"/, '$1ibCommission="-5"');
  const build = (gated: boolean) => {
    const { xml, rates } = toXml(gated ? withReport("ZERO", ev, { endingDelta: "-5" }) : { id: "ZERO", ev });
    const p = commission(xml);
    expect(p).not.toBe(xml);
    return { st: toUpload(p), rates };
  };

  it("the default: the commission leaves the pool, which ends empty", () => {
    const { st, rates } = build(true);
    const per = runUpload(st, rates, [2025], { fxTrace: true });
    expect(poolEnd(per)).toBe("0");
    // The 5 USD commission is a fee paid in dollars: a disposal of a 0.90 lot at 0.85.
    const rows = per.get(2025)!.report.fxGains.disposals.filter((d) => d.trigger === "commission");
    expect(rows.map((d) => [d.quantity.toString(), f2(d.gainLossEur)])).toEqual([["5", "-0.25"]]);
    // The lost principal books nothing in the default (its loss-sale rule).
    expect(per.get(2025)!.report.fxGains.disposals.filter((d) => d.trigger === "stock_sale")).toEqual([]);
  });

  it("«Tradicional con divisa» is unchanged, and so is the default without a CashReport", () => {
    const { st, rates } = build(true);
    expect(poolEnd(runUpload(st, rates, [2025], { ...TRAD, fxTrace: true }))).toBe("0");
    const bare = build(false);
    // Outside the gate the default keeps dropping the sale: 5 USD stay in the pool, as before.
    expect(poolEnd(runUpload(bare.st, bare.rates, [2025], { fxTrace: true }))).toBe("5");
  });
});

describe("the untracked-currency note: one per currency and kind", () => {
  // IBKR's REPRO leaves 200 USD untracked; a Degiro round trip in January
  // leaves 300 USD untracked. A trap: summed per currency, the IBKR note
  // told the user that an IBKR Cash Report could explain all 500.
  it("the IBKR hint covers only the IBKR amount", () => {
    const { xml, rates } = toXml({ id: "REPRO", ev: REPRO });
    const other = toStatement(
      harnessScenario({
        id: "DG",
        ev: [
          { k: "buy", d: "2025-01-10", sym: "AAA", qty: "3", px: "100", r: "0.92" },
          { k: "sell", d: "2025-01-20", sym: "AAA", qty: "3", px: "100", r: "0.93" },
          { k: "conv", d: "2025-01-24", usd: "300", r: "0.93" },
        ],
      }),
    );
    for (const t of other.st.trades) t.tradeID = `dg-${t.tradeID}`;
    for (const [d, m] of other.rates) rates.set(d, m);
    let st: Statement = createEmptyStatement();
    st = mergeStatement(st, parseIbkrFlexXml(xml), "Interactive Brokers");
    st = mergeStatement(st, other.st, "Degiro");
    st = finalizeMergedStatement(st);
    const msgs = runUpload(st, rates, [2025], TRAD).get(2025)!.report.messages;
    expect(msgs.filter((m) => m.id === "report.fx_traditional_uncovered_ibkr").map((m) => m.context)).toEqual([{ qty: "200.00", ccy: "USD" }]);
    expect(msgs.filter((m) => m.id === "report.fx_traditional_uncovered").map((m) => m.context)).toEqual([{ qty: "300.00", ccy: "USD" }]);
  });
});

describe("the loan note's adjustment matches where the report booked the debt's change", () => {
  // OWN: a loan of 1000 USD opened at 0.95 and repaid at 0.90 by the sale of
  // the shares it bought. The default's stock line (sale-rate cost) holds the
  // debt's 50 € and 1633/1637 hold none. A trap: the hint still told the
  // user to lower box 1633 by 50, a box with nothing of it (here 1633 is 0).
  const OWN: LoanEv[] = [
    { k: "buy", d: "2025-03-03", sym: "AAA", qty: "10", px: "100", r: "0.95" },
    { k: "sell", d: "2025-06-02", sym: "AAA", qty: "10", px: "110", r: "0.90" },
    { k: "conv", d: "2025-06-10", usd: "100", r: "0.88" },
  ];
  const msgs = (ev: LoanEv[], opts: object) => runLoan(withReport("OWN", ev), opts).get(2025)!.report.messages;

  it("«Tradicional con divisa» books it in 1633/1637: lower 1633 by it", () => {
    const m = msgs(OWN, TRAD).find((x) => x.id === "report.fx_loan_repayment");
    expect(m?.context).toEqual({ ccy: "USD", amount: "50.00", gain: "50.00", loss: "0.00" });
    expect(m?.hint).toContain("baja el valor de transmisión (1633) en la ganancia");
  });

  it("the default holds it in the stock line: no box instruction, reconcile by hand", () => {
    const all = msgs(OWN, {});
    expect(all.map((x) => x.id)).not.toContain("report.fx_loan_repayment");
    const m = all.find((x) => x.id === "report.fx_loan_repayment_manual");
    expect(m?.context).toEqual({ ccy: "USD", amount: "0.00", gain: "50.00", loss: "0.00", boxGain: "0.00", boxLoss: "0.00" });
    expect(m?.hint).not.toContain("baja el valor de transmisión (1633) en la ganancia");
    expect(m?.hint).toContain("a mano");
  });

  it("part in 1633/1637 and part in the stock line: the hint gives the part it can place", () => {
    // 300 funded at 0.80 repay 300 (a row in 1633/1637: debt part 45); the
    // shares' own 700 at the loan's rate repay the rest (debt part 35, in
    // the default's stock line).
    const ev: LoanEv[] = [
      { k: "buy", d: "2025-03-03", sym: "AAA", qty: "10", px: "100", r: "0.95" },
      { k: "fund", d: "2025-04-01", usd: "300", r: "0.80" },
      { k: "sell", d: "2025-06-02", sym: "AAA", qty: "10", px: "110", r: "0.90" },
      { k: "conv", d: "2025-06-10", usd: "400", r: "0.88" },
    ];
    const m = msgs(ev, {}).find((x) => x.id === "report.fx_loan_repayment_manual");
    expect(m?.context).toEqual({ ccy: "USD", amount: "45.00", gain: "80.00", loss: "0.00", boxGain: "45.00", boxLoss: "0.00" });
    const t = msgs(ev, TRAD).find((x) => x.id === "report.fx_loan_repayment");
    expect(t?.context?.gain).toBe("80.00");
  });

  // XYZ, bought with funded dollars, repays a loan (AAA, 1000 USD at 0.95)
  // with its own sale on 06-02 at 0.90. Only the funding differs: at 0.95 on
  // the loan's day (SAME) or at 0.94 a month before (DIFF). In SAME the
  // paying dollars cost the loan's rate by coincidence, so the row in
  // 1633/1637 nets to 0 (a `discard`), but both parts are still there: the
  // debt's +50 and XYZ's dollars' −50. Lowering 1633 by 50 gives the Supreme
  // Court split in both (savings −120 / general +50 in SAME, −110 / +50 in
  // DIFF). A trap, review: a zero row counted as outside the boxes, so SAME
  // got the `_manual` note and its hint blamed the shares bought with the
  // loan, which repaid nothing.
  const xyz = (fundRate: string, fundDay: string): LoanEv[] => [
    { k: "fund", d: fundDay, usd: "1000", r: fundRate },
    { k: "buy", d: fundDay, sym: "XYZ", qty: "10", px: "100", r: fundRate },
    { k: "buy", d: "2025-03-03", sym: "AAA", qty: "10", px: "100", r: "0.95" },
    { k: "sell", d: "2025-06-02", sym: "XYZ", qty: "10", px: "100", r: "0.90" },
    { k: "sell", d: "2025-07-01", sym: "AAA", qty: "10", px: "100", r: "0.90" },
    { k: "conv", d: "2025-07-10", usd: "1000", r: "0.88" },
  ];
  it("the default: paying dollars that cost the loan's rate by coincidence are in 1633/1637", () => {
    const r = runLoan(withReport("SAME", xyz("0.95", "2025-03-03")), {}).get(2025)!.report;
    expect(r.capitalGains.disposals.map((d) => [d.symbol, f2(d.gainLossEur)])).toEqual([["XYZ", "0.00"], ["AAA", "0.00"]]);
    expect(r.fxGains.disposals.map((d) => [d.trigger, f2(d.gainLossEur)])).toEqual([["conversion", "-70.00"]]);
    const ids = r.messages.map((x) => x.id);
    expect(ids).not.toContain("report.fx_loan_repayment_manual");
    const m = r.messages.find((x) => x.id === "report.fx_loan_repayment");
    expect(m?.context).toEqual({ ccy: "USD", amount: "0.00", gain: "50.00", loss: "0.00" });
    expect(m?.hint).toContain("baja el valor de transmisión (1633) en la ganancia");
  });
  it("the default: the same loan with funding at another rate gets the same note", () => {
    const r = runLoan(withReport("DIFF", xyz("0.94", "2025-02-03")), {}).get(2025)!.report;
    const m = r.messages.find((x) => x.id.startsWith("report.fx_loan_repayment"));
    expect(m?.id).toBe("report.fx_loan_repayment");
    expect(m?.context).toEqual({ ccy: "USD", amount: "10.00", gain: "50.00", loss: "0.00" });
  });
  it("«Tradicional con divisa»: a shifted cost equal to the loan's rate is in 1633/1637 too", () => {
    // XYZ's dollars cost 1.00 and bought it at 0.95; sold at 0.90 they come
    // back at 1.00 + 0.90 − 0.95 = 0.95, the loan's rate: a zero row.
    const ev: LoanEv[] = [
      { k: "fund", d: "2025-02-03", usd: "1000", r: "1.00" },
      { k: "buy", d: "2025-02-10", sym: "XYZ", qty: "10", px: "100", r: "0.95" },
      ...xyz("0.95", "2025-03-03").slice(2),
    ];
    const r = runLoan(withReport("TRAD-SAME", ev), { ...TRAD, fxTrace: true }).get(2025)!.report;
    expect(r.fxTrace!.filter((t) => t.trigger === "loan_repayment").map((t) => [t.kind, t.quantityFcy])).toEqual([["discard", "1000"]]);
    const m = r.messages.find((x) => x.id.startsWith("report.fx_loan_repayment"));
    expect(m?.id).toBe("report.fx_loan_repayment");
    expect(m?.context).toEqual({ ccy: "USD", amount: "0.00", gain: "50.00", loss: "0.00" });
  });
});

describe("seeded cycles with opening cash, same-day repayments and sales of 0 or less", () => {
  const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1);

  // The issue's generator with same-day sales, twice on some days: the first
  // sale's tracked dollars can repay the loan, and the second then finds it
  // settled. Every share sold, every dollar converted, no loss sale.
  const twice = SEEDS.map((seed) => gen(seed, true, true, { twice: true }));
  it("the generator really sells twice on an overdrawing day", () => {
    const n = twice.filter((hs) => {
      const days = hs.ev.filter((e) => e.k === "sell").map((e) => `${e.d}|${"sym" in e ? e.sym : ""}`);
      return days.length !== new Set(days).size;
    }).length;
    expect(n).toBeGreaterThan(30);
  });
  for (const [name, opts] of METHODS) {
    it(`${name}: same-day sales, twice a day, match EUR out − EUR in with a CashReport, the pool ends empty`, () => {
      const miss = twice.filter((hs) => {
        const per = runLoan(withReport(hs.id, hs.ev), { ...opts, fxTrace: true });
        return f2(lifetime(per)) !== f2(economic(hs)) || poolEnd(per) !== "0";
      });
      expect(miss.map((hs) => hs.id)).toEqual([]);
    });
  }

  // An opening balance of 250 USD with no EUR origin, spent before every
  // later lot: its dollars are valued where they are spent, so the economic
  // total does not apply; the pool ends empty and the ledger balances.
  for (const [name, opts] of METHODS) {
    it(`${name}: an opening balance: the pool ends empty, the ledger balances`, () => {
      const miss = twice.filter((hs) => {
        const last = hs.ev.at(-1)!;
        const ev: LoanEv[] =
          last.k === "conv"
            ? [...hs.ev.slice(0, -1), { ...last, usd: new Decimal(last.usd).plus(250).toString() }]
            : [...hs.ev, { k: "conv", d: "2027-12-01", usd: "250", r: "0.90" }];
        const per = runLoan(withReport(hs.id, ev, { opening: "250" }), { ...opts, fxTrace: true });
        return poolEnd(per) !== "0" || ids(per).includes("fx.conservation_mismatch");
      });
      expect(miss.map((hs) => hs.id)).toEqual([]);
    });
  }

  // The same cycles with loss sales, down to 0, some on the day a buy spent
  // the opening balance, then a second sale that day. 1500 USD of opening
  // balance, so the first buys usually open no loan and that second sale's
  // dollars reach the lost opening balance. All the account holds is
  // converted at the end, so a loan on that day is a phantom. A trap: the
  // opening balance a loss sale did not return became a same-day debt, the
  // second sale's dollars paid it, and the conversion opened a loan nothing
  // repaid (10 of these 150 seeds).
  const loss = SEEDS.map((seed) => gen(seed, true, true, { twice: true, loss: true }));
  const OPENING = "1500";
  const withOpening = (hs: (typeof loss)[number]): LoanEv[] => {
    const last = hs.ev.at(-1)!;
    return last.k === "conv"
      ? [...hs.ev.slice(0, -1), { ...last, usd: new Decimal(last.usd).plus(OPENING).toString() }]
      : [...hs.ev, { k: "conv", d: "2027-12-01", usd: OPENING, r: "0.90" }];
  };
  it("the generator really sells at a loss on a day that spends the opening balance", () => {
    const n = loss.filter((hs) => {
      const per = runLoan(withReport(hs.id, withOpening(hs), { opening: OPENING }), { ...TRAD, fxTrace: true });
      return [...per.values()].some((v) => v.report.fxTrace!.some((t) => t.note?.startsWith("principal perdido en la venta, sin origen")));
    }).length;
    expect(n).toBeGreaterThan(50);
  });
  it("«Tradicional con divisa»: loss sales without an opening balance keep EUR out − EUR in", () => {
    const miss = loss.filter((hs) => {
      const per = runLoan(withReport(hs.id, hs.ev), { ...TRAD, fxTrace: true });
      return f2(lifetime(per)) !== f2(economic(hs)) || poolEnd(per) !== "0";
    });
    expect(miss.map((hs) => hs.id)).toEqual([]);
  });
  for (const [name, opts] of METHODS) {
    it(`${name}: loss sales with an opening balance: no loan at the final conversion, the pool ends empty`, () => {
      const miss = loss.filter((hs) => {
        const ev = withOpening(hs);
        const end = ev.at(-1)!.d;
        const per = runLoan(withReport(hs.id, ev, { opening: OPENING }), { ...opts, fxTrace: true });
        const phantom = [...per.values()].some((v) => v.report.fxTrace!.some((t) => t.date === end && t.lotId === "LOAN"));
        return phantom || poolEnd(per) !== "0" || ids(per).includes("fx.conservation_mismatch");
      });
      expect(miss.map((hs) => hs.id)).toEqual([]);
    });
  }

  // Each cycle ends with a worthless sale whose 5 USD commission exceeds its
  // proceeds. «Tradicional con divisa» books the lost dollars and keeps EUR
  // out − EUR in; the default books no FX on them (its loss-sale rule), but
  // its pool must end empty too.
  const worthless = SEEDS.map((seed) => {
    const hs = gen(seed, true, true, { twice: true, worthless: true });
    const { xml, rates } = toXml(withReport(hs.id, hs.ev, { endingDelta: String(-WORTHLESS_COMMISSION) }));
    const patched = xml.replace(/(<Trade [^>]*tradePrice="0"[^>]*buySell="SELL"[^>]*?)ibCommission="0"/, `$1ibCommission="-${WORTHLESS_COMMISSION}"`);
    expect(patched).not.toBe(xml);
    return { hs, st: toUpload(patched), rates };
  });
  it("«Tradicional con divisa»: a worthless sale with its commission keeps EUR out − EUR in", () => {
    const miss = worthless.filter(({ hs, st, rates }) => {
      const per = runUpload(st, rates, hs.years, { ...TRAD, fxTrace: true });
      return f2(lifetime(per)) !== f2(economic(hs)) || poolEnd(per) !== "0";
    });
    expect(miss.map((w) => w.hs.id)).toEqual([]);
  });
  it("the default: a worthless sale with its commission leaves the pool empty", () => {
    const miss = worthless.filter(({ hs, st, rates }) => {
      const per = runUpload(st, rates, hs.years, { fxTrace: true });
      return poolEnd(per) !== "0" || ids(per).includes("fx.conservation_mismatch");
    });
    expect(miss.map((w) => w.hs.id)).toEqual([]);
  });

  it("monodivisa does not change with a CashReport", () => {
    for (const hs of twice.slice(0, 20)) {
      expect(years(runLoan(withReport(hs.id, hs.ev), MONO))).toEqual(years(runLoan({ id: hs.id, ev: hs.ev }, MONO)));
    }
  });
});

describe("returned loan principal is the loan's own only for that loan (PR #460 review)", () => {
  // AAA is bought on a loan of 1000 USD at 0.95 (L1); a funding at 0.93 a
  // fortnight later repays L1 in full. BBB is then bought on a second loan of
  // 1000 USD at 0.95 (L2). AAA's sale at 0.90 returns L1's principal at 0.95
  // and it repays L2: a row of gain 0 in 1633/1637 that holds L2's debt
  // change (+50) and the paying dollars' change (−50). A trap: the lot was
  // tagged as loan principal, so the report took L2's 50 € out of the boxes
  // and sent the user to reconcile by hand, as if BBB's own sale had repaid
  // L2. Only L1 is AAA's own loan.
  const OTHER: LoanEv[] = [
    { k: "buy", d: "2025-03-03", sym: "AAA", qty: "10", px: "100", r: "0.95" },
    { k: "fund", d: "2025-03-20", usd: "1000", r: "0.93" },
    { k: "buy", d: "2025-04-01", sym: "BBB", qty: "10", px: "100", r: "0.95" },
    { k: "sell", d: "2025-06-02", sym: "AAA", qty: "10", px: "100", r: "0.90" },
    { k: "sell", d: "2025-07-01", sym: "BBB", qty: "10", px: "100", r: "0.90" },
    { k: "conv", d: "2025-07-10", usd: "1000", r: "0.88" },
  ];

  it("the default: another loan's principal pays like any lot, its debt change is in 1633/1637", () => {
    const per = runLoan(withReport("OTHER", OTHER), {});
    const r = per.get(2025)!.report;
    expect(f2(lifetime(per))).toBe(f2(economic(harnessScenario(withReport("OTHER", OTHER)))));
    expect(loanRows(per)).toEqual([["2025-03-20", "1000", "20.00", "20.00"]]);
    expect(r.messages.map((x) => x.id)).not.toContain("report.fx_loan_repayment_manual");
    const m = r.messages.find((x) => x.id === "report.fx_loan_repayment");
    expect(m?.context).toEqual({ ccy: "USD", amount: "20.00", gain: "70.00", loss: "0.00" });
  });

  it("«Tradicional con divisa» gives the same note", () => {
    const r = runLoan(withReport("OTHER", OTHER), TRAD).get(2025)!.report;
    expect(r.messages.find((x) => x.id.startsWith("report.fx_loan_repayment"))?.id).toBe("report.fx_loan_repayment");
  });
});

describe("the gate reconciles the cash rows day by day (PR #460 review)", () => {
  const credit = (d: string) =>
    `<CashTransaction transactionID="c1" accountId="U1" description="COMMISSION ADJUSTMENT" currency="USD" dateTime="${d}" settleDate="${d}" amount="100" fxRateToBase="1" type="Commission Adjustments" />`;
  const wht = (d: string) =>
    `<CashTransaction transactionID="w1" accountId="U1" symbol="AAA" description="AAA US TAX" isin="US0000000AA1" currency="USD" dateTime="${d}" settleDate="${d}" amount="-100" fxRateToBase="1" type="Withholding Tax" />`;

  // A credit of 100 USD on a day with no ECB rate in its lookup window, and an
  // orphan withholding of 100 on another day. The FX engine drops both, and
  // the period's raw rows and its cash events both add up to 0: the gate
  // turned the loan model on although the credit's dollars were never seen.
  it("a credit with no ECB rate and an orphan withholding on another day", () => {
    const patch = (xml: string) => xml.replace("<CashTransactions>", `<CashTransactions>${credit("20250115")}${wht("20250702")}`);
    for (const [, opts] of METHODS) {
      const { gated, bare } = patchedRuns(patch, opts);
      expect(loanRows(gated)).toEqual([]);
      expect(years(gated)).toEqual(years(bare));
    }
  });

  // The same two rows on one day cancel inside the day too: the extractor
  // reports every row it leaves out, and one is enough to reject.
  it("the same two rows on one day", () => {
    const patch = (xml: string) => xml.replace("<CashTransactions>", `<CashTransactions>${credit("20250115")}${wht("20250115")}`);
    for (const [, opts] of METHODS) {
      const { gated, bare } = patchedRuns(patch, opts);
      expect(loanRows(gated)).toEqual([]);
      expect(years(gated)).toEqual(years(bare));
    }
  });

  it("a row with no ECB rate alone, the CashReport counting it", () => {
    const sc = withReport("REPRO", REPRO, { endingDelta: "100" });
    const { xml, rates } = toXml(sc);
    const p = xml.replace("<CashTransactions>", `<CashTransactions>${credit("20250115")}`);
    for (const [, opts] of METHODS) expect(loanRows(runUpload(toUpload(p), rates, [2025], opts))).toEqual([]);
  });

  // Control: a dividend and its withholding on the same day net into one
  // cash event, so the gate still passes.
  it("control: a withholding netted into its dividend that day still passes", () => {
    const sc = withReport("REPRO-DIV", [...REPRO, { k: "div", d: "2025-05-01", usd: "100", r: "0.80" }], { endingDelta: "-15" });
    const { xml, rates } = toXml(sc);
    const w = wht("20250501").replace('amount="-100"', 'amount="-15"');
    const p = xml.replace("<CashTransactions>", `<CashTransactions>${w}`);
    expect(p).not.toBe(xml);
    for (const [, opts] of METHODS) expect(loanRows(runUpload(toUpload(p), rates, [2025], opts)).length).toBeGreaterThan(0);
  });
});
