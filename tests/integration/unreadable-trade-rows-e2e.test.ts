/**
 * A trade row a parser cannot read is kept, never dropped and never booked as
 * a buy (#466, #467, #468). Every case runs the real broker input through the
 * real parser and generateTaxReport, in the three FX methods.
 *
 * - #466: Revolut checked its FX Rate cell before it knew the row type, so a
 *   bad cell deleted a sale or a dividend that never reads it.
 * - #467: a buy or sale row with an unreadable date, ticker, ISIN, amount or
 *   type was dropped, so the anti-churning one-purchase exception (#453) was
 *   applied with no proof. It is now a trade that books nothing
 *   (`quantityUnknown`, `unreadableRow`), named by `parser.trade_row_unreadable`.
 * - #468: Freedom24, Kraken, IBKR, Flatex and eToro booked a row whose type was
 *   neither a buy nor a sale as a buy (or a long position).
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import * as XLSX from "xlsx";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { degiroParser } from "../../src/parsers/degiro.js";
import { parseRevolutXlsx } from "../../src/parsers/revolut.js";
import { trading212Parser } from "../../src/parsers/trading212.js";
import { freedom24Parser } from "../../src/parsers/freedom24.js";
import { lightyearParser } from "../../src/parsers/lightyear.js";
import { scalableParser } from "../../src/parsers/scalable.js";
import { flatexParser } from "../../src/parsers/flatex.js";
import { tradeRepublicParser } from "../../src/parsers/trade-republic.js";
import { krakenParser } from "../../src/parsers/kraken.js";
import { parseEtoroXlsx } from "../../src/parsers/etoro.js";
import { buildModelo721Entries } from "../../src/generators/modelo721.js";
import { checkModelo720Thresholds } from "../../src/generators/modelo720.js";
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
const f24 = (row: Record<string, unknown>) => (): Statement => freedom24Parser.parse(JSON.stringify({
  trades: { detailed: [{ date: "2024-11-01 10:00:00", ticker: "OTHER.EU", isin: "ES0000009999", operation: "buy", p: 1, q: 1, curr_c: "EUR", commission: 0, amount: 1 }, row] },
  corporate_actions: { detailed: [] },
}));
const F24_ROW = { date: "2024-12-02 10:00:00", ticker: "XYZ.EU", isin: ISIN, operation: "buy", p: 10, q: 40, curr_c: "EUR", commission: 0, amount: 400 };
const LY_H = "Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.";
const LY_DATED = "01/11/2024 09:00:00,DV-1,AAPL,US0378331005,Dividend,,USD,,5,0.92,0,5,0";
const SC_H = "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency";
const FX_H = "Nummer;Buchtag;Valuta;ISIN;Bezeichnung;Nominal;;Buchungsinformationen;TA-Nr.;Kurs;;Depot";
const TR_H = '"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency","original_amount","original_currency","fx_rate","description","transaction_id","counterparty_name","counterparty_iban","payment_reference","mcc_code"';
const DG_H = "Date,Time,Product,ISIN,Reference Exchange,Execution Venue,Quantity,Price,,Value,,Transaction and/or third,,Total,,Order ID";
const ET_H = ["Action", "Amount", "Units", "Open Rate", "Close Rate", "Profit(USD)", "Open Date", "Close Date", "Type", "Leverage", "ISIN"];
const REV_A = ["Date acquired", "Date sold", "Symbol", "Quantity", "Cost basis", "Gross proceeds", "Gross PnL", "Fees", "Net PnL", "Currency"];
const REV_CASH = ["2024-11-01T10:00:00.000Z", "", "CASH TOP-UP", "", "", "USD 500", "USD", "1"];
const KRAKEN_H = `"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers"`;

const cases: Case[] = [
  { broker: "Revolut", label: "type 'BUY - STOP'", row: 'XYZ 20241202 [Type: "BUY - STOP"]', parse: () => revolut(["2024-12-02T10:00:00.000Z", "XYZ", "BUY - STOP", "40", "USD 10", "USD 400", "USD", "0.92"]) },
  { broker: "Revolut", label: "type 'SPINOFF' of 40 shares", row: 'XYZ 20241202 [Type: "SPINOFF"]', parse: () => revolut(["2024-12-02T10:00:00.000Z", "XYZ", "SPINOFF", "40", "", "USD 0", "USD", "0.92"]) },
  { broker: "Revolut", label: "empty Date", row: 'XYZ [Date: ""]', parse: () => revolut(REV_CASH, ["", "XYZ", "BUY - MARKET", "40", "USD 10", "USD 400", "USD", "0.92"]) },
  { broker: "Revolut", label: "closed position with an empty Symbol", row: '— 20241202 [Symbol: ""]', parse: () => parseRevolutXlsx(xlsx("Sheet1", [REV_A, ["2024-12-02", "2025-02-10", "", "40", "400", "440", "40", "0", "40", "USD"]])) },
  { broker: "Trading 212", label: "empty Ticker with an ISIN", row: `${ISIN} 20241202 [Ticker: ""]`, parse: () => trading212Parser.parse([T212_H, `Market buy,2024-12-02 09:30:00,${ISIN},,XYZ SA,40,10,EUR,1.00,,,400,EUR,,t1`].join("\n")) },
  { broker: "Trading 212", label: "empty Time", row: `XYZ (${ISIN}) [Time: ""]`, parse: () => trading212Parser.parse([T212_H, T212_DATED, `Market buy,,${ISIN},XYZ,XYZ SA,40,10,EUR,1.00,,,400,EUR,,t1`].join("\n")) },
  { broker: "Trading 212", label: "action 'Share transfer in'", row: `XYZ (${ISIN}) 20241202 [Action: "Share transfer in"]`, parse: () => trading212Parser.parse([T212_H, `Share transfer in,2024-12-02 09:30:00,${ISIN},XYZ,XYZ SA,40,10,EUR,1.00,,,0,EUR,,t1`].join("\n")) },
  { broker: "Trading 212", label: "action 'Share transfer in' naming only the Name", row: 'XYZ SA 20241202 [Action: "Share transfer in"]', parse: () => trading212Parser.parse([T212_H, "Share transfer in,2024-12-02 09:30:00,,,XYZ SA,40,10,EUR,1.00,,,0,EUR,,t1"].join("\n")) },
  { broker: "Freedom24", label: "date null", row: `XYZ (${ISIN}) [date: null]`, parse: f24({ ...F24_ROW, date: null }) },
  { broker: "Freedom24", label: "ticker null with an ISIN", row: `${ISIN} 20241202 [ticker: null]`, parse: f24({ ...F24_ROW, ticker: null }) },
  { broker: "Lightyear", label: "empty Ticker with an ISIN", row: `${ISIN} 20241202 [Ticker: ""]`, parse: () => lightyearParser.parse([LY_H, `02/12/2024 09:30:00,OR-1,,${ISIN},Buy,40,EUR,10.00,400.00,,0.00,400.00,`].join("\n")) },
  { broker: "Lightyear", label: "empty Date", row: `XYZ (${ISIN}) [Date: ""]`, parse: () => lightyearParser.parse([LY_H, LY_DATED, `,OR-1,XYZ,${ISIN},Buy,40,EUR,10.00,400.00,,0.00,400.00,`].join("\n")) },
  { broker: "Lightyear", label: "type 'Transfer in'", row: `XYZ (${ISIN}) 20241202 [Type: "Transfer in"]`, parse: () => lightyearParser.parse([LY_H, `02/12/2024 09:30:00,OR-1,XYZ,${ISIN},Transfer in,40,EUR,10.00,400.00,,0.00,400.00,`].join("\n")) },
  { broker: "Scalable Capital", label: "type 'Security transfer'", row: `XYZ SA (${ISIN}) 20241202 [type: "Security transfer"]`, parse: () => scalableParser.parse([SC_H, `2024-12-02;09:15;Executed;REF001;XYZ SA;Security;Security transfer;${ISIN};40;10,00;-400,00;0;0;EUR`].join("\n")) },
  { broker: "Scalable Capital", label: "empty ISIN", row: 'XYZ SA 20241202 [isin: ""]', parse: () => scalableParser.parse([SC_H, "2024-12-02;09:15;Executed;REF001;XYZ SA;Security;Buy;;40;10,00;-400,00;0;0;EUR"].join("\n")) },
  { broker: "Flatex", label: "a Kauf with an empty ISIN", row: 'XYZ SA 20241202 [ISIN: ""]', parse: () => flatexParser.parse([FX_H, `1;02.12.2024;02.12.2024;;XYZ SA;40;Stk.;Ausführung ORDER Kauf ${ISIN} 1;1;10,00;EUR;***xxx Depot`].join("\n")) },
  { broker: "Trade Republic", label: "empty amount", row: `XYZ SA (${ISIN}) 20241202 [amount: ""]`, parse: () => tradeRepublicParser.parse([TR_H, `"2024-12-02T09:30:00.000Z","2024-12-02","DEFAULT","TRADING","BUY","STOCK","XYZ SA","${ISIN}","40","10.000000","","","","EUR","","","","Buy","tx-1","","","",""`].join("\n")) },
  { broker: "Trade Republic", label: "trading type 'SAVINGS_PLAN_REVERSAL'", row: `XYZ SA (${ISIN}) 20241202 [type: "SAVINGS_PLAN_REVERSAL"]`, parse: () => tradeRepublicParser.parse([TR_H, `"2024-12-02T09:30:00.000Z","2024-12-02","DEFAULT","TRADING","SAVINGS_PLAN_REVERSAL","STOCK","XYZ SA","${ISIN}","40","10.000000","-400.00","","","EUR","","","","Buy","tx-1","","","",""`].join("\n")) },
  { broker: "DEGIRO", label: "empty ISIN", row: 'XYZ SA 20241202 [ISIN: ""]', parse: () => degiroParser.parse([DG_H, "02-12-2024,09:15,XYZ SA,,MAD,XMAD,40,10.00,EUR,-400.00,EUR,0,EUR,-400.00,EUR,aaa"].join("\n")) },
  { broker: "Scalable Capital", label: "date '2024-12-45'", row: `XYZ SA (${ISIN}) [date: "20241245"]`, parse: () => scalableParser.parse([SC_H, "2024-11-01;09:15;Executed;REF000;OTHER SA;Security;Buy;ES0000009999;1;1,00;-1,00;0;0;EUR", `2024-12-45;09:15;Executed;REF001;XYZ SA;Security;Buy;${ISIN};40;10,00;-400,00;0;0;EUR`].join("\n")) },
  { broker: "DEGIRO", label: "Date '31-02-2024'", row: `XYZ SA (${ISIN}) [Date: "20240231"]`, parse: () => degiroParser.parse([DG_H, "01-11-2024,09:15,OTHER SA,ES0000009999,MAD,XMAD,1,1.00,EUR,-1.00,EUR,0,EUR,-1.00,EUR,aa0", `31-02-2024,09:15,XYZ SA,${ISIN},MAD,XMAD,40,10.00,EUR,-400.00,EUR,0,EUR,-400.00,EUR,aaa`].join("\n")) },
  { broker: "Trade Republic", label: "date '<b>'", row: `XYZ SA (${ISIN}) [date: "<b>"]`, parse: () => tradeRepublicParser.parse([TR_H, `"2024-11-01T09:30:00.000Z","2024-11-01","DEFAULT","TRADING","BUY","STOCK","OTHER SA","ES0000009999","1","1.000000","-1.00","","","EUR","","","","Buy","tx-0","","","",""`, `"<b>","<b>","DEFAULT","TRADING","BUY","STOCK","XYZ SA","${ISIN}","40","10.000000","-400.00","","","EUR","","","","Buy","tx-1","","","",""`].join("\n")) },
  { broker: "Flatex", label: "Buchtag '02.13.2024'", row: `XYZ SA (${ISIN}) [Buchtag: "20241302"]`, parse: () => flatexParser.parse([FX_H, "1;01.11.2024;01.11.2024;ES0000009999;OTHER SA;1;Stk.;Ausführung ORDER Kauf ES0000009999 0;0;1,00;EUR;x", `1;02.13.2024;02.13.2024;${ISIN};XYZ SA;40;Stk.;Ausführung ORDER Kauf ${ISIN} 1;1;10,00;EUR;***xxx Depot`].join("\n")) },
  { broker: "Revolut", label: "BUY - MARKET with an empty Ticker", row: '— 20241202 [Ticker: ""]', parse: () => revolut(["2024-12-02T10:00:00Z", "", "BUY - MARKET", "40", "USD 10", "USD 400", "USD", "0.92"]) },
  { broker: "eToro", label: "empty Action with an ISIN, units and dates", row: `${ISIN} 20241202 [Action: ""]`, parse: () => parseEtoroXlsx(xlsx("Closed Positions", [ET_H, ["", "400", "40", "10", "11", "40", "02/12/2024", "10/02/2025", "Stocks", "1", ISIN]])) },
  { broker: "DEGIRO", label: "empty ISIN, Quantity and Price, with a Value and an Order ID", row: 'XYZ SA 20241202 [ISIN: ""]', parse: () => degiroParser.parse([DG_H, "02-12-2024,09:15,XYZ SA,,MAD,XMAD,,,EUR,-400.00,EUR,0,EUR,-400.00,EUR,aaa"].join("\n")) },
  { broker: "Scalable Capital", label: "type 'Security transfer' with no ISIN", row: 'XYZ SA 20241202 [type: "Security transfer"]', parse: () => scalableParser.parse([SC_H, "2024-12-02;09:15;Executed;REF001;XYZ SA;Security;Security transfer;;40;10,00;-400,00;0;0;EUR"].join("\n")) },
  { broker: "Flatex", label: "a Depotübertrag Eingang with no ISIN", row: 'XYZ SA 20241202 [ISIN: ""]', parse: () => flatexParser.parse([FX_H, "1;02.12.2024;02.12.2024;;XYZ SA;40;Stk.;Depotübertrag Eingang;1;10,00;EUR;***xxx Depot"].join("\n")) },
  { broker: "Trade Republic", label: "trading type 'SAVINGS_PLAN_REVERSAL' with no symbol", row: 'XYZ SA 20241202 [type: "SAVINGS_PLAN_REVERSAL"]', parse: () => tradeRepublicParser.parse([TR_H, `"2024-12-02T09:30:00.000Z","2024-12-02","DEFAULT","TRADING","SAVINGS_PLAN_REVERSAL","STOCK","XYZ SA","","40","10.000000","-400.00","","","EUR","","","","Buy","tx-1","","","",""`].join("\n")) },
  { broker: "eToro", label: "Action 'XYZ' (no Buy or Sell)", row: `XYZ (${ISIN}) 20241202 [Action: "XYZ"]`, parse: () => parseEtoroXlsx(xlsx("Closed Positions", [ET_H, ["XYZ", "400", "40", "10", "11", "40", "02/12/2024", "10/02/2025", "Stocks", "1", ISIN]])) },
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
    // A cash line of no security: a Scalable deposit, a Flatex row with no
    // ISIN and no Nominal, an eToro line with nothing but a profit.
    const sc = scalableParser.parse([SC_H, "2024-12-02;09:15;Executed;REF001;Deposit;Cash;Deposit;;;;1000,00;0;0;EUR"].join("\n"));
    expect([sc.trades, unreadableRows(sc)]).toEqual([[], undefined]);
    const fx = flatexParser.parse([FX_H, "1;02.12.2024;02.12.2024;;Zinsen;;;Zinsabschluss;1;;EUR;x"].join("\n"));
    expect([fx.trades, unreadableRows(fx)]).toEqual([[], undefined]);
    const et = await parseEtoroXlsx(xlsx("Closed Positions", [ET_H, ["", "", "", "", "", "40", "", "", "", "", ""]]));
    expect([et.trades, unreadableRows(et)]).toEqual([[], undefined]);
  });

  it.each(METHODS)("[%s] a row with no date and no ISIN stands at the upload's earliest date, never after another broker's year-end list", async (method) => {
    // Revolut's only readable date (a 2026 top-up) falls after the IBKR list
    // of 31/12/2025; in that file alone the undated XYZ buy would stand there.
    const parsed = await revolut(
      ["", "XYZ", "BUY - MARKET", "40", "USD 10", "USD 400", "USD", "0.92"],
      ["2026-01-05T10:00:00Z", "", "CASH TOP-UP", "", "", "USD 100", "USD", "0.92"],
    );
    expect(parsed.trades.map((t) => [t.symbol, t.tradeDate, t.undatedRow])).toEqual([["XYZ", "20260105", true]]);
    expect(issueSale(parsed, "Revolut", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
    // A garbage date next to a readable 2026 trade, and a Scalable row with no
    // ISIN and a day 45, next to a 2026 buy: the same.
    const garbage = await revolut(
      ["2025-13-45T10:00:00Z", "XYZ", "BUY - MARKET", "40", "USD 10", "USD 400", "USD", "0.92"],
      ["2026-02-05T10:00:00Z", "AAPL", "BUY - MARKET", "1", "USD 100", "USD 100", "USD", "0.92"],
    );
    expect(issueSale(garbage, "Revolut", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
    const sc = scalableParser.parse([SC_H, "2026-02-01;09:15;Executed;REF000;OTHER SA;Security;Buy;ES0000009999;1;1,00;-1,00;0;0;EUR", "2024-12-45;09:15;Executed;REF001;XYZ SA;Security;Buy;;40;10,00;-400,00;0;0;EUR"].join("\n"));
    expect(issueSale(sc, "Scalable Capital", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
  });

  it("the move to the upload's earliest date leaves the parsed file's own trade as it was", async () => {
    const parsed = await revolut(
      ["", "XYZ", "BUY - MARKET", "40", "USD 10", "USD 400", "USD", "0.92"],
      ["2026-01-05T10:00:00Z", "", "CASH TOP-UP", "", "", "USD 100", "USD", "0.92"],
    );
    const statement = createEmptyStatement();
    mergeStatement(statement, parseIbkrFlexXml(IB_ISSUE), "Interactive Brokers");
    mergeStatement(statement, parsed, "Revolut");
    const merged = finalizeMergedStatement(statement);
    expect(merged.trades.find((t) => t.undatedRow)?.tradeDate).toBe("20250301");
    expect(parsed.trades[0]!.tradeDate).toBe("20260105");
  });

  it("Trading 212: a stock split is not applied and is named, not called unreadable", () => {
    const parsed = trading212Parser.parse([T212_H,
      `Stock split close,2025-03-03 09:30:00,${ISIN},XYZ,XYZ SA,10,10,EUR,1.00,,,0,EUR,,s1`,
      `Stock split open,2025-03-03 09:30:00,${ISIN},XYZ,XYZ SA,40,2.5,EUR,1.00,,,0,EUR,,s2`].join("\n"));
    expect([parsed.trades, unreadableRows(parsed)]).toEqual([[], undefined]);
    const warning = parsed.parserMessages?.find((m) => m.id === "trading212.split_not_applied");
    expect([warning?.severity, warning?.context?.count, warning?.context?.rows]).toEqual([
      "warning", "2", `XYZ (${ISIN}) 20250303 [Stock split close: 10]; XYZ (${ISIN}) 20250303 [Stock split open: 40]`,
    ]);
  });

  it.each(METHODS)("[%s] Kraken: a readable trade with an empty txid is booked: the sale gains 1000 €", (method) => {
    const parsed = krakenParser.parse([KRAKEN_H,
      `"T1","O1","XETHZEUR","2024-03-15 10:30:00","buy","limit","2000.00","2000.00","0","1.0","0.0","",""`,
      `"","O2","XETHZEUR","2024-09-20 14:00:00","sell","market","3000.00","3000.00","0","1.0","0.0","",""`].join("\n"));
    expect(parsed.trades.map((t) => [t.tradeID, t.buySell, t.quantity])).toEqual([["T1", "BUY", "1"], ["kraken-row-2", "SELL", "-1"]]);
    expect(run([[parsed, "Kraken"]], 2024, method).capitalGains.netGainLoss.toFixed(2)).toBe("1000.00");
  });

  it("Kraken: a trade row with no pair names no coin: kept as a row that books nothing, named", () => {
    const parsed = krakenParser.parse([KRAKEN_H, `"T9","O9","","2024-03-15 10:30:00","buy","limit","2000.00","2000.00","0","1.0","0.0","",""`].join("\n"));
    expect(parsed.trades.map((t) => [t.symbol, t.quantityUnknown])).toEqual([["", true]]);
    expect(unreadableRows(parsed)).toBe('— 20240315 [pair: ""]');
  });

  it("controls: a row of an unknown type that writes a zero quantity moves no shares and stays skipped", async () => {
    expect((await revolut(["2024-12-02T10:00:00.000Z", "XYZ", "CUSTODY FEE", "0", "", "USD -1", "USD", "1"])).trades).toEqual([]);
    expect(trading212Parser.parse([T212_H, `Share transfer in,2024-12-02 09:30:00,${ISIN},XYZ,XYZ SA,0,10,EUR,1.00,,,0,EUR,,t1`].join("\n")).trades).toEqual([]);
    expect(scalableParser.parse([SC_H, `2024-12-02;09:15;Executed;REF001;XYZ SA;Security;Taxes;${ISIN};0;0;-3,00;0;0;EUR`].join("\n")).trades).toEqual([]);
  });
});

describe("#470 sibling: a Revolut crypto buy of unknown size leaves a holding of unknown size", () => {
  it("the inferred BTC holding keeps the readable 0.1, flagged and named, never as if complete", async () => {
    const parsed = await revolut(
      ["2025-03-01T10:00:00Z", "BTC", "BUY - MARKET", "0.1", "USD 60000", "USD 6000", "USD", "1"],
      ["2025-04-01T10:00:00Z", "BTC", "BUY - MARKET", "", "USD 60000", "USD 50000", "USD", "1"],
      ["2025-04-02T10:00:00Z", "ETH", "BUY - MARKET", "2", "USD 2000", "USD 4000", "USD", "1"],
    );
    expect(parsed.openPositions.map((p) => [p.symbol, p.assetCategory, p.quantity, p.quantityUnknown ?? false])).toEqual([
      ["BTC", "CRYPTO", "0.1", true],
      ["ETH", "CRYPTO", "2", false],
    ]);
    expect(parsed.trades.find((t) => t.quantityUnknown)?.quantity).toBe("0");
    expect(parsed.parserMessages?.map((m) => m.id)).toContain("parser.crypto_quantity_unknown");
    const warning = parsed.parserMessages?.find((m) => m.id === "revolut.holding_size_unknown");
    expect([warning?.severity, warning?.context?.tickers]).toEqual(["warning", "BTC"]);
  });

  it("the flagged holdings still reach the Modelo 721 and 720 as holdings to value by hand", async () => {
    const btc = await revolut(
      ["2025-02-01T10:00:00Z", "BTC", "BUY - MARKET", "1", "USD 60000", "USD 60000", "USD", "0.92"],
      ["2025-03-01T10:00:00Z", "BTC", "BUY - MARKET", "", "USD 60000", "USD 60000", "USD", "0.92"],
    );
    const m721 = buildModelo721Entries(btc.openPositions, rates(), "2025-12-31");
    expect([m721.positions.length, m721.unvaluedCount]).toEqual([1, 1]);
    const aapl = await revolut(
      ["2025-02-01T10:00:00Z", "AAPL", "BUY - MARKET", "100", "USD 200", "USD 20000", "USD", "0.92"],
      ["2025-03-01T10:00:00Z", "AAPL", "BUY - STOP", "100", "USD 200", "USD 20000", "USD", "0.92"],
    );
    expect(aapl.openPositions.map((p) => [p.symbol, p.quantity, p.quantityUnknown ?? false])).toEqual([["AAPL", "100", true]]);
    expect(checkModelo720Thresholds(aapl.openPositions, rates(), 2025).values.unvalued).toBe(1);
  });

  it("a DIVIDEND TAX (CORRECTION) is no trade: the holding stays readable, and no holding is invented after a full sale", async () => {
    const held = await revolut(
      ["2025-01-10T10:00:00Z", "AAPL", "BUY - MARKET", "10", "USD 100", "USD 1000", "USD", "1.03"],
      ["2025-05-15T10:00:00Z", "AAPL", "DIVIDEND", "", "", "USD 2.10", "USD", "1.12"],
      ["2025-05-15T10:00:01Z", "AAPL", "DIVIDEND TAX (CORRECTION)", "", "", "USD 0.37", "USD", "1.12"],
      ["2025-05-15T10:00:02Z", "AAPL", "DIVIDEND TAX (CORRECTION)", "", "", "USD -0.37", "USD", "1.12"],
    );
    expect(held.openPositions.map((p) => [p.symbol, p.quantity, p.costBasisMoney, p.quantityUnknown ?? false])).toEqual([["AAPL", "10", "1000.00", false]]);
    expect(held.trades.map((t) => t.quantityUnknown ?? false)).toEqual([false]);
    expect(unreadableRows(held)).toBeUndefined();
    const sold = await revolut(
      ["2025-01-10T10:00:00Z", "MSFT", "BUY - MARKET", "10", "USD 400", "USD 4000", "USD", "1.03"],
      ["2025-03-10T10:00:00Z", "MSFT", "SELL - MARKET", "10", "USD 410", "USD 4100", "USD", "1.08"],
      ["2025-05-15T10:00:00Z", "MSFT", "SPINOFF", "", "", "USD 0.37", "USD", "1.12"],
    );
    // A row of unknown type gives no side: it never makes a holding by itself.
    expect(sold.openPositions).toEqual([]);
  });

  it("an unreadable sale row also leaves the holding unknown; a ticker with only an unknown sale gets none", async () => {
    const parsed = await revolut(
      ["2025-03-01T10:00:00Z", "BTC", "BUY - MARKET", "0.1", "USD 60000", "USD 6000", "USD", "1"],
      ["2025-04-01T10:00:00Z", "BTC", "SELL - MARKET", "abc", "USD 60000", "USD 600", "USD", "1"],
      ["2025-04-02T10:00:00Z", "ETH", "SELL - MARKET", "", "USD 2000", "USD 4000", "USD", "1"],
    );
    expect(parsed.openPositions.map((p) => [p.symbol, p.quantity, p.quantityUnknown ?? false])).toEqual([["BTC", "0.1", true]]);
  });

  it("a buy of unknown size with nothing readable left still makes a flagged holding, named", async () => {
    const parsed = await revolut(["2025-04-01T10:00:00Z", "BTC", "BUY - MARKET", "", "USD 60000", "USD 600", "USD", "1"]);
    expect(parsed.openPositions.map((p) => [p.symbol, p.quantity, p.quantityUnknown ?? false])).toEqual([["BTC", "0", true]]);
    expect(parsed.parserMessages?.find((m) => m.id === "revolut.holding_size_unknown")?.context?.tickers).toBe("BTC");
  });
});

describe("#468 a row whose type is neither a buy nor a sale is never booked as a buy", () => {
  // Freedom24 issue example: buy 10 ACME at 150 USD (15/03/2024), then a row
  // of 10 at 175 USD (20/09/2024), at 1.10 USD/EUR.
  const f24json = (rows: { date: string; op: string; p: string; q: string; amount: string }[]): Statement => freedom24Parser.parse(JSON.stringify({
    report: { trades: { detailed: rows.map((r) => ({ date: r.date, ticker: "ACME.US", isin: "US0000000001", operation: r.op, p: r.p, q: r.q, curr_c: "USD", commission: "0", amount: r.amount, exchange: "NYSE" })) }, corporate_actions: { detailed: [] }, cash_flows: { detailed: [] } },
  }));
  const buy = { date: "2024-03-15 09:30:00", op: "buy", p: "150.00", q: "10", amount: "-1500.00" };

  describe.each(["sale", "sell_short", "transfer"])("Freedom24 operation %j", (op) => {
    it.each(METHODS)("[%s] is no second purchase: kept as a row that books nothing, named", (method) => {
      const parsed = f24json([buy, { date: "2024-09-20 14:00:00", op, p: "175.00", q: "10", amount: "1750.00" }]);
      expect(parsed.trades.map((t) => [t.buySell, t.quantity, t.quantityUnknown ?? false])).toEqual([["BUY", "10", false], ["BUY", "0", true]]);
      expect(unreadableRows(parsed)).toBe(`ACME (US0000000001) 20240920 [operation: "${op}"]`);
      expect(run([[parsed, "Freedom24"]], 2024, method).capitalGains.disposals).toEqual([]);
    });
  });

  it.each([" sell", "sell\n", "SELL"])("Freedom24 operation %j is read as a sell once trimmed: the 275 € gain", (op) => {
    for (const method of METHODS) {
      const parsed = f24json([buy, { date: "2024-09-20 14:00:00", op, p: "175.00", q: "10", amount: "1750.00" }]);
      expect(run([[parsed, "Freedom24"]], 2024, method).capitalGains.netGainLoss.toFixed(2)).toBe("275.00");
    }
  });

  it.each(METHODS)("[%s] Freedom24: a 'transfer' row after a loss sale no longer blocks the 550 € loss", (method) => {
    const rows = [
      buy,
      { date: "2024-11-01 14:00:00", op: "sell", p: "100.00", q: "10", amount: "1000.00" },
      { date: "2024-11-22 10:00:00", op: "transfer", p: "100.00", q: "10", amount: "1000.00" },
    ];
    const r = run([[f24json(rows), "Freedom24"]], 2024, method);
    expect([r.capitalGains.netGainLoss.toFixed(2), r.capitalGains.blockedLosses.toFixed(2)]).toEqual(["-550.00", "0.00"]);
  });

  // Kraken: a row whose type is "" or "settle", dated before a buy of 1 ETH at
  // 2000 € and a sale at 3000 €. Read as a buy at 1000 €, FIFO took it first.
  const kh = `"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers"`;
  describe.each(["", "settle", " Margin "])("Kraken type %j", (type) => {
    it.each(METHODS)("[%s] is no purchase: the sale gains 1000 €, not 2000 €", (method) => {
      const parsed = krakenParser.parse([kh,
        `"T0","O0","XETHZEUR","2024-02-01 10:30:00","${type}","market","1000.00","1000.00","0","1.0","0.0","",""`,
        `"T1","O1","XETHZEUR","2024-03-15 10:30:00","buy","limit","2000.00","2000.00","0","1.0","0.0","",""`,
        `"T2","O2","XETHZEUR","2024-09-20 14:00:00","sell","market","3000.00","3000.00","0","1.0","0.0","",""`].join("\n"));
      expect(parsed.trades[0]!.quantityUnknown).toBe(true);
      expect(unreadableRows(parsed)).toBe(`ETH 20240201 [type: ${JSON.stringify(type.trim())}]`);
      expect(run([[parsed, "Kraken"]], 2024, method).capitalGains.netGainLoss.toFixed(2)).toBe("1000.00");
    });
  });

  it("Kraken: a crypto-quoted pair of unknown type keeps a row for each coin", () => {
    const parsed = krakenParser.parse([kh, `"T0","O0","XETHXXBT","2024-02-01 10:30:00","settle","market","0.05","0.05","0","1.0","0.0","",""`].join("\n"));
    expect(parsed.trades.map((t) => [t.symbol, t.quantityUnknown])).toEqual([["ETH", true], ["BTC", true]]);
  });

  // IBKR: buy 10 at 150 USD, then a sale of 10 at 175 USD with no buySell.
  const ibkr = (sellAttr: string, sellQty = "-10"): string => {
    const t = (id: string, d: string, q: string, p: number, side: string): string =>
      `<Trade tradeID="${id}" accountId="U1" symbol="XYZ" description="XYZ" conid="1" isin="US0000000003" assetCategory="STK" currency="USD" tradeDate="${d}" settlementDate="${d}" quantity="${q}" tradePrice="${p}" tradeMoney="${Number(q) * p}" proceeds="${-Number(q) * p}" cost="1500" fifoPnlRealized="0" fxRateToBase="1" ${side} openCloseIndicator="${Number(q) > 0 ? "O" : "C"}" exchange="NYSE" ibCommissionCurrency="USD" ibCommission="0" taxes="0" multiplier="1" />`;
    return `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20240101" toDate="20241231" period="Custom"><Trades>${t("1", "20240315", "10", 150, 'buySell="BUY"')}${t("2", "20240920", sellQty, 175, sellAttr)}</Trades><CashTransactions /><CorporateActions /><SecuritiesInfo /></FlexStatement></FlexStatements></FlexQueryResponse>`;
  };
  it.each(METHODS)("[%s] IBKR: a trade with no buySell takes its side from the quantity sign: the 275 € gain", (method) => {
    for (const attr of ["", 'buySell=""', 'buySell="SELL"']) {
      const parsed = parseIbkrFlexXml(ibkr(attr));
      expect(parsed.trades.map((t) => t.buySell)).toEqual(["BUY", "SELL"]);
      expect(run([[parsed, "Interactive Brokers"]], 2024, method).capitalGains.netGainLoss.toFixed(2)).toBe("275.00");
    }
  });

  it("IBKR: with no buySell and no signed quantity the side is unknown, never BUY", () => {
    expect(parseIbkrFlexXml(ibkr("", "0")).trades[1]!.buySell).toBe("");
    expect(parseIbkrFlexXml(ibkr("", "")).trades[1]!.buySell).toBe("");
  });

  // eToro Spanish export: a short closed position, open 200, close 150, 10 units.
  const etoroEs = (direction: string): Promise<Statement> => {
    const H = ["ID de posición", "Acción", "Long / Short", "Importe", "Unidades", "Fecha de apertura", "Fecha de cierre", "Apalancamiento",
      "Comisiones de diferencial (USD)", "Diferencial de mercado (USD)", "Ganancias (USD)", "Ganancias (EUR)", "Tipo de cambio de apertura (USD)",
      "Tipo de cambio al cierre (USD)", "Tasa de apertura", "Tasa de cierre", "Tasa de Take Profit", "Tasa de Stop Loss",
      "Comisiones nocturnas y dividendos", "Copiado desde", "Tipo", "ISIN", "Notas"];
    return parseEtoroXlsx(xlsx("Posiciones cerradas", [H,
      ["1", "Acme (ACME)", direction, "2000", "10", "15/03/2024 09:30:00", "20/09/2024 14:00:00", "1", "0", "0", "500", "450", "1", "1", "200", "150", "0", "0", "0", "-", "Acciones", "US0000000004", ""]]));
  };
  it.each(METHODS)("[%s] eToro: an unknown Long / Short value is no long position: no 550 € loss, named", async (method) => {
    for (const direction of ["Corto", "Sell"]) {
      const parsed = await etoroEs(direction);
      expect(parsed.trades.every((t) => t.quantityUnknown === true)).toBe(true);
      expect(unreadableRows(parsed)).toContain(`[Long / Short: "${direction}"]`);
      expect(run([[parsed, "eToro"]], 2024, method).capitalGains.disposals).toEqual([]);
    }
    expect(run([[await etoroEs("Short"), "eToro"]], 2024, method).capitalGains.netGainLoss.toFixed(2)).toBe("550.00");
  });

  // Flatex: buy 10 at 150 €, then a row of the security that is neither Kauf
  // nor Verkauf. Its Nominal's sign alone booked it as a sale or a buy.
  const flatex = (...rows: string[]): Statement => flatexParser.parse([FX_H,
    "1;15.03.2024;15.03.2024;US0000000002;ACME INC.;10;Stk.;Ausführung ORDER Kauf US0000000002 0;100;150,00;EUR;x", ...rows].join("\n"));
  it.each(METHODS)("[%s] Flatex: a transfer out is no sale and a transfer in no repurchase", (method) => {
    for (const info of ["Depotübertrag Ausgang US0000000002", "Ausbuchung Kapitalmaßnahme US0000000002"]) {
      const parsed = flatex(`1;20.09.2024;20.09.2024;US0000000002;ACME INC.;-10;Stk.;${info};101;175,00;EUR;x`);
      expect(unreadableRows(parsed)).toBe(`ACME INC. (US0000000002) 20240920 [Buchungsinformationen: "${info}"]`);
      expect(run([[parsed, "Flatex"]], 2024, method).capitalGains.disposals).toEqual([]);
    }
    for (const info of ["Depotübertrag Eingang US0000000002", "Einbuchung Kapitalmaßnahme US0000000002"]) {
      const r = run([[flatex(
        "1;01.11.2024;01.11.2024;US0000000002;ACME INC.;-10;Stk.;Ausführung ORDER Verkauf US0000000002 1;101;100,00;EUR;x",
        `1;22.11.2024;22.11.2024;US0000000002;ACME INC.;10;Stk.;${info};102;100,00;EUR;x`,
      ), "Flatex"]], 2024, method);
      expect([r.capitalGains.netGainLoss.toFixed(2), r.capitalGains.blockedLosses.toFixed(2)]).toEqual(["-500.00", "0.00"]);
    }
  });

  it("Flatex: a Verkauf with a positive Nominal stays a sale; a Kauf with a negative one is unreadable", () => {
    const sale = flatex("1;20.09.2024;20.09.2024;US0000000002;ACME INC.;10;Stk.;Ausführung ORDER Verkauf US0000000002 1;101;175,00;EUR;x");
    expect(sale.trades.map((t) => [t.buySell, t.quantity])).toEqual([["BUY", "10"], ["SELL", "-10"]]);
    const odd = flatex("1;20.09.2024;20.09.2024;US0000000002;ACME INC.;-10;Stk.;Ausführung ORDER Kauf US0000000002 1;101;175,00;EUR;x");
    expect(unreadableRows(odd)).toBe('ACME INC. (US0000000002) 20240920 [Nominal: "-10"]');
  });
});
