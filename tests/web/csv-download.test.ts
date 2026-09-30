import { describe, it, expect } from "vitest";
import { csvDownloadBlob } from "../../src/generators/csv.js";

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("csvDownloadBlob — CSV download for Spanish-locale Excel", () => {
  it("starts with the UTF-8 byte-order mark EF BB BF", async () => {
    const bytes = await bytesOf(csvDownloadBlob("a,b\n1,2\n"));
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("encodes accents and the em dash as UTF-8 after the mark", async () => {
    const csv = "Descripcion\nSociété Générale —\n";
    const bytes = await bytesOf(csvDownloadBlob(csv));
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.slice(3));
    expect(body).toBe(csv);
    // "é" is C3 A9 in UTF-8, not the single cp1252 byte E9.
    expect(Array.from(bytes.slice(3 + "Descripcion\nSoci".length, 3 + "Descripcion\nSoci".length + 2))).toEqual([0xc3, 0xa9]);
  });

  it("adds exactly one mark and keeps comma separators and point decimals", async () => {
    const csv = "ISIN,Coste_EUR\nUS0000000001,1234.56\n";
    const blob = csvDownloadBlob(csv);
    const bytes = await bytesOf(blob);
    expect(bytes.length).toBe(3 + new TextEncoder().encode(csv).length);
    expect(bytes[3]).not.toBe(0xef);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(text).toBe("﻿" + csv);
    expect(blob.type).toBe("text/csv;charset=utf-8");
  });
});
