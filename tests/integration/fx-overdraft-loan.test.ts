/**
 * A balance below zero as a loan from the broker (issue #449), in both
 * methods that run the FX engine.
 *
 * A buy that spends more dollars than the account holds leaves it below
 * zero: IBKR lends those dollars until a later inflow repays them. Before
 * the fix the engine took the missing dollars as "untracked" (an opening
 * balance it cannot see), at the buy's rate, and a later sale re-added them
 * to the pool as if they existed: dollars that were owed, not held. A
 * conversion then spent them, and the total missed EUR out − EUR in
 * (REPRO: −175 on an economic −145, the pool ending with 200 dollars the
 * account never had; HELD and YEAR: 43 in «Tradicional con divisa» on an
 * economic 143).
 *
 * The loan model runs only when an IBKR CashReport proves the account's
 * dollars (fx-loan-gate.ts). Each scenario here is an IBKR Flex XML file
 * built from the harness, with a CashReport that chains each year's
 * `startingCash` to its `endingCash`, parsed and merged as the web does.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import Decimal from "decimal.js";
import { lifetime, economic, run, TRAD, MONO, type Ev } from "./fx-traditional-harness.js";
import { harnessScenario, runLoan, runUpload, toUpload, toXml, type LoanEv, type LoanScenario } from "./fx-overdraft-loan-xml.js";
import { gen } from "./fx-overdraft-loan-gen.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { localizeMessage, localizeHint, setLocale } from "../../src/i18n/index.js";
import es from "../../src/i18n/locales/es.js";
import en from "../../src/i18n/locales/en.js";
import ca from "../../src/i18n/locales/ca.js";
import eu from "../../src/i18n/locales/eu.js";
import gl from "../../src/i18n/locales/gl.js";
import { isMethodNote } from "../../src/web/casilla-detail.js";
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

// The issue's repro: 500 USD at 0.90 buy CCC; on 04-01 BBB is bought for
// 1000 with no dollars left (0.95) and sold for 800 the same day, so the
// account ends that day at −200; CCC's sale on 04-02 (0.94) brings 500 back;
// 1000 USD are funded at 0.80 and the 1300 are converted at 0.85.
const REPRO: LoanEv[] = [
  { k: "fund", d: "2025-03-03", usd: "500", r: "0.90" },
  { k: "buy", d: "2025-03-04", sym: "CCC", qty: "5", px: "100", r: "0.90" },
  { k: "buy", d: "2025-04-01", sym: "BBB", qty: "10", px: "100", r: "0.95" },
  { k: "sell", d: "2025-04-01", sym: "BBB", qty: "10", px: "80", r: "0.95" },
  { k: "sell", d: "2025-04-02", sym: "CCC", qty: "5", px: "100", r: "0.94" },
  { k: "fund", d: "2025-05-01", usd: "1000", r: "0.80" },
  { k: "conv", d: "2025-06-03", usd: "1300", r: "0.85" },
];
// REPRO with the rates mirrored: the dollar falls while the debt is open.
const MIRROR: LoanEv[] = [
  { k: "fund", d: "2025-03-03", usd: "500", r: "0.90" },
  { k: "buy", d: "2025-03-04", sym: "CCC", qty: "5", px: "100", r: "0.90" },
  { k: "buy", d: "2025-04-01", sym: "BBB", qty: "10", px: "100", r: "0.85" },
  { k: "sell", d: "2025-04-01", sym: "BBB", qty: "10", px: "80", r: "0.85" },
  { k: "sell", d: "2025-04-02", sym: "CCC", qty: "5", px: "100", r: "0.86" },
  { k: "fund", d: "2025-05-01", usd: "1000", r: "0.95" },
  { k: "conv", d: "2025-06-03", usd: "1300", r: "0.92" },
];
// AAA is bought for 1000 with 0 USD (0.95) and held; CCC's sale (600 at
// 0.94) and 400 funded at 0.80 repay the loan; AAA is sold later.
const HELD: LoanEv[] = [
  { k: "fund", d: "2025-03-03", usd: "500", r: "0.90" },
  { k: "buy", d: "2025-03-04", sym: "CCC", qty: "5", px: "100", r: "0.90" },
  { k: "buy", d: "2025-04-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
  { k: "sell", d: "2025-04-02", sym: "CCC", qty: "5", px: "120", r: "0.94" },
  { k: "fund", d: "2025-04-20", usd: "400", r: "0.80" },
  { k: "sell", d: "2025-06-02", sym: "AAA", qty: "10", px: "110", r: "0.85" },
  { k: "conv", d: "2025-06-03", usd: "1100", r: "0.83" },
];
// HELD across a year end: the loan opens in December and is repaid in January.
const YEAR: LoanEv[] = [
  { k: "fund", d: "2024-12-02", usd: "500", r: "0.90" },
  { k: "buy", d: "2024-12-03", sym: "CCC", qty: "5", px: "100", r: "0.90" },
  { k: "buy", d: "2024-12-30", sym: "AAA", qty: "10", px: "100", r: "0.95" },
  { k: "sell", d: "2025-01-03", sym: "CCC", qty: "5", px: "120", r: "0.93" },
  { k: "fund", d: "2025-01-20", usd: "400", r: "0.80" },
  { k: "sell", d: "2025-06-02", sym: "AAA", qty: "10", px: "110", r: "0.85" },
  { k: "conv", d: "2025-06-03", usd: "1100", r: "0.83" },
];
// A buy with no dollars funded 4 days later across the year end: the late
// cover (7 days) runs before any loan, so nothing changes.
const LATE_YEAR: LoanEv[] = [
  { k: "buy", d: "2024-12-30", sym: "AAA", qty: "10", px: "100", r: "0.95" },
  { k: "fund", d: "2025-01-03", usd: "1000", r: "0.90" },
  { k: "sell", d: "2025-02-03", sym: "AAA", qty: "10", px: "110", r: "0.92" },
  { k: "conv", d: "2025-03-03", usd: "550", r: "0.88" },
  { k: "conv", d: "2026-03-02", usd: "550", r: "0.85" },
];
// AAA bought for 1000 with no dollars; IBKR charges 5 USD of debit interest
// while the balance is negative, which adds to the debt; the sale repays
// 1005 and the 95 left are converted.
const INTEREST: LoanEv[] = [
  { k: "buy", d: "2025-03-03", sym: "AAA", qty: "10", px: "100", r: "0.95" },
  { k: "int", d: "2025-03-31", usd: "5", r: "0.93" },
  { k: "sell", d: "2025-06-02", sym: "AAA", qty: "10", px: "110", r: "0.90" },
  { k: "conv", d: "2025-06-10", usd: "95", r: "0.88" },
];
// IBKR auto-conversions (AFx) on the buy and the sale days: 40 economic.
const AFX: LoanEv[] = [
  { k: "fund", d: "2025-03-03", usd: "1000", r: "0.95", afx: true },
  { k: "buy", d: "2025-03-03", sym: "AAA", qty: "10", px: "100", r: "0.95" },
  { k: "sell", d: "2025-06-02", sym: "AAA", qty: "10", px: "110", r: "0.90" },
  { k: "conv", d: "2025-06-02", usd: "1100", r: "0.90", afx: true },
];

const withReport = (id: string, ev: LoanEv[], extra: Partial<LoanScenario> = {}): LoanScenario => ({ id, ev, opening: "0", ...extra });

describe("the issue's repro, with a CashReport", () => {
  const sc = withReport("REPRO", REPRO);

  it("reproduces the bug without a CashReport: −175 on an economic −145, 200 dollars left in the pool", () => {
    const bare = { id: "REPRO-bare", ev: REPRO };
    for (const [, opts] of METHODS) {
      const per = runLoan(bare, { ...opts, fxTrace: true });
      expect(f2(lifetime(per))).toBe("-175.00");
      expect(poolEnd(per)).toBe("200");
    }
  });

  for (const [name, opts] of METHODS) {
    it(`${name}: stock + FX = EUR out − EUR in (−145), the pool ends empty`, () => {
      const per = runLoan(sc, { ...opts, fxTrace: true });
      expect(f2(economic(harnessScenario(sc)))).toBe("-145.00");
      expect(f2(lifetime(per))).toBe("-145.00");
      expect(poolEnd(per)).toBe("0");
      expect(ids(per)).not.toContain("fx.conservation_mismatch");
      // REPRO is an IBKR upload: neither form of the untracked note may fire.
      expect(ids(per)).not.toContain("report.fx_traditional_uncovered");
      expect(ids(per)).not.toContain("report.fx_traditional_uncovered_ibkr");
      expect(ids(per)).not.toContain("report.fx_traditional_lost_dollars");
    });
  }

  it("the default: −190 stock; 10 repaying the loan, −15 and 50 converting: 45", () => {
    const per = runLoan(sc, {});
    expect(years(per)).toEqual([[2025, "-190.00", "45.00"]]);
    // 200 USD owed since 04-01 at 0.95, repaid on 04-02 with CCC's dollars
    // that cost 0.90: 200 × (0.95 − 0.90) = 10, of which the debt's own
    // change is 200 × (0.95 − 0.94) = 2.
    expect(loanRows(per)).toEqual([["2025-04-02", "200", "10.00", "2.00"]]);
  });

  it("«Tradicional con divisa»: −170 stock; 2 repaying the loan, −27 and 50 converting: 25", () => {
    const per = runLoan(sc, TRAD);
    expect(years(per)).toEqual([[2025, "-170.00", "25.00"]]);
    // CCC's dollars come back at 0.90 + (0.94 − 0.90) = 0.94 (the shift its
    // stock line declared): 200 × (0.95 − 0.94) = 2, all of it the debt's change.
    expect(loanRows(per)).toEqual([["2025-04-02", "200", "2.00", "2.00"]]);
  });

  it("monodivisa does not change: −170", () => {
    expect(f2(lifetime(runLoan(sc, MONO)))).toBe("-170.00");
  });

  it("the loan note gives the debt's part, and no lost-dollar note", () => {
    const m = runLoan(sc, {}).get(2025)!.report.messages.find((x) => x.id === "report.fx_loan_repayment");
    expect(m?.severity).toBe("info");
    expect(m?.context).toEqual({ ccy: "USD", amount: "10.00", gain: "2.00", loss: "0.00" });
    expect(m?.hint).toContain("STS 71/2021");
    expect(m?.hint).toContain("V2414-12");
    // It shows in the open «Cómo se ha calculado» box with the other method notes.
    expect(isMethodNote(m!)).toBe(true);
  });

  it("the trace shows the loan opening, the same-day repayment and the later one", () => {
    const trace = runLoan(sc, { ...TRAD, fxTrace: true }).get(2025)!.report.fxTrace ?? [];
    const loan = trace.filter((t) => /préstamo|prestada/.test(t.note ?? ""));
    expect(loan.map((t) => [t.date, t.kind, t.quantityFcy])).toEqual([
      ["2025-04-01", "park", "1000"],
      ["2025-04-01", "discard", "800"],
      ["2025-04-01", "discard", "200"],
      ["2025-04-02", "dispose", "200"],
    ]);
    expect(loan[0]!.note).toMatch(/^préstamo en divisa/);
    expect(loan[3]!.trigger).toBe("loan_repayment");
    expect(loan[3]!.note).toContain("2.00 € por la variación de la deuda");
  });
});

describe("the other loan shapes", () => {
  const cases: [string, LoanEv[], string, Record<string, (string | number)[][]>, string][] = [
    // id, events, economic, per-method per-year [stock, fx], mono total
    ["MIRROR", MIRROR, "-204.00", { default: [[2025, "-170.00", "-34.00"]], trad: [[2025, "-190.00", "-14.00"]] }, "-190.00"],
    ["HELD", HELD, "143.00", { default: [[2025, "179.00", "-36.00"]], trad: [[2025, "99.00", "44.00"]] }, "99.00"],
    [
      "YEAR",
      YEAR,
      "143.00",
      {
        default: [
          [2024, "0.00", "0.00"],
          [2025, "178.00", "-35.00"],
        ],
        trad: [
          [2024, "0.00", "0.00"],
          [2025, "93.00", "50.00"],
        ],
      },
      "93.00",
    ],
  ];
  for (const [id, ev, eco, want, mono] of cases) {
    it(`${id}: economic ${eco} in both methods, the pool ends empty`, () => {
      const sc = withReport(id, ev);
      expect(f2(economic(harnessScenario(sc)))).toBe(eco);
      const def = runLoan(sc, { fxTrace: true });
      const trad = runLoan(sc, { ...TRAD, fxTrace: true });
      expect(years(def)).toEqual(want.default);
      expect(years(trad)).toEqual(want.trad);
      for (const per of [def, trad]) {
        expect(f2(lifetime(per))).toBe(eco);
        expect(poolEnd(per)).toBe("0");
        expect(ids(per)).not.toContain("report.fx_traditional_uncovered");
      }
      expect(f2(lifetime(runLoan(sc, MONO)))).toBe(mono);
    });
  }

  it("HELD without a CashReport keeps the old result (43 in «Tradicional con divisa»)", () => {
    expect(f2(lifetime(runLoan({ id: "HELD-bare", ev: HELD }, TRAD)))).toBe("43.00");
  });

  it("YEAR: the December loan is repaid in January, in the 2025 return", () => {
    const per = runLoan(withReport("YEAR", YEAR), {});
    // CCC's sale returns 500 USD that cost 0.90 and 100 of profit at 0.93;
    // the 400 funded at 0.80 repay the rest. Debt part: q × (0.95 − r_day).
    expect(loanRows(per)).toEqual([
      ["2025-01-03", "500", "25.00", "10.00"],
      ["2025-01-03", "100", "2.00", "2.00"],
      ["2025-01-20", "400", "60.00", "60.00"],
    ]);
  });

  it("LATE-YEAR: the late cover runs first, the same figures as without a CashReport", () => {
    const sc = withReport("LATE-YEAR", LATE_YEAR);
    for (const [, opts] of [...METHODS, ["mono", MONO] as const]) {
      const per = runLoan(sc, opts);
      const bare = runLoan({ id: "LATE-YEAR-bare", ev: LATE_YEAR }, opts);
      expect(years(per)).toEqual(years(bare));
      expect(loanRows(per)).toEqual([]);
    }
    expect(f2(lifetime(runLoan(sc, {})))).toBe("51.50");
    expect(f2(lifetime(runLoan(sc, TRAD)))).toBe("51.50");
  });
});

describe("debit interest while the balance is negative adds to the debt", () => {
  const sc = withReport("INTEREST", INTEREST);

  it("economic 88.25 in both methods, the pool ends empty", () => {
    expect(f2(economic(harnessScenario(sc)))).toBe("88.25");
    for (const [, opts] of METHODS) {
      const per = runLoan(sc, { ...opts, fxTrace: true });
      expect(f2(lifetime(per))).toBe("88.25");
      expect(poolEnd(per)).toBe("0");
    }
  });

  it("the default: 90 stock; the interest's 5 USD repaid at 0.93 with profit dollars at 0.90 (0.15), −1.90 converting", () => {
    const per = runLoan(sc, {});
    expect(years(per)).toEqual([[2025, "90.00", "-1.75"]]);
    expect(loanRows(per)).toEqual([["2025-06-02", "5", "0.15", "0.15"]]);
  });

  it("«Tradicional con divisa»: 40 stock; 50 + 0.15 repaying, −1.90 converting", () => {
    const per = runLoan(sc, TRAD);
    expect(years(per)).toEqual([[2025, "40.00", "48.25"]]);
    expect(loanRows(per)).toEqual([
      ["2025-06-02", "1000", "50.00", "50.00"],
      ["2025-06-02", "5", "0.15", "0.15"],
    ]);
  });

  it("the interest itself books no exchange difference", () => {
    const rows = runLoan(sc, {}).get(2025)!.report.fxGains.disposals.filter((d) => d.trigger === "interest");
    expect(rows.map((d) => [d.quantity.toString(), f2(d.gainLossEur)])).toEqual([["5", "0.00"]]);
  });
});

describe("a positive opening balance is spent before any loan opens", () => {
  // 300 USD of opening balance with no EUR origin; AAA costs 1000 (0.95):
  // 300 come from the opening balance and 700 are borrowed. The sale (1100
  // at 0.90) repays the 700, and 400 are converted at 0.88.
  const sc = withReport(
    "OPEN",
    [
      { k: "buy", d: "2025-03-03", sym: "AAA", qty: "10", px: "100", r: "0.95" },
      { k: "sell", d: "2025-06-02", sym: "AAA", qty: "10", px: "110", r: "0.90" },
      { k: "conv", d: "2025-06-10", usd: "400", r: "0.88" },
    ],
    { opening: "300" },
  );

  it("the default: the sale's dollars repay the 700 in pool order, −8 in all", () => {
    // The sale returns the 300 untracked at the sale rate (0.90) first: they
    // repay 300 × (0.95 − 0.90) = 15. The loan's own 700 come back at 0.95
    // and repay the other 400 at no difference; their 300 left and the 100
    // of profit (0.90) convert at 0.88: −21 − 2. 15 − 23 = −8.
    const per = runLoan(sc, { fxTrace: true });
    expect(years(per)).toEqual([[2025, "90.00", "-8.00"]]);
    expect(loanRows(per)).toEqual([["2025-06-02", "300", "15.00", "15.00"]]);
    expect(poolEnd(per)).toBe("0");
  });

  it("«Tradicional con divisa»: 700 × (0.95 − 0.90) on the loan, and 300 untracked", () => {
    // Every returned dollar costs 0.90 here (the loan's 0.95 shifted by
    // 0.90 − 0.95), so the 700 repay 35 whichever lot pays.
    const per = runLoan(sc, { ...TRAD, fxTrace: true });
    expect(years(per)).toEqual([[2025, "40.00", "27.00"]]);
    expect(loanRows(per)).toEqual([
      ["2025-06-02", "300", "15.00", "15.00"],
      ["2025-06-02", "400", "20.00", "20.00"],
    ]);
    // Those 300 are the Cash Report's opening balance: no advice to upload it again.
    expect(per.get(2025)!.report.messages.find((m) => m.id === "report.fx_traditional_opening")?.context).toEqual({ qty: "300.00", ccy: "USD" });
    expect(ids(per).filter((id) => id.startsWith("report.fx_traditional_uncovered"))).toEqual([]);
    expect(poolEnd(per)).toBe("0");
  });
});

describe("intraday round trips (issue #447) inside the gate keep their results", () => {
  // IRT-LOSS: 500 USD at 0.90, AAA bought for 1000 and sold for 800 the same
  // day (0.95), 300 converted at 0.80. A trap: repaying the loan with the
  // oldest pool lot instead of the sale's own dollars moved the default.
  const loss = withReport("IRT-LOSS", [
    { k: "fund", d: "2024-02-01", usd: "500", r: "0.90" },
    { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
    { k: "sell", d: "2024-03-01", sym: "AAA", qty: "10", px: "80", r: "0.95" },
    { k: "conv", d: "2024-09-02", usd: "300", r: "0.80" },
  ]);

  it("IRT-LOSS: the default −190 / −30, «Tradicional con divisa» −190 / −20", () => {
    expect(years(runLoan(loss, {}))).toEqual([[2024, "-190.00", "-30.00"]]);
    expect(years(runLoan(loss, TRAD))).toEqual([[2024, "-190.00", "-20.00"]]);
  });

  // Two round trips with no dollars on one day, then 1000 funded and 1100 converted.
  const loss2: Ev[] = [
    { k: "buy", d: "2024-04-01", sym: "CCC", qty: "10", px: "100", r: "0.95" },
    { k: "sell", d: "2024-04-01", sym: "CCC", qty: "10", px: "80", r: "0.95" },
  ];
  const gain2: Ev[] = [
    { k: "buy", d: "2024-04-01", sym: "BBB", qty: "10", px: "100", r: "0.95" },
    { k: "sell", d: "2024-04-01", sym: "BBB", qty: "10", px: "130", r: "0.95" },
  ];
  const tail: Ev[] = [
    { k: "fund", d: "2024-05-01", usd: "1000", r: "0.80" },
    { k: "conv", d: "2024-06-03", usd: "1100", r: "0.85" },
  ];
  for (const [name, opts] of METHODS) {
    it(`${name}: two round trips of one day give 135 in either order, the pool ends empty`, () => {
      for (const ev of [[...loss2, ...gain2, ...tail], [...gain2, ...loss2, ...tail]]) {
        const per = runLoan(withReport("RTL", ev), { ...opts, fxTrace: true });
        expect(f2(lifetime(per))).toBe("135.00");
        expect(poolEnd(per)).toBe("0");
      }
    });
  }
});

describe("the default: a sale's currency that repays the loan the day it opened pays the shares", () => {
  // MIN1: 500 USD at 0.90; on 04-01 (0.95) AAA is bought for 1000, so 500
  // are borrowed, and 5 of the 10 shares are sold the same day for 510 (a
  // gain); the other 5 are sold on 06-02 for 550 (0.85); 560 converted at
  // 0.80. The sale returns the 500 that cost 0.90 first, and they repay the
  // loan. A trap: booking nothing and leaving the borrowed slice parked at
  // 0.95 lost 500 × (0.95 − 0.90) = 25 (−27 on an economic −2; f9926b6 and
  // the upload without a CashReport give −2).
  const MIN1: LoanEv[] = [
    { k: "fund", d: "2025-03-03", usd: "500", r: "0.90" },
    { k: "buy", d: "2025-04-01", sym: "AAA", qty: "10", px: "100", r: "0.95" },
    { k: "sell", d: "2025-04-01", sym: "AAA", qty: "5", px: "102", r: "0.95" },
    { k: "sell", d: "2025-06-02", sym: "AAA", qty: "5", px: "110", r: "0.85" },
    { k: "conv", d: "2025-07-01", usd: "560", r: "0.80" },
  ];
  const sc = withReport("MIN1", MIN1);

  it("both methods: −2, as without a CashReport, the pool ends empty", () => {
    expect(f2(economic(harnessScenario(sc)))).toBe("-2.00");
    for (const [, opts] of METHODS) {
      const per = runLoan(sc, { ...opts, fxTrace: true });
      expect(f2(lifetime(per))).toBe("-2.00");
      expect(poolEnd(per)).toBe("0");
      expect(ids(per)).not.toContain("fx.conservation_mismatch");
    }
    expect(years(runLoan(sc, {}))).toEqual(years(runLoan({ id: "MIN1-bare", ev: MIN1 }, {})));
  });

  it("the default's trace: the borrowed slice takes the cost of the dollars that repaid it", () => {
    const trace = runLoan(sc, { fxTrace: true }).get(2025)!.report.fxTrace ?? [];
    const row = trace.find((t) => t.kind === "park" && /paga la compra en lugar del préstamo/.test(t.note ?? ""));
    expect(row?.date).toBe("2025-04-01");
    expect(row?.quantityFcy).toBe("500");
    expect(row?.rate).toBe("0.9");
  });

  // The issue's generator with same-day sales (part of the position, or all
  // of it) on the day of an overdrawing buy, at no loss.
  const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
  for (const [name, opts] of METHODS) {
    it(`${name}: every seed with same-day sales matches EUR out − EUR in with a CashReport`, () => {
      const miss = SEEDS.filter((seed) => {
        const hs = gen(seed, true, true);
        return f2(lifetime(runLoan(withReport(hs.id, hs.ev), opts))) !== f2(economic(hs));
      });
      expect(miss).toEqual([]);
    });
  }
});

describe("the loan note: the debt's own change, the same in both methods", () => {
  // A loan of 1000 USD opened at 0.95 and repaid at 0.90 by the sale of the
  // shares it bought: the debt fell by 1000 × (0.95 − 0.90) = 50 €. The
  // default's stock line (sale-rate cost) holds that change and books 0 in
  // 1633/1637; «Tradicional con divisa» books it there. A trap: the note
  // summed only the rows in 1633/1637 and did not fire in the default.
  const OWN: LoanEv[] = [
    { k: "buy", d: "2025-03-03", sym: "AAA", qty: "10", px: "100", r: "0.95" },
    { k: "sell", d: "2025-06-02", sym: "AAA", qty: "10", px: "110", r: "0.90" },
    { k: "conv", d: "2025-06-10", usd: "100", r: "0.88" },
  ];
  // The default's 50 sit in its stock line, not in 1633/1637, so its note is
  // the `_manual` form (see fx-overdraft-loan-followup.test.ts).
  const note = (ev: LoanEv[], opts: object) =>
    runLoan(withReport("OWN", ev), opts)
      .get(2025)!
      .report.messages.find((m) => m.id === "report.fx_loan_repayment" || m.id === "report.fx_loan_repayment_manual");

  it("a gain of 50 in both methods; 50 in 1633/1637 in «Tradicional con divisa», 0 in the default", () => {
    expect(note(OWN, TRAD)?.context).toEqual({ ccy: "USD", amount: "50.00", gain: "50.00", loss: "0.00" });
    expect(note(OWN, {})?.context).toEqual({ ccy: "USD", amount: "0.00", gain: "50.00", loss: "0.00", boxGain: "0.00", boxLoss: "0.00" });
  });

  it("a loss is a positive amount for box 0305; the hint says to take it out of 1633/1637 where a row holds it", () => {
    const up = OWN.map((e) => (e.k === "sell" ? { ...e, r: "1.00" } : e.k === "conv" ? { ...e, r: "0.98" } : e));
    for (const [, opts] of METHODS) {
      const m = note(up, opts);
      expect(m?.context?.gain).toBe("0.00");
      expect(m?.context?.loss).toBe("50.00");
      expect(m?.hint).toContain("0305");
    }
    expect(note(up, TRAD)?.hint).toContain("quítalas de las casillas 1633/1637");
    expect(note(up, {})?.hint).toContain("cuádralo a mano");
  });
});

describe("the untracked-currency note names the right way out", () => {
  it("an IBKR upload with no Cash Report: the note says to upload it", () => {
    const per = runLoan({ id: "REPRO-bare", ev: REPRO }, TRAD);
    const m = per.get(2025)!.report.messages.find((x) => x.id === "report.fx_traditional_uncovered_ibkr");
    expect(m?.context).toEqual({ qty: "200.00", ccy: "USD" });
    expect(m?.hint).toContain("Cash Report");
    expect(isMethodNote(m!)).toBe(true);
    expect(ids(per)).not.toContain("report.fx_traditional_uncovered");
  });

  it("another broker: no word of an IBKR Cash Report", () => {
    // The harness statement names no broker.
    const r = run(harnessScenario({ id: "REPRO-plain", ev: REPRO }), TRAD).get(2025)!.report;
    const m = r.messages.find((x) => x.id === "report.fx_traditional_uncovered");
    expect(m?.message).toContain("descubierto o préstamo de margen");
    expect(m?.hint).not.toContain("Cash Report");
    expect(r.messages.map((x) => x.id)).not.toContain("report.fx_traditional_uncovered_ibkr");
  });
});

describe("the gate: no proof of the account's cash, no loan", () => {
  const bare = (opts: object) => runLoan({ id: "REPRO-bare", ev: REPRO }, opts);
  const same = (sc: LoanScenario) => {
    for (const [, opts] of METHODS) {
      const per = runLoan(sc, opts);
      expect(years(per)).toEqual(years(bare(opts)));
      expect(loanRows(per)).toEqual([]);
    }
  };

  it("no CashReport", () => {
    same({ id: "no-report", ev: REPRO });
  });
  it("a negative startingCash", () => {
    same(withReport("neg", REPRO, { opening: "-100" }));
  });
  it("a CashReport row without startingCash", () => {
    same(withReport("no-start", REPRO, { opening: null }));
  });
  it("an ending balance the upload does not explain", () => {
    same(withReport("delta", REPRO, { endingDelta: "50" }));
  });

  it("a USD deposit the FX engine does not read", () => {
    const ev: LoanEv[] = [...REPRO, { k: "dep", d: "2025-06-20", usd: "100", r: "0.85" }];
    for (const [, opts] of METHODS) {
      expect(years(runLoan(withReport("dep", ev), opts))).toEqual(years(runLoan({ id: "dep-bare", ev }, opts)));
    }
  });

  it("two accounts merged", () => {
    const { xml, rates } = toXml(withReport("REPRO", REPRO));
    const other = toXml(withReport("U2", [{ k: "fee", d: "2025-07-01", usd: "0", r: "0.85" }], { account: "U2" })).xml;
    for (const [, opts] of METHODS) {
      const per = runUpload(toUpload(xml, other), rates, [2025], opts);
      expect(years(per)).toEqual(years(bare(opts)));
      expect(loanRows(per)).toEqual([]);
    }
  });

  it("the same file uploaded twice is still one account", () => {
    // Trades would double too; here only the CashReport rows are doubled.
    const { xml, rates } = toXml(withReport("REPRO", REPRO));
    const st = toUpload(xml);
    st.holdingsBySource = [...st.holdingsBySource!, ...st.holdingsBySource!];
    expect(f2(lifetime(runUpload(st, rates, [2025], {})))).toBe("-145.00");
  });

  // Account U2 really held 1000 USD at the start (no file shows it): it buys
  // AAA for 1000, sells for 800 and buys 200 USD back. No dollar became euros,
  // so the FX is 0. A trap: the gate checked one account over the CashReport
  // rows only, so U1's CashReport (0 → 0) let U2's events through and booked
  // 70 € (trad) or 30 € (default) of loan repayments that never happened.
  it("a second account with no CashReport, merged with one that has it", () => {
    const U2: LoanEv[] = [
      { k: "buy", d: "2025-03-03", sym: "AAA", qty: "10", px: "100", r: "0.95" },
      { k: "sell", d: "2025-06-02", sym: "AAA", qty: "10", px: "80", r: "0.90" },
      { k: "fund", d: "2025-07-01", usd: "200", r: "0.80" },
    ];
    const fee: LoanEv[] = [{ k: "fee", d: "2025-01-15", usd: "0", r: "0.92" }];
    const u1 = toXml({ id: "U1", ev: fee, opening: "0", account: "U1" });
    const u1Bare = toXml({ id: "U1", ev: fee, account: "U1" }).xml;
    const u2 = toXml({ id: "U2", ev: U2, account: "U2" });
    const u2xml = u2.xml.replace(/(tradeID|transactionID)="(\d+)"/g, '$1="u2-$2"');
    const rates = new Map([...u1.rates, ...u2.rates]);
    for (const [, opts] of METHODS) {
      const merged = runUpload(toUpload(u1.xml, u2xml), rates, [2025], opts);
      expect(loanRows(merged)).toEqual([]);
      expect(years(merged)).toEqual(years(runUpload(toUpload(u1Bare, u2xml), rates, [2025], opts)));
      expect(f2(merged.get(2025)!.fx)).toBe("0.00");
    }
  });

  // USD wired in and out (no EUR origin) in the same year: the period nets to
  // the ending balance, but the balance never went below zero. A trap: the
  // per-period sum let the gate through and the loan model invented a loan.
  it("a USD deposit and an equal withdrawal in one period", () => {
    const shapes: LoanEv[][] = [
      [
        { k: "dep", d: "2025-02-03", usd: "1000", r: "0.95" },
        { k: "buy", d: "2025-03-03", sym: "AAA", qty: "10", px: "100", r: "0.95" },
        { k: "sell", d: "2025-06-02", sym: "AAA", qty: "10", px: "80", r: "0.90" },
        { k: "fund", d: "2025-07-01", usd: "200", r: "0.80" },
        { k: "dep", d: "2025-12-01", usd: "-1000", r: "0.80" },
      ],
      [
        { k: "dep", d: "2025-01-10", usd: "1000", r: "0.95" },
        { k: "buy", d: "2025-01-15", sym: "AAA", qty: "10", px: "100", r: "0.95" },
        { k: "sell", d: "2025-06-02", sym: "AAA", qty: "10", px: "110", r: "0.85" },
        { k: "dep", d: "2025-07-01", usd: "-1000", r: "0.84" },
        { k: "conv", d: "2025-08-01", usd: "100", r: "0.83" },
      ],
    ];
    for (const [i, ev] of shapes.entries()) {
      for (const [, opts] of METHODS) {
        const per = runLoan(withReport(`DEP-WD${i}`, ev), opts);
        expect(loanRows(per)).toEqual([]);
        expect(years(per)).toEqual(years(runLoan({ id: `DEP-WD${i}-bare`, ev }, opts)));
        expect(ids(per)).not.toContain("report.fx_loan_repayment");
      }
    }
  });

  // An option premium received and paid back in the same period nets to 0
  // in the CashReport, but the FX engine never reads option trades.
  it("an option trade in the currency", () => {
    const opt = (id: string, side: "BUY" | "SELL", d: string, money: string) =>
      `<Trade tradeID="${id}" accountId="U1" symbol="AAA 250620C00100000" description="AAA 20JUN25 100 C" isin="" assetCategory="OPT" currency="USD" tradeDate="${d}" settlementDate="${d}" quantity="${side === "SELL" ? "-1" : "1"}" tradePrice="1" tradeMoney="${money}" proceeds="${side === "SELL" ? money : `-${money}`}" cost="${money}" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "SELL" ? "O" : "C"}" exchange="CBOE" multiplier="100" ibCommissionCurrency="USD" ibCommission="0" taxes="0" />`;
    const patch = (xml: string) => xml.replace("<Trades>", `<Trades>${opt("o1", "SELL", "20250310", "100")}${opt("o2", "BUY", "20250320", "100")}`);
    const { xml, rates } = toXml(withReport("OPT", REPRO));
    const bareXml = toXml({ id: "OPT", ev: REPRO }).xml;
    expect(patch(xml)).not.toBe(xml);
    for (const [, opts] of METHODS) {
      const per = runUpload(toUpload(patch(xml)), rates, [2025], opts);
      expect(loanRows(per)).toEqual([]);
      expect(years(per)).toEqual(years(runUpload(toUpload(patch(bareXml)), rates, [2025], opts)));
    }
  });

  // A worthless sale whose 5 USD commission exceeds its proceeds: the default's
  // own producer drops a sale with proceeds ≤ 0, «Tradicional con divisa» keeps
  // it. A trap: the gate summed each method's own events, so the same upload
  // ran the loan in «Tradicional con divisa» and the untracked path in the default.
  it("the same answer in both methods: a sale whose commission exceeds its proceeds", () => {
    const ev: LoanEv[] = [
      ...REPRO,
      { k: "buy", d: "2025-05-05", sym: "ZZZ", qty: "1", px: "10", r: "0.82" },
      { k: "sell", d: "2025-05-20", sym: "ZZZ", qty: "1", px: "0", r: "0.82" },
    ];
    const { xml, rates } = toXml(withReport("WORTHLESS", ev, { endingDelta: "-5" }));
    const patched = xml.replace(/(<Trade [^>]*symbol="ZZZ"[^>]*buySell="SELL"[^>]*?)ibCommission="0"/, '$1ibCommission="-5"');
    expect(patched).not.toBe(xml);
    for (const [, opts] of METHODS) {
      const per = runUpload(toUpload(patched), rates, [2025], opts);
      expect(loanRows(per).length).toBeGreaterThan(0);
    }
  });

  it("AFx rows skipped by the opt-out: «Tradicional con divisa» stays 40", () => {
    const sc = withReport("AFX-SKIP", AFX);
    expect(f2(lifetime(runLoan(sc, { ...TRAD, trackAutoConvert: false })))).toBe("40.00");
    expect(loanRows(runLoan(sc, { ...TRAD, trackAutoConvert: false }))).toEqual([]);
    // Tracked, the AFx rows are conversions and the account never goes below zero.
    expect(f2(lifetime(runLoan(sc, TRAD)))).toBe("40.00");
    expect(f2(lifetime(runLoan(sc, {})))).toBe("40.00");
  });

  it("ibkr-autoconvert.xml: its CashReport does not reconcile, the FX is the same without it", () => {
    const xml = readFileSync(new URL("../fixtures/ibkr-autoconvert.xml", import.meta.url), "utf-8");
    const load = (strip: boolean) => {
      const parsed = parseIbkrFlexXml(xml);
      if (strip) parsed.cashBalances = [];
      return finalizeMergedStatement(mergeStatement(createEmptyStatement(), parsed, "Interactive Brokers"));
    };
    const withRows = load(false);
    expect(withRows.cashBalances?.some((c) => c.currency === "USD" && c.startingCash !== undefined)).toBe(true);
    const rates = new Map<string, Map<string, string>>();
    for (const t of withRows.trades) {
      const d = t.tradeDate.length === 8 ? `${t.tradeDate.slice(0, 4)}-${t.tradeDate.slice(4, 6)}-${t.tradeDate.slice(6)}` : t.tradeDate;
      rates.set(d, new Map([["USD", "0.92"]]));
    }
    for (const opts of [{}, TRAD, { trackAutoConvert: false }, { ...TRAD, trackAutoConvert: false }]) {
      const a = generateTaxReport(withRows, rates, 2025, opts);
      const b = generateTaxReport(load(true), rates, 2025, opts);
      expect(JSON.stringify(a.fxGains)).toBe(JSON.stringify(b.fxGains));
    }
  });
});

describe("the parser keeps each CashReport row's opening balance and period", () => {
  it("startingCash, and the row's dates or else the statement's", () => {
    const xml = `<FlexQueryResponse><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20250101" toDate="20251231"><CashReport>
      <CashReportCurrency accountId="U1" currency="USD" startingCash="12.5" endingCash="-3" endingSettledCash="-3" />
      <CashReportCurrency accountId="U1" currency="GBP" fromDate="20250301" toDate="20250630" endingCash="1" endingSettledCash="1" />
      </CashReport></FlexStatement></FlexStatements></FlexQueryResponse>`;
    const rows = parseIbkrFlexXml(xml).cashBalances!;
    expect(rows.map((r) => [r.currency, r.startingCash, r.fromDate, r.toDate])).toEqual([
      ["USD", "12.5", "20250101", "20251231"],
      ["GBP", undefined, "20250301", "20250630"],
    ]);
  });
});

describe("seeded overdraft cycles: stock + FX = EUR out − EUR in", () => {
  // The issue's generator (buys that overdraw the account, funded 1 to 12
  // days later, sometimes after another sale; no loss sales), 200 seeds.
  const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
  const failures = (withCashReport: boolean, opts: object): number[] =>
    SEEDS.filter((seed) => {
      const hs = gen(seed, true);
      const sc: LoanScenario = withCashReport ? withReport(hs.id, hs.ev) : { id: hs.id, ev: hs.ev };
      const per = runLoan(sc, opts);
      return f2(lifetime(per)) !== f2(economic(hs));
    });

  for (const [name, opts] of METHODS) {
    it(`${name}: every seed matches with a CashReport`, () => {
      expect(failures(true, opts)).toEqual([]);
    });
  }

  // 151 of the 200 seeds miss in «Tradicional con divisa» and 129 in the default.
  it("red control: without a CashReport, both methods miss on many seeds", () => {
    expect(failures(false, TRAD).length).toBeGreaterThan(100);
    expect(failures(false, {}).length).toBeGreaterThan(100);
  });
});

describe("the loan message in every locale", () => {
  beforeEach(async () => {
    await setLocale("es");
  });

  it("es = engine text, byte for byte (loan note and the relabelled untracked note)", () => {
    const def = runLoan(withReport("REPRO", REPRO), {}).get(2025)!.report.messages;
    const open = runLoan(
      withReport(
        "OPEN",
        [
          { k: "buy", d: "2025-03-03", sym: "AAA", qty: "10", px: "100", r: "0.95" },
          { k: "sell", d: "2025-06-02", sym: "AAA", qty: "10", px: "110", r: "0.90" },
          { k: "conv", d: "2025-06-10", usd: "400", r: "0.88" },
        ],
        { opening: "300" },
      ),
      TRAD,
    ).get(2025)!.report.messages;
    const ibkr = runLoan({ id: "REPRO-bare", ev: REPRO }, TRAD).get(2025)!.report.messages;
    const plain = run(harnessScenario({ id: "REPRO-plain", ev: REPRO }), TRAD).get(2025)!.report.messages;
    const manual = runLoan(
      withReport("OWN", [
        { k: "buy", d: "2025-03-03", sym: "AAA", qty: "10", px: "100", r: "0.95" },
        { k: "fund", d: "2025-04-01", usd: "300", r: "0.80" },
        { k: "sell", d: "2025-06-02", sym: "AAA", qty: "10", px: "110", r: "0.90" },
        { k: "conv", d: "2025-06-10", usd: "400", r: "0.88" },
      ]),
      {},
    ).get(2025)!.report.messages;
    for (const m of [
      def.find((x) => x.id === "report.fx_loan_repayment"),
      manual.find((x) => x.id === "report.fx_loan_repayment_manual"),
      open.find((x) => x.id === "report.fx_traditional_opening"),
      ibkr.find((x) => x.id === "report.fx_traditional_uncovered_ibkr"),
      plain.find((x) => x.id === "report.fx_traditional_uncovered"),
    ]) {
      expect(m).toBeDefined();
      expect(localizeMessage(m!)).toBe(m!.message);
      expect(localizeHint(m!)).toBe(m!.hint);
    }
  });

  const keys = [
    "fx.trigger.loan_repayment",
    "report.fx_loan_repayment",
    "report.fx_loan_repayment.hint",
    "report.fx_loan_repayment_manual",
    "report.fx_loan_repayment_manual.hint",
    "report.fx_traditional_uncovered",
    "report.fx_traditional_uncovered.hint",
    "report.fx_traditional_uncovered_ibkr",
    "report.fx_traditional_uncovered_ibkr.hint",
    "report.fx_traditional_opening",
    "report.fx_traditional_opening.hint",
  ];
  const ph = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  for (const [name, loc] of Object.entries({ en, ca, eu, gl })) {
    it(`${name} has every key with the same placeholders`, () => {
      for (const k of keys) {
        const v = (loc as Record<string, string>)[k];
        expect(v, `${name} ${k}`).toBeTruthy();
        expect(ph(v!), `${name} ${k}`).toEqual(ph((es as Record<string, string>)[k]!));
      }
    });
  }
});
