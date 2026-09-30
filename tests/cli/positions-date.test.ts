/**
 * CLI half of the positions-date guard: `declarenta modelo720` and `declarenta d6`
 * must refuse open positions from a statement that does not end on 31 December
 * of the tax year, like the web sections do. Without it the CLI wrote a real 720
 * file and the AFORIX guide from, say, a Flex Query ending 12/09/2020, valued as
 * the 31/12/2025 holdings.
 *
 * The fixture holds one EUR position, so no ECB request is made and the only
 * difference between the refused and the accepted run is the period end.
 */

import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "src/cli/index.ts");

function flexXml(toDate: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U7654321" fromDate="20250101" toDate="${toDate}" period="">
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

function runCli(command: "modelo720" | "d6", toDate: string) {
  const dir = mkdtempSync(join(tmpdir(), "declarenta-cli-"));
  const input = join(dir, "flex.xml");
  const output = join(dir, "out");
  writeFileSync(input, flexXml(toDate));
  const res = spawnSync(
    process.execPath,
    ["--import", "tsx", CLI, command, "-i", input, "-y", "2025", "--nif", "12345678Z", "--name", "Apellido, Nombre", "-o", output],
    { cwd: ROOT, encoding: "utf-8" },
  );
  return { status: res.status, stderr: res.stderr, written: existsSync(output) };
}

describe.each(["modelo720", "d6"] as const)("declarenta %s positions date", (command) => {
  it("refuses a statement that ends on another date and names both dates", () => {
    const res = runCli(command, "20200912");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("12/09/2020");
    expect(res.stderr).toContain("31/12/2025");
    expect(res.written).toBe(false);
  }, 30_000);

  it("writes the output for a statement that ends on 31 December of the year", () => {
    const res = runCli(command, "20251231");
    expect(res.stderr).not.toContain("12/09/2020");
    expect(res.status).toBe(0);
    expect(res.written).toBe(true);
  }, 30_000);

  it("warns without refusing when the statement gives no period end", () => {
    const res = runCli(command, "");
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("no indica a qué fecha corresponden las posiciones");
    expect(res.written).toBe(true);
  }, 30_000);
});
