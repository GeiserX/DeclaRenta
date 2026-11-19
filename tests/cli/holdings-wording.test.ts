/**
 * Issue #470: the CLI's own texts for a holding with no valid share count say
 * what the web texts say. A 0 next to a value is a number the file does give,
 * so the CLI must not call it unreadable («legible»).
 */

import { join } from "path";
import { describe, expect, it } from "vitest";
import { runCli, tempFiles } from "./run-cli.js";

const row = (symbol: string, isin: string, position: string, value: string): string =>
  `<OpenPosition accountId="U1111111" symbol="${symbol}" description="${symbol} SA" isin="${isin}" currency="EUR" assetCategory="STK" position="${position}" markPrice="1" positionValue="${value}" costBasisMoney="${value}" levelOfDetail="SUMMARY" />`;

const dir = tempFiles({
  "f.xml": `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF"><FlexStatements count="1">
<FlexStatement accountId="U1111111" fromDate="20250101" toDate="20251231" period="">
<OpenPositions>${row("SAP", "DE0007164600", "0", "60000")}${row("DBK", "DE0005140008", "100", "70000")}</OpenPositions>
</FlexStatement></FlexStatements></FlexQueryResponse>
`,
});
const base = ["-y", "2025", "--nif", "12345678Z", "--name", "Apellido, Nombre"];

describe("CLI texts for a 0 next to a value (#470)", () => {
  it("modelo720: the omission says the number is not valid, never that it is unreadable", () => {
    const res = runCli(["modelo720", "-i", join(dir, "f.xml"), ...base]);
    expect(res.stderr).toContain("Posición SAP no tiene un número de valores válido (falta, no se lee o es un 0 junto a un valor");
    expect(res.stderr).not.toContain("legible");
  }, 60_000);

  it("d6: the warning says the share count is not valid", () => {
    const res = runCli(["d6", "-i", join(dir, "f.xml"), ...base, "--format", "json", "-o", join(dir, "d6.json")]);
    expect(res.stderr).toContain("sin número de títulos válido");
    expect(res.stderr).not.toContain("legible");
  }, 60_000);
});
