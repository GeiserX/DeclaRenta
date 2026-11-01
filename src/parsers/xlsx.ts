/**
 * Binary XLSX exports (Revolut, eToro) cannot go through the text parser
 * registry, so the web app and the CLI both read them here. The broker is named
 * with the parser's own `name`, the same name the registry gives every other
 * broker and that mergeStatement stamps on each row as `brokerSource`.
 */

import type { Statement } from "../types/broker.js";
import { detectEtoroXlsx, etoroParser, parseEtoroXlsx } from "./etoro.js";
import { detectRevolutXlsx, parseRevolutXlsx, revolutParser } from "./revolut.js";

type XlsxBytes = Buffer | Uint8Array;

interface XlsxReader {
  broker: string;
  detect: (data: XlsxBytes) => Promise<boolean>;
  parse: (data: XlsxBytes) => Promise<Statement>;
}

// Revolut first: an eToro workbook is recognised by its sheet names only.
const XLSX_READERS: XlsxReader[] = [
  { broker: revolutParser.name, detect: detectRevolutXlsx, parse: parseRevolutXlsx },
  { broker: etoroParser.name, detect: detectEtoroXlsx, parse: parseEtoroXlsx },
];

async function findReader(data: XlsxBytes): Promise<XlsxReader | null> {
  for (const reader of XLSX_READERS) {
    if (await reader.detect(data)) return reader;
  }
  return null;
}

/** The broker of an XLSX export, or null when the bytes are not one we read. */
export async function detectXlsxBroker(data: XlsxBytes): Promise<string | null> {
  return (await findReader(data))?.broker ?? null;
}

/** Parse an XLSX export and name its broker, or null when the bytes are not one we read. */
export async function parseXlsxExport(data: XlsxBytes): Promise<{ broker: string; statement: Statement } | null> {
  const reader = await findReader(data);
  return reader ? { broker: reader.broker, statement: await reader.parse(data) } : null;
}
