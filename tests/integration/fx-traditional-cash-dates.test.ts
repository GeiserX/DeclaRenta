/**
 * «Tradicional con divisa» (issue #434), R0: in this mode every FX event is
 * dated on its trade date and settlement dates are not read. A cash row (fee,
 * interest, dividend, withholding) therefore goes on its `dateTime`, not on its
 * `settleDate`. A USD fee charged on 31 December that settles on 2 January
 * belongs to the earlier year. The withholding netting key follows the same
 * date as the income it nets into. The default keeps settlement dating.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { FxFifoEngine } from "../../src/engine/fx-fifo.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { toStatement, TRAD, type Scenario } from "./fx-traditional-harness.js";
import type { CashTransaction } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

const f2 = (d: Decimal) => d.toFixed(2);

// Fund 1000 USD at 0.80; a 10 USD fee on 2025-12-31 (0.90) that settles on 2026-01-02 (0.95).
const feeAcrossYear: Scenario = {
  id: "CASH-R0",
  years: [2025, 2026],
  closed: false,
  ev: [
    { k: "fund", d: "2025-12-01", usd: "1000", r: "0.80" },
    { k: "fee", d: "2025-12-31", usd: "10", r: "0.90" },
    { k: "fee", d: "2026-01-02", usd: "0", r: "0.95" },
  ],
};

function feeSettledInJanuary() {
  const { st, rates } = toStatement(feeAcrossYear);
  for (const c of st.cashTransactions) if (c.type === "Other Fees") c.settleDate = "20260102";
  return { st, rates };
}

describe("cash rows are dated by their trade date in «Tradicional con divisa»", () => {
  it("a fee charged on 31 December books in that year, at that day's rate", () => {
    const { st, rates } = feeSettledInJanuary();
    const y25 = generateTaxReport(st, rates, 2025, TRAD);
    const y26 = generateTaxReport(st, rates, 2026, TRAD);
    const fee25 = y25.fxGains.disposals.filter((d) => d.trigger === "commission");
    expect(fee25.map((d) => d.disposeDate)).toEqual(["2025-12-31"]);
    expect(f2(fee25[0]!.proceedsEur)).toBe("9.00");
    expect(f2(y25.fxGains.netGainLoss)).toBe("1.00");
    expect(y26.fxGains.disposals.filter((d) => d.trigger === "commission")).toEqual([]);
  });

  it("the default still dates the fee by its settlement (unchanged)", () => {
    const { st, rates } = feeSettledInJanuary();
    const y25 = generateTaxReport(st, rates, 2025, {});
    const y26 = generateTaxReport(st, rates, 2026, {});
    expect(y25.fxGains.disposals.filter((d) => d.trigger === "commission")).toEqual([]);
    const fee26 = y26.fxGains.disposals.filter((d) => d.trigger === "commission");
    expect(fee26.map((d) => d.disposeDate)).toEqual(["2026-01-02"]);
    expect(f2(fee26[0]!.proceedsEur)).toBe("9.50");
  });
});

describe("the withholding nets into its dividend on the same date basis", () => {
  const rates: EcbRateMap = new Map([
    ["2025-12-31", new Map([["USD", "0.90"]])],
    ["2026-01-02", new Map([["USD", "0.95"]])],
  ]);
  const row = (o: Partial<CashTransaction>): CashTransaction => ({
    transactionID: "1",
    accountId: "U1",
    symbol: "AAA",
    description: "AAA",
    isin: "US0000000AA1",
    currency: "USD",
    dateTime: "20251231;202000",
    settleDate: "20260102",
    amount: "100",
    fxRateToBase: "1",
    type: "Dividends",
    ...o,
  });
  // IBKR books the dividend and its US tax on the same day; here the tax row
  // settles on another day than the dividend.
  const cash = [
    row({}),
    row({ transactionID: "2", amount: "-15", type: "Withholding Tax", settleDate: "20251231" }),
  ];

  it("«Tradicional con divisa»: one net 85 USD lot on the trade date", () => {
    const ev = FxFifoEngine.extractCashFxEvents(cash, rates, { traditionalFx: true });
    expect(ev.map((e) => [e.date, e.quantity.toString(), e.ecbRate.toString()])).toEqual([["2025-12-31", "85", "0.9"]]);
  });

  it("default: keyed by settlement, unchanged (the tax row is an orphan, the lot stays gross)", () => {
    const ev = FxFifoEngine.extractCashFxEvents(cash, rates);
    expect(ev.map((e) => [e.date, e.quantity.toString(), e.ecbRate.toString()])).toEqual([["2026-01-02", "100", "0.95"]]);
  });
});
