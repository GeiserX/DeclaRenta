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

/** [date YYYYMMDD, side, quantity, price, extra XML attributes] */
type Row = [date: string, side: "BUY" | "SELL", qty: number, price: number, extra?: string];

let tradeSeq = 0;
function tradeXml([date, side, qty, price, extra = ""]: Row, currency: string, isin = ISIN): string {
  const signed = side === "BUY" ? qty : -qty;
  const money = new Decimal(qty).mul(price);
  tradeSeq++;
  return `<Trade tradeID="${tradeSeq}" accountId="U1" symbol="XYZ" description="XYZ SA" conid="4531" isin="${isin}" assetCategory="STK" currency="${currency}" tradeDate="${date}" settlementDate="${date}" quantity="${signed}" tradePrice="${price}" tradeMoney="${side === "BUY" ? money : money.neg()}" proceeds="${side === "BUY" ? money.neg() : money}" cost="${money}" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}" exchange="BME" ibCommissionCurrency="${currency}" ibCommission="0" taxes="0" multiplier="1" ${extra} />`;
}

function ibkrXml(rows: Row[], { fromDate = "20240101", toDate = "20251231", currency = "EUR", isin = ISIN, actions = "" } = {}): string {
  return `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="${fromDate}" toDate="${toDate}" period="Custom"><Trades>${rows
    .map((r) => tradeXml(r, currency, isin))
    .join("")}</Trades><CashTransactions /><CorporateActions>${actions}</CorporateActions><OpenPositions /><SecuritiesInfo /></FlexStatement></FlexStatements></FlexQueryResponse>`;
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

  it("DEGIRO: two fills with one «ID Orden» are one purchase", () => {
    const r = degiro([
      '01-03-2025,10:00,XYZ SA,ES0000004531,MAD,XMAD,60,"10,00",EUR,"-600,00",EUR,"0,00",EUR,"-600,00",EUR,aaa-111',
      '01-03-2025,10:00,XYZ SA,ES0000004531,MAD,XMAD,40,"10,00",EUR,"-400,00",EUR,"0,00",EUR,"-400,00",EUR,aaa-111',
      '15-03-2025,10:00,XYZ SA,ES0000004531,MAD,XMAD,-50,"8,00",EUR,"400,00",EUR,"0,00",EUR,"400,00",EUR,bbb-222',
    ]);
    expect(blockedOn(r, "2025-03-15")).toBe("0.00");
  });

  it("DEGIRO: two orders on the same day are two purchases", () => {
    const r = degiro([
      '01-03-2025,10:00,XYZ SA,ES0000004531,MAD,XMAD,60,"10,00",EUR,"-600,00",EUR,"0,00",EUR,"-600,00",EUR,aaa-111',
      '01-03-2025,11:00,XYZ SA,ES0000004531,MAD,XMAD,40,"10,00",EUR,"-400,00",EUR,"0,00",EUR,"-400,00",EUR,ccc-333',
      '15-03-2025,10:00,XYZ SA,ES0000004531,MAD,XMAD,-50,"8,00",EUR,"400,00",EUR,"0,00",EUR,"400,00",EUR,bbb-222',
    ]);
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
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

  it("a later sale of more shares than the upload shows (held from before it): never applied", () => {
    const r = run(ibkrXml([...issue, ["20251201", "SELL", 150, 10]], { fromDate: "20250101" }), 2025);
    expect(blockedOn(r, "2025-03-15")).toBe("100.00");
    expect(r.capitalGains.disposals.find((d) => sameDay(d.sellDate, "2025-03-15"))!.washSaleSinglePurchase).toBeUndefined();
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
