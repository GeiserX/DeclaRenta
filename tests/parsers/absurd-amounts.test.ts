import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { degiroParser } from "../../src/parsers/degiro.js";
import { flatexParser } from "../../src/parsers/flatex.js";
import { parseRevolutXlsx } from "../../src/parsers/revolut.js";
import { parseEtoroXlsx } from "../../src/parsers/etoro.js";
import { krakenParser } from "../../src/parsers/kraken.js";
import { reportOptionsForMethod } from "../../src/generators/report.js";
import type { FxMethod } from "../../src/types/tax.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { formatReport } from "../../src/cli/format-report.js";
import { formatCsv } from "../../src/generators/csv.js";
import { renderOperationsAnnex } from "../../src/web/operations-annex.js";
import type { Statement } from "../../src/types/broker.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// A cell no broker writes never makes a parser run out of memory (#470).
//
// decimal.js reads "1e1000000000" as a finite number, and `toFixed` writes
// one character per digit. The Degiro commission and transaction tax, the
// Flatex amount and quantity, the commission Flatex takes from its cash
// account, the Revolut prices and fee and the eToro gross dividend were all
// written with `toFixed`, so the parser died before the report could name
// the row. They now write such a number in exponent form
// (`plainOrExponent`); the report names the row and counts none of it.
// A red run on unfixed code must use PARSER_HUGE_CASES=1e100000.
// ===========================================================================

const RATES: EcbRateMap = new Map();
for (let t = Date.UTC(2019, 0, 1); t <= Date.UTC(2026, 0, 31); t += 86_400_000) {
  RATES.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "0.9"]]));
}

const fixture = (name: string) => readFileSync(resolve(__dirname, "../fixtures", name), "utf-8");

/** Replace the `col`-th cell (0-based, split by `sep`) of the first line containing `marker`. */
function setCell(csv: string, marker: string, sep: string, col: number, value: string): string {
  const lines = csv.split("\n");
  const i = lines.findIndex((l) => l.includes(marker));
  expect(i).toBeGreaterThan(0);
  const cells = lines[i]!.split(sep);
  cells[col] = value;
  lines[i] = cells.join(sep);
  return lines.join("\n");
}

function statementOf(parts: [Statement, string][]): Statement {
  const merged = createEmptyStatement();
  for (const [st, name] of parts) mergeStatement(merged, st, name);
  return finalizeMergedStatement(merged);
}

/**
 * Every year of the statement reports with short output, and the row is named
 * by `named`: the report's out-of-range warning, or the parser message that
 * keeps the number out of every trade.
 */
function expectNamedAndShort(st: Statement, named = "report.trade_out_of_range"): void {
  // The parser itself wrote no long number: every field of every row and
  // every parser message is short.
  for (const row of [...st.trades, ...st.cashTransactions]) {
    for (const value of Object.values(row)) {
      if (typeof value === "string") expect(value.length).toBeLessThan(200);
    }
  }
  for (const m of st.parserMessages ?? []) expect(m.message.length).toBeLessThan(2000);
  const years = new Set([...st.trades.map((t) => t.tradeDate), ...st.cashTransactions.map((c) => c.dateTime)]
    .map((d) => Number(d.replace(/-/g, "").slice(0, 4))));
  const ids = new Set<string>((st.parserMessages ?? []).map((m) => m.id));
  for (const year of years) {
    const r = generateTaxReport(st, RATES, year);
    for (const m of r.messages) ids.add(m.id);
    for (const text of [JSON.stringify(formatReport(r)), formatCsv(r), renderOperationsAnnex(r)]) {
      expect(text).not.toMatch(/\d{30}/);
      expect(text.length).toBeLessThan(200_000);
    }
  }
  expect(ids).toContain(named);
}

function workbook(sheets: Record<string, (string | number)[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

const hugeCases = (process.env.PARSER_HUGE_CASES ?? "1e100000,1e1000000000").split(",");

describe.each(hugeCases)("a cell of %s", (huge) => {
  it("Degiro, the transaction costs of a buy", () => {
    const csv = setCell(fixture("degiro-transactions-sample.csv"), "-155.40", ",", 14, `-${huge}`);
    const st = statementOf([[degiroParser.parse(csv), "Degiro"]]);
    expect(st.trades.some((t) => /e\+/.test(t.commission))).toBe(true);
    expectNamedAndShort(st);
  });

  it("Degiro, a transaction tax in the account statement", () => {
    const csv = setCell(fixture("degiro-account-sample.csv"), "Spanish Transaction Tax,,EUR,-0.40", ",", 8, `-${huge}`);
    const st = degiroParser.parse(csv);
    const msg = st.parserMessages?.find((m) => m.id === "degiro.transaction_tax" && m.message.includes("e+"));
    expect(msg).toBeDefined();
    expect(msg!.message.length).toBeLessThan(500);
  });

  it("Flatex, the price and the quantity of a buy", () => {
    for (const col of [9, 5]) {
      const depot = setCell(fixture("flatex-depotumsaetze-sample.csv"), "Ausführung ORDER Kauf US94106L1098", ";", col, huge);
      const st = statementOf([[flatexParser.parse(depot), "Flatex"], [flatexParser.parse(fixture("flatex-kontoumsaetze-sample.csv")), "Flatex"]]);
      expectNamedAndShort(st);
    }
  });

  // A leg that far from its fill does not square with it: no fill gets a
  // fee from it, and the order is named with the leg in exponent form (#467).
  it("Flatex, the cash leg the commission comes from", () => {
    const konto = setCell(fixture("flatex-kontoumsaetze-sample.csv"), "Ausführung ORDER Kauf US94106L1098", ";", 6, `-${huge}`);
    const st = statementOf([[flatexParser.parse(fixture("flatex-depotumsaetze-sample.csv")), "Flatex"], [flatexParser.parse(konto), "Flatex"]]);
    expect(st.trades.filter((t) => t.isin === "US94106L1098").map((t) => t.commission)).toEqual(["0"]);
    expect(st.parserMessages?.find((m) => m.id === "flatex.commission.not_recovered")?.message).toMatch(/e\+/);
    expectNamedAndShort(st, "flatex.commission.not_recovered");
  });

  it("Revolut, the cost basis and the fees of a closed position", async () => {
    const header = ["Date acquired", "Date sold", "Symbol", "Quantity", "Cost basis", "Gross proceeds", "Gross PnL", "Fees", "Net PnL", "Currency"];
    for (const [cost, fees] of [[huge, "1"], ["1000", huge]] as const) {
      const st = await parseRevolutXlsx(workbook({ Sheet1: [header, ["2025-01-15", "2025-06-15", "ACME", "10", cost, "1200", "200", fees, "199", "USD"]] }));
      expectNamedAndShort(statementOf([[st, "Revolut"]]));
    }
  });

  it("eToro, a net dividend with its withholding", async () => {
    const header = ["Date of Payment", "Instrument Name", "Net Dividend Received (USD)", "Withholding Tax Amount (USD)", "ISIN"];
    const st = await parseEtoroXlsx(workbook({ Dividends: [header, ["15/03/2025", "ACME", huge, "1.5", "US0378331005"]] }));
    expectNamedAndShort(statementOf([[st, "eToro"]]));
  });
});

// The same for Kraken (#467, #470): a vol, price, cost or fee no broker writes
// is passed on in exponent form, and the report names the trade and counts
// none of it. BTC bought on 01/02 (the cell under test) and 01/03, 0.05 sold
// on 01/06 for 2400 €. A vol out of range books no lot, so the sale takes the
// second one: a gain of 400 €. With a readable vol the lot keeps its place
// and has no cost, so the sale that takes it counts its proceeds and no cost,
// 2400 €, and report.non_finite_disposal names it: the user may overpay,
// never underpay.
describe("Kraken, a trade cell no broker writes", () => {
  const KH = `"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers"`;
  const kraken = (cells: { price?: string; cost?: string; fee?: string; vol?: string }): Statement => krakenParser.parse([KH,
    `"T1","O1","XBTEUR","2025-02-01 10:00:00","buy","limit","${cells.price ?? "40000.00"}","${cells.cost ?? "2000.00"}","${cells.fee ?? "1.00"}","${cells.vol ?? "0.05"}","0.0","","L1"`,
    `"T2","O2","XBTEUR","2025-03-01 10:00:00","buy","limit","40000.00","2000.00","0.00","0.05","0.0","","L2"`,
    `"T3","O3","XBTEUR","2025-06-01 10:00:00","sell","limit","48000.00","2400.00","0.00","0.05","0.0","","L3"`,
  ].join("\n"));
  const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];
  const gain = (st: Statement, method: FxMethod): string[] => {
    const cg = generateTaxReport(statementOf([[st, "Kraken"]]), RATES, 2025, reportOptionsForMethod(method)).capitalGains;
    return [cg.transmissionValue, cg.acquisitionValue, cg.netGainLoss].map((d) => d.toFixed(2));
  };

  it.each(METHODS)("[%s] control: a readable first buy is the lot the sale takes, with no message", (method) => {
    const st = kraken({});
    expect(generateTaxReport(statementOf([[st, "Kraken"]]), RATES, 2025, reportOptionsForMethod(method)).messages.map((m) => m.id))
      .not.toContain("report.trade_out_of_range");
    expect(gain(st, method)).toEqual(["2400.00", "2001.00", "399.00"]);
  });

  const cells: [string, string][] = [];
  for (const huge of [...hugeCases, "1e25", "1e-25"]) for (const field of ["vol", "price", "cost", "fee"]) cells.push([field, huge]);
  it.each(cells)("a %s of %s is named by the report, counted nowhere, and every output stays short", (field, huge) => {
    const st = kraken({ [field]: huge });
    expectNamedAndShort(statementOf([[st, "Kraken"]]));
    for (const method of METHODS) {
      expect(gain(st, method), method).toEqual(field === "vol" ? ["2400.00", "2000.00", "400.00"] : ["2400.00", "0.00", "2400.00"]);
      const r = generateTaxReport(statementOf([[st, "Kraken"]]), RATES, 2025, reportOptionsForMethod(method));
      expect(r.messages.find((m) => m.id === "report.trade_out_of_range")?.context?.rows, method).toBe("BTC (01/02/2025)");
      if (field !== "vol") expect(r.messages.map((m) => m.id), method).toContain("report.non_finite_disposal");
    }
  });
});
