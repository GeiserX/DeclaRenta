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

// Round 5 of #470: the CLI prints the parser's own holdings warnings for the
// 720 and the D-6 (before, only merge.holdings_other_date), and its «sin
// valorar» lines name each holding and give every reason.
const unvaluedDir = tempFiles({
  "u.xml": `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF"><FlexStatements count="1">
<FlexStatement accountId="U1111111" fromDate="20250101" toDate="20251231" period="">
<OpenPositions>${row("SAP", "DE0007164600", "-700", "60000")}${row("DBK", "DE0005140008", "0", "N/A")}${row("ALV", "DE0008404005", "100", "NaN")}${row("BAS", "DE000BASF111", "100", "70000")}</OpenPositions>
<CashReport><CashReportCurrency accountId="U1111111" currency="EUR" levelOfDetail="Currency" endingCash="N/A" averageQ4Cash="0" /></CashReport>
</FlexStatement></FlexStatements></FlexQueryResponse>
`,
});

describe("CLI holdings warnings and unvalued names (#470)", () => {
  it("modelo720: prints the parser's holdings and cash warnings, and names each unvalued holding with every reason", () => {
    const res = runCli(["modelo720", "-i", join(unvaluedDir, "u.xml"), ...base, "-o", join(unvaluedDir, "720.txt")]);
    expect(res.stderr).toContain("IBKR da un número de acciones o unidades y un valor de signo contrario para 1 posición(es) abierta(s): SAP (DE0007164600).");
    expect(res.stderr).toContain("IBKR da 0 acciones para 1 posición(es) abierta(s) sin un valor legible que lo confirme: DBK (DE0005140008).");
    expect(res.stderr).toContain("IBKR no da un saldo final legible para 1 saldo(s) en efectivo: U1111111 (EUR).");
    expect(res.stderr).toContain("Aviso: 3 posición(es) en valores sin valorar en euros: SAP (DE0007164600), DBK (DE0005140008), ALV (DE0008404005).");
    expect(res.stderr).toContain("signos contrarios");
    expect(res.stderr).toContain("12 cifras enteras");
    expect(res.stderr).toContain("un 0 que ningún valor confirma");
  }, 60_000);

  it("d6: prints the parser's holdings warnings (never the cash one), and names each holding left out", () => {
    const res = runCli(["d6", "-i", join(unvaluedDir, "u.xml"), ...base, "--format", "json", "-o", join(unvaluedDir, "d6.json")]);
    expect(res.stderr).toContain("IBKR da un número de acciones o unidades y un valor de signo contrario para 1 posición(es) abierta(s): SAP (DE0007164600).");
    expect(res.stderr).toContain("IBKR da 0 acciones para 1 posición(es) abierta(s) sin un valor legible que lo confirme: DBK (DE0005140008).");
    expect(res.stderr).not.toContain("saldo final legible");
    expect(res.stderr).toContain("Aviso: 3 posición(es) extranjera(s) sin valorar o sin número de títulos válido: SAP SA (DE0007164600), DBK SA (DE0005140008), ALV SA (DE0008404005).");
    expect(res.stderr).toContain("signos contrarios");
    expect(res.stderr).toContain("12 cifras enteras");
  }, 60_000);
});
