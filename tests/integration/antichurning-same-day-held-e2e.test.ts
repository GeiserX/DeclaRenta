import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import Decimal from "decimal.js";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { degiroParser } from "../../src/parsers/degiro.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { FxMethod, TaxSummary as TaxReport } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// #454 follow-up: what a buy on the sale day does to the held-shares walk.
//
// The pick order of #454 counts a purchase made before the sale only for its
// shares still held after the sale (V3282-18 A: «únicamente, las compras que
// supongan una recompra»). The walk hands `holdingAfter` (the position after
// the sale day) to the buy days newest first. FIFO sells the oldest shares
// first, so the sale day's own buys are the newest shares held after it: they
// are the walk's first day and count for their own held shares. The DGT counts
// a sale-day buy as a rebuy (V0571-21, 11/08/2020: the 7,000 bought that day
// make the sale not definitive).
//
// Taking the sale-day buys off the count (a review's proposal) gives 40
// instead of 90 below, V2481-20 1,088.08 instead of 1,751.73 (DGT 1,767) and
// V0571-21 −1,500 instead of −1,166.67 (DGT −1,166.67). These cases pin the
// DGT's figures, so that change turns them red.
//
// Before this rule the walk skipped the sale day and credited its held shares
// to an older lot (the "stand-in"). That had three gaps, each pinned below on
// the DGT's figure: (a) with no unused older lot in the window the rebuy was
// missed; (b) the sale-day buy stayed unused, so a later sale used the same
// shares again; (c) the stood-in lot was only partly held, so it went after
// the post-sale buys and the sale took a later purchase the DGT leaves for the
// next sale.
//
// Every case runs through the REAL parsers (IBKR Flex XML, DEGIRO CSV) and
// generateTaxReport, in the three FX methods.
// ===========================================================================

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];
const ISIN = "ES0000004541";

/** [date YYYYMMDD, side, quantity, price] */
type Row = [date: string, side: "BUY" | "SELL", qty: number, price: number];

let tradeSeq = 0;
function tradeXml([date, side, qty, price]: Row, currency: string): string {
  const signed = side === "BUY" ? qty : -qty;
  const money = new Decimal(qty).mul(price);
  tradeSeq++;
  return `<Trade tradeID="${tradeSeq}" ibOrderID="${tradeSeq}" accountId="U1" symbol="XYZ" description="XYZ SA" conid="4541" isin="${ISIN}" assetCategory="STK" currency="${currency}" tradeDate="${date}" settlementDate="${date}" quantity="${signed}" tradePrice="${price}" tradeMoney="${side === "BUY" ? money : money.neg()}" proceeds="${side === "BUY" ? money.neg() : money}" cost="${money}" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}" exchange="BME" ibCommissionCurrency="${currency}" ibCommission="0" taxes="0" multiplier="1" />`;
}

function ibkrXml(rows: Row[], currency = "EUR"): string {
  const net = rows.reduce((sum, [, side, qty]) => sum + (side === "BUY" ? qty : -qty), 0);
  const op =
    net > 0
      ? `<OpenPosition accountId="U1" symbol="XYZ" description="XYZ SA" isin="${ISIN}" currency="${currency}" assetCategory="STK" quantity="${net}" costBasisMoney="0" costBasisPrice="0" markPrice="10" positionValue="0" fifoPnlUnrealized="0" fxRateToBase="1" />`
      : "";
  return `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20240101" toDate="20251231" period="Custom"><Trades>${rows
    .map((r) => tradeXml(r, currency))
    .join("")}</Trades><CashTransactions /><CorporateActions /><OpenPositions>${op}</OpenPositions><SecuritiesInfo /></FlexStatement></FlexStatements></FlexQueryResponse>`;
}

function rates(): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (let t = Date.UTC(2024, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86_400_000) {
    map.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "1.10"]]));
  }
  return map;
}

function ibkr(rows: Row[], method: FxMethod, currency = "EUR"): TaxReport {
  const statement = finalizeMergedStatement(mergeStatement(createEmptyStatement(), parseIbkrFlexXml(ibkrXml(rows, currency)), "Interactive Brokers"));
  return generateTaxReport(statement, rates(), 2025, reportOptionsForMethod(method));
}

function degiro(rows: Row[], method: FxMethod): TaxReport {
  const comma = (n: Decimal): string => n.toFixed(2).replace(".", ",");
  const lines = rows.map(([date, side, qty, price], i) => {
    const day = `${date.slice(6, 8)}-${date.slice(4, 6)}-${date.slice(0, 4)}`;
    const value = new Decimal(qty).mul(price).mul(side === "BUY" ? -1 : 1);
    return `${day},10:00,XYZ SA,${ISIN},MAD,XMAD,${side === "BUY" ? qty : -qty},"${comma(new Decimal(price))}",EUR,"${comma(value)}",EUR,"0,00",EUR,"${comma(value)}",EUR,o${i}`;
  });
  const csv = [
    "Fecha,Hora,Producto,ISIN,Centro de referencia,Centro de ejecución,Cantidad,Precio,,Valor,,Costes de transacción y/o terceros,,Total,,ID Orden",
    ...lines,
  ].join("\n");
  const statement = finalizeMergedStatement(mergeStatement(createEmptyStatement(), degiroParser.parse(csv), degiroParser.name));
  return generateTaxReport(statement, rates(), 2025, reportOptionsForMethod(method));
}

/** Same day, whatever the parser's date format (IBKR keeps YYYYMMDD). */
const sameDay = (a: string, b: string): boolean => a.replace(/-/g, "") === b.replace(/-/g, "");
const on = (r: TaxReport, date: string) => r.capitalGains.disposals.filter((d) => sameDay(d.sellDate, date));
const sumOn = (r: TaxReport, date: string, field: "blockedLossEur" | "reintegratedLossEur" | "gainLossEur"): Decimal =>
  on(r, date).reduce((s, d) => s.plus(d[field]), new Decimal(0));
const trail = (r: TaxReport, date: string): string[] =>
  [...new Set(on(r, date).flatMap((d) => (d.washSaleRepurchaseDates ?? []).map((x) => x.replace(/-/g, ""))))].sort();
/** The year's capital-gains contribution: net + blocked − reintegrated. */
const fiscal = (r: TaxReport): string => {
  const cg = r.capitalGains;
  return cg.netGainLoss.plus(cg.blockedLosses).minus(cg.reintegratedLosses).toFixed(2);
};
const noMark = (r: TaxReport): boolean => r.capitalGains.disposals.every((d) => d.washSaleSinglePurchase === undefined);

// ---------------------------------------------------------------------------
// The review's example. Buy 100 on 01/03 and 40 on 05/03; on 10/03 sell 100 at
// −100 and buy 50. FIFO sells the whole 01/03 lot, so 90 shares are held after
// the day: the 50 of 10/03 and the 40 of 05/03. Both are rebuys for the DGT:
// 05/03 is a purchase before the sale still held (V3282-18 A), and 10/03 a buy
// on the sale day (V0571-21). Situation 3 gives the same count: 90 held after
// the sale, fewer than the 140 bought in the 2 months before. 90 of the 100
// sold shares are replaced: 90 blocked, 10 deductible (fiscal −10).
// ---------------------------------------------------------------------------
describe("the review's example: the 50 bought on the sale day count, so 90 are blocked", () => {
  const rows: Row[] = [
    ["20250301", "BUY", 100, 10],
    ["20250305", "BUY", 40, 10],
    ["20250310", "SELL", 100, 9],
    ["20250310", "BUY", 50, 9],
  ];

  for (const method of METHODS) {
    it(`[${method}] IBKR: 90 blocked (fiscal −10)`, () => {
      const r = ibkr(rows, method);
      expect(sumOn(r, "2025-03-10", "gainLossEur").toFixed(2)).toBe("-100.00");
      expect(sumOn(r, "2025-03-10", "blockedLossEur").toFixed(2)).toBe("90.00");
      expect(trail(r, "2025-03-10")).toEqual(["20250305", "20250310"]);
      expect(fiscal(r)).toBe("-10.00");
      expect(noMark(r)).toBe(true);
    });

    it(`[${method}] DEGIRO CSV gives the same year`, () => {
      const r = degiro(rows, method);
      expect(sumOn(r, "2025-03-10", "blockedLossEur").toFixed(2)).toBe("90.00");
      expect(fiscal(r)).toBe("-10.00");
      expect(noMark(r)).toBe(true);
    });

    it(`[${method}] IBKR in USD: 90 of the 100 sold shares blocked, whatever the EUR loss`, () => {
      const r = ibkr(rows, method, "USD");
      const loss = sumOn(r, "2025-03-10", "gainLossEur");
      expect(loss.isNegative()).toBe(true);
      expect(sumOn(r, "2025-03-10", "blockedLossEur").div(loss.abs()).toFixed(6)).toBe("0.900000");
    });
  }
});

// ---------------------------------------------------------------------------
// A sale larger than the shares held before the day. Buy 100 on 01/03 and 40
// on 05/03; on 10/03 buy 20 and sell 130 at −130. FIFO sells 01/03 and 30 of
// 05/03, so 30 are held: the 20 of 10/03 and 10 of 05/03. Both are rebuys
// (V0571-21; V3282-18 A situation 3, the lot the sale transmits): 30 blocked.
// ---------------------------------------------------------------------------
describe("a sale larger than the earlier holding: the sale-day buy and the rest of 05/03 count", () => {
  it.each(METHODS)("[%s] 30 of the 130 sold shares blocked", (method) => {
    const r = ibkr([["20250301", "BUY", 100, 10], ["20250305", "BUY", 40, 10], ["20250310", "SELL", 130, 9], ["20250310", "BUY", 20, 9]], method);
    expect(sumOn(r, "2025-03-10", "gainLossEur").toFixed(2)).toBe("-130.00");
    expect(sumOn(r, "2025-03-10", "blockedLossEur").toFixed(2)).toBe("30.00");
  });
});

// ---------------------------------------------------------------------------
// The definitive test of #451 uses the same absorption. Buy 200 on 01/03; sell
// 100 on 05/03 at −100, rebought by 100 on 08/03 (100 blocked, pending). On
// 20/03 sell all 200 at +200 and buy 300 the same day. The DGT counts the 300
// as a rebuy (V0571-21), so the sale is not definitive: the 100 stays pending
// (fiscal 200). Taking the sale-day buys off the count released it (fiscal 100).
// ---------------------------------------------------------------------------
describe("the definitive test: a sale rebought the same day keeps the loss pending (V0571-21)", () => {
  const rows: Row[] = [
    ["20250301", "BUY", 200, 10],
    ["20250305", "SELL", 100, 9],
    ["20250308", "BUY", 100, 10],
    ["20250320", "SELL", 200, 11],
    ["20250320", "BUY", 300, 11],
  ];

  it.each(METHODS)("[%s] 20/03 releases nothing (fiscal 200)", (method) => {
    const r = ibkr(rows, method);
    expect(sumOn(r, "2025-03-05", "blockedLossEur").toFixed(2)).toBe("100.00");
    expect(sumOn(r, "2025-03-20", "reintegratedLossEur").toFixed(2)).toBe("0.00");
    expect(fiscal(r)).toBe("200.00");
  });
});

// ---------------------------------------------------------------------------
// The three gaps the stand-in had, closed by counting the sale-day buy for its
// own held shares. Each case pins the DGT's figure through the IBKR Flex XML
// and DEGIRO CSV parsers in the three FX methods.
// ---------------------------------------------------------------------------
describe("gap (a): a sale-day rebuy blocks without an older lot in the window", () => {
  // Buy 100, sell all 100 on 10/03 at −100, buy 50 the same day. The DGT blocks
  // 50 (V0571-21), whenever the 100 were bought. The stand-in needed an older
  // lot inside the window: bought on 01/12/2024 it blocked 0.
  const exit = (first: string): Row[] => [[first, "BUY", 100, 10], ["20250310", "SELL", 100, 9], ["20250310", "BUY", 50, 9]];

  for (const method of METHODS) {
    it(`[${method}] 50 blocked with the sold lot inside or outside the window, by the 10/03 buy (IBKR and DEGIRO)`, () => {
      for (const first of ["20250301", "20241201"]) {
        for (const r of [ibkr(exit(first), method), degiro(exit(first), method)]) {
          expect(sumOn(r, "2025-03-10", "blockedLossEur").toFixed(2)).toBe("50.00");
          expect(trail(r, "2025-03-10")).toEqual(["20250310"]);
          expect(fiscal(r)).toBe("-50.00");
          expect(noMark(r)).toBe(true);
        }
      }
    });
  }
});

describe("gap (b): the sale-day shares are used once", () => {
  // Then on 20/03 sell 25 at −25 (FIFO sells 25 of 10/03). The 10/03 buy was
  // used by the 10/03 sale and the 01/03 shares are sold, so nothing replaces
  // the 20/03 sale: its 25 are definitive, deductible, and release 25 of the 50
  // pending (fiscal −100). The stand-in used the 01/03 lot on 10/03 and left the
  // 10/03 buy for 20/03, which blocked 25.
  const twice: Row[] = [["20250301", "BUY", 100, 10], ["20250310", "SELL", 100, 9], ["20250310", "BUY", 50, 9], ["20250320", "SELL", 25, 8]];

  for (const method of METHODS) {
    it(`[${method}] 20/03 is deducted and releases 25 of 10/03 (IBKR and DEGIRO)`, () => {
      for (const r of [ibkr(twice, method), degiro(twice, method)]) {
        expect(sumOn(r, "2025-03-10", "blockedLossEur").toFixed(2)).toBe("50.00");
        expect(sumOn(r, "2025-03-20", "blockedLossEur").toFixed(2)).toBe("0.00");
        expect(sumOn(r, "2025-03-20", "reintegratedLossEur").toFixed(2)).toBe("25.00");
        expect(fiscal(r)).toBe("-100.00");
      }
    });
  }
});

describe("gap (a), wider: the held count no longer lands on a lot an earlier sale used", () => {
  // Buy 100 on 01/03 and 100 on 02/03. On 03/03 sell 100 at −100: FIFO sells
  // 01/03, and 02/03 (still held) replaces it, 100 blocked. On 10/03 sell 100 at
  // −100 (FIFO sells 02/03) and buy 50 the same day. The 50 are a rebuy
  // (V0571-21): 50 blocked, and the other 50 sold shares are definitive and
  // release 50 of the 03/03 loss (fiscal −100). The stand-in handed the 50 held
  // shares to 02/03, which 03/03 used: 10/03 blocked 0 and released 100 (−200).
  const used: Row[] = [
    ["20250301", "BUY", 100, 10],
    ["20250302", "BUY", 100, 10],
    ["20250303", "SELL", 100, 9],
    ["20250310", "SELL", 100, 9],
    ["20250310", "BUY", 50, 9],
  ];

  for (const method of METHODS) {
    it(`[${method}] 10/03 blocks 50 and releases 50 (IBKR and DEGIRO)`, () => {
      for (const r of [ibkr(used, method), degiro(used, method)]) {
        expect(sumOn(r, "2025-03-03", "blockedLossEur").toFixed(2)).toBe("100.00");
        expect(sumOn(r, "2025-03-10", "blockedLossEur").toFixed(2)).toBe("50.00");
        expect(sumOn(r, "2025-03-10", "reintegratedLossEur").toFixed(2)).toBe("50.00");
        expect(fiscal(r)).toBe("-100.00");
      }
    });
  }

  // The V0571-21 layout without the unused pre-sale buy that saves it in the
  // consulta. Buy 100 on 01/12/2024. On 05/03/2025 sell 50 at −50, rebought by
  // 50 on 08/03 (50 blocked, pending). On 20/03 sell all 100 at +100 and buy 300
  // the same day. The 300 make the sale not definitive (V0571-21): release 0,
  // fiscal 100. The stand-in handed the held shares to 08/03, which 05/03 used,
  // so 20/03 counted as definitive and released the 50 (fiscal 50).
  const definitive: Row[] = [
    ["20241201", "BUY", 100, 10],
    ["20250305", "SELL", 50, 9],
    ["20250308", "BUY", 50, 10],
    ["20250320", "SELL", 100, 11],
    ["20250320", "BUY", 300, 11],
  ];

  for (const method of METHODS) {
    it(`[${method}] a sale rebought the same day is not definitive: the 50 stay pending (IBKR and DEGIRO)`, () => {
      for (const r of [ibkr(definitive, method), degiro(definitive, method)]) {
        expect(sumOn(r, "2025-03-05", "blockedLossEur").toFixed(2)).toBe("50.00");
        expect(sumOn(r, "2025-03-20", "reintegratedLossEur").toFixed(2)).toBe("0.00");
        expect(fiscal(r)).toBe("100.00");
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Gap (c): the sale-day buy is the oldest unused purchase after the earlier
// days. Buy 100 on 01/03. On 10/03 sell 100 at −100 and buy 50; on 15/03 buy
// 100; on 20/03 sell 50 at −50 (FIFO sells the 50 of 10/03). The 10/03 sale
// takes the 50 bought that day (V0571-21), then 50 of 15/03 (100 blocked). The
// 20/03 sale finds 50 of 15/03 unused and still held (V3282-18 A): 50 blocked,
// nothing definitive, nothing released (fiscal 0). The stand-in put the sold
// 01/03 lot after the post-sale buys, so 10/03 took all of 15/03 and 20/03 was
// deducted and released 50 (fiscal −100).
// ---------------------------------------------------------------------------
describe("gap (c): the sale-day rebuy comes before the post-sale buys", () => {
  const order: Row[] = [
    ["20250301", "BUY", 100, 10],
    ["20250310", "SELL", 100, 9],
    ["20250310", "BUY", 50, 9],
    ["20250315", "BUY", 100, 9],
    ["20250320", "SELL", 50, 8],
  ];

  for (const method of METHODS) {
    it(`[${method}] 10/03 takes its own 50 and 50 of 15/03; 20/03 blocks 50 and releases nothing (IBKR and DEGIRO)`, () => {
      for (const r of [ibkr(order, method), degiro(order, method)]) {
        expect(sumOn(r, "2025-03-10", "blockedLossEur").toFixed(2)).toBe("100.00");
        expect(trail(r, "2025-03-10")).toEqual(["20250310", "20250315"]);
        expect(sumOn(r, "2025-03-20", "blockedLossEur").toFixed(2)).toBe("50.00");
        expect(trail(r, "2025-03-20")).toEqual(["20250315"]);
        expect(sumOn(r, "2025-03-20", "reintegratedLossEur").toFixed(2)).toBe("0.00");
        expect(fiscal(r)).toBe("0.00");
      }
    });
  }
});

// ---------------------------------------------------------------------------
// The one-purchase exception (#453) still sees a sale-day buy as a purchase.
// Buy 2 and sell 1 at −1 on 10/03 with nothing held before: the day's buy is
// the only purchase of the window and FIFO sells one of its shares, so the
// other one is held. With the exception proven (IBKR with Open Positions that
// the trades explain) the loss is deductible; a DEGIRO CSV lists no holdings,
// so the fail-safe keeps it blocked with the "unverified" mark. This is the
// `degiro-transactions-sample.csv` 2021 THETA case. A second buy in the window
// (01/03) makes it two purchases: no exception, the held share blocks.
// ---------------------------------------------------------------------------
describe("the one-purchase exception with a sale-day buy", () => {
  const lone: Row[] = [["20250310", "BUY", 2, 10], ["20250310", "SELL", 1, 9]];

  for (const method of METHODS) {
    it(`[${method}] IBKR proves the exception: deductible, marked applied`, () => {
      const r = ibkr(lone, method);
      expect(sumOn(r, "2025-03-10", "blockedLossEur").toFixed(2)).toBe("0.00");
      expect(on(r, "2025-03-10").every((d) => d.washSaleSinglePurchase === "applied")).toBe(true);
      expect(fiscal(r)).toBe("-1.00");
    });

    it(`[${method}] DEGIRO cannot prove it: blocked, marked unverified`, () => {
      const r = degiro(lone, method);
      expect(sumOn(r, "2025-03-10", "blockedLossEur").toFixed(2)).toBe("1.00");
      expect(on(r, "2025-03-10").every((d) => d.washSaleSinglePurchase === "unverified")).toBe(true);
      expect(fiscal(r)).toBe("0.00");
    });

    it(`[${method}] a second purchase in the window: no exception, the held share blocks`, () => {
      const r = ibkr([["20250301", "BUY", 1, 10], ...lone], method);
      expect(sumOn(r, "2025-03-10", "blockedLossEur").toFixed(2)).toBe("1.00");
      expect(noMark(r)).toBe(true);
    });
  }
});

// The committed fixture: THETA bought 2 and sold 1 at a loss on 14/04/2021, the
// first THETA rows of the file. The day's buy is the only purchase of the
// window and the CSV lists no holdings, so the loss stays blocked with the
// "unverified" warning. Up to the #454 follow-up the engine skipped the sale-day
// buy and deducted the 49.02.
describe("degiro-transactions-sample.csv 2021: the THETA sale-day buy blocks the loss", () => {
  const fixtureRates = (): EcbRateMap => {
    const map: EcbRateMap = new Map();
    for (let t = Date.UTC(2020, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86_400_000) {
      map.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "1.20"]]));
    }
    return map;
  };
  const csv = readFileSync(new URL("../fixtures/degiro-transactions-sample.csv", import.meta.url), "utf-8");

  it.each(METHODS)("[%s] the whole loss is blocked, marked unverified, with the warning", (method) => {
    const statement = finalizeMergedStatement(mergeStatement(createEmptyStatement(), degiroParser.parse(csv), degiroParser.name));
    const r = generateTaxReport(statement, fixtureRates(), 2021, reportOptionsForMethod(method));
    const theta = r.capitalGains.disposals.filter((d) => d.symbol.includes("THETA") && sameDay(d.sellDate, "2021-04-14"));
    expect(theta).toHaveLength(1);
    expect(theta[0]!.gainLossEur.isNegative()).toBe(true);
    expect(theta[0]!.blockedLossEur.toFixed(6)).toBe(theta[0]!.gainLossEur.abs().toFixed(6));
    expect(theta[0]!.washSaleSinglePurchase).toBe("unverified");
    expect(r.messages.some((m) => m.id === "report.antichurning_single_purchase_unverified")).toBe(true);
  });
});
