import { afterEach, describe, it, expect, vi } from "vitest";
import PDFDocument from "pdfkit";
import Decimal from "decimal.js";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { computeCasillaBlocksWithFx } from "../../src/generators/casillas.js";
import { formatCsv } from "../../src/generators/csv.js";
import { formatReport } from "../../src/cli/format-report.js";
import { generatePdfReport } from "../../src/generators/pdf.js";
import { generatePdfWebReport } from "../../src/generators/pdf-web.js";
import { renderOperationsAnnex } from "../../src/web/operations-annex.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { buildManualRateMap } from "../../src/engine/manual-rates.js";
import { FifoEngine } from "../../src/engine/fifo.js";
import { FxFifoEngine } from "../../src/engine/fx-fifo.js";
import { localizeHint, localizeMessage, setLocale } from "../../src/i18n/index.js";
import type { FxMethod, TaxSummary } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// A trade amount no real trade reaches is not counted, and nothing builds a
// huge string from it (CodeRabbit on #470, verify round on f378e5e).
//
// decimal.js reads "1e1000000000" as a finite number. An IBKR trade with that
// price, commission or quantity made the web annex and the CLI run out of
// memory (toFixed writes one character per digit), and at "1e2000" box 0331
// and ganancia_neta got a 2000-digit loss with no warning. Every case runs
// through the real IBKR parser and generateTaxReport, in the three methods.
// ===========================================================================

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];

const RATES: EcbRateMap = new Map();
for (let t = Date.UTC(2024, 0, 1); t <= Date.UTC(2026, 0, 31); t += 86_400_000) {
  RATES.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "1.10"]]));
}

let seq = 0;
function trade(date: string, side: "BUY" | "SELL", qty: string, price: string, extra: { commission?: string; currency?: string; symbol?: string } = {}): string {
  seq++;
  const currency = extra.currency ?? "USD";
  const symbol = extra.symbol ?? "XYZ";
  return `<Trade tradeID="${seq}" accountId="U1" symbol="${symbol}" description="${symbol} INC" conid="4531" isin="US0000004531" assetCategory="STK" currency="${currency}" tradeDate="${date}" settlementDate="${date}" quantity="${qty}" tradePrice="${price}" tradeMoney="0" proceeds="0" cost="0" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}" exchange="NASDAQ" ibCommissionCurrency="${currency}" ibCommission="${extra.commission ?? "0"}" taxes="0" multiplier="1" />`;
}

function xml(rows: string[], cash: string[] = [], actions: string[] = [], exercises: string[] = []): string {
  return `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20250101" toDate="20251231" period="Custom"><Trades>${rows.join("")}</Trades><OptionEAE>${exercises.join("")}</OptionEAE><CashTransactions>${cash.join("")}</CashTransactions><CorporateActions>${actions.join("")}</CorporateActions><OpenPositions /><SecuritiesInfo /></FlexStatement></FlexStatements></FlexQueryResponse>`;
}

function report(rows: string[], method: FxMethod = "multidivisa", cash: string[] = [], actions: string[] = [], exercises: string[] = []): TaxSummary {
  return generateTaxReport(parseIbkrFlexXml(xml(rows, cash, actions, exercises)), RATES, 2025, reportOptionsForMethod(method));
}

/** One XYZ option contract (100 shares, strike 20 USD): its purchase for 2 USD a share, and IBKR's own delivery row for an exercise. */
const OPTION = `symbol="XYZC20" description="XYZ 01JUN25 20 C" conid="999" isin="" assetCategory="OPT" currency="USD"`;
function optionBuy(putCall: "C" | "P" = "C"): string {
  return `<Trade tradeID="O1" accountId="U1" ${OPTION.replace("XYZC20", `XYZ${putCall}20`).replace("20 C", `20 ${putCall}`)} tradeDate="20250115" settlementDate="20250115" quantity="1" tradePrice="2" tradeMoney="200" proceeds="-200" cost="200" fifoPnlRealized="0" fxRateToBase="1" buySell="BUY" openCloseIndicator="O" exchange="CBOE" ibCommissionCurrency="USD" ibCommission="0" taxes="0" multiplier="100" underlyingSymbol="XYZ" underlyingSecurityID="US0000004531" strike="20" expiry="20250601" putCall="${putCall}" />`;
}
/** IBKR's delivery BookTrade of the 100 shares (notes "Ex"): FIFO skips it while an OptionEAE row delivers them. */
const DELIVERY = `<Trade tradeID="X1" accountId="U1" symbol="XYZ" description="XYZ INC" conid="4531" isin="US0000004531" assetCategory="STK" currency="USD" tradeDate="20250301" settlementDate="20250301" quantity="100" tradePrice="20" tradeMoney="2000" proceeds="-2000" cost="2000" fifoPnlRealized="0" fxRateToBase="1" buySell="BUY" openCloseIndicator="O" exchange="--" ibCommissionCurrency="USD" ibCommission="0" taxes="0" multiplier="1" notes="Ex" />`;

/** An OptionEAE row on XYZ: one contract, a multiplier of 100 and a strike of 20, unless a field says otherwise. */
function exercise(putCall: "C" | "P", type: "Exercise" | "Assignment", fields: { quantity?: string; multiplier?: string; strike?: string } = {}): string {
  return `<OptionEAE accountId="U1" currency="USD" assetCategory="OPT" symbol="XYZ${putCall}20" description="XYZ 01JUN25 20 ${putCall}" conid="999" isin="" underlyingSymbol="XYZ" underlyingSecurityID="US0000004531" multiplier="${fields.multiplier ?? "100"}" strike="${fields.strike ?? "20"}" expiry="20250601" putCall="${putCall}" date="20250301" transactionType="${type}" quantity="${fields.quantity ?? "-1"}" tradePrice="0" markPrice="26" proceeds="0" tradeID="E1" />`;
}

/** A scrip dividend of XYZ shares (IBKR type SD), on 1 January 2025. */
function scrip(quantity: string): string {
  return `<CorporateAction transactionID="SD1" accountId="U1" symbol="XYZ" isin="US0000004531" currency="USD" description="XYZ(US0000004531) STOCK DIVIDEND 1 FOR 10 (XYZ, XYZ INC, US0000004531)" reportDate="20250101" dateTime="20250101" quantity="${quantity}" amount="0" type="SD" actionDescription="" />`;
}

function interest(id: string, date: string, amount: string): string {
  return `<CashTransaction transactionID="${id}" accountId="U1" symbol="" description="USD CREDIT INT FOR FEB-2025" isin="" currency="USD" dateTime="${date}" settleDate="${date}" amount="${amount}" fxRateToBase="1" type="Broker Interest Received" />`;
}

/**
 * Both PDFs build, with no «NaN» cell and no run of 30 digits. The words
 * «(NaN o infinito)» of `report.non_finite_disposal` are no cell.
 */
const NAN_CELL = /\bNaN\b(?! o infinito)|\d{30}/;
async function expectPdfsBounded(r: TaxSummary): Promise<void> {
  const spy = vi.spyOn(PDFDocument.prototype, "text");
  try {
    await generatePdfReport(r);
    const printed = spy.mock.calls.map((args) => String(args[0])).join("\n");
    expect(printed).not.toMatch(NAN_CELL);
  } finally {
    spy.mockRestore();
  }
  const blob = await generatePdfWebReport(r, (key: string) => key);
  const text = new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer()));
  expect(text).not.toMatch(NAN_CELL);
}

function dividend(id: string, date: string, amount: string, type = "Dividends"): string {
  return `<CashTransaction transactionID="${id}" accountId="U1" symbol="XYZ" description="XYZ(US0000004531) Cash Dividend USD 0.50" isin="US0000004531" currency="USD" dateTime="${date}" settleDate="${date}" amount="${amount}" fxRateToBase="1" type="${type}" />`;
}

/** A corporate action on XYZ: a 3-for-1 split, or a cash buyout of the 10 shares for `amount` dollars. */
function action(kind: "split" | "buyout", quantity: string, amount: string): string {
  const description = kind === "split"
    ? "XYZ(US0000004531) SPLIT 3 FOR 1 (XYZ, XYZ INC, US0000004531)"
    : "XYZ(US0000004531) MERGED(Acquisition) FOR USD 54.20 PER SHARE (XYZ, XYZ INC, US0000004531)";
  return `<CorporateAction transactionID="CA1" accountId="U1" symbol="XYZ" isin="US0000004531" currency="USD" description="${description}" reportDate="20250401" dateTime="20250401" quantity="${quantity}" amount="${amount}" type="${kind === "split" ? "FS" : "TC"}" actionDescription="" />`;
}

function totals(r: TaxSummary): [string, string, string] {
  const cg = r.capitalGains;
  return [cg.transmissionValue.toString(), cg.acquisitionValue.toString(), cg.netGainLoss.toString()];
}

function message(r: TaxSummary, id: string) {
  return r.messages.find((m) => m.id === id);
}

/**
 * Every figure a box or the summary shows is a finite amount of at most 12
 * integer digits, and no output (CLI JSON, CSV, annex) holds a run of 30
 * digits or more.
 */
function expectBounded(r: TaxSummary): void {
  const blocks = computeCasillaBlocksWithFx(r);
  const figures = [
    r.capitalGains.transmissionValue, r.capitalGains.acquisitionValue, r.capitalGains.netGainLoss,
    r.capitalGains.blockedLosses, r.fxGains.transmissionValue, r.fxGains.acquisitionValue, r.fxGains.netGainLoss,
    blocks.listedShares.transmissionValue, blocks.listedShares.acquisitionValue, blocks.listedShares.netGainLoss,
    blocks.otherElements.transmissionValue, blocks.otherElements.acquisitionValue, blocks.otherElements.netGainLoss,
  ];
  for (const f of figures) {
    expect(f.isFinite()).toBe(true);
    expect(f.abs().lessThan("1e12")).toBe(true);
  }
  expect(r.messages.map((m) => m.id)).not.toContain("report.non_finite_total");
  for (const text of [JSON.stringify(formatReport(r)), formatCsv(r), renderOperationsAnnex(r)]) {
    expect(text).not.toMatch(/\d{30}/);
    expect(text.length).toBeLessThan(100_000);
  }
}

describe("a trade number no broker writes is named and not counted", () => {
  afterEach(async () => {
    await setLocale("es");
  });

  for (const method of METHODS) {
    it(`a buy price of 1e2000: the sale's cost is not counted (132 / 0 / 132), never a 2000-digit loss (${method})`, () => {
      const r = report([trade("20250201", "BUY", "10", "1e2000"), trade("20250601", "SELL", "-10", "12")], method);
      expectBounded(r);
      expect(totals(r)).toEqual(["132", "0", "132"]);
      const msg = message(r, "report.trade_out_of_range");
      expect(msg?.severity).toBe("error");
      expect(msg?.context).toMatchObject({ count: "1", rows: "XYZ (01/02/2025)" });
      // The sale whose cost is left out is named too, as with any amount the boxes leave out.
      expect(message(r, "report.non_finite_disposal")?.context?.rows).toBe("XYZ (01/06/2025)");
    });

    it(`a commission of 1e2000 on the buy: the same (${method})`, () => {
      const r = report([trade("20250201", "BUY", "10", "10", { commission: "-1e2000" }), trade("20250601", "SELL", "-10", "12")], method);
      expectBounded(r);
      expect(totals(r)).toEqual(["132", "0", "132"]);
      expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe("XYZ (01/02/2025)");
    });

    it(`a sale price of 1e2000: that sale is left out, and it still takes its own lot (${method})`, () => {
      const r = report([
        trade("20250201", "BUY", "10", "10"),
        trade("20250301", "BUY", "10", "20"),
        trade("20250601", "SELL", "-10", "1e2000"),
        trade("20250701", "SELL", "-10", "30"),
      ], method);
      expectBounded(r);
      // The July sale takes the March lot (cost 200 USD), never the February
      // one the June sale already took: 330 / 220 / 110.
      expect(totals(r)).toEqual(["330", "220", "110"]);
      expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe("XYZ (01/06/2025)");
    });

    it(`a sale price of 1e-2000 is no price a broker writes either (${method})`, () => {
      const r = report([trade("20250201", "BUY", "10", "10"), trade("20250601", "SELL", "-10", "1e-2000")], method);
      expectBounded(r);
      expect(totals(r)).toEqual(["0", "0", "0"]);
      expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe("XYZ (01/06/2025)");
    });

    it(`a buy of 1e2000 shares books no lot: the sale has no lot and a cost of 0 (${method})`, () => {
      const r = report([trade("20250201", "BUY", "1e2000", "10"), trade("20250601", "SELL", "-10", "12")], method);
      expectBounded(r);
      expect(totals(r)).toEqual(["132", "0", "132"]);
      expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe("XYZ (01/02/2025)");
      expect(r.messages.map((m) => m.id)).toContain("fifo.sell_without_lots");
    });

    it(`a cost past 12 integer digits of euros is not counted, and the sale is named (${method})`, () => {
      const r = report([trade("20250201", "BUY", "10", "1e14", { currency: "EUR" }), trade("20250601", "SELL", "-10", "12", { currency: "EUR" })], method);
      expectBounded(r);
      expect(totals(r)).toEqual(["120", "0", "120"]);
      expect(message(r, "report.trade_out_of_range")).toBeUndefined();
      expect(message(r, "report.non_finite_disposal")?.context?.rows).toBe("XYZ (01/06/2025)");
    });

    it(`proceeds past 12 integer digits of euros leave that sale out, its cost too (${method})`, () => {
      const r = report([trade("20250201", "BUY", "10", "10", { currency: "EUR" }), trade("20250601", "SELL", "-10", "1e14", { currency: "EUR" })], method);
      expectBounded(r);
      expect(totals(r)).toEqual(["0", "0", "0"]);
      expect(message(r, "report.non_finite_disposal")?.context?.rows).toBe("XYZ (01/06/2025)");
    });
  }

  it("12 integer digits of euros still count in full (999.999.999.999,99 €)", () => {
    const r = report([trade("20250201", "BUY", "1", "999999999999.99", { currency: "EUR" }), trade("20250601", "SELL", "-1", "999999999999.99", { currency: "EUR" })]);
    expect(totals(r)).toEqual(["999999999999.99", "999999999999.99", "0"]);
    expect(message(r, "report.non_finite_disposal")).toBeUndefined();
    expect(message(r, "report.trade_out_of_range")).toBeUndefined();
  });

  it("a repurchase with a price of 1e2000 still blocks the loss (anti-churning reads every trade)", () => {
    const rows = (price: string) => [
      trade("20250301", "BUY", "10", "10", { currency: "EUR" }),
      trade("20250315", "SELL", "-10", "8", { currency: "EUR" }),
      trade("20250320", "BUY", "10", price, { currency: "EUR" }),
    ];
    const control = report(rows("9"), "monodivisa");
    const variant = report(rows("1e2000"), "monodivisa");
    expect(control.capitalGains.blockedLosses.toString()).toBe("20");
    expect(variant.capitalGains.blockedLosses.toString()).toBe("20");
    expectBounded(variant);
  });

  it("a loss past 12 integer digits of euros blocks nothing: the boxes do not count it", () => {
    const r = report([
      trade("20250301", "BUY", "10", "1e14", { currency: "EUR" }),
      trade("20250315", "SELL", "-10", "8", { currency: "EUR" }),
      trade("20250320", "BUY", "10", "9", { currency: "EUR" }),
    ], "monodivisa");
    expectBounded(r);
    expect(r.capitalGains.blockedLosses.toString()).toBe("0");
    expect(totals(r)).toEqual(["80", "0", "80"]);
  });

  // The sale of a lot with no cost, or a sale whose proceeds are no number,
  // reaches the currency engine from FIFO's disposals: a NaN there would
  // poison the dollar pool and every later conversion.
  it("the dollars of such a sale never poison a later conversion to euros", () => {
    const conv = (id: string, date: string, side: "BUY" | "SELL", usd: string) =>
      `<Trade tradeID="${id}" accountId="U1" symbol="EUR.USD" description="EUR.USD" isin="" assetCategory="CASH" currency="USD" tradeDate="${date}" settlementDate="${date}" quantity="${usd}" tradePrice="1" tradeMoney="${usd}" proceeds="${usd}" cost="${usd}" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="O" exchange="IDEALFX" ibCommissionCurrency="USD" ibCommission="0" taxes="0" multiplier="1" />`;
    for (const [label, buyPrice, sellPrice] of [["buy", "1e2000", "12"], ["sale", "10", "1e2000"]] as const) {
      for (const method of METHODS) {
        const r = report([
          conv("C1", "20250110", "SELL", "1000"),
          trade("20250201", "BUY", "10", buyPrice),
          trade("20250601", "SELL", "-10", sellPrice),
          conv("C2", "20250701", "BUY", "500"),
        ], method);
        expectBounded(r);
        expect(message(r, "report.trade_out_of_range"), `${label} ${method}`).toBeDefined();
        for (const d of r.fxGains.disposals) {
          expect(d.proceedsEur.isFinite() && d.costBasisEur.isFinite(), `${label} ${method}`).toBe(true);
        }
      }
    }
  });

  // The report hands FIFO such a trade with a price that is no number, so a
  // disposal can carry a NaN cost or NaN proceeds. The currency producer
  // never passes a NaN on: proceeds that are no number bring in no currency,
  // and a cost that is no number parked nothing.
  it("the currency producer of stock sales never emits a NaN amount", () => {
    const st = parseIbkrFlexXml(xml([
      trade("20250201", "BUY", "10", "10"),
      trade("20250301", "BUY", "10", "1e2000"),
      trade("20250601", "SELL", "-10", "1e2000"),
      trade("20250701", "SELL", "-10", "12"),
    ]));
    const fifoTrades = st.trades.map((tr) => (tr.tradePrice === "1e2000" ? { ...tr, tradePrice: "NaN", tradeMoney: "NaN" } : tr));
    const engine = new FifoEngine({ markLotCurrency: true });
    engine.processTrades(fifoTrades, RATES);
    for (const traditionalFx of [false, true]) {
      const events = FxFifoEngine.extractStockProceedsFxEvents(engine.getDisposals(), { traditionalFx });
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect((e.costFcy?.isFinite() ?? true) && (e.proceedsFcy?.isFinite() ?? true)).toBe(true);
      }
    }
  });

  it("a currency conversion of 1e2000 dollars is named and books no currency", () => {
    const conversion = `<Trade tradeID="FX1" accountId="U1" symbol="EUR.USD" description="EUR.USD" isin="" assetCategory="CASH" currency="USD" tradeDate="20250301" settlementDate="20250301" quantity="1e2000" tradePrice="1.10" tradeMoney="1.1e2000" proceeds="0" cost="0" fifoPnlRealized="0" fxRateToBase="1" buySell="SELL" openCloseIndicator="" exchange="IDEALFX" ibCommissionCurrency="USD" ibCommission="0" taxes="0" multiplier="1" />`;
    for (const method of METHODS) {
      const r = report([conversion, trade("20250201", "BUY", "10", "10"), trade("20250601", "SELL", "-10", "12")], method);
      expectBounded(r);
      expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe("EUR.USD (01/03/2025)");
    }
  });

  it("a dividend of 1e2000 is named and left out; the other dividend still counts", () => {
    const r = report([], "multidivisa", [dividend("D1", "20250315", "1e2000"), dividend("D2", "20250615", "50")]);
    expectBounded(r);
    expect(r.dividends.grossIncome.toString()).toBe("55");
    expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe("XYZ (15/03/2025)");
  });

  it("a withholding of -1e2000 is named and left out (no deduction from it)", () => {
    const r = report([], "multidivisa", [dividend("D1", "20250315", "50"), dividend("W1", "20250315", "-1e2000", "Withholding Tax")]);
    expectBounded(r);
    expect(r.dividends.grossIncome.toString()).toBe("55");
    expect(r.doubleTaxation.deduction.toString()).toBe("0");
    expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe("XYZ (15/03/2025)");
  });

  it("a cash buyout of 1e2000 dollars: its sale takes the shares and is left out, and the action is named", () => {
    const r = report([trade("20250201", "BUY", "10", "40")], "multidivisa", [], [action("buyout", "-10", "1e2000")]);
    expectBounded(r);
    expect(totals(r)).toEqual(["0", "0", "0"]);
    expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe("XYZ (01/04/2025)");
    expect(message(r, "report.non_finite_disposal")?.context?.rows).toContain("XYZ (01/04/2025)");
  });

  it("a cash buyout of -1e2000 shares sells nothing: the shares stay for the next sale, and the action is named", () => {
    // Before, it booked a sale of 1e2000 shares (with -1e1000000000 the web
    // PDF ran out of memory writing them). The quantity "0" moves no share.
    for (const method of METHODS) {
      const rows = [trade("20250201", "BUY", "10", "40"), trade("20250701", "SELL", "-10", "50")];
      const control = report(rows, method);
      const r = report(rows, method, [], [action("buyout", "-1e2000", "542")]);
      expectBounded(r);
      expect(r.capitalGains.disposals).toHaveLength(1);
      expect(totals(r)).toEqual(totals(control));
      expect(totals(r)).toEqual(["550", "440", "110"]);
      expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe("XYZ (01/04/2025)");
      expect(message(r, "report.non_finite_disposal")).toBeUndefined();
    }
  });

  it("a scrip dividend of 1e2000 shares books no lot, so the next sale takes the shares bought", () => {
    const rows = [trade("20250201", "BUY", "10", "40"), trade("20250601", "SELL", "-10", "50")];
    for (const method of METHODS) {
      const r = report(rows, method, [], [scrip("1e2000")]);
      expectBounded(r);
      expect(totals(r)).toEqual(totals(report(rows, method)));
      expect(totals(r)).toEqual(["550", "440", "110"]);
      expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe("XYZ (01/01/2025)");
    }
  });

  it("a split with a quantity of 1e2000 still splits by its own ratio (10 shares become 30), and is named", () => {
    const rows = [trade("20250201", "BUY", "10", "40"), trade("20250601", "SELL", "-10", "20")];
    const control = report(rows, "monodivisa", [], [action("split", "20", "0")]);
    const r = report(rows, "monodivisa", [], [action("split", "1e2000", "0")]);
    expectBounded(r);
    expect(totals(r)).toEqual(totals(control));
    expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe("XYZ (01/04/2025)");
  });

  it("an option exercise with a multiplier of 1e2000 books nothing and is named, never a lot of 1e2002 shares", () => {
    // Control: the exercise in range adds the premium to the shares' cost,
    // (2000 + 200) × 1.10 = 2420. IBKR's own delivery row stays skipped.
    const rows = [optionBuy(), DELIVERY, trade("20250601", "SELL", "-100", "30")];
    for (const method of METHODS) {
      const control = report(rows, method, [], [], [exercise("C", "Exercise")]);
      expect(totals(control)).toEqual(["3300", "2420", "880"]);
      expect(message(control, "report.trade_out_of_range")).toBeUndefined();
      // Out of range: no shares arrive, so the sale has no lot and a cost of 0
      // (the user may overpay, never underpay). Before, it booked 1e2002
      // shares at a cost with no premium, and said nothing.
      for (const multiplier of ["1e2000", "1" + "0".repeat(2000)]) {
        const r = report(rows, method, [], [], [exercise("C", "Exercise", { multiplier })]);
        expectBounded(r);
        expect(totals(r)).toEqual(["3300", "0", "3300"]);
        expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe("XYZC20 (01/03/2025)");
      }
    }
  });

  for (const [label, putCall, type, fields] of [
    ["a put exercise of -1e2000 contracts", "P", "Exercise", { quantity: "-1e2000" }],
    ["a call assignment of 1e2000 contracts", "C", "Assignment", { quantity: "1e2000" }],
    ["a put exercise with a 2001-digit strike", "P", "Exercise", { strike: "1" + "0".repeat(2000) }],
    ["a put exercise with a strike of 1e2000", "P", "Exercise", { strike: "1e2000" }],
    ["a put exercise of 1e19 contracts (1e21 shares)", "P", "Exercise", { quantity: "-1e19" }],
    ["a put exercise of 1e19 contracts at a strike of 0.01 (1e21 shares worth 1e19)", "P", "Exercise", { quantity: "-1e19", strike: "0.01" }],
  ] as const) {
    it(`${label} sells no share and is named`, () => {
      const rows = [trade("20250115", "BUY", "100", "10"), trade("20250701", "SELL", "-100", "12")];
      for (const method of METHODS) {
        const r = report(rows, method, [], [], [exercise(putCall, type, fields)]);
        expectBounded(r);
        // The shares stay for the July sale, as with no exercise at all.
        expect(totals(r)).toEqual(totals(report(rows, method)));
        expect(totals(r)).toEqual(["1320", "1100", "220"]);
        expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe(`XYZ${putCall}20 (01/03/2025)`);
        expect(message(r, "report.non_finite_disposal")).toBeUndefined();
      }
    });
  }

  it("a put exercise in range still sells the shares at the strike (control)", () => {
    const r = report([trade("20250115", "BUY", "100", "10")], "monodivisa", [], [], [exercise("P", "Exercise")]);
    expect(totals(r)).toEqual(["2200", "1100", "1100"]);
    expect(message(r, "report.trade_out_of_range")).toBeUndefined();
  });

  for (const method of METHODS) {
    it(`a dividend of -9e15 dollars is named and left out of box 0029, never -9,900,000,000,000,000 € (${method})`, () => {
      const r = report([], method, [dividend("D1", "20250315", "-9e15"), dividend("D2", "20250615", "50")]);
      expectBounded(r);
      expect(r.dividends.grossIncome.toString()).toBe("55");
      const msg = message(r, "report.cash_amount_too_large");
      expect(msg?.severity).toBe("error");
      expect(msg?.context).toMatchObject({ count: "1", rows: "XYZ (15/03/2025)" });
      // Named once, by its own message: no currency row stands in for it.
      expect(r.messages.filter((m) => m.severity === "error").map((m) => m.id)).toEqual(["report.cash_amount_too_large"]);
    });

    it(`interest of 9e15 and -9e19 dollars is named and left out of box 0027 (${method})`, () => {
      const r = report([], method, [interest("I1", "20250301", "9e15"), interest("I2", "20250401", "-9e19"), interest("I3", "20250501", "10")]);
      expectBounded(r);
      expect(r.interest.earned.toString()).toBe("11");
      expect(message(r, "report.cash_amount_too_large")?.context).toMatchObject({ count: "2" });
    });
  }

  it("a withholding of -9e15 dollars is named and gives no deduction", () => {
    const r = report([], "multidivisa", [dividend("D1", "20250315", "50"), dividend("W1", "20250315", "-9e15", "Withholding Tax")]);
    expectBounded(r);
    expect(r.dividends.grossIncome.toString()).toBe("55");
    expect(r.doubleTaxation.deduction.toString()).toBe("0");
    expect(message(r, "report.cash_amount_too_large")?.context?.rows).toBe("XYZ (15/03/2025)");
  });

  it("a dividend worth 999.999.999.999,99 € still counts; 1.000.000.000.000,10 € is named", () => {
    const counted = report([], "monodivisa", [dividend("D1", "20250315", "909090909090.9")]);
    expect(counted.dividends.grossIncome.toString()).toBe("999999999999.99");
    expect(message(counted, "report.cash_amount_too_large")).toBeUndefined();
    const named = report([], "monodivisa", [dividend("D1", "20250315", "909090909091")]);
    expect(named.dividends.grossIncome.toString()).toBe("0");
    expect(message(named, "report.cash_amount_too_large")?.context?.rows).toBe("XYZ (15/03/2025)");
  });

  it("names the cash rows worth 1e12 € or more in the 5 locales", async () => {
    const r = report([], "monodivisa", [dividend("D1", "20250315", "-9e15")]);
    const m = message(r, "report.cash_amount_too_large")!;
    expect(localizeMessage(m)).toBe(m.message);
    expect(localizeHint(m)).toBe(m.hint);
    for (const locale of ["en", "ca", "eu", "gl"] as const) {
      await setLocale(locale);
      expect(localizeMessage(m)).not.toBe(m.message);
      expect(localizeHint(m)).not.toBe(m.hint);
      expect(localizeMessage(m)).toContain("XYZ (15/03/2025)");
      expect(localizeMessage(m)).not.toContain("{{");
    }
  });

  it("names the rows in the 5 locales", async () => {
    const r = report([trade("20250201", "BUY", "10", "1e2000"), trade("20250601", "SELL", "-10", "12")]);
    const m = message(r, "report.trade_out_of_range")!;
    expect(localizeMessage(m)).toBe(m.message);
    expect(localizeHint(m)).toBe(m.hint);
    for (const locale of ["en", "ca", "eu", "gl"] as const) {
      await setLocale(locale);
      expect(localizeMessage(m)).not.toBe(m.message);
      expect(localizeHint(m)).not.toBe(m.hint);
      expect(localizeMessage(m)).toContain("XYZ (01/02/2025)");
      expect(localizeMessage(m)).not.toContain("{{");
    }
  });

  // The memory case. A red run on unfixed code must use
  // TRADE_HUGE_CASES=1e100000: the billion-digit case kills the worker.
  const hugeCases = (process.env.TRADE_HUGE_CASES ?? "1e100000,1e1000000000").split(",");
  for (const huge of hugeCases) {
    for (const [field, rows] of [
      ["the buy price", () => [trade("20250201", "BUY", "10", huge), trade("20250601", "SELL", "-10", "12")]],
      ["the buy commission", () => [trade("20250201", "BUY", "10", "10", { commission: `-${huge}` }), trade("20250601", "SELL", "-10", "12")]],
      ["the buy quantity", () => [trade("20250201", "BUY", huge, "10"), trade("20250601", "SELL", "-10", "12")]],
      ["the sale price", () => [trade("20250201", "BUY", "10", "10"), trade("20250601", "SELL", "-10", huge)]],
    ] as const) {
      it(`${field} of ${huge}: the report, the CLI JSON, the CSV and the annex finish with short output`, () => {
        const started = Date.now();
        const r = report(rows());
        expectBounded(r);
        expect(message(r, "report.trade_out_of_range")).toBeDefined();
        expect(Date.now() - started).toBeLessThan(5_000);
      });
    }
    for (const [field, cash, actions, exercises] of [
      ["a dividend", [dividend("D1", "20250315", huge)], [], []],
      ["a cash buyout amount", [], [action("buyout", "-10", huge)], []],
      ["a cash buyout quantity", [], [action("buyout", `-${huge}`, "542")], []],
      ["a scrip dividend quantity", [], [scrip(huge)], []],
      ["a put exercise quantity", [], [], [exercise("P", "Exercise", { quantity: `-${huge}` })]],
      ["a call assignment quantity", [], [], [exercise("C", "Assignment", { quantity: huge })]],
      ["a put exercise multiplier", [], [], [exercise("P", "Exercise", { multiplier: huge })]],
    ] as const) {
      it(`${field} of ${huge}: the same, and both PDFs`, async () => {
        const started = Date.now();
        const r = report([trade("20250115", "BUY", "100", "10"), trade("20250701", "SELL", "-100", "12")], "multidivisa", [...cash], [...actions], [...exercises]);
        expectBounded(r);
        await expectPdfsBounded(r);
        expect(message(r, "report.trade_out_of_range")).toBeDefined();
        expect(Date.now() - started).toBeLessThan(10_000);
      });
    }
  }
});

describe("a hand-typed number no price reaches is not used (#470)", () => {
  function crypto(side: "BUY" | "SELL", date: string, qty: string): string {
    return `<Trade tradeID="${date}" accountId="U1" symbol="BTC" description="BITCOIN" conid="4531" isin="" assetCategory="CRYPTO" currency="SOL" tradeDate="${date}" settlementDate="${date}" quantity="${qty}" tradePrice="10" tradeMoney="0" proceeds="0" cost="0" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}" exchange="PAXOS" ibCommissionCurrency="SOL" ibCommission="0" taxes="0" multiplier="1" />`;
  }
  const statement = () => parseIbkrFlexXml(xml([crypto("BUY", "20250115", "10"), crypto("SELL", "20250601", "-10")]));

  it("a manual rate of 150 values the sale (control)", () => {
    const manualRates = buildManualRateMap([
      { currency: "SOL", date: "2025-01-15", eurPerUnit: "150" },
      { currency: "SOL", date: "2025-06-01", eurPerUnit: "180" },
    ]);
    const r = generateTaxReport(statement(), RATES, 2025, { ...reportOptionsForMethod("multidivisa"), manualRates });
    expect(totals(r)).toEqual(["18000", "15000", "3000"]);
  });

  it("a manual opening lot at 40 dollars gives the sale its cost (control)", () => {
    const r = generateTaxReport(parseIbkrFlexXml(xml([trade("20250601", "SELL", "-10", "12")])), RATES, 2025, {
      ...reportOptionsForMethod("multidivisa"),
      manualOpeningLots: [{
        symbol: "XYZ", description: "XYZ INC", isin: "US0000004531", assetCategory: "STK",
        currency: "USD", acquireDate: "2024-01-10", quantity: "10", pricePerShare: "40",
      }],
    });
    expect(totals(r)).toEqual(["132", "440", "-308"]);
  });

  // A red run on unfixed code must use TRADE_HUGE_CASES=1e100000.
  for (const huge of (process.env.TRADE_HUGE_CASES ?? "1e100000,1e1000000000").split(",")) {
    it(`a manual rate of ${huge} is left out: the sale is named as unvalued, and the outputs stay short`, () => {
      const started = Date.now();
      const manualRates = buildManualRateMap([
        { currency: "SOL", date: "2025-01-15", eurPerUnit: "150" },
        { currency: "SOL", date: "2025-06-01", eurPerUnit: huge },
      ]);
      const r = generateTaxReport(statement(), RATES, 2025, { ...reportOptionsForMethod("multidivisa"), manualRates });
      expectBounded(r);
      expect(totals(r)).toEqual(["0", "0", "0"]);
      expect(message(r, "report.crypto_valuation_unresolved")).toBeDefined();
      expect(Date.now() - started).toBeLessThan(5_000);
    });

    it(`a manual opening lot priced at ${huge} is no lot: the sale has no cost, never a huge one`, () => {
      const started = Date.now();
      const r = generateTaxReport(parseIbkrFlexXml(xml([trade("20250601", "SELL", "-10", "12")])), RATES, 2025, {
        ...reportOptionsForMethod("multidivisa"),
        manualOpeningLots: [{
          symbol: "XYZ", description: "XYZ INC", isin: "US0000004531", assetCategory: "STK",
          currency: "USD", acquireDate: "2024-01-10", quantity: "10", pricePerShare: huge,
        }],
      });
      expectBounded(r);
      expect(totals(r)).toEqual(["132", "0", "132"]);
      expect(Date.now() - started).toBeLessThan(5_000);
    });
  }
});

describe("isCountableAmount boundary", () => {
  it("counts 999.999.999.999,99 € and refuses 1.000.000.000.000 €", async () => {
    const { isCountableAmount } = await import("../../src/engine/amount-range.js");
    expect(isCountableAmount(new Decimal("999999999999.99"))).toBe(true);
    expect(isCountableAmount(new Decimal("-999999999999.994"))).toBe(true);
    expect(isCountableAmount(new Decimal("999999999999.995"))).toBe(false);
    expect(isCountableAmount(new Decimal("1e12"))).toBe(false);
    expect(isCountableAmount(new Decimal(NaN))).toBe(false);
  });
});
