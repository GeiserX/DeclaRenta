import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import type { FxMethod } from "../../src/types/tax.js";
import type { FlexStatement, Trade } from "../../src/types/ibkr.js";
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

/** [date, side, quantity, total EUR amount of the trade] */
type Op = [date: string, side: "BUY" | "SELL", qty: number, amount: number];

const ISIN = "ES0000004511";

function trade(op: Op, n: number, currency: string): Trade {
  const [date, side, qty, amount] = op;
  const money = new Decimal(amount).toString();
  return {
    tradeID: `t${n}`, accountId: "U1", symbol: "XYZ", description: "XYZ SA", isin: ISIN, assetCategory: "STK",
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

function statement(ops: Op[], currency = "EUR"): FlexStatement {
  return {
    accountId: "U1", fromDate: "20070101", toDate: "20261231", period: "Annual",
    trades: ops.map((o, i) => trade(o, i, currency)),
    cashTransactions: [], corporateActions: [], openPositions: [], securitiesInfo: [],
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
  disposals: FifoDisposal[];
}

function year(ops: Op[], y: number, method: FxMethod = "monodivisa", currency = "EUR"): YearResult {
  const report = generateTaxReport(statement(ops, currency), rates(ops), y, reportOptionsForMethod(method));
  const cg = report.capitalGains;
  return {
    fiscal: cg.netGainLoss.plus(cg.blockedLosses).minus(cg.reintegratedLosses).toFixed(2),
    blocked: cg.blockedLosses.toFixed(2),
    reintegrated: cg.reintegratedLosses.toFixed(2),
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
// The engine gets the 23/04 sales right (not definitive) but releases part of
// the losses on 29/04 (fiscal 1,079.44). The 22/04 loss is rebought the same day
// (920 shares); the engine has no intraday times, skips same-day buys and takes
// 905 of the 27/04 purchase instead (post-sale buys first). The 23/04 sales then
// use 945 of the 06/05 purchase, and only 955 of it are left for the 1,880
// shares sold on 29/04: 925 definitive shares release 672 + 313 × 45/905.
// Taking pre-sale buys first would give 1,751.73 (20 shares still definitive,
// as no strict budget reaches the DGT's 1,767), and breaks V1760-23 below. The
// rebuy pick order is tracked apart from #451.
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

  it("releases 925 definitive shares on 29/04 (engine 1,079.44; DGT 1,767, see above)", () => {
    const r = year(ops, 2020);
    expect(onDate(r, "2020-04-29", "reintegratedLossEur")).toBe("687.56");
    expect(r.fiscal).toBe("1079.44");
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
    // 15/02: 105 × 100 (first lot) + 890 × 150. The DGT puts the 10 deductible
    // shares on the first-acquired lot (144,500); the engine absorbs the
    // first-processed FIFO lot first (144,000). Same-sale lot attribution is a
    // separate engine question, not the definitive test.
    expect(onDate(r, "2007-02-15", "blockedLossEur")).toBe("144000.00");
    // 01/04 releases 955 pending shares, oldest first: 105 × 100 + 850 × 150.
    expect(onDate(r, "2007-04-01", "reintegratedLossEur")).toBe("138000.00");
    // …and blocks its own loss on the 10 shares bought on 16/04 (10 × 40 here,
    // 10 × 30 for the DGT, the same lot-attribution difference).
    expect(onDate(r, "2007-04-01", "blockedLossEur")).toBe("400.00");
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
        blocked = blocked.plus(r.blocked);
        released = released.plus(r.reintegrated);
      }
      if (blocked.greaterThan(0)) churned++;
      expect(released.toFixed(2), `seed ${seed}: ${JSON.stringify(ops)}`).toBe(blocked.toFixed(2));
    }
    // The property is not vacuous: most histories do block something.
    expect(churned).toBeGreaterThan(30);
  });
});
