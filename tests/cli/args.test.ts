/**
 * CLI argument validation. `--year` used to go through a bare parseInt, and the
 * report filters by year prefix, so a typo such as `2O25` (parsed as 2) or `202`
 * summed every year starting with those digits and still exited 0. Unknown
 * `--format` values fell through to JSON, and error-severity report messages
 * (a sale with no lots, cost basis 0) left the exit code at 0.
 *
 * The fixtures are EUR only, so no ECB request is made.
 */

import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { brokerParsers } from "../../src/parsers/index.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "src/cli/index.ts");

function trade(id: string, date: string, quantity: string, buySell: "BUY" | "SELL"): string {
  const money = (Number(quantity) * 100).toFixed(2);
  return `<Trade tradeID="${id}" accountId="U7654321" symbol="IWDA" description="ISHARES CORE MSCI WORLD"
               isin="IE00B4L5Y983" assetCategory="STK" currency="EUR"
               tradeDate="${date}" settlementDate="${date}"
               quantity="${quantity}" tradePrice="100" tradeMoney="${money}"
               proceeds="${(-Number(money)).toFixed(2)}" cost="0" fifoPnlRealized="0"
               fxRateToBase="1" buySell="${buySell}" openCloseIndicator="${buySell === "BUY" ? "O" : "C"}"
               exchange="AEB" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />`;
}

function flexXml(trades: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U7654321" fromDate="20240101" toDate="20251231" period="">
      <Trades>
        ${trades.join("\n        ")}
      </Trades>
      <OpenPositions>
        <OpenPosition accountId="U7654321" symbol="IWDA" description="ISHARES CORE MSCI WORLD"
                      isin="IE00B4L5Y983" currency="EUR" assetCategory="STK"
                      quantity="1000" costBasisMoney="80000" costBasisPrice="80"
                      markPrice="100" positionValue="100000" fifoPnlUnrealized="20000" />
      </OpenPositions>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>
`;
}

const CLEAN = flexXml([trade("1", "20240110", "10", "BUY"), trade("2", "20250310", "-5", "SELL")]);
const SELL_WITHOUT_LOTS = flexXml([trade("3", "20250310", "-5", "SELL")]);

function runCli(args: string[], xml = CLEAN) {
  const dir = mkdtempSync(join(tmpdir(), "declarenta-cli-args-"));
  const input = join(dir, "flex.xml");
  const output = join(dir, "out");
  writeFileSync(input, xml);
  const [command, ...rest] = args;
  const res = spawnSync(
    process.execPath,
    ["--import", "tsx", CLI, command!, "-i", input, "-o", output, ...rest],
    { cwd: ROOT, encoding: "utf-8" },
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, written: existsSync(output) };
}

const PERSON = ["--nif", "12345678Z", "--name", "Apellido, Nombre"];

describe("declarenta CLI arguments", () => {
  it.each(["2O25", "202", "0", "2025abc"])("convert rejects --year %s", (year) => {
    const res = runCli(["convert", "-y", year]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--year");
    expect(res.written).toBe(false);
  }, 30_000);

  it.each(["modelo720", "d6"])("%s rejects --year 2O25", (command) => {
    const res = runCli([command, "-y", "2O25", ...PERSON]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--year");
    expect(res.written).toBe(false);
  }, 30_000);

  it.each([
    [["convert", "-y", "2025", "-f", "xlsx"], "--format"],
    [["convert", "-y", "2025", "--fx-trace-format", "xml"], "--fx-trace-format"],
    [["convert", "-y", "2025", "--titulares", "0"], "--titulares"],
    [["convert", "-y", "2025", "--titulares", "1.5"], "--titulares"],
    [["d6", "-y", "2025", "-f", "xml", ...PERSON], "--format"],
  ])("rejects %j", (args, option) => {
    const res = runCli(args);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(option);
    expect(res.written).toBe(false);
  }, 30_000);

  it("accepts a valid year and format (positive control)", () => {
    const res = runCli(["convert", "-y", "2025", "-f", "csv", "--titulares", "2"]);
    expect(res.stderr).not.toContain("error:");
    expect(res.status).toBe(0);
    expect(res.written).toBe(true);
  }, 30_000);

  it("writes the report but exits 1 when it carries an error message", () => {
    const res = runCli(["convert", "-y", "2025"], SELL_WITHOUT_LOTS);
    expect(res.stderr).toContain("Venta sin lotes");
    expect(res.written).toBe(true);
    expect(res.status).toBe(1);
  }, 30_000);

  it("lists every supported broker in the program and convert descriptions", () => {
    const help = (args: string[]) =>
      spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], { cwd: ROOT, encoding: "utf-8" }).stdout.replace(/\s+/g, " ");
    const top = help(["--help"]);
    // Help text wraps, so whitespace is collapsed. The convert check reads only
    // the description: the --broker option text already listed every name.
    const convert = help(["convert", "--help"]).split("Options:")[0]!;
    for (const p of brokerParsers) {
      expect(top).toContain(p.name);
      expect(convert).toContain(p.name);
    }
  }, 60_000);
});

describe("--antichurning-1y / --antichurning-2m (#452)", () => {
  const ISIN = "GB0007980591";
  const row = (id: string, date: string, qty: number, price: number) => {
    const side = qty > 0 ? "BUY" : "SELL";
    const money = (Math.abs(qty) * price).toFixed(2);
    return `<Trade tradeID="${id}" accountId="U7654321" symbol="LSEONLY" description="LONDON ONLY PLC" isin="${ISIN}" assetCategory="STK" currency="EUR" tradeDate="${date}" settlementDate="${date}" quantity="${qty}" tradePrice="${price}" tradeMoney="${side === "BUY" ? money : `-${money}`}" proceeds="${side === "BUY" ? `-${money}` : money}" cost="0" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}" exchange="LSE" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />`;
  };
  // The issue example: buy 01/02/2025 at 100, sell 01/03 at 80, rebuy 01/08 at 85.
  const ISSUE = `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U7654321" fromDate="20250101" toDate="20251231" period=""><Trades>${row("1", "20250201", 1, 100)}${row("2", "20250301", -1, 80)}${row("3", "20250801", 1, 85)}</Trades></FlexStatement></FlexStatements></FlexQueryResponse>`;

  function convert(extra: string[]) {
    const dir = mkdtempSync(join(tmpdir(), "declarenta-cli-452-"));
    const input = join(dir, "flex.xml");
    const output = join(dir, "out.json");
    writeFileSync(input, ISSUE);
    const res = spawnSync(process.execPath, ["--import", "tsx", CLI, "convert", "-i", input, "-o", output, "-y", "2025", ...extra], { cwd: ROOT, encoding: "utf-8" });
    const json = existsSync(output) ? (JSON.parse(readFileSync(output, "utf-8")) as { resumen: { perdidas_bloqueadas_antichurning: string } }) : undefined;
    return { status: res.status, stderr: res.stderr, json };
  }

  it("with no flag the rebuy 5 months later blocks nothing (control)", () => {
    const res = convert([]);
    expect(res.status).toBe(0);
    expect(Number(res.json!.resumen.perdidas_bloqueadas_antichurning)).toBe(0);
  }, 30_000);

  it("--antichurning-1y applies 1 year: the −20 is blocked (lower case and commas accepted)", () => {
    const res = convert(["--antichurning-1y", `${ISIN.toLowerCase()},US0378331005`]);
    expect(res.status).toBe(0);
    expect(Number(res.json!.resumen.perdidas_bloqueadas_antichurning)).toBe(20);
  }, 30_000);

  it("--antichurning-2m keeps 2 months", () => {
    const res = convert(["--antichurning-2m", ISIN]);
    expect(res.status).toBe(0);
    expect(Number(res.json!.resumen.perdidas_bloqueadas_antichurning)).toBe(0);
  }, 30_000);

  it("a value that is not an ISIN stops the run with a Spanish error", () => {
    const res = convert(["--antichurning-1y", "GB000798059"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("no es un ISIN válido");
    expect(res.json).toBeUndefined();
  }, 30_000);

  it("a mistyped check digit stops the run, so a typo cannot leave the 1-year block in place", () => {
    const res = convert(["--antichurning-2m", "GB0007980592"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("«GB0007980592» no es un ISIN válido");
    expect(res.json).toBeUndefined();
  }, 30_000);

  it("a valid ISIN that is in no file gives a warning and changes nothing", () => {
    const res = convert(["--antichurning-1y", "US0378331005"]);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("ningún valor de los ficheros tiene el ISIN US0378331005");
    expect(Number(res.json!.resumen.perdidas_bloqueadas_antichurning)).toBe(0);
  }, 30_000);

  it("an ISIN that is in the file gives no such warning", () => {
    const res = convert(["--antichurning-1y", ISIN]);
    expect(res.status).toBe(0);
    expect(res.stderr).not.toContain("ningún valor de los ficheros");
  }, 30_000);

  it("the same ISIN in both flags stops the run", () => {
    const res = convert(["--antichurning-1y", ISIN, "--antichurning-2m", ISIN]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("a la vez en --antichurning-1y y en --antichurning-2m");
  }, 30_000);
});
