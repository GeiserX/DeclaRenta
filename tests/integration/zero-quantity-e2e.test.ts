import { afterEach, describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { computeCasillaBlocksWithFx, combinedNetGainLoss } from "../../src/generators/casillas.js";
import { formatCsv } from "../../src/generators/csv.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { krakenParser } from "../../src/parsers/kraken.js";
import { binanceParser } from "../../src/parsers/binance.js";
import { coinbaseParser } from "../../src/parsers/coinbase.js";
import { degiroParser } from "../../src/parsers/degiro.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { FxMethod, TaxSummary } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Statement } from "../../src/types/broker.js";
import { localizeHint, localizeMessage, setLocale } from "../../src/i18n/index.js";

// ===========================================================================
// Issue #469: a buy or sale of 0 units must never book an empty lot.
//
// An explicit quantity of 0 reached FIFO as a lot of 0 shares. The next sale
// divided its cost by 0 (NaN), report.ts guardNonFiniteTotals then zeroed the
// whole year's acquisition value (long: the user overpays) or transmission
// value (short: the user underpays), and every casilla view recomputed from
// the NaN disposal and printed "NaN". Every case runs through the real parser
// and generateTaxReport, in the three FX methods.
// ===========================================================================

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];

const RATES: EcbRateMap = new Map();
for (let t = Date.UTC(2024, 0, 1); t <= Date.UTC(2026, 0, 31); t += 86_400_000) {
  RATES.set(new Date(t).toISOString().slice(0, 10), new Map([["USD", "1.10"]]));
}

function report(statement: Statement, broker: string, method: FxMethod): TaxSummary {
  const st = finalizeMergedStatement(mergeStatement(createEmptyStatement(), statement, broker));
  return generateTaxReport(st, RATES, 2025, reportOptionsForMethod(method));
}

function ids(r: TaxSummary): string[] {
  return r.messages.map((m) => m.id);
}

/** Every disposal is finite and moves at least one unit; the report has no NaN guard error. */
function expectFinite(r: TaxSummary): void {
  for (const d of r.capitalGains.disposals) {
    expect(d.quantity.greaterThan(0)).toBe(true);
    expect(d.proceedsEur.isFinite() && d.costBasisEur.isFinite() && d.gainLossEur.isFinite()).toBe(true);
  }
  expect(ids(r)).not.toContain("report.non_finite_total");
}

function totals(r: TaxSummary): [string, string, string] {
  const cg = r.capitalGains;
  return [cg.transmissionValue.toString(), cg.acquisitionValue.toString(), cg.netGainLoss.toString()];
}

let seq = 0;
function ibkrTrade(currency: string, date: string, side: "BUY" | "SELL", qty: string, price: string, commission = "0", oci?: "O" | "C"): string {
  seq++;
  return `<Trade tradeID="${seq}" accountId="U1" symbol="XYZ" description="XYZ INC" conid="4531" isin="US0000004531" assetCategory="STK" currency="${currency}" tradeDate="${date}" settlementDate="${date}" quantity="${qty}" tradePrice="${price}" tradeMoney="0" proceeds="0" cost="0" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${oci ?? (side === "BUY" ? "O" : "C")}" exchange="NASDAQ" ibCommissionCurrency="${currency}" ibCommission="${commission}" taxes="0" multiplier="1" />`;
}

function ibkr(rows: string[]): Statement {
  return parseIbkrFlexXml(
    `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20250101" toDate="20251231" period="Custom"><Trades>${rows.join("")}</Trades><CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo /></FlexStatement></FlexStatements></FlexQueryResponse>`,
  );
}

describe("#469 IBKR: a 0-share buy or sale books nothing and is named", () => {
  const longRows = (cur: string) => [
    ibkrTrade(cur, "20250201", "BUY", "0", "10", "-1"),
    ibkrTrade(cur, "20250301", "BUY", "100", "10"),
    ibkrTrade(cur, "20250601", "SELL", "-100", "12"),
  ];

  for (const method of METHODS) {
    it(`issue example in EUR: 1.200 / 1.000 / 200, not 1.200 / 0 / 1.200 (${method})`, () => {
      const r = report(ibkr(longRows("EUR")), "Interactive Brokers", method);
      expectFinite(r);
      expect(totals(r)).toEqual(["1200", "1000", "200"]);
      const msg = r.messages.find((m) => m.id === "fifo.zero_quantity_buy");
      expect(msg?.severity).toBe("warning");
      expect(msg?.context).toMatchObject({ symbol: "XYZ", isin: "US0000004531", date: "2025-02-01" });
    });

    it(`same in USD at 1.10: 1.320 / 1.100 / 220 (${method})`, () => {
      const r = report(ibkr(longRows("USD")), "Interactive Brokers", method);
      expectFinite(r);
      expect(totals(r)).toEqual(["1320", "1100", "220"]);
    });

    it(`a 0-share short open: 110 / 88 / +22, not 0 / 88 / -88 (${method})`, () => {
      const r = report(
        ibkr([
          ibkrTrade("USD", "20250201", "SELL", "0", "10", "-1", "O"),
          ibkrTrade("USD", "20250301", "SELL", "-10", "10", "0", "O"),
          ibkrTrade("USD", "20250601", "BUY", "10", "8", "0", "C"),
        ]),
        "Interactive Brokers",
        method,
      );
      expectFinite(r);
      expect(totals(r)).toEqual(["110", "88", "22"]);
      expect(ids(r)).toContain("fifo.zero_quantity_sell");
    });

    it(`a 0-share sale with no lots books no loss from its commission (${method})`, () => {
      const r = report(ibkr([ibkrTrade("EUR", "20250601", "SELL", "0", "12", "-5")]), "Interactive Brokers", method);
      expect(r.capitalGains.disposals).toHaveLength(0);
      expect(totals(r)).toEqual(["0", "0", "0"]);
      expect(ids(r)).toContain("fifo.zero_quantity_sell");
      expect(ids(r)).not.toContain("fifo.sell_without_lots");
    });
  }

  it("the casilla views read the same figures, never NaN (CSV 0331, blocks, net)", () => {
    const r = report(ibkr(longRows("EUR")), "Interactive Brokers", "multidivisa");
    const blocks = computeCasillaBlocksWithFx(r);
    expect(blocks.listedShares.transmissionValue.toString()).toBe("1200");
    expect(blocks.listedShares.acquisitionValue.toString()).toBe("1000");
    expect(combinedNetGainLoss(blocks).toString()).toBe("200");
    const csv = formatCsv(r);
    expect(csv).not.toMatch(/NaN/);
    expect(csv).toMatch(/^0331,.*,1000\.00$/m);
  });

  it("a 0-share buy changes nothing in anti-churning (the evidence still reads the statement's trades)", () => {
    const tr = (date: string, side: "BUY" | "SELL", qty: string, price: string) => ibkrTrade("EUR", date, side, qty, price);
    const control = report(ibkr([tr("20250301", "BUY", "100", "10"), tr("20250315", "SELL", "-50", "8")]), "Interactive Brokers", "monodivisa");
    const variant = report(
      ibkr([tr("20250301", "BUY", "100", "10"), tr("20250305", "BUY", "0", "10"), tr("20250315", "SELL", "-50", "8")]),
      "Interactive Brokers",
      "monodivisa",
    );
    expect(variant.capitalGains.blockedLosses.toString()).toBe(control.capitalGains.blockedLosses.toString());
    expect(variant.capitalGains.netGainLoss.toString()).toBe(control.capitalGains.netGainLoss.toString());
    expect(ids(variant).filter((id) => id !== "fifo.zero_quantity_buy")).toEqual(ids(control));
  });
});

describe("#469 the FX engine parks nothing for a 0-share buy (the mirror of FIFO)", () => {
  // USD funded at 1.25, bought at 1.00: a principal left parked with no lot
  // to release it would be named an orphan (ISIN change, merger) in
  // «Tradicional con divisa». FIFO books no lot for the 0-share buy, so the FX
  // engine must not park its 10 USD commission either.
  const rates: EcbRateMap = new Map();
  for (let t = Date.UTC(2024, 0, 1); t <= Date.UTC(2026, 0, 31); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    rates.set(d, new Map([["USD", d < "2025-02-01" ? "1.25" : "1.00"]]));
  }
  const fund = `<Trade tradeID="fx1" accountId="U1" symbol="EUR.USD" description="EUR.USD" conid="1" isin="" assetCategory="CASH" currency="USD" tradeDate="20250110" settlementDate="20250110" quantity="1010" tradePrice="1" tradeMoney="1010" proceeds="1010" cost="1010" fifoPnlRealized="0" fxRateToBase="1" buySell="SELL" openCloseIndicator="O" exchange="IDEALFX" ibCommissionCurrency="USD" ibCommission="0" taxes="0" multiplier="1" />`;
  const rows = [fund, ibkrTrade("USD", "20250201", "BUY", "0", "10", "-10"), ibkrTrade("USD", "20250301", "BUY", "100", "10"), ibkrTrade("USD", "20250601", "SELL", "-100", "12")];

  for (const method of ["multidivisa", "tradicional-divisa"] as FxMethod[]) {
    it(`no orphan principal and the same FX result as without the row (${method})`, () => {
      const st = (r: string[]) => finalizeMergedStatement(mergeStatement(createEmptyStatement(), ibkr(r), "Interactive Brokers"));
      const r = generateTaxReport(st(rows), rates, 2025, reportOptionsForMethod(method));
      const control = generateTaxReport(st(rows.filter((_, i) => i !== 1)), rates, 2025, reportOptionsForMethod(method));
      expect(ids(r)).not.toContain("report.fx_traditional_orphan");
      expect(r.fxGains.netGainLoss.toString()).toBe(control.fxGains.netGainLoss.toString());
      expect(ids(r).filter((id) => id !== "fifo.zero_quantity_buy")).toEqual(ids(control));
    });
  }
});

describe("#469 crypto parsers: a 0 or unreadable quantity never books an empty lot", () => {
  const KRAKEN_HEAD = `"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers"`;
  const kraken = (vol: string) => `${KRAKEN_HEAD}
"T1","O1","XBTEUR","2025-02-01 10:00:00","buy","limit","40000.00","2000.00","1.00","${vol}","0.0","","L1"
"T2","O2","XBTEUR","2025-03-01 10:00:00","buy","limit","40000.00","2000.00","0.00","0.05","0.0","","L2"
"T3","O3","XBTEUR","2025-06-01 10:00:00","sell","limit","48000.00","2400.00","0.00","0.05","0.0","","L3"`;
  const binance = (executed: string) => `Date(UTC),Pair,Side,Price,Executed,Amount,Fee
2025-02-01 10:00:00,BTCEUR,BUY,40000.00,${executed},2000.00,1EUR
2025-03-01 10:00:00,BTCEUR,BUY,40000.00,0.05,2000.00,0EUR
2025-06-01 10:00:00,BTCEUR,SELL,48000.00,0.05,2400.00,0EUR`;

  const cases: [name: string, parse: () => Statement, broker: string, unknown: boolean][] = [
    ["Kraken vol 0", () => krakenParser.parse(kraken("0")), "Kraken", false],
    ["Kraken vol blank", () => krakenParser.parse(kraken("")), "Kraken", true],
    ["Kraken vol unreadable", () => krakenParser.parse(kraken("abc")), "Kraken", true],
    ["Binance Executed 0", () => binanceParser.parse(binance("0")), "Binance", false],
    ["Binance Executed blank", () => binanceParser.parse(binance("")), "Binance", true],
    ["Binance Executed unreadable", () => binanceParser.parse(binance("--")), "Binance", true],
  ];

  for (const [name, parse, broker, unknown] of cases) {
    it(`${name}: the parser ${unknown ? "flags the row and warns" : "keeps the explicit 0 for FIFO to name"}`, () => {
      const parsed = parse();
      const first = parsed.trades.find((t) => t.tradeDate === "20250201")!;
      expect(first.quantityUnknown === true).toBe(unknown);
      expect((parsed.parserMessages ?? []).some((m) => m.id === "parser.crypto_quantity_unknown")).toBe(unknown);
    });

    for (const method of METHODS) {
      it(`${name}: 2.400 / 2.000 / 400, not a 2.400 gain (${method})`, () => {
        const r = report(parse(), broker, method);
        expectFinite(r);
        expect(totals(r)).toEqual(["2400", "2000", "400"]);
        expect(ids(r).includes("fifo.zero_quantity_buy")).toBe(!unknown);
      });
    }
  }

  it("Kraken: an unreadable vol on a crypto-quoted pair flags both coins (the quote coin has no price)", () => {
    const parsed = krakenParser.parse(`${KRAKEN_HEAD}
"T1","O1","XETHXXBT","2025-02-01 10:00:00","buy","limit","0.05","0.5","0","","0.0","","L1"`);
    expect(parsed.trades.map((t) => [t.symbol, t.buySell, t.quantityUnknown])).toEqual([
      ["ETH", "BUY", true],
      ["BTC", "SELL", true],
    ]);
    expect(parsed.parserMessages?.find((m) => m.id === "parser.crypto_quantity_unknown")?.context?.count).toBe("2");
  });

  it("Binance: an unreadable Executed on a crypto-quoted pair flags both coins instead of dropping the row", () => {
    const parsed = binanceParser.parse(`Date(UTC),Pair,Side,Price,Executed,Amount,Fee
2025-02-01 10:00:00,ETHBTC,BUY,0.05,,0.5BTC,0ETH`);
    expect(parsed.trades.map((t) => [t.symbol, t.buySell, t.quantityUnknown])).toEqual([
      ["ETH", "BUY", true],
      ["BTC", "SELL", true],
    ]);
  });

  const COINBASE = `Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes
2025-01-10T10:00:00Z,Buy,BTC,0.01,EUR,40000.00,400.00,400.00,0.00,Bought 0.01 BTC
2025-02-01T10:00:00Z,Convert,BTC,0.005,EUR,40000.00,200.00,200.00,0.00,Converted 0.005 BTC to 0 SOL
2025-03-01T10:00:00Z,Buy,SOL,10,EUR,20.00,200.00,200.00,0.00,Bought 10 SOL
2025-06-01T10:00:00Z,Sell,SOL,10,EUR,30.00,300.00,300.00,0.00,Sold 10 SOL`;

  it("Coinbase: a Convert to 0 units creates no buy and is named as an unparsed destination", () => {
    const parsed = coinbaseParser.parse(COINBASE);
    expect(parsed.trades.filter((t) => t.symbol === "SOL").map((t) => t.quantity)).toEqual(["10", "-10"]);
    expect(parsed.parserMessages?.map((m) => m.id)).toContain("coinbase.convert_dest_unparsed");
  });

  for (const method of METHODS) {
    it(`Coinbase: the SOL sale keeps its real cost, 500 / 400 / 100 (${method})`, () => {
      const r = report(coinbaseParser.parse(COINBASE), "Coinbase", method);
      expectFinite(r);
      expect(totals(r)).toEqual(["500", "400", "100"]);
    });
  }
});

describe("#469 DEGIRO: the quantity is compared as a number", () => {
  const csv = (q: string) => `Fecha,Hora,Producto,ISIN,Bolsa de,Centro de ejecución,Número,Precio,,Valor local,,Valor,,Tipo de cambio,Costes de transacción,,Total,,ID Orden
01-02-2025,10:00,BETA CHIPS INC,XX0000000002,TDG,XGAT,${q},141.0000,EUR,0.00,EUR,0.00,EUR,,-3.90,EUR,-3.90,EUR,cccc
01-03-2025,10:00,BETA CHIPS INC,XX0000000002,TDG,XGAT,5,100.0000,EUR,-500.00,EUR,-500.00,EUR,,0.00,EUR,-500.00,EUR,dddd
01-06-2025,10:00,BETA CHIPS INC,XX0000000002,TDG,XGAT,-5,120.0000,EUR,600.00,EUR,600.00,EUR,,0.00,EUR,600.00,EUR,eeee`;

  for (const q of ["0", "0.0", "\"0,00\""]) {
    it(`quantity ${q} with a readable price books no trade`, () => {
      expect(degiroParser.parse(csv(q)).trades.map((t) => t.quantity)).toEqual(["5", "-5"]);
    });
  }

  for (const method of METHODS) {
    it(`"0.0": 600 / 500 / 100, not 600 / 0 / 600 (${method})`, () => {
      const r = report(degiroParser.parse(csv("0.0")), "DEGIRO", method);
      expectFinite(r);
      expect(totals(r)).toEqual(["600", "500", "100"]);
    });
  }
});

describe("#469 the casilla boxes never render NaN, whatever reaches them", () => {
  // A defense in depth for any future engine path: only the non-finite amount
  // is left out, never the valid amounts of the rest of the year, and the
  // report names the sale (the same rule in the report totals and every view).
  it("a NaN cost is left out alone: the valid sale keeps its 1.000 cost, so 1.200 / 1.000 / 200", () => {
    const base = report(ibkr([ibkrTrade("EUR", "20250301", "BUY", "100", "10"), ibkrTrade("EUR", "20250601", "SELL", "-100", "12")]), "Interactive Brokers", "multidivisa");
    const good = base.capitalGains.disposals[0]!;
    const poisoned: TaxSummary = {
      ...base,
      capitalGains: {
        ...base.capitalGains,
        disposals: [good, { ...good, quantity: new Decimal(0), proceedsEur: new Decimal(0), costBasisEur: new Decimal(NaN), gainLossEur: new Decimal(NaN) }],
      },
    };
    const blocks = computeCasillaBlocksWithFx(poisoned);
    expect(blocks.listedShares.transmissionValue.toString()).toBe("1200");
    expect(blocks.listedShares.acquisitionValue.toString()).toBe("1000");
    expect(blocks.listedShares.netGainLoss.toString()).toBe("200");
    expect(blocks.listedShares.gains.toString()).toBe("200");
    expect(blocks.listedShares.losses.toString()).toBe("0");
    expect(combinedNetGainLoss(blocks).isFinite()).toBe(true);
    const resumen = formatCsv(poisoned).split("# RESUMEN CASILLAS")[1] ?? "";
    expect(resumen).not.toMatch(/NaN/);
  });
});

describe("#469 review: one sale with a non-finite amount never erases the year's valid amounts", () => {
  // Real path: a USD rate of "Infinity" on one sale date (a corrupt manual or
  // cached rate) poisons that sale only. The EUR sale (1.200 / 1.000) must stay
  // in the boxes, and the report must name the poisoned sale.
  const rows = [
    ibkrTrade("EUR", "20250301", "BUY", "100", "10"),
    ibkrTrade("EUR", "20250601", "SELL", "-100", "12"),
    ibkrTrade("USD", "20250310", "BUY", "10", "100").replace(/symbol="XYZ"/, 'symbol="ABC"').replace(/isin="US0000004531"/, 'isin="US0000000ABC"').replace(/conid="4531"/, 'conid="777"'),
    ibkrTrade("USD", "20250901", "SELL", "-10", "120").replace(/symbol="XYZ"/, 'symbol="ABC"').replace(/isin="US0000004531"/, 'isin="US0000000ABC"').replace(/conid="4531"/, 'conid="777"'),
  ];
  const poisoned: EcbRateMap = new Map([...RATES].map(([d, m]) => [d, d === "2025-09-01" ? new Map([["USD", "Infinity"]]) : m]));

  for (const method of METHODS) {
    it(`the EUR sale stays 1.200 / 1.000 / 200 and the error names ABC (${method})`, () => {
      const st = finalizeMergedStatement(mergeStatement(createEmptyStatement(), ibkr(rows), "Interactive Brokers"));
      const r = generateTaxReport(st, poisoned, 2025, reportOptionsForMethod(method));
      const abc = r.capitalGains.disposals.find((d) => d.symbol === "ABC")!;
      expect(abc.proceedsEur.isFinite()).toBe(false);
      expect(totals(r)).toEqual(["1200", "1000", "200"]);
      const blocks = computeCasillaBlocksWithFx(r);
      expect(blocks.listedShares.transmissionValue.toString()).toBe("1200");
      expect(blocks.listedShares.acquisitionValue.toString()).toBe("1000");
      expect(blocks.listedShares.netGainLoss.toString()).toBe("200");
      const err = r.messages.find((m) => m.id === "report.non_finite_disposal");
      expect(err?.severity).toBe("error");
      expect(err?.context?.rows).toContain("ABC");
      expect(err?.context?.rows).toContain("01/09/2025");
      const resumen = formatCsv(r).split("# RESUMEN CASILLAS")[1] ?? "";
      expect(resumen).not.toMatch(/NaN|Infinity/);
    });
  }

  describe("the error in the 5 locales", () => {
    afterEach(async () => {
      await setLocale("es");
    });

    it("the Spanish text is the report's own; every other locale has its own text naming the sale", async () => {
      const st = finalizeMergedStatement(mergeStatement(createEmptyStatement(), ibkr(rows), "Interactive Brokers"));
      const m = generateTaxReport(st, poisoned, 2025, reportOptionsForMethod("monodivisa")).messages.find((x) => x.id === "report.non_finite_disposal")!;
      await setLocale("es");
      expect(localizeMessage(m)).toBe(m.message);
      expect(localizeHint(m)).toBe(m.hint);
      for (const locale of ["en", "ca", "eu", "gl"] as const) {
        await setLocale(locale);
        expect(localizeMessage(m)).not.toBe(m.message);
        expect(localizeHint(m)).not.toBe(m.hint);
        expect(localizeMessage(m)).toContain(m.context!.rows);
        expect(localizeMessage(m)).not.toContain("{{");
      }
    });
  });
});
