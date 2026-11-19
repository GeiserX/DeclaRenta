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

describe("#457 open release rule: the definitive test can release while the rebought coin is still held", () => {
  // Loss −100 on 01/06/2025 (FIFO sells the 01/01 lot), rebought on 01/09/2025.
  // On 01/10/2026 FIFO sells the 01/03/2025 lot, not the rebought one, and no
  // buy follows it: the sale is definitive and releases the 100 though the
  // 01/09 coin is never sold. Under the reading "posterior transmisión" = the
  // sale of the reacquired element nothing would be released yet. The docs
  // (casillas.md, CLAUDE.md, the design doc) state this as open point A.
  const ops: Op[] = [
    ["2025-01-01", "BUY", 1, 200], ["2025-03-01", "BUY", 1, 150], ["2025-06-01", "SELL", 1, 100],
    ["2025-09-01", "BUY", 1, 90], ["2026-10-01", "SELL", 1, 160],
  ];

  it("2025 blocks 100; 2026 releases it on the sale of the 01/03/2025 lot", () => {
    expect(run(ops, 2025).blocked).toBe("100.00");
    const r = run(ops, 2026);
    expect(r.report.capitalGains.disposals.map((d) => d.acquireDate.replace(/-/g, ""))).toEqual(["20250301"]);
    expect(r.reintegrated).toBe("100.00");
  });
});

describe("#457: a crypto buy before a later sale does not keep an older loss pending", () => {
  // 2025: loss −100 on 01/06, rebought on 01/09 (blocks 100). 2026: buy on 01/02,
  // sell 1 on 01/03 (FIFO sells the 01/09 lot: 120 − 90 = +30), nothing after.
  // Under letter e the 01/02 buy is before that sale, so it is no repurchase for
  // it: the 01/03 sale is definitive and releases the 100.
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

  it("the 2026 release still warns: a buy before 01/03/2027 that the data does not show would undo it", () => {
    const m = run(ops, 2026).report.messages.find((x) => x.id === "report.antichurning_window_past_data");
    expect(m?.context).toEqual({ count: "1", year: "2026", lastDate: "31/12/2026", windowEnd: "01/03/2027" });
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
