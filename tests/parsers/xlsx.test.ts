/**
 * The web app and the CLI read Revolut and eToro XLSX exports through
 * parseXlsxExport, so both name the broker the same way: the parser's own name,
 * which mergeStatement stamps on every row as brokerSource.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import { detectXlsxBroker, parseXlsxExport } from "../../src/parsers/xlsx.js";
import { createEmptyStatement, mergeStatement } from "../../src/parsers/merge.js";
import { getBroker } from "../../src/parsers/index.js";

const REVOLUT = readFileSync(fileURLToPath(new URL("../fixtures/revolut-sample.xlsx", import.meta.url)));

function etoroWorkbook(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Action", "Amount", "Units", "Open Rate", "Close Rate", "Profit(USD)", "Open Date", "Close Date", "Type", "Leverage", "ISIN"],
    ["Buy AAPL", "1000", "5", "180", "195", "75", "15/03/2025 09:30:00", "20/09/2025 14:00:00", "Stocks", "1", "US0378331005"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Closed Positions");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

describe("XLSX exports", () => {
  it("names a Revolut export with the registry's Revolut parser name and stamps its rows", async () => {
    expect(await detectXlsxBroker(REVOLUT)).toBe("Revolut");
    const parsed = await parseXlsxExport(REVOLUT);
    expect(parsed?.broker).toBe(getBroker("Revolut")?.name);
    expect(parsed!.statement.trades.length).toBeGreaterThan(0);

    const merged = mergeStatement(createEmptyStatement(), parsed!.statement, parsed!.broker);
    expect(new Set(merged.trades.map((t) => t.brokerSource))).toEqual(new Set(["Revolut"]));
  });

  it("names an eToro export with the registry's eToro parser name and stamps its rows", async () => {
    const data = etoroWorkbook();
    expect(await detectXlsxBroker(data)).toBe("eToro");
    const parsed = await parseXlsxExport(data);
    expect(parsed?.broker).toBe(getBroker("eToro")?.name);
    expect(parsed!.statement.trades.length).toBeGreaterThan(0);

    const merged = mergeStatement(createEmptyStatement(), parsed!.statement, parsed!.broker);
    expect(new Set(merged.trades.map((t) => t.brokerSource))).toEqual(new Set(["eToro"]));
  });

  it("returns null for anything that is not one of those workbooks", async () => {
    const csv = new TextEncoder().encode("Date,Ticker,Type\n");
    expect(await detectXlsxBroker(csv)).toBeNull();
    expect(await parseXlsxExport(csv)).toBeNull();

    const other = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(other, XLSX.utils.aoa_to_sheet([["foo", "bar"]]), "Sheet1");
    const buf = XLSX.write(other, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
    expect(await parseXlsxExport(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))).toBeNull();
  });
});
