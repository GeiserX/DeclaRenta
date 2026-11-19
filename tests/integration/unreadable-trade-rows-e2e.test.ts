/**
 * A Revolut sale or dividend is never dropped for a bad FX Rate cell (#466).
 * Every case runs the real broker input through the real parser and
 * generateTaxReport, in the three FX methods.
 *
 * - #466: Revolut checked its FX Rate cell before it knew the row type, so a
 *   bad cell deleted a sale or a dividend that never reads it.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import * as XLSX from "xlsx";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { parseRevolutXlsx } from "../../src/parsers/revolut.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { FxMethod, TaxSummary as TaxReport } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Statement } from "../../src/types/broker.js";

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];
const ISIN = "ES0000004531";

function rates(): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86_400_000) {
    map.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "1.10"]]));
  }
  return map;
}

function xlsx(sheet: string, rows: string[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function run(parts: [Statement, string][], year: number, method: FxMethod): TaxReport {
  const statement = createEmptyStatement();
  for (const [part, broker] of parts) mergeStatement(statement, part, broker);
  return generateTaxReport(finalizeMergedStatement(statement), rates(), year, reportOptionsForMethod(method));
}

// The #453 issue file at IBKR: buy 100 at 10 € on 01/03/2025, sell 50 at 8 €
// on 15/03/2025 (a 100 € loss), 50 listed at the year end. The window starts
// on 15/01/2025. Another broker's buy of the same security on 02/12/2024,
// never sold, is held at the window start.
let seq = 0;
function ibTrade(date: string, side: "BUY" | "SELL", qty: number, price: number): string {
  const money = new Decimal(qty).mul(price);
  seq++;
  return `<Trade tradeID="${seq}" accountId="U1" symbol="XYZ" description="XYZ SA" conid="4531" isin="${ISIN}" assetCategory="STK" currency="EUR" tradeDate="${date}" settlementDate="${date}" quantity="${side === "BUY" ? qty : -qty}" tradePrice="${price}" tradeMoney="${side === "BUY" ? money : money.neg()}" proceeds="${side === "BUY" ? money.neg() : money}" cost="${money}" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}" exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" multiplier="1" />`;
}
const IB_ISSUE = `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20240101" toDate="20251231" period="Custom"><Trades>${ibTrade("20250301", "BUY", 100, 10)}${ibTrade("20250315", "SELL", 50, 8)}</Trades><CashTransactions /><CorporateActions /><OpenPositions><OpenPosition accountId="U1" symbol="XYZ" description="XYZ SA" conid="4531" isin="${ISIN}" currency="EUR" assetCategory="STK" position="50" costBasisMoney="0" costBasisPrice="0" markPrice="10" positionValue="0" fifoPnlUnrealized="0" fxRateToBase="1" side="Long" levelOfDetail="SUMMARY" /></OpenPositions><SecuritiesInfo /></FlexStatement></FlexStatements></FlexQueryResponse>`;

/** The IBKR sale of 15/03/2025 next to another broker's file. */
function issueSale(other: Statement, broker: string, method: FxMethod): { blocked: string; singlePurchase: string | undefined } {
  const r = run([[parseIbkrFlexXml(IB_ISSUE), "Interactive Brokers"], [other, broker]], 2025, method);
  const sale = r.capitalGains.disposals.find((d) => d.isin === ISIN)!;
  return { blocked: r.capitalGains.blockedLosses.toFixed(2), singlePurchase: sale.washSaleSinglePurchase };
}

const REV_H = ["Date", "Ticker", "Type", "Quantity", "Price per share", "Total Amount", "Currency", "FX Rate"];
const revolut = (...rows: string[][]): Promise<Statement> => parseRevolutXlsx(xlsx("Sheet1", [REV_H, ...rows]));

describe("#466 Revolut: a bad FX Rate cell drops only a cash row, never a sale or a dividend", () => {
  // BUY 10 AAPL for USD 1000, SELL 10 for USD 1500, at 1.10 USD/EUR: the sale
  // transmits 1650 € and gains 550 €; a USD 110 dividend is 121 €.
  const buy = ["2025-01-10T10:00:00Z", "AAPL", "BUY - MARKET", "10", "USD 100", "USD 1000", "USD", "0.91"];
  const sell = (fx: string): string[] => ["2025-06-10T10:00:00Z", "AAPL", "SELL - MARKET", "10", "USD 150", "USD 1500", "USD", fx];
  const dividend = (fx: string): string[] => ["2025-05-15T10:00:00Z", "AAPL", "DIVIDEND", "", "", "USD 110", "USD", fx];

  describe.each(["0", "N/A", "-0.92", ""])("FX Rate %j on the sale and the dividend", (fx) => {
    it.each(METHODS)("[%s] the sale keeps its 550 € gain and the dividend its 121 €", async (method) => {
      const parsed = await revolut(buy, dividend(fx), sell(fx));
      const r = run([[parsed, "Revolut"]], 2025, method);
      expect(r.capitalGains.disposals).toHaveLength(1);
      expect(r.capitalGains.transmissionValue.toFixed(2)).toBe("1650.00");
      expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("550.00");
      expect(r.dividends.grossIncome.toFixed(2)).toBe("121.00");
      expect(parsed.parserMessages?.some((m) => m.id === "revolut.bad_fx_rate") ?? false).toBe(false);
    });
  });

  it("a cash top-up with a bad FX Rate is still skipped, and named by date and amount", async () => {
    const parsed = await revolut(
      ["2025-01-02T10:00:00Z", "", "CASH TOP-UP", "", "", "USD 100", "USD", "0"],
      ["2025-01-03T10:00:00Z", "", "CASH WITHDRAWAL", "", "", "USD -20", "USD", "abc"],
      ["2025-01-04T10:00:00Z", "", "CASH TOP-UP", "", "", "USD 50", "USD", "1.10"],
    );
    expect(parsed.cashTransactions.map((c) => [c.dateTime, c.amount])).toEqual([["20250104", "50"]]);
    const warning = parsed.parserMessages?.find((m) => m.id === "revolut.bad_fx_rate");
    expect([warning?.severity, warning?.context?.count, warning?.context?.rows]).toEqual([
      "warning", "2", '20250102 USD 100 [FX Rate: "0"]; 20250103 USD -20 [FX Rate: "abc"]',
    ]);
  });

  it.each(METHODS)("[%s] the #467 example: a Revolut buy of XYZ with FX Rate 0, held at the window start, keeps the exception unproven", async (method) => {
    const parsed = await revolut(["2024-10-01T10:00:00.000Z", "XYZ", "BUY - MARKET", "40", "USD 10", "USD 400", "USD", "0"]);
    expect(parsed.trades.map((t) => [t.symbol, t.quantity])).toEqual([["XYZ", "40"]]);
    expect(issueSale(parsed, "Revolut", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
  });
});
