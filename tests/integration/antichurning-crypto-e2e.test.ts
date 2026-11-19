import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { binanceParser } from "../../src/parsers/binance.js";
import type { FxMethod } from "../../src/types/tax.js";
import type { FlexStatement, Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// Issue #457: crypto is no «valor o participación» (DGT V0525-25, V0648-24), so
// the anti-churning rule for it is art. 33.5.e LIRPF, not f or g: only a
// repurchase of the same coin in the year AFTER the sale defers the loss. Every
// case runs through the REAL generateTaxReport. "Fiscal" is the year's
// capital-gains contribution, `netGainLoss + blockedLosses − reintegratedLosses`.
// ===========================================================================

/** [date, side, quantity, total EUR amount of the trade] */
type Op = [date: string, side: "BUY" | "SELL", qty: number, amount: number];

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];

function trade([date, side, qty, amount]: Op, n: number, kind: "crypto" | "unlisted"): Trade {
  const money = new Decimal(amount).toString();
  return {
    tradeID: `t${n}`, accountId: "U1",
    symbol: kind === "crypto" ? "BTC" : "PRIVCO",
    description: kind === "crypto" ? "Bitcoin" : "PRIVATE CO",
    isin: "", assetCategory: kind === "crypto" ? "CRYPTO" : "STK",
    currency: "EUR", tradeDate: date, settlementDate: date,
    quantity: String(side === "BUY" ? qty : -qty),
    tradePrice: new Decimal(amount).div(qty).toString(),
    tradeMoney: side === "BUY" ? money : `-${money}`,
    proceeds: side === "BUY" ? `-${money}` : money,
    cost: money, fifoPnlRealized: "0", fxRateToBase: "1", buySell: side,
    openCloseIndicator: side === "BUY" ? "O" : "C", exchange: "", commissionCurrency: "EUR",
    commission: "0", taxes: "0", multiplier: "1",
  };
}

function run(ops: Op[], y: number, method: FxMethod = "multidivisa", kind: "crypto" | "unlisted" = "crypto") {
  const st: FlexStatement = {
    accountId: "U1", fromDate: "", toDate: "20261231", period: "",
    trades: ops.map((o, i) => trade(o, i, kind)),
    cashTransactions: [], corporateActions: [], openPositions: [], securitiesInfo: [],
  };
  const report = generateTaxReport(st, new Map(), y, reportOptionsForMethod(method));
  const cg = report.capitalGains;
  return {
    report,
    fiscal: cg.netGainLoss.plus(cg.blockedLosses).minus(cg.reintegratedLosses).toFixed(2),
    blocked: cg.blockedLosses.toFixed(2),
    reintegrated: cg.reintegratedLosses.toFixed(2),
  };
}

describe("#457 issue example: a crypto buy before the sale does not defer the loss", () => {
  // Buy 1 BTC on 01/12/2024 (200), buy 1 on 01/03/2025 (100), sell 1 on
  // 01/06/2025 for 100: FIFO sells the 200 lot (−100). Nothing is bought after.
  const ops: Op[] = [["2024-12-01", "BUY", 1, 200], ["2025-03-01", "BUY", 1, 100], ["2025-06-01", "SELL", 1, 100]];

  it.each(METHODS)("[%s] 2025: the whole −100 is deductible, nothing blocked", (method) => {
    const r = run(ops, 2025, method);
    expect(r.blocked).toBe("0.00");
    expect(r.fiscal).toBe("-100.00");
  });

  it("mirror: a security with no ISIN on the same dates (letter g) still blocks the 100", () => {
    const r = run(ops, 2025, "multidivisa", "unlisted");
    expect(r.blocked).toBe("100.00");
    expect(r.fiscal).toBe("0.00");
  });
});

describe("#457 migration: a loss 0.66.13 blocked is deducted in the year of the sale and never released later", () => {
  // The issue example plus a later sale of the other BTC on 01/03/2026 (+50).
  // 0.66.13 blocked the 100 in 2025 and released it in 2026. Now 2025 deducts
  // it and 2026 releases nothing, so a user who filed 2025 with 0.66.13 must
  // correct 2025 (docs/casillas.md warning box, guide_rw.blocked_losses_hint).
  const ops: Op[] = [
    ["2024-12-01", "BUY", 1, 200], ["2025-03-01", "BUY", 1, 100], ["2025-06-01", "SELL", 1, 100], ["2026-03-01", "SELL", 1, 150],
  ];

  it.each(METHODS)("[%s] 2025 deducts −100; 2026 reintegrates 0 and shows only its +50 gain", (method) => {
    expect(run(ops, 2025, method)).toMatchObject({ blocked: "0.00", fiscal: "-100.00" });
    expect(run(ops, 2026, method)).toMatchObject({ reintegrated: "0.00", fiscal: "50.00" });
  });
});

describe("#457 release rule: a sale of other coins releases nothing while the rebought coin is held", () => {
  // Loss −100 on 01/06/2025 (FIFO sells the 01/01 lot), rebought on 01/09/2025.
  // On 01/10/2026 FIFO sells the 01/03/2025 lot, not the rebought one, and no
  // buy follows it. Under art. 33.5.e the loss waits for the «posterior
  // transmisión del elemento patrimonial», the 01/09 coin, which is still held.
  // Up to the first #457 fix this sale was a «transmisión definitiva» and
  // released the 100 in 2026.
  const ops: Op[] = [
    ["2025-01-01", "BUY", 1, 200], ["2025-03-01", "BUY", 1, 150], ["2025-06-01", "SELL", 1, 100],
    ["2025-09-01", "BUY", 1, 90], ["2026-10-01", "SELL", 1, 160],
  ];

  it("2025 blocks 100; the 2026 sale of the 01/03/2025 lot releases nothing", () => {
    expect(run(ops, 2025).blocked).toBe("100.00");
    const r = run(ops, 2026);
    expect(r.report.capitalGains.disposals.map((d) => d.acquireDate.replace(/-/g, ""))).toEqual(["20250301"]);
    expect(r).toMatchObject({ reintegrated: "0.00", fiscal: "10.00" });
  });
});

describe("#457: a crypto buy before a later sale does not keep an older loss pending", () => {
  // 2025: loss −100 on 01/06, rebought on 01/09 (blocks 100). 2026: buy on 01/02,
  // sell 1 on 01/03 (FIFO sells the 01/09 lot: 120 − 90 = +30), nothing after.
  // Under letter e the 01/02 buy is before that sale, so it is no repurchase for
  // it: the 01/03 sale transmits the rebought 01/09 coin with no rebuy after it,
  // so it releases the 100.
  const ops: Op[] = [
    ["2025-01-01", "BUY", 1, 200], ["2025-06-01", "SELL", 1, 100], ["2025-09-01", "BUY", 1, 90],
    ["2026-02-01", "BUY", 1, 95], ["2026-03-01", "SELL", 1, 120],
  ];

  it.each(METHODS)("[%s] 2025 blocks 100; 2026 releases it (fiscal 30 − 100)", (method) => {
    const y25 = run(ops, 2025, method);
    expect(y25.blocked).toBe("100.00");
    expect(y25.fiscal).toBe("0.00");
    const y26 = run(ops, 2026, method);
    expect(y26.reintegrated).toBe("100.00");
    expect(y26.fiscal).toBe("-70.00");
  });

  it("mirror: on a security with no ISIN the 01/02 buy is a pre-sale repurchase, so 2026 releases nothing", () => {
    const y26 = run(ops, 2026, "multidivisa", "unlisted");
    expect(y26.reintegrated).toBe("0.00");
    expect(y26.fiscal).toBe("30.00");
  });

  it("the 2026 release still warns: a buy up to 01/03/2027 that the data does not show would undo it", () => {
    const m = run(ops, 2026).report.messages.find((x) => x.id === "report.antichurning_window_past_data");
    expect(m?.context).toEqual({ count: "1", year: "2026", lastDate: "31/12/2026", windowEnd: "01/03/2027" });
  });
});

describe("#457 follow-up: a crypto loss is released only when the rebought units are transmitted", () => {
  // CodeRabbit's history (geiresx/DeclaRenta#16). Buy 3 BTC in 2023 (200 each).
  // Sell 1 on 01/06/2025 for 100 (−100), rebought on 01/07/2025. Buy 1 more on
  // 01/05/2026. Sell 1 on 15/06/2026: FIFO sells a 2023 unit, and the 01/07/2025
  // coin is still held. Art. 33.5.e: «se integrará cuando se produzca la
  // posterior transmisión del elemento patrimonial», the reacquired one.
  const ops: Op[] = [
    ["2023-03-01", "BUY", 3, 600], ["2025-06-01", "SELL", 1, 100], ["2025-07-01", "BUY", 1, 110],
    ["2026-05-01", "BUY", 1, 120], ["2026-06-15", "SELL", 1, 250],
  ];

  it.each(METHODS)("[%s] 2025 blocks 100; the 15/06/2026 sale of a 2023 unit releases nothing", (method) => {
    expect(run(ops, 2025, method)).toMatchObject({ blocked: "100.00", fiscal: "0.00" });
    const r = run(ops, 2026, method);
    expect(r.report.capitalGains.disposals.map((d) => d.acquireDate.replace(/-/g, ""))).toEqual(["20230301"]);
    expect(r).toMatchObject({ reintegrated: "0.00", fiscal: "50.00" });
  });

  it.each(METHODS)("[%s] the later sale of the 01/07/2025 coin releases the 100", (method) => {
    // Sell the other 3 on 01/11/2026 with nothing bought after: the rebought
    // coin leaves, so the 100 is integrated in 2026.
    const r = run([...ops, ["2026-11-01", "SELL", 3, 600]], 2026, method);
    expect(r.reintegrated).toBe("100.00");
    const carrier = r.report.capitalGains.disposals.filter((d) => d.reintegratedLossEur.greaterThan(0));
    expect(carrier.map((d) => [d.acquireDate.replace(/-/g, ""), d.reintegratedLossEur.toFixed(2)])).toEqual([["20250701", "100.00"]]);
  });
});

describe("#457 follow-up: which coins carry the pending loss", () => {
  const released = (r: ReturnType<typeof run>) =>
    r.report.capitalGains.disposals.map((d) => [d.sellDate.replace(/-/g, ""), d.reintegratedLossEur.toFixed(2)]);

  it("a rebuy of 2 coins for a 1-coin loss: the tied coin of that day goes last", () => {
    // Loss −100 on 01/06/2025; 2 coins bought on 01/07/2025, 1 absorbs it.
    // Selling 1 coin of that day leaves 1 held, which keeps the tie; selling
    // the second releases the 100.
    const ops: Op[] = [
      ["2025-01-01", "BUY", 1, 200], ["2025-06-01", "SELL", 1, 100], ["2025-07-01", "BUY", 2, 220],
      ["2026-09-01", "SELL", 1, 130], ["2026-11-02", "SELL", 1, 130],
    ];
    expect(run(ops, 2025).blocked).toBe("100.00");
    expect(released(run(ops, 2026))).toEqual([["20260901", "0.00"], ["20261102", "100.00"]]);
  });

  it("selling half the rebought coin releases half the loss (proportional to quantity)", () => {
    const ops: Op[] = [
      ["2025-01-01", "BUY", 1, 200], ["2025-06-01", "SELL", 1, 100], ["2025-07-01", "BUY", 1, 110],
      ["2026-09-01", "SELL", 0.5, 70],
    ];
    expect(run(ops, 2026).reintegrated).toBe("50.00");
  });

  it.each(METHODS)("[%s] a chain: the rebought coin sold and rebought again passes the loss on to the new coin", (method) => {
    // 01/06/2025 loss −100, rebought 01/07/2025 (110). 01/03/2026 that coin is
    // sold for 90 (−20) and rebought on 01/04/2026: the sale is no definitive
    // transmission, so the 100 stays pending on the 01/04 coin and the 20 is
    // blocked by it. 01/11/2026 the 01/04 coin leaves with nothing after it:
    // both are integrated.
    const ops: Op[] = [
      ["2025-01-01", "BUY", 1, 200], ["2025-06-01", "SELL", 1, 100], ["2025-07-01", "BUY", 1, 110],
      ["2026-03-01", "SELL", 1, 90], ["2026-04-01", "BUY", 1, 95], ["2026-11-02", "SELL", 1, 100],
    ];
    expect(run(ops, 2025, method)).toMatchObject({ blocked: "100.00", fiscal: "0.00" });
    const r = run(ops, 2026, method);
    expect(released(r)).toEqual([["20260301", "0.00"], ["20261102", "120.00"]]);
    expect(r).toMatchObject({ blocked: "20.00", reintegrated: "120.00", fiscal: "-115.00" });
  });

  it("a gain sale of other coins uses up no rebuy, so the rebuy still blocks a later loss", () => {
    // 4 coins from 2023. 01/06/2025 loss −100, rebought 01/07/2025. 01/08/2025 a
    // 2023 coin is sold at a gain: it carries no pending loss, so it takes no
    // rebuy. The 15/08/2025 loss on a third 2023 coin is then blocked by the
    // 01/09/2025 buy. Up to the first #457 fix the gain sale ran the
    // definitive test and used up that buy, so the 15/08 loss was deducted.
    const ops: Op[] = [
      ["2023-03-01", "BUY", 4, 800], ["2025-06-01", "SELL", 1, 100], ["2025-07-01", "BUY", 1, 110],
      ["2025-08-01", "SELL", 1, 250], ["2025-08-15", "SELL", 1, 150], ["2025-09-01", "BUY", 1, 120],
    ];
    const r = run(ops, 2025);
    const blockedOf = r.report.capitalGains.disposals.map((d) => [d.sellDate.replace(/-/g, ""), d.blockedLossEur.toFixed(2)]);
    expect(blockedOf).toEqual([["20250601", "100.00"], ["20250801", "0.00"], ["20250815", "50.00"]]);
    expect(r.reintegrated).toBe("0.00");
  });

  it.each(METHODS)("[%s] selling every coin held before the rebuy is no release: the rebought coin is not yet transmitted", (method) => {
    // 2 coins from 2024. 01/06/2025 loss −100; 01/07/2025 the other coin is sold
    // and nothing is held; 01/08/2025 a coin is bought (it blocks the 01/06
    // loss). Selling out on 01/07 transmits no rebought coin, so the 100 waits
    // for the 01/08 coin, sold on 01/03/2026 with nothing bought after.
    const ops: Op[] = [
      ["2024-01-01", "BUY", 2, 400], ["2025-06-01", "SELL", 1, 100], ["2025-07-01", "SELL", 1, 250],
      ["2025-08-01", "BUY", 1, 120],
    ];
    expect(run(ops, 2025, method)).toMatchObject({ blocked: "100.00", reintegrated: "0.00", fiscal: "50.00" });
    const r = run([...ops, ["2026-03-01", "SELL", 1, 130]], 2026, method);
    expect(released(r)).toEqual([["20260301", "100.00"]]);
  });
});

describe("#457: a swap back into the coin is a repurchase (permuta, V1149-18)", () => {
  const BINANCE = "Date(UTC),Pair,Side,Price,Executed,Amount,Fee";
  const rateMap: EcbRateMap = new Map(
    ["2024-01-15", "2024-03-01", "2024-06-03"].map((d) => [d, new Map([["EUR", "1"]])] as const),
  );
  // The user's EUR value for BTC on the swap date (no price oracle).
  const manualRates: EcbRateMap = new Map([["2024-06-03", new Map([["BTC", "50000"]])]]);

  it("a BTC loss sale for EUR, then ETH swapped into 0.5 BTC within the year, blocks half the loss", () => {
    const csv = [
      BINANCE,
      "2024-01-15 10:00:00,BTCEUR,BUY,60000,1BTC,60000EUR,",
      "2024-01-15 11:00:00,ETHEUR,BUY,2500,10ETH,25000EUR,",
      "2024-03-01 10:00:00,BTCEUR,SELL,50000,1BTC,50000EUR,",
      "2024-06-03 10:00:00,ETHBTC,SELL,0.05,10ETH,0.5BTC,",
    ].join("\n");
    const p = binanceParser.parse(csv);
    const st: FlexStatement = {
      accountId: "", fromDate: "", toDate: "20241231", period: "",
      trades: p.trades, cashTransactions: p.cashTransactions, corporateActions: [], openPositions: [], securitiesInfo: [],
    };
    const report = generateTaxReport(st, rateMap, 2024, { manualRates });
    const sale = report.capitalGains.disposals.find((d) => d.symbol === "BTC")!;
    expect(sale.gainLossEur.toFixed(2)).toBe("-10000.00");
    expect(sale.blockedLossEur.toFixed(2)).toBe("5000.00");
    expect(sale.washSaleRepurchaseDates).toEqual(["2024-06-03"]);
  });
});
