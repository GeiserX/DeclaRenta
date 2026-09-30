/**
 * Shared helpers for the CLI tests: an all-EUR IBKR Flex Query fixture (no ECB
 * request is made for EUR) and a runner that spawns `src/cli/index.ts` through tsx.
 */

import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "src/cli/index.ts");

export interface FixturePosition {
  isin: string;
  symbol: string;
  value: string;
}

/** IBKR Flex Query ending 31/12/2025 with the given EUR positions (100 shares each). */
export function flexXml(accountId: string, positions: FixturePosition[]): string {
  const rows = positions
    .map(
      (p) => `        <OpenPosition accountId="${accountId}" symbol="${p.symbol}" description="${p.symbol} SA"
                      isin="${p.isin}" currency="EUR" assetCategory="STK"
                      quantity="100" costBasisMoney="${p.value}" costBasisPrice="1"
                      markPrice="1" positionValue="${p.value}" fifoPnlUnrealized="0" />`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="${accountId}" fromDate="20250101" toDate="20251231" period="">
      <OpenPositions>
${rows}
      </OpenPositions>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>
`;
}

/** Temporary directory with the given files written into it. Returns the directory. */
export function tempFiles(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "declarenta-cli-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

/** Runs the CLI. stdout is decoded as latin1 (the 720 file is ISO-8859-15), stderr as UTF-8. */
export function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], { cwd: ROOT });
  return { status: res.status, stdout: res.stdout.toString("latin1"), stderr: res.stderr.toString("utf-8") };
}
