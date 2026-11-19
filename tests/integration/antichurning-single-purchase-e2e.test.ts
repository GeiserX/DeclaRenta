import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { degiroParser } from "../../src/parsers/degiro.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { FxMethod, TaxSummary as TaxReport } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

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
function tradeXml([date, side, qty, price, extra = "", oci]: Row, currency: string, isin = ISIN): string {
  const signed = side === "BUY" ? qty : -qty;
  const money = new Decimal(qty).mul(price);
  tradeSeq++;
  return `<Trade tradeID="${tradeSeq}" accountId="U1" symbol="XYZ" description="XYZ SA" conid="4531" isin="${isin}" assetCategory="STK" currency="${currency}" tradeDate="${date}" settlementDate="${date}" quantity="${signed}" tradePrice="${price}" tradeMoney="${side === "BUY" ? money : money.neg()}" proceeds="${side === "BUY" ? money.neg() : money}" cost="${money}" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${oci ?? (side === "BUY" ? "O" : "C")}" exchange="BME" ibCommissionCurrency="${currency}" ibCommission="0" taxes="0" multiplier="1" ${extra} />`;
}

function openPositionXml(isin: string, quantity: number | string, currency: string): string {
  return `<OpenPosition accountId="U1" symbol="XYZ" description="XYZ SA" isin="${isin}" currency="${currency}" assetCategory="STK" quantity="${quantity}" costBasisMoney="0" costBasisPrice="0" markPrice="10" positionValue="0" fifoPnlUnrealized="0" fxRateToBase="1" />`;
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
  const op = [...listed, ...otherPositions].map(([i, q]) => openPositionXml(i, q, currency)).join("");
  return `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="${fromDate}" toDate="${toDate}" period="Custom"><Trades>${rows
    .map((r) => tradeXml(r, currency, isin))
    .join("")}</Trades><CashTransactions /><CorporateActions>${actions}</CorporateActions><OpenPositions>${op}</OpenPositions><SecuritiesInfo /></FlexStatement></FlexStatements></FlexQueryResponse>`;
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

  it("shares moved between two uploaded brokers cancel out (bought at one, sold at the other): applied", () => {
    // IBKR keeps nothing of XYZ (it lists another security); the 50 it moved to
    // Otro bróker are sold there. Held before the files: (0 − 50) + (0 + 50) = 0.
    const r = merged([
      ["Interactive Brokers", ibkrXml(rows, { fromDate: "20250101", positions: [], otherPositions: [["ES0000000002", 5]] })],
      [
        "Otro bróker",
        ibkrXml([["20250701", "SELL", 50, 10]], { fromDate: "20250101", positions: [], otherPositions: [["ES0000000003", 5]] }),
      ],
    ]);
    expect(blockedOn(r, "2025-06-01")).toBe("0.00");
    expect(ids(r)).toEqual([APPLIED]);
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

describe("(d) a manual opening lot explains the holdings it adds", () => {
  it("the purchase is a manual opening lot and the file lists the 50 left: applied", () => {
    // The file shows only the sale; the manual lot of 100 on 01/03 is the one
    // purchase. Held before the files: (50 listed + 50 sold) − 100 manual = 0.
    const xml = ibkrXml([["20250315", "SELL", 50, 8]], { positions: [[ISIN, 50]] });
    const statement = finalizeMergedStatement(mergeStatement(createEmptyStatement(), parseIbkrFlexXml(xml), "Interactive Brokers"));
    const r = generateTaxReport(statement, rates(), 2025, {
      ...reportOptionsForMethod("monodivisa"),
      manualOpeningLots: [
        { symbol: "XYZ", description: "XYZ SA", isin: ISIN, assetCategory: "STK", currency: "EUR", acquireDate: "2025-03-01", quantity: "100", pricePerShare: "10" },
      ],
    });
    expect(blockedOn(r, "2025-03-15")).toBe("0.00");
    expect(ids(r)).toEqual([APPLIED]);
  });
});

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
