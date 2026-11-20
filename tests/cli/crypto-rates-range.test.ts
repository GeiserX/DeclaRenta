/**
 * Issue #470: a --crypto-rates value no price reaches ("1e1000000000") is
 * left out, and the CLI says which. decimal.js reads it as finite, and a sale
 * valued with it ran `convert` out of memory. The file holds only SOL trades,
 * so no ECB request is made.
 */

import { join } from "path";
import { describe, expect, it } from "vitest";
import { runCli, tempFiles } from "./run-cli.js";

const trade = (side: "BUY" | "SELL", date: string, qty: string): string =>
  `<Trade tradeID="${date}" accountId="U1" symbol="BTC" description="BITCOIN" conid="4531" isin="" assetCategory="CRYPTO" currency="SOL" tradeDate="${date}" settlementDate="${date}" quantity="${qty}" tradePrice="10" tradeMoney="0" proceeds="0" cost="0" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}" exchange="PAXOS" ibCommissionCurrency="SOL" ibCommission="0" taxes="0" multiplier="1" />`;

const dir = tempFiles({
  "sol.xml": `<?xml version="1.0" encoding="UTF-8"?><FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20250101" toDate="20251231" period="Custom"><Trades>${trade("BUY", "20250115", "10")}${trade("SELL", "20250601", "-10")}</Trades></FlexStatement></FlexStatements></FlexQueryResponse>`,
});

/** Box 1633 of the JSON `convert` prints. */
const box1633 = (stdout: string): string =>
  (JSON.parse(stdout) as { casillas: Record<string, string> }).casillas["1633_valor_transmision_otros"]!;

const rates = (sale: string): string =>
  JSON.stringify([{ currency: "SOL", date: "2025-01-15", eurPerUnit: "150" }, { currency: "SOL", date: "2025-06-01", eurPerUnit: sale }]);

describe("CLI --crypto-rates out of range (#470)", () => {
  it("a rate of 180 values the sale (control)", () => {
    const res = runCli(["convert", "-i", join(dir, "sol.xml"), "-y", "2025", "--crypto-rates", rates("180")]);
    expect(res.status).toBe(0);
    expect(box1633(res.stdout)).toBe("18000.00");
    expect(res.stderr).not.toContain("no se usan");
  }, 60_000);

  it("a rate of 1e1000000000 is left out and named; the sale is named as unvalued", () => {
    const res = runCli(["convert", "-i", join(dir, "sol.xml"), "-y", "2025", "--crypto-rates", rates("1e1000000000")]);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("1 tipo(s) de --crypto-rates no se usan porque su valor no es un precio válido: SOL 2025-06-01");
    expect(res.stderr).toContain("cuyo valor en euros no se ha podido determinar");
    expect(box1633(res.stdout)).toBe("0.00");
  }, 60_000);
});
