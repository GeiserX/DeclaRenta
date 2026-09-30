/**
 * `declarenta modelo720` with several broker files. The 50.000 EUR threshold of
 * the Modelo 720 applies to the values of the category taken together, across
 * every foreign entity (Art. 42 ter RD 1065/2007). The command used to read a
 * single file, and a repeated --input kept only the last one, so 30.000 EUR at
 * each of two brokers was reported as "no need to file".
 */

import { join } from "path";
import { describe, expect, it } from "vitest";
import { flexXml, runCli, tempFiles } from "./run-cli.js";

const US = { isin: "US0378331005", symbol: "AAPL", value: "30000" };
const DE = { isin: "DE0007164600", symbol: "SAP", value: "30000" };

const dir = tempFiles({
  "a.xml": flexXml("U1111111", [US]),
  "b.xml": flexXml("U2222222", [DE]),
  "big.xml": flexXml("U1111111", [{ ...US, value: "60000" }]),
});
const file = (name: string) => join(dir, name);
const base = ["-y", "2025", "--nif", "12345678Z", "--name", "Apellido, Nombre"];

function detailIsins(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.startsWith("2"))
    .map((line) => line.slice(131, 143).trim())
    .sort();
}

describe("declarenta modelo720 with several input files", () => {
  it("adds the positions of every file before checking the 50.000 EUR threshold", () => {
    const res = runCli(["modelo720", "-i", file("a.xml"), "-i", file("b.xml"), ...base]);
    expect(res.stderr).not.toContain("por debajo de 50.000");
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("3 registro(s) validados");
    expect(detailIsins(res.stdout)).toEqual(["DE0007164600", "US0378331005"]);
  }, 30_000);

  it("accepts the files after a single --input", () => {
    const res = runCli(["modelo720", "-i", file("a.xml"), file("b.xml"), ...base]);
    expect(res.status).toBe(0);
    expect(detailIsins(res.stdout)).toEqual(["DE0007164600", "US0378331005"]);
  }, 30_000);

  it("accepts --broker", () => {
    const res = runCli(["modelo720", "-i", file("a.xml"), file("b.xml"), "--broker", "interactive", ...base]);
    expect(res.status).toBe(0);
    expect(detailIsins(res.stdout)).toEqual(["DE0007164600", "US0378331005"]);
  }, 30_000);

  it("still writes the file for one file above the threshold", () => {
    const res = runCli(["modelo720", "-i", file("big.xml"), ...base]);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("2 registro(s) validados");
    expect(detailIsins(res.stdout)).toEqual(["US0378331005"]);
  }, 30_000);

  it("still reports no filing for one file below the threshold", () => {
    const res = runCli(["modelo720", "-i", file("a.xml"), ...base]);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("por debajo de 50.000");
    expect(res.stdout).toBe("");
  }, 30_000);
});
