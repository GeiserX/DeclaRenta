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
    "freedom24.row_skipped_malformed", "freedom24.dividend_amount_unreadable", "freedom24.tax_amount_unreadable",
    "parser.trade_row_unreadable", "parser.corporate_action_not_applied", "parser.cash_row_undated",
    "parser.cash_row_unidentified", "parser.crypto_income_unidentified", "parser.crypto_income_amount_unreadable",
    "revolut.bad_fx_rate", "revolut.holding_size_unknown", "revolut.dividend_tax_correction",
  ];
  const sentences = (text: string): string[] => text.split(/(?<=[.?!])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/);
  it.each([["es", es], ["en", en]] as [string, Record<string, string>][])("%s: no hint joins clauses with a semicolon, and no sentence is longer than 28 words", (_name, locale) => {
    for (const key of KEYS) {
      for (const text of [locale[key]!, locale[`${key}.hint`]!]) {
        expect(text, key).not.toContain(";");
        for (const sentence of sentences(text)) expect(sentence.split(/\s+/).length, `${key}: ${sentence}`).toBeLessThanOrEqual(28);
      }
    }
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
