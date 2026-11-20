import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import Decimal from "decimal.js";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { degiroParser } from "../../src/parsers/degiro.js";
import { parseRevolutXlsx } from "../../src/parsers/revolut.js";
import { trading212Parser } from "../../src/parsers/trading212.js";
import { freedom24Parser } from "../../src/parsers/freedom24.js";
import { lightyearParser } from "../../src/parsers/lightyear.js";
import { scalableParser } from "../../src/parsers/scalable.js";
import { flatexParser } from "../../src/parsers/flatex.js";
import { tradeRepublicParser } from "../../src/parsers/trade-republic.js";
import { parseEtoroXlsx } from "../../src/parsers/etoro.js";
import * as XLSX from "xlsx";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { FxMethod, TaxSummary as TaxReport } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Statement } from "../../src/types/broker.js";

// ===========================================================================
// Issue #453: the one-purchase exception of the 2-month rule.
//
// DGT V3282-18 (and every later consulta that repeats its procedure), rule A)
// on the purchases of the 2 months BEFORE the sale: «No obstante, esta regla no
// resulta de aplicación cuando dentro del plazo de los dos meses anteriores a la
// transmisión sólo se hubiera efectuado una operación de compra y, además, al
// inicio de ese período no se tuvieran acciones o participaciones homogéneas.»
// AEAT Manual práctico Renta 2025: «No se aplicará dicha limitación si solo hubo
// una operación de compra de valores en los dos meses anteriores a la
// transmisión y al inicio de ese periodo no se poseían valores homogéneos.»
//
// Every case runs through the REAL IBKR parser and generateTaxReport.
// ===========================================================================

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];
const ISIN = "ES0000004531";

/** [date YYYYMMDD, side, quantity, price, extra XML attributes, openCloseIndicator] */
type Row = [date: string, side: "BUY" | "SELL", qty: number, price: number, extra?: string, oci?: "O" | "C"];

let tradeSeq = 0;
function tradeXml([date, side, qty, price, extra = "", oci]: Row, currency: string, isin = ISIN, account = "U1"): string {
  const signed = side === "BUY" ? qty : -qty;
  const money = new Decimal(qty).mul(price);
  tradeSeq++;
  return `<Trade tradeID="${tradeSeq}" accountId="${account}" symbol="XYZ" description="XYZ SA" conid="4531" isin="${isin}" assetCategory="STK" currency="${currency}" tradeDate="${date}" settlementDate="${date}" quantity="${signed}" tradePrice="${price}" tradeMoney="${side === "BUY" ? money : money.neg()}" proceeds="${side === "BUY" ? money.neg() : money}" cost="${money}" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${oci ?? (side === "BUY" ? "O" : "C")}" exchange="BME" ibCommissionCurrency="${currency}" ibCommission="0" taxes="0" multiplier="1" ${extra} />`;
}

/** An Open Positions row as IBKR writes it: the held quantity is the `position` attribute. */
function openPositionXml(isin: string, quantity: number | string | null, currency: string, account = "U1"): string {
  const qty = quantity === null ? "" : ` position="${quantity}"`;
  return `<OpenPosition accountId="${account}" symbol="XYZ" description="XYZ SA" conid="4531" isin="${isin}" currency="${currency}" assetCategory="STK"${qty} costBasisMoney="0" costBasisPrice="0" markPrice="10" positionValue="0" fifoPnlUnrealized="0" fxRateToBase="1" side="Long" levelOfDetail="SUMMARY" />`;
}

/**
 * An IBKR Flex statement. Its OpenPositions list what the rows leave held (as
 * IBKR does at the period end), plus `heldBefore` shares bought before the file;
 * `positions` replaces that list (`[]` = no OpenPositions in the query) and
 * `otherPositions` adds holdings of other securities.
 */
function ibkrXml(
  rows: Row[],
  {
    fromDate = "20240101",
    toDate = "20251231",
    currency = "EUR",
    isin = ISIN,
    actions = "",
    heldBefore = 0,
    positions = undefined as [isin: string, qty: number][] | undefined,
    otherPositions = [] as [isin: string, qty: number][],
  } = {},
): string {
  const net = rows.reduce((sum, [, side, qty]) => sum + (side === "BUY" ? qty : -qty), heldBefore);
  const listed = positions ?? (net > 0 ? [[isin, net] as [string, number]] : []);
  const all = [...listed, ...otherPositions];
  // `positions: []` with no other rows: the query has no Open Positions section.
  const op = positions !== undefined && all.length === 0 ? "" : `<OpenPositions>${all.map(([i, q]) => openPositionXml(i, q, currency)).join("")}</OpenPositions>`;
  return `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="${fromDate}" toDate="${toDate}" period="Custom"><Trades>${rows
    .map((r) => tradeXml(r, currency, isin))
    .join("")}</Trades><CashTransactions /><CorporateActions>${actions}</CorporateActions>${op}<SecuritiesInfo /></FlexStatement></FlexStatements></FlexQueryResponse>`;
}

function rates(): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86_400_000) {
    map.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "1.10"]]));
  }
  return map;
}

function run(xml: string, year: number, method: FxMethod = "monodivisa"): TaxReport {
  const statement = finalizeMergedStatement(mergeStatement(createEmptyStatement(), parseIbkrFlexXml(xml), "Interactive Brokers"));
  return generateTaxReport(statement, rates(), year, reportOptionsForMethod(method));
}

/** The year's capital-gains contribution: net + blocked − reintegrated. */
function fiscal(r: TaxReport): string {
  const cg = r.capitalGains;
  return cg.netGainLoss.plus(cg.blockedLosses).minus(cg.reintegratedLosses).toFixed(2);
}

// ---------------------------------------------------------------------------
// The issue's example: one buy of 100, a partial sale of 50 at a loss.
// ---------------------------------------------------------------------------
describe("#453 issue example: the only purchase of the 2 months before, with no shares at its start", () => {
  const rows: Row[] = [
    ["20250301", "BUY", 100, 10],
    ["20250315", "SELL", 50, 8],
  ];

  it.each(METHODS)("[%s] the −100 loss is deductible in 2025, nothing is blocked (EUR)", (method) => {
    const r = run(ibkrXml(rows), 2025, method);
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("-100.00");
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("0.00");
    expect(fiscal(r)).toBe("-100.00");
    expect(r.capitalGains.disposals[0]!.washSaleBlocked).toBe(false);
  });
});

const APPLIED = "report.antichurning_single_purchase";
const UNVERIFIED = "report.antichurning_single_purchase_unverified";
const ids = (r: TaxReport): string[] => r.messages.map((m) => m.id).filter((id) => id === APPLIED || id === UNVERIFIED);
/** Same day, whatever the parser's date format (IBKR keeps YYYYMMDD). */
const sameDay = (a: string, b: string): boolean => a.replace(/-/g, "") === b.replace(/-/g, "");
const blockedOn = (r: TaxReport, date: string): string =>
  r.capitalGains.disposals
    .filter((d) => sameDay(d.sellDate, date))
    .reduce((s, d) => s.plus(d.blockedLossEur), new Decimal(0))
    .toFixed(2);
const releasedOn = (r: TaxReport, date: string): string =>
  r.capitalGains.disposals
    .filter((d) => sameDay(d.sellDate, date))
    .reduce((s, d) => s.plus(d.reintegratedLossEur), new Decimal(0))
    .toFixed(2);

describe("#453 issue example: amounts in a foreign currency and the message", () => {
  const rows: Row[] = [
    ["20250301", "BUY", 100, 10],
    ["20250315", "SELL", 50, 8],
  ];

  it.each(METHODS)("[%s] USD at a flat 1.10: nothing blocked", (method) => {
    const r = run(ibkrXml(rows, { currency: "USD" }), 2025, method);
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("0.00");
    expect(r.capitalGains.disposals[0]!.gainLossEur.isNegative()).toBe(true);
  });

  it("says the exception was applied, once, with the window start, and marks the disposal", () => {
    const r = run(ibkrXml(rows), 2025);
    expect(ids(r)).toEqual([APPLIED]);
    const msg = r.messages.find((m) => m.id === APPLIED)!;
    expect(msg.severity).toBe("info");
    expect(msg.context).toEqual({ count: "1", year: "2025", windowStart: "15/01/2025" });
    expect(r.capitalGains.disposals[0]!.washSaleSinglePurchase).toBe("applied");
  });
});

// ---------------------------------------------------------------------------
// (a) The exception lifts only rule A), the purchases BEFORE the sale. V3282-18
// B): «Lo anterior debe entenderse sin perjuicio de que las recompras efectuadas
// en el plazo de los dos meses posteriores a la transmisión impidan también la
// imputación»; Manual 2025: «Asimismo, deben tenerse en cuenta las compras
// posteriores a la venta en los dos meses siguientes».
// ---------------------------------------------------------------------------
describe("(a) a repurchase after the sale still blocks", () => {
  it("buy 100, sell 50 at −100, rebuy 30 after: 30 of 50 shares blocked (60), not the whole loss", () => {
    const r = run(ibkrXml([["20250301", "BUY", 100, 10], ["20250315", "SELL", 50, 8], ["20250401", "BUY", 30, 10]]), 2025);
    expect(blockedOn(r, "2025-03-15")).toBe("60.00");
    expect(ids(r)).toEqual([APPLIED]);
  });

  it("a rebuy after the sale that covers every sold share blocks it all, and the exception changes nothing (no mark)", () => {
    const r = run(ibkrXml([["20250301", "BUY", 100, 10], ["20250315", "SELL", 50, 8], ["20250401", "BUY", 50, 10]]), 2025);
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(ids(r)).toEqual([]);
    expect(r.capitalGains.disposals[0]!.washSaleSinglePurchase).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Controls: when either condition fails, the purchase before blocks as before.
// ---------------------------------------------------------------------------
describe("controls: two purchases, or shares held when the window starts", () => {
  it("two buy operations in the window: the loss stays blocked", () => {
    const r = run(ibkrXml([["20250301", "BUY", 60, 10], ["20250305", "BUY", 40, 10], ["20250315", "SELL", 50, 8]]), 2025);
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(ids(r)).toEqual([]);
  });

  it("shares held since before the window: the loss stays blocked", () => {
    const r = run(ibkrXml([["20241202", "BUY", 100, 10], ["20250301", "BUY", 100, 10], ["20250315", "SELL", 50, 8]]), 2025);
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(ids(r)).toEqual([]);
  });

  it("shares held on the window's first day and sold inside it still count as held at its start", () => {
    // Window of the 15/03 sale: 15/01 – 15/03. On 15/01 the 100 bought in December
    // are still held; they are sold on 20/01, inside the window.
    const r = run(
      ibkrXml([["20241202", "BUY", 100, 10], ["20250120", "SELL", 100, 10], ["20250301", "BUY", 100, 10], ["20250315", "SELL", 50, 8]]),
      2025,
    );
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(ids(r)).toEqual([]);
  });

  it("an earlier position closed before the window starts does not stop the exception", () => {
    const r = run(
      ibkrXml([["20241001", "BUY", 100, 10], ["20241101", "SELL", 100, 10], ["20250301", "BUY", 100, 10], ["20250315", "SELL", 50, 8]]),
      2025,
    );
    expect(blockedOn(r, "2025-03-15")).toBe("0.00");
    expect(ids(r)).toEqual([APPLIED]);
  });

  it("a purchase on the sale day counts as a second purchase (no intraday order): the loss stays blocked", () => {
    const r = run(ibkrXml([["20250301", "BUY", 100, 10], ["20250315", "BUY", 10, 10], ["20250315", "SELL", 50, 8]]), 2025);
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(ids(r)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (b) The doctrine states the exception inside the procedure of letter f, the
// 2-month window. V0183-23 sends US-only shares to letter g (1 year) without
// saying the exception carries over, so the engine keeps the 1-year rule whole.
// ---------------------------------------------------------------------------
describe("(b) only the 2-month window (letter f)", () => {
  it("a security without ISIN (1-year window in the engine): the loss stays blocked, no message", () => {
    const r = run(ibkrXml([["20250301", "BUY", 100, 10], ["20250315", "SELL", 50, 8]], { isin: "" }), 2025);
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("100.00");
    expect(ids(r)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (c) «una operación de compra» is one buy order on one day. IBKR lists each
// fill as an execution with one ibOrderID (the parser collapses them into one
// trade); DEGIRO lists each fill as a row with one «ID Orden».
// ---------------------------------------------------------------------------
describe("(c) the fills of one order are one purchase", () => {
  it("IBKR: two executions of one order (same ibOrderID) are one purchase", () => {
    const r = run(
      ibkrXml([
        ["20250301", "BUY", 60, 10, 'ibOrderID="777" levelOfDetail="EXECUTION"'],
        ["20250301", "BUY", 40, 10, 'ibOrderID="777" levelOfDetail="EXECUTION"'],
        ["20250315", "SELL", 50, 8, 'ibOrderID="778"'],
      ]),
      2025,
    );
    expect(blockedOn(r, "2025-03-15")).toBe("0.00");
  });

  it("IBKR: two orders on the same day are two purchases", () => {
    const r = run(
      ibkrXml([
        ["20250301", "BUY", 60, 10, 'ibOrderID="777"'],
        ["20250301", "BUY", 40, 10, 'ibOrderID="779"'],
        ["20250315", "SELL", 50, 8, 'ibOrderID="778"'],
      ]),
      2025,
    );
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
  });

  const degiro = (rows: string[]): TaxReport => {
    const csv = [
      "Fecha,Hora,Producto,ISIN,Centro de referencia,Centro de ejecución,Cantidad,Precio,,Valor,,Costes de transacción y/o terceros,,Total,,ID Orden",
      // An earlier trade of another security: the file reaches back before the window.
      '02-01-2024,09:00,OTRA SA,ES0000000002,MAD,XMAD,1,"10,00",EUR,"-10,00",EUR,"0,00",EUR,"-10,00",EUR,ooo-000',
      ...rows,
    ].join("\n");
    const statement = finalizeMergedStatement(mergeStatement(createEmptyStatement(), degiroParser.parse(csv), degiroParser.name));
    return generateTaxReport(statement, rates(), 2025, reportOptionsForMethod("monodivisa"));
  };

  // A DEGIRO transactions file lists no holdings, so it cannot prove that no
  // share was held at the window start: the exception is never applied (fail
  // safe), but the "unverified" mark shows the two fills counted as one purchase.
  it("DEGIRO: two fills with one «ID Orden» are one purchase (unverified: the file lists no holdings)", () => {
    const r = degiro([
      '01-03-2025,10:00,XYZ SA,ES0000004531,MAD,XMAD,60,"10,00",EUR,"-600,00",EUR,"0,00",EUR,"-600,00",EUR,aaa-111',
      '01-03-2025,10:00,XYZ SA,ES0000004531,MAD,XMAD,40,"10,00",EUR,"-400,00",EUR,"0,00",EUR,"-400,00",EUR,aaa-111',
      '15-03-2025,10:00,XYZ SA,ES0000004531,MAD,XMAD,-50,"8,00",EUR,"400,00",EUR,"0,00",EUR,"400,00",EUR,bbb-222',
    ]);
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(r.capitalGains.disposals.find((d) => sameDay(d.sellDate, "2025-03-15"))!.washSaleSinglePurchase).toBe("unverified");
    expect(ids(r)).toEqual([UNVERIFIED]);
  });

  it("DEGIRO: two orders on the same day are two purchases", () => {
    const r = degiro([
      '01-03-2025,10:00,XYZ SA,ES0000004531,MAD,XMAD,60,"10,00",EUR,"-600,00",EUR,"0,00",EUR,"-600,00",EUR,aaa-111',
      '01-03-2025,11:00,XYZ SA,ES0000004531,MAD,XMAD,40,"10,00",EUR,"-400,00",EUR,"0,00",EUR,"-400,00",EUR,ccc-333',
      '15-03-2025,10:00,XYZ SA,ES0000004531,MAD,XMAD,-50,"8,00",EUR,"400,00",EUR,"0,00",EUR,"400,00",EUR,bbb-222',
    ]);
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(r.capitalGains.disposals.find((d) => sameDay(d.sellDate, "2025-03-15"))!.washSaleSinglePurchase).toBeUndefined();
    expect(ids(r)).toEqual([]);
  });

  // #454: the rest of the lot a sale transmits comes after the post-sale buys.
  // The fills of that lot are one lot: the rows FIFO left untouched must not
  // count as fully held and come first. 10/03 sells 50 of the 01/03 purchase
  // and takes the 15/03 one; 20/03 sells the last 50 of 01/03, finds 15/03 used
  // and nothing else held, so it is definitive: its own 100 is deductible and
  // the 100 of 10/03 is released. Fiscal −200, whatever the fill layout.
  describe("#454: one purchase as one row or as two fills gives the same year", () => {
    const row = (date: string, qty: number, price: string, value: string, id: string): string =>
      `${date},10:00,XYZ SA,ES0000004531,MAD,XMAD,${qty},"${price}",EUR,"${value}",EUR,"0,00",EUR,"${value}",EUR,${id}`;
    const tail = [
      row("10-03-2025", -50, "8,00", "400,00", "s1"),
      row("15-03-2025", 50, "10,00", "-500,00", "b2"),
      row("20-03-2025", -50, "8,00", "400,00", "s2"),
    ];
    const layouts = {
      "one row": [row("01-03-2025", 100, "10,00", "-1000,00", "b1"), ...tail],
      "two fills": [row("01-03-2025", 60, "10,00", "-600,00", "b1"), row("01-03-2025", 40, "10,00", "-400,00", "b1"), ...tail],
    };
    const report = (rows: string[], method: FxMethod): TaxReport => {
      const csv = [
        "Fecha,Hora,Producto,ISIN,Centro de referencia,Centro de ejecución,Cantidad,Precio,,Valor,,Costes de transacción y/o terceros,,Total,,ID Orden",
        ...rows,
      ].join("\n");
      const statement = finalizeMergedStatement(mergeStatement(createEmptyStatement(), degiroParser.parse(csv), degiroParser.name));
      return generateTaxReport(statement, rates(), 2025, reportOptionsForMethod(method));
    };
    for (const method of METHODS) {
      for (const [layout, rows] of Object.entries(layouts)) {
        it(`[${method}] ${layout}: 10/03 takes 15/03, 20/03 is definitive (fiscal −200, no mark)`, () => {
          const r = report(rows, method);
          const on = (date: string) => r.capitalGains.disposals.filter((d) => sameDay(d.sellDate, date));
          expect(blockedOn(r, "2025-03-10")).toBe("100.00");
          expect(on("2025-03-10").flatMap((d) => d.washSaleRepurchaseDates ?? [])).toEqual(["2025-03-15"]);
          expect(blockedOn(r, "2025-03-20")).toBe("0.00");
          expect(on("2025-03-20").reduce((s, d) => s.plus(d.reintegratedLossEur), new Decimal(0)).toFixed(2)).toBe("100.00");
          expect(fiscal(r)).toBe("-200.00");
          expect(r.capitalGains.disposals.every((d) => d.washSaleSinglePurchase === undefined)).toBe(true);
        });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (d) «al inicio de ese período no se tuvieran acciones»: the position at the
// window start must be zero in every merged file and in FIFO, and the upload
// must reach back to that date. Holdings from before the upload are invisible,
// so a window that starts before it never gets the exception (fail safe) and
// the user gets a warning instead.
// ---------------------------------------------------------------------------
describe("(d) no shares at the window start, as far as the upload can show", () => {
  const rows: Row[] = [
    ["20250105", "BUY", 100, 10],
    ["20250120", "SELL", 50, 8],
  ];

  it("the window starts before the file (20/11/2024 < 01/01/2025): not applied, warning", () => {
    const r = run(ibkrXml(rows, { fromDate: "20250101" }), 2025);
    expect(blockedOn(r, "2025-01-20")).toBe("100.00");
    expect(ids(r)).toEqual([UNVERIFIED]);
    const msg = r.messages.find((m) => m.id === UNVERIFIED)!;
    expect(msg.severity).toBe("warning");
    expect(msg.context).toEqual({ count: "1", year: "2025", windowStart: "20/11/2024" });
    expect(r.capitalGains.disposals[0]!.washSaleSinglePurchase).toBe("unverified");
  });

  it("the same trades in a file that starts earlier: applied", () => {
    const r = run(ibkrXml(rows, { fromDate: "20240101" }), 2025);
    expect(blockedOn(r, "2025-01-20")).toBe("0.00");
    expect(ids(r)).toEqual([APPLIED]);
  });

  /** Two merged brokers; each `files` entry is [broker name, xml]. */
  const merged = (files: [string, string][]): TaxReport => {
    const statement = createEmptyStatement();
    for (const [name, xml] of files) mergeStatement(statement, parseIbkrFlexXml(xml), name);
    return generateTaxReport(finalizeMergedStatement(statement), rates(), 2025, reportOptionsForMethod("monodivisa"));
  };
  const issue: Row[] = [
    ["20250301", "BUY", 100, 10],
    ["20250315", "SELL", 50, 8],
  ];

  it("another broker holding the security when the window starts: the loss stays blocked", () => {
    const r = merged([
      ["Interactive Brokers", ibkrXml(issue, { fromDate: "20250101" })],
      ["Otro bróker", ibkrXml([["20241201", "BUY", 100, 10]], { fromDate: "20240101" })],
    ]);
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(ids(r)).toEqual([]);
  });

  it("another broker that trades the security and starts after the window start: not applied, warning", () => {
    const r = merged([
      ["Interactive Brokers", ibkrXml(issue, { fromDate: "20250101" })],
      ["Otro bróker", ibkrXml([["20250701", "BUY", 10, 10]], { fromDate: "20250201" })],
    ]);
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(ids(r)).toEqual([UNVERIFIED]);
  });

  it("another broker that starts later but never trades the security: applied", () => {
    const r = merged([
      ["Interactive Brokers", ibkrXml(issue, { fromDate: "20250101" })],
      ["Otro bróker", ibkrXml([["20250701", "BUY", 10, 10]], { fromDate: "20250201", isin: "ES0000000002" })],
    ]);
    expect(blockedOn(r, "2025-03-15")).toBe("0.00");
    expect(ids(r)).toEqual([APPLIED]);
  });

  it("a later sale of more shares than the upload shows (held from before it): not applied, warning", () => {
    const r = run(ibkrXml([...issue, ["20251201", "SELL", 150, 10]], { fromDate: "20250101" }), 2025);
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(r.capitalGains.disposals.find((d) => sameDay(d.sellDate, "2025-03-15"))!.washSaleSinglePurchase).toBe("unverified");
    expect(ids(r)).toEqual([UNVERIFIED]);
  });

  it("shares FIFO holds without a BUY when the window starts (a scrip dividend): the loss stays blocked", () => {
    const scrip = `<CorporateAction transactionID="SD1" accountId="U1" symbol="XYZ" description="XYZ(${ISIN}) STOCK DIVIDEND" isin="${ISIN}" currency="EUR" reportDate="20241201" dateTime="20241201" quantity="10" amount="100" type="SD" actionDescription="" />`;
    const r = run(ibkrXml(issue, { fromDate: "20240101", actions: scrip }), 2025);
    expect(r.capitalGains.blockedLosses.greaterThan(0)).toBe(true);
    expect(ids(r)).toEqual([]);
  });

  it("a manual opening lot held when the window starts: the loss stays blocked", () => {
    const statement = finalizeMergedStatement(
      mergeStatement(createEmptyStatement(), parseIbkrFlexXml(ibkrXml(issue, { fromDate: "20250101" })), "Interactive Brokers"),
    );
    const r = generateTaxReport(statement, rates(), 2025, {
      ...reportOptionsForMethod("monodivisa"),
      manualOpeningLots: [
        { symbol: "XYZ", description: "XYZ SA", isin: ISIN, assetCategory: "STK", currency: "EUR", acquireDate: "2024-06-01", quantity: "100", pricePerShare: "10" },
      ],
    });
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(ids(r)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (d) Shares bought before the files. A file's start date proves nothing about
// them: only a holdings list that the trades explain does. IBKR lists the
// period-end holdings (OpenPositions); a list with more shares than the trades
// leave means shares from before the files, at any uploaded broker. A file
// with no holdings list explains nothing. Either way the exception is withheld.
// ---------------------------------------------------------------------------
describe("(d) shares from before the files are never taken as zero", () => {
  // Window of the 01/06 sale: 01/04 – 01/06, inside the file (from 01/01/2025).
  const rows: Row[] = [
    ["20250501", "BUY", 100, 10],
    ["20250601", "SELL", 50, 8],
  ];
  const merged = (files: [string, string][], method: FxMethod = "monodivisa"): TaxReport => {
    const statement = createEmptyStatement();
    for (const [name, xml] of files) mergeStatement(statement, parseIbkrFlexXml(xml), name);
    return generateTaxReport(finalizeMergedStatement(statement), rates(), 2025, reportOptionsForMethod(method));
  };

  it.each(METHODS)("[%s] the year-end holding (250) exceeds what the trades leave (50): 200 held from before, the 100 stays blocked", (method) => {
    const r = run(ibkrXml(rows, { fromDate: "20250101", heldBefore: 200 }), 2025, method);
    expect(blockedOn(r, "2025-06-01")).toBe("100.00");
    expect(r.capitalGains.disposals.find((d) => sameDay(d.sellDate, "2025-06-01"))!.washSaleSinglePurchase).toBe("unverified");
    expect(ids(r)).toEqual([UNVERIFIED]);
  });

  it.each(METHODS)("[%s] positive control: the same file whose holding (50) the trades explain: applied", (method) => {
    const r = run(ibkrXml(rows, { fromDate: "20250101" }), 2025, method);
    expect(blockedOn(r, "2025-06-01")).toBe("0.00");
    expect(ids(r)).toEqual([APPLIED]);
  });

  it("a file without holdings (no OpenPositions in the query), even if the shares from before are later partly sold: not applied", () => {
    const r = run(ibkrXml([...rows, ["20251001", "SELL", 30, 10]], { fromDate: "20250101", positions: [] }), 2025);
    expect(blockedOn(r, "2025-06-01")).toBe("100.00");
    expect(ids(r)).toEqual([UNVERIFIED]);
  });

  it.each(METHODS)("[%s] a second broker sells 20 it held since before its file (merged position never negative): not applied", (method) => {
    const r = merged(
      [
        ["Interactive Brokers", ibkrXml(rows, { fromDate: "20250101" })],
        [
          "Otro bróker",
          ibkrXml([["20250701", "SELL", 20, 10]], { fromDate: "20250101", positions: [], otherPositions: [["ES0000000002", 5]] }),
        ],
      ],
      method,
    );
    expect(blockedOn(r, "2025-06-01")).toBe("100.00");
    expect(ids(r)).toEqual([UNVERIFIED]);
  });

  it("the same second broker with no holdings list at all: not applied", () => {
    const r = merged([
      ["Interactive Brokers", ibkrXml(rows, { fromDate: "20250101" })],
      ["Otro bróker", ibkrXml([["20250701", "SELL", 20, 10]], { fromDate: "20250101", positions: [] })],
    ]);
    expect(blockedOn(r, "2025-06-01")).toBe("100.00");
    expect(ids(r)).toEqual([UNVERIFIED]);
  });

  it("a broker that lists the security but never trades it in the upload: not applied", () => {
    const r = merged([
      ["Interactive Brokers", ibkrXml(rows, { fromDate: "20250101" })],
      ["Otro bróker", ibkrXml([], { fromDate: "20250101", positions: [[ISIN, 20]] })],
    ]);
    expect(blockedOn(r, "2025-06-01")).toBe("100.00");
    expect(ids(r)).toEqual([UNVERIFIED]);
  });

  it("shares moved between two uploaded brokers (bought at one, sold at the other): not applied", () => {
    // IBKR keeps nothing of XYZ (it lists another security); the 50 it moved to
    // Otro bróker are sold there. No file documents the transfer, and the same
    // numbers fit Otro bróker holding 50 since before the window and IBKR moving
    // 50 out of the upload: each account must explain its own list, nothing is
    // offset between them (review of #453).
    const r = merged([
      ["Interactive Brokers", ibkrXml(rows, { fromDate: "20250101", positions: [], otherPositions: [["ES0000000002", 5]] })],
      [
        "Otro bróker",
        ibkrXml([["20250701", "SELL", 50, 10]], { fromDate: "20250101", positions: [], otherPositions: [["ES0000000003", 5]] }),
      ],
    ]);
    expect(blockedOn(r, "2025-06-01")).toBe("100.00");
    expect(ids(r)).toEqual([UNVERIFIED]);
  });
});

describe("(d) a holdings list the parser built from the file's own trades proves nothing", () => {
  const issueRows: Row[] = [
    ["20250301", "BUY", 100, 10],
    ["20250315", "SELL", 50, 8],
  ];
  const withList = (fromTrades: boolean): TaxReport => {
    const parsed = parseIbkrFlexXml(ibkrXml(issueRows));
    for (const pos of parsed.openPositions) pos.fromTrades = fromTrades;
    const statement = finalizeMergedStatement(mergeStatement(createEmptyStatement(), parsed, "Interactive Brokers"));
    return generateTaxReport(statement, rates(), 2025, reportOptionsForMethod("monodivisa"));
  };

  it("rows marked fromTrades (Revolut's transaction log): not applied", () => {
    const r = withList(true);
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(ids(r)).toEqual([UNVERIFIED]);
  });

  it("control: the same rows reported by the broker: applied", () => {
    const r = withList(false);
    expect(blockedOn(r, "2025-03-15")).toBe("0.00");
    expect(ids(r)).toEqual([APPLIED]);
  });
});

describe("(d) a manual opening lot inside the window belongs to no uploaded account", () => {
  it("the purchase is a manual opening lot and the file lists the 50 left: not applied", () => {
    // The file shows only the sale; the manual lot of 100 on 01/03 is the one
    // purchase, moved in from an account the upload does not hold, so nothing
    // shows what that account held at the window start (review of #453).
    const xml = ibkrXml([["20250315", "SELL", 50, 8]], { positions: [[ISIN, 50]] });
    const statement = finalizeMergedStatement(mergeStatement(createEmptyStatement(), parseIbkrFlexXml(xml), "Interactive Brokers"));
    const r = generateTaxReport(statement, rates(), 2025, {
      ...reportOptionsForMethod("monodivisa"),
      manualOpeningLots: [
        { symbol: "XYZ", description: "XYZ SA", isin: ISIN, assetCategory: "STK", currency: "EUR", acquireDate: "2025-03-01", quantity: "100", pricePerShare: "10" },
      ],
    });
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(ids(r)).toEqual([UNVERIFIED]);
  });

  it("even when the account's own trades explain its list (the lot's shares left the upload): not applied", () => {
    // IBKR sells 50 of the manual lot on 15/03 and buys 50 on 01/06 (after the
    // window); its list says 0, which its own trades explain (−50 + 50). The lot
    // came from an account the upload does not hold.
    const xml = ibkrXml([["20250315", "SELL", 50, 8], ["20250601", "BUY", 50, 10]], { positions: [], otherPositions: [["ES0000000002", 5]] });
    const statement = finalizeMergedStatement(mergeStatement(createEmptyStatement(), parseIbkrFlexXml(xml), "Interactive Brokers"));
    const r = generateTaxReport(statement, rates(), 2025, {
      ...reportOptionsForMethod("monodivisa"),
      manualOpeningLots: [
        { symbol: "XYZ", description: "XYZ SA", isin: ISIN, assetCategory: "STK", currency: "EUR", acquireDate: "2025-03-01", quantity: "100", pricePerShare: "10" },
      ],
    });
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(ids(r)).toEqual([UNVERIFIED]);
  });

  it("control: a manual opening lot sold before the window does not stop the exception", () => {
    const xml = ibkrXml([["20240901", "SELL", 100, 10], ...issueRowsD], { positions: [[ISIN, 50]] });
    const statement = finalizeMergedStatement(mergeStatement(createEmptyStatement(), parseIbkrFlexXml(xml), "Interactive Brokers"));
    const r = generateTaxReport(statement, rates(), 2025, {
      ...reportOptionsForMethod("monodivisa"),
      manualOpeningLots: [
        { symbol: "XYZ", description: "XYZ SA", isin: ISIN, assetCategory: "STK", currency: "EUR", acquireDate: "2023-03-01", quantity: "100", pricePerShare: "10" },
      ],
    });
    expect(blockedOn(r, "2025-03-15")).toBe("0.00");
    expect(ids(r)).toEqual([APPLIED]);
  });
});

const issueRowsD: Row[] = [
  ["20250301", "BUY", 100, 10],
  ["20250315", "SELL", 50, 8],
];

// ---------------------------------------------------------------------------
// A short sale is no share held: a short opened and covered long before the
// window neither counts as a holding nor as a sale of shares from before the
// files.
// ---------------------------------------------------------------------------
describe("a short opened and covered before the window", () => {
  const rows: Row[] = [
    ["20240601", "SELL", 50, 12, "", "O"],
    ["20240701", "BUY", 50, 11, "", "C"],
    ["20250301", "BUY", 100, 10],
    ["20250315", "SELL", 50, 8],
  ];

  it.each(METHODS)("[%s] no shares at the 2025 window start: applied, nothing blocked", (method) => {
    const r = run(ibkrXml(rows, { fromDate: "20240101" }), 2025, method);
    expect(blockedOn(r, "2025-03-15")).toBe("0.00");
    expect(ids(r)).toEqual([APPLIED]);
  });
});

// ---------------------------------------------------------------------------
// (e) The «transmisión definitiva» test of #451 uses «los mismos criterios que
// los señalados anteriormente para valorar si se produce la recompra»
// (V3282-18), so the exception decides it too: a gain sale whose only purchase
// of the 2 months before, with no shares at its start, is definitive.
// ---------------------------------------------------------------------------
describe("(e) the definitive-transmission test applies the exception the same way", () => {
  // 02/01 buy 100; 03/02 sell all at −100, rebought by the 150 of 03/03 (100 of
  // them absorb it: 100 pending). 15/04 sell 50 at +100: its window starts on
  // 15/02 with no shares, and 03/03 is its only purchase.
  const base: Row[] = [
    ["20250102", "BUY", 100, 10],
    ["20250203", "SELL", 100, 9],
    ["20250303", "BUY", 150, 10],
    ["20250415", "SELL", 50, 12],
  ];

  it.each(METHODS)("[%s] the 15/04 sale is definitive: it releases 50 of the 100 pending", (method) => {
    const r = run(ibkrXml(base, { fromDate: "20250101" }), 2025, method);
    expect(blockedOn(r, "2025-02-03")).toBe("100.00");
    expect(releasedOn(r, "2025-04-15")).toBe("50.00");
    expect(ids(r)).toEqual([APPLIED]);
  });

  it("with a second purchase in its window (01/04) it is not definitive and releases nothing", () => {
    const rows: Row[] = [...base.slice(0, 3), ["20250401", "BUY", 10, 10], base[3]!];
    const r = run(ibkrXml(rows, { fromDate: "20250101" }), 2025);
    expect(releasedOn(r, "2025-04-15")).toBe("0.00");
    expect(ids(r)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (f) The evidence rule, per account (review of the #453 fix). A wrongly
// applied exception deducts a loss the law blocks, so every gap in the files
// leaves it "unverified". For each account (broker and account id) that trades
// the security or lists it, the files must cover that account without a gap
// from the window start to a holdings list dated on or after the sale, every
// quantity in that list must be readable, and the list must equal what the
// account's own trades from the window start leave, in that list's share
// units. Nothing is offset between accounts.
// ---------------------------------------------------------------------------

/** One FlexStatement: one account and its period. */
interface Stmt {
  account?: string;
  fromDate: string;
  toDate: string;
  rows?: Row[];
  /** OpenPosition rows: [isin, quantity] (`null` = no quantity attribute). */
  positions?: [isin: string, qty: number | null][];
  /** Extra OpenPosition rows, written as given. */
  rawPositions?: string[];
  actions?: string;
  /** `false`: the statement has no Trades section (a holdings-only Flex). */
  trades?: false;
  /** `false`: the statement has no Open Positions section (not in the query). */
  positionsSection?: false;
  /** ISIN of the trade rows (`""`: a Flex without the Trades ISIN column). */
  tradeIsin?: string;
}

/** An IBKR Flex file with one FlexStatement per entry (a multi-account query). */
function flexXml(stmts: Stmt[]): string {
  const body = stmts
    .map(({ account = "U1", fromDate, toDate, rows = [], positions = [], rawPositions = [], actions = "", trades: withTrades, positionsSection, tradeIsin = ISIN }) => {
      const trades = withTrades === false ? "" : `<Trades>${rows.map((r) => tradeXml(r, "EUR", tradeIsin, account)).join("")}</Trades>`;
      const op = positions.map(([isin, qty]) => openPositionXml(isin, qty, "EUR", account)).join("") + rawPositions.join("");
      const openPositions = positionsSection === false ? "" : `<OpenPositions>${op}</OpenPositions>`;
      return `<FlexStatement accountId="${account}" fromDate="${fromDate}" toDate="${toDate}" period="Custom">${trades}<CashTransactions /><CorporateActions>${actions}</CorporateActions>${openPositions}<SecuritiesInfo /></FlexStatement>`;
    })
    .join("");
  return `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="${stmts.length}">${body}</FlexStatements></FlexQueryResponse>`;
}

/** Merge files, each [broker name, xml], and report 2025. */
function mergedFiles(files: [string, string][], method: FxMethod = "monodivisa"): TaxReport {
  const statement = createEmptyStatement();
  for (const [name, xml] of files) mergeStatement(statement, parseIbkrFlexXml(xml), name);
  return generateTaxReport(finalizeMergedStatement(statement), rates(), 2025, reportOptionsForMethod(method));
}

const OTHER = "ES0000000002";
const IB = "Interactive Brokers";
// Window of the 15/03 sale: 15/01 – 15/03.
const issueRows: Row[] = [
  ["20250301", "BUY", 100, 10],
  ["20250315", "SELL", 50, 8],
];
const expectUnverified = (r: TaxReport): void => {
  expect(blockedOn(r, "2025-03-15")).toBe("100.00");
  expect(r.capitalGains.disposals.find((d) => sameDay(d.sellDate, "2025-03-15"))!.washSaleSinglePurchase).toBe("unverified");
  expect(ids(r)).toEqual([UNVERIFIED]);
};
const expectApplied = (r: TaxReport): void => {
  expect(blockedOn(r, "2025-03-15")).toBe("0.00");
  expect(ids(r)).toEqual([APPLIED]);
};

describe("(f) a position row without a readable quantity is missing evidence, not zero", () => {
  // Buy 100, sell 50 at a loss, sell the other 50 in December: the trades leave 0.
  const rows: Row[] = [...issueRows, ["20251201", "SELL", 50, 10]];
  const file = (positions: [string, number | null][]): string =>
    flexXml([{ fromDate: "20240101", toDate: "20251231", rows, positions }]);

  it.each(METHODS)("[%s] the security's row has no quantity: not applied", (method) => {
    expectUnverified(mergedFiles([[IB, file([[ISIN, null], [OTHER, 5]])]], method));
  });

  it("the parser keeps the quantity missing, not zero", () => {
    const pos = parseIbkrFlexXml(file([[ISIN, null]])).openPositions[0]!;
    expect(pos.quantityUnknown).toBe(true);
    expect(parseIbkrFlexXml(file([[ISIN, 0]])).openPositions[0]!.quantityUnknown).toBeUndefined();
  });

  it("control: an explicit quantity of 0 proves zero: applied", () => {
    expectApplied(mergedFiles([[IB, file([[ISIN, 0], [OTHER, 5]])]]));
  });

  it("control: a list of other holdings with no row for the security proves zero: applied", () => {
    expectApplied(mergedFiles([[IB, file([[OTHER, 5]])]]));
  });
});

describe("(f) the holdings list must be dated on or after the sale", () => {
  it("a list of 10/01 (before the window) and a later file with trades only: not applied", () => {
    const r = mergedFiles([
      [IB, flexXml([{ fromDate: "20240101", toDate: "20250110", positions: [[OTHER, 5]] }])],
      [IB, flexXml([{ fromDate: "20250111", toDate: "20251231", rows: issueRows }])],
    ]);
    expectUnverified(r);
  });

  it("control: the later file lists the 50 left: applied", () => {
    const r = mergedFiles([
      [IB, flexXml([{ fromDate: "20240101", toDate: "20250110", positions: [[OTHER, 5]] }])],
      [IB, flexXml([{ fromDate: "20250111", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] }])],
    ]);
    expectApplied(r);
  });
});

describe("(f) a difference at one account is never offset against another", () => {
  it.each(METHODS)("[%s] broker A holds 20 with no trades; broker B lists 20 fewer than its trades leave: not applied", (method) => {
    // Held before the files: A +20, B −20 (moved out of the upload). The sum is
    // zero, but A held 20 when the window began.
    const r = mergedFiles(
      [
        [IB, flexXml([{ fromDate: "20240101", toDate: "20251231", rows: issueRows, positions: [[ISIN, 30]] }])],
        ["Otro bróker", flexXml([{ fromDate: "20240101", toDate: "20251231", positions: [[ISIN, 20]] }])],
      ],
      method,
    );
    expectUnverified(r);
  });

  it("the same with a split between the two lists' dates: not applied", () => {
    // A lists 20 on 30/06; B's trades leave 100 after the 2-for-1 split of
    // 01/09 and B lists 80 on 31/12. In each list's own units: A +20, B −20.
    const split = `<CorporateAction transactionID="FS1" accountId="U1" symbol="XYZ" description="XYZ(${ISIN}) SPLIT 2 FOR 1" isin="${ISIN}" currency="EUR" reportDate="20250901" dateTime="20250901" quantity="0" amount="0" type="FS" actionDescription="" />`;
    const r = mergedFiles([
      [IB, flexXml([{ fromDate: "20240101", toDate: "20251231", rows: issueRows, positions: [[ISIN, 80]], actions: split }])],
      ["Otro bróker", flexXml([{ fromDate: "20240101", toDate: "20250630", positions: [[ISIN, 20]] }])],
    ]);
    expectUnverified(r);
  });
});

describe("(f) a sale of shares the upload never shows bought still withholds it, even when the list matches", () => {
  it("50 held before the files, sold on 01/04, then 50 bought and moved out: the list (0) matches the trades since the window start, not applied", () => {
    // Trades since 15/01: +100 −50 −100 +50 = 0, and the list says 0. But the
    // 01/04 sale takes 50 shares the upload never shows: they were held when the
    // window began (and a transfer out, which no file shows, hid them later).
    const rows: Row[] = [...issueRows, ["20250401", "SELL", 100, 10], ["20250601", "BUY", 50, 10]];
    expectUnverified(mergedFiles([[IB, flexXml([{ fromDate: "20240101", toDate: "20251231", rows, positions: [[OTHER, 5]] }])]]));
  });
});

describe("(f) a split between the window start and the list: the list is compared in its own share units", () => {
  const split = `<CorporateAction transactionID="FS1" accountId="U1" symbol="XYZ" description="XYZ(${ISIN}) SPLIT 2 FOR 1" isin="${ISIN}" currency="EUR" reportDate="20250901" dateTime="20250901" quantity="0" amount="0" type="FS" actionDescription="" />`;
  const file = (listed: number): string =>
    flexXml([{ fromDate: "20240101", toDate: "20251231", rows: issueRows, positions: [[ISIN, listed]], actions: split }]);

  it.each(METHODS)("[%s] the 50 left become 100 after the 2-for-1 split and the list says 100: applied", (method) => {
    expectApplied(mergedFiles([[IB, file(100)]], method));
  });

  it("a list of 50 (not what the split leaves): not applied", () => {
    expectUnverified(mergedFiles([[IB, file(50)]]));
  });
});

describe("(f) the files must cover the account without a gap from the window start to the list", () => {
  const later = flexXml([{ fromDate: "20250301", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] }]);

  it.each(METHODS)("[%s] files of 01/01–10/01 and 01/03–31/12: the gap 11/01–28/02 hides the window start: not applied", (method) => {
    expectUnverified(mergedFiles([[IB, flexXml([{ fromDate: "20250101", toDate: "20250110" }])], [IB, later]], method));
  });

  it("control: adjacent files (01/01–28/02 and 01/03–31/12): applied", () => {
    expectApplied(mergedFiles([[IB, flexXml([{ fromDate: "20250101", toDate: "20250228" }])], [IB, later]]));
  });

  it("overlapping files (01/01–10/03 and 01/03–31/12): 01/03–10/03 is in two files, whose trades may count twice: not applied", () => {
    expectUnverified(mergedFiles([[IB, flexXml([{ fromDate: "20250101", toDate: "20250310" }])], [IB, later]]));
  });
});

describe("(f) the evidence must come from the account that traded (a multi-account Flex)", () => {
  it.each(METHODS)("[%s] U1 trades and lists nothing; U2 lists 50 it held before: not applied", (method) => {
    const r = mergedFiles(
      [
        [
          IB,
          flexXml([
            { account: "U1", fromDate: "20240101", toDate: "20251231", rows: issueRows },
            { account: "U2", fromDate: "20240101", toDate: "20251231", positions: [[ISIN, 50]] },
          ]),
        ],
      ],
      method,
    );
    expectUnverified(r);
  });

  it("U1's statement starts after the window start, U2's (listed first) before it: not applied", () => {
    const r = mergedFiles([
      [
        IB,
        flexXml([
          { account: "U2", fromDate: "20240101", toDate: "20251231", positions: [[OTHER, 5]] },
          { account: "U1", fromDate: "20250201", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] },
        ]),
      ],
    ]);
    expectUnverified(r);
  });

  it("control: U1 trades and lists the 50 left, U2 lists another security: applied", () => {
    const r = mergedFiles([
      [
        IB,
        flexXml([
          { account: "U1", fromDate: "20240101", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] },
          { account: "U2", fromDate: "20240101", toDate: "20251231", positions: [[OTHER, 5]] },
        ]),
      ],
    ]);
    expectApplied(r);
  });
});

// ---------------------------------------------------------------------------
// (g) Second review of the evidence rule: what a real IBKR export looks like.
// ---------------------------------------------------------------------------

/** An Open Positions row with every attribute given (IBKR's real format unless overridden). */
function positionRow(attrs: Record<string, string>): string {
  const all: Record<string, string> = {
    accountId: "U1", symbol: "XYZ", description: "XYZ SA", conid: "4531", isin: ISIN, currency: "EUR", assetCategory: "STK",
    position: "50", markPrice: "10", positionValue: "500", costBasisMoney: "500", costBasisPrice: "10", fifoPnlUnrealized: "0",
    fxRateToBase: "1", side: "Long", levelOfDetail: "SUMMARY", ...attrs,
  };
  return `<OpenPosition ${Object.entries(all).filter(([, v]) => v !== "\u0000").map(([k, v]) => `${k}="${v}"`).join(" ")} />`;
}
/** Drop an attribute from {@link positionRow}. */
const NONE = "\u0000";

describe("(g) IBKR writes the held quantity as `position`", () => {
  it.each(METHODS)("[%s] the issue example with IBKR's real Open Positions row: applied, 0 blocked", (method) => {
    expectApplied(mergedFiles([[IB, flexXml([{ fromDate: "20250101", toDate: "20251231", rows: issueRows, rawPositions: [positionRow({})] }])]], method));
  });

  it("the parser reads `position` from a committed real export (ibkr-autoconvert.xml: BRYN 2, PYPL 23)", () => {
    const xml = readFileSync(new URL("../fixtures/ibkr-autoconvert.xml", import.meta.url), "utf-8");
    const rows = parseIbkrFlexXml(xml).openPositions.map((p) => [p.symbol, p.quantity, p.quantityUnknown]);
    expect(rows).toEqual([
      ["BRYN", "2", undefined],
      ["PYPL", "23", undefined],
      ["V", "2", undefined],
    ]);
  });

  it("a hand-written row with `quantity` and no `position` is still read", () => {
    const xml = flexXml([{ fromDate: "20250101", toDate: "20251231", rawPositions: [positionRow({ position: NONE, quantity: "7" })] }]);
    const pos = parseIbkrFlexXml(xml).openPositions[0]!;
    expect([pos.quantity, pos.quantityUnknown]).toEqual(["7", undefined]);
  });

  it("a row with neither attribute is unknown, not zero: not applied", () => {
    const rows: Row[] = [...issueRows, ["20251201", "SELL", 50, 10]];
    expectUnverified(mergedFiles([[IB, flexXml([{ fromDate: "20250101", toDate: "20251231", rows, rawPositions: [positionRow({ position: NONE })] }])]]));
  });

  it("control: position=\"0\" proves zero: applied", () => {
    const rows: Row[] = [...issueRows, ["20251201", "SELL", 50, 10]];
    expectApplied(mergedFiles([[IB, flexXml([{ fromDate: "20250101", toDate: "20251231", rows, rawPositions: [positionRow({ position: "0" })] }])]]));
  });
});

describe("(g) a list row that may be the security under another name proves nothing", () => {
  // 50 held since 2024, never sold in the window: the 31/12/2026 list has 50
  // after the 100 bought and 100 sold since the window start.
  const rows: Row[] = [...issueRows, ["20260601", "SELL", 50, 12]];
  const file = (row: string): string => flexXml([{ fromDate: "20250101", toDate: "20261231", rows, rawPositions: [row] }]);

  it.each(METHODS)("[%s] the row of the 50 held has no ISIN (field not selected in Open Positions): not applied", (method) => {
    expectUnverified(mergedFiles([[IB, file(positionRow({ isin: "" }))]], method));
  });

  it("complete evidence, but another stock's row has no ISIN: not applied (it could be this one)", () => {
    const xml = flexXml([
      { fromDate: "20250101", toDate: "20251231", rows: issueRows, rawPositions: [positionRow({}), positionRow({ symbol: "ABC", conid: "1", isin: "", position: "5" })] },
    ]);
    expectUnverified(mergedFiles([[IB, xml]]));
  });

  it("control: complete evidence and an option row without ISIN (options are no shares): applied", () => {
    const xml = flexXml([
      {
        fromDate: "20250101",
        toDate: "20251231",
        rows: issueRows,
        rawPositions: [positionRow({}), positionRow({ symbol: "XYZ 260116C00010000", conid: "2", isin: "", assetCategory: "OPT", position: "3" })],
      },
    ]);
    expectApplied(mergedFiles([[IB, xml]]));
  });
});

describe("(g) only a statement with a Trades section covers its period", () => {
  // 50 held at the window start (15/01) and sold on 01/02 in a period no
  // trades file shows; the 31/12 list (50) matches the trades of 01/03–31/12.
  const tradesFile = flexXml([{ fromDate: "20250301", toDate: "20251231", rows: issueRows, positions: [] }]);

  it.each(METHODS)("[%s] a holdings-only Flex of 01/01–31/12 does not cover 01/01–28/02: not applied", (method) => {
    const holdingsOnly = flexXml([{ fromDate: "20250101", toDate: "20251231", trades: false, positions: [[ISIN, 50]] }]);
    expectUnverified(mergedFiles([[IB, tradesFile], [IB, holdingsOnly]], method));
  });

  it.each(METHODS)("[%s] a holdings-only Flex of 01/01–28/02, right before the trades file: not applied", (method) => {
    const holdingsOnly = flexXml([{ fromDate: "20250101", toDate: "20250228", trades: false, positions: [[OTHER, 5]] }]);
    const tradesWithList = flexXml([{ fromDate: "20250301", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] }]);
    expectUnverified(mergedFiles([[IB, holdingsOnly], [IB, tradesWithList]], method));
  });

  it("control: an empty Trades section of 01/01–28/02 says no trades: applied", () => {
    const before = flexXml([{ fromDate: "20250101", toDate: "20250228" }]);
    const later = flexXml([{ fromDate: "20250301", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] }]);
    expectApplied(mergedFiles([[IB, before], [IB, later]]));
  });
});

describe("(g) Open Positions with both the Summary and the Lot options", () => {
  const file = (rawPositions: string[]): string => flexXml([{ fromDate: "20250101", toDate: "20251231", rows: issueRows, rawPositions }]);

  it.each(METHODS)("[%s] a SUMMARY row of 50 and its LOT row of 50: counted once, applied", (method) => {
    expectApplied(mergedFiles([[IB, file([positionRow({}), positionRow({ levelOfDetail: "LOT" })])]], method));
  });

  it("the parser keeps only the SUMMARY row", () => {
    const pos = parseIbkrFlexXml(file([positionRow({}), positionRow({ levelOfDetail: "LOT", position: "30" }), positionRow({ levelOfDetail: "LOT", position: "20" })])).openPositions;
    expect(pos.map((p) => p.quantity)).toEqual(["50"]);
  });

  it("control: LOT rows with no SUMMARY row add up (30 + 20 = 50): applied", () => {
    expectApplied(mergedFiles([[IB, file([positionRow({ levelOfDetail: "LOT", position: "30" }), positionRow({ levelOfDetail: "LOT", position: "20" })])]]));
  });
});

describe("(g) the same Flex uploaded twice", () => {
  // 50 held before: the real list is 100, and the doubled trades (+200 −100) leave 100 too.
  const file = flexXml([{ fromDate: "20250101", toDate: "20251231", rows: issueRows, positions: [[ISIN, 100]] }]);

  it.each(METHODS)("[%s] every day is in two files: not applied", (method) => {
    const r = mergedFiles([[IB, file], [IB, file]], method);
    expect(ids(r)).toEqual([UNVERIFIED]);
  });
});

// ---------------------------------------------------------------------------
// (h) Third review of the evidence rule (CodeRabbit on the fork mirror of the
// second fix). Each gap below let the files "prove" a zero they do not prove,
// or kept a real proof from counting.
// ---------------------------------------------------------------------------

describe("(h) an empty `position` attribute is unknown, not zero", () => {
  it.each(METHODS)("[%s] position=\"\" on the security's row, the trades leave 0: not applied", (method) => {
    const rows: Row[] = [...issueRows, ["20251201", "SELL", 50, 10]];
    expectUnverified(
      mergedFiles([[IB, flexXml([{ fromDate: "20250101", toDate: "20251231", rows, rawPositions: [positionRow({ position: "" })] }])]], method),
    );
  });
});

describe("(h) a trade the upload cannot tie to an ISIN may be this security", () => {
  // An earlier Flex without the Trades ISIN column shows a buy and a sale of 10
  // XYZ in February; the later Flex, with the column, the issue example and its
  // list of 50. The February buy is a second purchase in the window, but its
  // rows carry no ISIN, so the ISIN's count misses it.
  const february: Row[] = [
    ["20250203", "BUY", 10, 10],
    ["20250210", "SELL", 10, 10],
  ];
  const later = flexXml([{ fromDate: "20250301", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] }]);

  it.each(METHODS)("[%s] the February trades have no ISIN: not applied", (method) => {
    const earlier = flexXml([{ fromDate: "20250101", toDate: "20250228", rows: february, tradeIsin: "" }]);
    expectUnverified(mergedFiles([[IB, earlier], [IB, later]], method));
  });

  it("control: the same February trades with their ISIN are a second purchase: blocked, no message", () => {
    const earlier = flexXml([{ fromDate: "20250101", toDate: "20250228", rows: february }]);
    const r = mergedFiles([[IB, earlier], [IB, later]]);
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(ids(r)).toEqual([]);
  });

  it("an ISIN-less sale at another broker after the sale, before the lists: not applied", () => {
    // Otro bróker held 40 since before the window and sells them on 01/06 in a
    // file without ISINs; its list (another security) then matches its ISIN trades (none).
    const r = mergedFiles([
      [IB, flexXml([{ fromDate: "20240101", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] }])],
      ["Otro bróker", flexXml([{ fromDate: "20240101", toDate: "20251231", rows: [["20250601", "SELL", 40, 12]], tradeIsin: "", positions: [[OTHER, 5]] }])],
    ]);
    expectUnverified(r);
  });

  it("control: ISIN-less trades before the window start: applied", () => {
    const earlier = flexXml([
      { fromDate: "20240101", toDate: "20250228", rows: [["20241203", "BUY", 10, 10], ["20241210", "SELL", 10, 10]], tradeIsin: "" },
    ]);
    expectApplied(mergedFiles([[IB, earlier], [IB, later]]));
  });
});

describe("(h) each account's own running balance from the window start must not go negative", () => {
  // IBKR buys 100 and sells 50 at a loss. Otro bróker sells 50 it held before
  // the window on 01/06, buys 50 on 01/07 and moves them out. Its list (0)
  // matches its trades since the window start (−50 + 50), and the merged
  // position never goes negative (IBKR's 50 cover it), but Otro bróker held 50
  // when the window began.
  const ib = flexXml([{ fromDate: "20240101", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] }]);

  it.each(METHODS)("[%s] Otro bróker sells before it buys: not applied", (method) => {
    const other = flexXml([{ fromDate: "20240101", toDate: "20251231", rows: [["20250601", "SELL", 50, 12], ["20250701", "BUY", 50, 10]], positions: [[OTHER, 5]] }]);
    expectUnverified(mergedFiles([[IB, ib], ["Otro bróker", other]], method));
  });

  it("control: Otro bróker buys before it sells: applied", () => {
    const other = flexXml([{ fromDate: "20240101", toDate: "20251231", rows: [["20250601", "BUY", 50, 10], ["20250701", "SELL", 50, 12]], positions: [[OTHER, 5]] }]);
    expectApplied(mergedFiles([[IB, ib], ["Otro bróker", other]]));
  });
});

describe("(h) an Open Positions row labeled with another account is that account's", () => {
  it.each(METHODS)("[%s] a one-account Flex of U1 lists the 50 under U2: not applied", (method) => {
    const xml = flexXml([{ fromDate: "20250101", toDate: "20251231", rows: issueRows, rawPositions: [positionRow({ accountId: "U2" })] }]);
    expectUnverified(mergedFiles([[IB, xml]], method));
  });

  it("U1 lists its own 50 and the file also lists 50 under U2, which no period covers: not applied", () => {
    const xml = flexXml([
      { fromDate: "20250101", toDate: "20251231", rows: issueRows, rawPositions: [positionRow({ accountId: "U1" }), positionRow({ accountId: "U2" })] },
    ]);
    expectUnverified(mergedFiles([[IB, xml]]));
  });

  it("control: the same row labeled U1: applied", () => {
    const xml = flexXml([{ fromDate: "20250101", toDate: "20251231", rows: issueRows, rawPositions: [positionRow({ accountId: "U1" })] }]);
    expectApplied(mergedFiles([[IB, xml]]));
  });
});

describe("(h) an Open Positions row without an Account ID belongs to its FlexStatement", () => {
  const xml = (row: string): string =>
    flexXml([
      { account: "U1", fromDate: "20240101", toDate: "20251231", rows: issueRows, rawPositions: [row] },
      { account: "U2", fromDate: "20240101", toDate: "20251231", positions: [[OTHER, 5]] },
    ]);

  it("the parser gives the row U1's account", () => {
    expect(parseIbkrFlexXml(xml(positionRow({ accountId: NONE }))).openPositions.map((p) => p.accountId)).toEqual(["U1", "U2"]);
  });

  it.each(METHODS)("[%s] a multi-account Flex whose U1 row has no Account ID: applied", (method) => {
    expectApplied(mergedFiles([[IB, xml(positionRow({ accountId: NONE }))]], method));
  });

  it("control: an explicit U2 inside U1's statement stays U2's: not applied", () => {
    expectUnverified(mergedFiles([[IB, xml(positionRow({ accountId: "U2" }))]]));
  });
});

describe("(h) an empty Open Positions section is a list of nothing", () => {
  // Buy 100 on 01/12, sell 50 at a loss on 15/12, sell the other 50 on
  // 10/01/2026. The 2025 Flex has no Open Positions section; the January Flex
  // has one, empty: the account holds nothing on 31/01/2026.
  const december: Row[] = [
    ["20251201", "BUY", 100, 10],
    ["20251215", "SELL", 50, 8],
  ];
  const year = flexXml([{ fromDate: "20250101", toDate: "20251231", rows: december, positionsSection: false }]);
  const january = (rows: Row[], positionsSection?: false): string =>
    flexXml([{ fromDate: "20260101", toDate: "20260131", rows, ...(positionsSection === false ? { positionsSection } : {}) }]);
  const sale = (r: TaxReport): { blocked: string; mark: string | undefined } => ({
    blocked: blockedOn(r, "2025-12-15"),
    mark: r.capitalGains.disposals.find((d) => sameDay(d.sellDate, "2025-12-15"))!.washSaleSinglePurchase,
  });

  it.each(METHODS)("[%s] the January Flex sells the rest and its section is empty: applied", (method) => {
    const r = mergedFiles([[IB, year], [IB, january([["20260110", "SELL", 50, 10]])]], method);
    expect(sale(r)).toEqual({ blocked: "0.00", mark: "applied" });
    expect(ids(r)).toEqual([APPLIED]);
  });

  it("control: the January Flex has no Open Positions section: not applied", () => {
    const r = mergedFiles([[IB, year], [IB, january([["20260110", "SELL", 50, 10]], false)]]);
    expect(sale(r)).toEqual({ blocked: "100.00", mark: "unverified" });
    expect(ids(r)).toEqual([UNVERIFIED]);
  });

  it("control: an empty section while the trades leave 50: not applied", () => {
    const r = mergedFiles([[IB, year], [IB, january([])]]);
    expect(sale(r)).toEqual({ blocked: "100.00", mark: "unverified" });
    expect(ids(r)).toEqual([UNVERIFIED]);
  });
});

// ---------------------------------------------------------------------------
// (i) Fourth review of the evidence rule (the lane's own review of the third
// fix). A share holding with no ISIN that is still open at the window start may
// be this security held then; a Flex whose Trades omit the Account ID belongs
// to its FlexStatement's account, as its Open Positions do.
// ---------------------------------------------------------------------------

describe("(i) a share holding with no ISIN still open at the window start may be this security", () => {
  // IBKR U1 runs the issue example and lists the 50 left. Otro bróker (U9), in
  // a Flex without the Trades ISIN column and without Open Positions, bought 40
  // XYZ on 01/10/2024 and never sold them: they may be the same shares, held
  // when the window began.
  const ib = flexXml([{ fromDate: "20240101", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] }]);
  const other = (rows: Row[], tradeIsin?: string): string =>
    flexXml([{ account: "U9", fromDate: "20240101", toDate: "20251231", rows, positionsSection: false, ...(tradeIsin === undefined ? {} : { tradeIsin }) }]);

  it.each(METHODS)("[%s] Otro bróker bought 40 with no ISIN in October 2024 and still holds them: not applied", (method) => {
    expectUnverified(mergedFiles([[IB, ib], ["Otro bróker", other([["20241001", "BUY", 40, 10]], "")]], method));
  });

  it("control: the same buy with its ISIN shows the 40 held at the window start: blocked, no message", () => {
    const r = mergedFiles([[IB, ib], ["Otro bróker", other([["20241001", "BUY", 40, 10]])]]);
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(ids(r)).toEqual([]);
  });

  it("the same account: an older Flex without the ISIN column bought 40 in 2024, the 2025 Flex lists 90: not applied", () => {
    const old = flexXml([{ fromDate: "20240101", toDate: "20241231", rows: [["20241001", "BUY", 40, 10]], tradeIsin: "", positionsSection: false }]);
    const y25 = flexXml([{ fromDate: "20250101", toDate: "20251231", rows: issueRows, positions: [[ISIN, 90]] }]);
    expectUnverified(mergedFiles([[IB, old], [IB, y25]]));
  });

  it("an ISIN-less sale before the window of shares the upload never shows bought: not applied (held before the files)", () => {
    expectUnverified(mergedFiles([[IB, ib], ["Otro bróker", other([["20241001", "SELL", 40, 10]], "")]]));
  });

  it("a sale with neither ISIN nor symbol before the window: not applied (it has no holding to check)", () => {
    const keyless = other([["20241001", "SELL", 40, 10]], "").replace(/symbol="XYZ"/g, 'symbol=""');
    expectUnverified(mergedFiles([[IB, ib], ["Otro bróker", keyless]]));
  });

  it("shares with no ISIN that FIFO holds without a BUY at the window start (a scrip dividend): not applied", () => {
    const scrip = `<CorporateAction transactionID="SD9" accountId="U9" symbol="XYZ" description="XYZ STOCK DIVIDEND" isin="" currency="EUR" reportDate="20241201" dateTime="20241201" quantity="10" amount="100" type="SD" actionDescription="" />`;
    const withScrip = flexXml([{ account: "U9", fromDate: "20240101", toDate: "20251231", rows: [["20241001", "BUY", 40, 10], ["20241105", "SELL", 40, 11]], tradeIsin: "", positionsSection: false, actions: scrip }]);
    expectUnverified(mergedFiles([[IB, ib], ["Otro bróker", withScrip]]));
  });

  it("control: an ISIN-less buy sold again before the window start: applied", () => {
    expectApplied(mergedFiles([[IB, ib], ["Otro bróker", other([["20241001", "BUY", 40, 10], ["20241105", "SELL", 40, 11]], "")]]));
  });

  // Revolut gives no ISIN; its holdings rows are built from its own trades.
  const revolutXlsx = (rows: string[][]): Uint8Array => {
    const wb = XLSX.utils.book_new();
    const header = ["Date", "Ticker", "Type", "Quantity", "Price per share", "Total Amount", "Currency", "FX Rate"];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  };
  const withRevolut = async (rows: string[][], method: FxMethod = "monodivisa"): Promise<TaxReport> => {
    const statement = createEmptyStatement();
    mergeStatement(statement, parseIbkrFlexXml(ib), IB);
    mergeStatement(statement, await parseRevolutXlsx(revolutXlsx(rows)), "Revolut");
    return generateTaxReport(finalizeMergedStatement(statement), rates(), 2025, reportOptionsForMethod(method));
  };
  const revolutBuy = ["2024-10-01T10:00:00.000Z", "XYZ", "BUY - MARKET", "40", "EUR 10", "EUR 400", "EUR", "1"];

  it.each(METHODS)("[%s] a Revolut transaction log bought 40 XYZ on 01/10/2024 and never sold them: not applied", async (method) => {
    expectUnverified(await withRevolut([revolutBuy], method));
  });

  it("control: the Revolut buy sold again before the window start: applied", async () => {
    expectApplied(await withRevolut([revolutBuy, ["2024-11-05T10:00:00.000Z", "XYZ", "SELL - MARKET", "40", "EUR 11", "EUR 440", "EUR", "1"]]));
  });
});

describe("(i) a Trade row without an Account ID belongs to its FlexStatement", () => {
  const dropTradeAccount = (xml: string): string => xml.replace(/(<Trade tradeID="\d+") accountId="[^"]*"/g, "$1");

  it("the parser gives the trades U1's account", () => {
    const xml = dropTradeAccount(flexXml([{ fromDate: "20250101", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] }]));
    expect(xml).not.toMatch(/<Trade [^>]*accountId/);
    expect(parseIbkrFlexXml(xml).trades.map((t) => t.accountId)).toEqual(["U1", "U1"]);
  });

  it.each(METHODS)("[%s] neither Trades nor Open Positions have the Account ID column: applied", (method) => {
    const xml = dropTradeAccount(flexXml([{ fromDate: "20250101", toDate: "20251231", rows: issueRows, rawPositions: [positionRow({ accountId: NONE })] }]));
    expectApplied(mergedFiles([[IB, xml]], method));
  });

  it("control: an explicit U2 on the trades inside U1's statement stays U2's: not applied", () => {
    const xml = flexXml([{ fromDate: "20250101", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] }]).replace(/(<Trade tradeID="\d+") accountId="U1"/g, '$1 accountId="U2"');
    expectUnverified(mergedFiles([[IB, xml]]));
  });
});

// ---------------------------------------------------------------------------
// (j) Sixth review of the evidence rule. FIFO matches ISIN-less shares across
// accounts (Spanish FIFO is per taxpayer), so a sale at one account can take
// another account's lot: the holding check must still see that lot. A trade
// row without a readable quantity is missing evidence, not zero shares.
// ---------------------------------------------------------------------------

describe("(j) another account's ISIN-less sale cannot hide a holding open at the window start", () => {
  // IBKR U1 runs the issue example and lists the 50 left. Otro bróker (U9)
  // bought 40 XYZ with no ISIN on 01/10/2024 and never sold them. Tercer
  // bróker (U8) sold 40 XYZ with no ISIN on 05/11/2024, shares it held before
  // its files. FIFO gives U8's sale U9's lot, so neither the lots nor the
  // symbol's merged balance show U9's 40, still held when the window began.
  const ib = flexXml([{ fromDate: "20240101", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] }]);
  const isinLess = (account: string, rows: Row[]): string =>
    flexXml([{ account, fromDate: "20240101", toDate: "20251231", rows, positionsSection: false, tradeIsin: "" }]);
  const u9Buy = isinLess("U9", [["20241001", "BUY", 40, 10]]);

  it.each(METHODS)("[%s] U8 sells 40 it never bought, FIFO takes U9's lot: not applied", (method) => {
    const u8 = isinLess("U8", [["20241105", "SELL", 40, 11]]);
    expectUnverified(mergedFiles([[IB, ib], ["Otro bróker", u9Buy], ["Tercer bróker", u8]], method));
  });

  it("the same with both accounts in one multi-account Flex: not applied", () => {
    const xml = flexXml([
      { fromDate: "20240101", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] },
      { account: "U9", fromDate: "20240101", toDate: "20251231", rows: [["20241001", "BUY", 40, 10]], tradeIsin: "", positionsSection: false },
      { account: "U8", fromDate: "20240101", toDate: "20251231", rows: [["20241105", "SELL", 40, 11]], tradeIsin: "", positionsSection: false },
    ]);
    expectUnverified(mergedFiles([[IB, xml]]));
  });

  it("control: U8 sells 40 it bought itself and U9 sells its 40, all before the window: applied", () => {
    const u8 = isinLess("U8", [["20240901", "BUY", 40, 10], ["20241105", "SELL", 40, 11]]);
    const u9 = isinLess("U9", [["20241001", "BUY", 40, 10], ["20241201", "SELL", 40, 11]]);
    expectApplied(mergedFiles([[IB, ib], ["Otro bróker", u9], ["Tercer bróker", u8]]));
  });

  it("control: U9 sells 40 from an ISIN-less manual opening lot before the window: applied", () => {
    // A manual opening lot belongs to no uploaded account: any account may sell it.
    const statement = createEmptyStatement();
    mergeStatement(statement, parseIbkrFlexXml(ib), IB);
    mergeStatement(statement, parseIbkrFlexXml(isinLess("U9", [["20241105", "SELL", 40, 11]])), "Otro bróker");
    const r = generateTaxReport(finalizeMergedStatement(statement), rates(), 2025, {
      ...reportOptionsForMethod("monodivisa"),
      manualOpeningLots: [
        { symbol: "XYZ", description: "XYZ SA", isin: "", conid: "4531", assetCategory: "STK", currency: "EUR", acquireDate: "2023-03-01", quantity: "40", pricePerShare: "10" },
      ],
    });
    expectApplied(r);
  });
});

describe("(j) a trade row without a readable quantity is missing evidence, not zero shares", () => {
  /** The issue example plus one buy and one sale of the security whose quantity attribute is `qty` (null: no attribute). */
  const withHidden = (qty: string | null, isin = ISIN, extraRows: Row[] = [["20250201", "BUY", 30, 9], ["20250210", "SELL", 30, 9]]): string => {
    const xml = flexXml([{ fromDate: "20240101", toDate: "20251231", rows: [...issueRows, ...extraRows], positions: [[ISIN, 50]] }]);
    // Rewrite the quantity of the extra rows (the last tradeIDs) only.
    const ids = [...xml.matchAll(/<Trade tradeID="(\d+)"/g)].map((m) => m[1]!).slice(issueRows.length);
    return ids.reduce((out, id) => {
      const re = new RegExp(`(<Trade tradeID="${id}"[^>]*?) quantity="[^"]*"`);
      return out.replace(re, qty === null ? "$1" : `$1 quantity="${qty}"`).replace(new RegExp(`(<Trade tradeID="${id}"[^>]*?) isin="[^"]*"`), `$1 isin="${isin}"`);
    }, xml);
  };

  it("the parser keeps the row, quantity \"0\", flagged unknown, and warns", () => {
    for (const qty of [null, "", "abc"]) {
      const parsed = parseIbkrFlexXml(withHidden(qty));
      const hidden = parsed.trades.slice(issueRows.length);
      expect(hidden.map((t) => [t.quantity, t.quantityUnknown])).toEqual([["0", true], ["0", true]]);
      const warning = parsed.parserMessages?.find((m) => m.id === "parser.trade_quantity_unknown");
      expect(warning?.severity).toBe("warning");
      expect(warning?.context).toEqual({ broker: "IBKR", count: "2", trades: "XYZ (ES0000004531) 20250201, XYZ (ES0000004531) 20250210" });
    }
    // Control: an explicit zero is a zero, with no flag and no warning.
    const zero = parseIbkrFlexXml(withHidden("0"));
    expect(zero.trades.slice(issueRows.length).map((t) => [t.quantity, t.quantityUnknown])).toEqual([["0", undefined], ["0", undefined]]);
    expect(zero.parserMessages?.some((m) => m.id === "parser.trade_quantity_unknown") ?? false).toBe(false);
  });

  // FIFO books no shares for the rows (no 0-share lot, so no 0/0 cost on the
  // 15/03 sale and no non-finite total).
  const expectUnverifiedSale = (r: TaxReport): void => {
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(r.capitalGains.disposals.find((d) => sameDay(d.sellDate, "2025-03-15"))!.washSaleSinglePurchase).toBe("unverified");
    expect(r.capitalGains.disposals.some((d) => d.quantity.isZero())).toBe(false);
    expect(r.messages.some((m) => m.id === "report.non_finite_total")).toBe(false);
    expect(ids(r)).toEqual([UNVERIFIED]);
  };

  it("two fills of one order, one with no quantity: the readable fill stays readable, the other its own flagged trade ((l) books it)", () => {
    const fills: Row[] = [["20250201", "BUY", 10, 9, 'ibOrderID="77"'], ["20250201", "BUY", 20, 9, 'ibOrderID="77"']];
    const xml = flexXml([{ fromDate: "20240101", toDate: "20251231", rows: [...issueRows, ...fills], positions: [[ISIN, 80]] }]);
    const lastId = [...xml.matchAll(/<Trade tradeID="(\d+)"/g)].map((m) => m[1]!).at(-1)!;
    const parsed = parseIbkrFlexXml(xml.replace(new RegExp(`(<Trade tradeID="${lastId}"[^>]*?) quantity="[^"]*"`), "$1"));
    const merged = parsed.trades.filter((t) => t.ibOrderID === "77");
    expect(merged.map((t) => [t.quantity, t.quantityUnknown])).toEqual([["10", undefined], ["0", true]]);
    // Control: both fills readable, no flag.
    expect(parseIbkrFlexXml(xml).trades.filter((t) => t.ibOrderID === "77").map((t) => [t.quantity, t.quantityUnknown])).toEqual([["30", undefined]]);
  });

  it.each(METHODS)("[%s] a second buy in the window and its sale, both with no quantity attribute: not applied", (method) => {
    expectUnverifiedSale(mergedFiles([[IB, withHidden(null)]], method));
  });

  it.each(["", "abc"])("the same with quantity=%j: not applied (it no longer crashes FIFO)", (qty) => {
    expectUnverifiedSale(mergedFiles([[IB, withHidden(qty)]]));
  });

  it("an ISIN-less buy with no quantity before the window at another broker: not applied", () => {
    const other = flexXml([{ account: "U9", fromDate: "20240101", toDate: "20251231", rows: [["20241001", "BUY", 40, 10]], positionsSection: false, tradeIsin: "" }])
      .replace(/ quantity="[^"]*"/, "");
    const ib = flexXml([{ fromDate: "20240101", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] }]);
    expectUnverified(mergedFiles([[IB, ib], ["Otro bróker", other]]));
  });

  it("control: the same two rows with an explicit quantity=\"0\": applied", () => {
    expectApplied(mergedFiles([[IB, withHidden("0")]]));
  });

  it("control: a row of another ISIN with no quantity: applied", () => {
    expectApplied(mergedFiles([[IB, withHidden(null, OTHER)]]));
  });
});

describe("(k) every share parser keeps a trade row with no readable quantity as missing evidence", () => {
  // The issue example at IBKR, plus one buy of the security on 02/12/2024
  // (before the 15/01 window start) at another broker. With a readable
  // quantity the shares are held at the window start (blocked, no exception
  // message); with an explicit 0 the row is skipped (applied); with an empty
  // or unreadable quantity the upload cannot prove the exception.
  const ib = flexXml([{ fromDate: "20240101", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] }]);
  const xlsx = (sheet: string, rows: string[][]): Uint8Array => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  };
  interface Broker {
    name: string;
    /** The broker name the parser warning gives. */
    label: string;
    /** No ISIN on its trades: a readable holding at the window start is unverified too. */
    isinLess?: true;
    parse: (qty: string) => Statement | Promise<Statement>;
  }
  const brokers: Broker[] = [
    {
      name: "Trading 212", label: "Trading 212",
      parse: (qty) => trading212Parser.parse([
        "Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Notes,ID",
        `Market buy,2024-12-02 09:30:00,${ISIN},XYZ,XYZ SA,${qty},10,EUR,1.00,,,400,EUR,,t1`,
      ].join("\n")),
    },
    {
      name: "Revolut", label: "Revolut", isinLess: true,
      parse: (qty) => parseRevolutXlsx(xlsx("Sheet1", [
        ["Date", "Ticker", "Type", "Quantity", "Price per share", "Total Amount", "Currency", "FX Rate"],
        ["2024-12-02T10:00:00.000Z", "XYZ", "BUY - MARKET", qty, "EUR 10", "EUR 400", "EUR", "1"],
      ])),
    },
    {
      name: "Freedom24", label: "Freedom24",
      parse: (qty) => freedom24Parser.parse(JSON.stringify({
        trades: { detailed: [{ date: "2024-12-02 10:00:00", ticker: "XYZ.EU", isin: ISIN, operation: "buy", p: 10, q: qty, curr_c: "EUR", commission: 0, amount: 400 }] },
        corporate_actions: { detailed: [] },
      })),
    },
    {
      name: "Lightyear", label: "Lightyear",
      parse: (qty) => lightyearParser.parse([
        "Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.",
        `02/12/2024 09:30:00,OR-1,XYZ,${ISIN},Buy,${qty},EUR,10.00,400.00,,0.00,400.00,`,
      ].join("\n")),
    },
    {
      name: "Scalable Capital", label: "Scalable Capital",
      parse: (qty) => scalableParser.parse([
        "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency",
        `2024-12-02;09:15;Executed;REF001;XYZ SA;Security;Buy;${ISIN};${qty};10,00;-400,00;0;0;EUR`,
      ].join("\n")),
    },
    {
      name: "Flatex", label: "Flatex",
      parse: (qty) => flatexParser.parse([
        "Nummer;Buchtag;Valuta;ISIN;Bezeichnung;Nominal;;Buchungsinformationen;TA-Nr.;Kurs;;Depot",
        `1;02.12.2024;02.12.2024;${ISIN};XYZ SA;${qty};Stk.;Ausführung ORDER Kauf ${ISIN} 1;1;10,00;EUR;***xxx Depot`,
      ].join("\n")),
    },
    {
      name: "Trade Republic", label: "Trade Republic",
      parse: (qty) => tradeRepublicParser.parse([
        '"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency","original_amount","original_currency","fx_rate","description","transaction_id","counterparty_name","counterparty_iban","payment_reference","mcc_code"',
        `"2024-12-02T09:30:00.000Z","2024-12-02","DEFAULT","TRADING","BUY","STOCK","XYZ SA","${ISIN}","${qty}","10.000000","-400.00","","","EUR","","","","Buy","tx-1","","","",""`,
      ].join("\n")),
    },
    {
      name: "DEGIRO", label: "DEGIRO",
      parse: (qty) => degiroParser.parse([
        "Date,Time,Product,ISIN,Reference Exchange,Execution Venue,Quantity,Price,,Value,,Transaction and/or third,,Total,,Order ID",
        `02-12-2024,09:15,XYZ SA,${ISIN},MAD,XMAD,${qty},10.00,EUR,-400.00,EUR,0,EUR,-400.00,EUR,aaa`,
      ].join("\n")),
    },
    {
      // A closed position: bought 02/12/2024, sold 10/02/2025 (inside the window).
      name: "eToro", label: "eToro",
      parse: (qty) => parseEtoroXlsx(xlsx("Closed Positions", [
        ["Action", "Amount", "Units", "Open Rate", "Close Rate", "Profit(USD)", "Open Date", "Close Date", "Type", "Leverage", "ISIN"],
        ["Buy XYZ", "400", qty, "10", "11", "40", "02/12/2024", "10/02/2025", "Stocks", "1", ISIN],
      ])),
    },
  ];
  const report = async (broker: Broker, qty: string, method: FxMethod = "monodivisa"): Promise<TaxReport> => {
    const statement = createEmptyStatement();
    mergeStatement(statement, parseIbkrFlexXml(ib), IB);
    mergeStatement(statement, await broker.parse(qty), broker.name);
    return generateTaxReport(finalizeMergedStatement(statement), rates(), 2025, reportOptionsForMethod(method));
  };

  describe.each(brokers)("$name", (broker) => {
    it.each(METHODS)("[%s] the buy before the window with an empty quantity: not applied, and FIFO books no shares for it", async (method) => {
      const r = await report(broker, "", method);
      expectUnverified(r);
      expect(r.capitalGains.disposals.some((d) => d.quantity.isZero())).toBe(false);
      expect(r.messages.some((m) => m.id === "report.non_finite_total")).toBe(false);
    });

    it.each(["", "abc"])("the parser keeps the row with quantity %j: quantity \"0\", flagged unknown, no money, and warns", async (qty) => {
      const parsed = await broker.parse(qty);
      expect(parsed.trades.length).toBeGreaterThan(0);
      for (const t of parsed.trades) {
        expect([t.quantity, t.quantityUnknown, t.tradeMoney, t.proceeds, t.cost, t.commission, t.taxes]).toEqual(["0", true, "0", "0", "0", "0", "0"]);
      }
      // Revolut infers holdings from its trades: a purchase of unknown size
      // leaves one of unknown size, flagged, never a readable count.
      expect(parsed.openPositions.map((p) => [p.symbol, p.quantity, p.quantityUnknown])).toEqual(broker.name === "Revolut" ? [["XYZ", "0", true]] : []);
      const warning = parsed.parserMessages?.find((m) => m.id === "parser.trade_quantity_unknown");
      expect([warning?.severity, warning?.context?.broker, warning?.context?.count]).toEqual(["warning", broker.label, String(parsed.trades.length)]);
    });

    it("control: an explicit 0 is skipped as before: applied", async () => {
      expect((await broker.parse("0")).trades).toEqual([]);
      expectApplied(await report(broker, "0"));
    });

    it(broker.isinLess ? "control: a readable 40 held at the window start, with no ISIN: not applied" : "control: a readable 40 held at the window start: blocked", async () => {
      const r = await report(broker, "40");
      if (broker.isinLess) expectUnverified(r);
      else {
        expect(blockedOn(r, "2025-03-15")).toBe("100.00");
        expect(ids(r)).toEqual([]);
      }
      expect((await broker.parse("40")).parserMessages?.some((m) => m.id === "parser.trade_quantity_unknown") ?? false).toBe(false);
    });
  });

  it("Freedom24 with no `q` key at all: kept the same way", () => {
    const parsed = freedom24Parser.parse(JSON.stringify({
      trades: { detailed: [{ date: "2024-12-02 10:00:00", ticker: "XYZ.EU", isin: ISIN, operation: "buy", p: 10, curr_c: "EUR", commission: 0, amount: 400 }] },
      corporate_actions: { detailed: [] },
    }));
    expect(parsed.trades.map((t) => [t.quantity, t.quantityUnknown])).toEqual([["0", true]]);
  });
});

// ---------------------------------------------------------------------------
// (l) Review of the seventh fix: a quantity-less row must neither swallow the
// readable fills of its order, nor crash the parser, nor be dropped by an
// earlier guard, nor turn a non-trade row into a trade.
// ---------------------------------------------------------------------------
describe("(l) an IBKR order with a readable fill and an unreadable one", () => {
  /** The issue example plus order 77 on 01/02: fills of `qty` shares, the `unreadable` indexes with no quantity. */
  const withOrder = (qty: number[], unreadable: number[]): string => {
    const fills: Row[] = qty.map((q) => ["20250201", "BUY", q, 9, 'ibOrderID="77"']);
    const xml = flexXml([{ fromDate: "20240101", toDate: "20251231", rows: [...issueRows, ...fills], positions: [[ISIN, 50 + qty.reduce((s, q) => s + q, 0)]] }]);
    const fillIds = [...xml.matchAll(/<Trade tradeID="(\d+)"/g)].map((m) => m[1]!).slice(issueRows.length);
    return unreadable.reduce((out, i) => out.replace(new RegExp(`(<Trade tradeID="${fillIds[i]}"[^>]*?) quantity="[^"]*"`), "$1"), xml);
  };

  it("the parser merges only the readable fills; the unreadable one stays its own trade, flagged, and is warned", () => {
    const parsed = parseIbkrFlexXml(withOrder([10, 20, 5], [2]));
    expect(parsed.trades.filter((t) => t.ibOrderID === "77").map((t) => [t.quantity, t.quantityUnknown ?? false])).toEqual([["30", false], ["0", true]]);
    expect(parsed.parserMessages?.find((m) => m.id === "parser.trade_quantity_unknown")?.context?.count).toBe("1");
    // One readable fill next to the unreadable one is kept as written.
    expect(parseIbkrFlexXml(withOrder([10, 20], [1])).trades.filter((t) => t.ibOrderID === "77").map((t) => [t.quantity, t.quantityUnknown ?? false])).toEqual([["10", false], ["0", true]]);
  });

  it.each(METHODS)("[%s] FIFO books the readable 30 shares (the 15/03 sale takes them first), and the unreadable fill keeps the exception unverified", (method) => {
    const r = mergedFiles([[IB, withOrder([10, 20, 5], [2])]], method);
    const sale = r.capitalGains.disposals.filter((d) => sameDay(d.sellDate, "2025-03-15"));
    expect(sale.filter((d) => sameDay(d.acquireDate, "2025-02-01")).reduce((s, d) => s.plus(d.quantity.abs()), new Decimal(0)).toString()).toBe("30");
    expect(r.capitalGains.disposals.some((d) => d.quantity.isZero())).toBe(false);
    expect(r.messages.some((m) => m.id === "report.non_finite_total")).toBe(false);
    // The sale's loss: 30 × (8 − 9) + 20 × (8 − 10) = −70, all blocked (two buy
    // operations in the window, order 77 and 01/03: no exception to prove).
    expect(blockedOn(r, "2025-03-15")).toBe("70.00");
    expect(sale.every((d) => d.washSaleSinglePurchase === undefined)).toBe(true);
  });

  it("the single-buy history: order 77 alone in the window, one fill unreadable: not applied", () => {
    // Buy order 77 of 100 on 01/03 (one fill of 100, one with no quantity), sell 50 on 15/03 at 8.
    const fills: Row[] = [["20250301", "BUY", 100, 10, 'ibOrderID="77"'], ["20250301", "BUY", 1, 10, 'ibOrderID="77"'], ["20250315", "SELL", 50, 8]];
    const xml = flexXml([{ fromDate: "20240101", toDate: "20251231", rows: fills, positions: [[ISIN, 50]] }]);
    const secondFill = [...xml.matchAll(/<Trade tradeID="(\d+)"/g)].map((m) => m[1]!)[1]!;
    const r = mergedFiles([[IB, xml.replace(new RegExp(`(<Trade tradeID="${secondFill}"[^>]*?) quantity="[^"]*"`), "$1")]]);
    expectUnverified(r);
    // The sale took 50 of the 100 readable shares: a loss of 100, not an unmatched sale.
    expect(r.capitalGains.disposals.find((d) => sameDay(d.sellDate, "2025-03-15"))!.gainLossEur.toFixed(2)).toBe("-100.00");
  });
});

describe("(l) a crypto acquisition of unknown quantity is no FIFO lot and no repurchase", () => {
  const cryptoTrade = (id: string, date: string, side: "BUY" | "SELL", qty: string | null, price: number, order = ""): string => {
    const q = qty === null ? "" : ` quantity="${side === "BUY" ? qty : `-${qty}`}"`;
    const money = new Decimal(qty ?? "1").mul(price);
    return `<Trade tradeID="${id}" accountId="U1" symbol="BTC" description="Bitcoin" isin="" assetCategory="CRYPTO" currency="EUR" tradeDate="${date}" settlementDate="${date}"${q} tradePrice="${price}" tradeMoney="${side === "BUY" ? money : money.neg()}" proceeds="${side === "BUY" ? money.neg() : money}" cost="${money}" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}" exchange="PAXOS" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" multiplier="1"${order ? ` ibOrderID="${order}"` : ""} />`;
  };
  // Buy 1 BTC at 200 in 2024, sell it on 01/06/2025 at 100 (−100), rebuy on
  // 01/07 in order 88 (one fill of 1 coin, one fill with no quantity), sell 1
  // on 01/09 at 100: the rebought coin leaves, so the loss is released in 2025.
  const xml = `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20240101" toDate="20251231" period="Custom"><Trades>${[
    cryptoTrade("c1", "20240110", "BUY", "1", 200),
    cryptoTrade("c2", "20250601", "SELL", "1", 100),
    cryptoTrade("c3", "20250701", "BUY", "1", 100, "88"),
    cryptoTrade("c4", "20250701", "BUY", null, 100, "88"),
    cryptoTrade("c5", "20250901", "SELL", "1", 100),
  ].join("")}</Trades><CashTransactions /><CorporateActions /><SecuritiesInfo /></FlexStatement></FlexStatements></FlexQueryResponse>`;

  it.each(METHODS)("[%s] the readable rebought coin blocks the loss and its sale releases it; the quantity-less fill books nothing", (method) => {
    const r = mergedFiles([[IB, xml]], method);
    expect(blockedOn(r, "2025-06-01")).toBe("100.00");
    expect(releasedOn(r, "2025-09-01")).toBe("100.00");
    expect(r.capitalGains.disposals.some((d) => d.quantity.isZero())).toBe(false);
  });

  it("a flagged crypto rebuy that still carries a quantity (a statement built elsewhere) blocks nothing, as FIFO books nothing", () => {
    const parsed = parseIbkrFlexXml(xml);
    // Rebuild the statement with only the flagged trade in the year after the loss.
    const kept = parsed.trades.filter((t) => t.tradeID !== "c3" && t.tradeID !== "c5" && !t.tradeID.startsWith("merged-"));
    const flagged = kept.map((t) => (t.tradeID === "c4" ? { ...t, quantity: "1" } : t));
    expect(flagged.find((t) => t.tradeID === "c4")).toMatchObject({ quantity: "1", quantityUnknown: true });
    const statement = finalizeMergedStatement(mergeStatement(createEmptyStatement(), { ...parsed, trades: flagged }, IB));
    const r = generateTaxReport(statement, rates(), 2025, reportOptionsForMethod("monodivisa"));
    expect(blockedOn(r, "2025-06-01")).toBe("0.00");
  });
});

describe("(l) an IBKR cancellation next to a row with an unreadable quantity", () => {
  const raw = (attrs: string): string =>
    `<Trade accountId="U1" symbol="XYZ" description="XYZ SA" conid="4531" isin="${ISIN}" assetCategory="STK" currency="EUR" tradeDate="20250210" settlementDate="20250210" tradePrice="9" tradeMoney="0" proceeds="0" cost="0" fifoPnlRealized="0" fxRateToBase="1" exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" multiplier="1" ${attrs} />`;
  const file = (rows: string[]): string =>
    `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20250101" toDate="20251231" period="Custom"><Trades>${rows.join("")}</Trades><CashTransactions /><CorporateActions /><SecuritiesInfo /></FlexStatement></FlexStatements></FlexQueryResponse>`;
  const cancel = raw('tradeID="9" transactionID="9" transactionType="TradeCancel" buySell="SELL (Ca.)" quantity="30" openCloseIndicator="C"');

  it.each(["abc", ""])("an ordinary SELL with quantity=%j and a cancellation without origTransactionID: no crash, the row is kept flagged, and the warning does not say the original is outside the file", (qty) => {
    const parsed = parseIbkrFlexXml(file([raw(`tradeID="8" transactionID="8" buySell="SELL" quantity="${qty}" openCloseIndicator="C"`), cancel]));
    expect(parsed.trades.map((t) => [t.tradeID, t.quantity, t.quantityUnknown])).toEqual([["8", "0", true]]);
    const msgs = parsed.parserMessages?.map((m) => m.id) ?? [];
    expect(msgs).toContain("parser.cancelled_trades_unreadable");
    expect(msgs).not.toContain("parser.cancelled_trades_unmatched");
  });

  it("control: a readable cancellation whose in-file candidate is readable but of another size: the original is outside the file", () => {
    const parsed = parseIbkrFlexXml(file([raw('tradeID="8" transactionID="8" buySell="SELL" quantity="-20" openCloseIndicator="C"'), cancel]));
    expect(parsed.trades.map((t) => t.tradeID)).toEqual(["8"]);
    const msgs = parsed.parserMessages?.map((m) => m.id) ?? [];
    expect(msgs).toContain("parser.cancelled_trades_unmatched");
    expect(msgs).not.toContain("parser.cancelled_trades_unreadable");
  });

  it("a cancellation whose own quantity is unreadable and no execution id ties: no crash, dropped alone, and the warning does not say the original is outside the file", () => {
    const badCancel = cancel.replace('quantity="30"', 'quantity="abc"');
    const parsed = parseIbkrFlexXml(file([raw('tradeID="8" transactionID="8" buySell="SELL" quantity="-30" openCloseIndicator="C"'), badCancel]));
    expect(parsed.trades.map((t) => t.tradeID)).toEqual(["8"]);
    expect(parsed.parserMessages?.map((m) => m.id)).toContain("parser.cancelled_trades_unreadable");
    expect(parsed.parserMessages?.some((m) => m.id === "parser.cancelled_trades_unmatched")).toBe(false);
  });

  it("control: a readable pair still cancels out, next to an unreadable row", () => {
    const parsed = parseIbkrFlexXml(file([
      raw('tradeID="7" transactionID="7" buySell="SELL" quantity="abc" openCloseIndicator="C"'),
      raw('tradeID="8" transactionID="8" buySell="SELL" quantity="-30" openCloseIndicator="C"'),
      cancel,
    ]));
    expect(parsed.trades.map((t) => [t.tradeID, t.quantityUnknown ?? false])).toEqual([["7", true]]);
    expect(parsed.parserMessages?.some((m) => m.id === "parser.cancelled_trades")).toBe(true);
  });
});

describe("(l) other parsers: an earlier guard, a currency-only cell, a non-trade row", () => {
  const ib = flexXml([{ fromDate: "20240101", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] }]);
  const report = async (name: string, statement: Statement | Promise<Statement>): Promise<TaxReport> => {
    const merged = createEmptyStatement();
    mergeStatement(merged, parseIbkrFlexXml(ib), IB);
    mergeStatement(merged, await statement, name);
    return generateTaxReport(finalizeMergedStatement(merged), rates(), 2025, reportOptionsForMethod("monodivisa"));
  };
  const xlsx = (rows: string[][]): Uint8Array => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  };
  const flags = (s: Statement): [string, string, boolean][] => s.trades.map((t) => [t.buySell, t.quantity, t.quantityUnknown ?? false]);

  describe("Revolut closed positions (realized P&L): both legs kept", () => {
    // XYZ bought 02/12/2024 (before the 15/01 window start) and sold 10/02/2025.
    const closed = (qty: string): Promise<Statement> => parseRevolutXlsx(xlsx([
      ["Date acquired", "Date sold", "Symbol", "Quantity", "Cost basis", "Gross proceeds", "Gross PnL", "Fees", "Currency"],
      ["2024-12-02", "2025-02-10", "XYZ", qty, "400", "380", "-20", "0", "EUR"],
    ]));

    it.each(["", "abc", "€"])("quantity %j: a BUY and a SELL of unknown quantity, no money, and the warning", async (qty) => {
      const parsed = await closed(qty);
      expect(flags(parsed)).toEqual([["BUY", "0", true], ["SELL", "0", true]]);
      for (const t of parsed.trades) expect([t.tradeMoney, t.proceeds, t.cost, t.commission]).toEqual(["0", "0", "0", "0"]);
      expect(parsed.parserMessages?.find((m) => m.id === "parser.trade_quantity_unknown")?.context).toMatchObject({ broker: "Revolut", count: "2" });
    });

    it("next to the IBKR issue file: not applied", async () => {
      expectUnverified(await report("Revolut", closed("")));
    });

    it("control: an explicit 0 is skipped as before: applied", async () => {
      expect((await closed("0")).trades).toEqual([]);
      expectApplied(await report("Revolut", closed("0")));
    });
  });

  describe("Flatex: a Kauf or Verkauf with neither Nominal nor Kurs", () => {
    const flatex = (nominal: string, info: string, kurs: string): Statement => flatexParser.parse([
      "Nummer;Buchtag;Valuta;ISIN;Bezeichnung;Nominal;;Buchungsinformationen;TA-Nr.;Kurs;;Depot",
      `1;02.12.2024;02.12.2024;${ISIN};XYZ SA;${nominal};Stk.;${info};1;${kurs};EUR;***xxx Depot`,
    ].join("\n"));

    it.each([[`Ausführung ORDER Kauf ${ISIN} 1`, "BUY"], [`Ausführung ORDER Verkauf ${ISIN} 1`, "SELL"]])("%s: kept, unknown quantity", (info, side) => {
      expect(flags(flatex("", info, ""))).toEqual([[side, "0", true]]);
    });

    it("next to the IBKR issue file: not applied", async () => {
      expectUnverified(await report("Flatex", flatex("", `Ausführung ORDER Kauf ${ISIN} 1`, "")));
    });

    it("an explicit zero Kurs and an unmatched custody transfer: kept as rows that book nothing (#467)", () => {
      expect(flags(flatex("", `Ausführung ORDER Kauf ${ISIN} 1`, "0,00"))).toEqual([["BUY", "0", true]]);
      expect(flags(flatex("", `Lagerstellenwechsel in ${ISIN}`, ""))).toEqual([["BUY", "0", true]]);
    });

    it("a row with no buy or sale text is kept as an unreadable row, never dropped (#468)", () => {
      const parsed = flatex("", `Einbuchung ${ISIN}`, "");
      expect(flags(parsed)).toEqual([["BUY", "0", true]]);
      expect(parsed.trades[0]?.unreadableRow).toBe(`XYZ SA (${ISIN}) 20241202 [Buchungsinformationen: "Einbuchung ${ISIN}"]`);
    });
  });

  describe("DEGIRO: a row with an ISIN and an order id but neither quantity nor price", () => {
    const degiro = (qty: string, price: string, value: string, orderId = "aaa"): Statement => degiroParser.parse([
      "Date,Time,Product,ISIN,Reference Exchange,Execution Venue,Quantity,Price,,Value,,Transaction and/or third,,Total,,Order ID",
      `02-12-2024,09:15,XYZ SA,${ISIN},MAD,XMAD,${qty},${price},EUR,${value},EUR,0,EUR,${value},EUR,${orderId}`,
    ].join("\n"));

    it("kept, unknown quantity, its side from the value", () => {
      expect(flags(degiro("", "", "-400.00"))).toEqual([["BUY", "0", true]]);
      expect(flags(degiro("", "", "400.00"))).toEqual([["SELL", "0", true]]);
    });

    it("next to the IBKR issue file: not applied", async () => {
      expectUnverified(await report("DEGIRO", degiro("", "", "-400.00")));
    });

    it("an explicit zero price (a rights assignment) is kept as a row that books nothing (#467); a row with no order id and no value is skipped", () => {
      expect(flags(degiro("", "0", "0"))).toEqual([["BUY", "0", true]]);
      expect(degiro("", "", "", "").trades).toEqual([]);
    });
  });

  describe("Freedom24: only a buy or a sell becomes a trade of unknown quantity", () => {
    const f24 = (operation: string, q: string): Statement => freedom24Parser.parse(JSON.stringify({
      trades: { detailed: [{ date: "2024-12-02 10:00:00", ticker: "XYZ.EU", isin: ISIN, operation, p: 10, q, curr_c: "EUR", commission: 0, amount: 400 }] },
      corporate_actions: { detailed: [] },
    }));

    it.each(["transfer", "deposit"])("operation %j with no quantity: kept as an unreadable row, never a buy (#468)", (operation) => {
      const parsed = f24(operation, "");
      expect(flags(parsed)).toEqual([["BUY", "0", true]]);
      expect(parsed.trades[0]?.unreadableRow).toBe(`XYZ (${ISIN}) 20241202 [operation: "${operation}"]`);
      expect(parsed.parserMessages?.map((m) => m.id)).toEqual(["parser.trade_row_unreadable"]);
    });

    it.each(["transfer", "deposit"])("operation %j with a written 0: moves no shares, skipped", (operation) => {
      expect(f24(operation, "0").trades).toEqual([]);
    });

    it("control: a sell with no quantity is kept as a SELL", () => {
      expect(flags(f24("sell", ""))).toEqual([["SELL", "0", true]]);
    });
  });

  it("Lightyear: a currency-only quantity (€) is unreadable, not an explicit 0: kept and warned", () => {
    const parsed = lightyearParser.parse([
      "Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.",
      `02/12/2024 09:30:00,OR-1,XYZ,${ISIN},Buy,€,EUR,10.00,400.00,,0.00,400.00,`,
    ].join("\n"));
    expect(flags(parsed)).toEqual([["BUY", "0", true]]);
    expect(parsed.parserMessages?.some((m) => m.id === "parser.trade_quantity_unknown")).toBe(true);
  });

  it("Revolut transaction log: a currency-only quantity ($) is unreadable too", async () => {
    const parsed = await parseRevolutXlsx(xlsx([
      ["Date", "Ticker", "Type", "Quantity", "Price per share", "Total Amount", "Currency", "FX Rate"],
      ["2024-12-02T10:00:00.000Z", "XYZ", "BUY - MARKET", "$", "EUR 10", "EUR 400", "EUR", "1"],
    ]));
    expect(flags(parsed)).toEqual([["BUY", "0", true]]);
  });
});

describe("(m) a buy or sale with a readable quantity but no readable price is evidence, not a dropped row", () => {
  // The IBKR issue file plus one more purchase of the security on 03/02, inside
  // the 15/01 – 15/03 window, at another broker. With a price it is a second
  // purchase (no exception); with no readable price the parser used to drop it
  // silently, and the exception was applied to a two-purchase window.
  const ib = flexXml([{ fromDate: "20240101", toDate: "20251231", rows: issueRows, positions: [[ISIN, 50]] }]);
  const report = (name: string, statement: Statement, method: FxMethod = "monodivisa"): TaxReport => {
    const merged = createEmptyStatement();
    mergeStatement(merged, parseIbkrFlexXml(ib), IB);
    mergeStatement(merged, statement, name);
    return generateTaxReport(finalizeMergedStatement(merged), rates(), 2025, reportOptionsForMethod(method));
  };
  const flags = (s: Statement): [string, string, boolean][] => s.trades.map((t) => [t.buySell, t.quantity, t.quantityUnknown ?? false]);
  const flatex = (nominal: string, kurs: string, info = `Ausführung ORDER Kauf ${ISIN} 1`): Statement => flatexParser.parse([
    "Nummer;Buchtag;Valuta;ISIN;Bezeichnung;Nominal;;Buchungsinformationen;TA-Nr.;Kurs;;Depot",
    `1;03.02.2025;03.02.2025;${ISIN};XYZ SA;${nominal};Stk.;${info};1;${kurs};EUR;***xxx Depot`,
  ].join("\n"));
  // Decimal-comma cells are quoted, as DEGIRO writes them: unquoted, "-45,00"
  // would split into two cells and shift every later column.
  const degiro = (qty: string, price: string, value: string, orderId = "aaa"): Statement => degiroParser.parse([
    "Date,Time,Product,ISIN,Reference Exchange,Execution Venue,Quantity,Price,,Value,,Transaction and/or third,,Total,,Order ID",
    `03-02-2025,09:15,XYZ SA,${ISIN},MAD,XMAD,"${qty}","${price}",EUR,"${value}",EUR,0,EUR,"${value}",EUR,${orderId}`,
  ].join("\n"));
  const t212 = (price: string, currency = "USD"): Statement => trading212Parser.parse([
    "Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Notes,ID",
    `Market buy,2025-02-03 09:30:00,${ISIN},XYZ,XYZ SA,5,${price},${currency},1.00,,,45.00,EUR,,t212-1`,
  ].join("\n"));
  // Two purchases in the window: no exception to prove, the whole loss of the
  // 15/03 sale is blocked (95 when FIFO gives it the 5 shares bought at 9).
  const twoPurchases = (r: TaxReport): void => {
    const loss = r.capitalGains.disposals.filter((d) => sameDay(d.sellDate, "2025-03-15")).reduce((s, d) => s.plus(d.gainLossEur), new Decimal(0));
    expect(loss.isNegative()).toBe(true);
    expect(blockedOn(r, "2025-03-15")).toBe(loss.neg().toFixed(2));
    expect(ids(r)).toEqual([]);
  };

  describe("Flatex: a Kauf of 5 with a blank or unreadable Kurs", () => {
    it.each(["", "abc", "€"])("Kurs %j: kept as a trade that books nothing, and warned", (kurs) => {
      const parsed = flatex("5", kurs);
      expect(flags(parsed)).toEqual([["BUY", "0", true]]);
      expect(parsed.parserMessages?.find((m) => m.id === "parser.trade_quantity_unknown")?.context).toMatchObject({ broker: "Flatex", count: "1" });
    });

    it.each(METHODS)("[%s] next to the IBKR issue file: not applied, the 100 stays blocked", (method) => {
      expectUnverified(report("Flatex", flatex("5", ""), method));
    });

    it("a Verkauf with a negative Nominal and a blank Kurs is kept as a SELL", () => {
      expect(flags(flatex("-5", "", `Ausführung ORDER Verkauf ${ISIN} 1`))).toEqual([["SELL", "0", true]]);
    });

    it("controls: a written price is a second purchase; a written zero Kurs and an unmatched custody transfer are kept, not applied (#467)", () => {
      twoPurchases(report("Flatex", flatex("5", "9,00")));
      expect(flags(flatex("5", "0,00"))).toEqual([["BUY", "0", true]]);
      expect(flags(flatex("5", "", `Lagerstellenwechsel in ${ISIN}`))).toEqual([["BUY", "0", true]]);
      expectUnverified(report("Flatex", flatex("5", "0,00")));
    });

    it("a row with no Kauf/Verkauf text is kept as an unreadable row (#468): not applied", () => {
      expect(flags(flatex("5", "", `Einbuchung ${ISIN}`))).toEqual([["BUY", "0", true]]);
      expectUnverified(report("Flatex", flatex("5", "", `Einbuchung ${ISIN}`)));
    });
  });

  describe("DEGIRO: a buy of 5 with a blank price", () => {
    it("kept as a trade that books nothing, its side from the value, and warned", () => {
      const parsed = degiro("5", "", "-45,00");
      expect(flags(parsed)).toEqual([["BUY", "0", true]]);
      expect(flags(degiro("-5", "", "45,00"))).toEqual([["SELL", "0", true]]);
      expect(parsed.parserMessages?.find((m) => m.id === "parser.trade_quantity_unknown")?.context).toMatchObject({ broker: "DEGIRO", count: "1" });
    });

    it.each(METHODS)("[%s] next to the IBKR issue file: not applied, the 100 stays blocked", (method) => {
      expectUnverified(report("DEGIRO", degiro("5", "", "-45,00"), method));
    });

    it("the same with no order id but a value: kept", () => {
      const parsed = degiro("5", "", "-45,00", "");
      expect(flags(parsed)).toEqual([["BUY", "0", true]]);
      // Kept on the value alone: the order id cell is really empty.
      expect(parsed.trades[0]!.tradeID).toBe("");
    });

    it("a written zero quantity (0,00) with a blank price and an order id: skipped, no evidence", () => {
      expect(degiro("0,00", "", "-45,00").trades).toEqual([]);
      expectApplied(report("DEGIRO", degiro("0,00", "", "-45,00")));
    });

    it.each(METHODS)("[%s] a written zero quantity (0,00) with an unreadable price (abc, -): skipped, not booked at that price, applied", (method) => {
      for (const price of ["abc", "-"]) {
        expect(degiro("0,00", price, "-45,00").trades).toEqual([]);
        expectApplied(report("DEGIRO", degiro("0,00", price, "-45,00"), method));
      }
    });

    it("controls: a written price is a second purchase; a written zero price (rights) and a row with no order id and no value are kept, not applied", () => {
      // The readable row is booked as written: 5 shares at 9,00 EUR.
      expect(degiro("5", "9,00", "-45,00").trades.map((t) => [t.quantity, t.tradePrice, t.currency, t.quantityUnknown ?? false])).toEqual([["5", "9.00", "EUR", false]]);
      twoPurchases(report("DEGIRO", degiro("5", "9,00", "-45,00")));
      // A written zero price (rights) is kept as a row that books nothing (#467).
      expect(flags(degiro("5", "0", "0"))).toEqual([["BUY", "0", true]]);
      // A readable quantity with a blank price, no order id and no value is
      // still a purchase of unknown price: dropped, it hid a second purchase
      // in the window, so the exception could be applied wrongly (#467).
      expect(flags(degiro("5", "", "", ""))).toEqual([["BUY", "0", true]]);
      expectUnverified(report("DEGIRO", degiro("5", "0", "0")));
      expectUnverified(report("DEGIRO", degiro("5", "", "", "")));
    });
  });

  describe("Trading 212: a buy of 5 with no price and a Total in another currency", () => {
    it("still counted in the skip warning, and kept as a trade that books nothing", () => {
      const parsed = t212("");
      expect(flags(parsed)).toEqual([["BUY", "0", true]]);
      expect(parsed.parserMessages?.map((m) => m.id)).toEqual(["parser.trading212.unresolved_price_skipped", "parser.trade_quantity_unknown"]);
    });

    it.each(METHODS)("[%s] next to the IBKR issue file: not applied, the 100 stays blocked", (method) => {
      expectUnverified(report("Trading 212", t212(""), method));
    });

    it("control: the same buy with its price is a second purchase", () => {
      twoPurchases(report("Trading 212", t212("9.00", "EUR")));
    });

    it("control: a written zero price is still skipped (counted in the skip warning), no evidence: applied", () => {
      const parsed = t212("0");
      expect(parsed.trades).toEqual([]);
      expect(parsed.parserMessages?.map((m) => m.id)).toEqual(["parser.trading212.unresolved_price_skipped"]);
      expectApplied(report("Trading 212", parsed));
    });
  });
});

describe("(m) an IBKR cancellation whose quantity is unreadable pairs by its execution id", () => {
  const row = (attrs: string): string =>
    `<Trade accountId="U1" symbol="XYZ" description="XYZ SA" conid="4531" isin="${ISIN}" assetCategory="STK" currency="EUR" settlementDate="20250210" fifoPnlRealized="0" fxRateToBase="1" exchange="BME" ibCommissionCurrency="EUR" taxes="0" multiplier="1" ${attrs} />`;
  const file = (rows: string[]): string =>
    `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20250101" toDate="20251231" period="Custom"><Trades>${rows.join("")}</Trades><CashTransactions /><CorporateActions /><SecuritiesInfo /></FlexStatement></FlexStatements></FlexQueryResponse>`;
  // Buy 30 at 9 on 10/01; sell 30 at 12 on 10/02 (execution E2), which IBKR cancels.
  const buy = row('tradeID="1" transactionID="1" tradeDate="20250110" buySell="BUY" quantity="30" tradePrice="9" tradeMoney="270" proceeds="-270" cost="270" ibCommission="0" openCloseIndicator="O" ibExecID="E1" ibOrderID="O1"');
  const sell = row('tradeID="2" transactionID="2" tradeDate="20250210" buySell="SELL" quantity="-30" tradePrice="12" tradeMoney="-360" proceeds="360" cost="-270" ibCommission="0" openCloseIndicator="C" ibExecID="E2" ibOrderID="O2"');
  const cancel = (q: string, exec = "E2"): string =>
    row(`tradeID="3" transactionID="3" tradeDate="20250210" transactionType="TradeCancel" buySell="SELL (Ca.)" quantity="${q}" tradePrice="12" tradeMoney="360" proceeds="-360" cost="270" ibCommission="0" openCloseIndicator="C" ibExecID="${exec}" ibOrderID="O2"`);
  const run = (rows: string[], method: FxMethod) =>
    generateTaxReport(finalizeMergedStatement(mergeStatement(createEmptyStatement(), parseIbkrFlexXml(file(rows)), IB)), rates(), 2025, reportOptionsForMethod(method));

  it.each(["abc", ""])("cancel quantity %j with the sale's ibExecID: both rows dropped, no disposal", (q) => {
    const parsed = parseIbkrFlexXml(file([buy, sell, cancel(q)]));
    expect(parsed.trades.map((t) => t.tradeID)).toEqual(["1"]);
    expect(parsed.parserMessages?.map((m) => m.id)).toContain("parser.cancelled_trades");
    for (const method of METHODS) expect(run([buy, sell, cancel(q)], method).capitalGains.disposals).toEqual([]);
  });

  it("the sale's quantity unreadable and the cancel readable, same ibExecID: both dropped", () => {
    const parsed = parseIbkrFlexXml(file([buy, sell.replace('quantity="-30"', 'quantity="abc"'), cancel("30")]));
    expect(parsed.trades.map((t) => t.tradeID)).toEqual(["1"]);
  });

  it.each([["omitted", ""], ["empty", ' tradePrice=""'], ["blank", ' tradePrice="  "']])("a cancel whose tradePrice is %s, with the sale's ibExecID: both rows dropped (a missing price is no written zero)", (_label, attr) => {
    const parsed = parseIbkrFlexXml(file([buy, sell, cancel("30").replace(' tradePrice="12"', attr)]));
    expect(parsed.trades.map((t) => t.tradeID)).toEqual(["1"]);
    for (const method of METHODS) expect(run([buy, sell, cancel("30").replace(' tradePrice="12"', attr)], method).capitalGains.disposals).toEqual([]);
  });

  it("the sale's quantity unreadable and the cancel's price another, same ibExecID: the execution id alone ties the pair", () => {
    const parsed = parseIbkrFlexXml(file([buy, sell.replace('quantity="-30"', 'quantity="abc"'), cancel("30").replace('tradePrice="12"', 'tradePrice="13"')]));
    expect(parsed.trades.map((t) => t.tradeID)).toEqual(["1"]);
  });

  it("an unreadable cancel whose ibExecID matches nothing: dropped alone, with the unreadable warning, never the 'outside this file' one", () => {
    const parsed = parseIbkrFlexXml(file([buy, sell, cancel("abc", "E9")]));
    expect(parsed.trades.map((t) => t.tradeID)).toEqual(["1", "2"]);
    const msgs = parsed.parserMessages?.map((m) => m.id) ?? [];
    expect(msgs).toContain("parser.cancelled_trades_unreadable");
    expect(msgs).not.toContain("parser.cancelled_trades_unmatched");
  });

  it("controls: a readable cancel still pairs with no ibExecID at all; another execution's sale is not taken by an unreadable cancel", () => {
    const noExec = (r: string): string => r.replace(/ ibExecID="[^"]*"/, "");
    expect(parseIbkrFlexXml(file([buy, noExec(sell), noExec(cancel("30"))])).trades.map((t) => t.tradeID)).toEqual(["1"]);
    expect(parseIbkrFlexXml(file([buy, noExec(sell), noExec(cancel("abc"))])).trades.map((t) => t.tradeID)).toEqual(["1", "2"]);
  });

  it("controls: two rows with no tradePrice and no ibExecID do not pair; a written tradePrice=\"0\" on both still does", () => {
    const noExec = (r: string): string => r.replace(/ ibExecID="[^"]*"/, "");
    const noPrice = (r: string): string => r.replace(/ tradePrice="[^"]*"/, "");
    const unpaired = parseIbkrFlexXml(file([buy, noPrice(noExec(sell)), noPrice(noExec(cancel("30")))]));
    expect(unpaired.trades.map((t) => t.tradeID)).toEqual(["1", "2"]);
    expect(unpaired.parserMessages?.map((m) => m.id)).toContain("parser.cancelled_trades_unreadable");
    const zero = (r: string): string => r.replace(/ tradePrice="[^"]*"/, ' tradePrice="0"');
    expect(parseIbkrFlexXml(file([buy, zero(noExec(sell)), zero(noExec(cancel("30")))])).trades.map((t) => t.tradeID)).toEqual(["1"]);
  });
});

describe("(m) a quantity-less crypto trade gets the crypto warning, not the 2-month one", () => {
  const cryptoTrade = (id: string, date: string, side: "BUY" | "SELL", qty: string | null, price: number): string => {
    const q = qty === null ? "" : ` quantity="${side === "BUY" ? qty : `-${qty}`}"`;
    const money = new Decimal(qty ?? "1").mul(price);
    return `<Trade tradeID="${id}" accountId="U1" symbol="BTC" description="Bitcoin" isin="" assetCategory="CRYPTO" currency="EUR" tradeDate="${date}" settlementDate="${date}"${q} tradePrice="${price}" tradeMoney="${side === "BUY" ? money : money.neg()}" proceeds="${side === "BUY" ? money.neg() : money}" cost="${money}" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}" exchange="PAXOS" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" multiplier="1" />`;
  };
  // Buy 1 BTC at 200 in 2024, sell it on 01/06/2025 at 100 (−100), rebuy on 01/07 with no quantity.
  const xml = (rebuy: string | null): string => `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20240101" toDate="20251231" period="Custom"><Trades>${[
    cryptoTrade("c1", "20240110", "BUY", "1", 200),
    cryptoTrade("c2", "20250601", "SELL", "1", 100),
    cryptoTrade("c3", "20250701", "BUY", rebuy, 100),
    `<Trade tradeID="s1" accountId="U1" symbol="XYZ" description="XYZ SA" conid="4531" isin="${ISIN}" assetCategory="STK" currency="EUR" tradeDate="20250801" settlementDate="20250801" tradePrice="10" tradeMoney="0" proceeds="0" cost="0" fifoPnlRealized="0" fxRateToBase="1" buySell="BUY" openCloseIndicator="O" exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" multiplier="1" />`,
  ].join("")}</Trades><CashTransactions /><CorporateActions /><SecuritiesInfo /></FlexStatement></FlexStatements></FlexQueryResponse>`;

  it("the parser splits the warning: the share row in the shared one, the coin in the crypto one, which names art. 33.5.e and no one-purchase exception", () => {
    const parsed = parseIbkrFlexXml(xml(null));
    const share = parsed.parserMessages?.find((m) => m.id === "parser.trade_quantity_unknown");
    const coin = parsed.parserMessages?.find((m) => m.id === "parser.crypto_quantity_unknown");
    expect(share?.context).toMatchObject({ broker: "IBKR", count: "1", trades: `XYZ (${ISIN}) 20250801` });
    expect(coin?.context).toMatchObject({ broker: "IBKR", count: "1", trades: "BTC 20250701" });
    expect(coin?.hint).toContain("33.5.e");
    expect(coin?.hint).not.toContain("compra única");
  });

  it.each(METHODS)("[%s] the report deducts the loss (no units to tie it to) and carries the crypto warning", (method) => {
    const r = mergedFiles([[IB, xml(null)]], method);
    expect(blockedOn(r, "2025-06-01")).toBe("0.00");
    expect(r.messages.some((m) => m.id === "parser.crypto_quantity_unknown")).toBe(true);
  });

  it("control: a readable rebuy of 1 coin blocks the 100 and gives no crypto warning", () => {
    const r = mergedFiles([[IB, xml("1")]]);
    expect(blockedOn(r, "2025-06-01")).toBe("100.00");
    expect(r.messages.some((m) => m.id === "parser.crypto_quantity_unknown")).toBe(false);
  });
});
