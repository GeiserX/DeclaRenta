import { describe, it, expect } from "vitest";
import { scalableParser } from "../../src/parsers/scalable.js";
import { generateTaxReport } from "../../src/generators/report.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// End-to-end: a Scalable Capital cash/savings-account interest row drives the
// WHOLE pipeline (scalableParser.parse → generateTaxReport) and lands in the
// interest block → Casilla 0027 (Art. 25.2 LIRPF). Issue #48: a Scalable user's
// cash-account interest was in the CSV but silently dropped (the `if (!isin)
// continue` guard ran before classification). A NEGATIVE interest row is a
// cash-account charge → Casilla informational "intereses pagados al broker".
//
// EUR figures are pinned exactly. The interest is in EUR, so it auto-resolves
// at rate 1 — but we still pass an in-memory rate map (built like the other
// integration tests), and NO network fetch ever happens.
// ===========================================================================

const HEADER =
  "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency";

/** Build an in-memory ECB rate map (date → currency → "EUR per 1 FCY"). */
function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

describe("issue #48 e2e: Scalable cash interest → Casilla 0027", () => {
  // EUR rows resolve at 1; the map is passed only to match the real call shape.
  const rates = makeRateMap({ "2024-12-31": { USD: "1.05" } });

  it("a positive EUR interest row of 7,45 lands in interest.earned (0027)", () => {
    const csv = [
      HEADER,
      "2024-12-31;23:59;Executed;REF100;KKT-Abschluss;Cash;Interest;;0;0;7,45;0;0;EUR",
    ].join("\n");
    const statement = scalableParser.parse(csv);
    // IMPORTANT: signature is (statement, rateMap, year) — rate map is the 2nd arg.
    const report = generateTaxReport(statement, rates, 2024);

    expect(report.interest.earned.toFixed(2)).toBe("7.45");
    expect(report.interest.paid.toFixed(2)).toBe("0.00");
    const earned = report.interest.entries.filter((e) => e.type === "earned");
    expect(earned).toHaveLength(1);
  });

  it("a negative interest row increments interest.paid (intereses pagados al broker)", () => {
    const csv = [
      HEADER,
      "2024-12-31;23:59;Executed;REF101;KKT-Abschluss;Cash;Interest;;0;0;-4,20;0;0;EUR",
    ].join("\n");
    const statement = scalableParser.parse(csv);
    const report = generateTaxReport(statement, rates, 2024);

    // valueIncomeEur abs()'s the amount; the earned/paid split is by type.
    expect(report.interest.paid.toFixed(2)).toBe("4.20");
    expect(report.interest.earned.toFixed(2)).toBe("0.00");
    const paid = report.interest.entries.filter((e) => e.type === "paid");
    expect(paid).toHaveLength(1);
  });

  it("a mixed CSV (positive + negative interest) splits earned vs paid correctly", () => {
    const csv = [
      HEADER,
      "2024-03-31;23:59;Executed;REF102;KKT-Abschluss;Cash;Interest;;0;0;7,45;0;0;EUR",
      "2024-12-31;23:59;Executed;REF103;KKT-Abschluss;Cash;Interest;;0;0;-1,30;0;0;EUR",
    ].join("\n");
    const statement = scalableParser.parse(csv);
    const report = generateTaxReport(statement, rates, 2024);

    expect(report.interest.earned.toFixed(2)).toBe("7.45");
    expect(report.interest.paid.toFixed(2)).toBe("1.30");
  });

  it("a non-EUR (USD) interest row is converted to EUR at the ECB rate for 0027", () => {
    // 100 USD interest on 2024-12-31, ECB rate 1.05 EUR/USD → 105.00 EUR in 0027.
    // Proves the FCY conversion path (the EUR cases short-circuit at rate 1).
    const csv = [
      HEADER,
      "2024-12-31;23:59;Executed;REF104;KKT-Abschluss;Cash;Interest;;0;0;100,00;0;0;USD",
    ].join("\n");
    const statement = scalableParser.parse(csv);
    const report = generateTaxReport(statement, rates, 2024);

    expect(report.interest.earned.toFixed(2)).toBe("105.00");
  });
});
