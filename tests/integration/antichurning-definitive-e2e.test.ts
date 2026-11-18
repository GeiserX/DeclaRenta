import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { formatReport } from "../../src/cli/format-report.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { FxMethod } from "../../src/types/tax.js";
import type { CorporateAction, FlexStatement, Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { FifoDisposal } from "../../src/types/tax.js";

// ===========================================================================
// Issue #451: a deferred anti-churning loss is released only on a «transmisión
// definitiva» of homogeneous shares, oldest pending loss first, counted in shares.
//
// Each block below is the facts of a DGT consulta (or of the issue), run through
// the REAL generateTaxReport. "Fiscal" is the year's capital-gains contribution,
// `netGainLoss + blockedLosses − reintegratedLosses` (report.ts). Every buy is at
// 10 EUR unless stated, and each sale's price is set so that its FIFO result is
// the one the consulta states.
// ===========================================================================

/** [date, side, quantity, total EUR amount of the trade, optional ISIN] */
type Op = [date: string, side: "BUY" | "SELL", qty: number, amount: number, isin?: string];

const ISIN = "ES0000004511";

function trade(op: Op, n: number, currency: string): Trade {
  const [date, side, qty, amount, isin = ISIN] = op;
  const money = new Decimal(amount).toString();
  return {
    tradeID: `t${n}`, accountId: "U1", symbol: isin === ISIN ? "XYZ" : isin.slice(-4), description: "XYZ SA", isin, assetCategory: "STK",
    currency, tradeDate: date, settlementDate: date,
    quantity: String(side === "BUY" ? qty : -qty),
    tradePrice: new Decimal(amount).div(qty).toString(),
    tradeMoney: side === "BUY" ? money : `-${money}`,
    proceeds: side === "BUY" ? `-${money}` : money,
    cost: money, fifoPnlRealized: "0", fxRateToBase: "1", buySell: side,
    openCloseIndicator: side === "BUY" ? "O" : "C", exchange: "BME", commissionCurrency: currency,
    commission: "0", taxes: "0", multiplier: "1",
  };
}

function statement(ops: Op[], currency = "EUR", corporateActions: CorporateAction[] = []): FlexStatement {
  return {
    accountId: "U1", fromDate: "20070101", toDate: "20261231", period: "Annual",
    trades: ops.map((o, i) => trade(o, i, currency)),
    cashTransactions: [], corporateActions, openPositions: [], securitiesInfo: [],
  };
}

function rates(ops: Op[], usd = "1.10"): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date] of ops) map.set(date, new Map([["USD", usd]]));
  return map;
}

interface YearResult {
  fiscal: string;
  blocked: string;
  reintegrated: string;
  /** Unrounded totals, for sums across years (round only the final sum). */
  blockedEur: Decimal;
  reintegratedEur: Decimal;
  disposals: FifoDisposal[];
}

function year(
  ops: Op[],
  y: number,
  method: FxMethod = "monodivisa",
  currency = "EUR",
  corporateActions: CorporateAction[] = [],
): YearResult {
  const report = generateTaxReport(statement(ops, currency, corporateActions), rates(ops), y, reportOptionsForMethod(method));
  const cg = report.capitalGains;
  return {
    fiscal: cg.netGainLoss.plus(cg.blockedLosses).minus(cg.reintegratedLosses).toFixed(2),
    blocked: cg.blockedLosses.toFixed(2),
    reintegrated: cg.reintegratedLosses.toFixed(2),
    blockedEur: cg.blockedLosses,
    reintegratedEur: cg.reintegratedLosses,
    disposals: cg.disposals,
  };
}

/** Σ over the disposals sold on `date` of one field. */
function onDate(r: YearResult, date: string, field: "blockedLossEur" | "reintegratedLossEur"): string {
  return r.disposals
    .filter((d) => d.sellDate === date)
    .reduce((s, d) => s.plus(d[field]), new Decimal(0))
    .toFixed(2);
}

/** A sale of `qty` shares bought at 10 whose FIFO result is `gain`. */
const sell = (date: string, qty: number, gain: number): Op => [date, "SELL", qty, qty * 10 + gain];
const buy = (date: string, qty: number, price = 10): Op => [date, "BUY", qty, qty * price];

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];

// ---------------------------------------------------------------------------
// The issue's example: two churned sales, the second rebought again.
// ---------------------------------------------------------------------------
describe("#451 issue example: a sale rebought in its own window keeps the earlier loss deferred", () => {
  const ops: Op[] = [
    ["2025-09-01", "BUY", 1, 100], ["2025-10-01", "SELL", 1, 80], ["2025-10-05", "BUY", 1, 75],
    ["2025-10-10", "SELL", 1, 70], ["2025-10-25", "BUY", 1, 72],
  ];
  const withExit: Op[] = [...ops, ["2026-03-01", "SELL", 1, 73]];

  it.each(METHODS)("2025 [%s]: 0 deductible, 25 blocked, nothing released (EUR)", (method) => {
    const r = year(ops, 2025, method);
    expect(r.fiscal).toBe("0.00");
    expect(r.blocked).toBe("25.00");
    expect(r.reintegrated).toBe("0.00");
    expect(onDate(r, "2025-10-01", "blockedLossEur")).toBe("20.00");
    expect(onDate(r, "2025-10-10", "blockedLossEur")).toBe("5.00");
    expect(onDate(r, "2025-10-10", "reintegratedLossEur")).toBe("0.00");
  });

  it.each(METHODS)("2025 [%s]: the same in USD at a flat 1.10 (27.50 blocked, 0 deductible)", (method) => {
    const r = year(ops, 2025, method, "USD");
    expect(r.fiscal).toBe("0.00");
    expect(r.blocked).toBe("27.50");
    expect(r.reintegrated).toBe("0.00");
  });

  it("2026: selling C with no rebuy releases both pending losses (25), which names the sales they came from", () => {
    const r = year(withExit, 2026);
    expect(r.reintegrated).toBe("25.00");
    expect(r.fiscal).toBe("-24.00");
    expect(r.disposals[0]!.washSaleReleasedFromDates).toEqual(["2025-10-01", "2025-10-10"]);
  });

  it("the CLI JSON names the amounts per operation: 2025 blocks 20 + 5, the 2026 sale releases 25", () => {
    const ops2025 = formatReport(generateTaxReport(statement(withExit), rates(withExit), 2025)).operaciones;
    expect(ops2025.map((o) => o.perdida_bloqueada_eur)).toEqual(["20.00", "5.00"]);
    const ops2026 = formatReport(generateTaxReport(statement(withExit), rates(withExit), 2026)).operaciones;
    expect(ops2026.map((o) => o.perdida_reintegrada_eur)).toEqual(["25.00"]);
  });

  it("the lifetime total is the raw result: 2025 + 2026 fiscal = −25 + 1", () => {
    const total = new Decimal(year(withExit, 2025).fiscal).plus(year(withExit, 2026).fiscal);
    expect(total.toFixed(2)).toBe("-24.00");
  });
});

// ---------------------------------------------------------------------------
// V3282-18 (28/12/2018): the gain sales of 31/03 and 05/04 are rebought, so no
// sale of 2017 is definitive and both losses (500 + 600) stay deferred.
// ---------------------------------------------------------------------------
describe("DGT V3282-18: rebought gain sales are not definitive (2017: 900)", () => {
  const ops: Op[] = [
    buy("2017-02-05", 4000), sell("2017-02-08", 4000, 400),
    buy("2017-02-15", 4000), sell("2017-02-20", 2000, -500),
    buy("2017-03-15", 2000), buy("2017-03-20", 2000), buy("2017-03-24", 2000),
    sell("2017-03-26", 2000, -600), buy("2017-03-28", 2000), sell("2017-03-31", 2000, 400),
    buy("2017-04-01", 2000), sell("2017-04-05", 2000, 100),
  ];

  it("releases nothing in 2017: fiscal = 400 + 400 + 100", () => {
    const r = year(ops, 2017);
    expect(r.reintegrated).toBe("0.00");
    expect(r.blocked).toBe("1100.00");
    expect(r.fiscal).toBe("900.00");
  });
});

// ---------------------------------------------------------------------------
// V2481-20 (21/07/2020): the losses of 20/04 and 22/04 are rebought; the later
// gain sales are not definitive. The DGT integrates neither loss in 2020
// (fiscal 1,767) because of the 1,900 shares bought on 06/05.
//
// KNOWN GAP. The engine gets the 23/04 sales right (not definitive) but
// releases 687.56 on 29/04 (fiscal 1,079.44). Most of it, 672.29, comes from
// the same-day exclusion: the 22/04 loss is rebought the same day (920 shares),
// but brokers give no intraday times, so the engine skips same-day buys and
// takes 905 of the 27/04 purchase instead. The 23/04 sales then use 945 of the
// 06/05 purchase, and only 955 of it are left for the 1,880 shares sold on
// 29/04. Counting same-day buys would give 1,751.73; the last 15.27 is the
// rebuy pick order (post-sale buys first). Both are tracked apart from #451.
// ---------------------------------------------------------------------------
describe("DGT V2481-20: rebought gain sales keep the losses deferred", () => {
  // The 14/04 and 23/04 sales span several FIFO lots at different stated
  // results; every buy is at 10 and each sale's total is qty × 10 + result.
  const ops: Op[] = [
    buy("2020-03-25", 695), buy("2020-04-07", 535), sell("2020-04-14", 1230, 644),
    buy("2020-04-14", 1000), buy("2020-04-20", 880), sell("2020-04-20", 880, -672),
    buy("2020-04-21", 905), sell("2020-04-22", 905, -313), buy("2020-04-22", 920),
    sell("2020-04-23", 920, 119), sell("2020-04-23", 1000, 397),
    buy("2020-04-27", 1880), sell("2020-04-29", 1880, 607), buy("2020-05-06", 1900),
  ];

  it("blocks both losses and releases nothing on the rebought 23/04 gain sales", () => {
    const r = year(ops, 2020);
    expect(r.blocked).toBe("985.00");
    expect(onDate(r, "2020-04-23", "reintegratedLossEur")).toBe("0.00");
  });

  // Engine today: 29/04 releases 687.56, fiscal 1,079.44 (see above).
  it.fails("known gap: the DGT releases nothing in 2020 (fiscal 1,767)", () => {
    const r = year(ops, 2020);
    expect(onDate(r, "2020-04-29", "reintegratedLossEur")).toBe("0.00");
    expect(r.fiscal).toBe("1767.00");
  });
});

// ---------------------------------------------------------------------------
// V0248-18 (05/02/2018): one loss sale (16/02) and three gain sales, each with
// unused purchases in its window, taken in date order: 25/04 uses the 3,000 of
// 31/03, 28/04 the 5,000 of 18/03 (2,000 needed), and 29/05 the 3,000 + 4,000
// left. No sale of 2017 is definitive, so the 800 stays deferred (fiscal 900).
//
// KNOWN GAP, rebuy pick order only (no same-day buy is involved). The engine
// takes post-sale buys first and pre-sale buys newest first: 16/02 takes
// 18/03, 25/04 takes 28/05, and 28/04 takes 1,000 of 28/05 plus 1,000 of
// 31/03. Only 2,000 are left for the 3,000 sold on 29/05, so 1,000 of them
// count as definitive and release 400 (fiscal 500). Taking the earliest
// unused buy first gives the DGT's answer. Tracked apart from #451.
// ---------------------------------------------------------------------------
describe("DGT V0248-18: gain sales use up rebuys in date order (2017: 900)", () => {
  const ops: Op[] = [
    buy("2016-10-07", 5000), buy("2017-02-15", 2000), sell("2017-02-16", 2000, -800),
    buy("2017-03-18", 5000), buy("2017-03-31", 3000), sell("2017-04-25", 3000, 500),
    sell("2017-04-28", 2000, 300), buy("2017-05-28", 4000), sell("2017-05-29", 3000, 100),
  ];

  it("blocks the 800 and releases nothing on the 25/04 and 28/04 gain sales", () => {
    const r = year(ops, 2017);
    expect(r.blocked).toBe("800.00");
    expect(onDate(r, "2017-04-25", "reintegratedLossEur")).toBe("0.00");
    expect(onDate(r, "2017-04-28", "reintegratedLossEur")).toBe("0.00");
  });

  // Engine today: 29/05 releases 400, fiscal 500 (see above).
  it.fails("known gap: the DGT releases nothing in 2017 (fiscal 900)", () => {
    const r = year(ops, 2017);
    expect(r.reintegrated).toBe("0.00");
    expect(r.fiscal).toBe("900.00");
  });
});

// ---------------------------------------------------------------------------
// V0571-21 (11/03/2021): 11/08 is not definitive; the definitive 25/12 sale of
// 3,000 shares releases the 800 of 05/07 and 1,000 of the 3,000 shares of 08/07.
// ---------------------------------------------------------------------------
describe("DGT V0571-21: a definitive sale releases the oldest pending losses by share count (2020: −1,166.67)", () => {
  const ops: Op[] = [
    buy("2020-07-04", 6000), sell("2020-07-05", 2000, -800), buy("2020-07-06", 5000),
    sell("2020-07-08", 3000, -500), sell("2020-07-09", 3000, -700),
    buy("2020-08-10", 3000), sell("2020-08-11", 2000, 0), buy("2020-08-11", 7000),
    sell("2020-12-25", 3000, -200),
  ];

  it("11/08 releases nothing; 25/12 releases 800 + 500 × 1,000/3,000", () => {
    const r = year(ops, 2020);
    expect(onDate(r, "2020-08-11", "reintegratedLossEur")).toBe("0.00");
    expect(onDate(r, "2020-12-25", "reintegratedLossEur")).toBe("966.67");
    expect(r.fiscal).toBe("-1166.67");
  });
});

// ---------------------------------------------------------------------------
// V1760-23 (19/06/2023): three definitive sales in July release 2,000, 3,000
// and 990 pending shares; selling the last 10 shares releases all the rest.
// ---------------------------------------------------------------------------
describe("DGT V1760-23: definitive sales release by share count, and the total exit releases the rest", () => {
  const ops: Op[] = [
    buy("2022-05-04", 6000), sell("2022-05-05", 2000, -800), buy("2022-05-06", 5000),
    sell("2022-05-09", 3000, -500), sell("2022-05-10", 3000, -700),
    buy("2022-06-10", 3000), sell("2022-06-17", 3000, -200), buy("2022-06-20", 3000),
    sell("2022-07-19", 2000, -250), sell("2022-07-20", 3000, -200), sell("2022-07-21", 990, -50),
    sell("2023-12-01", 10, 0),
  ];

  it("2022: 250 + 200 + 50 own losses, plus 800 + 500 + 700 × 990/3,000 released (−2,031)", () => {
    const r = year(ops, 2022);
    expect(onDate(r, "2022-07-19", "reintegratedLossEur")).toBe("800.00");
    expect(onDate(r, "2022-07-20", "reintegratedLossEur")).toBe("500.00");
    expect(onDate(r, "2022-07-21", "reintegratedLossEur")).toBe("231.00");
    expect(r.fiscal).toBe("-2031.00");
  });

  it("2023: the definitive sale of the last 10 shares releases everything left (469 + 200), no orphan", () => {
    const r = year(ops, 2023);
    expect(r.reintegrated).toBe("669.00");
    const lifetimeBlocked = new Decimal(year(ops, 2022).blocked).plus(r.blocked);
    const lifetimeReleased = new Decimal(year(ops, 2022).reintegrated).plus(r.reintegrated);
    expect(lifetimeReleased.toFixed(2)).toBe(lifetimeBlocked.toFixed(2));
  });
});

// ---------------------------------------------------------------------------
// V0754-26 (06/04/2026): six rebought 2025 loss sales; the definitive 2026 sale
// of 770 shares releases 190 + 195 + 200 + 185 of the 207 of 09/10, by date.
// The consulta gives no buy dates or amounts: each sale here is rebought within
// days by the same quantity, as the consulta states, and the last buy is 14/11.
// The engine matches only this timing, with every rebuy after its sale; the
// variant below, with the rebuys before the sales, is a known gap.
// ---------------------------------------------------------------------------
describe("DGT V0754-26: 2025 releases nothing; the 2026 definitive sale releases 770 shares oldest first", () => {
  const ops: Op[] = [
    buy("2025-07-01", 1000),
    sell("2025-08-01", 190, -190), buy("2025-08-05", 190),
    sell("2025-08-28", 195, -390), buy("2025-09-01", 195),
    sell("2025-09-11", 200, -100), buy("2025-09-15", 200),
    sell("2025-10-09", 207, -207), buy("2025-10-13", 207),
    sell("2025-10-17", 207, -414), buy("2025-10-20", 207),
    sell("2025-11-06", 225, -225), buy("2025-11-14", 225),
    sell("2026-02-11", 770, -77),
  ];

  it("2025: every loss stays deferred", () => {
    const r = year(ops, 2025);
    expect(r.reintegrated).toBe("0.00");
    expect(r.fiscal).toBe("0.00");
  });

  it("2026: own loss 77 plus 190 + 390 + 100 + 207 × 185/207 released (−942)", () => {
    const r = year(ops, 2026);
    expect(r.reintegrated).toBe("865.00");
    expect(r.fiscal).toBe("-942.00");
    expect([...new Set(r.disposals.flatMap((d) => d.washSaleReleasedFromDates ?? []))].sort()).toEqual([
      "2025-08-01", "2025-08-28", "2025-09-11", "2025-10-09",
    ]);
  });
});

// ---------------------------------------------------------------------------
// V0754-26 with each rebuy a few days BEFORE its sale (the consulta allows
// either: «en los dos meses anteriores o posteriores»; the last buy, 14/11,
// still follows the last sale). The DGT answer is the same: nothing in 2025.
//
// KNOWN GAP, rebuy pick order. The engine takes post-sale buys first, so each
// sale uses the NEXT sale's pre-sale rebuy, and the 06/11 sale finds only 30
// shares left: 195 definitive shares release 385 in 2025 (fiscal −775), and
// 2026 gives −1,331 instead of −942. Tracked apart from #451.
// ---------------------------------------------------------------------------
describe("DGT V0754-26, rebuys before the sales: 2025 releases nothing", () => {
  const ops: Op[] = [
    buy("2025-01-02", 1000),
    buy("2025-07-28", 190), sell("2025-08-01", 190, -190),
    buy("2025-08-25", 195), sell("2025-08-28", 195, -390),
    buy("2025-09-08", 200), sell("2025-09-11", 200, -100),
    buy("2025-10-06", 207), sell("2025-10-09", 207, -207),
    buy("2025-10-14", 207), sell("2025-10-17", 207, -414),
    sell("2025-11-06", 225, -225), buy("2025-11-14", 225),
    sell("2026-02-11", 770, -77),
  ];

  // Engine today: 2025 releases 385 (fiscal −775); 2026 fiscal −1,331.
  it.fails("known gap: 2025 releases nothing and 2026 gives −942, as with rebuys after the sales", () => {
    const r2025 = year(ops, 2025);
    expect(r2025.reintegrated).toBe("0.00");
    expect(r2025.fiscal).toBe("0.00");
    expect(year(ops, 2026).fiscal).toBe("-942.00");
  });
});

// ---------------------------------------------------------------------------
// V0913-08 (07/05/2008): the 01/04 sale of 965 shares has 10 shares rebought, so
// it is definitive for 955: it releases 955 pending shares of 15/02 and blocks
// its own loss on 10 shares. The 10 shares are not used twice.
// ---------------------------------------------------------------------------
describe("DGT V0913-08: one rebuy keeps 10 shares of the old deferral and blocks 10 of the new loss", () => {
  // The consulta leaves the price of the 30 shares bought on 05/04 blank; 900 here.
  const ops: Op[] = [
    ["2007-01-01", "BUY", 105, 105 * 950], ["2007-02-10", "BUY", 900, 900 * 1000],
    ["2007-02-15", "SELL", 1005, 1005 * 850], ["2007-03-01", "BUY", 950, 950 * 990],
    ["2007-03-10", "BUY", 15, 15 * 980], ["2007-04-01", "SELL", 965, 965 * 950],
    ["2007-04-05", "BUY", 30, 30 * 900], ["2007-04-16", "BUY", 10, 10 * 820],
  ];

  it("15/02 blocks 995 of 1,005 shares; 01/04 releases 955 of them and blocks 10 of its own", () => {
    const r = year(ops, 2007);
    // 15/02: the 10 deductible shares are the first acquired, so the rebought
    // 995 are the newest: 900 × 150 + 95 × 100 = 144,500, as the DGT computes.
    expect(onDate(r, "2007-02-15", "blockedLossEur")).toBe("144500.00");
    // 01/04 releases 955 pending shares, oldest first: 95 × 100 + 860 × 150.
    expect(onDate(r, "2007-04-01", "reintegratedLossEur")).toBe("138500.00");
    // …and blocks its own loss on the 10 shares bought on 16/04. The rebought
    // shares are the newest sold, the 10 of 10/03 at 980: 10 × 30, as the DGT.
    expect(onDate(r, "2007-04-01", "blockedLossEur")).toBe("300.00");
  });
});

// ---------------------------------------------------------------------------
// V0046-20 (13/01/2020): the 18/11 sale of 1,500 shares is definitive, so the
// 1,933.30 deferred on 19/03 is integrated in 2019, although FIFO sells old lots.
// ---------------------------------------------------------------------------
describe("DGT V0046-20: a definitive sale of old FIFO shares releases the pending loss (2019: 11,769.62)", () => {
  const ops: Op[] = [
    buy("2018-06-01", 2500), buy("2019-03-08", 500), sell("2019-03-19", 500, -1933.3),
    buy("2019-03-20", 500), sell("2019-11-18", 1500, 9172.38), sell("2019-11-19", 500, 4530.54),
  ];

  it("releases 1,933.30 on 18/11", () => {
    const r = year(ops, 2019);
    expect(onDate(r, "2019-11-18", "reintegratedLossEur")).toBe("1933.30");
    expect(r.fiscal).toBe("11769.62");
  });
});

// ---------------------------------------------------------------------------
// V1294-22 (24/05/2022): 21/12/2021 sells 18,000 with 10,000 rebought before it;
// 8,000 definitive shares ≥ the 5,000 pending of 31/12/2020, so all is released.
// Regression guard: the old engine also released the whole 15,000.
// ---------------------------------------------------------------------------
describe("DGT V1294-22: 8,000 definitive shares release the whole 2020 loss (regression guard)", () => {
  const ops: Op[] = [
    buy("2015-01-01", 18000), buy("2020-12-18", 5000, 9), ["2020-12-31", "SELL", 5000, 35000],
    buy("2021-10-28", 10000, 8), ["2021-12-21", "SELL", 18000, 108000],
  ];

  it("2020 blocks 15,000; 2021 releases 15,000", () => {
    expect(year(ops, 2020).blocked).toBe("15000.00");
    expect(year(ops, 2021).reintegrated).toBe("15000.00");
  });
});

// ---------------------------------------------------------------------------
// A gain sale rebought in its window is not definitive (V3282-18, 3rd sale).
// ---------------------------------------------------------------------------
describe("a gain sale rebought in its window keeps the deferral", () => {
  const ops: Op[] = [
    ["2025-01-02", "BUY", 1, 100], ["2025-02-01", "SELL", 1, 80], ["2025-02-05", "BUY", 1, 75],
    ["2025-02-10", "SELL", 1, 95], ["2025-02-20", "BUY", 1, 90],
  ];

  it("taxes the 20 gain now and keeps the 20 loss deferred (fiscal 20)", () => {
    const r = year(ops, 2025);
    expect(r.reintegrated).toBe("0.00");
    expect(r.fiscal).toBe("20.00");
  });
});

// ---------------------------------------------------------------------------
// One sale that spans an older GAIN lot and a newer LOSS lot, rebought in part.
// Of the shares sold, the rebought ones are the last acquired (V0913-08,
// V1294-22), so the loss lot stays blocked (V0279-25), and the gain lot's
// definitive shares release the pending loss. A gain lot must never take the
// rebuy that blocks a loss lot of the same sale.
// ---------------------------------------------------------------------------
describe("a rebought sale of an old gain lot and a new loss lot keeps the loss lot blocked", () => {
  const ops: Op[] = [
    buy("2024-01-02", 50, 30), ["2024-03-01", "SELL", 50, 1000], buy("2024-03-05", 50, 20),
    buy("2024-03-10", 50, 40), ["2024-08-01", "SELL", 100, 2500], buy("2024-08-05", 50, 25),
    ["2025-03-01", "SELL", 50, 1250],
  ];

  for (const method of METHODS) {
    it(`[${method}] 2024 blocks 500 + 750 and releases 500 (fiscal −250); 2025 releases the 750`, () => {
      const r2024 = year(ops, 2024, method);
      expect(onDate(r2024, "2024-08-01", "blockedLossEur")).toBe("750.00");
      expect(onDate(r2024, "2024-08-01", "reintegratedLossEur")).toBe("500.00");
      expect(r2024.fiscal).toBe("-250.00");
      expect(year(ops, 2025, method).reintegrated).toBe("750.00");
    });
  }

  it("a pending loss elsewhere does not let the gain lot take the rebuy (blocked 500 either way)", () => {
    // Lot A gains 500, lot B loses 500, 100 rebought: B stays blocked.
    const plain: Op[] = [
      buy("2025-01-02", 100, 10), buy("2025-03-03", 100, 20),
      ["2025-06-02", "SELL", 200, 3000], buy("2025-06-10", 100, 15),
    ];
    // The same, plus one share with a 10 loss pending from a 2024 churn.
    const withPending: Op[] = [
      buy("2024-06-03", 1, 30), ["2024-07-01", "SELL", 1, 20], buy("2024-07-05", 1, 20),
      buy("2025-01-02", 100, 10), buy("2025-03-03", 100, 20),
      ["2025-06-02", "SELL", 201, 3015], buy("2025-06-10", 100, 15),
    ];
    expect(year(plain, 2025).blocked).toBe("500.00");
    const r = year(withPending, 2025);
    expect(onDate(r, "2025-06-02", "blockedLossEur")).toBe("500.00");
    // The 101 definitive shares release the one pending share (10).
    expect(r.reintegrated).toBe("10.00");
    expect(r.fiscal).toBe("485.00");
  });
});

// ---------------------------------------------------------------------------
// The total exit asks FIFO, not only the trades: shares that came in without a
// BUY (a scrip dividend, a merger into a new ISIN) are still held, so selling
// the traded shares is not a total exit and releases only its definitive shares.
// ---------------------------------------------------------------------------
describe("the total exit does not fire while FIFO still holds shares the trades do not show", () => {
  it("scrip dividend: 10 scrip shares remain, so 100 definitive shares release only the first 100 (2025: 100)", () => {
    const ops: Op[] = [
      ["2025-01-10", "BUY", 100, 1000], ["2025-03-03", "SELL", 100, 900], ["2025-03-10", "BUY", 100, 900],
      ["2025-04-22", "SELL", 100, 800], ["2025-04-25", "BUY", 100, 800], ["2025-09-01", "SELL", 100, 1000],
    ];
    const scrip: CorporateAction = {
      transactionID: "SD1", accountId: "U1", symbol: "XYZ", isin: ISIN, description: `XYZ(${ISIN}) STOCK DIVIDEND`,
      currency: "EUR", reportDate: "20250203", dateTime: "20250203", quantity: "10", amount: "100", type: "SD", actionDescription: "",
    };
    for (const method of METHODS) {
      const r = year(ops, 2025, method, "EUR", [scrip]);
      expect(onDate(r, "2025-09-01", "reintegratedLossEur")).toBe("100.00");
      expect(r.reintegrated).toBe("100.00");
    }
  });

  it("merger into a new ISIN: 100 merged shares remain, so the sale releases 100, not 200 (2025: 100)", () => {
    const OLD = "US0000000001";
    const NEW = "US0000000002";
    const ops: Op[] = [
      ["2025-01-10", "BUY", 200, 2000, OLD], ["2025-03-03", "SELL", 100, 900, NEW], ["2025-03-10", "BUY", 100, 900, NEW],
      ["2025-04-22", "SELL", 100, 900, NEW], ["2025-04-25", "BUY", 100, 800, NEW], ["2025-09-01", "SELL", 100, 1000, NEW],
    ];
    const merger: CorporateAction = {
      transactionID: "TC1", accountId: "U1", symbol: "0001", isin: OLD,
      description: `0001(${OLD}) MERGED(Acquisition) 1 FOR 1 0002(${NEW})`,
      currency: "EUR", reportDate: "20250203", dateTime: "20250203", quantity: "-200", amount: "0", type: "TC", actionDescription: "",
    };
    for (const method of METHODS) {
      const r = year(ops, 2025, method, "EUR", [merger]);
      expect(r.reintegrated).toBe("100.00");
      expect(r.fiscal).toBe("0.00");
    }
  });

  it("a TC row that keeps the ISIN does not move the held shares' entry date: 01/09 still releases only 100", () => {
    // The scrip case, plus a TC row on 01/10 that names no new security. FIFO
    // books it as a merger of the ISIN into itself. The 10 shares FIFO still
    // holds were in the position on 01/09, so the 01/09 sale is no total exit.
    const ops: Op[] = [
      ["2025-01-10", "BUY", 100, 1000], ["2025-03-03", "SELL", 100, 900], ["2025-03-10", "BUY", 100, 900],
      ["2025-04-22", "SELL", 100, 800], ["2025-04-25", "BUY", 100, 800], ["2025-09-01", "SELL", 100, 1000],
    ];
    const scrip: CorporateAction = {
      transactionID: "SD1", accountId: "U1", symbol: "XYZ", isin: ISIN, description: `XYZ(${ISIN}) STOCK DIVIDEND`,
      currency: "EUR", reportDate: "20250203", dateTime: "20250203", quantity: "10", amount: "100", type: "SD", actionDescription: "",
    };
    const sameIsin: CorporateAction = {
      transactionID: "TC3", accountId: "U1", symbol: "XYZ", isin: ISIN, description: `XYZ(${ISIN}) TENDERED TO XYZ.TEN`,
      currency: "EUR", reportDate: "20251001", dateTime: "20251001", quantity: "-10", amount: "0", type: "TC", actionDescription: "",
    };
    for (const method of METHODS) {
      const r = year(ops, 2025, method, "EUR", [scrip, sameIsin]);
      expect(onDate(r, "2025-09-01", "reintegratedLossEur"), method).toBe("100.00");
    }
  });
});

// ---------------------------------------------------------------------------
// Property: over a position that is closed by a definitive sale, every blocked
// euro is released exactly once. Σ (net + blocked − reintegrated) = Σ net.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomClosedPosition(seed: number): Op[] {
  const rnd = mulberry32(seed);
  const ops: Op[] = [];
  let day = Date.UTC(2024, 0, 2);
  let position = 0;
  const steps = 8 + Math.floor(rnd() * 14);
  for (let i = 0; i < steps; i++) {
    day += (1 + Math.floor(rnd() * 25)) * 86400000;
    const date = new Date(day).toISOString().slice(0, 10);
    const price = 50 + Math.floor(rnd() * 50);
    if (position === 0 || rnd() < 0.5) {
      const qty = 1 + Math.floor(rnd() * 20);
      ops.push([date, "BUY", qty, qty * price]);
      position += qty;
    } else {
      const qty = 1 + Math.floor(rnd() * position);
      ops.push([date, "SELL", qty, qty * price]);
      position -= qty;
    }
  }
  // Close the position with nothing bought within two months before or after.
  day += 70 * 86400000;
  if (position > 0) ops.push([new Date(day).toISOString().slice(0, 10), "SELL", position, position * 60]);
  return ops;
}

describe("lifetime totals are summed before rounding", () => {
  it("a 1 EUR loss released a third a year sums to 1.00, not 3 × 0.33", () => {
    // 3 shares lose 1 EUR and are rebought: 1 EUR pending on 3 shares. One
    // definitive share a year releases 1/3 EUR each year.
    const ops: Op[] = [
      ["2023-01-02", "BUY", 3, 30], ["2023-03-01", "SELL", 3, 29], ["2023-03-05", "BUY", 3, 29],
      ["2024-06-03", "SELL", 1, 10], ["2025-06-02", "SELL", 1, 10], ["2026-06-01", "SELL", 1, 10],
    ];
    const years = [2023, 2024, 2025, 2026].map((y) => year(ops, y));
    const sum = (f: (r: YearResult) => Decimal) => years.reduce((s, r) => s.plus(f(r)), new Decimal(0));
    expect(years.slice(1).map((r) => r.reintegrated)).toEqual(["0.33", "0.33", "0.33"]);
    // Summing the rounded year strings loses a cent; the Decimal totals do not.
    expect(sum((r) => new Decimal(r.reintegrated)).toFixed(2)).toBe("0.99");
    expect(sum((r) => r.reintegratedEur).toFixed(2)).toBe("1.00");
    expect(sum((r) => r.blockedEur).toFixed(2)).toBe("1.00");
  });
});

describe("property: a closed position releases every blocked euro once", () => {
  it("Σ blocked = Σ reintegrated over all years, for 60 seeded random histories", () => {
    let churned = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const ops = randomClosedPosition(seed);
      const years = [...new Set(ops.map((o) => Number(o[0].slice(0, 4))))];
      let blocked = new Decimal(0);
      let released = new Decimal(0);
      for (const y of years) {
        const r = year(ops, y);
        blocked = blocked.plus(r.blockedEur);
        released = released.plus(r.reintegratedEur);
      }
      if (blocked.greaterThan(0)) churned++;
      expect(released.toFixed(2), `seed ${seed}: ${JSON.stringify(ops)}`).toBe(blocked.toFixed(2));
    }
    // The property is not vacuous: most histories do block something.
    expect(churned).toBeGreaterThan(30);
  });
});

/** A random history of long and short legs that ends flat, with no trade in the last leg's window. */
function randomClosedLongShort(seed: number): { op: Op; oc: "O" | "C" }[] {
  const rnd = mulberry32(seed);
  const out: { op: Op; oc: "O" | "C" }[] = [];
  let day = Date.UTC(2024, 0, 2);
  let long = 0;
  let short = 0;
  const steps = 10 + Math.floor(rnd() * 16);
  const at = () => new Date(day).toISOString().slice(0, 10);
  for (let i = 0; i < steps; i++) {
    day += (1 + Math.floor(rnd() * 25)) * 86400000;
    const price = 50 + Math.floor(rnd() * 50);
    if (long > 0) {
      const qty = rnd() < 0.5 ? 1 + Math.floor(rnd() * 20) : -(1 + Math.floor(rnd() * long));
      out.push({ op: [at(), qty > 0 ? "BUY" : "SELL", Math.abs(qty), Math.abs(qty) * price], oc: qty > 0 ? "O" : "C" });
      long += qty;
    } else if (short > 0) {
      const qty = rnd() < 0.5 ? 1 + Math.floor(rnd() * 20) : -(1 + Math.floor(rnd() * short));
      out.push({ op: [at(), qty > 0 ? "SELL" : "BUY", Math.abs(qty), Math.abs(qty) * price], oc: qty > 0 ? "O" : "C" });
      short += qty;
    } else {
      const qty = 1 + Math.floor(rnd() * 20);
      const goShort = rnd() < 0.5;
      out.push({ op: [at(), goShort ? "SELL" : "BUY", qty, qty * price], oc: "O" });
      if (goShort) short = qty;
      else long = qty;
    }
  }
  day += 70 * 86400000;
  if (long > 0) out.push({ op: [at(), "SELL", long, long * 60], oc: "C" });
  if (short > 0) out.push({ op: [at(), "BUY", short, short * 60], oc: "C" });
  return out;
}

describe("property: with short legs too, a closed position releases every blocked euro once", () => {
  it("Σ blocked = Σ reintegrated over all years, for 80 seeded random long/short histories, in all 3 methods", () => {
    let churned = 0;
    let withShortLoss = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const legs = randomClosedLongShort(seed);
      const trades = legs.map((l, i) => flagged(l.op, i, l.oc));
      const years = [...new Set(legs.map((l) => Number(l.op[0].slice(0, 4))))];
      for (const method of METHODS) {
        let blocked = new Decimal(0);
        let released = new Decimal(0);
        for (const y of years) {
          const r = yearOf(trades, y, method);
          blocked = blocked.plus(r.blockedEur);
          released = released.plus(r.reintegratedEur);
          if (method === "monodivisa" && r.disposals.some((d) => d.isShort === true && d.blockedLossEur.greaterThan(0))) withShortLoss++;
        }
        if (method === "monodivisa" && blocked.greaterThan(0)) churned++;
        expect(released.toFixed(2), `seed ${seed} ${method}: ${JSON.stringify(legs)}`).toBe(blocked.toFixed(2));
      }
    }
    // Not vacuous: many histories block something, some of it a short cover's own loss.
    expect(churned).toBeGreaterThan(30);
    expect(withShortLoss).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Follow-up to #455 (late review). Only a «transmisión definitiva» of HELD
// shares releases a pending loss, and only a real one empties the position.
// ---------------------------------------------------------------------------

/** One trade with an explicit open/close flag (a short opens with SELL+O and closes with BUY+C). */
function flagged(op: Op, n: number, oc: "O" | "C"): Trade {
  return { ...trade(op, n, "EUR"), openCloseIndicator: oc };
}

function yearOf(trades: Trade[], y: number, method: FxMethod, corporateActions: CorporateAction[] = [], toDate = "20261231"): YearResult {
  const st: FlexStatement = {
    accountId: "U1", fromDate: "20070101", toDate, period: "Annual",
    trades, cashTransactions: [], corporateActions, openPositions: [], securitiesInfo: [],
  };
  const map: EcbRateMap = new Map();
  for (const t of trades) map.set(t.tradeDate, new Map([["USD", "1.10"]]));
  const cg = generateTaxReport(st, map, y, reportOptionsForMethod(method)).capitalGains;
  return {
    fiscal: cg.netGainLoss.plus(cg.blockedLosses).minus(cg.reintegratedLosses).toFixed(2),
    blocked: cg.blockedLosses.toFixed(2),
    reintegrated: cg.reintegratedLosses.toFixed(2),
    blockedEur: cg.blockedLosses,
    reintegratedEur: cg.reintegratedLosses,
    disposals: cg.disposals,
  };
}

describe("a short cover is not a transmission of held shares, and its buy is not a repurchase", () => {
  // The 03/03 loss is rebought on 10/03 (20 pending). The 20/05 buy covers the
  // short opened on 05/05: those shares go straight back to the lender and never
  // stay in the patrimony, so they are no repurchase of the 02/05 long exit.
  // 02/05 is definitive and empties the long position: it releases the 20. The
  // 20/05 cover closes a short, not held shares, so it releases nothing itself.
  const trades: Trade[] = [
    flagged(["2025-01-02", "BUY", 10, 100], 0, "O"),
    flagged(["2025-03-03", "SELL", 10, 80], 1, "C"),
    flagged(["2025-03-10", "BUY", 10, 80], 2, "O"),
    flagged(["2025-05-02", "SELL", 10, 90], 3, "C"),
    flagged(["2025-05-05", "SELL", 10, 95], 4, "O"),
    flagged(["2025-05-20", "BUY", 10, 85], 5, "C"),
    flagged(["2026-01-05", "BUY", 10, 90], 6, "O"),
    flagged(["2026-06-01", "SELL", 10, 100], 7, "C"),
  ];

  for (const method of METHODS) {
    it(`[${method}] 2025: the 02/05 long exit releases the 20, the 20/05 cover nothing (fiscal 0); 2026 nothing`, () => {
      const r = yearOf(trades, 2025, method);
      expect(r.disposals.some((d) => d.isShort === true && d.sellDate === "2025-05-20")).toBe(true);
      expect(r.blocked).toBe("20.00");
      expect(onDate(r, "2025-05-02", "reintegratedLossEur")).toBe("20.00");
      expect(onDate(r, "2025-05-20", "reintegratedLossEur")).toBe("0.00");
      expect(r.fiscal).toBe("0.00");
      expect(yearOf(trades, 2026, method).reintegrated).toBe("0.00");
    });

    it(`[${method}] flat for good after the 20/05 cover: lifetime blocked = released`, () => {
      const years = [2025, 2026, 2027].map((y) => yearOf(trades.slice(0, 6), y, method));
      const blocked = years.reduce((s, r) => s.plus(r.blockedEur), new Decimal(0));
      const released = years.reduce((s, r) => s.plus(r.reintegratedEur), new Decimal(0));
      expect(blocked.toFixed(2)).toBe("20.00");
      expect(released.toFixed(2)).toBe("20.00");
    });

    it(`[${method}] short-only trader: a cover buy does not block an earlier cover's loss`, () => {
      // Short 10 on 10/01, covered 03/03 at a loss of 20; short again 20/03,
      // covered 01/04 at a gain of 10. The 01/04 cover buy acquires no shares
      // that stay, so the 03/03 loss is deductible now and nothing is left pending.
      const shortOnly: Trade[] = [
        flagged(["2025-01-10", "SELL", 10, 100], 0, "O"),
        flagged(["2025-03-03", "BUY", 10, 120], 1, "C"),
        flagged(["2025-03-20", "SELL", 10, 100], 2, "O"),
        flagged(["2025-04-01", "BUY", 10, 90], 3, "C"),
      ];
      const r = yearOf(shortOnly, 2025, method);
      expect(r.blocked).toBe("0.00");
      expect(r.reintegrated).toBe("0.00");
      expect(r.fiscal).toBe("-10.00");
    });
  }

  it("a C buy with no open short books no lot, so it repurchases nothing", () => {
    // FIFO reports the cover without lots and books nothing for it.
    const orphan: Trade[] = [
      flagged(["2025-01-02", "BUY", 10, 100], 0, "O"),
      flagged(["2025-03-03", "SELL", 10, 80], 1, "C"),
      flagged(["2025-03-10", "BUY", 10, 80], 2, "C"),
    ];
    expect(yearOf(orphan, 2025, "monodivisa").blocked).toBe("0.00");
  });

  it("a C;O buy that covers 10 and opens 5 repurchases only the 5 long shares", () => {
    // The 03/03 long loss of 20 on 10 shares. On 20/03 a short of 10 is open and
    // a C;O buy of 15 covers it and opens 5 long: only those 5 stay, so only 5 of
    // the 10 shares (10 EUR) are blocked.
    const roll: Trade[] = [
      flagged(["2025-01-02", "BUY", 10, 100], 0, "O"),
      flagged(["2025-03-03", "SELL", 10, 80], 1, "C"),
      flagged(["2025-03-10", "SELL", 10, 100], 2, "O"),
      { ...flagged(["2025-03-20", "BUY", 15, 150], 3, "C"), openCloseIndicator: "C;O" },
    ];
    const r = yearOf(roll, 2025, "monodivisa");
    expect(onDate(r, "2025-03-03", "blockedLossEur")).toBe("10.00");
  });

  for (const method of METHODS) {
    it(`[${method}] same-day covers follow FIFO's order: a C;O buy listed after an orphan C buy still covers first`, () => {
      // A short of 10 is open on 20/03. The file lists a C buy of 15 before a
      // C;O buy of 10. FIFO runs C;O first (opens and rolls before closes): it
      // covers the 10 and opens nothing. The C buy then finds no short and books
      // nothing. No share stays, so the 03/03 loss is deductible now.
      const covers: Trade[] = [
        flagged(["2025-01-02", "BUY", 10, 100], 0, "O"),
        flagged(["2025-03-03", "SELL", 10, 80], 1, "C"),
        flagged(["2025-03-10", "SELL", 10, 100], 2, "O"),
        flagged(["2025-03-20", "BUY", 15, 150], 3, "C"),
        { ...flagged(["2025-03-20", "BUY", 10, 100], 4, "C"), openCloseIndicator: "C;O" },
      ];
      const r = yearOf(covers, 2025, method);
      expect(r.disposals.filter((d) => d.isShort === true && d.sellDate === "2025-03-20").reduce((s, d) => s.plus(d.quantity), new Decimal(0)).toString()).toBe("10");
      expect(r.blocked).toBe("0.00");
      expect(r.fiscal).toBe("-20.00");
    });

    it(`[${method}] a total exit that shares its day with a short cover gives the rest of the queue to the long sale`, () => {
      // Issue example: 20 + 5 pending on 20 shares, 10 held. On 01/09 the long
      // sale (a C;O sell, which FIFO books before the C cover) is definitive and
      // empties the position: 10 shares release 20, the total exit the other 5.
      // The same day a C buy covers a short of 5 at a gain. A cover releases
      // nothing, so all 25 belong to the long sale.
      const day: Trade[] = [
        flagged(["2025-01-02", "BUY", 10, 100], 0, "O"),
        flagged(["2025-03-03", "SELL", 10, 80], 1, "C"),
        flagged(["2025-03-10", "BUY", 10, 100], 2, "O"),
        flagged(["2025-04-22", "SELL", 10, 95], 3, "C"),
        flagged(["2025-04-25", "BUY", 10, 100], 4, "O"),
        flagged(["2025-06-02", "SELL", 5, 60], 5, "O"),
        { ...flagged(["2025-09-01", "SELL", 10, 100], 6, "C"), openCloseIndicator: "C;O" },
        flagged(["2025-09-01", "BUY", 5, 50], 7, "C"),
      ];
      const r = yearOf(day, 2025, method);
      const cover = r.disposals.filter((d) => d.sellDate === "2025-09-01" && d.isShort === true);
      expect(cover.length).toBe(1);
      expect(cover[0]!.gainLossEur.greaterThan(0)).toBe(true);
      expect(cover[0]!.reintegratedLossEur.toFixed(2)).toBe("0.00");
      expect(r.disposals.filter((d) => d.sellDate === "2025-09-01" && d.isShort !== true).reduce((s, d) => s.plus(d.reintegratedLossEur), new Decimal(0)).toFixed(2)).toBe("25.00");
      expect(r.reintegrated).toBe("25.00");
    });
  }
});

describe("a zero-share sale is not a total exit", () => {
  // The 01/12 sale closes the position at a loss of 20 and the 10/01 buy blocks
  // it. A 0-share SELL row on 15/12 (FIFO books it with no lots) transmits
  // nothing, so it must not release the pending 20.
  const zeroSell: Trade = {
    ...trade(["2025-12-15", "SELL", 1, 8], 3, "EUR"),
    quantity: "0", tradeMoney: "0", proceeds: "0", cost: "0",
  };
  const trades: Trade[] = [
    trade(buy("2025-06-02", 10), 0, "EUR"),
    trade(sell("2025-12-01", 10, -20), 1, "EUR"),
    trade(buy("2026-01-10", 10, 8), 2, "EUR"),
    zeroSell,
  ];

  for (const method of METHODS) {
    it(`[${method}] 2025: 20 blocked, nothing released (fiscal 0)`, () => {
      const r = yearOf(trades, 2025, method);
      expect(r.disposals.some((d) => d.sellDate === "2025-12-15" && d.quantity.isZero())).toBe(true);
      expect(r.blocked).toBe("20.00");
      expect(r.reintegrated).toBe("0.00");
      expect(r.fiscal).toBe("0.00");
    });
  }
});

describe("the total exit reads the date shares entered the security, not the spin-off's inherited acquisition date", () => {
  // XYZ is bought, churned twice (200 pending on 100 held) and sold on 01/09
  // with no rebuy: the position is empty, so the total exit releases all 200.
  // The 01/12 spin-off brings XYZ shares carved from a 2024 parent purchase.
  // Their tax acquisition date is the parent's (2024), but they entered XYZ on
  // 01/12, after the sale, so they must not keep the position open on 01/09.
  const PARENT = "US1111111111";
  const ops: Op[] = [
    ["2024-02-01", "BUY", 100, 1000, PARENT],
    ["2025-01-10", "BUY", 100, 1000], ["2025-03-03", "SELL", 100, 900], ["2025-03-10", "BUY", 100, 900],
    ["2025-04-22", "SELL", 100, 800], ["2025-04-25", "BUY", 100, 800], ["2025-09-01", "SELL", 100, 1000],
  ];
  const spinOff: CorporateAction = {
    transactionID: "SO1", accountId: "U1", symbol: "XYZ", isin: ISIN,
    description: `1111(${PARENT}) SPINOFF 1 FOR 1 XYZ(${ISIN})`,
    currency: "EUR", reportDate: "20251201", dateTime: "20251201", quantity: "100", amount: "0", type: "SO", actionDescription: "",
  };

  for (const method of METHODS) {
    it(`[${method}] spun-off shares still held at the end: 01/09 releases 200 (2025 fiscal 0)`, () => {
      const r = year(ops, 2025, method, "EUR", [spinOff]);
      expect(onDate(r, "2025-09-01", "reintegratedLossEur")).toBe("200.00");
      expect(r.fiscal).toBe("0.00");
    });

    it(`[${method}] the spun-off shares sold in 2026: 01/09 still releases 200`, () => {
      const withSale: Op[] = [...ops, ["2026-03-02", "SELL", 100, 600]];
      const r = year(withSale, 2025, method, "EUR", [spinOff]);
      expect(onDate(r, "2025-09-01", "reintegratedLossEur")).toBe("200.00");
    });
  }

  it("a spin-off BEFORE the sale keeps the position open: 01/09 releases only its 100 definitive shares", () => {
    const early: CorporateAction = { ...spinOff, reportDate: "20250801", dateTime: "20250801" };
    const r = year(ops, 2025, "monodivisa", "EUR", [early]);
    expect(onDate(r, "2025-09-01", "reintegratedLossEur")).toBe("100.00");
  });
});

describe("the total exit reads the date shares entered the security, not the merger's inherited acquisition date", () => {
  // Same history as the spin-off block, but the late shares come from a merger:
  // OLD, held since 2024, is MERGED 1 FOR 1 into XYZ. The merged lots keep OLD's
  // 2024 tax acquisition date, yet they entered XYZ on the merger date.
  const OLD = "US2222222222";
  const ops: Op[] = [
    ["2024-02-01", "BUY", 100, 1000, OLD],
    ["2025-01-10", "BUY", 100, 1000], ["2025-03-03", "SELL", 100, 900], ["2025-03-10", "BUY", 100, 900],
    ["2025-04-22", "SELL", 100, 800], ["2025-04-25", "BUY", 100, 800], ["2025-09-01", "SELL", 100, 1000],
  ];
  const merger = (date: string): CorporateAction => ({
    transactionID: "TC2", accountId: "U1", symbol: "2222", isin: OLD,
    description: `2222(${OLD}) MERGED(Acquisition) 1 FOR 1 XYZ(${ISIN})`,
    currency: "EUR", reportDate: date, dateTime: date, quantity: "-100", amount: "0", type: "TC", actionDescription: "",
  });

  for (const method of METHODS) {
    it(`[${method}] merged shares still held at the end: 01/09 releases 200`, () => {
      const r = year(ops, 2025, method, "EUR", [merger("20251201")]);
      expect(onDate(r, "2025-09-01", "reintegratedLossEur")).toBe("200.00");
    });

    it(`[${method}] the merged shares sold in 2026: 01/09 still releases 200`, () => {
      const withSale: Op[] = [...ops, ["2026-03-02", "SELL", 100, 600]];
      const r = year(withSale, 2025, method, "EUR", [merger("20251201")]);
      expect(onDate(r, "2025-09-01", "reintegratedLossEur")).toBe("200.00");
    });

    it(`[${method}] a merger BEFORE the sale keeps the position open: 01/09 releases only 100`, () => {
      const r = year(ops, 2025, method, "EUR", [merger("20250801")]);
      expect(onDate(r, "2025-09-01", "reintegratedLossEur")).toBe("100.00");
    });
  }
});

// ---------------------------------------------------------------------------
// The detector sees only the uploaded trades. A sale whose repurchase window
// runs past the last date the upload covers could still be blocked (a loss) or
// turn non-definitive (a release) by a buy the upload does not show. BLOCK and
// RELEASE share one warning; the figures are never withheld.
// ---------------------------------------------------------------------------
describe("a sale whose window runs past the loaded data gets one warning, for a block and for a release", () => {
  const ID = "report.antichurning_window_past_data";
  function messagesOf(trades: Trade[], y: number, method: FxMethod, toDate: string) {
    const st: FlexStatement = {
      accountId: "U1", fromDate: "", toDate, period: "",
      trades, cashTransactions: [], corporateActions: [], openPositions: [], securitiesInfo: [],
    };
    const map: EcbRateMap = new Map();
    for (const t of trades) map.set(t.tradeDate, new Map([["USD", "1.10"]]));
    return generateTaxReport(st, map, y, reportOptionsForMethod(method));
  }
  const ops = (list: Op[]): Trade[] => list.map((o, i) => trade(o, i, "EUR"));

  it("a December loss with nothing loaded after it: warned, the loss still deducted", () => {
    const r = messagesOf(ops([buy("2025-06-02", 10), sell("2025-12-20", 10, -20)]), 2025, "monodivisa", "");
    const m = r.messages.find((x) => x.id === ID);
    expect(m?.severity).toBe("warning");
    expect(m?.context).toEqual({ count: "1", year: "2025", lastDate: "20/12/2025", windowEnd: "20/02/2026" });
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("0.00");
  });

  for (const method of METHODS) {
    it(`[${method}] a December release with nothing loaded after it: warned, the 20 still released`, () => {
      const list: Op[] = [
        buy("2025-01-02", 10), sell("2025-03-03", 10, -20), buy("2025-03-10", 10), sell("2025-12-01", 10, 10),
      ];
      const r = messagesOf(ops(list), 2025, method, "");
      expect(r.capitalGains.reintegratedLosses.toFixed(2)).toBe("20.00");
      // The 03/03 loss is fully blocked, so only the 01/12 release is open.
      expect(r.messages.find((x) => x.id === ID)?.context).toEqual({
        count: "1", year: "2025", lastDate: "01/12/2025", windowEnd: "01/02/2026",
      });
    });
  }

  it("no warning once the upload covers the window (statement end or a later trade of any security)", () => {
    const list: Op[] = [buy("2025-06-02", 10), sell("2025-12-20", 10, -20)];
    expect(messagesOf(ops(list), 2025, "monodivisa", "20260228").messages.some((x) => x.id === ID)).toBe(false);
    const later: Op[] = [...list, ["2026-03-02", "BUY", 1, 50, "US0000000009"]];
    expect(messagesOf(ops(later), 2025, "monodivisa", "").messages.some((x) => x.id === ID)).toBe(false);
  });

  it("no warning for a December gain with nothing pending, or a loss already fully blocked", () => {
    const gain: Op[] = [buy("2025-06-02", 10), sell("2025-12-20", 10, 20)];
    expect(messagesOf(ops(gain), 2025, "monodivisa", "").messages.some((x) => x.id === ID)).toBe(false);
    const blocked: Op[] = [buy("2025-06-02", 10), sell("2025-12-01", 10, -20), buy("2025-12-10", 10, 8)];
    const r = messagesOf(ops(blocked), 2025, "monodivisa", "");
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("20.00");
    expect(r.messages.some((x) => x.id === ID)).toBe(false);
  });
});

describe("the window-past-data warning counts sales, not FIFO lots", () => {
  it("one December loss sale of three lots is one sale", () => {
    const list: Op[] = [buy("2025-02-03", 10), buy("2025-03-03", 10), buy("2025-04-01", 10), sell("2025-12-19", 30, -30)];
    const st: FlexStatement = { ...statement(list), toDate: "" };
    const r = generateTaxReport(st, rates(list), 2025, reportOptionsForMethod("monodivisa"));
    expect(r.capitalGains.disposals).toHaveLength(3);
    expect(r.messages.find((m) => m.id === "report.antichurning_window_past_data")?.context?.count).toBe("1");
  });
});

describe("the window-past-data warning checks each broker's files on their own", () => {
  const ID = "report.antichurning_window_past_data";
  const at = (o: Op, n: number, src?: string): Trade => ({ ...trade(o, n, "EUR"), ...(src ? { brokerSource: src } : {}) });
  const flex = (toDate: string, trades: Trade[]): FlexStatement => ({
    accountId: "U1", fromDate: "", toDate, period: "", trades, cashTransactions: [], corporateActions: [], openPositions: [], securitiesInfo: [],
  });
  function merged(files: [FlexStatement, string][]): FlexStatement {
    const target = createEmptyStatement();
    for (const [file, broker] of files) mergeStatement(target, file, broker);
    return finalizeMergedStatement(target);
  }
  const report = (st: FlexStatement) => {
    const map: EcbRateMap = new Map();
    for (const t of st.trades) map.set(t.tradeDate, new Map([["USD", "1.10"]]));
    return generateTaxReport(st, map, 2025, reportOptionsForMethod("monodivisa"));
  };
  const degiro = flex("", [at(buy("2025-06-02", 10), 0), at(sell("2025-12-20", 10, -20), 1)]);

  it("a DEGIRO file ending on its 20/12 loss sale is warned even when an IBKR statement runs to 2026", () => {
    const ibkr = flex("20261231", [at(["2025-03-03", "BUY", 1, 50, "US0000000009"], 2), at(["2026-11-02", "SELL", 1, 60, "US0000000009"], 3)]);
    const r = report(merged([[degiro, "DEGIRO"], [ibkr, "Interactive Brokers"]]));
    expect(r.messages.find((m) => m.id === ID)?.context).toEqual({
      count: "1", year: "2025", lastDate: "20/12/2025", windowEnd: "20/02/2026",
    });
  });

  it("no warning once that broker's own data covers the window (its statement end or a later trade there)", () => {
    const ibkrXyz = flex("20261231", [at(["2025-03-03", "BUY", 1, 50, "US0000000009"], 2)]);
    const degiroLater = flex("", [...degiro.trades, at(["2026-03-02", "BUY", 1, 50, "US0000000009"], 4)]);
    expect(report(merged([[degiroLater, "DEGIRO"], [ibkrXyz, "Interactive Brokers"]])).messages.some((m) => m.id === ID)).toBe(false);
    // The same security at a broker whose statement runs to 2026: only DEGIRO, which ends first, counts.
    const ibkrSame = flex("20261231", [at(buy("2025-02-03", 5), 5)]);
    expect(report(merged([[degiro, "DEGIRO"], [ibkrSame, "Interactive Brokers"]])).messages.some((m) => m.id === ID)).toBe(true);
  });

  it("a broker's statement end counts even when its last trade is earlier", () => {
    // XYZ trades only at IBKR, whose statement ends 28/02/2026 after the 20/02 window end.
    const ibkr = flex("20260228", [at(buy("2025-06-02", 10), 0), at(sell("2025-12-20", 10, -20), 1)]);
    const other = flex("", [at(["2025-03-03", "BUY", 1, 50, "US0000000009"], 2), at(["2026-01-05", "SELL", 1, 60, "US0000000009"], 3)]);
    expect(report(merged([[ibkr, "Interactive Brokers"], [other, "DEGIRO"]])).messages.some((m) => m.id === ID)).toBe(false);
  });

  it("a statement-only broker running to 2026 does not hide another broker's December loss", () => {
    // The IBKR file has a statement end but no trades. XYZ trades only at
    // DEGIRO, whose data ends on its 20/12 loss sale.
    const ibkrEmpty = flex("20261231", []);
    const r = report(merged([[degiro, "DEGIRO"], [ibkrEmpty, "Interactive Brokers"]]));
    expect(r.messages.find((m) => m.id === ID)?.context).toEqual({
      count: "1", year: "2025", lastDate: "20/12/2025", windowEnd: "20/02/2026",
    });
  });

  it("a single broker keeps the whole-upload date: its statement end covers every security", () => {
    const one = flex("20260228", [at(buy("2025-06-02", 10), 0, "Interactive Brokers"), at(sell("2025-12-20", 10, -20), 1, "Interactive Brokers")]);
    expect(report(one).messages.some((m) => m.id === ID)).toBe(false);
  });
});

describe("a window still open when the return is due gets its own warning, without 'the result is already correct'", () => {
  const PAST = "report.antichurning_window_past_data";
  const OPEN = "report.antichurning_window_open_at_filing";
  function crypto(o: Op, n: number): Trade {
    return { ...trade(o, n, "EUR"), isin: "", symbol: "BTC", description: "Bitcoin", assetCategory: "CRYPTO", exchange: "" };
  }
  const run = (trades: Trade[], toDate: string) => {
    const st: FlexStatement = { accountId: "U1", fromDate: "", toDate, period: "", trades, cashTransactions: [], corporateActions: [], openPositions: [], securitiesInfo: [] };
    const map: EcbRateMap = new Map();
    for (const t of trades) map.set(t.tradeDate, new Map([["USD", "1.10"]]));
    return generateTaxReport(st, map, 2025, reportOptionsForMethod("monodivisa"));
  };

  it("a crypto loss of 15/07/2025: its 1-year window ends 15/07/2026, after the 30/06/2026 filing deadline", () => {
    const r = run([crypto(buy("2025-02-03", 1, 200), 0), crypto(["2025-07-15", "SELL", 1, 100], 1)], "20251231");
    expect(r.messages.some((m) => m.id === PAST)).toBe(false);
    const m = r.messages.find((x) => x.id === OPEN);
    expect(m?.severity).toBe("warning");
    expect(m?.context).toEqual({ count: "1", year: "2025", lastDate: "31/12/2025", windowEnd: "15/07/2026", deadline: "30/06/2026" });
    expect(m?.hint).toMatch(/autoliquidación rectificativa/);
    expect(m?.hint).not.toMatch(/ya es correcto/);
  });

  it("a crypto loss of 15/03/2025 ends 15/03/2026, before the deadline: the usual warning", () => {
    const r = run([crypto(buy("2025-02-03", 1, 200), 0), crypto(["2025-03-15", "SELL", 1, 100], 1)], "20251231");
    expect(r.messages.some((m) => m.id === OPEN)).toBe(false);
    expect(r.messages.find((m) => m.id === PAST)?.context?.windowEnd).toBe("15/03/2026");
  });

  it("both kinds in one year give both warnings, each with its own count", () => {
    const r = run([
      // Bought more than a year before either sale, so neither loss is blocked.
      crypto(buy("2024-01-02", 2, 400), 0), crypto(["2025-03-15", "SELL", 1, 100], 1), crypto(["2025-07-15", "SELL", 1, 100], 2),
    ], "20251231");
    expect(r.messages.find((m) => m.id === PAST)?.context?.count).toBe("1");
    expect(r.messages.find((m) => m.id === OPEN)?.context?.count).toBe("1");
  });
});
