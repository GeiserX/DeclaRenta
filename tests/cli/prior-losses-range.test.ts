/**
 * Issue #470: a --prior-losses amount no real loss reaches is left out, and
 * the CLI says which entry. decimal.js reads "1e1000000000" as finite, and an
 * expired loss of that size ran `convert` out of memory (the carryforward
 * printed it in full); 1e2000 printed a 2000-digit line. Leaving a loss out
 * can only raise the tax. The file holds only EUR trades, so no ECB request is
 * made.
 */

import { join } from "path";
import { describe, expect, it } from "vitest";
import { runCli, tempFiles } from "./run-cli.js";

const trade = (id: string, side: "BUY" | "SELL", date: string, qty: string, price: string): string =>
  `<Trade tradeID="${id}" accountId="U1" symbol="AAA" description="AAA SA" conid="19" isin="ES0000000001" assetCategory="STK" currency="EUR" tradeDate="${date}" settlementDate="${date}" quantity="${qty}" tradePrice="${price}" tradeMoney="0" proceeds="0" cost="0" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}" exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" multiplier="1" />`;

/** One sale with a gain of 300 € in 2025. */
const dir = tempFiles({
  "f.xml": `<?xml version="1.0" encoding="UTF-8"?><FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20250101" toDate="20251231" period="Custom"><Trades>${trade("1", "BUY", "20250110", "10", "10")}${trade("2", "SELL", "20250210", "-10", "40")}</Trades></FlexStatement></FlexStatements></FlexQueryResponse>`,
});

const loss = (year: number, value: string) => ({ year, amount: value, remaining: value, category: "gains" });

function convert(losses: object[]) {
  const file = join(tempFiles({ "prior.json": JSON.stringify(losses) }), "prior.json");
  return runCli(["convert", "-i", join(dir, "f.xml"), "-y", "2025", "--prior-losses", file]);
}

const SKIPPED = "Aviso: se ha omitido una entrada de --prior-losses con un importe que llega a un billón de euros";
const longestLine = (text: string): number => Math.max(...text.split("\n").map((l) => l.length));

describe("CLI --prior-losses out of range (#470)", () => {
  it("ordinary losses are used and an expired one is reported (control)", () => {
    const res = convert([loss(2023, "100"), loss(2019, "50")]);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("Compensación ganancias con pérdida 2023: 100.00 EUR");
    expect(res.stderr).toContain("Pérdida de 2019 expirada: 50.00 EUR");
    expect(res.stderr).not.toContain(SKIPPED);
  }, 60_000);

  it("999,999,999,999.99 € is still a loss (boundary)", () => {
    const res = convert([loss(2019, "999999999999.99")]);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("Pérdida de 2019 expirada: 999999999999.99 EUR");
    expect(res.stderr).not.toContain(SKIPPED);
  }, 60_000);

  it("a billion euros, 1e2000 and 1e1000000000 are left out and named, expired or not", () => {
    const res = convert([
      loss(2019, "1000000000000"),
      loss(2020, "1e2000"),
      loss(2019, "1e1000000000"),
      { ...loss(2023, "100"), remaining: "-1e1000000000" },
      loss(2024, "40"),
    ]);
    expect(res.status).toBe(0);
    for (const year of [2019, 2020, 2023]) expect(res.stderr).toContain(`${SKIPPED} (year ${year}). Revisa el fichero.`);
    expect(res.stderr.split(SKIPPED)).toHaveLength(5);
    expect(res.stderr).not.toContain("expirada");
    expect(res.stderr).toContain("Compensación ganancias con pérdida 2024: 40.00 EUR");
    expect(res.stderr).toContain("Total compensado: 40.00 EUR");
    expect(longestLine(res.stderr)).toBeLessThan(500);
  }, 120_000);
});
