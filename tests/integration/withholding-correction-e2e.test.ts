import { describe, it, expect } from "vitest";
import { ibkrParser } from "../../src/parsers/ibkr.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import { generateTaxReport } from "../../src/generators/report.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// End-to-end: an IBKR withholding correction (issue #436).
// ---------------------------------------------------------------------------
// IBKR corrects a dividend withholding with three rows on the dividend's date:
// the original −1.50, its +1.50 reversal and the corrected −1.00. The net cash
// is 10.00 − 1.00 = 9.00 USD. The FX path used to net only the negative rows,
// so it opened a 7.50 lot plus a separate 1.50 lot, and a 4.00 USD conversion
// could show as two FX rows. Now the withholdings net with their sign: one
// 9.00 lot, one 4.00 row. 0029, 0588 and 1633/1637 match a file that carries
// only the clean −1.00 withholding.
// Rates are "EUR per 1 USD": 0.90 up to 2025-03-31, 0.95 after.
// ===========================================================================

function rateMap(): EcbRateMap {
  const m: EcbRateMap = new Map();
  const d = new Date("2025-01-01T00:00:00Z");
  while (d <= new Date("2025-12-31T00:00:00Z")) {
    const k = d.toISOString().slice(0, 10);
    m.set(k, new Map([["USD", k <= "2025-03-31" ? "0.90" : "0.95"]]));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return m;
}

let id = 1000;
function cash(type: string, amount: string, date = "20250310"): string {
  const desc = `AAPL(US0378331005) CASH DIVIDEND USD 0.25 PER SHARE${type === "Withholding Tax" ? " - US TAX" : ""}`;
  return `<CashTransaction transactionID="${id++}" accountId="U1" symbol="AAPL" description="${desc}" isin="US0378331005" currency="USD" dateTime="${date};202000" settleDate="${date}" reportDate="${date}" amount="${amount}" fxRateToBase="0.9" type="${type}" levelOfDetail="DETAIL" />`;
}

/** A USD→EUR conversion of 4.00 USD on 2025-04-15 (BUY EUR.USD). */
function conversion(): string {
  return `<Trade tradeID="${id++}" transactionID="${id++}" accountId="U1" symbol="EUR.USD" description="EUR.USD" isin="" assetCategory="CASH" currency="USD" tradeDate="20250415" settleDateTarget="20250415" dateTime="20250415;120000" quantity="3.60" tradePrice="1.1111" tradeMoney="4.00" proceeds="-4.00" cost="0" fifoPnlRealized="0" fxRateToBase="0.9" buySell="BUY" openCloseIndicator="" exchange="IDEALFX" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" notes="" levelOfDetail="EXECUTION" ibOrderID="${id++}" />`;
}

function report(cashRows: string[]) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Issue436" type="AF">
 <FlexStatements count="1">
  <FlexStatement accountId="U1" fromDate="20250101" toDate="20251231" period="Custom">
   <Trades>
${conversion()}
   </Trades>
   <CashTransactions>
${cashRows.join("\n")}
   </CashTransactions>
   <CorporateActions />
   <OpenPositions />
  </FlexStatement>
 </FlexStatements>
</FlexQueryResponse>
`;
  const stmt = finalizeMergedStatement(mergeStatement(createEmptyStatement(), ibkrParser.parse(xml), ibkrParser.name));
  return generateTaxReport(stmt, rateMap(), 2025, { fxTrace: true });
}

describe("issue #436 — IBKR withholding correction, end to end", () => {
  const corrected = report([
    cash("Dividends", "10.00"),
    cash("Withholding Tax", "-1.50"),
    cash("Withholding Tax", "1.50"),
    cash("Withholding Tax", "-1.00"),
  ]);
  const clean = report([cash("Dividends", "10.00"), cash("Withholding Tax", "-1.00")]);

  it("opens one 9.00 USD lot for the dividend", () => {
    const lots = (corrected.fxTrace ?? []).filter((t) => t.kind === "acquire");
    expect(lots).toHaveLength(1);
    expect(Number(lots[0]!.quantityFcy)).toBe(9);
    expect(lots[0]!.date).toBe("2025-03-10");
  });

  // With the withholding rows listed before the dividend, the old 1.50 lot came
  // first in FIFO and the conversion split into a 1.50 row and a 2.50 row.
  const reversalFirst = report([
    cash("Withholding Tax", "-1.50"),
    cash("Withholding Tax", "1.50"),
    cash("Withholding Tax", "-1.00"),
    cash("Dividends", "10.00"),
  ]);

  it.each([
    ["dividend first", corrected],
    ["withholding rows first", reversalFirst],
  ])("the 4.00 USD conversion is one FX row from that lot (%s)", (_label, r) => {
    const rows = r.fxGains.disposals;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quantity.toFixed(2)).toBe("4.00");
    expect(rows[0]!.acquireDate).toBe("2025-03-10");
    expect(rows[0]!.proceedsEur.toFixed(2)).toBe("3.80"); // 4 × 0.95
    expect(rows[0]!.costBasisEur.toFixed(2)).toBe("3.60"); // 4 × 0.90
  });

  it("0029, 0588 and 1633/1637 equal the clean −1.00 file", () => {
    expect(corrected.dividends.grossIncome.toFixed(2)).toBe("9.00");
    expect(corrected.doubleTaxation.deduction.toFixed(2)).toBe("0.90");
    expect(corrected.dividends.grossIncome.toFixed(4)).toBe(clean.dividends.grossIncome.toFixed(4));
    expect(corrected.doubleTaxation.deduction.toFixed(4)).toBe(clean.doubleTaxation.deduction.toFixed(4));
    expect(corrected.fxGains.transmissionValue.toFixed(4)).toBe(clean.fxGains.transmissionValue.toFixed(4));
    expect(corrected.fxGains.acquisitionValue.toFixed(4)).toBe(clean.fxGains.acquisitionValue.toFixed(4));
    expect(corrected.fxGains.disposals).toHaveLength(clean.fxGains.disposals.length);
  });

  it("the FX conservation check stays silent", () => {
    expect(corrected.messages.some((m) => m.id === "fx.conservation_mismatch")).toBe(false);
  });
});
