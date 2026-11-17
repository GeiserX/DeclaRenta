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
