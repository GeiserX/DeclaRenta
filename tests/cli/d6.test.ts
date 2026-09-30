/**
 * `declarenta d6`: it must read every input file, like `convert` and the web, and
 * it must still write the report when nothing is held at year end but last
 * year's D-6 lists positions that now have to be cancelled.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { flexXml, runCli, tempFiles } from "./run-cli.js";

const US = { isin: "US0378331005", symbol: "AAPL", value: "30000" };
const DE = { isin: "DE0007164600", symbol: "SAP", value: "30000" };

const dir = tempFiles({
  "a.xml": flexXml("U1111111", [US]),
  "b.xml": flexXml("U2222222", [DE]),
  "empty.xml": flexXml("U1111111", []),
  "prev.json": JSON.stringify({ positions: [{ isin: "US0378331005" }] }),
});
const file = (name: string) => join(dir, name);
const base = ["-y", "2025", "--nif", "12345678Z", "--name", "Apellido, Nombre", "--format", "json"];

interface D6Json {
  positions: { isin: string }[];
  cancelled: { isin: string }[];
}

function readReport(path: string): D6Json {
  return JSON.parse(readFileSync(path, "utf-8")) as D6Json;
}

describe("declarenta d6", () => {
  it("lists the positions of every input file", () => {
    const out = file("both.json");
    const res = runCli(["d6", "-i", file("a.xml"), "-i", file("b.xml"), ...base, "-o", out]);
    expect(res.status).toBe(0);
    expect(readReport(out).positions.map((p) => p.isin).sort()).toEqual(["DE0007164600", "US0378331005"]);
  }, 30_000);

  it("still lists the position of a single file", () => {
    const out = file("single.json");
    const res = runCli(["d6", "-i", file("a.xml"), ...base, "-o", out]);
    expect(res.status).toBe(0);
    expect(readReport(out).positions.map((p) => p.isin)).toEqual(["US0378331005"]);
  }, 30_000);

  it("writes the cancellations when nothing is held but last year's D-6 had positions", () => {
    const out = file("cancelled.json");
    const res = runCli(["d6", "-i", file("empty.xml"), ...base, "--previous-d6", file("prev.json"), "-o", out]);
    expect(res.stderr).not.toContain("No es necesario presentar D-6");
    expect(res.status).toBe(0);
    const report = readReport(out);
    expect(report.positions).toEqual([]);
    expect(report.cancelled.map((c) => c.isin)).toEqual(["US0378331005"]);
  }, 30_000);

  it("still reports no filing when nothing is held and there is no previous D-6", () => {
    const out = file("nothing.json");
    const res = runCli(["d6", "-i", file("empty.xml"), ...base, "-o", out]);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("No es necesario presentar D-6");
    expect(existsSync(out)).toBe(false);
  }, 30_000);
});
