// @vitest-environment jsdom
/**
 * Every output that lists the sales one by one shows each amount as the boxes
 * count it, like the annex and the web views (#469, #470): the CLI JSON
 * (`operaciones`, `operaciones_fx`), the CSV, the PDF of the CLI (pdfkit) and
 * the web PDF (jsPDF), and the 1633/1637 drill-down of the currency rows.
 * They printed the raw amounts, so a sale whose buy has a price no broker
 * writes showed "coste_eur":"NaN" and the CSV row 10,NaN,…; a cost of
 * 1.1e13 € was printed in full though the boxes leave it out.
 *
 * The data goes through the real IBKR parser and generateTaxReport. An
 * amount the boxes leave out is null in the JSON, an empty cell in the CSV
 * and «—» in both PDFs, so each column adds up to its box.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import Decimal from "decimal.js";
import PDFDocument from "pdfkit";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { computeCasillaBlocksWithFx } from "../../src/generators/casillas.js";
import { formatReport } from "../../src/cli/format-report.js";
import { formatCsv } from "../../src/generators/csv.js";
import { generatePdfReport } from "../../src/generators/pdf.js";
import { generatePdfWebReport } from "../../src/generators/pdf-web.js";
import { renderCasillaCards } from "../../src/web/casilla-detail.js";
import { t } from "../../src/i18n/index.js";
import type { TaxSummary } from "../../src/types/tax.js";

function trade(id: string, side: "BUY" | "SELL", date: string, qty: string, price: string): string {
  return `<Trade tradeID="${id}" accountId="U0000001" symbol="ACME" description="ACME CORP"
    isin="XX0000000001" assetCategory="STK" currency="EUR" tradeDate="${date}" settlementDate="${date}"
    quantity="${qty}" tradePrice="${price}" tradeMoney="0" proceeds="0" cost="0" fifoPnlRealized="0"
    fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}"
    exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />`;
}

function report(rows: string[]): TaxSummary {
  const file = `<FlexQueryResponse queryName="Test" type="AF"><FlexStatements count="1">
  <FlexStatement accountId="U0000001" fromDate="20250101" toDate="20251231" period="LastYear">
    <Trades>${rows.join("")}</Trades><CashTransactions /><CorporateActions /><OpenPositions />
  </FlexStatement></FlexStatements></FlexQueryResponse>`;
  return generateTaxReport(parseIbkrFlexXml(file), new Map(), 2025);
}

/** A sale the boxes count in full: 10 ACME bought at 10 €, sold at 13 €. */
const GOOD = [trade("10", "BUY", "20250110", "10", "10"), trade("11", "SELL", "20250710", "-10", "13")];
/** The buy has a price no broker writes: the sale adds its 120 € of proceeds and no cost. */
const BAD_BUY = [trade("1", "BUY", "20250115", "10", "1e2000"), trade("2", "SELL", "20250601", "-10", "12")];
/** The sale has a price no broker writes: neither its proceeds nor its 100 € cost are added. */
const BAD_SALE = [trade("1", "BUY", "20250115", "10", "10"), trade("2", "SELL", "20250601", "-10", "1e2000")];
/** A cost of 1.1e13 € (read range, but past the 12 integer digits a box counts). */
const HUGE_COST = [trade("1", "BUY", "20250115", "1100000000", "10000"), trade("2", "SELL", "20250601", "-1100000000", "0.5")];

/** [cost, proceeds, result] of the sale of 1 June in each output. */
function jsonCells(r: TaxSummary): unknown[] {
  const op = formatReport(r).operaciones.find((o) => o.fecha_venta === "20250601")!;
  return [op.coste_eur, op.importe_venta_eur, op.ganancia_eur];
}

function csvCells(r: TaxSummary): string[] {
  const line = formatCsv(r).split("\n").find((l) => l.includes(",20250601,"))!;
  // ISIN, symbol, description, category, buy date, sale date, units, cost, proceeds, result.
  return line.split(",").slice(7, 10);
}

/** Every string the CLI PDF writes, in order. */
async function pdfStrings(r: TaxSummary): Promise<string[]> {
  const spy = vi.spyOn(PDFDocument.prototype, "text");
  await generatePdfReport(r);
  return spy.mock.calls.map((args) => String(args[0]));
}

async function webPdfText(r: TaxSummary): Promise<string> {
  const blob = await generatePdfWebReport(r, (key: string) => key);
  return new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer()));
}

/** A cell «NaN» (not the words «(NaN o infinito)» of the error that names the sale). */
const NAN_CELL = /\bNaN\b(?! o infinito)/;

describe("the per-sale outputs show each amount as the boxes count it", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a sale counted in full prints its own amounts, as before", async () => {
    const r = report(GOOD);
    const op = formatReport(r).operaciones[0]!;
    expect([op.coste_eur, op.importe_venta_eur, op.ganancia_eur]).toEqual(["100.00", "130.00", "30.00"]);
    expect(formatCsv(r)).toContain(",10,100.00,130.00,30.00,");
    const strings = await pdfStrings(r);
    expect(strings).toEqual(expect.arrayContaining(["100.00", "130.00", "30.00"]));
    expect(await webPdfText(r)).toContain("+30.00");
  });

  it("a cost that is no number: null, an empty cell and «—», and the result is the proceeds the boxes add", async () => {
    const r = report(BAD_BUY);
    expect(jsonCells(r)).toEqual([null, "120.00", "120.00"]);
    expect(csvCells(r)).toEqual(["", "120.00", "120.00"]);
    expect(JSON.stringify(formatReport(r))).not.toContain("NaN");
    expect(formatCsv(r)).not.toContain("NaN");
    const strings = await pdfStrings(r);
    expect(strings.join("\n")).not.toMatch(NAN_CELL);
    expect(strings).toContain("—");
    const web = await webPdfText(r);
    expect(web).not.toMatch(NAN_CELL);
    expect(web).toContain("+120.00");
  });

  it("proceeds that are no number: the cost and the result are left out too, never «NaN»", async () => {
    const r = report(BAD_SALE);
    expect(jsonCells(r)).toEqual([null, null, null]);
    expect(csvCells(r)).toEqual(["", "", ""]);
    expect(JSON.stringify(formatReport(r))).not.toContain("NaN");
    expect(formatCsv(r)).not.toContain("NaN");
    expect((await pdfStrings(r)).join("\n")).not.toMatch(NAN_CELL);
    expect(await webPdfText(r)).not.toMatch(NAN_CELL);
  });

  it("a cost of 1.1e13 € is not printed in full, as the boxes leave it out", async () => {
    const r = report(HUGE_COST);
    expect(jsonCells(r)).toEqual([null, "550000000.00", "550000000.00"]);
    expect(csvCells(r)).toEqual(["", "550000000.00", "550000000.00"]);
    for (const text of [JSON.stringify(formatReport(r)), formatCsv(r), (await pdfStrings(r)).join("\n"), await webPdfText(r)]) {
      expect(text).not.toContain("11000000000000");
    }
  });

  it("each column of the JSON adds up to its box", () => {
    const r = report([...GOOD, ...BAD_BUY.map((row) => row.replace(/ACME/g, "BETA").replace("XX0000000001", "XX0000000002"))]);
    const blocks = computeCasillaBlocksWithFx(r);
    const sum = (field: "coste_eur" | "importe_venta_eur") =>
      formatReport(r).operaciones.reduce((s, o) => (o[field] === null ? s : s.plus(o[field])), new Decimal(0));
    expect(sum("importe_venta_eur").toFixed(2)).toBe(blocks.listedShares.transmissionValue.toFixed(2));
    expect(sum("coste_eur").toFixed(2)).toBe(blocks.listedShares.acquisitionValue.toFixed(2));
  });
});

describe("a currency row the boxes leave out", () => {
  /** A report with one currency row whose amounts are set by hand. */
  function withFxRow(proceeds: string, cost: string): TaxSummary {
    const r = report(GOOD);
    const fx = {
      currency: "USD", disposeDate: "20250601", acquireDate: "20250301", quantity: new Decimal(100),
      proceedsEur: new Decimal(proceeds), costBasisEur: new Decimal(cost), gainLossEur: new Decimal(proceeds).minus(cost),
      trigger: "conversion" as const, holdingPeriodDays: 92, lotId: "USD-1",
    };
    return { ...r, fxGains: { ...r.fxGains, disposals: [fx] } };
  }

  it("is null in the JSON and empty in the CSV, never «NaN»", () => {
    const op = formatReport(withFxRow("NaN", "90")).operaciones_fx[0]!;
    expect([op.coste_eur, op.importe_venta_eur, op.ganancia_eur]).toEqual([null, null, null]);
    const counted = formatReport(withFxRow("95", "1e2000")).operaciones_fx[0]!;
    expect([counted.coste_eur, counted.importe_venta_eur, counted.ganancia_eur]).toEqual([null, "95.00", "95.00"]);
    const csv = formatCsv(withFxRow("95", "1e2000"));
    expect(csv).toContain("USD,20250301,20250601,100.00,,95.00,95.00,92,");
    expect(csv).not.toMatch(/\d{30}/);
  });

  it("reads «—» in the 1633/1637 drill-down, and a cost next to proceeds left out carries «(no se suma)»", () => {
    function fxCells(r: TaxSummary, key: Parameters<typeof t>[0]): string[] {
      const container = document.createElement("div");
      renderCasillaCards(container, r);
      const card = [...container.querySelectorAll<HTMLElement>(".casilla-card")]
        .find((c) => c.querySelector(".casilla-concept")?.textContent === t(key))!;
      card.querySelector<HTMLButtonElement>(".casilla-trigger")!.click();
      const tables = [...card.querySelectorAll(".detail-table")];
      const fxTable = tables[tables.length - 1]!;
      return [...fxTable.querySelectorAll("tbody tr")].map((tr) => tr.querySelectorAll("td")[4]!.textContent.replace(/\s+/g, " ").trim());
    }
    const noProceeds = withFxRow("NaN", "90");
    expect(fxCells(noProceeds, "casilla.other_transmission_value")).toEqual(["—"]);
    expect(fxCells(noProceeds, "casilla.other_acquisition_value")).toEqual([`90,00 (${t("annex.not_counted")})`]);
    const noCost = withFxRow("95", "1e2000");
    expect(fxCells(noCost, "casilla.other_transmission_value")).toEqual(["95,00"]);
    expect(fxCells(noCost, "casilla.other_acquisition_value")).toEqual(["—"]);
    // Control: a row counted in full.
    expect(fxCells(withFxRow("95", "90"), "casilla.other_acquisition_value")).toEqual(["90,00"]);
  });
});
