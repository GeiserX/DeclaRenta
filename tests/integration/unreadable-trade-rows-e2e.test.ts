/**
 * A trade row a parser cannot read is kept, never dropped (#466, #467). Every
 * case runs the real broker input through the real parser and
 * generateTaxReport, in the three FX methods.
 *
 * - #466: Revolut checked its FX Rate cell before it knew the row type, so a
 *   bad cell deleted a sale or a dividend that never reads it.
 * - #467: a buy or sale row with an unreadable date, ticker, ISIN, amount or
 *   type was dropped, so the anti-churning one-purchase exception (#453) was
 *   applied with no proof. It is now a trade that books nothing
 *   (`quantityUnknown`, `unreadableRow`), named by `parser.trade_row_unreadable`.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import * as XLSX from "xlsx";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { degiroParser } from "../../src/parsers/degiro.js";
import { parseRevolutXlsx } from "../../src/parsers/revolut.js";
import { trading212Parser } from "../../src/parsers/trading212.js";
import { lightyearParser } from "../../src/parsers/lightyear.js";
import { scalableParser } from "../../src/parsers/scalable.js";
import { flatexParser } from "../../src/parsers/flatex.js";
import { tradeRepublicParser } from "../../src/parsers/trade-republic.js";
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

const unreadableRows = (s: Statement): string | undefined =>
  s.parserMessages?.find((m) => m.id === "parser.trade_row_unreadable")?.context?.rows;

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

// One row per broker: a buy of the security on 02/12/2024 with one cell that
// cannot be read. Each is kept as a trade that books nothing, named, and the
// IBKR sale's one-purchase exception stays unproven; the readable row is the
// control (shares held at the window start: blocked, never applied).
interface Case {
  broker: string;
  label: string;
  parse: () => Statement | Promise<Statement>;
  /** What the warning names: security, date, cell. */
  row: string;
}
const T212_H = "Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Notes,ID";
const T212_DATED = "Dividend (Ordinary),2024-11-01 00:00:00,US0378331005,AAPL,Apple Inc,,,USD,0.92,,,2.35,USD,,div1";
const LY_H = "Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.";
const LY_DATED = "01/11/2024 09:00:00,DV-1,AAPL,US0378331005,Dividend,,USD,,5,0.92,0,5,0";
const SC_H = "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency";
const FX_H = "Nummer;Buchtag;Valuta;ISIN;Bezeichnung;Nominal;;Buchungsinformationen;TA-Nr.;Kurs;;Depot";
const TR_H = '"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency","original_amount","original_currency","fx_rate","description","transaction_id","counterparty_name","counterparty_iban","payment_reference","mcc_code"';
const DG_H = "Date,Time,Product,ISIN,Reference Exchange,Execution Venue,Quantity,Price,,Value,,Transaction and/or third,,Total,,Order ID";
const REV_A = ["Date acquired", "Date sold", "Symbol", "Quantity", "Cost basis", "Gross proceeds", "Gross PnL", "Fees", "Net PnL", "Currency"];
const REV_CASH = ["2024-11-01T10:00:00.000Z", "", "CASH TOP-UP", "", "", "USD 500", "USD", "1"];

const cases: Case[] = [
  { broker: "Revolut", label: "type 'BUY - STOP'", row: 'XYZ 20241202 [Type: "BUY - STOP"]', parse: () => revolut(["2024-12-02T10:00:00.000Z", "XYZ", "BUY - STOP", "40", "USD 10", "USD 400", "USD", "0.92"]) },
  { broker: "Revolut", label: "type 'SPINOFF' of 40 shares", row: 'XYZ 20241202 [Type: "SPINOFF"]', parse: () => revolut(["2024-12-02T10:00:00.000Z", "XYZ", "SPINOFF", "40", "", "USD 0", "USD", "0.92"]) },
  { broker: "Revolut", label: "empty Date", row: 'XYZ [Date: ""]', parse: () => revolut(REV_CASH, ["", "XYZ", "BUY - MARKET", "40", "USD 10", "USD 400", "USD", "0.92"]) },
  { broker: "Revolut", label: "closed position with an empty Symbol", row: '— 20241202 [Symbol: ""]', parse: () => parseRevolutXlsx(xlsx("Sheet1", [REV_A, ["2024-12-02", "2025-02-10", "", "40", "400", "440", "40", "0", "40", "USD"]])) },
  { broker: "Trading 212", label: "empty Ticker with an ISIN", row: `${ISIN} 20241202 [Ticker: ""]`, parse: () => trading212Parser.parse([T212_H, `Market buy,2024-12-02 09:30:00,${ISIN},,XYZ SA,40,10,EUR,1.00,,,400,EUR,,t1`].join("\n")) },
  { broker: "Trading 212", label: "empty Time", row: `XYZ (${ISIN}) [Time: ""]`, parse: () => trading212Parser.parse([T212_H, T212_DATED, `Market buy,,${ISIN},XYZ,XYZ SA,40,10,EUR,1.00,,,400,EUR,,t1`].join("\n")) },
  { broker: "Trading 212", label: "action 'Stock split open'", row: `XYZ (${ISIN}) 20241202 [Action: "Stock split open"]`, parse: () => trading212Parser.parse([T212_H, `Stock split open,2024-12-02 09:30:00,${ISIN},XYZ,XYZ SA,40,10,EUR,1.00,,,0,EUR,,t1`].join("\n")) },
  { broker: "Lightyear", label: "empty Ticker with an ISIN", row: `${ISIN} 20241202 [Ticker: ""]`, parse: () => lightyearParser.parse([LY_H, `02/12/2024 09:30:00,OR-1,,${ISIN},Buy,40,EUR,10.00,400.00,,0.00,400.00,`].join("\n")) },
  { broker: "Lightyear", label: "empty Date", row: `XYZ (${ISIN}) [Date: ""]`, parse: () => lightyearParser.parse([LY_H, LY_DATED, `,OR-1,XYZ,${ISIN},Buy,40,EUR,10.00,400.00,,0.00,400.00,`].join("\n")) },
  { broker: "Lightyear", label: "type 'Transfer in'", row: `XYZ (${ISIN}) 20241202 [Type: "Transfer in"]`, parse: () => lightyearParser.parse([LY_H, `02/12/2024 09:30:00,OR-1,XYZ,${ISIN},Transfer in,40,EUR,10.00,400.00,,0.00,400.00,`].join("\n")) },
  { broker: "Scalable Capital", label: "type 'Security transfer'", row: `XYZ SA (${ISIN}) 20241202 [type: "Security transfer"]`, parse: () => scalableParser.parse([SC_H, `2024-12-02;09:15;Executed;REF001;XYZ SA;Security;Security transfer;${ISIN};40;10,00;-400,00;0;0;EUR`].join("\n")) },
  { broker: "Scalable Capital", label: "empty ISIN", row: 'XYZ SA 20241202 [isin: ""]', parse: () => scalableParser.parse([SC_H, "2024-12-02;09:15;Executed;REF001;XYZ SA;Security;Buy;;40;10,00;-400,00;0;0;EUR"].join("\n")) },
  { broker: "Trade Republic", label: "empty amount", row: `XYZ SA (${ISIN}) 20241202 [amount: ""]`, parse: () => tradeRepublicParser.parse([TR_H, `"2024-12-02T09:30:00.000Z","2024-12-02","DEFAULT","TRADING","BUY","STOCK","XYZ SA","${ISIN}","40","10.000000","","","","EUR","","","","Buy","tx-1","","","",""`].join("\n")) },
  { broker: "Trade Republic", label: "trading type 'SAVINGS_PLAN_REVERSAL'", row: `XYZ SA (${ISIN}) 20241202 [type: "SAVINGS_PLAN_REVERSAL"]`, parse: () => tradeRepublicParser.parse([TR_H, `"2024-12-02T09:30:00.000Z","2024-12-02","DEFAULT","TRADING","SAVINGS_PLAN_REVERSAL","STOCK","XYZ SA","${ISIN}","40","10.000000","-400.00","","","EUR","","","","Buy","tx-1","","","",""`].join("\n")) },
  { broker: "DEGIRO", label: "empty ISIN", row: 'XYZ SA 20241202 [ISIN: ""]', parse: () => degiroParser.parse([DG_H, "02-12-2024,09:15,XYZ SA,,MAD,XMAD,40,10.00,EUR,-400.00,EUR,0,EUR,-400.00,EUR,aaa"].join("\n")) },
  { broker: "Scalable Capital", label: "date '2024-12-45'", row: `XYZ SA (${ISIN}) [date: "20241245"]`, parse: () => scalableParser.parse([SC_H, "2024-11-01;09:15;Executed;REF000;OTHER SA;Security;Buy;ES0000009999;1;1,00;-1,00;0;0;EUR", `2024-12-45;09:15;Executed;REF001;XYZ SA;Security;Buy;${ISIN};40;10,00;-400,00;0;0;EUR`].join("\n")) },
  { broker: "DEGIRO", label: "Date '31-02-2024'", row: `XYZ SA (${ISIN}) [Date: "20240231"]`, parse: () => degiroParser.parse([DG_H, "01-11-2024,09:15,OTHER SA,ES0000009999,MAD,XMAD,1,1.00,EUR,-1.00,EUR,0,EUR,-1.00,EUR,aa0", `31-02-2024,09:15,XYZ SA,${ISIN},MAD,XMAD,40,10.00,EUR,-400.00,EUR,0,EUR,-400.00,EUR,aaa`].join("\n")) },
  { broker: "Trade Republic", label: "date '<b>'", row: `XYZ SA (${ISIN}) [date: "<b>"]`, parse: () => tradeRepublicParser.parse([TR_H, `"2024-11-01T09:30:00.000Z","2024-11-01","DEFAULT","TRADING","BUY","STOCK","OTHER SA","ES0000009999","1","1.000000","-1.00","","","EUR","","","","Buy","tx-0","","","",""`, `"<b>","<b>","DEFAULT","TRADING","BUY","STOCK","XYZ SA","${ISIN}","40","10.000000","-400.00","","","EUR","","","","Buy","tx-1","","","",""`].join("\n")) },
];

describe("#467 a trade row that cannot be read is kept as a trade that books nothing, never dropped", () => {
  describe.each(cases)("$broker, $label", ({ broker, parse, row }) => {
    it("the parser keeps it with no shares and no money, and the warning names it", async () => {
      const parsed = await parse();
      const kept = parsed.trades.filter((t) => t.unreadableRow !== undefined);
      expect(kept.length).toBeGreaterThan(0);
      for (const t of kept) {
        expect([t.quantity, t.quantityUnknown, t.tradeMoney, t.proceeds, t.cost, t.commission]).toEqual(["0", true, "0", "0", "0", "0"]);
        expect(t.tradeDate).toMatch(/^\d{8}$/);
      }
      expect(kept[0]!.unreadableRow).toBe(row);
      expect(unreadableRows(parsed)).toContain(row);
      const warning = parsed.parserMessages?.find((m) => m.id === "parser.trade_row_unreadable");
      expect([warning?.severity, warning?.context?.broker, warning?.context?.count]).toEqual(["warning", broker, String(kept.length)]);
      // Never double-listed as a row of unknown quantity.
      expect(parsed.parserMessages?.some((m) => m.id === "parser.trade_quantity_unknown") ?? false).toBe(false);
    });

    it.each(METHODS)("[%s] next to the IBKR issue file: the one-purchase exception is not applied, the 100 € stay blocked", async (method) => {
      expect(issueSale(await parse(), broker, method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
    });
  });

  it.each(METHODS)("[%s] control: with no other broker the exception is applied (the check can go the other way)", (method) => {
    const r = run([[parseIbkrFlexXml(IB_ISSUE), "Interactive Brokers"]], 2025, method);
    expect([r.capitalGains.blockedLosses.toFixed(2), r.capitalGains.disposals[0]!.washSaleSinglePurchase]).toEqual(["0.00", "applied"]);
  });

  it.each([
    ["Revolut", () => revolut(["2024-12-02T10:00:00.000Z", "XYZ", "BUY - MARKET", "40", "USD 10", "USD 400", "USD", "0.92"])],
    ["Trading 212", () => trading212Parser.parse([T212_H, `Market buy,2024-12-02 09:30:00,${ISIN},XYZ,XYZ SA,40,10,EUR,1.00,,,400,EUR,,t1`].join("\n"))],
    ["Lightyear", () => lightyearParser.parse([LY_H, `02/12/2024 09:30:00,OR-1,XYZ,${ISIN},Buy,40,EUR,10.00,400.00,,0.00,400.00,`].join("\n"))],
    ["Flatex", () => flatexParser.parse([FX_H, `1;02.12.2024;02.12.2024;${ISIN};XYZ SA;40;Stk.;Ausführung ORDER Kauf ${ISIN} 1;1;10,00;EUR;***xxx Depot`].join("\n"))],
    ["DEGIRO", () => degiroParser.parse([DG_H, `02-12-2024,09:15,XYZ SA,${ISIN},MAD,XMAD,40,10.00,EUR,-400.00,EUR,0,EUR,-400.00,EUR,aaa`].join("\n"))],
  ] as [string, () => Statement | Promise<Statement>][])("control, %s: the readable row is a holding at the window start, with no warning", async (broker, parse) => {
    const parsed = await parse();
    expect(parsed.trades.every((t) => t.unreadableRow === undefined && t.quantityUnknown !== true)).toBe(true);
    expect(unreadableRows(parsed)).toBeUndefined();
    expect(issueSale(parsed, broker, "monodivisa").blocked).toBe("100.00");
  });

  it("a row with no readable date takes the file's earliest date; a file with none is refused", async () => {
    const parsed = await revolut(["", "XYZ", "BUY - MARKET", "40", "USD 10", "USD 400", "USD", "1"], ["2025-03-01T10:00:00Z", "ACME", "BUY - MARKET", "1", "USD 1", "USD 1", "USD", "1"], REV_CASH);
    expect(parsed.trades.map((t) => [t.symbol, t.tradeDate, t.quantityUnknown ?? false])).toEqual([["XYZ", "20241101", true], ["ACME", "20250301", false]]);
    await expect(revolut(["", "XYZ", "BUY - MARKET", "40", "USD 10", "USD 400", "USD", "1"])).rejects.toThrow(/fecha legible/);
  });

  it("controls: a row that names no security and no trade stays skipped with no warning", async () => {
    const parsed = await revolut(["2025-01-02T10:00:00Z", "", "REWARD", "", "", "USD 1", "USD", "1"]);
    expect([parsed.trades, unreadableRows(parsed)]).toEqual([[], undefined]);
    const t212 = trading212Parser.parse([T212_H, "Lending interest,2024-12-02 09:30:00,,,,,,,,,,1,EUR,,l1"].join("\n"));
    expect([t212.trades, unreadableRows(t212)]).toEqual([[], undefined]);
  });

  it("controls: a row of an unknown type that writes a zero quantity moves no shares and stays skipped", async () => {
    expect((await revolut(["2024-12-02T10:00:00.000Z", "XYZ", "CUSTODY FEE", "0", "", "USD -1", "USD", "1"])).trades).toEqual([]);
    expect(trading212Parser.parse([T212_H, `Stock split open,2024-12-02 09:30:00,${ISIN},XYZ,XYZ SA,0,10,EUR,1.00,,,0,EUR,,t1`].join("\n")).trades).toEqual([]);
    expect(scalableParser.parse([SC_H, `2024-12-02;09:15;Executed;REF001;XYZ SA;Security;Taxes;${ISIN};0;0;-3,00;0;0;EUR`].join("\n")).trades).toEqual([]);
  });
});

describe("#470 sibling: a Revolut crypto buy of unknown size leaves a holding of unknown size", () => {
  it("the inferred BTC holding is flagged, never the readable 0.1 as if complete", async () => {
    const parsed = await revolut(
      ["2025-03-01T10:00:00Z", "BTC", "BUY - MARKET", "0.1", "USD 60000", "USD 6000", "USD", "1"],
      ["2025-04-01T10:00:00Z", "BTC", "BUY - MARKET", "", "USD 60000", "USD 50000", "USD", "1"],
      ["2025-04-02T10:00:00Z", "ETH", "BUY - MARKET", "2", "USD 2000", "USD 4000", "USD", "1"],
    );
    expect(parsed.openPositions.map((p) => [p.symbol, p.assetCategory, p.quantity, p.quantityUnknown ?? false])).toEqual([
      ["BTC", "CRYPTO", "0", true],
      ["ETH", "CRYPTO", "2", false],
    ]);
    expect(parsed.trades.find((t) => t.quantityUnknown)?.quantity).toBe("0");
    expect(parsed.parserMessages?.map((m) => m.id)).toContain("parser.crypto_quantity_unknown");
  });

  it("an unreadable sale row also leaves the holding unknown; a ticker with only an unknown sale gets none", async () => {
    const parsed = await revolut(
      ["2025-03-01T10:00:00Z", "BTC", "BUY - MARKET", "0.1", "USD 60000", "USD 6000", "USD", "1"],
      ["2025-04-01T10:00:00Z", "BTC", "SELL - MARKET", "abc", "USD 60000", "USD 600", "USD", "1"],
      ["2025-04-02T10:00:00Z", "ETH", "SELL - MARKET", "", "USD 2000", "USD 4000", "USD", "1"],
    );
    expect(parsed.openPositions.map((p) => [p.symbol, p.quantity, p.quantityUnknown ?? false])).toEqual([["BTC", "0", true]]);
  });
});
