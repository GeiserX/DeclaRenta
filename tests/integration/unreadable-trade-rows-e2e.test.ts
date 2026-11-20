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
import { parseRevolutXlsx, parseRevolutDate } from "../../src/parsers/revolut.js";
import { trading212Parser } from "../../src/parsers/trading212.js";
import { freedom24Parser } from "../../src/parsers/freedom24.js";
import { lightyearParser } from "../../src/parsers/lightyear.js";
import { scalableParser } from "../../src/parsers/scalable.js";
import { flatexParser } from "../../src/parsers/flatex.js";
import { tradeRepublicParser } from "../../src/parsers/trade-republic.js";
import { krakenParser } from "../../src/parsers/kraken.js";
import { parseEtoroXlsx } from "../../src/parsers/etoro.js";
import { coinbaseParser } from "../../src/parsers/coinbase.js";
import { binanceParser } from "../../src/parsers/binance.js";
import { isReadableDay } from "../../src/parsers/csv-utils.js";
import { isTranslationKey } from "../../src/i18n/index.js";
import es from "../../src/i18n/locales/es.js";
import en from "../../src/i18n/locales/en.js";
import ca from "../../src/i18n/locales/ca.js";
import eu from "../../src/i18n/locales/eu.js";
import gl from "../../src/i18n/locales/gl.js";
import { buildModelo721Entries } from "../../src/generators/modelo721.js";
import { checkModelo720Thresholds } from "../../src/generators/modelo720.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { FxMethod, TaxMessage, TaxSummary as TaxReport } from "../../src/types/tax.js";
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
  { broker: "Revolut", label: "type 'TRANSFER IN'", row: 'XYZ 20241202 [Type: "TRANSFER IN"]', parse: () => revolut(["2024-12-02T10:00:00.000Z", "XYZ", "TRANSFER IN", "40", "USD 10", "USD 400", "USD", "0.92"]) },
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
  { broker: "Flatex", label: "an Einbuchung with no ISIN, a Kurs and an empty Nominal", row: 'XYZ SA 20241202 [ISIN: ""]', parse: () => flatexParser.parse([FX_H, "1;02.12.2024;02.12.2024;;XYZ SA;;Stk.;Einbuchung;1;10,00;EUR;***xxx Depot"].join("\n")) },
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
        // An undated row keeps no date of its own; the merge gives it one.
        expect(t.tradeDate).toMatch(t.undatedRow === true ? /^$/ : /^\d{8}$/);
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

  it("a row with no readable date keeps no date in the parsed file; the merge puts it at the upload's earliest date", async () => {
    const parsed = await revolut(["", "XYZ", "BUY - MARKET", "40", "USD 10", "USD 400", "USD", "1"], ["2025-03-01T10:00:00Z", "ACME", "BUY - MARKET", "1", "USD 1", "USD 1", "USD", "1"], REV_CASH);
    expect(parsed.trades.map((t) => [t.symbol, t.tradeDate, t.undatedRow ?? false, t.quantityUnknown ?? false])).toEqual([["XYZ", "", true, true], ["ACME", "20250301", false, false]]);
    const statement = createEmptyStatement();
    mergeStatement(statement, parsed, "Revolut");
    expect(finalizeMergedStatement(statement).trades.map((t) => [t.symbol, t.tradeDate])).toEqual([["XYZ", "20241101"], ["ACME", "20250301"]]);
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
    expect(parsed.trades.map((t) => [t.symbol, t.tradeDate, t.undatedRow])).toEqual([["XYZ", "", true]]);
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
    expect(parsed.trades[0]!.tradeDate).toBe("");
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
      ["2025-03-01T10:00:00Z", "AAPL", "TRANSFER IN", "100", "USD 200", "USD 20000", "USD", "0.92"],
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
    // An empty cell is no long position either: read as one, a short's gain
    // became a loss.
    for (const direction of ["Corto", "Sell", ""]) {
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

  // Sweep 2: a Storno of a sale reads "Verkauf" too, with a positive
  // Nominal, so it was booked as a second sale and the loss counted twice.
  it.each(METHODS)("[%s] Flatex: a Storno of a sale is no second sale: it books nothing and is named", (method) => {
    const sale = "1;03.06.2024;03.06.2024;US0000000002;ACME INC.;-10;Stk.;Ausführung ORDER Verkauf US0000000002 1;101;80,00;EUR;x";
    const control = run([[flatex(sale), "Flatex"]], 2024, method);
    expect([control.capitalGains.disposals.length, control.capitalGains.netGainLoss.toFixed(2)]).toEqual([1, "-700.00"]);
    for (const [nominal, info] of [["10", "Storno Ausführung ORDER Verkauf US0000000002 1"], ["-10", "Storno Ausführung ORDER Kauf US0000000002 0"]]) {
      const parsed = flatex(sale, `1;03.06.2024;03.06.2024;US0000000002;ACME INC.;${nominal};Stk.;${info};102;80,00;EUR;x`);
      expect(unreadableRows(parsed)).toBe(`ACME INC. (US0000000002) 20240603 [Buchungsinformationen: ${JSON.stringify(info).slice(0, 40)}…"]`);
      const r = run([[parsed, "Flatex"]], 2024, method);
      expect([r.capitalGains.disposals.length, r.capitalGains.netGainLoss.toFixed(2)]).toEqual([1, "-700.00"]);
    }
  });
});

// ---------------------------------------------------------------------------
// Round 2: splits and corporate actions as evidence, rows with no readable
// date, date cells in XLSX, and cash rows with no readable date.
// ---------------------------------------------------------------------------

const AAPL = "US0378331005";
const messageRows = (s: Statement, id: string): string | undefined =>
  s.parserMessages?.find((m) => m.id === id)?.context?.rows;
/** The report with its messages left out: every number and row it computes. */
const numbers = (r: TaxReport): string => JSON.stringify({ ...r, messages: [] });

describe("#467 Trading 212 split rows are evidence of a holding: kept, named as not applied", () => {
  const split = (isin: string, time = "2024-12-02 09:30:00"): Statement => trading212Parser.parse([T212_H,
    `Stock split close,${time},${isin},XYZ,XYZ SA,10,10,EUR,1.00,,,0,EUR,,s1`,
    `Stock split open,${time},${isin},XYZ,XYZ SA,40,2.5,EUR,1.00,,,0,EUR,,s2`].join("\n"));

  it("each leg is a row that books nothing, named only by parser.corporate_action_not_applied", () => {
    const parsed = split(ISIN, "2025-03-03 09:30:00");
    expect(parsed.trades.map((t) => [t.symbol, t.isin, t.tradeDate, t.quantity, t.quantityUnknown, t.tradeMoney, t.proceeds, t.cost, t.unreadableRow])).toEqual([
      ["XYZ", ISIN, "20250303", "0", true, "0", "0", "0", undefined],
      ["XYZ", ISIN, "20250303", "0", true, "0", "0", "0", undefined],
    ]);
    expect(parsed.parserMessages?.map((m) => [m.id, m.severity])).toEqual([["parser.corporate_action_not_applied", "warning"]]);
    expect(messageRows(parsed, "parser.corporate_action_not_applied")).toBe(
      `XYZ (${ISIN}) 20250303 [Stock split close: 10]; XYZ (${ISIN}) 20250303 [Stock split open: 40]`);
  });

  it.each(METHODS)("[%s] a split of the security on 02/12/2024 next to the IBKR issue file: the exception is not applied, 100 € stay blocked", (method) => {
    expect(issueSale(split(ISIN), "Trading 212", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
  });

  it.each(METHODS)("[%s] control: a split of another security leaves the exception applied", (method) => {
    expect(issueSale(split("ES0000009999"), "Trading 212", method)).toEqual({ blocked: "0.00", singlePurchase: "applied" });
  });

  it.each(METHODS)("[%s] a split with no readable Time is kept with no date, still named as a split, and still blocks", (method) => {
    const parsed = split(ISIN, "garbage");
    expect(parsed.trades.map((t) => [t.tradeDate, t.undatedRow, t.unreadableRow])).toEqual([["", true, undefined], ["", true, undefined]]);
    expect(messageRows(parsed, "parser.corporate_action_not_applied")).toBe(
      `XYZ (${ISIN}) garbage [Stock split close: 10]; XYZ (${ISIN}) garbage [Stock split open: 40]`);
    expect(unreadableRows(parsed)).toBeUndefined();
    expect(issueSale(parsed, "Trading 212", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
  });
});

describe("#467 Lightyear and Scalable split and corporate-action rows: kept, named as not applied", () => {
  const files: [string, string, () => Statement][] = [
    ["Lightyear", `XYZ (${ISIN}) 20241202 [Stock split: 40]`, () => lightyearParser.parse([LY_H, `02/12/2024 09:30:00,CA-1,XYZ,${ISIN},Stock split,40,EUR,,,,,,`].join("\n"))],
    ["Lightyear", `XYZ (${ISIN}) 20241202 [Reverse split: 40]`, () => lightyearParser.parse([LY_H, `02/12/2024 09:30:00,CA-1,XYZ,${ISIN},Reverse split,40,EUR,,,,,,`].join("\n"))],
    ["Scalable Capital", `XYZ SA (${ISIN}) 20241202 [Corporate action: 40]`, () => scalableParser.parse([SC_H, `2024-12-02;09:15;Executed;REF1;XYZ SA;Security;Corporate action;${ISIN};40;;0;0;0;EUR`].join("\n"))],
    ["Scalable Capital", `XYZ SA (${ISIN}) 20241202 [Split: 40]`, () => scalableParser.parse([SC_H, `2024-12-02;09:15;Executed;REF1;XYZ SA;Security;Split;${ISIN};40;;0;0;0;EUR`].join("\n"))],
  ];
  describe.each(files)("%s: %s", (broker, row, parse) => {
    it("kept with no shares and no money, named only as not applied", () => {
      const parsed = parse();
      expect(parsed.trades.map((t) => [t.quantity, t.quantityUnknown, t.tradeMoney, t.corporateActionRow])).toEqual([["0", true, "0", row]]);
      expect(parsed.parserMessages?.map((m) => m.id)).toEqual(["parser.corporate_action_not_applied"]);
    });
    it.each(METHODS)("[%s] next to the IBKR issue file: 100 € stay blocked", (method) => {
      expect(issueSale(parse(), broker, method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
    });
  });
});

describe("#467 Trade Republic corporate-action and delivery rows are evidence of a holding", () => {
  const tr = (category: string, type: string, isin: string, shares: string): Statement => tradeRepublicParser.parse([TR_H,
    `"2024-12-02T09:30:00.000Z","2024-12-02","DEFAULT","${category}","${type}","STOCK","XYZ SA","${isin}","${shares}","","","","","EUR","","","","${type}","tx-1","","","",""`].join("\n"));

  it.each([
    ["DELIVERY", "FREE_RECEIPT", "40.0000000000", "trade_republic.delivery_not_applied"],
    ["CORPORATE_ACTION", "MERGER", "-40.0000000000", "trade_republic.corporate_action_not_applied"],
  ])("%s %s: kept with no shares and no money; its own warning still names the ISIN", (category, type, shares, id) => {
    const parsed = tr(category, type, ISIN, shares);
    expect(parsed.trades.map((t) => [t.isin, t.quantity, t.quantityUnknown, t.tradeMoney, t.cost, t.corporateActionRow])).toEqual([
      [ISIN, "0", true, "0", "0", `XYZ SA (${ISIN}) 20241202 [${category} ${type}: ${shares}]`],
    ]);
    expect(parsed.parserMessages?.map((m) => [m.id, m.context?.isins])).toEqual([[id, ISIN]]);
  });

  it.each(METHODS)("[%s] a delivery or a merger of the security on 02/12/2024 next to the IBKR issue file: 100 € stay blocked", (method) => {
    expect(issueSale(tr("DELIVERY", "FREE_RECEIPT", ISIN, "40"), "Trade Republic", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
    expect(issueSale(tr("CORPORATE_ACTION", "MERGER", ISIN, "-40"), "Trade Republic", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
  });

  it.each(METHODS)("[%s] controls: a delivery of another security, or of zero shares, leaves the exception applied", (method) => {
    expect(issueSale(tr("DELIVERY", "FREE_RECEIPT", "ES0000009999", "40"), "Trade Republic", method)).toEqual({ blocked: "0.00", singlePurchase: "applied" });
    const zero = tr("DELIVERY", "FREE_RECEIPT", ISIN, "0");
    expect(zero.trades).toEqual([]);
    expect(issueSale(zero, "Trade Republic", method)).toEqual({ blocked: "0.00", singlePurchase: "applied" });
  });
});

describe("#467 a file with no readable trade date is read, never refused; its rows stay evidence whatever the window", () => {
  const files: [string, string, () => Statement | Promise<Statement>][] = [
    ["Revolut", 'XYZ [Date: ""]', () => revolut(["", "XYZ", "BUY - MARKET", "40", "USD 10", "USD 400", "USD", "1"])],
    // No ticker and a date that is no day: the critic case, a row with no ISIN.
    ["Revolut", '— [Ticker: ""]', () => revolut(["not a date", "", "BUY - MARKET", "40", "USD 10", "USD 400", "USD", "1"])],
    ["Trading 212", `XYZ (${ISIN}) [Time: "02.12.2024 09:30"]`, () => trading212Parser.parse([T212_H, `Market buy,02.12.2024 09:30,${ISIN},XYZ,XYZ SA,40,10,EUR,1.00,,,400,EUR,,t1`].join("\n"))],
    ["Trading 212", 'XYZ SA [Time: ""]', () => trading212Parser.parse([T212_H, "Market buy,,,,XYZ SA,40,10,EUR,1.00,,,400,EUR,,t1"].join("\n"))],
    ["Freedom24", `XYZ (${ISIN}) [date: null]`, () => freedom24Parser.parse(JSON.stringify({ trades: { detailed: [{ ...F24_ROW, date: null }] }, corporate_actions: { detailed: [] } }))],
    ["Lightyear", `XYZ (${ISIN}) [Date: ""]`, () => lightyearParser.parse([LY_H, `,OR-1,XYZ,${ISIN},Buy,40,EUR,10.00,400.00,,0.00,400.00,`].join("\n"))],
    ["Lightyear", `XYZ (${ISIN}) [Date: "2024/12/02 09:30"]`, () => lightyearParser.parse([LY_H, `2024/12/02 09:30,OR-1,XYZ,${ISIN},Buy,40,EUR,10.00,400.00,,0.00,400.00,`].join("\n"))],
  ];
  describe.each(files)("%s: %s", (broker, row, parse) => {
    it("the parser keeps the row with no date of its own and names it", async () => {
      const parsed = await parse();
      expect(parsed.trades.map((t) => [t.tradeDate, t.undatedRow, t.quantity, t.quantityUnknown])).toEqual([["", true, "0", true]]);
      expect(unreadableRows(parsed)).toBe(row);
    });
    it.each(METHODS)("[%s] next to the IBKR issue file: the exception is not applied, 100 € stay blocked", async (method) => {
      expect(issueSale(await parse(), broker, method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
    });
  });

  it.each(METHODS)("[%s] an upload whose only rows have no date: nothing is booked, the row stays named, the report runs", async (method) => {
    const parsed = await revolut(["", "XYZ", "BUY - MARKET", "40", "USD 10", "USD 400", "USD", "1"]);
    const statement = createEmptyStatement();
    mergeStatement(statement, parsed, "Revolut");
    const merged = finalizeMergedStatement(statement);
    expect(merged.trades).toEqual([]);
    expect(unreadableRows(merged)).toBe('XYZ [Date: ""]');
    const r = generateTaxReport(merged, rates(), 2025, reportOptionsForMethod(method));
    expect(r.capitalGains.disposals).toEqual([]);
  });

  it.each(METHODS)("[%s] an undated crypto row is dated by the merge, so the crypto valuation never sees an empty date", async (method) => {
    const parsed = await revolut(["", "BTC", "BUY - MARKET", "", "USD 60000", "USD 600", "USD", "1"], ["2025-02-01T10:00:00Z", "AAPL", "BUY - MARKET", "1", "USD 100", "USD 100", "USD", "1"]);
    expect(parsed.trades.find((t) => t.symbol === "BTC")?.tradeDate).toBe("");
    const r = run([[parsed, "Revolut"]], 2025, method);
    expect(r.capitalGains.disposals).toEqual([]);
  });
});

describe("#467 XLSX date cells read as their real day, never as 'm/d/yy' text", () => {
  // A date cell is a number with a date format; xlsx renders the default
  // format as "1/10/25". Built at local noon, so no time zone moves the day.
  const day = (y: number, m: number, d: number, h = 12): Date => new Date(y, m - 1, d, h);
  function xlsxDates(sheet: string, rows: unknown[][], formats: Record<string, string> = {}): Uint8Array {
    const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
    for (const [address, z] of Object.entries(formats)) (ws[address] as XLSX.CellObject).z = z;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheet);
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  it.each(METHODS)("[%s] Revolut closed positions: the sale of 10/06/2025 gains 550 €", async (method) => {
    const parsed = await parseRevolutXlsx(xlsxDates("Sheet1", [REV_A, [day(2025, 1, 10), day(2025, 6, 10), "AAPL", 10, 1000, 1500, 500, 0, 500, "USD"]], { B2: "dd/mm/yyyy hh:mm" }));
    expect(parsed.trades.map((t) => [t.buySell, t.tradeDate, t.quantity])).toEqual([["BUY", "20250110", "10"], ["SELL", "20250610", "-10"]]);
    expect(parsed.parserMessages).toBeUndefined();
    expect(run([[parsed, "Revolut"]], 2025, method).capitalGains.netGainLoss.toFixed(2)).toBe("550.00");
  });

  it.each(METHODS)("[%s] Revolut transaction log: the same sale, and a dividend dated by its cell", async (method) => {
    const parsed = await parseRevolutXlsx(xlsxDates("Sheet1", [REV_H,
      [day(2025, 1, 10, 9), "AAPL", "BUY - MARKET", "10", "USD 100", "USD 1000", "USD", "1"],
      [day(2025, 5, 15), "AAPL", "DIVIDEND", "", "", "USD 110", "USD", "1"],
      [day(2025, 6, 10, 15), "AAPL", "SELL - MARKET", "10", "USD 150", "USD 1500", "USD", "1"]]));
    expect(parsed.trades.map((t) => t.tradeDate)).toEqual(["20250110", "20250610"]);
    expect(parsed.cashTransactions.map((c) => c.dateTime)).toEqual(["20250515"]);
    const r = run([[parsed, "Revolut"]], 2025, method);
    expect([r.capitalGains.netGainLoss.toFixed(2), r.dividends.grossIncome.toFixed(2)]).toEqual(["550.00", "121.00"]);
  });

  it("eToro closed positions and dividends", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ET_H, ["Buy AAPL", "1000", "5", "180", "195", "82.50", day(2025, 3, 15, 9), day(2025, 9, 20, 14), "Stocks", "1", AAPL]], { cellDates: true }), "Closed Positions");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Date of Payment", "Instrument Name", "Net Dividend Received (USD)", "Withholding Tax Amount (USD)", "ISIN"], [day(2025, 6, 15), "AAPL", "42.50", "7.50", AAPL]], { cellDates: true }), "Dividends");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
    const parsed = await parseEtoroXlsx(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    expect(parsed.trades.map((t) => [t.buySell, t.tradeDate])).toEqual([["BUY", "20250315"], ["SELL", "20250920"]]);
    expect(parsed.cashTransactions.map((c) => [c.type, c.dateTime])).toEqual([["Dividends", "20250615"], ["Withholding Tax", "20250615"]]);
  });

  it("Scalable reads a German DD.MM.YYYY date", () => {
    const parsed = scalableParser.parse([SC_H, `02.12.2024;09:15;Executed;REF1;XYZ SA;Security;Buy;${ISIN};40;10,00;-400,00;0;0;EUR`].join("\n"));
    expect(parsed.trades.map((t) => [t.tradeDate, t.quantity])).toEqual([["20241202", "40"]]);
  });
});

describe("#467 a cash row with no readable date is not booked under a guessed date: it is named for the user to add by hand", () => {
  const IB_CASH = (extra: string): string => `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20250101" toDate="20251231" period="Custom"><Trades /><CashTransactions><CashTransaction transactionID="D1" accountId="U1" symbol="AAPL" description="AAPL Cash Dividend" isin="${AAPL}" currency="USD" dateTime="20250601;100000" amount="110" fxRateToBase="1" type="Dividends" />${extra}</CashTransactions><CorporateActions /><OpenPositions /><SecuritiesInfo /></FlexStatement></FlexStatements></FlexQueryResponse>`;
  const DG_ACC = "Fecha,Hora,Fecha valor,Producto,ISIN,Descripción,Tipo,Variación,,Saldo,,ID Orden";
  const FX_KONTO = "Buchtag;Valuta;BIC / BLZ;IBAN / Kontonummer;Buchungsinformationen;TA-Nr.;Betrag;;Auftraggeberkonto;Konto";
  const KR_LEDGER = `"txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"`;
  const CB_H = "ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";
  const ET_DIV = ["Date of Payment", "Instrument Name", "Net Dividend Received (USD)", "Withholding Tax Amount (USD)", "ISIN"];
  const f24div = (date: string | null, amount: number) => ({ type_id: "dividend", date, ticker: "AAPL.US", isin: AAPL, amount, tax_amount: 0, curr_c: "USD" });
  const trDiv = (date: string, id: string): string => `"${date}","${date}","DEFAULT","CASH","DIVIDEND","STOCK","Apple","${AAPL}","","","110.00","","","USD","","","","Dividend","${id}","","","",""`;
  const cashCases: { broker: string; year: number; cells: string[]; parse: (undated: boolean) => Statement | Promise<Statement> }[] = [
    { broker: "Revolut", year: 2025, cells: ['Dividends AAPL 110 USD [Date: "20251345"]', 'Dividends AAPL 50 USD [Date: ""]', 'Deposits/Withdrawals CASH TOP-UP 100 USD [Date: ""]'], parse: (u) => revolut(
      ["2025-05-15T10:00:00Z", "AAPL", "DIVIDEND", "", "", "USD 110", "USD", "1"],
      ...(u ? [["2025-13-45T10:00:00Z", "AAPL", "DIVIDEND", "", "", "USD 110", "USD", "1"], ["", "AAPL", "DIVIDEND", "", "", "USD 50", "USD", "1"], ["", "", "CASH TOP-UP", "", "", "USD 100", "USD", "1"]] : [])) },
    { broker: "Trading 212", year: 2024, cells: [`Dividends AAPL (${AAPL}) 5 USD [Time: ""]`, `Withholding Tax AAPL (${AAPL}) -0.5 USD [Time: "2024/12/01"]`], parse: (u) => trading212Parser.parse([T212_H, T212_DATED,
      ...(u ? [`Dividend (Ordinary),,${AAPL},AAPL,Apple Inc,,,USD,0.92,,,5.00,USD,,div2`, `Dividend (Dividend tax),2024/12/01,${AAPL},AAPL,Apple Inc,,,USD,0.92,,,0.50,USD,,div3`] : [])].join("\n")) },
    { broker: "Freedom24", year: 2024, cells: [`Dividends AAPL (${AAPL}) 50 USD [date: ""]`], parse: (u) => freedom24Parser.parse(JSON.stringify({
      trades: { detailed: [] }, corporate_actions: { detailed: [f24div("2024-06-01", 110), ...(u ? [f24div(null, 50)] : [])] } })) },
    { broker: "Lightyear", year: 2024, cells: [`Dividends AAPL (${AAPL}) 110 USD [Date: ""]`], parse: (u) => lightyearParser.parse([LY_H, LY_DATED,
      ...(u ? [`,DV-2,AAPL,${AAPL},Dividend,,USD,,110,0.92,0,110,0`] : [])].join("\n")) },
    { broker: "Scalable Capital", year: 2025, cells: [`Dividends AAPL Inc (${AAPL}) 110 USD [date: "20251345"]`], parse: (u) => scalableParser.parse([SC_H, `2025-05-15;09:15;Executed;REF8;AAPL Inc;Security;Distribution;${AAPL};;;110,00;0;0;USD`,
      ...(u ? [`2025-13-45;09:15;Executed;REF9;AAPL Inc;Security;Distribution;${AAPL};;;110,00;0;0;USD`] : [])].join("\n")) },
    { broker: "Trade Republic", year: 2025, cells: [`Dividends Apple (${AAPL}) 110 USD [date: "<b>"]`], parse: (u) => tradeRepublicParser.parse([TR_H, trDiv("2025-05-15", "tx-8"),
      ...(u ? [trDiv("<b>", "tx-9")] : [])].join("\n")) },
    { broker: "eToro", year: 2025, cells: [`Dividends AAPL (${AAPL}) 50.0000 USD [Date: ""]`, `Withholding Tax AAPL (${AAPL}) -7.5 USD [Date: ""]`], parse: (u) => parseEtoroXlsx(xlsx("Dividends", [ET_DIV,
      ["15/06/2025", "AAPL", "42.50", "7.50", AAPL], ...(u ? [["", "AAPL", "42.50", "7.50", AAPL]] : [])])) },
    { broker: "DEGIRO", year: 2024, cells: ['[Fecha: "20240231"]'], parse: (u) => degiroParser.parse([DG_ACC, "12-01-2024,07:31,11-01-2024,ALPHA SEMICON ADR,XX0000000001,Dividendo,,USD,2.42,USD,2.42,",
      ...(u ? ["31-02-2024,07:31,11-01-2024,ALPHA SEMICON ADR,XX0000000001,Dividendo,,USD,4.00,USD,6.42,"] : [])].join("\n")) },
    { broker: "Flatex", year: 2025, cells: ['[Buchtag: "20250231"]'], parse: (u) => flatexParser.parse([FX_KONTO, "30.12.2025;26.12.2025;;;Dividendenzahlung US67066G1040;4669369368;0,21;EUR;1234567890;***xxx Cashkonto",
      ...(u ? ["31.02.2025;26.12.2025;;;Dividendenzahlung US67066G1040;4669369369;0,36;EUR;1234567890;***xxx Cashkonto"] : [])].join("\n")) },
    { broker: "Interactive Brokers", year: 2025, cells: [`Dividends AAPL (${AAPL}) 50 USD [dateTime: "20250231"]`], parse: (u) => parseIbkrFlexXml(IB_CASH(u
      ? `<CashTransaction transactionID="D2" accountId="U1" symbol="AAPL" description="AAPL Cash Dividend" isin="${AAPL}" currency="USD" dateTime="20250231" amount="50" fxRateToBase="1" type="Dividends" />` : "")) },
    { broker: "Kraken", year: 2024, cells: ['[time: "20241301"]'], parse: (u) => krakenParser.parse([KR_LEDGER, `"LID100","REFID100","2024-06-01 00:00:00","staking","","currency","XETH","0.025","0.0001","5.025"`,
      ...(u ? [`"LID101","REFID101","2024-13-01 00:00:00","staking","","currency","XETH","0.5","0.0001","5.525"`] : [])].join("\n")) },
    { broker: "Coinbase", year: 2025, cells: ['[Timestamp: ""]'], parse: (u) => coinbaseParser.parse([CB_H, "tx1,2025-01-05 10:00:00 UTC,Rewards Income,ETH,0.01,EUR,€3000.00,€30.00,€30.00,€0.00,",
      ...(u ? ["tx2,,Rewards Income,ETH,0.02,EUR,€3000.00,€60.00,€60.00,€0.00,"] : [])].join("\n")) },
  ];
  describe.each(cashCases)("$broker", ({ broker, year, cells, parse }) => {
    it("the row is not booked, no booked row has a guessed date, and the warning names it", async () => {
      const parsed = await parse(true);
      for (const c of parsed.cashTransactions) expect(isReadableDay(c.dateTime)).toBe(true);
      expect(parsed.cashTransactions).toHaveLength((await parse(false)).cashTransactions.length);
      const warning = parsed.parserMessages?.find((m) => m.id === "parser.cash_row_undated");
      expect([warning?.severity, warning?.context?.broker, warning?.context?.count]).toEqual(["warning", warning?.context?.broker, String(cells.length)]);
      for (const cell of cells) expect(warning?.context?.rows).toContain(cell);
    });
    it.each(METHODS)("[%s] every number of the report is the one of the file without that row", async (method) => {
      expect(numbers(run([[await parse(true), broker]], year, method))).toBe(numbers(run([[await parse(false), broker]], year, method)));
    });
  });
});

describe("#467 IBKR, Coinbase and Binance: a trade with no readable date is kept as a row that books nothing, named", () => {
  it.each(METHODS)("[%s] IBKR: a buy dated 31/02 in the issue file is kept, named, and the 100 € stay blocked", (method) => {
    const xml = IB_ISSUE.replace("<Trades>", `<Trades>${ibTrade("20240231", "BUY", 40, 10)}`);
    const parsed = parseIbkrFlexXml(xml);
    expect(parsed.trades.filter((t) => t.undatedRow).map((t) => [t.tradeDate, t.quantity, t.quantityUnknown])).toEqual([["", "0", true]]);
    expect(unreadableRows(parsed)).toBe(`XYZ (${ISIN}) [tradeDate: "20240231"]`);
    const r = run([[parsed, "Interactive Brokers"]], 2025, method);
    const sale = r.capitalGains.disposals.find((d) => d.isin === ISIN)!;
    expect([r.capitalGains.blockedLosses.toFixed(2), sale.washSaleSinglePurchase]).toEqual(["100.00", "unverified"]);
  });

  it("IBKR control: a file in another Date Format setting is still refused with the setting to change", () => {
    expect(() => parseIbkrFlexXml(IB_ISSUE.replace('tradeDate="20250301"', 'tradeDate="03/01/2025"'))).toThrow(/yyyyMMdd/);
  });

  it.each(METHODS)("[%s] Coinbase: a sale with no Timestamp is kept and named, never dropped silently", (method) => {
    const parsed = coinbaseParser.parse(["ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes",
      "tx4,2025-01-05 10:00:00 UTC,Buy,ETH,0.50000000,EUR,€3200.00,€1600.00,€1610.00,€10.00,Bought 0.5 ETH",
      "tx5,,Sell,ETH,0.50000000,EUR,€3500.00,€1750.00,€1740.00,€10.00,Sold 0.5 ETH"].join("\n"));
    expect(unreadableRows(parsed)).toBe('ETH [Timestamp: ""]');
    expect(run([[parsed, "Coinbase"]], 2025, method).capitalGains.disposals).toEqual([]);
  });

  it.each(METHODS)("[%s] Binance: a sale dated 2024-13-45 is kept and named, never booked on a false day", (method) => {
    const parsed = binanceParser.parse(["Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
      "2024-01-15 10:30:00,BTCEUR,BUY,42000.00,0.05,2100.00,0.001BTC",
      "2024-13-45 14:00:00,BTCEUR,SELL,48000.00,0.05,2400.00,0.001BTC"].join("\n"));
    expect(unreadableRows(parsed)).toBe('BTC [Date(UTC): "20241345"]');
    expect(run([[parsed, "Binance"]], 2024, method).capitalGains.disposals).toEqual([]);
  });
});

describe("#467 Revolut DIVIDEND TAX (CORRECTION) rows are named, so the user knows where the withholding correction went", () => {
  const file = (withCorrection: boolean): Promise<Statement> => revolut(
    ["2025-05-15T10:00:00Z", "AAPL", "DIVIDEND", "", "", "USD 110", "USD", "1"],
    ...(withCorrection ? [
      ["2025-05-16T10:00:00Z", "AAPL", "DIVIDEND TAX (CORRECTION)", "", "", "USD 0.37", "USD", "1"],
      ["2025-05-16T10:00:01Z", "AAPL", "DIVIDEND TAX (CORRECTION)", "", "", "USD -0.37", "USD", "1"]] : []));

  it("an info message lists each row by ticker, date and amount", async () => {
    const message = (await file(true)).parserMessages?.find((m) => m.id === "revolut.dividend_tax_correction");
    expect([message?.severity, message?.context?.count, message?.context?.rows]).toEqual(["info", "2", "AAPL 20250516 USD 0.37; AAPL 20250516 USD -0.37"]);
  });

  it.each(METHODS)("[%s] the rows move no number", async (method) => {
    expect(numbers(run([[await file(true), "Revolut"]], 2025, method))).toBe(numbers(run([[await file(false), "Revolut"]], 2025, method)));
  });

  it("the hint is plain short sentences in the five locales, with no clause joined by a semicolon", () => {
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
      expect(locale["revolut.dividend_tax_correction.hint"]).not.toContain(";");
    }
  });
});

// ---------------------------------------------------------------------------
// Round 3 of #466, #467 and #468: rows that still vanished or read a false day
// ---------------------------------------------------------------------------

describe("#467 Flatex: a share movement with a written Kurs 0, or an unmatched custody transfer, is evidence of a holding", () => {
  const depot = (...rows: string[]): Statement => flatexParser.parse([FX_H, ...rows].join("\n"));
  const zeroKurs = (info: string, isin = ISIN): string => `1;02.12.2024;02.12.2024;${isin};XYZ SA;40;Stk.;${info};1;0,00;EUR;***xxx Depot`;
  const custody = (nominal: string, day = "02.12.2024", n = "1"): string => `1;${day};${day};${ISIN};XYZ SA;${nominal};Stk.;Lagerstellenwechsel Eingang;${n};10,00;EUR;***xxx Depot`;

  describe.each(["Depotübertrag Eingang", "Kapitalmaßnahme Split", "Einbuchung Gratisaktien", `Ausführung ORDER Kauf ${ISIN} 1`])("Kurs 0,00 with %j", (info) => {
    it("is kept with no shares and no money, named only as not applied", () => {
      const parsed = depot(zeroKurs(info));
      expect(parsed.trades.map((t) => [t.isin, t.tradeDate, t.quantity, t.quantityUnknown, t.tradeMoney])).toEqual([[ISIN, "20241202", "0", true, "0"]]);
      expect(messageRows(parsed, "parser.corporate_action_not_applied")).toBe(`XYZ SA (${ISIN}) 20241202 [${info}: 40]`);
      expect(unreadableRows(parsed)).toBeUndefined();
    });
    it.each(METHODS)("[%s] next to the IBKR issue file: the exception is not applied, 100 € stay blocked", (method) => {
      expect(issueSale(depot(zeroKurs(info)), "Flatex", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
    });
  });

  it.each(METHODS)("[%s] an unmatched Lagerstellenwechsel of 40 shares is kept, and still named by its own info message", (method) => {
    const parsed = depot(custody("40"));
    expect(parsed.trades.map((t) => [t.quantity, t.quantityUnknown])).toEqual([["0", true]]);
    expect(parsed.parserMessages?.map((m) => m.id)).toEqual(["flatex.lagerstellenwechsel.unmatched", "parser.corporate_action_not_applied"]);
    expect(issueSale(parsed, "Flatex", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
  });

  it.each(METHODS)("[%s] controls: a balanced same-day pair, and a Kurs 0 row of another security, leave the exception applied", (method) => {
    const pair = depot(custody("-40", "02.12.2024", "1"), custody("40", "02.12.2024", "2"));
    expect([pair.trades, pair.parserMessages]).toEqual([[], undefined]);
    expect(issueSale(pair, "Flatex", method)).toEqual({ blocked: "0.00", singlePurchase: "applied" });
    expect(issueSale(depot(zeroKurs("Depotübertrag Eingang", "ES0000009999")), "Flatex", method)).toEqual({ blocked: "0.00", singlePurchase: "applied" });
  });
});

describe("#467 DEGIRO: a row with a written zero price moves shares; every spelling of the zero is kept and named", () => {
  const row = (price: string, isin = ISIN, qty = "40", order = ""): Statement => degiroParser.parse([DG_H,
    `02-12-2024,09:15,XYZ SA,${isin},MAD,XMAD,${qty},${price},EUR,0,EUR,0,EUR,0,EUR,${order}`].join("\n"));

  describe.each(["0", "0.00", "0.0000"])("price %j", (price) => {
    it("is kept with no shares and no money, named as not applied", () => {
      const parsed = row(price);
      expect(parsed.trades.map((t) => [t.quantity, t.quantityUnknown, t.tradeMoney, t.cost])).toEqual([["0", true, "0", "0"]]);
      expect(messageRows(parsed, "parser.corporate_action_not_applied")).toBe(`XYZ SA (${ISIN}) 20241202 [Price ${price}: 40]`);
    });
    it.each(METHODS)("[%s] next to the IBKR issue file: 100 € stay blocked, never 20 € from a zero-cost lot", (method) => {
      expect(issueSale(row(price), "DEGIRO", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
    });
  });

  it.each(METHODS)("[%s] controls: a zero quantity is no movement; another security leaves the exception applied", (method) => {
    expect(row("0", ISIN, "0").trades).toEqual([]);
    expect(issueSale(row("0", "ES0000009999"), "DEGIRO", method)).toEqual({ blocked: "0.00", singlePurchase: "applied" });
  });
});

describe("#467 a DEGIRO option or future with no ISIN is kept as a derivative, never as any share", () => {
  const opt = (product: string): Statement => degiroParser.parse([DG_H,
    `03-06-2024,10:00,${product},,CBOE,CBOE,1,5.00,USD,-500.00,USD,0,EUR,-500.00,EUR,ord1`].join("\n"));

  it.each([["AAPL C200.00 20DEC24", "OPT"], ["ASML P600 17JAN25", "OPT"], ["FDAX MAR25", "FUT"]])("%s is named, books nothing, category %s", (product, category) => {
    const parsed = opt(product);
    expect(parsed.trades.map((t) => [t.assetCategory, t.quantityUnknown])).toEqual([[category, true]]);
    expect(unreadableRows(parsed)).toBe(`${product} 20240603 [ISIN: ""]`);
  });

  it.each(METHODS)("[%s] next to the IBKR issue file the exception stays applied; a no-ISIN share row still blocks it", (method) => {
    expect(issueSale(opt("AAPL C200.00 20DEC24"), "DEGIRO", method)).toEqual({ blocked: "0.00", singlePurchase: "applied" });
    expect(issueSale(opt("XYZ SA"), "DEGIRO", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
  });
});

describe("#467 XLSX workbooks in the 1904 date system read their real day", () => {
  const day = (y: number, m: number, d: number, h = 12): Date => new Date(y, m - 1, d, h);
  function book(sheets: [string, unknown[][]][], date1904: boolean): Uint8Array {
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), name);
    if (date1904) wb.Workbook = { ...wb.Workbook, WBProps: { ...wb.Workbook?.WBProps, date1904: true } };
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const revolutBook = (date1904: boolean): Uint8Array => book([["Sheet1", [REV_A, [day(2025, 1, 10), day(2025, 6, 10), "AAPL", 10, 1000, 1500, 500, 0, 500, "USD"]]]], date1904);

  it("the probe is real: the 1904 file stores other serial numbers for the same days", () => {
    const serial = (data: Uint8Array): unknown => (XLSX.read(data, { type: "buffer" }).Sheets.Sheet1!.A2 as XLSX.CellObject).v;
    expect(serial(revolutBook(true))).not.toBe(serial(revolutBook(false)));
  });

  it.each(METHODS)("[%s] Revolut closed positions: the sale of 10/06/2025 gains 550 € in both date systems", async (method) => {
    for (const date1904 of [false, true]) {
      const parsed = await parseRevolutXlsx(revolutBook(date1904));
      expect(parsed.trades.map((t) => [t.buySell, t.tradeDate])).toEqual([["BUY", "20250110"], ["SELL", "20250610"]]);
      expect(run([[parsed, "Revolut"]], 2025, method).capitalGains.netGainLoss.toFixed(2)).toBe("550.00");
    }
  });

  it("eToro closed positions and dividends", async () => {
    const parsed = await parseEtoroXlsx(book([
      ["Closed Positions", [ET_H, ["Buy AAPL", "1000", "5", "180", "195", "82.50", day(2024, 3, 15, 9), day(2024, 9, 20, 14), "Stocks", "1", AAPL]]],
      ["Dividends", [["Date of Payment", "Instrument Name", "Net Dividend Received (USD)", "Withholding Tax Amount (USD)", "ISIN"], [day(2024, 5, 16), "AAPL", "42.50", "7.50", AAPL]]],
    ], true));
    expect(parsed.trades.map((t) => [t.buySell, t.tradeDate])).toEqual([["BUY", "20240315"], ["SELL", "20240920"]]);
    expect(parsed.cashTransactions.map((c) => c.dateTime)).toEqual(["20240516", "20240516"]);
  });
});

describe("#467 slash dates read the same with or without a leading zero, in the file's order", () => {
  it("Revolut: 1/10/2024, 01/10/2024 and 1/10/24 are all 1 October; 15/01/2020 is 15 January", () => {
    expect(["1/10/2024", "01/10/2024", "1/10/24", "01/10/2024 09:30"].map((d) => parseRevolutDate(d))).toEqual(["20241001", "20241001", "20241001", "20241001"]);
    expect(parseRevolutDate("15/01/2020")).toBe("20200115");
    expect(parseRevolutDate("1/5/2020", "MDY")).toBe("20200105");
  });

  it.each(METHODS)("[%s] Revolut: a file whose dates show month first ('3/15/2025') reads 1/10/2025 as 10 January", async (method) => {
    const parsed = await revolut(
      ["1/10/2025", "AAPL", "BUY - MARKET", "10", "USD 100", "USD 1000", "USD", "1"],
      ["3/15/2025", "AAPL", "SELL - MARKET", "10", "USD 150", "USD 1500", "USD", "1"]);
    expect(parsed.trades.map((t) => t.tradeDate)).toEqual(["20250110", "20250315"]);
    expect(run([[parsed, "Revolut"]], 2025, method).capitalGains.netGainLoss.toFixed(2)).toBe("550.00");
  });

  it("eToro: a sheet of day-first dates reads 1/10/2024 as 1 October, as 01/10/2024", async () => {
    const parsed = await parseEtoroXlsx(xlsx("Closed Positions", [ET_H,
      ["Buy AAPL", "1000", "5", "180", "195", "82.50", "1/10/2024 09:30:00", "15/11/2024 14:00:00", "Stocks", "1", AAPL],
      ["Buy MSFT", "1000", "5", "180", "195", "82.50", "01/10/2024 09:30:00", "15/11/2024 14:00:00", "Stocks", "1", "US5949181045"]]));
    expect(parsed.trades.filter((t) => t.buySell === "BUY").map((t) => t.tradeDate)).toEqual(["20241001", "20241001"]);
  });
});

describe("#466 Revolut: stop orders are buys and sales", () => {
  it.each(METHODS)("[%s] BUY - STOP then SELL - STOP gains 550 €, with no warning", async (method) => {
    for (const [buy, sell] of [["BUY - STOP", "SELL - STOP"], ["BUY - STOP LIMIT", "SELL - STOP LIMIT"]]) {
      const parsed = await revolut(
        ["2025-01-10T10:00:00Z", "AAPL", buy!, "10", "USD 100", "USD 1000", "USD", "1"],
        ["2025-06-10T10:00:00Z", "AAPL", sell!, "10", "USD 150", "USD 1500", "USD", "1"]);
      expect(parsed.parserMessages).toBeUndefined();
      expect(run([[parsed, "Revolut"]], 2025, method).capitalGains.netGainLoss.toFixed(2)).toBe("550.00");
    }
  });
});

describe("#467 Revolut: a ticker row of an unknown type with a zero quantity but an amount is named, never dropped", () => {
  const file = (type: string, amount: string): Promise<Statement> => revolut(
    ["2025-01-10T10:00:00Z", "AAPL", "BUY - MARKET", "10", "USD 100", "USD 1000", "USD", "1"],
    ["2025-05-10T10:00:00Z", "AAPL", type, "0", "", amount, "USD", "1"]);

  it.each(METHODS)("[%s] a cash merger of USD 1500 is named in the parser and in the report, and the holding is of unknown size", async (method) => {
    const parsed = await file("MERGER - CASH", "USD 1500");
    expect(unreadableRows(parsed)).toBe('AAPL 20250510 [Type: "MERGER - CASH"]');
    expect(messageRows(parsed, "revolut.holding_size_unknown") ?? parsed.parserMessages?.find((m) => m.id === "revolut.holding_size_unknown")?.context?.tickers).toBe("AAPL");
    expect(run([[parsed, "Revolut"]], 2025, method).messages.map((m) => m.id)).toContain("parser.trade_row_unreadable");
  });

  it("controls: the same row with a zero amount, and a fee, stay skipped", async () => {
    expect((await file("MERGER - CASH", "USD 0")).trades).toHaveLength(1);
    expect((await file("CUSTODY FEE", "USD -1")).trades).toHaveLength(1);
  });
});

describe("#467 a dividend with no ticker goes by its ISIN; with no security at all it is named", () => {
  const unidentified = (s: Statement): string | undefined => messageRows(s, "parser.cash_row_unidentified");
  const gross = (s: Statement, broker: string, method: FxMethod): string => run([[s, broker]], 2025, method).dividends.grossIncome.toFixed(2);

  it.each(METHODS)("[%s] Lightyear and Trading 212: a USD 500 dividend with only an ISIN is 550.00 € (at 1.10)", (method) => {
    const ly = lightyearParser.parse([LY_H, `15/05/2025 09:00:00,DV-1,,${AAPL},Dividend,,USD,,500,0.92,0,500,75`].join("\n"));
    expect(ly.cashTransactions.map((c) => [c.type, c.symbol, c.isin])).toEqual([["Dividends", AAPL, AAPL], ["Withholding Tax", AAPL, AAPL]]);
    expect(gross(ly, "Lightyear", method)).toBe("550.00");
    const t212 = trading212Parser.parse([T212_H, `Dividend (Ordinary),2025-05-15 09:00:00,${AAPL},,Apple Inc,,,USD,0.92,,,500,USD,,d1`].join("\n"));
    expect(gross(t212, "Trading 212", method)).toBe("550.00");
  });

  it.each(METHODS)("[%s] with neither ticker nor ISIN it is not booked and the warning names it, in every parser", async (method) => {
    const cases: [string, Statement][] = [
      ["Lightyear", lightyearParser.parse([LY_H, "15/05/2025 09:00:00,DV-1,,,Dividend,,USD,,500,0.92,0,500,75"].join("\n"))],
      ["Scalable Capital", scalableParser.parse([SC_H, "2025-05-15;09:15;Executed;REF001;XYZ SA;Security;Distribution;;;;500,00;0;0;EUR"].join("\n"))],
      ["Trading 212", trading212Parser.parse([T212_H, "Dividend (Ordinary),2025-05-15 09:00:00,,,Apple Inc,,,USD,0.92,,,500,USD,,d1"].join("\n"))],
      ["Revolut", await revolut(["2025-05-15T10:00:00Z", "", "DIVIDEND", "", "", "USD 500", "USD", "1"])],
    ];
    const rows = cases.map(([broker, s]) => [broker, unidentified(s), gross(s, broker, method)]);
    expect(rows).toEqual([
      ["Lightyear", "Dividend 500 USD (Tax Amt. 75) 20250515", "0.00"],
      ["Scalable Capital", "Distribution XYZ SA 500 EUR 20250515", "0.00"],
      ["Trading 212", "Dividend (Ordinary) 500 USD 20250515", "0.00"],
      ["Revolut", "DIVIDEND USD 500 20250515", "0.00"],
    ]);
  });
});

describe("#467 IBKR cash rows read every Flex Date/Time separator", () => {
  const xml = (dateTime: string): string => `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20250101" toDate="20251231" period="Custom"><Trades /><CashTransactions><CashTransaction transactionID="D1" accountId="U1" symbol="AAPL" description="AAPL Cash Dividend" isin="${AAPL}" currency="USD" dateTime="${dateTime}" amount="110" fxRateToBase="1" type="Dividends" /><CashTransaction transactionID="W1" accountId="U1" symbol="AAPL" description="AAPL US Tax" isin="${AAPL}" currency="USD" dateTime="${dateTime}" amount="-16.5" fxRateToBase="1" type="Withholding Tax" /></CashTransactions><CorporateActions /><OpenPositions /><SecuritiesInfo /></FlexStatement></FlexStatements></FlexQueryResponse>`;
  const forms = ["20250601;100000", "20250601,100000", "20250601 100000", "20250601100000", "2025060110:00:00",
    "2025-06-01;10:00:00", "2025-06-01,10:00:00", "2025-06-01 10:00:00", "2025-06-0110:00:00", "2025-06-01100000", "20250601"];

  describe.each(forms)("dateTime %j", (dateTime) => {
    it.each(METHODS)("[%s] the 110 USD dividend is 121.00 € and its withholding 18.15 €, with no warning", (method) => {
      const parsed = parseIbkrFlexXml(xml(dateTime));
      expect(parsed.parserMessages?.some((m) => m.id === "parser.cash_row_undated") ?? false).toBe(false);
      const r = run([[parsed, "Interactive Brokers"]], 2025, method);
      expect([r.dividends.grossIncome.toFixed(2), r.dividends.entries.map((e) => e.withholdingTaxEur.toFixed(2))]).toEqual(["121.00", ["18.15"]]);
    });
  });
});

describe("#467 a readable cash row that names a security is no trade evidence", () => {
  it("Trading 212 'Result adjustment' and Lightyear 'Fee' and 'Tax' with an empty share count: no trade, no unreadable row", () => {
    const t212 = trading212Parser.parse([T212_H, `Result adjustment,2024-03-20 09:30:00,${AAPL},AAPL,Apple Inc,,,,,,,0.50,EUR,,r1`].join("\n"));
    const ly = lightyearParser.parse([LY_H, `20/03/2024 09:30:00,FE-1,AAPL,${AAPL},Fee,,USD,,1,,0,1,`, `20/03/2024 09:30:00,TX-1,AAPL,${AAPL},Tax,,USD,,1,,0,1,`].join("\n"));
    const sc = scalableParser.parse([SC_H, `2024-03-20;09:15;Executed;REF001;XYZ SA;Security;Fee;${ISIN};;;-1,00;0;0;EUR`].join("\n"));
    for (const s of [t212, ly, sc]) {
      expect(s.trades).toEqual([]);
      expect(unreadableRows(s)).toBeUndefined();
    }
    expect(ly.parserMessages?.map((m) => m.id)).toEqual(["lightyear.unknown_types"]);
  });

  it("controls: the same actions writing a share count are still kept and named", () => {
    expect(unreadableRows(trading212Parser.parse([T212_H, `Result adjustment,2024-03-20 09:30:00,${AAPL},AAPL,Apple Inc,5,,,,,,0.50,EUR,,r1`].join("\n")))).toBe(`AAPL (${AAPL}) 20240320 [Action: "Result adjustment"]`);
    expect(unreadableRows(lightyearParser.parse([LY_H, `20/03/2024 09:30:00,FE-1,AAPL,${AAPL},Fee,5,USD,,1,,0,1,`].join("\n")))).toBe(`AAPL (${AAPL}) 20240320 [Type: "Fee"]`);
  });
});

describe("#467 a Revolut split with no readable date is named, never applied on a false day or dropped", () => {
  const file = (date: string): Promise<Statement> => revolut(
    ["2025-01-10T10:00:00Z", "AAPL", "BUY - MARKET", "10", "USD 100", "USD 1000", "USD", "1"],
    [date, "AAPL", "STOCK SPLIT", "10", "", "USD 0", "USD", "1"]);

  it.each([["n/a", "n/a"], ["", "—"]])("date %j: a row that books nothing, the holding of unknown size", async (date, shown) => {
    const parsed = await file(date);
    expect(parsed.corporateActions).toEqual([]);
    expect(parsed.trades.filter((t) => t.corporateActionRow).map((t) => [t.tradeDate, t.undatedRow, t.quantity])).toEqual([["", true, "0"]]);
    expect(messageRows(parsed, "parser.corporate_action_not_applied")).toBe(`AAPL ${shown} [STOCK SPLIT: 10]`);
    expect(parsed.openPositions.map((p) => [p.symbol, p.quantityUnknown])).toEqual([["AAPL", true]]);
  });

  it.each(METHODS)("[%s] control: the same split with its date is applied", async (method) => {
    const r = run([[await file("2025-03-01T10:00:00Z"), "Revolut"]], 2025, method);
    expect(r.messages.map((m) => m.id)).toContain("fifo.split_applied");
  });

  // A dated split whose Quantity is 0, empty or not a number says nothing of
  // the shares it added: it is kept and named like the undated one, never
  // only counted.
  const datedSplit = (quantity: string, ...before: string[][]): Promise<Statement> => revolut(...before,
    ["2024-12-02T10:00:00Z", "XYZ", "STOCK SPLIT", quantity, "", "EUR 0", "EUR", "1"]);

  it.each([["0", "0"], ["", "—"], ["abc", "abc"]])("dated, Quantity %j: a row that books nothing, named, the holding of unknown size", async (quantity, shown) => {
    const parsed = await datedSplit(quantity, ["2024-11-01T10:00:00Z", "XYZ", "BUY - MARKET", "10", "EUR 10", "EUR 100", "EUR", "1"]);
    expect(parsed.corporateActions).toEqual([]);
    expect(parsed.trades.filter((t) => t.corporateActionRow).map((t) => [t.symbol, t.tradeDate, t.quantity, t.proceeds, t.cost, t.undatedRow])).toEqual([["XYZ", "20241202", "0", "0", "0", undefined]]);
    expect(messageRows(parsed, "parser.corporate_action_not_applied")).toBe(`XYZ 20241202 [STOCK SPLIT: ${shown}]`);
    expect(parsed.parserMessages?.map((m) => m.id)).not.toContain("revolut.split_unresolved");
    // The readable 10 shares stay, flagged: the split's size is unknown.
    expect(parsed.openPositions.map((p) => [p.symbol, p.quantity, p.quantityUnknown])).toEqual([["XYZ", "10", true]]);
  });

  describe.each(["0", ""])("dated, Quantity %j, of the security on 02/12/2024 next to the IBKR issue file", (quantity) => {
    it.each(METHODS)("[%s] the exception is not applied, 100 € stay blocked", async (method) => {
      expect(issueSale(await datedSplit(quantity), "Revolut", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
    });
  });

  // Revolut writes no ISIN, so a kept row of any ticker leaves every security
  // "unverified", as the undated split does. The control is the same split
  // with a readable Quantity: it is applied as a split, so it is no evidence.
  it.each(METHODS)("[%s] control: the same split with a readable Quantity is applied, and the exception stays applied", async (method) => {
    expect(issueSale(await datedSplit("10"), "Revolut", method)).toEqual({ blocked: "0.00", singlePurchase: "applied" });
  });
});

describe("#467 Binance Transaction History: a row with no readable UTC_Time or Change is named, never only counted", () => {
  const TX_H = "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark";
  const message = (rows: { id: string }[] | undefined, id: string) => rows?.find((m) => m.id === id) as { context?: Record<string, string>; hint?: string } | undefined;

  it("each row is named by coin, operation, change and the cell, in the parser and in the report", () => {
    const parsed = binanceParser.parse([TX_H,
      "1,2025-01-04 11:20:13,Spot,Binance Convert,SOL,10,",
      "1,2025-01-04 11:20:13,Spot,Binance Convert,USDT,-200,",
      "1,,Spot,Binance Convert,BTC,0.01,",
      "1,not-a-date,Spot,Simple Earn Flexible Interest,ETH,0.001,",
      "1,2025-03-15,Spot,Buy,DOGE,50,",
      "1,2025-02-01 09:00:00,Spot,Binance Convert,ADA,abc,",
    ].join("\n"));
    const time = message(parsed.parserMessages, "binance.unparseable_timestamp");
    expect(time?.context).toEqual({ count: "3", rows: 'BTC Binance Convert 0.01 [UTC_Time: ""]; ETH Simple Earn Flexible Interest 0.001 [UTC_Time: "not-a-date"]; DOGE Buy 50 [UTC_Time: "2025-03-15"]' });
    expect(message(parsed.parserMessages, "binance.unparseable_amount")?.context).toEqual({ count: "1", rows: 'ADA Binance Convert 20250201 [Change: "abc"]' });
    const r = run([[parsed, "Binance"]], 2025, "multidivisa");
    expect(message(r.messages, "binance.unparseable_timestamp")?.context?.rows).toBe(time?.context?.rows);
    // The readable permuta is still booked.
    expect(parsed.trades.map((t) => [t.symbol, t.buySell])).toEqual([["USDT", "SELL"], ["SOL", "BUY"]]);
  });

  it("both warnings exist in the five locales, name the rows and say the coin's art. 33.5.e result is not reliable", () => {
    for (const id of ["binance.unparseable_timestamp", "binance.unparseable_amount"]) {
      expect(isTranslationKey(id) && isTranslationKey(`${id}.hint`)).toBe(true);
      for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
        expect(locale[id]).toContain("{{rows}}");
        expect(locale[`${id}.hint`]).toContain("33.5.e");
      }
    }
  });

  // BTC bought on 10/01/2024 for 500 €, sold on 01/02/2025 for 300 € (a 200 €
  // loss), bought again on 01/06/2025 for 300 €: the loss waits on that coin
  // (art. 33.5.e). With the rebuy's UTC_Time empty the report cannot block the
  // loss, so the warning must name the BTC rows and say why.
  const file = (rebuyTime: string): Statement => binanceParser.parse([TX_H,
    "1,2024-01-10 10:00:00,Spot,Buy Crypto With Fiat,BTC,0.01,W/1",
    "1,2024-01-10 10:00:00,Spot,Buy Crypto With Fiat,EUR,-500,W/1",
    "1,2025-02-01 10:00:00,Spot,Binance Convert,BTC,-0.01,",
    "1,2025-02-01 10:00:00,Spot,Binance Convert,EUR,300,",
    `1,${rebuyTime},Spot,Buy Crypto With Fiat,BTC,0.01,W/3`,
    `1,${rebuyTime},Spot,Buy Crypto With Fiat,EUR,-300,W/3`,
  ].join("\n"));
  const blocked = (r: TaxReport): string => r.capitalGains.disposals.reduce((sum, d) => sum.plus(d.blockedLossEur), new Decimal(0)).toFixed(2);

  it.each(METHODS)("[%s] an undated rebuy of BTC: the loss cannot be tied, and the warning names both rows and art. 33.5.e", (method) => {
    const r = run([[file(""), "Binance"]], 2025, method);
    expect(blocked(r)).toBe("0.00");
    const warning = message(r.messages, "binance.unparseable_timestamp");
    expect(warning?.context?.rows).toBe('BTC Buy Crypto With Fiat 0.01 [UTC_Time: ""]; EUR Buy Crypto With Fiat -300 [UTC_Time: ""]');
    expect(warning?.hint).toContain("33.5.e");
  });

  it.each(METHODS)("[%s] control: the same rebuy with its date blocks the 200 € and gives no warning", (method) => {
    const r = run([[file("2025-06-01 10:00:00"), "Binance"]], 2025, method);
    expect(blocked(r)).toBe("200.00");
    expect(r.messages.some((m) => m.id.startsWith("binance.unparseable"))).toBe(false);
  });

  it("a Change that is empty, blank, NaN or Infinity is named with its cell; a row with no Coin is named with the Coin cell", () => {
    const parsed = binanceParser.parse([TX_H,
      "1,2025-02-01 10:00:00,Spot,Buy,BTC,,",
      "1,2025-02-01 10:00:00,Spot,Sell,BTC,  ,",
      "1,2025-02-01 10:00:00,Spot,Buy,BTC,NaN,",
      "1,2025-02-01 10:00:00,Spot,Buy,BTC,Infinity,",
      "1,,Spot,Buy,BTC,,",
      "1,2025-02-01 10:00:00,Spot,Buy,,0.5,",
      "1,,Spot,Buy,,-0.5,",
    ].join("\n"));
    expect(parsed.trades).toEqual([]);
    expect(parsed.cashTransactions).toEqual([]);
    expect(message(parsed.parserMessages, "binance.unparseable_amount")?.context).toEqual({ count: "4", rows:
      'BTC Buy 20250201 [Change: ""]; BTC Sell 20250201 [Change: ""]; BTC Buy 20250201 [Change: "NaN"]; BTC Buy 20250201 [Change: "Infinity"]' });
    expect(message(parsed.parserMessages, "binance.unparseable_timestamp")?.context).toEqual({ count: "1", rows: 'BTC Buy [Change: ""] [UTC_Time: ""]' });
    expect(message(parsed.parserMessages, "binance.unparseable_coin")?.context).toEqual({ count: "2", rows: 'Buy 0.5 20250201 [Coin: ""]; Buy -0.5 [UTC_Time: ""] [Coin: ""]' });
  });

  it("control: a '--' or zero Change, an empty row and an internal transfer still give no warning", () => {
    const parsed = binanceParser.parse([TX_H,
      "1,2025-02-01 10:00:00,Spot,Transaction Fee,BNB,--,",
      "1,2025-02-01 10:00:00,Spot,Buy,BTC,0,",
      "1,2025-02-01 10:00:00,Spot,Buy,,0,",
      "1,2025-02-01 10:00:00,Spot,Buy,,,",
      "1,2025-02-01 10:00:00,Spot,Deposit,EUR,,",
    ].join("\n"));
    expect(parsed.parserMessages ?? []).toEqual([]);
  });

  it.each(METHODS)("[%s] a BTC rebuy with an empty Change after a loss sale: the report names the row instead of only dropping it", (method) => {
    const parsed = binanceParser.parse([TX_H,
      "1,2024-01-10 10:00:00,Spot,Buy Crypto With Fiat,BTC,0.01,W/1",
      "1,2024-01-10 10:00:00,Spot,Buy Crypto With Fiat,EUR,-500,W/1",
      "1,2025-02-01 10:00:00,Spot,Binance Convert,BTC,-0.01,",
      "1,2025-02-01 10:00:00,Spot,Binance Convert,EUR,300,",
      "1,2025-06-01 10:00:00,Spot,Buy Crypto With Fiat,BTC,,W/3",
      "1,2025-06-01 10:00:00,Spot,Buy Crypto With Fiat,EUR,-300,W/3",
    ].join("\n"));
    const r = run([[parsed, "Binance"]], 2025, method);
    expect(message(r.messages, "binance.unparseable_amount")?.context?.rows).toBe('BTC Buy Crypto With Fiat 20250601 [Change: ""]');
  });

  // A trade leg no other leg pairs within 1 s books nothing: it is named by
  // coin, operation, change and time, never dropped with no word (#467).
  it("a plain spot Buy and Sell 5 s apart: no trade, and both legs are named", () => {
    const parsed = binanceParser.parse([TX_H,
      "1,2025-06-01 10:00:00,Spot,Buy,BTC,0.01,",
      "1,2025-06-01 10:00:05,Spot,Sell,EUR,-500,",
    ].join("\n"));
    expect(parsed.trades).toEqual([]);
    expect(message(parsed.parserMessages, "binance.unpaired_leg")?.context).toEqual({ count: "2", rows:
      "BTC Buy 0.01 2025-06-01 10:00:00; EUR Sell -500 2025-06-01 10:00:05" });
    expect(parsed.parserMessages?.map((m) => m.id)).toEqual(["binance.unpaired_leg"]);
  });

  it("every leg left without a counterpart is named the same way: a spot sale, a Convert and a Strategy leg", () => {
    const parsed = binanceParser.parse([TX_H,
      "1,2025-04-01 12:00:00,Spot,Sell,ETH,-1,",
      "1,2025-04-01 12:00:00,Spot,Buy,EUR,3000,",
      "1,2025-04-01 12:00:00,Spot,Sell,SOL,-2,",
      "1,2025-04-02 12:00:00,Spot,Binance Convert,USDT,-200,",
      "1,2025-04-02 12:00:00,Spot,Binance Convert,SOL,2,",
      "1,2025-04-02 12:00:00,Spot,Binance Convert,ETH,0.1,",
      "1,2025-04-03 12:00:00,Strategy,Transaction Sold,XRP,-10,",
      "1,2025-04-03 12:00:00,Strategy,Transaction Sold,ADA,-50,",
      "1,2025-04-03 12:00:00,Strategy,Transaction Revenue,USDT,20,",
    ].join("\n"));
    expect(message(parsed.parserMessages, "binance.unpaired_leg")?.context?.rows).toBe(
      "SOL Sell -2 2025-04-01 12:00:00; ETH Binance Convert 0.1 2025-04-02 12:00:00; ADA Transaction Sold -50 2025-04-03 12:00:00");
    expect(parsed.parserMessages?.some((m) => m.id === "binance.unhandled_operation")).toBe(false);
  });

  // BTC bought on 10/01/2024 for 500 €, sold on 01/02/2025 for 300 € (a 200 €
  // loss), bought again on 01/06/2025 with a plain spot Buy/Sell pair. With
  // the legs 5 s apart nothing pairs them: the report cannot block the loss,
  // so the warning names both legs and says why.
  const spotRebuy = (gap: string): Statement => binanceParser.parse([TX_H,
    "1,2024-01-10 10:00:00,Spot,Buy,BTC,0.01,",
    "1,2024-01-10 10:00:00,Spot,Sell,EUR,-500,",
    "1,2025-02-01 10:00:00,Spot,Sell,BTC,-0.01,",
    "1,2025-02-01 10:00:00,Spot,Buy,EUR,300,",
    "1,2025-06-01 10:00:00,Spot,Buy,BTC,0.01,",
    `1,2025-06-01 10:00:${gap},Spot,Sell,EUR,-300,`,
  ].join("\n"));

  it.each(METHODS)("[%s] a spot rebuy whose legs do not pair: the warning names both legs and art. 33.5.e", (method) => {
    const r = run([[spotRebuy("05"), "Binance"]], 2025, method);
    expect(blocked(r)).toBe("0.00");
    const warning = message(r.messages, "binance.unpaired_leg");
    expect(warning?.context?.rows).toBe("BTC Buy 0.01 2025-06-01 10:00:00; EUR Sell -300 2025-06-01 10:00:05");
    expect(warning?.hint).toContain("33.5.e");
  });

  it.each(METHODS)("[%s] control: the same rebuy with both legs in one second blocks the 200 € and gives no warning", (method) => {
    const r = run([[spotRebuy("00"), "Binance"]], 2025, method);
    expect(blocked(r)).toBe("200.00");
    expect(r.messages.some((m) => m.id.startsWith("binance."))).toBe(false);
  });

  it("the unpaired-leg warning exists in the five locales, names the rows and says the art. 33.5.e result is not reliable", () => {
    expect(isTranslationKey("binance.unpaired_leg") && isTranslationKey("binance.unpaired_leg.hint")).toBe(true);
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
      expect(locale["binance.unpaired_leg"]).toContain("{{rows}}");
      expect(locale["binance.unpaired_leg.hint"]).toContain("33.5.e");
    }
  });

  it("the no-coin warning exists in the five locales, names the rows and says the art. 33.5.e result is not reliable", () => {
    expect(isTranslationKey("binance.unparseable_coin") && isTranslationKey("binance.unparseable_coin.hint")).toBe(true);
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
      expect(locale["binance.unparseable_coin"]).toContain("{{rows}}");
      expect(locale["binance.unparseable_coin.hint"]).toContain("33.5.e");
    }
  });
});

describe("#467 Freedom24 corporate actions: a dividend with no ticker goes by its ISIN, a split is kept, and the malformed-row hint is true", () => {
  const f24ca = (...rows: Record<string, unknown>[]): Statement => freedom24Parser.parse(JSON.stringify({
    trades: { detailed: [] }, corporate_actions: { detailed: rows },
  }));
  const DIV = { date: "2025-05-15 00:00:00", ticker: "AAPL.US", isin: AAPL, type_id: "dividend", amount: "500", tax_amount: "75", curr_c: "USD" };

  it.each(METHODS)("[%s] a USD 500 dividend with only an ISIN is 550.00 € (at 1.10), with its withholding", (method) => {
    const parsed = f24ca({ ...DIV, ticker: null });
    expect(parsed.cashTransactions.map((c) => [c.type, c.symbol, c.isin])).toEqual([["Dividends", AAPL, AAPL], ["Withholding Tax", AAPL, AAPL]]);
    expect(parsed.parserMessages ?? []).toEqual([]);
    const r = run([[parsed, "Freedom24"]], 2025, method);
    expect(r.dividends.grossIncome.toFixed(2)).toBe("550.00");
  });

  it.each(METHODS)("[%s] with neither ticker nor ISIN it is not booked and parser.cash_row_unidentified names it", (method) => {
    const parsed = f24ca({ ...DIV, ticker: "", isin: "" });
    expect(messageRows(parsed, "parser.cash_row_unidentified")).toBe("dividend 500 USD (tax_amount 75) 20250515");
    expect(parsed.parserMessages?.map((m) => m.id)).toEqual(["parser.cash_row_unidentified"]);
    expect(run([[parsed, "Freedom24"]], 2025, method).dividends.grossIncome.toFixed(2)).toBe("0.00");
  });

  it("a row with no readable type_id is counted, and the hint names only the cause that leads there, in the five locales", () => {
    const parsed = f24ca({ ...DIV, type_id: null }, { ...DIV, type_id: 7 });
    const warning = parsed.parserMessages?.find((m) => m.id === "freedom24.row_skipped_malformed");
    expect(warning?.context).toEqual({ count: "2" });
    expect(warning?.hint).toContain("type_id");
    expect(warning?.hint).not.toMatch(/"date"|"ticker"/);
    expect(warning?.hint).toContain("compra única");
    expect(isTranslationKey("freedom24.row_skipped_malformed") && isTranslationKey("freedom24.row_skipped_malformed.hint")).toBe(true);
    for (const [locale, rule] of [[es, "compra única"], [en, "one-purchase"], [ca, "compra única"], [eu, "erosketa bakarraren"], [gl, "compra única"]] as [Record<string, string>, string][]) {
      expect(locale["freedom24.row_skipped_malformed"]).toContain("{{count}}");
      expect(locale["freedom24.row_skipped_malformed.hint"]).toContain("type_id");
      expect(locale["freedom24.row_skipped_malformed.hint"]).not.toMatch(/date|ticker/);
      // The row may move shares: the 2-month one-purchase check may be affected.
      expect(locale["freedom24.row_skipped_malformed.hint"]).toContain(rule);
      expect(locale["freedom24.row_skipped_malformed.hint"]).toContain("2");
    }
  });

  // A row with no readable type_id may be a split, a merger or a dividend:
  // it is kept as a corporate action that books nothing, so its security (or,
  // with none named, every security) is "unverified" (#467).
  describe.each([["null", null], ["empty", ""], ["a number", 7], ["missing", undefined]])("a corporate action whose type_id is %s", (_label, type_id) => {
    const typeless = (row: Record<string, unknown> = {}): Statement =>
      f24ca({ date: "2024-12-02 00:00:00", ticker: "XYZ.EU", isin: ISIN, amount: 0, curr_c: "EUR", type_id, ...row });
    const cell = type_id === undefined ? "—" : JSON.stringify(type_id);

    it("is kept as a row that books nothing, named as not applied, and still counted", () => {
      const parsed = typeless();
      expect(parsed.trades.map((t) => [t.symbol, t.isin, t.quantity, t.proceeds, t.cost, t.quantityUnknown])).toEqual([["XYZ", ISIN, "0", "0", "0", true]]);
      expect(messageRows(parsed, "parser.corporate_action_not_applied")).toBe(`XYZ (${ISIN}) 20241202 [type_id: ${cell}]`);
      expect(parsed.parserMessages?.find((m) => m.id === "freedom24.row_skipped_malformed")?.context).toEqual({ count: "1" });
      expect(parsed.cashTransactions).toEqual([]);
    });

    it.each(METHODS)("[%s] of the security next to the IBKR issue file: the exception is not applied, 100 € stay blocked", (method) => {
      expect(issueSale(typeless(), "Freedom24", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
    });

    it.each(METHODS)("[%s] with no ticker and no ISIN: every security stays unverified, 100 € blocked", (method) => {
      expect(issueSale(typeless({ ticker: "", isin: "" }), "Freedom24", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
    });

    it.each(METHODS)("[%s] control: of another security, the exception stays applied", (method) => {
      expect(issueSale(typeless({ ticker: "ABC.EU", isin: "ES0000009999" }), "Freedom24", method)).toEqual({ blocked: "0.00", singlePurchase: "applied" });
    });
  });

  // A dividend whose tax_amount cell is written but cannot be read is booked
  // with no withholding (the user can only lose a deduction, never underpay),
  // and the cell is named (#467).
  it.each(METHODS)("[%s] a dividend with an unreadable tax_amount is booked with no withholding, and the cell is named", (method) => {
    const parsed = f24ca(
      { ...DIV, tax_amount: "abc" },
      { ...DIV, ticker: "", tax_amount: "NaN", date: "2025-05-16 00:00:00" },
      { ...DIV, tax_amount: "Infinity", date: "2025-05-17 00:00:00" },
      { ...DIV, tax_amount: { v: 1 }, date: "2025-05-18 00:00:00" },
      { ...DIV, tax_amount: true, date: "2025-05-19 00:00:00" },
    );
    expect(messageRows(parsed, "freedom24.tax_amount_unreadable")).toBe([
      `dividend AAPL (${AAPL}) 500 USD 20250515 [tax_amount: "abc"]`,
      `dividend ${AAPL} 500 USD 20250516 [tax_amount: "NaN"]`,
      `dividend AAPL (${AAPL}) 500 USD 20250517 [tax_amount: "Infinity"]`,
      `dividend AAPL (${AAPL}) 500 USD 20250518 [tax_amount: {"v":1}]`,
      `dividend AAPL (${AAPL}) 500 USD 20250519 [tax_amount: true]`,
    ].join("; "));
    expect(parsed.cashTransactions.map((c) => c.type)).toEqual(["Dividends", "Dividends", "Dividends", "Dividends", "Dividends"]);
    const r = run([[parsed, "Freedom24"]], 2025, method);
    expect(r.dividends.grossIncome.toFixed(2)).toBe("2750.00");
    expect(r.messages.find((m) => m.id === "freedom24.tax_amount_unreadable")?.context?.rows).toBe(messageRows(parsed, "freedom24.tax_amount_unreadable"));
  });

  it("control: a tax_amount that is missing, null, empty or zero gives no warning; a readable one is booked", () => {
    const parsed = f24ca(
      { ...DIV, tax_amount: undefined },
      { ...DIV, tax_amount: null, date: "2025-05-16 00:00:00" },
      { ...DIV, tax_amount: "", date: "2025-05-17 00:00:00" },
      { ...DIV, tax_amount: 0, date: "2025-05-18 00:00:00" },
      { ...DIV, date: "2025-05-19 00:00:00" },
    );
    expect(parsed.parserMessages ?? []).toEqual([]);
    expect(parsed.cashTransactions.map((c) => [c.type, c.amount])).toEqual([
      ["Dividends", "500"], ["Dividends", "500"], ["Dividends", "500"], ["Dividends", "500"], ["Dividends", "500"], ["Withholding Tax", "-75"],
    ]);
  });

  it("an unreadable tax_amount on a row that is not booked is shown in that row's own warning", () => {
    const parsed = f24ca({ ...DIV, ticker: "", isin: "", tax_amount: "abc" }, { ...DIV, amount: "x", tax_amount: "abc" });
    expect(messageRows(parsed, "parser.cash_row_unidentified")).toBe('dividend 500 USD [tax_amount: "abc"] 20250515');
    expect(messageRows(parsed, "freedom24.dividend_amount_unreadable")).toBe(`dividend AAPL (${AAPL}) USD 20250515 [tax_amount: "abc"] [amount: "x"]`);
    expect(messageRows(parsed, "freedom24.tax_amount_unreadable")).toBeUndefined();
  });

  it("the Spanish the parsers emit for the new and reworded warnings is the es locale", () => {
    const fill = (text: string, context: Record<string, string> | undefined): string =>
      text.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => context?.[k] ?? "");
    const emitted = [
      ...(f24ca({ ...DIV, type_id: null }, { ...DIV, tax_amount: "abc" }).parserMessages ?? []),
      ...(binanceParser.parse(["User_ID,UTC_Time,Account,Operation,Coin,Change,Remark", "1,2025-06-01 10:00:00,Spot,Buy,BTC,0.01,"].join("\n")).parserMessages ?? []),
    ].filter((m) => ["freedom24.row_skipped_malformed", "freedom24.tax_amount_unreadable", "binance.unpaired_leg"].includes(m.id));
    expect(emitted.map((m) => m.id).sort()).toEqual(["binance.unpaired_leg", "freedom24.row_skipped_malformed", "freedom24.tax_amount_unreadable"]);
    const esText = es as Record<string, string>;
    for (const m of emitted) {
      expect(m.message).toBe(fill(esText[m.id]!, m.context));
      expect(m.hint).toBe(esText[`${m.id}.hint`]);
    }
  });

  it("the unreadable-tax warning exists in the five locales, names the rows and the tax_amount cell", () => {
    expect(isTranslationKey("freedom24.tax_amount_unreadable") && isTranslationKey("freedom24.tax_amount_unreadable.hint")).toBe(true);
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
      expect(locale["freedom24.tax_amount_unreadable"]).toContain("{{rows}}");
      expect(locale["freedom24.tax_amount_unreadable.hint"]).toContain("tax_amount");
      expect(locale["freedom24.tax_amount_unreadable.hint"]).toContain("0588");
    }
  });

  it("a dividend with no readable date is still named by parser.cash_row_undated, not counted as malformed", () => {
    const parsed = f24ca({ ...DIV, date: null });
    expect(parsed.parserMessages?.map((m) => m.id)).toEqual(["parser.cash_row_undated"]);
  });

  const split = (isin: string): Statement => f24ca({ date: "2024-12-02 00:00:00", ticker: "XYZ.EU", isin, type_id: "split", amount: 0, curr_c: "EUR" });

  it("a split is kept as a row that books nothing, named as not applied", () => {
    const parsed = split(ISIN);
    expect(parsed.trades.map((t) => [t.symbol, t.isin, t.quantity, t.quantityUnknown])).toEqual([["XYZ", ISIN, "0", true]]);
    expect(messageRows(parsed, "parser.corporate_action_not_applied")).toBe(`XYZ (${ISIN}) 20241202 [split: —]`);
    expect(parsed.cashTransactions).toEqual([]);
  });

  it.each(METHODS)("[%s] a split of the security on 02/12/2024 next to the IBKR issue file: the exception is not applied, 100 € stay blocked", (method) => {
    expect(issueSale(split(ISIN), "Freedom24", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
  });

  it.each(METHODS)("[%s] control: a split of another security leaves the exception applied", (method) => {
    expect(issueSale(split("ES0000009999"), "Freedom24", method)).toEqual({ blocked: "0.00", singlePurchase: "applied" });
  });

  const action = (row: Record<string, unknown>): Statement => f24ca({ date: "2024-12-02 00:00:00", ticker: "XYZ.EU", isin: ISIN, amount: 0, curr_c: "EUR", ...row });

  it.each(METHODS)("[%s] a split with no ticker and no ISIN is kept and named: every security stays unverified, 100 € blocked", (method) => {
    const parsed = action({ ticker: "", isin: "", type_id: "split" });
    expect(messageRows(parsed, "parser.corporate_action_not_applied")).toBe("— 20241202 [split: —]");
    expect(issueSale(parsed, "Freedom24", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
  });

  describe.each(["conversion", "bonus", "exchange", "transfer", "maturity", "redemption", "delisting"])("a corporate action of type %j", (type_id) => {
    it("is kept as a row that books nothing, named as not applied", () => {
      const parsed = action({ type_id, amount: "1000" });
      expect(messageRows(parsed, "parser.corporate_action_not_applied")).toBe(`XYZ (${ISIN}) 20241202 [${type_id}: —]`);
      expect(parsed.trades.map((t) => [t.quantity, t.proceeds, t.cost])).toEqual([["0", "0", "0"]]);
      expect(parsed.cashTransactions).toEqual([]);
    });

    it.each(METHODS)("[%s] next to the IBKR issue file: the exception is not applied, 100 € stay blocked", (method) => {
      expect(issueSale(action({ type_id }), "Freedom24", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
    });
  });

  it.each(METHODS)("[%s] control: a conversion of another security leaves the exception applied", (method) => {
    expect(issueSale(action({ type_id: "conversion", isin: "ES0000009999", ticker: "ABC.EU" }), "Freedom24", method)).toEqual({ blocked: "0.00", singlePurchase: "applied" });
  });

  it("the not-applied hint says a row that paid money is a sale missing from the report, in the five locales", () => {
    for (const [locale, word] of [[es, "vencimiento"], [en, "maturity"], [ca, "venciment"], [eu, "mugaeguna"], [gl, "vencemento"]] as [Record<string, string>, string][]) {
      expect(locale["parser.corporate_action_not_applied.hint"]).toContain(word);
    }
  });

  it.each(METHODS)("[%s] a dividend with an unreadable amount is named, never booked, and the report still runs", (method) => {
    const parsed = f24ca(
      { ...DIV, ticker: "", amount: "abc" },
      { ...DIV, amount: null },
      { ...DIV, ticker: "", amount: "" },
      { ...DIV, amount: "Infinity", tax_amount: "" },
      { ...DIV, date: "2025-06-15 00:00:00" },
    );
    expect(messageRows(parsed, "freedom24.dividend_amount_unreadable")).toBe([
      `dividend ${AAPL} USD 20250515 (tax_amount 75) [amount: "abc"]`,
      `dividend AAPL (${AAPL}) USD 20250515 (tax_amount 75) [amount: null]`,
      `dividend ${AAPL} USD 20250515 (tax_amount 75) [amount: ""]`,
      `dividend AAPL (${AAPL}) USD 20250515 [amount: "Infinity"]`,
    ].join("; "));
    expect(parsed.cashTransactions.map((c) => [c.type, c.amount, c.dateTime])).toEqual([["Dividends", "500", "20250615"], ["Withholding Tax", "-75", "20250615"]]);
    expect(run([[parsed, "Freedom24"]], 2025, method).dividends.grossIncome.toFixed(2)).toBe("550.00");
  });

  it("a dividend with no security and an unreadable or missing amount is named, never read as zero", () => {
    const parsed = f24ca({ ...DIV, ticker: "", isin: "", amount: "abc", tax_amount: "" }, { ...DIV, ticker: "", isin: "", amount: undefined, tax_amount: undefined });
    expect(messageRows(parsed, "parser.cash_row_unidentified")).toBe('dividend [amount: "abc"] USD 20250515; dividend [amount: —] USD 20250515');
    expect(parsed.cashTransactions).toEqual([]);
  });

  it("the unreadable-amount warning exists in the five locales and names the rows", () => {
    expect(isTranslationKey("freedom24.dividend_amount_unreadable") && isTranslationKey("freedom24.dividend_amount_unreadable.hint")).toBe(true);
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
      expect(locale["freedom24.dividend_amount_unreadable"]).toContain("{{rows}}");
      expect(locale["freedom24.dividend_amount_unreadable.hint"]).toContain("amount");
    }
  });
});

describe("#467 a crypto buy or sale whose quantity, side or coin cannot be read is named, never dropped with no word", () => {
  // BTC bought on 15/03/2024 for 3000 € and sold on 01/03/2025 for 9000 €: a
  // 6000 € gain. When the sale's quantity, side or coin cannot be read, the
  // parser cannot book it, so the row must be named: a silent skip hides the
  // gain.
  const CB_H = "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";
  const cbBuy = "2024-03-15T10:30:00Z,Buy,BTC,0.1,EUR,30000.00,3000.00,3000.00,0,";
  const cbSell = (asset: string, qty: string): string => `2025-03-01T10:00:00Z,Sell,${asset},${qty},EUR,90000.00,9000.00,9000.00,0,`;
  const coinbase = (...rows: string[]): Statement => coinbaseParser.parse([CB_H, ...rows].join("\n"));
  const BN_H = "Date(UTC),Pair,Side,Price,Executed,Amount,Fee";
  const bnBuy = "2024-01-15 10:30:00,BTCEUR,BUY,30000.00,0.1,3000.00,0EUR";
  const bnSell = (side: string, executed: string): string => `2025-03-01 10:00:00,BTCEUR,${side},90000.00,${executed},9000.00,0EUR`;
  const binance = (...rows: string[]): Statement => binanceParser.parse([BN_H, ...rows].join("\n"));
  const KR_H = `"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers"`;
  const krBuy = `"T1","O1","XBTEUR","2024-03-15 10:30:00","buy","limit","30000.00","3000.00","0","0.1","0.0","","L1"`;
  const krSell = (vol: string): string => `"T2","O2","XBTEUR","2025-03-01 10:00:00","sell","market","90000.00","9000.00","0","${vol}","0.0","","L2"`;
  const kraken = (...rows: string[]): Statement => krakenParser.parse([KR_H, ...rows].join("\n"));

  const cases: { label: string; broker: string; parse: () => Statement; rows: string }[] = [
    { label: "Coinbase, Quantity empty", broker: "Coinbase", parse: () => coinbase(cbBuy, cbSell("BTC", "")), rows: 'BTC 20250301 [Quantity Transacted: ""]' },
    { label: "Coinbase, Quantity 'abc'", broker: "Coinbase", parse: () => coinbase(cbBuy, cbSell("BTC", "abc")), rows: 'BTC 20250301 [Quantity Transacted: "abc"]' },
    { label: "Coinbase, Asset empty", broker: "Coinbase", parse: () => coinbase(cbBuy, cbSell("", "0.1")), rows: 'Sell 0.1 20250301 [Asset: ""]' },
    { label: "Binance Trade History, Side empty", broker: "Binance", parse: () => binance(bnBuy, bnSell("", "0.1")), rows: 'BTC 20250301 [Side: ""]' },
    { label: "Binance Trade History, Side 'SOLD'", broker: "Binance", parse: () => binance(bnBuy, bnSell("SOLD", "0.1")), rows: 'BTC 20250301 [Side: "SOLD"]' },
    { label: "Binance Trade History, Executed empty", broker: "Binance", parse: () => binance(bnBuy, bnSell("SELL", "")), rows: 'BTC 20250301 [Executed: ""]' },
    { label: "Binance Trade History, Executed '1,000.5BTC'", broker: "Binance", parse: () => binance(bnBuy, bnSell("SELL", '"1,000.5BTC"')), rows: 'BTC 20250301 [Executed: "1,000.5BTC"]' },
    { label: "Kraken trades, vol empty", broker: "Kraken", parse: () => kraken(krBuy, krSell("")), rows: 'BTC 20250301 [vol: ""]' },
    { label: "Kraken trades, vol 'abc'", broker: "Kraken", parse: () => kraken(krBuy, krSell("abc")), rows: 'BTC 20250301 [vol: "abc"]' },
  ];

  describe.each(cases)("$label", ({ broker, parse, rows }) => {
    it.each(METHODS)("[%s] the sale books nothing and parser.trade_row_unreadable names it", (method) => {
      const parsed = parse();
      expect(unreadableRows(parsed)).toBe(rows);
      const r = run([[parsed, broker]], 2025, method);
      expect(r.capitalGains.disposals).toEqual([]);
      expect(r.messages.find((m) => m.id === "parser.trade_row_unreadable")?.context?.rows).toBe(rows);
    });
  });

  const controls: [string, () => Statement][] = [
    ["Coinbase", () => coinbase(cbBuy, cbSell("BTC", "0.1"))],
    ["Binance", () => binance(bnBuy, bnSell("SELL", "0.1"))],
    ["Kraken", () => kraken(krBuy, krSell("0.1"))],
  ];
  describe.each(controls)("control: %s, the same sale readable", (broker, parse) => {
    it.each(METHODS)("[%s] gains 6000 € in one disposal, with no parser message", (method) => {
      const parsed = parse();
      expect(parsed.parserMessages ?? []).toEqual([]);
      const r = run([[parsed, broker]], 2025, method);
      expect([r.capitalGains.netGainLoss.toFixed(2), r.capitalGains.disposals.length]).toEqual(["6000.00", 1]);
    });
  });

  it("a crypto-quoted Binance row with no readable side or quantity names both coins", () => {
    expect(unreadableRows(binance("2025-03-01 10:00:00,ETHBTC,,0.05,1,0.05,0BTC"))).toBe('ETH 20250301 [Side: ""]; BTC 20250301 [Side: ""]');
    expect(unreadableRows(binance("2025-03-01 10:00:00,ETHBTC,SELL,0.05,,0.05,0BTC"))).toBe('ETH 20250301 [Executed: ""]; BTC 20250301 [Executed: ""]');
    expect(binance("2025-03-01 10:00:00,ETHBTC,SELL,0.05,,0.05,0BTC").trades.every((t) => t.quantityUnknown)).toBe(true);
  });

  it("a crypto-quoted Kraken row with no readable vol names both coins", () => {
    const parsed = kraken(`"T3","O3","XETHXXBT","2025-03-01 10:00:00","sell","market","0.05","0.05","0","","0.0","","L3"`);
    expect(unreadableRows(parsed)).toBe('ETH 20250301 [vol: ""]; BTC 20250301 [vol: ""]');
    expect(parsed.trades.every((t) => t.quantityUnknown)).toBe(true);
  });

  it("a Coinbase Convert whose Quantity cannot be read names the coin given up and still books the coin received", () => {
    const parsed = coinbase("2025-03-01T10:00:00Z,Convert,BTC,,EUR,90000.00,9000.00,9000.00,0,Converted 0.1 BTC to 3 ETH");
    expect(unreadableRows(parsed)).toBe('BTC 20250301 [Quantity Transacted: ""]');
    expect(parsed.trades.filter((t) => !t.quantityUnknown).map((t) => [t.symbol, t.buySell, t.quantity, t.cost])).toEqual([["ETH", "BUY", "3", "9000.00"]]);
  });

  it("control: a Coinbase row with no Asset that is no buy, sale or convert stays skipped with no word", () => {
    expect(coinbase("2025-03-01T10:00:00Z,Send,,0.1,EUR,90000.00,9000.00,9000.00,0,").parserMessages ?? []).toEqual([]);
  });

  // ETH bought on 15/03/2024 for 3000 €, sold on 01/03/2025 for 2000 € (a
  // 1000 € loss) and bought again on 01/07/2025: the loss waits (art. 33.5.e).
  // A rebuy row whose coin or quantity cannot be read cannot block it, so the
  // warning names the row and says the art. 33.5.e result is not reliable.
  const cbRebuy = (rebuy: string): Statement => coinbase(
    "2024-03-15T10:30:00Z,Buy,ETH,1,EUR,3000.00,3000.00,3000.00,0,",
    "2025-03-01T10:00:00Z,Sell,ETH,1,EUR,2000.00,2000.00,2000.00,0,",
    rebuy,
  );
  describe.each([
    ["Asset empty", "2025-07-01T10:00:00Z,Buy,,1,EUR,2000.00,2000.00,2000.00,0,", 'Buy 1 20250701 [Asset: ""]'],
    ["Quantity 'abc'", "2025-07-01T10:00:00Z,Buy,ETH,abc,EUR,2000.00,2000.00,2000.00,0,", 'ETH 20250701 [Quantity Transacted: "abc"]'],
    ["Quantity empty", "2025-07-01T10:00:00Z,Buy,ETH,,EUR,2000.00,2000.00,2000.00,0,", 'ETH 20250701 [Quantity Transacted: ""]'],
  ])("Coinbase rebuy with %s", (_label, rebuy, rows) => {
    it.each(METHODS)("[%s] the loss is not blocked, and the warning names the rebuy and art. 33.5.e", (method) => {
      const r = run([[cbRebuy(rebuy), "Coinbase"]], 2025, method);
      expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("0.00");
      const warning = r.messages.find((m) => m.id === "parser.trade_row_unreadable");
      expect(warning?.context?.rows).toBe(rows);
      expect(warning?.hint).toContain("33.5.e");
    });
  });

  it.each(METHODS)("[%s] control: the same rebuy readable blocks the 1000 € loss", (method) => {
    const r = run([[cbRebuy("2025-07-01T10:00:00Z,Buy,ETH,1,EUR,2000.00,2000.00,2000.00,0,"), "Coinbase"]], 2025, method);
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("1000.00");
    expect(r.messages.some((m) => m.id === "parser.trade_row_unreadable")).toBe(false);
  });

  it("the unreadable-row hint says a crypto row makes the art. 33.5.e result unreliable, in the five locales and in the Spanish the parser emits", () => {
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
      expect(locale["parser.trade_row_unreadable.hint"]).toContain("33.5.e");
    }
    const emitted = coinbase(cbBuy, cbSell("BTC", "")).parserMessages?.find((m) => m.id === "parser.trade_row_unreadable");
    expect(emitted?.hint).toBe((es as Record<string, string>)["parser.trade_row_unreadable.hint"]);
  });
});

describe("#467 Binance spot: several coins bought in one window never move one order's cost onto another coin with no word", () => {
  const TX_H = "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark";
  const message = (messages: readonly TaxMessage[] | undefined, id: string): TaxMessage | undefined => messages?.find((m) => m.id === id);
  const costOf = (s: Statement, coin: string): string | undefined => s.trades.find((t) => t.symbol === coin && t.buySell === "BUY")?.cost;
  const ethGain = (r: TaxReport): string[] => r.capitalGains.disposals.filter((d) => d.symbol === "ETH").map((d) => new Decimal(d.gainLossEur).toFixed(2));

  // Two BTC fills (0.05 for 5000 € each) at 10:00:00 and one ETH order (1 for
  // 100 €) at 10:00:0x. The ETH is sold on 01/06/2025 for 200 €: a 100 € gain.
  const multiFill = (ethSecond: string): Statement => binanceParser.parse([TX_H,
    "1,2025-01-10 10:00:00,Spot,Buy,BTC,0.05,", "1,2025-01-10 10:00:00,Spot,Sell,EUR,-5000,", "1,2025-01-10 10:00:00,Spot,Fee,BNB,-0.001,",
    "1,2025-01-10 10:00:00,Spot,Buy,BTC,0.05,", "1,2025-01-10 10:00:00,Spot,Sell,EUR,-5000,", "1,2025-01-10 10:00:00,Spot,Fee,BNB,-0.001,",
    `1,2025-01-10 10:00:${ethSecond},Spot,Buy,ETH,1,`, `1,2025-01-10 10:00:${ethSecond},Spot,Sell,EUR,-100,`, `1,2025-01-10 10:00:${ethSecond},Spot,Fee,BNB,-0.001,`,
    "1,2025-06-01 10:00:00,Spot,Sell,ETH,-1,", "1,2025-06-01 10:00:00,Spot,Buy,EUR,200,",
  ].join("\n"));

  it.each(METHODS)("[%s] two BTC fills and an ETH order 1 s later: each fill keeps its own payment, ETH gains 100 €", (method) => {
    const parsed = multiFill("01");
    expect([costOf(parsed, "BTC"), costOf(parsed, "ETH")]).toEqual(["10000", "100"]);
    expect(parsed.parserMessages ?? []).toEqual([]);
    expect(ethGain(run([[parsed, "Binance"]], 2025, method))).toEqual(["100.00"]);
  });

  it.each(METHODS)("[%s] control: the ETH order 3 s later gives the same numbers", (method) => {
    const parsed = multiFill("03");
    expect([costOf(parsed, "BTC"), costOf(parsed, "ETH")]).toEqual(["10000", "100"]);
    expect(ethGain(run([[parsed, "Binance"]], 2025, method))).toEqual(["100.00"]);
  });

  // BTC (0.1 for 10000 €) at 10:00:00; ETH's leg at 10:00:01 and its 100 €
  // at 10:00:02. The window of 10:00:00 has two coins and one payment, so
  // the payment must be shared by a guess: every leg is named.
  const straddle = (): Statement => binanceParser.parse([TX_H,
    "1,2025-01-10 10:00:00,Spot,Buy,BTC,0.1,", "1,2025-01-10 10:00:00,Spot,Sell,EUR,-10000,",
    "1,2025-01-10 10:00:01,Spot,Buy,ETH,1,", "1,2025-01-10 10:00:02,Spot,Sell,EUR,-100,",
    "1,2025-06-01 10:00:00,Spot,Sell,ETH,-1,", "1,2025-06-01 10:00:00,Spot,Buy,EUR,200,",
  ].join("\n"));

  it.each(METHODS)("[%s] a payment shared by a guess names every leg of its window and art. 33.5.e", (method) => {
    const parsed = straddle();
    const r = run([[parsed, "Binance"]], 2025, method);
    const warning = message(r.messages, "binance.spot_cost_split");
    expect(warning?.context).toEqual({ count: "3", rows: "BTC Buy 0.1 2025-01-10 10:00:00; EUR Sell -10000 2025-01-10 10:00:00; ETH Buy 1 2025-01-10 10:00:01" });
    expect(warning?.hint).toContain("33.5.e");
    expect(message(r.messages, "binance.unpaired_leg")?.context?.rows).toBe("EUR Sell -100 2025-01-10 10:00:02");
    // The total paid stays exact.
    expect(new Decimal(costOf(parsed, "BTC")!).plus(costOf(parsed, "ETH")!).toFixed(2)).toBe("10000.00");
  });

  it("two BTC fills paid in one EUR row and an ETH order in the same second: booked by order as before, but named", () => {
    const parsed = binanceParser.parse([TX_H,
      "1,2025-01-10 10:00:00,Spot,Buy,BTC,0.05,", "1,2025-01-10 10:00:00,Spot,Buy,BTC,0.05,", "1,2025-01-10 10:00:00,Spot,Sell,EUR,-10000,",
      "1,2025-01-10 10:00:00,Spot,Buy,ETH,1,", "1,2025-01-10 10:00:00,Spot,Sell,EUR,-100,",
    ].join("\n"));
    expect([costOf(parsed, "BTC"), costOf(parsed, "ETH")]).toEqual(["10000", "100"]);
    expect(message(parsed.parserMessages, "binance.spot_cost_split")?.context?.count).toBe("5");
  });

  // The same counts of received and EUR rows prove nothing when the file does
  // not write each payment next to its coin: then the payment of one order
  // may go to another coin. Each case ends with the ETH sold on 01/06/2025
  // for 200 €; the readable control writes each payment next to its coin.
  const window = (...legs: string[]): Statement => binanceParser.parse([TX_H,
    ...legs.map((l) => `1,2025-01-10 10:00:00,Spot,${l},`),
    "1,2025-06-01 10:00:00,Spot,Sell,ETH,-1,", "1,2025-06-01 10:00:00,Spot,Buy,EUR,200,",
  ].join("\n"));
  const unprovenCases: [string, string[], string][] = [
    ["ETH and two BTC fills, then three payments", ["Buy,ETH,1", "Buy,BTC,0.05", "Buy,BTC,0.05", "Sell,EUR,-5000", "Sell,EUR,-5000", "Sell,EUR,-100"],
      "ETH Buy 1 2025-01-10 10:00:00; BTC Buy 0.05 2025-01-10 10:00:00; BTC Buy 0.05 2025-01-10 10:00:00; EUR Sell -5000 2025-01-10 10:00:00; EUR Sell -5000 2025-01-10 10:00:00; EUR Sell -100 2025-01-10 10:00:00"],
    ["BTC and ETH, then the two payments", ["Buy,BTC,0.1", "Buy,ETH,1", "Sell,EUR,-100", "Sell,EUR,-10000"],
      "BTC Buy 0.1 2025-01-10 10:00:00; ETH Buy 1 2025-01-10 10:00:00; EUR Sell -100 2025-01-10 10:00:00; EUR Sell -10000 2025-01-10 10:00:00"],
  ];
  describe.each(unprovenCases)("%s: the payments are not written next to their coins", (_label, legs, rows) => {
    it.each(METHODS)("[%s] every leg of the window is named with art. 33.5.e, and the total paid stays exact", (method) => {
      const parsed = window(...legs);
      const r = run([[parsed, "Binance"]], 2025, method);
      const warning = message(r.messages, "binance.spot_cost_split");
      expect(warning?.context).toEqual({ count: String(legs.length), rows });
      expect(warning?.hint).toContain("33.5.e");
      expect(new Decimal(costOf(parsed, "BTC")!).plus(costOf(parsed, "ETH")!).toFixed(2)).toBe("10100.00");
    });
  });

  const provenCases: [string, string[]][] = [
    ["ETH, BTC and BTC, each with its payment after it", ["Buy,ETH,1", "Sell,EUR,-100", "Buy,BTC,0.05", "Sell,EUR,-5000", "Buy,BTC,0.05", "Sell,EUR,-5000"]],
    ["BTC and ETH, each with its payment before it", ["Sell,EUR,-10000", "Buy,BTC,0.1", "Sell,EUR,-100", "Buy,ETH,1"]],
  ];
  describe.each(provenCases)("control: %s", (_label, legs) => {
    it.each(METHODS)("[%s] each coin keeps its own payment, ETH gains 100 €, no warning", (method) => {
      const parsed = window(...legs);
      expect([costOf(parsed, "BTC"), costOf(parsed, "ETH")]).toEqual(["10000", "100"]);
      expect(parsed.parserMessages ?? []).toEqual([]);
      expect(ethGain(run([[parsed, "Binance"]], 2025, method))).toEqual(["100.00"]);
    });
  });

  it("control: one fill per coin, each with its own payment, gives no warning", () => {
    const parsed = binanceParser.parse([TX_H,
      "1,2025-01-10 10:00:00,Spot,Buy,BTC,0.1,", "1,2025-01-10 10:00:00,Spot,Sell,EUR,-10000,",
      "1,2025-01-10 10:00:00,Spot,Buy,ETH,1,", "1,2025-01-10 10:00:00,Spot,Sell,EUR,-100,",
    ].join("\n"));
    expect([costOf(parsed, "BTC"), costOf(parsed, "ETH")]).toEqual(["10000", "100"]);
    expect(parsed.parserMessages ?? []).toEqual([]);
  });

  it("the shared-payment warning exists in the five locales, names the rows and says the art. 33.5.e result is not reliable", () => {
    expect(isTranslationKey("binance.spot_cost_split") && isTranslationKey("binance.spot_cost_split.hint")).toBe(true);
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
      expect(locale["binance.spot_cost_split"]).toContain("{{rows}}");
      expect(locale["binance.spot_cost_split.hint"]).toContain("33.5.e");
    }
    const emitted = message(straddle().parserMessages, "binance.spot_cost_split")!;
    const esText = es as Record<string, string>;
    expect(emitted.message).toBe(esText["binance.spot_cost_split"]!.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => emitted.context?.[k] ?? ""));
    expect(emitted.hint).toBe(esText["binance.spot_cost_split.hint"]);
  });
});

describe("#467 crypto income whose coin cannot be read is named, never skipped with no word", () => {
  const CB_H = "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";
  const KR_H = `"txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"`;
  const message = (messages: readonly TaxMessage[] | undefined, id: string): TaxMessage | undefined => messages?.find((m) => m.id === id);
  const incomeEntries = (r: TaxReport): number => r.interest.entries.length + r.generalGains.entries.length;
  // 0.5 ETH received on 01/03/2025, worth 1000 € by Coinbase's own Total.
  const cbIncome = (type: string, asset: string): Statement => coinbaseParser.parse([CB_H, `2025-03-01T10:00:00Z,${type},${asset},0.5,EUR,2000,1000,1000,0,`].join("\n"));

  describe.each(["Staking Income", "Rewards Income", "Learning Reward", "Inflation Reward", "Coinbase Earn"])("Coinbase %s", (type) => {
    describe.each(["", "  "])("with Asset %j", (asset) => {
      it.each(METHODS)("[%s] is not booked under a guessed coin, and the row is named by its type, amount, date and cell", (method) => {
        const parsed = cbIncome(type, asset);
        expect(parsed.cashTransactions).toEqual([]);
        const r = run([[parsed, "Coinbase"]], 2025, method);
        expect(incomeEntries(r)).toBe(0);
        const warning = message(r.messages, "parser.crypto_income_unidentified");
        expect(warning?.context).toEqual({ broker: "Coinbase", count: "1", rows: `${type} 0.5 (1000 EUR) 20250301 [Asset: ""]` });
      });
    });

    it.each(METHODS)("[%s] control: with Asset ETH it is booked as income and nothing is named", (method) => {
      const parsed = cbIncome(type, "ETH");
      expect(parsed.cashTransactions.map((c) => [c.symbol, c.amount])).toEqual([["ETH", "1000"]]);
      const r = run([[parsed, "Coinbase"]], 2025, method);
      expect(incomeEntries(r)).toBe(1);
      expect(message(r.messages, "parser.crypto_income_unidentified")).toBeUndefined();
    });
  });

  it("a Coinbase row of a type it does not read is counted with its type also when its Asset is empty", () => {
    for (const asset of ["ETH", ""]) {
      expect(message(cbIncome("Airdrop", asset).parserMessages, "coinbase.unknown_types_skipped")?.context).toEqual({ count: "1", types: "Airdrop (1)" });
    }
  });

  const krLedger = (row: string): Statement => krakenParser.parse([KR_H, row].join("\n"));
  const krCases: [string, string, string][] = [
    ["staking", `"L1","R1","2025-03-01 00:00:00","staking","","currency","","0.5","0","5"`, `staking 0.5 20250301 [asset: ""]`],
    ["Earn reward", `"L1","R1","2025-03-01 00:00:00","earn","reward","currency","  ","0.5","0","5"`, `earn reward 0.5 20250301 [asset: ""]`],
  ];
  describe.each(krCases)("Kraken %s with no asset", (_label, row, rows) => {
    it.each(METHODS)("[%s] is not booked under an empty coin, and the row is named", (method) => {
      const parsed = krLedger(row);
      expect(parsed.cashTransactions).toEqual([]);
      const r = run([[parsed, "Kraken"]], 2025, method);
      expect(incomeEntries(r)).toBe(0);
      expect(message(r.messages, "parser.crypto_income_unidentified")?.context).toEqual({ broker: "Kraken", count: "1", rows });
    });
  });

  it("control: a Kraken staking reward of XETH is booked on ETH and nothing is named", () => {
    const parsed = krLedger(`"L1","R1","2025-03-01 00:00:00","staking","","currency","XETH","0.5","0","5"`);
    expect(parsed.cashTransactions.map((c) => [c.symbol, c.amount])).toEqual([["ETH", "0.5"]]);
    expect(message(parsed.parserMessages, "parser.crypto_income_unidentified")).toBeUndefined();
  });

  it("the warning exists in the five locales, names the rows, and the parser emits the Spanish text", () => {
    expect(isTranslationKey("parser.crypto_income_unidentified") && isTranslationKey("parser.crypto_income_unidentified.hint")).toBe(true);
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
      expect(locale["parser.crypto_income_unidentified"]).toContain("{{rows}}");
      expect(locale["parser.crypto_income_unidentified"]).toContain("{{broker}}");
    }
    const emitted = message(cbIncome("Staking Income", "").parserMessages, "parser.crypto_income_unidentified")!;
    const esText = es as Record<string, string>;
    expect(emitted.message).toBe(esText["parser.crypto_income_unidentified"]!.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => emitted.context?.[k] ?? ""));
    expect(emitted.hint).toBe(esText["parser.crypto_income_unidentified.hint"]);
  });
});

describe("#466 #467 #468 the warnings of these issues read as plain short sentences in Spanish and English", () => {
  const KEYS = [
    "binance.unparseable_amount", "binance.unparseable_coin", "binance.unpaired_leg", "binance.spot_cost_split",
    "binance.fee_unassigned", "binance.income_negative", "binance.fiat_conversion_not_booked", "binance.unsupported_pair",
    "freedom24.row_skipped_malformed", "freedom24.dividend_amount_unreadable", "freedom24.tax_amount_unreadable",
    "parser.trade_row_unreadable", "parser.corporate_action_not_applied", "parser.cash_row_undated",
    "parser.cash_row_unidentified", "parser.crypto_income_unidentified", "parser.crypto_income_amount_unreadable", "parser.cash_income_amount_unreadable",
    "revolut.bad_fx_rate", "revolut.holding_size_unknown", "revolut.dividend_tax_correction",
    "etoro.columns_not_detected", "etoro.staking_not_imported", "degiro.cash_row_undescribed",
  ];
  const sentences = (text: string): string[] => text.split(/(?<=[.?!])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/);
  it.each([["es", es], ["en", en]] as [string, Record<string, string>][])("%s: no hint joins clauses with a semicolon, and no sentence is longer than 25 words", (_name, locale) => {
    for (const key of KEYS) {
      for (const text of [locale[key]!, locale[`${key}.hint`]!]) {
        expect(text, key).not.toContain(";");
        for (const sentence of sentences(text)) expect(sentence.split(/\s+/).length, `${key}: ${sentence}`).toBeLessThanOrEqual(25);
      }
    }
  });

  it("the corporate-action warning says who did not apply the rows, in the five locales and in the Spanish the parser emits", () => {
    expect((es as Record<string, string>)["parser.corporate_action_not_applied"]).toContain("DeclaRenta no ha aplicado");
    expect((en as Record<string, string>)["parser.corporate_action_not_applied"]).toContain("DeclaRenta did not apply");
    expect((ca as Record<string, string>)["parser.corporate_action_not_applied"]).toContain("DeclaRenta no ha aplicat");
    expect((eu as Record<string, string>)["parser.corporate_action_not_applied"]).toContain("DeclaRentak ez ditu aplikatu");
    expect((gl as Record<string, string>)["parser.corporate_action_not_applied"]).toContain("DeclaRenta non aplicou");
    const parsed = trading212Parser.parse([T212_H,
      `Stock split close,2025-03-03 09:30:00,${ISIN},XYZ,XYZ SA,10,10,EUR,1.00,,,0,EUR,,s1`,
      `Stock split open,2025-03-03 09:30:00,${ISIN},XYZ,XYZ SA,40,2.5,EUR,1.00,,,0,EUR,,s2`].join("\n"));
    const emitted = parsed.parserMessages?.find((m) => m.id === "parser.corporate_action_not_applied");
    expect(emitted?.message).toBe((es as Record<string, string>)["parser.corporate_action_not_applied"]!.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => emitted?.context?.[k] ?? ""));
  });
});

describe("#467 Freedom24: a withholding larger than its dividend is never booked", () => {
  const f24 = (...rows: Record<string, unknown>[]): Statement => freedom24Parser.parse(JSON.stringify({
    trades: { detailed: [] }, corporate_actions: { detailed: rows },
  }));
  const ES_DIV = { date: "2025-05-15 00:00:00", ticker: "XYZ.EU", isin: ISIN, type_id: "dividend", amount: "500", tax_amount: "95", curr_c: "EUR" };
  const US_DIV = { date: "2025-05-15 00:00:00", ticker: "AAPL.US", isin: AAPL, type_id: "dividend", amount: "500", tax_amount: "75", curr_c: "USD" };

  describe.each(["1e400", "1.234,56", "600", "-600"])("tax_amount %j on a 500 dividend", (tax) => {
    it.each(METHODS)("[%s] of a Spanish security: no withholding in box 0597, the dividend counts, the cell is named", (method) => {
      const parsed = f24({ ...ES_DIV, tax_amount: tax });
      expect(messageRows(parsed, "freedom24.tax_amount_unreadable")).toBe(`dividend XYZ (${ISIN}) 500 EUR 20250515 [tax_amount: ${JSON.stringify(tax)}]`);
      const r = run([[parsed, "Freedom24"]], 2025, method);
      expect([r.dividends.grossIncome.toFixed(2), new Decimal(r.dividends.spanishWithholding).toFixed(2)]).toEqual(["500.00", "0.00"]);
    });

    it.each(METHODS)("[%s] of a US security: no withholding and no deduction in box 0588, the cell is named", (method) => {
      const parsed = f24({ ...US_DIV, tax_amount: tax });
      expect(messageRows(parsed, "freedom24.tax_amount_unreadable")).toBe(`dividend AAPL (${AAPL}) 500 USD 20250515 [tax_amount: ${JSON.stringify(tax)}]`);
      const r = run([[parsed, "Freedom24"]], 2025, method);
      expect([r.dividends.grossIncome.toFixed(2), r.doubleTaxation.deduction.toFixed(2)]).toEqual(["550.00", "0.00"]);
    });
  });

  it.each(METHODS)("[%s] control: a withholding up to the dividend is booked with no warning", (method) => {
    const parsed = f24(ES_DIV, US_DIV, { ...ES_DIV, tax_amount: "500", date: "2025-05-16 00:00:00" });
    expect(parsed.parserMessages ?? []).toEqual([]);
    const r = run([[parsed, "Freedom24"]], 2025, method);
    expect(new Decimal(r.dividends.spanishWithholding).toFixed(2)).toBe("595.00");
    expect(r.doubleTaxation.deduction.toFixed(2)).toBe("82.50");
  });

  it("the warning says, in the five locales, that the withholding is no number or is larger than the dividend", () => {
    for (const [locale, word] of [[es, "mayor"], [en, "larger"], [ca, "més gran"], [eu, "handiagoa"], [gl, "maior"]] as [Record<string, string>, string][]) {
      expect(locale["freedom24.tax_amount_unreadable.hint"]).toContain(word);
    }
    const emitted = f24({ ...ES_DIV, tax_amount: "600" }).parserMessages?.find((m) => m.id === "freedom24.tax_amount_unreadable");
    const esText = es as Record<string, string>;
    expect(emitted?.message).toBe(esText["freedom24.tax_amount_unreadable"]!.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => emitted?.context?.[k] ?? ""));
    expect(emitted?.hint).toBe(esText["freedom24.tax_amount_unreadable.hint"]);
  });
});

describe("#467 Binance: a window that pairs several coins by a guess names every leg, in every trade path", () => {
  const TX_H = "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark";
  const message = (messages: readonly TaxMessage[] | undefined, id: string): TaxMessage | undefined => messages?.find((m) => m.id === id);
  const buyOf = (s: Statement, coin: string): string | undefined => {
    const t = s.trades.find((x) => x.symbol === coin && x.buySell === "BUY");
    return t ? `${t.cost} ${t.currency}` : undefined;
  };
  const ethGain = (r: TaxReport): string[] => r.capitalGains.disposals.filter((d) => d.symbol === "ETH").map((d) => new Decimal(d.gainLossEur).toFixed(2));
  // Every leg on 10/01/2025 10:00:00, then the ETH sold on 01/06/2025 for 200 €.
  const window = (...legs: string[]): Statement => binanceParser.parse([TX_H,
    ...legs.map((l) => `1,2025-01-10 10:00:00,Spot,${l},`),
    "1,2025-06-01 10:00:00,Spot,Sell,ETH,-1,", "1,2025-06-01 10:00:00,Spot,Buy,EUR,200,",
  ].join("\n"));
  const rowsOf = (legs: string[]): string => legs.map((l) => {
    const [op, coin, change] = l.split(",");
    return `${coin} ${op} ${change} 2025-01-10 10:00:00`;
  }).join("; ");

  // Two coins bought, paid in two currencies, with no EUR column. Which
  // payment goes with which coin is a guess when the file does not write
  // each payment next to its coin. ETH booked at 11000 € gives a -10800 €
  // loss: it must be named, never silent.
  const guessed: [string, string[], string][] = [
    ["spot: ETH and BTC, then EUR and USD", ["Buy,ETH,1", "Buy,BTC,0.1", "Sell,EUR,-11000", "Sell,USD,-110"], "11000 EUR"],
    ["spot: ETH and BTC, then EUR and USDT", ["Buy,ETH,1", "Buy,BTC,0.1", "Sell,EUR,-10000", "Sell,USDT,-110"], "10000 EUR"],
    ["Convert: ETH and BTC, then EUR and USD", ["Binance Convert,ETH,1", "Binance Convert,BTC,0.1", "Binance Convert,EUR,-11000", "Binance Convert,USD,-110"], "11000 EUR"],
    ["Strategy: Buy ETH and BTC, then two EUR Spend", ["Transaction Buy,ETH,1", "Transaction Buy,BTC,0.1", "Transaction Spend,EUR,-11000", "Transaction Spend,EUR,-110"], "11000 EUR"],
  ];
  describe.each(guessed)("%s", (_label, legs, ethCost) => {
    it.each(METHODS)("[%s] books the same numbers as before, and names every leg of the window with art. 33.5.e", (method) => {
      const parsed = window(...legs);
      expect(buyOf(parsed, "ETH")).toBe(ethCost);
      const r = run([[parsed, "Binance"]], 2025, method);
      const warning = message(r.messages, "binance.spot_cost_split");
      expect(warning?.context).toEqual({ count: String(legs.length), rows: rowsOf(legs) });
      expect(warning?.hint).toContain("33.5.e");
    });
  });

  it.each(METHODS)("[%s] Strategy sales: two coins sold for two EUR rows by a guess are named", (method) => {
    const legs = ["Transaction Sold,ETH,-1", "Transaction Sold,BTC,-0.1", "Transaction Revenue,EUR,10000", "Transaction Revenue,EUR,200"];
    const parsed = binanceParser.parse([TX_H,
      "1,2024-12-01 10:00:00,Spot,Buy,ETH,1,", "1,2024-12-01 10:00:00,Spot,Sell,EUR,-150,",
      "1,2024-12-01 10:00:05,Spot,Buy,BTC,0.1,", "1,2024-12-01 10:00:05,Spot,Sell,EUR,-9000,",
      ...legs.map((l) => `1,2025-01-10 10:00:00,Spot,${l},`),
    ].join("\n"));
    const r = run([[parsed, "Binance"]], 2025, method);
    expect(message(r.messages, "binance.spot_cost_split")?.context).toEqual({ count: "4", rows: rowsOf(legs) });
  });

  // Controls: the file writes each payment next to its coin, or the pairs
  // are all of one coin, so the pairing is what the file says.
  const proven: [string, string[], string, string][] = [
    ["spot: each payment after its coin, EUR and USD", ["Buy,BTC,0.1", "Sell,EUR,-11000", "Buy,ETH,1", "Sell,USD,-110"], "110 USD", "79.00"],
    ["spot: each payment before its coin, EUR and USDT", ["Sell,EUR,-10000", "Buy,BTC,0.1", "Sell,USDT,-110", "Buy,ETH,1"], "110 USDT", ""],
    ["Convert: each payment after its coin", ["Binance Convert,BTC,0.1", "Binance Convert,EUR,-11000", "Binance Convert,ETH,1", "Binance Convert,USD,-110"], "110 USD", "79.00"],
    ["Strategy: each Spend after its Buy", ["Transaction Buy,BTC,0.1", "Transaction Spend,EUR,-11000", "Transaction Buy,ETH,1", "Transaction Spend,EUR,-110"], "110 EUR", "90.00"],
    ["Strategy: each Spend before its Buy, with a Fee between", ["Transaction Spend,EUR,-11000", "Transaction Buy,BTC,0.1", "Transaction Fee,BNB,-0.001", "Transaction Spend,EUR,-110", "Transaction Buy,ETH,1"], "110 EUR", "90.00"],
  ];
  describe.each(proven)("control: %s", (_label, legs, ethCost, gain) => {
    it.each(METHODS)("[%s] ETH keeps its own payment and nothing is named", (method) => {
      const parsed = window(...legs);
      expect(buyOf(parsed, "ETH")).toBe(ethCost);
      expect(parsed.parserMessages ?? []).toEqual([]);
      if (gain) expect(ethGain(run([[parsed, "Binance"]], 2025, method))).toEqual([gain]);
    });
  });

  it("control: two Strategy buys of the same coin, paid in one currency, are not named", () => {
    const parsed = window("Transaction Buy,ETH,0.5", "Transaction Buy,ETH,0.5", "Transaction Spend,EUR,-50", "Transaction Spend,EUR,-50");
    expect(message(parsed.parserMessages, "binance.spot_cost_split")).toBeUndefined();
  });

  it("control: a Convert window with an EUR value on every leg pairs by value and is not named", () => {
    const parsed = binanceParser.parse(["User_ID,UTC_Time,Account,Operation,Coin,Change,Remark,EUR_Value",
      "1,2025-01-10 10:00:00,Spot,Binance Convert,ETH,1,,110", "1,2025-01-10 10:00:00,Spot,Binance Convert,BTC,0.1,,11000",
      "1,2025-01-10 10:00:00,Spot,Binance Convert,EUR,-11000,,-11000", "1,2025-01-10 10:00:00,Spot,Binance Convert,USD,-121,,-110",
    ].join("\n"));
    expect(buyOf(parsed, "ETH")).toBe("121 USD");
    expect(message(parsed.parserMessages, "binance.spot_cost_split")).toBeUndefined();
  });

  // A leg left over makes the pairing a guess: the rows the pairs use can sit
  // next to each other while the leftover sits between a coin and the
  // payment it took. "Buy BTC, Buy SOL, Sell USD" does not say whether the
  // 110 USD paid BTC or SOL. Every leg of the window is named, the leftover
  // also by binance.unpaired_leg, and the numbers do not move.
  const leftover: [string, string[], string, string][] = [
    ["spot: ETH and EUR, then BTC, SOL and USD", ["Buy,ETH,1", "Sell,EUR,-11000", "Buy,BTC,0.1", "Buy,SOL,10", "Sell,USD,-110"], "110 USD", "SOL Buy 10"],
    ["Convert: ETH and EUR, then BTC, SOL and USD", ["Binance Convert,ETH,1", "Binance Convert,EUR,-11000", "Binance Convert,BTC,0.1", "Binance Convert,SOL,10", "Binance Convert,USD,-110"], "110 USD", "SOL Binance Convert 10"],
    ["Convert: one payment for BTC or SOL", ["Binance Convert,BTC,0.1", "Binance Convert,SOL,10", "Binance Convert,USD,-110"], "110 USD", "SOL Binance Convert 10"],
    ["Strategy: Buy ETH, Spend, then Buy BTC, Buy SOL, Spend", ["Transaction Buy,ETH,1", "Transaction Spend,EUR,-11000", "Transaction Buy,BTC,0.1", "Transaction Buy,SOL,10", "Transaction Spend,EUR,-110"], "110 EUR", "SOL Transaction Buy 10"],
    ["Strategy: the -50 Spend next to BTC is left over", ["Transaction Spend,EUR,-11000", "Transaction Buy,ETH,1", "Transaction Spend,EUR,-110", "Transaction Spend,EUR,-50", "Transaction Buy,BTC,0.1"], "110 EUR", "EUR Transaction Spend -50"],
    ["Strategy: one Spend for BTC or SOL", ["Transaction Buy,BTC,0.1", "Transaction Buy,SOL,10", "Transaction Spend,EUR,-110"], "110 EUR", "SOL Transaction Buy 10"],
  ];
  describe.each(leftover)("a leg left over, %s", (_label, legs, btcCost, unpaired) => {
    it.each(METHODS)("[%s] BTC keeps the same cost, and every leg of the window is named", (method) => {
      const parsed = window(...legs);
      expect(buyOf(parsed, "BTC")).toBe(btcCost);
      const r = run([[parsed, "Binance"]], 2025, method);
      expect(message(r.messages, "binance.spot_cost_split")?.context).toEqual({ count: String(legs.length), rows: rowsOf(legs) });
      expect(message(r.messages, "binance.unpaired_leg")?.context?.rows).toBe(`${unpaired} 2025-01-10 10:00:00`);
    });
  });

  // A leftover that a later window pairs proves the first window only when
  // all the pairs together are adjacent rows: "Sold XRP, Revenue, Sold ADA"
  // then "Revenue" one second later is one trade after another (the straddle
  // tests in binance.test.ts give no warning). Here SOL is paired one second
  // later, but the 110 € sits next to SOL, not next to BTC.
  it("a leftover paired one second later, but not next to its counterpart, still names the window", () => {
    const legs: [string, string][] = [["0", "Transaction Buy,BTC,0.1"], ["1", "Transaction Buy,SOL,10"], ["1", "Transaction Spend,EUR,-110"], ["2", "Transaction Spend,EUR,-50"]];
    const parsed = binanceParser.parse([TX_H, ...legs.map(([sec, l]) => `1,2025-01-10 10:00:0${sec},Spot,${l},`)].join("\n"));
    expect(buyOf(parsed, "BTC")).toBe("110 EUR");
    expect(buyOf(parsed, "SOL")).toBe("50 EUR");
    expect(message(parsed.parserMessages, "binance.unpaired_leg")).toBeUndefined();
    expect(message(parsed.parserMessages, "binance.spot_cost_split")?.context?.rows)
      .toBe("BTC Transaction Buy 0.1 2025-01-10 10:00:00; SOL Transaction Buy 10 2025-01-10 10:00:01; EUR Transaction Spend -110 2025-01-10 10:00:01");
  });

  it("control: a leftover paired one second later next to its counterpart names nothing", () => {
    const legs: [string, string][] = [["0", "Transaction Buy,BTC,0.1"], ["1", "Transaction Spend,EUR,-110"], ["1", "Transaction Buy,SOL,10"], ["2", "Transaction Spend,EUR,-50"]];
    const parsed = binanceParser.parse([TX_H, ...legs.map(([sec, l]) => `1,2025-01-10 10:00:0${sec},Spot,${l},`)].join("\n"));
    expect([buyOf(parsed, "BTC"), buyOf(parsed, "SOL")]).toEqual(["110 EUR", "50 EUR"]);
    expect(parsed.parserMessages ?? []).toEqual([]);
  });

  // FIFO keeps one lot per Buy row, so two buys of one coin that cost
  // different amounts are not the same whichever Spend each takes: "Buy ETH
  // 1, Buy ETH 2, Spend -100, Spend -200" gives a later sale of 1 ETH a cost
  // of 100 € or of 200 €. That is a guess, and it is named.
  const sameCoin: [string, string[]][] = [
    ["two ETH buys paid 100 and 200 €", ["Transaction Buy,ETH,1", "Transaction Buy,ETH,2", "Transaction Spend,EUR,-100", "Transaction Spend,EUR,-200"]],
    ["two ETH sales for 100 and 200 €", ["Transaction Sold,ETH,-1", "Transaction Sold,ETH,-2", "Transaction Revenue,EUR,100", "Transaction Revenue,EUR,200"]],
    ["two ETH buys of 1 and 2 for one Spend", ["Transaction Buy,ETH,1", "Transaction Buy,ETH,2", "Transaction Spend,EUR,-100"]],
  ];
  it.each(sameCoin)("Strategy, one coin, %s: booked by order as before, and every leg is named", (_label, legs) => {
    const parsed = binanceParser.parse([TX_H,
      "1,2024-12-01 10:00:00,Spot,Buy,ETH,3,", "1,2024-12-01 10:00:00,Spot,Sell,EUR,-300,",
      ...legs.map((l) => `1,2025-01-10 10:00:00,Spot,${l},`),
    ].join("\n"));
    expect(message(parsed.parserMessages, "binance.spot_cost_split")?.context).toEqual({ count: String(legs.length), rows: rowsOf(legs) });
  });

  it.each(METHODS)("[%s] Strategy, two ETH buys paid 100 and 200 €: the later sale keeps the cost it had, and the buys are named", (method) => {
    const legs = ["Transaction Buy,ETH,1", "Transaction Buy,ETH,2", "Transaction Spend,EUR,-100", "Transaction Spend,EUR,-200"];
    const parsed = window(...legs);
    expect(parsed.trades.filter((t) => t.symbol === "ETH" && t.buySell === "BUY").map((t) => `${t.quantity} ${t.cost}`)).toEqual(["1 100", "2 200"]);
    const r = run([[parsed, "Binance"]], 2025, method);
    expect(ethGain(r)).toEqual(["100.00"]);
    expect(message(r.messages, "binance.spot_cost_split")?.context?.rows).toBe(rowsOf(legs));
  });

  const sameCoinProven: [string, string[]][] = [
    ["two ETH buys of 1 and 2, each paid 100 €", ["Transaction Buy,ETH,1", "Transaction Buy,ETH,2", "Transaction Spend,EUR,-100", "Transaction Spend,EUR,-100"]],
    ["each Spend after its Buy", ["Transaction Buy,ETH,1", "Transaction Spend,EUR,-100", "Transaction Buy,ETH,2", "Transaction Spend,EUR,-200"]],
    ["one Buy and two Spend of 50 €", ["Transaction Buy,ETH,1", "Transaction Spend,EUR,-50", "Transaction Spend,EUR,-50"]],
  ];
  it.each(sameCoinProven)("control: Strategy, one coin, %s: the pairing cannot change a lot, nothing is named as shared", (_label, legs) => {
    expect(message(window(...legs).parserMessages, "binance.spot_cost_split")).toBeUndefined();
  });

  it("the warning speaks of purchases and sales in the five locales, and the parser emits the Spanish text", () => {
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
      expect(locale["binance.spot_cost_split"]).toContain("{{rows}}");
      expect(locale["binance.spot_cost_split.hint"]).toContain("33.5.e");
    }
    expect((es as Record<string, string>)["binance.spot_cost_split.hint"]).toContain("venta");
    expect((en as Record<string, string>)["binance.spot_cost_split.hint"]).toContain("sale");
    const emitted = message(window("Transaction Buy,ETH,1", "Transaction Buy,BTC,0.1", "Transaction Spend,EUR,-11000", "Transaction Spend,EUR,-110").parserMessages, "binance.spot_cost_split")!;
    const esText = es as Record<string, string>;
    expect(emitted.message).toBe(esText["binance.spot_cost_split"]!.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => emitted.context?.[k] ?? ""));
    expect(emitted.hint).toBe(esText["binance.spot_cost_split.hint"]);
  });
});

describe("#467 crypto income whose amount cannot be read is named, never booked as 0 and never stops the report", () => {
  const CB_H = "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";
  const KR_H = `"txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"`;
  const message = (messages: readonly TaxMessage[] | undefined, id: string): TaxMessage | undefined => messages?.find((m) => m.id === id);
  const incomeEntries = (r: TaxReport): number => r.interest.entries.length + r.generalGains.entries.length;
  const cbIncome = (type: string, subtotal: string, total: string): Statement =>
    coinbaseParser.parse([CB_H, `2025-03-01T10:00:00Z,${type},ETH,0.5,EUR,2000,${subtotal},${total},0,`].join("\n"));

  const cbCases: [string, string, string][] = [
    ["", "", 'Staking Income 0.5 ETH 20250301 [Total (inclusive of fees and/or spread): "", Subtotal: ""]'],
    ["abc", "abc", 'Staking Income 0.5 ETH 20250301 [Total (inclusive of fees and/or spread): "abc", Subtotal: "abc"]'],
    ["", "€", 'Staking Income 0.5 ETH 20250301 [Total (inclusive of fees and/or spread): "€", Subtotal: ""]'],
  ];
  describe.each(cbCases)("Coinbase Staking Income with Subtotal %j and Total %j", (subtotal, total, rows) => {
    it.each(METHODS)("[%s] is not booked as 0, the report runs, and the row is named by its cells", (method) => {
      const parsed = cbIncome("Staking Income", subtotal, total);
      expect(parsed.cashTransactions).toEqual([]);
      const r = run([[parsed, "Coinbase"]], 2025, method);
      expect(incomeEntries(r)).toBe(0);
      expect(message(r.messages, "parser.crypto_income_amount_unreadable")?.context).toEqual({ broker: "Coinbase", count: "1", rows });
    });
  });

  it.each(METHODS)("[%s] an empty Total with a readable Subtotal books the Subtotal, not 0", (method) => {
    const parsed = cbIncome("Staking Income", "1000", "");
    expect(parsed.cashTransactions.map((c) => [c.symbol, c.amount])).toEqual([["ETH", "1000"]]);
    const r = run([[parsed, "Coinbase"]], 2025, method);
    expect(r.interest.earned.toFixed(2)).toBe("1000.00");
    expect(message(r.messages, "parser.crypto_income_amount_unreadable")).toBeUndefined();
  });

  it.each(METHODS)("[%s] control: a readable Total is booked and nothing is named", (method) => {
    const parsed = cbIncome("Staking Income", "1000", "1000");
    expect(parsed.cashTransactions.map((c) => [c.symbol, c.amount])).toEqual([["ETH", "1000"]]);
    const r = run([[parsed, "Coinbase"]], 2025, method);
    expect(r.interest.earned.toFixed(2)).toBe("1000.00");
    expect(message(r.messages, "parser.crypto_income_amount_unreadable")).toBeUndefined();
  });

  const krLedger = (row: string): Statement => krakenParser.parse([KR_H, row].join("\n"));
  const krCases: [string, string, string][] = [
    ["staking amount 'abc'", `"L1","R1","2025-03-01 00:00:00","staking","","currency","XETH","abc","0","5"`, `staking ETH 20250301 [amount: "abc"]`],
    ["Earn reward amount empty", `"L1","R1","2025-03-01 00:00:00","earn","reward","currency","XETH","","0","5"`, `earn reward ETH 20250301 [amount: ""]`],
  ];
  describe.each(krCases)("Kraken %s", (_label, row, rows) => {
    it.each(METHODS)("[%s] is not booked as 0, and the row is named", (method) => {
      const parsed = krLedger(row);
      expect(parsed.cashTransactions).toEqual([]);
      const r = run([[parsed, "Kraken"]], 2025, method);
      expect(incomeEntries(r)).toBe(0);
      expect(message(r.messages, "parser.crypto_income_amount_unreadable")?.context).toEqual({ broker: "Kraken", count: "1", rows });
    });
  });

  it("control: a Kraken staking reward with a readable amount is booked and nothing is named", () => {
    const parsed = krLedger(`"L1","R1","2025-03-01 00:00:00","staking","","currency","XETH","0.5","0","5"`);
    expect(parsed.cashTransactions.map((c) => [c.symbol, c.amount])).toEqual([["ETH", "0.5"]]);
    expect(parsed.parserMessages ?? []).toEqual([]);
  });

  it("the warning exists in the five locales, names the rows, and the parser emits the Spanish text", () => {
    expect(isTranslationKey("parser.crypto_income_amount_unreadable") && isTranslationKey("parser.crypto_income_amount_unreadable.hint")).toBe(true);
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
      expect(locale["parser.crypto_income_amount_unreadable"]).toContain("{{rows}}");
      expect(locale["parser.crypto_income_amount_unreadable"]).toContain("{{broker}}");
    }
    const emitted = message(cbIncome("Staking Income", "", "").parserMessages, "parser.crypto_income_amount_unreadable")!;
    const esText = es as Record<string, string>;
    expect(emitted.message).toBe(esText["parser.crypto_income_amount_unreadable"]!.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => emitted.context?.[k] ?? ""));
    expect(emitted.hint).toBe(esText["parser.crypto_income_amount_unreadable.hint"]);
  });
});

describe("#467 a dividend or interest row whose amount cannot be read is named, never booked as 0 or dropped with no word", () => {
  const message = (messages: readonly TaxMessage[] | undefined, id: string): TaxMessage | undefined => messages?.find((m) => m.id === id);
  const ID = "parser.cash_income_amount_unreadable";
  // Each row: a parse of one row, the broker, and the text that names it.
  // A dividend's withholding is not booked either: with no dividend it would
  // be a deduction for income the report does not count.
  const cases: [string, () => Statement, string, string][] = [];
  for (const cell of ["abc", ""]) {
    cases.push(
      [`Lightyear Dividend, Gross Amount ${JSON.stringify(cell)}`, () => lightyearParser.parse([LY_H, `16/12/2025 06:02:35,DD-1,GOOG,US02079K1079,Dividend,,USD,,${cell},,,${cell},2.11`].join("\n")),
        "Lightyear", `Dividend GOOG USD 20251216 (Tax Amt. 2.11) [Gross Amount: ${JSON.stringify(cell)}]`],
      [`Lightyear Dividend with no security, Gross Amount ${JSON.stringify(cell)}`, () => lightyearParser.parse([LY_H, `16/12/2025 06:02:35,DD-1,,,Dividend,,USD,,${cell},,,${cell},2.11`].join("\n")),
        "Lightyear", `Dividend — USD 20251216 (Tax Amt. 2.11) [Gross Amount: ${JSON.stringify(cell)}]`],
      [`Lightyear Interest, both amounts ${JSON.stringify(cell)}`, () => lightyearParser.parse([LY_H, `16/12/2025 06:02:35,IN-1,,,Interest,,EUR,,${cell},,,${cell},`].join("\n")),
        "Lightyear", `Interest EUR 20251216 [Net Amt.: ${JSON.stringify(cell)}, Gross Amount: ${JSON.stringify(cell)}]`],
      [`Lightyear Reward, both amounts ${JSON.stringify(cell)}`, () => lightyearParser.parse([LY_H, `16/12/2025 06:02:35,RW-1,,,Reward,,EUR,,${cell},,,${cell},`].join("\n")),
        "Lightyear", `Reward EUR 20251216 [Net Amt.: ${JSON.stringify(cell)}, Gross Amount: ${JSON.stringify(cell)}]`],
      [`Trading 212 Dividend, Total ${JSON.stringify(cell)}`, () => trading212Parser.parse([T212_H, `Dividend (Ordinary),2025-03-15 00:00:00,US0378331005,AAPL,Apple Inc,,,USD,0.92,,,${cell},USD,,div001`].join("\n")),
        "Trading 212", `Dividend (Ordinary) AAPL USD 20250315 [Total: ${JSON.stringify(cell)}]`],
      [`Trading 212 Interest on cash, Total ${JSON.stringify(cell)}`, () => trading212Parser.parse([T212_H, `Interest on cash,2025-03-15 00:00:00,,,,,,,,,,${cell},EUR,,int001`].join("\n")),
        "Trading 212", `Interest on cash EUR 20250315 [Total: ${JSON.stringify(cell)}]`],
      [`Scalable Interest, amount ${JSON.stringify(cell)}`, () => scalableParser.parse([SC_H, `2025-12-31;23:59;Executed;REF004;KKT-Abschluss;Cash;Interest;;0;0;${cell};0;0;EUR`].join("\n")),
        "Scalable Capital", `Interest KKT-Abschluss EUR 20251231 [amount: ${JSON.stringify(cell)}]`],
      [`Scalable Distribution, amount ${JSON.stringify(cell)}`, () => scalableParser.parse([SC_H, `2025-09-01;08:00;Executed;REF003;Acme World ETF;Security;Distribution;XX0000000001;0;0;${cell};0;-2,33;EUR`].join("\n")),
        "Scalable Capital", `Distribution Acme World ETF (XX0000000001) EUR 20250901 (tax -2.33) [amount: ${JSON.stringify(cell)}]`],
      [`Scalable Distribution with no ISIN, amount ${JSON.stringify(cell)}`, () => scalableParser.parse([SC_H, `2025-09-01;08:00;Executed;REF003;Acme World ETF;Security;Distribution;;0;0;${cell};0;-2,33;EUR`].join("\n")),
        "Scalable Capital", `Distribution Acme World ETF EUR 20250901 (tax -2.33) [amount: ${JSON.stringify(cell)}]`],
      [`Trade Republic INTEREST_PAYMENT, amount ${JSON.stringify(cell)}`, () => tradeRepublicParser.parse([TR_H, `"2025-01-01T00:53:12.791610Z","2025-01-01","DEFAULT","CASH","INTEREST_PAYMENT","","","","","","${cell}","","0.00","EUR","","","","Interest payment Booking","tx-int-001","","","",""`].join("\n")),
        "Trade Republic", `INTEREST_PAYMENT EUR 20250101 [amount: ${JSON.stringify(cell)}]`],
      [`Trade Republic DIVIDEND, amount ${JSON.stringify(cell)}`, () => tradeRepublicParser.parse([TR_H, `"2025-03-14T10:00:00.000Z","2025-03-14","DEFAULT","CASH","DIVIDEND","STOCK","Apple Inc","US0378331005","","","${cell}","","-0.35","EUR","","","","Dividend","tx-div-001","","","",""`].join("\n")),
        "Trade Republic", `DIVIDEND Apple Inc (US0378331005) EUR 20250314 (tax -0.35) [amount: ${JSON.stringify(cell)}]`],
      [`Trade Republic TAX_OPTIMIZATION, amount ${JSON.stringify(cell)}`, () => tradeRepublicParser.parse([TR_H, `"2025-01-02T00:00:00.000Z","2025-01-02","DEFAULT","CASH","TAX_OPTIMIZATION","","","","","","${cell}","","","EUR","","","","Tax optimisation","tx-opt-001","","","",""`].join("\n")),
        "Trade Republic", `TAX_OPTIMIZATION EUR 20250102 [amount: ${JSON.stringify(cell)}]`],
    );
  }
  describe.each(cases)("%s", (_label, parse, broker, rows) => {
    it.each(METHODS)("[%s] no income and no withholding are booked, the report runs, and the row is named by its cell", (method) => {
      const parsed = parse();
      expect(parsed.cashTransactions).toEqual([]);
      const r = run([[parsed, broker]], 2025, method);
      expect([r.dividends.grossIncome.toFixed(2), r.dividends.entries.length, r.interest.earned.toFixed(2)]).toEqual(["0.00", 0, "0.00"]);
      expect(message(r.messages, ID)?.context).toEqual({ broker, count: "1", rows });
    });
  });

  // Controls: the same rows with a readable amount are booked, and a written
  // zero stays an explicit zero, with no warning.
  const readable: [string, () => Statement, string, string][] = [
    ["Lightyear Dividend", () => lightyearParser.parse([LY_H, "16/12/2025 06:02:35,DD-1,GOOG,US02079K1079,Dividend,,USD,,14.09,,,11.98,2.11"].join("\n")), "Lightyear", "Dividends 14.09"],
    ["Lightyear Interest with only a Net Amt.", () => lightyearParser.parse([LY_H, "16/12/2025 06:02:35,IN-1,,,Interest,,EUR,,,,0,5.00,0"].join("\n")), "Lightyear", "Broker Interest Received 5"],
    ["Trading 212 Dividend", () => trading212Parser.parse([T212_H, "Dividend (Ordinary),2025-03-15 00:00:00,US0378331005,AAPL,Apple Inc,,,USD,0.92,,,2.35,USD,,div001"].join("\n")), "Trading 212", "Dividends 2.35"],
    ["Scalable Interest", () => scalableParser.parse([SC_H, "2025-12-31;23:59;Executed;REF004;KKT-Abschluss;Cash;Interest;;0;0;7,45;0;0;EUR"].join("\n")), "Scalable Capital", "Broker Interest Received 7.45"],
    ["Trade Republic INTEREST_PAYMENT", () => tradeRepublicParser.parse([TR_H, `"2025-01-01T00:53:12.791610Z","2025-01-01","DEFAULT","CASH","INTEREST_PAYMENT","","","","","","64.640000","","0.00","EUR","","","","Interest payment Booking","tx-int-001","","","",""`].join("\n")), "Trade Republic", "Broker Interest Received 64.64"],
  ];
  it.each(readable)("control: %s with a readable amount is booked and nothing is named", (_label, parse, _broker, first) => {
    const parsed = parse();
    expect(`${parsed.cashTransactions[0]?.type} ${parsed.cashTransactions[0]?.amount}`).toBe(first);
    expect(message(parsed.parserMessages, ID)).toBeUndefined();
  });
  it("control: a Lightyear Interest of 0 and a Trading 212 interest of 0 stay skipped with no warning", () => {
    expect(lightyearParser.parse([LY_H, "15/01/2025,REF001,,,Interest,,EUR,,,,0,0,0"].join("\n")).parserMessages ?? []).toEqual([]);
    expect(trading212Parser.parse([T212_H, "Interest on cash,2025-03-15 00:00:00,,,,,,,,,,0,EUR,,int001"].join("\n")).parserMessages ?? []).toEqual([]);
  });

  it("the warning exists in the five locales, names the rows, and the parser emits the Spanish text", () => {
    expect(isTranslationKey(ID) && isTranslationKey(`${ID}.hint`)).toBe(true);
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
      expect(locale[ID]).toContain("{{rows}}");
      expect(locale[ID]).toContain("{{broker}}");
    }
    const emitted = message(trading212Parser.parse([T212_H, "Interest on cash,2025-03-15 00:00:00,,,,,,,,,,abc,EUR,,int001"].join("\n")).parserMessages, ID)!;
    const esText = es as Record<string, string>;
    expect(emitted.message).toBe(esText[ID]!.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => emitted.context?.[k] ?? ""));
    expect(emitted.hint).toBe(esText[`${ID}.hint`]);
  });
});

describe("#467 Binance: every fee, dust row, negative income, fiat swap and price is booked from the file or named", () => {
  const TX_H = "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark";
  const TH_H = "Date(UTC),Pair,Side,Price,Executed,Amount,Fee";
  const message = (messages: readonly TaxMessage[] | undefined, id: string): TaxMessage | undefined => messages?.find((m) => m.id === id);
  const ids = (s: Statement): string[] => (s.parserMessages ?? []).map((m) => m.id);
  // Rows as "seconds|Operation,Coin,Change[,Remark]" on 10/01/2025 10:00:0s, or "date time|..." for another day.
  const tx = (...rows: string[]): Statement => binanceParser.parse([TX_H, ...rows.map((r) => {
    const [when, cells] = r.split("|") as [string, string];
    const time = when.length === 1 ? `2025-01-10 10:00:0${when}` : when;
    return `1,${time},Spot,${cells}${cells.split(",").length === 3 ? "," : ""}`;
  })].join("\n"));
  const gains = (r: TaxReport, coin: string): string[] => r.capitalGains.disposals.filter((d) => d.symbol === coin).map((d) => new Decimal(d.gainLossEur).toFixed(2));
  const comm = (s: Statement, coin: string): string[] => s.trades.filter((t) => t.symbol === coin).map((t) => `${t.commission} ${t.commissionCurrency}`);

  // Trade History: FIFO values a fiat-quoted trade at Price × Executed. A
  // Price it cannot read was read as 0: BTC bought for 2000 € and sold for
  // 3000 € showed a 2000 € loss with no word. Amount ÷ Executed are the
  // file's own numbers, so the price is taken from them.
  const buyBtc = "2025-01-10 10:00:00,BTCEUR,BUY,20000,0.1BTC,2000EUR,0EUR";
  const sellBtc = (price: string, amount = "3000EUR"): string => `2025-06-01 10:00:00,BTCEUR,SELL,${price},0.1BTC,${amount},0EUR`;
  const history = (...rows: string[]): Statement => binanceParser.parse([TH_H, ...rows].join("\n"));
  const prices: [string, string[], string][] = [
    ["sale, Price \"abc\"", [buyBtc, sellBtc("abc")], "1000.00"],
    ["sale, Price empty", [buyBtc, sellBtc("")], "1000.00"],
    ["sale, Price \"30,000.00\"", [buyBtc, sellBtc("\"30,000.00\"")], "1000.00"],
    ["purchase, Price \"abc\"", ["2025-01-10 10:00:00,BTCEUR,BUY,abc,0.1BTC,2000EUR,0EUR", sellBtc("30000")], "1000.00"],
    ["USD pair, sale Price \"abc\"", ["2025-01-10 10:00:00,BTCUSD,BUY,22000,0.1BTC,2200USD,0USD", "2025-06-01 10:00:00,BTCUSD,SELL,abc,0.1BTC,3300USD,0USD"], "1210.00"],
    ["control: Price 30000", [buyBtc, sellBtc("30000")], "1000.00"],
    ["control: USD pair, sale Price 33000", ["2025-01-10 10:00:00,BTCUSD,BUY,22000,0.1BTC,2200USD,0USD", "2025-06-01 10:00:00,BTCUSD,SELL,33000,0.1BTC,3300USD,0USD"], "1210.00"],
  ];
  describe.each(prices)("Trade History %s", (_label, rows, gain) => {
    it.each(METHODS)("[%s] the price is Amount ÷ Executed, the gain is the one of the readable control, and nothing is named", (method) => {
      const parsed = history(...rows);
      expect(parsed.parserMessages ?? []).toEqual([]);
      expect(gains(run([[parsed, "Binance"]], 2025, method), "BTC")).toEqual([gain]);
    });
  });
  it.each(METHODS)("[%s] Trade History: a sale whose Price and Amount both cannot be read is kept as a row that books nothing, named by its Price", (method) => {
    const parsed = history(buyBtc, sellBtc("abc", "xyz"));
    expect(unreadableRows(parsed)).toBe('BTC 20250601 [Price: "abc"]');
    const r = run([[parsed, "Binance"]], 2025, method);
    expect(gains(r, "BTC")).toEqual([]);
    expect(message(r.messages, "parser.trade_row_unreadable")?.context?.rows).toBe('BTC 20250601 [Price: "abc"]');
  });
  it("control: a written Price of 0 stays the file's word", () => {
    const parsed = history(buyBtc, sellBtc("0"));
    expect(parsed.trades.map((t) => t.tradePrice)).toEqual(["20000", "0"]);
    expect(parsed.parserMessages ?? []).toEqual([]);
  });

  // Trade History: a row whose Pair cannot be split was named only by its
  // Pair text, so an empty Pair named nothing. Each row is now named by
  // date, side, amount and the Pair cell.
  it.each(METHODS)("[%s] Trade History: a row with an empty or unknown Pair is named by date, side, amount and cell", (method) => {
    const parsed = history(buyBtc, "2025-06-01 10:00:00,,SELL,30000,0.1BTC,3000EUR,0EUR", "2025-06-02 10:00:00,XYZABC,BUY,1,5,5,0");
    const r = run([[parsed, "Binance"]], 2025, method);
    expect(message(r.messages, "binance.unsupported_pair")?.context).toEqual({
      count: "2", pairs: ", XYZABC", rows: '20250601 SELL 0.1BTC [Pair: ""]; 20250602 BUY 5 [Pair: "XYZABC"]',
    });
  });

  // Strategy: every pair took the first fee row of its coin, so in "Sold ETH,
  // Fee -5, Revenue, Sold BTC, Fee -1, Revenue" BTC paid ETH's 5 € and the -1 €
  // row vanished, with no word. Each fee row now goes, once, to the pair the
  // file writes it beside.
  const sales = [
    "0|Transaction Sold,ETH,-1", "0|Transaction Fee,EUR,-5", "0|Transaction Revenue,EUR,3000",
    "0|Transaction Sold,BTC,-0.1", "0|Transaction Fee,EUR,-1", "0|Transaction Revenue,EUR,9000",
  ];
  const strategy: [string, string[], string, string, string | undefined][] = [
    ["each fee inside its pair", sales, "2995.00", "8999.00", undefined],
    ["the first sale has no fee row", [sales[0]!, sales[2]!, ...sales.slice(3)], "3000.00", "8999.00", undefined],
    ["a fee written between the two sales is no one's", ["0|Transaction Sold,ETH,-1", "0|Transaction Revenue,EUR,3000", "0|Transaction Fee,EUR,-5", "0|Transaction Sold,BTC,-0.1", "0|Transaction Revenue,EUR,9000", "0|Transaction Fee,EUR,-1"], "3000.00", "8999.00", "EUR Transaction Fee -5 2025-01-10 10:00:00"],
    ["control: the two sales 5 s apart", [...sales.slice(0, 3), ...sales.slice(3).map((r) => r.replace("0|", "5|"))], "2995.00", "8999.00", undefined],
  ];
  describe.each(strategy)("Strategy, two sales in one second, %s", (_label, rows, eth, btc, unassigned) => {
    it.each(METHODS)("[%s] each sale pays only its own fee, and a fee the file ties to no sale is named and deducted from none", (method) => {
      const parsed = tx(...rows);
      const r = run([[parsed, "Binance"]], 2025, method);
      expect([gains(r, "ETH"), gains(r, "BTC")]).toEqual([[eth], [btc]]);
      expect(message(r.messages, "binance.fee_unassigned")?.context?.rows).toBe(unassigned);
    });
  });
  it("Strategy: two fee rows of one sale (partial fills) are both deducted", () => {
    expect(comm(tx("0|Transaction Sold,BTC,-0.1", "0|Transaction Fee,EUR,-1", "0|Transaction Fee,EUR,-2", "0|Transaction Revenue,EUR,9000"), "BTC")).toEqual(["-3 EUR"]);
  });
  it("Strategy, revenue in USDT: each permuta takes its own fee", () => {
    const parsed = tx("0|Transaction Sold,ETH,-1", "0|Transaction Fee,USDT,-5", "0|Transaction Revenue,USDT,3300",
      "0|Transaction Sold,BTC,-0.1", "0|Transaction Fee,USDT,-1", "0|Transaction Revenue,USDT,9900");
    expect(comm(parsed, "USDT")).toEqual(["-5 USDT", "-1 USDT"]);
  });

  // Strategy: a pair that emitted no trade (EUR for USD) wrote its fee onto
  // the last trade of the file, an unrelated BTC sale 5 s earlier (-50 €).
  it.each(METHODS)("[%s] Strategy: a fiat-for-fiat window puts its fee on no earlier trade, and its rows are named", (method) => {
    const parsed = tx("0|Transaction Sold,BTC,-0.1", "0|Transaction Revenue,EUR,9000",
      "5|Transaction Sold,USD,-110", "5|Transaction Fee,EUR,-50", "5|Transaction Revenue,EUR,100");
    expect(comm(parsed, "BTC")).toEqual(["0 EUR"]);
    const r = run([[parsed, "Binance"]], 2025, method);
    expect(gains(r, "BTC")).toEqual(["9000.00"]);
    expect(message(r.messages, "binance.fiat_conversion_not_booked")?.context?.rows)
      .toBe("USD Transaction Sold -110 2025-01-10 10:00:05; EUR Transaction Revenue 100 2025-01-10 10:00:05");
  });

  // Spot: the last trade of the window took every fee, so two orders in one
  // second put both fees on ETH (1994 € instead of 1999 €) with no word.
  const spotTail = ["2025-06-01 10:00:00|Sell,ETH,-1", "2025-06-01 10:00:00|Buy,EUR,5000", "2025-06-02 10:00:00|Sell,BTC,-0.1", "2025-06-02 10:00:00|Buy,EUR,20000"];
  const spot: [string, string[], string, string, string | undefined][] = [
    ["each fee after its order: the first one sits between both orders", ["0|Buy,BTC,0.1", "0|Sell,EUR,-9000", "0|Fee,EUR,-5", "0|Buy,ETH,1", "0|Sell,EUR,-3000", "0|Fee,EUR,-1"], "1999.00", "11000.00", "EUR Fee -5 2025-01-10 10:00:00"],
    ["each fee inside its order", ["0|Buy,BTC,0.1", "0|Fee,EUR,-5", "0|Sell,EUR,-9000", "0|Buy,ETH,1", "0|Fee,EUR,-1", "0|Sell,EUR,-3000"], "1999.00", "10995.00", undefined],
    ["control: the two orders 5 s apart", ["0|Buy,BTC,0.1", "0|Sell,EUR,-9000", "0|Fee,EUR,-5", "5|Buy,ETH,1", "5|Sell,EUR,-3000", "5|Fee,EUR,-1"], "1999.00", "10995.00", undefined],
  ];
  describe.each(spot)("spot, two purchases in one second, %s", (_label, rows, eth, btc, unassigned) => {
    it.each(METHODS)("[%s] each order pays only its own fee, and a fee the file ties to no order is named and deducted from none", (method) => {
      const parsed = tx(...rows, ...spotTail);
      const r = run([[parsed, "Binance"]], 2025, method);
      expect([gains(r, "ETH"), gains(r, "BTC")]).toEqual([[eth], [btc]]);
      expect(message(r.messages, "binance.fee_unassigned")?.context?.rows).toBe(unassigned);
    });
  });

  // Dust: a dust row with no BNB row at its exact time was dropped with no
  // word, and a BNB row one second later was lost with it.
  const dustBuys = ["2024-01-10 10:00:00|Buy,SOL,1", "2024-01-10 10:00:00|Sell,EUR,-10", "2024-01-11 10:00:00|Buy,ADA,100", "2024-01-11 10:00:00|Sell,EUR,-20"];
  const dust = (...rows: string[]): Statement => tx(...dustBuys, ...rows.map((r) => `2025-02-01 10:00:0${r[0]}|Small Assets Exchange BNB,${r.slice(2)}`));
  const permutas = (s: Statement): string[] => s.trades.filter((t) => t.description.startsWith("Dust")).map((t) => `${t.buySell} ${t.symbol} ${t.quantity}`);
  it.each(METHODS)("[%s] dust: a SOL row with no BNB row is named as a leg with no other side", (method) => {
    const parsed = dust("0|SOL,-1");
    expect(permutas(parsed)).toEqual([]);
    const r = run([[parsed, "Binance"]], 2025, method);
    expect(message(r.messages, "binance.unpaired_leg")?.context?.rows).toBe("SOL Small Assets Exchange BNB -1 2025-02-01 10:00:00");
  });
  it("dust: a BNB row 1 s after its dust row is paired, as in the same second", () => {
    for (const second of ["0", "1"]) {
      const parsed = dust("0|SOL,-1", `${second}|BNB,0.05`);
      expect(permutas(parsed)).toEqual(["SELL SOL -1", "BUY BNB 0.05"]);
      expect(parsed.parserMessages ?? []).toEqual([]);
    }
  });
  it("dust: two coins and one BNB row: the coin left out is named, and the window is named as shared by a guess", () => {
    const parsed = dust("0|SOL,-1", "0|ADA,-100", "0|BNB,0.1");
    expect(permutas(parsed)).toEqual(["SELL SOL -1", "BUY BNB 0.1"]);
    expect(message(parsed.parserMessages, "binance.unpaired_leg")?.context?.rows).toBe("ADA Small Assets Exchange BNB -100 2025-02-01 10:00:00");
    expect(message(parsed.parserMessages, "binance.spot_cost_split")?.context?.count).toBe("3");
  });
  it("dust: two coins and two BNB rows with no Remark are paired by order, a guess that is named", () => {
    const parsed = dust("0|SOL,-1", "0|ADA,-100", "0|BNB,0.02", "0|BNB,0.08");
    expect(permutas(parsed)).toEqual(["SELL SOL -1", "BUY BNB 0.02", "SELL ADA -100", "BUY BNB 0.08"]);
    expect(message(parsed.parserMessages, "binance.spot_cost_split")?.context?.count).toBe("4");
  });
  it("control: two coins and two BNB rows paired by their Remark are named by nothing", () => {
    const parsed = dust("0|SOL,-1,SOL to BNB", "0|ADA,-100,ADA to BNB", "0|BNB,0.08,ADA to BNB", "0|BNB,0.02,SOL to BNB");
    expect(permutas(parsed)).toEqual(["SELL SOL -1", "BUY BNB 0.02", "SELL ADA -100", "BUY BNB 0.08"]);
    expect(parsed.parserMessages ?? []).toEqual([]);
  });

  // Income: a negative income row (a reward taken back) was dropped with no
  // word, so a later sale used the reward's 50 € lot (-38 € instead of +2 €).
  it.each(METHODS)("[%s] a negative Referral Commission is named, and the numbers do not move", (method) => {
    const sale = ["2025-02-01 10:00:00|Buy,ADA,10", "2025-02-01 10:00:00|Sell,EUR,-10", "2025-06-01 10:00:00|Sell,ADA,-10", "2025-06-01 10:00:00|Buy,EUR,12"];
    const parsed = binanceParser.parse([`${TX_H},EUR_Value`,
      "1,2024-03-01 10:00:00,Spot,Referral Commission,ADA,10,,50", "1,2024-03-05 10:00:00,Spot,Referral Commission,ADA,-10,,-50",
      ...sale.map((r) => `1,${r.replace("|", ",Spot,")},,`)].join("\n"));
    expect(parsed.cashTransactions.map((c) => c.amount)).toEqual(["10"]);
    const r = run([[parsed, "Binance"]], 2025, method);
    expect(gains(r, "ADA")).toEqual(["-38.00"]);
    expect(message(r.messages, "binance.income_negative")?.context).toEqual({ count: "1", rows: "ADA Referral Commission -10 2024-03-05 10:00:00" });
  });
  it("control: a positive reward alone names nothing", () => {
    expect(ids(tx("0|Referral Commission,ADA,10"))).toEqual([]);
  });

  // A Convert of EUR for USD and back was dropped with no word: the comment
  // said the FX engine handles it, but that engine reads only cash trades.
  it.each(METHODS)("[%s] a fiat-for-fiat Convert is named, never dropped with no word", (method) => {
    const parsed = tx("0|Binance Convert,EUR,-100", "0|Binance Convert,USD,110", "2025-06-01 10:00:00|Binance Convert,USD,-110", "2025-06-01 10:00:00|Binance Convert,EUR,110");
    expect(parsed.trades).toEqual([]);
    const r = run([[parsed, "Binance"]], 2025, method);
    expect(message(r.messages, "binance.fiat_conversion_not_booked")?.context).toEqual({
      count: "4",
      rows: "EUR Binance Convert -100 2025-01-10 10:00:00; USD Binance Convert 110 2025-01-10 10:00:00; USD Binance Convert -110 2025-06-01 10:00:00; EUR Binance Convert 110 2025-06-01 10:00:00",
    });
  });
  it("control: a Convert of EUR for BTC is booked and names nothing", () => {
    const parsed = tx("0|Binance Convert,EUR,-100", "0|Binance Convert,BTC,0.001");
    expect(parsed.trades.map((t) => `${t.buySell} ${t.symbol}`)).toEqual(["BUY BTC"]);
    expect(ids(parsed)).toEqual([]);
  });

  it("the new warnings exist in the five locales, name the rows, and the parser emits the Spanish text", () => {
    const esText = es as Record<string, string>;
    const emitted: TaxMessage[] = [
      ...(tx("0|Buy,BTC,0.1", "0|Sell,EUR,-9000", "0|Fee,EUR,-5", "0|Buy,ETH,1", "0|Sell,EUR,-3000", "0|Fee,EUR,-1").parserMessages ?? []),
      ...(tx("0|Referral Commission,ADA,-10").parserMessages ?? []),
      ...(tx("0|Binance Convert,EUR,-100", "0|Binance Convert,USD,110").parserMessages ?? []),
    ];
    expect(emitted.map((m) => m.id)).toEqual(["binance.fee_unassigned", "binance.income_negative", "binance.fiat_conversion_not_booked"]);
    for (const m of emitted) {
      expect(isTranslationKey(m.id) && isTranslationKey(`${m.id}.hint`)).toBe(true);
      for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
        expect(locale[m.id]).toContain("{{rows}}");
        expect(locale[m.id]).toContain("{{count}}");
      }
      expect(m.message).toBe(esText[m.id]!.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => m.context?.[k] ?? ""));
      expect(m.hint).toBe(esText[`${m.id}.hint`]);
    }
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) expect(locale["binance.unsupported_pair"]).toContain("{{rows}}");
  });
});

describe("#467 Coinbase: a price, currency or money column that cannot be read is never booked as 0, as euros or as a crash", () => {
  // BTC bought on 15/03/2024 for 3000 € and sold on 01/03/2025 for 9000 €: a
  // 6000 € gain. FIFO values a Coinbase trade at Quantity × Spot Price.
  const CB_H = "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";
  const coinbase = (...rows: string[]): Statement => coinbaseParser.parse([CB_H, ...rows].join("\n"));
  const message = (messages: readonly TaxMessage[] | undefined, id: string): TaxMessage | undefined => messages?.find((m) => m.id === id);
  const net = (r: TaxReport): string => r.capitalGains.netGainLoss.toFixed(2);
  const cbBuy = "2024-03-15T10:30:00Z,Buy,BTC,0.1,EUR,30000.00,3000.00,3000.00,0,";
  const cbSell = (price: string, subtotal = "9000.00", currency = "EUR"): string => `2025-03-01T10:00:00Z,Sell,BTC,0.1,${currency},${price},${subtotal},9000.00,0,`;

  it.each(METHODS)("[%s] control: the readable sale gains 6000 € with no parser message", (method) => {
    const parsed = coinbase(cbBuy, cbSell("90000.00"));
    expect(parsed.parserMessages ?? []).toEqual([]);
    expect(net(run([[parsed, "Coinbase"]], 2025, method))).toBe("6000.00");
  });

  // A Spot Price that cannot be read was booked as 0 (a 3000 € loss), or
  // passed on as text and stopped the whole report with a DecimalError.
  describe.each(["", "€", "abc", "N/A", "-"])("Spot Price %j", (price) => {
    it.each(METHODS)("[%s] the sale is priced from its Subtotal: the 6000 € gain, no crash", (method) => {
      const parsed = coinbase(cbBuy, cbSell(price));
      expect(parsed.trades.map((t) => t.tradePrice)).toEqual(["30000.00", "90000"]);
      expect(net(run([[parsed, "Coinbase"]], 2025, method))).toBe("6000.00");
    });
    it.each(METHODS)("[%s] the purchase is priced from its Subtotal: the 6000 € gain, no crash", (method) => {
      const parsed = coinbase(`2024-03-15T10:30:00Z,Buy,BTC,0.1,EUR,${price},3000.00,3000.00,0,`, cbSell("90000.00"));
      expect(net(run([[parsed, "Coinbase"]], 2025, method))).toBe("6000.00");
    });
    it.each(METHODS)("[%s] with no readable Subtotal either, the sale books nothing and is named by its Spot Price", (method) => {
      const parsed = coinbase(cbBuy, cbSell(price, "abc"));
      const r = run([[parsed, "Coinbase"]], 2025, method);
      expect(r.capitalGains.disposals).toEqual([]);
      expect(message(r.messages, "parser.trade_row_unreadable")?.context?.rows).toBe(`BTC 20250301 [Spot Price at Transaction: ${JSON.stringify(price)}]`);
    });
    it.each(METHODS)("[%s] a Convert is priced from its Subtotal: the 6000 € gain, and the ETH received costs 9000 €", (method) => {
      const parsed = coinbase(cbBuy, `2025-03-01T10:00:00Z,Convert,BTC,0.1,EUR,${price},9000.00,9000.00,0,Converted 0.1 BTC to 3 ETH`);
      expect(parsed.trades.map((t) => [t.symbol, t.buySell, t.tradePrice])).toEqual([["BTC", "BUY", "30000.00"], ["BTC", "SELL", "90000"], ["ETH", "BUY", "3000"]]);
      expect(net(run([[parsed, "Coinbase"]], 2025, method))).toBe("6000.00");
    });
  });

  it.each(METHODS)("[%s] a sale cut short before its Spot Price books nothing and is named, never a full loss", (method) => {
    const parsed = coinbase(cbBuy, "2025-03-01T10:00:00Z,Sell,BTC,0.1,EUR");
    const r = run([[parsed, "Coinbase"]], 2025, method);
    expect(r.capitalGains.disposals).toEqual([]);
    expect(message(r.messages, "parser.trade_row_unreadable")?.context?.rows).toBe("BTC 20250301 [Spot Price at Transaction: —]");
  });

  it("no money cell holds text: Subtotal, Total and Fees that cannot be read are 0", () => {
    const parsed = coinbase(cbBuy, "2025-03-01T10:00:00Z,Sell,BTC,0.1,EUR,90000.00,abc,N/A,-,");
    expect(parsed.trades.map((t) => [t.tradeMoney, t.proceeds, t.cost, t.commission])).toEqual([["3000.00", "0", "3000.00", "0"], ["0", "0", "0", "0"]]);
  });

  it.each(METHODS)("[%s] a Convert of a written 0 quantity whose Spot Price is text never stops the report", (method) => {
    const parsed = coinbase(cbBuy, "2025-03-01T10:00:00Z,Convert,BTC,0,EUR,abc,abc,abc,0,Converted 0 BTC to 0 ETH");
    // Both counts are a written 0: no ETH is booked, and no row is named.
    expect(parsed.trades.map((t) => t.tradePrice)).toEqual(["30000.00", "0"]);
    expect(parsed.parserMessages ?? []).toEqual([]);
    expect(net(run([[parsed, "Coinbase"]], 2025, method))).toBe("0.00");
  });

  it.each(METHODS)("[%s] control: a written Spot Price 0 stays the file's word", (method) => {
    const parsed = coinbase(cbBuy, cbSell("0"));
    expect(parsed.parserMessages ?? []).toEqual([]);
    expect(net(run([[parsed, "Coinbase"]], 2025, method))).toBe("-3000.00");
  });

  // Exports from before 2021 put the currency in the money headers ("EUR
  // Spot Price at Transaction", "USD Subtotal"). No money column was found,
  // so every trade was booked at 0 with no word and the gain vanished.
  const OLD_H = (ccy: string): string => `Timestamp,Transaction Type,Asset,Quantity Transacted,${ccy} Spot Price at Transaction,${ccy} Subtotal,${ccy} Total (inclusive of fees),${ccy} Fees,Notes`;
  describe.each(["EUR", "USD"])("an older export with %s in its headers", (ccy) => {
    it.each(METHODS)("[%s] books the same numbers as the current header", (method) => {
      const old = coinbaseParser.parse([OLD_H(ccy), "2024-03-15T10:30:00Z,Buy,BTC,0.1,30000.00,3000.00,3005.00,5.00,", "2025-03-01T10:00:00Z,Sell,BTC,0.1,90000.00,9000.00,8990.00,10.00,"].join("\n"));
      const current = coinbase(`2024-03-15T10:30:00Z,Buy,BTC,0.1,${ccy},30000.00,3000.00,3005.00,5.00,`, `2025-03-01T10:00:00Z,Sell,BTC,0.1,${ccy},90000.00,9000.00,8990.00,10.00,`);
      expect(old.trades.map((t) => [t.currency, t.tradePrice, t.commission])).toEqual(current.trades.map((t) => [t.currency, t.tradePrice, t.commission]));
      expect(old.parserMessages ?? []).toEqual([]);
      const r = run([[old, "Coinbase"]], 2025, method);
      expect(net(r)).toBe(net(run([[current, "Coinbase"]], 2025, method)));
      expect(r.capitalGains.netGainLoss.isZero()).toBe(false);
    });
  });

  it("an older export's Coinbase Earn row is booked from its Total in the header currency", () => {
    const parsed = coinbaseParser.parse([OLD_H("EUR"), "2025-05-01T10:00:00Z,Coinbase Earn,XLM,10,0.1,1.00,1.00,0,"].join("\n"));
    expect(parsed.cashTransactions.map((c) => [c.symbol, c.amount, c.currency])).toEqual([["XLM", "1.00", "EUR"]]);
    expect(parsed.parserMessages ?? []).toEqual([]);
  });

  it("a header with no Spot Price at Transaction column is refused, never booked at 0", () => {
    expect(() => coinbaseParser.parse(["Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Subtotal,Total,Fees,Notes", "2025-03-01T10:00:00Z,Sell,BTC,0.1,EUR,9000.00,9000.00,0,"].join("\n")))
      .toThrow("faltan columnas obligatorias");
  });

  // An empty Price Currency was read as EUR: dollars were booked as euros.
  it.each(METHODS)("[%s] a sale with an empty Price Currency books nothing and is named by that cell", (method) => {
    const parsed = coinbase(cbBuy, cbSell("90000.00", "9000.00", ""));
    const r = run([[parsed, "Coinbase"]], 2025, method);
    expect(r.capitalGains.disposals).toEqual([]);
    expect(message(r.messages, "parser.trade_row_unreadable")?.context?.rows).toBe('BTC 20250301 [Spot Price Currency: ""]');
  });

  it("a Convert with an empty Price Currency books neither coin and names both", () => {
    const parsed = coinbase("2025-03-01T10:00:00Z,Convert,BTC,0.1,,90000.00,9000.00,9000.00,0,Converted 0.1 BTC to 3 ETH");
    expect(parsed.trades.every((t) => t.quantityUnknown)).toBe(true);
    expect(message(parsed.parserMessages, "parser.trade_row_unreadable")?.context?.rows).toBe('BTC 20250301 [Spot Price Currency: ""]; ETH 20250301 [Spot Price Currency: ""]');
  });

  it("a header with no Price Currency column books no trade under a guessed currency", () => {
    const parsed = coinbaseParser.parse(["Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price at Transaction,Subtotal,Total,Fees,Notes", "2025-03-01T10:00:00Z,Sell,BTC,0.1,90000.00,9000.00,9000.00,0,"].join("\n"));
    expect(message(parsed.parserMessages, "parser.trade_row_unreadable")?.context?.rows).toBe("BTC 20250301 [Spot Price Currency: —]");
  });

  it.each(METHODS)("[%s] income with an empty Price Currency is not booked as euros, and is named", (method) => {
    const parsed = coinbase("2025-05-01T10:00:00Z,Staking Income,ETH,0.01,,3000.00,30.00,30.00,0,");
    expect(parsed.cashTransactions).toEqual([]);
    const r = run([[parsed, "Coinbase"]], 2025, method);
    expect(r.interest.entries).toEqual([]);
    expect(message(r.messages, "parser.crypto_income_amount_unreadable")?.context?.rows).toBe('Staking Income 0.01 ETH 20250501 [Spot Price Currency: ""]');
  });

  // Income in dollars was given its dollar amount as its euro value: $30 of
  // staking was declared as 30 €, and the coin's lot cost 30 €.
  describe("income in a Price Currency other than EUR", () => {
    const usdIncome = "2025-05-01T10:00:00Z,Staking Income,ETH,0.01,USD,3000.00,30.00,30.00,0,";
    const usdSale = "2025-06-01T10:00:00Z,Sell,ETH,0.01,USD,3000.00,30.00,30.00,0,";
    it.each(METHODS)("[%s] is valued at the ECB rate, the same as a 30 USD sale, and its lot costs that much", (method) => {
      const parsed = coinbase(usdIncome, usdSale);
      expect(parsed.cashTransactions[0]?.rewardCostBasisEur).toBeUndefined();
      const r = run([[parsed, "Coinbase"]], 2025, method);
      const sale = r.capitalGains.disposals[0]!;
      expect(r.interest.earned.toFixed(2)).toBe(new Decimal(sale.proceedsEur).toFixed(2));
      expect(r.interest.earned.toFixed(2)).not.toBe("30.00");
      expect(new Decimal(sale.costBasisEur).toFixed(2)).toBe(r.interest.earned.toFixed(2));
      expect(net(r)).toBe("0.00");
    });
    it.each(METHODS)("[%s] control: the same income in EUR keeps Coinbase's own 30 €", (method) => {
      const parsed = coinbase(usdIncome.replace("USD", "EUR"));
      expect(parsed.cashTransactions[0]?.rewardCostBasisEur).toBe("30");
      expect(run([[parsed, "Coinbase"]], 2025, method).interest.earned.toFixed(2)).toBe("30.00");
    });
  });

  // A reversal (negative) income row lowered the income but still opened a
  // second 0.01 ETH lot at 30 €, so a sale of a coin with no lot got a made-up
  // cost and its fifo.insufficient_lots warning was hidden.
  describe("a negative income row", () => {
    const rows = (second: string): Statement => coinbase(
      "2025-04-01T10:00:00Z,Staking Income,ETH,0.01,EUR,3000.00,30.00,30.00,0,",
      second,
      "2025-06-01T10:00:00Z,Sell,ETH,0.02,EUR,3000.00,60.00,60.00,0,",
    );
    it.each(METHODS)("[%s] lowers the income and opens no lot", (method) => {
      const parsed = rows("2025-05-01T10:00:00Z,Staking Income,ETH,-0.01,EUR,3000.00,-30.00,-30.00,0,");
      expect(parsed.cashTransactions.map((c) => c.rewardQuantity)).toEqual(["0.01", undefined]);
      const r = run([[parsed, "Coinbase"]], 2025, method);
      expect(r.interest.earned.toFixed(2)).toBe("0.00");
      expect(r.capitalGains.acquisitionValue.toFixed(2)).toBe("30.00");
      expect(net(r)).toBe("30.00");
      expect(r.messages.some((m) => m.id === "fifo.insufficient_lots")).toBe(true);
    });
    it.each(METHODS)("[%s] control: two positive income rows give two lots and no gain", (method) => {
      const r = run([[rows("2025-05-01T10:00:00Z,Staking Income,ETH,0.01,EUR,3000.00,30.00,30.00,0,"), "Coinbase"]], 2025, method);
      expect([r.interest.earned.toFixed(2), r.capitalGains.acquisitionValue.toFixed(2), net(r)]).toEqual(["60.00", "60.00", "0.00"]);
    });
  });

  // Coinbase writes US numbers. A lone thousands comma ("90,000") was read as
  // a decimal point: the sale was booked at 90 € (a full loss), a quantity of
  // "1,500" as 1.5 and an income of "1,500" as 1.5 €, all with no word.
  describe("a US thousands comma with no decimals", () => {
    it.each(METHODS)("[%s] control: the same sale written \"90,000.00\" gains 6000 €", (method) => {
      const parsed = coinbase(cbBuy, `2025-03-01T10:00:00Z,Sell,BTC,0.1,EUR,"90,000.00","9,000.00","9,000.00",0,`);
      expect(parsed.parserMessages ?? []).toEqual([]);
      expect(net(run([[parsed, "Coinbase"]], 2025, method))).toBe("6000.00");
    });
    describe.each([["\"90,000\"", "\"9,000\""], ["\"€90,000\"", "\"€9,000\""], ["\"$90,000\"", "\"$9,000\""]])("Spot Price %s, Subtotal %s", (price, subtotal) => {
      it.each(METHODS)("[%s] the sale is read in thousands: the 6000 € gain", (method) => {
        const parsed = coinbase(cbBuy, `2025-03-01T10:00:00Z,Sell,BTC,0.1,EUR,${price},${subtotal},${subtotal},0,`);
        expect(parsed.trades.map((t) => [t.tradePrice, t.proceeds])).toEqual([["30000.00", "0"], ["90000", "9000"]]);
        expect(parsed.parserMessages ?? []).toEqual([]);
        expect(net(run([[parsed, "Coinbase"]], 2025, method))).toBe("6000.00");
      });
    });
    const xlm = (qty: string): Statement => coinbase(
      `2024-03-15T10:30:00Z,Buy,XLM,${qty},EUR,0.10,150.00,150.00,0,`,
      `2025-03-01T10:00:00Z,Sell,XLM,${qty},EUR,0.30,450.00,450.00,0,`,
    );
    it.each(METHODS)("[%s] a quantity of \"1,500\" is 1500 coins, the same 300 € gain as 1500", (method) => {
      const parsed = xlm("\"1,500\"");
      expect(parsed.trades.map((t) => t.quantity)).toEqual(["1500", "-1500"]);
      expect(net(run([[parsed, "Coinbase"]], 2025, method))).toBe(net(run([[xlm("1500"), "Coinbase"]], 2025, method)));
      expect(net(run([[parsed, "Coinbase"]], 2025, method))).toBe("300.00");
    });
    it.each(METHODS)("[%s] an income Total of \"1,500\" is 1500 €", (method) => {
      const parsed = coinbase("2025-05-01T10:00:00Z,Staking Income,ETH,0.5,EUR,\"3,000\",\"1,500\",\"1,500\",0,");
      expect(parsed.cashTransactions.map((c) => [c.amount, c.rewardCostBasisEur])).toEqual([["1500", "1500"]]);
      expect(run([[parsed, "Coinbase"]], 2025, method).interest.earned.toFixed(2)).toBe("1500.00");
    });
    it("a comma that cannot be a thousands group stays a decimal comma", () => {
      expect(xlm("\"0,5\"").trades.map((t) => t.quantity)).toEqual(["0.5", "-0.5"]);
      // US format never writes a group after a bare 0, so "0,123" is 0.123.
      expect(xlm("\"0,123\"").trades.map((t) => t.quantity)).toEqual(["0.123", "-0.123"]);
    });
  });

  // A Spot Price that cannot be read is Subtotal ÷ Quantity. With a Subtotal
  // of 0 that made the sale a full loss with no word.
  it.each(METHODS)("[%s] a sale whose Spot Price cannot be read and whose Subtotal is 0 books nothing and is named", (method) => {
    const parsed = coinbase(cbBuy, "2025-03-01T10:00:00Z,Sell,BTC,0.1,EUR,N/A,0.00,0.00,0,");
    const r = run([[parsed, "Coinbase"]], 2025, method);
    expect(r.capitalGains.disposals).toEqual([]);
    expect(message(r.messages, "parser.trade_row_unreadable")?.context?.rows).toBe('BTC 20250301 [Spot Price at Transaction: "N/A"]');
  });

  // A negative price gave the sale negative proceeds. The side already says
  // which way the coin moved, as for a price read from the Subtotal.
  describe.each(["-90000.00", "(90000.00)"])("a Spot Price written %s", (price) => {
    it.each(METHODS)("[%s] is read as its size: the 6000 € gain", (method) => {
      const parsed = coinbase(cbBuy, cbSell(price));
      expect(parsed.trades.map((t) => t.tradePrice)).toEqual(["30000.00", "90000"]);
      expect(net(run([[parsed, "Coinbase"]], 2025, method))).toBe("6000.00");
    });
  });

  // ETH bought on 15/03/2024 for 3000 €, sold on 01/03/2025 for 2000 € (a
  // 1000 € loss), and bought again on 01/07/2025 through a Convert from BTC.
  // A Convert whose Notes give no readable coin count for ETH booked a BUY of
  // 0 ETH: the rebuy was hidden, the 1000 € loss was deducted with no word,
  // and a later ETH sale stopped the report on a lot of 0 units that cost
  // 9000 € (report.non_finite_total).
  describe("a Convert whose Notes give no readable coin count received", () => {
    const ethLoss = [
      "2024-03-15T10:30:00Z,Buy,ETH,1,EUR,3000.00,3000.00,3000.00,0,",
      "2025-03-01T10:00:00Z,Sell,ETH,1,EUR,2000.00,2000.00,2000.00,0,",
      cbBuy,
    ];
    const convert = (dest: string): string => `2025-07-01T10:00:00Z,Convert,BTC,0.1,EUR,90000.00,9000.00,9000.00,0,Converted 0.1 BTC to ${dest} ETH`;
    it.each(METHODS)("[%s] control: \"to 1 ETH\" is a rebuy that blocks the 1000 € loss", (method) => {
      const parsed = coinbase(...ethLoss, convert("1"));
      expect(parsed.parserMessages ?? []).toEqual([]);
      expect(run([[parsed, "Coinbase"]], 2025, method).capitalGains.blockedLosses.toFixed(2)).toBe("1000.00");
    });
    describe.each([".", "1.2.3", "0", "0.00000000"])("\"to %s ETH\"", (dest) => {
      it.each(METHODS)("[%s] books no ETH and names the row by its Notes, with the art. 33.5.e caveat", (method) => {
        const parsed = coinbase(...ethLoss, convert(dest));
        expect(parsed.trades.filter((t) => t.symbol === "ETH" && !t.quantityUnknown).map((t) => t.buySell)).toEqual(["BUY", "SELL"]);
        const r = run([[parsed, "Coinbase"]], 2025, method);
        const warning = message(r.messages, "parser.trade_row_unreadable");
        expect(warning?.context?.rows).toBe(`ETH 20250701 [Notes: "Converted 0.1 BTC to ${dest} ETH"]`);
        expect(warning?.hint).toContain("33.5.e");
        // The BTC given up is still booked: the 6000 € gain.
        expect(r.capitalGains.disposals.map((d) => d.symbol)).toContain("BTC");
      });
    });
    it.each(METHODS)("[%s] \"to 0 ETH\" and a later ETH sale: no lot of 0 units, so no non-finite total; the sale has no lot and its 9000 € count as gain", (method) => {
      const parsed = coinbase(cbBuy, "2025-04-01T10:00:00Z,Convert,BTC,0.1,EUR,90000.00,9000.00,9000.00,0,Converted 0.1 BTC to 0 ETH",
        "2025-06-01T10:00:00Z,Sell,ETH,3,EUR,3000.00,9000.00,9000.00,0,");
      const r = run([[parsed, "Coinbase"]], 2025, method);
      expect(r.messages.some((m) => m.id === "report.non_finite_total")).toBe(false);
      expect(r.messages.some((m) => m.id === "fifo.sell_without_lots")).toBe(true);
      // BTC gains 6000 €, and the ETH sale with no known cost 9000 €.
      expect(net(r)).toBe("15000.00");
      expect(message(r.messages, "parser.trade_row_unreadable")?.context?.rows).toBe('ETH 20250401 [Notes: "Converted 0.1 BTC to 0 ETH"]');
    });
  });
});

describe("#467 DEGIRO: a cash row or a trade the file does not fully give is named, never booked as a guess or a crash", () => {
  // Realistic rates: 1 USD = 0.92 EUR, 1 GBP = 1.17 EUR, 1 JPY = 0.0062 EUR.
  const realRates = (): EcbRateMap => {
    const map: EcbRateMap = new Map();
    for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2025, 11, 31); t += 86_400_000) {
      map.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "0.92"], ["GBP", "1.17"], ["JPY", "0.0062"]]));
    }
    return map;
  };
  const report = (parsed: Statement, method: FxMethod): TaxReport => {
    const statement = createEmptyStatement();
    mergeStatement(statement, parsed, "DEGIRO");
    return generateTaxReport(finalizeMergedStatement(statement), realRates(), 2024, reportOptionsForMethod(method));
  };
  const message = (s: Statement, id: string): TaxMessage | undefined => s.parserMessages?.find((m) => m.id === id);
  const ID = "parser.cash_income_amount_unreadable";
  const cash = (r: TaxReport): string[] =>
    [r.dividends.grossIncome, r.doubleTaxation.deduction, r.interest.earned].map((d) => new Decimal(d).toFixed(2));
  const gains = (r: TaxReport): string[] =>
    [r.capitalGains.transmissionValue, r.capitalGains.acquisitionValue, r.capitalGains.netGainLoss].map((d) => new Decimal(d).toFixed(2));

  // Account CSV, real layout: the labelled "Variación" column holds the
  // currency and the unnamed column after it the amount.
  const AC = "Fecha,Hora,Fecha valor,Producto,ISIN,Descripción,Tipo,Variación,,Saldo,,ID Orden";
  const arow = (desc: string, amount: string, ccy = "USD", product = "APPLE INC", isin = AAPL): string =>
    ["12-01-2024", "07:31", "11-01-2024", product, isin, desc, "", ccy, amount, ccy, "100.00", ""].join(",");
  const account = (...rows: string[]): Statement => degiroParser.parse([AC, ...rows].join("\n"));
  const dividend = (amount: string, withheld = "-15.00", ccy = "USD"): Statement =>
    account(arow("Dividendo", amount, ccy), arow("Retención del dividendo", withheld, ccy));

  describe.each(["abc", "", "$"])("a Dividendo amount of %j", (cell) => {
    it.each(METHODS)("[%s] books neither the dividend nor its withholding, the report runs, and both are named", (method) => {
      const parsed = dividend(cell);
      expect(parsed.cashTransactions).toEqual([]);
      expect(message(parsed, ID)?.context?.rows).toBe(
        `Dividendo APPLE INC (${AAPL}) USD 20240112 (Retención del dividendo -15.00 USD) [Variación: ${JSON.stringify(cell)}]`);
      expect(cash(report(parsed, method))).toEqual(["0.00", "0.00", "0.00"]);
    });
  });

  it.each(METHODS)("[%s] control: a readable dividend and withholding are booked, and a written 0 stays a zero with no warning", (method) => {
    const parsed = dividend("100.00");
    expect(cash(report(parsed, method))).toEqual(["92.00", "13.80", "0.00"]);
    expect(parsed.parserMessages).toBeUndefined();
    const zero = dividend("0", "0");
    expect(zero.cashTransactions.map((c) => c.amount)).toEqual(["0", "0"]);
    expect(zero.parserMessages).toBeUndefined();
  });

  it.each(METHODS)("[%s] a GBX dividend amount of \"abc\" is named, never a raw DecimalError that refuses the file", (method) => {
    const parsed = dividend("abc", "-36", "GBX");
    expect(parsed.cashTransactions).toEqual([]);
    expect(message(parsed, ID)?.context?.rows).toBe(
      `Dividendo APPLE INC (${AAPL}) GBX 20240112 (Retención del dividendo -0.36 GBP) [Variación: "abc"]`);
    expect(cash(report(parsed, method))).toEqual(["0.00", "0.00", "0.00"]);
    // Control: 242 and -36 pence are 2.42 and -0.36 GBP.
    expect(cash(report(dividend("242", "-36", "GBX"), method))).toEqual(["2.83", "0.42", "0.00"]);
  });

  it.each(METHODS)("[%s] a withholding amount of \"abc\" is named, not booked: the dividend stays, with no deduction", (method) => {
    const parsed = dividend("100.00", "abc");
    expect(parsed.cashTransactions.map((c) => `${c.type} ${c.amount}`)).toEqual(["Dividends 100.00"]);
    expect(message(parsed, ID)?.context?.rows).toBe(`Retención del dividendo APPLE INC (${AAPL}) USD 20240112 [Variación: "abc"]`);
    expect(cash(report(parsed, method))).toEqual(["92.00", "0.00", "0.00"]);
  });

  it.each(METHODS)("[%s] a GBP dividend with an empty currency cell is named, never booked as euros (100 € instead of 117 €)", (method) => {
    const bat = (ccy: string): Statement => account(arow("Dividendo", "100.00", ccy, "BAT", "GB0002875804"));
    expect(cash(report(bat("GBP"), method))).toEqual(["117.00", "0.00", "0.00"]);
    const parsed = bat("");
    expect(parsed.cashTransactions).toEqual([]);
    expect(message(parsed, ID)?.context?.rows).toBe(`Dividendo BAT (GB0002875804) 20240112 [Variación, divisa: ""]`);
    expect(cash(report(parsed, method))).toEqual(["0.00", "0.00", "0.00"]);
  });

  it.each(METHODS)("[%s] a withholding with an empty currency cell is named, not booked as euros", (method) => {
    const parsed = account(arow("Dividendo", "100.00"), arow("Retención del dividendo", "-15.00", ""));
    expect(parsed.cashTransactions.map((c) => `${c.type} ${c.amount} ${c.currency}`)).toEqual(["Dividends 100.00 USD"]);
    expect(message(parsed, ID)?.context?.rows).toBe(`Retención del dividendo APPLE INC (${AAPL}) 20240112 [Variación, divisa: ""]`);
    expect(cash(report(parsed, method))).toEqual(["92.00", "0.00", "0.00"]);
  });

  describe.each(["flatex Interest", "Interés", "Zinsen", "Rente"])("interest row %j", (desc) => {
    it.each(METHODS)("[%s] a positive amount is interest received; a negative one stays out; one that cannot be read is named", (method) => {
      const paid = account(arow(desc, "10.00", "EUR", "", ""), arow("Dividendo", "100.00"));
      expect(paid.cashTransactions.map((c) => `${c.type} ${c.amount} ${c.currency}`)).toEqual(["Broker Interest Received 10.00 EUR", "Dividends 100.00 USD"]);
      expect(cash(report(paid, method))).toEqual(["92.00", "0.00", "10.00"]);
      const charged = account(arow(desc, "-1.00", "EUR", "", ""));
      expect([charged.cashTransactions, charged.parserMessages]).toEqual([[], undefined]);
      const unreadable = account(arow(desc, "abc", "EUR", "", ""));
      expect(unreadable.cashTransactions).toEqual([]);
      expect(message(unreadable, ID)?.context?.rows).toBe(`${desc} EUR 20240112 [Variación: "abc"]`);
      expect(cash(report(unreadable, method))).toEqual(["0.00", "0.00", "0.00"]);
    });
  });

  // A dividend's ISIN sets the country of its withholding: with no ISIN a
  // Spanish 19.00 € withheld was read as foreign tax under country XX.
  const SAN = "ES0113900J37";
  const san = (product: string, isin: string, withheldIsin = isin): Statement =>
    account(arow("Dividendo", "100.00", "EUR", product, isin), arow("Retención del dividendo", "-19.00", "EUR", product, withheldIsin));
  const spanish = (r: TaxReport): string[] =>
    [r.dividends.grossIncome, r.dividends.spanishWithholding, r.doubleTaxation.deduction].map((d) => new Decimal(d).toFixed(2));
  describe.each(["", "BANCO SANTANDER"])("a Spanish dividend and withholding with no ISIN, Producto %j", (product) => {
    it.each(METHODS)("[%s] are named and not booked, never a 15.00 € foreign deduction on a 19.00 € Spanish withholding", (method) => {
      expect(spanish(report(san("BANCO SANTANDER", SAN), method))).toEqual(["100.00", "19.00", "0.00"]);
      const parsed = san(product, "");
      expect(parsed.cashTransactions).toEqual([]);
      expect(message(parsed, "parser.cash_row_unidentified")?.context?.rows).toBe(
        `Dividendo ${product || "—"} 100.00 EUR (Retención del dividendo -19.00 EUR) 20240112`);
      expect(spanish(report(parsed, method))).toEqual(["0.00", "0.00", "0.00"]);
    });
  });
  it.each(METHODS)("[%s] a withholding with no ISIN next to a dividend with one is named; the dividend stays, with no deduction", (method) => {
    const parsed = san("BANCO SANTANDER", SAN, "");
    expect(parsed.cashTransactions.map((c) => `${c.type} ${c.isin}`)).toEqual([`Dividends ${SAN}`]);
    expect(message(parsed, "parser.cash_row_unidentified")?.context?.rows).toBe("Retención del dividendo BANCO SANTANDER -19.00 EUR 20240112");
    expect(spanish(report(parsed, method))).toEqual(["100.00", "0.00", "0.00"]);
  });
  it.each(METHODS)("[%s] a US dividend with no security is named, never booked under country XX", (method) => {
    const parsed = account(arow("Dividendo", "100.00", "USD", "", ""), arow("Retención del dividendo", "-15.00", "USD", "", ""));
    expect(parsed.cashTransactions).toEqual([]);
    expect(message(parsed, "parser.cash_row_unidentified")?.context?.rows).toBe("Dividendo — 100.00 USD (Retención del dividendo -15.00 USD) 20240112");
    expect(cash(report(parsed, method))).toEqual(["0.00", "0.00", "0.00"]);
  });
  it("control: a written 0 with no ISIN stays an explicit zero with no warning", () => {
    const zero = account(arow("Dividendo", "0", "EUR", "", ""), arow("Retención del dividendo", "0", "EUR", "", ""));
    expect([zero.cashTransactions.map((c) => c.amount), zero.parserMessages]).toEqual([["0", "0"], undefined]);
  });

  // A row with no Descripción cannot be typed: one that names a security and
  // moves money may be a dividend, so it is named, never dropped with no word.
  const UNDESCRIBED = "degiro.cash_row_undescribed";
  it.each(METHODS)("[%s] a row with a security and an amount but no Descripción is named and not booked", (method) => {
    const bat = (desc: string): Statement => account(arow(desc, "100.00", "GBP", "BAT", "GB0002875804"));
    expect(cash(report(bat("Dividendo"), method))).toEqual(["117.00", "0.00", "0.00"]);
    expect(message(bat("Dividendo"), UNDESCRIBED)).toBeUndefined();
    const parsed = bat("");
    expect(parsed.cashTransactions).toEqual([]);
    expect(message(parsed, UNDESCRIBED)?.context).toEqual({ count: "1", rows: 'BAT (GB0002875804) 100.00 GBP 20240112 [Descripción: ""]' });
    expect(cash(report(parsed, method))).toEqual(["0.00", "0.00", "0.00"]);
  });
  it("controls: a row with no Descripción and no security, a written 0 or no amount stays skipped with no warning", () => {
    expect(account(arow("", "100.00", "EUR", "", "")).parserMessages).toBeUndefined();
    expect(account(arow("", "0,00")).parserMessages).toBeUndefined();
    expect(account(arow("", "")).parserMessages).toBeUndefined();
  });
  it("the warning for a row with no Descripción exists in the five locales and the parser emits the Spanish text", () => {
    expect(isTranslationKey(UNDESCRIBED) && isTranslationKey(`${UNDESCRIBED}.hint`)).toBe(true);
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) expect(locale[UNDESCRIBED]).toContain("{{rows}}");
    const emitted = message(account(arow("", "abc")), UNDESCRIBED)!;
    expect(emitted.context?.rows).toBe(`APPLE INC (${AAPL}) USD 20240112 [Descripción: "", Variación: "abc"]`);
    const esText = es as Record<string, string>;
    expect(emitted.message).toBe(esText[UNDESCRIBED]!.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => emitted.context?.[k] ?? ""));
    expect(emitted.hint).toBe(esText[`${UNDESCRIBED}.hint`]);
  });

  // Transactions CSV, 19-col layout.
  const TX = "Fecha,Hora,Producto,ISIN,Bolsa de,Centro de ejecución,Número,Precio,,Valor local,,Valor,,Tipo de cambio,Costes de transacción,,Total,,ID Orden";
  type Row = { d?: string; q?: string; p?: string; ccy?: string; lv?: string; ev?: string; fx?: string; cc?: string; id?: string };
  const trow = (r: Row): string => [r.d ?? "10-01-2024", "10:00", "APPLE INC", AAPL, "NDQ", "XNAS", r.q ?? "10", r.p ?? "100.00", r.ccy ?? "USD",
    r.lv ?? "-1000.00", r.ccy ?? "USD", r.ev ?? "-920.00", "EUR", r.fx ?? "1.0870", "-2.00", r.cc ?? "EUR", "-922.00", "EUR", r.id ?? "aaaa1111-2222-3333-4444-555566667777"].join(",");
  const SELL: Row = { d: "10-03-2024", q: "-10", p: "120.00", lv: "1200.00", ev: "1104.00", id: "bbbb1111-2222-3333-4444-555566667777" };
  const pair = (sell: Row, buy: Row = {}): Statement => degiroParser.parse([TX, trow(buy), trow({ ...SELL, ...sell })].join("\n"));

  describe.each([["Valor local", { lv: "abc" }], ["Tipo de cambio", { fx: "abc" }]] as [string, Row][])("a GBX sale with a %s of \"abc\"", (_cell, bad) => {
    it.each(METHODS)("[%s] is read, never a raw DecimalError: the gain is the control's", (method) => {
      const gbx = (sell: Row): Statement => pair({ ccy: "GBX", p: "12000", lv: "120000", ...sell }, { ccy: "GBX", p: "10000", lv: "-100000" });
      expect(gains(report(gbx(bad), method))).toEqual(gains(report(gbx({}), method)));
      expect(gains(report(gbx({}), method))).toEqual(["1402.00", "1172.00", "230.00"]);
    });
  });

  it.each(METHODS)("[%s] a yen buy with an empty price-currency cell is named, never booked as euros (a loss of 9,929.60 €)", (method) => {
    const JPY_BUY: Row = { ccy: "JPY", p: "1000", lv: "-10000", ev: "-62.00", fx: "161.29" };
    const JPY_SELL: Row = { ccy: "JPY", p: "1200", lv: "12000", ev: "74.40", fx: "161.29" };
    expect(gains(report(pair(JPY_SELL, JPY_BUY), method))).toEqual(["72.40", "64.00", "8.40"]);
    const parsed = pair(JPY_SELL, { ...JPY_BUY, ccy: "" });
    expect(unreadableRows(parsed)).toBe(`APPLE INC (${AAPL}) 20240110 [Precio, divisa: ""]`);
    expect(parsed.trades.map((t) => [t.buySell, t.quantity, t.quantityUnknown ?? false])).toEqual([["BUY", "0", true], ["SELL", "-10", false]]);
    // The sale has no lot: its whole value is a gain, more tax, never less.
    expect(gains(report(parsed, method))).toEqual(["72.40", "0.00", "72.40"]);
  });

  it.each(METHODS)("[%s] an empty costs-currency cell books the commission in EUR, never in the price currency", (method) => {
    expect(gains(report(pair({ ccy: "GBP", cc: "" }, { ccy: "GBP", cc: "" }), method))).toEqual(["1402.00", "1172.00", "230.00"]);
    expect(gains(report(pair({ ccy: "GBP" }, { ccy: "GBP" }), method))).toEqual(["1402.00", "1172.00", "230.00"]);
  });

  // The quoted cell is how a comma-delimited file writes "(120,00)".
  describe.each([["-120.00", "-120.00"], ["\"(120,00)\"", "(120,00)"]])("a sale with a Precio of %s", (cell, p) => {
    it.each(METHODS)("[%s] is named and books nothing, never negative proceeds (a loss of 2,028.00 € on a gain of 180.00 €)", (method) => {
      expect(gains(report(pair({}), method))).toEqual(["1102.00", "922.00", "180.00"]);
      const parsed = pair({ p: cell });
      expect(unreadableRows(parsed)).toBe(`APPLE INC (${AAPL}) 20240310 [Precio: ${JSON.stringify(p)}]`);
      expect(parsed.trades.map((t) => [t.buySell, t.quantity, t.quantityUnknown ?? false])).toEqual([["BUY", "10", false], ["SELL", "0", true]]);
      expect(gains(report(parsed, method))).toEqual(["0.00", "0.00", "0.00"]);
    });
  });
  it.each(METHODS)("[%s] a buy with a Precio of \"-100.00\" is named and books nothing, never a negative cost", (method) => {
    const parsed = pair({}, { p: "-100.00" });
    expect(unreadableRows(parsed)).toBe(`APPLE INC (${AAPL}) 20240110 [Precio: "-100.00"]`);
    // The sale has no lot: its whole value is a gain, more tax, never less.
    expect(gains(report(parsed, method))).toEqual(["1102.00", "0.00", "1102.00"]);
  });

  // A buy or sale with a readable quantity and an empty price is a trade, with
  // or without an order id or a value: dropped, it hid a second purchase.
  const xyz = (price: string, qty = "40", order = ""): Statement => degiroParser.parse([DG_H,
    `02-12-2024,09:15,XYZ SA,${ISIN},MAD,XMAD,${qty},${price},EUR,,EUR,0,EUR,0,EUR,${order}`].join("\n"));
  it.each(METHODS)("[%s] an empty price with a readable quantity, no order id and no value is kept and named; the exception is not applied", (method) => {
    const parsed = xyz("");
    expect(parsed.trades.map((t) => [t.buySell, t.quantity, t.quantityUnknown])).toEqual([["BUY", "0", true]]);
    expect(message(parsed, "parser.trade_quantity_unknown")?.context?.trades).toBe(`XYZ SA (${ISIN}) 20241202`);
    expect(issueSale(parsed, "DEGIRO", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
    // Control: the same row with an order id was already kept.
    expect(issueSale(xyz("", "40", "ord1"), "DEGIRO", method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
  });
  it("controls: a written zero quantity, or no readable quantity and no price, order id or value, stays skipped", () => {
    expect(xyz("", "0").trades).toEqual([]);
    expect(xyz("", "").trades).toEqual([]);
  });
});

describe("#467 eToro: a row or a sheet the parser cannot read is named, never booked as 0, as dollars, as a loss or a crash", () => {
  // Realistic rate: 1 USD = 0.92 EUR.
  const usdRates = (): EcbRateMap => {
    const map: EcbRateMap = new Map();
    for (let t = Date.UTC(2024, 0, 1); t <= Date.UTC(2025, 11, 31); t += 86_400_000) {
      map.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "0.92"]]));
    }
    return map;
  };
  const report = (parsed: Statement, method: FxMethod): TaxReport => {
    const statement = createEmptyStatement();
    mergeStatement(statement, parsed, "eToro");
    return generateTaxReport(finalizeMergedStatement(statement), usdRates(), 2025, reportOptionsForMethod(method));
  };
  const message = (s: Statement, id: string): TaxMessage | undefined => s.parserMessages?.find((m) => m.id === id);
  const ID = "parser.cash_income_amount_unreadable";
  // 0029 dividends, 0588 deduction, 0027 interest, and the capital gain.
  const nums = (r: TaxReport): string[] =>
    [r.dividends.grossIncome, r.doubleTaxation.deduction, r.interest.earned, r.capitalGains.netGainLoss].map((d) => new Decimal(d).toFixed(2));
  const book = (sheets: [string, string[][]][]): Promise<Statement> => {
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
    return parseEtoroXlsx(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  };

  const DV = ["Date of Payment", "Instrument Name", "Net Dividend Received (USD)", "Withholding Tax Amount (USD)", "ISIN"];
  const dividend = (net: string, wht = "7.50", header = DV): Promise<Statement> =>
    book([["Dividends", [header, ["15/06/2025", "AAPL", net, wht, AAPL]]]]);

  describe.each(["abc", "", "$"])("a dividend whose Net Dividend Received is %j", (cell) => {
    it.each(METHODS)("[%s] books neither the dividend nor its withholding, and is named", async (method) => {
      const parsed = await dividend(cell);
      expect(parsed.cashTransactions).toEqual([]);
      expect(message(parsed, ID)?.context).toEqual({ broker: "eToro", count: "1",
        rows: `Dividends AAPL (${AAPL}) USD 20250615 (Withholding Tax Amount (USD) 7.50) [Net Dividend Received (USD): ${JSON.stringify(cell)}]` });
      expect(nums(report(parsed, method))).toEqual(["0.00", "0.00", "0.00", "0.00"]);
    });
  });

  it.each(METHODS)("[%s] controls: a readable dividend is booked, and a written 0 stays skipped with no warning", async (method) => {
    expect(nums(report(await dividend("42.50"), method))).toEqual(["46.00", "6.90", "0.00", "0.00"]);
    const zero = await dividend("0");
    expect([zero.cashTransactions, zero.parserMessages]).toEqual([[], undefined]);
  });

  it.each(METHODS)("[%s] a Spanish dividend with an empty EUR net is named by that cell, never dropped with no word", async (method) => {
    const H = ["Fecha de pago", "Nombre del instrumento", "Dividendo neto recibido (USD)", "Dividendo neto recibido (EUR)",
      "Importe de la retención tributaria (USD)", "Importe de la retención tributaria (EUR)", "ISIN"];
    const es = (eur: string): Promise<Statement> => book([["Dividendos", [H, ["15/06/2025", "Apple", "42.50", eur, "7.50", "6.70", AAPL]]]]);
    expect(nums(report(await es("38.00"), method))).toEqual(["44.70", "6.70", "0.00", "0.00"]);
    const parsed = await es("");
    expect(parsed.cashTransactions).toEqual([]);
    expect(message(parsed, ID)?.context?.rows).toBe(
      `Dividends Apple (${AAPL}) EUR 20250615 (Importe de la retención tributaria (EUR) 6.70) [Dividendo neto recibido (EUR): ""]`);
    expect(nums(report(parsed, method))).toEqual(["0.00", "0.00", "0.00", "0.00"]);
  });

  describe.each(["$1234.56", "1,234.56", "1.234,56"])("a dividend with no withholding and a net of %j", (cell) => {
    it.each(METHODS)("[%s] is read as 1234.56, never a raw DecimalError that stops the report", async (method) => {
      const control = nums(report(await dividend("1234.56", "0"), method));
      expect(control).toEqual(["1135.80", "0.00", "0.00", "0.00"]);
      expect(nums(report(await dividend(cell, "0"), method))).toEqual(control);
      // No withholding column at all, and a withholding rate of 0 %.
      expect(nums(report(await book([["Dividends", [["Date of Payment", "Instrument Name", "Net Dividend Received (USD)", "ISIN"],
        ["15/06/2025", "AAPL", cell, AAPL]]]]), method))).toEqual(control);
      expect(nums(report(await book([["Dividends", [["Date of Payment", "Instrument Name", "Net Dividend Received (USD)", "Withholding Tax Rate (%)", "ISIN"],
        ["15/06/2025", "AAPL", cell, "0 %", AAPL]]]]), method))).toEqual(control);
    });
  });

  // A sheet with only the withholding rate: gross = net ÷ (1 − rate).
  const DVR = ["Date of Payment", "Instrument Name", "Net Dividend Received (USD)", "Withholding Tax Rate (%)", "ISIN"];
  const byRate = (...rows: [string, string][]): Promise<Statement> =>
    book([["Dividends", [DVR, ...rows.map(([net, rate], i) => [`${15 + i}/06/2025`, "AAPL", net, rate, AAPL])]]]);
  describe.each(["100", "100%", "150", "-15"])("a dividend whose Withholding Tax Rate (%%) is %j", (rate) => {
    it.each(METHODS)("[%s] is booked at its net with no withholding, never an infinite or crashing gross", async (method) => {
      const parsed = await byRate(["42.50", rate]);
      expect(parsed.cashTransactions.map((c) => [c.type, c.amount])).toEqual([["Dividends", "42.50"]]);
      expect(nums(report(parsed, method))).toEqual(["39.10", "0.00", "0.00", "0.00"]);
    });
  });
  it.each(METHODS)("[%s] a reversal on the rate path refunds its withholding, never a \"--7.5\" that stops the report", async (method) => {
    // Control: 42.50 net at 15 % is 50 gross with 7.50 withheld.
    expect(nums(report(await byRate(["42.50", "15%"]), method))).toEqual(["46.00", "6.90", "0.00", "0.00"]);
    const reversal = await byRate(["-42.50", "15%"]);
    expect(reversal.cashTransactions.map((c) => [c.type, c.amount])).toEqual([["Dividends", "-50.0000"], ["Withholding Tax", "7.5000"]]);
    const both = await byRate(["42.50", "15%"], ["-42.50", "15%"]);
    expect(nums(report(both, method))).toEqual(["0.00", "0.00", "0.00", "0.00"]);
  });

  const AA = ["Date", "Type", "Details", "Amount"];
  const interest = (amount: string): Promise<Statement> => book([["Account Activity", [AA, ["15/06/2025", "Interest Payment", "", amount]]]]);
  describe.each(["abc", "", "$"])("an interest payment whose Amount is %j", (cell) => {
    it.each(METHODS)("[%s] is not booked and is named", async (method) => {
      const parsed = await interest(cell);
      expect(parsed.cashTransactions).toEqual([]);
      expect(message(parsed, ID)?.context?.rows).toBe(`Interest Payment USD 20250615 [Amount: ${JSON.stringify(cell)}]`);
      expect(nums(report(parsed, method))).toEqual(["0.00", "0.00", "0.00", "0.00"]);
    });
  });

  it.each(METHODS)("[%s] a staking reward in Account Activity is named for the user to add by hand, never dropped with no word", async (method) => {
    const parsed = await book([["Account Activity", [AA,
      ["15/06/2025", "Staking", "ETH/USD", "42.50"],
      ["16/06/2025", "Interest Payment", "", "42.50"],
      ["17/06/2025", "Deposit", "", "1000.00"],
      ["18/06/2025", "Open Position", "AAPL/USD", "-500.00"]]]]);
    // The interest is booked; the staking reward is not guessed, it is named.
    expect(parsed.cashTransactions.map((c) => [c.type, c.amount])).toEqual([["Broker Interest Received", "42.5"]]);
    const emitted = message(parsed, "etoro.staking_not_imported");
    expect([emitted?.severity, emitted?.context]).toEqual(["warning", { count: "1", rows: "Staking ETH/USD 42.50 20250615" }]);
    expect(emitted?.message).toBe((es as Record<string, string>)["etoro.staking_not_imported"]!.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => emitted?.context?.[k] ?? ""));
    expect(emitted?.hint).toBe((es as Record<string, string>)["etoro.staking_not_imported.hint"]);
    expect(parsed.parserMessages).toHaveLength(1);
    expect(nums(report(parsed, method))).toEqual(["0.00", "0.00", "39.10", "0.00"]);
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
      expect(locale["etoro.staking_not_imported"]).toContain("{{count}}");
      expect(locale["etoro.staking_not_imported"]).toContain("{{rows}}");
      expect(locale["etoro.staking_not_imported.hint"]).toBeTruthy();
    }
  });

  it.each(METHODS)("[%s] controls: a readable interest payment is booked, and a written 0 stays skipped with no warning", async (method) => {
    expect(nums(report(await interest("42.50"), method))).toEqual(["0.00", "0.00", "39.10", "0.00"]);
    const zero = await interest("0");
    expect([zero.cashTransactions, zero.parserMessages]).toEqual([[], undefined]);
  });

  // English closed position: buy 5 AAPL at 200, sell at 240 (a 200 USD gain, 184 €).
  const closed = (o: Partial<Record<string, string>> = {}, header = ET_H): Promise<Statement> => {
    const base: Record<string, string> = { "Action": "Buy AAPL", "Amount": "1000", "Units": "5", "Open Rate": "200", "Close Rate": "240",
      "Profit(USD)": "200", "Open Date": "15/03/2025 09:30:00", "Close Date": "20/09/2025 14:00:00", "Type": "Stocks", "Leverage": "1", "ISIN": AAPL, ...o };
    return book([["Closed Positions", [header, ET_H.map((h) => base[h]!)]]]);
  };
  describe.each(["Open Rate", "Close Rate"])("a closed position whose %s cannot be read", (column) => {
    describe.each(["abc", "", "$"])("%j", (cell) => {
      it.each(METHODS)("[%s] keeps both legs as unreadable rows that book nothing, never a crash or a full loss", async (method) => {
        const parsed = await closed({ [column]: cell });
        expect(parsed.trades.every((t) => t.quantityUnknown === true)).toBe(true);
        expect(unreadableRows(parsed)).toBe(`AAPL (${AAPL}) 20250315 [${column}: ${JSON.stringify(cell)}]; AAPL (${AAPL}) 20250920 [${column}: ${JSON.stringify(cell)}]`);
        const r = report(parsed, method);
        expect(r.capitalGains.disposals).toEqual([]);
        expect(nums(r)).toEqual(["0.00", "0.00", "0.00", "0.00"]);
      });
    });
  });

  it.each(METHODS)("[%s] control: a readable position gains 184 €, and a rate with a thousands separator is read as a number", async (method) => {
    expect(nums(report(await closed(), method))).toEqual(["0.00", "0.00", "0.00", "184.00"]);
    const plain = nums(report(await closed({ "Open Rate": "1100", "Close Rate": "1234.56" }), method));
    expect(plain).toEqual(["0.00", "0.00", "0.00", "618.98"]);
    for (const cell of ["1,234.56", "1.234,56", "$1234.56"]) {
      expect(nums(report(await closed({ "Open Rate": "1100", "Close Rate": cell }), method))).toEqual(plain);
    }
  });

  describe.each(["Open Rate", "Close Rate"])("a Closed Positions sheet whose %s column is not recognised", (column) => {
    it.each(METHODS)("[%s] keeps every row unreadable and names the missing column, never a price of 0", async (method) => {
      const parsed = await closed({}, ET_H.map((h) => h === column ? (column === "Open Rate" ? "Opening Rate" : "Closing Rate") : h));
      expect(unreadableRows(parsed)).toBe(`AAPL (${AAPL}) 20250315 [${column}: —]; AAPL (${AAPL}) 20250920 [${column}: —]`);
      expect(report(parsed, method).capitalGains.disposals).toEqual([]);
    });
  });

  // Spanish export: SAP quoted in EUR, 10 units, 100 → 150 EUR. eToro's FX
  // rates turn the instrument's quote into dollars: 1.08 at open and, unless
  // given, 1.08 at close, so the legs are 108 and 162 USD (540 USD, 496.80 €).
  const SP_H = ["ID de posición", "Acción", "Long / Short", "Importe", "Unidades", "Fecha de apertura", "Fecha de cierre", "Apalancamiento",
    "Ganancias (USD)", "Ganancias (EUR)", "Tipo de cambio de apertura (USD)", "Tipo de cambio al cierre (USD)", "Tasa de apertura", "Tasa de cierre", "Tipo", "ISIN"];
  type Position = { name?: string; isin?: string; units?: string; fx?: string; fxClose?: string; open?: string; close?: string };
  const spRow = (p: Position): string[] => {
    const fx = p.fx ?? "1.08";
    return ["1", p.name ?? "SAP", "Long", "1000", p.units ?? "10", "01/02/2025 10:00:00", "15/06/2025 16:00:00", "1", "540", "500",
      fx, p.fxClose ?? fx, p.open ?? "100", p.close ?? "150", "Acciones", p.isin ?? "DE0007164600"];
  };
  const position = (p: Position, header = SP_H): Promise<Statement> =>
    book([["Posiciones cerradas", [header, spRow(p).filter((_c, i) => header.includes(SP_H[i]!))]]]);
  const sap = (fx: string): Promise<Statement> => position({ fx });
  describe.each(["abc", "", "-", "0"])("a EUR instrument whose FX rate at open is %j", (fx) => {
    it.each(METHODS)("[%s] is kept unreadable, never booked at its EUR quote as dollars", async (method) => {
      const parsed = await position({ fx, fxClose: "1.08" });
      expect(unreadableRows(parsed)).toBe(`SAP (DE0007164600) 20250201 [Tipo de cambio de apertura (USD): ${JSON.stringify(fx)}]; SAP (DE0007164600) 20250615 [Tipo de cambio de apertura (USD): ${JSON.stringify(fx)}]`);
      expect(report(parsed, method).capitalGains.disposals).toEqual([]);
    });
  });
  it.each(METHODS)("[%s] control: a readable FX rate values the legs in dollars at eToro's rates, and a rate of 1 keeps the dollar quote", async (method) => {
    const eur = await sap("1.08");
    expect(eur.trades.map((t) => [t.currency, t.tradePrice])).toEqual([["USD", "108"], ["USD", "162"]]);
    expect(nums(report(eur, method))).toEqual(["0.00", "0.00", "0.00", "496.80"]);
    const usd = await sap("1");
    expect(usd.trades.map((t) => [t.currency, t.tradePrice])).toEqual([["USD", "100"], ["USD", "150"]]);
    expect(nums(report(usd, method))).toEqual(["0.00", "0.00", "0.00", "460.00"]);
  });

  // #467 sweep: every instrument whose FX rate was not 1 was booked as EUR, so
  // a pence or HKD quote became a loss 85 or 8 times too large.
  describe.each([
    ["Barclays in pence", { name: "Barclays (BARC.L)", isin: "GB0031348658", units: "100", fx: "0.0127", open: "180", close: "170" }, ["2.286", "2.159"], "-11.68"],
    ["Tencent in HKD", { name: "Tencent (0700.HK)", isin: "KYG875721634", units: "100", fx: "0.128", open: "400", close: "350" }, ["51.2", "44.8"], "-588.80"],
    ["SAP in EUR, 1.08 at open and 1.10 at close", { fx: "1.08", fxClose: "1.10" }, ["108", "165"], "524.40"],
  ] as [string, Position, string[], string][])("%s", (_label, p, prices, gain) => {
    it.each(METHODS)("[%s] is valued in dollars at eToro's FX rates, never at its own quote as euros", async (method) => {
      const parsed = await position(p);
      expect(parsed.trades.map((t) => [t.currency, t.tradePrice])).toEqual([["USD", prices[0]], ["USD", prices[1]]]);
      expect(nums(report(parsed, method))).toEqual(["0.00", "0.00", "0.00", gain]);
    });
  });
  describe.each(["abc", "", "0"])("a non-USD instrument whose FX rate at close is %j", (fxClose) => {
    it.each(METHODS)("[%s] is kept unreadable and named by that cell", async (method) => {
      const parsed = await position({ name: "Barclays (BARC.L)", isin: "GB0031348658", units: "100", fx: "0.0127", fxClose, open: "180", close: "170" });
      expect(unreadableRows(parsed)).toBe(`Barclays (BARC.L) (GB0031348658) 20250201 [Tipo de cambio al cierre (USD): ${JSON.stringify(fxClose)}]; Barclays (BARC.L) (GB0031348658) 20250615 [Tipo de cambio al cierre (USD): ${JSON.stringify(fxClose)}]`);
      expect(report(parsed, method).capitalGains.disposals).toEqual([]);
    });
  });
  it.each(METHODS)("[%s] a non-USD instrument with no FX rate at close column is named; a USD one needs none", async (method) => {
    const noClose = SP_H.filter((h) => h !== "Tipo de cambio al cierre (USD)");
    const parsed = await position({}, noClose);
    expect(unreadableRows(parsed)).toBe("SAP (DE0007164600) 20250201 [FX rate at close (USD): —]; SAP (DE0007164600) 20250615 [FX rate at close (USD): —]");
    expect(report(parsed, method).capitalGains.disposals).toEqual([]);
    expect(nums(report(await position({ fx: "1" }, noClose), method))).toEqual(["0.00", "0.00", "0.00", "460.00"]);
  });

  // The same SAP position in the English export, whose FX columns are "FX rate at open (USD)" and "FX rate at close (USD)".
  const EN_H = ["Position ID", "Action", "Long / Short", "Amount", "Units / Contracts", "Open Date", "Close Date", "Leverage",
    "Profit(USD)", "Profit(EUR)", "FX rate at open (USD)", "FX rate at close (USD)", "Open Rate", "Close Rate", "Type", "ISIN"];
  const sapEn = (fx: string, open = "100", close = "150"): Promise<Statement> => book([["Closed Positions", [EN_H,
    ["1", "SAP", "Long", "1000", "10", "01/02/2025 10:00:00", "15/06/2025 16:00:00", "1", "540", "500", fx, fx, open, close, "Stocks", "DE0007164600"]]]]);
  it.each(METHODS)("[%s] the English FX rate at open is read like the Spanish one, never a EUR gain booked in dollars", async (method) => {
    const es = await sap("1.08");
    const en = await sapEn("1.08");
    expect(en.trades.map((t) => [t.currency, t.tradePrice])).toEqual(es.trades.map((t) => [t.currency, t.tradePrice]));
    expect(nums(report(en, method))).toEqual(nums(report(es, method)));
    // The loss case too: 150 → 100 in EUR is no larger loss in dollars.
    const esLoss = await position({ open: "150", close: "100" });
    expect(nums(report(await sapEn("1.08", "150", "100"), method))).toEqual(nums(report(esLoss, method)));
    // An English FX rate that cannot be read is named like the Spanish one.
    expect(unreadableRows(await sapEn("abc"))).toBe('SAP (DE0007164600) 20250201 [FX rate at open (USD): "abc"]; SAP (DE0007164600) 20250615 [FX rate at open (USD): "abc"]');
  });

  it("a sheet whose needed columns are not recognised is named by an error, in the five locales; a sheet with only a header is not", async () => {
    const cases: [string, string[][], string, string][] = [
      ["Dividends", [["Date of Payment", "Instrument Name", "Net Dividend Received", "ISIN"], ["15/06/2025", "AAPL", "42.50", AAPL]], "Dividends", "Net Dividend Received"],
      ["Dividends", [["Payment Date", "Instrument Name", "Net Dividend Received (USD)", "ISIN"], ["15/06/2025", "AAPL", "42.50", AAPL]], "Dividends", "Date of Payment"],
      ["Account Activity", [["Date", "Transaction Type", "Details", "Amount"], ["15/06/2025", "Interest Payment", "", "42.50"]], "Account Activity", "Type"],
      ["Posiciones cerradas", [["Instrumento", "Unidades"], ["SAP", "10"]], "Posiciones cerradas", "Action"],
    ];
    for (const [sheet, rows, name, columns] of cases) {
      const parsed = await book([[sheet, rows]]);
      expect(parsed.cashTransactions).toEqual([]);
      const emitted = message(parsed, "etoro.columns_not_detected");
      expect([emitted?.severity, emitted?.context]).toEqual(["error", { sheet: name, columns }]);
      expect(emitted?.message).toBe((es as Record<string, string>)["etoro.columns_not_detected"]!.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => emitted?.context?.[k] ?? ""));
      expect(emitted?.hint).toBe((es as Record<string, string>)["etoro.columns_not_detected.hint"]);
      expect((await book([[sheet, [rows[0]!]]])).parserMessages).toBeUndefined();
    }
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
      expect(locale["etoro.columns_not_detected"]).toContain("{{sheet}}");
      expect(locale["etoro.columns_not_detected"]).toContain("{{columns}}");
      expect(locale["etoro.columns_not_detected.hint"]).toBeTruthy();
    }
  });

  it.each(METHODS)("[%s] an undated TotalEnergies dividend is named, not taken for a totals line; a totals line stays skipped", async (method) => {
    const parsed = await book([["Dividends", [DV, ["", "TotalEnergies", "42.50", "7.50", "FR0000120271"], ["", "Total", "42.50", "7.50", ""], ["", "Totales:", "42.50", "7.50", ""]]]]);
    expect(parsed.parserMessages?.map((m) => [m.id, m.context?.rows])).toEqual([["parser.cash_row_undated",
      'Dividends TotalEnergies (FR0000120271) 50.0000 USD [Date: ""]; Withholding Tax TotalEnergies (FR0000120271) -7.5 USD [Date: ""]']]);
    expect(nums(report(parsed, method))).toEqual(["0.00", "0.00", "0.00", "0.00"]);
  });
});

describe("#467 Flatex: a cash leg, income row, currency, Kurs or order number the parser cannot read is named, never booked as a fee, as 0, as euros or a crash", () => {
  // Realistic rate: 1 USD = 0.92 EUR.
  const realRates = (): EcbRateMap => {
    const map: EcbRateMap = new Map();
    for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2025, 11, 31); t += 86_400_000) {
      map.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "0.92"]]));
    }
    return map;
  };
  const KH = "Buchtag;Valuta;BIC / BLZ;IBAN / Kontonummer;Buchungsinformationen;TA-Nr.;Betrag;;Auftraggeberkonto;Konto";
  const drow = (date: string, qty: string, info: string, ta: string, kurs: string, ccy = "EUR", isin = ISIN): string =>
    `1;${date};${date};${isin};XYZ SA;${qty};Stk.;${info};${ta};${kurs};${ccy};***xxx Depot`;
  const krow = (date: string, info: string, ta: string, amount: string, ccy = "EUR"): string =>
    `${date};${date};;;${info};${ta};${amount};${ccy};1;***xxx Cashkonto`;
  const depot = (...rows: string[]): Statement => flatexParser.parse([FX_H, ...rows].join("\n"));
  const konto = (...rows: string[]): Statement => flatexParser.parse([KH, ...rows].join("\n"));
  const merged = (...parts: Statement[]): Statement => {
    const statement = createEmptyStatement();
    for (const part of parts) mergeStatement(statement, part, "Flatex");
    return finalizeMergedStatement(statement);
  };
  const report = (statement: Statement, method: FxMethod): TaxReport =>
    generateTaxReport(statement, realRates(), 2024, reportOptionsForMethod(method));
  const message = (s: Statement, id: string): TaxMessage | undefined => s.parserMessages?.find((m) => m.id === id);
  const gains = (r: TaxReport): string[] =>
    [r.capitalGains.transmissionValue, r.capitalGains.acquisitionValue, r.capitalGains.netGainLoss].map((d) => new Decimal(d).toFixed(2));
  const cash = (r: TaxReport): string[] =>
    [r.dividends.grossIncome, r.doubleTaxation.deduction, r.interest.earned].map((d) => new Decimal(d).toFixed(2));
  const FEE = "flatex.commission.not_recovered";
  const INCOME = "parser.cash_income_amount_unreadable";

  // Buy 10 at 100 € (order 111111), sell 10 at 120 € (order 222222); Flatex
  // charges 5.90 € on each, so the gain is 1194.10 − 1005.90 = 188.20 €.
  const BUY = drow("01.03.2024", "10", `Ausführung ORDER Kauf ${ISIN} 111111`, "9001", "100,00");
  const SELL = drow("03.06.2024", "-10", `Ausführung ORDER Verkauf ${ISIN} 222222`, "9002", "120,00");
  const legBuy = (amount = "-1005,90"): string => krow("01.03.2024", `Ausführung ORDER Kauf ${ISIN} 111111`, "8001", amount);
  const legSell = (amount = "1194,10", ta = "8002", text = `Ausführung ORDER Verkauf ${ISIN} 222222`): string =>
    krow("03.06.2024", text, ta, amount);

  describe("the cash leg of an order", () => {
    it.each(METHODS)("[%s] control: readable legs give each order its 5.90 € fee, with no warning", (method) => {
      const statement = merged(depot(BUY, SELL), konto(legBuy(), legSell()));
      expect(statement.trades.map((t) => t.commission)).toEqual(["-5.9", "-5.9"]);
      expect(statement.parserMessages ?? []).toEqual([]);
      expect(gains(report(statement, method))).toEqual(["1194.10", "1005.90", "188.20"]);
    });

    describe.each(["", "€", "abc"])("a sale leg whose Betrag is %j", (cell) => {
      it.each(METHODS)("[%s] gives the sale no fee (never the whole sale as a fee, never a crash) and names the order", (method) => {
        const statement = merged(depot(BUY, SELL), konto(legBuy(), legSell(cell)));
        expect(statement.trades.map((t) => t.commission)).toEqual(["-5.9", "0"]);
        expect(message(statement, FEE)?.context?.rows).toBe(`222222 ${ISIN} 20240603 [Betrag: ${JSON.stringify(cell)}]`);
        expect(gains(report(statement, method))).toEqual(["1200.00", "1005.90", "194.10"]);
      });
    });

    it.each(METHODS)("[%s] a written 0 on a sale leg is the file's word, but a fee as large as the sale is no fee: 0, named", (method) => {
      const statement = merged(depot(BUY, SELL), konto(legBuy(), legSell("0")));
      expect(statement.trades.map((t) => t.commission)).toEqual(["-5.9", "0"]);
      expect(message(statement, FEE)?.context?.rows).toBe(`222222 ${ISIN} 20240603 [1200 EUR / 0 EUR]`);
      expect(gains(report(statement, method))).toEqual(["1200.00", "1005.90", "194.10"]);
    });

    it.each(METHODS)("[%s] an empty buy leg gives the buy no fee, never a cost of twice the buy", (method) => {
      const statement = merged(depot(BUY, SELL), konto(legBuy(""), legSell()));
      expect(statement.trades.map((t) => t.commission)).toEqual(["0", "-5.9"]);
      expect(message(statement, FEE)?.context?.rows).toBe(`111111 ${ISIN} 20240301 [Betrag: ""]`);
      expect(gains(report(statement, method))).toEqual(["1194.10", "1000.00", "194.10"]);
    });
  });

  describe("an order whose legs and fills differ in number", () => {
    // Order 333333 filled in two parts of 5 at 100 €, each charged 5.90 €.
    const fill = (ta: string): string => drow("01.03.2024", "5", `Ausführung ORDER Kauf ${ISIN} 333333`, ta, "100,00");
    const leg = (ta: string, amount = "-505,90"): string => krow("01.03.2024", `Ausführung ORDER Kauf ${ISIN} 333333`, ta, amount);
    const fills = (): Statement => depot(fill("9101"), fill("9102"), SELL);

    it.each(METHODS)("[%s] controls: one leg per fill, and one combined leg split pro rata, give the same gain", (method) => {
      const each = merged(fills(), konto(leg("8101"), leg("8102"), legSell()));
      expect(each.parserMessages ?? []).toEqual([]);
      expect(gains(report(each, method))).toEqual(["1194.10", "1011.80", "182.30"]);
      const combined = merged(fills(), konto(leg("8101", "-1011,80"), legSell()));
      expect(combined.parserMessages?.map((m) => m.id)).toEqual(["flatex.commission.multi_fill_prorated"]);
      expect(gains(report(combined, method))).toEqual(["1194.10", "1011.80", "182.30"]);
    });

    it.each(METHODS)("[%s] a missing leg makes no fee of half the order: both fills keep 0, the order is named", (method) => {
      const statement = merged(fills(), konto(leg("8101"), legSell()));
      expect(statement.trades.map((t) => t.commission)).toEqual(["0", "0", "-5.9"]);
      expect(statement.parserMessages?.map((m) => [m.id, m.severity, m.context?.rows])).toEqual([
        [FEE, "warning", `333333 ${ISIN} 20240301 [1000 EUR / -505.9 EUR]`],
      ]);
      expect(gains(report(statement, method))).toEqual(["1194.10", "1000.00", "194.10"]);
    });

    it.each(METHODS)("[%s] an extra sale leg makes no fee of the whole sale: the sale keeps 0, the order is named", (method) => {
      const statement = merged(depot(BUY, SELL), konto(legBuy(), legSell(), legSell("1194,10", "8003")));
      expect(statement.trades.map((t) => t.commission)).toEqual(["-5.9", "0"]);
      expect(message(statement, FEE)?.context?.rows).toBe(`222222 ${ISIN} 20240603 [1200 EUR / 2388.2 EUR]`);
      expect(gains(report(statement, method))).toEqual(["1200.00", "1005.90", "194.10"]);
    });

    it.each(METHODS)("[%s] a Storno cancels its leg: the rebooked sale gets its own 5.90 € fee, as in the control", (method) => {
      const storno = legSell("-1194,10", "8003", `Storno Ausführung ORDER Verkauf ${ISIN} 222222`);
      const statement = merged(depot(BUY, SELL), konto(legBuy(), legSell(), storno, legSell("1194,10", "8004")));
      expect(statement.trades.map((t) => t.commission)).toEqual(["-5.9", "-5.9"]);
      expect(message(statement, FEE)).toBeUndefined();
      expect(gains(report(statement, method))).toEqual(["1194.10", "1005.90", "188.20"]);
    });

    // Sweep 2: the leg of a third fill (3 at 100 €) is below the smallest
    // fill, so it passed the limit and became the other fills' fee (317.70 €).
    describe.each([
      ["the Depot export does not list", []],
      ["the Depot export writes with a Nominal of 0", [drow("01.03.2024", "0", `Ausführung ORDER Kauf ${ISIN} 333333`, "9103", "100,00")]],
    ] as [string, string[]][])("a leg of a third fill %s", (_label, third) => {
      it.each(METHODS)("[%s] gives the order no fee and names it: that leg is never the other fills' fee", (method) => {
        const statement = merged(depot(fill("9101"), fill("9102"), ...third, SELL), konto(leg("8101"), leg("8102"), leg("8103", "-305,90"), legSell()));
        expect(statement.trades.map((t) => t.commission)).toEqual(["0", "0", "-5.9"]);
        expect(statement.parserMessages?.map((m) => [m.id, m.severity, m.context?.rows])).toEqual([
          [FEE, "warning", `333333 ${ISIN} 20240301 [1000 EUR / -1317.7 EUR]`],
        ]);
        expect(gains(report(statement, method))).toEqual(["1194.10", "1000.00", "194.10"]);
      });
    });

    it.each(METHODS)("[%s] one fill with the leg of a second fill gives no fee; a Storno and its rebooking still do", (method) => {
      const one = merged(depot(drow("01.03.2024", "10", `Ausführung ORDER Kauf ${ISIN} 333333`, "9101", "100,00"), SELL),
        konto(leg("8101", "-1005,90"), leg("8102"), legSell()));
      expect(one.trades.map((t) => t.commission)).toEqual(["0", "-5.9"]);
      expect(message(one, FEE)?.context?.rows).toBe(`333333 ${ISIN} 20240301 [1000 EUR / -1511.8 EUR]`);
      expect(gains(report(one, method))).toEqual(["1194.10", "1000.00", "194.10"]);
      const storno = leg("8103", "505,90");
      const rebooked = merged(fills(), konto(leg("8101"), leg("8102"), storno, leg("8104"), legSell()));
      expect(rebooked.parserMessages?.map((m) => m.id)).toEqual(["flatex.commission.multi_fill_prorated"]);
      expect(gains(report(rebooked, method))).toEqual(["1194.10", "1011.80", "182.30"]);
    });
  });

  // Round 1 of the merge sweep (#467): a fee was derived from legs and fills
  // that are not the same executions. Flatex writes a fill and its cash leg
  // on the same Buchtag, so the legs of each day must match the fills of
  // that day, and no fill of the order may be a row the parser could not read.
  describe("an order whose legs and fills are not the same executions", () => {
    const BUY_INFO = `Ausführung ORDER Kauf ${ISIN} 333333`;
    const SELL_INFO = `Ausführung ORDER Verkauf ${ISIN} 222222`;
    const fill = (date: string, qty: string, ta: string, kurs = "100,00"): string => drow(date, qty, BUY_INFO, ta, kurs);
    const leg = (date: string, ta: string, amount: string): string => krow(date, BUY_INFO, ta, amount);
    const sell = (qty: string, ta = "9002"): string => drow("03.06.2024", `-${qty}`, SELL_INFO, ta, "120,00");
    const sellLeg = (amount: string, ta = "8002"): string => krow("03.06.2024", SELL_INFO, ta, amount);
    const booked = (s: Statement): string[][] => s.trades.filter((t) => t.quantityUnknown !== true).map((t) => [t.quantity, t.commission]);

    it.each(METHODS)("[%s] a fill the parser cannot read gives the order no fee: its leg never becomes the other fill's fee", (method) => {
      // Order 333333 filled 6 + 4 at 100 €, each charged its share of 5.90 €.
      const control = merged(depot(fill("01.03.2024", "6", "9101"), fill("01.03.2024", "4", "9102"), sell("6")),
        konto(leg("01.03.2024", "8101", "-603,54"), leg("01.03.2024", "8102", "-402,36"), sellLeg("714,10")));
      expect(booked(control)).toEqual([["6", "-3.54"], ["4", "-2.36"], ["-6", "-5.9"]]);
      expect(gains(report(control, method))).toEqual(["714.10", "603.54", "110.56"]);
      const statement = merged(depot(fill("01.03.2024", "6", "9101"), fill("01.03.2024", "4", "9102", "abc"), sell("6")),
        konto(leg("01.03.2024", "8101", "-603,54"), leg("01.03.2024", "8102", "-402,36"), sellLeg("714,10")));
      expect(booked(statement)).toEqual([["6", "0"], ["-6", "-5.9"]]);
      expect(message(statement, FEE)?.context?.rows).toBe(`333333 ${ISIN} 20240301 [600 EUR / -1005.9 EUR]`);
      expect(message(statement, "flatex.commission.multi_fill_prorated")).toBeUndefined();
      expect(gains(report(statement, method))).toEqual(["714.10", "600.00", "114.10"]);
    });

    it.each(METHODS)("[%s] a leg on a day with no fill in the Depot export gives the order no fee", (method) => {
      const control = merged(depot(fill("01.03.2024", "6", "9101"), sell("6")), konto(leg("01.03.2024", "8101", "-603,54"), sellLeg("714,10")));
      expect(gains(report(control, method))).toEqual(["714.10", "603.54", "110.56"]);
      const statement = merged(depot(fill("01.03.2024", "6", "9101"), sell("6")),
        konto(leg("01.03.2024", "8101", "-603,54"), leg("04.03.2024", "8102", "-402,36"), sellLeg("714,10")));
      expect(booked(statement)).toEqual([["6", "0"], ["-6", "-5.9"]]);
      expect(message(statement, FEE)?.context?.rows).toBe(`333333 ${ISIN} 20240301 [600 EUR / -1005.9 EUR]`);
      expect(gains(report(statement, method))).toEqual(["714.10", "600.00", "114.10"]);
    });

    it.each(METHODS)("[%s] one fill and one leg of another day are other executions: no fee, named", (method) => {
      const control = merged(depot(fill("01.03.2024", "4", "9101"), sell("4")), konto(leg("01.03.2024", "8101", "-402,36"), sellLeg("474,10")));
      expect(gains(report(control, method))).toEqual(["474.10", "402.36", "71.74"]);
      const statement = merged(depot(fill("01.03.2024", "4", "9101"), sell("4")), konto(leg("04.03.2024", "8102", "-603,54"), sellLeg("474,10")));
      expect(booked(statement)).toEqual([["4", "0"], ["-4", "-5.9"]]);
      expect(message(statement, FEE)?.context?.rows).toBe(`333333 ${ISIN} 20240301 [400 EUR / -603.54 EUR]`);
      expect(gains(report(statement, method))).toEqual(["474.10", "400.00", "74.10"]);
    });

    describe.each(["xx.03.2024", ""])("a leg whose Buchtag is %j", (cell) => {
      it.each(METHODS)("[%s] cannot be paired with a fill: the order gets no fee and is named by that cell", (method) => {
        // Order 333333 filled 5 on 01.03 and 6 on 04.03, 5.90 € each.
        const fills = (): Statement => depot(fill("01.03.2024", "5", "9101"), fill("04.03.2024", "6", "9102"), sell("11"));
        const control = merged(fills(), konto(leg("01.03.2024", "8101", "-505,90"), leg("04.03.2024", "8102", "-605,90"), sellLeg("1314,10")));
        expect(gains(report(control, method))).toEqual(["1314.10", "1111.80", "202.30"]);
        const statement = merged(fills(), konto(leg(cell, "8101", "-505,90"), leg("04.03.2024", "8102", "-605,90"), sellLeg("1314,10")));
        expect(booked(statement)).toEqual([["5", "0"], ["6", "0"], ["-11", "-5.9"]]);
        expect(message(statement, FEE)?.context?.rows).toBe(`333333 ${ISIN} 20240301 [Buchtag: ${JSON.stringify(cell)}]`);
        expect(gains(report(statement, method))).toEqual(["1314.10", "1100.00", "214.10"]);
      });
    });

    it.each(METHODS)("[%s] one leg for fills of two days could be a missing leg: no fee, named; on one day it is split pro rata", (method) => {
      const twoDays = merged(depot(fill("01.03.2024", "5", "9101"), fill("04.03.2024", "5", "9102"), SELL),
        konto(leg("04.03.2024", "8101", "-1011,80"), legSell()));
      expect(booked(twoDays)).toEqual([["5", "0"], ["5", "0"], ["-10", "-5.9"]]);
      expect(message(twoDays, FEE)?.context?.rows).toBe(`333333 ${ISIN} 20240301 [1000 EUR / -1011.8 EUR]`);
      expect(gains(report(twoDays, method))).toEqual(["1194.10", "1000.00", "194.10"]);
      const oneDay = merged(depot(fill("04.03.2024", "5", "9101"), fill("04.03.2024", "5", "9102"), SELL),
        konto(leg("04.03.2024", "8101", "-1011,80"), legSell()));
      expect(oneDay.parserMessages?.map((m) => m.id)).toEqual(["flatex.commission.multi_fill_prorated"]);
      expect(gains(report(oneDay, method))).toEqual(["1194.10", "1011.80", "182.30"]);
    });

    it.each(METHODS)("[%s] a sale filled twice in one day with one leg missing keeps its proceeds: no fee as large as a fill", (method) => {
      const fills = (): Statement => depot(BUY, sell("4", "9002"), sell("6", "9003"));
      const control = merged(fills(), konto(legBuy(), sellLeg("474,10", "8002"), sellLeg("714,10", "8003")));
      expect(gains(report(control, method))).toEqual(["1188.20", "1005.90", "182.30"]);
      const statement = merged(fills(), konto(legBuy(), sellLeg("714,10", "8003")));
      expect(booked(statement)).toEqual([["10", "-5.9"], ["-4", "0"], ["-6", "0"]]);
      expect(message(statement, FEE)?.context?.rows).toBe(`222222 ${ISIN} 20240603 [1200 EUR / 714.1 EUR]`);
      expect(gains(report(statement, method))).toEqual(["1200.00", "1005.90", "194.10"]);
    });

    it.each(METHODS)("[%s] a leg with no TA-Nr. uploaded twice makes no fee as large as a fill", (method) => {
      const fills = (): Statement => depot(fill("01.03.2024", "6", "9101"), fill("01.03.2024", "4", "9102"), sell("6"));
      const legs = [leg("01.03.2024", "", "-603,54"), leg("01.03.2024", "", "-402,36"), sellLeg("714,10")];
      expect(gains(report(merged(fills(), konto(...legs)), method))).toEqual(["714.10", "603.54", "110.56"]);
      const statement = merged(fills(), konto(...legs), konto(leg("01.03.2024", "", "-402,36")));
      expect(booked(statement)).toEqual([["6", "0"], ["4", "0"], ["-6", "-5.9"]]);
      expect(message(statement, FEE)?.context?.rows).toBe(`333333 ${ISIN} 20240301 [1000 EUR / -1408.26 EUR]`);
      expect(gains(report(statement, method))).toEqual(["714.10", "600.00", "114.10"]);
    });
  });

  it.each(METHODS)("[%s] a row with no order number gets no key from the digits of its ISIN: two orders never pool their legs", (method) => {
    const row = (date: string, qty: string, side: string, ta: string, kurs: string, key: string): string =>
      drow(date, qty, `Ausführung ORDER ${side} ${AAPL}${key}`, ta, kurs, "EUR", AAPL);
    const leg = (key: string): string => krow("01.03.2024", `Ausführung ORDER Kauf ${AAPL}${key}`, "8001", "-1005,90");
    const withKeys = merged(depot(row("01.03.2024", "10", "Kauf", "9001", "100,00", " 111111"), row("03.06.2024", "-10", "Verkauf", "9002", "120,00", " 222222")), konto(leg(" 111111")));
    expect(gains(report(withKeys, method))).toEqual(["1200.00", "1005.90", "194.10"]);
    const noKeys = merged(depot(row("01.03.2024", "10", "Kauf", "9001", "100,00", ""), row("03.06.2024", "-10", "Verkauf", "9002", "120,00", "")), konto(leg("")));
    expect(noKeys.trades.map((t) => t.commission)).toEqual(["0", "0"]);
    // With no order number neither file can be joined: each fill keeps a fee of 0, which can only raise the tax.
    expect(noKeys.parserMessages ?? []).toEqual([]);
    expect(gains(report(noKeys, method))).toEqual(["1200.00", "1000.00", "200.00"]);
  });

  describe("a dividend, withholding or interest row", () => {
    const div = (amount: string, ccy = "EUR"): string => krow("15.05.2024", `Dividendenzahlung ${AAPL}`, "7001", amount, ccy);
    const tax = (amount = "-1,50"): string => krow("15.05.2024", `Quellensteuer ${AAPL}`, "7002", amount);

    it.each(METHODS)("[%s] control: a readable dividend and withholding are booked, and a written 0 stays a zero with no warning", (method) => {
      expect(cash(report(merged(konto(div("10,00"), tax())), method))).toEqual(["10.00", "1.50", "0.00"]);
      const zero = konto(div("0"), tax("0"));
      expect(zero.cashTransactions.map((c) => c.amount)).toEqual(["0", "0"]);
      expect(message(zero, INCOME)).toBeUndefined();
    });

    describe.each(["", "€", "abc"])("a dividend Betrag of %j", (cell) => {
      it.each(METHODS)("[%s] books neither the dividend nor its withholding, the report runs, and both are named", (method) => {
        const parsed = konto(div(cell), tax());
        expect(parsed.cashTransactions).toEqual([]);
        expect(message(parsed, INCOME)?.context?.rows).toBe(
          `Dividendenzahlung ${AAPL} EUR 20240515 (Quellensteuer ${AAPL} -1.50 EUR) [Betrag: ${JSON.stringify(cell)}]`);
        expect(cash(report(merged(parsed), method))).toEqual(["0.00", "0.00", "0.00"]);
      });
    });

    it.each(METHODS)("[%s] a withholding Betrag of \"abc\" is named, not booked: the dividend stays, with no deduction", (method) => {
      const parsed = konto(div("10,00"), tax("abc"));
      expect(parsed.cashTransactions.map((c) => `${c.type} ${c.amount}`)).toEqual(["Dividends 10.00"]);
      expect(message(parsed, INCOME)?.context?.rows).toBe(`Quellensteuer ${AAPL} EUR 20240515 [Betrag: "abc"]`);
      expect(cash(report(merged(parsed), method))).toEqual(["10.00", "0.00", "0.00"]);
    });

    it.each(METHODS)("[%s] a dividend with an empty currency cell is named, never booked as euros", (method) => {
      expect(cash(report(merged(konto(div("10,00", "USD"))), method))).toEqual(["9.20", "0.00", "0.00"]);
      const parsed = konto(div("10,00", ""));
      expect(parsed.cashTransactions).toEqual([]);
      expect(message(parsed, INCOME)?.context?.rows).toBe(`Dividendenzahlung ${AAPL} 20240515 [Betrag, divisa: ""]`);
      expect(cash(report(merged(parsed), method))).toEqual(["0.00", "0.00", "0.00"]);
    });

    it.each(METHODS)("[%s] interest and coupons received are interest (casilla 0027); interest charged stays out", (method) => {
      for (const text of ["Habenzinsen 01.01.2024 - 31.03.2024", "Zinsen", "Zinszahlung DE0001102341"]) {
        const parsed = konto(krow("31.03.2024", text, "7101", "12,34"));
        expect(parsed.parserMessages).toBeUndefined();
        expect(cash(report(merged(parsed), method))).toEqual(["0.00", "0.00", "12.34"]);
      }
      expect(konto(krow("31.03.2024", "Sollzinsen 01.01.2024 - 31.03.2024", "7104", "-3,00")).cashTransactions).toEqual([]);
      const unreadable = konto(krow("31.03.2024", "Habenzinsen 01.01.2024 - 31.03.2024", "7105", "abc"));
      expect(unreadable.cashTransactions).toEqual([]);
      expect(message(unreadable, INCOME)?.context?.rows).toBe('Habenzinsen 01.01.2024 - 31.03.2024 EUR 20240331 [Betrag: "abc"]');
      expect(cash(report(merged(unreadable), method))).toEqual(["0.00", "0.00", "0.00"]);
    });
  });

  describe("a Depotumsätze trade", () => {
    it.each(METHODS)("[%s] with an empty currency cell is an unreadable row, never a trade in euros", (method) => {
      const usd = merged(depot(BUY.replace(";EUR;", ";USD;"), SELL.replace(";EUR;", ";USD;")));
      expect(gains(report(usd, method))).toEqual(["1104.00", "920.00", "184.00"]);
      const parsed = depot(BUY.replace(";EUR;", ";;"), SELL.replace(";EUR;", ";;"));
      expect(parsed.trades.map((t) => [t.quantity, t.quantityUnknown])).toEqual([["0", true], ["0", true]]);
      expect(unreadableRows(parsed)).toBe(`XYZ SA (${ISIN}) 20240301 [Kurs, divisa: ""]; XYZ SA (${ISIN}) 20240603 [Kurs, divisa: ""]`);
      expect(gains(report(merged(parsed), method))).toEqual(["0.00", "0.00", "0.00"]);
    });

    it.each(METHODS)("[%s] with a negative Kurs is an unreadable row, never negative proceeds", (method) => {
      const parsed = depot(BUY, SELL.replace(";120,00;", ";-120,00;"));
      expect(parsed.trades.map((t) => [t.buySell, t.quantity, t.quantityUnknown ?? false])).toEqual([["BUY", "10", false], ["SELL", "0", true]]);
      expect(unreadableRows(parsed)).toBe(`XYZ SA (${ISIN}) 20240603 [Kurs: "-120,00"]`);
      expect(gains(report(merged(parsed), method))).toEqual(["0.00", "0.00", "0.00"]);
    });
  });

  it("the order warning reads in the five locales", () => {
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
      expect(locale[FEE]).toContain("{{count}}");
      expect(locale[FEE]).toContain("{{rows}}");
      expect(locale[`${FEE}.hint`]).toBeTruthy();
    }
    expect(isTranslationKey(FEE)).toBe(true);
  });
});

// Round 10 (Freedom24 sweep, #467): the price `p` went into tradePrice raw (a
// missing one became "0", so a 270.60 € gain became a 1654.40 € loss; "" or
// "abc" stopped the report); a missing curr_c was read as USD (a euro stock
// or dividend converted at the dollar rate); every cash_flows row was dropped
// with no word; a dividend description that is not text stopped the report.
describe("#467 Freedom24 sweep: price, currency, cash flows and description", () => {
  const F24_BUY = { date: "2024-03-15 09:30:00", ticker: "ACME.US", isin: "US0000000001", operation: "buy", p: "150.00", q: "10", curr_c: "USD", commission: "2.00", amount: "-1502.00", exchange: "NYSE" };
  const F24_SELL = { ...F24_BUY, date: "2024-09-20 14:00:00", operation: "sell", p: "175.00", amount: "1748.00" };
  const F24_DIV = { date: "2024-06-15 00:00:00", ticker: "ACME.US", isin: "US0000000001", type_id: "dividend", amount: "100.00", tax_amount: "15.00", curr_c: "USD", description: "Q2 Dividend" };
  const f24 = (sections: { trades?: unknown[]; ca?: unknown[]; flows?: unknown[] }): Statement => freedom24Parser.parse(JSON.stringify({
    report: { trades: { detailed: sections.trades ?? [] }, corporate_actions: { detailed: sections.ca ?? [] }, cash_flows: { detailed: sections.flows ?? [] } },
  }));
  const gains = (r: TaxReport): string[] => [r.capitalGains.transmissionValue.toFixed(2), r.capitalGains.netGainLoss.toFixed(2)];

  it.each(METHODS)("[%s] control: buy 10 at 150 USD, sell 10 at 175 USD is a 270.60 € gain", (method) => {
    const parsed = f24({ trades: [F24_BUY, F24_SELL] });
    expect(parsed.parserMessages ?? []).toEqual([]);
    expect(gains(run([[parsed, "Freedom24"]], 2024, method))).toEqual(["1922.80", "270.60"]);
  });

  const badPrices: [string, unknown, string][] = [
    ["missing", undefined, "p: —"], ["empty", "", 'p: ""'], ["text", "abc", 'p: "abc"'], ["decimal comma", "175,00", 'p: "175,00"'],
    ["null", null, "p: null"], ["negative", "-175", 'p: "-175"'], ["NaN", "NaN", 'p: "NaN"'], ["Infinity", "Infinity", 'p: "Infinity"'], ["an object", {}, "p: {}"],
  ];
  describe.each(badPrices)("a sale whose price is %s", (_label, p, cell) => {
    it.each(METHODS)("[%s] is an unreadable row named by p: no sale at that price, no crash", (method) => {
      const parsed = f24({ trades: [F24_BUY, { ...F24_SELL, p }] });
      expect(parsed.trades.map((t) => [t.buySell, t.quantity, t.quantityUnknown ?? false])).toEqual([["BUY", "10", false], ["SELL", "0", true]]);
      expect(unreadableRows(parsed)).toBe(`ACME (US0000000001) 20240920 [${cell}]`);
      const r = run([[parsed, "Freedom24"]], 2024, method);
      expect(r.capitalGains.disposals).toEqual([]);
      expect(gains(r)).toEqual(["0.00", "0.00"]);
    });
  });

  it.each(METHODS)("[%s] a buy with no price is an unreadable row, never a lot that cost 0", (method) => {
    const parsed = f24({ trades: [{ ...F24_BUY, p: undefined }, F24_SELL] });
    expect(unreadableRows(parsed)).toBe("ACME (US0000000001) 20240315 [p: —]");
    expect(parsed.trades.map((t) => [t.buySell, t.quantity])).toEqual([["BUY", "0"], ["SELL", "-10"]]);
    expect(() => run([[parsed, "Freedom24"]], 2024, method)).not.toThrow();
  });

  it.each(METHODS)("[%s] a sale with a written zero price is a corporate action not applied, never a sale for 0", (method) => {
    for (const p of ["0", "0.00", 0]) {
      const parsed = f24({ trades: [F24_BUY, { ...F24_SELL, p }] });
      expect(parsed.parserMessages?.find((m) => m.id === "parser.corporate_action_not_applied")?.context?.rows)
        .toBe(`ACME (US0000000001) 20240920 [p ${String(p)}: 10]`);
      expect(unreadableRows(parsed)).toBeUndefined();
      const r = run([[parsed, "Freedom24"]], 2024, method);
      expect(r.capitalGains.disposals).toEqual([]);
    }
  });

  it("a readable price keeps the file's text, a number price is read too", () => {
    expect(f24({ trades: [F24_BUY, F24_SELL] }).trades.map((t) => t.tradePrice)).toEqual(["150.00", "175.00"]);
    expect(f24({ trades: [{ ...F24_BUY, p: 150 }, { ...F24_SELL, p: " 175 " }] }).trades.map((t) => t.tradePrice)).toEqual(["150", "175"]);
  });

  const SAN_BUY = { ...F24_BUY, ticker: "SAN.MC", isin: "ES0113900J37", exchange: "BME" };
  const SAN_SELL = { ...F24_SELL, ticker: "SAN.MC", isin: "ES0113900J37", exchange: "BME" };
  it.each(METHODS)("[%s] a trade with no readable curr_c is an unreadable row, never a trade in dollars", (method) => {
    expect(gains(run([[f24({ trades: [{ ...SAN_BUY, curr_c: "EUR" }, { ...SAN_SELL, curr_c: "EUR" }] }), "Freedom24"]], 2024, method))).toEqual(["1748.00", "246.00"]);
    for (const [curr, cell] of [[undefined, "curr_c: —"], ["", 'curr_c: ""'], [null, "curr_c: null"], [978, "curr_c: 978"], ["euro", 'curr_c: "euro"']] as const) {
      const parsed = f24({ trades: [{ ...SAN_BUY, curr_c: curr }, { ...SAN_SELL, curr_c: curr }] });
      expect(unreadableRows(parsed)).toBe(`SAN (ES0113900J37) 20240315 [${cell}]; SAN (ES0113900J37) 20240920 [${cell}]`);
      expect(gains(run([[parsed, "Freedom24"]], 2024, method))).toEqual(["0.00", "0.00"]);
    }
  });

  it.each(METHODS)("[%s] a curr_c with spaces or in lower case is read: the 270.60 € gain", (method) => {
    for (const curr of [" USD", "usd", "Usd "]) {
      const parsed = f24({ trades: [{ ...F24_BUY, curr_c: curr }, { ...F24_SELL, curr_c: curr }] });
      expect(parsed.parserMessages ?? []).toEqual([]);
      expect(parsed.trades.map((t) => t.currency)).toEqual(["USD", "USD"]);
      expect(gains(run([[parsed, "Freedom24"]], 2024, method))).toEqual(["1922.80", "270.60"]);
    }
  });

  it.each(METHODS)("[%s] a dividend with no readable curr_c is not booked and is named, never read as dollars", (method) => {
    const SAP = { ...F24_DIV, ticker: "SAP.DE", isin: "DE0007164600", tax_amount: "26.38" };
    expect(run([[f24({ ca: [{ ...SAP, curr_c: "EUR" }] }), "Freedom24"]], 2024, method).dividends.grossIncome.toFixed(2)).toBe("100.00");
    expect(run([[f24({ ca: [{ ...SAP, curr_c: " eur" }] }), "Freedom24"]], 2024, method).dividends.grossIncome.toFixed(2)).toBe("100.00");
    const parsed = f24({ ca: [{ ...SAP, curr_c: undefined }, { ...SAP, curr_c: "", amount: "x", date: "2024-06-16 00:00:00" }, { ...SAP, curr_c: null, tax_amount: undefined, date: "2024-06-17 00:00:00" }] });
    expect(parsed.cashTransactions).toEqual([]);
    expect(messageRows(parsed, "parser.cash_income_amount_unreadable")).toBe([
      'dividend SAP (DE0007164600) 20240615 (tax_amount 26.38) [amount: "100.00", curr_c: —]',
      'dividend SAP (DE0007164600) 20240616 (tax_amount 26.38) [amount: "x", curr_c: ""]',
      'dividend SAP (DE0007164600) 20240617 [amount: "100.00", curr_c: null]',
    ].join("; "));
    expect(messageRows(parsed, "freedom24.dividend_amount_unreadable")).toBeUndefined();
    const r = run([[parsed, "Freedom24"]], 2024, method);
    expect(r.dividends.grossIncome.toFixed(2)).toBe("0.00");
    expect(r.doubleTaxation.deduction.toFixed(2)).toBe("0.00");
  });

  it("a dividend with no security and no curr_c is named with its curr_c cell", () => {
    const parsed = f24({ ca: [{ ...F24_DIV, ticker: "", isin: "", curr_c: undefined }] });
    expect(messageRows(parsed, "parser.cash_row_unidentified")).toBe("dividend 100.00 [curr_c: —] (tax_amount 15.00) 20240615");
  });

  it.each(METHODS)("[%s] a dividend description that is not text gets the default one, never a crash", (method) => {
    for (const description of [123, {}, [], true, "  "]) {
      const parsed = f24({ ca: [{ ...F24_DIV, description }] });
      expect(parsed.cashTransactions[0]!.description).toBe("US Dividend - ACME.US");
      expect(run([[parsed, "Freedom24"]], 2024, method).dividends.grossIncome.toFixed(2)).toBe("110.00");
    }
    expect(f24({ ca: [{ ...F24_DIV, description: " Q2 Dividend " }] }).cashTransactions[0]!.description).toBe("Q2 Dividend");
  });

  it.each(METHODS)("[%s] a cash_flows row that is not a deposit or a withdrawal is named, never dropped with no word", (method) => {
    const parsed = f24({ trades: [F24_BUY, F24_SELL], flows: [
      { date: "2024-06-15 00:00:00", type_id: "interest", amount: "50.00", curr_c: "USD" },
      { date: "2024-06-16 00:00:00", type_id: "dividend", ticker: "ACME.US", amount: 50, curr_c: "usd" },
      { date: "2024-06-17 00:00:00", type_id: "commission", amount: "-5.00", curr_c: "USD" },
      { date: "2024-01-02 00:00:00", type_id: "card_deposit", amount: "5000", curr_c: "EUR" },
      { date: "2024-12-02 00:00:00", type_id: "withdrawal", amount: "-100", curr_c: "EUR" },
      { date: "2024-12-03 00:00:00", type_id: "fee", amount: "0", curr_c: "EUR" },
      { type: "coupon", amount: "7" },
      null,
    ] });
    const warning = parsed.parserMessages?.find((m) => m.id === "freedom24.cash_flow_not_read");
    expect(warning?.context).toEqual({ count: "5", rows: "interest 50.00 USD 20240615; dividend 50 USD 20240616; commission -5.00 USD 20240617; coupon 7 — —; — — — —" });
    const r = run([[parsed, "Freedom24"]], 2024, method);
    expect(r.messages.find((m) => m.id === "freedom24.cash_flow_not_read")?.context?.rows).toBe(warning?.context?.rows);
    expect(gains(r)).toEqual(["1922.80", "270.60"]);
    expect(r.dividends.grossIncome.toFixed(2)).toBe("0.00");
  });

  it("control: deposits, withdrawals, written zeros and an empty cash_flows give no warning", () => {
    expect(f24({ flows: [{ type_id: "deposit", amount: "100" }, { type_id: "Withdrawal", amount: "-100" }, { type_id: "fee", amount: 0 }] }).parserMessages).toBeUndefined();
    expect(f24({}).parserMessages).toBeUndefined();
    expect(freedom24Parser.parse(JSON.stringify({ trades: { detailed: [] }, cash_flows: { detailed: "x" } })).parserMessages).toBeUndefined();
  });

  it("the cash-flows warning is the es locale and exists in the five locales", () => {
    const parsed = f24({ flows: [{ date: "2024-06-15 00:00:00", type_id: "interest", amount: "50.00", curr_c: "USD" }] });
    const m = parsed.parserMessages!.find((x) => x.id === "freedom24.cash_flow_not_read")!;
    const fill = (text: string): string => text.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => m.context?.[k] ?? "");
    expect(m.message).toBe(fill((es as Record<string, string>)["freedom24.cash_flow_not_read"]!));
    expect(m.hint).toBe((es as Record<string, string>)["freedom24.cash_flow_not_read.hint"]);
    expect(isTranslationKey("freedom24.cash_flow_not_read") && isTranslationKey("freedom24.cash_flow_not_read.hint")).toBe(true);
    for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
      expect(locale["freedom24.cash_flow_not_read"]).toContain("{{rows}}");
      expect(locale["freedom24.cash_flow_not_read"]).toContain("cash_flows");
      expect(locale["freedom24.cash_flow_not_read.hint"]).toContain("Renta Web");
    }
  });
});

// Round 11 (Freedom24 sweep 2, #467): the tax_amount of a reversed dividend
// was booked as a second withholding (a reversed Spanish dividend kept 38 €
// in box 0597 on 0 € of income); a cash_flows type that only contains
// "deposit" or "withdraw" (deposit interest) was dropped with no word; a
// trade's own amount that contradicts p × q (an option, a bond priced in %,
// a price or commission of 1e400) was ignored; q was read with the decimal
// comma guess, so "1,000" became 1 share.
describe("#467 Freedom24 sweep 2: reversal withholding, cash-flow types, amount against p × q and quantity", () => {
  const F24_BUY = { date: "2024-03-15 09:30:00", ticker: "ACME.US", isin: "US0000000001", operation: "buy", p: "150.00", q: "10", curr_c: "USD", commission: "2.00", amount: "-1502.00", exchange: "NYSE" };
  const F24_SELL = { ...F24_BUY, date: "2024-09-20 14:00:00", operation: "sell", p: "175.00", amount: "1748.00" };
  const SAN_DIV = { date: "2024-06-15 00:00:00", ticker: "SAN.MC", isin: "ES0113900J37", type_id: "dividend", amount: "100.00", tax_amount: "19.00", curr_c: "EUR", description: "SAN div" };
  const SAN_REV = { ...SAN_DIV, date: "2024-06-20 00:00:00", amount: "-100.00" };
  const f24 = (sections: { trades?: unknown[]; ca?: unknown[]; flows?: unknown[] }): Statement => freedom24Parser.parse(JSON.stringify({
    report: { trades: { detailed: sections.trades ?? [] }, corporate_actions: { detailed: sections.ca ?? [] }, cash_flows: { detailed: sections.flows ?? [] } },
  }));
  const gains = (r: TaxReport): string[] => [r.capitalGains.transmissionValue.toFixed(2), r.capitalGains.netGainLoss.toFixed(2)];
  const spanish = (r: TaxReport): string[] => [r.dividends.grossIncome.toFixed(2), r.dividends.spanishWithholding.toFixed(2)];

  it.each(METHODS)("[%s] control: a Spanish dividend of 100 € with 19 € withheld", (method) => {
    const parsed = f24({ ca: [SAN_DIV] });
    expect(parsed.parserMessages).toBeUndefined();
    expect(spanish(run([[parsed, "Freedom24"]], 2024, method))).toEqual(["100.00", "19.00"]);
  });

  it.each(METHODS)("[%s] a reversed dividend refunds its tax_amount, of either sign: box 0597 is 0, never 38", (method) => {
    for (const tax of ["19.00", "-19.00", 19, -19]) {
      const parsed = f24({ ca: [SAN_DIV, { ...SAN_REV, tax_amount: tax }] });
      expect(parsed.cashTransactions.map((c) => [c.type, c.amount])).toEqual([
        ["Dividends", "100.00"], ["Withholding Tax", "-19"], ["Dividends", "-100.00"], ["Withholding Tax", "19"],
      ]);
      expect(parsed.parserMessages).toBeUndefined();
      expect(spanish(run([[parsed, "Freedom24"]], 2024, method))).toEqual(["0.00", "0.00"]);
    }
  });

  it.each(METHODS)("[%s] a reversal with a written zero tax_amount refunds no withholding: the file's word", (method) => {
    expect(spanish(run([[f24({ ca: [SAN_DIV, { ...SAN_REV, tax_amount: "0" }] }), "Freedom24"]], 2024, method))).toEqual(["0.00", "19.00"]);
  });

  it.each(METHODS)("[%s] a positive dividend books its tax_amount as withheld, of either sign", (method) => {
    expect(spanish(run([[f24({ ca: [{ ...SAN_DIV, tax_amount: "-19.00" }] }), "Freedom24"]], 2024, method))).toEqual(["100.00", "19.00"]);
  });

  it.each(METHODS)("[%s] a cash_flows type that only contains deposit or withdraw is named, never dropped", (method) => {
    const parsed = f24({ trades: [F24_BUY, F24_SELL], flows: [
      { date: "2024-05-01", type_id: "deposit_interest", amount: "12.00", curr_c: "EUR" },
      { date: "2024-05-02", type: "Interest on deposit", amount: "12.00", curr_c: "EUR" },
      { date: "2024-05-03", type_id: "withdrawal_commission", amount: "-5.00", curr_c: "EUR" },
      { date: "2024-05-04", type_id: "deposit", type: "dividend", amount: "12.00", curr_c: "EUR" },
      { date: "2024-05-05", type_id: "depositInterest", amount: "3.00", curr_c: "EUR" },
      { date: "2024-01-02", type_id: "deposit", amount: "5000", curr_c: "EUR" },
      { date: "2024-01-03", type_id: "card_deposit", amount: "100", curr_c: "EUR" },
      { date: "2024-01-04", type: "Bank withdrawal", amount: "-100", curr_c: "EUR" },
      { date: "2024-01-05", type_id: "WITHDRAWALS", type: "withdrawal", amount: "-100", curr_c: "EUR" },
    ] });
    const rows = "deposit_interest 12.00 EUR 20240501; Interest on deposit 12.00 EUR 20240502; withdrawal_commission -5.00 EUR 20240503; deposit (dividend) 12.00 EUR 20240504; depositInterest 3.00 EUR 20240505";
    expect(messageRows(parsed, "freedom24.cash_flow_not_read")).toBe(rows);
    const r = run([[parsed, "Freedom24"]], 2024, method);
    expect(r.messages.find((m) => m.id === "freedom24.cash_flow_not_read")?.context?.rows).toBe(rows);
    expect(gains(r)).toEqual(["1922.80", "270.60"]);
  });

  it.each(METHODS)("[%s] control: the trade's amount equals p × q with or without its commission, so it is booked", (method) => {
    for (const [buy, sell] of [["-1502.00", "1748.00"], ["-1500", "1750"], [-1502, 1748]] as const) {
      const parsed = f24({ trades: [{ ...F24_BUY, amount: buy }, { ...F24_SELL, amount: sell }] });
      expect(parsed.parserMessages).toBeUndefined();
      expect(gains(run([[parsed, "Freedom24"]], 2024, method))).toEqual(["1922.80", "270.60"]);
    }
    for (const amount of [undefined, null, "", "n/a"]) {
      const parsed = f24({ trades: [{ ...F24_BUY, amount }, { ...F24_SELL, amount }] });
      expect(parsed.parserMessages).toBeUndefined();
      expect(gains(run([[parsed, "Freedom24"]], 2024, method))).toEqual(["1922.80", "270.60"]);
    }
  });

  const contradictions: [string, Record<string, unknown>, Record<string, unknown>, string, string][] = [
    ["an option: q 10 at 1.50 per share, amount × 100", { p: "1.50", amount: "-1502.00" }, { p: "1.75", amount: "1748.00" },
      'q: "10", p: "1.50", commission: "2.00", amount: "-1502.00"', 'q: "10", p: "1.75", commission: "2.00", amount: "1748.00"'],
    ["a bond with p in % of face, amount × 10", { p: "150.00", amount: "-15002.00" }, { p: "175.00", amount: "17498.00" },
      'q: "10", p: "150.00", commission: "2.00", amount: "-15002.00"', 'q: "10", p: "175.00", commission: "2.00", amount: "17498.00"'],
    ["a price of 1e400", { p: "1e400" }, {}, 'q: "10", p: "1e400", commission: "2.00", amount: "-1502.00"', ""],
    ["a commission of 1e400", { commission: "1e400" }, {}, 'q: "10", p: "150.00", commission: "1e400", amount: "-1502.00"', ""],
  ];
  describe.each(contradictions)("a trade whose amount contradicts p × q: %s", (_label, buy, sell, buyCell, sellCell) => {
    it.each(METHODS)("[%s] is an unreadable row named by q, p, commission and amount, never booked at p × q", (method) => {
      const parsed = f24({ trades: [{ ...F24_BUY, ...buy }, { ...F24_SELL, ...sell }] });
      const named = [`ACME (US0000000001) 20240315 [${buyCell}]`, ...(sellCell ? [`ACME (US0000000001) 20240920 [${sellCell}]`] : [])];
      expect(unreadableRows(parsed)).toBe(named.join("; "));
      expect(parsed.parserMessages?.find((m) => m.id === "parser.trade_row_unreadable")?.hint).toContain("no cuadra con las demás celdas de la fila");
      const r = run([[parsed, "Freedom24"]], 2024, method);
      expect(r.messages.some((m) => m.id === "parser.trade_row_unreadable")).toBe(true);
      expect(r.messages.some((m) => m.id === "report.non_finite_total")).toBe(false);
      if (sellCell) expect(gains(r)).toEqual(["0.00", "0.00"]);
      else expect(r.capitalGains.acquisitionValue.abs().lessThan(1e6)).toBe(true);
    });
  });

  it.each(METHODS)("[%s] control: q 1000 is booked as 1000 shares", (method) => {
    const parsed = f24({ trades: [{ ...F24_BUY, q: "1000", amount: "-150002.00" }, { ...F24_SELL, q: "1000", amount: "174998.00" }] });
    expect(parsed.parserMessages).toBeUndefined();
    expect(gains(run([[parsed, "Freedom24"]], 2024, method))).toEqual(["192497.80", "27495.60"]);
  });

  it.each(METHODS)("[%s] a q with a comma is a trade of unknown quantity, never 1 or 1.5 shares", (method) => {
    for (const q of ["1,000", "1,5"]) {
      const parsed = f24({ trades: [{ ...F24_BUY, q: "1000", amount: undefined }, { ...F24_SELL, q, amount: undefined }] });
      expect(parsed.trades.map((t) => [t.buySell, t.quantity, t.quantityUnknown ?? false])).toEqual([["BUY", "1000", false], ["SELL", "0", true]]);
      expect(parsed.parserMessages?.map((m) => m.id)).toEqual(["parser.trade_quantity_unknown"]);
      expect(run([[parsed, "Freedom24"]], 2024, method).capitalGains.disposals).toEqual([]);
    }
  });
});

describe("#467 Kraken sweep: price, coin codes, slash pairs, ledger trades and airdrops", () => {
  const KR_H = `"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers"`;
  const KR_H_NOPRICE = `"txid","ordertxid","pair","time","type","ordertype","cost","fee","vol","margin","misc","ledgers"`;
  const kraken = (...rows: string[]): Statement => krakenParser.parse([KR_H, ...rows].join("\n"));
  const krBuy = `"T1","O1","XBTEUR","2024-03-15 10:30:00","buy","limit","30000.00","3000.00","0","0.1","0.0","","L1"`;
  const krSell = (price: string, cost = "9000.00", pair = "XBTEUR"): string =>
    `"T2","O2","${pair}","2025-03-01 10:00:00","sell","market","${price}","${cost}","0","0.1","0.0","","L2"`;
  const manual = (coins: Record<string, string>): EcbRateMap => {
    const map: EcbRateMap = new Map();
    for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86_400_000) map.set(new Date(t).toISOString().slice(0, 10), new Map(Object.entries(coins)));
    return map;
  };
  const runWith = (parts: [Statement, string][], year: number, method: FxMethod, manualRates: EcbRateMap): TaxReport => {
    const statement = createEmptyStatement();
    for (const [part, broker] of parts) mergeStatement(statement, part, broker);
    return generateTaxReport(finalizeMergedStatement(statement), rates(), year, { ...reportOptionsForMethod(method), manualRates });
  };
  const net = (r: TaxReport): string => r.capitalGains.netGainLoss.toFixed(2);

  describe("a trade whose price cannot be read", () => {
    // BTC bought for 3000 € and sold for 9000 €: a 6000 € gain. FIFO values a
    // trade at price × vol, so an unreadable price crashed the report ("abc",
    // "-") or booked the sale for 0 € ("", "€"): a 3000 € loss.
    it.each(METHODS)("[%s] control: price 90000.00 gains 6000 €", (method) => {
      expect(net(run([[kraken(krBuy, krSell("90000.00")), "Kraken"]], 2025, method))).toBe("6000.00");
    });

    describe.each(["abc", "-", "", "€", "NaN", "-90000.00"])("price %j with a readable cost", (price) => {
      it.each(METHODS)("[%s] the sale is priced cost ÷ vol: the 6000 € gain, no crash", (method) => {
        const parsed = kraken(krBuy, krSell(price));
        expect(parsed.trades.map((t) => [t.buySell, t.quantity, t.tradePrice])).toEqual([["BUY", "0.1", "30000.00"], ["SELL", "-0.1", "90000"]]);
        expect(parsed.parserMessages).toBeUndefined();
        const r = run([[parsed, "Kraken"]], 2025, method);
        expect([net(r), r.capitalGains.transmissionValue.toFixed(2)]).toEqual(["6000.00", "9000.00"]);
      });
    });

    it.each(METHODS)("[%s] a buy whose price cannot be read is priced cost ÷ vol, never a lot that cost 0", (method) => {
      const parsed = kraken(krBuy.replace('"30000.00"', '"abc"'), krSell("90000.00"));
      expect(parsed.trades[0]!.tradePrice).toBe("30000");
      expect(net(run([[parsed, "Kraken"]], 2025, method))).toBe("6000.00");
    });

    it.each(METHODS)("[%s] a file with no price column is priced cost ÷ vol", (method) => {
      const parsed = krakenParser.parse([KR_H_NOPRICE,
        `"T1","O1","XBTEUR","2024-03-15 10:30:00","buy","limit","3000.00","0","0.1","0.0","",""`,
        `"T2","O2","XBTEUR","2025-03-01 10:00:00","sell","market","9000.00","0","0.1","0.0","",""`].join("\n"));
      expect(parsed.trades.map((t) => t.tradePrice)).toEqual(["30000", "90000"]);
      expect(net(run([[parsed, "Kraken"]], 2025, method))).toBe("6000.00");
    });

    describe.each([["abc", "abc", 'BTC 20250301 [price: "abc"]'], ["", "", 'BTC 20250301 [price: ""]'], ["-", "x", 'BTC 20250301 [price: "-"]']])("price %j and cost %j", (price, cost, rows) => {
      it.each(METHODS)("[%s] the sale books nothing and is named by its price cell", (method) => {
        const parsed = kraken(krBuy, krSell(price, cost));
        expect(unreadableRows(parsed)).toBe(rows);
        expect(parsed.trades[1]!.quantityUnknown).toBe(true);
        const r = run([[parsed, "Kraken"]], 2025, method);
        expect(r.capitalGains.disposals).toEqual([]);
        expect(r.messages.find((m) => m.id === "parser.trade_row_unreadable")?.context?.rows).toBe(rows);
      });
    });

    it("a written zero price stays the file's word", () => {
      expect(kraken(krBuy, krSell("0.00")).trades[1]!.tradePrice).toBe("0.00");
      expect(kraken(krBuy, krSell("0")).parserMessages).toBeUndefined();
    });

    it.each(METHODS)("[%s] a crypto-quoted buy whose price cannot be read is priced cost ÷ vol, never a crash", (method) => {
      const rows = (price: string): Statement => kraken(
        `"T0","O0","XBTEUR","2024-01-10 10:00:00","buy","limit","30000","3000","0","0.1","0.0","",""`,
        `"T1","O1","XETHXXBT","2024-03-15 10:30:00","buy","limit","${price}","0.05","0","1","0.0","",""`,
        `"T2","O2","XETHZEUR","2025-03-01 10:00:00","sell","market","3000","3000","0","1","0.0","",""`);
      const btc = manual({ BTC: "40000" });
      const control = runWith([[rows("0.05"), "Kraken"]], 2025, method, btc);
      for (const price of ["abc", ""]) {
        const parsed = rows(price);
        expect(parsed.trades.find((t) => t.tradeID === "T1")!.tradePrice).toBe("0.05");
        expect(net(runWith([[parsed, "Kraken"]], 2025, method, btc))).toBe(net(control));
        expect(net(runWith([[parsed, "Kraken"]], 2024, method, btc))).toBe(net(runWith([[rows("0.05"), "Kraken"]], 2024, method, btc)));
      }
    });
  });

  describe("a coin whose code starts with X or Z", () => {
    // Only Kraken's own legacy codes (XXBT, XETH, ZEUR, ...) carry a prefix.
    // A real coin that starts with X or Z (ZETA, ZORA, XAUT) lost its first
    // letter, so a rebuy of ZETA at Binance did not block the Kraken loss
    // (art. 33.5.e LIRPF) and XUSD was booked as dollars.
    const BN_H = "Date(UTC),Pair,Side,Price,Executed,Amount,Fee";
    const lossAndRebuy = (coin: string): [Statement, string][] => [
      [kraken(`"T1","O1","${coin}EUR","2024-06-01 10:00:00","buy","limit","2.00","2000.00","0","1000","0.0","",""`,
        `"T2","O2","${coin}EUR","2025-03-01 10:00:00","sell","market","1.00","1000.00","0","1000","0.0","",""`), "Kraken"],
      [binanceParser.parse([BN_H, `2025-04-01 10:30:00,${coin}EUR,BUY,1.10,1000,1100.00,0EUR`].join("\n")), "Binance"],
    ];
    describe.each(["SOL", "ZETA", "ZORA", "XAUT"])("%s sold at a loss at Kraken and bought back at Binance", (coin) => {
      it.each(METHODS)("[%s] the loss of 1000 € is blocked on the same coin", (method) => {
        const r = run(lossAndRebuy(coin), 2025, method);
        expect(r.capitalGains.disposals.map((d) => d.symbol)).toEqual([coin]);
        expect([net(r), r.capitalGains.blockedLosses.toFixed(2)]).toEqual(["-1000.00", "1000.00"]);
      });
    });

    it.each([
      ["ZETAEUR", "ZETA", "EUR"], ["ZORAEUR", "ZORA", "EUR"], ["ZBCNEUR", "ZBCN", "EUR"], ["XAUTEUR", "XAUT", "EUR"],
      ["XDAIEUR", "XDAI", "EUR"], ["XUSDEUR", "XUSD", "EUR"], ["XXBTZEUR", "BTC", "EUR"], ["XETHXXBT", "ETH", "BTC"],
      ["XXDGZUSD", "DOGE", "USD"], ["XICNXXBT", "ICN", "BTC"], ["XNMCXXBT", "NMC", "BTC"], ["XXVNZEUR", "XVN", "EUR"], ["XTZEUR", "XTZ", "EUR"],
      ["XTZUSD", "XTZ", "USD"], ["DOTXBT", "DOT", "BTC"], ["XDGEUR", "DOGE", "EUR"], ["XBTUSDT", "BTC", "USDT"],
      ["USDTZUSD", "USDT", "USD"], ["IMXXBT", "IMX", "BTC"],
    ])("pair %s is %s/%s", (pair, base, quote) => {
      const parsed = kraken(`"T1","O1","${pair}","2024-06-01 10:00:00","buy","limit","2.00","2000.00","0","1000","0.0","",""`);
      expect([parsed.trades[0]!.symbol, parsed.trades[0]!.currency]).toEqual([base, quote]);
      expect(parsed.parserMessages).toBeUndefined();
    });

    // Kraken's own key for USDT/USD is USDTZUSD: a modern base before a
    // legacy quote. It was booked as the coin "USDTZ", so a USDT rebuy at
    // Binance did not block the Kraken loss (art. 33.5.e LIRPF).
    describe.each(["USDTZUSD", "USDTUSD"])("USDT bought and sold at a loss as %s, bought back at Binance", (pair) => {
      it.each(METHODS)("[%s] the loss of 242 € is blocked on USDT", (method) => {
        const r = run([
          [kraken(`"T1","O1","${pair}","2025-01-10 10:00:00","buy","limit","1.10","1100.0","0","1000","0.0","",""`,
            `"T2","O2","${pair}","2025-03-01 10:00:00","sell","market","0.88","880.0","0","1000","0.0","",""`), "Kraken"],
          [binanceParser.parse([BN_H, "2025-03-20 10:30:00,USDTEUR,BUY,0.90,1000,900.00,0EUR"].join("\n")), "Binance"],
        ], 2025, method);
        expect(r.capitalGains.disposals.map((d) => d.symbol)).toEqual(["USDT"]);
        expect([net(r), r.capitalGains.blockedLosses.toFixed(2)]).toEqual(["-242.00", "242.00"]);
      });
    });

    it.each(METHODS)("[%s] an Earn reward in XUSD is a coin, never dollars", (method) => {
      const parsed = krakenParser.parse([`"txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"`,
        `"L1","R1","2025-03-01 00:00:00","earn","reward","currency","XUSD","12.5","0","1000"`].join("\n"));
      expect(parsed.cashTransactions.map((c) => [c.symbol, c.currency])).toEqual([["XUSD", "XUSD"]]);
      const r = run([[parsed, "Kraken"]], 2025, method);
      expect(r.interest.entries).toEqual([]);
    });
  });

  describe("a pair written with a slash", () => {
    // BTC/EUR was booked as the coin "BTC/": it matched no BTC lot, reward
    // or rebuy, so a loss was deducted although the coin was bought back.
    const BN_H = "Date(UTC),Pair,Side,Price,Executed,Amount,Fee";
    const lossAndRebuy = (pair: string): [Statement, string][] => [
      [kraken(`"T1","O1","${pair}","2024-06-01 10:00:00","buy","limit","60000","6000","0","0.1","0.0","",""`,
        `"T2","O2","${pair}","2025-03-01 10:00:00","sell","market","50000","5000","0","0.1","0.0","",""`), "Kraken"],
      [binanceParser.parse([BN_H, "2025-04-01 10:30:00,BTCEUR,BUY,51000,0.1,5100.00,0EUR"].join("\n")), "Binance"],
    ];
    describe.each(["XBTEUR", "BTC/EUR", "XBT/EUR", "XXBT/ZEUR"])("%s sold at a loss and bought back at Binance", (pair) => {
      it.each(METHODS)("[%s] the loss of 1000 € is blocked on BTC", (method) => {
        const r = run(lossAndRebuy(pair), 2025, method);
        expect(r.capitalGains.disposals.map((d) => d.symbol)).toEqual(["BTC"]);
        expect([net(r), r.capitalGains.blockedLosses.toFixed(2)]).toEqual(["-1000.00", "1000.00"]);
      });
    });

    it.each(METHODS)("[%s] a BTC/EUR sale takes the cost of an XXBT staking reward", (method) => {
      const reward = krakenParser.parse([`"txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"`,
        `"L1","R1","2024-06-01 00:00:00","staking","","currency","XXBT","0.01","0","5"`].join("\n"));
      const sale = (pair: string): Statement => kraken(`"T2","O2","${pair}","2025-03-01 10:00:00","sell","market","90000.00","900.00","0","0.01","0.0","",""`);
      const btc = manual({ BTC: "50000" });
      const r = runWith([[reward, "Kraken"], [sale("BTC/EUR"), "Kraken"]], 2025, method, btc);
      expect(net(r)).toBe(net(runWith([[reward, "Kraken"], [sale("XBTEUR"), "Kraken"]], 2025, method, btc)));
      expect(net(r)).toBe("400.00");
    });

    it("a crypto-quoted slash pair books both coins", () => {
      const parsed = kraken(`"T1","O1","ETH/XBT","2024-03-15 10:30:00","buy","limit","0.05","0.05","0","1","0.0","",""`);
      expect(parsed.trades.map((t) => [t.symbol, t.currency, t.buySell, t.quantity])).toEqual([["ETH", "BTC", "BUY", "1"], ["BTC", "ETH", "SELL", "-0.05"]]);
      expect(parsed.parserMessages).toBeUndefined();
    });

    it.each([["BTC/FOO", "BTC/FOO"], ["BTC/", "BTC/EUR"], ["BTC/EUR/X", "BTC/EUR"]])("a slash pair %s whose quote is not recognised is named as %s", (pair, split) => {
      const parsed = kraken(`"T1","O1","${pair}","2024-03-15 10:30:00","buy","limit","0.05","0.05","0","1","0.0","",""`);
      const m = parsed.parserMessages?.find((x) => x.id === "kraken.unrecognized_pair");
      expect(m?.message).toContain(`${pair} (interpretado como ${split})`);
      expect(parsed.trades[0]!.symbol).not.toContain("/");
    });
  });

  describe("ledger trade rows with no Trades CSV", () => {
    // A ledger-only upload: 0.1 BTC sold for 9000 € on 01/03/2025. The ledger
    // parser books no trades (they come from the Trades CSV, whose txid is
    // the ledger refid), so the sale vanished with no word.
    const KL_H = `"txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"`;
    const ledger = (...rows: string[]): Statement => krakenParser.parse([KL_H, ...rows].join("\n"));
    const saleLegs = [
      `"L1","TR1","2025-03-01 10:00:00","trade","","currency","XXBT","-0.1000000000","0","0"`,
      `"L2","TR1","2025-03-01 10:00:00","trade","","currency","ZEUR","9000.0000","0","9000"`,
    ];
    const ROWS = "TR1 20250301 [XXBT -0.1000000000, ZEUR 9000.0000]";
    const notBooked = (r: TaxReport): TaxMessage | undefined => r.messages.find((m) => m.id === "kraken.ledger_trade_not_booked");

    it.each(METHODS)("[%s] each trade is named by refid, date and legs, and nothing is booked", (method) => {
      const parsed = ledger(...saleLegs, `"L3","TR2","2025-04-01 10:00:00","trade","","currency","ZEUR","-500","0","8500"`,
        `"L4","TR2","bad","trade","","currency","XETH","0.2","0","0.2"`);
      expect([parsed.trades, parsed.cashTransactions, parsed.parserMessages]).toEqual([[], [], undefined]);
      const r = run([[parsed, "Kraken"]], 2025, method);
      expect(notBooked(r)?.severity).toBe("warning");
      expect(notBooked(r)?.context).toEqual({ count: "2", rows: `${ROWS}; TR2 20250401 [ZEUR -500, XETH 0.2]` });
      expect([net(r), r.capitalGains.disposals.length]).toEqual(["0.00", 0]);
    });

    it.each(METHODS)("[%s] control: with the Trades CSV that books TR1 nothing is named and the sale gains 6000 €", (method) => {
      const trades = kraken(krBuy, krSell("90000.00").replace('"T2"', '"TR1"'));
      const r = run([[ledger(...saleLegs), "Kraken"], [trades, "Kraken"]], 2025, method);
      expect(notBooked(r)).toBeUndefined();
      expect(net(r)).toBe("6000.00");
    });

    it.each(METHODS)("[%s] a Trades CSV that does not book TR1 leaves it named", (method) => {
      const r = run([[kraken(krBuy), "Kraken"], [ledger(...saleLegs), "Kraken"]], 2025, method);
      expect(notBooked(r)?.context).toEqual({ count: "1", rows: ROWS });
    });

    it("two ledger files with the same trade name it once", () => {
      const r = run([[ledger(...saleLegs), "Kraken"], [ledger(...saleLegs), "Kraken"]], 2025, "multidivisa");
      expect(notBooked(r)?.context).toEqual({ count: "1", rows: ROWS });
    });

    it("the warning is the es locale and exists in the five locales", () => {
      const m = notBooked(run([[ledger(...saleLegs), "Kraken"]], 2025, "multidivisa"))!;
      const fill = (text: string): string => text.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => m.context?.[k] ?? "");
      expect(m.message).toBe(fill((es as Record<string, string>)["kraken.ledger_trade_not_booked"]!));
      expect(m.hint).toBe((es as Record<string, string>)["kraken.ledger_trade_not_booked.hint"]);
      expect(isTranslationKey("kraken.ledger_trade_not_booked") && isTranslationKey("kraken.ledger_trade_not_booked.hint")).toBe(true);
      for (const locale of [es, en, ca, eu, gl] as Record<string, string>[]) {
        expect(locale["kraken.ledger_trade_not_booked"]).toContain("{{rows}}");
        expect(locale["kraken.ledger_trade_not_booked.hint"]).toContain("Trades");
      }
    });
  });

  describe("ledger transfer rows", () => {
    // Kraken books an airdrop (FLR, SGB) as a ledger row of type transfer and
    // subtype airdrop. Every transfer was skipped with no word, so 1500 FLR
    // worth 45 € of base-general income (art. 33.1 LIRPF) went undeclared.
    const KL_H = `"txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"`;
    const ledger = (...rows: string[]): Statement => krakenParser.parse([KL_H, ...rows].join("\n"));
    const transfer = (id: string, subtype: string, amount = "1500"): string =>
      `"${id}","R${id}","2023-01-10 00:00:00","transfer","${subtype}","currency","FLR","${amount}","0","1500"`;
    const ignored = (s: Statement): TaxMessage | undefined => s.parserMessages?.find((m) => m.id === "kraken.ledger_rows_ignored");

    it.each(METHODS)("[%s] an airdrop is base-general income valued on its day", (method) => {
      const parsed = ledger(transfer("L1", "airdrop"));
      expect(parsed.cashTransactions.map((c) => [c.transactionID, c.symbol, c.amount, c.type, c.taxBucket])).toEqual([["kraken-airdrop-L1", "FLR", "1500", "Crypto Reward Income", "general"]]);
      expect(parsed.parserMessages).toBeUndefined();
      const r = runWith([[parsed, "Kraken"]], 2023, method, manual({ FLR: "0.03" }));
      expect(r.generalGains.total.toFixed(2)).toBe("45.00");
      expect(r.interest.entries).toEqual([]);
    });

    it("control: moves between the user's own wallets stay skipped with no word", () => {
      const parsed = ledger(...["spottostaking", "stakingfromspot", "stakingtospot", "spotfromstaking", "spotfromfutures", "SpotToFutures"].map((sub, i) => transfer(`L${i}`, sub, "-5")));
      expect([parsed.cashTransactions, parsed.parserMessages]).toEqual([[], undefined]);
    });

    it("any other transfer, and an airdrop that is not positive, is named by type and subtype", () => {
      const parsed = ledger(transfer("L1", ""), transfer("L2", "fork"), transfer("L3", "fork"), transfer("L4", "airdrop", "-1500"), transfer("L5", "airdrop", "abc"));
      expect(parsed.cashTransactions).toEqual([]);
      expect(ignored(parsed)?.context).toEqual({ count: "4" });
      expect(ignored(parsed)?.message).toContain("transfer (1), transfer/fork (2), transfer/airdrop (1).");
      expect(parsed.parserMessages?.find((m) => m.id === "parser.crypto_income_amount_unreadable")?.context?.rows).toBe('transfer airdrop FLR 20230110 [amount: "abc"]');
    });
  });
});

describe("#467 Binance sweep 2: a date in another order and a Convert round trip are named, never booked in another year or lost", () => {
  const message = (messages: readonly TaxMessage[] | undefined, id: string): TaxMessage | undefined => messages?.find((m) => m.id === id);
  const gains = (r: TaxReport, coin: string): string[] => r.capitalGains.disposals.filter((d) => d.symbol === coin).map((d) => new Decimal(d.gainLossEur).toFixed(2));

  // Trade History: BTC bought for 2000 € on 10/01/2025 and sold for 3000 € on
  // 01/06/2025. A sheet re-saved in a locale with dashed day-first dates
  // writes the sale as "01-06-2025": the 2-digit-year reader took "01-06-20"
  // and booked the sale on 20/06/2001, so the 1000 € gain left the year with
  // no word. Binance itself writes "2025-06-01" or "25-06-01".
  const TH_H = "Date(UTC),Pair,Side,Price,Executed,Amount,Fee";
  const history = (saleDate: string): Statement => binanceParser.parse([TH_H,
    "2025-01-10 10:00:00,BTCEUR,BUY,20000,0.1BTC,2000EUR,0EUR",
    `${saleDate},BTCEUR,SELL,30000,0.1BTC,3000EUR,0EUR`].join("\n"));

  it.each(METHODS)("[%s] a sale dated 01-06-2025 is kept as a row that books nothing, named, never moved to 2001", (method) => {
    const parsed = history("01-06-2025 10:00:00");
    expect(unreadableRows(parsed)).toBe('BTC [Date(UTC): "01062025"]');
    const r = run([[parsed, "Binance"]], 2025, method);
    expect(gains(r, "BTC")).toEqual([]);
    expect(r.messages.some((m) => m.id === "parser.trade_row_unreadable")).toBe(true);
    expect(run([[parsed, "Binance"]], 2001, method).capitalGains.disposals).toEqual([]);
  });

  it.each(METHODS)("[%s] a sale dated 15-06-2025 is named the same way, never moved to 2015", (method) => {
    const parsed = history("15-06-2025 10:00:00");
    expect(unreadableRows(parsed)).toBe('BTC [Date(UTC): "15062025"]');
    expect(run([[parsed, "Binance"]], 2015, method).capitalGains.disposals).toEqual([]);
  });

  it.each(METHODS)("[%s] control: the same sale written 2025-06-01T10:00:00Z or 25-06-01 keeps its 1000 € gain", (method) => {
    for (const date of ["2025-06-01T10:00:00Z", "25-06-01 10:00:00"]) {
      const parsed = history(date);
      expect(parsed.parserMessages).toBeUndefined();
      expect(gains(run([[parsed, "Binance"]], 2025, method), "BTC")).toEqual(["1000.00"]);
    }
  });

  // Transaction History: BTC bought for 2000 € in 2024, then two Convert
  // orders one second apart: BTC → ETH and ETH → BTC, each worth 3000 €. The
  // ±1 s window netted every coin to zero, so both disposals vanished with no
  // word and the 1000 € gain on the 2024 lot left the year.
  const TXV_H = "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark,EUR_Value";
  const roundTrip = (back: string): Statement => binanceParser.parse([TXV_H,
    "1,2024-01-10 10:00:00,Spot,Buy,BTC,0.1,,2000",
    "1,2024-01-10 10:00:00,Spot,Sell,EUR,-2000,,2000",
    "1,2025-02-01 10:00:00,Spot,Binance Convert,BTC,-0.1,,3000",
    "1,2025-02-01 10:00:00,Spot,Binance Convert,ETH,1,,3000",
    `1,2025-02-01 ${back},Spot,Binance Convert,ETH,-1,,3000`,
    `1,2025-02-01 ${back},Spot,Binance Convert,BTC,0.1,,3000`].join("\n"));

  it.each(METHODS)("[%s] a Convert round trip in one second names its four rows, never lost with no word", (method) => {
    const parsed = roundTrip("10:00:01");
    expect(message(parsed.parserMessages, "binance.unpaired_leg")?.context).toEqual({ count: "4", rows:
      "BTC Binance Convert -0.1 2025-02-01 10:00:00; ETH Binance Convert 1 2025-02-01 10:00:00; ETH Binance Convert -1 2025-02-01 10:00:01; BTC Binance Convert 0.1 2025-02-01 10:00:01" });
    const r = run([[parsed, "Binance"]], 2025, method);
    expect(r.messages.some((m) => m.id === "binance.unpaired_leg")).toBe(true);
  });

  it.each(METHODS)("[%s] control: the same Converts 5 s apart are booked, and the BTC sale gains 1000 €", (method) => {
    const parsed = roundTrip("10:00:05");
    expect(parsed.parserMessages).toBeUndefined();
    expect(gains(run([[parsed, "Binance"]], 2025, method), "BTC")).toEqual(["1000.00"]);
  });

  it("control: BTC → USDT → ETH in one second nets only USDT and books BTC → ETH, with the USDT rows named", () => {
    const parsed = binanceParser.parse([TXV_H,
      "1,2024-01-10 10:00:00,Spot,Buy,BTC,0.1,,2000",
      "1,2024-01-10 10:00:00,Spot,Sell,EUR,-2000,,2000",
      "1,2025-02-01 10:00:00,Spot,Binance Convert,BTC,-0.1,,3000",
      "1,2025-02-01 10:00:00,Spot,Binance Convert,USDT,3300,,3000",
      "1,2025-02-01 10:00:01,Spot,Binance Convert,USDT,-3300,,3000",
      "1,2025-02-01 10:00:01,Spot,Binance Convert,ETH,1,,3000"].join("\n"));
    expect(parsed.trades.filter((t) => t.tradeDate === "20250201").map((t) => `${t.buySell} ${t.symbol} ${t.quantity}`)).toEqual(["SELL BTC -0.1", "BUY ETH 1"]);
    expect(message(parsed.parserMessages, "binance.unpaired_leg")?.context?.rows).toBe(
      "USDT Binance Convert 3300 2025-02-01 10:00:00; USDT Binance Convert -3300 2025-02-01 10:00:01");
    expect(gains(run([[parsed, "Binance"]], 2025, "multidivisa"), "BTC")).toEqual(["1000.00"]);
  });
});
