import { afterEach, describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { computeCasillaBlocksWithFx } from "../../src/generators/casillas.js";
import { formatCsv } from "../../src/generators/csv.js";
import { formatReport } from "../../src/cli/format-report.js";
import { renderOperationsAnnex } from "../../src/web/operations-annex.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
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

function xml(rows: string[], cash: string[] = [], actions: string[] = []): string {
  return `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20250101" toDate="20251231" period="Custom"><Trades>${rows.join("")}</Trades><CashTransactions>${cash.join("")}</CashTransactions><CorporateActions>${actions.join("")}</CorporateActions><OpenPositions /><SecuritiesInfo /></FlexStatement></FlexStatements></FlexQueryResponse>`;
}

function report(rows: string[], method: FxMethod = "multidivisa", cash: string[] = [], actions: string[] = []): TaxSummary {
  return generateTaxReport(parseIbkrFlexXml(xml(rows, cash, actions)), RATES, 2025, reportOptionsForMethod(method));
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
    for (const [quantity, amount] of [["-10", "1e2000"], ["-1e2000", "542"]] as const) {
      const r = report([trade("20250201", "BUY", "10", "40")], "multidivisa", [], [action("buyout", quantity, amount)]);
      expectBounded(r);
      expect(totals(r)).toEqual(["0", "0", "0"]);
      expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe("XYZ (01/04/2025)");
      expect(message(r, "report.non_finite_disposal")?.context?.rows).toContain("XYZ (01/04/2025)");
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
    for (const [field, cash, actions] of [
      ["a dividend", [dividend("D1", "20250315", huge)], []],
      ["a cash buyout amount", [], [action("buyout", "-10", huge)]],
    ] as const) {
      it(`${field} of ${huge}: the same`, () => {
        const started = Date.now();
        const r = report([trade("20250201", "BUY", "10", "10")], "multidivisa", [...cash], [...actions]);
        expectBounded(r);
        expect(message(r, "report.trade_out_of_range")).toBeDefined();
        expect(Date.now() - started).toBeLessThan(5_000);
      });
    }
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
