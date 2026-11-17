/**
 * `--fx-method` (issue #434): the three methods, the `--monodivisa` alias, the
 * contradiction guard and the method name on stderr and in the CSV export.
 * The fixture is EUR only, so no ECB request is made.
 */

import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "src/cli/index.ts");

function trade(id: string, date: string, quantity: string, buySell: "BUY" | "SELL"): string {
  const money = (Math.abs(Number(quantity)) * 100).toFixed(2);
  return `<Trade tradeID="${id}" accountId="U7654321" symbol="IWDA" description="ISHARES CORE MSCI WORLD"
               isin="IE00B4L5Y983" assetCategory="STK" currency="EUR"
               tradeDate="${date}" settlementDate="${date}"
               quantity="${quantity}" tradePrice="100" tradeMoney="${money}"
               proceeds="${buySell === "BUY" ? "-" : ""}${money}" cost="0" fifoPnlRealized="0"
               fxRateToBase="1" buySell="${buySell}" openCloseIndicator="${buySell === "BUY" ? "O" : "C"}"
               exchange="AEB" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />`;
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U7654321" fromDate="20240101" toDate="20251231" period="">
      <Trades>
        ${trade("1", "20240110", "10", "BUY")}
        ${trade("2", "20250310", "-5", "SELL")}
      </Trades>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>
`;

function runCli(extra: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "declarenta-cli-fxmethod-"));
  const input = join(dir, "flex.xml");
  const output = join(dir, "out.csv");
  writeFileSync(input, XML);
  const res = spawnSync(process.execPath, ["--import", "tsx", CLI, "convert", "-i", input, "-o", output, "-y", "2025", "-f", "csv", ...extra], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  const csv = existsSync(output) ? readFileSync(output, "utf-8") : "";
  return { status: res.status, stderr: res.stderr, csv, written: existsSync(output) };
}

const methodRow = (csv: string) => csv.split(/\r?\n/).find((l) => l.startsWith("Metodo_Divisa"));

describe("convert --fx-method", () => {
  it.each([
    [[], "CRITERIO_DGT_MULTIDIVISA", "Criterio DGT (multidivisa)"],
    [["--fx-method", "multidivisa"], "CRITERIO_DGT_MULTIDIVISA", "Criterio DGT (multidivisa)"],
    [["--fx-method", "tradicional-divisa"], "TRADICIONAL_CON_DIVISA", "Tradicional con divisa"],
    [["--fx-method", "monodivisa"], "TRADICIONAL_SIN_DIVISA_MONODIVISA", "Tradicional sin divisa (monodivisa)"],
    [["--monodivisa"], "TRADICIONAL_SIN_DIVISA_MONODIVISA", "Tradicional sin divisa (monodivisa)"],
    [["--monodivisa", "--fx-method", "monodivisa"], "TRADICIONAL_SIN_DIVISA_MONODIVISA", "Tradicional sin divisa (monodivisa)"],
  ])("%j → Metodo_Divisa %s", (args, cell, name) => {
    const res = runCli(args);
    expect(res.status).toBe(0);
    expect(methodRow(res.csv)).toMatch(new RegExp(`^Metodo_Divisa[,;]${cell}$`));
    expect(res.stderr).toContain(`Método: ${name}`);
  }, 30_000);

  it("--monodivisa is exactly --fx-method monodivisa", () => {
    expect(runCli(["--monodivisa"]).csv).toBe(runCli(["--fx-method", "monodivisa"]).csv);
  }, 60_000);

  it.each([["multidivisa"], ["tradicional-divisa"]])("--monodivisa with --fx-method %s exits 1 and writes nothing", (m) => {
    const res = runCli(["--monodivisa", "--fx-method", m]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("se contradicen");
    expect(res.written).toBe(false);
  }, 30_000);

  it("an unknown method exits 1 and names the choices", () => {
    const res = runCli(["--fx-method", "fifo"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--fx-method");
    expect(res.stderr).toContain("tradicional-divisa");
    expect(res.written).toBe(false);
  }, 30_000);

  it("help lists the three methods with their names", () => {
    const help = spawnSync(process.execPath, ["--import", "tsx", CLI, "convert", "--help"], { cwd: ROOT, encoding: "utf-8" }).stdout.replace(/\s+/g, " ");
    expect(help).toContain("--fx-method <method>");
    expect(help).toContain('choices: "multidivisa", "tradicional-divisa", "monodivisa"');
    for (const n of ["«Criterio DGT (multidivisa)»", "«Tradicional con divisa»", "«Tradicional sin divisa (monodivisa)»"]) expect(help).toContain(n);
  }, 30_000);
});
