/**
 * Trade Republic rows the parser could not read, or read wrongly (#466, #467,
 * #468). Every case runs a real CSV through the real parser and
 * generateTaxReport, in the three FX methods, next to a readable control.
 *
 * - A dividend's tax cell was checked with a lenient parseFloat and passed on
 *   raw: "-15.00 EUR" or "-15abc" stopped the whole report, "-Infinity" gave
 *   an unlimited withholding.
 * - A positive tax on a reversed dividend (a refund) was booked as a new
 *   withholding.
 * - A dividend with an original_currency but no original_amount booked the
 *   EUR amount as if it were in the foreign currency.
 * - A row of an unknown category or CASH type was dropped with no word, even
 *   when it moved shares (the #453 exception went to "applied") or money.
 * - A buy or sale with no security (no ISIN and no name, or a crypto row with
 *   no symbol) was pooled under an empty symbol with unrelated securities.
 * - A TRADING row of another type that wrote a share count but named no
 *   security was dropped, while the same row as a BUY was evidence.
 * - A negative price cell sold the shares at a negative price.
 * - A price, amount or fee cell was read twice: "1.2,3,4" became 123.4, or
 *   its raw text stopped the report.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { tradeRepublicParser } from "../../src/parsers/trade-republic.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { FxMethod, TaxSummary as TaxReport } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Statement } from "../../src/types/broker.js";

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];
const ISIN = "ES0000004531";

// 0.909 EUR per USD every day: 110 USD is 99.99 €.
function rates(): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86_400_000) {
    map.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "0.909"]]));
  }
  return map;
}

const H = "datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code";
let n = 0;
function row(o: Partial<Record<string, string>>): string {
  n++;
  const d = o.date ?? "2025-05-15";
  const v = {
    datetime: `${d}T10:00:00.000Z`, date: d, account_type: "DEFAULT", category: "", type: "", asset_class: "", name: "", symbol: "",
    shares: "", price: "", amount: "", fee: "", tax: "", currency: "EUR", original_amount: "", original_currency: "", fx_rate: "",
    description: "", transaction_id: `tx-${n}`, counterparty_name: "", counterparty_iban: "", payment_reference: "", mcc_code: "", ...o,
  };
  return Object.values(v).map((x) => `"${x}"`).join(",");
}
const tr = (...rows: string[]): Statement => tradeRepublicParser.parse([H, ...rows].join("\n"));

function run(parts: [Statement, string][], method: FxMethod): TaxReport {
  const statement = createEmptyStatement();
  for (const [part, broker] of parts) mergeStatement(statement, part, broker);
  return generateTaxReport(finalizeMergedStatement(statement), rates(), 2025, reportOptionsForMethod(method));
}
const report = (s: Statement, method: FxMethod): TaxReport => run([[s, "Trade Republic"]], method);
const rowsOf = (s: Statement, id: string): string | undefined => s.parserMessages?.find((m) => m.id === id)?.context?.rows;

// The #453 issue file at IBKR: buy 100 XYZ at 10 € on 01/03/2025, sell 50 at
// 8 € on 15/03/2025 (a 100 € loss), 50 listed at the year end. A Trade
// Republic holding of XYZ from 02/12/2024 keeps the loss blocked.
let seq = 0;
function ibTrade(date: string, side: "BUY" | "SELL", qty: number, price: number): string {
  const money = new Decimal(qty).mul(price);
  seq++;
  return `<Trade tradeID="${seq}" accountId="U1" symbol="XYZ" description="XYZ SA" conid="4531" isin="${ISIN}" assetCategory="STK" currency="EUR" tradeDate="${date}" settlementDate="${date}" quantity="${side === "BUY" ? qty : -qty}" tradePrice="${price}" tradeMoney="${side === "BUY" ? money : money.neg()}" proceeds="${side === "BUY" ? money.neg() : money}" cost="${money}" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}" exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" multiplier="1" />`;
}
const IB_ISSUE = `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20240101" toDate="20251231" period="Custom"><Trades>${ibTrade("20250301", "BUY", 100, 10)}${ibTrade("20250315", "SELL", 50, 8)}</Trades><CashTransactions /><CorporateActions /><OpenPositions><OpenPosition accountId="U1" symbol="XYZ" description="XYZ SA" conid="4531" isin="${ISIN}" currency="EUR" assetCategory="STK" position="50" costBasisMoney="0" costBasisPrice="0" markPrice="10" positionValue="0" fifoPnlUnrealized="0" fxRateToBase="1" side="Long" levelOfDetail="SUMMARY" /></OpenPositions><SecuritiesInfo /></FlexStatement></FlexStatements></FlexQueryResponse>`;

function issueSale(other: Statement, method: FxMethod): { blocked: string; singlePurchase: string | undefined } {
  const r = run([[parseIbkrFlexXml(IB_ISSUE), "Interactive Brokers"], [other, "Trade Republic"]], method);
  const sale = r.capitalGains.disposals.find((d) => d.isin === ISIN)!;
  return { blocked: r.capitalGains.blockedLosses.toFixed(2), singlePurchase: sale.washSaleSinglePurchase };
}
const held = (o: Partial<Record<string, string>>): Statement =>
  tr(row({ asset_class: "STOCK", name: "XYZ SA", symbol: ISIN, shares: "40", price: "10", amount: "-400", date: "2024-12-02", ...o }));

const DIV = (o: Partial<Record<string, string>> = {}) => row({
  category: "CASH", type: "DIVIDEND", asset_class: "STOCK", name: "Acme Corp", symbol: "US0000001001", shares: "10",
  amount: "100.00", original_amount: "110", original_currency: "USD", ...o,
});
const ES_DIV = (o: Partial<Record<string, string>> = {}) => DIV({ name: "Iberia SA", symbol: "ES0000001001", original_amount: "", original_currency: "", ...o });
const BUY = (o: Partial<Record<string, string>> = {}) => row({
  category: "TRADING", type: "BUY", asset_class: "STOCK", name: "Acme Corp", symbol: "US0000001001", shares: "1", price: "100",
  amount: "-100.00", fee: "-1.00", date: "2025-02-01", ...o,
});
const SELL = (o: Partial<Record<string, string>> = {}) => row({
  category: "TRADING", type: "SELL", asset_class: "STOCK", name: "Acme Corp", symbol: "US0000001001", shares: "-1", price: "150",
  amount: "150.00", fee: "-1.00", date: "2025-06-01", ...o,
});

describe("Trade Republic dividend tax: a tax cell that cannot be read never stops the report and never books a withholding", () => {
  it.each(METHODS)("[%s] control: 110 USD with a tax of -15.00 gives 0029 99.99 and 0588 15.00", (method) => {
    const s = tr(DIV({ tax: "-15.00" }));
    expect(s.parserMessages).toBeUndefined();
    const r = report(s, method);
    expect(r.dividends.grossIncome.toFixed(2)).toBe("99.99");
    expect(r.doubleTaxation.deduction.toFixed(2)).toBe("15.00");
  });

  it.each(METHODS)("[%s] a tax of '-15.00 EUR', '-15abc', '-1.234.5' or '-Infinity': the dividend is booked in full, with no withholding, and named", (method) => {
    for (const tax of ["-15.00 EUR", "-15abc", "-1.234.5", "-Infinity"]) {
      const s = tr(DIV({ tax }));
      expect(s.cashTransactions.map((c) => c.type), tax).toEqual(["Dividends"]);
      expect(rowsOf(s, "trade_republic.tax_unreadable"), tax).toBe(`DIVIDEND Acme Corp (US0000001001) 110 USD 20250515 [tax: ${JSON.stringify(tax)}]`);
      const r = report(s, method);
      expect(r.dividends.grossIncome.toFixed(2), tax).toBe("99.99");
      expect(r.doubleTaxation.deduction.toFixed(2), tax).toBe("0.00");
    }
  });

  it.each(METHODS)("[%s] a Spanish dividend with a tax of '-19 EUR' or '-Infinity' books 100 € and no Spanish withholding", (method) => {
    expect(report(tr(ES_DIV({ tax: "-19.00" })), method).dividends.spanishWithholding.toFixed(2)).toBe("19.00");
    for (const tax of ["-19 EUR", "-Infinity"]) {
      const s = tr(ES_DIV({ tax }));
      expect(rowsOf(s, "trade_republic.tax_unreadable"), tax).toBe(`DIVIDEND Iberia SA (ES0000001001) 100 EUR 20250515 [tax: ${JSON.stringify(tax)}]`);
      const r = report(s, method);
      expect(r.dividends.grossIncome.toFixed(2), tax).toBe("100.00");
      expect(r.dividends.spanishWithholding.toFixed(2), tax).toBe("0.00");
    }
  });

  it.each(METHODS)("[%s] a reversal whose tax cannot be read is not booked: the dividend it reverses keeps its income and its withholding", (method) => {
    const s = tr(DIV({ tax: "-5.00" }), DIV({ amount: "-100.00", original_amount: "-110", tax: "+5abc" }));
    expect(s.cashTransactions.map((c) => [c.type, c.amount])).toEqual([["Dividends", "110"], ["Withholding Tax", "-5.00"]]);
    expect(rowsOf(s, "trade_republic.tax_unreadable")).toBe('DIVIDEND Acme Corp (US0000001001) -110 USD 20250515 [tax: "+5abc"]');
    const r = report(s, method);
    expect(r.dividends.grossIncome.toFixed(2)).toBe("99.99");
    expect(r.doubleTaxation.deduction.toFixed(2)).toBe("5.00");
  });

  it("an empty tax cell or a written zero is no withholding and no warning", () => {
    for (const tax of ["", "0", "0.00"]) {
      const s = tr(DIV({ tax }));
      expect(s.cashTransactions.map((c) => c.type), tax).toEqual(["Dividends"]);
      expect(s.parserMessages, tax).toBeUndefined();
    }
  });
});

describe("Trade Republic dividend reversal: the tax of a reversed dividend is a refund, never a new withholding", () => {
  it.each(METHODS)("[%s] control: one US dividend of 110 USD with a tax of -5 gives 0588 5.00", (method) => {
    expect(report(tr(DIV({ tax: "-5.00" })), method).doubleTaxation.deduction.toFixed(2)).toBe("5.00");
  });

  it.each(METHODS)("[%s] +110 (-5) / -110 (+5 or -5) / +110 (-5) gives 0588 5.00, not 15.00", (method) => {
    for (const refund of ["5.00", "-5.00"]) {
      const s = tr(DIV({ tax: "-5.00" }), DIV({ amount: "-100.00", original_amount: "-110", tax: refund }), DIV({ tax: "-5.00" }));
      expect(s.cashTransactions.filter((c) => c.type === "Withholding Tax").map((c) => c.amount), refund).toEqual(["-5.00", "5", "-5.00"]);
      const r = report(s, method);
      expect(r.dividends.grossIncome.toFixed(2), refund).toBe("99.99");
      expect(r.doubleTaxation.deduction.toFixed(2), refund).toBe("5.00");
    }
  });

  it.each(METHODS)("[%s] Spanish +100 (-19) / -100 (+19) / +100 (-19) keeps 19.00 withheld; a fully reversed dividend keeps none", (method) => {
    expect(report(tr(ES_DIV({ tax: "-19.00" })), method).dividends.spanishWithholding.toFixed(2)).toBe("19.00");
    const three = report(tr(ES_DIV({ tax: "-19.00" }), ES_DIV({ amount: "-100.00", tax: "19.00" }), ES_DIV({ tax: "-19.00" })), method);
    expect(three.dividends.grossIncome.toFixed(2)).toBe("100.00");
    expect(three.dividends.spanishWithholding.toFixed(2)).toBe("19.00");
    const reversed = report(tr(ES_DIV({ tax: "-19.00" }), ES_DIV({ amount: "-100.00", tax: "19.00" })), method);
    expect(reversed.dividends.grossIncome.toFixed(2)).toBe("0.00");
    expect(reversed.dividends.spanishWithholding.toFixed(2)).toBe("0.00");
  });

  it("a positive tax on a positive dividend stays a withholding, as before", () => {
    expect(tr(DIV({ tax: "5.00" })).cashTransactions.map((c) => c.amount)).toEqual(["110", "-5"]);
  });
});

describe("Trade Republic dividend currency: the currency is the one of the amount that was read", () => {
  it.each(METHODS)("[%s] control: 100 EUR credited for 110 USD gives 0029 99.99", (method) => {
    expect(report(tr(DIV()), method).dividends.grossIncome.toFixed(2)).toBe("99.99");
  });

  it.each(METHODS)("[%s] original_currency USD with an empty original_amount books the 100 EUR in EUR", (method) => {
    const s = tr(DIV({ original_amount: "" }));
    expect(s.cashTransactions.map((c) => [c.currency, c.amount, c.brokerConvertedToBase])).toEqual([["EUR", "100", undefined]]);
    expect(s.parserMessages).toBeUndefined();
    expect(report(s, method).dividends.grossIncome.toFixed(2)).toBe("100.00");
  });

  it("a dividend whose EUR amount cannot be read is named in EUR when it has no original_amount", () => {
    const s = tr(DIV({ original_amount: "", amount: "abc" }));
    expect(s.cashTransactions).toEqual([]);
    expect(rowsOf(s, "parser.cash_income_amount_unreadable")).toBe('DIVIDEND Acme Corp (US0000001001) EUR 20250515 [amount: "abc"]');
  });
});

describe("Trade Republic rows of an unknown category or CASH type are kept or named, never dropped with no word", () => {
  it.each(METHODS)("[%s] control: a TR buy of 40 XYZ on 02/12/2024 next to the IBKR issue file blocks 100 €", (method) => {
    expect(issueSale(held({ category: "TRADING", type: "BUY" }), method)).toEqual({ blocked: "100.00", singlePurchase: undefined });
  });

  it.each(METHODS)("[%s] BENEFITS SAVEBACK or CASH STOCKPERK of 40 XYZ is evidence: 100 € stay blocked", (method) => {
    for (const [category, type, cell] of [["BENEFITS", "SAVEBACK", 'category: "BENEFITS"'], ["CASH", "STOCKPERK", 'type: "STOCKPERK"']] as const) {
      const s = held({ category, type });
      expect(s.trades.map((t) => [t.quantity, t.quantityUnknown, t.cost]), type).toEqual([["0", true, "0"]]);
      expect(rowsOf(s, "parser.trade_row_unreadable"), type).toBe(`XYZ SA (${ISIN}) 20241202 [${cell}]`);
      expect(issueSale(s, method), type).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
    }
  });

  it.each(METHODS)("[%s] a CASH COUPON_PAYMENT or CAPITAL_DISTRIBUTION of a security is not booked and is named", (method) => {
    const s = tr(
      row({ category: "CASH", type: "COUPON_PAYMENT", asset_class: "BOND", name: "Bund 2030", symbol: "DE0001102507", amount: "50.00" }),
      row({ category: "CASH", type: "CAPITAL_DISTRIBUTION", asset_class: "STOCK", name: "Acme Corp", symbol: "US0000001001", amount: "100.00" }),
    );
    expect([s.trades, s.cashTransactions]).toEqual([[], []]);
    expect(rowsOf(s, "trade_republic.cash_type_not_read")).toBe(
      'COUPON_PAYMENT Bund 2030 (DE0001102507) 50.00 EUR 20250515; CAPITAL_DISTRIBUTION Acme Corp (US0000001001) 100.00 EUR 20250515');
    const r = report(s, method);
    expect([r.dividends.grossIncome.toFixed(2), r.interest.earned.toFixed(2)]).toEqual(["0.00", "0.00"]);
  });

  it("controls: deposits, card payments and transfers with no security, and a written zero, stay skipped with no word", () => {
    const s = tr(
      row({ category: "CASH", type: "CUSTOMER_INBOUND", name: "Jane Doe", amount: "1000.00" }),
      row({ category: "CASH", type: "CARD_TRANSACTION", name: "Shop", amount: "-12.50" }),
      row({ category: "CASH", type: "TRANSFER_INBOUND", amount: "500.00" }),
      row({ category: "CASH", type: "COUPON_PAYMENT", name: "Bund 2030", symbol: "DE0001102507", amount: "0.00" }),
      row({ category: "BENEFITS", type: "SAVEBACK", name: "XYZ SA", symbol: ISIN, shares: "0", amount: "0" }),
    );
    expect([s.trades, s.cashTransactions, s.parserMessages]).toEqual([[], [], undefined]);
  });
});

describe("Trade Republic buys and sales with no security are never pooled under an empty symbol", () => {
  it.each(METHODS)("[%s] control: BTC buy 100 and ETH sell 1000 give a 1000 gain with no lots", (method) => {
    const r = report(tr(
      BUY({ asset_class: "CRYPTO", name: "Bitcoin", symbol: "BTC", fee: "" }),
      SELL({ asset_class: "CRYPTO", name: "Ethereum", symbol: "ETH", price: "1000", amount: "1000.00", fee: "" })), method);
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("1000.00");
  });

  it.each(METHODS)("[%s] the same crypto rows with no symbol book nothing and are named: no coin takes another's cost", (method) => {
    const s = tr(
      BUY({ asset_class: "CRYPTO", name: "Bitcoin", symbol: "", fee: "" }),
      SELL({ asset_class: "CRYPTO", name: "Ethereum", symbol: "", price: "1000", amount: "1000.00", fee: "" }));
    expect(s.trades.map((t) => [t.symbol, t.quantity, t.quantityUnknown])).toEqual([["", "0", true], ["", "0", true]]);
    expect(rowsOf(s, "parser.trade_row_unreadable")).toBe('Bitcoin 20250201 [symbol: ""]; Ethereum 20250601 [symbol: ""]');
    const r = report(s, method);
    expect([r.capitalGains.netGainLoss.toFixed(2), r.capitalGains.acquisitionValue.toFixed(2)]).toEqual(["0.00", "0.00"]);
  });

  it.each(METHODS)("[%s] control: A buy 100 and B sell 1000 give a 1000 gain; with no ISIN and no name they book nothing and are named", (method) => {
    const control = report(tr(
      BUY({ name: "A Corp", symbol: "US0000000AAA", fee: "" }),
      SELL({ name: "B Corp", symbol: "US0000000BBB", price: "1000", amount: "1000.00", fee: "" })), method);
    expect(control.capitalGains.netGainLoss.toFixed(2)).toBe("1000.00");
    const s = tr(BUY({ name: "", symbol: "", fee: "" }), SELL({ name: "", symbol: "", price: "1000", amount: "1000.00", fee: "" }));
    expect(rowsOf(s, "parser.trade_row_unreadable")).toBe('— 20250201 [symbol: ""]; — 20250601 [symbol: ""]');
    const r = report(s, method);
    expect([r.capitalGains.netGainLoss.toFixed(2), r.capitalGains.acquisitionValue.toFixed(2)]).toEqual(["0.00", "0.00"]);
  });

  it.each(METHODS)("[%s] a buy of 40 with no ISIN and no name is still evidence of an unidentified trade next to the IBKR issue file", (method) => {
    expect(issueSale(held({ category: "TRADING", type: "BUY", name: "", symbol: "" }), method)).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
  });

  it("a stock with a name and no ISIN is still booked under its name", () => {
    expect(tr(BUY({ symbol: "" })).trades.map((t) => [t.symbol, t.isin, t.quantity])).toEqual([["Acme Corp", "", "1"]]);
  });
});

describe("Trade Republic rows of another type that write a share count but name no security are evidence, as a BUY is", () => {
  it.each(METHODS)("[%s] TRADING SAVINGS_PLAN, DELIVERY FREE_RECEIPT or CORPORATE_ACTION MERGER of 40 with no symbol and no name: 100 € stay blocked", (method) => {
    for (const [category, type] of [["TRADING", "SAVINGS_PLAN"], ["DELIVERY", "FREE_RECEIPT"], ["CORPORATE_ACTION", "MERGER"]] as const) {
      const s = held({ category, type, name: "", symbol: "" });
      expect(s.trades.map((t) => [t.isin, t.quantity, t.quantityUnknown]), type).toEqual([["", "0", true]]);
      expect(issueSale(s, method), type).toEqual({ blocked: "100.00", singlePurchase: "unverified" });
    }
  });

  it.each(METHODS)("[%s] controls: the same rows with a written zero or no share count stay skipped", (method) => {
    for (const shares of ["0", ""]) {
      const s = held({ category: "TRADING", type: "SAVINGS_PLAN", name: "", symbol: "", shares });
      expect(s.trades, shares).toEqual([]);
      expect(issueSale(s, method), shares).toEqual({ blocked: "0.00", singlePurchase: "applied" });
    }
  });
});

describe("Trade Republic price: a negative price cell never sells the shares at a negative price", () => {
  it.each(METHODS)("[%s] control: buy 1 at 100 and sell 1 at 150, fee 1 each, gain 48.00", (method) => {
    const r = report(tr(BUY(), SELL()), method);
    expect([r.capitalGains.transmissionValue.toFixed(2), r.capitalGains.netGainLoss.toFixed(2)]).toEqual(["149.00", "48.00"]);
  });

  it.each(METHODS)("[%s] a sell price of '-150' or '(150.00)', or a buy price of '-100', is |amount| ÷ shares", (method) => {
    for (const s of [tr(BUY(), SELL({ price: "-150" })), tr(BUY(), SELL({ price: "(150.00)" })), tr(BUY({ price: "-100" }), SELL())]) {
      expect(s.trades.map((t) => t.tradePrice)).toEqual(["100", "150"]);
      const r = report(s, method);
      expect([r.capitalGains.transmissionValue.toFixed(2), r.capitalGains.acquisitionValue.toFixed(2), r.capitalGains.netGainLoss.toFixed(2)])
        .toEqual(["149.00", "101.00", "48.00"]);
    }
  });
});

describe("Trade Republic price, amount and fee cells are read once: a cell that reads as a number only when read twice is no number", () => {
  it.each(METHODS)("[%s] a buy or sell price of '1.2,3,4' never stops the report: the price is |amount| ÷ shares", (method) => {
    for (const s of [tr(BUY({ price: "1.2,3,4" }), SELL()), tr(BUY(), SELL({ price: "1.2,3,4" }))]) {
      expect(s.trades.map((t) => t.tradePrice)).toEqual(["100", "150"]);
      const r = report(s, method);
      expect([r.capitalGains.transmissionValue.toFixed(2), r.capitalGains.acquisitionValue.toFixed(2), r.capitalGains.netGainLoss.toFixed(2)])
        .toEqual(["149.00", "101.00", "48.00"]);
    }
  });

  it.each(METHODS)("[%s] a sale amount of '1.2,3,4' is no 123.40: the sale books nothing and is named", (method) => {
    const s = tr(BUY(), SELL({ amount: "1.2,3,4" }));
    expect(s.trades.map((t) => [t.quantity, t.proceeds, t.quantityUnknown])).toEqual([["1", "0", undefined], ["0", "0", true]]);
    expect(rowsOf(s, "parser.trade_row_unreadable")).toBe('Acme Corp (US0000001001) 20250601 [amount: "1.2,3,4"]');
    expect(report(s, method).capitalGains.transmissionValue.toFixed(2)).toBe("0.00");
  });

  it.each(METHODS)("[%s] a buy fee of '1.2,3,4' is no 123.40 cost: it is not booked", (method) => {
    const s = tr(BUY({ fee: "1.2,3,4" }), SELL());
    expect(s.trades.map((t) => t.commission)).toEqual(["0", "-1"]);
    expect(report(s, method).capitalGains.acquisitionValue.toFixed(2)).toBe("100.00");
  });

  it("controls: '1.234,5', '1,234.5' and '(150.00)' still read as one number", () => {
    expect(tr(BUY({ price: "1.234,5", shares: "1", amount: "-1234.50" })).trades.map((t) => t.tradePrice)).toEqual(["1234.5"]);
    expect(tr(BUY({ price: "1,234.5", shares: "1", amount: "-1234.50" })).trades.map((t) => t.tradePrice)).toEqual(["1234.5"]);
    expect(tr(BUY({ fee: "(1.50)" })).trades.map((t) => t.commission)).toEqual(["-1.5"]);
  });
});

