/**
 * The library entry (src/index.ts) must expose every registered broker parser
 * by name and the helpers the CLI builds a report with: without them a library
 * consumer cannot parse a Revolut XLSX, run the Flatex commission pass in
 * finalizeMergedStatement, fetch the previous year's ECB rates for early-January
 * trades, or compute casillas 0328/0331/1633/1637.
 */

import { describe, expect, it } from "vitest";
import * as lib from "../src/index.js";

describe("library entry exports", () => {
  it("exports every registered broker parser by name", () => {
    const exported = new Set(Object.values(lib));
    const missing = lib.brokerParsers.filter((p) => !exported.has(p)).map((p) => p.name);
    expect(missing).toEqual([]);
  });

  it.each([
    "parseRevolutXlsx",
    "detectRevolutXlsx",
    "createEmptyStatement",
    "mergeStatement",
    "finalizeMergedStatement",
    "buildEcbRateMap",
    "deriveEcbNeeds",
    "computeCasillaBlocksWithFx",
    "buildManualRateMap",
  ])("exports %s", (name) => {
    expect(typeof (lib as Record<string, unknown>)[name]).toBe("function");
  });
});
