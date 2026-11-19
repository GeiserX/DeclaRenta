import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport, reportOptionsForMethod, type ReportOptions } from "../../src/generators/report.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import { localizeHint, localizeMessage, setLocale } from "../../src/i18n/index.js";
import type { FxMethod, TaxSummary as TaxReport } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// Issue #452: the anti-churning window of a security listed only on a market
// that is neither an EEA regulated market nor a third-country market the
// Commission declared equivalent is 1 year (LIRPF 33.5.g), not 2 months.
// DeclaRenta reads IBKR's `listingExchange` and lets the user set the window
// per ISIN. Every case runs through the REAL IBKR parser and generateTaxReport.
// ===========================================================================

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];
const ISIN = "GB0007980591";

/** [date YYYYMMDD, side, quantity, price] */
type Row = [date: string, side: "BUY" | "SELL", qty: number, price: number];

let seq = 0;
function tradeXml([date, side, qty, price]: Row, listing: string, currency: string, isin: string): string {
  const signed = side === "BUY" ? qty : -qty;
  const money = new Decimal(qty).mul(price);
  seq++;
  const listingAttr = listing === "" ? "" : ` listingExchange="${listing}"`;
  return `<Trade tradeID="${seq}" accountId="U1" symbol="LSEONLY" description="LONDON ONLY PLC" conid="9452" isin="${isin}" assetCategory="STK" currency="${currency}" tradeDate="${date}" settlementDate="${date}" quantity="${signed}" tradePrice="${price}" tradeMoney="${side === "BUY" ? money : money.neg()}" proceeds="${side === "BUY" ? money.neg() : money}" cost="${money}" fifoPnlRealized="0" fxRateToBase="1" buySell="${side}" openCloseIndicator="${side === "BUY" ? "O" : "C"}" exchange="LSE"${listingAttr} ibCommissionCurrency="${currency}" ibCommission="0" taxes="0" multiplier="1" />`;
}

/** An IBKR Flex statement; `securityInfo` adds a SecurityInfo row with that listing exchange. */
function ibkrXml(
  rows: Row[],
  listing: string,
  { currency = "EUR", isin = ISIN, securityInfo = undefined as string | undefined, toDate = "20251231" } = {},
): string {
  const held = rows.reduce((sum, [, side, qty]) => sum + (side === "BUY" ? qty : -qty), 0);
  const op = held > 0
    ? `<OpenPosition accountId="U1" symbol="LSEONLY" description="LONDON ONLY PLC" isin="${isin}" currency="${currency}" assetCategory="STK" quantity="${held}" costBasisMoney="0" costBasisPrice="0" markPrice="85" positionValue="0" fifoPnlUnrealized="0" fxRateToBase="1" />`
    : "";
  const si = securityInfo === undefined
    ? ""
    : `<SecurityInfo symbol="LSEONLY" description="LONDON ONLY PLC" isin="${isin}" cusip="" currency="${currency}" assetCategory="STK" multiplier="1" subCategory="COMMON" listingExchange="${securityInfo}" />`;
  return `<FlexQueryResponse queryName="T" type="AF"><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20250101" toDate="${toDate}" period="Custom"><Trades>${rows
    .map((r) => tradeXml(r, listing, currency, isin))
    .join("")}</Trades><CashTransactions /><CorporateActions /><OpenPositions>${op}</OpenPositions><SecuritiesInfo>${si}</SecuritiesInfo></FlexStatement></FlexStatements></FlexQueryResponse>`;
}

function rates(): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (let t = Date.UTC(2019, 0, 1); t <= Date.UTC(2027, 11, 31); t += 86_400_000) {
    map.set(new Date(t).toISOString().slice(0, 10), new Map([["GBP", "0.85"], ["USD", "1.10"], ["CAD", "0.66"]]));
  }
  return map;
}

function run(xml: string, year: number, method: FxMethod = "multidivisa", extra: ReportOptions = {}): TaxReport {
  const statement = finalizeMergedStatement(mergeStatement(createEmptyStatement(), parseIbkrFlexXml(xml), "Interactive Brokers"));
  return generateTaxReport(statement, rates(), year, { ...reportOptionsForMethod(method), ...extra });
}

/** The year's capital-gains contribution: net + blocked − reintegrated. */
function fiscal(r: TaxReport): string {
  const cg = r.capitalGains;
  return cg.netGainLoss.plus(cg.blockedLosses).minus(cg.reintegratedLosses).toFixed(2);
}

const msg = (r: TaxReport, id: string) => r.messages.find((m) => m.id === id);
const ONE_YEAR = "report.antichurning_one_year_ibkr";
const OPEN = "report.antichurning_listing_open";
const USER = "report.antichurning_window_user";

// The issue's example: 1 share, buy 01/02/2025 at 100, sell 01/03 at 80, buy 01/08 at 85.
const ISSUE: Row[] = [
  ["20250201", "BUY", 1, 100],
  ["20250301", "SELL", 1, 80],
  ["20250801", "BUY", 1, 85],
];

describe("#452 positive control: the issue example as an IBKR export, London vs New York", () => {
  it.each(METHODS)("[%s] listingExchange LSE → 1 year: the 01/08 rebuy blocks the −20, with a warning naming the ISIN", (method) => {
    const r = run(ibkrXml(ISSUE, "LSE"), 2025, method);
    expect(r.capitalGains.netGainLoss.toFixed(2)).toBe("-20.00");
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("20.00");
    expect(fiscal(r)).toBe("0.00");
    const sale = r.capitalGains.disposals.find((d) => d.gainLossEur.isNegative())!;
    expect(sale.washSaleRepurchaseDates).toEqual(["2025-08-01"]);
    const w = msg(r, ONE_YEAR);
    expect(w?.severity).toBe("warning");
    expect(w?.message).toContain(`LSEONLY (${ISIN}, IBKR: LSE)`);
    expect(w?.context?.count).toBe("1");
    const row = r.capitalGains.antichurningSecurities?.find((s) => s.isin === ISIN);
    expect(row).toMatchObject({ months: 12, source: "ibkr", listingExchanges: ["LSE"] });
  });

  it.each(METHODS)("[%s] listingExchange NYSE → 2 months: the −20 is deductible and no warning", (method) => {
    const r = run(ibkrXml(ISSUE, "NYSE"), 2025, method);
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("0.00");
    expect(fiscal(r)).toBe("-20.00");
    expect(msg(r, ONE_YEAR)).toBeUndefined();
    expect(r.capitalGains.antichurningSecurities?.find((s) => s.isin === ISIN)).toMatchObject({ months: 2, source: "default" });
  });

  it("no listingExchange (another broker's shape, or a Flex without the field) keeps today's 2 months", () => {
    const r = run(ibkrXml(ISSUE, ""), 2025);
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("0.00");
    expect(fiscal(r)).toBe("-20.00");
    expect(msg(r, ONE_YEAR)).toBeUndefined();
  });

  it("the same in GBP: 1 year blocks the whole EUR loss", () => {
    const r = run(ibkrXml(ISSUE, "LSE", { currency: "GBP" }), 2025, "monodivisa");
    expect(r.capitalGains.netGainLoss.isNegative()).toBe(true);
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe(r.capitalGains.netGainLoss.abs().toFixed(2));
  });
});

describe("#452 every IBKR row of the ISIN must name a letter-g market", () => {
  it("a SecurityInfo row listing NYSE turns the Trades' LSE back to 2 months (dual listing)", () => {
    const r = run(ibkrXml(ISSUE, "LSE", { securityInfo: "NYSE" }), 2025);
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("0.00");
    expect(msg(r, ONE_YEAR)).toBeUndefined();
    expect(r.capitalGains.antichurningSecurities?.find((s) => s.isin === ISIN)?.listingExchanges).toEqual(["LSE", "NYSE"]);
  });

  it("London before the end of the Brexit transition (sale in 2020) is still letter f: 2 months", () => {
    const rows: Row[] = [
      ["20200201", "BUY", 1, 100],
      ["20200301", "SELL", 1, 80],
      ["20200801", "BUY", 1, 85],
    ];
    const r = run(ibkrXml(rows, "LSE", { toDate: "20201231" }), 2020);
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("0.00");
    expect(msg(r, ONE_YEAR)).toBeUndefined();
  });

  it("SIX (EBS) after its equivalence lapsed on 30/06/2019 is 1 year", () => {
    const r = run(ibkrXml(ISSUE, "EBS", { isin: "CH0038863350" }), 2025);
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("20.00");
    expect(msg(r, ONE_YEAR)?.message).toContain("IBKR: EBS");
  });

  it("Toronto (TSE) stays at 2 months with an info message that calls the point open", () => {
    const r = run(ibkrXml(ISSUE, "TSE", { isin: "CA0084741085" }), 2025);
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("0.00");
    expect(msg(r, ONE_YEAR)).toBeUndefined();
    const open = msg(r, OPEN);
    expect(open?.severity).toBe("info");
    expect(open?.message).toContain("2016/2273");
    expect(open?.message).toContain("CA0084741085");
    expect(r.capitalGains.antichurningSecurities?.find((s) => s.isin === "CA0084741085")).toMatchObject({
      months: 2,
      openDecision: "2016/2273",
    });
  });

  it("Tokyo (TSEJ), Singapore (SGX) and LSEETF are not automatic 1 year", () => {
    for (const [code, isin] of [["TSEJ", "JP3633400001"], ["SGX", "SG1L01001701"], ["LSEETF", "IE00B4L5Y983"]] as const) {
      const r = run(ibkrXml(ISSUE, code, { isin }), 2025);
      expect(r.capitalGains.blockedLosses.toFixed(2), code).toBe("0.00");
      expect(msg(r, ONE_YEAR), code).toBeUndefined();
    }
  });
});

describe("#452 the per-ISIN user setting wins over everything", () => {
  it.each(METHODS)("[%s] 2 months set by the user beats IBKR's LSE reading, and the info message says so", (method) => {
    const r = run(ibkrXml(ISSUE, "LSE"), 2025, method, { windowMonthsByIsin: { [ISIN]: 2 } });
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("0.00");
    expect(fiscal(r)).toBe("-20.00");
    expect(msg(r, ONE_YEAR)).toBeUndefined();
    expect(msg(r, USER)?.message).toContain(ISIN);
    expect(r.capitalGains.antichurningSecurities?.find((s) => s.isin === ISIN)).toMatchObject({ months: 2, source: "user" });
  });

  it.each(METHODS)("[%s] 1 year set by the user applies with no IBKR market at all", (method) => {
    const r = run(ibkrXml(ISSUE, ""), 2025, method, { windowMonthsByIsin: { [ISIN]: 12 } });
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("20.00");
    expect(fiscal(r)).toBe("0.00");
    expect(msg(r, USER)?.message).toContain(ISIN);
  });

  it("garbage in the setting (bad ISIN, other values, a string) is ignored", () => {
    const r = run(ibkrXml(ISSUE, ""), 2025, "multidivisa", {
      windowMonthsByIsin: JSON.parse(`{"__proto__": 12, "XX123": 12, "${ISIN}": "12"}`) as Record<string, 2 | 12>,
    });
    expect(r.capitalGains.blockedLosses.toFixed(2)).toBe("0.00");
    expect(msg(r, USER)).toBeUndefined();
  });

  it("a toggle never removes the security from the list the panel draws", () => {
    const keys = (r: TaxReport) => (r.capitalGains.antichurningSecurities ?? []).map((s) => s.isin);
    const auto = run(ibkrXml(ISSUE, "LSE"), 2025);
    const two = run(ibkrXml(ISSUE, "LSE"), 2025, "multidivisa", { windowMonthsByIsin: { [ISIN]: 2 } });
    const year = run(ibkrXml(ISSUE, "LSE"), 2025, "multidivisa", { windowMonthsByIsin: { [ISIN]: 12 } });
    expect(keys(auto)).toEqual([ISIN]);
    expect(keys(two)).toEqual([ISIN]);
    expect(keys(year)).toEqual([ISIN]);
  });
});

describe("#452 one window feeds the block, the definitive test (#451) and the past-data warning (#462)", () => {
  it("a gain sale 5 months before a rebuy releases the pending loss under 2 months and keeps it pending under 1 year", () => {
    // Loss sale 01/03 (blocked by the 15/03 rebuy in both windows), gain sale
    // 01/06 of the rebought share, rebuy 01/11: 5 months after the gain sale.
    const rows: Row[] = [
      ["20250201", "BUY", 1, 100],
      ["20250301", "SELL", 1, 80],
      ["20250315", "BUY", 1, 80],
      ["20250601", "SELL", 1, 90],
      ["20251101", "BUY", 1, 85],
    ];
    const two = run(ibkrXml(rows, "NYSE"), 2025);
    expect(two.capitalGains.blockedLosses.toFixed(2)).toBe("20.00");
    expect(two.capitalGains.reintegratedLosses.toFixed(2)).toBe("20.00");
    const year = run(ibkrXml(rows, "LSE"), 2025);
    expect(year.capitalGains.blockedLosses.toFixed(2)).toBe("20.00");
    expect(year.capitalGains.reintegratedLosses.toFixed(2)).toBe("0.00");
  });

  it("the past-data warning uses the 1-year window: a September London loss sale is still open at filing", () => {
    const rows: Row[] = [
      ["20250201", "BUY", 1, 100],
      ["20250901", "SELL", 1, 80],
    ];
    const lse = run(ibkrXml(rows, "LSE", { toDate: "20250915" }), 2025);
    const open = msg(lse, "report.antichurning_window_open_at_filing");
    expect(open?.context?.windowEnd).toBe("01/09/2026");
    expect(msg(lse, "report.antichurning_window_past_data")).toBeUndefined();
    const nyse = run(ibkrXml(rows, "NYSE", { toDate: "20250915" }), 2025);
    expect(msg(nyse, "report.antichurning_window_open_at_filing")).toBeUndefined();
    expect(msg(nyse, "report.antichurning_window_past_data")?.context?.windowEnd).toBe("01/11/2025");
  });
});

describe("#452 messages: report.ts writes the same Spanish text as es.ts", () => {
  it("the three new messages and their hints localize to the engine's text in es", async () => {
    await setLocale("es");
    const reports = [
      run(ibkrXml(ISSUE, "LSE"), 2025),
      run(ibkrXml(ISSUE, "TSE", { isin: "CA0084741085" }), 2025),
      run(ibkrXml(ISSUE, ""), 2025, "multidivisa", { windowMonthsByIsin: { [ISIN]: 12 } }),
    ];
    const seen = new Set<string>();
    for (const r of reports) {
      for (const m of r.messages.filter((x) => [ONE_YEAR, OPEN, USER].includes(x.id))) {
        seen.add(m.id);
        expect(localizeMessage(m)).toBe(m.message);
        expect(localizeHint(m)).toBe(m.hint);
      }
    }
    expect([...seen].sort()).toEqual([ONE_YEAR, OPEN, USER].sort());
  });
});

describe("#452 committed IBKR fixtures: no letter-g code, so no 1-year reading", () => {
  it.each(["ibkr-autoconvert.xml", "ibkr-multicurrency.xml", "ibkr-options.xml"])("%s gives no 1-year warning in any year", async (name) => {
    const { readFileSync } = await import("node:fs");
    const xml = readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf-8");
    const statement = finalizeMergedStatement(mergeStatement(createEmptyStatement(), parseIbkrFlexXml(xml), "Interactive Brokers"));
    const years = new Set(statement.trades.map((t) => Number(t.tradeDate.replace(/-/g, "").slice(0, 4))));
    expect(statement.trades.some((t) => t.listingExchange !== undefined)).toBe(true);
    for (const year of years) {
      const r = generateTaxReport(statement, rates(), year, {});
      expect(msg(r, ONE_YEAR), `${name} ${year}`).toBeUndefined();
      expect(msg(r, USER), `${name} ${year}`).toBeUndefined();
      // ASR (TSE) and BCM (VENTURE) sell at a gain with nothing pending: no row, no open-decision note.
      expect(msg(r, OPEN), `${name} ${year}`).toBeUndefined();
      expect((r.capitalGains.antichurningSecurities ?? []).every((s) => s.months === 2), `${name} ${year}`).toBe(true);
    }
  });
});
