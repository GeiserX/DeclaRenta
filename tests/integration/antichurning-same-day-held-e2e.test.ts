import { describe, it, expect } from "vitest";
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
// the sale day) to the pre-sale buy days, newest first. The sale day's own buys
// are in that count, but the walk skips them (no time of day), so their held
// shares go to the newest earlier buy day: an older lot stands in for the
// sale-day buy, even when FIFO sold it.
//
// A review of #454 read this as a bug and proposed taking the sale-day buys off
// the count. It is not: the DGT counts a sale-day buy as a rebuy (V0571-21,
// 11/08/2020: the 7,000 bought that day make the sale not definitive), and the
// stand-in is how the engine gets there. Taking them off gives 40 instead of 90
// below, and breaks two consultas pinned in antichurning-definitive-e2e:
// V2481-20 falls from 1,751.73 to 1,088.08 (DGT 1,767) and V0571-21 from
// −1,166.67 to −1,500 (DGT −1,166.67). These cases pin the DGT's figures, so
// that change turns them red.
//
// The stand-in has two real gaps, pinned at the end as `it.fails` on the DGT's
// figure: it needs an older lot inside the window, and the sale-day buy stays
// unused, so a later sale can use the same shares again.
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
      expect(trail(r, "2025-03-10")).toContain("20250305");
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
// KNOWN GAPS of the stand-in. Counting a sale-day buy for its own held shares
// closes both, but it also moves a committed fixture (see the design doc,
// "Known limitations"), so it waits for a decision.
// ---------------------------------------------------------------------------
describe("known gaps: the stand-in needs an older lot in the window, and can use the sale-day shares twice", () => {
  // Buy 100, sell all 100 on 10/03 at −100, buy 50 the same day. The DGT blocks
  // 50 (V0571-21). Bought on 01/03/2025 the 01/03 lot stands in and the engine
  // blocks 50; bought on 01/12/2024 no lot is inside the window and it blocks 0.
  const exit = (first: string): Row[] => [[first, "BUY", 100, 10], ["20250310", "SELL", 100, 9], ["20250310", "BUY", 50, 9]];

  it.each(METHODS)("[%s] engine: 50 blocked with the sold lot inside the window, 0 outside it", (method) => {
    expect(sumOn(ibkr(exit("20250301"), method), "2025-03-10", "blockedLossEur").toFixed(2)).toBe("50.00");
    expect(sumOn(ibkr(exit("20241201"), method), "2025-03-10", "blockedLossEur").toFixed(2)).toBe("0.00");
  });

  it.fails("known gap: the DGT blocks 50 whenever the lot was bought (V0571-21)", () => {
    expect(sumOn(ibkr(exit("20241201"), "monodivisa"), "2025-03-10", "blockedLossEur").toFixed(2)).toBe("50.00");
  });

  // Then on 20/03 sell 25 at −25 (FIFO sells 25 of 10/03). For the DGT the 10/03
  // buy was used by the 10/03 sale and the 01/03 shares are sold, so nothing
  // replaces the 20/03 sale: its 25 are definitive, deductible, and release 25
  // of the 50 pending. The engine used the 01/03 lot on 10/03 and leaves the
  // 10/03 buy unused, so 20/03 takes it and blocks 25.
  const twice: Row[] = [...exit("20250301"), ["20250320", "SELL", 25, 8]];

  it.each(METHODS)("[%s] engine: 20/03 is blocked by the shares 10/03 already counted", (method) => {
    const r = ibkr(twice, method);
    expect(sumOn(r, "2025-03-10", "blockedLossEur").toFixed(2)).toBe("50.00");
    expect(sumOn(r, "2025-03-20", "blockedLossEur").toFixed(2)).toBe("25.00");
    expect(sumOn(r, "2025-03-20", "reintegratedLossEur").toFixed(2)).toBe("0.00");
  });

  it.fails("known gap: the DGT deducts 20/03 and releases 25 of 10/03", () => {
    const r = ibkr(twice, "monodivisa");
    expect(sumOn(r, "2025-03-20", "blockedLossEur").toFixed(2)).toBe("0.00");
    expect(sumOn(r, "2025-03-20", "reintegratedLossEur").toFixed(2)).toBe("25.00");
  });
});
