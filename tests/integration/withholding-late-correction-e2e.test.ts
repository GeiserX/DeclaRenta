import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { readFileSync } from "fs";
import { ibkrParser } from "../../src/parsers/ibkr.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import type { FxMethod, TaxSummary } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import es from "../../src/i18n/locales/es.js";

// ===========================================================================
// End-to-end: withholding corrections that are not an exact same-day reversal
// (issue #438). A 10.00 USD dividend withheld −1.50, then corrected:
//   (a) a partial refund +0.50 two days later, or
//   (b) a +1.50 reversal and a −1.00 new withholding on another date.
// The real withholding is 1.00 USD = 0.90 €, so 0588 must be 0.90 in every FX
// method (it was 1.35: one row, absolute value).
// Rates are "EUR per 1 USD": 0.90 for the whole range.
// ===========================================================================

const MSG_ID = "report.withholding_corrected_prior_year";

function rateMap(from: number, to: number, usd = "0.90"): EcbRateMap {
  const m: EcbRateMap = new Map();
  for (let t = Date.UTC(from, 0, 1); t <= Date.UTC(to, 11, 31); t += 86400000) {
    m.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", usd]]));
  }
  return m;
}

let id = 5000;
/** One IBKR cash row; `reportDate` is the day IBKR posted it (defaults to `date`). */
function cash(type: string, amount: string, date: string, reportDate = date): string {
  const desc = `AAPL(US0378331005) CASH DIVIDEND USD 0.25 PER SHARE${type === "Withholding Tax" ? " - US TAX" : ""}`;
  return `<CashTransaction transactionID="${id++}" accountId="U1" symbol="AAPL" description="${desc}" isin="US0378331005" currency="USD" dateTime="${date};202000" settleDate="${date}" reportDate="${reportDate}" amount="${amount}" fxRateToBase="0.9" type="${type}" levelOfDetail="DETAIL" />`;
}

function statement(cashRows: string[], from = "20250101", to = "20251231") {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Issue438" type="AF">
 <FlexStatements count="1">
  <FlexStatement accountId="U1" fromDate="${from}" toDate="${to}" period="Custom">
   <Trades />
   <CashTransactions>
${cashRows.join("\n")}
   </CashTransactions>
   <CorporateActions />
   <OpenPositions />
  </FlexStatement>
 </FlexStatements>
</FlexQueryResponse>
`;
  return ibkrParser.parse(xml);
}

function merged(...parts: ReturnType<typeof statement>[]) {
  let acc = createEmptyStatement();
  for (const p of parts) acc = mergeStatement(acc, p, ibkrParser.name);
  return finalizeMergedStatement(acc);
}

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];

describe("issue #438 — 0588 sums every withholding row of the dividend, with its sign", () => {
  const cases: [string, string[]][] = [
    ["partial refund two days later", [cash("Dividends", "10.00", "20250310"), cash("Withholding Tax", "-1.50", "20250310"), cash("Withholding Tax", "0.50", "20250312")]],
    [
      "reversal and new withholding on another date",
      [
        cash("Dividends", "10.00", "20250310"),
        cash("Withholding Tax", "-1.50", "20250310"),
        cash("Withholding Tax", "1.50", "20250312"),
        cash("Withholding Tax", "-1.00", "20250312"),
      ],
    ],
  ];
  const clean = merged(statement([cash("Dividends", "10.00", "20250310"), cash("Withholding Tax", "-1.00", "20250310")]));

  for (const [label, rows] of cases) {
    for (const method of METHODS) {
      it(`${label}: 0588 = 0.90 € (${method})`, () => {
        const r = generateTaxReport(merged(statement(rows)), rateMap(2024, 2025), 2025, reportOptionsForMethod(method));
        const c = generateTaxReport(clean, rateMap(2024, 2025), 2025, reportOptionsForMethod(method));
        expect(r.dividends.grossIncome.toFixed(2)).toBe("9.00");
        expect(r.doubleTaxation.deduction.toFixed(2)).toBe("0.90");
        expect(r.doubleTaxation.byCountry.US!.taxPaid.toFixed(2)).toBe("0.90");
        expect(r.dividends.entries[0]!.withholdingTaxEur.toFixed(4)).toBe(c.dividends.entries[0]!.withholdingTaxEur.toFixed(4));
        expect(r.messages.some((m) => m.id === MSG_ID)).toBe(false);
      });
    }
  }
});

describe("issue #438 — a correction posted next year for an earlier year's withholding", () => {
  // 2024: dividend 10.00 withheld −1.50 on 2024-12-10. IBKR corrects it in the
  // 2025 statement (reportDate 2025-01-20) with rows dated on the original day.
  const y2024 = statement([cash("Dividends", "10.00", "20241210"), cash("Withholding Tax", "-1.50", "20241210")], "20240101", "20241231");
  const y2025 = statement(
    [
      cash("Withholding Tax", "1.50", "20241210", "20250120"),
      cash("Withholding Tax", "-1.00", "20241210", "20250120"),
      cash("Dividends", "4.00", "20250610"),
      cash("Withholding Tax", "-0.60", "20250610"),
    ],
    "20250101",
    "20251231",
  );
  const rates = rateMap(2023, 2025);

  for (const method of METHODS) {
    it(`the 2025 report warns that 2024's 0588 was too high (${method})`, () => {
      const r = generateTaxReport(merged(y2025), rates, 2025, reportOptionsForMethod(method));
      const m = r.messages.filter((x) => x.id === MSG_ID);
      expect(m).toHaveLength(1);
      expect(m[0]!.severity).toBe("warning");
      // Net +0.50 USD refunded on 2024's withholding, × 0.90.
      expect(m[0]!.context).toEqual({ year: "2024", reportYear: "2025", amount: "0.45" });
      // 2025's own figures are untouched by the 2024 correction.
      expect(r.doubleTaxation.deduction.toFixed(2)).toBe("0.54");
    });
  }

  it("with both years uploaded, 2024 is recomputed with the correction and 2025 still warns", () => {
    const both = merged(y2024, y2025);
    const r2024 = generateTaxReport(both, rates, 2024);
    expect(r2024.doubleTaxation.deduction.toFixed(2)).toBe("0.90");
    expect(r2024.messages.some((x) => x.id === MSG_ID)).toBe(false);
    const r2025 = generateTaxReport(both, rates, 2025);
    expect(r2025.messages.find((x) => x.id === MSG_ID)?.context?.amount).toBe("0.45");
    expect(r2025.doubleTaxation.deduction.toFixed(2)).toBe("0.54");
  });

  it("the amount is each titular's share", () => {
    const r = generateTaxReport(merged(y2025), rates, 2025, { titulares: 2 });
    expect(r.messages.find((x) => x.id === MSG_ID)?.context?.amount).toBe("0.23"); // 0.225 → 0.23
  });

  it("the Spanish text is the es locale's, byte for byte", () => {
    const r = generateTaxReport(merged(y2025), rates, 2025);
    const m = r.messages.find((x) => x.id === MSG_ID)!;
    const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_x, k: string) => m.context![k]!);
    expect(m.message).toBe(fill(es[MSG_ID as keyof typeof es] as string));
    expect(m.hint).toBe(fill(es[`${MSG_ID}.hint` as keyof typeof es] as string));
  });

  it("no warning when the late correction raises the withholding", () => {
    const more = statement(
      [cash("Withholding Tax", "1.00", "20241210", "20250120"), cash("Withholding Tax", "-1.50", "20241210", "20250120")],
      "20250101",
      "20251231",
    );
    const r = generateTaxReport(merged(more), rates, 2025);
    expect(r.messages.some((x) => x.id === MSG_ID)).toBe(false);
  });

  it("no warning for a withholding of late December posted in January (no refund)", () => {
    const late = statement([cash("Withholding Tax", "-1.50", "20241230", "20250102")], "20250101", "20251231");
    const r = generateTaxReport(merged(late), rates, 2025);
    expect(r.messages.some((x) => x.id === MSG_ID)).toBe(false);
  });

  it("no warning in the earlier year's own report", () => {
    const r = generateTaxReport(merged(y2025), rates, 2024);
    expect(r.messages.some((x) => x.id === MSG_ID)).toBe(false);
  });
});

describe("issue #438 — the real IBKR correction-only export", () => {
  // Posted 2023-01-24, dated on three 2022 dividend days: +0.66 / −0.53 each,
  // so 0.13 USD refunded per day, 0.39 USD in all.
  const xml = readFileSync(new URL("../fixtures/ibkr-withholding-correction-only.xml", import.meta.url), "utf-8");
  const st = merged(ibkrParser.parse(xml));
  const rates = rateMap(2021, 2023, "0.92");

  it("keeps the posting date of each row", () => {
    expect(st.cashTransactions.map((t) => t.reportDate)).toEqual(Array(6).fill("2023-01-24"));
  });

  it("the 2023 report warns about 2022's 0588", () => {
    const r: TaxSummary = generateTaxReport(st, rates, 2023);
    const m = r.messages.find((x) => x.id === MSG_ID);
    expect(m?.context).toEqual({ year: "2022", reportYear: "2023", amount: new Decimal("0.39").mul("0.92").toFixed(2) });
  });
});

// Review of #438: corrections the first fix still got wrong, end to end in the
// three FX methods. 0588 must be the net tax really paid, a refund must never
// vanish, and a correction of an earlier year must neither lower this year's
// 0588 nor go unreported.
describe("issue #438 — refunds that must go to the right dividend", () => {
  const rates = rateMap(2024, 2025);
  const cases: [string, string[], { gross: string; paid: string; d0588: string }][] = [
    [
      "the dividend itself is reversed and rebooked on other dates",
      [
        cash("Dividends", "10.00", "20250310"),
        cash("Withholding Tax", "-1.50", "20250310"),
        cash("Dividends", "-10.00", "20250314"),
        cash("Withholding Tax", "1.50", "20250314"),
        cash("Dividends", "10.00", "20250316"),
        cash("Withholding Tax", "-1.00", "20250316"),
      ],
      { gross: "9.00", paid: "0.90", d0588: "0.90" },
    ],
    [
      "a reclassification: reversed, then rebooked as 8.00 withheld 1.20 the same day",
      [
        cash("Dividends", "10.00", "20250310"),
        cash("Withholding Tax", "-1.50", "20250310"),
        cash("Dividends", "-10.00", "20250314"),
        cash("Withholding Tax", "1.50", "20250314"),
        cash("Dividends", "8.00", "20250314"),
        cash("Withholding Tax", "-1.20", "20250314"),
      ],
      { gross: "7.20", paid: "1.08", d0588: "1.08" },
    ],
    [
      "a payment in lieu listed first on the same day keeps its withholding",
      [
        cash("Payment In Lieu Of Dividends", "2.00", "20250310"),
        cash("Withholding Tax", "-0.30", "20250310"),
        cash("Dividends", "10.00", "20250310"),
        cash("Withholding Tax", "-1.50", "20250310"),
        cash("Withholding Tax", "0.50", "20250312"),
      ],
      { gross: "10.80", paid: "1.17", d0588: "1.17" },
    ],
    [
      "a refund nearer to a dividend that withheld less than it",
      [
        cash("Dividends", "10.00", "20250303"),
        cash("Withholding Tax", "-1.50", "20250303"),
        cash("Dividends", "2.00", "20250310"),
        cash("Withholding Tax", "-0.20", "20250310"),
        cash("Withholding Tax", "0.50", "20250307"),
      ],
      { gross: "10.80", paid: "1.08", d0588: "1.08" },
    ],
  ];
  for (const [label, rows, want] of cases) {
    for (const method of METHODS) {
      it(`${label} (${method})`, () => {
        const r = generateTaxReport(merged(statement(rows)), rates, 2025, reportOptionsForMethod(method));
        expect(r.dividends.grossIncome.toFixed(2)).toBe(want.gross);
        expect(r.doubleTaxation.byCountry.US!.taxPaid.toFixed(2)).toBe(want.paid);
        expect(r.doubleTaxation.deduction.toFixed(2)).toBe(want.d0588);
        for (const e of r.dividends.entries) expect(e.withholdingTaxEur.isNegative()).toBe(false);
      });
    }
  }
});

describe("issue #438 — an earlier year's correction counts once, in the right year", () => {
  const rates = rateMap(2023, 2025);
  const warnings = (r: TaxSummary) => r.messages.filter((x) => x.id === MSG_ID).map((x) => x.context);

  // Weekly payer: 2024-12-27 withheld 1.50; the 2025 statement corrects it to
  // 1.00 (rows dated 2024-12-27, posted 2025-01-20) and has the next weekly
  // dividend, 2025-01-03, exactly 7 days later, withheld 1.50.
  const w2024 = statement([cash("Dividends", "10.00", "20241227"), cash("Withholding Tax", "-1.50", "20241227")], "20240101", "20241231");
  const w2025 = statement(
    [
      cash("Dividends", "10.00", "20250103"),
      cash("Withholding Tax", "-1.50", "20250103"),
      cash("Withholding Tax", "1.50", "20241227", "20250120"),
      cash("Withholding Tax", "-1.00", "20241227", "20250120"),
    ],
    "20250101",
    "20251231",
  );
  for (const method of METHODS) {
    it(`weekly payer, 2025 file only: 2025's 0588 keeps its 1.35 and the 0.45 goes to the warning (${method})`, () => {
      const r = generateTaxReport(merged(w2025), rates, 2025, reportOptionsForMethod(method));
      expect(r.doubleTaxation.deduction.toFixed(2)).toBe("1.35");
      expect(warnings(r)).toEqual([{ year: "2024", reportYear: "2025", amount: "0.45" }]);
    });
    it(`weekly payer, both files: 2024 = 0.90, 2025 = 1.35 plus the warning (${method})`, () => {
      const both = merged(w2024, w2025);
      expect(generateTaxReport(both, rates, 2024, reportOptionsForMethod(method)).doubleTaxation.deduction.toFixed(2)).toBe("0.90");
      const r = generateTaxReport(both, rates, 2025, reportOptionsForMethod(method));
      expect(r.doubleTaxation.deduction.toFixed(2)).toBe("1.35");
      expect(warnings(r)).toEqual([{ year: "2024", reportYear: "2025", amount: "0.45" }]);
    });
  }

  // A refund dated in January (its own booking day) for a late-December dividend.
  const j2024 = statement([cash("Dividends", "10.00", "20241230"), cash("Withholding Tax", "-1.50", "20241230")], "20240101", "20241231");
  const j2025 = statement([cash("Withholding Tax", "0.50", "20250103")]);
  for (const method of METHODS) {
    it(`a January refund of a December dividend warns, alone or with 2024's file (${method})`, () => {
      const alone = generateTaxReport(merged(j2025), rates, 2025, reportOptionsForMethod(method));
      expect(warnings(alone)).toEqual([{ year: "2024", reportYear: "2025", amount: "0.45" }]);
      const both = merged(j2024, j2025);
      expect(generateTaxReport(both, rates, 2024, reportOptionsForMethod(method)).doubleTaxation.deduction.toFixed(2)).toBe("0.90");
      const r2025 = generateTaxReport(both, rates, 2025, reportOptionsForMethod(method));
      expect(r2025.doubleTaxation.deduction.toFixed(2)).toBe("0.00");
      expect(warnings(r2025)).toEqual([{ year: "2024", reportYear: "2025", amount: "0.45" }]);
    });
  }

  // The 2025 file has a refund of a June 2024 withholding and a dividend paid
  // on 2024-12-31 but posted 2025-01-02, with its own withholding. That
  // withholding was never in 2024's file, so it must not offset the refund.
  const d2025 = statement([
    cash("Withholding Tax", "0.50", "20240610", "20250115"),
    cash("Dividends", "10.00", "20241231", "20250102"),
    cash("Withholding Tax", "-1.50", "20241231", "20250102"),
  ]);
  for (const method of METHODS) {
    it(`a dividend posted late brings its own withholding, which never hides a refund (${method})`, () => {
      const r = generateTaxReport(merged(d2025), rates, 2025, reportOptionsForMethod(method));
      expect(warnings(r)).toEqual([{ year: "2024", reportYear: "2025", amount: "0.45" }]);
    });
  }
});

describe("issue #438 — the prior-year warning names the box the withholding went to", () => {
  const SPANISH_ID = "report.spanish_withholding_corrected_prior_year";
  const rates = rateMap(2023, 2025);
  /** A Telefónica (Spanish issuer, EUR) IBKR cash row. */
  const tef = (type: string, amount: string, date: string, reportDate = date) =>
    `<CashTransaction transactionID="${id++}" accountId="U1" symbol="TEF" description="TEF(ES0178430E18) CASH DIVIDEND EUR 0.15 PER SHARE${type === "Withholding Tax" ? " - ES TAX" : ""}" isin="ES0178430E18" currency="EUR" dateTime="${date};202000" settleDate="${date}" reportDate="${reportDate}" amount="${amount}" fxRateToBase="1" type="${type}" levelOfDetail="DETAIL" />`;
  const t2024 = statement([tef("Dividends", "15.00", "20241210"), tef("Withholding Tax", "-2.85", "20241210")], "20240101", "20241231");
  // IBKR re-posts the Spanish 19% as 15% in 2025, dated on the dividend's day.
  const t2025 = statement([tef("Withholding Tax", "2.85", "20241210", "20250120"), tef("Withholding Tax", "-2.25", "20241210", "20250120")]);

  for (const method of METHODS) {
    it(`a Spanish withholding's correction points to 0597, not 0588 (${method})`, () => {
      const r = generateTaxReport(merged(t2025), rates, 2025, reportOptionsForMethod(method));
      expect(r.messages.some((x) => x.id === MSG_ID)).toBe(false);
      const m = r.messages.filter((x) => x.id === SPANISH_ID);
      expect(m).toHaveLength(1);
      expect(m[0]!.severity).toBe("warning");
      expect(m[0]!.context).toEqual({ year: "2024", reportYear: "2025", amount: "0.60" });
      expect(m[0]!.message).toContain("0597");
      expect(m[0]!.message).not.toContain("0588");
      expect(m[0]!.hint).not.toContain("0588");
    });
  }

  it("with 2024's file too, 2024's 0597 is recomputed and 2025 still warns about 0597", () => {
    const both = merged(t2024, t2025);
    expect(generateTaxReport(both, rates, 2024).dividends.spanishWithholding.toFixed(2)).toBe("2.25");
    const r = generateTaxReport(both, rates, 2025);
    expect(r.messages.filter((x) => x.id === SPANISH_ID).map((x) => x.context)).toEqual([{ year: "2024", reportYear: "2025", amount: "0.60" }]);
    expect(r.messages.some((x) => x.id === MSG_ID)).toBe(false);
  });

  it("Spanish and foreign corrections in one file get one warning each", () => {
    const mixed = statement([
      tef("Withholding Tax", "2.85", "20241210", "20250120"),
      tef("Withholding Tax", "-2.25", "20241210", "20250120"),
      cash("Withholding Tax", "1.50", "20241210", "20250120"),
      cash("Withholding Tax", "-1.00", "20241210", "20250120"),
    ]);
    const r = generateTaxReport(merged(mixed), rates, 2025);
    expect(r.messages.filter((x) => x.id === SPANISH_ID).map((x) => x.context)).toEqual([{ year: "2024", reportYear: "2025", amount: "0.60" }]);
    expect(r.messages.filter((x) => x.id === MSG_ID).map((x) => x.context)).toEqual([{ year: "2024", reportYear: "2025", amount: "0.45" }]);
  });

  it("the Spanish text of the 0597 warning is the es locale's, byte for byte", () => {
    const r = generateTaxReport(merged(t2025), rates, 2025);
    const m = r.messages.find((x) => x.id === SPANISH_ID)!;
    const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_x, k: string) => m.context![k]!);
    expect(m.message).toBe(fill(es[SPANISH_ID as keyof typeof es] as string));
    expect(m.hint).toBe(fill(es[`${SPANISH_ID}.hint` as keyof typeof es] as string));
  });
});

describe("issue #438 — the warning values a refund the way the dividend's year does", () => {
  // USD is 0.90 in 2024 and 0.80 in 2025. A 2024-12-30 dividend withheld 1.50
  // gets a 0.50 refund dated 2025-01-03.
  const rates = rateMap(2023, 2024);
  for (const [day, fx] of rateMap(2025, 2025, "0.80")) rates.set(day, fx);
  const j2024 = statement([cash("Dividends", "10.00", "20241230"), cash("Withholding Tax", "-1.50", "20241230")], "20240101", "20241231");
  const j2025 = statement([cash("Withholding Tax", "0.50", "20250103")]);
  const warnings = (r: TaxSummary) => r.messages.filter((x) => x.id === MSG_ID).map((x) => x.context);

  it("matched to its dividend: the stated drop equals what 2024's 0588 loses (dividend-date rate)", () => {
    const both = merged(j2024, j2025);
    const filed = generateTaxReport(merged(j2024), rates, 2024).doubleTaxation.deduction;
    const recomputed = generateTaxReport(both, rates, 2024).doubleTaxation.deduction;
    expect(filed.minus(recomputed).toFixed(2)).toBe("0.45"); // 1.35 − 0.90
    expect(warnings(generateTaxReport(both, rates, 2025))).toEqual([{ year: "2024", reportYear: "2025", amount: "0.45" }]);
  });

  it("with no dividend in the data, the refund keeps its own date's rate", () => {
    expect(warnings(generateTaxReport(merged(j2025), rates, 2025))).toEqual([{ year: "2024", reportYear: "2025", amount: "0.40" }]);
  });
});

describe("issue #438 — the warning states what the earlier year loses when a late refund moves another one", () => {
  const warnings = (r: TaxSummary) => r.messages.filter((x) => x.id === MSG_ID).map((x) => x.context);
  /** What the 2025 rows take off 2024's 0588: 2024 filed with its own file, minus 2024 recomputed with both. */
  const drop = (y2024: ReturnType<typeof statement>, y2025: ReturnType<typeof statement>, rates: EcbRateMap) =>
    generateTaxReport(merged(y2024), rates, 2024)
      .doubleTaxation.deduction.minus(generateTaxReport(merged(y2024, y2025), rates, 2024).doubleTaxation.deduction)
      .toFixed(2);

  it("a late refund that pushes an earlier refund to another dividend: the warning is the whole drop", () => {
    // USD is 0.90 up to 2024-03-03 and 0.80 after. Dividends on 3 and 10 March
    // 2024 withheld 1.00 each; a 1.00 refund dated 8 March goes to 10 March
    // (nearest), so 2024 was filed with 0.90 (3 March). The 2025 file posts a
    // 1.00 refund dated 16 March 2024: it reaches only 10 March, so the 8 March
    // refund moves to 3 March and 2024's withholding falls from 0.90 to 0.
    const rates = rateMap(2023, 2025);
    for (const [day] of rates) if (day > "2024-03-03") rates.set(day, new Map([["USD", "0.80"]]));
    const y2024 = statement(
      [
        cash("Dividends", "10.00", "20240303"),
        cash("Withholding Tax", "-1.00", "20240303"),
        cash("Dividends", "10.00", "20240310"),
        cash("Withholding Tax", "-1.00", "20240310"),
        cash("Withholding Tax", "1.00", "20240308"),
      ],
      "20240101",
      "20241231",
    );
    const y2025 = statement([cash("Withholding Tax", "1.00", "20240316", "20250120")]);
    expect(drop(y2024, y2025, rates)).toBe("0.90");
    expect(warnings(generateTaxReport(merged(y2024, y2025), rates, 2025))).toEqual([{ year: "2024", reportYear: "2025", amount: "0.90" }]);
  });

  it("a late refund that pushes a filed refund onto this year's dividend: no drop in 2024, no warning", () => {
    // 2024: a 27 December dividend withheld 1.00, refunded by a 1.00 row dated
    // 30 December (2024 filed 0). 2025: a 3 January dividend withheld 1.00 and
    // a 1.00 refund dated 26 December 2024, posted 2025, which reaches only
    // 27 December. The 30 December refund moves to 3 January: 2024 stays 0,
    // and 2025's own 0588 loses the moved refund. Warning about 2024 too would
    // count the same refund twice.
    const rates = rateMap(2023, 2025);
    const y2024 = statement(
      [cash("Dividends", "10.00", "20241227"), cash("Withholding Tax", "-1.00", "20241227"), cash("Withholding Tax", "1.00", "20241230")],
      "20240101",
      "20241231",
    );
    const y2025 = statement([
      cash("Dividends", "10.00", "20250103"),
      cash("Withholding Tax", "-1.00", "20250103"),
      cash("Withholding Tax", "1.00", "20241226", "20250120"),
    ]);
    expect(drop(y2024, y2025, rates)).toBe("0.00");
    const r = generateTaxReport(merged(y2024, y2025), rates, 2025);
    expect(r.doubleTaxation.deduction.toFixed(2)).toBe("0.00");
    expect(warnings(r)).toEqual([]);
  });
});

describe("issue #438 — the warning leaves out a reversed dividend, as the report does", () => {
  const warnings = (r: TaxSummary) => r.messages.filter((x) => x.id === MSG_ID).map((x) => x.context);
  const drop = (y2024: ReturnType<typeof statement>, y2025: ReturnType<typeof statement>, rates: EcbRateMap) =>
    generateTaxReport(merged(y2024), rates, 2024)
      .doubleTaxation.deduction.minus(generateTaxReport(merged(y2024, y2025), rates, 2024).doubleTaxation.deduction)
      .toFixed(2);
  // USD is 0.90 up to 2024-03-03 and 0.80 after. The 3 March 2024 dividend is
  // reversed on its own day and rebooked on 10 March; its −1.50 withholding is
  // dated 3 March. The report cancels the dividend and its reversal, so the
  // withholding belongs to the rebooked dividend (2024 filed 1.50 × 0.80).
  const rates = rateMap(2023, 2025);
  for (const [day] of rates) if (day > "2024-03-03") rates.set(day, new Map([["USD", "0.80"]]));
  const y2024 = statement(
    [
      cash("Dividends", "10.00", "20240303"),
      cash("Dividends", "-10.00", "20240303"),
      cash("Dividends", "10.00", "20240310"),
      cash("Withholding Tax", "-1.50", "20240303"),
    ],
    "20240101",
    "20241231",
  );

  it("a late refund of the rebooked dividend's withholding is valued at the rebooked dividend's rate", () => {
    const y2025 = statement([cash("Withholding Tax", "0.50", "20240305", "20250120")]);
    expect(drop(y2024, y2025, rates)).toBe("0.40");
    expect(warnings(generateTaxReport(merged(y2024, y2025), rates, 2025))).toEqual([{ year: "2024", reportYear: "2025", amount: "0.40" }]);
  });

  it("a reversal posted next year: the filed dividend loses its whole withholding", () => {
    // 2024 filed the 3 March dividend with its 1.50 (× 0.90). The 2025 file
    // reverses it, dated on its day: recomputed, 2024 has no dividend and no
    // withholding.
    const filed = statement([cash("Dividends", "10.00", "20240303"), cash("Withholding Tax", "-1.50", "20240303")], "20240101", "20241231");
    const y2025 = statement([cash("Dividends", "-10.00", "20240303", "20250120"), cash("Withholding Tax", "1.50", "20240303", "20250120")]);
    expect(drop(filed, y2025, rates)).toBe("1.35");
    expect(warnings(generateTaxReport(merged(filed, y2025), rates, 2025))).toEqual([{ year: "2024", reportYear: "2025", amount: "1.35" }]);
    // The dividend reversal alone, with the withholding left in place: the
    // withholding has no dividend now, so 2024 loses it all the same.
    const onlyDividend = statement([cash("Dividends", "-10.00", "20240303", "20250120")]);
    expect(drop(filed, onlyDividend, rates)).toBe("1.35");
    expect(warnings(generateTaxReport(merged(filed, onlyDividend), rates, 2025))).toEqual([{ year: "2024", reportYear: "2025", amount: "1.35" }]);
  });

  it("a reversal and an identical rebook posted next year, withholding redone too: no drop, no warning", () => {
    // The 2025 file reverses the 3 March dividend and its withholding and books
    // both again, all dated 3 March 2024. The report cancels one dividend and
    // one withholding pair: 2024 is unchanged.
    const filed = statement([cash("Dividends", "10.00", "20240303"), cash("Withholding Tax", "-1.50", "20240303")], "20240101", "20241231");
    const y2025 = statement([
      cash("Dividends", "-10.00", "20240303", "20250120"),
      cash("Withholding Tax", "1.50", "20240303", "20250120"),
      cash("Dividends", "10.00", "20240303", "20250120"),
      cash("Withholding Tax", "-1.50", "20240303", "20250120"),
    ]);
    expect(drop(filed, y2025, rates)).toBe("0.00");
    expect(warnings(generateTaxReport(merged(filed, y2025), rates, 2025))).toEqual([]);
  });
});

describe("issue #467 — a refund dated more than 7 days from its dividend", () => {
  const UNJOINED_ID = "report.withholding_refund_unjoined";
  const rates = rateMap(2024, 2026);
  /** One IBKR cash row of any security; a Spanish ISIN is booked in EUR. */
  const row = (symbol: string, isin: string, type: string, amount: string, date: string, reportDate = date) => {
    const ccy = isin.startsWith("ES") ? "EUR" : "USD";
    const desc = `${symbol}(${isin}) CASH DIVIDEND ${ccy} 1 PER SHARE${type === "Withholding Tax" ? ` - ${isin.slice(0, 2)} TAX` : ""}`;
    return `<CashTransaction transactionID="${id++}" accountId="U1" symbol="${symbol}" description="${desc}" isin="${isin}" currency="${ccy}" dateTime="${date};202000" settleDate="${date}" reportDate="${reportDate}" amount="${amount}" fxRateToBase="${ccy === "EUR" ? "1" : "0.9"}" type="${type}" levelOfDetail="DETAIL" />`;
  };
  const MSFT = "US5949181045";
  const GOOG = "US02079K3059";
  const SAN = "ES0113900J37";
  const msft = (type: string, amount: string, date: string, reportDate?: string) => row("MSFT", MSFT, type, amount, date, reportDate);
  const goog = [row("GOOG", GOOG, "Dividends", "200", "20250901"), row("GOOG", GOOG, "Withholding Tax", "-20", "20250901")];
  const paid = [msft("Dividends", "100", "20250601"), msft("Withholding Tax", "-10", "20250601")];
  /** MSFT's dividend reversed with its withholding on `date`. */
  const reversed = (date: string) => [msft("Dividends", "-100", date), msft("Withholding Tax", "10", date)];
  const unjoined = (r: TaxSummary) => r.messages.find((m) => m.id === UNJOINED_ID);

  for (const method of METHODS) {
    const opts = reportOptionsForMethod(method);
    it(`control: reversed 3 days later, 0588 is GOOG's 20 USD = 18.00 € (${method})`, () => {
      const r = generateTaxReport(merged(statement([...paid, ...reversed("20250604"), ...goog])), rates, 2025, opts);
      expect(r.dividends.grossIncome.toFixed(2)).toBe("180.00");
      expect(r.doubleTaxation.deduction.toFixed(2)).toBe("18.00");
      expect(unjoined(r)).toBeUndefined();
    });

    it(`reversed 30 days later: the refund goes back to MSFT's dividend, 0588 = 18.00 € (${method})`, () => {
      const r = generateTaxReport(merged(statement([...paid, ...reversed("20250701"), ...goog])), rates, 2025, opts);
      expect(r.dividends.grossIncome.toFixed(2)).toBe("180.00");
      expect(r.doubleTaxation.deduction.toFixed(2)).toBe("18.00");
      expect(unjoined(r)).toBeUndefined();
    });

    it(`a Spanish dividend reversed 30 days later withholds nothing: 0597 = 0.00 (${method})`, () => {
      const r = generateTaxReport(
        merged(statement([row("SAN", SAN, "Dividends", "100", "20250601"), row("SAN", SAN, "Withholding Tax", "-19", "20250601"), row("SAN", SAN, "Dividends", "-100", "20250701"), row("SAN", SAN, "Withholding Tax", "19", "20250701")])),
        rates,
        2025,
        opts,
      );
      expect(r.dividends.grossIncome.toFixed(2)).toBe("0.00");
      expect(r.dividends.spanishWithholding.toFixed(2)).toBe("0.00");
      expect(unjoined(r)).toBeUndefined();
    });

    it(`a refund whose dividend is not in the data is named, and 0588 keeps the tax (${method})`, () => {
      const r = generateTaxReport(merged(statement([msft("Withholding Tax", "10", "20250701"), ...goog])), rates, 2025, opts);
      expect(r.doubleTaxation.deduction.toFixed(2)).toBe("18.00");
      expect(unjoined(r)?.severity).toBe("warning");
      expect(unjoined(r)?.context).toEqual({ count: "1", rows: "MSFT (01/07/2025, 10.00 USD)" });
    });

    it(`a refund larger than the tax its dividend still has: the rest is named (${method})`, () => {
      const r = generateTaxReport(merged(statement([...paid, msft("Withholding Tax", "15", "20250701"), ...goog])), rates, 2025, opts);
      expect(r.doubleTaxation.deduction.toFixed(2)).toBe("18.00");
      expect(unjoined(r)?.context).toEqual({ count: "1", rows: "MSFT (01/07/2025, 5.00 USD)" });
    });

    it(`a refund dated next year never lowers this year's 0588; next year's report names it (${method})`, () => {
      const both = merged(statement([msft("Dividends", "100", "20250901"), msft("Withholding Tax", "-10", "20250901"), msft("Withholding Tax", "10", "20260120")], "20250101", "20261231"));
      const r2025 = generateTaxReport(both, rates, 2025, opts);
      expect(r2025.doubleTaxation.deduction.toFixed(2)).toBe("9.00");
      expect(unjoined(r2025)).toBeUndefined();
      expect(unjoined(generateTaxReport(both, rates, 2026, opts))?.context).toEqual({ count: "1", rows: "MSFT (20/01/2026, 10.00 USD)" });
    });

    it(`a refund at another broker never lowers this broker's 0588 (${method})`, () => {
      let acc = createEmptyStatement();
      acc = mergeStatement(acc, statement(paid), ibkrParser.name);
      acc = mergeStatement(acc, statement([msft("Withholding Tax", "10", "20250701")]), "Other broker");
      const r = generateTaxReport(finalizeMergedStatement(acc), rates, 2025, opts);
      expect(r.doubleTaxation.deduction.toFixed(2)).toBe("9.00");
      expect(unjoined(r)?.context).toEqual({ count: "1", rows: "MSFT (01/07/2025, 10.00 USD)" });
    });

    it(`an IBKR late refund dated 19 days after its 2024 dividend lowers 2024 and warns in 2025 (${method})`, () => {
      const y2024 = statement([cash("Dividends", "10.00", "20240601"), cash("Withholding Tax", "-1.50", "20240601")], "20240101", "20241231");
      const y2025 = statement([cash("Withholding Tax", "0.50", "20240620", "20250120")]);
      const both = merged(y2024, y2025);
      expect(generateTaxReport(both, rates, 2024, opts).doubleTaxation.deduction.toFixed(2)).toBe("0.90");
      const r2025 = generateTaxReport(both, rates, 2025, opts);
      expect(r2025.messages.filter((m) => m.id === MSG_ID).map((m) => m.context)).toEqual([{ year: "2024", reportYear: "2025", amount: "0.45" }]);
      expect(unjoined(r2025)).toBeUndefined();
    });
  }

  it("the Spanish text is the es locale's, byte for byte", () => {
    const r = generateTaxReport(merged(statement([msft("Withholding Tax", "10", "20250701")])), rates, 2025);
    const m = unjoined(r)!;
    const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_x, k: string) => m.context![k]!);
    expect(m.message).toBe(fill(es[UNJOINED_ID as keyof typeof es] as string));
    expect(m.hint).toBe(fill(es[`${UNJOINED_ID}.hint` as keyof typeof es] as string));
  });
});
