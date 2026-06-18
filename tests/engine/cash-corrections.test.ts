import { describe, it, expect } from "vitest";
import { collapseCorrections } from "../../src/engine/cash-corrections.js";
import { calculateDividends } from "../../src/engine/dividends.js";
import type { CashTransaction } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// Broker correction/reversal collapsing (Giovanni's bug, issue: DEGIRO
// duplicate dividend + storno). A duplicated cash movement and its opposite-
// sign reversal must cancel BEFORE the dividend/interest engines run, so the
// real payment nets correctly in both the gross (0029) and the withholding —
// instead of the reversal being .abs()'d into an addition that triples the
// retención (€19 → €57).
// ===========================================================================

function makeCashTx(overrides: Partial<CashTransaction>): CashTransaction {
  return {
    transactionID: "1",
    accountId: "U1",
    symbol: "TEF",
    description: "TELEFONICA Dividendo",
    isin: "ES0178430E18",
    currency: "EUR",
    dateTime: "2025-06-10",
    settleDate: "2025-06-10",
    amount: "100",
    fxRateToBase: "1",
    type: "Dividends",
    ...overrides,
  };
}

function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

describe("collapseCorrections", () => {
  it("cancels an exact opposite-sign reversal pair (duplicate dividend + storno)", () => {
    const txs: CashTransaction[] = [
      makeCashTx({ transactionID: "d1", amount: "100" }), // real
      makeCashTx({ transactionID: "d2", amount: "100" }), // duplicate
      makeCashTx({ transactionID: "d3", amount: "-100" }), // reversal
    ];
    const out = collapseCorrections(txs);
    // The duplicate (+100) and the reversal (−100) annihilate; the real +100 survives.
    expect(out).toHaveLength(1);
    expect(out[0]!.transactionID).toBe("d1");
    expect(out[0]!.amount).toBe("100");
  });

  it("cancels a withholding reversal pair, leaving the single real withholding", () => {
    const txs: CashTransaction[] = [
      makeCashTx({ transactionID: "w1", amount: "-19", type: "Withholding Tax" }),
      makeCashTx({ transactionID: "w2", amount: "-19", type: "Withholding Tax" }), // duplicate
      makeCashTx({ transactionID: "w3", amount: "19", type: "Withholding Tax" }), // reversal
    ];
    const out = collapseCorrections(txs);
    expect(out).toHaveLength(1);
    expect(out[0]!.amount).toBe("-19"); // one real −19 retención survives
  });

  it("does NOT cancel two same-sign rows (genuine duplicate payments are ambiguous)", () => {
    // Two real −19 withholdings on two real dividends are NOT a reversal pair.
    const txs: CashTransaction[] = [
      makeCashTx({ transactionID: "w1", amount: "-19", type: "Withholding Tax" }),
      makeCashTx({ transactionID: "w2", amount: "-19", type: "Withholding Tax" }),
    ];
    const out = collapseCorrections(txs);
    expect(out).toHaveLength(2); // untouched — conservative
  });

  it("is the identity on a stream with no reversals (byte-identical, same reference)", () => {
    const txs: CashTransaction[] = [
      makeCashTx({ transactionID: "d1", amount: "100" }),
      makeCashTx({ transactionID: "w1", amount: "-19", type: "Withholding Tax" }),
    ];
    const out = collapseCorrections(txs);
    expect(out).toBe(txs); // returns the same array reference when nothing cancels
  });

  it("does not pair across different (type, isin, currency, date, |amount|)", () => {
    const txs: CashTransaction[] = [
      makeCashTx({ transactionID: "a", amount: "100", isin: "ES0178430E18" }),
      makeCashTx({ transactionID: "b", amount: "-100", isin: "US0378331005" }), // different ISIN
      makeCashTx({ transactionID: "c", amount: "100", dateTime: "2025-06-10" }),
      makeCashTx({ transactionID: "d", amount: "-100", dateTime: "2025-09-10" }), // different date
      makeCashTx({ transactionID: "e", amount: "50", type: "Withholding Tax" }),
      makeCashTx({ transactionID: "f", amount: "-30", type: "Withholding Tax" }), // different magnitude
    ];
    const out = collapseCorrections(txs);
    expect(out).toHaveLength(6); // no key matches → nothing cancels
  });

  it("preserves order and keeps the EARLIEST of identical survivors", () => {
    const txs: CashTransaction[] = [
      makeCashTx({ transactionID: "keep-before", amount: "50" }),
      makeCashTx({ transactionID: "first100", amount: "100" }),
      makeCashTx({ transactionID: "rev", amount: "-100" }),
      makeCashTx({ transactionID: "second100", amount: "100" }),
      makeCashTx({ transactionID: "keep-after", amount: "70" }),
    ];
    const out = collapseCorrections(txs).map((t) => t.transactionID);
    // One +100/−100 pair cancels; the EARLIEST +100 (first100) is kept and the
    // later one is cancelled with rev. The two distinct-amount rows are untouched
    // and order is preserved. (first100 and second100 are identical-key rows, so
    // which survives is economically irrelevant; keeping the earliest is the
    // intended, matcher-friendly choice.)
    expect(out).toEqual(["keep-before", "first100", "keep-after"]);
  });
});

describe("calculateDividends with collapsed corrections (Giovanni's full DEGIRO case)", () => {
  it("nets a duplicate dividend + reversal to ONE gross and ONE withholding (€100 / €19, not 3×)", () => {
    const rates = makeRateMap({ "2025-06-10": { EUR: "1" } });
    const raw: CashTransaction[] = [
      makeCashTx({ transactionID: "d1", amount: "100", type: "Dividends" }),
      makeCashTx({ transactionID: "d2", amount: "100", type: "Dividends" }), // duplicate
      makeCashTx({ transactionID: "d3", amount: "-100", type: "Dividends" }), // reversal
      makeCashTx({ transactionID: "w1", amount: "-19", type: "Withholding Tax" }),
      makeCashTx({ transactionID: "w2", amount: "-19", type: "Withholding Tax" }), // duplicate
      makeCashTx({ transactionID: "w3", amount: "19", type: "Withholding Tax" }), // reversal
    ];
    const entries = calculateDividends(collapseCorrections(raw), rates);
    // One real dividend survives, with one real withholding.
    expect(entries).toHaveLength(1);
    expect(entries[0]!.grossAmountEur.toFixed(2)).toBe("100.00");
    expect(entries[0]!.withholdingTaxEur.toFixed(2)).toBe("19.00"); // NOT 57.00
    const totalGross = entries.reduce((s, e) => s.plus(e.grossAmountEur), entries[0]!.grossAmountEur.minus(entries[0]!.grossAmountEur));
    expect(totalGross.toFixed(2)).toBe("100.00");
  });

  it("WITHOUT collapsing, the same input triples the withholding (pins the bug it fixes)", () => {
    const rates = makeRateMap({ "2025-06-10": { EUR: "1" } });
    const raw: CashTransaction[] = [
      makeCashTx({ transactionID: "d1", amount: "100", type: "Dividends" }),
      makeCashTx({ transactionID: "d2", amount: "100", type: "Dividends" }),
      makeCashTx({ transactionID: "d3", amount: "-100", type: "Dividends" }),
      makeCashTx({ transactionID: "w1", amount: "-19", type: "Withholding Tax" }),
      makeCashTx({ transactionID: "w2", amount: "-19", type: "Withholding Tax" }),
      makeCashTx({ transactionID: "w3", amount: "19", type: "Withholding Tax" }),
    ];
    const entries = calculateDividends(raw, rates); // no collapse
    const total = entries.reduce((s, e) => s.plus(e.withholdingTaxEur), entries[0]!.withholdingTaxEur.minus(entries[0]!.withholdingTaxEur));
    expect(total.toFixed(2)).toBe("57.00"); // the bug: 3 × |19|, abs destroys the reversal's sign
  });
});
