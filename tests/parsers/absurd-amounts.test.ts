import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { degiroParser } from "../../src/parsers/degiro.js";
import { flatexParser } from "../../src/parsers/flatex.js";
import { parseRevolutXlsx } from "../../src/parsers/revolut.js";
import { parseEtoroXlsx } from "../../src/parsers/etoro.js";
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
