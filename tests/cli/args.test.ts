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
import { existsSync, mkdtempSync, writeFileSync } from "fs";
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
